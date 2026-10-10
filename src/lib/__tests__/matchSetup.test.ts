// The Constructed setup flow's pure logic (PRD #5334, ADR 0153, issue #5340):
// steps per branch, change propagation, persistence and the Start request.
import { beforeEach, describe, expect, it } from "vitest";
import type { LobbyDeck } from "../deckTypes";
import {
    EMPTY_SETUP,
    MATCH_SETUP_STORAGE_KEY,
    applyChange,
    firstOpenStep,
    loadSetup,
    matchFormatOptions,
    parseSetup,
    saveSetup,
    setupSteps,
    startRequest,
    stepsFor,
    type MatchSetup,
} from "../matchSetup";

function deck(overrides: Partial<LobbyDeck>): LobbyDeck {
    return {
        kind: "preset",
        presetId: "deck",
        name: "Deck",
        format: "premodern",
        colors: ["R"],
        cards: [{ id: "card-a", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

const burn = deck({ presetId: "burn", name: "Burn", format: "premodern" });
const stiflenought = deck({
    presetId: "stiflenought",
    name: "Stiflenought",
    format: "premodern",
});
const atog = deck({ presetId: "atog", name: "Atog", format: "old-school" });
const pile = deck({ presetId: "pile", name: "Pile", format: "manual" });
const DECKS = [burn, stiflenought, atog, pile];

const setup = (patch: Partial<MatchSetup>): MatchSetup => ({
    ...EMPTY_SETUP,
    ...patch,
});

/** A setup with every step of the Bot branch answered. */
const READY_BOT = setup({
    mode: "arena",
    opponent: "bot",
    matchFormat: "premodern",
    gamesFormat: 3,
    myDeckId: "burn",
});

describe("stepsFor — the steps each branch walks", () => {
    it("Arena vs Bot and Solo walk all five steps", () => {
        for (const opponent of ["bot", "solo"] as const) {
            expect(stepsFor(setup({ mode: "arena", opponent }))).toEqual([
                "mode",
                "opponent",
                "format",
                "myDeck",
                "opponentDeck",
            ]);
        }
    });

    it("Host has no second deck: the opponent brings their own", () => {
        expect(stepsFor(setup({ mode: "arena", opponent: "host" }))).toEqual([
            "mode",
            "opponent",
            "format",
            "myDeck",
        ]);
    });

    it("Cockatrice skips the Match Format step (it is Manual)", () => {
        expect(
            stepsFor(setup({ mode: "cockatrice", opponent: "solo" }))
        ).toEqual(["mode", "opponent", "myDeck", "opponentDeck"]);
    });

    it("Join swaps the Match Format step for the table it inherits from", () => {
        expect(stepsFor(setup({ mode: "arena", opponent: "join" }))).toEqual([
            "mode",
            "opponent",
            "table",
            "myDeck",
        ]);
    });
});

describe("setupSteps / firstOpenStep — what the rail shows", () => {
    it("an empty setup opens on step one", () => {
        expect(firstOpenStep(setupSteps(EMPTY_SETUP, DECKS))).toBe(0);
    });

    it("answers each step in walk order and reports ready at the end", () => {
        const steps = setupSteps(READY_BOT, DECKS);
        expect(steps.map((s) => s.answer)).toEqual([
            "Arena",
            "Bot",
            "Premodern · Bo3",
            "Burn",
            "Mirror · Medium",
        ]);
        expect(firstOpenStep(steps)).toBe(steps.length);
    });

    it("a remembered deck that no longer exists reads as unanswered", () => {
        const steps = setupSteps({ ...READY_BOT, myDeckId: "gone" }, DECKS);
        expect(firstOpenStep(steps)).toBe(3);
    });
});

describe("applyChange — an upstream change clears what it invalidates", () => {
    it("a Match Format change drops a deck the new Format does not admit", () => {
        const next = applyChange(
            READY_BOT,
            { matchFormat: "old-school" },
            DECKS
        );
        expect(next.matchFormat).toBe("old-school");
        expect(next.myDeckId).toBeNull();
    });

    it("drops an inadmissible second deck back to unanswered", () => {
        const next = applyChange(
            { ...READY_BOT, opponentDeckId: "stiflenought" },
            { matchFormat: "old-school" },
            DECKS
        );
        expect(next.opponentDeckId).toBeNull();
        expect(next.opponentDeckChosen).toBe(false);
    });

    it("Freeform admits every playable deck, so nothing is dropped", () => {
        const next = applyChange(
            { ...READY_BOT, opponentDeckId: "stiflenought" },
            { matchFormat: "freeform" },
            DECKS
        );
        expect(next.myDeckId).toBe("burn");
        expect(next.opponentDeckId).toBe("stiflenought");
    });

    it("Cockatrice drops the Bot and every non-Manual deck", () => {
        const next = applyChange(READY_BOT, { mode: "cockatrice" }, DECKS);
        expect(next.opponent).toBeNull();
        expect(next.myDeckId).toBeNull();
    });

    it("a game-mode change leaves a joined table behind", () => {
        const joined = setup({
            mode: "arena",
            opponent: "join",
            joinTableId: "t1",
            joinTableFormat: "premodern",
        });
        const next = applyChange(joined, { mode: "cockatrice" }, DECKS);
        expect(next.opponent).toBeNull();
        expect(next.joinTableId).toBeNull();
        expect(next.joinTableFormat).toBeNull();
    });

    it("an empty patch drops a remembered deck that was deleted", () => {
        expect(
            applyChange({ ...READY_BOT, myDeckId: "gone" }, {}, DECKS).myDeckId
        ).toBeNull();
    });
});

describe("matchFormatOptions — step 3", () => {
    it("offers the playable Formats with their admitted-deck counts", () => {
        const options = matchFormatOptions(DECKS);
        expect(options.map((o) => [o.format, o.admitted])).toEqual([
            ["freeform", 3],
            ["alpha-40", 0],
            ["old-school", 1],
            ["premodern", 2],
        ]);
        expect(options[0].hint).toBe("Admits every deck · 3 decks");
        expect(options[2].hint).toBe("1 deck");
    });
});

describe("persistence — round-trip and tolerant load", () => {
    beforeEach(() => localStorage.clear());

    it("round-trips every choice", () => {
        const full = setup({
            ...READY_BOT,
            opponentDeckId: "stiflenought",
            opponentDeckChosen: true,
            difficulty: "expert",
        });
        saveSetup(full);
        expect(loadSetup()).toEqual(full);
    });

    it("loads the empty setup when nothing is stored", () => {
        expect(loadSetup()).toEqual(EMPTY_SETUP);
    });

    it.each(["not json", "[]", "42", "null", '"arena"'])(
        "loads garbage %s as the empty setup",
        (raw) => {
            localStorage.setItem(MATCH_SETUP_STORAGE_KEY, raw);
            expect(loadSetup()).toEqual(EMPTY_SETUP);
        }
    );

    it("keeps the valid fields of an old or hand-edited shape", () => {
        const loaded = parseSetup(
            JSON.stringify({
                mode: "arena",
                opponent: "ai",
                matchFormat: "limited",
                gamesFormat: 2,
                myDeckId: 7,
                opponentDeckChosen: "yes",
                difficulty: "godlike",
                legacyField: true,
            })
        );
        expect(loaded).toEqual(setup({ mode: "arena" }));
    });

    it("a stored Join loads unanswered until the table step exists", () => {
        expect(parseSetup(JSON.stringify({ opponent: "join" })).opponent).toBe(
            null
        );
    });
});

describe("startRequest — the payload Start sends per opponent", () => {
    const NICK = "Filo";

    it("is null while any step is unanswered", () => {
        expect(
            startRequest({ ...READY_BOT, myDeckId: null }, DECKS, NICK)
        ).toBeNull();
    });

    it("vs Bot: createSoloGame with vsAi, no deck2 for Mirror", () => {
        const req = startRequest(READY_BOT, DECKS, NICK);
        expect(req?.mutation).toBe("createSoloGame");
        expect(req?.seat).toBe("p1");
        expect(req?.args).toMatchObject({
            name: "Filo vs Bot",
            vsAi: true,
            bestOf: 3,
            matchFormat: "premodern",
            deck: { id: "burn", format: "premodern" },
        });
        expect(req?.args).not.toHaveProperty("deck2");
    });

    it("vs Bot with a chosen deck sends it as deck2", () => {
        const req = startRequest(
            { ...READY_BOT, opponentDeckId: "stiflenought" },
            DECKS,
            NICK
        );
        expect(req?.args).toMatchObject({ deck2: { id: "stiflenought" } });
    });

    it("Solo: createSoloGame with no Bot", () => {
        const req = startRequest(
            { ...READY_BOT, opponent: "solo" },
            DECKS,
            NICK
        );
        expect(req?.mutation).toBe("createSoloGame");
        expect(req?.seat).toBe("p1");
        expect(req?.args).not.toHaveProperty("vsAi");
        expect(req?.args).toMatchObject({ matchFormat: "premodern" });
    });

    it("Host: createGame at the user's own seat, with the Match Format", () => {
        const req = startRequest(
            { ...READY_BOT, opponent: "host" },
            DECKS,
            NICK
        );
        expect(req).toMatchObject({
            mutation: "createGame",
            seat: "own",
            args: { name: "Filo's game", matchFormat: "premodern", bestOf: 3 },
        });
    });

    it("Cockatrice: the Manual mutations, no Match Format argument", () => {
        const manual = setup({
            mode: "cockatrice",
            myDeckId: "pile",
            gamesFormat: 3,
        });
        expect(
            startRequest({ ...manual, opponent: "solo" }, DECKS, NICK)
        ).toMatchObject({ mutation: "createManualSoloGame", seat: "p1" });
        const host = startRequest({ ...manual, opponent: "host" }, DECKS, NICK);
        expect(host).toMatchObject({ mutation: "createManualGame" });
        expect(host?.args).not.toHaveProperty("matchFormat");
    });

    it("Join: joinGame on the table, with the joiner's deck", () => {
        const req = startRequest(
            setup({
                mode: "arena",
                opponent: "join",
                joinTableId: "t1",
                joinTableFormat: "premodern",
                myDeckId: "burn",
            }),
            DECKS,
            NICK
        );
        expect(req).toMatchObject({
            mutation: "joinGame",
            seat: "own",
            args: { gameId: "t1", deck: { id: "burn" } },
        });
    });
});
