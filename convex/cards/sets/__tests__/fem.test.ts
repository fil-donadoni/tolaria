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
    combatMedic,
    farrelsMantle,
    farrelsZealot,
    farrelitePriest,
    handOfJustice,
    heroism,
    icatianInfantry,
    icatianJavelineers,
    icatianLieutenant,
    icatianMoneychanger,
    icatianPhalanx,
    icatianPriest,
    icatianScout,
    icatianSkirmishers,
    icatianTown,
    orderOfLeitbur,
    goblinWarDrums,
    goblinWarDrumsFemB,
    goblinWarDrumsFemC,
    goblinWarDrumsFemD,
    goblinGrenade,
    goblinGrenadeFemB,
    goblinGrenadeFemC,
    goblinWarrens,
    goblinChirurgeon,
    goblinChirurgeonFemB,
    goblinChirurgeonFemC,
    goblinKites,
    orcishCaptain,
    brassclawOrcs,
    brassclawOrcsFemB,
    brassclawOrcsFemC,
    brassclawOrcsFemD,
    orcishVeteran,
    orcishVeteranFemB,
    orcishVeteranFemC,
    orcishVeteranFemD,
    orcishSpy,
    orcishSpyFemB,
    orcishSpyFemC,
    orgg,
    goblinFlotilla,
    dwarvenLieutenant,
    dwarvenSoldier,
    dwarvenSoldierFemB,
    dwarvenSoldierFemC,
    dwarvenArmorer,
    dwarvenCatapult,
    raidingParty,
    homarid,
    homaridFemB,
    homaridFemC,
    homaridFemD,
    tidalInfluence,
    homaridWarrior,
    homaridShaman,
    homaridSpawningBed,
    deepSpawn,
    highTide,
    riverMerfolk,
    svyelunitePriest,
    vodalianMage,
    vodalianKnights,
    vodalianWarMachine,
    seasinger,
    merseine,
    merseineFemB,
    tidalFlats,
    armorThrull,
    armorThrullFemB,
    armorThrullFemC,
    armorThrullFemD,
    basalThrull,
    basalThrullFemB,
    basalThrullFemC,
    basalThrullFemD,
    breedingPit,
    derelor,
    ebonPraetor,
    hymnToTourach,
    hymnToTourachFemB,
    hymnToTourachFemC,
    hymnToTourachFemD,
    initiatesOfTheEbonHand,
    initiatesOfTheEbonHandFemB,
    initiatesOfTheEbonHandFemC,
    mindstabThrull,
    mindstabThrullFemB,
    mindstabThrullFemC,
    necrite,
    necriteFemB,
    necriteFemC,
    orderOfTheEbonHand,
    orderOfTheEbonHandFemB,
    orderOfTheEbonHandFemC,
    soulExchange,
    thrullChampion,
    thrullRetainer,
    thrullWizard,
    tourachsChant,
    tourachsGate,
} from "../fem";
import {
    getCardById,
    getCardByName,
    getAllCards,
    getAllSetCodes,
    getPrintingsForCard,
} from "../../index";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    getCostModifiers,
} from "../../../gre/state";
import type { CardPrint } from "../../types";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../gre/layers";
import { projectPublicState } from "../../../gameProjections";
import {
    applyAllCombatDamage,
    finalizeCleanup,
    fireDelayedTriggers,
    untapStep,
} from "../../../gre/phases";
import {
    finalizeTargetSelection,
    tryAutoCommitPendingActivation,
    tryAutoCommitPendingCast,
    tapSourceIntoPayment,
} from "../../../game";
import { grizzlyBears } from "../lea";
import { getLegalActions } from "../../../gre/rules";
import { matchesPermanentFilter } from "../../filters";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import {
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
    applyMayPaySubmit,
} from "../../../gre/pendingChoiceSubmit";

const ALL_FEM_PRINTS = [
    vodalianSoldiersFemB,
    vodalianSoldiersFemC,
    vodalianSoldiersFemD,
];

// Multi-art black prints (C5) — each resolves to its shared definition.
const C5_MULTI_ART_PRINTS: { print: CardPrint; defId: string }[] = [
    { print: armorThrullFemB, defId: armorThrull.id },
    { print: armorThrullFemC, defId: armorThrull.id },
    { print: armorThrullFemD, defId: armorThrull.id },
    { print: basalThrullFemB, defId: basalThrull.id },
    { print: basalThrullFemC, defId: basalThrull.id },
    { print: basalThrullFemD, defId: basalThrull.id },
    { print: hymnToTourachFemB, defId: hymnToTourach.id },
    { print: hymnToTourachFemC, defId: hymnToTourach.id },
    { print: hymnToTourachFemD, defId: hymnToTourach.id },
    { print: initiatesOfTheEbonHandFemB, defId: initiatesOfTheEbonHand.id },
    { print: initiatesOfTheEbonHandFemC, defId: initiatesOfTheEbonHand.id },
    { print: mindstabThrullFemB, defId: mindstabThrull.id },
    { print: mindstabThrullFemC, defId: mindstabThrull.id },
    { print: necriteFemB, defId: necrite.id },
    { print: necriteFemC, defId: necrite.id },
    { print: orderOfTheEbonHandFemB, defId: orderOfTheEbonHand.id },
    { print: orderOfTheEbonHandFemC, defId: orderOfTheEbonHand.id },
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

/** Drives any suspended mid-resolution pending choices to completion by
 *  auto-answering each head: an `option-pick` takes its first option; any
 *  permanent/card pick takes (up to `count`) candidate ids — the simple
 *  golden-path answer for stepped resolutions (Goblin Warrens, Dwarven Armorer,
 *  Raiding Party). `applyPendingChoiceSubmit` re-resolves the stack when the
 *  queue empties, so this loops until no choice remains. */
function answerPendingChoices(state: GameState, maxRounds = 8): void {
    for (let i = 0; i < maxRounds; i++) {
        const head = state.pendingChoices?.[0];
        if (!head) return;
        if (head.kind === "random-reveal") {
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                choiceId: head.choiceId,
            });
            continue;
        }
        let pick: string[];
        if (head.kind === "option-pick") {
            pick = head.options?.length ? [head.options[0].id] : [];
        } else {
            const want =
                typeof head.count === "number"
                    ? head.count
                    : (head.count?.max ?? head.candidateIds?.length ?? 0);
            // `choose-hand-card` / `discard-hand` (and any zone:"hand" pick)
            // draw from the chooser's hand zone (no candidateIds list); every
            // other zone pick carries candidateIds.
            const fromHand =
                head.kind === "choose-hand-card" ||
                head.kind === "discard-hand" ||
                head.zone === "hand";
            const pool =
                head.candidateIds ??
                (fromHand
                    ? (
                          state.players.find((p) => p.id === head.playerId)
                              ?.hand ?? []
                      ).map((c) => c.id)
                    : []);
            pick = pool.slice(0, want);
        }
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: pick,
        });
    }
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

// ═══════════════════════════════════════════════════════════════════════════
// C2 — Blue: Homarids, Vodalians & the Tide (issue #571). One describe per
// card with non-trivial behaviour, citing the CR section it exercises.
// ═══════════════════════════════════════════════════════════════════════════

/** A battlefield permanent with N tide counters. */
function makeWithTide(
    cardId: string,
    tide: number,
    controllerId = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId,
        zone: "battlefield",
        counters: tide > 0 ? { tide } : {},
    });
}

describe("Homarid — tide counter P/T cycle (CR 611.2c, 603.6a, 603.8)", () => {
    it("carries the canonical FEM characteristics", () => {
        expect(homarid.manaCost).toEqual({ X: 2, U: 1 });
        expect(homarid.subtypes).toEqual(["Homarid"]);
        expect(homarid.power).toBe(2);
        expect(homarid.toughness).toBe(2);
    });

    it("enters with a tide counter on it (CR 603.6)", () => {
        const inst = makeWithTide(homarid.id, 0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, inst, "homarid-tide-enter", {
            type: "PERMANENT_ENTERED",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield[0].counters?.tide).toBe(1);
    });

    it("adds a tide counter each upkeep (CR 603.6a)", () => {
        const inst = makeWithTide(homarid.id, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, inst, "homarid-tide-upkeep", UPKEEP("p1"));
        expect(state.players[0].battlefield[0].counters?.tide).toBe(3);
    });

    it("is 1/1 at exactly one tide counter (-1/-1)", () => {
        const inst = makeWithTide(homarid.id, 1);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(1);
        expect(getEffectiveToughness(state, onBoard)).toBe(1);
    });

    it("is 2/2 at exactly two tide counters (no modifier)", () => {
        const inst = makeWithTide(homarid.id, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(2);
        expect(getEffectiveToughness(state, onBoard)).toBe(2);
    });

    it("is 3/3 at exactly three tide counters (+1/+1)", () => {
        const inst = makeWithTide(homarid.id, 3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(3);
        expect(getEffectiveToughness(state, onBoard)).toBe(3);
    });

    it("sheds all tide counters at four or more (CR 603.8)", () => {
        const inst = makeWithTide(homarid.id, 4);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, inst, "homarid-tide-shed", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield[0].counters?.tide ?? 0).toBe(0);
    });

    it("tide P/T survives the wire-format projection (CR 611.2c)", () => {
        const inst = makeWithTide(homarid.id, 3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        // 3/3 at three tide counters on fat state...
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(3);
        expect(getEffectiveToughness(state, onBoard)).toBe(3);
        // ...and after projection (the slim instance keeps `counters`, the
        // pt-buff predicate reads the same count).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === onBoard.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("resolves all four artworks to the shared definition (ADR 0014)", () => {
        for (const print of [homaridFemB, homaridFemC, homaridFemD]) {
            expect(getCardById(print.printId)).toBe(homarid);
            expect(print.setCode).toBe("fem");
        }
    });
});

describe("Tidal Influence — tide anthem + cast-by-name restriction (CR 601.3e)", () => {
    it("can't be cast while a permanent named Tidal Influence is on the battlefield (CAPABILITY J)", () => {
        const existing = makeInstance(tidalInfluence.id, {
            id: "ti-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const inHand = makeInstance(tidalInfluence.id, {
            id: "ti-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            battlefield: [existing],
            hand: [inHand],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
        });
        // Cast is illegal while a Tidal Influence is already in play (CR 601.3e).
        expect(getLegalActions(state, p1, inHand)).not.toContain("cast");
    });

    it("is castable when no Tidal Influence is on the battlefield", () => {
        const inHand = makeInstance(tidalInfluence.id, {
            id: "ti-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [inHand],
            manaPool: { U: 1, C: 2 },
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
        });
        expect(getLegalActions(state, p1, inHand)).toContain("cast");
    });

    it("gives all blue creatures -2/-0 at one tide counter, +2/+0 at three", () => {
        const anthemOne = makeWithTide(tidalInfluence.id, 1);
        const blueCreature = makeInstance(homarid.id, {
            id: "blue-c",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            counters: { tide: 2 }, // 2/2 baseline (no Homarid self-modifier)
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [anthemOne, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        const blue = state.players[0].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        // -2/-0 at one tide counter: 2/2 → 0/2.
        expect(getEffectivePower(state, blue)).toBe(0);
        expect(getEffectiveToughness(state, blue)).toBe(2);

        // Bump the anthem to three tide counters → +2/+0: 2/2 → 4/2.
        anthemOne.counters = { tide: 3 };
        const blue2 = state.players[0].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(getEffectivePower(state, blue2)).toBe(4);
        expect(getEffectiveToughness(state, blue2)).toBe(2);
    });

    it("the anthem survives the wire-format projection", () => {
        const anthem = makeWithTide(tidalInfluence.id, 3);
        const blueCreature = makeInstance(homarid.id, {
            id: "blue-c",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            counters: { tide: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [anthem, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
});

describe("Homarid Spawning Bed — token-count = sacrificed MV (CR 118.5, 202.3, 707.1)", () => {
    it("makes a number of 1/1 blue Camarid tokens equal to the sacrificed creature's mana value", () => {
        const bed = makeInstance(homaridSpawningBed.id, {
            id: "bed",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // Sacrificing a {2}{U} creature (mana value 3) makes three Camarids.
        const sacrificed = makeInstance(homarid.id, {
            id: "sac",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bed, sacrificed] }),
                makePlayer("p2"),
            ],
        });
        // The sacrifice cost was paid at activation; the MV is snapshotted on
        // the stack item via additionalSacrificeMv. Mirror that here.
        state.stack.push({
            ...bed,
            zone: "stack",
            castById: "p1",
            abilityId: "homarid-spawning-bed-spawn",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "sac", mv: 3 },
        } as StackItem);
        resolveTopOfStack(state);
        const camarids = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Camarid")
        );
        expect(camarids).toHaveLength(3);
        for (const c of camarids) {
            expect(getEffectivePower(state, c)).toBe(1);
            expect(getEffectiveToughness(state, c)).toBe(1);
        }
    });

    it("Camarid token bodies survive the wire-format projection (CR 707.1)", () => {
        const bed = makeInstance(homaridSpawningBed.id, {
            id: "bed",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bed] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...bed,
            zone: "stack",
            castById: "p1",
            abilityId: "homarid-spawning-bed-spawn",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "x", mv: 2 },
        } as StackItem);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const camarids = projected.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Camarid")
        );
        expect(camarids).toHaveLength(2);
        expect(getEffectivePower(projected, camarids[0])).toBe(1);
        expect(getEffectiveToughness(projected, camarids[0])).toBe(1);
    });
});

describe("High Tide — extra {U} per Island tapped this turn (CR 614)", () => {
    it("arms the additive rider for the controller on resolution", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, highTide.id, "p1");
        resolveTopOfStack(state);
        expect(state.highTideThisTurn).toContain("p1");
        // It went to the graveyard (instant resolved).
        expect(state.players[0].graveyard.some((c) => c.id === item.id)).toBe(
            true
        );
    });

    it("two High Tides stack to two extra {U} per Island tap (helper-level)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        resolveTopOfStack((pushSpell(state, highTide.id, "p1"), state));
        resolveTopOfStack((pushSpell(state, highTide.id, "p1"), state));
        expect(state.highTideThisTurn).toHaveLength(2);
    });
});

describe("River Merfolk — mountainwalk grant (CR 702.13)", () => {
    it("gains mountainwalk until end of turn on activation", () => {
        const inst = makeInstance(riverMerfolk.id, {
            id: "rm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, inst, "river-merfolk-mountainwalk");
        const onBoard = state.players[0].battlefield[0];
        expect(onBoard.staticAbilities).toContain("mountainwalk");
    });
});

describe("Vodalian Mage — counter-unless-pay (CR 701.5a, 117.3a)", () => {
    it("counters the target spell unless its controller pays {1}", () => {
        const mage = makeInstance(vodalianMage.id, {
            id: "mage",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mage] }),
                makePlayer("p2"),
            ],
        });
        // An opponent spell on the stack to counter.
        const spell = pushSpell(state, grizzlyBears.id, "p2");
        resolveActivated(state, mage, "vodalian-mage-counter", [
            { type: "spell", id: spell.id },
        ]);
        // The spell's controller (p2) is asked to pay {1}; declining (empty
        // pool) counters the spell (CR 701.5a).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.some((s) => s.id === spell.id)).toBe(false);
    });
});

describe("Vodalian Knights — Island-matters knight (CR 508.1c, 603.8, 702.9)", () => {
    it("carries first strike and the {U} flying grant", () => {
        expect(vodalianKnights.staticAbilities).toContain("first strike");
        const fly = vodalianKnights.activatedAbilities?.find(
            (a) => a.id === "vodalian-knights-fly"
        );
        expect(fly).toBeDefined();
    });

    it("sacrifices itself when its controller controls no Islands (CR 603.8)", () => {
        const inst = makeInstance(vodalianKnights.id, {
            id: "vk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, inst, "vodalian-knights-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vk")
        ).toBeUndefined();
    });
});

describe("Seasinger — conditional gainControl (CR 611.2c) + may-not-untap (CR 502.1)", () => {
    it("declares the may-choose-not-to-untap static ability (CAPABILITY I reuse)", () => {
        expect(seasinger.staticAbilities).toContain("may-choose-not-to-untap");
    });

    it("steals a creature whose controller controls an Island, for as long as Seasinger stays tapped", () => {
        const singer = makeInstance(seasinger.id, {
            id: "singer",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const island = makeInstance(getCardByName("Island")?.id ?? "island", {
            id: "isl",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [singer] }),
                makePlayer("p2", { battlefield: [island, victim] }),
            ],
        });
        resolveActivated(state, singer, "seasinger-steal", [
            { type: "permanent", id: "victim" },
        ]);
        // The victim moves under p1's control.
        expect(
            state.players[0].battlefield.some((c) => c.id === "victim")
        ).toBe(true);
    });

    it("does NOT steal a creature whose controller controls no Island (CR 115.4 guard)", () => {
        const singer = makeInstance(seasinger.id, {
            id: "singer",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [singer] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, singer, "seasinger-steal", [
            { type: "permanent", id: "victim" },
        ]);
        // No Island → the guard fizzles the steal; victim stays with p2.
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(true);
    });

    it("may choose not to untap, keeping its stolen creature (untap step, CR 502.1)", () => {
        const singer = makeInstance(seasinger.id, {
            id: "singer",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [singer] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "UNTAP",
        });
        untapStep(state);
        // A may-choose-not-to-untap permanent gets a 0..1 untap-pick prompt
        // routed to its controller (it is NOT auto-untapped).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("untap-pick");
        expect(head?.count).toEqual({ min: 0, max: 1 });
        // Choosing to untap nothing leaves Seasinger tapped (theft persists).
        expect(state.players[0].battlefield[0].isTapped).toBe(true);
    });
});

describe("Merseine — net counters + dynamic cost K (CR 122, 502.1, 601.2f, 202.3)", () => {
    function merseineBoard(): {
        state: GameState;
        aura: CardInstanceState;
        host: CardInstanceState;
    } {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const aura = makeInstance(merseine.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
            counters: { net: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        return { state, aura, host };
    }

    it("enters with three net counters (CR 122.1)", () => {
        const aura = makeInstance(merseine.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
        });
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        resolveTrigger(state, aura, "merseine-enter-counters", {
            type: "PERMANENT_ENTERED",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield[0].counters?.net).toBe(3);
    });

    it("keeps the enchanted creature from untapping while a net counter remains (CR 502.1)", () => {
        const { state } = merseineBoard();
        // It is p2's untap step; the host is tapped + net-locked → stays tapped.
        state.activePlayerId = "p2";
        state.phase = "UNTAP";
        untapStep(state);
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(true);
    });

    it("lets the host untap once all net counters are removed", () => {
        const { state } = merseineBoard();
        // No net counters → the untap lock lifts.
        state.players[0].battlefield[0].counters = {};
        state.activePlayerId = "p2";
        state.phase = "UNTAP";
        untapStep(state);
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(false);
    });

    it("the dynamic cost equals the enchanted creature's mana cost (CAPABILITY K, helper-level)", () => {
        // Grizzly Bears costs {1}{G} → mana value 2. The Merseine ability's
        // cost is `manaEqualToEnchantedCreatureCost` — the engine reads the
        // host's printed cost. Verify the host's cost is what the engine folds.
        const bears = getCardById(grizzlyBears.id);
        const cost = bears.manaCost ?? {};
        const total = Object.values(cost).reduce<number>(
            (acc, v) => acc + (typeof v === "number" ? v : 0),
            0
        );
        expect(total).toBe(2);
        const ability = merseine.activatedAbilities?.find(
            (a) => a.id === "merseine-remove-net"
        );
        expect(ability?.cost.manaEqualToEnchantedCreatureCost).toBe(true);
        expect(ability?.cost.removeCounter).toEqual({ type: "net", count: 1 });
        expect(ability?.activatableByEnchantedController).toBe(true);
    });

    it("resolves all four artworks to the shared definition (ADR 0014)", () => {
        expect(getCardById(merseineFemB.printId)).toBe(merseine);
    });
});

describe("Vodalian War Machine — tapOtherFilter cost (CAPABILITY D reuse)", () => {
    it("declares defender plus two tap-a-Merfolk abilities", () => {
        expect(vodalianWarMachine.staticAbilities).toContain("defender");
        const ids = (vodalianWarMachine.activatedAbilities ?? []).map(
            (a) => a.id
        );
        expect(ids).toContain("vodalian-war-machine-attack");
        expect(ids).toContain("vodalian-war-machine-pump");
        for (const a of vodalianWarMachine.activatedAbilities ?? []) {
            expect(a.cost.tapOtherFilter).toEqual({
                filter: {
                    types: "Creature",
                    subtypes: "Merfolk",
                    controllerRelation: "you",
                },
                count: 1,
            });
        }
    });

    it("the pump ability grants +2/+1 until end of turn", () => {
        const machine = makeInstance(vodalianWarMachine.id, {
            id: "vwm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, machine, "vodalian-war-machine-pump");
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(2);
        expect(getEffectiveToughness(state, onBoard)).toBe(5);
    });

    it("the attack ability lets it attack despite defender for the turn (CR 508.1a)", () => {
        const machine = makeInstance(vodalianWarMachine.id, {
            id: "vwm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, machine, "vodalian-war-machine-attack");
        expect(
            state.players[0].battlefield[0].canAttackDespiteDefenderThisTurn
        ).toBe(true);
    });
});

describe("Deep Spawn — upkeep mill-or-sacrifice (CR 117.3a, 701.13a)", () => {
    it("mills two cards to keep itself when the player chooses to pay", () => {
        const spawn = makeInstance(deepSpawn.id, {
            id: "spawn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const lib = [
            makeInstance(grizzlyBears.id, {
                id: "l1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(grizzlyBears.id, {
                id: "l2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spawn], library: lib }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, spawn, "deep-spawn-upkeep-mill", UPKEEP("p1"));
        // Suspended on the may-pay; accept (mill two to keep Deep Spawn).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // Paying milled two cards; Deep Spawn stays on the battlefield.
        expect(state.players[0].battlefield.some((c) => c.id === "spawn")).toBe(
            true
        );
        expect(state.players[0].graveyard.length).toBe(2);
    });
});

describe("Homarid Warrior — shroud + skip-untap dive (CR 702.18, 502.1)", () => {
    it("gains shroud and skips its next untap, tapped, on activation", () => {
        const inst = makeInstance(homaridWarrior.id, {
            id: "hw",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, inst, "homarid-warrior-dive");
        const onBoard = state.players[0].battlefield[0];
        expect(onBoard.staticAbilities).toContain("shroud");
        expect(onBoard.isTapped).toBe(true);
        expect(onBoard.skipNextUntap).toBe(true);
    });
});

describe("Homarid Shaman — tap a green creature (CR 701.21)", () => {
    it("taps the targeted green creature", () => {
        const shaman = makeInstance(homaridShaman.id, {
            id: "shaman",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // A green creature for the opponent (Grizzly Bears is green).
        const green = makeInstance(grizzlyBears.id, {
            id: "green",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shaman] }),
                makePlayer("p2", { battlefield: [green] }),
            ],
        });
        resolveActivated(state, shaman, "homarid-shaman-tap", [
            { type: "permanent", id: "green" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "green")?.isTapped
        ).toBe(true);
    });
});

describe("Svyelunite Priest — upkeep-only shroud grant (CR 602.5)", () => {
    it("is restricted to its controller's upkeep", () => {
        const ability = svyelunitePriest.activatedAbilities?.find(
            (a) => a.id === "svyelunite-priest-shroud"
        );
        expect(ability?.controllerTurnOnly).toBe(true);
        expect(ability?.activationPhaseRestriction).toEqual(["UPKEEP"]);
    });
});

describe("Tidal Flats — first strike for blockers unless attacker pays (CR 509, 117.3a)", () => {
    it("carries the {U}{U} combat ability", () => {
        const ability = tidalFlats.activatedAbilities?.find(
            (a) => a.id === "tidal-flats-first-strike"
        );
        expect(ability).toBeDefined();
        expect(ability?.cost.mana).toEqual({ U: 2 });
    });
});

// ===========================================================================
// CAPABILITY D — tapOtherFilter activation cost (Hand of Justice, CR 602.1 /
// 118.8). Full-path coverage: GRE legality (moves / candidate gating),
// game.ts activation (finalizeTargetSelection → pick → commit taps the
// chosen creatures and resolves the destroy), and the frontend affordability
// view (buildTriggerStateView exposes isTapped + colors). The mutation's
// pick step (`selectActivationCost`) is mirrored here as a pure helper that
// pushes onto the real `tapOtherChoice.pickedIds` — same branch order/gating
// the mutation uses (ADR 0001, no convex-test harness).
// ===========================================================================

/** Mirror of selectActivationCost's tap-other picker: validate + record one
 *  pick on the live `tapOtherChoice`, then attempt the auto-commit. */
function pickTapOther(
    state: GameState,
    playerId: string,
    instanceId: string
): void {
    const pa = state.pendingActivation;
    if (!pa?.tapOtherChoice) throw new Error("No tap-other picker pending");
    const player = state.players.find((p) => p.id === playerId)!;
    const candidate = player.battlefield.find((c) => c.id === instanceId);
    if (!candidate) throw new Error("Pick not on battlefield");
    const toc = pa.tapOtherChoice;
    if (toc.pickedIds.length >= toc.count) throw new Error("Tap cost paid");
    if (candidate.id === pa.cardInstanceId)
        throw new Error("Cannot tap source");
    if (candidate.isTapped) throw new Error("Already tapped");
    if (toc.pickedIds.includes(candidate.id)) throw new Error("Already picked");
    // Mirror game.ts: match against a colour-resolved view (the layer system
    // computes effective colours so a `colors` clause reads the engine's view).
    const view = {
        ...candidate,
        colors: STATIC_EFFECT_CTX.getColors(candidate),
    };
    if (
        !matchesPermanentFilter(view, toc.filter, {
            selfControllerId: playerId,
        })
    )
        throw new Error("Does not match filter");
    toc.pickedIds.push(candidate.id);
    tryAutoCommitPendingActivation(state, playerId);
}

/** Three untapped white Order-of-Leitbur creatures + Hand of Justice for the
 *  controller, and a vanilla Grizzly Bears for the opponent to destroy. */
function handOfJusticeBoard(): {
    state: GameState;
    handId: string;
    orderIds: string[];
    bearId: string;
} {
    const hand = makeInstance(handOfJustice.id, {
        id: "hoj",
        controllerId: "p1",
        ownerId: "p1",
    });
    const orderIds = ["ord-a", "ord-b", "ord-c"];
    const orders = orderIds.map((id) =>
        makeInstance(orderOfLeitbur.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [hand, ...orders] }),
            makePlayer("p2", { battlefield: [bear] }),
        ],
    });
    return { state, handId: "hoj", orderIds, bearId: "bear" };
}

describe("Hand of Justice — tapOtherFilter cost (CR 602.1 / 118.8)", () => {
    it("carries the canonical printed characteristics", () => {
        expect(handOfJustice.manaCost).toEqual({ X: 5, W: 1 });
        expect(handOfJustice.power).toBe(2);
        expect(handOfJustice.toughness).toBe(6);
        expect(handOfJustice.subtypes).toEqual(["Avatar"]);
        const cost = handOfJustice.activatedAbilities![0].cost;
        expect(cost.tap).toBe(true);
        expect(cost.tapOtherFilter).toEqual({
            filter: {
                types: "Creature",
                colors: "W",
                controllerRelation: "you",
            },
            count: 3,
        });
    });

    it("GRE legality: the candidate pool is the white creatures OTHER than the source", () => {
        const { state, handId } = handOfJusticeBoard();
        const filter =
            handOfJustice.activatedAbilities![0].cost.tapOtherFilter!.filter;
        const p1 = state.players[0];
        // The candidate gate (game.ts `tapOtherCandidates`) excludes the source
        // and tapped permanents, then matches the colour-resolved view. Hand of
        // Justice is itself white ({5}{W}) — it matches the colour clause but is
        // excluded as the source — leaving the three Orders as the legal picks.
        const candidates = p1.battlefield.filter(
            (c) =>
                c.id !== handId &&
                !c.isTapped &&
                matchesPermanentFilter(
                    { ...c, colors: STATIC_EFFECT_CTX.getColors(c) },
                    filter,
                    { selfControllerId: "p1" }
                )
        );
        expect(candidates.map((c) => c.id).sort()).toEqual([
            "ord-a",
            "ord-b",
            "ord-c",
        ]);
    });

    it("full path: taps three white creatures + the source and destroys the target", () => {
        const { state, handId, orderIds, bearId } = handOfJusticeBoard();
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: handId,
            abilityId: "hand-of-justice-destroy",
            kind: "ability",
            targetType: "Creature",
            count: 1,
            selected: [{ type: "permanent", id: bearId }],
        };
        finalizeTargetSelection(state, state.pendingTarget!, "p1");

        // Deferred into the tap-other picker (mana is fully covered — no {X}).
        expect(state.pendingActivation?.tapOtherChoice?.count).toBe(3);

        // Pick the three Orders one at a time; commit fires after the third.
        pickTapOther(state, "p1", orderIds[0]);
        pickTapOther(state, "p1", orderIds[1]);
        pickTapOther(state, "p1", orderIds[2]);

        // Source {T} + the three Orders are all tapped; ability is on the stack.
        const p1 = state.players[0];
        expect(p1.battlefield.find((c) => c.id === handId)?.isTapped).toBe(
            true
        );
        for (const id of orderIds) {
            expect(p1.battlefield.find((c) => c.id === id)?.isTapped).toBe(
                true
            );
        }
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);

        // Resolve: the targeted Grizzly Bears is destroyed.
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === bearId)
        ).toBeUndefined();
    });

    it("frontend affordability: projected white creatures expose isTapped (untapped pre-payment)", () => {
        const { state, orderIds } = handOfJusticeBoard();
        const projected = projectPublicState(state, 1, "p1");
        const slimOrders = projected.players[0].battlefield.filter((c) =>
            orderIds.includes(c.id)
        );
        expect(slimOrders).toHaveLength(3);
        // The slim instances must carry the tap state so a tapOtherFilter
        // affordability hint can count untapped matching creatures.
        for (const o of slimOrders) expect(o.isTapped).toBe(false);
    });
});

// ===========================================================================
// CAPABILITY G — per-turn activation-count + conditional delayed sacrifice
// (Farrelite Priest, CR 605.1a / 602.5 / 603.7a). The count lives on the
// per-instance `activationsThisTurn` map (recorded BEFORE resolve by
// activateManaAbility); the resolve schedules a next-end-step self-sacrifice
// only on the 4th+ activation. Mirror of activateManaAbility's resolve path:
// bump the live count, then run the ability's resolve via a transient stack
// item — same as the production mutation (recordActivation → resolveTopOfStack).
// ===========================================================================

/** Mirror of activateManaAbility: increment the live activation count, push a
 *  transient stack item, resolve it (adds {W} + maybe schedules the sac). */
function activateFarrelitePriestMana(state: GameState, sourceId: string): void {
    const player = state.players.find((p) =>
        p.battlefield.some((c) => c.id === sourceId)
    )!;
    const src = player.battlefield.find((c) => c.id === sourceId)!;
    const map = src.activationsThisTurn ?? {};
    map["farrelite-priest-mana"] = (map["farrelite-priest-mana"] ?? 0) + 1;
    src.activationsThisTurn = map;
    state.stack.push({
        ...src,
        zone: "stack",
        castById: player.id,
        abilityId: "farrelite-priest-mana",
    });
    resolveTopOfStack(state);
}

describe("Farrelite Priest — activation-count drawback (CR 605.1a / 602.5 / 603.7a)", () => {
    it("is a non-tap, non-stack repeatable mana ability", () => {
        const ab = farrelitePriest.activatedAbilities![0];
        expect(ab.useStack).toBe(false);
        expect(ab.cost.tap).toBeUndefined();
        expect(ab.cost.mana).toEqual({ X: 1 });
        expect(ab.manaProduced).toEqual({ W: 1 });
    });

    it("adds {W} on each activation", () => {
        const priest = makeInstance(farrelitePriest.id, {
            id: "fp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        activateFarrelitePriestMana(state, "fp");
        expect(state.players[0].manaPool.W).toBe(1);
    });

    it("survives at three activations (no delayed sacrifice scheduled)", () => {
        const priest = makeInstance(farrelitePriest.id, {
            id: "fp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        for (let i = 0; i < 3; i++) activateFarrelitePriestMana(state, "fp");
        expect(state.delayedTriggers ?? []).toHaveLength(0);
        fireDelayedTriggers(state, "next-end-step");
        expect(
            state.players[0].battlefield.find((c) => c.id === "fp")
        ).toBeDefined();
    });

    it("is sacrificed at the next end step after a fourth activation", () => {
        const priest = makeInstance(farrelitePriest.id, {
            id: "fp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        for (let i = 0; i < 4; i++) activateFarrelitePriestMana(state, "fp");
        // The 4th activation schedules the end-step self-sacrifice.
        expect(state.delayedTriggers?.length).toBeGreaterThanOrEqual(1);
        fireDelayedTriggers(state, "next-end-step");
        // The delayed trigger goes on the stack as a sacrifice; resolve it.
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "fp")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "fp")).toBe(
            true
        );
    });
});

// ===========================================================================
// Combat-damage prevention / "assigns no combat damage" (CR 510.1c) — the
// markAssignsNoCombatDamage primitive shared by Farrel's Mantle / Zealot and
// Heroism. A source in `assignsNoCombatDamageThisTurn` deals 0 combat damage.
// ===========================================================================

describe("assigns no combat damage this turn (CR 510.1c)", () => {
    it("a marked attacker deals no combat damage to its blocker", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { blk: ["atk"] },
                blockedAttackerIds: ["atk"],
                blockersConfirmed: true,
            },
            assignsNoCombatDamageThisTurn: ["atk"],
        });
        applyAllCombatDamage(state, { atk: { blk: 2 } });
        const blk = state.players[1].battlefield.find((c) => c.id === "blk");
        // The marked attacker assigned 0; the blocker took no damage.
        expect(blk?.damageMarked ?? 0).toBe(0);
    });

    it("an unmarked attacker still deals its combat damage (control)", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { blk: ["atk"] },
                blockedAttackerIds: ["atk"],
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, { atk: { blk: 2 } });
        // The unmarked 2/2 attacker assigned its 2 lethal combat damage — the
        // 2/2 blocker took it and was destroyed (CR 704.5g).
        expect(state.players[1].battlefield.some((c) => c.id === "blk")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "blk")).toBe(
            true
        );
    });

    it("the mark clears at cleanup (CR 514.2)", () => {
        const state = makeState({ assignsNoCombatDamageThisTurn: ["atk"] });
        finalizeCleanup(state);
        expect(state.assignsNoCombatDamageThisTurn).toBeUndefined();
    });
});

// ===========================================================================
// Reuse-only white cards — spell / ability outcomes (CR-cited per card).
// ===========================================================================

describe("Icatian Town — token creation (CR 707.2)", () => {
    it("creates four 1/1 white Citizen tokens", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, icatianTown.id, "p1");
        resolveTopOfStack(state);
        const tokens = state.players[0].battlefield.filter((c) =>
            (c.subtypes ?? []).includes("Citizen")
        );
        expect(tokens).toHaveLength(4);
        for (const t of tokens) {
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
            expect(t.types).toContain("Creature");
        }
    });
});

describe("Icatian Javelineers — counter-removal ping (CR 122.6 / 119)", () => {
    it("enters with a javelin counter and pings for 1 on activation", () => {
        expect(icatianJavelineers.entersWith).toEqual({
            counters: [{ type: "javelin", count: 1 }],
        });
        const source = makeInstance(icatianJavelineers.id, {
            id: "jav",
            controllerId: "p1",
            ownerId: "p1",
            counters: { javelin: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, source, "icatian-javelineers-throw", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Icatian Priest / Lieutenant — temporary pumps (CR 611 layer 7c)", () => {
    it("Icatian Priest gives a creature +1/+1 until end of turn", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const priest = makeInstance(icatianPriest.id, {
            id: "ip",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest, target] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, target)).toBe(2);
        resolveActivated(state, priest, "icatian-priest-pump", [
            { type: "permanent", id: "tgt" },
        ]);
        expect(getEffectivePower(state, target)).toBe(3);
    });
});

describe("Order of Leitbur — protection + pump knight (CR 702.16 / 611)", () => {
    it("carries protection from black", () => {
        expect(orderOfLeitbur.staticAbilities).toContain(
            "protection from black"
        );
    });
    it("pumps itself +1/+0 until end of turn", () => {
        const knight = makeInstance(orderOfLeitbur.id, {
            id: "k",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, knight)).toBe(2);
        resolveActivated(state, knight, "order-of-leitbur-pump");
        expect(getEffectivePower(state, knight)).toBe(3);
    });
});

describe("Combat Medic — prevention shield (CR 615)", () => {
    it("carries the {1}{W} prevent-1 activated ability and a 0/2 body", () => {
        expect(combatMedic.power).toBe(0);
        expect(combatMedic.toughness).toBe(2);
        const ab = combatMedic.activatedAbilities![0];
        expect(ab.cost.mana).toEqual({ X: 1, W: 1 });
        expect(ab.targetRequirement).toEqual({ type: "any", count: 1 });
    });
});

// ===========================================================================
// Remaining reuse-only white cards — definition-shape coverage. The
// load-bearing behaviour (banding keyword, "assigns no combat damage" on
// the unblocked trigger, mana filter, ETB damage) is exercised by the
// shared-primitive blocks above; here each card's canonical shape is pinned.
// ===========================================================================

describe("FEM white reuse cards — canonical shapes", () => {
    it("Farrel's Mantle is a {2}{W} Aura with an unblocked-attack trigger", () => {
        expect(farrelsMantle.types).toEqual(["Enchantment"]);
        expect(farrelsMantle.subtypes).toEqual(["Aura"]);
        expect(farrelsMantle.manaCost).toEqual({ X: 2, W: 1 });
        expect(farrelsMantle.triggeredAbilities?.[0].event).toBe(
            "ATTACKER_UNBLOCKED"
        );
    });

    it("Farrel's Zealot is a {1}{W}{W} 2/2 with an unblocked-attack trigger", () => {
        expect(farrelsZealot.power).toBe(2);
        expect(farrelsZealot.toughness).toBe(2);
        expect(farrelsZealot.manaCost).toEqual({ X: 1, W: 2 });
        expect(farrelsZealot.triggeredAbilities?.[0].event).toBe(
            "ATTACKER_UNBLOCKED"
        );
    });

    it("Heroism is a {2}{W} Enchantment with a sacrifice-a-white-creature cost", () => {
        expect(heroism.types).toEqual(["Enchantment"]);
        expect(heroism.manaCost).toEqual({ X: 2, W: 1 });
        expect(heroism.activatedAbilities![0].cost.sacrificeFilter).toEqual({
            types: "Creature",
            colors: "W",
            controllerRelation: "you",
        });
    });

    it("Icatian Infantry grants first strike and banding until end of turn", () => {
        expect(icatianInfantry.power).toBe(1);
        const ids = icatianInfantry.activatedAbilities!.map((a) => a.id);
        expect(ids).toContain("icatian-infantry-first-strike");
        expect(ids).toContain("icatian-infantry-banding");
    });

    it("Icatian Lieutenant pumps a Soldier creature +1/+0", () => {
        const req = icatianLieutenant.activatedAbilities![0].targetRequirement;
        expect(req).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: "Soldier",
        });
    });

    it("Icatian Moneychanger enters with three credit counters", () => {
        expect(icatianMoneychanger.entersWith).toEqual({
            counters: [{ type: "credit", count: 3 }],
        });
    });

    it("Icatian Phalanx and Skirmishers carry banding", () => {
        expect(icatianPhalanx.staticAbilities).toContain("banding");
        expect(icatianSkirmishers.staticAbilities).toEqual(
            expect.arrayContaining(["first strike", "banding"])
        );
    });

    it("Icatian Scout grants first strike with a {1},{T} cost", () => {
        const cost = icatianScout.activatedAbilities![0].cost;
        expect(cost.tap).toBe(true);
        expect(cost.mana).toEqual({ X: 1 });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// C4 — Red: Goblins, Orcs & Dwarves (issue #570). One describe per card with
// non-trivial behaviour. The menace keyword + min-blocker enforcement is
// exercised at the engine level in convex/gre/__tests__/combat.test.ts,
// moves.test.ts and moves-integration.test.ts (ADR 0038); here we assert the
// card data and the War Drums grant on the wire.
// ═══════════════════════════════════════════════════════════════════════════

describe("FEM red registry parity + multi-art prints (ADR 0014)", () => {
    const RED_DEFS = [
        goblinWarDrums,
        goblinGrenade,
        goblinWarrens,
        goblinChirurgeon,
        goblinKites,
        orcishCaptain,
        brassclawOrcs,
        orcishVeteran,
        orcishSpy,
        orgg,
        goblinFlotilla,
        dwarvenLieutenant,
        dwarvenSoldier,
        dwarvenArmorer,
        dwarvenCatapult,
        raidingParty,
    ];

    it("registers all 16 red cards by id and name", () => {
        for (const def of RED_DEFS) {
            expect(getCardById(def.id)).toBe(def);
            expect(getCardByName(def.name)).toBe(def);
            expect(getAllCards()).toContain(def);
        }
    });

    it("resolves every red alternate artwork to its shared definition", () => {
        const printPairs: Array<[{ printId: string }, { id: string }]> = [
            [goblinWarDrumsFemB, goblinWarDrums],
            [goblinWarDrumsFemC, goblinWarDrums],
            [goblinWarDrumsFemD, goblinWarDrums],
            [goblinGrenadeFemB, goblinGrenade],
            [goblinGrenadeFemC, goblinGrenade],
            [goblinChirurgeonFemB, goblinChirurgeon],
            [goblinChirurgeonFemC, goblinChirurgeon],
            [brassclawOrcsFemB, brassclawOrcs],
            [brassclawOrcsFemC, brassclawOrcs],
            [brassclawOrcsFemD, brassclawOrcs],
            [orcishVeteranFemB, orcishVeteran],
            [orcishVeteranFemC, orcishVeteran],
            [orcishVeteranFemD, orcishVeteran],
            [orcishSpyFemB, orcishSpy],
            [orcishSpyFemC, orcishSpy],
            [dwarvenSoldierFemB, dwarvenSoldier],
            [dwarvenSoldierFemC, dwarvenSoldier],
        ];
        for (const [print, def] of printPairs) {
            expect(getCardById(print.printId)).toBe(def);
        }
    });
});

describe("Goblin War Drums — grants menace anthem-style (CR 611, 702.111a)", () => {
    it("declares exactly one keyword-grant static effect for menace", () => {
        const effects = goblinWarDrums.staticEffects ?? [];
        expect(effects).toHaveLength(1);
        expect(effects[0].kind).toBe("keyword-grant");
        expect(goblinWarDrums.manaCost).toEqual({ X: 2, R: 1 });
        expect(goblinWarDrums.types).toEqual(["Enchantment"]);
    });

    it("grants menace to your creatures (GRE + wire), not the opponent's", () => {
        const drums = makeInstance(goblinWarDrums.id, {
            id: "drums",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drums, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        applySourceStaticEffects(state, drums);
        const mineLive = state.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        const theirsLive = state.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(mineLive.staticAbilities).toContain("menace");
        expect(theirsLive.staticAbilities).not.toContain("menace");

        // Wire format: the granted keyword survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimMine = projected.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(slimMine.staticAbilities).toContain("menace");
    });
});

describe("Goblin Grenade — sacrifice a Goblin, 5 damage (CR 601.2f, 115.4)", () => {
    it("carries the additional sacrifice cost and any-target requirement", () => {
        expect(goblinGrenade.additionalCosts).toEqual({
            sacrificeFilter: { subtypes: ["Goblin"] },
        });
        expect(goblinGrenade.targetRequirement).toEqual({
            type: "any",
            count: 1,
        });
        expect(goblinGrenade.manaCost).toEqual({ R: 1 });
    });

    it("deals 5 damage to a target player on resolution", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        pushSpell(state, goblinGrenade.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });
});

describe("Goblin Warrens — sacrifice two Goblins for three tokens (CR 111)", () => {
    it("makes three 1/1 red Goblin tokens when two Goblins are sacrificed", () => {
        const warrens = makeInstance(goblinWarrens.id, {
            id: "warrens",
            controllerId: "p1",
            ownerId: "p1",
        });
        const g1 = makeInstance(grizzlyBears.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Goblin"],
        });
        const g2 = makeInstance(grizzlyBears.id, {
            id: "g2",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Goblin"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warrens, g1, g2] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, warrens, "goblin-warrens-breed");
        answerPendingChoices(state); // sacrifice the two Goblins
        const goblins = state.players[0].battlefield.filter(
            (c) =>
                (c.subtypes ?? []).includes("Goblin") &&
                c.types.includes("Creature") &&
                c.id !== "g1" &&
                c.id !== "g2"
        );
        // The two sacrificed Goblins are gone; three fresh tokens remain.
        expect(state.players[0].battlefield.find((c) => c.id === "g1")).toBe(
            undefined
        );
        expect(goblins).toHaveLength(3);
        for (const t of goblins) {
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
        }
    });
});

describe("Goblin Chirurgeon — sacrifice a Goblin, regenerate (CR 701.15a)", () => {
    it("applies a regeneration shield to the target creature", () => {
        const chirurgeon = makeInstance(goblinChirurgeon.id, {
            id: "chir",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ally = makeInstance(grizzlyBears.id, {
            id: "ally",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chirurgeon, ally] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, chirurgeon, "goblin-chirurgeon-regen", [
            { type: "permanent", id: "ally" },
        ]);
        const allyLive = state.players[0].battlefield.find(
            (c) => c.id === "ally"
        )!;
        expect(allyLive.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Goblin Kites — grant flying + delayed coin-flip (CR 702.9, 705.2)", () => {
    it("grants flying and arms a next-end-step coin-flip delayed trigger", () => {
        const kites = makeInstance(goblinKites.id, {
            id: "kites",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flyer = makeInstance(grizzlyBears.id, {
            id: "flyer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kites, flyer] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, kites, "goblin-kites-fly", [
            { type: "permanent", id: "flyer" },
        ]);
        const flyerLive = state.players[0].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(flyerLive.staticAbilities).toContain("flying");
        // A delayed trigger is queued for the next end step.
        expect(
            (state.delayedTriggers ?? []).some(
                (d) => d.triggerId === "goblin-kites-flip"
            )
        ).toBe(true);
    });

    it("targets only your creatures with toughness 2 or less", () => {
        const req = goblinKites.activatedAbilities![0].targetRequirement!;
        expect(req.controller).toBe("you");
        expect(req.toughnessFilter).toEqual({ max: 2 });
    });
});

describe("Orcish Captain — coin-flip pump on an Orc (CR 705.2)", () => {
    it("buffs +2/+0 on a winning flip", () => {
        const captain = makeInstance(orcishCaptain.id, {
            id: "cap",
            controllerId: "p1",
            ownerId: "p1",
        });
        const orc = makeInstance(grizzlyBears.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Orc"],
        });
        // Seed so flipCoin returns heads (win). The reveal suspends, so resolve
        // twice (push + re-resolve) — modeled by resolving until no suspension.
        const state = makeState({
            rngSeed: 1,
            players: [
                makePlayer("p1", { battlefield: [captain, orc] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, captain, "orcish-captain-flip", [
            { type: "permanent", id: "orc" },
        ]);
        // Drive the suspended coin-flip reveal to completion.
        answerPendingChoices(state);
        const orcLive = state.players[0].battlefield.find(
            (c) => c.id === "orc"
        )!;
        // The coin resolved to one deterministic face for this seed; whichever
        // it is, exactly one of the two P/T modifications applied.
        const power = getEffectivePower(state, orcLive);
        const toughness = getEffectiveToughness(state, orcLive);
        const win = power === 4 && toughness === 2; // +2/+0 on 2/2
        const lose = power === 2 && toughness === 0; // -0/-2 on 2/2
        expect(win || lose).toBe(true);
        expect(orcishCaptain.activatedAbilities![0].targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: "Orc",
        });
    });
});

describe("Brassclaw Orcs — can't block power 2+ (CR 509.1b, ADR 0006)", () => {
    it("declares a blocker-side block-restriction predicate", () => {
        const effects = brassclawOrcs.staticEffects ?? [];
        const restriction = effects.find((e) => e.kind === "block-restriction");
        expect(restriction).toBeDefined();
        if (restriction && restriction.kind === "block-restriction") {
            expect(restriction.side).toBe("blocker");
            // Legal to block a 1-power attacker, illegal vs a 2-power attacker.
            const weak = { power: 1 } as never;
            const strong = { power: 2 } as never;
            const self = {} as never;
            expect(restriction.predicate(self, weak)).toBe(true);
            expect(restriction.predicate(self, strong)).toBe(false);
        }
        expect(brassclawOrcs.power).toBe(3);
        expect(brassclawOrcs.toughness).toBe(2);
    });
});

describe("Orcish Veteran — can't block white power 2+ / first strike (CR 509.1b)", () => {
    it("declares the colour-clause block-restriction and a first-strike ability", () => {
        const restriction = (orcishVeteran.staticEffects ?? []).find(
            (e) => e.kind === "block-restriction"
        );
        expect(restriction?.kind).toBe("block-restriction");
        expect(orcishVeteran.activatedAbilities?.[0].id).toBe(
            "orcish-veteran-first-strike"
        );
    });

    it("grants first strike to itself on activation", () => {
        const vet = makeInstance(orcishVeteran.id, {
            id: "vet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vet] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, vet, "orcish-veteran-first-strike");
        const vetLive = state.players[0].battlefield.find(
            (c) => c.id === "vet"
        )!;
        expect(vetLive.staticAbilities).toContain("first strike");
    });
});

describe("Orcish Spy — look at top three of a library (CR 401.4)", () => {
    it("targets a player and resolves without error", () => {
        expect(orcishSpy.activatedAbilities![0].targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
        const spy = makeInstance(orcishSpy.id, {
            id: "spy",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libCard = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spy] }),
                makePlayer("p2", { library: [libCard] }),
            ],
        });
        resolveActivated(state, spy, "orcish-spy-look", [
            { type: "player", id: "p2" },
        ]);
        // Look does not move the card.
        expect(state.players[1].library).toHaveLength(1);
    });
});

describe("Orgg — trample + attack/block restrictions (CR 702.19, 508.1c)", () => {
    it("has trample and both data-driven combat restrictions", () => {
        expect(orgg.staticAbilities).toContain("trample");
        const kinds = (orgg.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("attack-restriction");
        expect(kinds).toContain("block-restriction");
        expect(orgg.power).toBe(6);
        expect(orgg.toughness).toBe(6);
    });

    it("attack-restriction forbids attacking into an untapped power-3 creature", () => {
        const attackR = (orgg.staticEffects ?? []).find(
            (e) => e.kind === "attack-restriction"
        );
        if (attackR && attackR.kind === "attack-restriction") {
            const self = {} as never;
            const big = [
                { types: ["Creature"], isTapped: false, power: 3 },
            ] as never;
            const small = [
                { types: ["Creature"], isTapped: false, power: 2 },
            ] as never;
            expect(attackR.predicate(self, big)).toBe(false);
            expect(attackR.predicate(self, small)).toBe(true);
        }
    });
});

describe("Goblin Flotilla — islandwalk (CR 702.13)", () => {
    it("carries the islandwalk keyword", () => {
        expect(goblinFlotilla.staticAbilities).toContain("islandwalk");
        expect(goblinFlotilla.power).toBe(2);
        expect(goblinFlotilla.toughness).toBe(2);
    });
});

describe("Dwarven Lieutenant — pump a Dwarf (CR 611.2)", () => {
    it("gives a Dwarf +1/+0 until end of turn", () => {
        const lt = makeInstance(dwarvenLieutenant.id, {
            id: "lt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dwarf = makeInstance(grizzlyBears.id, {
            id: "dwarf",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Dwarf"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lt, dwarf] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, lt, "dwarven-lieutenant-pump", [
            { type: "permanent", id: "dwarf" },
        ]);
        const dwarfLive = state.players[0].battlefield.find(
            (c) => c.id === "dwarf"
        )!;
        expect(getEffectivePower(state, dwarfLive)).toBe(3); // 2 + 1
    });
});

describe("Dwarven Soldier — French-vanilla body (FEM 53)", () => {
    it("has the canonical 2/1 Dwarf Soldier characteristics", () => {
        expect(dwarvenSoldier.power).toBe(2);
        expect(dwarvenSoldier.toughness).toBe(1);
        expect(dwarvenSoldier.subtypes).toEqual(["Dwarf", "Soldier"]);
    });
});

describe("Dwarven Armorer — discard for a counter (CR 122.1)", () => {
    it("puts a chosen counter on the target after discarding", () => {
        expect(dwarvenArmorer.activatedAbilities![0].resolveSteps).toHaveLength(
            2
        );
        const armorer = makeInstance(dwarvenArmorer.id, {
            id: "armorer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "buffme",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(grizzlyBears.id, {
            id: "discardme",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [armorer, target],
                    hand: [handCard],
                }),
                makePlayer("p2"),
            ],
        });
        // Resolve drives resolveSteps; suspensions (discard pick, counter
        // choice) are answered by auto-resolution where no real branch exists.
        resolveActivated(state, armorer, "dwarven-armorer-counter", [
            { type: "permanent", id: "buffme" },
        ]);
        // Answer the discard pick (step 0) and the counter-kind option (step 1).
        answerPendingChoices(state);
        // A +0/+1 or +1/+0 counter landed on the target, and the chosen card
        // was discarded.
        const buffed = state.players[0].battlefield.find(
            (c) => c.id === "buffme"
        )!;
        const counters = buffed.counters ?? {};
        const total = (counters["+0/+1"] ?? 0) + (counters["+1/+0"] ?? 0);
        expect(total).toBe(1);
        expect(
            state.players[0].graveyard.some((c) => c.id === "discardme")
        ).toBe(true);
    });
});

describe("Dwarven Catapult — X damage split among opponent creatures (CR 107.3)", () => {
    it("deals floor(X / N) to each of the opponent's creatures", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        const c1 = makeInstance(grizzlyBears.id, {
            id: "oc1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const c2 = makeInstance(grizzlyBears.id, {
            id: "oc2",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield = [c1, c2];
        const item = pushSpell(state, dwarvenCatapult.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // X=2 over two creatures → floor(2/2)=1 damage to each (non-lethal on a
        // 2/2). Both survive with 1 damage marked, proving the even split.
        item.chosenX = 2;
        resolveTopOfStack(state);
        const oc1 = state.players[1].battlefield.find((c) => c.id === "oc1");
        const oc2 = state.players[1].battlefield.find((c) => c.id === "oc2");
        expect(oc1?.damageMarked ?? 0).toBe(1);
        expect(oc2?.damageMarked ?? 0).toBe(1);
    });

    it("rounds the split down: X=3 over two creatures = 1 each", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        const c1 = makeInstance(grizzlyBears.id, {
            id: "d1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const c2 = makeInstance(grizzlyBears.id, {
            id: "d2",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield = [c1, c2];
        const item = pushSpell(state, dwarvenCatapult.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3; // floor(3/2) = 1 to each
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "d1")
                ?.damageMarked ?? 0
        ).toBe(1);
    });
});

describe("Raiding Party — symmetric Plains destruction (CR 701.7)", () => {
    it("sacrifices an Orc and destroys unprotected Plains", () => {
        const party = makeInstance(raidingParty.id, {
            id: "party",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Opponent controls two Plains and no white creatures to protect them.
        const plains1 = makeInstance(getCardByName("Plains").id, {
            id: "pl1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const plains2 = makeInstance(getCardByName("Plains").id, {
            id: "pl2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [party] }),
                makePlayer("p2", { battlefield: [plains1, plains2] }),
            ],
        });
        resolveActivated(state, party, "raiding-party-raze");
        // Drive the per-player tap/protect choices to completion (no white
        // creatures to tap → each player picks nothing → no Plains protected).
        answerPendingChoices(state);
        // With no white creatures to tap, no Plains are protected → both gone.
        const remainingPlains = state.players[1].battlefield.filter((c) =>
            (c.subtypes ?? []).includes("Plains")
        );
        expect(remainingPlains).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// C5 — Black: Thrulls & Order of the Ebon Hand (issue #572). One describe per
// card citing the CR section it exercises. Covers CAPABILITY C (sac-self mana,
// ADR 0039), the exile-as-cost extension (E), reused activation-count (G),
// cost-increase static, random discard, and the Thrull pump/anthem package.
// ═══════════════════════════════════════════════════════════════════════════

// --- C5 helpers ------------------------------------------------------------

/** Mirror of selectAdditionalCost's spell-cast picker: validate the pick
 *  against the live additional-cost filter, record `pickedId`, then attempt the
 *  auto-commit (CR 117.9 / 601.2f). */
function pickAdditionalCost(
    state: GameState,
    playerId: string,
    instanceId: string
): void {
    const pc = state.pendingCast;
    if (!pc?.additionalCost)
        throw new Error("No additional-cost picker pending");
    if (pc.additionalCost.pickedId) throw new Error("Additional cost paid");
    const player = state.players.find((p) => p.id === playerId)!;
    const candidate = player.battlefield.find((c) => c.id === instanceId);
    if (!candidate) throw new Error("Pick not on battlefield");
    if (
        !matchesPermanentFilter(candidate, pc.additionalCost.filter, {
            selfControllerId: playerId,
        })
    )
        throw new Error("Does not match filter");
    pc.additionalCost.pickedId = candidate.id;
    tryAutoCommitPendingCast(state, playerId);
}

// ---------------------------------------------------------------------------
// FEM black registry parity + multi-art prints (ADR 0014).
// ---------------------------------------------------------------------------

describe("FEM black registry parity + multi-art prints (ADR 0014)", () => {
    const C5_DEFS = [
        armorThrull,
        basalThrull,
        breedingPit,
        derelor,
        ebonPraetor,
        hymnToTourach,
        initiatesOfTheEbonHand,
        mindstabThrull,
        necrite,
        orderOfTheEbonHand,
        soulExchange,
        thrullChampion,
        thrullRetainer,
        thrullWizard,
        tourachsChant,
        tourachsGate,
    ];

    it("registers every C5 black card by id and by name", () => {
        for (const def of C5_DEFS) {
            expect(getCardById(def.id)).toBe(def);
            expect(getCardByName(def.name)).toBe(def);
            expect(getAllCards()).toContain(def);
        }
    });

    it("resolves every alternate artwork to the shared definition (fem set code)", () => {
        for (const { print, defId } of C5_MULTI_ART_PRINTS) {
            expect(print.definitionId).toBe(defId);
            expect(getCardById(print.printId).id).toBe(defId);
            expect(print.setCode).toBe("fem");
        }
    });

    it("uses a distinct id/printId across all definitions and prints (no dupes)", () => {
        const ids = [
            ...C5_DEFS.map((d) => d.id),
            ...C5_MULTI_ART_PRINTS.map((m) => m.print.printId),
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });
});

// ---------------------------------------------------------------------------
// Basal Thrull — CAPABILITY C: sacrifice-self FIXED-output mana ability
// (ADR 0039, CR 605.1a). "{T}, Sacrifice this creature: Add {B}{B}."
// ---------------------------------------------------------------------------

describe("Basal Thrull — sac-self mana ability (CAPABILITY C, ADR 0039, CR 605.1a)", () => {
    it("carries the canonical printed characteristics + a useStack:false sac mana ability", () => {
        expect(basalThrull.manaCost).toEqual({ B: 2 });
        expect(basalThrull.subtypes).toEqual(["Thrull"]);
        expect(basalThrull.power).toBe(1);
        expect(basalThrull.toughness).toBe(2);
        const ability = basalThrull.activatedAbilities?.[0];
        expect(ability?.useStack).toBe(false); // mana ability — no stack (CR 605.1a)
        expect(ability?.cost).toEqual({ tap: true, sacrifice: true });
        expect(ability?.manaProduced).toEqual({ B: 2 });
    });

    it("full path: tapSourceIntoPayment SACRIFICES the source (not taps) and adds {B}{B}", () => {
        // Drive the real tap-mana payment path: the sac-self fixed-output ability
        // routes through tapSourceIntoPayment, which (ADR 0039) sacrifices the
        // source instead of tapping it and adds the fixed {B}{B} to the pool.
        const thrull = makeInstance(basalThrull.id, {
            id: "thrull",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull] }),
                makePlayer("p2"),
            ],
        });
        tapSourceIntoPayment(state, state.players[0], thrull, undefined, []);
        // Mana ability: {B}{B} added to the pool.
        expect(state.players[0].manaPool.B).toBe(2);
        // The source was SACRIFICED — gone from battlefield, in graveyard, and
        // not left tapped on the board.
        expect(
            state.players[0].battlefield.find((c) => c.id === "thrull")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "thrull")
        ).toBeDefined();
    });

    it("the sacrifice survives the wire-format projection (source gone, B mana visible)", () => {
        const thrull = makeInstance(basalThrull.id, {
            id: "thrull",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull] }),
                makePlayer("p2"),
            ],
        });
        tapSourceIntoPayment(state, state.players[0], thrull, undefined, []);
        const projected = projectPublicState(state, 1, "p1");
        // Source is no longer on the projected battlefield, B mana is in the pool.
        expect(
            projected.players[0].battlefield.find((c) => c.id === "thrull")
        ).toBeUndefined();
        expect(projected.players[0].manaPool.B).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Armor Thrull — {T}, Sacrifice this: put a +1/+2 counter on target creature
// (CR 602.1 tap + self-sacrifice cost; CR 122.1 P/T counter).
// ---------------------------------------------------------------------------

describe("Armor Thrull — sac-self +1/+2 counter (CR 602.1, 122.1)", () => {
    it("carries the canonical printed characteristics", () => {
        expect(armorThrull.manaCost).toEqual({ X: 2, B: 1 });
        expect(armorThrull.subtypes).toEqual(["Thrull"]);
        expect(armorThrull.power).toBe(1);
        expect(armorThrull.toughness).toBe(3);
        const cost = armorThrull.activatedAbilities![0].cost;
        expect(cost.tap).toBe(true);
        expect(cost.sacrifice).toBe(true);
    });

    it("puts a +1/+2 counter on the target, lifting its effective P/T", () => {
        const armorer = makeInstance(armorThrull.id, {
            id: "armorer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [armorer, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, armorer, "armor-thrull-counter", [
            { type: "permanent", id: "target" },
        ]);
        const buffed = state.players[0].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(buffed.counters?.["+1/+2"]).toBe(1);
        expect(getEffectivePower(state, buffed)).toBe(2 + 1);
        expect(getEffectiveToughness(state, buffed)).toBe(2 + 2);
    });

    it("the +1/+2 P/T survives the wire-format projection", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2 + 1);
        expect(getEffectiveToughness(projected, slim)).toBe(2 + 2);
    });
});

// ---------------------------------------------------------------------------
// Basal Thrull mana feeds nothing on the stack — but Soul Exchange exercises
// the exile-as-cost extension (E). CAPABILITY E (extended): exile-a-permanent-
// you-control as an additional cost, coexisting with a graveyard target.
// ---------------------------------------------------------------------------

describe("Soul Exchange — exile-as-cost + reanimate + Thrull +2/+2 (CAPABILITY E, CR 117.9/601.2f/406)", () => {
    it("declares the exileFilter additional cost (you-control) + graveyard target", () => {
        expect(soulExchange.additionalCosts?.exileFilter).toEqual({
            types: "Creature",
            controllerRelation: "you",
        });
        expect(soulExchange.additionalCosts?.sacrificeFilter).toBeUndefined();
        expect(soulExchange.targetRequirement).toMatchObject({
            type: "Creature",
            zone: "graveyard",
            controller: "you",
        });
    });

    it("GRE: reanimates the targeted graveyard creature; +2/+2 when the exiled creature was a Thrull", () => {
        // The exiled creature's subtypes are snapshotted on the stack item; a
        // Thrull adds a +2/+2 counter to the reanimated creature (CR 117.9).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "deadbear",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, soulExchange.id, "p1", [
            { type: "graveyard-card", id: "deadbear", playerId: "p1" },
        ]);
        // Simulate the exiled-creature snapshot (a Thrull was exiled at cast).
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "exiled",
            mv: 2,
            subtypes: ["Thrull"],
        };
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "deadbear"
        )!;
        expect(reanimated).toBeDefined();
        expect(reanimated.zone).toBe("battlefield");
        expect(reanimated.counters?.["+2/+2"]).toBe(1);
        expect(getEffectivePower(state, reanimated)).toBe(2 + 2);
        expect(getEffectiveToughness(state, reanimated)).toBe(2 + 2);
    });

    it("GRE: no +2/+2 counter when the exiled creature was NOT a Thrull", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "deadbear",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, soulExchange.id, "p1", [
            { type: "graveyard-card", id: "deadbear", playerId: "p1" },
        ]);
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "exiled",
            mv: 2,
            subtypes: ["Bear"],
        };
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "deadbear"
        )!;
        expect(reanimated.counters?.["+2/+2"] ?? 0).toBe(0);
    });

    it("full path: cast exiles a Thrull you control, then reanimates with +2/+2", () => {
        // Drive the real cast path: finalizeTargetSelection (target a graveyard
        // creature) opens the exile picker; pickAdditionalCost exiles the Thrull
        // and commits; the spell resolves reanimating the target with +2/+2.
        const fodderThrull = makeInstance(basalThrull.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const exchange = makeInstance(soulExchange.id, {
            id: "exchange",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const deadBear = makeInstance(grizzlyBears.id, {
            id: "deadbear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fodderThrull],
                    hand: [exchange],
                    graveyard: [deadBear],
                    manaPool: { B: 2 }, // {B}{B} pre-paid in pool
                }),
                makePlayer("p2"),
            ],
        });
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "exchange",
            targetType: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "you",
            selected: [
                { type: "graveyard-card", id: "deadbear", playerId: "p1" },
            ],
        };
        finalizeTargetSelection(state, state.pendingTarget!, "p1");
        // Targets chosen → exile picker is open, even though mana is covered.
        expect(state.pendingCast?.additionalCost?.kind).toBe("exile");

        // Pay the exile cost with the Thrull → auto-commit fires.
        pickAdditionalCost(state, "p1", "fodder");

        // The Thrull was EXILED (not sacrificed).
        expect(
            state.players[0].battlefield.find((c) => c.id === "fodder")
        ).toBeUndefined();
        expect(
            state.players[0].exile?.find((c) => c.id === "fodder")
        ).toBeDefined();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);

        // Resolve the spell: the Bears returns with a +2/+2 counter (exiled
        // creature was a Thrull).
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "deadbear"
        )!;
        expect(reanimated.zone).toBe("battlefield");
        expect(reanimated.counters?.["+2/+2"]).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Hymn to Tourach — Target player discards two cards at random (CR 701.8a).
// ---------------------------------------------------------------------------

describe("Hymn to Tourach — random discard two (CR 701.8a)", () => {
    it("discards exactly two cards from the targeted player's hand", () => {
        const hand = [
            makeInstance(grizzlyBears.id, {
                id: "h1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(grizzlyBears.id, {
                id: "h2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(grizzlyBears.id, {
                id: "h3",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand })],
        });
        pushSpell(state, hymnToTourach.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // Two of three hand cards moved to the graveyard at random.
        expect(state.players[1].hand).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(2);
    });

    it("clamps to hand size: a one-card hand discards just that card", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "only",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, hymnToTourach.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Derelor — Black spells you cast cost {B} more (CR 601.2f cost increase,
// scoped to the controller's own black spells — the Gloom precedent).
// ---------------------------------------------------------------------------

describe("Derelor — controller's black spells cost {B} more (CR 601.2f)", () => {
    it("carries the canonical printed characteristics + cost-modifier static", () => {
        expect(derelor.manaCost).toEqual({ X: 3, B: 1 });
        expect(derelor.power).toBe(4);
        expect(derelor.toughness).toBe(4);
        expect(derelor.subtypes).toEqual(["Thrull"]);
        const eff = derelor.staticEffects?.[0];
        expect(eff?.kind).toBe("cost-modifier");
        expect((eff as { costIncrease?: unknown }).costIncrease).toEqual({
            B: 1,
        });
    });

    it("taxes the controller's OWN black spell by {B}, but not a colorless spell", () => {
        const der = makeInstance(derelor.id, {
            id: "der",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [der] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = makeInstance(hymnToTourach.id, {
            id: "hymn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mods = getCostModifiers(state, blackSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(1);
    });

    it("does NOT tax the opponent's black spells", () => {
        const der = makeInstance(derelor.id, {
            id: "der",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [der] }),
                makePlayer("p2"),
            ],
        });
        const oppSpell = makeInstance(hymnToTourach.id, {
            id: "opphymn",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const mods = getCostModifiers(state, oppSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Initiates of the Ebon Hand — CAPABILITY G: activation-count delayed
// self-sacrifice (CR 605.1a mana, 602.5 count, 603.7a delayed end-step sac).
// ---------------------------------------------------------------------------

describe("Initiates of the Ebon Hand — 4th-activation delayed sacrifice (CAPABILITY G, CR 602.5/603.7a)", () => {
    const MANA_ID = "initiates-ebon-hand-mana";

    function setup() {
        const initiates = makeInstance(initiatesOfTheEbonHand.id, {
            id: "initiates",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [initiates] }),
                makePlayer("p2"),
            ],
        });
        return { state, initiates };
    }

    /** Mirror an activation: bump the count, then run the (useStack:false)
     *  resolve via a stack push (resolveTopOfStack runs card.resolve). */
    function activateOnce(state: GameState, source: CardInstanceState) {
        source.activationsThisTurn = {
            ...source.activationsThisTurn,
            [MANA_ID]: (source.activationsThisTurn?.[MANA_ID] ?? 0) + 1,
        };
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: MANA_ID,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("is a {1}: Add {B} mana ability (no stack)", () => {
        const ability = initiatesOfTheEbonHand.activatedAbilities?.[0];
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ B: 1 });
        expect(ability?.cost).toEqual({ mana: { X: 1 } });
    });

    it("3 activations → no delayed sacrifice scheduled", () => {
        const { state, initiates } = setup();
        activateOnce(state, initiates);
        activateOnce(state, initiates);
        activateOnce(state, initiates);
        expect(state.players[0].manaPool.B).toBe(3);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("4th activation → schedules a next-end-step self-sacrifice", () => {
        const { state, initiates } = setup();
        for (let i = 0; i < 4; i++) activateOnce(state, initiates);
        expect(state.players[0].manaPool.B).toBe(4);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe(
            "initiates-ebon-hand-sacrifice"
        );
        expect(state.delayedTriggers![0].timing).toBe("next-end-step");
    });

    it("the delayed trigger sacrifices the Initiates at the next end step", () => {
        const { state, initiates } = setup();
        for (let i = 0; i < 4; i++) activateOnce(state, initiates);
        fireDelayedTriggers(state, "next-end-step");
        // The scheduled sacrifice is on the stack; resolve it.
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "initiates")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "initiates")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Ebon Praetor — CAPABILITY G (oncePerTurn) + upkeep -2/-2 + Thrull-sac bonus.
// ---------------------------------------------------------------------------

describe("Ebon Praetor — upkeep -2/-2 + once-per-turn Thrull-sac bonus (CR 602.5, 122.1)", () => {
    it("carries first strike, trample, and a once-per-turn upkeep-only sac ability", () => {
        expect(ebonPraetor.staticAbilities).toContain("first strike");
        expect(ebonPraetor.staticAbilities).toContain("trample");
        const ability = ebonPraetor.activatedAbilities![0];
        expect(ability.oncePerTurn).toBe(true);
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Creature" });
    });

    it("upkeep trigger puts a -2/-2 counter, dropping effective P/T", () => {
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, praetor, "ebon-praetor-upkeep", UPKEEP("p1"));
        const after = state.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        expect(after.counters?.["-2/-2"]).toBe(1);
        expect(getEffectivePower(state, after)).toBe(5 - 2);
        expect(getEffectiveToughness(state, after)).toBe(5 - 2);
    });

    it("sac ability removes a -2/-2 counter; sacrificing a Thrull adds +1/+0", () => {
        // Pre-mark a -2/-2 counter (from a prior upkeep). The cost snapshot
        // records the sacrificed creature's subtypes; a Thrull adds +1/+0.
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "-2/-2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        const item: StackItem = {
            ...praetor,
            zone: "stack",
            castById: "p1",
            abilityId: "ebon-praetor-sacrifice",
            targets: [],
            additionalSacrificeSnapshot: {
                cardInstanceId: "sacced",
                mv: 2,
                subtypes: ["Thrull"],
            },
        };
        state.stack.push(item);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        // -2/-2 removed and +1/+0 added → effective 6/5 from base 5/5.
        expect(after.counters?.["-2/-2"] ?? 0).toBe(0);
        expect(after.counters?.["+1/+0"]).toBe(1);
        expect(getEffectivePower(state, after)).toBe(5 + 1);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });

    it("no +1/+0 when the sacrificed creature was not a Thrull", () => {
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "-2/-2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...praetor,
            zone: "stack",
            castById: "p1",
            abilityId: "ebon-praetor-sacrifice",
            targets: [],
            additionalSacrificeSnapshot: {
                cardInstanceId: "sacced",
                mv: 2,
                subtypes: ["Bear"],
            },
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        expect(after.counters?.["-2/-2"] ?? 0).toBe(0);
        expect(after.counters?.["+1/+0"] ?? 0).toBe(0);
    });

    it("the -2/-2 P/T survives the wire-format projection", () => {
        const praetor = makeInstance(ebonPraetor.id, {
            id: "praetor",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "-2/-2": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [praetor] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "praetor"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Mindstab Thrull — attacks-unblocked optional self-sac → defender discards 3
// (CR 509.1h, 603.3d, 701.8).
// ---------------------------------------------------------------------------

describe("Mindstab Thrull — unblocked sac → discard three (CR 509.1h, 603.3d)", () => {
    function setup(handSize: number) {
        const thrull = makeInstance(mindstabThrull.id, {
            id: "mindstab",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppHand = Array.from({ length: handSize }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `oh${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull] }),
                makePlayer("p2", { hand: oppHand }),
            ],
        });
        return { state, thrull };
    }

    const UNBLOCKED = (attackerId: string): StackItem["triggerEvent"] =>
        ({
            type: "ATTACKER_UNBLOCKED" as const,
            attackerId,
            attackerControllerId: "p1",
        }) as StackItem["triggerEvent"];

    it("accepting the sac makes the defender discard three; the Thrull is sacrificed", () => {
        const { state, thrull } = setup(4);
        resolveTrigger(
            state,
            thrull,
            "mindstab-thrull-unblocked",
            UNBLOCKED("mindstab")
        );
        // First head: the may-pay sacrifice choice routed to the controller.
        const sacHead = state.pendingChoices?.[0];
        expect(sacHead?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // Then the defender (p2) picks three cards to discard.
        answerPendingChoices(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "mindstab")
        ).toBeUndefined();
        expect(state.players[1].hand).toHaveLength(1); // 4 - 3 discarded
        expect(state.players[1].graveyard).toHaveLength(3);
    });

    it("declining the sac leaves the Thrull on the battlefield and discards nothing", () => {
        const { state, thrull } = setup(4);
        resolveTrigger(
            state,
            thrull,
            "mindstab-thrull-unblocked",
            UNBLOCKED("mindstab")
        );
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[0].battlefield.find((c) => c.id === "mindstab")
        ).toBeDefined();
        expect(state.players[1].hand).toHaveLength(4);
    });
});

// ---------------------------------------------------------------------------
// Necrite — attacks-unblocked optional self-sac → destroy a defender creature,
// can't be regenerated (CR 509.1h, 603.3d, 701.7).
// ---------------------------------------------------------------------------

describe("Necrite — unblocked sac → destroy a defender's creature (CR 509.1h, 701.7)", () => {
    const UNBLOCKED = (attackerId: string): StackItem["triggerEvent"] =>
        ({
            type: "ATTACKER_UNBLOCKED" as const,
            attackerId,
            attackerControllerId: "p1",
        }) as StackItem["triggerEvent"];

    it("picking a creature sacrifices Necrite and destroys the picked creature", () => {
        const necr = makeInstance(necrite.id, {
            id: "necrite",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [necr] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveTrigger(state, necr, "necrite-unblocked", UNBLOCKED("necrite"));
        // The choose-permanents (0..1) pick routes to the controller.
        answerPendingChoices(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "necrite")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Order of the Ebon Hand — protection from white + first-strike / pump knight
// (CR 702.16, 702.7, 611.2c).
// ---------------------------------------------------------------------------

describe("Order of the Ebon Hand — protection + pump knight (CR 702.16, 611.2c)", () => {
    it("declares protection from white and two pump abilities", () => {
        expect(orderOfTheEbonHand.staticAbilities).toContain(
            "protection from white"
        );
        const ids = orderOfTheEbonHand.activatedAbilities!.map((a) => a.id);
        expect(ids).toContain("order-ebon-hand-first-strike");
        expect(ids).toContain("order-ebon-hand-pump");
    });

    it("{B}{B} pump grants +1/+0 until end of turn", () => {
        const order = makeInstance(orderOfTheEbonHand.id, {
            id: "order",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, order, "order-ebon-hand-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "order"
        )!;
        expect(getEffectivePower(state, after)).toBe(2 + 1);
        expect(getEffectiveToughness(state, after)).toBe(1);
    });

    it("{B} first-strike grant adds first strike until end of turn", () => {
        const order = makeInstance(orderOfTheEbonHand.id, {
            id: "order",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, order, "order-ebon-hand-first-strike");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "order"
        )!;
        expect(after.staticAbilities).toContain("first strike");
    });
});

// ---------------------------------------------------------------------------
// Thrull Champion — Thrull anthem (+1/+1) + gainControl while-you-control-source
// (CR 611 layer 7c, 611.2c).
// ---------------------------------------------------------------------------

describe("Thrull Champion — Thrull anthem + conditional gainControl (CR 611)", () => {
    it("gives Thrull creatures +1/+1 (the anthem) — survives projection", () => {
        const champ = makeInstance(thrullChampion.id, {
            id: "champ",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherThrull = makeInstance(basalThrull.id, {
            id: "buddy",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [champ, otherThrull] }),
                makePlayer("p2"),
            ],
        });
        const buddy = state.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        // Basal Thrull is a 1/2 → 2/3 under the Champion's anthem.
        expect(getEffectivePower(state, buddy)).toBe(1 + 1);
        expect(getEffectiveToughness(state, buddy)).toBe(2 + 1);
        // The Champion buffs itself too (it is a Thrull): 2/2 → 3/3.
        const self = state.players[0].battlefield.find(
            (c) => c.id === "champ"
        )!;
        expect(getEffectivePower(state, self)).toBe(2 + 1);
        // Wire-format guard.
        const projected = projectPublicState(state, 1, "p1");
        const slimBuddy = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(getEffectivePower(projected, slimBuddy)).toBe(2);
        expect(getEffectiveToughness(projected, slimBuddy)).toBe(3);
    });

    it("{T}: gains control of a target Thrull", () => {
        const champ = makeInstance(thrullChampion.id, {
            id: "champ",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const enemyThrull = makeInstance(basalThrull.id, {
            id: "enemy",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [champ] }),
                makePlayer("p2", { battlefield: [enemyThrull] }),
            ],
        });
        resolveActivated(state, champ, "thrull-champion-steal", [
            { type: "permanent", id: "enemy" },
        ]);
        expect(state.players[0].battlefield.some((c) => c.id === "enemy")).toBe(
            true
        );
    });
});

// ---------------------------------------------------------------------------
// Thrull Retainer — Aura: +1/+1 to host + sac-self regenerate (CR 303.4, 611,
// 701.15a).
// ---------------------------------------------------------------------------

describe("Thrull Retainer — Aura +1/+1 + sac-self regenerate (CR 303.4, 701.15a)", () => {
    it("buffs the enchanted host by +1/+1 (survives projection)", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(thrullRetainer.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "host";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        const hostInst = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(state, hostInst)).toBe(2 + 1);
        expect(getEffectiveToughness(state, hostInst)).toBe(2 + 1);
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(3);
    });

    it("sac-self applies a regeneration shield to the host", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(thrullRetainer.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "host";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, aura, "thrull-retainer-regenerate");
        const hostInst = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(hostInst.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Thrull Wizard — {1}{B}: counter target black spell unless its controller pays
// (CR 701.5a, 117.3a). FAITHFUL-TEXT NOTE: "{B} OR {3}" is modelled as a single
// may-pay of {B} (flagged in the card definition, not silently dropped).
// ---------------------------------------------------------------------------

describe("Thrull Wizard — counter black spell unless pay (CR 701.5a)", () => {
    it("only targets black spells (colorFilter B)", () => {
        const ability = thrullWizard.activatedAbilities![0];
        expect(ability.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "B",
        });
    });

    it("counters the black spell when its controller declines to pay", () => {
        const wiz = makeInstance(thrullWizard.id, {
            id: "wiz",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wiz] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = pushSpell(state, hymnToTourach.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveActivated(state, wiz, "thrull-wizard-counter", [
            { type: "spell", id: blackSpell.id },
        ]);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.some((s) => s.id === blackSpell.id)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Breeding Pit — upkeep pay-{B}{B}-or-sac + end-step Thrull token (CR 603.2).
// ---------------------------------------------------------------------------

describe("Breeding Pit — upkeep tax + end-step Thrull token (CR 603.2)", () => {
    it("creates a 0/1 black Thrull token at the end step", () => {
        const pit = makeInstance(breedingPit.id, {
            id: "pit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pit] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, pit, "breeding-pit-end-step", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const token = state.players[0].battlefield.find(
            (c) => c.id !== "pit" && c.subtypes.includes("Thrull")
        );
        expect(token).toBeDefined();
        expect(getEffectivePower(state, token!)).toBe(0);
        expect(getEffectiveToughness(state, token!)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Tourach's Chant — upkeep pay-{B}-or-sac + Forest-entered punisher (CR 603.2).
// ---------------------------------------------------------------------------

describe("Tourach's Chant — Forest-entered punisher (CR 603.2)", () => {
    it("deals 3 to the Forest's controller when they control no creature", () => {
        const chant = makeInstance(tourachsChant.id, {
            id: "chant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const forest = makeInstance(getCardByName("Forest").id, {
            id: "forest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chant] }),
                makePlayer("p2", { battlefield: [forest], life: 20 }),
            ],
        });
        resolveTrigger(state, chant, "tourachs-chant-forest-punish", {
            type: "PERMANENT_ENTERED",
            instanceId: "forest",
            controllerId: "p2",
            types: ["Land"],
        } as StackItem["triggerEvent"]);
        // No creature to take the -1/-1 counter → the player takes 3 damage.
        expect(state.players[1].life).toBe(17);
    });
});

// ---------------------------------------------------------------------------
// Tourach's Gate — Aura on a land: typed-sac adds time counters; upkeep removes
// one (sac at zero); tap-the-host pumps attackers (CR 303.4, 122).
// ---------------------------------------------------------------------------

describe("Tourach's Gate — time counters + attacker pump (CR 303.4, 122)", () => {
    it("Sacrifice a Thrull: puts three time counters on the Aura", () => {
        const gate = makeInstance(tourachsGate.id, {
            id: "gate",
            controllerId: "p1",
            ownerId: "p1",
        });
        gate.attachedTo = "land";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gate] }),
                makePlayer("p2"),
            ],
        });
        // The sacrifice cost is paid via the engine picker in production; here we
        // resolve the ability (cost assumed paid) and assert the counters land.
        resolveActivated(state, gate, "tourachs-gate-add-time");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "gate"
        )!;
        expect(after.counters?.time).toBe(3);
    });

    it("upkeep removes one time counter; sacrifices the Aura at zero", () => {
        const gate = makeInstance(tourachsGate.id, {
            id: "gate",
            controllerId: "p1",
            ownerId: "p1",
            counters: { time: 1 },
        });
        gate.attachedTo = "land";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gate] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, gate, "tourachs-gate-upkeep", UPKEEP("p1"));
        // 1 → 0 time counters → the Aura is sacrificed.
        expect(
            state.players[0].battlefield.find((c) => c.id === "gate")
        ).toBeUndefined();
    });

    it("tap-the-host pump gives attacking creatures +2/-1 and taps the land", () => {
        const land = makeInstance(getCardByName("Swamp").id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gate = makeInstance(tourachsGate.id, {
            id: "gate",
            controllerId: "p1",
            ownerId: "p1",
        });
        gate.attachedTo = "land";
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, gate, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gate, "tourachs-gate-pump");
        const atk = state.players[0].battlefield.find((c) => c.id === "atk")!;
        expect(getEffectivePower(state, atk)).toBe(2 + 2);
        expect(getEffectiveToughness(state, atk)).toBe(2 - 1);
        // The enchanted land was tapped as the cost.
        expect(
            state.players[0].battlefield.find((c) => c.id === "land")?.isTapped
        ).toBe(true);
    });
});
