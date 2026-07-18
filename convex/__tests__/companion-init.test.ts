// Integration: companion auto-declare at game init (CR 702.139c, ADR 0064,
// issue #1391). Exercises `buildInitialGameState` (game.ts) — the single
// choke point shared by BOTH `chooseFirstPlayer` (Game 1) and
// `buildNextGameForMatch` (Bo3 Game 2+) — and `buildNextGameSeats`
// (matches.ts), the seat builder that must thread the Match's current
// SIDEBOARD through so a Bo3 rematch re-scans post-sideboard.
import { describe, it, expect } from "vitest";
import { buildInitialGameState, type PlayerInput } from "../game";
import { buildNextGameSeats, type MatchPlayer } from "../matches";
import { getCardByName } from "../cards";
import { lutri } from "../cards/sets/iko/multicolor";

const MOUNTAIN = getCardByName("Mountain").id;
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id;
const SAVANNAH_LIONS = getCardByName("Savannah Lions").id;

function deckCard(cardId: string): { cardId: string; cardName: string } {
    return { cardId, cardName: cardId };
}

describe("companion auto-declare at game init (buildInitialGameState)", () => {
    it("auto-declares Lutri into the slot when the sideboard carries it and the maindeck is singleton", () => {
        const player: PlayerInput = {
            id: "p1",
            name: "P1",
            bgColor: "#f00",
            deck: {
                id: "d1",
                name: "Deck",
                format: "vintage-cube",
                cards: [
                    deckCard(MOUNTAIN),
                    deckCard(MOUNTAIN),
                    deckCard(LIGHTNING_BOLT),
                    deckCard(SAVANNAH_LIONS),
                ],
                sideboard: [deckCard(lutri.id)],
            },
        };
        const opponent: PlayerInput = {
            id: "p2",
            name: "P2",
            bgColor: "#00f",
            deck: {
                id: "d2",
                name: "Deck2",
                format: "vintage-cube",
                cards: [deckCard(MOUNTAIN)],
                sideboard: [],
            },
        };
        const state = buildInitialGameState([player, opponent]);
        const companion = state.players[0].companion;
        expect(companion).toBeDefined();
        expect((companion!.instance.card as { id: string }).id).toBe(lutri.id);
        expect(companion!.used).toBe(false);
        // The opponent declared no sideboard companion.
        expect(state.players[1].companion).toBeUndefined();
    });

    it("does not declare a companion when the maindeck fails the condition", () => {
        const player: PlayerInput = {
            id: "p1",
            name: "P1",
            bgColor: "#f00",
            deck: {
                id: "d1",
                name: "Deck",
                format: "vintage-cube",
                // Two copies of a nonland card — fails Lutri's Singleton.
                cards: [deckCard(LIGHTNING_BOLT), deckCard(LIGHTNING_BOLT)],
                sideboard: [deckCard(lutri.id)],
            },
        };
        const state = buildInitialGameState([
            player,
            {
                id: "p2",
                name: "P2",
                bgColor: "#00f",
                deck: {
                    id: "d2",
                    name: "D2",
                    format: "vintage-cube",
                    cards: [],
                },
            },
        ]);
        expect(state.players[0].companion).toBeUndefined();
    });

    it("declares no companion when the sideboard is absent/empty", () => {
        const player: PlayerInput = {
            id: "p1",
            name: "P1",
            bgColor: "#f00",
            deck: {
                id: "d1",
                name: "Deck",
                format: "vintage-cube",
                cards: [deckCard(MOUNTAIN)],
            },
        };
        const state = buildInitialGameState([
            player,
            {
                id: "p2",
                name: "P2",
                bgColor: "#00f",
                deck: {
                    id: "d2",
                    name: "D2",
                    format: "vintage-cube",
                    cards: [],
                },
            },
        ]);
        expect(state.players[0].companion).toBeUndefined();
    });
});

describe("Bo3 re-scan — sideboard threading (matches.ts buildNextGameSeats)", () => {
    it("carries the Match's CURRENT sideboard onto each rebuilt Game's seat", () => {
        const matchPlayer: MatchPlayer = {
            id: "p1",
            name: "P1",
            bgColor: "#f00",
            deck: {
                id: "d1",
                name: "Deck",
                format: "vintage-cube",
                maindeck: [deckCard(MOUNTAIN), deckCard(LIGHTNING_BOLT)],
                sideboard: [deckCard(lutri.id)],
            },
            score: 0,
            ready: false,
        };
        const seats = buildNextGameSeats({ players: [matchPlayer] });
        expect(seats[0].deck.sideboard).toEqual([deckCard(lutri.id)]);
        expect(seats[0].deck.cards).toEqual([
            deckCard(MOUNTAIN),
            deckCard(LIGHTNING_BOLT),
        ]);

        // Feeding the rebuilt seat straight into buildInitialGameState
        // re-declares the companion for the next Game (post-sideboard).
        const state = buildInitialGameState([
            {
                id: seats[0].id,
                name: seats[0].name,
                bgColor: seats[0].bgColor,
                deck: {
                    id: seats[0].deck.id,
                    name: seats[0].deck.name,
                    format: seats[0].deck.format,
                    cards: seats[0].deck.cards,
                    sideboard: seats[0].deck.sideboard,
                },
            },
            {
                id: "p2",
                name: "P2",
                bgColor: "#00f",
                deck: {
                    id: "d2",
                    name: "D2",
                    format: "vintage-cube",
                    cards: [],
                },
            },
        ]);
        expect(
            (state.players[0].companion?.instance.card as { id: string })?.id
        ).toBe(lutri.id);
    });
});
