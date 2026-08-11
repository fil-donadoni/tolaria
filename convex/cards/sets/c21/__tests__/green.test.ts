// C21 — per-card behavior tests for green cards in
// `convex/cards/sets/c21/green.ts` (set split by colour, ADR 0043).
//
// Pest Infestation (issue #2369): the FIRST card to compose three engine
// primitives that shipped ahead of it with zero card consumers —
// `{ min: 0, max: "X" }` optional variable target count (#2365), the
// `scaled` EffectValue member (#2366), and a literal
// `EffectTokenSpec.triggeredAbilities` (#2364, exercised elsewhere only via
// a test-local fixture, `abilities/tokens/__tests__/tokenTriggeredAbility.
// test.ts`). Per the per-Op test regime this card is NOT the
// already-exercised-Ops case — `destroy`/`createToken` are implemented, but
// the SHAPE this card feeds them through has never run via a real cast, so
// it earns a hand-written test at every layer below.

import { describe, it, expect } from "vitest";
import { pestInfestation } from "../green";
import { ankhOfMishra, basaltMonolith } from "../../lea/colorless";
import { badMoon } from "../../lea/black";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTargetRequirementCount,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

function pestTokens(state: ReturnType<typeof makeState>, controllerId = "p1") {
    const player = state.players.find((p) => p.id === controllerId)!;
    return player.battlefield.filter((c) => c.subtypes?.includes("Pest"));
}

describe("Pest Infestation (up-to-X destroy + scaled token count + token dies-trigger, issue #2369)", () => {
    it("X = 3, three legal targets: destroys all three and creates SIX Pest tokens", () => {
        const artifact1 = makeInstance(ankhOfMishra.id, {
            id: "pi-artifact-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const artifact2 = makeInstance(basaltMonolith.id, {
            id: "pi-artifact-2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const enchantment1 = makeInstance(badMoon.id, {
            id: "pi-enchantment-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [artifact1, artifact2, enchantment1],
                }),
            ],
        });
        const item = pushSpell(state, pestInfestation.id, "p1", [
            { type: "permanent", id: "pi-artifact-1" },
            { type: "permanent", id: "pi-artifact-2" },
            { type: "permanent", id: "pi-enchantment-1" },
        ]);
        item.chosenX = 3;

        resolveTopOfStack(state);

        expect(state.players[1].battlefield).toHaveLength(0);
        expect(pestTokens(state)).toHaveLength(6);
        for (const token of pestTokens(state)) {
            expect(token.power).toBe(1);
            expect(token.toughness).toBe(1);
        }
    });

    it("X = 0: legal cast, resolves target count to { min: 0, max: 0 }, zero targets and zero tokens", () => {
        // The announce-time resolution THIS card's exact targetRequirement
        // shape produces at X = 0 — the edge the issue calls out as never
        // exercised by a real card (only unit tests touch `{ min, max: "X" }`
        // today).
        expect(
            resolveTargetRequirementCount(
                pestInfestation.targetRequirement!.count,
                0
            )
        ).toEqual({ min: 0, max: 0 });

        const artifact1 = makeInstance(ankhOfMishra.id, {
            id: "pi-x0-artifact",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [artifact1] }),
            ],
        });
        const item = pushSpell(state, pestInfestation.id, "p1", []);
        item.chosenX = 0;

        resolveTopOfStack(state);

        // Nothing destroyed — the untouched artifact is still there.
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(pestTokens(state)).toHaveLength(0);
    });

    it('"up to X" with fewer legal targets than X: still legal, destroys only what was chosen, still creates twice X tokens', () => {
        const onlyArtifact = makeInstance(ankhOfMishra.id, {
            id: "pi-scarce-artifact",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [onlyArtifact] }),
            ],
        });
        // X = 3 announced, but only ONE legal target exists on the board —
        // "up to X" has no lower bound, so choosing fewer than X is legal.
        const item = pushSpell(state, pestInfestation.id, "p1", [
            { type: "permanent", id: "pi-scarce-artifact" },
        ]);
        item.chosenX = 3;

        resolveTopOfStack(state);

        expect(state.players[1].battlefield).toHaveLength(0);
        // "twice X" tokens is driven by chosenX, not by how many targets
        // were actually destroyed.
        expect(pestTokens(state)).toHaveLength(6);
    });

    it("a created Pest's own dies-trigger fires end-to-end and gains its controller 1 life", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, pestInfestation.id, "p1", []);
        item.chosenX = 1;
        resolveTopOfStack(state);

        const tokens = pestTokens(state);
        expect(tokens).toHaveLength(2);
        const [firstToken] = tokens;
        const lifeBefore = getPlayer(state, "p1").life;

        removePermanentTo(state, firstToken.id, "graveyard", "destroy");
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 1);
    });

    it("wire format: created Pest tokens survive projectPublicState with their characteristics intact", () => {
        const artifact1 = makeInstance(ankhOfMishra.id, {
            id: "pi-wire-artifact",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [artifact1] }),
            ],
        });
        const item = pushSpell(state, pestInfestation.id, "p1", [
            { type: "permanent", id: "pi-wire-artifact" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        expect(pestTokens(state)).toHaveLength(4);

        const projected = projectPublicState(state, 1, "p1");
        const projectedTokens = projected.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Pest")
        );
        expect(projectedTokens).toHaveLength(4);
        for (const token of projectedTokens) {
            expect(token.types).toEqual(["Creature"]);
            expect(token.power).toBe(1);
            expect(token.toughness).toBe(1);
        }
    });
});
