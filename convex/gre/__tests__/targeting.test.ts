import { describe, it, expect } from "vitest";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type PlayerState,
    type GameState,
    type StackItem,
} from "../state";
import { getLegalTargets } from "../rules";
import type { CardType, TargetRequirement } from "../../cards/types";
import { getCardById } from "../../cards";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const card = overrides.card ?? { name: "Test Card", types: ["Creature"] };
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card,
        types: overrides.types ?? (card.types as CardType[]) ?? [],
        subtypes:
            (overrides.subtypes as string[]) ??
            (card.subtypes as string[]) ??
            [],
        power: overrides.power ?? (card.power as number | undefined),
        toughness:
            overrides.toughness ?? (card.toughness as number | undefined),
        staticAbilities:
            (overrides.staticAbilities as string[]) ??
            (card.staticAbilities as string[]) ??
            [],
        controllerId: overrides.controllerId ?? "p1",
        ownerId: overrides.ownerId ?? "p1",
        zone: overrides.zone ?? "battlefield",
        isTapped: overrides.isTapped ?? false,
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
        bgColor: "#000",
        life: 20,
        deck: {},
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    };
}

// Card fixtures
const CREATURE = { id: "test-creature", name: "Bear", types: ["Creature"] };
const ARTIFACT = { id: "test-artifact", name: "Mox", types: ["Artifact"] };
const ENCHANTMENT = {
    id: "test-enchant",
    name: "Aura",
    types: ["Enchantment"],
};
const LAND = {
    name: "Island",
    types: ["Land"],
    subtypes: ["Island"],
    supertypes: ["Basic"],
};
const ARTIFACT_CREATURE = {
    id: "test-artcreat",
    name: "Golem",
    types: ["Artifact", "Creature"],
};

// ---------------------------------------------------------------------------
// getLegalTargets
// ---------------------------------------------------------------------------

describe("getLegalTargets", () => {
    it("finds creatures for Creature requirement", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({
            id: "mox",
            card: ARTIFACT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2", battlefield: [mox] }),
            ],
        });

        const req: TargetRequirement = { type: "Creature", count: 1 };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(1);
        expect(targets[0]).toEqual({ type: "permanent", id: "bear" });
    });

    it("finds artifacts and enchantments for Disenchant-style requirement", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({ id: "mox", card: ARTIFACT });
        const aura = makeCard({
            id: "aura",
            card: ENCHANTMENT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear, mox] }),
                makePlayer({ id: "p2", battlefield: [aura] }),
            ],
        });

        const req: TargetRequirement = {
            type: ["Artifact", "Enchantment"],
            count: 1,
        };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(2);
        const ids = targets.map((t) => t.id);
        expect(ids).toContain("mox");
        expect(ids).toContain("aura");
        expect(ids).not.toContain("bear");
    });

    it("finds all permanents for 'any' requirement", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({
            id: "mox",
            card: ARTIFACT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2", battlefield: [mox] }),
            ],
        });

        const req: TargetRequirement = { type: "any", count: 1 };
        const targets = getLegalTargets(state, req);

        // 2 permanents + 2 players
        expect(targets).toHaveLength(4);
    });

    it("includes players for 'player' requirement", () => {
        const state = makeGameState();
        const req: TargetRequirement = { type: "player", count: 1 };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(2);
        expect(targets.every((t) => t.type === "player")).toBe(true);
    });

    it("artifact creature matches both Artifact and Creature requirements", () => {
        const golem = makeCard({ id: "golem", card: ARTIFACT_CREATURE });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [golem] }),
                makePlayer({ id: "p2" }),
            ],
        });

        const creatureReq: TargetRequirement = { type: "Creature", count: 1 };
        const artifactReq: TargetRequirement = { type: "Artifact", count: 1 };
        const disenchantReq: TargetRequirement = {
            type: ["Artifact", "Enchantment"],
            count: 1,
        };

        expect(getLegalTargets(state, creatureReq)).toHaveLength(1);
        expect(getLegalTargets(state, artifactReq)).toHaveLength(1);
        expect(getLegalTargets(state, disenchantReq)).toHaveLength(1);
    });

    it("returns empty when no matching permanents exist", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2" }),
            ],
        });

        const req: TargetRequirement = {
            type: ["Artifact", "Enchantment"],
            count: 1,
        };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Mass destruction — destroyAll / destroyAllBySubtype
// ---------------------------------------------------------------------------

describe("mass destruction", () => {
    it("destroyAll('Creature') destroys all creatures on both sides", () => {
        const wrathDef = getCardById("a2788d69-6a3a-42f0-8736-cc6b57755ecd"); // Wrath of God
        const bear1 = makeCard({ id: "b1", card: CREATURE });
        const bear2 = makeCard({
            id: "b2",
            card: CREATURE,
            controllerId: "p2",
            ownerId: "p2",
        });
        const mox = makeCard({ id: "mox", card: ARTIFACT });

        const stackItem: StackItem = {
            ...makeCard({
                id: "wrath",
                card: { id: wrathDef.id, name: "Wrath of God" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear1, mox] }),
                makePlayer({ id: "p2", battlefield: [bear2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1); // mox survives
        expect(getPlayer(state, "p1").battlefield[0].id).toBe("mox");
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(2); // bear1 + wrath
        expect(getPlayer(state, "p2").graveyard).toHaveLength(1); // bear2
    });

    it("destroyAll('Land') destroys all lands (Armageddon)", () => {
        const armaDef = getCardById("5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb"); // Armageddon
        const land1 = makeCard({
            id: "l1",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
        });
        const land2 = makeCard({
            id: "l2",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeCard({ id: "b1", card: CREATURE });

        const stackItem: StackItem = {
            ...makeCard({
                id: "arma",
                card: { id: armaDef.id, name: "Armageddon" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [land1, bear] }),
                makePlayer({ id: "p2", battlefield: [land2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1); // bear survives
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
    });

    it("destroyAll(['Artifact','Creature','Enchantment']) (Nevinyrral's Disk)", () => {
        const diskDef = getCardById("12926dc8-8e6f-4a47-a12b-4d674189615a");
        const ability = diskDef.activatedAbilities![0];

        const disk = makeCard({
            id: "disk",
            card: { id: diskDef.id, name: "Nevinyrral's Disk" },
            types: ["Artifact"],
            isTapped: true,
        });
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({
            id: "mox",
            card: ARTIFACT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeCard({
            id: "aura",
            card: ENCHANTMENT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeCard({
            id: "land",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
        });

        // Ability stack item
        const stackItem: StackItem = {
            ...makeCard({
                id: "disk-ability",
                card: { id: diskDef.id, name: "Nevinyrral's Disk" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
            abilityId: ability.id,
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [disk, bear, land] }),
                makePlayer({ id: "p2", battlefield: [mox, aura] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        // Disk destroys itself (artifact), bear (creature), mox (artifact), aura (enchantment)
        // Land survives
        expect(getPlayer(state, "p1").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p1").battlefield[0].id).toBe("land");
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(2); // disk + bear
        expect(getPlayer(state, "p2").graveyard).toHaveLength(2); // mox + aura
    });

    it("destroyAllBySubtype('Island') destroys only Islands (Tsunami)", () => {
        const tsunamiDef = getCardById("9ed67d61-cf47-446b-b454-eb404a8686b7");

        const island = makeCard({
            id: "island",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
        });
        const plains = makeCard({
            id: "plains",
            types: ["Land"],
            subtypes: ["Plains"],
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
        });

        const stackItem: StackItem = {
            ...makeCard({
                id: "tsunami",
                card: { id: tsunamiDef.id, name: "Tsunami" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [island, plains] }),
                makePlayer({ id: "p2" }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p1").battlefield[0].id).toBe("plains");
    });

    it("destroyAllBySubtype('Plains') destroys only Plains (Flashfires)", () => {
        const flashDef = getCardById("ee8a05a4-0ce3-4abe-bb60-08af53cf08e5");

        const plains1 = makeCard({
            id: "p1-plains",
            types: ["Land"],
            subtypes: ["Plains"],
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
        });
        const mountain = makeCard({
            id: "mountain",
            types: ["Land"],
            subtypes: ["Mountain"],
            card: {
                name: "Mountain",
                types: ["Land"],
                subtypes: ["Mountain"],
            },
            controllerId: "p2",
            ownerId: "p2",
        });
        const plains2 = makeCard({
            id: "p2-plains",
            types: ["Land"],
            subtypes: ["Plains"],
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
            controllerId: "p2",
            ownerId: "p2",
        });

        const stackItem: StackItem = {
            ...makeCard({
                id: "flash",
                card: { id: flashDef.id, name: "Flashfires" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [plains1] }),
                makePlayer({ id: "p2", battlefield: [mountain, plains2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p2").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p2").battlefield[0].id).toBe("mountain");
    });

    it("destroyAll('Enchantment') destroys all enchantments (Tranquility)", () => {
        const tranqDef = getCardById("774cc5a6-3a69-4812-add4-eb5eb6389238");

        const aura1 = makeCard({ id: "e1", card: ENCHANTMENT });
        const aura2 = makeCard({
            id: "e2",
            card: ENCHANTMENT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeCard({ id: "bear", card: CREATURE });

        const stackItem: StackItem = {
            ...makeCard({
                id: "tranq",
                card: { id: tranqDef.id, name: "Tranquility" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [aura1, bear] }),
                makePlayer({ id: "p2", battlefield: [aura2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1); // bear
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// entersTapped
// ---------------------------------------------------------------------------

describe("entersTapped", () => {
    it("Nevinyrral's Disk enters the battlefield tapped", () => {
        const diskDef = getCardById("12926dc8-8e6f-4a47-a12b-4d674189615a");

        const stackItem: StackItem = {
            ...makeCard({
                id: "disk",
                card: { id: diskDef.id, name: "Nevinyrral's Disk" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        const disk = getPlayer(state, "p1").battlefield[0];
        expect(disk.isTapped).toBe(true);
    });

    it("normal artifact enters untapped", () => {
        const moxDef = getCardById("b0e1427c-05cd-465b-be59-97ed6e39f7ba"); // Mox Emerald

        const stackItem: StackItem = {
            ...makeCard({
                id: "mox",
                card: { id: moxDef.id, name: "Mox Emerald" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        const mox = getPlayer(state, "p1").battlefield[0];
        expect(mox.isTapped).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Activated ability on stack
// ---------------------------------------------------------------------------

describe("activated ability stack resolution", () => {
    it("ability resolves without moving source to graveyard", () => {
        const diskDef = getCardById("12926dc8-8e6f-4a47-a12b-4d674189615a");
        const ability = diskDef.activatedAbilities![0];

        // Disk on battlefield (tapped from paying cost)
        const disk = makeCard({
            id: "disk",
            card: { id: diskDef.id, name: "Nevinyrral's Disk" },
            types: ["Artifact"],
            isTapped: true,
        });

        // Ability on stack
        const abilityItem: StackItem = {
            ...makeCard({
                id: "disk-ability",
                card: { id: diskDef.id, name: "Nevinyrral's Disk" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
            abilityId: ability.id,
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [disk] }),
                makePlayer({ id: "p2" }),
            ],
            stack: [abilityItem],
        });

        const resolved = resolveTopOfStack(state);

        // Ability item is returned (not placed anywhere)
        expect(resolved.abilityId).toBe(ability.id);
        // Disk itself was destroyed by its own effect (artifact)
        expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard[0].id).toBe("disk");
    });

    it("sorcery resolves to graveyard (not ability behavior)", () => {
        const wrathDef = getCardById("a2788d69-6a3a-42f0-8736-cc6b57755ecd");

        const stackItem: StackItem = {
            ...makeCard({
                id: "wrath",
                card: { id: wrathDef.id, name: "Wrath of God" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        // Sorcery goes to graveyard
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard[0].id).toBe("wrath");
    });
});
