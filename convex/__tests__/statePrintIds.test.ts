// The Print IDs a loaded debug / Blade position adds to `games.cardIds`, the
// Game-load Token Print query's input (issue #4120). A scenario replaces the
// board without touching the decklists, so without this its tokens — the
// surfaces QA and `check:ui` walk — would resolve no edition art.
import { describe, it, expect } from "vitest";
import { statePrintIds, withStatePrintIds } from "../deckStore";
import { buildStateFromScenario } from "../gre/scenarioBuilder";
import { findTokenSpec } from "../cards/tokenCatalogue";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { StackItem } from "../gre/state";

const BIRDS = "55fe6449-1f23-43dc-adee-d144cd505b5c";
const PRINT = "4e50454c-3927-4e7e-b4f6-7f5d5fd9b913";

describe("statePrintIds", () => {
    it("names the Card ID, chosen printing and token source of every card in play", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BIRDS, {
                            id: "b",
                            imagePrintId: PRINT,
                        }),
                        makeInstance(BIRDS, {
                            id: "t",
                            isToken: true,
                            sourcePrintId: "producer",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(statePrintIds(state).sort()).toEqual(
            [BIRDS, PRINT, "producer"].sort()
        );
    });

    it("includes the stack, and leaves out synthetic ids that name no print", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            stack: [
                {
                    ...makeInstance(BIRDS, { id: "s" }),
                    sourcePrintId: "stack-source",
                } as StackItem,
                {
                    ...makeInstance(BIRDS, { id: "w" }),
                    card: { id: "token:Wasp|x" },
                    castById: "p1",
                } as StackItem,
                {
                    ...makeInstance(BIRDS, { id: "l" }),
                    card: { id: `${BIRDS}#left` },
                    castById: "p1",
                } as StackItem,
                {
                    ...makeInstance(BIRDS, { id: "f" }),
                    card: { id: "face-down:2-2" },
                    castById: "p1",
                } as StackItem,
            ],
        });
        expect(statePrintIds(state).sort()).toEqual(
            [BIRDS, "stack-source"].sort()
        );
    });

    it("a staged catalogue token carries its producer, so the loaded position can resolve it", () => {
        const wasp = findTokenSpec("Wasp")!;
        const state = buildStateFromScenario(makeState({}), {
            cards: [{ name: "Wasp", owner: "me", token: true }],
        });
        expect(wasp.sourcePrintId).toBeDefined();
        expect(statePrintIds(state)).toContain(wasp.sourcePrintId);
    });
});

describe("withStatePrintIds", () => {
    it("keeps the deck manifest first and adds only what the position brings", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(BIRDS, { id: "b" })],
                }),
                makePlayer("p2"),
            ],
        });
        expect(withStatePrintIds(["deck-a", BIRDS], state)).toEqual([
            "deck-a",
            BIRDS,
        ]);
        expect(withStatePrintIds(undefined, state)).toEqual([BIRDS]);
    });
});
