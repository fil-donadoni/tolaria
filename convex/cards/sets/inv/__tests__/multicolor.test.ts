// Per-card behavior tests for INV gold cards (`convex/cards/sets/inv/multicolor.ts`).
// Both cards belong to the Domain capability cluster (issue #1066). The
// `{ domain: { of } }` value member and the `winGame` Op each already have
// their own permanent interpreter test (`convex/gre/effects/__tests__/interpreter.test.ts`)
// per the new-construct regime (ADR 0045) — the tests here assert the
// CARD-level wiring: Ordered Migration's Domain-scaled token count, and
// Coalition Victory's compound win predicate (both clauses required).
//
// First-printing audit (ADR 0041): some cards exercised below were first
// implemented as part of this INV tranche but are REPRINTS — their
// definitions now live in their earliest-paper-printing home sets, and INV
// keeps only a `CardPrint`. The behaviour suites stay with the tranche that
// authored them and import the definition from its home module.

import { describe, it, expect } from "vitest";
import type { CardType, TargetSelection } from "../../../types";
import {
    orderedMigration,
    coalitionVictory,
    angelicShield,
    wingsOfHope,
    teferisMoat,
    sleepersRobe,
    stalkingAssassin,
    urborgDrake,
    vileConsumption,
    recoil,
    agonizingDemise,
    blazingSpecter,
    bloodstoneCameo,
    firescreamer,
    hoodedKavu,
    plagueSpores,
    recklessAssault,
    shivanOasis,
    smolderingTar,
    trenchWurm,
    trollHornCameo,
    urborgVolcano,
    viciousKavu,
    artifactMutation,
    firesOfYavimaya,
    frenziedTilling,
    huntingKavu,
    meteorStorm,
    ragingKavu,
    voraciousCobra,
    yavimayaKavu,
    firebrandRanger,
    savageOffensive,
    viashinoGrappler,
    armadilloCloak,
    auraShards,
    captainSisay,
    chargingTroll,
    hornedCheetah,
    noblePanther,
    sabertoothNishoba,
    dromar,
    rith,
    treva,
    stormscapeApprentice,
    stormscapeMaster,
    nightscapeMaster,
    thunderscapeApprentice,
    thunderscapeMaster,
    sterlingGrove,
    revivingVapors,
    barrinsSpite,
    seersVision,
    aetherRift,
    shivanEmissary,
    duelingGrounds,
} from "../multicolor";
import { lobotomy } from "../../tmp/multicolor";
import { simoon } from "../../vis/multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import {
    finalizeTargetSelection,
    tapSourceIntoPayment,
} from "../../../../game";
import { getManaTapOptionsDetailed } from "../../../../gre/constants";
import {
    plains,
    island,
    swamp,
    mountain,
    forest,
    icyManipulator,
} from "../../lea/colorless";
import {
    grizzlyBears,
    scatheZombies,
    airElemental,
    dwarvenWarriors,
    benalishHero,
} from "../../lea";
import { empressGalina } from "../blue";
import { registerTokenDefinition } from "../../..";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import {
    validateAttackerEligibility,
    mustAttack,
    getAttackerCapEffect,
    getBlockerCapEffect,
    validateDeclaredAttackers,
    validateDeclaredBlockers,
} from "../../../../gre/combat";
import { cavernsOfDespair } from "../../leg/red";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { resolveActivated, resolveTrigger, submitChoice } from "./helpers";

/** Drives a CR 603.3d trigger target choice through the real machinery (issue
 *  #1193): raise the `kind:"trigger"` PendingTarget on the top-of-stack
 *  trigger, write the chosen selection (or `[]` to decline an "up to"
 *  requirement), then finalize it onto the trigger before resolution. Returns
 *  whether a real choice was raised — `false` when the engine auto-locked the
 *  target set (sole mandatory target, or "up to one" with none legal), in
 *  which case the trigger's `targets` are already written. */
function driveTriggerTarget(
    state: GameState,
    selected: TargetSelection[]
): boolean {
    const raised = raiseTriggerTargetSelection(state);
    if (raised) {
        state.pendingTarget!.selected = selected;
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
    }
    return raised;
}

describe("Ordered Migration (CR 111 / 701.7 token creation, Domain, issue #1066)", () => {
    it("creates one 1/1 blue flying Bird per basic land type controlled", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "om-pl",
                            controllerId: "p1",
                        }),
                        makeInstance(island.id, {
                            id: "om-is",
                            controllerId: "p1",
                        }),
                        makeInstance(swamp.id, {
                            id: "om-sw",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, orderedMigration.id, "p1");
        resolveTopOfStack(state);
        const birds = state.players[0].battlefield.filter(
            (c) => c.id !== "om-pl" && c.id !== "om-is" && c.id !== "om-sw"
        );
        expect(birds).toHaveLength(3);
        for (const bird of birds) {
            expect(bird.power).toBe(1);
            expect(bird.toughness).toBe(1);
            expect(bird.staticAbilities).toContain("flying");
        }
    });

    it("creates no tokens for a player with no basic lands", () => {
        const state = makeState();
        pushSpell(state, orderedMigration.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("Coalition Victory (CR 104.2a alternate win, Domain, issue #1066)", () => {
    /** Five distinct basic lands (Domain 5) plus one creature per color,
     *  swappable per test so exactly one clause can be dropped at a time. */
    function fullBoard(overrides: {
        omitLand?: "Plains" | "Island" | "Swamp" | "Mountain" | "Forest";
        omitColor?: "W" | "U" | "B" | "R" | "G";
    }) {
        const lands = [
            { def: plains, subtype: "Plains" },
            { def: island, subtype: "Island" },
            { def: swamp, subtype: "Swamp" },
            { def: mountain, subtype: "Mountain" },
            { def: forest, subtype: "Forest" },
        ]
            .filter((l) => l.subtype !== overrides.omitLand)
            .map((l, i) =>
                makeInstance(l.def.id, {
                    id: `cv-land-${i}`,
                    controllerId: "p1",
                })
            );

        const colorCards: Record<"W" | "U" | "B" | "R" | "G", string> = {
            W: "test-cv-white",
            U: "test-cv-blue",
            B: "test-cv-black",
            R: "test-cv-red",
            G: "test-cv-green",
        };
        for (const [color, id] of Object.entries(colorCards)) {
            registerTokenDefinition({
                id,
                name: id,
                rarity: "common",
                manaCost: { [color]: 1 },
                types: ["Creature"],
                power: 1,
                toughness: 1,
            });
        }
        const creatures = (
            Object.entries(colorCards) as [
                "W" | "U" | "B" | "R" | "G",
                string,
            ][]
        )
            .filter(([color]) => color !== overrides.omitColor)
            .map(([color, id], i) =>
                makeInstance(id, {
                    id: `cv-creature-${color}-${i}`,
                    controllerId: "p1",
                })
            );

        return makeState({
            players: [
                makePlayer("p1", { battlefield: [...lands, ...creatures] }),
                makePlayer("p2"),
            ],
        });
    }

    it("wins when the controller has a land of each basic type AND a creature of each color", () => {
        const state = fullBoard({});
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it("does NOT win when missing one basic land type (Domain 4)", () => {
        const state = fullBoard({ omitLand: "Forest" });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("does NOT win when missing a creature of one color", () => {
        const state = fullBoard({ omitColor: "G" });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("a multicolour creature covers each of its colors", () => {
        // 5 basic lands + ONE Naya-style tri-color creature (W/R/G) + mono U
        // + mono B creatures — still covers all five colors with fewer
        // creatures than five.
        const lands = [plains, island, swamp, mountain, forest].map((def, i) =>
            makeInstance(def.id, {
                id: `cv-multi-land-${i}`,
                controllerId: "p1",
            })
        );
        const triId = "test-cv-tricolor";
        registerTokenDefinition({
            id: triId,
            name: triId,
            rarity: "common",
            manaCost: { W: 1, R: 1, G: 1 },
            types: ["Creature"],
            power: 3,
            toughness: 3,
        });
        registerTokenDefinition({
            id: "test-cv-mono-u2",
            name: "test-cv-mono-u2",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        registerTokenDefinition({
            id: "test-cv-mono-b2",
            name: "test-cv-mono-b2",
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const creatures = [
            makeInstance(triId, { id: "cv-tri", controllerId: "p1" }),
            makeInstance("test-cv-mono-u2", {
                id: "cv-u2",
                controllerId: "p1",
            }),
            makeInstance("test-cv-mono-b2", {
                id: "cv-b2",
                controllerId: "p1",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [...lands, ...creatures] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────
// staticEffects[] coverage (issue #1075) — Angelic Shield / Wings of Hope /
// Teferi's Moat. The catalogue smoke/static sweeps only iterate `effects[]`,
// so a card whose entire behavior is a `staticEffects[]` continuous effect
// gets no coverage from those sweeps and needs a hand-written test per the
// mandatory card-testing table (`.claude/rules/gre-development.md`).
// ─────────────────────────────────────────────────────────────────────────

describe("Angelic Shield (controller-scoped anthem +0/+1, CR 611/613 layer 7c)", () => {
    function setup() {
        const shield = makeInstance(angelicShield.id, {
            id: "shield",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = makeInstance(grizzlyBears.id, {
            id: "dude",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shield, dude] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }
    it("gives +0/+1 to a creature you control", () => {
        const { state } = setup();
        const d = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, d)).toBe(2);
        expect(getEffectiveToughness(state, d)).toBe(3);
    });
    it("does NOT buff a creature without Angelic Shield in play", () => {
        const { state } = setup();
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "shield"
        );
        const d = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, d)).toBe(2);
        expect(getEffectiveToughness(state, d)).toBe(2);
    });
    it("wire format: the +0/+1 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "dude"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Wings of Hope (Aura +1/+3 + flying, CR 611/613 layer 6/7c)", () => {
    function setup() {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wingsOfHope.id, {
            id: "wings",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }
    it("grants +1/+3 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(5);
    });
    it("grants flying to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.staticAbilities).not.toContain("flying");
        // Flying is a layer-6 keyword grant computed at read time — the raw
        // instance's own staticAbilities never mutate; the interpreter reads
        // it via the same staticEffects scan getEffective{Power,Toughness}
        // uses. Assert via the declared keyword-grant static effect, mirroring
        // the Wings of Aesthir precedent (ice/multicolor.ts).
        const grants = (wingsOfHope.staticEffects ?? [])
            .filter((e) => e.kind === "keyword-grant")
            .map((e) => (e as { keyword: string }).keyword);
        expect(grants).toEqual(["flying"]);
    });
    it("wire format: the +1/+3 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});

describe("Teferi's Moat (chosen-color no-fly attack lock, CR 508/509 + 603.6b)", () => {
    function setup(chosenColor: string, attackerCardId: string) {
        const moat = makeInstance(teferisMoat.id, {
            id: "moat",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: chosenColor,
        });
        const attacker = makeInstance(attackerCardId, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [moat] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        const live = state.players[1].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        return { state, live };
    }
    it("forbids a chosen-color, non-flying creature from attacking the Moat's controller", () => {
        // Grizzly Bears is a mono-green ({G}) vanilla body.
        const { state, live } = setup("G", grizzlyBears.id);
        const v = validateAttackerEligibility(live, [], state);
        expect(v.eligible).toBe(false);
    });
    it("allows a different-color creature to attack", () => {
        // Scathe Zombies is mono-black ({B}); Teferi's Moat locked green.
        const { state, live } = setup("G", scatheZombies.id);
        expect(validateAttackerEligibility(live, [], state).eligible).toBe(
            true
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────
// UB free-tranche coverage (issue #1076) — per the card-testing convention,
// only the cards whose behavior is board-visible and NOT covered by the
// catalogue-wide per-Op sweeps get a hand-written describe here: a
// staticEffects[] keyword-grant (Sleeper's Robe), two board-visible
// activatedAbilities[] (Stalking Assassin), a staticEffects[]
// attack-requirement (Urborg Drake), and a triggered-grant continuous effect
// (Vile Consumption). Spinal Embrace / Undermine / Slinking Serpent /
// Vodalian Zombie are plain `effects[]`/keyword cards reusing
// already-exercised Ops and ride the per-Op regime (catalogue
// `effectScripts.test.ts` static sweep + `effectScriptSmoke.test.ts`
// canned-scenario smoke test) with no hand-written test required. Recoil
// gets its own describe below: its `$bounced.owner` ref (issue #1106) is a
// NEW construct usage (the interpreter's `.owner` snapshot property has its
// own permanent test in `interpreter.test.ts`, but the per-Op regime still
// wants the CARD-level owner/controller divergence exercised here).
// ─────────────────────────────────────────────────────────────────────────

describe("Sleeper's Robe (fear keyword-grant + combat-damage draw, CR 702.14b / 510.4)", () => {
    it("grants fear to the host when the Aura resolves onto it", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sleepersRobe.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);
        const liveHost = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(liveHost.staticAbilities).toContain("fear");
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slimHost.staticAbilities).toContain("fear");
    });

    it("triggers when the enchanted creature deals combat damage to an opponent", () => {
        const robe = makeInstance(sleepersRobe.id, {
            id: "robe",
            controllerId: "p1",
            attachedTo: "host",
        });
        const trigger = sleepersRobe.triggeredAbilities![0];
        expect(
            trigger.matches(
                {
                    type: "DAMAGE_DEALT",
                    sourceInstanceId: "host",
                    sourceControllerId: "p1",
                    target: { type: "player", id: "p2" },
                    amount: 2,
                    isCombat: true,
                },
                robe
            )
        ).toBe(true);
    });

    it("does NOT trigger on non-combat damage, damage to a permanent, damage from a different source, or damage to its own controller", () => {
        const robe = makeInstance(sleepersRobe.id, {
            id: "robe",
            controllerId: "p1",
            attachedTo: "host",
        });
        const trigger = sleepersRobe.triggeredAbilities![0];
        const base = {
            type: "DAMAGE_DEALT" as const,
            sourceInstanceId: "host",
            sourceControllerId: "p1",
            target: { type: "player" as const, id: "p2" },
            amount: 2,
            isCombat: true,
        };
        expect(trigger.matches({ ...base, isCombat: false }, robe)).toBe(false);
        expect(
            trigger.matches(
                {
                    ...base,
                    target: { type: "permanent" as const, id: "p2creature" },
                },
                robe
            )
        ).toBe(false);
        expect(
            trigger.matches({ ...base, sourceInstanceId: "other" }, robe)
        ).toBe(false);
        expect(
            trigger.matches(
                { ...base, target: { type: "player" as const, id: "p1" } },
                robe
            )
        ).toBe(false);
    });

    it("resolves the may-draw effect: accepting draws a card", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
        });
        const robe = makeInstance(sleepersRobe.id, {
            id: "robe",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [host, robe],
                    library: [makeInstance(plains.id, { id: "lib-1" })],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...robe,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "sleepers-robe-combat-damage-draw",
            triggerSourceId: robe.id,
            triggerEvent: {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "host",
                sourceControllerId: "p1",
                target: { type: "player", id: "p2" },
                amount: 2,
                isCombat: true,
            } as never,
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on mayPay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].hand).toHaveLength(1);
    });
});

describe("Stalking Assassin (two tap-cost activated abilities, CR 605 / 701.26 / 701.8)", () => {
    function setup() {
        const assassin = makeInstance(stalkingAssassin.id, {
            id: "assassin",
            controllerId: "p1",
        });
        const foe = makeInstance(grizzlyBears.id, {
            id: "foe",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [assassin] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        return { state };
    }

    it("{3}{U}, {T}: taps target creature", () => {
        const { state } = setup();
        const assassin = state.players[0].battlefield[0];
        state.stack.push({
            ...assassin,
            zone: "stack",
            castById: "p1",
            abilityId: "stalking-assassin-tap",
            targets: [{ type: "permanent", id: "foe" }],
        });
        resolveTopOfStack(state);
        const foe = state.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(foe.isTapped).toBe(true);
    });

    it("{3}{B}, {T}: destroys target TAPPED creature", () => {
        const { state } = setup();
        const assassin = state.players[0].battlefield[0];
        state.players[1].battlefield[0].isTapped = true;
        state.stack.push({
            ...assassin,
            zone: "stack",
            castById: "p1",
            abilityId: "stalking-assassin-destroy",
            targets: [{ type: "permanent", id: "foe" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.some((c) => c.id === "foe")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "foe")).toBe(
            true
        );
    });
});

describe("Urborg Drake (flying + attacks-each-combat-if-able, CR 702.9b / 508.1d)", () => {
    it("mustAttack is true when eligible, false when tapped or summoning sick", () => {
        const drake = makeInstance(urborgDrake.id, { id: "drake" });
        const state = makeState();
        expect(mustAttack(drake, state)).toBe(true);
        expect(mustAttack({ ...drake, isTapped: true }, state)).toBe(false);
        expect(mustAttack({ ...drake, isSummoningSick: true }, state)).toBe(
            false
        );
    });
});

describe("Vile Consumption (triggered-grant to every creature, CR 113.1/611 + upkeep pay-or-sacrifice)", () => {
    function withVileConsumption(creatureController: "p1" | "p2" = "p1") {
        const vc = makeInstance(vileConsumption.id, {
            id: "vc",
            controllerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: creatureController,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield:
                        creatureController === "p1" ? [vc, bear] : [vc],
                }),
                makePlayer("p2", {
                    battlefield: creatureController === "p2" ? [bear] : [],
                }),
            ],
        });
        applySourceStaticEffects(state, vc);
        return { state, vc, bear };
    }

    it("grants the upkeep tax to every creature in play, either player's", () => {
        const { bear } = withVileConsumption("p2");
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "vile-consumption-upkeep"
            )
        ).toBe(true);
    });

    it("does NOT grant the tax to a non-creature (Vile Consumption itself stays untaxed)", () => {
        const { vc } = withVileConsumption();
        expect(
            effectiveTriggeredAbilities(vc).some(
                (a) => a.id === "vile-consumption-upkeep"
            )
        ).toBe(false);
    });

    it("fires the granted trigger at the creature controller's own upkeep (scope: your)", () => {
        const { state, bear } = withVileConsumption("p1");
        const triggers = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            } as never,
        ]);
        expect(
            triggers.some(
                (t) =>
                    t.triggeredAbilityId === "vile-consumption-upkeep" &&
                    t.triggerSourceId === bear.id
            )
        ).toBe(true);
        expect(
            collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p2",
                } as never,
            ]).some((t) => t.triggeredAbilityId === "vile-consumption-upkeep")
        ).toBe(false);
    });

    it("paying 1 life keeps the creature (CR 119.4)", () => {
        const { state } = withVileConsumption("p1");
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                } as never,
            ])
        );
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            true
        );
        expect(state.players[0].life).toBe(19);
    });

    it("declining sacrifices the creature (CR 701.21)", () => {
        const { state } = withVileConsumption("p1");
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                } as never,
            ])
        );
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
    });
});

describe("Recoil (bounce to OWNER's hand + owner discards, CR 400.7, issue #1106)", () => {
    it("bounces a permanent to its OWNER's hand and makes the OWNER discard, even when a different player controls it (Spinal Embrace shape)", () => {
        // A "stolen" creature: p2 owns it (CR 108.3), but p1 currently
        // controls it (mirrors what Spinal Embrace leaves behind — a control
        // change only mutates `controllerId`, it never relocates the
        // permanent out of the owner's battlefield array).
        const stolen = makeInstance(grizzlyBears.id, {
            id: "stolen-bear",
            controllerId: "p1",
            ownerId: "p2",
        });
        const p2Card = makeInstance(scatheZombies.id, {
            id: "p2-hand-card",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stolen] }),
                makePlayer("p2", { hand: [p2Card] }),
            ],
        });
        pushSpell(state, recoil.id, "p1", [
            { type: "permanent", id: "stolen-bear" },
        ]);
        resolveTopOfStack(state);
        // Bounced to the OWNER's (p2) hand, not the controller's (p1).
        expect(state.players[1].hand.some((c) => c.id === "stolen-bear")).toBe(
            true
        );
        expect(state.players[0].hand.some((c) => c.id === "stolen-bear")).toBe(
            false
        );
        // Discard suspends for the OWNER (p2), not the controller (p1).
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        submitChoice(state, ["p2-hand-card"]);
        // p2 (the owner) discarded — p1 (the former controller) never had a
        // discard prompt. p1's graveyard holds only the resolved Recoil
        // spell itself, not a discarded card.
        expect(
            state.players[1].graveyard.some((c) => c.id === "p2-hand-card")
        ).toBe(true);
        expect(
            state.players[0].graveyard.some((c) => c.id === "p2-hand-card")
        ).toBe(false);
    });

    it("survives projection: the OWNER's hand/graveyard reflect the bounce + discard (wire format)", () => {
        const stolen = makeInstance(grizzlyBears.id, {
            id: "stolen-bear-wire",
            controllerId: "p1",
            ownerId: "p2",
        });
        const p2Card = makeInstance(scatheZombies.id, {
            id: "p2-hand-card-wire",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stolen] }),
                makePlayer("p2", { hand: [p2Card] }),
            ],
        });
        pushSpell(state, recoil.id, "p1", [
            { type: "permanent", id: "stolen-bear-wire" },
        ]);
        resolveTopOfStack(state);
        submitChoice(state, ["p2-hand-card-wire"]);
        const projected = projectPublicState(state, 1, "p2");
        expect(
            projected.players[1].hand.some((c) => c?.id === "stolen-bear-wire")
        ).toBe(true);
        expect(
            projected.players[1].graveyard.some(
                (c) => c.id === "p2-hand-card-wire"
            )
        ).toBe(true);
    });
});

describe("Agonizing Demise (CR 702.33 Kicker + 701.8 destroy + 701.19c regen-suppression, issue #1077)", () => {
    function cast(kicked: boolean) {
        const foe = makeInstance(grizzlyBears.id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        const item: StackItem = pushSpell(state, agonizingDemise.id, "p1", [
            { type: "permanent", id: "foe" },
        ]);
        if (kicked) item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        return state;
    }

    it("unkicked: destroys the target creature, no damage dealt", () => {
        const state = cast(false);
        expect(state.players[1].battlefield.some((c) => c.id === "foe")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "foe")).toBe(
            true
        );
        expect(state.players[1].life).toBe(20);
    });

    it("kicked: also deals damage equal to the slain creature's power to its controller", () => {
        const state = cast(true);
        expect(state.players[1].graveyard.some((c) => c.id === "foe")).toBe(
            true
        );
        // Grizzly Bears is a 2/2 — 2 damage to its controller (p2).
        expect(state.players[1].life).toBe(18);
    });
});

describe("Blazing Specter (CR 702.9b flying + 702.10b haste + combat-damage discard, issue #1077)", () => {
    it("has flying and haste", () => {
        expect(blazingSpecter.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "haste"])
        );
    });

    it("triggers only on its own combat damage dealt to a player", () => {
        const specter = makeInstance(blazingSpecter.id, {
            id: "specter",
            controllerId: "p1",
        });
        const trigger = blazingSpecter.triggeredAbilities![0];
        const base = {
            type: "DAMAGE_DEALT" as const,
            sourceInstanceId: "specter",
            sourceControllerId: "p1",
            target: { type: "player" as const, id: "p2" },
            amount: 2,
            isCombat: true,
        };
        expect(trigger.matches(base, specter)).toBe(true);
        expect(trigger.matches({ ...base, isCombat: false }, specter)).toBe(
            false
        );
        expect(
            trigger.matches({ ...base, sourceInstanceId: "other" }, specter)
        ).toBe(false);
        expect(
            trigger.matches(
                { ...base, target: { type: "permanent" as const, id: "x" } },
                specter
            )
        ).toBe(false);
    });

    it("makes the damaged player discard a card of their own choosing", () => {
        const specter = makeInstance(blazingSpecter.id, {
            id: "specter",
            controllerId: "p1",
        });
        const oppCard = makeInstance(grizzlyBears.id, {
            id: "opp-hand-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [specter] }),
                makePlayer("p2", { hand: [oppCard] }),
            ],
        });
        resolveTrigger(state, specter, "blazing-specter-damage-discard", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "specter",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 2,
            isCombat: true,
        } as never);
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        submitChoice(state, ["opp-hand-1"]);
        expect(state.players[1].hand).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "opp-hand-1")
        ).toBe(true);
    });
});

describe("Firescreamer (CR 613.4c firebreathing pump, issue #1077)", () => {
    it("{R}: gets +1/+0 until end of turn", () => {
        const creature = makeInstance(firescreamer.id, {
            id: "fs",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, creature, "firescreamer-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "fs")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
});

describe("Hooded Kavu (CR 702.14b fear temporary grant, issue #1077)", () => {
    it("{B}: gains fear until end of turn", () => {
        const creature = makeInstance(hoodedKavu.id, {
            id: "hk",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, creature, "hooded-kavu-fear");
        const live = state.players[0].battlefield.find((c) => c.id === "hk")!;
        expect(live.staticAbilities).toContain("fear");
    });
});

describe("Plague Spores (CR 701.8 destroy x2 + 701.19c regen-suppression, issue #1077)", () => {
    it("destroys both the creature and the land, neither regenerable", () => {
        const foe = makeInstance(grizzlyBears.id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeInstance(forest.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [foe, land] }),
            ],
        });
        pushSpell(state, plagueSpores.id, "p1", [
            { type: "permanent", id: "foe" },
            { type: "permanent", id: "land" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "foe",
            "land",
        ]);
    });
});

describe("Reckless Assault (CR 602.1/118.5 mana+life activation cost, issue #1077)", () => {
    it("deals 1 damage to any target", () => {
        const ench = makeInstance(recklessAssault.id, {
            id: "ra",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ench] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ench, "reckless-assault-ping", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Smoldering Tar (CR 603.6a upkeep target-player drain + 701.21 sacrifice-for-damage, issue #1077)", () => {
    it("upkeep trigger: the chosen target player loses 1 life (CR 603.3d — target at stack placement)", () => {
        const tar = makeInstance(smolderingTar.id, {
            id: "tar",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tar] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...tar,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "smoldering-tar-upkeep",
            triggerSourceId: tar.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            } as never,
            // Un-set slot so `raiseTriggerTargetSelection` treats it as a
            // target candidate (CR 603.3d).
            targets: undefined,
        });
        // "target player" (count 1) — both players are legal, so a real
        // choice is owed at stack placement (not a resolution-time pick).
        expect(driveTriggerTarget(state, [{ type: "player", id: "p2" }])).toBe(
            true
        );
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
        expect(state.players[0].life).toBe(20);
    });

    it("upkeep trigger: the controller may target themselves (open choice, either player)", () => {
        const tar = makeInstance(smolderingTar.id, {
            id: "tar",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tar] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...tar,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "smoldering-tar-upkeep",
            triggerSourceId: tar.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            } as never,
            targets: undefined,
        });
        expect(driveTriggerTarget(state, [{ type: "player", id: "p1" }])).toBe(
            true
        );
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(20);
    });

    it("Sacrifice: deals 4 damage to target creature", () => {
        const tar = makeInstance(smolderingTar.id, {
            id: "tar",
            controllerId: "p1",
        });
        const foe = makeInstance(grizzlyBears.id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tar] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, tar, "smoldering-tar-detonate", [
            { type: "permanent", id: "foe" },
        ]);
        expect(state.players[1].battlefield.some((c) => c.id === "foe")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "foe")).toBe(
            true
        );
    });
});

describe("Trench Wurm (CR 605 activated ability, 701.8 destroy nonbasic land, issue #1077)", () => {
    it("{2}{R}, {T}: destroys target nonbasic land", () => {
        const wurm = makeInstance(trenchWurm.id, {
            id: "wurm",
            controllerId: "p1",
        });
        const nonbasic = makeInstance(urborgVolcano.id, {
            id: "vol",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wurm] }),
                makePlayer("p2", { battlefield: [nonbasic] }),
            ],
        });
        resolveActivated(state, wurm, "trench-wurm-destroy-land", [
            { type: "permanent", id: "vol" },
        ]);
        expect(state.players[1].battlefield.some((c) => c.id === "vol")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "vol")).toBe(
            true
        );
    });
});

describe("Vicious Kavu (CR 508.1 attacks trigger + 613.4c pump, issue #1077)", () => {
    it("triggers only when it is among the declared attackers", () => {
        const kavu = makeInstance(viciousKavu.id, { id: "vk" });
        const trigger = viciousKavu.triggeredAbilities![0];
        expect(
            trigger.matches(
                {
                    type: "ATTACKERS_DECLARED",
                    attackerIds: ["vk", "other"],
                } as never,
                kavu
            )
        ).toBe(true);
        expect(
            trigger.matches(
                { type: "ATTACKERS_DECLARED", attackerIds: ["other"] } as never,
                kavu
            )
        ).toBe(false);
    });

    it("gets +2/+0 until end of turn when it attacks", () => {
        const kavu = makeInstance(viciousKavu.id, {
            id: "vk",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, kavu, "vicious-kavu-attacks", {
            type: "ATTACKERS_DECLARED",
            attackerIds: ["vk"],
        } as never);
        const live = state.players[0].battlefield.find((c) => c.id === "vk")!;
        expect(getEffectivePower(state, live)).toBe(4);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
});

describe("Artifact Mutation (CR 701.8 destroy + 111 token creation scaled by mana value, issue #1078)", () => {
    it("destroys the target artifact (can't be regenerated) and creates Saprolings equal to its mana value", () => {
        const artifact = makeInstance(icyManipulator.id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        pushSpell(state, artifactMutation.id, "p1", [
            { type: "permanent", id: "art" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["art"]);
        // Icy Manipulator is mana value 4 ({4}).
        const tokens = state.players[0].battlefield;
        expect(tokens).toHaveLength(4);
        for (const t of tokens) {
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
        }
    });
});

describe("Fires of Yavimaya (controller-scoped haste anthem + sacrifice-for-pump, CR 611/613 layer 6, issue #1078)", () => {
    it("grants haste to creatures you control (GRE + wire), not the opponent's", () => {
        const enchantment = makeInstance(firesOfYavimaya.id, {
            id: "foy",
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
                makePlayer("p1", { battlefield: [enchantment, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        applySourceStaticEffects(state, enchantment);
        const mineLive = state.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        const theirsLive = state.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(mineLive.staticAbilities).toContain("haste");
        expect(theirsLive.staticAbilities).not.toContain("haste");
        const projected = projectPublicState(state, 1, "p1");
        const slimMine = projected.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(slimMine.staticAbilities).toContain("haste");
    });

    it("sacrifice: target creature gets +2/+2 until end of turn", () => {
        const enchantment = makeInstance(firesOfYavimaya.id, {
            id: "foy2",
            controllerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "tgt",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchantment, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, enchantment, "fires-of-yavimaya-pump", [
            { type: "permanent", id: "tgt" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "tgt")!;
        expect(getEffectivePower(state, live)).toBe(4);
        expect(getEffectiveToughness(state, live)).toBe(4);
    });
});

describe("Frenzied Tilling (CR 701.8 destroy + 401.4 search/tapped/701.24 shuffle, issue #1078)", () => {
    it("destroys the targeted land, then searches a basic land onto the battlefield tapped", () => {
        const targetLand = makeInstance(forest.id, {
            id: "victim-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [makeInstance(mountain.id, { id: "lib-mtn" })],
                }),
                makePlayer("p2", { battlefield: [targetLand] }),
            ],
        });
        pushSpell(state, frenziedTilling.id, "p1", [
            { type: "permanent", id: "victim-land" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        submitChoice(state, ["lib-mtn"]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim-land")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "victim-land")
        ).toBe(true);
        const found = state.players[0].battlefield.find(
            (c) => c.id === "lib-mtn"
        );
        expect(found).toBeDefined();
        expect(found?.isTapped).toBe(true);
        expect(state.players[0].library).toHaveLength(0);
    });
});

describe("Hunting Kavu (CR 602.1 tap ability, CR 508.1/509.1 attacking-without-flying target filter, CR 701.13 exile, issue #1078)", () => {
    it("exiles itself and the target creature", () => {
        const kavu = makeInstance(huntingKavu.id, {
            id: "hk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const foe = makeInstance(grizzlyBears.id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, kavu, "hunting-kavu-exile", [
            { type: "permanent", id: "foe" },
        ]);
        expect(state.players[0].battlefield.some((c) => c.id === "hk")).toBe(
            false
        );
        expect(state.players[0].exile.map((c) => c.id)).toContain("hk");
        expect(state.players[1].battlefield.some((c) => c.id === "foe")).toBe(
            false
        );
        expect(state.players[1].exile.map((c) => c.id)).toContain("foe");
    });
});

describe("Meteor Storm (CR 118.3/701.8 random-discard activation cost + 120.1 damage, issue #1078)", () => {
    it("deals 4 damage to any target", () => {
        const ench = makeInstance(meteorStorm.id, {
            id: "ms",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ench] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ench, "meteor-storm-blast", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(16);
    });
});

describe("Raging Kavu (CR 702.8b flash + 702.10b haste, issue #1078)", () => {
    it("has flash and haste", () => {
        expect(ragingKavu.staticAbilities).toEqual(
            expect.arrayContaining(["flash", "haste"])
        );
        expect(ragingKavu.power).toBe(3);
        expect(ragingKavu.toughness).toBe(1);
    });
});

describe("Simoon (CR 115 target-opponent player selector + 120.1 damage sweep, issue #1078)", () => {
    it("deals 1 damage to each creature the target opponent controls, not your own", () => {
        const theirs1 = makeInstance(grizzlyBears.id, {
            id: "theirs1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const theirs2 = makeInstance(grizzlyBears.id, {
            id: "theirs2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs1, theirs2] }),
            ],
        });
        pushSpell(state, simoon.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const t1 = state.players[1].battlefield.find(
            (c) => c.id === "theirs1"
        )!;
        expect(t1.damageMarked).toBe(1);
        // theirs2 is a vanilla 2/2 — 1 damage doesn't kill it, but marks it.
        const t2 = state.players[1].battlefield.find(
            (c) => c.id === "theirs2"
        )!;
        expect(t2.damageMarked).toBe(1);
        const mineLive = state.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(mineLive.damageMarked ?? 0).toBe(0);
    });
});

describe("Voracious Cobra (CR 702.7 first strike + 510.4/603.2 combat-damage-to-a-creature destroys it, issue #1078)", () => {
    it("triggers only on its own combat damage dealt to a permanent", () => {
        const cobra = makeInstance(voraciousCobra.id, {
            id: "cobra",
            controllerId: "p1",
        });
        const trigger = voraciousCobra.triggeredAbilities![0];
        const base = {
            type: "DAMAGE_DEALT" as const,
            sourceInstanceId: "cobra",
            sourceControllerId: "p1",
            target: { type: "permanent" as const, id: "victim" },
            amount: 2,
            isCombat: true,
        };
        expect(trigger.matches(base, cobra)).toBe(true);
        expect(trigger.matches({ ...base, isCombat: false }, cobra)).toBe(
            false
        );
        expect(
            trigger.matches({ ...base, sourceInstanceId: "other" }, cobra)
        ).toBe(false);
        expect(
            trigger.matches(
                { ...base, target: { type: "player" as const, id: "p2" } },
                cobra
            )
        ).toBe(false);
    });

    it("destroys the creature it dealt combat damage to (via the newly-censused $event.damagedPermanent row)", () => {
        const cobra = makeInstance(voraciousCobra.id, {
            id: "cobra",
            controllerId: "p1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cobra] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveTrigger(state, cobra, "voracious-cobra-damage-destroy", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "cobra",
            sourceControllerId: "p1",
            target: { type: "permanent", id: "victim" },
            amount: 2,
            isCombat: true,
        } as never);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
    });
});

describe("Yavimaya Kavu (CR 604.3 characteristic-defining P/T, global battlefield-wide red/green creature counts, issue #1078)", () => {
    function setup() {
        const kavu = makeInstance(yavimayaKavu.id, {
            id: "yk",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Red creature (controlled by p1, counts toward power). Yavimaya
        // Kavu is itself R+G, so it self-counts on both sides too (below).
        const red = makeInstance(hoodedKavu.id, {
            id: "red-creature",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Green creature (controlled by p2 — GLOBAL count, not "you control").
        const green = makeInstance(grizzlyBears.id, {
            id: "green-creature",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu, red] }),
                makePlayer("p2", { battlefield: [green] }),
            ],
        });
        return { state };
    }

    it("power = red creatures on the battlefield (any controller), toughness = green creatures", () => {
        const { state } = setup();
        const live = state.players[0].battlefield.find((c) => c.id === "yk")!;
        // Red creatures: hoodedKavu (mono red) + Yavimaya Kavu itself (RG gold
        // — its OWN colors are R and G, derived from its mana pips, so the
        // CDA counts itself, the well-known real-card "gotcha"). Power = 2.
        expect(getEffectivePower(state, live)).toBe(2);
        // Green creatures: grizzlyBears (mono green) + Yavimaya Kavu itself
        // (also green). Toughness = 2.
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("wire format: the CDA survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "yk"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Firebrand Ranger (CR 602.1 tap ability, hand-source moveZone, issue #1078)", () => {
    it("puts a chosen basic land from hand onto the battlefield", () => {
        const ranger = makeInstance(firebrandRanger.id, {
            id: "fr",
            controllerId: "p1",
            ownerId: "p1",
        });
        const landInHand = makeInstance(forest.id, {
            id: "hand-forest",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ranger], hand: [landInHand] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ranger, "firebrand-ranger-land-drop");
        expect(state.pendingChoices?.[0]?.kind).toBe("choose-hand-card");
        submitChoice(state, ["hand-forest"]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "hand-forest")
        ).toBe(true);
        expect(state.players[0].hand.some((c) => c.id === "hand-forest")).toBe(
            false
        );
    });
});

describe("Savage Offensive (CR 702.33 Kicker + 611/613 temporary keyword grant + pump, issue #1078)", () => {
    function cast(kicked: boolean) {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2"),
            ],
        });
        const item: StackItem = pushSpell(state, savageOffensive.id, "p1");
        if (kicked) item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        return state;
    }

    it("unkicked: grants first strike, no +1/+1", () => {
        const state = cast(false);
        const live = state.players[0].battlefield.find((c) => c.id === "mine")!;
        expect(live.staticAbilities).toContain("first strike");
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("kicked: grants first strike AND +1/+1", () => {
        const state = cast(true);
        const live = state.players[0].battlefield.find((c) => c.id === "mine")!;
        expect(live.staticAbilities).toContain("first strike");
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Viashino Grappler (CR 613.4c temporary trample grant, issue #1078)", () => {
    it("{G}: gains trample until end of turn", () => {
        const creature = makeInstance(viashinoGrappler.id, {
            id: "vg",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, creature, "viashino-grappler-trample");
        const live = state.players[0].battlefield.find((c) => c.id === "vg")!;
        expect(live.staticAbilities).toContain("trample");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// GW free-tranche coverage (issue #1079) — per the card-testing convention,
// only board-visible behavior not already covered by the catalogue-wide
// per-Op sweeps gets a hand-written describe here: two resolve()
// damage-dealt lifegain triggers (Armadillo Cloak, Horned Cheetah, both
// precedent-twins of the shipped Spirit Link/El-Hajjâj shape), a resolve()
// cross-controller ETB trigger (Aura Shards, precedent-twin of Loran of the
// Third Path), three activatedAbilities[] visible on the board (Captain
// Sisay's tutor, Charging Troll's regenerate, Noble Panther's temporary
// keyword grant), and the two vanilla-keyword creatures (Llanowar Knight,
// Sabertooth Nishoba — the catalogue's first double-color protection body).
// Aura Mutation and Heroes' Reunion are plain `effects[]` spells reusing
// already-exercised Ops (the `ref: "$x.manaValue"` construct is already
// exercised by Artifact Mutation in this same file) and ride the per-Op
// regime (catalogue `effectScripts.test.ts` static sweep +
// `effectScriptSmoke.test.ts` canned-scenario smoke test) with no
// hand-written test required.
// ─────────────────────────────────────────────────────────────────────────

describe("Armadillo Cloak (Aura +2/+2 + trample, CR 611/613 layer 6/7c, + resolve() damage-dealt lifegain, GW issue #1079)", () => {
    function setup() {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const cloak = makeInstance(armadilloCloak.id, {
            id: "cloak",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, cloak] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }
    it("grants +2/+2 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });
    it("wire format: the +2/+2 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
    it("gains its controller life equal to damage dealt by the enchanted creature only", () => {
        const { state } = setup();
        const cloak = state.players[0].battlefield.find(
            (c) => c.id === "cloak"
        )!;
        const trigger = armadilloCloak.triggeredAbilities![0];
        const fromHost = {
            type: "DAMAGE_DEALT" as const,
            sourceInstanceId: "host",
            sourceControllerId: "p1",
            target: { type: "player" as const, id: "p2" },
            amount: 5,
            isCombat: true,
        };
        expect(trigger.matches(fromHost, cloak)).toBe(true);
        expect(
            trigger.matches({ ...fromHost, sourceInstanceId: "other" }, cloak)
        ).toBe(false);
        resolveTrigger(state, cloak, "armadillo-cloak-lifegain", fromHost);
        expect(state.players[0].life).toBe(25);
    });
});

describe("Aura Shards (CR 603.6a creature-you-control ETB + resolve() may-destroy artifact/enchantment, GW issue #1079)", () => {
    it("triggers only when a creature the controller controls enters", () => {
        const shards = makeInstance(auraShards.id, {
            id: "shards",
            controllerId: "p1",
        });
        const trigger = auraShards.triggeredAbilities![0];
        const yourCreature = {
            type: "PERMANENT_ENTERED" as const,
            instanceId: "new",
            controllerId: "p1",
            types: ["Creature"] as CardType[],
        };
        expect(trigger.matches(yourCreature, shards)).toBe(true);
        expect(
            trigger.matches({ ...yourCreature, controllerId: "p2" }, shards)
        ).toBe(false);
        expect(
            trigger.matches(
                { ...yourCreature, types: ["Land"] as CardType[] },
                shards
            )
        ).toBe(false);
    });

    /** Puts the ETB trigger on the stack with an un-set target slot (CR
     *  603.3d) so `driveTriggerTarget` can raise the announcement-time
     *  choice. */
    function pushShardsTrigger(state: GameState, shardsId: string) {
        state.stack.push({
            ...state.players[0].battlefield.find((c) => c.id === shardsId)!,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "aura-shards-destroy",
            triggerSourceId: shardsId,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "creature",
                controllerId: "p1",
                types: ["Creature"],
            } as never,
            targets: undefined,
        });
    }

    it("may destroy a target artifact or enchantment across either battlefield (CR 603.3d — target at stack placement)", () => {
        const shards = makeInstance(auraShards.id, {
            id: "shards",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppArtifact = makeInstance(icyManipulator.id, {
            id: "opp-artifact",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shards] }),
                makePlayer("p2", { battlefield: [oppArtifact] }),
            ],
        });
        pushShardsTrigger(state, "shards");
        // "Up to one" — a real choice is always owed even with a single legal
        // target (the caster may still decline), so the machinery raises.
        expect(
            driveTriggerTarget(state, [
                { type: "permanent", id: "opp-artifact" },
            ])
        ).toBe(true);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "opp-artifact")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "opp-artifact")
        ).toBe(true);
    });

    it("declining the 'may' (empty target set) destroys nothing", () => {
        const shards = makeInstance(auraShards.id, {
            id: "shards",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppArtifact = makeInstance(icyManipulator.id, {
            id: "opp-artifact",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shards] }),
                makePlayer("p2", { battlefield: [oppArtifact] }),
            ],
        });
        pushShardsTrigger(state, "shards");
        expect(driveTriggerTarget(state, [])).toBe(true);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "opp-artifact")
        ).toBe(true);
    });

    it("Aura Shards is itself a legal target (no `excludeSource`) — it can destroy itself", () => {
        // Aura Shards is an Enchantment, so with no other artifact/enchantment
        // in play it is its own sole legal target (CR 603.3d — the text has no
        // "another" clause). A real choice is still owed ("up to one").
        const shards = makeInstance(auraShards.id, {
            id: "shards",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shards] }),
                makePlayer("p2"),
            ],
        });
        pushShardsTrigger(state, "shards");
        expect(
            driveTriggerTarget(state, [{ type: "permanent", id: "shards" }])
        ).toBe(true);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "shards")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "shards")).toBe(
            true
        );
    });
});

describe("Captain Sisay (CR 605 tap ability, CR 701.23 search-by-supertype + reveal + shuffle, GW issue #1079)", () => {
    it("searches library for a legendary card, revealed, into hand, then shuffles", () => {
        const sisay = makeInstance(captainSisay.id, {
            id: "sisay",
            controllerId: "p1",
            ownerId: "p1",
        });
        const legendaryInLib = makeInstance(empressGalina.id, {
            id: "lib-legend",
            ownerId: "p1",
        });
        const nonLegendInLib = makeInstance(grizzlyBears.id, {
            id: "lib-bear",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sisay],
                    library: [legendaryInLib, nonLegendInLib],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sisay, "captain-sisay-tutor");
        expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
        submitChoice(state, ["lib-legend"]);
        expect(state.players[0].hand.some((c) => c.id === "lib-legend")).toBe(
            true
        );
        expect(
            state.players[0].library.some((c) => c.id === "lib-legend")
        ).toBe(false);
        // "then shuffle" — the non-legendary card stays in the library.
        expect(state.players[0].library).toHaveLength(1);
    });
});

describe("Charging Troll (CR 702.20b vigilance + CR 701.19a self-regenerate, GW issue #1079)", () => {
    it("stacks a regeneration shield on itself for {G}", () => {
        const troll = makeInstance(chargingTroll.id, {
            id: "troll",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, troll, "charging-troll-regen");
        expect(
            state.players[0].battlefield.find((c) => c.id === "troll")!
                .regenerationShields
        ).toBe(1);
    });
});

describe("Horned Cheetah (CR 120.3/603.2 resolve() damage-dealt lifegain, GW issue #1079)", () => {
    it("gains its controller life equal to the damage it deals", () => {
        const cheetah = makeInstance(hornedCheetah.id, {
            id: "cheetah",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cheetah] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, cheetah, "horned-cheetah-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "cheetah",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 2,
            isCombat: true,
        } as never);
        expect(state.players[0].life).toBe(22);
    });
});

describe("Noble Panther (CR 611.2a temporary first strike grant, GW issue #1079)", () => {
    it("{1}: gains first strike until end of turn", () => {
        const panther = makeInstance(noblePanther.id, {
            id: "np",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [panther] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, panther, "noble-panther-first-strike");
        const live = state.players[0].battlefield.find((c) => c.id === "np")!;
        expect(live.staticAbilities).toContain("first strike");
    });
});

describe("Sabertooth Nishoba (CR 702.19 trample + 702.16 double protection, GW issue #1079)", () => {
    it("has trample and protection from both blue and red", () => {
        expect(sabertoothNishoba.staticAbilities).toEqual(
            expect.arrayContaining([
                "trample",
                "protection from blue",
                "protection from red",
            ])
        );
    });
});

describe("Dromar, the Banisher (CR 702.9b flying + 510.4/603.2 combat-damage trigger + 117.3a/118.4 mayPay + 700.2 modal, issue #1080)", () => {
    function setup() {
        const dromarInst = makeInstance(dromar.id, {
            id: "dromar",
            controllerId: "p1",
        });
        const blueGuy = makeInstance(airElemental.id, {
            id: "blue-guy",
            controllerId: "p2",
        });
        const greenGuy = makeInstance(grizzlyBears.id, {
            id: "green-guy",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dromarInst],
                    manaPool: { U: 3 },
                }),
                makePlayer("p2", { battlefield: [blueGuy, greenGuy] }),
            ],
        });
        return { state, dromarInst, blueGuy, greenGuy };
    }

    it("paying {2}{U} and choosing blue bounces only the blue creature", () => {
        const { state } = setup();
        resolveTrigger(state, dromarInst(state), "dromar-damage-bounce", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "dromar",
            isCombat: true,
            amount: 6,
            target: { type: "player", id: "p2" },
        } as never);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        submitChoice(state, ["U"]); // colorChoiceModes ids are the color codes
        expect(
            state.players[1].battlefield.some((c) => c.id === "blue-guy")
        ).toBe(false);
        expect(state.players[1].hand.some((c) => c.id === "blue-guy")).toBe(
            true
        );
        // The green creature is untouched.
        expect(
            state.players[1].battlefield.some((c) => c.id === "green-guy")
        ).toBe(true);
    });

    it("declining the may-pay leaves the board untouched", () => {
        const { state } = setup();
        resolveTrigger(state, dromarInst(state), "dromar-damage-bounce", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "dromar",
            isCombat: true,
            amount: 6,
            target: { type: "player", id: "p2" },
        } as never);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[1].battlefield).toHaveLength(2);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    function dromarInst(state: ReturnType<typeof makeState>) {
        return state.players[0].battlefield.find((c) => c.id === "dromar")!;
    }
});

describe("Rith, the Awakener (CR 702.9b flying + 510.4/603.2 combat-damage trigger + 117.3a/118.4 mayPay + 700.2 modal + 111/701.7 create domain-agnostic count, issue #1080)", () => {
    function setup() {
        const rithInst = makeInstance(rith.id, {
            id: "rith",
            controllerId: "p1",
        });
        const greenGuy1 = makeInstance(grizzlyBears.id, {
            id: "green-guy-1",
            controllerId: "p1",
        });
        const greenGuy2 = makeInstance(dwarvenWarriors.id, {
            id: "red-guy",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [rithInst, greenGuy1],
                    manaPool: { G: 3 },
                }),
                makePlayer("p2", { battlefield: [greenGuy2] }),
            ],
        });
        return { state, rithInst, greenGuy1 };
    }

    it("paying {2}{G} and choosing green creates one Saproling per green permanent", () => {
        const { state } = setup();
        const rithLive = state.players[0].battlefield.find(
            (c) => c.id === "rith"
        )!;
        resolveTrigger(state, rithLive, "rith-damage-saprolings", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "rith",
            isCombat: true,
            amount: 6,
            target: { type: "player", id: "p2" },
        } as never);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        submitChoice(state, ["4"]); // modes: [W,U,B,R,G] — index 4 = green
        // Rith's own cost includes {G}, so it is itself a green permanent —
        // 2 green permanents total: Rith and "green-guy-1" ("red-guy" on
        // p2's side is red, not green, and is NOT counted).
        const saprolings = state.players[0].battlefield.filter(
            (c) => c.id !== "rith" && c.id !== "green-guy-1"
        );
        expect(saprolings).toHaveLength(2);
        for (const token of saprolings) {
            expect(token.power).toBe(1);
            expect(token.toughness).toBe(1);
        }
    });
});

describe("Treva, the Renewer (CR 702.9b flying + 510.4/603.2 combat-damage trigger + 117.3a/118.4 mayPay + 700.2 modal + 119.3 life gain scaled by count, issue #1080)", () => {
    it("paying {2}{W} and choosing white gains 1 life per white permanent", () => {
        const trevaInst = makeInstance(treva.id, {
            id: "treva",
            controllerId: "p1",
        });
        const whiteGuy1 = makeInstance(benalishHero.id, {
            id: "white-guy-1",
            controllerId: "p1",
        });
        const whiteGuy2 = makeInstance(benalishHero.id, {
            id: "white-guy-2",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [trevaInst, whiteGuy1],
                    manaPool: { W: 3 },
                    life: 20,
                }),
                makePlayer("p2", { battlefield: [whiteGuy2] }),
            ],
        });
        resolveTrigger(state, trevaInst, "treva-damage-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "treva",
            isCombat: true,
            amount: 6,
            target: { type: "player", id: "p2" },
        } as never);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        submitChoice(state, ["0"]); // modes: [W,U,B,R,G] — index 0 = white
        // Treva's own cost includes {W}, so it is itself a white permanent —
        // 3 white permanents total: Treva, whiteGuy1, and whiteGuy2 (across
        // both battlefields).
        expect(state.players[0].life).toBe(23);
    });
});

describe("Stormscape Apprentice (CR 602.1 tap-cost activated abilities, issue #1080)", () => {
    it("{W}, {T}: taps target creature; {B}, {T}: target player loses 1 life", () => {
        const apprentice = makeInstance(stormscapeApprentice.id, {
            id: "sa",
            controllerId: "p1",
        });
        const foe = makeInstance(grizzlyBears.id, {
            id: "foe",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [apprentice] }),
                makePlayer("p2", { battlefield: [foe], life: 20 }),
            ],
        });
        resolveActivated(state, apprentice, "stormscape-apprentice-tap", [
            { type: "permanent", id: "foe" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "foe")?.isTapped
        ).toBe(true);

        resolveActivated(state, apprentice, "stormscape-apprentice-drain", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Stormscape Master (CR 613.1f keyword grant + 700.2 modal + 119.3 life drain, issue #1080)", () => {
    it("grants protection from the chosen color", () => {
        const master = makeInstance(stormscapeMaster.id, {
            id: "sm",
            controllerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "target",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, master, "stormscape-master-protection", [
            { type: "permanent", id: "target" },
        ]);
        submitChoice(state, ["protection-black"]); // protectionColorModes ids
        const live = state.players[0].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(live.staticAbilities).toContain("protection from black");
    });

    it("drains 2 life from target player and gains the controller 2", () => {
        const master = makeInstance(stormscapeMaster.id, {
            id: "sm",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, master, "stormscape-master-drain", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(22);
    });
});

describe("Nightscape Master (CR 400.7 bounce + 120.1 damage, issue #1080)", () => {
    it("{U}{U}, {T}: returns target creature to hand", () => {
        const master = makeInstance(nightscapeMaster.id, {
            id: "nm",
            controllerId: "p1",
        });
        const foe = makeInstance(grizzlyBears.id, {
            id: "foe",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, master, "nightscape-master-bounce", [
            { type: "permanent", id: "foe" },
        ]);
        expect(state.players[1].battlefield.some((c) => c.id === "foe")).toBe(
            false
        );
        expect(state.players[1].hand.some((c) => c.id === "foe")).toBe(true);
    });

    it("{R}{R}, {T}: deals 2 damage to target creature", () => {
        const master = makeInstance(nightscapeMaster.id, {
            id: "nm",
            controllerId: "p1",
        });
        // A 4/4 (not the 2/2 Grizzly Bears) so it survives 2 damage and the
        // marked-damage assertion below isn't wiped by the SBA destroy.
        const foe = makeInstance(airElemental.id, {
            id: "foe",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, master, "nightscape-master-damage", [
            { type: "permanent", id: "foe" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(live.damageMarked ?? 0).toBe(2);
    });
});

describe("Thunderscape Apprentice (CR 119.3 life loss + 613.4c temporary pump, issue #1080)", () => {
    it("{B}, {T}: target player loses 1 life", () => {
        const apprentice = makeInstance(thunderscapeApprentice.id, {
            id: "ta",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [apprentice] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, apprentice, "thunderscape-apprentice-drain", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });

    it("{G}, {T}: target creature gets +1/+1 until end of turn", () => {
        const apprentice = makeInstance(thunderscapeApprentice.id, {
            id: "ta",
            controllerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [apprentice, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, apprentice, "thunderscape-apprentice-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Thunderscape Master (CR 119.3 life drain + 613.4c team pump, issue #1080)", () => {
    it("{B}{B}, {T}: target player loses 2 life and controller gains 2", () => {
        const master = makeInstance(thunderscapeMaster.id, {
            id: "tm",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, master, "thunderscape-master-drain", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(22);
    });

    it("{G}{G}, {T}: creatures you control get +2/+2 until end of turn", () => {
        const master = makeInstance(thunderscapeMaster.id, {
            id: "tm",
            controllerId: "p1",
        });
        const ownBear = makeInstance(grizzlyBears.id, {
            id: "own-bear",
            controllerId: "p1",
        });
        const foeBear = makeInstance(grizzlyBears.id, {
            id: "foe-bear",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master, ownBear] }),
                makePlayer("p2", { battlefield: [foeBear] }),
            ],
        });
        resolveActivated(state, master, "thunderscape-master-pump-team", []);
        const own = state.players[0].battlefield.find(
            (c) => c.id === "own-bear"
        )!;
        const foe = state.players[1].battlefield.find(
            (c) => c.id === "foe-bear"
        )!;
        expect(getEffectivePower(state, own)).toBe(4);
        expect(getEffectiveToughness(state, own)).toBe(4);
        // The opponent's creature is untouched — "creatures YOU control".
        expect(getEffectivePower(state, foe)).toBe(2);
        expect(getEffectiveToughness(state, foe)).toBe(2);
    });
});

describe("Sterling Grove (CR 611/613 layer 6 keyword grant + 702.18 Shroud, issue #1125)", () => {
    // Builds a board with Sterling Grove + a second enchantment + a
    // non-enchantment (all controlled by p1) and an opponent's enchantment.
    // `angelicShield` is a plain non-Aura Enchantment (its own `pt-buff`
    // static doesn't interfere with the guard); `grizzlyBears` is the
    // non-enchantment control. The shroud grant is the real CR-702.18
    // enforcement — a `permanent-guard` staticEffect read live by
    // `isGuardedAgainst` (`cantBeTargeted`), the SAME path Blurred Mongoose's
    // printed shroud uses (`inv/green.ts`), scoped by
    // STERLING_GROVE_AFFECTS_OTHER_ENCHANTMENTS to OTHER enchantments the
    // Grove's controller owns.
    const makeBoard = () => {
        const grove = makeInstance(sterlingGrove.id, {
            id: "grove",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherEnch = makeInstance(angelicShield.id, {
            id: "other-ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const myCreature = makeInstance(grizzlyBears.id, {
            id: "my-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppEnch = makeInstance(angelicShield.id, {
            id: "opp-ench",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [grove, otherEnch, myCreature],
                }),
                makePlayer("p2", { battlefield: [oppEnch] }),
            ],
        });
        return { state, grove, otherEnch, myCreature, oppEnch };
    };

    // A spell/ability source; shroud is unfiltered (not controller-relative),
    // so which player controls the source is irrelevant to the guard.
    const SRC = { isSpell: true, controllerId: "p1" } as const;

    it("grants shroud to another enchantment you control (cantBeTargeted true)", () => {
        const { state, otherEnch } = makeBoard();
        expect(isGuardedAgainst(state, otherEnch, "cantBeTargeted", SRC)).toBe(
            true
        );
    });

    it("does NOT grant shroud to Sterling Grove itself (excludes self)", () => {
        const { state, grove } = makeBoard();
        expect(isGuardedAgainst(state, grove, "cantBeTargeted", SRC)).toBe(
            false
        );
    });

    it("does NOT grant shroud to an opponent's enchantment", () => {
        const { state, oppEnch } = makeBoard();
        expect(isGuardedAgainst(state, oppEnch, "cantBeTargeted", SRC)).toBe(
            false
        );
    });

    it("does NOT grant shroud to a non-enchantment you control", () => {
        const { state, myCreature } = makeBoard();
        expect(isGuardedAgainst(state, myCreature, "cantBeTargeted", SRC)).toBe(
            false
        );
    });

    // Wire format (mandatory for board-visible staticEffects, CLAUDE.md GRE
    // testing convention): the guard reads the source's `staticEffects` off its
    // `{ id }` and the target's live `types`/`controllerId`, all of which
    // survive `projectPublicState` (only `card` is slimmed). Re-run the whole
    // scoping matrix through the projection so a dropped instance field would
    // fail here.
    it("the shroud scoping survives projection (wire format)", () => {
        const { state } = makeBoard();
        const projected = projectPublicState(state, 1, "p2");
        const p1bf = projected.players[0].battlefield;
        const p2bf = projected.players[1].battlefield;
        const pGrove = p1bf.find((c) => c.id === "grove")!;
        const pOther = p1bf.find((c) => c.id === "other-ench")!;
        const pBear = p1bf.find((c) => c.id === "my-bear")!;
        const pOpp = p2bf.find((c) => c.id === "opp-ench")!;
        expect(isGuardedAgainst(projected, pOther, "cantBeTargeted", SRC)).toBe(
            true
        );
        expect(isGuardedAgainst(projected, pGrove, "cantBeTargeted", SRC)).toBe(
            false
        );
        expect(isGuardedAgainst(projected, pBear, "cantBeTargeted", SRC)).toBe(
            false
        );
        expect(isGuardedAgainst(projected, pOpp, "cantBeTargeted", SRC)).toBe(
            false
        );
    });
});

// Reviving Vapors — {2}{W}{U} Instant (CR 401.4 look, CR 202.3 mana value,
// issue #1101). `lookDistribute`'s `destination`/`bind` extension already has its
// OWN permanent interpreter coverage (per-Op regime, ADR 0045,
// `convex/gre/effects/__tests__/interpreter.test.ts`); a hand-written test
// still lands here because the catalogue's auto-generated canned-scenario
// smoke sweep (`effectScriptSmoke.test.ts`) explicitly SKIPS every
// `lookDistribute` card (it suspends on a live look-distribute pick — the
// generator can't drive that choice), so this is the card-level proof the DSL
// script is wired correctly end to end.
const REVIVING_VAPORS_MV4_ID = "test-reviving-vapors-mv4";
registerTokenDefinition({
    id: REVIVING_VAPORS_MV4_ID,
    name: REVIVING_VAPORS_MV4_ID,
    rarity: "common",
    manaCost: { generic: 4 },
    types: ["Sorcery"],
});

describe("Reviving Vapors (CR 401.4 look, issue #1101)", () => {
    const libOf = (ids: [string, string][]) =>
        ids.map(([cid, defId]) =>
            makeInstance(defId, {
                id: cid,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );

    it("puts the kept card into hand, gains life equal to its mana value, and sends the other two to the graveyard", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf([
                        ["keep", REVIVING_VAPORS_MV4_ID], // mana value 4
                        ["bin1", island.id],
                        ["bin2", island.id],
                        ["untouched", island.id],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, revivingVapors.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the dig pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.candidateIds).toEqual(["keep", "bin1", "bin2"]);
        expect(head.destination).toBe("graveyard");

        submitChoice(state, ["keep"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("keep");
        expect(state.players[0].life).toBe(24); // 20 + 4 (the kept card's MV)
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["bin1", "bin2"])
        );
        // The 4th library card never entered the look window — untouched.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "untouched",
        ]);
    });

    it("wire format: the kept card, graveyard cards, and life gain all survive projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf([
                        ["keep", REVIVING_VAPORS_MV4_ID],
                        ["bin1", island.id],
                        ["bin2", island.id],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, revivingVapors.id, "p1");
        resolveTopOfStack(state); // suspends
        submitChoice(state, ["keep"]);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.some((c) => c?.id === "keep")).toBe(
            true
        );
        expect(projected.players[0].life).toBe(24);
        expect(projected.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["bin1", "bin2"])
        );
    });
});

// ===========================================================================
// UB engine gaps, closed (issue #1104, parent #1076)
// ===========================================================================

// The sacrifice is a CLICK ON A CREATURE, not a pick between two sentences:
// the `choice` is narrowed to the two announced targets (`candidates`), and
// `bindOther` snapshots the one left over so "return THE OTHER to its owner's
// hand" can name it (no announced slot can — which slot it is depends on the
// choice). The bounced creature also stays PUBLIC knowledge (every player
// watched it leave the battlefield), so it is not a hidden hand slot.
describe("Barrin's Spite (CR 601.2c sameController cross-slot targeting + candidate-narrowed sacrifice choice, issue #1104)", () => {
    it("offers exactly the two announced creatures as the pick, to their controller", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bs0-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const zombies = makeInstance(scatheZombies.id, {
            id: "bs0-zombies",
            controllerId: "p2",
            ownerId: "p2",
        });
        // A THIRD creature their controller also controls must NOT be offered:
        // the choice is narrowed to the announced targets, not the board.
        const bystander = makeInstance(grizzlyBears.id, {
            id: "bs0-bystander",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [bear, zombies, bystander],
                }),
            ],
        });
        pushSpell(state, barrinsSpite.id, "p1", [
            { type: "permanent", id: "bs0-bear" },
            { type: "permanent", id: "bs0-zombies" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2"); // their controller chooses
        expect(head.zone).toBe("battlefield");
        expect(head.candidateIds?.sort()).toEqual(["bs0-bear", "bs0-zombies"]);
        expect(head.count).toBe(1);
    });

    it("sacrificing the first: it dies, the second returns to its owner's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bs-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const zombies = makeInstance(scatheZombies.id, {
            id: "bs-zombies",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, zombies] }),
            ],
        });
        pushSpell(state, barrinsSpite.id, "p1", [
            { type: "permanent", id: "bs-bear" },
            { type: "permanent", id: "bs-zombies" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the pick
        expect(state.pendingChoices![0].playerId).toBe("p2"); // their controller
        // The chooser clicks the CREATURE, not a sentence.
        submitChoice(state, ["bs-bear"]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([]);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "bs-bear"
        );
        expect(state.players[1].hand.map((c) => c.id)).toContain("bs-zombies");
        expect(state.stack).toHaveLength(0);
        // Wire format: the bounced creature is PUBLIC to the opponent's
        // viewer too — a creature everyone watched leave the battlefield must
        // not read as a card that vanished into a hidden hand.
        const projected = projectPublicState(state, 1, "p1");
        const oppHand = projected.players[1].hand;
        expect(oppHand).toHaveLength(1);
        expect(oppHand[0]?.id).toBe("bs-zombies");
    });

    it("sacrificing the second: it dies, the first returns to its owner's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bs2-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const zombies = makeInstance(scatheZombies.id, {
            id: "bs2-zombies",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, zombies] }),
            ],
        });
        pushSpell(state, barrinsSpite.id, "p1", [
            { type: "permanent", id: "bs2-bear" },
            { type: "permanent", id: "bs2-zombies" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull();
        submitChoice(state, ["bs2-zombies"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "bs2-zombies"
        );
        expect(state.players[1].hand.map((c) => c.id)).toContain("bs2-bear");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Lobotomy (CR 201.2 dynamic same-name filter + CR 400.7 multi-zone sweep, issue #1104)", () => {
    it("reveals the target's hand, sweeps graveyard+hand+library for cards sharing the chosen card's name, exiles them, then shuffles", () => {
        const bearHand1 = makeInstance(grizzlyBears.id, {
            id: "lb-hand1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const bearHand2 = makeInstance(grizzlyBears.id, {
            id: "lb-hand2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const islandHand = makeInstance(island.id, {
            id: "lb-island",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const bearGy = makeInstance(grizzlyBears.id, {
            id: "lb-gy",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const bearLib = makeInstance(grizzlyBears.id, {
            id: "lb-lib",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const zombiesLib = makeInstance(scatheZombies.id, {
            id: "lb-lib2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [bearHand1, bearHand2, islandHand],
                    graveyard: [bearGy],
                    library: [bearLib, zombiesLib],
                }),
            ],
        });
        pushSpell(state, lobotomy.id, "p1", [{ type: "player", id: "p2" }]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice

        // Wire format: the leading `reveal` Op made p2's hand known to every
        // player BEFORE the choice suspends — the caster's own view already
        // shows the real cards, not nulled slots.
        const revealedProjection = projectPublicState(state, 1, "p1");
        expect(
            revealedProjection.players[1].hand.map((c) => c?.id).sort()
        ).toEqual(["lb-hand1", "lb-hand2", "lb-island"]);
        // The basic land is excluded from the choice's candidate allow-list
        // (`excludeSupertype: "Basic"`, CR 201.3's "other than a basic land
        // card").
        expect(state.pendingChoices![0].candidateIds?.sort()).toEqual([
            "lb-hand1",
            "lb-hand2",
        ]);

        submitChoice(state, ["lb-hand1"]);

        // CR 701.23a — the LIBRARY leg is an explicit search: resolution
        // suspends again with the opponent's library open to the caster and
        // only the same-named copies eligible, so the caster actually SEES the
        // deck (the whole point of "search that player's library"). The count
        // is clamped to the matching copies, so declining is not an option —
        // the card says "exile them".
        const librarySearch = state.pendingChoices![0];
        expect(librarySearch.kind).toBe("search-library");
        expect(librarySearch.zoneOwnerId).toBe("p2");
        expect(librarySearch.candidateIds).toEqual(["lb-lib"]);
        expect(librarySearch.count).toEqual({ min: 1, max: 1 });
        // Wire format: the searched library is exposed face-up to the caster —
        // ALL of it, not just the matching card.
        const searchProjection = projectPublicState(state, 1, "p1");
        expect(
            searchProjection.players[1].librarySearch?.map((c) => c.id).sort()
        ).toEqual(["lb-lib", "lb-lib2"]);

        submitChoice(state, ["lb-lib"]);

        // Every Grizzly Bears across all three zones is exiled — the chosen
        // card itself, its hand duplicate, the graveyard copy, and the
        // library copy. The non-matching cards (basic land, Scathe Zombies)
        // are untouched.
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual(
            ["lb-gy", "lb-hand1", "lb-hand2", "lb-lib"].sort()
        );
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["lb-island"]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].library.map((c) => c.id)).toEqual(["lb-lib2"]);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Seer's Vision (CR 702-adjacent opponents-hand-reveal static + sac-for-discard ability, issue #1104)", () => {
    it("wire format — the CONTROLLER sees their opponent's hand revealed", () => {
        const sv = makeInstance(seersVision.id, {
            id: "sv-perm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppCard = makeInstance(grizzlyBears.id, {
            id: "sv-hand1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sv] }),
                makePlayer("p2", { hand: [oppCard] }),
            ],
        });
        const asController = projectPublicState(state, 1, "p1");
        expect(asController.players[1].hand.map((c) => c?.id)).toEqual([
            "sv-hand1",
        ]);
    });

    it("wire format — the static ends the instant the source leaves the battlefield", () => {
        const oppCard = makeInstance(grizzlyBears.id, {
            id: "sv-gone-hand1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"), // no Seer's Vision on the battlefield
                makePlayer("p2", { hand: [oppCard] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].hand).toEqual([null]);
    });

    it("Sacrifice: look at target player's hand, choose a card, that player discards it", () => {
        const sv = makeInstance(seersVision.id, {
            id: "sv-activate",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(grizzlyBears.id, {
            id: "sv-discard-me",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sv] }),
                makePlayer("p2", { hand: [handCard] }),
            ],
        });
        resolveActivated(state, sv, "seers-vision-discard", [
            { type: "player", id: "p2" },
        ]);
        expect(state.pendingChoices).toBeDefined();
        submitChoice(state, ["sv-discard-me"]);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "sv-discard-me"
        );
        expect(state.stack).toHaveLength(0);
    });

    // Regression (issue #1698) — the ability's OWN cost is `{ sacrifice: true
    // }` (CR 602.2a: costs are paid BEFORE the ability goes on the stack, see
    // `convex/game.ts`'s real `activateAbilityOnState` cost-then-push
    // ordering), so by the time this `choice` Op needs to look at the target's
    // hand, Seer's Vision is no longer on the battlefield and its own
    // `revealsHand: "opponents"` continuous static has already ended. The
    // GRE-only test above pushed the stack item WITHOUT paying the cost (the
    // `resolveActivated` shim), which is why it never caught this: `sv` sat on
    // the battlefield throughout, keeping the static alive by accident. This
    // test reproduces the REAL timing by constructing the source already in
    // the graveyard.
    it("Sacrifice cost already removed the source — the pick must not depend on the now-gone reveal static (issue #1698)", () => {
        const sv = makeInstance(seersVision.id, {
            id: "sv-activate-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const handCard = makeInstance(grizzlyBears.id, {
            id: "sv-discard-me-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [sv] }), // already sacrificed
                makePlayer("p2", { hand: [handCard] }),
            ],
        });
        resolveActivated(state, sv, "seers-vision-discard", [
            { type: "player", id: "p2" },
        ]);
        expect(state.pendingChoices?.[0]?.kind).toBe("choose-hand-card");

        // Wire assertion (through the real reducer, not a hand-built view):
        // the controller's client must see p2's hand candidate face-up RIGHT
        // NOW, or `HandCardPick` renders an empty modal and the game hangs
        // forever waiting for a click that can never happen.
        const projected = projectPublicState(state, 1, "p1");
        const oppHand = projected.players.find((p) => p.id === "p2")!.hand;
        expect(oppHand.map((c) => c?.id)).toEqual(["sv-discard-me-2"]);

        submitChoice(state, ["sv-discard-me-2"]);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "sv-discard-me-2"
        );
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    // Acceptance criterion — an empty target hand must resolve as a no-op
    // instead of suspending on an unsatisfiable "choose 1" (CR 608.2b: a
    // choice with nothing to choose from is skipped, not raised).
    it("Sacrifice targeting a player with an empty hand resolves as a no-op, not a stuck choice (issue #1698)", () => {
        const sv = makeInstance(seersVision.id, {
            id: "sv-empty-target",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [sv] }),
                makePlayer("p2", { hand: [] }),
            ],
        });
        resolveActivated(state, sv, "seers-vision-discard", [
            { type: "player", id: "p2" },
        ]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Aether Rift (CR 701.9a random discard, CR 603.2 upkeep trigger, CR 117.3a unless-a-player-pays, issue #1123)", () => {
    const upkeep = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    /** p1 controls Aether Rift with exactly ONE card in hand — a fixed hand
     *  size makes `discardAtRandom`'s pick deterministic (no RNG variance to
     *  account for) without needing to seed the PRNG. */
    function withHand(handCard: ReturnType<typeof makeInstance>): GameState {
        const rift = makeInstance(aetherRift.id, {
            id: "rift",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [rift], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
    }

    function fireUpkeep(state: GameState): void {
        const rift = state.players[0].battlefield.find((c) => c.id === "rift")!;
        resolveTrigger(state, rift, "aether-rift-upkeep-discard", upkeep);
    }

    it("discards a card at random from the controller's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "ar-bear-1",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = withHand(bear);
        fireUpkeep(state);
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "ar-bear-1")
        ).toBe(true);
    });

    it('does NOT offer a may-pay when the discarded card is not a creature ("if you discard a creature card this way")', () => {
        const land = makeInstance(plains.id, {
            id: "ar-land-1",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = withHand(land);
        fireUpkeep(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "ar-land-1")
        ).toBe(true);
    });

    it("offers the controller first, then the opponent, to pay 5 life (CR 101.4 APNAP)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "ar-bear-2",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = withHand(bear);
        fireUpkeep(state);
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");
    });

    it("returns the discarded creature to the battlefield when BOTH players decline to pay", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "ar-bear-3",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = withHand(bear);
        fireUpkeep(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(
            state.players[0].battlefield.some((c) => c.id === "ar-bear-3")
        ).toBe(true);
        expect(
            state.players[0].graveyard.some((c) => c.id === "ar-bear-3")
        ).toBe(false);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });

    // Mutation-guard (same shape as the Op's own permanent test in
    // interpreter.test.ts): every OTHER case above uses a 1-card hand with
    // an EMPTY graveyard, so "reanimate the card discarded THIS upkeep" and
    // "reanimate whatever's in the graveyard" read identically. This case
    // adds a SECOND hand card (proving the random pick — not "the only
    // candidate" — is what gets tracked) and a PRE-EXISTING graveyard
    // occupant (a plausible wrong answer, sitting at `graveyard[0]` while
    // the freshly-discarded creature lands at `graveyard[1]` — `moveCard`,
    // `gre/state.ts`, pushes onto the end).
    it("reanimates the SPECIFIC creature discarded this upkeep, not a pre-existing graveyard occupant", () => {
        const rift = makeInstance(aetherRift.id, {
            id: "rift-identity",
            controllerId: "p1",
            ownerId: "p1",
        });
        const decoyBear = makeInstance(grizzlyBears.id, {
            id: "ar-decoy-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const targetBear = makeInstance(grizzlyBears.id, {
            id: "ar-target-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const otherLand = makeInstance(plains.id, {
            id: "ar-other-land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            // Empirically (see the Op's own identity-guard test in
            // interpreter.test.ts): seed 0 draws hand index 0 —
            // `targetBear`, never `otherLand`.
            rngSeed: 0,
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", {
                    battlefield: [rift],
                    hand: [targetBear, otherLand],
                    graveyard: [decoyBear],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, rift, "aether-rift-upkeep-discard", upkeep);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(
            state.players[0].hand.some((c) => c.id === "ar-other-land")
        ).toBe(true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "ar-target-bear")
        ).toBe(true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "ar-decoy-bear")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "ar-decoy-bear")
        ).toBe(true);
    });

    it("stays in the graveyard when the CONTROLLER pays 5 life (opponent is never even asked)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "ar-bear-4",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = withHand(bear);
        fireUpkeep(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].life).toBe(15);
        expect(
            state.players[0].battlefield.some((c) => c.id === "ar-bear-4")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "ar-bear-4")
        ).toBe(true);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("stays in the graveyard when the OPPONENT pays 5 life after the controller declines", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "ar-bear-5",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = withHand(bear);
        fireUpkeep(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[1].life).toBe(15);
        expect(
            state.players[0].battlefield.some((c) => c.id === "ar-bear-5")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "ar-bear-5")
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("the reanimated creature survives the wire projection (wire format)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "ar-bear-6",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = withHand(bear);
        fireUpkeep(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "ar-bear-6")
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Shivan Emissary — single Kicker, ETB destroy-target-nonblack-creature,
// can't be regenerated (issue #1328, decomposed from #1086). Same auto-
// generated DSL smoke sweep skip as Benalish Emissary ("construct 'if'
// branches on a runtime predicate — covered by the card's own tests") — this
// hand-written suite is the required proof obligation. Same Waterspout
// Elemental / Thunderscape Battlemage template as Benalish Emissary
// (`inv/__tests__/white.test.ts`) — see that describe block's header
// comment for the full precedent chain; not re-derived here.
// ---------------------------------------------------------------------------

describe("Shivan Emissary (single Kicker ETB — destroy target nonblack creature, issue #1328)", () => {
    it("unkicked: the ETB trigger never even reaches the stack (CR 603.4 check-time gate)", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "se-target-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushSpell(state, shivanEmissary.id, "p1"); // no kickerPayments — unkicked
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[1].battlefield.some((c) => c.id === "se-target-1")
        ).toBe(true);
    });

    it("kicked: the ETB trigger destroys the announced nonblack creature target, can't be regenerated", () => {
        const emissary = makeInstance(shivanEmissary.id, {
            id: "se-kicked",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "se-target-2",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [emissary] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        (
            emissary as CardInstanceState & {
                kickerPayments?: Record<string, number>;
            }
        ).kickerPayments = { kicker: 1 };
        resolveTrigger(
            state,
            emissary,
            "shivan-emissary-kicked",
            {
                type: "PERMANENT_ENTERED",
                instanceId: emissary.id,
                controllerId: emissary.controllerId,
                types: emissary.types,
            } as StackItem["triggerEvent"],
            [{ type: "permanent", id: "se-target-2" }]
        );
        // Destroyed despite the regeneration shield — cantBeRegenerated: true.
        expect(
            state.players[1].battlefield.some((c) => c.id === "se-target-2")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "se-target-2")
        ).toBe(true);
    });

    // Defense in depth (CR 707.10), same shape as Benalish Emissary.
    it("resolution-time gate: forced onto the stack unkicked, the destroy still does not fire", () => {
        const emissary = makeInstance(shivanEmissary.id, {
            id: "se-unkicked-forced",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "se-target-3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [emissary] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveTrigger(
            state,
            emissary,
            "shivan-emissary-kicked",
            {
                type: "PERMANENT_ENTERED",
                instanceId: emissary.id,
                controllerId: emissary.controllerId,
                types: emissary.types,
            } as StackItem["triggerEvent"],
            [{ type: "permanent", id: "se-target-3" }]
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "se-target-3")
        ).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dueling Grounds (#1127) — battlefield-wide declared-attacker / declared-
// blocker count cap (CR 508.1a / 509.1a)
// ─────────────────────────────────────────────────────────────────────────────

/** A creature that can attack right now, on `controllerId`'s battlefield. */
function capCreature(id: string, controllerId: string): CardInstanceState {
    return makeInstance(grizzlyBears.id, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });
}

/** p1 is the active player and has declared `attackerIds`; `p2Battlefield`
 *  holds the defender's permanents (where the enchantment usually sits, to
 *  prove the cap is symmetric — it binds whoever it is not controlled by). */
function combatState(
    p1Battlefield: CardInstanceState[],
    p2Battlefield: CardInstanceState[],
    combat: Partial<GameState["combat"]> = {}
): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...combat,
        },
    });
}

describe("Dueling Grounds (CR 508.1a / 509.1a — declared-set count caps)", () => {
    it("caps both declarations at one, scanned from the OPPONENT's battlefield (CR 109.2 — symmetric)", () => {
        const grounds = makeInstance(duelingGrounds.id, { controllerId: "p2" });
        const state = combatState([capCreature("a", "p1")], [grounds]);
        expect(getAttackerCapEffect(state)?.max).toBe(1);
        expect(getBlockerCapEffect(state)?.max).toBe(1);
        expect(getAttackerCapEffect(state)?.oracleText).toBe(
            "No more than one creature can attack each combat."
        );
    });

    it("imposes no cap when it is not on the battlefield", () => {
        const state = combatState([capCreature("a", "p1")], []);
        expect(getAttackerCapEffect(state)).toBeUndefined();
        expect(getBlockerCapEffect(state)).toBeUndefined();
    });

    it("validateDeclaredAttackers accepts one attacker and rejects two (CR 508.1a, whole declared set)", () => {
        const grounds = makeInstance(duelingGrounds.id, { controllerId: "p2" });
        const [a, b] = [capCreature("a", "p1"), capCreature("b", "p1")];

        const one = combatState([a, b], [grounds], { attackerIds: ["a"] });
        expect(validateDeclaredAttackers(one)).toEqual({ ok: true });

        const two = combatState([a, b], [grounds], { attackerIds: ["a", "b"] });
        expect(validateDeclaredAttackers(two)).toEqual({
            ok: false,
            reason: "No more than one creature can attack each combat.",
        });
    });

    it("validateDeclaredBlockers counts distinct CREATURES, not assignments (CR 509.1a)", () => {
        const grounds = makeInstance(duelingGrounds.id, { controllerId: "p1" });
        const [x, y] = [capCreature("x", "p2"), capCreature("y", "p2")];
        const attackers = [capCreature("a", "p1"), capCreature("b", "p1")];

        // ONE blocker blocking TWO attackers consumes ONE slot — legal.
        const single = combatState([...attackers, grounds], [x, y], {
            attackerIds: ["a", "b"],
            blockerAssignments: { x: ["a", "b"] },
        });
        expect(validateDeclaredBlockers(single)).toEqual({ ok: true });

        // TWO blockers is over the cap, however few attackers they block.
        const double = combatState([...attackers, grounds], [x, y], {
            attackerIds: ["a", "b"],
            blockerAssignments: { x: ["a"], y: ["b"] },
        });
        expect(validateDeclaredBlockers(double)).toEqual({
            ok: false,
            reason: "No more than one creature can block each combat.",
        });
    });

    it("stacks with Caverns of Despair at the MOST RESTRICTIVE cap (CR 508.1c — every restriction is obeyed)", () => {
        const grounds = makeInstance(duelingGrounds.id, { controllerId: "p1" });
        const caverns = makeInstance(cavernsOfDespair.id, {
            controllerId: "p2",
        });
        const state = combatState([grounds], [caverns]);
        expect(getAttackerCapEffect(state)?.max).toBe(1);
        expect(getBlockerCapEffect(state)?.max).toBe(1);

        // Caverns alone still binds at two — the minimum is genuinely computed,
        // not the last source scanned.
        const cavernsOnly = combatState([], [caverns]);
        expect(getAttackerCapEffect(cavernsOnly)?.max).toBe(2);
    });

    it("wire format: the cap survives projectPublicState (card.card stripped to { id })", () => {
        const grounds = makeInstance(duelingGrounds.id, { controllerId: "p2" });
        const [a, b] = [capCreature("a", "p1"), capCreature("b", "p1")];
        const state = combatState([a, b], [grounds], {
            attackerIds: ["a", "b"],
        });

        expect(validateDeclaredAttackers(state).ok).toBe(false);

        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as GameState;
        expect(getAttackerCapEffect(projected)?.max).toBe(1);
        expect(getBlockerCapEffect(projected)?.max).toBe(1);
        expect(validateDeclaredAttackers(projected)).toEqual({
            ok: false,
            reason: "No more than one creature can attack each combat.",
        });
    });
});

// Bloodstone Cameo / Troll-Horn Cameo / Shivan Oasis — three near-identical
// two-color choice-of-color tap mana sources (CR 605.1a `manaChoices`), the
// mana sweep's own skip list (`manaAbility.catalogue.test.ts`) explicitly
// excludes `manaChoices` abilities since the board-dependent CHOICE index is
// load-bearing. Mirrors the Talisman painland cycle pattern
// (`sets/mrd/__tests__/colorless.test.ts`), minus the coloured-tap self-
// damage rider — none of these three has one.
describe.each([
    { def: bloodstoneCameo, colors: ["B", "R"] as const },
    { def: trollHornCameo, colors: ["R", "G"] as const },
    { def: shivanOasis, colors: ["R", "G"] as const },
])(
    "$def.name ({T}: Add one of two colors; CR 605.1a manaChoices)",
    ({ def, colors }) => {
        it("offers both colors as tap options, in printed order", () => {
            const source = makeInstance(def.id, {
                id: `${def.id}-options`,
                controllerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [source] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            const battlefields = state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }));
            const options = getManaTapOptionsDetailed(
                source,
                "p1",
                battlefields
            );
            expect(options.map((o) => o.mana)).toEqual([
                { [colors[0]]: 1 },
                { [colors[1]]: 1 },
            ]);
        });

        it(`tapping index 1 adds {${colors[1]}} to the pool, no life cost`, () => {
            const source = makeInstance(def.id, {
                id: `${def.id}-tap`,
                controllerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [source] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, source, 1, []);
            expect(player.manaPool[colors[1]]).toBe(1);
            expect(player.life).toBe(20);
        });

        it("wire format: the tapped-for mana pool survives the projection", () => {
            const source = makeInstance(def.id, {
                id: `${def.id}-wire`,
                controllerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [source] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, source, 0, []);
            const projected = projectPublicState(state, 1, "p1");
            expect(projected.players[0].manaPool[colors[0]]).toBe(1);
        });
    }
);
