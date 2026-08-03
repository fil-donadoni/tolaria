// state-adapter (issue #110): the bot's projected wire view rehydrates into a
// GameState the GRE enumerator can read — hidden zones (library contents,
// a non-viewer's hand) are rebuilt to their wire SIZE with opaque placeholders,
// everything else is preserved.
import { describe, expect, it } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import { getCardByName, tryGetDefinition } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { enumerateMoves, PLACEHOLDER_CARD_ID } from "@convex/gre";
import { projectedToGameState } from "../state-adapter";

const POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function projected(): PublicGameState {
    return {
        seq: 7,
        turn: 3,
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "bot",
        priorityPlayerId: "bot",
        players: [
            {
                id: "bot",
                name: "bot",
                bgColor: "#000",
                life: 20,
                hand: [
                    {
                        id: "h1",
                        card: { id: "x" },
                        legalActions: [],
                    } as never,
                ],
                library: { count: 12 },
                graveyard: [],
                exile: [],
                battlefield: [],
                manaPool: { ...POOL },
            },
            {
                id: "human",
                name: "human",
                bgColor: "#111",
                life: 20,
                // Opponent hand projected as nulls.
                hand: [null, null, null],
                library: { count: 9 },
                graveyard: [],
                exile: [],
                battlefield: [],
                manaPool: { ...POOL },
            },
        ],
        stack: [],
    } as unknown as PublicGameState;
}

describe("projectedToGameState (issue #110)", () => {
    it("keeps the bot's own hand cards", () => {
        const gs = projectedToGameState(projected());
        const bot = gs.players.find((p) => p.id === "bot")!;
        expect(bot.hand).toHaveLength(1);
        expect(bot.hand[0].id).toBe("h1");
    });

    it("rebuilds a nulled opponent hand to its wire LENGTH with placeholders (issue #2006)", () => {
        const gs = projectedToGameState(projected());
        const human = gs.players.find((p) => p.id === "human")!;
        // CR 402.2 — the SIZE of a hand is public information, so the wire
        // `null[]` length must survive the reducer. Dropping it (the pre-#2006
        // behaviour) made every client-side hand-size read return 0.
        expect(human.hand).toHaveLength(3);
        for (const c of human.hand) {
            expect(c.zone).toBe("hand");
            expect(c.ownerId).toBe("human");
            expect(c.controllerId).toBe("human");
            // Opaque: the id resolves to no CardDefinition, so nothing about
            // the opponent's actual cards is invented.
            expect((c.card as { id: string }).id).toBe(PLACEHOLDER_CARD_ID);
            expect(tryGetDefinition((c.card as { id: string }).id)).toBeNull();
        }
        // Hand and library placeholders never collide on instance id.
        const ids = new Set([
            ...human.hand.map((c) => c.id),
            ...human.library.map((c) => c.id),
        ]);
        expect(ids.size).toBe(human.hand.length + human.library.length);
    });

    it("never surfaces a rehydrated opponent-hand placeholder as a legal move", () => {
        const p = projected();
        // Hand the opponent priority in their own main phase — enumeration
        // would otherwise return nothing at all and prove nothing.
        p.activePlayerId = "human";
        p.priorityPlayerId = "human";
        const gs = projectedToGameState(p);
        // The padded hand must not become castable/enumerable: the padding
        // restores a COUNT, never an actionable card.
        expect(enumerateMoves(gs, "human")).toEqual([{ kind: "pass" }]);
    });

    it("rebuilds each library to its wire count with placeholders (issue #136)", () => {
        const gs = projectedToGameState(projected());
        const bot = gs.players.find((p) => p.id === "bot")!;
        const human = gs.players.find((p) => p.id === "human")!;
        expect(bot.library).toHaveLength(12);
        expect(human.library).toHaveLength(9);
        for (const p of gs.players) {
            for (const c of p.library) {
                expect(c.zone).toBe("library");
                expect(c.ownerId).toBe(p.id);
                // Opaque: the id resolves to no CardDefinition.
                expect(
                    (c.card as { id: string }).id === PLACEHOLDER_CARD_ID
                ).toBe(true);
                expect(
                    tryGetDefinition((c.card as { id: string }).id)
                ).toBeNull();
            }
        }
    });

    it("keeps an empty wire count as an empty library (deck-out preserved)", () => {
        const p = projected();
        p.players[0].library = { count: 0, known: [] };
        const gs = projectedToGameState(p);
        expect(gs.players.find((x) => x.id === "bot")!.library).toHaveLength(0);
    });

    it("never surfaces a placeholder in hand as a legal move (issue #136)", () => {
        const p = projected();
        // Drop the synthetic 'x' card; leave only an opaque placeholder in hand,
        // as a simulated draw would after pulling one from the library.
        p.players[0].hand = [
            {
                id: "drawn-placeholder",
                card: { id: PLACEHOLDER_CARD_ID },
                zone: "hand",
                ownerId: "bot",
                controllerId: "bot",
                types: [],
                subtypes: [],
                staticAbilities: [],
                isTapped: false,
            } as never,
        ];
        const gs = projectedToGameState(p);
        const moves = enumerateMoves(gs, "bot");
        // Only "pass" — no play-land / cast-spell referencing the placeholder.
        expect(moves).toEqual([{ kind: "pass" }]);
    });

    it("preserves top-level decision fields", () => {
        const gs = projectedToGameState(projected());
        expect(gs.phase).toBe("PRECOMBAT_MAIN");
        expect(gs.priorityPlayerId).toBe("bot");
        expect(gs.activePlayerId).toBe("bot");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CR 401.5 (issue #1095) — the wire's `library.known[]` carries identities the
// projection decided this viewer legitimately sees: a scry-kept top card, or a
// continuously-revealed library top (Goblin Spy). The adapter used to drop the
// channel entirely and rebuild every library from placeholders, so the bot
// searched a top card it can plainly see is something else.
//
// These build the wire view through the REAL `projectPublicState` — a
// hand-written `{ count, known }` fixture would prove the adapter reads a
// fixture, not that the server and the adapter agree.
describe("projectedToGameState — revealed library top (CR 401.5, issue #1095)", () => {
    const SPY = getCardByName("Goblin Spy").id;
    const MOUNTAIN = getCardByName("Mountain").id;
    const FOREST = getCardByName("Forest").id;

    /** `human` controls a Goblin Spy over a stocked library; the wire view is
     *  taken from the BOT's seat, i.e. the opponent's. */
    function botViewOfSpy(withSpy = true): PublicGameState {
        const state = makeState({
            players: [
                makePlayer("bot", {}),
                makePlayer("human", {
                    battlefield: withSpy
                        ? [
                              makeInstance(SPY, {
                                  controllerId: "human",
                                  ownerId: "human",
                                  id: "spy",
                              }),
                          ]
                        : [],
                    library: [MOUNTAIN, FOREST, FOREST].map((cardId, i) =>
                        makeInstance(cardId, {
                            controllerId: "human",
                            ownerId: "human",
                            id: `human-lib-${i}`,
                            zone: "library",
                        })
                    ),
                }),
            ],
        });
        return projectPublicState(state, 1, "bot");
    }

    it("rehydrates the revealed top card as a real instance, not a placeholder", () => {
        const gs = projectedToGameState(botViewOfSpy());
        const humanLib = gs.players.find((p) => p.id === "human")!.library;
        expect(humanLib).toHaveLength(3);
        expect(humanLib[0].card.id).toBe(MOUNTAIN);
        // Characteristics are hydrated so a simulated draw → play reads a
        // fully-formed card, exactly like `makeRealInstance`.
        expect(humanLib[0].types).toContain("Land");
        // Everything BELOW the reveal stays opaque — the reveal is one card.
        expect(humanLib[1].card.id).toBe(PLACEHOLDER_CARD_ID);
        expect(humanLib[2].card.id).toBe(PLACEHOLDER_CARD_ID);
    });

    it("leaves the library fully opaque when nothing is revealed", () => {
        const gs = projectedToGameState(botViewOfSpy(false));
        const humanLib = gs.players.find((p) => p.id === "human")!.library;
        expect(humanLib).toHaveLength(3);
        for (const c of humanLib) {
            expect(c.card.id).toBe(PLACEHOLDER_CARD_ID);
        }
    });

    it("preserves the library COUNT so the deck-out SBA stays exact (CR 704.5b)", () => {
        const gs = projectedToGameState(botViewOfSpy());
        expect(gs.players.find((p) => p.id === "human")!.library).toHaveLength(
            3
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review finding (PR #2111): overlaying a known identity must SWAP, not stamp.
//
// The bot's OWN library is reconstructed from its real decklist
// (`makeRealLibrary`, issue #1509) — a genuine multiset of the cards still in
// the deck, emitted in `Map` insertion order, which has nothing to do with the
// real draw order. Overwriting the slot at a known index therefore DUPLICATES
// whatever the wire revealed and DELETES whatever the reconstruction had put
// there: deck `[Mountain, Forest, Island]` with Island known on top rebuilds as
// `[Island, Forest, Island]` — a phantom Island the bot may "draw", and a
// Mountain it never can. Length is unchanged, so the deck-out SBA count (CR
// 704.5b) still looks right and nothing goes red.
//
// This is NOT Goblin-Spy-specific: it fires for a plain `knownTo` scry with no
// Spy anywhere, i.e. every vs-AI ponder/brainstorm/scry line. The invariant the
// assertions below pin is the one the length check misses — the reconstructed
// library must remain a PERMUTATION of the deck multiset.
describe("projectedToGameState — known-card overlay preserves the deck multiset", () => {
    const MOUNTAIN = getCardByName("Mountain").id;
    const FOREST = getCardByName("Forest").id;
    const ISLAND = getCardByName("Island").id;

    /** Bot deck = one each of Mountain/Forest/Island; the REAL library order is
     *  `[Island, Mountain, Forest]`, deliberately different from the multiset's
     *  insertion order so a stamping overlay corrupts it. `knownIndices` are
     *  stamped `knownTo: ["bot"]` — an ordinary scry, no Goblin Spy involved. */
    function botView(knownIndices: number[]): PublicGameState {
        const order = [ISLAND, MOUNTAIN, FOREST];
        const state = makeState({
            players: [
                makePlayer("bot", {
                    library: order.map((cardId, i) =>
                        makeInstance(cardId, {
                            controllerId: "bot",
                            ownerId: "bot",
                            id: `bot-lib-${i}`,
                            zone: "library",
                            ...(knownIndices.includes(i)
                                ? { knownTo: ["bot"] }
                                : {}),
                        })
                    ),
                }),
                makePlayer("human", {}),
            ],
        });
        return projectPublicState(state, 1, "bot");
    }

    const OWN_DECK = { playerId: "bot", cardIds: [MOUNTAIN, FOREST, ISLAND] };

    const libIds = (state: PublicGameState) =>
        projectedToGameState(state, OWN_DECK)
            .players.find((p) => p.id === "bot")!
            .library.map((c) => c.card.id);

    it("stays a permutation of the deck multiset with the top card known", () => {
        const ids = libIds(botView([0]));
        // The revealed card is where the wire said it is …
        expect(ids[0]).toBe(ISLAND);
        // … and NOTHING was duplicated or lost doing it.
        expect([...ids].sort()).toEqual([...OWN_DECK.cardIds].sort());
    });

    it("stays a permutation with a contiguous run of known cards", () => {
        const ids = libIds(botView([0, 1]));
        expect(ids[0]).toBe(ISLAND);
        expect(ids[1]).toBe(MOUNTAIN);
        expect([...ids].sort()).toEqual([...OWN_DECK.cardIds].sort());
    });

    it("stays a permutation when every position is known", () => {
        const ids = libIds(botView([0, 1, 2]));
        expect(ids).toEqual([ISLAND, MOUNTAIN, FOREST]);
        expect([...ids].sort()).toEqual([...OWN_DECK.cardIds].sort());
    });

    it("is untouched when nothing is known (the pre-existing exact path)", () => {
        const ids = libIds(botView([]));
        expect([...ids].sort()).toEqual([...OWN_DECK.cardIds].sort());
    });
});
