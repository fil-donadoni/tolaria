/**
 * What a held stack answer is worth once the opponent's hand is empty
 * (`LatentLens.stackAnswerUnits`). CR 701.6a: a counterspell needs a spell on
 * the stack, so its worth is a wait for the next one. A caster with a clock
 * waits: the opponent's draws are the only way back. A caster without one has
 * nothing to protect, and the answer is worth nothing until a spell shows up.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { buildBladeState, findBladeScenario } from "../blade";
import { seatPlayerId } from "../blade/matcher";
import type { ScenarioCard } from "../../../debugScenarioSpec";
import { cardValue, handLatentLens } from "../../evaluate";
import { getPlayer } from "../../state";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

const ENTRY = "counterspell: Mana Drain holds against a Savannah Lions";

function heldValue(
    answer: string,
    board: readonly ScenarioCard[],
    oppHand: readonly ScenarioCard[] = []
): number {
    const entry = findBladeScenario(ENTRY)!;
    const state = buildBladeState({
        ...entry,
        setup: [],
        spec: {
            ...entry.spec,
            cards: [
                { name: answer, owner: "me", zone: "hand" },
                ...board,
                ...oppHand,
            ],
        },
    });
    const me = seatPlayerId(state, "me");
    const answerId = getCardByName(answer)?.id;
    const held = getPlayer(state, me).hand.find((c) => c.card.id === answerId)!;
    return cardValue(state, held, handLatentLens(state, me, held));
}

const ANGEL: ScenarioCard = {
    name: "Serra Angel",
    owner: "me",
    zone: "battlefield",
};
const ZERO_POWER: ScenarioCard = {
    name: "Wall of Wood",
    owner: "me",
    zone: "battlefield",
};
const OPP_CARD: ScenarioCard = {
    name: "Savannah Lions",
    owner: "opp",
    zone: "hand",
};

describe("a held counterspell against an empty hand (CR 701.6a)", () => {
    const unit = DEFAULT_EVAL_WEIGHTS.latent.disruption;

    it("is worth nothing with no clock on the caster's board", () => {
        expect(heldValue("Force of Will", [])).toBe(0);
    });

    it("a creature that deals no damage is no clock", () => {
        expect(heldValue("Force of Will", [ZERO_POWER])).toBe(0);
    });

    it("keeps its whole worth behind a clock", () => {
        expect(heldValue("Force of Will", [ANGEL])).toBe(unit);
    });

    it("keeps it with no clock while the opponent holds a card", () => {
        expect(heldValue("Force of Will", [], [OPP_CARD])).toBe(unit);
    });

    it("a resolve() counter is read through its shadow script", () => {
        expect(heldValue("Mana Drain", [ANGEL])).toBeGreaterThan(unit);
    });
});
