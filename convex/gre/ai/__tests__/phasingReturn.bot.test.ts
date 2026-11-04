// A phased-out permanent read as temporary (CR 702.26a, issue #4006): it comes
// back at its controller's next untap step, so the evaluator prices it as a
// permanent that returns, never as one that is gone.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition } from "../../../cards/types";
import { evaluateBreakdown } from "../../evaluate";
import type { CardInstanceState, GameState } from "../../state";
import { phaseOutPermanent } from "../../state";
import { targetSlotBeneficence } from "../beneficence";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import type { BladeScenario } from "../blade/types";
import { pendingBattlefieldReturns } from "../pendingReturn";

const BEAR = {
    id: "test-phasing-return-bear",
    name: "test-phasing-return-bear",
    manaCost: { X: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
} as unknown as CardDefinition;

const auraGranting = (keyword: string): CardDefinition =>
    ({
        id: `test-phasing-return-aura-${keyword}`,
        name: `test-phasing-return-aura-${keyword}`,
        manaCost: { X: 1 },
        types: ["Enchantment"],
        subtypes: ["Aura"],
        staticEffects: [
            { kind: "keyword-grant", applies: () => true, keyword },
        ],
    }) as unknown as CardDefinition;

function boardWith(card: CardInstanceState): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield: [card] }), makePlayer("p2")],
    });
}

describe("phased-out permanents as pending returns (CR 702.26a)", () => {
    it("reads an untap-cycle bundle as returning under the player it phased out under", () => {
        withTemporaryDefinition(BEAR, () => {
            const state = boardWith(
                makeInstance(BEAR.id, { id: "bear", controllerId: "p1" })
            );
            phaseOutPermanent(state, "bear", {
                returnOn: { kind: "untap-cycle" },
            });
            expect(
                pendingBattlefieldReturns(state).map((r) => [r.card.id, r.to])
            ).toEqual([["bear", "p1"]]);
        });
    });

    it("credits each card of a bundle to its own controller (CR 702.26d)", () => {
        withTemporaryDefinition(BEAR, () => {
            const state = boardWith(
                makeInstance(BEAR.id, { id: "bear", controllerId: "p1" })
            );
            state.players[1].battlefield.push(
                makeInstance(BEAR.id, {
                    id: "on-bear",
                    controllerId: "p2",
                    attachedTo: "bear",
                })
            );
            phaseOutPermanent(state, "bear", {
                returnOn: { kind: "untap-cycle" },
            });
            expect(
                pendingBattlefieldReturns(state).map((r) => [r.card.id, r.to])
            ).toEqual([
                ["bear", "p1"],
                ["on-bear", "p2"],
            ]);
        });
    });

    it("does not read a bundle waiting on its source: it may never return", () => {
        withTemporaryDefinition(BEAR, () => {
            const state = boardWith(
                makeInstance(BEAR.id, { id: "bear", controllerId: "p1" })
            );
            phaseOutPermanent(state, "bear", {
                returnOn: { kind: "source-leaves", sourceId: "jail" },
            });
            expect(pendingBattlefieldReturns(state)).toEqual([]);
        });
    });

    it("prices a phased-out body like the same body standing, enters ability excluded (CR 702.26d)", () => {
        const scenario = {
            label: "phased body",
            spec: {
                cards: [
                    {
                        name: "Flametongue Kavu",
                        owner: "me",
                        zone: "battlefield",
                    },
                    { name: "Hill Giant", owner: "opp", zone: "battlefield" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                libraryCount: 20,
            },
        } as unknown as BladeScenario;
        const state = buildBladeState(scenario);
        const me = seatPlayerId(state, "me");
        const standing = evaluateBreakdown(state, me).self.creatures;
        const kavu = state.players.find((p) => p.id === me)!.battlefield[0];
        phaseOutPermanent(state, kavu.id, {
            returnOn: { kind: "untap-cycle" },
        });
        const phased = evaluateBreakdown(state, me).self.creatures;
        expect(phased).toBeCloseTo(standing, 6);
        expect(phased).toBeGreaterThan(0);
    });
});

describe("the sign of an Aura granting a drawback keyword (CR 702.26a)", () => {
    it("reads granted phasing as harmful and another keyword as beneficial", () => {
        expect(
            targetSlotBeneficence(auraGranting("phasing"), undefined, 0)
        ).toBe("harmful");
        expect(
            targetSlotBeneficence(auraGranting("flying"), undefined, 0)
        ).toBe("beneficial");
    });
});
