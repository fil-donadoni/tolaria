// M11 (Magic 2011) — white behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { dayOfJudgment } from "../white";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { validateEffectScript } from "../../../../gre/effects/validate";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

// Fillers: a vanilla creature and a non-creature artifact (the sweep must
// leave non-creatures alone).
const BEAR_ID = "test-m11w-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});
const ROCK_ID = "test-m11w-rock";
registerTokenDefinition({
    id: ROCK_ID,
    name: ROCK_ID,
    rarity: "common",
    manaCost: { C: 1 },
    types: ["Artifact"],
});

// Day of Judgment — "Destroy all creatures." (CR 701.8.) The first DSL card
// using the forEach construct (ADR 0045, issue #807): the creature set is
// frozen at construct entry (CR 608.2i) and each member is destroyed through
// the replacement layer via the `$each` object ref.
describe("Day of Judgment (destroy all creatures — DSL-only forEach sweep, CR 701.8 / issue #807)", () => {
    it("is a {2}{W}{W} sorcery, DSL-only with a valid Effect Script and no targets", () => {
        expect(dayOfJudgment.manaCost).toEqual({ X: 2, W: 2 });
        expect(dayOfJudgment.types).toEqual(["Sorcery"]);
        expect(dayOfJudgment.targetRequirement).toBeUndefined();
        expect(dayOfJudgment.resolve).toBeUndefined();
        expect(dayOfJudgment.resolveSteps).toBeUndefined();
        expect(validateEffectScript(dayOfJudgment)).toEqual([]);
    });

    it("destroys every creature on BOTH battlefields and leaves non-creatures (CR 701.8)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "dojA",
                            controllerId: "p1",
                        }),
                        makeInstance(ROCK_ID, {
                            id: "dojRock",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: ["dojB", "dojC"].map((cid) =>
                        makeInstance(BEAR_ID, {
                            id: cid,
                            controllerId: "p2",
                            ownerId: "p2",
                        })
                    ),
                }),
            ],
        });
        pushSpell(state, dayOfJudgment.id, "p1");
        resolveTopOfStack(state);
        // The caster's creature died too; the artifact survived.
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "dojRock",
        ]);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("dojA");
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "dojB",
            "dojC",
        ]);
        // CR 608.2k — the resolved sorcery is in its owner's graveyard.
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            dayOfJudgment.id
        );
    });

    it("routes through the replacement layer — indestructible creatures survive (CR 702.12), no regeneration rider", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "dojInd",
                            controllerId: "p2",
                            ownerId: "p2",
                            staticAbilities: ["indestructible"],
                        }),
                        makeInstance(BEAR_ID, {
                            id: "dojSoft",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, dayOfJudgment.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "dojInd",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "dojSoft",
        ]);
    });

    it("resolves cleanly on an empty board (zero-member set, CR 608.2b)", () => {
        const state = makeState();
        pushSpell(state, dayOfJudgment.id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.stack).toHaveLength(0);
    });

    it("the sweep survives projection (wire format)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "dojW1",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "dojW2",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, dayOfJudgment.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].battlefield).toHaveLength(0);
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[1].graveyard.map((c) => c.id)).toContain(
            "dojW2"
        );
    });
});
