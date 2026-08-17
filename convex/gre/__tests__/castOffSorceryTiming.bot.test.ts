// Bot-lane half of the "cast off sorcery timing" producer census (CR 307.1 /
// 117.1a / 601.3a, issue #2473). Lives in its own `*.bot.test.ts` file because
// `convex/gre/search.ts` is a declared bot module (`bot-suite-boundary.test.ts`
// / `BOT_MODULE_EXACT`), so any test importing it belongs to `test:bot`.
//
// There are TWO wholesale "build a StackItem from a cast" reimplementations in
// the bot, and only one of them is the greedy sandbox:
//   - `applyMoveForSearch` (`applyMove.ts`) — the GREEDY 1-ply sandbox, whose
//     sole caller is `greedy.ts`. Covered in `castOffSorceryTiming.test.ts`
//     (applyMove.ts is not a declared bot module).
//   - `applyMoveInSearch` (`search.ts`) — the ISMCTS chokepoint every rollout,
//     every blade scenario and all self-play route through. Covered HERE.
// Missing the second one means the bot simulates a game in which the flag is
// universally absent, while the server it feeds moves to stamps it.
//
// A THIRD bot-side builder exists — `applyProbeCast` in `gre/ai/dominance.ts`,
// the dominance-pruning probe — whose contract is explicitly "exactly as the
// real cast does". It is covered here too (round-3 review finding 2).
import { describe, it, expect } from "vitest";
import { applyMoveInSearch } from "../search";
import { applyProbeCast } from "../ai/dominance";
import type { Move } from "../moves";
import { type GameState, type StackItem } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

// A free vanilla creature — the payment machinery is irrelevant to the timing
// snapshot, and a zero cost keeps the in-tree tap plan empty.
const SEARCH_TIMING_PROBE_ID = "test:search-timing-probe";
const searchTimingProbe: CardDefinition = {
    id: SEARCH_TIMING_PROBE_ID,
    rarity: "common",
    name: "Search Timing Probe",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 1,
    toughness: 1,
};
registerTokenDefinition(searchTimingProbe);

function castProbeInSearch(state: GameState): void {
    const move: Move = {
        kind: "cast-spell",
        cardInstanceId: "searchprobe",
        targets: [],
        confirmTargets: false,
        tapPlan: [],
    };
    applyMoveInSearch(state, "p1", move);
}

/** Wherever the cast spell ended up after the in-tree auto-pass drain — still
 *  on the stack, or already resolved onto the battlefield. */
function probeAfterCast(
    state: GameState
): StackItem | ReturnType<typeof makeInstance> | undefined {
    return (
        state.stack.find((s) => s.id === "searchprobe") ??
        state.players[0].battlefield.find((c) => c.id === "searchprobe")
    );
}

describe("cast off sorcery timing — ISMCTS in-tree cast-spell executor (convex/gre/search.ts, issue #2473)", () => {
    it("stamps the flag when the in-tree cast happens at INSTANT timing", () => {
        const probeInst = makeInstance(SEARCH_TIMING_PROBE_ID, {
            id: "searchprobe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
        });
        castProbeInSearch(state);
        const probe = probeAfterCast(state);
        expect(probe).toBeDefined();
        expect(probe?.castOffSorceryTiming).toBe(true);
    });

    it("omits the flag when the in-tree cast happens at SORCERY timing", () => {
        const probeInst = makeInstance(SEARCH_TIMING_PROBE_ID, {
            id: "searchprobe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // makeState's defaults ARE sorcery timing: PRECOMBAT_MAIN, empty
        // stack, active === priority === "p1".
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
        });
        castProbeInSearch(state);
        const probe = probeAfterCast(state);
        expect(probe).toBeDefined();
        expect(probe?.castOffSorceryTiming).toBe(undefined);
    });
});

describe("cast off sorcery timing — dominance-pruning probe cast (convex/gre/ai/dominance.ts, issue #2473)", () => {
    /** The probe board `applyProbeCast` is handed, plus the cast move. The
     *  pruning seam itself returns only a boolean, so the stamp is asserted on
     *  the probe's own stack item — the state `isNoOpDelta` then compares. */
    function probeCastBoard(
        phase: "PRECOMBAT_MAIN" | "DECLARE_ATTACKERS"
    ): GameState {
        const probeInst = makeInstance(SEARCH_TIMING_PROBE_ID, {
            id: "searchprobe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        return makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase,
        });
    }

    const probeCastMove: Extract<Move, { kind: "cast-spell" }> = {
        kind: "cast-spell",
        cardInstanceId: "searchprobe",
        targets: [],
        confirmTargets: false,
        tapPlan: [],
    };

    it("stamps the flag when the probe cast happens at INSTANT timing", () => {
        const state = probeCastBoard("DECLARE_ATTACKERS");
        expect(applyProbeCast(state, "p1", probeCastMove)).toBe(true);
        const item = state.stack.find((s) => s.id === "searchprobe");
        expect(item).toBeDefined();
        expect(item?.castOffSorceryTiming).toBe(true);
    });

    it("omits the flag when the probe cast happens at SORCERY timing", () => {
        const state = probeCastBoard("PRECOMBAT_MAIN");
        expect(applyProbeCast(state, "p1", probeCastMove)).toBe(true);
        const item = state.stack.find((s) => s.id === "searchprobe");
        expect(item).toBeDefined();
        expect(item?.castOffSorceryTiming).toBe(undefined);
    });
});
