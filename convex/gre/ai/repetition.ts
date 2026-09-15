/**
 * Position repetition — the Bot's memory of where it has already stood
 * (issue #3590).
 *
 * THE CLASS. An optional loop (CR 104.4b makes only a MANDATORY one a draw,
 * and CR 732.5 never forces a player out of an optional one) is a sequence of
 * the Bot's own decisions that returns the game to a position it has already
 * occupied, with no progress. The search cannot see that: every search starts
 * from a single `GameState`, and two visits of the same position carry the
 * SAME feature vector under every evaluation term by construction — the
 * history is not in the state. So no `evaluate` term and no fitted weight can
 * ever separate "loop again" from "loop for the first time"; the axis is the
 * decision history, and it has to be handed in.
 *
 * THE RULE. A loop is the SAME action, taken again in the same step, that
 * bought nothing since the last time. So the history maps (phase, move) — one
 * turn at a time — to the seat's PROGRESS when it took that move: its
 * `materialMargin`, plus the spell count while a storm card could read it
 * (CR 702.40). When the seat decides again at a priority node in that step, a
 * move it already took there is denied unless it has made progress since —
 * a strictly better margin, or more spells for a storm payoff
 * (`searchWithTrace`). A loop that drains the opponent a point per lap is a loop
 * toward a win, and it is allowed to finish. `pass` is never denied and the
 * deny-set never empties the move list, so each no-progress repeat strictly
 * shrinks a finite set.
 *
 * WHY NOT "THE SAME POSITION". An exact position repeat was the first design,
 * and the Tier 1 smoke outgrew it twice. A Parallax Wave exiling opposing
 * Goblins with enters triggers, then itself, hands the opponent a tutor or a
 * token on every lap, so the whole position never repeats. The same loop run
 * in response to those triggers grows the STACK every lap, so even the seat's
 * own side never repeats. In both the seat takes the identical action again,
 * in the same step, no better off — and that is what is keyed. Everything the
 * opponent's side or the stack does is judged through the margin: a lap that
 * helped the opponent reads as no progress; a lap that hurt them is progress.
 *
 * Nothing here names a card: the Parallax Wave refill under Opalescence and an
 * Aluren creature bounce are the same shape to this module.
 *
 * WHAT A POSITION IS — `positionFingerprint`, what a blade `revisit` walk must
 * return to. The `GameState`, canonically serialised, minus:
 *   * the bookkeeping `dominance.ts` already treats as "changed nothing"
 *     (allocator cursors, lazy layer memos, the rng cursor, per-turn
 *     activation and trigger tallies);
 *   * wire bookkeeping a projected state carries (`seq`, bumped by every save
 *     — live play fingerprints the projection, and a history keyed on `seq`
 *     would never match a second time);
 *   * the per-turn TALLIES a loop lap bumps (`lifeGainedThisTurn`,
 *     `deathsThisTurn`, `drawnThisTurn`, …) and exile-bundle ids.
 * Battlefield, hand and exile are compared as sets; everything else in order.
 * `priorityPlayerId` / `passCount` are KEPT, unlike in `dominance.ts`: a pass
 * with one pass banked resolves the stack, a pass with none hands priority
 * over.
 *
 * THE TRADE, stated rather than hidden. An UNLISTED field is compared, so a new
 * `GameState` field can only hide a repetition (the loop survives, as it did
 * before this module). An IGNORED tally is the other direction: a lap whose
 * ONLY change is that tally reads as a repeat, and its move is denied. That is
 * the point for an Aluren bounce, whose lap changes nothing but the spell
 * count — and it would be wrong wherever something READS the tally. The one
 * such reader this engine has for the spell count is storm (CR 702.40), so
 * while any storm card is in a hand, on the battlefield or on the stack the
 * spell counts are part of the position again. The other tallies have no loop
 * that pays off through them today; a card that makes one pay off belongs on
 * the same footing as storm here.
 *
 * Determinism: a pure function of the state and the history the caller hands
 * in. The history is plain data (strings and arrays), so it survives the
 * Worker's structured-clone hop.
 */

import type { GameState } from "../state";
import { materialMargin } from "../evaluate";
import type { Move } from "../moves";
import {
    IGNORED_INSTANCE_KEYS,
    IGNORED_MOVER_PLAYER_KEYS,
    IGNORED_STATE_KEYS,
} from "./dominance";

/** Kept in a position even though `dominance.ts` ignores them — see the module
 *  header: who holds priority and how many passes are banked change what a
 *  pass does. */
const KEPT_PRIORITY_KEYS: ReadonlySet<string> = new Set([
    "priorityPlayerId",
    "passCount",
]);

/** Fields a PROJECTED state carries that the engine's own state does not, and
 *  which move on every save without the game moving. */
const WIRE_STATE_KEYS = ["seq"] as const;

/** Game-level tallies a loop lap bumps without changing the board. */
const TALLY_STATE_KEYS = [
    "deathsThisTurn",
    "lifeGainedThisTurn",
    "damageDealtToPlayerThisTurn",
    "artifactDamageToPlayerThisTurn",
    "creatureAttackedThisTurn",
    "controlChangedThisTurn",
    // Last-known information cache written by every departure — a lookup
    // table, not a game fact of its own.
    "lastKnownCopiable",
] as const;

/** Player-level tallies, stripped for EVERY player (a loop can be run by
 *  either seat), on top of the mover keys `dominance.ts` already ignores. */
const TALLY_PLAYER_KEYS = [
    "spellsWarpedThisTurn",
    "drawnThisTurn",
    "leftGraveyardThisTurn",
    "permanentYouControlledLeftThisTurn",
    "lastDrawnCardId",
] as const;

/** The spell-count tally, restored to the position while a storm card could
 *  read it (see the module header). Same name at game and player level. */
const SPELL_COUNT_KEY = "spellsCastThisTurn";

/** The storm keyword id (CR 702.40), as the Mechanics Registry names it. */
const STORM_KEYWORD = "storm";

type IgnoreSets = {
    state: ReadonlySet<string>;
    player: ReadonlySet<string>;
};

function ignoreSets(keepSpellCount: boolean): IgnoreSets {
    const drop = (k: string) =>
        KEPT_PRIORITY_KEYS.has(k) || (keepSpellCount && k === SPELL_COUNT_KEY);
    return {
        state: new Set(
            [
                ...IGNORED_STATE_KEYS,
                ...WIRE_STATE_KEYS,
                ...TALLY_STATE_KEYS,
            ].filter((k) => !drop(k))
        ),
        player: new Set(
            [...IGNORED_MOVER_PLAYER_KEYS, ...TALLY_PLAYER_KEYS].filter(
                (k) => !drop(k)
            )
        ),
    };
}

const IGNORE_DEFAULT = ignoreSets(false);
const IGNORE_WITH_SPELL_COUNT = ignoreSets(true);
const IGNORED_INSTANCE: ReadonlySet<string> = new Set(IGNORED_INSTANCE_KEYS);

/** Zones with no meaningful order (CR 403.1 battlefield, 402.1 hand, 406.1
 *  exile), compared as sets. The library (CR 401.1) and the stack (CR 405.2)
 *  are ordered and compared as sequences; so is the graveyard, the fail-closed
 *  side. */
const UNORDERED_ZONE_KEYS: ReadonlySet<string> = new Set([
    "battlefield",
    "hand",
    "exile",
]);

function hasStorm(item: unknown): boolean {
    const abilities = (item as { staticAbilities?: unknown }).staticAbilities;
    return Array.isArray(abilities) && abilities.includes(STORM_KEYWORD);
}

/** Is anything in a position to read the spell count (CR 702.40)? */
function spellCountIsRead(state: GameState): boolean {
    for (const player of state.players) {
        if (player.hand.some(hasStorm) || player.battlefield.some(hasStorm)) {
            return true;
        }
    }
    return state.stack.some(hasStorm);
}

/** Canonical JSON: sorted keys, `undefined` dropped, a card DEFINITION
 *  reference (the `card` field) lowered to its id. `ignore` strips keys at the
 *  object it is applied to, and rides down into arrays of the same records. */
function canonical(
    value: unknown,
    ignore: ReadonlySet<string> | null,
    sets: IgnoreSets,
    out: string[]
): void {
    if (value === null || typeof value !== "object") {
        if (value === undefined || typeof value === "function") {
            out.push("null");
        } else {
            out.push(JSON.stringify(value));
        }
        return;
    }
    if (Array.isArray(value)) {
        out.push("[");
        value.forEach((v, i) => {
            if (i > 0) out.push(",");
            canonical(v, ignore, sets, out);
        });
        out.push("]");
        return;
    }
    const obj = value as Record<string, unknown>;
    out.push("{");
    let first = true;
    for (const key of Object.keys(obj).sort()) {
        const v = obj[key];
        if (v === undefined || typeof v === "function") continue;
        if (ignore?.has(key)) continue;
        if (!first) out.push(",");
        first = false;
        out.push(JSON.stringify(key), ":");
        if (key === "card" && v !== null && typeof v === "object") {
            out.push(JSON.stringify((v as { id?: unknown }).id ?? null));
        } else if (UNORDERED_ZONE_KEYS.has(key) && Array.isArray(v)) {
            // A zone whose order is no part of the game: an object that
            // leaves and returns is appended at the END, so the same set of
            // permanents in another order is the same position.
            const items = v.map((item) => {
                const part: string[] = [];
                canonical(item, IGNORED_INSTANCE, sets, part);
                return part.join("");
            });
            out.push("[", items.sort().join(","), "]");
        } else {
            // Every nested object may be a card instance (zones, stack items,
            // attachments), so the instance ignore list rides down the tree.
            canonical(v, IGNORED_INSTANCE, sets, out);
        }
    }
    out.push("}");
}

/** cyrb53 — a fast, well-mixed 53-bit string hash. Two seeds give ~106 bits,
 *  so the history stores a short key instead of a whole serialised state. */
function cyrb53(str: string, seed: number): string {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** An exile-and-return bundle's own `id` comes from the instance allocator
 *  (`allocInstanceId`), whose cursor is already bookkeeping: the same card
 *  exiled by the same source on a later lap is the same held exile under a
 *  fresh number. Everything else about the bundle — source, host, owner,
 *  attachments, noted counters — stays part of the position. */
function withoutBundleIds(held: unknown): unknown {
    if (!Array.isArray(held)) return held;
    return held.map((b) =>
        b !== null && typeof b === "object" ? { ...b, id: undefined } : b
    );
}

function fingerprintOf(state: GameState): string {
    const sets = spellCountIsRead(state)
        ? IGNORE_WITH_SPELL_COUNT
        : IGNORE_DEFAULT;
    const out: string[] = [];
    const top = state as unknown as Record<string, unknown>;
    out.push("{");
    let first = true;
    for (const key of Object.keys(top).sort()) {
        const v = top[key];
        if (v === undefined || sets.state.has(key)) continue;
        if (!first) out.push(",");
        first = false;
        out.push(JSON.stringify(key), ":");
        canonical(
            key === "exileHeld" ? withoutBundleIds(v) : v,
            key === "players" ? sets.player : IGNORED_INSTANCE,
            sets,
            out
        );
    }
    out.push("}");
    const text = out.join("");
    return `${cyrb53(text, 1)}-${cyrb53(text, 2)}`;
}

/** The WHOLE position key of `state`: equal for two states that differ only in
 *  bookkeeping (see the module header), different otherwise. What a blade
 *  `revisit` walk must return to. */
export function positionFingerprint(state: GameState): string {
    return fingerprintOf(state);
}

/** A margin strictly better than the recorded one by more than this is
 *  progress. Floating-point slack only: every real change moves the margin by
 *  a whole weight. */
const PROGRESS_EPS = 1e-9;

/** The seat's progress at the moment it took a move in a step. */
export type RepetitionEntry = {
    /** The seat's `materialMargin`. */
    margin: number;
    /** The seat's spell count this turn while a storm card could read it
     *  (CR 702.40); 0 otherwise. */
    spells: number;
};

/** The Bot's decision history for one seat: step-and-move key → the progress
 *  it had when it last took that move there. Plain data so it crosses
 *  `postMessage`. Scoped to one turn — an entry from an earlier turn is
 *  dropped rather than carried. */
export type RepetitionHistory = {
    turn: number;
    chosen: Record<string, RepetitionEntry>;
};

export function emptyRepetitionHistory(): RepetitionHistory {
    return { turn: -1, chosen: {} };
}

/** The same key the search's root layer uses for its own moves
 *  (`moveKey`, `search.ts`) — kept local so this module does not import the
 *  search. */
export function repetitionMoveKey(move: Move): string {
    return JSON.stringify(move);
}

/** Separates the step from the move key; never part of a JSON move. */
const STEP_SEPARATOR = "\u0000";

function stepPrefix(state: GameState): string {
    return `${state.phase}${STEP_SEPARATOR}`;
}

function progressOf(state: GameState, seatId: string): RepetitionEntry {
    const seat = state.players.find((p) => p.id === seatId);
    return {
        margin: materialMargin(state, seatId),
        spells: spellCountIsRead(state) ? (seat?.spellsCastThisTurn ?? 0) : 0,
    };
}

function madeProgress(now: RepetitionEntry, then: RepetitionEntry): boolean {
    return now.margin > then.margin + PROGRESS_EPS || now.spells > then.spells;
}

/** Record that `seatId` took `move` at `state`. Returns the updated history (a
 *  new object — the caller's value is never mutated). An entry is written the
 *  first time the move is taken in this step, and rewritten whenever it is
 *  taken again after progress; `pass` is never remembered, since it is never
 *  denied. */
export function recordRepetition(
    history: RepetitionHistory | undefined,
    state: GameState,
    seatId: string,
    move: Move
): RepetitionHistory {
    const base =
        history && history.turn === state.turn
            ? history
            : { turn: state.turn, chosen: {} };
    if (move.kind === "pass") return base;
    const key = stepPrefix(state) + repetitionMoveKey(move);
    const now = progressOf(state, seatId);
    const prior = base.chosen[key];
    if (prior && !madeProgress(now, prior)) return base;
    return { turn: base.turn, chosen: { ...base.chosen, [key]: now } };
}

/** The move keys `seatId` already took in `state`'s step with no progress
 *  since — the moves that would only repeat the lap. Empty for a new step, a
 *  history from another turn, or once the seat has made progress. */
export function repeatedMoveKeys(
    history: RepetitionHistory | undefined,
    state: GameState,
    seatId: string
): ReadonlySet<string> {
    if (!history || history.turn !== state.turn) return EMPTY;
    const prefix = stepPrefix(state);
    let now: RepetitionEntry | undefined;
    const out = new Set<string>();
    for (const [key, entry] of Object.entries(history.chosen)) {
        if (!key.startsWith(prefix)) continue;
        now ??= progressOf(state, seatId);
        if (!madeProgress(now, entry)) out.add(key.slice(prefix.length));
    }
    return out.size > 0 ? out : EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();
