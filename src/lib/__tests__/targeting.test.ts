import { describe, it, expect } from "vitest";
import { isUntargetableByPending } from "../targeting";
import type { CardInstance, Player } from "~/types/game";

// Client mirror of the server `cantBeTargeted` gate (#382, CR 702.18 / 611 /
// 113.3 / 109.5). When `isUntargetableByPending` returns true the battlefield
// click gate (useBattlefieldInteraction / useBattlefieldVisualState) greys the
// card and never fires `selectTarget` — so a shrouded permanent reads as
// un-clickable. These tests pin that the client derives the same answer the
// server does, including across the spell-vs-ability and Aura-spell axes.

// Real shipped C6 card ids (registry-resolved by id, like the server).
const JASMINE_BOREAL = "db6ef678-4ce9-48d6-aa4f-2afd9a1ad724"; // vanilla creature
const SPECTRAL_CLOAK = "7524fd0d-a675-41d6-bc99-bd3ba336893b";
const ANTI_MAGIC_AURA = "ff78eef1-efaa-4a12-bf5d-fec83c14aff8";
const BARTEL_RUNEAXE = "f1a42691-98bb-4234-9b56-085e6677f3e4";

function inst(
    overrides: Partial<CardInstance> & { card: { id: string } }
): CardInstance {
    return {
        id: overrides.id ?? "inst",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
        subtypes: [],
        ...overrides,
    };
}

function player(overrides: Partial<Player> & { id: string }): Player {
    return {
        name: overrides.id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    } as Player;
}

describe("isUntargetableByPending — Spectral Cloak (CR 702.18)", () => {
    function board(bearTapped: boolean): Player[] {
        const bear = inst({
            id: "bear",
            card: { id: JASMINE_BOREAL },
            isTapped: bearTapped,
        });
        const cloak = inst({
            id: "cloak",
            card: { id: SPECTRAL_CLOAK },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            attachedTo: "bear",
        });
        const spell = inst({
            id: "spell",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        return [
            player({ id: "p1", battlefield: [bear, cloak], hand: [spell] }),
            player({ id: "p2" }),
        ];
    }

    it("marks the untapped cloaked creature as not clickable", () => {
        const players = board(false);
        const bear = players[0].battlefield[0];
        expect(isUntargetableByPending(players, bear, "spell", "cast")).toBe(
            true
        );
    });

    it("becomes clickable again once the host taps", () => {
        const players = board(true);
        const bear = players[0].battlefield[0];
        expect(isUntargetableByPending(players, bear, "spell", "cast")).toBe(
            false
        );
    });
});

describe("isUntargetableByPending — Anti-Magic Aura (CR 113.3)", () => {
    function board(): Player[] {
        const bear = inst({ id: "bear", card: { id: JASMINE_BOREAL } });
        const aura = inst({
            id: "aura",
            card: { id: ANTI_MAGIC_AURA },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            attachedTo: "bear",
        });
        const spell = inst({
            id: "spell",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        const tim = inst({ id: "tim", card: { id: JASMINE_BOREAL } });
        return [
            player({
                id: "p1",
                battlefield: [bear, aura, tim],
                hand: [spell],
            }),
            player({ id: "p2" }),
        ];
    }

    it("not clickable for a spell source", () => {
        const players = board();
        const bear = players[0].battlefield[0];
        expect(isUntargetableByPending(players, bear, "spell", "cast")).toBe(
            true
        );
    });

    it("clickable for an ability source (CR 113.3 — spells only)", () => {
        const players = board();
        const bear = players[0].battlefield[0];
        // Ability source = a battlefield permanent ("tim").
        expect(isUntargetableByPending(players, bear, "tim", "ability")).toBe(
            false
        );
    });
});

describe("isUntargetableByPending — Bartel Runeaxe (CR 109.5)", () => {
    function board(): Player[] {
        const bartel = inst({
            id: "bartel",
            card: { id: BARTEL_RUNEAXE },
        });
        const auraSpell = inst({
            id: "aura-spell",
            card: { id: ANTI_MAGIC_AURA },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            zone: "hand",
        });
        const boltSpell = inst({
            id: "bolt",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        return [
            player({
                id: "p1",
                battlefield: [bartel],
                hand: [auraSpell, boltSpell],
            }),
            player({ id: "p2" }),
        ];
    }

    it("not clickable for an Aura spell", () => {
        const players = board();
        const bartel = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, bartel, "aura-spell", "cast")
        ).toBe(true);
    });

    it("clickable for a non-Aura spell", () => {
        const players = board();
        const bartel = players[0].battlefield[0];
        expect(isUntargetableByPending(players, bartel, "bolt", "cast")).toBe(
            false
        );
    });
});
