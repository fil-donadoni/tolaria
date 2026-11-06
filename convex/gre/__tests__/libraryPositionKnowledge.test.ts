// ADR 0026 — a card's position in a library is known to exactly the players who
// could see that placement (CR 400.2 keeps the zone hidden, not a placement made
// in full view; CR 701.24a ends it). Identity (`knownTo`) and position
// (`libraryPositionKnownTo`) are separate facts: every assertion on what a viewer
// sees reads `projectPublicState`, the surface a client actually gets.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "../../cards";
import { ponder } from "../../cards/sets/lrw/blue.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { knownLibraryIndices } from "../libraryKnownRuns";
import { finalizeDrawLookKeep } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    buildSpellContext,
    clearKnowledge,
    drawCard,
    grantKnowledgeToAll,
    putHandCardOnTopOfLibrary,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";

const OUST = getCardByName("Oust").id;
const BRAINSTORM = getDefinition("8d42d7aa-7f53-4cfc-842a-086aab2448d1").id;
const BEARS = getCardByName("Grizzly Bears").id;
const MOUNTAIN = getCardByName("Mountain").id;
const NATURAL_SELECTION = getDefinition(
    "a8917dc8-01c0-4e72-9310-c4d501775411"
).id;

const library = (ids: string[], owner = "p1") =>
    ids.map((id) =>
        makeInstance(MOUNTAIN, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );

const bearInPlay = () =>
    makeInstance(BEARS, { id: "bear", controllerId: "p1", ownerId: "p1" });

/** `viewer`'s wire view of p1's library, as `[index, instance id]`, by index. */
function seen(state: GameState, viewer: string): [number, string][] {
    const seat = projectPublicState(state, 1, viewer).players.find(
        (p) => p.id === "p1"
    )!;
    return seat.library.known
        .map((k): [number, string] => [k.index, k.card.id])
        .sort((a, b) => a[0] - b[0]);
}

function stackItem(state: GameState): StackItem {
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

/** The real Oust, resolved off the stack: the bear goes second from the top. */
function oustBear(top: string[]): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: library(top),
                battlefield: [bearInPlay()],
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, OUST, "p2", [{ type: "permanent", id: "bear" }]);
    resolveTopOfStack(state);
    return state;
}

/** The real Brainstorm, resolved off the stack with `revealed` shown to both
 *  players while still in hand, its two put-backs picked in `pick` order. The
 *  library's top three are the cards it draws. */
function brainstormBack(pick: string[]): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: library(["revealed", "private", "kept", "u1", "u2"]),
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, BRAINSTORM, "p1");
    resolveTopOfStack(state);
    grantKnowledgeToAll(state, "p1", ["revealed"]);
    submitChoice(state, pick);
    return state;
}

describe("a public library insert stays visible at its position (CR 400.2)", () => {
    it("exposes a card second from the top under an unknown card to BOTH players", () => {
        const state = oustBear(["u1", "u2", "u3"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "u1",
            "bear",
            "u2",
            "u3",
        ]);
        expect(seen(state, "p1")).toEqual([[1, "bear"]]);
        expect(seen(state, "p2")).toEqual([[1, "bear"]]);
    });

    it("exposes a card third from the top to both players", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: library(["u1", "u2", "u3"]),
                    battlefield: [bearInPlay()],
                }),
                makePlayer("p2"),
            ],
        });
        buildSpellContext(
            state,
            stackItem(state)
        ).putIntoLibraryFromBattlefield({ type: "permanent", id: "bear" }, 3);
        expect(seen(state, "p1")).toEqual([[2, "bear"]]);
        expect(seen(state, "p2")).toEqual([[2, "bear"]]);
    });

    it("tracks the card through a draw, to its new index", () => {
        const state = oustBear(["u1", "u2", "u3"]);
        drawCard(state.players[0]);
        expect(seen(state, "p1")).toEqual([[0, "bear"]]);
        expect(seen(state, "p2")).toEqual([[0, "bear"]]);
    });

    it("tracks the card when the top of the library grows above it", () => {
        const state = oustBear(["u1", "u2", "u3"]);
        const hand = makeInstance(MOUNTAIN, {
            id: "secret",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        state.players[0].hand.push(hand);
        putHandCardOnTopOfLibrary(state, state.players[0], "secret");
        expect(seen(state, "p2")).toEqual([[2, "bear"]]);
    });

    it("clears for every viewer on a shuffle (CR 701.24a)", () => {
        const state = oustBear(["u1", "u2", "u3"]);
        buildSpellContext(state, stackItem(state)).shuffleLibrary("p1");
        expect(seen(state, "p1")).toEqual([]);
        expect(seen(state, "p2")).toEqual([]);
    });

    it("forgets the old position when the card leaves and comes back unseen", () => {
        const state = oustBear(["u1"]);
        drawCard(state.players[0]);
        drawCard(state.players[0]);
        const bear = state.players[0].hand.find((c) => c.id === "bear")!;
        expect(bear.libraryPositionKnownTo).toBeUndefined();
    });

    it("never sends the placement record over the wire", () => {
        const state = oustBear(["u1", "u2"]);
        const card = projectPublicState(state, 1, "p2").players[0].library
            .known[0].card as unknown as Record<string, unknown>;
        expect(card.id).toBe("bear");
        expect(card).not.toHaveProperty("libraryPositionKnownTo");
    });

    it("survives a save and load", () => {
        const state = oustBear(["u1", "u2"]);
        const reloaded = expandState(compactState(state));
        expect(seen(reloaded, "p2")).toEqual([[1, "bear"]]);
        // A look-class card keeps round-tripping through the shorter tuple.
        state.players[0].library[0].knownTo = ["p1"];
        expect(seen(expandState(compactState(state)), "p1")).toEqual([
            [0, "u1"],
            [1, "bear"],
        ]);
    });
});

describe("a private placement is known to its controller only", () => {
    it("keeps a card revealed in hand face-down for the opponent, on top", () => {
        const state = brainstormBack(["private", "revealed"]);
        // moveHandCardToLibraryTop unshifts in pick order: "revealed" lands on top.
        expect(state.players[0].library[0].id).toBe("revealed");
        expect(seen(state, "p2")).toEqual([]);
        expect(seen(state, "p1")).toEqual([
            [0, "revealed"],
            [1, "private"],
        ]);
        // Identity is a different fact: the opponent still knows the card.
        expect(state.players[0].library[0].knownTo).toContain("p2");
    });

    it("keeps it face-down when the card above it is drawn", () => {
        const state = brainstormBack(["revealed", "private"]);
        expect(state.players[0].library[1].id).toBe("revealed");
        expect(seen(state, "p2")).toEqual([]);
        drawCard(state.players[0]);
        expect(state.players[0].library[0].id).toBe("revealed");
        expect(seen(state, "p2")).toEqual([]);
        expect(seen(state, "p1")).toEqual([[0, "revealed"]]);
    });

    it("stays known to the controller at its new index when a public insert pushes it down", () => {
        const state = brainstormBack(["private", "revealed"]);
        state.players[0].battlefield.push(bearInPlay());
        buildSpellContext(
            state,
            stackItem(state)
        ).putIntoLibraryFromBattlefield({ type: "permanent", id: "bear" }, 2);
        expect(state.players[0].library.map((c) => c.id).slice(0, 3)).toEqual([
            "revealed",
            "bear",
            "private",
        ]);
        expect(seen(state, "p1")).toEqual([
            [0, "revealed"],
            [1, "bear"],
            [2, "private"],
        ]);
        // The public card and nothing else, despite the identity of "revealed".
        expect(seen(state, "p2")).toEqual([[1, "bear"]]);
    });

    it("stays known to the controller at any depth, under a card they never saw", () => {
        const state = brainstormBack(["private", "revealed"]);
        state.players[0].library.unshift(...library(["unseen"]));
        expect(seen(state, "p1")).toEqual([
            [1, "revealed"],
            [2, "private"],
        ]);
        expect(seen(state, "p2")).toEqual([]);
    });

    it("shows a card this resolution publicly revealed to the reveal's audience", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: library(["u1"]),
                    hand: [
                        makeInstance(MOUNTAIN, {
                            id: "shown",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const ctx = buildSpellContext(state, stackItem(state));
        ctx.markKnownToAll("p1", ["shown"]);
        ctx.notifyReveal(["p1", "p2"], ["shown"], "src", "reveal");
        ctx.moveHandCardToLibraryTop("p1", "shown");
        expect(seen(state, "p2")).toEqual([[0, "shown"]]);
    });

    it("adds the audience of a reveal that follows the placement", () => {
        const state = brainstormBack(["private", "revealed"]);
        buildSpellContext(state, stackItem(state)).markKnownToAll("p1", [
            "private",
        ]);
        expect(seen(state, "p2")).toEqual([[1, "private"]]);
    });
});

describe("a look-class grant conveys what it always did", () => {
    it("stays with the viewer it was shown to, and unknown neighbours stay backs", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        const ctx = buildSpellContext(state, stackItem(state));
        ctx.markKnown("p1", ["a"], "p1");
        expect(seen(state, "p1")).toEqual([[0, "a"]]);
        expect(seen(state, "p2")).toEqual([]);
    });

    it("still goes dark for its viewer once an unknown card straddles it", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library(["u", "a", "v"]) }),
                makePlayer("p2"),
            ],
        });
        state.players[0].library[1].knownTo = ["p1"];
        expect(seen(state, "p1")).toEqual([]);
    });
});

describe("a private re-placement takes a public position away", () => {
    it("narrows to the chooser when a scry re-places the card", () => {
        const state = oustBear(["u1", "u2"]);
        const item = stackItem(state);
        const ctx = buildSpellContext(state, item);
        ctx.orderTop("p1", 2, { destination: "none" });
        item.collectedChoices = { "0:order-top-s1": ["bear", "u1"] };
        buildSpellContext(state, item).orderTop("p1", 2, {
            destination: "none",
        });
        expect(state.players[0].library[0].id).toBe("bear");
        expect(seen(state, "p2")).toEqual([]);
        expect(seen(state, "p1")).toEqual([
            [0, "bear"],
            [1, "u1"],
        ]);
    });

    it("narrows to the chooser when a scry bottoms the card", () => {
        const state = oustBear(["u1", "u2"]);
        const item = stackItem(state);
        buildSpellContext(state, item).orderTop("p1", 2, {
            destination: "library-bottom",
        });
        item.collectedChoices = {
            "0:order-top-s1": ["u1"],
            "0:order-top-s1:second": ["bear"],
        };
        buildSpellContext(state, item).orderTop("p1", 2, {
            destination: "library-bottom",
        });
        expect(state.players[0].library.at(-1)!.id).toBe("bear");
        expect(seen(state, "p2")).toEqual([]);
    });

    it("narrows to the chooser on a reorder-library answer", () => {
        const state = oustBear(["u1", "u2"]);
        // The real Natural Selection, the opponent's: they see and arrange the
        // top three of p1's library, and p1 only sees them being put back.
        pushSpell(state, NATURAL_SELECTION, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].kind).toBe("reorder-library");
        submitChoice(state, ["bear", "u1", "u2"]);
        expect(seen(state, "p1")).toEqual([]);
        expect(seen(state, "p2")).toEqual([
            [0, "bear"],
            [1, "u1"],
            [2, "u2"],
        ]);
    });

    it("narrows to the searcher on a tutor to the top with no reveal", () => {
        const state = oustBear(["u1", "u2"]);
        buildSpellContext(state, stackItem(state)).putLibraryCardsOnTop("p1", [
            "bear",
        ]);
        expect(seen(state, "p2")).toEqual([]);
        expect(seen(state, "p1")).toEqual([[0, "bear"]]);
    });

    it("keeps the position for the audience of a tutor's reveal", () => {
        const state = oustBear(["u1", "u2"]);
        const ctx = buildSpellContext(state, stackItem(state));
        ctx.notifyReveal(["p1", "p2"], ["bear"], "src", "reveal");
        ctx.putLibraryCardsOnTop("p1", ["bear"]);
        expect(seen(state, "p2")).toEqual([[0, "bear"]]);
    });

    it("clears a random bottoming nobody witnessed (draw-look-keep)", () => {
        const state = oustBear(["u1", "u2"]);
        state.pendingChoices = [
            {
                id: "lamp",
                kind: "draw-look-keep",
                playerId: "p1",
                zone: "library",
                candidateIds: ["u1", "bear"],
            },
        ] as unknown as GameState["pendingChoices"];
        finalizeDrawLookKeep(state, ["u1"]);
        expect(state.players[0].library.at(-1)!.id).toBe("bear");
        expect(seen(state, "p1")).toEqual([]);
        expect(seen(state, "p2")).toEqual([]);
    });
});

describe("knownLibraryIndices — placements between the end runs", () => {
    it("emits each index once, top run then bottom run then the middle", () => {
        const cards = library(["t", "u1", "m", "u2", "b"]);
        cards[0].knownTo = ["p1"];
        cards[2].knownTo = ["p1"];
        cards[2].libraryPositionKnownTo = ["p1"];
        cards[4].knownTo = ["p1"];
        expect(knownLibraryIndices(cards, "p1")).toEqual([0, 4, 2]);
    });

    it("carries a run through a witnessed card, as a known card always did", () => {
        const cards = library(["t", "m", "k", "u"]);
        cards[0].knownTo = ["p1"];
        cards[1].knownTo = ["p1"];
        cards[1].libraryPositionKnownTo = ["p1"];
        cards[2].knownTo = ["p1"];
        expect(knownLibraryIndices(cards, "p1")).toEqual([0, 1, 2]);
    });

    it("lets clearKnowledge narrow the record to a witness", () => {
        const cards = library(["a"]);
        cards[0].knownTo = ["p1", "p2"];
        cards[0].libraryPositionKnownTo = ["p1", "p2"];
        clearKnowledge(cards, "p1");
        expect(knownLibraryIndices(cards, "p2")).toEqual([]);
        expect(knownLibraryIndices(cards, "p1")).toEqual([0]);
    });
});
