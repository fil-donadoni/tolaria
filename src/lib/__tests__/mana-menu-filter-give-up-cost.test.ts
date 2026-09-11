// The mana-ability menu's FILTERED give-up affordability gate — CR 118.3 /
// 118.5, issue #3455.
//
// `getManaCostMenuAbility` is the client surface for a `useStack: false`
// ability with no {T}/self-sacrifice component to left-click through (Ashnod's
// Altar's "Sacrifice a creature: Add {C}{C}", Skirge Familiar's "Discard a
// card: Add {B}"). Once the engine could PAY those costs, an unpayable one had
// to withhold the entry rather than dispatch an activation the server parks and
// then rejects — the same contract the `tapOtherFilter` leg already carried.
//
// Driven through the real reducer (`buildTriggerStateView`), never a hand-built
// view: the gate reads the viewer-visible battlefield and hand length, and both
// are fields a reducer can silently drop.

import { describe, it, expect, beforeAll } from "vitest";
import { preloadDefinitions } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import type { CardInstance } from "../../types/game";
import { getManaCostMenuAbility, buildTriggerStateView } from "../card-utils";

const ME = "p1";

/** "Sacrifice a creature: Add {C}{C}." — no {T}, no self-sacrifice. */
const ALTAR: CardDefinition = {
    id: "test-3455-menu-altar",
    name: "Test Menu Altar",
    rarity: "uncommon",
    oracleText: "Sacrifice a creature: Add {C}{C}.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "test-3455-menu-altar-mana",
            oracleText: "Sacrifice a creature: Add {C}{C}.",
            cost: { sacrificeFilter: { types: ["Creature"] } },
            useStack: false,
            manaProduced: { C: 2 },
        },
    ],
};

/** "Sacrifice a Goblin: Add {R}." on a source that IS a Goblin — CR 109.2: a
 *  filter without `excludeSource` admits the source itself, so a blanket
 *  self-exclusion in the gate would hide a legal payment. */
const PROSPECTOR: CardDefinition = {
    id: "test-3455-menu-prospector",
    name: "Test Menu Prospector",
    rarity: "common",
    oracleText: "Sacrifice a Goblin: Add {R}.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "test-3455-menu-prospector-mana",
            oracleText: "Sacrifice a Goblin: Add {R}.",
            cost: { sacrificeFilter: { subtypes: ["Goblin"] } },
            useStack: false,
            manaProduced: { R: 1 },
        },
    ],
};

/** "Discard a card: Add {B}." */
const FAMILIAR: CardDefinition = {
    id: "test-3455-menu-familiar",
    name: "Test Menu Familiar",
    rarity: "rare",
    oracleText: "Discard a card: Add {B}.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Imp"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "test-3455-menu-familiar-mana",
            oracleText: "Discard a card: Add {B}.",
            cost: { discardFilter: { filter: {}, count: 1 } },
            useStack: false,
            manaProduced: { B: 1 },
        },
    ],
};

beforeAll(() => {
    preloadDefinitions([ALTAR, PROSPECTOR, FAMILIAR]);
});

function instance(
    def: CardDefinition,
    id: string,
    extra: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: def.id },
        types: def.types,
        subtypes: def.subtypes ?? [],
        staticAbilities: [],
        controllerId: ME,
        ownerId: ME,
        isTapped: false,
        power: def.power,
        toughness: def.toughness,
        ...extra,
    } as unknown as CardInstance;
}

const viewOf = (battlefield: CardInstance[], handSize: number) =>
    buildTriggerStateView(
        [
            {
                id: ME,
                life: 20,
                hand: Array.from({ length: handSize }, () => ({})),
                battlefield,
            },
            { id: "p2", life: 20, hand: [], battlefield: [] },
        ],
        ME
    );

describe("getManaCostMenuAbility — filtered give-up affordability (issue #3455)", () => {
    it("offers the sacrifice ability when a matching permanent is on the board", () => {
        const source = instance(ALTAR, "source");
        const view = viewOf([source, instance(PROSPECTOR, "goblin")], 0);
        expect(getManaCostMenuAbility(source, view)?.id).toBe(
            "test-3455-menu-altar-mana"
        );
    });

    it("withholds it with no matching permanent — never a doomed dispatch", () => {
        const source = instance(ALTAR, "source");
        expect(getManaCostMenuAbility(source, viewOf([source], 0))).toBeNull();
    });

    it("CR 109.2 — a source that matches its OWN filter pays for itself", () => {
        // Skirk Prospector IS a Goblin and the filter carries no
        // `excludeSource`, so the entry must stay offered on an otherwise
        // empty board.
        const source = instance(PROSPECTOR, "source");
        expect(getManaCostMenuAbility(source, viewOf([source], 0))?.id).toBe(
            "test-3455-menu-prospector-mana"
        );
    });

    it("gates the discard leg on hand size (CR 118.3)", () => {
        const source = instance(FAMILIAR, "source");
        expect(getManaCostMenuAbility(source, viewOf([source], 0))).toBeNull();
        expect(getManaCostMenuAbility(source, viewOf([source], 1))?.id).toBe(
            "test-3455-menu-familiar-mana"
        );
    });

    it("stays offered with no state view at all (the #436 UI-hint convention)", () => {
        expect(getManaCostMenuAbility(instance(ALTAR, "source"))?.id).toBe(
            "test-3455-menu-altar-mana"
        );
    });
});
