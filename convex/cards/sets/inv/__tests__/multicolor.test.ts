// Per-card behavior tests for INV gold cards (`convex/cards/sets/inv/multicolor.ts`).
// Both cards belong to the Domain capability cluster (issue #1066). The
// `{ domain: { of } }` value member and the `winGame` Op each already have
// their own permanent interpreter test (`convex/gre/effects/__tests__/interpreter.test.ts`)
// per the new-construct regime (ADR 0045) — the tests here assert the
// CARD-level wiring: Ordered Migration's Domain-scaled token count, and
// Coalition Victory's compound win predicate (both clauses required).

import { describe, it, expect } from "vitest";
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
    agonizingDemise,
    blazingSpecter,
    bloodstoneCameo,
    firescreamer,
    hoodedKavu,
    plagueSpores,
    recklessAssault,
    shivanZombie,
    smolderingTar,
    trenchWurm,
    urborgVolcano,
    viciousKavu,
} from "../multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    type StackItem,
} from "../../../../gre/state";
import { plains, island, swamp, mountain, forest } from "../../lea/colorless";
import { grizzlyBears, scatheZombies } from "../../lea";
import { registerTokenDefinition } from "../../..";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import {
    validateAttackerEligibility,
    mustAttack,
} from "../../../../gre/combat";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { resolveActivated, resolveTrigger, submitChoice } from "./helpers";

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
// (Vile Consumption). Recoil / Spinal Embrace / Undermine / Slinking
// Serpent / Vodalian Zombie are plain `effects[]`/keyword cards reusing
// already-exercised Ops and ride the per-Op regime (catalogue
// `effectScripts.test.ts` static sweep + `effectScriptSmoke.test.ts`
// canned-scenario smoke test) with no hand-written test required.
// ─────────────────────────────────────────────────────────────────────────

describe("Sleeper's Robe (fear keyword-grant + combat-damage draw, CR 702.14b / 510.4)", () => {
    it("declares a keyword-grant for fear (Snow Devil pattern)", () => {
        expect(sleepersRobe.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "fear",
        });
        expect(sleepersRobe.targetRequirement).toMatchObject({
            type: "Creature",
        });
    });

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

    it("the destroy ability's target requirement is filtered to TAPPED creatures only", () => {
        const destroyAbility = stalkingAssassin.activatedAbilities!.find(
            (a) => a.id === "stalking-assassin-destroy"
        )!;
        expect(destroyAbility.targetRequirement?.tappedFilter).toBe("tapped");
    });
});

describe("Urborg Drake (flying + attacks-each-combat-if-able, CR 702.9b / 508.1d)", () => {
    it("has flying and a declared attack-requirement static effect", () => {
        expect(urborgDrake.staticAbilities).toContain("flying");
        expect(
            (urborgDrake.staticEffects ?? []).some(
                (e) => e.kind === "attack-requirement"
            )
        ).toBe(true);
    });

    it("mustAttack is true when eligible, false when tapped or summoning sick", () => {
        const drake = makeInstance(urborgDrake.id, { id: "drake" });
        expect(mustAttack(drake)).toBe(true);
        expect(mustAttack({ ...drake, isTapped: true })).toBe(false);
        expect(mustAttack({ ...drake, isSummoningSick: true })).toBe(false);
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

    it("declares a triggered-grant static and the granted template (not on triggeredAbilities)", () => {
        const kinds = (vileConsumption.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("triggered-grant");
        expect(vileConsumption.triggeredAbilities ?? []).toHaveLength(0);
        expect(
            vileConsumption.triggeredGrantTemplates?.some(
                (t) => t.id === "vile-consumption-upkeep"
            )
        ).toBe(true);
    });

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

    it("paying 1 life keeps the creature (CR 118.4)", () => {
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

    it("declining sacrifices the creature (CR 701.16)", () => {
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

describe("Agonizing Demise (CR 702.33 Kicker + 701.8 destroy + 701.15c regen-suppression, issue #1077)", () => {
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
        if (kicked) item.kickerCount = 1;
        resolveTopOfStack(state);
        return state;
    }

    it("declares Kicker {1}{R}, a nonblack-creature target filter, and a can't-be-regenerated destroy", () => {
        expect(agonizingDemise.kicker?.cost).toEqual({ X: 1, R: 1 });
        expect(agonizingDemise.targetRequirement?.excludeColors).toBe("B");
        expect(agonizingDemise.effects?.[0]).toMatchObject({
            op: "destroy",
            cantBeRegenerated: true,
        });
    });

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

describe("Bloodstone Cameo (CR 605.1a choice-of-color mana ability, issue #1077)", () => {
    it("is a mana ability (useStack:false) offering B or R", () => {
        const ability = bloodstoneCameo.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.manaChoices).toEqual([{ B: 1 }, { R: 1 }]);
        expect(ability.cost.tap).toBe(true);
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

describe("Plague Spores (CR 701.8 destroy x2 + 701.15c regen-suppression, issue #1077)", () => {
    it("targets a nonblack creature AND an independent land slot", () => {
        expect(plagueSpores.targetRequirement).toMatchObject({
            type: "Creature",
            excludeColors: "B",
        });
        expect(plagueSpores.additionalTargetRequirements?.[0]).toMatchObject({
            type: "Land",
        });
    });

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
    it("costs {1} and 2 life", () => {
        const ability = recklessAssault.activatedAbilities![0];
        expect(ability.cost.mana).toEqual({ X: 1 });
        expect(ability.cost.life).toBe(2);
    });

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

describe("Shivan Zombie (CR 702.16 protection, issue #1077)", () => {
    it("has protection from white", () => {
        expect(shivanZombie.staticAbilities).toContain("protection from white");
    });
});

describe("Smoldering Tar (CR 603.6a upkeep target-player drain + 701.16 sacrifice-for-damage, issue #1077)", () => {
    it("the detonate ability is sacrifice-only and sorcery-speed-restricted", () => {
        const detonate = smolderingTar.activatedAbilities![0];
        expect(detonate.cost).toEqual({ sacrifice: true });
        expect(detonate.controllerTurnOnly).toBe(true);
        expect(detonate.activationPhaseRestriction).toEqual([
            "PRECOMBAT_MAIN",
            "POSTCOMBAT_MAIN",
        ]);
    });

    it("upkeep trigger: choosing the opponent makes them lose 1 life", () => {
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
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the player pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        submitChoice(state, ["p2"]);
        expect(state.players[1].life).toBe(19);
        expect(state.players[0].life).toBe(20);
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
    it("targets a nonbasic land", () => {
        const ability = trenchWurm.activatedAbilities![0];
        expect(ability.targetRequirement?.excludeSupertypes).toBe("Basic");
    });

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

describe("Urborg Volcano (CR 110.5b enters tapped + 605.1a choice-of-color mana ability, issue #1077)", () => {
    it("enters tapped and taps for B or R", () => {
        expect(urborgVolcano.entersTapped).toBe(true);
        const ability = urborgVolcano.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.manaChoices).toEqual([{ B: 1 }, { R: 1 }]);
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
