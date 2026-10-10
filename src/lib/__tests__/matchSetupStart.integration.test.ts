// Full path (PRD #5334 stories 36–37, 52, issue #5341): a vs-Bot setup's
// Start request run through the REAL `createSoloGame` — the Match it stores
// carries the chosen Match Format, and the Bot's seat holds the chosen deck
// (or the player's own deck for Mirror). `matchSetup.test.ts` pins the
// request's shape; this proves the server reads it the way the flow means it.
import { describe, expect, it } from "vitest";
import type { MutationCtx } from "@convex/_generated/server";
import { makeInMemoryDb } from "@convex/__tests__/fixtures/inMemoryDb.fixture";
import { createSoloGame } from "@convex/game";
import type { LobbyDeck } from "../deckTypes";
import { EMPTY_SETUP, startRequest, type MatchSetup } from "../matchSetup";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

const ALICE = "user-alice";
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

/** A legal deck of copies of one card, told apart by card name. */
function deck(
    presetId: string,
    format: "premodern" | "freeform",
    cardName: string
): LobbyDeck {
    return {
        kind: "preset",
        presetId,
        name: presetId,
        format,
        colors: [],
        cards: Array.from({ length: 60 }, () => ({
            cardId: MOUNTAIN,
            cardName,
            definitionId: cardName,
        })),
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    };
}

// The player's deck is Premodern and the Match Format Freeform: a create that
// lost the chosen Match Format would default to the host deck's (Premodern)
// and refuse the Freeform Bot deck — or store the wrong Format under Mirror.
const DECKS = [
    deck("mine", "premodern", "Mountain"),
    deck("theirs", "freeform", "Island"),
];

const VS_BOT: MatchSetup = {
    ...EMPTY_SETUP,
    mode: "arena",
    opponent: "bot",
    matchFormat: "freeform",
    gamesFormat: 3,
    myDeckId: "mine",
};

async function startVsBot(setup: MatchSetup) {
    const db = makeInMemoryDb(
        { users: [{ _id: ALICE, nickname: "Alice", email: "a@x" }] },
        { identitySubject: ALICE }
    );
    const request = startRequest(setup, DECKS, "Alice");
    if (request?.mutation !== "createSoloGame") {
        throw new Error(`expected createSoloGame, got ${request?.mutation}`);
    }
    await run(createSoloGame, db.ctx, request.args);
    const match = db.tables.matches![0];
    const seatCards = (seat: string) =>
        db.tables
            .matchDecks!.find((r) => r.playerId === `${ALICE}-${seat}`)!
            .maindeck.map((c: { cardName: string }) => c.cardName);
    return { match, p1: seatCards("p1"), p2: seatCards("p2") };
}

describe("vs-Bot Start through createSoloGame", () => {
    it("stores the chosen Match Format and seats the chosen Bot deck", async () => {
        const { match, p1, p2 } = await startVsBot({
            ...VS_BOT,
            opponentDeckId: "theirs",
            opponentDeckChosen: true,
        });
        expect(match.matchFormat).toBe("freeform");
        expect(match.bestOf).toBe(3);
        expect(match.vsAi).toBe(true);
        expect(new Set(p1)).toEqual(new Set(["Mountain"]));
        expect(new Set(p2)).toEqual(new Set(["Island"]));
    });

    it("Mirror seats the player's own deck for the Bot", async () => {
        const { match, p2 } = await startVsBot(VS_BOT);
        expect(match.matchFormat).toBe("freeform");
        expect(new Set(p2)).toEqual(new Set(["Mountain"]));
    });
});
