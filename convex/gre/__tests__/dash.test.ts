// Dash capability tests (CR 702.109, issue #1314). Built once here, reused by
// every future dash card — mirrors `evoke.test.ts`'s structure and scope,
// including its "no shipped card yet" precedent: the sole catalogue candidate
// (Death-Greeter's Champion, issue #917) is ALSO blocked on Backup (CR
// 702.165, a separate ticket) and stays a commented-out stub, so a SYNTHETIC
// probe card exercises the capability end-to-end instead — the exact pattern
// `evoke.test.ts`'s `spentManaProbe` already established for "no shipped card
// consumes this yet". Covers the whole GRE → game.ts → UI path the capability
// crosses:
//   - `def.dash` resolves through the SAME `getAlternativeCost` /
//     `affordableAlternativeCosts` authority as `evoke` / the generic
//     `alternativeCosts[]` array (convex/gre/alternativeCost.ts)
//   - CR 702.109a's mana-for-mana swap: `convex/gre/rules.ts`'s "cast"
//     legality gate offers "cast" via the DASH mana leg even when the printed
//     cost is unaffordable (the whole point of the keyword)
//   - the real cast-commit seam tags the resulting stack item `dashed: true`
//     AND actually pays the dash mana (not a zeroed cost — the bug class the
//     generic `AlternativeCost.mana` leg exists to close) —
//     `tryAutoCommitPendingCast`, convex/game.ts (this project has no
//     convex-test harness for game.ts mutations, ADR 0001, so the REAL
//     exported commit function is driven directly over a manually-parked
//     `pendingCast`, mirroring evoke.test.ts / Force-of-Will's
//     pitch-cost.test.ts pattern)
//   - the `dashed` marker riding onto the resulting permanent for free (a
//     stack item IS its CardInstanceState, the `escaped`/`evoked` precedent)
//     via `resolveTopOfStack`
//   - CR 702.109a's own second half — `dashTrigger`'s check-time `condition`
//     grants haste and schedules a next-end-step return on a DASHED
//     permanent, and leaves a HARD-CAST permanent alone — through the real
//     ETB trigger path (`collectTriggers` + `resolveTopOfStack`) and the real
//     delayed-trigger fire path (`fireDelayedTriggers`)
//   - serialization round-trip of `dashed`
//   - the frontend wiring SURFACE: `projectPublicState` carries the field
import { describe, it, expect } from "vitest";
import { resolveTopOfStack, type GameState, type StackItem } from "../state";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../alternativeCost";
import { getLegalActions } from "../rules";
import { fireDelayedTriggers } from "../phases";
import { tryAutoCommitPendingCast, finalizeTargetSelection } from "../../game";
import { collectTriggers } from "../triggers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { dashTrigger } from "../../cards/abilities/dash";
import { ragavanNimblePilferer } from "../../cards/sets/mh2/red";

// A dash creature: printed cost is a steep {X:5}{R} (6 mana value), its dash
// cost is a cheap {R} (1 mana value) — the contrast the "cast legal via dash
// even when the printed cost is unaffordable" test relies on.
const DASH_PROBE_ID = "test:dash-probe";
const dashProbe: CardDefinition = {
    id: DASH_PROBE_ID,
    rarity: "common",
    name: "Dash Probe",
    manaCost: { X: 5, R: 1 },
    dash: { id: "dash", description: "Dash {R}", mana: { R: 1 } },
    types: ["Creature"],
    subtypes: ["Warrior"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [dashTrigger("Dash Probe")],
};
registerTokenDefinition(dashProbe);

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

describe("Dash — cost lookup (CR 702.109a, convex/gre/alternativeCost.ts)", () => {
    it("getAlternativeCost resolves def.dash by its own id (reference equality)", () => {
        expect(getAlternativeCost(dashProbe, "dash")).toBe(dashProbe.dash);
    });

    it("affordableAlternativeCosts offers the dash variant unconditionally (no permanent/life/hand leg)", () => {
        const probeInst = handCard(DASH_PROBE_ID, "probe");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
        });
        const alts = affordableAlternativeCosts(
            state,
            state.players[0],
            probeInst
        );
        expect(alts.some((a) => a.id === "dash")).toBe(true);
    });
});

describe("Dash — cast legality (CR 118.9 / 702.109a, convex/gre/rules.ts)", () => {
    it("'cast' is legal via the dash mana leg when the printed cost is unaffordable", () => {
        const probeInst = handCard(DASH_PROBE_ID, "probe");
        // Give p1 exactly {R} floating — nowhere NEAR the printed {X:5}{R}
        // (6 mana value), but exactly the dash cost. `getLegalActions`'s
        // mana-solver reads `player.manaPool` directly for pool-based
        // affordability, no battlefield mana source needed for this check.
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].manaPool.R = 1;
        const actions = getLegalActions(state, state.players[0], probeInst);
        expect(actions).toContain("cast");
    });

    it("'cast' is illegal when NEITHER the printed cost NOR the dash cost is affordable", () => {
        const probeInst = handCard(DASH_PROBE_ID, "probe");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // Zero mana anywhere — neither the 6-mana printed cost nor the
        // 1-mana dash cost is payable.
        const actions = getLegalActions(state, state.players[0], probeInst);
        expect(actions).not.toContain("cast");
    });
});

describe("Dash — cast commit pays the dash mana AND tags the stack item (CR 601.2h / 118.9 / 702.109a)", () => {
    function dashProbeParkedCast(): GameState {
        const probeInst = handCard(DASH_PROBE_ID, "probe");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // Floating {R} in the pool covers the dash cost — mirrors the
        // announceCast/finalizeTargetSelection "park with the alt cost's
        // mana" shape once `tapForPayment` (or an already-covered pool) makes
        // it payable.
        state.players[0].manaPool.R = 1;
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "probe",
            manaCost: { R: 1 },
            tappedLandIds: [],
            dashed: true,
        };
        return state;
    }

    it("commits: pays the {R} dash mana from the pool, stacks Dash Probe tagged dashed", () => {
        const state = dashProbeParkedCast();
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        const p1 = state.players[0];
        // The dash mana was ACTUALLY paid — not silently zeroed (the bug
        // class `AlternativeCost.mana` closes).
        expect(p1.manaPool.R).toBe(0);
        expect(p1.hand.map((c) => c.id)).not.toContain("probe");
        const stackItem = state.stack.find((s) => s.id === "probe");
        expect(stackItem).toBeDefined();
        expect((stackItem as StackItem).dashed).toBe(true);
    });

    it("does NOT commit while the dash mana is still uncovered", () => {
        const state = dashProbeParkedCast();
        state.players[0].manaPool.R = 0; // mana not yet paid
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).toBeNull();
        expect(state.pendingCast).toBeDefined();
    });
});

describe("Dash — CR 702.109a haste grant + next-end-step return", () => {
    it("a DASHED Dash Probe gains haste, then is returned to hand at the next end step", () => {
        const probeStack: StackItem = {
            ...handCard(DASH_PROBE_ID, "probe"),
            zone: "stack",
            castById: "p1",
            dashed: true,
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(probeStack);
        // ETB: the permanent enters the battlefield.
        resolveTopOfStack(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(onBoard).toBeDefined();
        expect(onBoard!.dashed).toBe(true);

        // Fire + resolve the dash trigger (haste grant + schedule the delayed
        // return).
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "probe",
                controllerId: "p1",
                cardId: DASH_PROBE_ID,
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        // CR 702.109a — "it gains haste".
        const hasted = state.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(hasted?.staticAbilities).toContain("haste");
        // CR 603.7a — the next-end-step return is scheduled.
        expect(state.delayedTriggers?.length).toBe(1);
        expect(state.delayedTriggers![0].timing).toBe("next-end-step");

        // Fire the next-end-step delayed trigger and resolve it.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);

        // CR 702.109a — "returned to its owner's hand".
        expect(state.players[0].battlefield.some((c) => c.id === "probe")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "probe")).toBe(true);
    });

    it("a HARD-CAST Dash Probe (no dash) does NOT gain haste and is NOT scheduled to bounce", () => {
        const probeStack: StackItem = {
            ...handCard(DASH_PROBE_ID, "probe"),
            zone: "stack",
            castById: "p1",
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(probeStack);
        resolveTopOfStack(state);

        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "probe",
                controllerId: "p1",
                cardId: DASH_PROBE_ID,
                types: ["Creature"],
            },
        ]);
        // Not dashed: the check-time condition fails, no trigger fires at all.
        expect(triggers).toHaveLength(0);

        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(onBoard?.staticAbilities ?? []).not.toContain("haste");
        expect(state.delayedTriggers?.length ?? 0).toBe(0);
        expect(onBoard).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Issue #2412 fixup round 3 (PR review finding). `dashTrigger`'s OWN template
// is the direct battlefield→hand bounce `resetBattlefieldTransientState`
// (CR 400.7, `convex/gre/state.ts`) is supposed to gate: the "next end step"
// delayed trigger does `moveZone $self → hand`, which runs the permanent
// through `removePermanentTo`'s hand/library branch — NOT through
// `resetStackTransientState` (that function only reaches a permanent
// re-entering the stack). `resetBattlefieldTransientState` had no
// `delete card.dashed` (nor `evoked`/`escaped`), so the bounced object kept
// `dashed: true`, and a later HARD recast's
// `{ ...card, ...(isDashCost ? { dashed: true } : {}) }` spread in
// `finalizeTargetSelection`/`tryAutoCommitPendingCast` never clears an
// inherited value it doesn't itself set — reproduced with the shipped card
// (Ragavan, Nimble Pilferer, MH2) whose own `dashTrigger` IS this exact
// interaction: dash → resolve → end-of-turn self-bounce → hard recast would
// silently gain haste and re-schedule ANOTHER end-step bounce, every game,
// no counter/Regrowth round trip needed.
// ---------------------------------------------------------------------------
describe("Dash — battlefield-side leak: end-step self-bounce then HARD recast does not leak (CR 400.7 / issue #2412 fixup round 3)", () => {
    it("a HARD recast of Ragavan after a dashed end-step self-bounce does not gain haste or re-schedule the end-step return", () => {
        const RAGAVAN_ID = ragavanNimblePilferer.id;
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });

        // 1. Cast Ragavan DASHED — stamp `dashed: true` directly on the stack
        //    item, exactly like `tryAutoCommitPendingCast`'s real cast-commit
        //    seam (already covered by the "cast commit tags the stack item"
        //    describe block above; this test is about the EXIT, not payment).
        const ragavanStack: StackItem = {
            ...handCard(RAGAVAN_ID, "rag"),
            zone: "stack",
            castById: "p1",
            dashed: true,
        };
        state.stack.push(ragavanStack);
        resolveTopOfStack(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "rag"
        );
        expect(onBoard).toBeDefined();
        expect(onBoard!.dashed).toBe(true);

        // 2. Fire Ragavan's OWN `dashTrigger` (haste grant + schedule the
        //    next-end-step return) through the real ETB trigger path.
        const etbTriggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "rag",
                controllerId: "p1",
                cardId: RAGAVAN_ID,
                types: ["Creature"],
            },
        ]);
        expect(etbTriggers.map((t) => t.triggeredAbilityId)).toContain(
            "dash-haste-and-return"
        );
        state.stack.push(...etbTriggers);
        resolveTopOfStack(state);
        expect(state.delayedTriggers?.length).toBe(1);

        // 3. Fire the next-end-step delayed trigger: `moveZone $self → hand`
        //    — a DIRECT battlefield→hand bounce, never re-entering the stack.
        //    This runs through `removePermanentTo`'s hand branch, which calls
        //    `resetBattlefieldTransientState` (NOT `resetStackTransientState`
        //    — the already-fixed stack-side chokepoint from round 2).
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === "rag")).toBe(
            false
        );
        const inHand = state.players[0].hand.find((c) => c.id === "rag");
        expect(inHand).toBeDefined();
        // The core assertion the fix guarantees: a self-bounced dashed
        // permanent reaches hand with no memory of having been dashed.
        expect((inHand as { dashed?: boolean }).dashed).toBe(undefined);

        // 4. Recast, HARD (no dash), through the real production cast-commit
        //    path (`finalizeTargetSelection`). Ragavan costs {R}.
        state.players[0].manaPool.R = 1;
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "rag",
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        const recast = state.stack.find((s) => s.id === "rag");
        expect(recast).toBeDefined();
        expect(recast?.dashed).toBe(undefined);

        // 5. Resolve to the battlefield and re-run the real ETB trigger scan.
        //    A hard-cast Ragavan must NOT re-offer `dash-haste-and-return` —
        //    on pre-fix code the stale `dashed: true` survives step 4's
        //    spread and this would incorrectly appear, granting haste and
        //    scheduling ANOTHER end-step self-bounce.
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === "rag")).toBe(
            true
        );
        const hardCastTriggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "rag",
                controllerId: "p1",
                cardId: RAGAVAN_ID,
                types: ["Creature"],
            },
        ]);
        expect(hardCastTriggers.map((t) => t.triggeredAbilityId)).not.toContain(
            "dash-haste-and-return"
        );

        // No haste grant, no re-scheduled end-step return.
        const hardCastOnBoard = state.players[0].battlefield.find(
            (c) => c.id === "rag"
        );
        expect(hardCastOnBoard?.staticAbilities ?? []).not.toContain("haste");
        expect(state.delayedTriggers?.length ?? 0).toBe(0);
    });
});

describe("Dash — serialization (CR 702.109a)", () => {
    it("round-trips the dashed flag on a battlefield permanent", () => {
        const probePermanent = makeInstance(DASH_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            dashed: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [probePermanent] }),
                makePlayer("p2"),
            ],
        });
        const restored = expandState(compactState(state));
        const back = restored.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(back?.dashed).toBe(true);
    });
});

describe("Dash — frontend wiring SURFACE (projectPublicState)", () => {
    it("dashed survives the wire projection", () => {
        const probePermanent = makeInstance(DASH_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            dashed: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [probePermanent] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(slim?.dashed).toBe(true);
    });
});
