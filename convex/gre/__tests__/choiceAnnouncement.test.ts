// Issue #8956 — the `lastChoiceAnnouncement` one-slot record that lets EVERY
// seat read a named card (CR 201.3: a chosen name is public) and the shape of
// a scry / surveil split (CR 701.22a / 701.25a: counts public, the library
// half hidden). The opponent's wire copy never names a card left in the
// library; a graveyard destination is public.
import { describe, it, expect } from "vitest";
import { ponder } from "../../cards/sets/lrw/blue.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { buildSpellContext, type StackItem } from "../state";
import {
    applyNameCardSubmit,
    applyPendingChoiceSubmit,
} from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { getDefinition } from "../../cards";

const BEAR = getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a");

const lib = (ids: string[]) =>
    ids.map((id) =>
        makeInstance(BEAR.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

function pushItem(state: ReturnType<typeof makeState>): StackItem {
    const item: StackItem = {
        ...makeInstance(ponder().id, { controllerId: "p1", ownerId: "p1" }),
        id: "s1",
        castById: "p1",
        targets: [],
        resolutionStep: 0,
    };
    state.stack.push(item);
    return item;
}

function scryState(destination: "library-bottom" | "graveyard") {
    const state = makeState({
        players: [
            makePlayer("p1", { library: lib(["a", "b", "c", "d"]) }),
            makePlayer("p2"),
        ],
    });
    const item = pushItem(state);
    buildSpellContext(state, item).orderTop("p1", 2, { destination });
    return state;
}

function answer(
    state: ReturnType<typeof makeState>,
    top: string[],
    second: string[]
) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: top,
        secondZoneIds: second,
    });
}

describe("lastChoiceAnnouncement — order-top (CR 701.22a / 701.25a)", () => {
    it("scry: the opponent's projection carries counts and no library name", () => {
        const state = scryState("library-bottom");
        answer(state, ["a"], ["b"]);
        const note = state.lastChoiceAnnouncement!;
        expect(note).toMatchObject({
            kind: "top-split",
            chooserId: "p1",
            looked: 2,
            onTop: 1,
            second: 1,
            secondZone: "library-bottom",
        });

        const opp = projectPublicState(state, 1, "p2").lastChoiceAnnouncement!;
        expect(opp.looked).toBe(2);
        expect(opp.chooserNames).toBeUndefined();
        expect(JSON.stringify(opp)).not.toContain(BEAR.name);

        const mine = projectPublicState(state, 1, "p1").lastChoiceAnnouncement!;
        expect(mine.chooserNames).toEqual({
            top: [BEAR.name],
            bottom: [BEAR.name],
        });
    });

    it("surveil: graveyard names reach both seats, the top names only the chooser", () => {
        const state = scryState("graveyard");
        answer(state, ["a"], ["b"]);
        const opp = projectPublicState(state, 1, "p2").lastChoiceAnnouncement!;
        expect(opp).toMatchObject({
            secondZone: "graveyard",
            onTop: 1,
            second: 1,
            graveyardNames: [BEAR.name],
        });
        expect(opp.chooserNames).toBeUndefined();
    });

    it("an order-only look (no second zone) records nothing", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        buildSpellContext(state, pushItem(state)).orderTop("p1", 2, {
            destination: "none",
        });
        answer(state, ["b", "a"], []);
        expect(state.lastChoiceAnnouncement).toBeUndefined();
    });

    it("a second answer overwrites the slot with a fresh seq and key", () => {
        const state = scryState("library-bottom");
        answer(state, ["a", "b"], []);
        const first = state.lastChoiceAnnouncement!;
        // The first answer resumed the (Ponder) item; start a clean second look.
        state.stack.length = 0;
        state.pendingChoices = [];
        buildSpellContext(state, pushItem(state)).orderTop("p1", 2, {
            destination: "library-bottom",
        });
        answer(state, ["a"], ["b"]);
        expect(state.lastChoiceAnnouncement!.seq).toBe(first.seq + 1);
        expect(state.lastChoiceAnnouncement!.key).not.toBe(first.key);
    });

    it("survives the save round-trip", () => {
        const state = scryState("library-bottom");
        answer(state, ["a"], ["b"]);
        const back = expandState(compactState(state));
        expect(back.lastChoiceAnnouncement).toEqual(
            state.lastChoiceAnnouncement
        );
    });
});

describe("lastChoiceAnnouncement — name-card (CR 201.3)", () => {
    it("records the canonical name, public to both seats", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushItem(state);
        buildSpellContext(state, item).requestNameCard({
            playerId: "p1",
            choiceId: "n1",
            prompt: "Name a card",
        });
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: BEAR.name.toLowerCase(),
        });
        for (const viewer of ["p1", "p2"]) {
            expect(
                projectPublicState(state, 1, viewer).lastChoiceAnnouncement
            ).toMatchObject({
                kind: "named-card",
                chooserId: "p1",
                cardName: BEAR.name,
            });
        }
    });
});
