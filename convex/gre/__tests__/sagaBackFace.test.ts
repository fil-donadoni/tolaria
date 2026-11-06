// A Saga on the BACK face of a nonmodal double-faced card (CR 712.8e, CR 714,
// issue #8338). The Elesh Norn // The Argent Etchings shape: exile the front
// face, return it transformed, and it enters as a Saga.
//
// The back face's chapters ride its content-derived id, so the definition it
// presents reaches `expandChapterAbilities` like any Saga. Every test below goes
// through the id: the entry path, the cold decode a client runs, the projection.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { chapterAbilityId, LORE_COUNTER } from "../../cards/abilities/sagas";
import { backFaceAsTokenSpec } from "../../cards/backFaceSpec";
import {
    getDefinition,
    registerTokenDefinition,
    tokenDefinitionId,
} from "../../cards";
import type { CardBackFace } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import { advancePhase } from "../phases";
import { finalChapter, loreCounters } from "../sagas";
import { checkStateBasedActions } from "../sba";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";
import { transformPermanent } from "../transform";

const BACK_FACE: CardBackFace = {
    name: "Test Etchings",
    types: ["Enchantment"],
    subtypes: ["Saga"],
    colors: ["W"],
    oracleText: "I — Draw a card.\nII — You gain 2 life.",
    chapterAbilities: [
        {
            chapters: [1],
            oracleText: "I — Draw a card.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
        {
            chapters: [2],
            oracleText: "II — You gain 2 life.",
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
};

const FRONT_ID = "test-saga-back-face-front";
const FLIP = "test-saga-back-face-flip";
registerTokenDefinition({
    id: FRONT_ID,
    name: "Test Praetor",
    rarity: "rare",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: FLIP,
            oracleText:
                "{0}: Exile this creature, then return it to the battlefield transformed under its owner's control.",
            cost: {},
            useStack: true,
            effects: [
                { op: "exileAndReturnTransformed", target: { ref: "$source" } },
            ],
        },
    ],
    backFace: BACK_FACE,
});

function boardWithFront(stateOverrides: Partial<GameState> = {}): {
    state: GameState;
    front: CardInstanceState;
} {
    const library = [
        makeInstance(FRONT_ID, { ownerId: "p1", zone: "library" }),
        makeInstance(FRONT_ID, { ownerId: "p1", zone: "library" }),
    ];
    const front = makeInstance(FRONT_ID, {
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [front], library }),
            makePlayer("p2"),
        ],
        ...stateOverrides,
    });
    return { state, front };
}

/** Activates the flip and resolves it: the permanent re-enters as the Saga. */
function enterTransformed(stateOverrides: Partial<GameState> = {}): {
    state: GameState;
    saga: CardInstanceState;
} {
    const { state, front } = boardWithFront(stateOverrides);
    resolveActivated(state, front, FLIP);
    const saga = state.players[0].battlefield.find((c) => c.id === front.id)!;
    return { state, saga };
}

const stackedChapter = (state: GameState, chapters: number[]) =>
    state.stack.some(
        (i) => i.triggeredAbilityId === chapterAbilityId(chapters)
    );

describe("a permanent entering with a Saga back face up (CR 712.14a, CR 714.3a)", () => {
    it("enters with its lore counter and fires chapter I", () => {
        const { state, saga } = enterTransformed();
        expect(saga.transformed).toBe(true);
        expect(saga.subtypes).toEqual(["Saga"]);
        expect(loreCounters(saga)).toBe(1);
        expect(stackedChapter(state, [1])).toBe(true);
        expect(stackedChapter(state, [2])).toBe(false);

        const handBefore = state.players[0].hand.length;
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(handBefore + 1);
    });

    it("advances at precombat main and fires the next chapter (CR 714.3c, CR 714.2b)", () => {
        const { state, saga } = enterTransformed({
            phase: "DRAW",
            priorityPlayerId: "p1",
        });
        resolveTopOfStack(state);
        advancePhase(state);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(loreCounters(saga)).toBe(2);
        expect(stackedChapter(state, [2])).toBe(true);
    });
});

describe("the CR 714.4 sacrifice applies to a back-face Saga", () => {
    it("reads the final chapter off the face, waits for it, then sacrifices (CR 714.2d, CR 712.8a)", () => {
        const { state, saga } = enterTransformed({
            phase: "DRAW",
            priorityPlayerId: "p1",
        });
        expect(finalChapter(saga)).toBe(2);
        resolveTopOfStack(state);
        advancePhase(state);

        // The final chapter is on the stack: the Saga stays.
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(saga);

        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).not.toContain(saga);
        // CR 712.8a — it lands as its front face.
        const buried = state.players[0].graveyard.find(
            (c) => c.id === saga.id
        )!;
        expect((buried.card as { id: string }).id).toBe(FRONT_ID);
        expect(buried.transformed).toBeUndefined();
    });
});

describe("transforming in place is not entering (CR 701.27, CR 714.3a)", () => {
    it("gets no entry counter, then advances at precombat main (CR 714.3c)", () => {
        const { state, front } = boardWithFront({
            phase: "DRAW",
            priorityPlayerId: "p1",
        });
        transformPermanent(NO_BOARD_LAYER_VIEW, front);
        expect(front.subtypes).toEqual(["Saga"]);
        expect(loreCounters(front)).toBe(0);
        expect(state.stack).toHaveLength(0);

        advancePhase(state);
        expect(front.counters?.[LORE_COUNTER]).toBe(1);
        expect(stackedChapter(state, [1])).toBe(true);
    });
});

describe("the face's id carries its chapters (CR 712.8e, ADR 0067)", () => {
    // A client (or a cold isolate) holds nothing but the wire id: no printed
    // card, no registration. A fresh face so no earlier test registered this id.
    it("a cold decode is a whole Saga: triggers, entry lore counter, final chapter", () => {
        const id = tokenDefinitionId(
            backFaceAsTokenSpec({ ...BACK_FACE, name: "Test Cold Etchings" })
        );
        const decoded = getDefinition(id);
        expect(decoded.subtypes).toEqual(["Saga"]);
        expect(
            decoded.triggeredAbilities?.map((t) => t.chapterNumbers)
        ).toEqual([[1], [2]]);
        expect(decoded.entersWith?.counters).toEqual([
            { type: LORE_COUNTER, count: 1 },
        ]);
    });

    it("two faces differing only in a chapter's script get two ids (CR 714.2)", () => {
        const other: CardBackFace = {
            ...BACK_FACE,
            chapterAbilities: [
                {
                    chapters: [1],
                    oracleText: "I — Draw a card.",
                    effects: [{ op: "draw", player: "controller", count: 2 }],
                },
            ],
        };
        expect(tokenDefinitionId(backFaceAsTokenSpec(other))).not.toBe(
            tokenDefinitionId(backFaceAsTokenSpec(BACK_FACE))
        );
    });

    it("a token without chapters keeps its id byte-identical", () => {
        const id = tokenDefinitionId({
            name: "Test Plain",
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        expect(id.split("|")).toHaveLength(16);
    });

    it("projects the Saga with its lore counter, identically to both viewers (CR 712.6)", () => {
        const { state, saga } = enterTransformed();
        for (const viewerId of ["p1", "p2"]) {
            const slim = projectPublicState(
                state,
                1,
                viewerId
            ).players[0].battlefield.find((c) => c.id === saga.id)!;
            expect(slim.transformed).toBe(true);
            expect(slim.subtypes).toEqual(["Saga"]);
            expect(slim.counters?.[LORE_COUNTER]).toBe(1);
            expect(getDefinition(slim.card.id).name).toBe("Test Etchings");
        }
    });
});
