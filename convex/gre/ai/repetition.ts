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
 * THE RULE. When the Bot decides at a position whose fingerprint it has
 * already recorded, every move it chose there before is denied at the root —
 * that move is what led back here. `pass` is never denied (it is the floor
 * that always makes progress), and the deny-set never empties the move list.
 * Each revisit denies at least one more move from a finite list, so any loop
 * through identical positions ends.
 *
 * Nothing here names a card: the Parallax Wave refill under Opalescence and an
 * Aluren creature bounce are the same shape to this module.
 *
 * WHAT A POSITION IS. The whole `GameState`, canonically serialised, minus the
 * bookkeeping that moves on every action without changing the game — the SAME
 * ignore lists `dominance.ts` uses to decide a move "changed nothing"
 * (allocator cursors, lazy layer memos, rng cursor, per-turn activation and
 * trigger tallies), plus the per-turn/per-game TALLIES a loop bumps on every
 * lap (`spellsCastThisTurn`, `lifeGainedThisTurn`, …). Everything else is
 * compared, so a new `GameState` field is part of the position by default: the
 * worst an unlisted field can do is hide a repetition (the loop survives, as
 * it did before this module), never deny a move that made progress.
 * `priorityPlayerId` / `passCount` are deliberately KEPT, unlike in
 * `dominance.ts`: a pass with one pass banked resolves the stack, a pass with
 * none hands priority over, so they are different positions.
 *
 * Determinism: a pure function of the state and the history the caller hands
 * in. The history is plain data (strings and arrays), so it survives the
 * Worker's structured-clone hop.
 */

import type { GameState } from "../state";
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

const IGNORED_STATE: ReadonlySet<string> = new Set(
    [...IGNORED_STATE_KEYS, ...TALLY_STATE_KEYS].filter(
        (k) => !KEPT_PRIORITY_KEYS.has(k)
    )
);
const IGNORED_PLAYER: ReadonlySet<string> = new Set([
    ...IGNORED_MOVER_PLAYER_KEYS,
    ...TALLY_PLAYER_KEYS,
]);
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

/** Canonical JSON: sorted keys, `undefined` dropped, a card DEFINITION (the
 *  `card` field every instance and stack item shares by reference) lowered to
 *  its id. `ignore` strips keys at the object it is applied to. */
function canonical(
    value: unknown,
    ignore: ReadonlySet<string> | null,
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
            canonical(v, ignore === IGNORED_INSTANCE ? ignore : null, out);
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
        } else if (key === "players") {
            canonical(v, IGNORED_PLAYER, out);
        } else if (UNORDERED_ZONE_KEYS.has(key) && Array.isArray(v)) {
            // A zone whose order is no part of the game: an object that
            // leaves and returns is appended at the END, so the same set of
            // permanents in another order is the same position.
            const items = v.map((item) => {
                const part: string[] = [];
                canonical(item, IGNORED_INSTANCE, part);
                return part.join("");
            });
            out.push("[", items.sort().join(","), "]");
        } else {
            // Every nested object may be a card instance (zones, stack items,
            // attachments), so the instance ignore list rides down the tree.
            canonical(v, IGNORED_INSTANCE, out);
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

/** The position key of `state`: equal for two states that differ only in
 *  bookkeeping (see the module header), different otherwise. */
export function positionFingerprint(state: GameState): string {
    const out: string[] = [];
    const top = state as unknown as Record<string, unknown>;
    out.push("{");
    let first = true;
    for (const key of Object.keys(top).sort()) {
        const v = top[key];
        if (v === undefined || IGNORED_STATE.has(key)) continue;
        if (!first) out.push(",");
        first = false;
        out.push(JSON.stringify(key), ":");
        canonical(
            v,
            key === "players" ? IGNORED_PLAYER : IGNORED_INSTANCE,
            out
        );
    }
    out.push("}");
    const text = out.join("");
    return `${cyrb53(text, 1)}-${cyrb53(text, 2)}`;
}

/** The Bot's decision history for one seat: position fingerprint → the move
 *  keys it chose there. Plain data so it crosses `postMessage`. Scoped to one
 *  turn — a position embeds its turn number, so an entry from an earlier turn
 *  can never match again and is dropped rather than carried. */
export type RepetitionHistory = {
    turn: number;
    chosen: Record<string, string[]>;
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

/** Record that the seat chose `move` at `state`. Returns the updated history
 *  (a new object — the caller's value is never mutated). `pass` is not
 *  recorded: it is never denied, so remembering it buys nothing. */
export function recordRepetition(
    history: RepetitionHistory | undefined,
    state: GameState,
    move: Move
): RepetitionHistory {
    const base =
        history && history.turn === state.turn
            ? history
            : { turn: state.turn, chosen: {} };
    if (move.kind === "pass") return base;
    const fp = positionFingerprint(state);
    const key = repetitionMoveKey(move);
    const prior = base.chosen[fp] ?? [];
    if (prior.includes(key)) return base;
    return {
        turn: base.turn,
        chosen: { ...base.chosen, [fp]: [...prior, key] },
    };
}

/** The move keys already chosen at `state`'s position — the moves that led the
 *  game back here. Empty when the position is new (or the history is from
 *  another turn). */
export function repeatedMoveKeys(
    history: RepetitionHistory | undefined,
    state: GameState
): ReadonlySet<string> {
    if (!history || history.turn !== state.turn) return EMPTY;
    const keys = history.chosen[positionFingerprint(state)];
    return keys ? new Set(keys) : EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();
