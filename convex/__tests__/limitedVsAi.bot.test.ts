// Auto-Build + vs-AI hookup integration test (issue #1115 AC: "a human can
// start a vs-AI Match selecting a bot seat's deck as opponent, reaching a
// playable board — through public mutations"). The project has no
// convex-test harness (see `convex/__tests__/adminAuth.test.ts`) — this
// drives the EXACT exported pure functions the real mutations call, in the
// same order, against the REAL card registry and the REAL checked-in LEA
// Booster Config, exactly like `convex/__tests__/limitedEvents.test.ts` and
// `convex/__tests__/limitedDeckbuild.test.ts` do for the earlier slices of
// this same pipeline. This file continues the pipeline through Auto-Build
// (`convex/limited/autoBuild.ts`) and BOTH `createSoloGame` legality gates
// (`assertDeckLegal`, `convex/game.ts`) — the human's own Limited deck AND
// the bot seat's Auto-Built deck.
import { describe, it, expect } from "vitest";
import {
    getCardByName,
    getPrintingsForCard,
    resolveDeckCardMeta,
    tryGetDefinition,
} from "../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../cards/colors";
import { assertDeckLegal, type GateDeck } from "../formats";
import { getDefinitionProducibleColors, manaValue } from "../gre/constants";
import { makeRng } from "../gre/rng";
import {
    computeBotAutoBuiltDeck,
    type AutoBuildEventContext,
    type GetAutoBuildCardMeta,
    type ResolveBasicLand,
    type TrueColor,
} from "../limited/autoBuild";
import {
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import {
    assertLimitedSeatOwnership,
    resolvePoolFromEvent,
} from "../limited/poolResolution";
import { getBoosterConfig } from "../limited/registry";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

// The same wiring `convex/limitedEvents.ts` uses for Auto-Build.
const getAutoBuildCardMeta: GetAutoBuildCardMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
        isLand: def.types.includes("Land"),
        isBasicLand:
            def.types.includes("Land") &&
            (def.supertypes?.includes("Basic") ?? false),
    };
};

function resolveBasicLandFor(setCode: string): ResolveBasicLand {
    return (color: TrueColor) => {
        const name = {
            W: "Plains",
            U: "Island",
            B: "Swamp",
            R: "Mountain",
            G: "Forest",
        }[color];
        const def = getCardByName(name);
        const printing = getPrintingsForCard(def.id).find(
            (p) => p.setCode === setCode
        );
        return { cardId: printing?.printId ?? def.id, cardName: name };
    };
}

describe("Auto-Build + vs-AI hookup: sealed event → auto-built bot decks → createSoloGame reaches a playable board (issue #1115)", () => {
    it("every bot seat has an Auto-Built deck the instant the Sealed event starts, and BOTH createSoloGame legality gates accept a human-vs-bot pairing", () => {
        // 1. createLimitedEvent + joinLimitedEvent + startLimitedEvent — a
        // 3-seat Sealed LEA event, one human, two bots (mirrors
        // `limitedDeckbuild.test.ts`'s lifecycle exactly).
        const packSlots = ["lea"];
        let seats = buildEmptySeats(3);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(2026)
        );
        const event = { _id: "vsai-event-1", seats };
        const humanSeat = event.seats.find((s) => s.userId === "user1")!;
        const botSeats = event.seats.filter((s) => s.isBot);
        expect(botSeats).toHaveLength(2);

        // 2. Auto-Build — every bot seat has a deck the instant the Sealed
        // event starts (`status: "started"` — no separate "completion" step
        // for Sealed, PRD #1107 story 24, ADR 0054/0055 decision 3).
        const eventContext: AutoBuildEventContext = {
            type: "sealed",
            status: "started",
        };
        const resolveBasicLand = resolveBasicLandFor(packSlots[0]);
        const botDecks = botSeats.map((seat) => {
            const built = computeBotAutoBuiltDeck(
                seat,
                eventContext,
                getAutoBuildCardMeta,
                resolveBasicLand
            );
            expect(built).not.toBeNull();
            expect(built!.cards.length).toBeGreaterThanOrEqual(40);
            return { seat, built: built! };
        });

        // A human seat never gets an Auto-Built deck (they build their own,
        // issue #1111).
        expect(
            computeBotAutoBuiltDeck(
                humanSeat,
                eventContext,
                getAutoBuildCardMeta,
                resolveBasicLand
            )
        ).toBeNull();

        // 3. Build the human's own Limited deck from their Pool (mirrors
        // `limitedDeckbuild.test.ts` step 2 exactly).
        const nonBasicCards = humanSeat.pool!.filter(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
        );
        const basicCard = humanSeat.pool!.find(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
        )!;
        const mainCount = Math.min(30, nonBasicCards.length);
        const mainFromPool = nonBasicCards.slice(0, mainCount);
        const sideFromPool = nonBasicCards.slice(mainCount);
        const basicsNeeded = Math.max(0, 40 - mainFromPool.length);
        const humanDeck: GateDeck = {
            name: "Alice's Sealed Deck",
            format: "limited",
            cards: [
                ...mainFromPool.map((c) => ({
                    cardId: c.cardId,
                    cardName: c.cardName,
                })),
                ...Array.from({ length: basicsNeeded }, () => ({
                    cardId: basicCard.cardId,
                    cardName: basicCard.cardName,
                })),
            ],
            sideboard: sideFromPool.map((c) => ({
                cardId: c.cardId,
                cardName: c.cardName,
            })),
            limitedEventId: event._id,
            limitedSeatId: String(humanSeat.seatIndex),
        };

        // 4. `loadLimitedPoolResolver`'s ownership gate — the human really
        // owns their own seat (`userDecks.create`'s gate, reused verbatim by
        // the game-start gate per `convex/game.ts`).
        expect(() =>
            assertLimitedSeatOwnership(event, humanDeck.limitedSeatId!, "user1")
        ).not.toThrow();

        // 5. Both `createSoloGame` legality gates — the human's OWN Limited
        // deck (format "limited", pool-scoped) AND the bot's Auto-Built deck
        // (format "freeform" on the wire — it isn't owned by ANY user's own
        // Seat, so it can't carry `limitedEventId`/`limitedSeatId` without
        // tripping the ownership gate; Freeform's validator is a permissive
        // no-op, so the ALREADY pool-legal-by-construction decklist — proven
        // by `autoBuild.test.ts`'s property test — starts cleanly). Neither
        // gate throws: `createSoloGame` would proceed to build both Match
        // seats and the initial Game — "reaches a playable board".
        const humanResolvePool = () =>
            resolvePoolFromEvent(event, humanDeck.limitedSeatId!);
        expect(() =>
            assertDeckLegal(humanDeck, undefined, undefined, humanResolvePool)
        ).not.toThrow();

        for (const { seat, built } of botDecks) {
            const botGateDeck: GateDeck = {
                name: seat.nickname ?? `Bot ${seat.seatIndex + 1}`,
                format: "freeform",
                cards: built.cards,
                sideboard: built.sideboard,
                // Deliberately NO limitedEventId/limitedSeatId — the bot
                // seat has no `userId`, so it can never satisfy the
                // ownership gate a `"limited"`-format deck would trigger.
            };
            expect(() => assertDeckLegal(botGateDeck)).not.toThrow();
        }
    });
});
