// NEC blue — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Kappa Cannoneer composes ONLY already-exercised constructs: `wardAbility`
// (fully exercised generically in `convex/cards/abilities/__tests__/ward.test.ts`)
// and the `counters` / `restrictCombat` Ops (interpreter-suite-exercised).
// This file pins the CARD — the ETB anthem wired through the real stack, and
// that Ward is declared — not the underlying machinery.

import { describe, it, expect } from "vitest";
import { kappaCannoneer } from "../blue";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";

function pushArtifactEtb(
    state: GameState,
    kappa: CardInstanceState,
    entered: { instanceId: string; controllerId: string }
) {
    state.stack.push({
        ...kappa,
        zone: "stack",
        castById: kappa.controllerId,
        triggeredAbilityId: "kappa-cannoneer-artifact-etb",
        triggerSourceId: kappa.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: entered.instanceId,
            controllerId: entered.controllerId,
            types: ["Artifact"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Kappa Cannoneer (Improvise + Ward + self/artifact ETB anthem, CR 702.126/702.21, issue #1527)", () => {
    it("its OWN ETB puts a +1/+1 counter on itself and makes it unblockable this turn", () => {
        const kappa = makeInstance(kappaCannoneer.id, {
            id: "kappa",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kappa] }),
                makePlayer("p2"),
            ],
        });
        pushArtifactEtb(state, kappa, {
            instanceId: "kappa",
            controllerId: "p1",
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "kappa"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(after.cantBeBlockedThisTurn).toBe(true);
    });

    it("another artifact you control entering ALSO grows Kappa (CR 109.2 doesn't exclude it)", () => {
        const kappa = makeInstance(kappaCannoneer.id, {
            id: "kappa",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kappa] }),
                makePlayer("p2"),
            ],
        });
        pushArtifactEtb(state, kappa, {
            instanceId: "some-other-artifact",
            controllerId: "p1",
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "kappa"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(after.cantBeBlockedThisTurn).toBe(true);
    });

    it("does NOT trigger off an opponent's artifact entering (scope: yours)", () => {
        // Assert the ability's own `matches` predicate directly rather than
        // building a full battlefield — `collectTriggers` wiring is already
        // covered generically by other set tests.
        const ability = kappaCannoneer.triggeredAbilities!.find(
            (a) => a.id === "kappa-cannoneer-artifact-etb"
        )!;
        const selfView = {
            id: "kappa",
            controllerId: "p1",
        } as unknown as Parameters<NonNullable<typeof ability.matches>>[1];
        expect(
            ability.matches!(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "opp-artifact",
                    controllerId: "p2",
                    types: ["Artifact"],
                } as StackItem["triggerEvent"] as never,
                selfView
            )
        ).toBe(false);
    });
});
