// Per-card behavior tests for white cards in `convex/cards/sets/uds/white.ts`
// (UDS, split by colour per ADR 0043). Assertions check external behavior only
// (zone changes after resolution).

import { describe, it, expect } from "vitest";
import { replenish } from "..";
import { registerTokenDefinition } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";

// A vanilla enchantment fixture for the graveyard.
const ENCH_ID = "uds-test-enchantment";
registerTokenDefinition({
    id: ENCH_ID,
    name: ENCH_ID,
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
});

// A creature fixture so the enchantment filter has something to exclude.
const CREATURE_ID = "uds-test-noncreature-filtered";
registerTokenDefinition({
    id: CREATURE_ID,
    name: CREATURE_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
});

// An Aura fixture (CR 303.4c) — needs a legal host to enter at all.
const AURA_ID = "uds-test-aura";
registerTokenDefinition({
    id: AURA_ID,
    name: AURA_ID,
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
});

// An enchantment creature — swept by Replenish's Enchantment filter AND a
// legal creature host for the Aura, so it can host an Aura reanimated in the
// SAME simultaneous event (CR 400.7 / 614-batch, issue #1094).
const ENCH_CREATURE_ID = "uds-test-ench-creature";
registerTokenDefinition({
    id: ENCH_CREATURE_ID,
    name: ENCH_CREATURE_ID,
    rarity: "common",
    manaCost: { W: 2 },
    types: ["Enchantment", "Creature"],
    power: 2,
    toughness: 2,
});

const gyEnchant = (id: string) =>
    makeInstance(ENCH_ID, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
const gyCard = (cardId: string, id: string) =>
    makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });

describe("Replenish (CR 404 / 400.7 — bulk graveyard-set move, issue #1056)", () => {
    it("is a {3}{W} sorcery", () => {
        expect(replenish.types).toEqual(["Sorcery"]);
        expect(replenish.manaCost).toEqual({ X: 3, W: 1 });
    });

    it("returns all enchantment cards from your graveyard to the battlefield at once", () => {
        const nonEnch = makeInstance(CREATURE_ID, {
            id: "gy-creature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        gyEnchant("ench-1"),
                        nonEnch,
                        gyEnchant("ench-2"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, replenish.id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[0].battlefield.map((c) => c.id);
        expect(bf).toContain("ench-1");
        expect(bf).toContain("ench-2");
        // Non-enchantment stays; both enchantments left the graveyard.
        expect(
            state.players[0].graveyard.some((c) => c.id === "gy-creature")
        ).toBe(true);
        expect(
            state.players[0].graveyard.some(
                (c) => c.id === "ench-1" || c.id === "ench-2"
            )
        ).toBe(false);

        // Wire format: the returned enchantments survive projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimBf = projected.players[0].battlefield.map((c) => c.id);
        expect(slimBf).toContain("ench-1");
        expect(slimBf).toContain("ench-2");
    });

    it("returns the whole set as ONE simultaneous event — a reanimated Aura attaches to an enchantment-creature returned in the same sweep (CR 400.7 / 614-batch, issue #1094)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        gyCard(AURA_ID, "rep-aura"),
                        gyCard(ENCH_CREATURE_ID, "rep-host"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, replenish.id, "p1");
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.id === "rep-aura"
        );
        expect(
            state.players[0].battlefield.some((c) => c.id === "rep-host")
        ).toBe(true);
        expect(aura?.attachedTo).toBe("rep-host");

        // Wire format: the attachment survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimAura = projected.players[0].battlefield.find(
            (c) => c.id === "rep-aura"
        );
        expect(slimAura?.attachedTo).toBe("rep-host");
    });

    it("an Aura with no legal host stays in the graveyard (CR 303.4c, issue #1094)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [gyCard(AURA_ID, "rep-orphan")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, replenish.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "rep-orphan")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "rep-orphan")
        ).toBe(true);
    });
});
