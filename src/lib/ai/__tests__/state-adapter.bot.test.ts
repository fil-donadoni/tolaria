// state-adapter (issue #110): the bot's projected wire view rehydrates into a
// GameState the GRE enumerator can read — hidden zones (library contents,
// a non-viewer's hand) are rebuilt to their wire SIZE with opaque placeholders,
// everything else is preserved.
import { describe, expect, it } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import { tryGetDefinition } from "@convex/cards";
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
