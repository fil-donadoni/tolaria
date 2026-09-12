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
//  - a GRANTED ABILITY instance (`grant-N`, off a per-GAME counter) is the
//    template it references: `sourceCardId` + `abilityId`. Nothing else could
//    work — a live game that has made three grants says `grant-4` where the
//    rebuild says `grant-1`, so every `activate-granted-ability` would refuse
//    for ever (PR review).
//  - everything else travels verbatim (the move kind, an ability id, a chosen
//    mode, an X, a named card, a boolean).
//
// OBJECTS BECOME SORTED PAIRS, never objects. Two reasons, both measured in PR
// review, and both specific to `declare-attackers`' `attackTargets` — the one
// Move field whose KEYS are instance ids. (1) Instance ids are bare integer
// strings (`allocInstanceId`), and both JS and `JSON.stringify` emit
// integer-like keys in ascending NUMERIC order whatever the insertion order
// was — so the serialised order followed each build's own id numbering and the
// same attack keyed two ways. (2) Writing `out[subst(key)] = …` silently
// overwrote when two keys canonicalised alike, so "both Bears attack the
// planeswalker" and "one attacks it, one goes to the face" collapsed to ONE
// key — two semantically different moves, indistinguishable. A sorted array of
// `[key, value]` pairs fixes the order and keeps the cardinality.
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
// equality up to isomorphism would live). ARRAY order is likewise semantic and
// left alone: `tapPlan` and a `resolution-choice`'s `cardInstanceIds` are
// ordered payloads, so sorting them would discard a real difference.

import type { GameState } from "./state";
import type { Move } from "./moves";

/** Prefix for a canonicalised player id. */
const SEAT = "seat#";
/** Prefix for a canonicalised card instance id. */
const CARD = "card#";
/** Prefix for a canonicalised granted-ability instance id. */
const GRANT = "grant#";

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

/**
 * A canonical token per per-world HANDLE `state` holds: `card#<definition id>`
 * for a card instance, `grant#<source card>:<ability>` for a granted ability.
 *
 * EVERY place a card instance can sit is walked, not only the five zones a
 * Move usually names. A handle left out of this map is left verbatim, which is
 * the safe direction for one side — but if both sides happened to allocate the
 * SAME integer for DIFFERENT cards in a zone nobody walked, they would AGREE
 * wrongly, and that is the one failure this file cannot afford (PR review).
 */
function handleTokens(state: GameState): Map<string, string> {
    const tokens = new Map<string, string>();
    const take = (instance: { id: string; card: Record<string, unknown> }) => {
        // `CardInstanceState.card` is documented as a definition REFERENCE
        // whose only readable field is `id` (`gre/state.ts`). A legacy fixture
        // that inlines metadata without one is left unresolved rather than
        // keyed off something engine code is told not to read.
        const definitionId = (instance.card as { id?: string }).id;
        if (definitionId) tokens.set(instance.id, `${CARD}${definitionId}`);
    };
    for (const player of state.players) {
        for (const zone of [
            player.battlefield,
            player.hand,
            player.graveyard,
            player.exile,
            player.library,
        ]) {
            for (const instance of zone) take(instance);
        }
        // CR 702.139a — the companion slot holds a real instance.
        if (player.companion) take(player.companion.instance);
        for (const grant of player.grantedAbilities ?? []) {
            // CR 113.1b — `grant-N` comes off `GameState.nextGrantSeq`, a
            // per-GAME counter, so it is pure per-world noise. The template the
            // grant references is what identifies it on both sides.
            tokens.set(
                grant.id,
                `${GRANT}${grant.sourceCardId}:${grant.abilityId}`
            );
        }
    }
    for (const item of state.stack) take(item);
    // CR 614.12a (ADR 0100) — an entry parked mid-flight is off every zone.
    for (const staged of state.stagedEntries ?? []) take(staged.card);
    // CR 702.26 — a phased-out bundle is off the battlefield but still real.
    for (const bundle of state.phasedOut ?? []) {
        for (const instance of bundle.cards) take(instance);
    }
    return tokens;
}

/** Replace one string with its canonical coordinate, or leave it alone. */
function substitution(
    state: GameState,
    deciderId: string
): (value: string) => string {
    const seats = relativeSeatIndexes(state, deciderId);
    const handles = handleTokens(state);
    return (value) => {
        const seat = seats.get(value);
        if (seat !== undefined) return `${SEAT}${seat}`;
        return handles.get(value) ?? value;
    };
}

/** Deep-walk `value`, substituting every string — object KEYS included, which
 *  is what `declare-attackers`' `attackTargets` record needs (its keys are
 *  attacker ids). Generic on purpose: a Move kind added tomorrow is
 *  canonicalised without editing this file, which is the one property a
 *  per-kind switch could not have.
 *
 *  An object becomes a SORTED ARRAY OF PAIRS — see this file's header for the
 *  two failures that made both halves of that necessary. Sorted by the whole
 *  serialised pair, not by its key: two entries whose keys canonicalise alike
 *  are kept, and only a total order on the pair puts them in the same sequence
 *  on both sides. */
function canonicalise(value: unknown, subst: (s: string) => string): unknown {
    if (typeof value === "string") return subst(value);
    if (Array.isArray(value)) return value.map((v) => canonicalise(v, subst));
    if (value !== null && typeof value === "object") {
        return Object.entries(value)
            .map(([key, inner]): [string, unknown] => [
                subst(key),
                canonicalise(inner, subst),
            ])
            .map((pair): [string, [string, unknown]] => [
                JSON.stringify(pair),
                pair,
            ])
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, pair]) => pair);
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
