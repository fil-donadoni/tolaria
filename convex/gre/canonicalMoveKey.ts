// A Move's identity ACROSS TWO BUILDS of the same position (issue #3483).
//
// `search.ts`'s `moveKey` is the structural key WITHIN one build: it embeds
// every field verbatim, instance ids included, which is exactly right for a
// tree node and exactly wrong for comparing a live decision against the same
// position rebuilt from a `ScenarioSpec`. Two builds allocate different ids,
// so `moveKey` never agrees across them.
//
// The verdict lowering used to compare through `describeMove` instead, on the
// stated grounds that the describer's sentence was "the only vocabulary they
// share". It is not a shared vocabulary: the describer is a function built to
// be READ BY A HUMAN, and a human sentence names the player — so a decision
// targeting a player rendered "→ Mr bambury (P1)" on the live board and
// "→ Blade P2" on the rebuild, and the guard refused a position it had
// captured perfectly. The player name was the first symptom, not the bug: any
// per-world fact the describer reaches for is a further instance of it.
//
// So the comparison gets its own key, built from coordinates the rebuild
// reproduces deterministically from the spec and nothing else:
//
//  - a PLAYER is its seat index RELATIVE to the seat being judged — 0 for the
//    decider, 1..n for the others in turn order. Not a name, and not a binary
//    you/opponent role: two seats is what the product ships, but a relative
//    index costs nothing extra and stays unambiguous if a third ever exists,
//    so nothing here has to be fenced off above two players.
//  - a CARD INSTANCE is its card DEFINITION id — the same swap
//    `priorityMoveKey` makes for a hand-sourced id, for the same reason it
//    gives: "the invariant that actually identifies the semantic move".
//  - everything else travels verbatim (the move kind, an ability id, a chosen
//    mode, an X, a named card, a boolean).
//
// FAIL-CLOSED, deliberately: a string this module cannot place — an id whose
// instance is in no zone, an instance whose `card` carries no definition id —
// is left exactly as it is. The two sides then disagree and the caller refuses
// the position, which is the safe direction. Substituting a shared "unknown"
// marker would make them AGREE on a fact neither established.
//
// KNOWN LIMIT, carried over from the describer unchanged: two interchangeable
// candidates — the same play on two copies of the same card — produce the same
// key, because card identity is all either side has. No better and no worse
// than the sentence this replaces (issue #3139 is where structural state
// equality up to isomorphism would live).

import type { GameState } from "./state";
import type { Move } from "./moves";

/** Prefix for a canonicalised player id. */
const SEAT = "seat#";
/** Prefix for a canonicalised card instance id. */
const CARD = "card#";

/**
 * Every player id in `state`, keyed to its seat index RELATIVE to `deciderId`
 * — 0 for the decider itself, then 1..n round the seat order (which is turn
 * order).
 *
 * Empty when `deciderId` is not a seat in `state`: there is no relative frame
 * to express, and an absolute index would be a different coordinate system
 * wearing the same name.
 */
export function relativeSeatIndexes(
    state: GameState,
    deciderId: string
): Map<string, number> {
    const seats = new Map<string, number>();
    const decider = state.players.findIndex((p) => p.id === deciderId);
    if (decider < 0) return seats;
    const count = state.players.length;
    state.players.forEach((player, index) => {
        seats.set(player.id, (index - decider + count) % count);
    });
    return seats;
}

/** Definition id per card instance id, across every zone `state` holds. */
function cardTokens(state: GameState): Map<string, string> {
    const tokens = new Map<string, string>();
    for (const player of state.players) {
        for (const zone of [
            player.battlefield,
            player.hand,
            player.graveyard,
            player.exile,
            player.library,
        ]) {
            for (const instance of zone) {
                // `CardInstanceState.card` is documented as a definition
                // REFERENCE whose only readable field is `id` (`gre/state.ts`).
                // A legacy fixture that inlines metadata without one is left
                // unresolved rather than keyed off something engine code is
                // told not to read.
                const definitionId = (instance.card as { id?: string }).id;
                if (definitionId) tokens.set(instance.id, definitionId);
            }
        }
    }
    for (const item of state.stack) {
        const definitionId = (item.card as { id?: string }).id;
        if (definitionId) tokens.set(item.id, definitionId);
    }
    return tokens;
}

/** Replace one string with its canonical coordinate, or leave it alone. */
function substitution(
    state: GameState,
    deciderId: string
): (value: string) => string {
    const seats = relativeSeatIndexes(state, deciderId);
    const cards = cardTokens(state);
    return (value) => {
        const seat = seats.get(value);
        if (seat !== undefined) return `${SEAT}${seat}`;
        const card = cards.get(value);
        return card === undefined ? value : `${CARD}${card}`;
    };
}

/** Deep-walk `value`, substituting every string — object KEYS included, which
 *  is what `declare-attackers`' `attackTargets` record needs (its keys are
 *  attacker ids). Generic on purpose: a Move kind added tomorrow is
 *  canonicalised without editing this file, which is the one property a
 *  per-kind switch could not have. */
function canonicalise(value: unknown, subst: (s: string) => string): unknown {
    if (typeof value === "string") return subst(value);
    if (Array.isArray(value)) return value.map((v) => canonicalise(v, subst));
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            out[subst(key)] = canonicalise(inner, subst);
        }
        return out;
    }
    return value;
}

/**
 * The key that identifies `move` as a SEMANTIC move, independent of which
 * build of the position produced it.
 *
 * `deciderId` is the seat the move belongs to; player ids are expressed
 * relative to it, so the same play keys identically on a live board and on
 * that board rebuilt from its `ScenarioSpec`.
 *
 * Field ORDER is inherited from the move object, exactly as `moveKey`
 * inherits it: both sides are built by the same enumerator, so the same kind
 * of move always lays its fields out the same way.
 */
export function canonicalMoveKey(
    move: Move,
    state: GameState,
    deciderId: string
): string {
    return JSON.stringify(canonicalise(move, substitution(state, deciderId)));
}
