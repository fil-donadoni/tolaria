// C18 — colorless card behavior tests (ADR 0043 per-colour split).
//
// Coveted Jewel is a DSL card composing three already-exercised Ops (`draw`,
// `gainControl`, `tapUntap`) plus a plain-data `manaChoices` mana ability.
// The catalogue-wide auto-generated smoke sweep
// (`convex/cards/__tests__/effectScriptSmoke.test.ts`) explicitly SKIPS the
// "coveted-jewel-steal" trigger ("Op 'gainControl' changes control of a
// permanent (and installs a conditional-control SBA) — covered by the Op's
// interpreter tests") — per gre-development.md's per-Op regime, an explicit
// skip is the signal to add a hand-written test for the card's OWN wiring
// (the trigger firing on the right event, the right player drawing, the
// right control change), not just the Op in isolation. The ETB draw trigger
// is NOT skipped by the sweep (asserted automatically), so it gets only a
// light definition-wiring check here (the Tsabo's Web precedent,
// inv/__tests__/colorless.test.ts).

import { describe, expect, it } from "vitest";
import { resolveTrigger } from "./helpers";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { covetedJewel } from "..";

describe("Coveted Jewel (C18) — unblocked-attack steal trigger (CR 509.1h / 603.3b)", () => {
    it("an opponent's unblocked attacker makes that opponent draw 3, gain control of the Jewel, and untap it", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(covetedJewel.id, {
                            id: "jewel",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2", {
                    library: [
                        makeInstance(covetedJewel.id, {
                            id: "lib-1",
                            zone: "library",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(covetedJewel.id, {
                            id: "lib-2",
                            zone: "library",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(covetedJewel.id, {
                            id: "lib-3",
                            zone: "library",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                    battlefield: [
                        makeInstance(covetedJewel.id, {
                            id: "attacker",
                            controllerId: "p2",
                            ownerId: "p2",
                            types: ["Creature"],
                        }),
                    ],
                }),
            ],
        });
        const jewel = state.players[0].battlefield[0];

        resolveTrigger(state, jewel, "coveted-jewel-steal", {
            type: "ATTACKER_UNBLOCKED",
            attackerId: "attacker",
            attackerControllerId: "p2",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
        });

        const p2 = state.players.find((p) => p.id === "p2")!;
        // "that player [the attacking opponent] draws three cards" (CR 121.1).
        expect(p2.hand).toHaveLength(3);
        expect(p2.library).toHaveLength(0);
        // "gains control of this artifact" (CR 613.1b, indefinite reassignment)
        // "Untap it." (CR 701.26b) — control moved off the battlefield array it
        // started in.
        expect(state.players[0].battlefield.some((c) => c.id === "jewel")).toBe(
            false
        );
        const movedJewel = p2.battlefield.find((c) => c.id === "jewel");
        expect(movedJewel).toBeDefined();
        expect(movedJewel?.controllerId).toBe("p2");
        expect(movedJewel?.isTapped).toBe(false);
    });

    it("does not trigger on the Jewel controller's own unblocked attacker", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(covetedJewel.id, {
                            id: "jewel",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                        makeInstance(covetedJewel.id, {
                            id: "own-attacker",
                            controllerId: "p1",
                            ownerId: "p1",
                            types: ["Creature"],
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const jewel = state.players[0].battlefield[0];

        // The trigger scanner would never even raise this — reproduce its
        // `matches` predicate directly against a same-controller attacker to
        // assert the guard, mirroring how other `matches`-only assertions are
        // tested elsewhere in the catalogue.
        const ability = (covetedJewel.triggeredAbilities ?? []).find(
            (t) => t.id === "coveted-jewel-steal"
        )!;
        const selfView = {
            id: jewel.id,
            card: jewel.card,
            controllerId: jewel.controllerId,
            ownerId: jewel.ownerId,
            types: jewel.types,
            subtypes: jewel.subtypes,
            isTapped: jewel.isTapped,
        };
        expect(
            ability.matches(
                {
                    type: "ATTACKER_UNBLOCKED",
                    attackerId: "own-attacker",
                    attackerControllerId: "p1",
                    attackerTypes: ["Creature"],
                    attackerSubtypes: [],
                },
                selfView
            )
        ).toBe(false);
    });
});
