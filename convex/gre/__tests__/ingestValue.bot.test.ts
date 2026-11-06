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
import { buildBladeState } from "../ai/blade/build";
import { seatPlayerId } from "../ai/blade/matcher";
import { BLADE_SCENARIOS } from "../ai/blade/scenarios";
import { candidateFeatures } from "../ai/verdicts/evalPairs";
import { describeMove } from "../describeMove";
import { enumerateMoves } from "../moves";

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

const INGEST_ENTRY =
    "Ingest: casts the 2/2 that exiles from the damaged player's library over the vanilla 2/2";

/** The 1-ply policy of casting `name` at the blade entry's position: the
 *  Eval Pair value the search ranks root candidates by, no rollouts. */
function castPolicyValue(name: string): number {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === INGEST_ENTRY);
    if (!scenario) throw new Error("blade entry missing");
    const state = buildBladeState(scenario);
    const bot = seatPlayerId(state, scenario.bot);
    const move = enumerateMoves(state, bot).find(
        (m) =>
            m.kind === "cast-spell" && describeMove(m, state) === `cast ${name}`
    );
    if (!move) throw new Error(`no cast of ${name}`);
    return candidateFeatures(state, bot, move).policyValue;
}

// The blade entry runs the search, where the two casts tie inside rollout
// noise over a full library (issue #8459); the sign of the damaged player is
// decided here, one ply deep, where it is +3.0 intact and -3.0 flipped.
describe("the sign reaches the decision — 1-ply policy at the blade position (issue #8465)", () => {
    it("ranks the Ingest body's cast above the vanilla body's (CR 702.115a)", () => {
        expect(castPolicyValue("Culling Drone")).toBeGreaterThan(
            castPolicyValue("Walking Corpse") + 2
        );
    });
});
