// The Bot's sign on "that player" behind a "deals damage to a player" head
// (CR 702.115a, CR 120.3; issue #4014): `$event.damagedPlayer` is the player the
// creature hit, so an exile or a discard there is worth something to the
// creature's controller, never a cost.
import { describe, expect, it } from "vitest";
import { preloadDefinitions } from "../../cards";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { dslRealizedAbilityValueById } from "../cardValue";
import { contextAwareGroundingForChoice } from "../ai/candidateValue";
import { contextFreeGrounding } from "../ai/grounding";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";

const creature = (
    id: string,
    extra: Partial<CardDefinition>
): CardDefinition => ({
    id,
    name: id,
    rarity: "common",
    manaCost: { X: 2 },
    types: ["Creature"],
    subtypes: [],
    power: 2,
    toughness: 2,
    ...extra,
});

const damagedPlayer: Extract<EffectOp, { op: "discard" }>["player"] = {
    ref: "$event.damagedPlayer",
};

preloadDefinitions([
    creature("value-ingest", { staticAbilities: ["ingest"] }),
    creature("value-vanilla", {}),
]);

describe("the damaged player's seat in the Bot's value model (CR 120.3)", () => {
    it("prices Ingest above the vanilla body it shares (CR 702.115a)", () => {
        expect(dslRealizedAbilityValueById("value-vanilla")).toBe(0);
        expect(dslRealizedAbilityValueById("value-ingest")).toBeGreaterThan(0);
    });

    it("reads $event.damagedPlayer as the opponent, and other event refs as before", () => {
        const ctx = contextFreeGrounding(DEFAULT_EVAL_WEIGHTS.latent);
        expect(ctx.isSelf(damagedPlayer, "self")).toBe(false);
        expect(ctx.isSelf({ ref: "$source" }, "opponent")).toBe(true);
    });

    it("reads it as the opponent on a live board too", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const ctx = contextAwareGroundingForChoice(state, "p1");
        expect(ctx.isSelf(damagedPlayer, "self")).toBe(false);
        expect(ctx.isSelf({ ref: "$source" }, "opponent")).toBe(true);
    });
});
