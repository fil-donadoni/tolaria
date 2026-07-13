import { describe, it, expect, beforeAll } from "vitest";
import {
    isUntargetableByPending,
    isPlayerUntargetableByPending,
} from "../targeting";
import type { CardInstance, Player } from "~/types/game";
import { registerTokenDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";

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
const SYLVAN_CARYATID = "d40b65c1-b24d-492d-81b9-d8474ebdc08c"; // hexproof

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

// CR 702.11b — hexproof is controller-relative: an opponent's targeted spell
// greys the permanent (not clickable), but the controller's own does not.
// #958. The 5th arg to isUntargetableByPending is the source's controller (the
// chooser = pendingTarget.playerId), threaded by both battlefield click gates.
describe("isUntargetableByPending — Sylvan Caryatid hexproof (CR 702.11b)", () => {
    function board(): Player[] {
        // p1 controls the hexproof Caryatid. staticAbilities mirror the wire
        // projection (the server ships the effective keyword array on the card).
        const caryatid = inst({
            id: "caryatid",
            card: { id: SYLVAN_CARYATID },
            types: ["Creature"],
            subtypes: ["Plant"],
            staticAbilities: ["defender", "hexproof"],
        });
        // p1's own bolt (in p1's hand) and p2's bolt (in p2's hand).
        const ownBolt = inst({
            id: "own-bolt",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        const oppBolt = inst({
            id: "opp-bolt",
            card: { id: JASMINE_BOREAL },
            zone: "hand",
        });
        return [
            player({ id: "p1", battlefield: [caryatid], hand: [ownBolt] }),
            player({ id: "p2", hand: [oppBolt] }),
        ];
    }

    it("not clickable for an opponent's targeted spell (source controller = p2)", () => {
        const players = board();
        const caryatid = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, caryatid, "opp-bolt", "cast", "p2")
        ).toBe(true);
    });

    it("clickable for the controller's own targeted spell (source controller = p1)", () => {
        const players = board();
        const caryatid = players[0].battlefield[0];
        expect(
            isUntargetableByPending(players, caryatid, "own-bolt", "cast", "p1")
        ).toBe(false);
    });
});

// Player-scoped shroud (CR 702.18 applied to a player via CR 115.4, #1128).
// Mirrors the permanent suites above but drives `isPlayerUntargetableByPending`
// — the client mirror of the server's `playerHasShroud` gate — through a
// player nameplate rather than a battlefield card. No shipped card grants
// this yet (Solitary Confinement is the real consumer, blocked-by child of
// #1058); verified here with a fixture permanent registered via
// `registerTokenDefinition`, mirroring the GRE suite's synthetic-card
// pattern ("no real card this slice", per the issue).
const PLAYER_SHROUD_SOURCE_ID = "test-player-shroud-source-client";
const playerShroudFixture: CardDefinition = {
    id: PLAYER_SHROUD_SOURCE_ID,
    name: "Test Player Shroud Source",
    rarity: "common",
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "player-guard",
            id: "test-player-shroud-client",
            cantBeTargeted: true,
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(playerShroudFixture);
});

describe("isPlayerUntargetableByPending — player-scoped shroud (CR 702.18 / 115.4, #1128)", () => {
    function board(): Player[] {
        const source = inst({
            id: "shroud-source",
            card: { id: PLAYER_SHROUD_SOURCE_ID },
            types: ["Enchantment"],
            subtypes: [],
        });
        return [
            player({ id: "p1", battlefield: [source] }),
            player({ id: "p2" }),
        ];
    }

    it("marks the shrouded player's controller as not clickable", () => {
        const players = board();
        expect(isPlayerUntargetableByPending(players, "p1")).toBe(true);
    });

    it("leaves the non-shrouded player clickable (no regression)", () => {
        const players = board();
        expect(isPlayerUntargetableByPending(players, "p2")).toBe(false);
    });
});
