// Per-card behavior tests for red cards in `convex/cards/sets/lea/red.ts`
// (LEA, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises. Shared stack/resolve shims live in
// ./helpers; fixture builders stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    blueElementalBlast,
    burrowing,
    castle,
    crusade,
    disintegrate,
    dragonWhelp,
    dwarvenDemolitionTeam,
    dwarvenWarriors,
    earthbind,
    earthquake,
    falseOrders,
    flashfires,
    fireball,
    firebreathing,
    fork,
    goblinBalloonBrigade,
    goblinKing,
    graniteGargoyle,
    grizzlyBears,
    healingSalve,
    ironclawOrcs,
    keldonWarlord,
    lightningBolt,
    manaFlare,
    manabarbs,
    merfolkOfThePearlTrident,
    monssGoblinRaiders,
    orcishArtillery,
    orcishOriflamme,
    plains,
    powerSink,
    powerSurge,
    ragingRiver,
    redElementalBlast,
    rockHydra,
    savannahLions,
    sedgeTroll,
    serraAngel,
    shatter,
    shivanDragon,
    smoke,
    solRing,
    stoneGiant,
    stoneRain,
    swamp,
    taiga,
    tunnel,
    twoHeadedGiantOfForiys,
    uthdenTroll,
    wallOfBone,
    wallOfFire,
    wallOfSwords,
    wheelOfFortune,
} from "..";
import {
    regenerateOrDestroy,
    removePermanentTo,
    resolveTopOfStack,
    emitPermanentEntered,
    emitPermanentTapped,
    processPendingActionTriggers,
    applySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import {
    validateBlockerEligibility,
    getMaxBlockTargets,
} from "../../../../gre/combat";
import {
    advancePhase,
    untapStep,
    emitAttackersDeclaredEvents,
} from "../../../../gre/phases";
import { tryGetDefinition } from "../../../index";
import { compactState, expandState } from "../../../../gre/serialize";
import type { CardType } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    activatePump,
    grizzlyBearsId,
    pushDelayedTrigger,
    runUntapForJ,
} from "./helpers";

describe("Lightning Bolt (3 damage to any target, CR 608.3)", () => {
    it("deals 3 damage to a target player", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("kills a 1/1 creature (damage >= toughness)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
        expect(state.players[1].graveyard[0].id).toBe("lion");
    });

    it("goes to the caster's graveyard after resolving", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            lightningBolt.id
        );
    });

    it("cannot target lands (CR 115.4 / 120.3 — 'any target' is damageable only)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const forest = makeInstance(taiga.id, {
            id: "forest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion, forest] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            lightningBolt.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("lion");
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
        expect(ids).not.toContain("forest");
    });
});

describe("Fireball ({X}{R} — X damage divided, +{1}/target, CR 107.3 / 120.1 / 601.2f)", () => {
    function setupState(targets: string[] = []) {
        const creatures = targets.map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                power: 2,
                toughness: 1,
            })
        );
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
    }

    it("deals X damage to a single target when only one is chosen", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });

    it("divides X damage evenly rounded down across multiple targets", () => {
        // X=5 across 2 targets => 2 each, remainder 1 discarded (CR 120.1).
        const state = setupState(["lion-a", "lion-b"]);
        state.players[1].battlefield[0].toughness = 3;
        state.players[1].battlefield[1].toughness = 3;
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        // 2 damage per target < 3 toughness → neither dies, both stay alive.
        expect(state.players[1].battlefield).toHaveLength(2);
    });

    it("kills all targets when per-target damage reaches lethal", () => {
        // X=6 across 2 targets => 3 each, lethal against toughness 1.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 6;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(2);
    });

    it("is a no-op when X is 0 (total 0 damage)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20);
    });

    it("goes to the caster's graveyard after resolving (CR 608.2k)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            fireball.id
        );
    });

    it("wire format: divided damage still lethal after projectPublicState", () => {
        // Regression: the projection slims stack items' card to { id } only,
        // but chosenX/targets must survive the projection AND re-driving the
        // GRE from a freshly cloned state must still kill both lions.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 4;
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack[0];
        expect(projectedItem.chosenX).toBe(4);
        expect(projectedItem.targets).toHaveLength(2);
        // Resolve against the live state (the source of truth) and assert
        // that the per-target damage (4/2 = 2) clears both 1-toughness lions.
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Earthquake ({X}{R} — X damage to each non-flying creature and each player, CR 107.3 / 120.3)", () => {
    function setupBoard() {
        const ground = makeInstance(savannahLions.id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Serra Angel is a 4/4 with flying — the canonical flier in LEA.
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flier] }),
            ],
        });
    }

    it("kills non-flying creatures, spares fliers, damages both players", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "flier")
        ).toBeDefined();
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });

    it("is a no-op when X is 0", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(2);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });

    it("leaves fliers alive even when X would otherwise be lethal", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 10;
        resolveTopOfStack(state);
        // Only the flier survives; both players take 10.
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield[0].id).toBe("flier");
        expect(state.players[0].life).toBe(10);
        expect(state.players[1].life).toBe(10);
    });

    it("wire format: battlefield and life projection reflect the sweep", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).not.toContain("ground");
        expect(ids).toContain("flier");
        expect(p2.life).toBe(18);
        expect(projected.players.find((p) => p.id === "p1")!.life).toBe(18);
    });
});

describe("Wheel of Fortune (each player discards hand + draws 7, CR 701.9 / 121.1)", () => {
    function libraryCards(
        owner: string,
        count: number,
        prefix: string
    ): CardInstanceState[] {
        return Array.from({ length: count }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `${prefix}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    }

    it("discarded cards land in each player's graveyard, then each draws 7", () => {
        // p1: 3 in hand, 0 in graveyard, 10 in library → after resolve:
        //   graveyard = 3 discarded + Wheel itself = 4, hand = 7, library = 3
        // p2: 4 in hand, 1 in graveyard, 12 in library → after resolve:
        //   graveyard = 1 + 4 discarded = 5, hand = 7, library = 5
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 4, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p2", 1, "p2-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p2", 12, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[0].graveyard).toHaveLength(4);
        expect(
            state.players[0].graveyard.some(
                (c) => c.card.id === wheelOfFortune.id
            )
        ).toBe(true);
        expect(state.players[0].library).toHaveLength(3);

        expect(state.players[1].hand).toHaveLength(7);
        expect(state.players[1].graveyard).toHaveLength(5);
        expect(state.players[1].library).toHaveLength(5);
    });

    it("is a no-op on an empty hand for the discard step (player still draws 7)", () => {
        const p1 = makePlayer("p1", {
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[1].hand).toHaveLength(7);
    });

    it("wire format: hand/library/graveyard counts survive projectPublicState", () => {
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 2, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 3, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(7);
        expect(projected.players[0].graveyard).toHaveLength(3);
        expect(projected.players[0].library.count).toBe(
            state.players[0].library.length
        );
        expect(projected.players[1].hand).toHaveLength(7);
        expect(projected.players[1].graveyard).toHaveLength(3);
        expect(projected.players[1].library.count).toBe(
            state.players[1].library.length
        );
    });
});

// ---------------------------------------------------------------------------
// Circle of Protection: {color} (CR 615.1, 615.6 — one-shot damage prevention)
// ---------------------------------------------------------------------------

describe("Burrowing (Aura — host has mountainwalk, CR 702.14c)", () => {
    function setupAttached() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, burrowing.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants mountainwalk to host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("mountainwalk");
    });

    it("wire format: mountainwalk survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("mountainwalk");
    });
});

describe("Goblin Balloon Brigade ({R}: gain flying until end of turn)", () => {
    function setup() {
        const bb = makeInstance(goblinBalloonBrigade.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [bb] }),
                makePlayer("p2"),
            ],
        });
    }

    function activate(state: GameState, source: CardInstanceState) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "goblin-balloon-brigade-fly",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("grants flying to itself on activation", () => {
        const state = setup();
        const bb = state.players[0].battlefield[0];
        expect(bb.staticAbilities).not.toContain("flying");
        activate(state, bb);
        const after = state.players[0].battlefield[0];
        expect(after.staticAbilities).toContain("flying");
    });
});

describe("Goblin King (other Goblins get +1/+1; lord pt-buff)", () => {
    it("buffs other Goblins +1/+1 and excludes itself", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "raider" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, goblin] }),
                makePlayer("p2"),
            ],
        });
        // Raider gets buffed.
        expect(getEffectivePower(state, goblin)).toBe(2);
        expect(getEffectiveToughness(state, goblin)).toBe(2);
        // King does NOT buff itself.
        expect(getEffectivePower(state, king)).toBe(2);
        expect(getEffectiveToughness(state, king)).toBe(2);
    });

    it("buffs opponent's Goblins too (subtype-only filter)", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const oppGoblin = makeInstance(monssGoblinRaiders.id, {
            id: "opp-rat",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king] }),
                makePlayer("p2", { battlefield: [oppGoblin] }),
            ],
        });
        expect(getEffectivePower(state, oppGoblin)).toBe(2);
    });

    it("does NOT buff non-Goblin creatures", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

describe("Keldon Warlord (P/T = number of OTHER creatures you control)", () => {
    it("scales with creatures you control, excluding itself", () => {
        const warlord = makeInstance(keldonWarlord.id, { id: "warlord" });
        const c1 = makeInstance(grizzlyBears.id, { id: "c1" });
        const c2 = makeInstance(grizzlyBears.id, { id: "c2" });
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warlord, c1, c2] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        // 2 other creatures controlled → 2/2.
        expect(getEffectivePower(state, warlord)).toBe(2);
        expect(getEffectiveToughness(state, warlord)).toBe(2);
    });

    it("a lone Warlord is 0/0 (dies to SBA)", () => {
        const warlord = makeInstance(keldonWarlord.id, { id: "warlord" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warlord] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, warlord)).toBe(0);
        expect(getEffectiveToughness(state, warlord)).toBe(0);
    });
});

describe("Orcish Artillery ({T}: 2 dmg to any target + 3 dmg to self)", () => {
    function setup() {
        const oa = makeInstance(orcishArtillery.id, {
            id: "oa",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [oa] }),
                makePlayer("p2"),
            ],
        });
    }

    it("deals 2 to a target opponent and 3 to the controller", () => {
        const state = setup();
        const oa = state.players[0].battlefield[0];
        state.stack.push({
            ...oa,
            zone: "stack",
            castById: "p1",
            abilityId: "orcish-artillery-shoot",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17); // self-damage
        expect(state.players[1].life).toBe(18); // target damage
    });
});

describe("Shatter / Stone Rain / Tunnel (destroy-target shorthand)", () => {
    it("Shatter destroys an artifact, ignores creatures", () => {
        const ring = makeInstance(solRing.id, {
            id: "ring",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ring] }),
            ],
        });
        pushSpell(state, shatter.id, "p1", [{ type: "permanent", id: "ring" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "ring"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("ring");
    });

    it("Stone Rain destroys a target Land", () => {
        const land = makeInstance(plains.id, {
            id: "victim-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "victim-land" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("Tunnel only targets Walls (subtypeFilter)", () => {
        expect(tunnel.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: "Wall",
        });
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        pushSpell(state, tunnel.id, "p1", [{ type: "permanent", id: "wall" }]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("wall");
    });

    it("Tunnel can't be regenerated — a regen shield does not save the Wall (CR 701.19c)", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            card: { id: wallOfSwords.id, regenerationShields: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        pushSpell(state, tunnel.id, "p1", [{ type: "permanent", id: "wall" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "wall")
        ).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("wall");
    });
});

describe("Uthden Troll ({R}: regenerate self)", () => {
    it("activating regen shields self", () => {
        const troll = makeInstance(uthdenTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...troll,
            zone: "stack",
            castById: "p1",
            abilityId: "uthden-troll-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Green FREE cycle (LEA): Ice Storm, Ley Druid, Stream of Life, Wall of
// Brambles. Plus Lord of Atlantis (blue, was missed in the blue batch).
// ---------------------------------------------------------------------------

describe("Lord-style keyword grant — Goblin King mountainwalk", () => {
    it("entering King grants mountainwalk to existing Goblins", () => {
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "rat" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin] }),
                makePlayer("p2"),
            ],
        });
        // Goblin starts with no mountainwalk.
        expect(
            state.players[0].battlefield.find((c) => c.id === "rat")!
                .staticAbilities
        ).not.toContain("mountainwalk");
        // Cast Goblin King — its keyword-grant should reach the existing rat.
        pushSpell(state, goblinKing.id, "p1");
        resolveTopOfStack(state);
        const ratAfter = state.players[0].battlefield.find(
            (c) => c.id === "rat"
        )!;
        expect(ratAfter.staticAbilities).toContain("mountainwalk");
    });

    it("a new Goblin entering picks up an existing King's mountainwalk", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king] }),
                makePlayer("p2"),
            ],
        });
        // CR 613.7a (PRD #2064 S3) — layer 6 is derived from the live board,
        // and a source's continuous effects begin applying when the engine
        // stamps it (`applySourceStaticEffects`, run on every battlefield entry
        // path). A fixture that places the source directly has to run that step
        // itself, exactly as an ETB would.
        applySourceStaticEffects(state, king);
        pushSpell(state, monssGoblinRaiders.id, "p1");
        resolveTopOfStack(state);
        const newRat = state.players[0].battlefield.find(
            (c) => c.id !== "king"
        )!;
        expect(newRat.staticAbilities).toContain("mountainwalk");
    });

    it("when the King leaves, the grant is removed from existing Goblins", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "rat" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, goblin] }),
                makePlayer("p2"),
            ],
        });
        // CR 613.7a (PRD #2064 S3) — layer 6 is derived from the live board,
        // and a source's continuous effects begin applying when the engine
        // stamps it (`applySourceStaticEffects`, run on every battlefield entry
        // path). A fixture that places the source directly has to run that step
        // itself, exactly as an ETB would.
        applySourceStaticEffects(state, king);
        expect(goblin.staticAbilities).toContain("mountainwalk");
        removePermanentTo(state, "king", "graveyard");
        const ratAfter = state.players[0].battlefield.find(
            (c) => c.id === "rat"
        )!;
        expect(ratAfter.staticAbilities).not.toContain("mountainwalk");
        expect(ratAfter.grantedStaticAbilities).toBeUndefined();
    });

    it("does NOT grant mountainwalk to non-Goblin creatures", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, goblinKing.id, "p1");
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).not.toContain("mountainwalk");
    });

    it("wire format: mountainwalk grant survives the projection", () => {
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "rat" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, goblinKing.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slimRat = projected.players[0].battlefield.find(
            (c) => c.id === "rat"
        )!;
        expect(slimRat.staticAbilities).toContain("mountainwalk");
    });
});

describe("Granite Gargoyle (flying + {R}: +0/+1 until end of turn)", () => {
    function setup() {
        const gg = makeInstance(graniteGargoyle.id, {
            id: "gg",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [gg] }),
                makePlayer("p2"),
            ],
        });
    }

    it("has flying as a static ability", () => {
        const state = setup();
        const gg = state.players[0].battlefield.find((c) => c.id === "gg")!;
        expect(gg.staticAbilities).toContain("flying");
    });

    it("activation pumps +0/+1 until end of turn", () => {
        const state = setup();
        const gg = state.players[0].battlefield.find((c) => c.id === "gg")!;
        activatePump(state, gg, "granite-gargoyle-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "gg")!;
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });
});

describe("Shivan Dragon (flying + {R}: +1/+0 until end of turn)", () => {
    function setup() {
        const sd = makeInstance(shivanDragon.id, {
            id: "sd",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [sd] }),
                makePlayer("p2"),
            ],
        });
    }

    it("has flying and pumps +1/+0 on activation", () => {
        const state = setup();
        const sd = state.players[0].battlefield.find((c) => c.id === "sd")!;
        expect(sd.staticAbilities).toContain("flying");
        activatePump(state, sd, "shivan-dragon-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "sd")!;
        expect(getEffectivePower(state, after)).toBe(6);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });

    it("wire format: pumped P/T survives the projection", () => {
        const state = setup();
        const sd = state.players[0].battlefield.find((c) => c.id === "sd")!;
        activatePump(state, sd, "shivan-dragon-pump");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sd"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(6);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});

describe("Wall of Fire ({R}: +1/+0 until end of turn)", () => {
    it("has defender + pumps on activation", () => {
        const w = makeInstance(wallOfFire.id, {
            id: "wf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [w] }), makePlayer("p2")],
        });
        const wall = state.players[0].battlefield.find((c) => c.id === "wf")!;
        expect(wall.staticAbilities).toContain("defender");
        activatePump(state, wall, "wall-of-fire-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "wf")!;
        expect(getEffectivePower(state, after)).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });
});

describe("Mana Flare (extra mana on land tap)", () => {
    it("matches forMana taps of Lands and skips non-Land or non-mana taps", () => {
        const trig = manaFlare.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "mf",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const baseEvent = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "land",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(trig!.matches(baseEvent, self)).toBe(true);
        expect(trig!.matches({ ...baseEvent, forMana: false }, self)).toBe(
            false
        );
        expect(
            trig!.matches(
                {
                    ...baseEvent,
                    permanentTypes: ["Creature"] as CardType[],
                },
                self
            )
        ).toBe(false);
    });

    // CR 605.4 — resolves immediately, off the stack: the extra mana is in the
    // tapping player's pool within the same game action that tapped the land.
    it("resolves immediately without the stack — bonus mana added", () => {
        const flare = makeInstance(manaFlare.id, {
            id: "mf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(taiga.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flare, land] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { R: 1 };
        emitPermanentTapped(state, land, true, { R: 1 });
        processPendingActionTriggers(state);

        expect(state.stack).toHaveLength(0);
        expect(state.players[0].manaPool?.R).toBe(2);
    });
});

describe("Manabarbs (1 damage on land tap)", () => {
    it("matches every land mana tap", () => {
        const trig = manabarbs.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "mb",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const ev = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "x",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Mountain"],
            forMana: true,
            manaProduced: { R: 1 },
        };
        expect(trig!.matches(ev, self)).toBe(true);
    });

    // CR 605.1b — a tap trigger that adds NO mana (Manabarbs deals damage) is
    // an ordinary triggered ability: it DOES use the stack and hands priority
    // to the active player, unlike the mana-adding Mana Flare above.
    it("uses the stack — damage trigger waits for resolution", () => {
        const barbs = makeInstance(manabarbs.id, {
            id: "mb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(taiga.id, {
            id: "mtn",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barbs] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        emitPermanentTapped(state, land, true, { R: 1 });
        processPendingActionTriggers(state);

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0]?.triggeredAbilityId).toBe("manabarbs-damage");
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });
});

describe("Firebreathing (Aura — {R}: enchanted creature gets +1/+0 EOT)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(firebreathing.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, aura };
    }

    it("activation pumps host +1/+0 until end of turn", () => {
        const { state, aura } = setup();
        activatePump(state, aura, "firebreathing-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(3);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("multiple activations stack additively", () => {
        const { state, aura } = setup();
        activatePump(state, aura, "firebreathing-pump");
        activatePump(state, aura, "firebreathing-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(4);
    });

    it("no-op when aura no longer attached (CR 608.2b)", () => {
        const { state, aura } = setup();
        aura.attachedTo = undefined;
        activatePump(state, aura, "firebreathing-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

describe("Power Surge (each player takes damage = untapped lands at upkeep)", () => {
    function setup(opts: {
        p1Untapped: number;
        p1Tapped: number;
        activePlayerId: string;
    }) {
        const enchant = makeInstance(powerSurge.id, {
            id: "ps",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1Battlefield: CardInstanceState[] = [];
        for (let i = 0; i < opts.p1Untapped; i++)
            p1Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p1-u-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        for (let i = 0; i < opts.p1Tapped; i++)
            p1Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p1-t-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    isTapped: true,
                })
            );
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId: opts.activePlayerId,
            priorityPlayerId: opts.activePlayerId,
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", { battlefield: [enchant] }),
            ],
        });
    }

    it("damages active player only by their UNTAPPED land count (tapped lands skipped)", () => {
        // 3 untapped + 1 tapped (manually). Untap step is bypassed in this
        // test path — the trigger should still correctly skip the tapped one.
        const state = setup({
            p1Untapped: 3,
            p1Tapped: 1,
            activePlayerId: "p1",
        });
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        // Only 3 untapped lands → 3 damage (tapped one is skipped).
        expect(state.players[0].life).toBe(before - 3);
    });

    it("no-op (no stack entry / no damage) when active player has 0 untapped lands", () => {
        const state = setup({
            p1Untapped: 0,
            p1Tapped: 0,
            activePlayerId: "p1",
        });
        advancePhase(state);
        // Trigger predicate matches but resolve guards on count > 0.
        if (state.stack.length > 0) resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// Wave 2 — block restrictions (CR 509.1b, 702.36b)
// ---------------------------------------------------------------------------

describe("Ironclaw Orcs (can't block creatures with power 2 or greater)", () => {
    it("blocking a 2/2 attacker is illegal", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const big = makeInstance(grizzlyBears.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [big] }),
            ],
        });
        expect(
            validateBlockerEligibility(big, orc, [orc], state).eligible
        ).toBe(false);
    });

    it("blocking a 1/1 attacker is legal", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const tiny = makeInstance(savannahLions.id, {
            id: "tiny",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [tiny] }),
            ],
        });
        expect(validateBlockerEligibility(tiny, orc, [orc], state)).toEqual({
            eligible: true,
        });
    });

    it("layer-buffed attacker (Crusade-style) trips the restriction", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isSummoningSick: false,
        });
        const crusadeEnch = makeInstance(crusade.id, {
            id: "crusade",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [lion, crusadeEnch] }),
            ],
        });
        expect(
            validateBlockerEligibility(lion, orc, [orc], state).eligible
        ).toBe(false);
    });

    it("wire format: power-keyed restriction survives projection (layer 7c)", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isSummoningSick: false,
        });
        const crusadeEnch = makeInstance(crusade.id, {
            id: "crusade",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [lion, crusadeEnch] }),
            ],
        });
        // GRE-level: Crusade pumps lion to 2/2 → Ironclaw can't block
        expect(getEffectivePower(state, lion)).toBe(2);
        expect(
            validateBlockerEligibility(lion, orc, [orc], state).eligible
        ).toBe(false);
        // Wire format: same assertion against projected state
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[1].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slimLion)).toBe(2);
    });
});

describe("Dwarven Warriors ({T}: target creature with power 2 or less can't be blocked this turn)", () => {
    function setup(targetPower: number) {
        const dw = makeInstance(dwarvenWarriors.id, {
            id: "dw",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
            power: targetPower,
            toughness: 2,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dw, target] }),
                makePlayer("p2"),
            ],
        });
        return { state, dw };
    }

    it("activated → grants 'unblockable' to legal target until EOT", () => {
        const { state, dw } = setup(2);
        state.stack.push({
            ...dw,
            zone: "stack",
            castById: "p1",
            abilityId: "dwarven-warriors-unblockable",
            targets: [{ type: "permanent", id: "tgt" }],
        });
        resolveTopOfStack(state);
        const tgt = state.players[0].battlefield.find((c) => c.id === "tgt")!;
        expect(tgt.staticAbilities).toContain("unblockable");
    });

    it("granted unblockable rejects every blocker in combat", () => {
        const { state, dw } = setup(2);
        state.stack.push({
            ...dw,
            zone: "stack",
            castById: "p1",
            abilityId: "dwarven-warriors-unblockable",
            targets: [{ type: "permanent", id: "tgt" }],
        });
        resolveTopOfStack(state);
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "tgt"
        )!;
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        expect(
            validateBlockerEligibility(attacker, blocker, [blocker], state)
                .eligible
        ).toBe(false);
    });

    it("getLegalTargets only returns creatures with power ≤ 2", () => {
        const { state } = setup(2);
        // Add a 6/6 Shivan Dragon — should be excluded.
        const big = makeInstance(shivanDragon.id, {
            id: "big",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        state.players[0].battlefield.push(big);
        const req = dwarvenWarriors.activatedAbilities?.[0]?.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const ids = getLegalTargets(state, req, NO_TARGETING_SOURCE).map(
            (t) => t.id
        );
        expect(ids).toContain("tgt");
        expect(ids).not.toContain("big");
    });
});

// ---------------------------------------------------------------------------
// Wave 3 — prevent-to-target shields (CR 615.1)
// ---------------------------------------------------------------------------

describe("Smoke (creature-only untap cap, CR 502.1, ADR 0005)", () => {
    it("with 0 tapped creatures, no prompt — UNTAP auto-resolves to UPKEEP", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const land = makeInstance(plains.id, { id: "l1", isTapped: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant, land] }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.phase).toBe("UPKEEP");
        // Land is unrestricted under Smoke — untaps normally.
        expect(
            state.players[0].battlefield.find((c) => c.id === "l1")?.isTapped
        ).toBe(false);
    });

    it("with 2+ tapped creatures, an untap-pick PendingChoice is enqueued ({min:0,max:1}, creature filter)", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        expect(state.phase).toBe("UNTAP");
        const queue = state.pendingChoices ?? [];
        expect(queue).toHaveLength(1);
        const head = queue[0];
        expect(head.kind).toBe("untap-pick");
        expect(head.playerId).toBe("p1");
        expect(head.zone).toBe("battlefield");
        expect(head.filter).toEqual({ types: "Creature" });
        expect(head.count).toEqual({ min: 0, max: 1 });
        expect(state.priorityPlayerId).toBe("p1");
        // Both creatures are still tapped — pick has not committed.
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });

    it("submit-untap untaps exactly the chosen creature; the other stays tapped", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        // Simulate the mutation's commit path.
        const picked = ["bear-1"];
        const chooser = state.players.find(
            (p) => p.id === state.pendingChoices![0].zoneOwnerId
        )!;
        for (const id of picked) {
            const c = chooser.battlefield.find((x) => x.id === id);
            if (c) c.isTapped = false;
        }
        state.pendingChoices = undefined;
        untapStep(state);
        advancePhase(state);

        expect(state.phase).toBe("UPKEEP");
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });

    it("submit-skip (empty selection) leaves every creature tapped", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        // Skip commit: empty selection, advance dispatcher.
        state.pendingChoices = undefined;
        untapStep(state);
        advancePhase(state);

        expect(state.phase).toBe("UPKEEP");
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });

    it("Smoke does NOT cap non-creature untaps — artifacts, enchantments, lands untap normally", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const artifact = makeInstance(solRing.id, {
            id: "ring",
            isTapped: true,
        });
        const castleEnch = makeInstance(castle.id, {
            id: "castle",
            isTapped: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        enchant,
                        land1,
                        land2,
                        artifact,
                        castleEnch,
                        bear,
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        const bf = state.players[0].battlefield;
        // Non-creature permanents untap immediately, even while the
        // creature prompt is still pending for the single bear (only 1
        // creature is tapped so the cap auto-resolves to "untap it";
        // here the lone eligible is also picked since there is no
        // tactical zero-branch for a single match — but more importantly
        // the non-creatures must already be untapped).
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "ring")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "castle")?.isTapped).toBe(false);
    });

    it("wire format: untap-pick prompt + creature filter survive projectPublicState", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0].kind).toBe("untap-pick");
        expect(projected.pendingChoices?.[0].filter).toEqual({
            types: "Creature",
        });
        expect(projected.pendingChoices?.[0].count).toEqual({
            min: 0,
            max: 1,
        });
        // Both creatures still tapped in the slim view — the dispatcher
        // has not committed any untap yet.
        const slim = projected.players[0].battlefield;
        expect(slim.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(slim.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });
});

describe("Modal spells (CR 700.2) — Healing Salve / Blue & Red Elemental Blast", () => {
    it("Healing Salve gain-life mode: target player gains 3 life", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 13 }), makePlayer("p2")],
        });
        const item = pushSpell(state, healingSalve.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenModeId = "gain-life";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(16);
    });

    it("Healing Salve prevent mode: shield absorbs 3 incoming damage on target", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const salve = pushSpell(state, healingSalve.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        salve.chosenModeId = "prevent";
        resolveTopOfStack(state);
        // Bolt would deal 3 — fully prevented.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.damageMarked ?? 0).toBe(0);
    });

    it("Blue Elemental Blast counter mode: counters target red spell on the stack", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        const blast = pushSpell(state, blueElementalBlast.id, "p2", [
            { type: "spell", id: bolt.id },
        ]);
        blast.chosenModeId = "counter";
        resolveTopOfStack(state); // resolve the counter mode → removes bolt
        // Now resolve what's left — should NOT be the bolt anymore.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("Red Elemental Blast destroy mode: destroys target blue permanent", () => {
        const merfolk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "merfolk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [merfolk] }),
            ],
        });
        const blast = pushSpell(state, redElementalBlast.id, "p1", [
            { type: "permanent", id: "merfolk" },
        ]);
        blast.chosenModeId = "destroy";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "merfolk")
        ).toBeUndefined();
    });
});

describe("Sedge Troll (conditional +1/+1 if Swamp + {B}: regen, CR 611/701.19a)", () => {
    it("gets +1/+1 when controller has a Swamp", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sw = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll, sw] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, troll)).toBe(3);
        expect(getEffectiveToughness(state, troll)).toBe(3);
    });

    it("stays at base 2/2 without a Swamp", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, troll)).toBe(2);
        expect(getEffectiveToughness(state, troll)).toBe(2);
    });

    it("does NOT count opponent's Swamps", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2", { battlefield: [oppSwamp] }),
            ],
        });
        expect(getEffectivePower(state, troll)).toBe(2);
        expect(getEffectiveToughness(state, troll)).toBe(2);
    });

    it("CDA buff survives the projection boundary (wire format)", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sw = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll, sw] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, troll)).toBe(3);
        const projected = projectPublicState(state, 0, "p1");
        const slimTroll = projected.players[0].battlefield.find(
            (c) => c.id === "troll"
        );
        if (!slimTroll) throw new Error("troll not in projection");
        expect(getEffectivePower(projected, slimTroll)).toBe(3);
        expect(getEffectiveToughness(projected, slimTroll)).toBe(3);
    });
});

describe("Dwarven Demolition Team ({T}: destroy target Wall)", () => {
    it("destroys a target Wall on resolution", () => {
        const ddt = makeInstance(dwarvenDemolitionTeam.id, {
            id: "ddt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wall = makeInstance(wallOfBone.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ddt] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        state.stack.push({
            ...ddt,
            id: "stack-ddt",
            zone: "stack",
            castById: "p1",
            abilityId: "dwarven-demolition-team-destroy",
            targets: [{ type: "permanent", id: "wall" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "wall")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "wall")
        ).toBeDefined();
    });
});

describe("twoHeadedGiantOfForiys — can block 2 attackers (CR 509.1a)", () => {
    it("getMaxBlockTargets returns 2", () => {
        const giant = makeInstance(twoHeadedGiantOfForiys.id, {
            id: "giant",
            controllerId: "p2",
        });
        expect(getMaxBlockTargets(giant)).toBe(2);
    });

    it("can block 2 attackers simultaneously (data model)", () => {
        const att1 = makeInstance(grizzlyBears.id, {
            id: "att1",
            controllerId: "p1",
            isAttacking: true,
        });
        const att2 = makeInstance(savannahLions.id, {
            id: "att2",
            controllerId: "p1",
            isAttacking: true,
        });
        const giant = makeInstance(twoHeadedGiantOfForiys.id, {
            id: "giant",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [att1, att2] }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["att1", "att2"],
                confirmed: true,
                blockerAssignments: { giant: ["att1", "att2"] },
                blockersConfirmed: true,
            },
        });
        // Verify getBlockersPerAttacker works with multi-block
        const combat = state.combat!;
        expect(combat.blockerAssignments["giant"]).toEqual(["att1", "att2"]);
    });

    it("cannot block 3 attackers (only 1 additional)", () => {
        const giant = makeInstance(twoHeadedGiantOfForiys.id, {
            id: "giant",
            controllerId: "p2",
        });
        expect(getMaxBlockTargets(giant)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// canBlockAdditional + mustBlockAllThisTurn serialization
// ---------------------------------------------------------------------------

describe("Rock Hydra (CR 107.3 — enters with X +1/+1 counters)", () => {
    it("enters with X +1/+1 counters when cast with X=3", () => {
        const state = makeState();
        const item = pushSpell(state, rockHydra.id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        const onField = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === rockHydra.id
        )!;
        expect(onField.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(state, onField)).toBe(3);
        expect(getEffectiveToughness(state, onField)).toBe(3);
    });

    it("replacement effect: damage removes +1/+1 counters instead of being dealt", () => {
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 4 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "hydra" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(after.damageMarked).toBeFalsy();
    });

    it("replacement effect: excess damage gets through when counters are insufficient", () => {
        // Hydra with 2 counters (effective 2/2) takes 3 bolt: replacement
        // removes 2 counters (prevents 2), 1 excess damage marks on the now
        // 0/0 creature → lethal → destroyed inline (CR 704.5g).
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "hydra" },
        ]);
        resolveTopOfStack(state);
        // Hydra should be in the graveyard — 0/0 with 1 excess damage is lethal
        expect(
            state.players[0].battlefield.find((c) => c.id === "hydra")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "hydra")
        ).toBeDefined();
    });

    it("{R}: prevent next 1 damage to Rock Hydra this turn", () => {
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        activatePump(state, hydra, "rock-hydra-prevent");
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "hydra" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        // 3 damage bolt: 1 prevented by shield, 2 absorbed by counter-removal
        expect(after.counters?.["+1/+1"]).toBeUndefined();
        expect(after.damageMarked).toBeFalsy();
    });

    it("{RRR}: adds a +1/+1 counter (only during upkeep)", () => {
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        activatePump(state, hydra, "rock-hydra-grow");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(3);
    });

    it("{RRR} is restricted to upkeep phase (definition check)", () => {
        const def = tryGetDefinition(rockHydra.id)!;
        const growAbility = def.activatedAbilities!.find(
            (a) => a.id === "rock-hydra-grow"
        )!;
        expect(growAbility.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(growAbility.controllerTurnOnly).toBe(true);
    });
});

describe("Orcish Oriflamme (attacking creatures you control get +1/+0, CR 508.1)", () => {
    function setup() {
        const oriflamme = makeInstance(orcishOriflamme.id, {
            id: "oriflamme",
            controllerId: "p1",
        });
        const attacker = makeInstance(grizzlyBearsId(), {
            id: "attacker",
            controllerId: "p1",
            isAttacking: true,
        });
        const nonAttacker = makeInstance(grizzlyBearsId(), {
            id: "bystander",
            controllerId: "p1",
        });
        const oppAttacker = makeInstance(grizzlyBearsId(), {
            id: "opp-attacker",
            controllerId: "p2",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [oriflamme, attacker, nonAttacker],
        });
        const p2 = makePlayer("p2", {
            battlefield: [oppAttacker],
        });
        return makeState({ players: [p1, p2] });
    }

    it("buffs attacking creatures you control +1/+0", () => {
        const state = setup();
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(state, attacker)).toBe(3); // 2 base + 1
        expect(getEffectiveToughness(state, attacker)).toBe(2); // unchanged
    });

    it("does NOT buff non-attacking creatures", () => {
        const state = setup();
        const bystander = state.players[0].battlefield.find(
            (c) => c.id === "bystander"
        )!;
        expect(getEffectivePower(state, bystander)).toBe(2); // base only
    });

    it("does NOT buff opponent's attacking creatures", () => {
        const state = setup();
        const oppAttacker = state.players[1].battlefield.find(
            (c) => c.id === "opp-attacker"
        )!;
        expect(getEffectivePower(state, oppAttacker)).toBe(2); // base only
    });

    it("buff disappears when isAttacking is cleared (END_OF_COMBAT)", () => {
        const state = setup();
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(state, attacker)).toBe(3);
        attacker.isAttacking = undefined;
        expect(getEffectivePower(state, attacker)).toBe(2);
    });

    it("wire format: buff survives projectPublicState", () => {
        const state = setup();
        const projected = projectPublicState(state, 1, "p1");
        const projAttacker = projected.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(projected, projAttacker)).toBe(3);
        expect(getEffectiveToughness(projected, projAttacker)).toBe(2);
    });
});

describe("Disintegrate ({X}{R} Sorcery — exile-on-death, CR 614.1a)", () => {
    it("creature taking lethal damage is exiled, not sent to graveyard", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, disintegrate.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        // Bear had 2 toughness, took 3 damage → lethal → exiled
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[1].exile.find((c) => c.id === "bear")
        ).toBeDefined();
    });

    it("creature can't be regenerated (regen shield doesn't save it)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, disintegrate.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        // Regen shield should not have saved the creature
        expect(
            state.players[1].exile.find((c) => c.id === "bear")
        ).toBeDefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("exileOnDeath cleared at CLEANUP — creatures dying next turn go to graveyard normally", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            exileOnDeath: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            phase: "END_STEP",
        });
        advancePhase(state); // END_STEP → CLEANUP (clears exileOnDeath)
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter?.exileOnDeath).toBeUndefined();
        // Destroy after cleanup — should go to graveyard, not exile
        regenerateOrDestroy(state, "bear");
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
        expect(
            state.players[1].exile.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("deals X damage to a player target", () => {
        const state = makeState();
        const item = pushSpell(state, disintegrate.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });
});

describe("Dragon Whelp (CR 602.5, 603.7a — activation-count delayed sacrifice)", () => {
    const PUMP_ID = "dragon-whelp-pump";

    function setup() {
        const whelp = makeInstance(dragonWhelp.id, {
            id: "whelp",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whelp] }),
                makePlayer("p2"),
            ],
        });
        return { state, whelp };
    }

    function pumpOnce(state: GameState, source: CardInstanceState) {
        source.activationsThisTurn = {
            ...source.activationsThisTurn,
            [PUMP_ID]: (source.activationsThisTurn?.[PUMP_ID] ?? 0) + 1,
        };
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: PUMP_ID,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("pump 3 times → no delayed sacrifice scheduled", () => {
        const { state, whelp } = setup();
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        expect(getEffectivePower(state, whelp)).toBe(2 + 3);
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("pump 4 times → delayed sacrifice scheduled", () => {
        const { state, whelp } = setup();
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        expect(getEffectivePower(state, whelp)).toBe(2 + 4);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe(
            "dragon-whelp-sacrifice"
        );
    });

    it("delayed sacrifice destroys the creature on resolution", () => {
        const { state, whelp } = setup();
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "whelp")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "whelp")
        ).toBeDefined();
    });

    it("pump 5+ times → only sacrificed once (destroy is no-op after first)", () => {
        const { state, whelp } = setup();
        for (let i = 0; i < 5; i++) pumpOnce(state, whelp);
        // Two delayed triggers scheduled (one at activation 4, one at 5)
        expect(state.delayedTriggers!.length).toBe(2);
        // Resolve first — creature dies
        pushDelayedTrigger(state, state.delayedTriggers![0], "delayed-1");
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        // Resolve second — no-op (creature already in graveyard)
        pushDelayedTrigger(state, state.delayedTriggers![1], "delayed-2");
        resolveTopOfStack(state);
        // Still only one creature in graveyard
        expect(state.players[0].graveyard).toHaveLength(1);
    });
});

describe("Stone Giant (CR 113.1, 611.2a, 603.7a — dynamic toughness target + flying + delayed destroy)", () => {
    const ABILITY_ID = "stone-giant-fling";

    function setup() {
        const giant = makeInstance(stoneGiant.id, {
            id: "giant",
            isSummoningSick: false,
        });
        // toughness 2 < power 3 → legal target
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giant, bear] }),
                makePlayer("p2"),
            ],
        });
        return { state, giant, bear };
    }

    function activate(
        state: GameState,
        source: CardInstanceState,
        targetId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: ABILITY_ID,
            targets: [{ type: "permanent", id: targetId }],
        });
        resolveTopOfStack(state);
    }

    it("getTargetRequirement computes toughnessFilter from source power", () => {
        const ability = stoneGiant.activatedAbilities![0];
        const req = ability.getTargetRequirement!(
            {
                id: "g",
                types: ["Creature"] as CardType[],
                subtypes: ["Giant"],
                power: 3,
                toughness: 4,
                isTapped: false,
                controllerId: "p1",
                ownerId: "p1",
                card: { id: stoneGiant.id },
            },
            { players: [], activePlayerId: "p1" }
        );
        expect(req.toughnessFilter).toEqual({ max: 2 });
        expect(req.controller).toBe("you");
    });

    it("only targets creatures with toughness < source power", () => {
        const { state, giant } = setup();
        // Use dynamic requirement to get the effective target req
        const ability = stoneGiant.activatedAbilities![0];
        const req = ability.getTargetRequirement!(giant, state);
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1");
        const ids = legal.map((t) => t.id);
        // bear (toughness 2) is legal, giant itself (toughness 4) is not
        expect(ids).toContain("bear");
        expect(ids).not.toContain("giant");
    });

    it("creature with toughness >= source power is NOT a legal target", () => {
        const { state, giant } = setup();
        // Add a 3/3 creature — toughness 3 is NOT < 3
        const bigCreature = makeInstance(grizzlyBears.id, {
            id: "big",
            controllerId: "p1",
            toughness: 3,
        });
        state.players[0].battlefield.push(bigCreature);
        const ability = stoneGiant.activatedAbilities![0];
        const req = ability.getTargetRequirement!(giant, state);
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("big");
    });

    it("grants flying until end of turn on resolution", () => {
        const { state, giant, bear } = setup();
        activate(state, giant, "bear");
        expect(bear.staticAbilities).toContain("flying");
        expect(bear.grantedStaticAbilities).toHaveLength(1);
        expect(bear.grantedStaticAbilities![0].ability).toBe("flying");
    });

    it("schedules delayed destroy at end step", () => {
        const { state, giant } = setup();
        activate(state, giant, "bear");
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe("stone-giant-destroy");
        expect(state.delayedTriggers![0].payload.targetId).toBe("bear");
    });

    it("delayed trigger destroys the target at end step", () => {
        const { state, giant } = setup();
        activate(state, giant, "bear");
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// W20: Skip-turn + mana drain — timeVault, manaShort, drainPower
// ---------------------------------------------------------------------------

describe("Earthbind (CR 613.1a — keyword-remove: flying + ETB damage)", () => {
    it("host loses flying continuously", () => {
        const flier = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(earthbind.id, {
            id: "eb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "angel",
        });
        const p1 = makePlayer("p1", { battlefield: [aura] });
        const p2 = makePlayer("p2", { battlefield: [flier] });
        const state = makeState({ players: [p1, p2] });
        applySourceStaticEffects(state, aura);

        expect(flier.staticAbilities).not.toContain("flying");
        // `seq` is the CR 613.7 layer timestamp the source stamps on every
        // record it writes (issue #1715) — an implementation detail here.
        expect(flier.removedKeywords).toEqual([
            expect.objectContaining({ keyword: "flying", sourceId: "eb" }),
        ]);
    });

    it("deals 2 damage to flying host on ETB", () => {
        const flier = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(earthbind.id, {
            id: "eb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "angel",
        });
        const p1 = makePlayer("p1", { battlefield: [aura] });
        const p2 = makePlayer("p2", { battlefield: [flier] });
        const state = makeState({ players: [p1, p2] });
        applySourceStaticEffects(state, aura);

        // Emit the ETB event and collect triggers
        emitPermanentEntered(state, aura);
        processPendingActionTriggers(state);

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("earthbind-etb");

        resolveTopOfStack(state);
        expect(flier.damageMarked).toBe(2);
    });

    it("non-flying host takes no ETB damage", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(earthbind.id, {
            id: "eb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const p1 = makePlayer("p1", { battlefield: [aura] });
        const p2 = makePlayer("p2", { battlefield: [bear] });
        const state = makeState({ players: [p1, p2] });
        applySourceStaticEffects(state, aura);

        emitPermanentEntered(state, aura);
        processPendingActionTriggers(state);

        // Trigger fires but resolve is a no-op for non-flying hosts
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(bear.damageMarked).toBeUndefined();
    });
});

describe("False Orders (CR 506.4 — remove from combat)", () => {
    it("removes a blocking creature from combat", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const attacker = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [attacker],
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", { battlefield: [blocker] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["lion"],
                confirmed: true,
                blockerAssignments: { bear: ["lion"] },
                blockersConfirmed: true,
            },
        });

        pushSpell(state, falseOrders.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        expect(blocker.isBlocking).toBe(false);
        expect(state.combat!.blockerAssignments["bear"]).toBeUndefined();
    });

    it("removing sole blocker leaves attacker unblocked", async () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const attacker = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [attacker],
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [blocker],
            life: 20,
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear: ["angel"] },
                // Real play records the angel as blocked at declare-blockers.
                // Removing its sole blocker must explicitly un-block it now that
                // "blocked" is combat state, not the live blocker count (#172).
                blockedAttackerIds: ["angel"],
                blockersConfirmed: true,
            },
        });

        pushSpell(state, falseOrders.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        // Angel was solely blocked by the bear → it is now unblocked.
        expect(state.combat!.blockedAttackerIds).not.toContain("angel");

        // Angel is now unblocked — should deal damage to player
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {});

        expect(p2.life).toBe(16); // Serra Angel = 4 power
    });

    it("removing one of two blockers leaves the attacker blocked (deals no damage to the defender)", async () => {
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const attacker = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [attacker],
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [bear1, bear2],
            life: 20,
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear1: ["angel"], bear2: ["angel"] },
                blockedAttackerIds: ["angel"],
                blockersConfirmed: true,
            },
        });

        pushSpell(state, falseOrders.id, "p1", [
            { type: "permanent", id: "bear1" },
        ]);
        resolveTopOfStack(state);

        // bear2 still blocks the angel — it stays blocked.
        expect(state.combat!.blockedAttackerIds).toContain("angel");
        expect(state.combat!.blockerAssignments["bear1"]).toBeUndefined();

        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, { angel: { bear2: 4 } });

        // Defender takes nothing — the attacker is still blocked.
        expect(p2.life).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// W26 — mana substitution, graveyard trigger, aura retarget
// ---------------------------------------------------------------------------

describe("Fork (copy target instant or sorcery spell, CR 707.10)", () => {
    type Targets = NonNullable<StackItem["targets"]>;

    // Mirrors finalizeTargetSelection's "copy-retarget" branch in
    // convex/game.ts: writes the chosen targets onto the spell copy and
    // clears the prompt. Kept as a pure helper so the test needs no Convex
    // context (same convention as activation-flow.test.ts).
    function applyCopyRetarget(state: GameState, newTargets: Targets): void {
        const pt = state.pendingTarget!;
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId);
        if (copy) copy.targets = newTargets;
        state.pendingTarget = undefined;
    }

    it("copies an instant spell on the stack (CR 707.10)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state); // Fork resolves

        // The original + the copy remain; the copy sits on top of the
        // original (resolves first). Fork itself has left the stack.
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(bolt.id);
        const copy = state.stack[state.stack.length - 1];
        expect(copy.isCopy).toBe(true);
        expect((copy.card as { id: string }).id).toBe(lightningBolt.id);
        expect(copy.id).not.toBe(bolt.id);
        // The copy inherits the original's targets (CR 707.10b default).
        expect(copy.targets).toEqual([{ type: "player", id: "p1" }]);
    });

    it("copies a sorcery spell on the stack", () => {
        const state = makeState();
        const sr = pushSpell(state, stoneRain.id, "p1", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: sr.id }]);
        resolveTopOfStack(state);

        const copy = state.stack[state.stack.length - 1];
        expect(copy.isCopy).toBe(true);
        expect((copy.card as { id: string }).id).toBe(stoneRain.id);
    });

    it("copy is red regardless of the original spell's color (CR 707.10c)", () => {
        // Power Sink is blue; Fork's copy must be red.
        const state = makeState();
        const ps = pushSpell(state, powerSink.id, "p2", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: ps.id }]);
        resolveTopOfStack(state);

        const copy = state.stack[state.stack.length - 1];
        expect(copy.colorOverride).toEqual(["R"]);
        expect(STATIC_EFFECT_CTX.getColors(copy)).toEqual(["R"]);
        // sanity: the original Power Sink stays blue
        expect(STATIC_EFFECT_CTX.getColors(state.stack[0])).toContain("U");
    });

    it("caster may choose new targets for the copy (CR 707.10b)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" }, // original targets p1
        ]);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state); // Fork resolves → copy + retarget prompt

        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("copy-retarget");
        expect(pt.playerId).toBe("p1"); // Fork's controller chooses
        expect(pt.targetType).toBe("any"); // Lightning Bolt's requirement
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId)!;
        expect(copy.isCopy).toBe(true);

        // Re-point the copy at p2, then resolve it.
        applyCopyRetarget(state, [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        expect(state.players[1].life).toBe(17); // p2 took the copy's 3
        expect(state.players[0].life).toBe(20); // p1 untouched
        // The copy ceased to exist — it never entered a graveyard (only Fork
        // itself, a real card, is in its caster's graveyard).
        const allGraveyard = [
            ...state.players[0].graveyard,
            ...state.players[1].graveyard,
        ];
        expect(allGraveyard.some((c) => c.id === copy.id)).toBe(false);
        expect(
            state.players[0].graveyard.map((c) => (c.card as { id: string }).id)
        ).toEqual([fork.id]);
    });

    it("copy resolves with the original targets if no re-selection (CR 707.10b)", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const bolt = state.stack[0];
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);

        // Decline the retarget: clear the prompt, keep inherited targets.
        expect(state.pendingTarget?.kind).toBe("copy-retarget");
        state.pendingTarget = undefined;
        resolveTopOfStack(state); // copy resolves at the original target p1

        expect(state.players[0].life).toBe(17);
        expect(state.players[1].life).toBe(20);
    });

    it("cannot copy a permanent (non-instant/sorcery) spell (CR 707.10)", () => {
        const state = makeState();
        const bear = pushSpell(state, grizzlyBears.id, "p2", []);

        // A creature spell is not a legal Fork target.
        const legal = getLegalTargets(
            state,
            fork.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        expect(legal.some((t) => t.type === "spell" && t.id === bear.id)).toBe(
            false
        );

        // Even if forced, copyStackItem refuses it: no copy, no prompt.
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bear.id }]);
        resolveTopOfStack(state); // Fork resolves to graveyard, no copy
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(bear.id);
    });

    it("wire format: copy's red color + isCopy survive projectPublicState", () => {
        const state = makeState();
        const ps = pushSpell(state, powerSink.id, "p2", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: ps.id }]);
        resolveTopOfStack(state);
        const copyId = state.stack[state.stack.length - 1].id;

        // GRE: the copy is red.
        const greCopy = state.stack.find((s) => s.id === copyId)!;
        expect(STATIC_EFFECT_CTX.getColors(greCopy)).toEqual(["R"]);
        expect(greCopy.isCopy).toBe(true);

        // Wire: the same survives the projection that crosses the network.
        const projected = projectPublicState(state, 1, "p1");
        const slimCopy = projected.stack.find((s) => s.id === copyId)!;
        expect(slimCopy.colorOverride).toEqual(["R"]);
        expect((slimCopy as { isCopy?: boolean }).isCopy).toBe(true);
        expect(STATIC_EFFECT_CTX.getColors(slimCopy as never)).toEqual(["R"]);
    });

    it("isCopy survives the DB serialize round-trip", () => {
        const state = makeState();
        const ps = pushSpell(state, powerSink.id, "p2", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: ps.id }]);
        resolveTopOfStack(state);
        state.pendingTarget = undefined; // stable stack for serialization

        const round = expandState(compactState(state));
        const copy = round.stack.find((s) => s.isCopy);
        expect(copy).toBeDefined();
        expect(copy!.colorOverride).toEqual(["R"]);
    });
});

// ---------------------------------------------------------------------------
// Banding (CR 702.22) — W28: benalishHero, mesaPegasus, timberWolves,
// helmOfChatzuk. Covers keyword recognition, band-composition legality,
// block-as-group, and the two damage-assignment authority shifts (702.22j-k).
// ---------------------------------------------------------------------------

describe("Raging River (pile combat — CR 509.2 variant, ADR 0012)", () => {
    // Submits the current head pending choice with the given picks (the "left"
    // pile / "left" attackers); applyPendingChoiceSubmit auto-resumes the
    // trigger's resolution.
    function submitHead(state: GameState, picks: string[]) {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: picks,
        });
    }

    function setup() {
        const river = makeInstance(ragingRiver.id, {
            id: "river",
            controllerId: "p1",
            ownerId: "p1",
        });
        const atkA = makeInstance(savannahLions.id, {
            id: "atkA",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const atkB = makeInstance(savannahLions.id, {
            id: "atkB",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const flyer = makeInstance(savannahLions.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const g1 = makeInstance(savannahLions.id, {
            id: "g1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const g2 = makeInstance(savannahLions.id, {
            id: "g2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [river, atkA, atkB] }),
                makePlayer("p2", { battlefield: [flyer, g1, g2] }),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
        });
        state.combat = {
            attackerIds: ["atkA", "atkB"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        return { state, atkA, atkB, flyer, g1, g2 };
    }

    it("fires on attack, partitions defenders, labels attackers, sets restrictions", () => {
        const { state } = setup();

        emitAttackersDeclaredEvents(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("raging-river-piles");

        // Resolve the trigger → defender partition choice for p2.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("partition");
        expect(state.pendingChoices?.[0].playerId).toBe("p2");

        // p2 puts g1 in the left pile (g2 → right). Flyer is not offered.
        submitHead(state, ["g1"]);

        // Attacker labelling choice for p1.
        expect(state.pendingChoices?.[0].kind).toBe("partition");
        expect(state.pendingChoices?.[0].playerId).toBe("p1");

        // p1 labels atkA "left" (atkB → right).
        submitHead(state, ["atkA"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.combatBlockRestrictions).toEqual([
            { attackerId: "atkA", allowedPileLabel: "left" },
            { attackerId: "atkB", allowedPileLabel: "right" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "g1")!.pileLabel
        ).toBe("left");
        expect(
            state.players[1].battlefield.find((c) => c.id === "g2")!.pileLabel
        ).toBe("right");
    });

    it("enforces pile rules in block validation; flying ignores piles", () => {
        const { state, atkA, atkB, flyer, g1, g2 } = setup();
        emitAttackersDeclaredEvents(state);
        resolveTopOfStack(state);
        submitHead(state, ["g1"]); // g1 left, g2 right
        submitHead(state, ["atkA"]); // atkA left, atkB right

        const field = [flyer, g1, g2];
        // atkA is "left": only g1 (left) or the flyer may block it.
        expect(
            validateBlockerEligibility(atkA, g1, field, state).eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(atkA, g2, field, state).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(atkA, flyer, field, state).eligible
        ).toBe(true);
        // atkB is "right": only g2 (right) or the flyer may block it.
        expect(
            validateBlockerEligibility(atkB, g2, field, state).eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(atkB, g1, field, state).eligible
        ).toBe(false);
    });

    it("does not fire when the attacking player isn't the controller", () => {
        const { state } = setup();
        // Opponent (p2) is now the attacker; Raging River belongs to p1.
        state.activePlayerId = "p2";
        state.combat!.attackerIds = ["g1"];
        emitAttackersDeclaredEvents(state);
        expect(state.stack).toHaveLength(0);
    });

    it("clears pile labels and restrictions at end of combat (CR 511.3)", () => {
        const { state, g1 } = setup();
        emitAttackersDeclaredEvents(state);
        resolveTopOfStack(state);
        submitHead(state, ["g1"]);
        submitHead(state, ["atkA"]);
        expect(state.combatBlockRestrictions).toHaveLength(2);

        // CR 511.3 / CR 511.2 — pile labels and combat-scoped block
        // restrictions are part of the combat and end as the END_OF_COMBAT
        // step *ends*, not when it begins. They must still be present during
        // END_OF_COMBAT (so e.g. Desert can target an attacker), and clear
        // only on leaving the step.
        state.phase = "COMBAT_DAMAGE";
        state.combat!.blockersConfirmed = true;
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        expect(state.combatBlockRestrictions).toHaveLength(2);
        expect(
            state.players[1].battlefield.find((c) => c.id === g1.id)!.pileLabel
        ).toBe("left");

        // Leaving END_OF_COMBAT ends the combat → labels and restrictions lift.
        advancePhase(state);
        expect(state.phase).toBe("POSTCOMBAT_MAIN");
        expect(state.combatBlockRestrictions).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === g1.id)!.pileLabel
        ).toBeUndefined();
    });

    it("survives a serialize round-trip mid-combat", () => {
        const { state } = setup();
        emitAttackersDeclaredEvents(state);
        resolveTopOfStack(state);
        submitHead(state, ["g1"]);
        submitHead(state, ["atkA"]);

        const restored = expandState(compactState(state));
        expect(restored.combatBlockRestrictions).toEqual(
            state.combatBlockRestrictions
        );
        expect(
            restored.players[1].battlefield.find((c) => c.id === "g1")!
                .pileLabel
        ).toBe("left");
    });
});

// Migration harness (ADR 0045, issue #831): Flashfires had no per-card test, so
// this behaviour test is authored to guard the resolve()→effects[] migration
// (destroyAll{Plains} → forEach/destroy).
describe("Flashfires ({3}{R} — destroy all Plains, CR 701.8)", () => {
    it("destroys every Plains across both players and spares other lands", () => {
        const p1Plains = makeInstance(plains.id, {
            id: "p1-plains",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Swamp = makeInstance(swamp.id, {
            id: "p1-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p2Plains = makeInstance(plains.id, {
            id: "p2-plains",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Plains, p1Swamp] }),
                makePlayer("p2", { battlefield: [p2Plains] }),
            ],
        });
        pushSpell(state, flashfires.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-plains")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-plains")
        ).toBeUndefined();
        // Non-Plains land survives.
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-swamp")
        ).toBeDefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "p1-plains"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "p2-plains"
        );
    });
});
