// The Debug panel's one-click restarts read ONE seat's decklist (issue #2506
// review, finding 3).
//
// Before the split the panel cloned `game.players[0].deck.cards` straight off
// the `games` row, which every client could read — so "New Solo" / "New vs-AI"
// worked from either seat of a 2-player game by cloning whichever list came
// first, the opponent's included. The split closed that read: `getSeatDeck`
// answers only for a seat the CALLER owns, and returns `null` otherwise. Keeping
// `players[0]` as the source seat therefore regresses the feature for the
// JOINER — `sourceDeck` stays undefined and both buttons no-op in silence,
// because `if (!sourceDeck) return;` has no error path.
//
// So the panel sources the seat THIS client occupies (the session `playerId`),
// and that is what these tests pin: the query is mounted for the viewer's own
// seat, and the restart actually fires with the cards that come back. Driven
// through a real render of the real component — a hand-built call of the
// selection expression would pass just as happily on a panel that never used it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    render,
    cleanup,
    screen,
    waitFor,
    fireEvent,
} from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

const GAME = "game1" as Id<"games">;
const HOST = "alice";
const JOINER = "bob";

const HOST_CARDS = [{ cardId: "print-a", cardName: "Mountain" }];
const JOINER_CARDS = [
    { cardId: "print-b", cardName: "Forest" },
    { cardId: "print-c", cardName: "Grizzly Bears" },
];

/** Every non-"skip" `useQuery`, so a test can assert WHICH seat was asked for
 *  — the arg is the whole bug: a query mounted for the other seat resolves
 *  `null` and is indistinguishable from "still loading" at the call site. */
const queryMounts: { ref: unknown; args: unknown }[] = [];
const mutationCalls: { ref: unknown; args: unknown }[] = [];
/** Whom the mocked transport authenticates as — `getSeatDeck` answers only for
 *  a seat this user owns, exactly as the server gate does. */
let viewerUserId = JOINER;

function seat(id: string) {
    return {
        id,
        name: id,
        bgColor: "#000",
        deck: { id: `deck-${id}`, name: `${id}'s deck`, format: "freeform" },
    };
}

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        queryMounts.push({ ref, args });
        const name = (ref as { name?: string }).name;
        if (name === "users.currentUser")
            return { _id: viewerUserId, nickname: viewerUserId };
        if (name === "game.getGame")
            return {
                _id: GAME,
                name: "Table",
                status: "playing",
                players: [seat(HOST), seat(JOINER)],
            };
        if (name === "game.getSeatDeck") {
            // The server gate, restated at the transport boundary: a seat the
            // caller does not own answers `null`, never the cards.
            const { playerId } = args as { playerId: string };
            const owns =
                playerId === viewerUserId ||
                playerId.startsWith(`${viewerUserId}-`);
            if (!owns) return null;
            return {
                playerId,
                cards: playerId === HOST ? HOST_CARDS : JOINER_CARDS,
            };
        }
        // `getFullState` and anything else the panel subscribes to.
        return undefined;
    },
    useMutation: (ref: unknown) => (args: unknown) => {
        mutationCalls.push({ ref, args });
        return Promise.resolve("game2" as Id<"games">);
    },
}));

// The mocked `convex/react` has no `name` on the query refs the generated api
// hands out, so the mock above reads one — this stub supplies it.
vi.mock("@convex/_generated/api", () => {
    const named = (name: string) => ({ name });
    return {
        api: {
            users: { currentUser: named("users.currentUser") },
            game: {
                getGame: named("game.getGame"),
                getSeatDeck: named("game.getSeatDeck"),
                getFullState: named("game.getFullState"),
                debugResetGame: named("game.debugResetGame"),
                createSoloGame: named("game.createSoloGame"),
                debugBo3Sideboard: named("game.debugBo3Sideboard"),
            },
        },
    };
});

const DebugPanel = (await import("../debug-panel")).default;

const onSwitchGame = vi.fn();

function renderPanel(playerId: string) {
    return render(
        <DebugPanel
            gameId={GAME}
            playerId={playerId}
            showAllCards={false}
            onToggleShowAllCards={() => {}}
            debugAllActions={false}
            onToggleDebugAllActions={() => {}}
            onSwitchGame={onSwitchGame}
        />
    );
}

/** Opens the collapsed panel — every affordance under test is behind it. */
function openPanel() {
    fireEvent.click(screen.getByText("Debug"));
}

function seatDeckMounts() {
    return queryMounts
        .filter((m) => (m.ref as { name?: string }).name === "game.getSeatDeck")
        .map((m) => (m.args as { playerId: string }).playerId);
}

describe("Debug panel restart source deck (issue #2506 review, finding 3)", () => {
    beforeEach(() => {
        queryMounts.length = 0;
        mutationCalls.length = 0;
        onSwitchGame.mockClear();
        viewerUserId = JOINER;
    });
    afterEach(() => cleanup());

    it("asks getSeatDeck for the JOINER's own seat, not the host's", async () => {
        renderPanel(JOINER);
        openPanel();
        const asked = seatDeckMounts();
        expect(asked.length).toBeGreaterThan(0);
        expect(new Set(asked)).toEqual(new Set([JOINER]));
    });

    it("restarts for the JOINER with the JOINER's own cards", async () => {
        renderPanel(JOINER);
        openPanel();
        fireEvent.click(screen.getByText("New Solo Game"));
        await waitFor(() => expect(mutationCalls.length).toBeGreaterThan(0));
        const created = mutationCalls.find(
            (c) => (c.ref as { name?: string }).name === "game.createSoloGame"
        );
        expect(created).toBeDefined();
        const { deck } = created!.args as {
            deck: { id: string; cards: { cardId: string }[] };
        };
        expect(deck.id).toBe(`deck-${JOINER}`);
        expect(deck.cards.map((c) => c.cardId)).toEqual(["print-b", "print-c"]);
        expect(onSwitchGame).toHaveBeenCalledWith("game2", `${JOINER}-p1`);
    });

    it("still sources the HOST's own seat when the host is the viewer", async () => {
        viewerUserId = HOST;
        renderPanel(HOST);
        openPanel();
        expect(new Set(seatDeckMounts())).toEqual(new Set([HOST]));
        fireEvent.click(screen.getByText("New vs-AI Game"));
        await waitFor(() => expect(mutationCalls.length).toBeGreaterThan(0));
        const created = mutationCalls.find(
            (c) => (c.ref as { name?: string }).name === "game.createSoloGame"
        );
        expect(
            (created!.args as { deck: { cards: { cardId: string }[] } }).deck
                .cards
        ).toEqual(HOST_CARDS);
    });
});
