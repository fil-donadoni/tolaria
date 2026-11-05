// The Bot's Miracle reveal policy (CR 702.94a): reveal IFF it intends to
// cast — the miracle cost payable now AND the cast worth something on the
// current board. One candidate, never a searched pair: a reveal that is not
// followed by a cast only hands the opponent information.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../cards/types";
import { registerTokenDefinition, getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";
import { choiceCandidates } from "../ai/choiceCandidates";
import { compiledDevastationTide } from "../../oracle/__tests__/devastationTide.fixture";
import { metamorphosisFanatic } from "../../cards/sets/dsc/black.cards";

const ISLAND = getCardByName("Island").id;
const SWAMP = getCardByName("Swamp").id;
const BEARS = getCardByName("Balduvian Bears").id;

const TIDE_ID = "test-miracle-bot-devastation-tide";
registerTokenDefinition({
    ...compiledDevastationTide(),
    id: TIDE_ID,
    rarity: "rare",
});
registerTokenDefinition(metamorphosisFanatic());
const DRAW_ID = "test-miracle-bot-draw";
registerTokenDefinition({
    id: DRAW_ID,
    name: DRAW_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 } as EffectOp],
});

function permanents(cardId: string, owner: string, n: number, tag: string) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(cardId, {
            id: `${owner}-${tag}-${i}`,
            ownerId: owner,
            controllerId: owner,
            zone: "battlefield",
        })
    );
}

/** The bot ("p1") draws `cardId` as its first card this turn. */
function windowFor(
    cardId: string,
    p1Battlefield: ReturnType<typeof permanents>,
    p2Battlefield: ReturnType<typeof permanents>
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: [
                    makeInstance(cardId, {
                        id: "miracle",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
                battlefield: p1Battlefield,
            }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
    pushSpell(state, DRAW_ID, "p1");
    resolveTopOfStack(state);
    expect(state.pendingChoices?.[0].kind).toBe("miracle-reveal");
    return state;
}

const answer = (state: GameState) =>
    choiceCandidates(state, state.pendingChoices![0]).map((c) => c.move);

describe("Bot miracle reveal policy (CR 702.94a)", () => {
    it("reveals a mass bounce that takes the opponent's board, castable now", () => {
        const state = windowFor(
            TIDE_ID,
            permanents(ISLAND, "p1", 2, "island"),
            permanents(BEARS, "p2", 3, "bears")
        );
        expect(answer(state)).toEqual([
            { kind: "miracle-reveal", reveal: true },
        ]);
    });

    it("keeps it hidden when the miracle cost cannot be paid", () => {
        const state = windowFor(
            TIDE_ID,
            permanents(ISLAND, "p1", 1, "island"),
            permanents(BEARS, "p2", 3, "bears")
        );
        expect(answer(state)).toEqual([
            { kind: "miracle-reveal", reveal: false },
        ]);
    });

    it("keeps it hidden when the bounce would cost the Bot more than the opponent", () => {
        const state = windowFor(
            TIDE_ID,
            [
                ...permanents(ISLAND, "p1", 2, "island"),
                ...permanents(BEARS, "p1", 3, "bears"),
            ],
            []
        );
        expect(answer(state)).toEqual([
            { kind: "miracle-reveal", reveal: false },
        ]);
    });

    it("reveals a creature miracle it can pay for", () => {
        const state = windowFor(
            metamorphosisFanatic().id,
            permanents(SWAMP, "p1", 2, "swamp"),
            []
        );
        expect(answer(state)).toEqual([
            { kind: "miracle-reveal", reveal: true },
        ]);
    });
});
