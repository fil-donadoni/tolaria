// Antiquities (ATQ) — per-card behavior tests for green cards in
// `convex/cards/sets/atq/green.ts` (set split by colour, ADR 0043). Each
// non-trivial card gets a describe block citing the CR section it exercises;
// assertions check external behavior only. Shared test shims live in
// `./helpers`; fixtures in `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import {
    ornithopter,
    yotianSoldier,
    clayStatue,
    grapeshotCatapult,
    colossusOfSardia,
    crumble,
    citanulDruid,
    ivoryTower,
    gaeasAvenger,
    amuletOfKroog,
    powerleech,
    argothianPixies,
    argothianTreefolk,
    titaniasSong,
} from "..";
import { grizzlyBears, hillGiant, solRing } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    getActivatedManaAbility,
    hasManaAbility,
} from "../../../../gre/constants";
import { collectTriggers } from "../../../../gre/triggers";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    runDamageReplacement,
    type GameState,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { applyAllCombatDamage } from "../../../../gre/phases";
import type { CardType } from "../../../types";
import {
    abilityActivatedEvent,
    artifactTappedEvent,
    fireTrigger,
    vanilla,
    withTitaniasSong,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Artifact removal & bounce (free tranche, #274)
// ─────────────────────────────────────────────────────────────────────────────

describe("Crumble (destroy artifact, no regen, controller gains life = mv, CR 701.7 / 701.15c)", () => {
    it("destroys the target artifact and grants its controller life = mv", () => {
        // Clay Statue is mv 4 (MTGJSON {4}).
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "statue")).toBe(
            true
        );
        // Controller (p2) gains 4 life.
        expect(state.players[1].life).toBe(24);
    });

    it("can't be regenerated — a regen shield does not save it (CR 701.15c)", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
            card: { id: clayStatue.id, regenerationShields: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
    });

    it("indestructible artifact survives but no life is gained (destroy is replaced)", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        // Still on the battlefield; gainLife still fires (controller reads the
        // surviving permanent's mv) — Crumble's life gain is not contingent on
        // the destroy succeeding per oracle text.
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeDefined();
        expect(state.players[1].life).toBe(24);
    });

    it("getLegalTargets restricts to artifacts only", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = vanilla("creature", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue, creature] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            crumble.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain("statue");
        expect(ids).not.toContain("creature");
    });

    it("wire format: target id survives projectPublicState and resolve still works", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        const item = pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack.find((s) => s.id === item.id)!;
        expect(projectedItem.targets?.[0]).toEqual({
            type: "permanent",
            id: "statue",
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(24);
    });
});

// Citanul Druid (CR 603.2 opponent-cast trigger, CR 122.1 +1/+1 counter)
describe("Citanul Druid (+1/+1 on opponent artifact cast)", () => {
    const druidSelf = {
        id: "druid",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"] as CardType[],
        subtypes: ["Human", "Druid"],
        isTapped: false,
        card: {},
    };
    const artifactCast = (casterId: string) => ({
        type: "SPELL_CAST" as const,
        casterId,
        spellInstanceId: "x",
        spellCardId: "y",
        spellTypes: ["Artifact"] as CardType[],
        spellSubtypes: [],
        spellColors: [],
    });

    it("fires on an opponent's artifact spell, not the controller's", () => {
        const trig = citanulDruid.triggeredAbilities![0];
        expect(trig.matches(artifactCast("p2"), druidSelf)).toBe(true);
        expect(trig.matches(artifactCast("p1"), druidSelf)).toBe(false);
    });

    it("does not fire on a non-artifact opponent spell", () => {
        const trig = citanulDruid.triggeredAbilities![0];
        const nonArtifact = {
            ...artifactCast("p2"),
            spellTypes: ["Instant"] as CardType[],
        };
        expect(trig.matches(nonArtifact, druidSelf)).toBe(false);
    });

    it("resolving the trigger adds a +1/+1 counter → 2/2 effective", () => {
        const druid = makeInstance(citanulDruid.id, {
            id: "druid",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid] }),
                makePlayer("p2"),
            ],
        });
        fireTrigger(state, druid, "citanul-druid-grow", artifactCast("p2"));
        const after = state.players[0].battlefield.find(
            (c) => c.id === "druid"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(2);
    });

    it("wire format: counter-driven 2/2 survives projectPublicState", () => {
        const druid = makeInstance(citanulDruid.id, {
            id: "druid",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "druid"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

// Gaea's Avenger (CR 604.3 characteristic-defining P/T)
describe("Gaea's Avenger (P/T = 1 + opponents' artifacts, CR 604.3)", () => {
    function setup(opponentArtifacts: number) {
        const avenger = makeInstance(gaeasAvenger.id, {
            id: "avenger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifacts = Array.from({ length: opponentArtifacts }, (_, i) =>
            makeInstance(amuletOfKroog.id, {
                id: `art-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [avenger] }),
                makePlayer("p2", { battlefield: artifacts }),
            ],
        });
        return { state, avenger };
    }

    it("is 1/1 with no opponent artifacts", () => {
        const { state, avenger } = setup(0);
        expect(getEffectivePower(state, avenger)).toBe(1);
        expect(getEffectiveToughness(state, avenger)).toBe(1);
    });

    it("recomputes from the board: 3 opponent artifacts → 4/4", () => {
        const { state, avenger } = setup(3);
        expect(getEffectivePower(state, avenger)).toBe(4);
        expect(getEffectiveToughness(state, avenger)).toBe(4);
    });

    it("ignores artifacts the controller owns (only opponents count)", () => {
        const { state, avenger } = setup(2);
        // Add an artifact controlled by p1 — must NOT raise the count.
        state.players[0].battlefield.push(
            makeInstance(amuletOfKroog.id, {
                id: "my-art",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(getEffectivePower(state, avenger)).toBe(3);
    });

    it("wire format: the CDA survives projectPublicState", () => {
        const { state, avenger } = setup(2);
        expect(getEffectivePower(state, avenger)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "avenger"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Powerleech (gain 1 on opponent artifact tap or non-tap ability)", () => {
    const self = {
        id: "pl",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
    };
    const tappedTrig = powerleech.triggeredAbilities!.find(
        (t) => t.id === "powerleech-tapped"
    )!;
    const abilityTrig = powerleech.triggeredAbilities!.find(
        (t) => t.id === "powerleech-ability"
    )!;

    it("fires only for an OPPONENT's artifact (scope: opponents)", () => {
        // opponent (p2) artifact → both events match
        expect(
            tappedTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        // own (p1) artifact → neither matches
        expect(
            tappedTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p1" }),
                self
            )
        ).toBe(false);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p1" }),
                self
            )
        ).toBe(false);
    });

    it("resolves +1 life to the enchantment's controller (both cases)", () => {
        const make = () => {
            const pl = makeInstance(powerleech.id, {
                id: "pl",
                controllerId: "p1",
                ownerId: "p1",
            });
            return {
                pl,
                state: makeState({
                    players: [
                        makePlayer("p1", { battlefield: [pl], life: 20 }),
                        makePlayer("p2", { life: 20 }),
                    ],
                }),
            };
        };
        const tap = make();
        fireTrigger(
            tap.state,
            tap.pl,
            "powerleech-tapped",
            artifactTappedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(tap.state.players[0].life).toBe(21);

        const abil = make();
        fireTrigger(
            abil.state,
            abil.pl,
            "powerleech-ability",
            abilityActivatedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(abil.state.players[0].life).toBe(21);
        // Wire format: life gain visible after projection.
        const projected = projectPublicState(abil.state, 0, "p1");
        expect(projected.players[0].life).toBe(21);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cluster C+D — continuous artifact-source prevention/redirection + artifact-
// damage tracking (#287)
// ─────────────────────────────────────────────────────────────────────────────

describe("Argothian Pixies (block restriction + prevent from artifact creatures, CR 509.1b / 615)", () => {
    it("can't be blocked by artifact creatures, but can by non-artifact creatures", () => {
        const pixies = makeInstance(argothianPixies.id, {
            id: "pixies",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const artifactBlocker = makeInstance(yotianSoldier.id, {
            id: "yotian",
            controllerId: "p2",
            ownerId: "p2",
        });
        const fleshBlocker = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pixies] }),
                makePlayer("p2", {
                    battlefield: [artifactBlocker, fleshBlocker],
                }),
            ],
        });
        expect(
            validateBlockerEligibility(
                pixies,
                artifactBlocker,
                [artifactBlocker, fleshBlocker],
                state
            ).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(
                pixies,
                fleshBlocker,
                [artifactBlocker, fleshBlocker],
                state
            ).eligible
        ).toBe(true);
    });

    it("prevents combat damage from an artifact creature but takes damage from a non-artifact creature", () => {
        // Artifact creature attacker (Colossus 9/9) vs Pixies blocking.
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const pixies = makeInstance(argothianPixies.id, {
            id: "pixies",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [pixies] }),
                makePlayer("p2", { battlefield: [colossus] }),
            ],
            combat: {
                attackerIds: ["colossus"],
                confirmed: true,
                blockerAssignments: { pixies: ["colossus"] },
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {}, "regular");
        const pixiesAfter = state.players[0].battlefield.find(
            (c) => c.id === "pixies"
        );
        // All 9 damage from the artifact creature is prevented.
        expect(pixiesAfter?.damageMarked ?? 0).toBe(0);
    });

    it("does NOT prevent damage from a non-artifact creature (source filter)", () => {
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const pixies = makeInstance(argothianPixies.id, {
            id: "pixies",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pixies] }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "giant",
            "p2",
            { type: "permanent", id: "pixies" },
            3,
            false
        );
        // Not consumed — flesh source, damage proceeds.
        expect(res).not.toBeNull();
        expect(res?.amount).toBe(3);
    });
});

describe("Argothian Treefolk (prevent all damage from artifact sources, CR 615)", () => {
    it("prevents damage from an artifact source (any artifact, not just creatures)", () => {
        const treefolk = makeInstance(argothianTreefolk.id, {
            id: "treefolk",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Grapeshot Catapult is a noncreature Artifact damage source.
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [treefolk] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "permanent", id: "treefolk" },
            2,
            false
        );
        expect(res).toBeNull(); // prevented (consumed)
    });

    it("takes damage from a non-artifact source", () => {
        const treefolk = makeInstance(argothianTreefolk.id, {
            id: "treefolk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [treefolk] }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "giant",
            "p2",
            { type: "permanent", id: "treefolk" },
            3,
            false
        );
        expect(res?.amount).toBe(3);
    });

    it("wire format — prevention survives projectPublicState", () => {
        const treefolk = makeInstance(argothianTreefolk.id, {
            id: "treefolk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [treefolk] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const res = runDamageReplacement(
            projected as unknown as GameState,
            "catapult",
            "p2",
            { type: "permanent", id: "treefolk" },
            2,
            false
        );
        expect(res).toBeNull();
    });
});

describe("Titania's Song ({3}{G} Enchantment — CR 613.1f ability-loss + CR 205 type-add + CR 604.3 mana-value P/T)", () => {
    it("declares ability-loss + type-add + pt-cda static effects", () => {
        const kinds = (titaniasSong.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("ability-loss");
        expect(kinds).toContain("type-add");
        expect(kinds).toContain("pt-cda");
    });

    it("makes every noncreature artifact an artifact creature with P/T = mana value", () => {
        const { state, ring } = withTitaniasSong();
        expect(ring.types).toContain("Creature");
        expect(ring.types).toContain("Artifact");
        // Sol Ring mana value is 1 → 1/1.
        expect(getEffectivePower(state, ring)).toBe(1);
        expect(getEffectiveToughness(state, ring)).toBe(1);
    });

    it("strips all abilities: the Sol Ring's mana ability stops functioning", () => {
        const { ring } = withTitaniasSong();
        expect(ring.abilitiesSuppressedBy).toEqual([
            { sourceId: "song-1", seq: expect.any(Number) },
        ]);
        expect(hasManaAbility(ring)).toBe(false);
        expect(getActivatedManaAbility(ring)).toBeNull();
    });

    it("strips keyword abilities into removedKeywords (Ivory Tower has none; Ornithopter would)", () => {
        // Use Ivory Tower (an Artifact with a triggered ability) to assert the
        // triggered ability is suppressed.
        const state = makeState();
        const song = makeInstance(titaniasSong.id, {
            id: "song-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const tower = makeInstance(ivoryTower.id, {
            id: "tower-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(song, tower);
        applySourceStaticEffects(state, song);
        // Ivory Tower's "at the beginning of your upkeep" trigger is gone.
        expect(effectiveTriggeredAbilities(tower)).toHaveLength(0);
        const triggers = collectTriggers(state, [
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
        ]);
        expect(
            triggers.some((t) => t.triggeredAbilityId === "ivory-tower-life")
        ).toBe(false);
    });

    it("does NOT animate a printed artifact creature (Ornithopter stays as-is)", () => {
        const state = makeState();
        const song = makeInstance(titaniasSong.id, {
            id: "song-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const bird = makeInstance(ornithopter.id, {
            id: "bird-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(song, bird);
        applySourceStaticEffects(state, song);
        // Printed artifact creature: keeps flying, unsuppressed, base 0/2.
        expect(bird.abilitiesSuppressedBy).toBeUndefined();
        expect(bird.staticAbilities).toContain("flying");
        expect(getEffectivePower(state, bird)).toBe(0);
        expect(getEffectiveToughness(state, bird)).toBe(2);
    });

    it("affects an artifact that ENTERS after the Song resolves (applyExistingGrantsTo)", () => {
        const { state } = withTitaniasSong();
        const newRing = makeInstance(solRing.id, {
            id: "ring-2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(newRing);
        applyExistingGrantsTo(state, newRing);
        expect(newRing.types).toContain("Creature");
        expect(newRing.abilitiesSuppressedBy).toEqual([
            { sourceId: "song-1", seq: expect.any(Number) },
        ]);
        expect(getEffectivePower(state, newRing)).toBe(1);
    });

    it("reverts cleanly when the Song leaves play (unapplySourceStaticEffects)", () => {
        const { state, song, ring } = withTitaniasSong();
        unapplySourceStaticEffects(state, song);
        expect(ring.types).not.toContain("Creature");
        expect(ring.abilitiesSuppressedBy).toBeUndefined();
        expect(hasManaAbility(ring)).toBe(true);
        // P/T pipeline: no longer a creature → base undefined.
        expect(getActivatedManaAbility(ring)).not.toBeNull();
    });

    it("wire format: animated P/T and types survive projectPublicState", () => {
        const { state, ring } = withTitaniasSong();
        // Fat-state assertion.
        expect(ring.types).toContain("Creature");
        expect(getEffectivePower(state, ring)).toBe(1);
        expect(getEffectiveToughness(state, ring)).toBe(1);
        // Same assertion after projection (viewer p1).
        const projected = projectPublicState(state, 1, "p1");
        const projRing = projected.players[0].battlefield.find(
            (c) => c.id === "ring-1"
        )!;
        expect(projRing.types).toContain("Creature");
        expect(projRing.types).toContain("Artifact");
        expect(getEffectivePower(projected, projRing)).toBe(1);
        expect(getEffectiveToughness(projected, projRing)).toBe(1);
    });
});
