// Two tactical features of the 1-ply policy (issue #8701): spell timing across
// combat (`combatReserve`) and the enters-tapped land on an idle turn
// (`landTempo`). Each asserts the SIGN of a gap at its blade entry's position,
// one ply deep — the number the rollout default policy and the PUCT prior rank
// candidates by. The blade entries run the search, whose rollouts do not
// separate the two candidates robustly (both anchors are `stretch`); the sign
// is decided here. Each gap is a term weight alone (`combatReserveWeight`,
// `landTempoWeight`), so only the sign is asserted and a refit is no red.
import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/build";
import { seatPlayerId } from "../ai/blade/matcher";
import { BLADE_SCENARIOS } from "../ai/blade/scenarios";
import { candidateFeatures } from "../ai/verdicts/evalPairs";
import type { FeatureVector } from "../ai/verdicts/features";
import { describeMove } from "../describeMove";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";

const COMBAT_ANCHOR =
    "combat reserve pair: does NOT cast a creature precombat that taps out of the held trick";
const COMBAT_HALF = "combat reserve pair: casts the creature after combat";
const LAND_ANCHOR =
    "land tempo pair: plays the enters-tapped land on an idle turn";
const LAND_HALF =
    "land tempo pair: plays the untapped land when it makes a spell castable this turn";

function bladePosition(label: string): { state: GameState; bot: string } {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === label);
    if (!scenario) throw new Error(`blade entry missing: ${label}`);
    const state = buildBladeState(scenario);
    return { state, bot: seatPlayerId(state, scenario.bot) };
}

/** The 1-ply features of the move `describeMove` renders as `text`. */
function features(state: GameState, bot: string, text: string): FeatureVector {
    const move = enumerateMoves(state, bot).find(
        (m) => describeMove(m, state) === text
    );
    if (!move) throw new Error(`no move "${text}"`);
    return candidateFeatures(state, bot, move);
}

function featuresAt(label: string, text: string): FeatureVector {
    const { state, bot } = bladePosition(label);
    return features(state, bot, text);
}

describe("combat reserve — a sorcery-speed cast before combat that taps out of a held trick (issue #8701, CR 500.1)", () => {
    it("scores the cast precombat below the same cast postcombat", () => {
        expect(
            featuresAt(COMBAT_ANCHOR, "cast Grizzly Bears").policyValue
        ).toBeLessThan(
            featuresAt(COMBAT_HALF, "cast Grizzly Bears").policyValue
        );
    });

    it("prices nothing with no creature to attack with (CR 508.1a)", () => {
        const { state, bot } = bladePosition(COMBAT_ANCHOR);
        const me = state.players.find((p) => p.id === bot)!;
        me.battlefield = me.battlefield.filter(
            (c) => !c.types.includes("Creature")
        );
        expect(
            features(state, bot, "cast Grizzly Bears").terms.combatReserve
        ).toBe(0);
    });
});

describe("land tempo — the enters-tapped land on an idle turn (issue #8701, CR 603.6d)", () => {
    it("ranks the enters-tapped drop above the untapped one when the turn has no use for the mana", () => {
        expect(
            featuresAt(LAND_ANCHOR, "play Shivan Oasis").policyValue
        ).toBeGreaterThan(featuresAt(LAND_ANCHOR, "play Forest").policyValue);
    });

    it("ranks the untapped drop above it when that mana casts a spell this turn", () => {
        expect(
            featuresAt(LAND_HALF, "play Forest").policyValue
        ).toBeGreaterThan(
            featuresAt(LAND_HALF, "play Shivan Oasis").policyValue
        );
    });
});
