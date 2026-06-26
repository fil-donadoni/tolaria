// Antiquities (ATQ) — per-card behavior tests for white cards in
// `convex/cards/sets/atq/white.ts` (set split by colour, ADR 0043). Each
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
    argivianArchaeologist,
    triskelion,
    argivianBlacksmith,
    circleOfProtectionArtifacts,
    artifactWard,
    martyrsOfKorlis,
    reversePolarity,
} from "..";
import { grizzlyBears, hillGiant } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    runDamageReplacement,
    type GameState,
} from "../../../../gre/state";
import {
    getLegalTargets,
    getPendingTargetSourceTypes,
} from "../../../../gre/rules";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { applyAllCombatDamage } from "../../../../gre/phases";
import type { CardType } from "../../../types";
import { resolveActivated, vanilla } from "./helpers";

describe("Argivian Archaeologist ({W}{W},{T}: return artifact from graveyard, CR 605 / 400.7)", () => {
    it("returns the targeted artifact card to the controller's hand", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const source = makeInstance(argivianArchaeologist.id, {
            id: "arch",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [source],
                    graveyard: [art],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, source, "argivian-archaeologist-return", [
            { type: "graveyard-card", id: "art", playerId: "p1" },
        ]);
        expect(state.players[0].graveyard.some((c) => c.id === "art")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "art")).toBe(true);
    });

    it("is a 1/2 artifact creature costing {1}{W}{W}", () => {
        expect(argivianArchaeologist.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(argivianArchaeologist.power).toBe(1);
        expect(argivianArchaeologist.toughness).toBe(2);
        expect(argivianArchaeologist.manaCost).toEqual({ X: 1, W: 2 });
    });
});

describe("Argivian Blacksmith (prevent next 2 to target creature, CR 615.1)", () => {
    it("registers a 2-damage shield on the targeted creature", () => {
        const smith = makeInstance(argivianBlacksmith.id, { id: "smith" });
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [smith, robot] })],
        });
        resolveActivated(state, smith, "argivian-blacksmith-prevent", [
            { type: "permanent", id: "robot" },
        ]);
        expect(state.targetPreventionShields?.[0]).toMatchObject({
            targetId: "robot",
            remaining: 2,
        });
    });
});

// Circle of Protection: Artifacts (CR 615.1 source-prevention via COP factory)
describe("Circle of Protection: Artifacts (CR 615.1)", () => {
    it("is a {1}{W} enchantment built from the COP factory", () => {
        expect(circleOfProtectionArtifacts.types).toEqual(["Enchantment"]);
        expect(circleOfProtectionArtifacts.manaCost).toEqual({ X: 1, W: 1 });
    });

    it("registers an end-of-turn prevention against the chosen artifact source", () => {
        const cop = makeInstance(circleOfProtectionArtifacts.id, { id: "cop" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cop] }),
                makePlayer("p2"),
            ],
        });
        // Chosen source: an artifact permanent that would damage p1.
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(robot);
        resolveActivated(state, cop, "cop-prevent", [
            { type: "permanent", id: "robot" },
        ]);
        expect(state.preventionEffects).toEqual([
            {
                sourceInstanceId: "robot",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("the COP ability lists artifact permanents as legal sources, not creatures", () => {
        const cop = makeInstance(circleOfProtectionArtifacts.id, { id: "cop" });
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cop] }),
                makePlayer("p2", { battlefield: [robot, bear] }),
            ],
        });
        const ability = circleOfProtectionArtifacts.activatedAbilities!.find(
            (a) => a.id === "cop-prevent"
        )!;
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("robot");
        expect(legal).not.toContain("bear");
    });
});

describe("Artifact Ward (Aura: block restriction + prevention + targeting guard, CR 303.4 / 509.1b / 615 / 611)", () => {
    function setup(opts: { tappedHost?: boolean } = {}) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: opts.tappedHost,
        });
        const ward = makeInstance(artifactWard.id, {
            id: "ward",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        return { host, ward };
    }

    it("enchanted creature can't be blocked by artifact creatures", () => {
        const { host, ward } = setup();
        const artifactBlocker = makeInstance(yotianSoldier.id, {
            id: "yotian",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [artifactBlocker] }),
            ],
        });
        expect(
            validateBlockerEligibility(
                host,
                artifactBlocker,
                [artifactBlocker],
                state
            ).eligible
        ).toBe(false);
    });

    it("prevents damage to enchanted creature from artifact sources", () => {
        const { host, ward } = setup();
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "permanent", id: "host" },
            2,
            false
        );
        expect(res).toBeNull();
    });

    it("enchanted creature can't be targeted by abilities from artifact sources, but can by non-artifact sources", () => {
        const { host, ward } = setup();
        // Triskelion is an artifact source with a targeted ability.
        const trisk = makeInstance(triskelion.id, {
            id: "trisk",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Hill Giant is a non-artifact permanent (stands in for a flesh source).
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [trisk, giant] }),
            ],
        });
        // Artifact source (Triskelion's types include "Artifact") — guarded.
        expect(
            isGuardedAgainst(state, host, "cantBeTargeted", trisk.types)
        ).toBe(true);
        // Non-artifact source — NOT guarded.
        expect(
            isGuardedAgainst(state, host, "cantBeTargeted", giant.types)
        ).toBe(false);
        // Unenchanted creature is never guarded by this Ward.
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(
            isGuardedAgainst(state, other, "cantBeTargeted", trisk.types)
        ).toBe(false);
    });

    it("getPendingTargetSourceTypes reports an artifact source's types (ability path)", () => {
        const trisk = makeInstance(triskelion.id, {
            id: "trisk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [trisk] }),
            ],
        });
        expect(
            getPendingTargetSourceTypes(state, "trisk", "ability")
        ).toContain("Artifact");
    });

    it("getLegalTargets excludes the warded creature for an artifact ability source", () => {
        const { host, ward } = setup();
        host.isAttacking = false;
        const trisk = makeInstance(triskelion.id, {
            id: "trisk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [trisk] }),
            ],
        });
        const req = { type: "any" as CardType, count: 1 as const };
        // Artifact source: warded host excluded.
        const artifactLegal = getLegalTargets(state, req, [], "p2", undefined, [
            "Artifact",
        ]).map((t) => t.id);
        expect(artifactLegal).not.toContain("host");
        // No source-type info (non-artifact / default): host IS targetable.
        const fleshLegal = getLegalTargets(state, req, [], "p2").map(
            (t) => t.id
        );
        expect(fleshLegal).toContain("host");
    });

    it("wire format — prevention survives projectPublicState", () => {
        const { host, ward } = setup();
        host.isAttacking = false;
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const res = runDamageReplacement(
            projected as unknown as GameState,
            "catapult",
            "p2",
            { type: "permanent", id: "host" },
            2,
            false
        );
        expect(res).toBeNull();
    });
});

describe("Martyrs of Korlis (redirect artifact damage to self while untapped, CR 614)", () => {
    it("redirects player damage from an artifact source while untapped", () => {
        const martyrs = makeInstance(martyrsOfKorlis.id, {
            id: "martyrs",
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
                makePlayer("p1", { battlefield: [martyrs], life: 20 }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "player", id: "p1" },
            2,
            false
        );
        expect(res?.target).toEqual({ type: "permanent", id: "martyrs" });
    });

    it("does NOT redirect while tapped (CR 614 condition)", () => {
        const martyrs = makeInstance(martyrsOfKorlis.id, {
            id: "martyrs",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [martyrs], life: 20 }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "player", id: "p1" },
            2,
            false
        );
        expect(res?.target).toEqual({ type: "player", id: "p1" });
    });

    it("does NOT redirect damage from a non-artifact source", () => {
        const martyrs = makeInstance(martyrsOfKorlis.id, {
            id: "martyrs",
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
                makePlayer("p1", { battlefield: [martyrs], life: 20 }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "giant",
            "p2",
            { type: "player", id: "p1" },
            3,
            false
        );
        expect(res?.target).toEqual({ type: "player", id: "p1" });
    });
});

describe("artifact-damage tracking + Reverse Polarity (CR 120.3 tally / 119 lifegain)", () => {
    it("bumps artifactDamageToPlayerThisTurn only for artifact combat sources", () => {
        // Artifact creature (Colossus 9/9) attacks unblocked.
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [colossus] }),
            ],
            combat: {
                attackerIds: ["colossus"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {}, "regular");
        expect(state.players[0].life).toBe(11);
        expect(state.artifactDamageToPlayerThisTurn?.["p1"]).toBe(9);
        // The general damage tally also counts it.
        expect(state.damageDealtToPlayerThisTurn?.["p1"]).toBe(9);
    });

    it("does NOT bump the artifact tally for a non-artifact combat source", () => {
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
            combat: {
                attackerIds: ["giant"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {}, "regular");
        expect(state.players[0].life).toBe(17);
        expect(state.artifactDamageToPlayerThisTurn?.["p1"] ?? 0).toBe(0);
        expect(state.damageDealtToPlayerThisTurn?.["p1"]).toBe(3);
    });

    it("Reverse Polarity gains twice the artifact damage dealt this turn", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 11 }), makePlayer("p2")],
            artifactDamageToPlayerThisTurn: { p1: 9 },
        });
        const item = pushSpell(state, reversePolarity.id, "p1");
        item.controllerId = "p1";
        resolveTopOfStack(state);
        // 9 artifact damage → gain 18.
        expect(state.players[0].life).toBe(29);
    });

    it("Reverse Polarity gains 0 when no artifact damage was dealt", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 17 }), makePlayer("p2")],
            damageDealtToPlayerThisTurn: { p1: 3 },
        });
        const item = pushSpell(state, reversePolarity.id, "p1");
        item.controllerId = "p1";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });
});
