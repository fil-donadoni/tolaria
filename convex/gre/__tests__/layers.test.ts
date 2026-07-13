import { describe, it, expect } from "vitest";
import {
    getEffectivePower,
    getEffectiveToughness,
    getStaticPTBuff,
} from "../layers";
import {
    getPlayer,
    resolveTopOfStack,
    applySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type PlayerState,
    type StackItem,
} from "../state";
import type { CardType } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import { checkCounterAnnihilationSBA } from "../sba";
import {
    castle,
    crusade,
    lightningBolt,
    giantGrowth,
    badMoon,
    bogWraith,
} from "../../cards/sets/lea";
import { opalescence } from "../../cards/sets/uds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// SLIM card builder. Embedded `manaCost` passthrough is allowed so synthetic
// fixtures can drive color-aware predicates (layer system + protection)
// without a registry entry.
function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const cardRef = overrides.card as
        | { id?: string; manaCost?: unknown }
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
        types: (overrides.types as CardType[]) ?? def?.types ?? [],
        subtypes: (overrides.subtypes as string[]) ?? def?.subtypes ?? [],
        power: overrides.power ?? def?.power,
        toughness: overrides.toughness ?? def?.toughness,
        staticAbilities:
            (overrides.staticAbilities as string[]) ??
            def?.staticAbilities ??
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

        // Giant Growth is a temporary +3/+3 buff (base P/T unchanged). Castle
        // adds +0/+2 at read time → effective 4/6.
        const elfAfter = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "elf"
        );
        expect(elfAfter?.power).toBe(1);
        expect(elfAfter?.toughness).toBe(1);
        expect(getEffectivePower(state, elfAfter!)).toBe(4);
        expect(getEffectiveToughness(state, elfAfter!)).toBe(6);
    });
});

// ---------------------------------------------------------------------------
// Bad Moon — CR 611 / 202.2 (color-based global buff)
// "Black creatures get +1/+1." — symmetric, affects opponent's creatures too.
// ---------------------------------------------------------------------------

function makeBadMoon(controllerId: string): CardInstanceState {
    return makeCard({
        id: `badmoon-${controllerId}`,
        card: { id: badMoon.id, name: badMoon.name, types: badMoon.types },
        types: badMoon.types,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
}

function makeBlackCreature(
    id: string,
    controllerId: string
): CardInstanceState {
    return makeCard({
        id,
        card: {
            id: bogWraith.id,
            name: bogWraith.name,
            types: bogWraith.types,
            manaCost: bogWraith.manaCost, // { X: 3, B: 1 } — colors predicate reads this
        },
        types: bogWraith.types,
        power: bogWraith.power,
        toughness: bogWraith.toughness,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
}

describe("Bad Moon static effect (CR 611)", () => {
    it("buffs black creatures you control (+1/+1)", () => {
        const moon = makeBadMoon("p1");
        const wraith = makeBlackCreature("wraith", "p1");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [moon, wraith] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getEffectivePower(state, wraith)).toBe(4);
        expect(getEffectiveToughness(state, wraith)).toBe(4);
    });

    it("buffs OPPONENT's black creatures too (symmetric effect)", () => {
        const moon = makeBadMoon("p1");
        const oppWraith = makeBlackCreature("opp-wraith", "p2");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [moon] }),
                makePlayer({ id: "p2", battlefield: [oppWraith] }),
            ],
        });

        expect(getEffectivePower(state, oppWraith)).toBe(4);
        expect(getEffectiveToughness(state, oppWraith)).toBe(4);
    });

    it("does NOT buff non-black creatures (Grizzly Bears stays 2/2)", () => {
        const moon = makeBadMoon("p1");
        const bears = makeCreature(
            "bears",
            "p1",
            { power: 2, toughness: 2 },
            {
                card: {
                    name: "Grizzly Bears",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                    manaCost: { X: 1, G: 1 }, // green — no B
                },
            }
        );
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [moon, bears] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getEffectivePower(state, bears)).toBe(2);
        expect(getEffectiveToughness(state, bears)).toBe(2);
    });

    it("does NOT buff colorless creatures (Ornithopter-style)", () => {
        const moon = makeBadMoon("p1");
        const golem = makeCreature(
            "golem",
            "p1",
            { power: 3, toughness: 3 },
            {
                card: {
                    name: "Obsianus Golem",
                    types: ["Creature"],
                    manaCost: { X: 6 }, // colorless — generic only
                },
            }
        );
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [moon, golem] }),
                makePlayer({ id: "p2" }),
            ],
        });

        expect(getEffectivePower(state, golem)).toBe(3);
        expect(getEffectiveToughness(state, golem)).toBe(3);
    });

    it("stacks with Castle when the black creature is also yours and untapped", () => {
        const moon = makeBadMoon("p1");
        const castleCard = makeCastleOnBattlefield("p1");
        const wraith = makeBlackCreature("wraith", "p1");
        const state = makeGameState({
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [moon, castleCard, wraith],
                }),
                makePlayer({ id: "p2" }),
            ],
        });

        // Base 3/3 + Bad Moon (+1/+1) + Castle (+0/+2) = 4/6
        expect(getEffectivePower(state, wraith)).toBe(4);
        expect(getEffectiveToughness(state, wraith)).toBe(6);
    });

    it("Castle does NOT apply to opponent's black creature even with Bad Moon", () => {
        const moon = makeBadMoon("p1");
        const castleCard = makeCastleOnBattlefield("p1");
        const oppWraith = makeBlackCreature("opp-wraith", "p2");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [moon, castleCard] }),
                makePlayer({ id: "p2", battlefield: [oppWraith] }),
            ],
        });

        // Bad Moon (+1/+1) applies; Castle (creatures YOU control) does not → 4/4
        expect(getEffectivePower(state, oppWraith)).toBe(4);
        expect(getEffectiveToughness(state, oppWraith)).toBe(4);
    });

    it("two Bad Moons stack (+2/+2)", () => {
        const m1 = makeBadMoon("p1");
        m1.id = "bm1";
        const m2 = makeBadMoon("p2");
        m2.id = "bm2";
        const wraith = makeBlackCreature("wraith", "p1");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [m1, wraith] }),
                makePlayer({ id: "p2", battlefield: [m2] }),
            ],
        });

        // 3/3 + 1/1 + 1/1 = 5/5
        expect(getEffectivePower(state, wraith)).toBe(5);
        expect(getEffectiveToughness(state, wraith)).toBe(5);
    });

    it("Lightning Bolt does NOT kill a Bad-Moon-buffed Bog Wraith (now 4/4)", () => {
        const moon = makeBadMoon("p1");
        const wraith = makeBlackCreature("wraith", "p1");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [moon, wraith] }),
                makePlayer({ id: "p2" }),
            ],
        });

        const bolt: StackItem = {
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
            targets: [{ type: "permanent", id: "wraith" }],
        };
        state.stack.push(bolt);
        resolveTopOfStack(state);

        expect(
            getPlayer(state, "p1").battlefield.find((c) => c.id === "wraith")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Layer 7b set-base-P/T pipeline (CR 613.4b, ADR 0017)
// ---------------------------------------------------------------------------

describe("CR 613.4 ordered P/T pipeline (set effects, ADR 0017)", () => {
    const EOT = { phase: "end-of-turn" as const };

    function bearWith(overrides: Partial<CardInstanceState>): {
        state: GameState;
        bear: CardInstanceState;
    } {
        const bear = makeCreature("bear", "p1", { power: 2, toughness: 2 });
        Object.assign(bear, overrides);
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2" }),
            ],
        });
        return { state, bear };
    }

    it("set base power 0 leaves toughness untouched", () => {
        const { state, bear } = bearWith({
            temporaryPTSet: [{ power: 0, duration: EOT }],
        });
        expect(getEffectivePower(state, bear)).toBe(0);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("set base power and toughness to 0/2", () => {
        const { state, bear } = bearWith({
            temporaryPTSet: [{ power: 0, toughness: 2, duration: EOT }],
        });
        expect(getEffectivePower(state, bear)).toBe(0);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("set 0/2 + a +1/+1 counter computes 1/3 (7b then 7c)", () => {
        const { state, bear } = bearWith({
            temporaryPTSet: [{ power: 0, toughness: 2, duration: EOT }],
            counters: { "+1/+1": 1 },
        });
        expect(getEffectivePower(state, bear)).toBe(1);
        expect(getEffectiveToughness(state, bear)).toBe(3);
    });

    it("set 0/2 + a +2/+2 pump computes 2/4 (7b then 7d)", () => {
        const { state, bear } = bearWith({
            temporaryPTSet: [{ power: 0, toughness: 2, duration: EOT }],
            temporaryPTMods: [{ power: 2, toughness: 2, duration: EOT }],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("two set effects resolve by timestamp — the latest entry wins", () => {
        const { state, bear } = bearWith({
            temporaryPTSet: [
                { power: 5, duration: EOT },
                { power: 0, duration: EOT },
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(0);
    });

    it("a set overrides the printed base entirely (not summed)", () => {
        // A 4/4 set to base power 1 reads 1, not 5.
        const big = makeCreature("big", "p1", { power: 4, toughness: 4 });
        big.temporaryPTSet = [{ power: 1, duration: EOT }];
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [big] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(getEffectivePower(state, big)).toBe(1);
    });

    it("wire format: set 0/2 + counter survives projectPublicState", () => {
        const { state } = bearWith({
            temporaryPTSet: [{ power: 0, toughness: 2, duration: EOT }],
            counters: { "+1/+1": 1 },
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Opalescence — duplicate external "set P/T" CDA sources don't stack
// (CR 613.4b / 613.7: multiple such effects resolve in timestamp order, the
// latest one overwrites every earlier one entirely — never summed).
// ---------------------------------------------------------------------------

describe("multiple pt-cda sources on the same target (CR 613.4b — overwrite, not sum)", () => {
    it("two Opalescences give the same P/T on a shared target as just one", () => {
        const makeCrusade = (id: string) =>
            makeCard({
                id,
                card: { id: crusade.id },
                controllerId: "p1",
                ownerId: "p1",
            });
        const makeOpal = (id: string) =>
            makeCard({
                id,
                card: { id: opalescence.id },
                controllerId: "p1",
                ownerId: "p1",
            });

        const singleCrusade = makeCrusade("crusade-single");
        const opal1 = makeOpal("opal-1");
        const singleState = makeGameState({
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [opal1, singleCrusade],
                }),
                makePlayer({ id: "p2" }),
            ],
        });
        applySourceStaticEffects(singleState, opal1);

        const doubleCrusade = makeCrusade("crusade-double");
        const opal2 = makeOpal("opal-2");
        const opal3 = makeOpal("opal-3");
        const doubleState = makeGameState({
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [opal2, opal3, doubleCrusade],
                }),
                makePlayer({ id: "p2" }),
            ],
        });
        applySourceStaticEffects(doubleState, opal2);
        applySourceStaticEffects(doubleState, opal3);

        // Crusade (mana value 2) is animated to base 2/2, then its own
        // "White creatures get +1/+1" self-applies (it's now a white
        // creature) → 3/3, with exactly ONE Opalescence in play.
        expect(getEffectivePower(singleState, singleCrusade)).toBe(3);
        expect(getEffectiveToughness(singleState, singleCrusade)).toBe(3);

        // A SECOND Opalescence targeting the same Crusade must not double
        // the base P/T contribution — same result as the single-Opalescence
        // board, not 4/4 → 5/5.
        expect(getEffectivePower(doubleState, doubleCrusade)).toBe(
            getEffectivePower(singleState, singleCrusade)
        );
        expect(getEffectiveToughness(doubleState, doubleCrusade)).toBe(
            getEffectiveToughness(singleState, singleCrusade)
        );
    });
});

// ---------------------------------------------------------------------------
// C5 (#384) — named-counter P/T contributions + annihilation SBA (CR 122 / 704.5q)
// ---------------------------------------------------------------------------

describe("counter P/T contributions (CR 613.4d)", () => {
    it("-0/-2 counters drop only toughness", () => {
        const bear = makeCard({
            id: "bear",
            types: ["Creature"],
            power: 2,
            toughness: 4,
        });
        bear.counters = { "-0/-2": 2 };
        const state = makeGameState({
            players: [makePlayer({ id: "p1", battlefield: [bear] })],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(0); // 4 - 2*2

        // Survives the wire.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(0);
    });
});

describe("counter annihilation SBA (CR 704.5q)", () => {
    function bearWith(counters: Record<string, number>): {
        bear: CardInstanceState;
        state: GameState;
    } {
        const bear = makeCard({
            id: "bear",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        bear.counters = counters;
        const state = makeGameState({
            players: [makePlayer({ id: "p1", battlefield: [bear] })],
        });
        return { bear, state };
    }

    it("removes equal numbers of +1/+1 and -1/-1 counters, keeping the remainder", () => {
        const { bear, state } = bearWith({ "+1/+1": 3, "-1/-1": 1 });
        expect(checkCounterAnnihilationSBA(state)).toBe(true);
        expect(bear.counters?.["+1/+1"]).toBe(2);
        expect(bear.counters?.["-1/-1"]).toBeUndefined();
    });

    it("fully annihilates an equal pair, clearing both", () => {
        const { bear, state } = bearWith({ "+1/+1": 2, "-1/-1": 2 });
        checkCounterAnnihilationSBA(state);
        expect(bear.counters?.["+1/+1"]).toBeUndefined();
        expect(bear.counters?.["-1/-1"]).toBeUndefined();
    });

    it("leaves named (non-P/T) counters untouched", () => {
        const { bear, state } = bearWith({
            "+1/+1": 1,
            "-1/-1": 1,
            sleep: 3,
        });
        checkCounterAnnihilationSBA(state);
        expect(bear.counters?.sleep).toBe(3);
        expect(bear.counters?.["+1/+1"]).toBeUndefined();
    });

    it("is a no-op when only one P/T kind is present", () => {
        const { bear, state } = bearWith({ "+1/+1": 2 });
        expect(checkCounterAnnihilationSBA(state)).toBe(false);
        expect(bear.counters?.["+1/+1"]).toBe(2);
    });
});
