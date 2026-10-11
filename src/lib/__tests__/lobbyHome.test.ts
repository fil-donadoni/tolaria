// The lobby home's pure logic (PRD #5334 stories 1–14, issue #5344): Last
// Match readiness and labels, Your Tables rows, the Decks section filter.
import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { LobbyDeck } from "../deckTypes";
import { EMPTY_SETUP, type MatchSetup } from "../matchSetup";
import { homeDecks, lastMatchView, yourTables } from "../lobbyHome";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";

function deck(overrides: Record<string, unknown>): LobbyDeck {
    return {
        kind: "preset",
        presetId: "deck",
        name: "Deck",
        format: "premodern",
        colors: ["R"],
        cards: [{ id: "card-a", cardName: "Lightning Bolt", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as unknown as LobbyDeck;
}

const burn = deck({
    presetId: "burn",
    name: "Burn",
    featuredCardId: "art-burn",
});
const elves = deck({
    presetId: "elves",
    name: "Elves",
    featuredCardId: "art-elves",
    cards: [{ id: "c", cardName: "Llanowar Elves", quantity: 4 }],
});
const mine = deck({
    kind: "user",
    presetId: "mine",
    name: "Solitary Box",
    format: "old-school",
    cards: [{ id: "c", cardName: "Solitary Confinement", quantity: 1 }],
});
const DECKS = [burn, elves, mine];

const setup = (patch: Partial<MatchSetup>): MatchSetup => ({
    ...EMPTY_SETUP,
    ...patch,
});

const BOT = setup({
    mode: "arena",
    opponent: "bot",
    matchFormat: "premodern",
    gamesFormat: 3,
    myDeckId: "burn",
    opponentDeckId: "elves",
    opponentDeckChosen: true,
});

describe("lastMatchView — story 1–3", () => {
    it("names both decks, splits their art and lists the setup", () => {
        expect(lastMatchView(BOT, DECKS)).toEqual({
            title: "Burn vs Elves",
            setupLine: "Arena · Bot · Premodern · Bo3",
            myArt: "art-burn",
            opponentArt: "art-elves",
        });
    });

    it("Mirror shows the player's deck on both sides", () => {
        const view = lastMatchView(
            setup({ ...BOT, opponentDeckId: null }),
            DECKS
        );
        expect(view?.title).toBe("Burn vs Burn");
        expect(view?.opponentArt).toBe("art-burn");
    });

    it("a hosted table has one art: the opponent brings their own deck", () => {
        const view = lastMatchView(
            setup({ ...BOT, opponent: "host", opponentDeckId: null }),
            DECKS
        );
        expect(view?.title).toBe("Burn vs Human");
        expect(view?.setupLine).toBe("Arena · Host a table · Premodern · Bo3");
        expect(view?.opponentArt).toBeUndefined();
    });

    it("is absent while the setup cannot be replayed as is", () => {
        expect(lastMatchView(EMPTY_SETUP, DECKS)).toBeNull();
        expect(
            lastMatchView(setup({ ...BOT, myDeckId: null }), DECKS)
        ).toBeNull();
        // The remembered deck was deleted since.
        expect(lastMatchView(BOT, [elves])).toBeNull();
    });
});

const activeMatch = (
    patch: Partial<Parameters<typeof yourTables>[0] & object>
) => ({
    gameId: "g1" as Id<"games">,
    status: "playing" as const,
    solo: false,
    vsAi: false,
    ...patch,
});

const event = (patch: Partial<LimitedEventSummaryView>) =>
    ({
        _id: "e1",
        type: "draft",
        packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
        status: "started",
        completed: false,
        ...patch,
    }) as LimitedEventSummaryView;

describe("yourTables — stories 6–8", () => {
    it("names a Constructed Match by opponent kind and phase, seat by solo", () => {
        const [bot] = yourTables(activeMatch({ solo: true, vsAi: true }), []);
        expect(bot).toMatchObject({
            kind: "match",
            line: "vs Bot",
            phase: "In progress",
            seat: "p1",
        });
        const [solo] = yourTables(activeMatch({ solo: true }), []);
        expect(solo.line).toBe("Solo");
        const [human] = yourTables(activeMatch({ status: "waiting" }), []);
        expect(human).toMatchObject({
            line: "vs Human",
            phase: "Waiting for an opponent",
            seat: "own",
        });
    });

    it("names a Limited Event by pool and phase, after the Match", () => {
        const rows = yourTables(activeMatch({}), [
            event({}),
            event({
                _id: "e2",
                status: "open",
            } as Partial<LimitedEventSummaryView>),
            event({
                _id: "e3",
                type: "sealed",
                packSlots: ["lea"],
                status: "playing",
            } as Partial<LimitedEventSummaryView>),
        ]);
        expect(rows.map((r) => [r.kind, r.title, r.phase])).toEqual([
            ["match", "Constructed", "In progress"],
            ["event", "Vintage Cube Draft", "Draft"],
            ["event", "Vintage Cube Draft", "Waiting for players"],
            ["event", "Limited Edition Alpha Sealed", "Games"],
        ]);
    });

    it("is empty when the player is seated nowhere", () => {
        expect(yourTables(null, [])).toEqual([]);
    });
});

describe("homeDecks — stories 10–13", () => {
    it("splits own decks from presets", () => {
        const { mine: own, presets } = homeDecks(DECKS, "all", "");
        expect(own.map((e) => e.deck.presetId)).toEqual(["mine"]);
        expect(presets.map((e) => e.deck.presetId)).toEqual(["burn", "elves"]);
    });

    it("narrows by Format", () => {
        const { mine: own, presets } = homeDecks(DECKS, "old-school", "");
        expect(own).toHaveLength(1);
        expect(presets).toHaveLength(0);
    });

    it("finds a deck by a card in it and names the card", () => {
        const { mine: own, presets } = homeDecks(DECKS, "all", "solitary");
        expect(presets).toHaveLength(0);
        expect(own).toEqual([{ deck: mine, matchedCard: null }]);
        const byCard = homeDecks(DECKS, "all", "llanowar");
        expect(byCard.presets).toEqual([
            { deck: elves, matchedCard: "Llanowar Elves" },
        ]);
    });
});
