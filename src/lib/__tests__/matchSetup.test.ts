// The Constructed setup flow's pure logic (PRD #5334, ADR 0153, issue #5340):
// steps per branch, change propagation, persistence and the Start request.
import { beforeEach, describe, expect, it } from "vitest";
import type { LobbyDeck } from "../deckTypes";
import {
    EMPTY_SETUP,
    MATCH_SETUP_STORAGE_KEY,
    applyChange,
    archivedDecksOffered,
    clockOffered,
    defaultBotDeckId,
    effectiveClock,
    firstOpenStep,
    loadSetup,
    matchFormatOptions,
    parseSetup,
    reconcileSetup,
    saveSetup,
    setupSteps,
    startRequest,
    stepsFor,
    tablesForMode,
    effectiveMatchFormat,
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
            "Mirror · Expert",
        ]);
        expect(firstOpenStep(steps)).toBe(steps.length);
    });

    it("a remembered deck that no longer exists reads as unanswered", () => {
        const steps = setupSteps({ ...READY_BOT, myDeckId: "gone" }, DECKS);
        expect(firstOpenStep(steps)).toBe(3);
    });

    it("a remembered deck that became illegal is dropped, so Start is off", () => {
        const decks = DECKS.map((d) =>
            d.presetId === "burn" ? { ...d, isLegal: false } : d
        );
        expect(applyChange(READY_BOT, {}, decks).myDeckId).toBeNull();
        expect(startRequest(READY_BOT, decks, "Alice")).toBeNull();
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
        expect(options[0].hint).toBe("Admits every Arena deck · 3 decks");
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
            expect(parseSetup(raw)).toEqual(EMPTY_SETUP);
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

    it("an unknown game mode loads unanswered", () => {
        expect(parseSetup(JSON.stringify({ mode: "online" })).mode).toBe(null);
    });

    it("a stored Join reopens on the table step; a join code is never kept", () => {
        const loaded = parseSetup(
            JSON.stringify({ opponent: "join", joinCode: "ABC123" })
        );
        expect(loaded.opponent).toBe("join");
        expect(loaded.joinCode).toBeNull();
    });
});

describe("startRequest — the payload Start sends per opponent", () => {
    const NICK = "Filo";

    it("is null while any step is unanswered", () => {
        expect(
            startRequest({ ...READY_BOT, myDeckId: null }, DECKS, NICK)
        ).toBeNull();
    });

    it("is null while the second deck is unanswered", () => {
        expect(
            startRequest(
                { ...READY_BOT, opponentDeckChosen: false },
                DECKS,
                NICK
            )
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

describe("Join and Cockatrice branches (issue #5342)", () => {
    const joined = setup({
        mode: "arena",
        opponent: "join",
        joinTableId: "t1",
        joinTableFormat: "premodern",
    });

    it("Join inherits the host's Match Format and asks no Match Format step", () => {
        expect(effectiveMatchFormat(joined)).toBe("premodern");
        expect(stepsFor(joined)).not.toContain("format");
        expect(stepsFor(joined)).toContain("table");
    });

    it("step 4 is pre-filtered by the inherited Match Format", () => {
        const next = applyChange(joined, { myDeckId: "atog" }, DECKS);
        expect(next.myDeckId).toBeNull();
        expect(applyChange(joined, { myDeckId: "burn" }, DECKS).myDeckId).toBe(
            "burn"
        );
    });

    it("Cockatrice drops step 3 and forces Manual", () => {
        const cockatrice = setup({ mode: "cockatrice", opponent: "solo" });
        expect(stepsFor(cockatrice)).not.toContain("format");
        expect(effectiveMatchFormat(cockatrice)).toBe("manual");
        expect(
            applyChange(cockatrice, { myDeckId: "burn" }, DECKS).myDeckId
        ).toBeNull();
        expect(
            applyChange(cockatrice, { myDeckId: "pile" }, DECKS).myDeckId
        ).toBe("pile");
    });

    it("switching to Cockatrice with Bot chosen clears the opponent", () => {
        const next = applyChange(READY_BOT, { mode: "cockatrice" }, DECKS);
        expect(next.opponent).toBeNull();
        expect(next.mode).toBe("cockatrice");
    });

    it("picking a table and typing a code replace each other", () => {
        const coded = applyChange(joined, { joinCode: "ABC123" }, DECKS);
        expect(coded.joinTableId).toBeNull();
        expect(coded.joinTableFormat).toBeNull();
        expect(effectiveMatchFormat(coded)).toBe("freeform");
        const back = applyChange(
            coded,
            { joinTableId: "t2", joinTableFormat: "old-school" },
            DECKS
        );
        expect(back.joinCode).toBeNull();
        expect(effectiveMatchFormat(back)).toBe("old-school");
    });

    it("leaving Join or Arena drops the code", () => {
        const coded = applyChange(joined, { joinCode: "ABC123" }, DECKS);
        expect(
            applyChange(coded, { opponent: "solo" }, DECKS).joinCode
        ).toBeNull();
    });

    it("Join by code: joinGameByCode with the code and the joiner's deck", () => {
        const req = startRequest(
            setup({
                mode: "arena",
                opponent: "join",
                joinCode: "ABC123",
                myDeckId: "burn",
            }),
            DECKS,
            "Filo"
        );
        expect(req).toMatchObject({
            mutation: "joinGameByCode",
            seat: "own",
            args: { code: "ABC123", deck: { id: "burn" } },
        });
    });

    it("Join in Cockatrice: joinManualGame", () => {
        const req = startRequest(
            setup({
                mode: "cockatrice",
                opponent: "join",
                joinTableId: "t1",
                myDeckId: "pile",
            }),
            DECKS,
            "Filo"
        );
        expect(req).toMatchObject({ mutation: "joinManualGame" });
    });

    it("tablesForMode keeps one game mode's tables", () => {
        const rows = [{ id: 1 }, { id: 2, mode: "manual" as const }];
        expect(tablesForMode(rows, "arena")).toEqual([{ id: 1 }]);
        expect(tablesForMode(rows, "cockatrice")).toEqual([
            { id: 2, mode: "manual" },
        ]);
        expect(tablesForMode(rows, null)).toEqual([]);
    });
});

describe("reconcileSetup — a remembered setup made true of today", () => {
    const JOIN = setup({
        mode: "arena",
        opponent: "join",
        joinTableId: "table-1",
        joinTableFormat: "premodern",
        myDeckId: "burn",
    });

    it("keeps a table that is still open", () => {
        expect(reconcileSetup(JOIN, DECKS, [{ _id: "table-1" }])).toEqual(JOIN);
    });

    it("drops a table that closed since, and the deck it admitted", () => {
        const next = reconcileSetup(JOIN, DECKS, []);
        expect(next.joinTableId).toBeNull();
        expect(next.joinTableFormat).toBeNull();
        expect(next.myDeckId).toBeNull();
    });

    it("drops a deck that was deleted", () => {
        expect(reconcileSetup(READY_BOT, [atog], []).myDeckId).toBeNull();
    });
});

describe("Bot deck default by Limited Origin (issue #5394, ADR 0153)", () => {
    const limited = (id: string, limitedOrigin?: string) =>
        deck({
            kind: "user",
            presetId: id,
            name: id,
            format: "limited",
            limitedOrigin,
        });
    const cubeA = limited("cube-a", "draft:cube:vintage");
    const cubeB = limited("cube-b", "draft:cube:vintage");
    const alpha = limited("alpha", "sealed:lea");
    const legacy = limited("legacy");
    const LIMITED_DECKS = [cubeA, alpha, cubeB, legacy];
    const base = setup({
        mode: "arena",
        opponent: "bot",
        matchFormat: "limited",
    });

    it("picking a deck defaults the Bot to another deck of the same origin", () => {
        const next = applyChange(base, { myDeckId: "cube-a" }, LIMITED_DECKS);
        expect(next.opponentDeckId).toBe("cube-b");
        expect(next.opponentDeckChosen).toBe(true);
    });

    it("keeps Mirror when no other deck shares the origin, or the deck has none", () => {
        for (const mine of ["alpha", "legacy"]) {
            const next = applyChange(base, { myDeckId: mine }, LIMITED_DECKS);
            expect(next.opponentDeckId).toBeNull();
            expect(next.opponentDeckChosen).toBe(true);
        }
    });

    it("re-defaults when the player's deck changes, but never overrides a hand pick", () => {
        const first = applyChange(base, { myDeckId: "cube-a" }, LIMITED_DECKS);
        const moved = applyChange(first, { myDeckId: "alpha" }, LIMITED_DECKS);
        expect(moved.opponentDeckId).toBeNull();
        const picked = applyChange(
            first,
            { opponentDeckId: "legacy" },
            LIMITED_DECKS
        );
        const changed = applyChange(
            picked,
            { myDeckId: "alpha" },
            LIMITED_DECKS
        );
        expect(changed.opponentDeckId).toBe("legacy");
    });

    it("a cross-origin Bot deck stays choosable", () => {
        const first = applyChange(base, { myDeckId: "cube-a" }, LIMITED_DECKS);
        const cross = applyChange(
            first,
            { opponentDeckId: "alpha", opponentDeckChosen: true },
            LIMITED_DECKS
        );
        expect(cross.opponentDeckId).toBe("alpha");
    });

    it("applies to the Bot under Limited only", () => {
        const mine = { myDeckId: "cube-a" };
        expect(
            defaultBotDeckId(
                { ...base, ...mine, opponent: "solo" },
                LIMITED_DECKS
            )
        ).toBeNull();
        expect(defaultBotDeckId({ ...base, ...mine }, LIMITED_DECKS)).toBe(
            "cube-b"
        );
    });
});

describe("another player's archived deck (issue #8411, ADR 0106 §4)", () => {
    const archived = deck({
        kind: "user",
        userDeckId: "row-1",
        presetId: "row-1",
        name: "Alice's Sealed",
        format: "limited",
        ownerNickname: "Alice",
    } as Partial<LobbyDeck>);
    const decks = [...DECKS, archived];
    const seated = setup({
        mode: "arena",
        opponent: "bot",
        matchFormat: "freeform",
        myDeckId: "row-1",
        opponentDeckId: null,
        opponentDeckChosen: true,
    });

    it("is offered only where createSoloGame seats it: Arena, Bot or Solo, Freeform", () => {
        expect(archivedDecksOffered(seated)).toBe(true);
        expect(archivedDecksOffered({ ...seated, opponent: "solo" })).toBe(
            true
        );
        for (const opponent of ["host", "join"] as const) {
            expect(archivedDecksOffered({ ...seated, opponent })).toBe(false);
        }
        expect(
            archivedDecksOffered({ ...seated, matchFormat: "premodern" })
        ).toBe(false);
        expect(archivedDecksOffered({ ...seated, mode: "cockatrice" })).toBe(
            false
        );
    });

    it("Start names its row, so the server can seat the row", () => {
        const request = startRequest(seated, decks, "Root");
        expect(request?.mutation).toBe("createSoloGame");
        expect(request?.args.deck.userDeckId).toBe("row-1");
    });

    it("leaving Bot or Solo drops it, though the deck list still holds it", () => {
        const next = applyChange(seated, { opponent: "host" }, decks);
        expect(next.myDeckId).toBeNull();
    });

    it("leaving Freeform drops it", () => {
        const next = applyChange(seated, { matchFormat: "premodern" }, decks);
        expect(next.myDeckId).toBeNull();
    });

    it("is not counted among the player's decks a Match Format admits", () => {
        const count = (list: readonly LobbyDeck[]) =>
            matchFormatOptions(list).find((o) => o.format === "freeform")
                ?.admitted;
        expect(count(decks)).toBe(count(DECKS));
    });
});

describe("Match Clock (issue #2308)", () => {
    const NICK = "Filo";
    const host = { ...READY_BOT, opponent: "host" as const };

    it("is offered against another player or the Bot, never solo, a joined table or Tabletop", () => {
        expect(clockOffered(host)).toBe(true);
        expect(clockOffered(READY_BOT)).toBe(true);
        expect(clockOffered({ ...READY_BOT, opponent: "solo" })).toBe(false);
        expect(clockOffered({ ...READY_BOT, opponent: "join" })).toBe(false);
        expect(clockOffered({ ...host, mode: "cockatrice" })).toBe(false);
    });

    it("defaults on against a player, off against the Bot; 15' Bo1, 25' Bo3", () => {
        expect(effectiveClock(host)).toEqual({ on: true, minutes: 25 });
        expect(effectiveClock({ ...host, gamesFormat: 1 })).toEqual({
            on: true,
            minutes: 15,
        });
        expect(effectiveClock(READY_BOT)).toEqual({ on: false, minutes: 25 });
        expect(effectiveClock({ ...READY_BOT, opponent: "solo" })).toBeNull();
    });

    it("Start sends the minutes only while the clock is on", () => {
        expect(startRequest(host, DECKS, NICK)?.args).toMatchObject({
            clockMinutes: 25,
        });
        expect(startRequest(READY_BOT, DECKS, NICK)?.args).not.toHaveProperty(
            "clockMinutes"
        );
        expect(
            startRequest(
                { ...READY_BOT, clockOn: true, clockMinutes: 40 },
                DECKS,
                NICK
            )?.args
        ).toMatchObject({ vsAi: true, clockMinutes: 40 });
        expect(
            startRequest({ ...host, clockOn: false }, DECKS, NICK)?.args
        ).not.toHaveProperty("clockMinutes");
        expect(
            startRequest(
                { ...READY_BOT, opponent: "solo", clockOn: true },
                DECKS,
                NICK
            )?.args
        ).not.toHaveProperty("clockMinutes");
    });

    it("a new opponent or Games Format re-defaults what was not set in that change", () => {
        const toggled = applyChange(host, { clockOn: false }, DECKS);
        expect(applyChange(toggled, { opponent: "bot" }, DECKS).clockOn).toBe(
            null
        );
        const custom = applyChange(host, { clockMinutes: 40 }, DECKS);
        expect(
            applyChange(custom, { gamesFormat: 1 }, DECKS).clockMinutes
        ).toBe(null);
        expect(
            applyChange(custom, { myDeckId: "burn" }, DECKS).clockMinutes
        ).toBe(40);
    });

    it("round-trips through storage, dropping an out-of-bounds value", () => {
        expect(
            parseSetup(
                JSON.stringify({ ...host, clockOn: false, clockMinutes: 30 })
            )
        ).toMatchObject({ clockOn: false, clockMinutes: 30 });
        expect(
            parseSetup(
                JSON.stringify({ ...host, clockOn: "yes", clockMinutes: 999 })
            )
        ).toMatchObject({ clockOn: null, clockMinutes: null });
    });

    it("the recap names the clock while it is on", () => {
        const format = (s: MatchSetup) =>
            setupSteps(s, DECKS).find((st) => st.key === "format")?.answer;
        expect(format(host)).toBe("Premodern · Bo3 · 25' clock");
        expect(format(READY_BOT)).toBe("Premodern · Bo3");
    });
});
