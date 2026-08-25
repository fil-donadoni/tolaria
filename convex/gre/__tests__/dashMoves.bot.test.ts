// Bot-lane half of Dash (CR 702.109a, issue #1964): the cast mode has to be
// VISIBLE to the search, not merely legal for a human (`getLegalActions` /
// `tryAutoCommitPendingCast`, exercised by `dash.test.ts`, is the HUMAN path).
//
// Lives in its own `*.bot.test.ts` file because `convex/gre/moves.ts` is a
// declared bot module (`bot-suite-boundary.test.ts`), so any test importing
// the enumerator belongs to `test:bot`.
//
// Before this, `enumerateCastMoves` read ONLY `getInstanceManaCost` (the
// PRINTED cost) — a dash card whose printed cost the Bot could not afford
// (the exact situation Dash exists for) enumerated ZERO cast moves, so the
// Bot could NEVER choose to dash. That made the value-model sign fix in
// `opValuers.ts`/`cardScriptValue.ts` (same issue) academic: correcting how a
// dash trigger is SCORED changes nothing if the search can never reach the
// position being scored. Three properties are pinned here:
//   1. the dash variant is enumerated ALONGSIDE the plain cast when both
//      costs are affordable (Ragavan, Nimble Pilferer: printed {R}, dash
//      {1}{R} — dash costs MORE mana, the common CR 702.109a shape, a
//      premium for haste + guaranteed bounce);
//   2. the dash variant is the ONLY cast move when the printed cost is
//      unaffordable but the (cheaper) dash cost is — the shape `dash.test.ts`
//      already proves is LEGAL for a human and this file proves is now
//      VISIBLE to the Bot;
//   3. the search sandbox actually stamps `dashed: true` on the resulting
//      permanent, so `dashTrigger`'s `conditionOnSelf` can decide TRUE and
//      the haste grant / delayed return fire inside a rollout — without this
//      half, enumerating the move alone would still leave the trigger inert
//      in every simulated line.

import { describe, it, expect } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import type { GameState } from "../state";
import { ragavanNimblePilferer } from "../../cards/sets/mh2/red";
import { dashTrigger } from "../../cards/abilities/dash";
import type { CardDefinition } from "../../cards/types";

const MOUNTAIN = getCardByName("Mountain").id;

/** p1 holds Ragavan in hand with `untappedMountains` untapped Mountains —
 *  its printed cost is {R} (1 mana value), its dash cost {1}{R} (2). */
function ragavanBoard(untappedMountains: number): GameState {
    const ragavan = makeInstance(ragavanNimblePilferer.id, {
        id: "ragavan",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const mountains = Array.from({ length: untappedMountains }, (_, i) =>
        makeInstance(MOUNTAIN, { id: `m${i}`, controllerId: "p1" })
    );
    return makeState({
        players: [
            makePlayer("p1", { hand: [ragavan], battlefield: mountains }),
            makePlayer("p2"),
        ],
    });
}

function ragavanCasts(state: GameState): Move[] {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "ragavan"
    );
}

// A synthetic probe (distinct id from `dash.test.ts`'s own fixture, so both
// files can register independently): printed cost {5}{R} (6 mana value, an
// UNAFFORDABLE floor at 1 mana) vs a cheap {R} (1 mana value) dash cost —
// the exact "printed cost the Bot could never pay" shape issue #1964
// measured.
const EXPENSIVE_DASH_PROBE_ID = "test:dash-probe-moves-1964";
const expensiveDashProbe: CardDefinition = {
    id: EXPENSIVE_DASH_PROBE_ID,
    rarity: "common",
    name: "Expensive Dash Probe",
    manaCost: { X: 5, R: 1 },
    dash: { id: "dash", description: "Dash {R}", mana: { R: 1 } },
    types: ["Creature"],
    subtypes: ["Warrior"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [dashTrigger("Expensive Dash Probe")],
};
registerTokenDefinition(expensiveDashProbe);

describe("Dash — Bot move enumeration (CR 702.109a, issue #1964)", () => {
    it("enumerates the dash variant beside the plain cast when both are affordable", () => {
        const state = ragavanBoard(2);
        const casts = ragavanCasts(state);
        const plain = casts.filter(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === undefined
        );
        const dashed = casts.filter(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === "dash"
        );
        expect(plain).toHaveLength(1);
        expect(dashed).toHaveLength(1);
        const dashMove = dashed[0];
        if (dashMove.kind !== "cast-spell") throw new Error("narrowing");
        expect(dashMove.targets).toEqual([]);
        expect(dashMove.confirmTargets).toBe(false);
        // The dash cost ({1}{R}, mana value 2) needs BOTH Mountains — a
        // short tap plan here is the executor-freeze shape (it announces
        // before it taps).
        expect(dashMove.tapPlan).toHaveLength(2);
        const plainMove = plain[0];
        if (plainMove.kind !== "cast-spell") throw new Error("narrowing");
        expect(plainMove.tapPlan).toHaveLength(1);
    });

    it("enumerates ONLY the dash cast when the printed cost is unaffordable but dash is (the motivating shape)", () => {
        const probeInst = makeInstance(EXPENSIVE_DASH_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool.R = 1; // covers dash ({R}), nowhere near {5}{R}
        const casts = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "probe"
        );
        expect(casts).toHaveLength(1);
        const only = casts[0];
        if (only.kind !== "cast-spell") throw new Error("narrowing");
        expect(only.alternativeCostId).toBe("dash");
    });

    it("enumerates NEITHER cast when neither cost is affordable", () => {
        const probeInst = makeInstance(EXPENSIVE_DASH_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
        });
        expect(
            enumerateMoves(state, "p1").filter(
                (m) => m.kind === "cast-spell" && m.cardInstanceId === "probe"
            )
        ).toHaveLength(0);
    });

    it("the search sandbox stamps dashed:true, so the dash trigger's conditionOnSelf can decide TRUE", () => {
        const state = ragavanBoard(2);
        const dashMove = ragavanCasts(state).find(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === "dash"
        )!;
        const next = applyMoveForSearch(state, "p1", dashMove);
        const p1 = next.players.find((p) => p.id === "p1")!;
        const permanent = p1.battlefield.find((c) => c.id === "ragavan")!;
        expect(permanent.dashed).toBe(true);
    });

    it("the PLAIN cast of the same card carries no dashed flag", () => {
        const state = ragavanBoard(2);
        const plainMove = ragavanCasts(state).find(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === undefined
        )!;
        const next = applyMoveForSearch(state, "p1", plainMove);
        const p1 = next.players.find((p) => p.id === "p1")!;
        const permanent = p1.battlefield.find((c) => c.id === "ragavan")!;
        expect(permanent.dashed).toBeUndefined();
    });
});
