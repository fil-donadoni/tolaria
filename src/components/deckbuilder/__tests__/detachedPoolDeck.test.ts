// The detached pool deckbuilder's seed (ADR 0106): a saved deck re-attached to
// its Deck Pool with no Seat in reach, against the real card registry.
import { describe, expect, it } from "vitest";
import {
    arrangementFromDeckLayout,
    detachedZones,
    offPoolEntryIndex,
} from "../detachedPoolDeck";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const bolt = { cardId: BOLT_ID, cardName: "Lightning Bolt" };
const poolBolt = { ...bolt, scryfallId: BOLT_ID };
const poolPlains = {
    cardId: PLAINS_ID,
    cardName: "Plains",
    scryfallId: PLAINS_ID,
};

describe("arrangementFromDeckLayout", () => {
    it("reads the row's Maindeck Pins per Pool copy and drops a key naming no copy", () => {
        expect(
            arrangementFromDeckLayout({
                maindeck: {
                    pins: { "3": { mv: "mv:6" }, [BOLT_ID]: { mv: "mv:2" } },
                },
            })
        ).toEqual([{ poolIndex: 3, pins: { mv: "mv:6" } }]);
        expect(arrangementFromDeckLayout(undefined)).toEqual([]);
    });
});

describe("detachedZones", () => {
    it("re-attaches the pinned copy to the Maindeck after a reload", () => {
        const zones = detachedZones([poolBolt, poolBolt], {
            cards: [bolt],
            sideboard: [bolt],
            layout: { maindeck: { pins: { "1": { mv: "mv:6" } } } },
        });
        expect(zones.cards.map((c) => c.poolIndex)).toEqual([1]);
        expect(zones.sideboard.map((c) => c.poolIndex)).toEqual([0]);
        expect(zones.unplacedCount).toBe(0);
    });

    it("offers every Pool copy the row does not place, in the Sideboard", () => {
        const zones = detachedZones([poolBolt, poolBolt], {
            cards: [bolt],
            sideboard: [],
        });
        expect(zones.sideboard.map((c) => c.poolIndex)).toEqual([1]);
        expect(zones.unplacedCount).toBe(1);
    });

    it("never restores a Pool Basic the row removed: Basics are exempt", () => {
        const zones = detachedZones([poolBolt, poolPlains], {
            cards: [bolt],
            sideboard: [],
        });
        expect(zones.sideboard).toEqual([]);
        expect(zones.unplacedCount).toBe(0);
    });

    it("keeps a card the Pool does not hold, with no Pool copy, so it can be removed", () => {
        const zones = detachedZones([], { cards: [bolt], sideboard: [] });
        expect(zones.cards).toEqual([{ ...bolt, poolIndex: undefined }]);
    });
});

describe("offPoolEntryIndex", () => {
    const pooled = { ...bolt, pinKey: "0" };

    it("finds a keyless non-Basic, whether the gesture names no key or a drag's cardId", () => {
        expect(offPoolEntryIndex([pooled, bolt], BOLT_ID, undefined)).toBe(1);
        expect(offPoolEntryIndex([pooled, bolt], BOLT_ID, BOLT_ID)).toBe(1);
    });

    it("never takes a Pool copy, even a gesture that lost its key", () => {
        expect(offPoolEntryIndex([pooled], BOLT_ID, undefined)).toBe(-1);
        expect(offPoolEntryIndex([pooled, bolt], BOLT_ID, "0")).toBe(-1);
    });

    it("never takes a Basic, which is free in Limited", () => {
        expect(
            offPoolEntryIndex(
                [{ cardId: PLAINS_ID, cardName: "Plains" }],
                PLAINS_ID,
                undefined
            )
        ).toBe(-1);
    });
});
