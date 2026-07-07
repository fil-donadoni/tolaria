import { describe, it, expect } from "vitest";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type PlayerState,
    type GameState,
    type StackItem,
} from "../state";
import {
    getLegalTargets,
    getPendingTargetSourceSubtypes,
    matchesBattlefieldController,
    spellMatchesCreaturePtFilter,
    spellMatchesExcludeTypeFilter,
} from "../rules";
import { isGuardedAgainst } from "../permanentGuard";
import type { CardType, TargetRequirement } from "../../cards/types";
import { getDefinition, tryGetDefinition } from "../../cards";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// SLIM card builder. `card.card` always shrinks to `{ id }`, with an optional
// `manaCost` passthrough for synthetic fixtures that need color filtering.
// Runtime fields fall back to the registry def when `id` matches, else to
// the inline cardData fields, else to defaults.
function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const cardRef = overrides.card as
        | {
              id?: string;
              manaCost?: unknown;
              types?: CardType[];
              subtypes?: string[];
              power?: number;
              toughness?: number;
              staticAbilities?: string[];
          }
        | undefined;
    const id = cardRef?.id ?? `synth-${crypto.randomUUID()}`;
    const def = tryGetDefinition(id);
    const cardField: { id: string; manaCost?: unknown } = { id };
    if (cardRef?.manaCost !== undefined) {
        cardField.manaCost = cardRef.manaCost;
    }
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardField,
        types: overrides.types ?? def?.types ?? cardRef?.types ?? [],
        subtypes:
            overrides.subtypes ?? def?.subtypes ?? cardRef?.subtypes ?? [],
        power: overrides.power ?? def?.power ?? cardRef?.power,
        toughness: overrides.toughness ?? def?.toughness ?? cardRef?.toughness,
        staticAbilities:
            overrides.staticAbilities ??
            def?.staticAbilities ??
            cardRef?.staticAbilities ??
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
        rngSeed: 0,
        rngCounter: 0,
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

    // CR 702.11b — hexproof: bars targeting only by the controller's opponents.
    describe("hexproof (CR 702.11b)", () => {
        function boardWithHexproof(): GameState {
            const caryatid = makeCard({
                id: "caryatid",
                card: CREATURE,
                controllerId: "p2",
                ownerId: "p2",
                staticAbilities: ["defender", "hexproof"],
            });
            return makeGameState({
                players: [
                    makePlayer({ id: "p1", battlefield: [] }),
                    makePlayer({ id: "p2", battlefield: [caryatid] }),
                ],
            });
        }
        const req: TargetRequirement = { type: "Creature", count: 1 };

        it("excludes a hexproof permanent from an OPPONENT's source", () => {
            const state = boardWithHexproof();
            const targets = getLegalTargets(state, req, [], "p1");
            expect(targets.map((t) => t.id)).not.toContain("caryatid");
        });

        it("includes it for the controller's OWN source", () => {
            const state = boardWithHexproof();
            const targets = getLegalTargets(state, req, [], "p2");
            expect(targets.map((t) => t.id)).toContain("caryatid");
        });
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

    it("finds only creatures, planeswalkers, battles and players for 'any' requirement (CR 115.4)", () => {
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
        const island = makeCard({
            id: "island",
            card: LAND,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2", battlefield: [mox, aura, island] }),
            ],
        });

        const req: TargetRequirement = { type: "any", count: 1 };
        const targets = getLegalTargets(state, req);

        // Only the creature + 2 players — artifact, enchantment and land are excluded.
        expect(targets).toHaveLength(3);
        const ids = targets.map((t) => t.id);
        expect(ids).toContain("bear");
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
        expect(ids).not.toContain("mox");
        expect(ids).not.toContain("aura");
        expect(ids).not.toContain("island");
    });

    it("includes players for 'player' requirement", () => {
        const state = makeGameState();
        const req: TargetRequirement = { type: "player", count: 1 };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(2);
        expect(targets.every((t) => t.type === "player")).toBe(true);
    });

    it("controller:'opponent' restricts a player target to the opponent (CR 115.1, Word of Command)", () => {
        const state = makeGameState();
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "opponent",
        };
        // From p1's perspective the only legal player target is p2.
        const targets = getLegalTargets(state, req, [], "p1");
        expect(targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("controller:'you' restricts a player target to the caster", () => {
        const state = makeGameState();
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "you",
        };
        const targets = getLegalTargets(state, req, [], "p1");
        expect(targets).toEqual([{ type: "player", id: "p1" }]);
    });

    it("playerAttackedThisTurn filters players to those who attacked (CR 506.2)", () => {
        // p2 controls a creature flagged as having attacked; p1 controls none.
        const attacker = makeCard({
            id: "atk",
            card: CREATURE,
            controllerId: "p2",
            ownerId: "p2",
        });
        attacker.hasAttackedThisTurn = true;
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1" }),
                makePlayer({ id: "p2", battlefield: [attacker] }),
            ],
        });
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            playerAttackedThisTurn: true,
        };
        const targets = getLegalTargets(state, req);
        expect(targets).toEqual([{ type: "player", id: "p2" }]);
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
// Permanent-controller filter (CR 109.3 / 102.1, #904).
//
// `matchesBattlefieldController` is the single authority both `getLegalTargets`
// (offered set) and the `selectTarget` mutation's permanent branch (accepted
// set — the authoritative anti-spoof gate) route through. The project has no
// convex-test harness (ADR 0001), so these tests drive that shared predicate
// directly: it is the exact decision the mutation makes, so exercising it is
// equivalent to exercising the mutation's controller rejection. A negative
// (server rejects a wrong-controller permanent) + positive (accepts the right
// one) is asserted per controller value.
// ---------------------------------------------------------------------------

describe("permanent-controller filter — selectTarget authority (CR 109.3 / 102.1, #904)", () => {
    // chooser = p1, active player = p1, opponent = p2.
    const ACTIVE = "p1";

    describe("controller: 'you' (Simulacrum)", () => {
        it("accepts a permanent the chooser controls", () => {
            expect(
                matchesBattlefieldController("p1", "p1", ACTIVE, "you")
            ).toBe(true);
        });
        it("rejects an opponent's permanent (spoof)", () => {
            expect(
                matchesBattlefieldController("p2", "p1", ACTIVE, "you")
            ).toBe(false);
        });
    });

    describe("controller: 'opponent' (Nettling Imp)", () => {
        it("accepts an opponent's permanent", () => {
            expect(
                matchesBattlefieldController("p2", "p1", ACTIVE, "opponent")
            ).toBe(true);
        });
        it("rejects a permanent the chooser controls (spoof)", () => {
            expect(
                matchesBattlefieldController("p1", "p1", ACTIVE, "opponent")
            ).toBe(false);
        });
        it("rejects when the chooser is unknown (can never be an opponent)", () => {
            expect(
                matchesBattlefieldController(
                    "p2",
                    undefined,
                    ACTIVE,
                    "opponent"
                )
            ).toBe(false);
        });
    });

    describe("controller: 'active' (Arcum's Whistle)", () => {
        it("accepts a permanent the active player controls", () => {
            // Chooser is the non-active player p2; the active player is p1.
            expect(
                matchesBattlefieldController("p1", "p2", ACTIVE, "active")
            ).toBe(true);
        });
        it("rejects a permanent the non-active player controls (spoof)", () => {
            expect(
                matchesBattlefieldController("p2", "p2", ACTIVE, "active")
            ).toBe(false);
        });
    });

    describe("controller: 'any' / undefined", () => {
        it("accepts any controller", () => {
            expect(
                matchesBattlefieldController("p1", "p2", ACTIVE, "any")
            ).toBe(true);
            expect(
                matchesBattlefieldController("p2", "p1", ACTIVE, undefined)
            ).toBe(true);
        });
    });

    // getLegalTargets integration: the offered set honors the same filter, so
    // the client is never shown an illegal target either.
    describe("getLegalTargets honors the controller filter", () => {
        const OWN = makeCard({ id: "own", card: CREATURE, controllerId: "p1" });
        const THEIRS = makeCard({
            id: "theirs",
            card: CREATURE,
            controllerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [OWN] }),
                makePlayer({ id: "p2", battlefield: [THEIRS] }),
            ],
        });

        it("'you' offers only the caster's creature", () => {
            const req: TargetRequirement = {
                type: "Creature",
                count: 1,
                controller: "you",
            };
            const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
            expect(ids).toEqual(["own"]);
        });
        it("'opponent' offers only the opponent's creature", () => {
            const req: TargetRequirement = {
                type: "Creature",
                count: 1,
                controller: "opponent",
            };
            const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
            expect(ids).toEqual(["theirs"]);
        });
        it("'active' offers only the active player's creature (chooser p2)", () => {
            const req: TargetRequirement = {
                type: "Creature",
                count: 1,
                controller: "active",
            };
            const ids = getLegalTargets(state, req, [], "p2").map((t) => t.id);
            expect(ids).toEqual(["own"]); // p1 is active
        });
    });
});

// ---------------------------------------------------------------------------
// Mass destruction — destroyAll (types / subtypes / keyword filters)
// ---------------------------------------------------------------------------

describe("mass destruction", () => {
    it("destroyAll('Creature') destroys all creatures on both sides", () => {
        const wrathDef = getDefinition("a2788d69-6a3a-42f0-8736-cc6b57755ecd"); // Wrath of God
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
        const armaDef = getDefinition("5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb"); // Armageddon
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
        const diskDef = getDefinition("12926dc8-8e6f-4a47-a12b-4d674189615a");
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

    it("destroyAll({ subtypes: 'Island' }) destroys only Islands (Tsunami)", () => {
        const tsunamiDef = getDefinition(
            "9ed67d61-cf47-446b-b454-eb404a8686b7"
        );

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

    it("destroyAll({ subtypes: 'Plains' }) destroys only Plains (Flashfires)", () => {
        const flashDef = getDefinition("ee8a05a4-0ce3-4abe-bb60-08af53cf08e5");

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
        const tranqDef = getDefinition("774cc5a6-3a69-4812-add4-eb5eb6389238");

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
        const diskDef = getDefinition("12926dc8-8e6f-4a47-a12b-4d674189615a");

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
        const moxDef = getDefinition("b0e1427c-05cd-465b-be59-97ed6e39f7ba"); // Mox Emerald

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
        const diskDef = getDefinition("12926dc8-8e6f-4a47-a12b-4d674189615a");
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

        const resolved = resolveTopOfStack(state)!;

        // Ability item is returned (not placed anywhere)
        expect(resolved.abilityId).toBe(ability.id);
        // Disk itself was destroyed by its own effect (artifact)
        expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard[0].id).toBe("disk");
    });

    it("sorcery resolves to graveyard (not ability behavior)", () => {
        const wrathDef = getDefinition("a2788d69-6a3a-42f0-8736-cc6b57755ecd");

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

// ---------------------------------------------------------------------------
// getLegalTargets — spell targets (CR 114.1)
// ---------------------------------------------------------------------------

describe("getLegalTargets: spell targeting (CR 114.1)", () => {
    it("returns all stack items for 'spell' requirement", () => {
        const bolt: StackItem = {
            ...makeCard({
                id: "bolt1",
                card: { name: "Lightning Bolt" },
                types: ["Instant"],
                zone: "stack",
            }),
            castById: "p1",
        };
        const bear: StackItem = {
            ...makeCard({
                id: "bear1",
                card: { name: "Bear" },
                types: ["Creature"],
                zone: "stack",
            }),
            castById: "p2",
        };
        const state = makeGameState({ stack: [bear, bolt] });

        const req: TargetRequirement = { type: "spell", count: 1 };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(2);
        expect(targets.every((t) => t.type === "spell")).toBe(true);
        const ids = targets.map((t) => t.id).sort();
        expect(ids).toEqual(["bear1", "bolt1"]);
    });

    it("returns empty when stack is empty", () => {
        const state = makeGameState({ stack: [] });
        const req: TargetRequirement = { type: "spell", count: 1 };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });

    it("does NOT include permanents or players when only 'spell' is requested", () => {
        const bear = makeCard({
            id: "bear",
            card: CREATURE,
            zone: "battlefield",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2" }),
            ],
            stack: [],
        });
        const req: TargetRequirement = { type: "spell", count: 1 };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// spellExcludeTypeFilter / spellCreaturePtFilter — CR 114.1 (issue #683)
// Spell Pierce ("target noncreature spell") and Stern Scolding ("target
// creature spell with power or toughness 2 or less").
// ---------------------------------------------------------------------------

describe("getLegalTargets: spellExcludeTypeFilter (CR 114.1, Spell Pierce)", () => {
    it("excludes creature spells, keeps every other spell type", () => {
        const bolt: StackItem = {
            ...makeCard({ id: "bolt1", types: ["Instant"] }),
            castById: "p1",
        };
        const bear: StackItem = {
            ...makeCard({ id: "bear1", types: ["Creature"] }),
            castById: "p2",
        };
        const state = makeGameState({ stack: [bear, bolt] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellExcludeTypeFilter: "Creature",
        };
        const targets = getLegalTargets(state, req);
        expect(targets.map((t) => t.id)).toEqual(["bolt1"]);
    });

    it("excludes an activated ability on the stack (it is never a spell)", () => {
        const ability: StackItem = {
            ...makeCard({ id: "ab1", types: ["Artifact"] }),
            castById: "p1",
            abilityId: "some-ability",
        };
        const state = makeGameState({ stack: [ability] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellExcludeTypeFilter: "Creature",
        };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

describe("getLegalTargets: spellCreaturePtFilter (CR 114.1 + 208.2, Stern Scolding)", () => {
    it("keeps creature spells at or under the power-or-toughness threshold", () => {
        const weak: StackItem = {
            ...makeCard({
                id: "weak1",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            }),
            castById: "p1",
        };
        const strong: StackItem = {
            ...makeCard({
                id: "strong1",
                types: ["Creature"],
                power: 4,
                toughness: 4,
            }),
            castById: "p1",
        };
        const state = makeGameState({ stack: [weak, strong] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellTypeFilter: "Creature",
            spellCreaturePtFilter: { maxPowerOrToughness: 2 },
        };
        const targets = getLegalTargets(state, req);
        expect(targets.map((t) => t.id)).toEqual(["weak1"]);
    });

    it("matches on toughness alone (power over the threshold, toughness at it)", () => {
        const lanky: StackItem = {
            ...makeCard({
                id: "lanky1",
                types: ["Creature"],
                power: 5,
                toughness: 2,
            }),
            castById: "p1",
        };
        const state = makeGameState({ stack: [lanky] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellCreaturePtFilter: { maxPowerOrToughness: 2 },
        };
        expect(getLegalTargets(state, req).map((t) => t.id)).toEqual([
            "lanky1",
        ]);
    });

    it("excludes a noncreature spell regardless of power/toughness", () => {
        const bolt: StackItem = {
            ...makeCard({ id: "bolt2", types: ["Instant"] }),
            castById: "p1",
        };
        const state = makeGameState({ stack: [bolt] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellCreaturePtFilter: { maxPowerOrToughness: 2 },
        };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

// Backend integration: `spellMatchesExcludeTypeFilter` /
// `spellMatchesCreaturePtFilter` are the EXACT predicates `selectTarget`
// (game.ts) calls to accept/reject a submitted target, shared with
// `getLegalTargets` above (one predicate, two call sites — same pattern as
// `spellWouldDestroyLandControlledBy` / Equinox). Mirrors that precedent's
// "backend: selectTarget ACCEPTS/REJECTS" shape.
describe("backend: selectTarget spell-filter predicates (issue #683)", () => {
    it("spellMatchesExcludeTypeFilter REJECTS a creature spell, ACCEPTS a noncreature spell", () => {
        const bear: StackItem = {
            ...makeCard({ id: "bear2", types: ["Creature"] }),
            castById: "p1",
        };
        const bolt: StackItem = {
            ...makeCard({ id: "bolt3", types: ["Instant"] }),
            castById: "p1",
        };
        expect(spellMatchesExcludeTypeFilter(bear, ["Creature"])).toBe(false);
        expect(spellMatchesExcludeTypeFilter(bolt, ["Creature"])).toBe(true);
    });

    it("spellMatchesCreaturePtFilter ACCEPTS a small creature spell, REJECTS a big one", () => {
        const small: StackItem = {
            ...makeCard({
                id: "small1",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            }),
            castById: "p1",
        };
        const big: StackItem = {
            ...makeCard({
                id: "big1",
                types: ["Creature"],
                power: 6,
                toughness: 6,
            }),
            castById: "p1",
        };
        expect(
            spellMatchesCreaturePtFilter(small, { maxPowerOrToughness: 2 })
        ).toBe(true);
        expect(
            spellMatchesCreaturePtFilter(big, { maxPowerOrToughness: 2 })
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Counterspell — CR 701.5a
// "Counter target spell."
// ---------------------------------------------------------------------------

import { counterspell, lightningBolt, giantGrowth } from "../../cards/sets/lea";

describe("spell resolution: Counterspell (CR 701.5a)", () => {
    function makeCounterspellItem(
        castBy: string,
        targets: StackItem["targets"]
    ): StackItem {
        return {
            ...makeCard({
                id: crypto.randomUUID(),
                card: {
                    id: counterspell.id,
                    name: counterspell.name,
                    types: counterspell.types,
                },
                types: counterspell.types,
                zone: "stack",
                ownerId: castBy,
                controllerId: castBy,
            }),
            castById: castBy,
            targets,
        };
    }

    function makeBoltItem(castBy: string): StackItem {
        return {
            ...makeCard({
                id: crypto.randomUUID(),
                card: {
                    id: lightningBolt.id,
                    name: lightningBolt.name,
                    types: lightningBolt.types,
                },
                types: lightningBolt.types,
                zone: "stack",
                ownerId: castBy,
                controllerId: castBy,
            }),
            castById: castBy,
            targets: [{ type: "player", id: "p1" }],
        };
    }

    it("counters target spell: target goes to its owner's graveyard (CR 701.5a)", () => {
        const state = makeGameState();
        const bolt = makeBoltItem("p2");
        state.stack.push(bolt);
        const counter = makeCounterspellItem("p1", [
            { type: "spell", id: bolt.id },
        ]);
        state.stack.push(counter);

        resolveTopOfStack(state); // resolve Counterspell (top)

        // Stack is empty after Counterspell resolves
        expect(state.stack).toHaveLength(0);
        // Bolt never resolves — p1 still at 20 life
        expect(getPlayer(state, "p1").life).toBe(20);
        // Bolt goes to its owner's (p2) graveyard
        const p2Grave = getPlayer(state, "p2").graveyard;
        expect(p2Grave).toHaveLength(1);
        expect((p2Grave[0].card as { id: string }).id).toBe(lightningBolt.id);
        // Counterspell goes to its own owner's (p1) graveyard (CR 608.2k)
        const p1Grave = getPlayer(state, "p1").graveyard;
        expect(p1Grave).toHaveLength(1);
        expect((p1Grave[0].card as { id: string }).id).toBe(counterspell.id);
    });

    it("counters a creature spell before it enters the battlefield", () => {
        const state = makeGameState();
        const bearSpell: StackItem = {
            ...makeCard({
                id: "bear-spell",
                card: { name: "Bear", types: ["Creature"] },
                types: ["Creature"],
                zone: "stack",
                ownerId: "p2",
                controllerId: "p2",
            }),
            castById: "p2",
        };
        state.stack.push(bearSpell);
        state.stack.push(
            makeCounterspellItem("p1", [{ type: "spell", id: "bear-spell" }])
        );

        resolveTopOfStack(state);

        // Bear never hits the battlefield
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        // Bear goes to p2's graveyard (not battlefield)
        expect(getPlayer(state, "p2").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p2").graveyard[0].id).toBe("bear-spell");
    });

    it("Counterspell countering Counterspell: double counter", () => {
        const state = makeGameState();
        const bolt = makeBoltItem("p1");
        state.stack.push(bolt); // index 0

        const cs1 = makeCounterspellItem("p2", [
            { type: "spell", id: bolt.id },
        ]);
        state.stack.push(cs1); // index 1: counter the Bolt

        const cs2 = makeCounterspellItem("p1", [{ type: "spell", id: cs1.id }]);
        state.stack.push(cs2); // index 2 (top): counter cs1

        // Resolve cs2 (top) → counters cs1
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(bolt.id);
        // cs1 goes to p2's graveyard; cs2 goes to p1's graveyard
        expect(getPlayer(state, "p2").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);

        // Now resolve bolt → deals 3 to p1
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p1").life).toBe(17);
    });

    it("fizzles silently when target is no longer on stack (CR 608.2b)", () => {
        const state = makeGameState();
        // Counterspell targeting a non-existent id (e.g. already countered)
        const counter = makeCounterspellItem("p1", [
            { type: "spell", id: "ghost-spell" },
        ]);
        state.stack.push(counter);

        resolveTopOfStack(state);

        // No crash; Counterspell still goes to graveyard
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(
            (getPlayer(state, "p1").graveyard[0].card as { id: string }).id
        ).toBe(counterspell.id);
    });

    it("counters a targeted spell without applying its effect", () => {
        // Giant Growth on p1's creature, then Counterspell: creature stays 1/1
        const state = makeGameState();
        const elf = makeCard({
            id: "elf1",
            card: {
                name: "Llanowar Elves",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            power: 1,
            toughness: 1,
        });
        getPlayer(state, "p1").battlefield.push(elf);

        const growth: StackItem = {
            ...makeCard({
                id: "gg-spell",
                card: {
                    id: giantGrowth.id,
                    name: giantGrowth.name,
                    types: giantGrowth.types,
                },
                types: giantGrowth.types,
                zone: "stack",
                ownerId: "p1",
                controllerId: "p1",
            }),
            castById: "p1",
            targets: [{ type: "permanent", id: "elf1" }],
        };
        state.stack.push(growth);

        state.stack.push(
            makeCounterspellItem("p2", [{ type: "spell", id: "gg-spell" }])
        );

        // Resolve Counterspell
        resolveTopOfStack(state);

        // Giant Growth did NOT resolve — elf stays 1/1
        const elfAfter = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "elf1"
        );
        expect(elfAfter?.power).toBe(1);
        expect(elfAfter?.toughness).toBe(1);
        // gg-spell is in p1's graveyard
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "gg-spell")
        ).toBe(true);
    });

    it("counters an activated ability: ability item is removed but no card moves", () => {
        // Build a fake activated ability on the stack
        const state = makeGameState();
        const abilityItem: StackItem = {
            ...makeCard({
                id: "ability1",
                card: {
                    id: "some-source-id",
                    name: "Source Permanent",
                    types: ["Artifact"],
                },
                types: ["Artifact"],
                zone: "stack",
                ownerId: "p2",
                controllerId: "p2",
            }),
            castById: "p2",
            abilityId: "ability-slot-1",
        };
        state.stack.push(abilityItem);

        state.stack.push(
            makeCounterspellItem("p1", [{ type: "spell", id: "ability1" }])
        );

        resolveTopOfStack(state);

        // Stack emptied; ability item vanishes (not a card, doesn't go to graveyard).
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p2").graveyard).toHaveLength(0);
        // Counterspell itself still goes to p1's graveyard.
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
    });

    it("ignores non-spell target passed to Counterspell (defensive)", () => {
        // Counterspell's resolve guards against non-spell targets — no crash,
        // spell simply fizzles to graveyard without countering anything.
        const state = makeGameState();
        const bolt = makeBoltItem("p2");
        state.stack.push(bolt);
        // Malformed targets: a player instead of a spell.
        state.stack.push(
            makeCounterspellItem("p1", [{ type: "player", id: "p2" }])
        );

        resolveTopOfStack(state);

        // Bolt is still on the stack (not countered)
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(bolt.id);
        // Counterspell still goes to p1's graveyard
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Shroud / "can't be the target" backend gate (#382, CR 702.18 / 611 / 109.5)
//
// Mirrors the exact decision the `selectTarget` mutation makes server-side:
// locate the pending source's types + subtypes + spell-vs-ability, then call
// `isGuardedAgainst("cantBeTargeted", source)`. This is the authoritative
// rejection — `selectTarget` throws when it returns true.
// ---------------------------------------------------------------------------

describe("can't-be-targeted backend gate (#382)", () => {
    // Real shipped C6 cards (registry-resolved by id).
    const SPECTRAL_CLOAK = "7524fd0d-a675-41d6-bc99-bd3ba336893b";
    const ANTI_MAGIC_AURA = "ff78eef1-efaa-4a12-bf5d-fec83c14aff8";
    const BARTEL_RUNEAXE = "f1a42691-98bb-4234-9b56-085e6677f3e4";

    it("getPendingTargetSourceSubtypes reads the cast source's subtypes", () => {
        // A spell waiting in hand carrying the Aura subtype.
        const auraSpell = makeCard({
            id: ANTI_MAGIC_AURA,
            zone: "hand",
            subtypes: ["Aura"],
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", hand: [auraSpell] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(
            getPendingTargetSourceSubtypes(state, auraSpell.id, "cast")
        ).toEqual(["Aura"]);
    });

    it("rejects a spell targeting an untapped Spectral-Cloaked creature", () => {
        const bear = makeCard({
            id: "bear",
            card: CREATURE,
            isTapped: false,
        });
        const cloak = makeCard({
            id: "cloak",
            card: { id: SPECTRAL_CLOAK },
        });
        // makeCard does not spread arbitrary overrides — set the host link.
        cloak.attachedTo = "bear";
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear, cloak] }),
                makePlayer({ id: "p2" }),
            ],
        });
        // Server gate: a spell source can't pick the cloaked bear.
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: true })
        ).toBe(true);
    });

    it("Anti-Magic Aura host: rejects spell, accepts ability", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const aura = makeCard({
            id: "aura",
            card: { id: ANTI_MAGIC_AURA },
        });
        aura.attachedTo = "bear";
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear, aura] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: true })
        ).toBe(true);
        // An activated/triggered ability source is NOT a spell (CR 113.3).
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: false })
        ).toBe(false);
    });

    it("Bartel Runeaxe: rejects an Aura spell only", () => {
        const bartel = makeCard({
            id: "bartel",
            card: { id: BARTEL_RUNEAXE },
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bartel] }),
                makePlayer({ id: "p2" }),
            ],
        });
        // Aura spell → rejected.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: ["Aura"],
                isSpell: true,
            })
        ).toBe(true);
        // Non-Aura spell → accepted.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: [],
                isSpell: true,
            })
        ).toBe(false);
    });
});
