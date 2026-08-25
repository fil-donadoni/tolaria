// CR 122.1 — "A counter is a marker placed on an object or player". The
// player-counter field map and its reader (issue #1969).
//
// A DEPENDENCY-FREE LEAF, deliberately NOT part of `gre/constants.ts`. Both of
// its imports are `import type` and therefore erased, so this module adds ZERO
// runtime import edges — which is the whole point. `gre/constants.ts` imports
// the card REGISTRY (`../cards`) at runtime, so any module that pulls a helper
// out of it also pulls in every set file; when `scenarioGenerator.ts` did that
// for `readPlayerCounters`, it re-ordered module evaluation enough to make an
// existing `cards/sets/ecl → gre/protection → gre/layers → gre/constants →
// cards` cycle resolve the OTHER way, and Figure of Fable's
// `PROTECTION_FROM_EACH_OPPONENT` grant evaluated to `undefined` (caught by
// `cards/__tests__/effectScripts.test.ts`). See
// `docs/findings/1969-figure-of-fable-import-cycle.md`.
import type { PlayerCounterKind } from "../cards/types";
import type { PlayerState } from "./state";

/** CR 122.1 — the single map from a {@link PlayerCounterKind} to the dedicated
 *  `PlayerState` scalar that stores it (ADR 0032: player counters are named
 *  fields, never entries in a generic `counters[type]` map).
 *
 *  Every player-counter read and write goes through this map — the
 *  `addPlayerCounter` Op executor, the `playerCounters` `EffectValue` reader,
 *  the `SpellContext.addPlayerCounters`/`getPlayerCounters` primitives, the
 *  canned-scenario assertor and the bot's valuer. Typed as an exhaustive
 *  `Record<PlayerCounterKind, …>`, so adding a kind to `PLAYER_COUNTER_KINDS`
 *  without a field here is a type error rather than a silent read of
 *  `undefined`. */
export const PLAYER_COUNTER_FIELD: Readonly<
    Record<
        PlayerCounterKind,
        "poisonCounters" | "energyCounters" | "experienceCounters"
    >
> = {
    poison: "poisonCounters",
    energy: "energyCounters",
    experience: "experienceCounters",
};

/** CR 122.1 — reads a player's total of one player-counter kind (0 when the
 *  scalar is absent). The single reader every consumer shares. */
export function readPlayerCounters(
    player: PlayerState,
    kind: PlayerCounterKind
): number {
    return player[PLAYER_COUNTER_FIELD[kind]] ?? 0;
}
