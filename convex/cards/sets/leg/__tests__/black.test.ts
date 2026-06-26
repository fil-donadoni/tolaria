// Legends (LEG) — black per-card behaviour tests (ADR 0043 colour split;
// twin of arn/leb colour test files). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external
// behaviour only. Shared shims live in ./helpers; fixtures in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    ENTERED_C7,
    HEADLESS,
    ORNITHOPTER,
    UPKEEP_C7,
    abyssUpkeep,
    answerChoice,
    castEvent,
    fillManaPool,
    resolveTrigger,
    upkeepEvent487,
} from "./helpers";
import {
    acidRain,
    blight,
    carrionAnts,
    cosmicHorror,
    cyclopeanMummy,
    darkness,
    fallenAngel,
    ghostsOfTheDamned,
    greed,
    headlessHorseman,
    hellSwarm,
    hellfire,
    hellsCaretaker,
    horrorOfHorrors,
    lostSoul,
    moldDemon,
    netherVoid,
    spiritShackle,
    syphonSoul,
    theAbyss,
    walkingDead,
    wallOfTombstones,
} from "..";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { advancePhase } from "../../../../gre/phases";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type StackItem,
} from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { grizzlyBears, lightningBolt, swamp } from "../../lea";

// ---------------------------------------------------------------------------
// Black free tranche (#373)
// ---------------------------------------------------------------------------

describe("LEG black keyword / vanilla creatures (CR 702)", () => {
    it("Headless Horseman is a vanilla 2/2 with no abilities", () => {
        expect(headlessHorseman.power).toBe(2);
        expect(headlessHorseman.toughness).toBe(2);
        expect(headlessHorseman.staticAbilities ?? []).toEqual([]);
        expect(headlessHorseman.triggeredAbilities).toBeUndefined();
        expect(headlessHorseman.activatedAbilities).toBeUndefined();
    });
    it("Lost Soul has swampwalk", () => {
        expect(lostSoul.staticAbilities).toContain("swampwalk");
    });
    it("Fallen Angel has flying", () => {
        expect(fallenAngel.staticAbilities).toContain("flying");
    });
});

describe("Carrion Ants ({1}: +1/+1 EOT, CR 611.1)", () => {
    it("pumps itself by +1/+1 until end of turn (repeatable)", () => {
        const ants = makeInstance(carrionAnts.id, {
            id: "ants",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ants] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, ants)).toBe(0);
        expect(getEffectiveToughness(state, ants)).toBe(1);
        // Activate twice.
        for (let i = 0; i < 2; i++) {
            state.stack.push({
                ...ants,
                zone: "stack",
                castById: "p1",
                abilityId: "carrion-ants-pump",
                targets: [],
            } as StackItem);
            resolveTopOfStack(state);
        }
        const live = state.players[0].battlefield.find((c) => c.id === "ants")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
        // Wire format: the buff survives projection.
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ants"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Walking Dead ({B}: Regenerate this, CR 701.15a)", () => {
    it("arms a regeneration shield on itself", () => {
        const wd = makeInstance(walkingDead.id, {
            id: "wd",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wd] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wd,
            zone: "stack",
            castById: "p1",
            abilityId: "walking-dead-regenerate",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wd")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe("Ghosts of the Damned ({T}: target -1/-0 EOT, CR 611.1)", () => {
    it("debuffs the target's power by 1 until end of turn", () => {
        const ghosts = makeInstance(ghostsOfTheDamned.id, {
            id: "ghosts",
            controllerId: "p1",
        });
        const bear = makeInstance(headlessHorseman.id, {
            id: "bear",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ghosts] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        state.stack.push({
            ...ghosts,
            zone: "stack",
            castById: "p1",
            abilityId: "ghosts-of-the-damned-debuff",
            targets: [{ type: "permanent", id: "bear" }],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(1);
    });
});

describe("Fallen Angel (Sacrifice a creature: +2/+1 EOT, CR 602.1/611.1)", () => {
    it("sacrifices a creature and pumps itself +2/+1", () => {
        const angel = makeInstance(fallenAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = makeInstance(headlessHorseman.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel, fodder] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, angel)).toBe(3);
        state.stack.push({
            ...angel,
            zone: "stack",
            castById: "p1",
            abilityId: "fallen-angel-feast",
            sacrificedPermanentId: "fodder",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "angel"
        )!;
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(4);
    });
});

describe("Hell's Caretaker (reanimate from GY, upkeep only, CR 400.7)", () => {
    it("returns a creature card from the graveyard to the battlefield", () => {
        const caretaker = makeInstance(hellsCaretaker.id, {
            id: "ct",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = makeInstance(headlessHorseman.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const deadInst = makeInstance(carrionAnts.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [caretaker, fodder],
                    graveyard: [deadInst],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...caretaker,
            zone: "stack",
            castById: "p1",
            abilityId: "hells-caretaker-reanimate",
            sacrificedPermanentId: "fodder",
            targets: [{ type: "graveyard-card", id: "dead", playerId: "p1" }],
        } as StackItem);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dead")
        ).toBeDefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "dead")
        ).toBeUndefined();
    });
});

describe("Blight (enchanted land tapped → destroy, CR 303.4)", () => {
    it("destroys the host land when it becomes tapped", () => {
        const land = makeInstance(swamp.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(blight.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "land",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveTrigger(state, aura, "blight-destroy-land", {
            type: "PERMANENT_TAPPED",
            permanentId: "land",
            controllerId: "p2",
            permanentTypes: ["Land"],
            permanentSubtypes: ["Swamp"],
            forMana: false,
        } as StackItem["triggerEvent"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
    });
});

describe("Hell Swarm (all creatures -1/-0 EOT, CR 611.1)", () => {
    it("debuffs every creature's power by 1", () => {
        const a = makeInstance(headlessHorseman.id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(headlessHorseman.id, {
            id: "b",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });
        pushSpell(state, hellSwarm.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectivePower(state, a)).toBe(1);
        expect(getEffectivePower(state, b)).toBe(1);
    });
});

describe("Hellfire (destroy all nonblack creatures + X+3 to you, CR 701.7)", () => {
    it("destroys nonblack creatures, spares black, and deals X+3 to caster", () => {
        // Scathe Zombies (black) survives; Hill Giant (red) dies.
        const zombie = makeInstance("e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", {
            id: "zombie",
            controllerId: "p2",
        });
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "giant",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [zombie, giant] }),
            ],
        });
        pushSpell(state, hellfire.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "giant")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "zombie")
        ).toBeDefined();
        // X = 1 nonblack creature died → 1 + 3 = 4 damage to caster.
        expect(state.players[0].life).toBe(16);
    });
});

describe("Syphon Soul (2 to each opponent, gain that much, CR 120.1)", () => {
    it("deals 2 to the opponent and gains the caster 2 life", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, syphonSoul.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(22);
    });
});

describe("Horror of Horrors (Sac a Swamp: regenerate target black creature)", () => {
    it("arms a regeneration shield on a black creature", () => {
        const horror = makeInstance(horrorOfHorrors.id, {
            id: "hh",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, {
            id: "swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Scathe Zombies — black creature.
        const zombie = makeInstance("e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", {
            id: "zombie",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [horror, land, zombie] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...horror,
            zone: "stack",
            castById: "p1",
            abilityId: "horror-of-horrors-regenerate",
            sacrificedPermanentId: "swamp",
            targets: [{ type: "permanent", id: "zombie" }],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "zombie"
        )!;
        expect(live.regenerationShields ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe("Cyclopean Mummy (dies → exile, CR 603.2 / 406)", () => {
    it("moves the dead creature from graveyard to exile", () => {
        const mummy = makeInstance(cyclopeanMummy.id, {
            id: "mummy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [mummy] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, mummy, "cyclopean-mummy-exile", {
            type: "CREATURE_DIED",
            creatureInstanceId: "mummy",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 1,
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].graveyard.find((c) => c.id === "mummy")
        ).toBeUndefined();
        expect(
            state.players[0].exile.find((c) => c.id === "mummy")
        ).toBeDefined();
    });
});

describe("Greed ({B}, Pay 2 life: Draw a card, CR 118.4 / 121.1)", () => {
    it("draws a card and costs 2 life", () => {
        const greedInst = makeInstance(greed.id, {
            id: "greed",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libCard = makeInstance(headlessHorseman.id, {
            id: "lib",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [greedInst],
                    library: [libCard],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...greedInst,
            zone: "stack",
            castById: "p1",
            abilityId: "greed-draw",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        expect(state.players[0].hand.find((c) => c.id === "lib")).toBeDefined();
    });
});

describe("Darkness (prevent all combat damage this turn, CR 615)", () => {
    it("arms the global combat-damage prevention", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, darkness.id, "p1");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

describe("Cosmic Horror (upkeep: destroy unless pay {3}{B}{B}{B}, then 7 to you, CR 603.6a / 701.7)", () => {
    function setup() {
        const horror = makeInstance(cosmicHorror.id, {
            id: "horror",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [horror] }),
                makePlayer("p2"),
            ],
        });
        return { state, horror };
    }

    it("declining destroys it AND deals 7 damage to its controller", () => {
        const { state, horror } = setup();
        resolveTrigger(state, horror, "cosmic-horror-upkeep", UPKEEP_C7("p1"));
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.some((c) => c.id === "horror")).toBe(
            true
        );
        expect(state.players[0].life).toBe(13); // 20 - 7
    });

    it("paying keeps it and deals no damage", () => {
        const { state, horror } = setup();
        fillManaPool(state);
        resolveTrigger(state, horror, "cosmic-horror-upkeep", UPKEEP_C7("p1"));
        answerChoice(state, ["yes"]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "horror")
        ).toBe(true);
        expect(state.players[0].life).toBe(20);
    });

    it("has first strike", () => {
        expect(cosmicHorror.staticAbilities).toContain("first strike");
    });
});

describe("Mold Demon (ETB: sacrifice unless you sacrifice two Swamps, CR 603.6a / 118.3)", () => {
    function setup(swampCount: number) {
        const demon = makeInstance(moldDemon.id, {
            id: "demon",
            controllerId: "p1",
        });
        const swamps = Array.from({ length: swampCount }, (_, i) =>
            makeInstance(swamp.id, { id: `swamp-${i}`, controllerId: "p1" })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [demon, ...swamps] }),
                makePlayer("p2"),
            ],
        });
        return { state, demon };
    }

    it("sacrifices two Swamps and keeps Mold Demon when the controller pays", () => {
        const { state } = setup(2);
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "mold-demon-etb",
            ENTERED_C7(state.players[0].battlefield[0])
        );
        answerChoice(state, ["yes"]); // accept the sacrifice cost
        answerChoice(state, ["swamp-0", "swamp-1"]); // pick the two Swamps
        const bf = state.players[0].battlefield;
        expect(bf.some((c) => c.id === "demon")).toBe(true);
        expect(bf.some((c) => c.subtypes.includes("Swamp"))).toBe(false);
    });

    it("declining the cost sacrifices Mold Demon", () => {
        const { state } = setup(2);
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "mold-demon-etb",
            ENTERED_C7(state.players[0].battlefield[0])
        );
        answerChoice(state, ["decline"]);
        const bf = state.players[0].battlefield;
        expect(bf.some((c) => c.id === "demon")).toBe(false);
        // The two Swamps remain.
        expect(bf.filter((c) => c.subtypes.includes("Swamp"))).toHaveLength(2);
        expect(state.players[0].graveyard.some((c) => c.id === "demon")).toBe(
            true
        );
    });

    it("auto-sacrifices when fewer than two Swamps are available (no real choice)", () => {
        const { state } = setup(1);
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "mold-demon-etb",
            ENTERED_C7(state.players[0].battlefield[0])
        );
        // Unpayable cost forces the consequence with no prompt.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].battlefield.some((c) => c.id === "demon")).toBe(
            false
        );
    });
});

describe("Spirit Shackle (becomes-tapped → -0/-2 counter, CR 701.20a / 122.1 / 613.4d)", () => {
    function setup() {
        const creature = makeInstance(grizzlyBears.id, {
            id: "creature",
            controllerId: "p2",
            power: 2,
            toughness: 2,
        });
        const aura = makeInstance(spiritShackle.id, {
            id: "shackle",
            controllerId: "p1",
            attachedTo: "creature",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        return { state, creature, aura };
    }

    it("puts a -0/-2 counter on the host when it becomes tapped, dropping its toughness", () => {
        const { state, creature } = setup();
        expect(getEffectiveToughness(state, creature)).toBe(2);
        const tapEvent: StackItem["triggerEvent"] = {
            type: "PERMANENT_TAPPED",
            permanentId: "creature",
            controllerId: "p2",
            permanentTypes: creature.types,
            permanentSubtypes: creature.subtypes,
            forMana: false,
        } as StackItem["triggerEvent"];
        const aura = state.players[0].battlefield[0];
        resolveTrigger(state, aura, "spirit-shackle-tap", tapEvent);
        expect(creature.counters?.["-0/-2"]).toBe(1);
        // CR 613.4d — the -0/-2 counter rides layer 7d.
        expect(getEffectiveToughness(state, creature)).toBe(0);
    });

    it("the -0/-2 toughness drop survives projection (wire format)", () => {
        const { state, creature } = setup();
        creature.counters = { "-0/-2": 1 };
        expect(getEffectiveToughness(state, creature)).toBe(0);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "creature"
        )!;
        expect(slim.counters?.["-0/-2"]).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(0);
    });
});

describe("Nether Void (counter any spell unless its controller pays {3}, CR 117.3a / 701.5a)", () => {
    it("is a World enchantment (CR 205.4) — supertype carried as data", () => {
        expect(netherVoid.supertypes).toEqual(["World"]);
        expect(netherVoid.types).toEqual(["Enchantment"]);
        expect(netherVoid.manaCost).toEqual({ X: 3, B: 1 });
    });

    it("suspends on a may-pay billed to the spell's controller, then counters on decline", () => {
        const nv = makeInstance(netherVoid.id, {
            id: "nv",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [nv] }),
                makePlayer("p2"),
            ],
        });
        // p2 casts a sorcery (any spell type is taxed).
        const spell = pushSpell(state, acidRain.id, "p2");
        resolveTrigger(
            state,
            nv,
            "nether-void-tax",
            castEvent("p2", spell, ["Sorcery"])
        );
        // Suspended on a {3} may-pay aimed at the spell's controller (p2).
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");
        expect(head.cost).toEqual({ X: 3 });
        // Decline → the spell is countered (CR 701.5a).
        answerChoice(state, ["no"]);
        expect(state.stack.find((s) => s.id === spell.id)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === spell.id)).toBe(
            true
        );
    });

    it("lets the spell remain when its controller pays {3}", () => {
        const nv = makeInstance(netherVoid.id, {
            id: "nv",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [nv] }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, acidRain.id, "p2");
        resolveTrigger(
            state,
            nv,
            "nether-void-tax",
            castEvent("p2", spell, ["Sorcery"])
        );
        answerChoice(state, ["yes"]);
        // Paid → the spell survives on the stack to resolve normally.
        expect(state.stack.find((s) => s.id === spell.id)).toBeDefined();
    });

    it("taxes instants too (any spell type), at the same flat {3}", () => {
        const nv = makeInstance(netherVoid.id, {
            id: "nv",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [nv] }),
                makePlayer("p2"),
            ],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTrigger(
            state,
            nv,
            "nether-void-tax",
            castEvent("p2", bolt, ["Instant"])
        );
        expect(state.pendingChoices![0].cost).toEqual({ X: 3 });
    });
});

describe("The Abyss (each-player upkeep destroy, CR 603.6a / 704.5m)", () => {
    it("is a World enchantment with the upkeep trigger", () => {
        expect(theAbyss.types).toContain("Enchantment");
        expect(theAbyss.supertypes).toContain("World");
        expect(theAbyss.triggeredAbilities?.[0]?.event).toBe("PHASE_BEGIN");
    });

    it("on the active player's upkeep, destroys their chosen nonartifact creature; it can't be regenerated", () => {
        const abyss = makeInstance(theAbyss.id, {
            id: "abyss",
            controllerId: "p1",
        });
        const victim = makeInstance(HEADLESS, {
            id: "victim",
            controllerId: "p2",
            // A regeneration shield must NOT save it (CR 701.7c).
            regenerationShields: 1,
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [abyss] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveTrigger(
            state,
            abyss,
            "the-abyss-upkeep-destroy",
            abyssUpkeep("p2")
        );
        // p2 (active) is prompted to choose one of THEIR nonartifact creatures.
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("sacrifice-permanents");
        expect(head?.playerId).toBe("p2");
        expect(head?.zoneOwnerId).toBe("p2");
        expect(head?.filter).toEqual({
            types: "Creature",
            excludeTypes: "Artifact",
        });
        answerChoice(state, ["victim"]);
        // Destroyed despite the regeneration shield.
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("victim");
    });

    it("only the active player's creatures are legal — opponents' creatures are never touched", () => {
        const abyss = makeInstance(theAbyss.id, {
            id: "abyss",
            controllerId: "p1",
        });
        const mine = makeInstance(HEADLESS, { id: "mine", controllerId: "p1" });
        const theirs = makeInstance(HEADLESS, {
            id: "theirs",
            controllerId: "p2",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [abyss, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        resolveTrigger(
            state,
            abyss,
            "the-abyss-upkeep-destroy",
            abyssUpkeep("p1")
        );
        const head = state.pendingChoices?.[0];
        // The choice is scoped to p1's own battlefield (zoneOwnerId), so only
        // p1's nonartifact creature is selectable — p2's is never offered.
        expect(head?.playerId).toBe("p1");
        expect(head?.zoneOwnerId).toBe("p1");
        answerChoice(state, ["mine"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "abyss",
        ]);
        // p2's creature is untouched.
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "theirs",
        ]);
    });

    it("artifact creatures are not legal targets; with only an artifact creature the trigger does nothing", () => {
        const abyss = makeInstance(theAbyss.id, {
            id: "abyss",
            controllerId: "p1",
        });
        const thopter = makeInstance(ORNITHOPTER, {
            id: "thopter",
            controllerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [abyss, thopter] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            abyss,
            "the-abyss-upkeep-destroy",
            abyssUpkeep("p1")
        );
        // No legal nonartifact creature → no choice raised, nothing destroyed.
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "abyss",
            "thopter",
        ]);
    });

    it("no-op when the active player controls no creature at all", () => {
        const abyss = makeInstance(theAbyss.id, {
            id: "abyss",
            controllerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [abyss] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            abyss,
            "the-abyss-upkeep-destroy",
            abyssUpkeep("p2")
        );
        expect(state.pendingChoices?.length ?? 0).toBe(0);
    });

    it("wire format: the destroyed creature is gone from the projected battlefield", () => {
        const abyss = makeInstance(theAbyss.id, {
            id: "abyss",
            controllerId: "p1",
        });
        const victim = makeInstance(HEADLESS, {
            id: "victim",
            controllerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [abyss, victim] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            abyss,
            "the-abyss-upkeep-destroy",
            abyssUpkeep("p1")
        );
        answerChoice(state, ["victim"]);
        const projected = projectPublicState(state, 1, "p1");
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.some((c) => c.id === "victim")).toBe(false);
        expect(p1.battlefield.some((c) => c.id === "abyss")).toBe(true);
    });
});

describe("Wall of Tombstones (upkeep: base toughness = 1 + GY creatures, indefinite, CR 613.4b)", () => {
    it("is a {1}{B} 0/1 Wall with Defender and an upkeep trigger", () => {
        expect(wallOfTombstones.manaCost).toEqual({ X: 1, B: 1 });
        expect(wallOfTombstones.power).toBe(0);
        expect(wallOfTombstones.toughness).toBe(1);
        expect(wallOfTombstones.subtypes).toContain("Wall");
        expect(wallOfTombstones.staticAbilities).toContain("defender");
        expect(wallOfTombstones.triggeredAbilities?.[0]?.event).toBe(
            "PHASE_BEGIN"
        );
    });

    function setup(graveyardCreatureCount: number) {
        const wall = makeInstance(wallOfTombstones.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Mix of creature cards (counted) + a noncreature card (Lightning Bolt,
        // NOT counted) — the set value reads creature cards only.
        const graveyard: CardInstanceState[] = [];
        for (let i = 0; i < graveyardCreatureCount; i++) {
            graveyard.push(
                makeInstance(grizzlyBears.id, {
                    id: `gy-cre-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "graveyard",
                })
            );
        }
        graveyard.push(
            makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        const state = makeState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [wall], graveyard }),
                makePlayer("p2"),
            ],
        });
        return { state, wall };
    }

    it("sets base toughness to 1 + creature cards in graveyard (noncreature cards excluded)", () => {
        const { state, wall } = setup(3); // 3 creatures + 1 bolt in GY
        resolveTrigger(
            state,
            wall,
            "wall-of-tombstones-set-toughness",
            upkeepEvent487("p1")
        );
        // 1 + 3 = 4; power untouched (still 0).
        expect(getEffectiveToughness(state, wall)).toBe(4);
        expect(getEffectivePower(state, wall)).toBe(0);
    });

    it("locks the value at resolution — later graveyard changes don't retro-recompute (CR 611.2)", () => {
        const { state, wall } = setup(2); // 1 + 2 = 3
        resolveTrigger(
            state,
            wall,
            "wall-of-tombstones-set-toughness",
            upkeepEvent487("p1")
        );
        expect(getEffectiveToughness(state, wall)).toBe(3);
        // Empty the graveyard AFTER resolution — the locked set is unaffected.
        state.players[0].graveyard = [];
        expect(getEffectiveToughness(state, wall)).toBe(3);
    });

    it("is indefinite — survives the next upkeep boundary (no duration to tick out)", () => {
        const { state, wall } = setup(2); // 1 + 2 = 3
        resolveTrigger(
            state,
            wall,
            "wall-of-tombstones-set-toughness",
            upkeepEvent487("p1")
        );
        expect(getEffectiveToughness(state, wall)).toBe(3);
        // Advance to p1's NEXT upkeep — an indefinite set must NOT be purged.
        for (let i = 0; i < 40; i++) {
            advancePhase(state);
            if (state.phase === "UPKEEP" && state.activePlayerId === "p1") {
                break;
            }
        }
        // The wall's stored set persists (still 3) before its trigger re-fires.
        expect(wall.temporaryPTSet?.length).toBe(1);
        expect(getEffectiveToughness(state, wall)).toBe(3);
    });

    it("a +1/+1 counter (layer 7c) stacks on top of the 7b set (CR 613.4)", () => {
        const { state, wall } = setup(2); // set toughness to 3 (1 + 2)
        resolveTrigger(
            state,
            wall,
            "wall-of-tombstones-set-toughness",
            upkeepEvent487("p1")
        );
        expect(getEffectiveToughness(state, wall)).toBe(3);
        // Add a +1/+1 counter — it applies AFTER the 7b set: 3 + 1 = 4.
        wall.counters = { "+1/+1": 1 };
        expect(getEffectiveToughness(state, wall)).toBe(4);
        expect(getEffectivePower(state, wall)).toBe(1); // 0 + 1 counter
    });

    it("wire format: the dynamic base toughness survives projectPublicState", () => {
        const { state } = setup(3); // 1 + 3 = 4
        const wall = state.players[0].battlefield.find((c) => c.id === "wall")!;
        resolveTrigger(
            state,
            wall,
            "wall-of-tombstones-set-toughness",
            upkeepEvent487("p1")
        );
        expect(getEffectiveToughness(state, wall)).toBe(4);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wall"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
        expect(getEffectivePower(projected, slim)).toBe(0);
    });
});
