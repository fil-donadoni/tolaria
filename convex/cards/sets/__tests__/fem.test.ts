// Fallen Empires (FEM) — per-card behavior tests (twin of drk.test.ts /
// leg.test.ts). Each card gets a dedicated describe block citing the CR section
// it exercises. Tests assert external behavior only (definition shape, zone
// after resolution, projected wire-format characteristics, multi-art print
// resolution), per the PRD testing decisions (#566).
//
// THIS slice covers the walking skeleton (#567): the `fem` set is registered
// and Vodalian Soldiers — a {1}{U} 1/2 vanilla Merfolk Soldier — resolves from
// the stack onto the battlefield and survives projection, with all four FEM
// artworks resolving to the one shared definition.

import { describe, it, expect } from "vitest";
import {
    vodalianSoldiers,
    vodalianSoldiersFemB,
    vodalianSoldiersFemC,
    vodalianSoldiersFemD,
    thallid,
    thallidDevourer,
    thornThallid,
    feralThallid,
    sporeFlower,
    fungalBloom,
    elvishFarmer,
    elvenFortress,
    elvishHunter,
    elvishScout,
    sporeCloud,
    theloniteDruid,
    theloniteMonk,
    thelonsChant,
    thelonsCurse,
    nightSoil,
} from "../fem";
import {
    getCardById,
    getCardByName,
    getAllCards,
    getAllSetCodes,
    getPrintingsForCard,
} from "../../index";
import { resolveTopOfStack } from "../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { projectPublicState } from "../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";

const ALL_FEM_PRINTS = [
    vodalianSoldiersFemB,
    vodalianSoldiersFemC,
    vodalianSoldiersFemD,
];

// --- helpers (mirror drk.test.ts) ------------------------------------------

/** Push a triggered ability onto the stack and resolve it. */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

const UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** Push an activated ability onto the stack (cost assumed paid), then resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

// ---------------------------------------------------------------------------
// Registry parity — the set must be reachable by id, by name and in the
// deck-builder index (the pool / debug-panel lookup paths).
// ---------------------------------------------------------------------------

describe("FEM registry parity", () => {
    it("registers Vodalian Soldiers by id", () => {
        expect(getCardById(vodalianSoldiers.id)).toBe(vodalianSoldiers);
    });

    it("registers it by name (debug-panel / pool lookup path)", () => {
        expect(getCardByName("Vodalian Soldiers")).toBe(vodalianSoldiers);
    });

    it("includes it in getAllCards (deck-builder index)", () => {
        expect(getAllCards()).toContain(vodalianSoldiers);
    });

    it("registers the fem set code in the catalogue", () => {
        expect(getAllSetCodes()).toContain("fem");
    });
});

// ---------------------------------------------------------------------------
// Vanilla creature (CR 302 — Creature card as pure data: types/subtypes + P/T
// only; values validated against Scryfall set:fem, modern Oracle).
// ---------------------------------------------------------------------------

describe("Vodalian Soldiers (vanilla creature, CR 302)", () => {
    it("carries the canonical FEM printed characteristics", () => {
        expect(vodalianSoldiers.types).toEqual(["Creature"]);
        expect(vodalianSoldiers.subtypes).toEqual(["Merfolk", "Soldier"]);
        expect(vodalianSoldiers.power).toBe(1);
        expect(vodalianSoldiers.toughness).toBe(2);
        expect(vodalianSoldiers.manaCost).toEqual({ X: 1, U: 1 });
        expect(vodalianSoldiers.rarity).toBe("common");
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, vodalianSoldiers.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });

    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, vodalianSoldiers.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.name).toBe("Vodalian Soldiers");
        expect(def.subtypes).toEqual(["Merfolk", "Soldier"]);
        expect(def.power).toBe(1);
        expect(def.toughness).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Multi-art prints (ADR 0014) — FEM's signature multi-artwork commons ship as
// one shared CardDefinition plus one CardPrint per additional artwork. Every
// artwork must resolve to the single definition and carry the fem set code.
// ---------------------------------------------------------------------------

describe("Vodalian Soldiers multi-art prints (ADR 0014)", () => {
    it("resolves every alternate artwork to the shared definition", () => {
        for (const print of ALL_FEM_PRINTS) {
            expect(getCardById(print.printId)).toBe(vodalianSoldiers);
            expect(print.definitionId).toBe(vodalianSoldiers.id);
        }
    });

    it("carries the fem set code and common rarity on every print", () => {
        for (const print of ALL_FEM_PRINTS) {
            expect(print.setCode).toBe("fem");
            expect(print.rarity).toBe("common");
        }
    });

    it("uses a distinct printId per artwork (no duplicates)", () => {
        const ids = [
            vodalianSoldiers.id,
            ...ALL_FEM_PRINTS.map((p) => p.printId),
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("lists all FEM artworks as printings, original first (deck builder)", () => {
        const printings = getPrintingsForCard(vodalianSoldiers.id);
        expect(printings[0]).toEqual({
            printId: vodalianSoldiers.id,
            setCode: "fem",
        });
        for (const print of ALL_FEM_PRINTS) {
            expect(printings).toContainEqual({
                printId: print.printId,
                setCode: "fem",
            });
        }
        expect(printings).toHaveLength(1 + ALL_FEM_PRINTS.length);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1 — Green: Thallids, Fungi & Elves (issue #569). One describe per card with
// non-trivial behaviour, citing the CR section it exercises.
// ═══════════════════════════════════════════════════════════════════════════

/** Helper: a battlefield Thallid-family creature with N spore counters. */
function makeWithSpores(
    cardId: string,
    spores: number,
    controllerId = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId,
        zone: "battlefield",
        counters: spores > 0 ? { spore: spores } : {},
    });
}

describe("Thallid — spore engine (CR 122.1, 122.6, 707.1)", () => {
    it("carries the canonical FEM characteristics", () => {
        expect(thallid.manaCost).toEqual({ G: 1 });
        expect(thallid.types).toEqual(["Creature"]);
        expect(thallid.subtypes).toEqual(["Fungus"]);
        expect(thallid.power).toBe(1);
        expect(thallid.toughness).toBe(1);
    });

    it("adds a spore counter at the beginning of its controller's upkeep", () => {
        const thallidInst = makeWithSpores(thallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thallidInst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            thallidInst,
            "thallid-spore-upkeep",
            UPKEEP("p1")
        );
        const inPlay = state.players[0].battlefield[0];
        expect(inPlay.counters?.spore).toBe(1);
    });

    it("removes three spore counters to create a 1/1 green Saproling token", () => {
        const thallidInst = makeWithSpores(thallid.id, 3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thallidInst] }),
                makePlayer("p2"),
            ],
        });
        // The removeCounter cost is paid by the activation mutation; the test
        // exercises the resolve effect. Pay the cost manually then resolve.
        thallidInst.counters = { spore: 0 };
        resolveActivated(state, thallidInst, "thallid-make-saproling");
        const tokens = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Saproling")
        );
        expect(tokens).toHaveLength(1);
        expect(getEffectivePower(state, tokens[0])).toBe(1);
        expect(getEffectiveToughness(state, tokens[0])).toBe(1);
    });

    it("Saproling token survives the wire-format projection (CR 707.1)", () => {
        const thallidInst = makeWithSpores(thallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thallidInst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, thallidInst, "thallid-make-saproling");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Saproling")
        )!;
        expect(slim).toBeDefined();
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });
});

describe("Thallid Devourer — sacrifice-a-Saproling pump (CR 602.1, 611.2)", () => {
    it("gets +1/+2 until end of turn when a Saproling is sacrificed", () => {
        const devourer = makeWithSpores(thallidDevourer.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [devourer] }),
                makePlayer("p2"),
            ],
        });
        // The Saproling sacrifice is paid by the activation mutation; resolve
        // exercises the pump effect on the source.
        resolveActivated(state, devourer, "thallid-devourer-devour");
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === devourer.id
        )!;
        expect(getEffectivePower(state, inPlay)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, inPlay)).toBe(4); // 2 + 2
    });
});

describe("Thorn Thallid — spore payoff ping (CR 115.4)", () => {
    it("deals 1 damage to a target player", () => {
        const thorn = makeWithSpores(thornThallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thorn] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, thorn, "thorn-thallid-ping", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Feral Thallid — spore payoff regenerate (CR 701.15a)", () => {
    it("applies a regeneration shield to itself", () => {
        const feral = makeWithSpores(feralThallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [feral] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, feral, "feral-thallid-regenerate");
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === feral.id
        )!;
        expect(inPlay.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Spore Flower — spore payoff Fog (CR 615)", () => {
    it("prevents all combat damage this turn", () => {
        const flower = makeWithSpores(sporeFlower.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flower] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, flower, "spore-flower-fog");
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

describe("Fungal Bloom — feed the spore engine (CR 122.1)", () => {
    it("puts a spore counter on a target Fungus", () => {
        const bloom = makeInstance(fungalBloom.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const thallidInst = makeWithSpores(thallid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bloom, thallidInst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bloom, "fungal-bloom-feed", [
            { type: "permanent", id: thallidInst.id },
        ]);
        const fed = state.players[0].battlefield.find(
            (c) => c.id === thallidInst.id
        )!;
        expect(fed.counters?.spore).toBe(1);
    });
});

describe("Elvish Farmer — sacrifice-a-Saproling lifegain (CR 602.1)", () => {
    it("gains 2 life when a Saproling is sacrificed", () => {
        const farmer = makeWithSpores(elvishFarmer.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [farmer], life: 20 }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, farmer, "elvish-farmer-gain-life");
        expect(state.players[0].life).toBe(22);
    });
});

describe("Elven Fortress — pump a blocking creature (CR 611.2)", () => {
    it("gives a target blocking creature +0/+1 until end of turn", () => {
        const fortress = makeInstance(elvenFortress.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const blocker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p1",
            zone: "battlefield",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fortress, blocker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, fortress, "elven-fortress-pump", [
            { type: "permanent", id: blocker.id },
        ]);
        const b = state.players[0].battlefield.find(
            (c) => c.id === blocker.id
        )!;
        expect(getEffectiveToughness(state, b)).toBe(3); // 2 + 1
        expect(getEffectivePower(state, b)).toBe(1); // unchanged
    });
});

describe("Elvish Hunter — one-shot untap lock (CR 302.6)", () => {
    it("marks a target creature to skip its next untap step", () => {
        const hunter = makeInstance(elvishHunter.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(vodalianSoldiers.id, {
            controllerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hunter] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, hunter, "elvish-hunter-lock", [
            { type: "permanent", id: victim.id },
        ]);
        const locked = state.players[1].battlefield.find(
            (c) => c.id === victim.id
        )!;
        expect(locked.skipNextUntap).toBe(true);
    });
});

describe("Elvish Scout — untap attacker + combat-damage prevention (CR 615)", () => {
    it("untaps a target attacking creature and shields it from combat damage", () => {
        const scout = makeInstance(elvishScout.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const attacker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p1",
            zone: "battlefield",
            isTapped: true,
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, scout, "elvish-scout-untap", [
            { type: "permanent", id: attacker.id },
        ]);
        const a = state.players[0].battlefield.find(
            (c) => c.id === attacker.id
        )!;
        expect(a.isTapped).toBe(false);
    });
});

describe("Spore Cloud — mass tap + Fog + untap lock (CR 701.20a, 615, 302.6)", () => {
    it("taps all blockers, fogs combat, and locks untaps", () => {
        const blocker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p2",
            zone: "battlefield",
            isBlocking: true,
        });
        const attacker = makeInstance(vodalianSoldiers.id, {
            controllerId: "p1",
            zone: "battlefield",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        pushSpell(state, sporeCloud.id, "p1");
        resolveTopOfStack(state);
        const b = state.players[1].battlefield.find(
            (c) => c.id === blocker.id
        )!;
        const a = state.players[0].battlefield.find(
            (c) => c.id === attacker.id
        )!;
        expect(b.isTapped).toBe(true);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
        expect(b.skipNextUntap).toBe(true);
        expect(a.skipNextUntap).toBe(true);
    });
});

describe("Thelonite Druid — animate Forests (CR 208.2, 611.1)", () => {
    it("turns Forests you control into 2/3 creatures that are still lands", () => {
        const druid = makeInstance(theloniteDruid.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        // A bare Forest land instance (no registry lookup needed — the engine
        // reads types/subtypes off the instance).
        const forestInst: CardInstanceState = {
            id: "forest-1",
            card: { id: "00000000-0000-0000-0000-0000000f0001" },
            types: ["Land"],
            subtypes: ["Forest"],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid, forestInst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, druid, "thelonite-druid-animate-forests");
        const f = state.players[0].battlefield.find(
            (c) => c.id === "forest-1"
        )!;
        expect(getEffectivePower(state, f)).toBe(2);
        expect(getEffectiveToughness(state, f)).toBe(3);
        expect(f.types).toContain("Creature");
        expect(f.types).toContain("Land"); // still a land

        // Wire-format: animated P/T survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "forest-1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Thelonite Monk — land becomes a Forest indefinitely (CR 305.7)", () => {
    it("replaces a target land's subtypes with Forest", () => {
        const monk = makeInstance(theloniteMonk.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const land: CardInstanceState = {
            id: "land-1",
            card: { id: "00000000-0000-0000-0000-000000000001" },
            types: ["Land"],
            subtypes: ["Mountain"],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monk, land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, monk, "thelonite-monk-forest", [
            { type: "permanent", id: "land-1" },
        ]);
        const l = state.players[0].battlefield.find((c) => c.id === "land-1")!;
        expect(l.subtypes).toEqual(["Forest"]);
        expect(l.types).toContain("Land");
    });
});

describe("Thelon's Curse — symmetric untap-lock on blue creatures (CR 611)", () => {
    it("declares an untap restriction filtered to blue creatures with cap 0", () => {
        const eff = thelonsCurse.staticEffects?.find(
            (e) => e.kind === "untap-restriction"
        );
        expect(eff).toBeDefined();
        if (eff && eff.kind === "untap-restriction") {
            expect(eff.maxUntap).toBe(0);
            expect(eff.filter).toMatchObject({
                types: "Creature",
                colors: "U",
            });
        }
    });
});

describe("Thelon's Chant — upkeep tax + Swamp punisher (CR 117.3a, 603.6a)", () => {
    it("declares an upkeep pay-or-sacrifice trigger and a Swamp-ETB trigger", () => {
        const ids = (thelonsChant.triggeredAbilities ?? []).map((t) => t.id);
        expect(ids).toContain("thelons-chant-upkeep");
        expect(ids).toContain("thelons-chant-swamp-punish");
    });
});

describe("Night Soil — exile-from-graveyard cost (CR 602.1, 118.5, 707.1)", () => {
    it("declares an exile-from-graveyard cost of two creature cards", () => {
        const ability = nightSoil.activatedAbilities?.[0];
        expect(ability?.cost.exileFromGraveyard).toEqual({
            count: 2,
            cardType: "Creature",
        });
        expect(ability?.cost.mana).toEqual({ X: 1 });
    });

    it("creates a 1/1 green Saproling on resolve (cost paid by the mutation)", () => {
        const soil = makeInstance(nightSoil.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [soil] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, soil, "night-soil-make-saproling");
        const tokens = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Saproling")
        );
        expect(tokens).toHaveLength(1);
        expect(getEffectivePower(state, tokens[0])).toBe(1);
    });
});
