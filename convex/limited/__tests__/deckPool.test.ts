// Deck Pool (ADR 0106): the pure write-vs-skip decision, the backfill planner,
// and legality judged through `limitedValidate` against an injected Deck Pool.
import { describe, expect, it } from "vitest";

import type { DeckCardMeta } from "../../cards";
import type { ResolveCard } from "../../formats";
import { deckPoolNeedsWrite, planDeckPoolBackfill } from "../deckPool";
import type { LimitedPoolCard } from "../eventTypes";
import { resolveLimitedDeckLegality } from "../poolResolution";

const card = (id: string): LimitedPoolCard => ({
    scryfallId: `print-${id}`,
    cardId: id,
    cardName: id,
});

describe("deckPoolNeedsWrite — identical-payload skip (ADR 0106 §1)", () => {
    it("writes when no Deck Pool is stored yet", () => {
        expect(deckPoolNeedsWrite(null, [card("bolt")])).toBe(true);
    });

    it("skips a payload identical to the stored one, whatever its key order", () => {
        const stored = [card("bolt"), card("giant")];
        const next = stored.map((c) => ({
            cardName: c.cardName,
            cardId: c.cardId,
            scryfallId: c.scryfallId,
        }));
        expect(deckPoolNeedsWrite(stored, next)).toBe(false);
    });

    it("writes when the Pool grew (a Draft pick since the last save)", () => {
        expect(
            deckPoolNeedsWrite([card("bolt")], [card("bolt"), card("giant")])
        ).toBe(true);
    });

    it("writes when an entry changed or moved", () => {
        expect(deckPoolNeedsWrite([card("bolt")], [card("giant")])).toBe(true);
        expect(
            deckPoolNeedsWrite(
                [card("bolt"), card("giant")],
                [card("giant"), card("bolt")]
            )
        ).toBe(true);
    });
});

describe("planDeckPoolBackfill — classifying legacy limited decks (ADR 0106 §8)", () => {
    it("backfills a recoverable deck, leaves one with a Deck Pool, reports the rest", () => {
        const plan = planDeckPoolBackfill([
            {
                deckId: "recoverable",
                hasDeckPool: false,
                seatPool: [card("a")],
            },
            { deckId: "present", hasDeckPool: true, seatPool: [card("a")] },
            { deckId: "present-orphan", hasDeckPool: true, seatPool: null },
            { deckId: "lost", hasDeckPool: false, seatPool: null },
        ]);
        expect(plan).toEqual({
            backfill: [{ deckId: "recoverable", pool: [card("a")] }],
            present: ["present", "present-orphan"],
            unrecoverable: ["lost"],
        });
    });
});

describe("Limited legality against an injected Deck Pool (limitedValidate)", () => {
    const REGISTRY: Record<string, DeckCardMeta> = {
        bolt: {
            cardId: "bolt",
            setCode: "lea",
            rarity: "common",
            isBasic: false,
        },
        giant: {
            cardId: "giant",
            setCode: "lea",
            rarity: "common",
            isBasic: false,
        },
        mountain: {
            cardId: "mountain",
            setCode: "lea",
            rarity: "common",
            isBasic: true,
        },
    };
    const resolve: ResolveCard = (id) => REGISTRY[id] ?? null;
    const entry = (id: string) => ({ cardId: id, cardName: id });
    const deck = {
        cards: [
            entry("bolt"),
            ...Array.from({ length: 39 }, () => entry("mountain")),
        ],
        sideboard: [entry("giant")],
    };

    it("is legal when the Deck Pool accounts for every non-basic card", () => {
        const legality = resolveLimitedDeckLegality(
            deck,
            [card("bolt"), card("giant")],
            resolve
        );
        expect(legality).toEqual({ isLegal: true, reasons: [] });
    });

    it("rejects a card the Deck Pool never granted", () => {
        const legality = resolveLimitedDeckLegality(
            deck,
            [card("bolt")],
            resolve
        );
        expect(legality.reasons.map((r) => r.code)).toContain(
            "pool-not-granted"
        );
    });

    it("is pool-unresolved, never a pass, without a Deck Pool", () => {
        const legality = resolveLimitedDeckLegality(deck, null, resolve);
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons.map((r) => r.code)).toContain(
            "pool-unresolved"
        );
    });
});
