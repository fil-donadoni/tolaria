import { describe, it, expect } from "vitest";
import {
    getEffectivePower,
    getEffectiveToughness,
    getStaticPTBuff,
} from "../layers";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PlayerState,
    type StackItem,
} from "../state";
import type { CardType } from "../../cards/types";
import { castle, lightningBolt, giantGrowth } from "../../cards/sets/lea";

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

function makeCastleOnBattlefield(controllerId: string): CardInstanceState {
    return makeCard({
        id: `castle-${controllerId}`,
        card: { id: castle.id, name: castle.name, types: castle.types },
        types: castle.types,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
}

function makeCreature(
    id: string,
    controllerId: string,
    stats: { power: number; toughness: number },
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeCard({
        id,
        card: {
            name: "Bear",
            types: ["Creature"],
            power: stats.power,
            toughness: stats.toughness,
        },
        types: ["Creature"],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        power: stats.power,
        toughness: stats.toughness,
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// Castle — CR 611 / 613 (layer 7c static P/T buff)
// "Untapped creatures you control get +0/+2."
// ---------------------------------------------------------------------------

describe("Castle static effect (CR 611)", () => {
    it("buffs an untapped creature you control by +0/+2", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const bear = makeCreature("bear", "p1", { power: 2, toughness: 2 });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard, bear] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getStaticPTBuff(state, bear)).toEqual({
            power: 0,
            toughness: 2,
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("does NOT buff a tapped creature you control", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const bear = makeCreature(
            "bear",
            "p1",
            { power: 2, toughness: 2 },
            { isTapped: true }
        );
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard, bear] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getStaticPTBuff(state, bear)).toEqual({
            power: 0,
            toughness: 0,
        });
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("does NOT buff opponent's creatures", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const oppBear = makeCreature("opp-bear", "p2", {
            power: 2,
            toughness: 2,
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard] }),
                makePlayer({ id: "p2", battlefield: [oppBear] }),
            ],
        });

        expect(getEffectiveToughness(state, oppBear)).toBe(2);
    });

    it("does NOT buff non-creature permanents", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const mox = makeCard({
            id: "mox",
            card: { name: "Mox", types: ["Artifact"] },
            types: ["Artifact"],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard, mox] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getStaticPTBuff(state, mox)).toEqual({
            power: 0,
            toughness: 0,
        });
    });

    it("stacks additively when multiple Castles are in play", () => {
        const c1 = makeCastleOnBattlefield("p1");
        c1.id = "castle-1";
        const c2 = makeCastleOnBattlefield("p1");
        c2.id = "castle-2";
        const bear = makeCreature("bear", "p1", { power: 2, toughness: 2 });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [c1, c2, bear] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getEffectiveToughness(state, bear)).toBe(6); // 2 + 2 + 2
    });

    it("buff disappears when Castle leaves the battlefield", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const bear = makeCreature("bear", "p1", { power: 2, toughness: 2 });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard, bear] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getEffectiveToughness(state, bear)).toBe(4);

        // Castle goes to graveyard
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== castleCard.id
        );

        expect(getEffectiveToughness(state, bear)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Damage interactions with Castle
// ---------------------------------------------------------------------------

describe("Castle + damage", () => {
    function makeBoltOnStack(targetId: string): StackItem {
        return {
            ...makeCard({
                id: "bolt",
                card: {
                    id: lightningBolt.id,
                    name: lightningBolt.name,
                    types: lightningBolt.types,
                },
                types: lightningBolt.types,
                zone: "stack",
            }),
            castById: "p2",
            targets: [{ type: "permanent", id: targetId }],
        };
    }

    it("Lightning Bolt does NOT kill a Castle-buffed 2/2 (now 2/4)", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const bear = makeCreature("bear", "p1", { power: 2, toughness: 2 });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard, bear] }),
                makePlayer({ id: "p2" }),
            ],
        });
        state.stack.push(makeBoltOnStack("bear"));

        resolveTopOfStack(state);

        // Bear still alive: 3 damage < 4 effective toughness
        expect(
            getPlayer(state, "p1").battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
    });

    it("Lightning Bolt kills a tapped Castle-buffed 1/1 (buff inactive → toughness 1)", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const elf = makeCreature(
            "elf",
            "p1",
            { power: 1, toughness: 1 },
            { isTapped: true }
        );
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard, elf] }),
                makePlayer({ id: "p2" }),
            ],
        });
        state.stack.push(makeBoltOnStack("elf"));

        resolveTopOfStack(state);

        expect(
            getPlayer(state, "p1").battlefield.find((c) => c.id === "elf")
        ).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Castle + Giant Growth (one-shot modifier + static) additivity
// ---------------------------------------------------------------------------

describe("Castle + Giant Growth", () => {
    it("Giant Growth adds on top of Castle's buff (1/1 → 4/6)", () => {
        const castleCard = makeCastleOnBattlefield("p1");
        const elf = makeCreature("elf", "p1", { power: 1, toughness: 1 });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [castleCard, elf] }),
                makePlayer({ id: "p2" }),
            ],
        });

        // Resolve Giant Growth on elf
        const growth: StackItem = {
            ...makeCard({
                id: "gg",
                card: {
                    id: giantGrowth.id,
                    name: giantGrowth.name,
                    types: giantGrowth.types,
                },
                types: giantGrowth.types,
                zone: "stack",
            }),
            castById: "p1",
            targets: [{ type: "permanent", id: "elf" }],
        };
        state.stack.push(growth);
        resolveTopOfStack(state);

        // Giant Growth mutates base to 4/4. Castle still adds +0/+2 at read time → 4/6.
        const elfAfter = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "elf"
        );
        expect(elfAfter?.power).toBe(4);
        expect(elfAfter?.toughness).toBe(4);
        expect(getEffectivePower(state, elfAfter!)).toBe(4);
        expect(getEffectiveToughness(state, elfAfter!)).toBe(6);
    });
});
