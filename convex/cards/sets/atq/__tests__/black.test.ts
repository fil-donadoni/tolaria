// Antiquities (ATQ) — per-card behavior tests for black cards in
// `convex/cards/sets/atq/black.ts` (set split by colour, ADR 0043). Each
// non-trivial card gets a describe block citing the CR section it exercises;
// assertions check external behavior only. Shared test shims live in
// `./helpers`; fixtures in `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import {
    ornithopter,
    amuletOfKroog,
    yawgmothDemon,
    priestOfYawgmoth,
    gateToPhyrexia,
    hauntingWind,
    artifactPossession,
    phyrexianGremlins,
    xenicPoltergeist,
} from "..";
import { solRing } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { hasManaAbility } from "../../../../gre/constants";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { advancePhase, untapStep } from "../../../../gre/phases";
import { checkStateBasedActions } from "../../../../gre/sba";
import type { CardType } from "../../../types";
import {
    abilityActivatedEvent,
    artifactTappedEvent,
    fireTrigger,
    resolveActivated,
    vanilla,
} from "./helpers";

// Yawgmoth Demon (CR 603.6a upkeep may-sacrifice-or-else)
describe("Yawgmoth Demon (upkeep may-sac artifact, else tap+2)", () => {
    it("is a 6/6 with flying and first strike", () => {
        expect(yawgmothDemon.power).toBe(6);
        expect(yawgmothDemon.toughness).toBe(6);
        expect(yawgmothDemon.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "first strike"])
        );
    });

    it("with no artifact to sacrifice, taps itself and deals 2 to controller", () => {
        const demon = makeInstance(yawgmothDemon.id, {
            id: "demon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [demon] })],
            phase: "UPKEEP",
        });
        // No artifacts: the may is skipped, the else-branch runs immediately.
        fireTrigger(state, demon, "yawgmoth-demon-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "demon"
        )!;
        expect(live.isTapped).toBe(true);
        expect(state.players[0].life).toBe(18);
    });

    it("declining the sacrifice taps itself and deals 2", () => {
        const demon = makeInstance(yawgmothDemon.id, {
            id: "demon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifact = makeInstance(amuletOfKroog.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [demon, artifact] })],
            phase: "UPKEEP",
        });
        // Decline the may-pay → else-branch.
        fireTrigger(
            state,
            demon,
            "yawgmoth-demon-upkeep",
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
            false
        );
        const live = state.players[0].battlefield.find(
            (c) => c.id === "demon"
        )!;
        expect(live.isTapped).toBe(true);
        expect(state.players[0].life).toBe(18);
        // Artifact NOT sacrificed.
        expect(state.players[0].battlefield.some((c) => c.id === "art")).toBe(
            true
        );
    });
});

describe("Priest of Yawgmoth (CR 602.1 — add {B} = sacrificed artifact mv)", () => {
    it("adds {B} equal to the snapshotted sacrificed mana value", () => {
        const priest = makeInstance(priestOfYawgmoth.id, { id: "priest-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        // The cost flow snapshots the sacrificed permanent's mv onto the stack
        // item; resolve() reads it via getAdditionalSacrificeMv. Simulate a
        // mv-3 artifact (e.g. Yotian Soldier) having been sacrificed.
        state.stack.push({
            ...priest,
            zone: "stack",
            castById: "p1",
            abilityId: "priest-of-yawgmoth-mana",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "sac-x", mv: 3 },
        });
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
    });

    it("adds no mana when the sacrificed permanent's mv is 0", () => {
        const priest = makeInstance(priestOfYawgmoth.id, { id: "priest-2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...priest,
            zone: "stack",
            castById: "p1",
            abilityId: "priest-of-yawgmoth-mana",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "sac-y", mv: 0 },
        });
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(0);
    });
});

describe("Gate to Phyrexia (CR 602.5 — upkeep, once/turn, sac creature)", () => {
    it("destroys a target artifact on resolution", () => {
        const gate = makeInstance(gateToPhyrexia.id, { id: "gate-1" });
        const artifact = makeInstance(ornithopter.id, {
            id: "art-tgt",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [gate] }),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        resolveActivated(state, gate, "gate-to-phyrexia-destroy", [
            { type: "permanent", id: "art-tgt" },
        ]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "art-tgt")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "art-tgt")).toBe(
            true
        );
    });
});

describe("Haunting Wind (1 dmg on artifact tap or non-tap ability)", () => {
    const self = {
        id: "hw",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
    };
    const tappedTrig = hauntingWind.triggeredAbilities!.find(
        (t) => t.id === "haunting-wind-tapped"
    )!;
    const abilityTrig = hauntingWind.triggeredAbilities!.find(
        (t) => t.id === "haunting-wind-ability"
    )!;

    it("tapped trigger fires for any artifact tap, ignores non-artifacts", () => {
        expect(
            tappedTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        expect(
            tappedTrig.matches(
                artifactTappedEvent({
                    permanentId: "a",
                    controllerId: "p2",
                    permanentTypes: ["Land"],
                }),
                self
            )
        ).toBe(false);
    });

    it("ability trigger fires for an artifact's non-tap ability, ignores non-artifacts", () => {
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({
                    permanentId: "a",
                    controllerId: "p2",
                    permanentTypes: ["Creature"],
                }),
                self
            )
        ).toBe(false);
        // Cross-wiring guard: the tapped trigger must NOT match the
        // ABILITY_ACTIVATED event, and vice versa.
        expect(
            tappedTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(false);
        expect(
            abilityTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(false);
    });

    it("resolves 1 damage to the artifact's controller on the ability event", () => {
        const hw = makeInstance(hauntingWind.id, {
            id: "hw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hw], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(
            state,
            hw,
            "haunting-wind-ability",
            abilityActivatedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(state.players[1].life).toBe(19);
    });

    it("wire format — damage to controller survives projection", () => {
        const hw = makeInstance(hauntingWind.id, {
            id: "hw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hw], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(
            state,
            hw,
            "haunting-wind-tapped",
            artifactTappedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(state.players[1].life).toBe(19);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(19);
    });
});

describe("Artifact Possession (Aura: 2 dmg on enchanted artifact tap/ability)", () => {
    const tappedTrig = artifactPossession.triggeredAbilities!.find(
        (t) => t.id === "artifact-possession-tapped"
    )!;
    const abilityTrig = artifactPossession.triggeredAbilities!.find(
        (t) => t.id === "artifact-possession-ability"
    )!;

    it("fires only for the enchanted artifact (self.attachedTo host check)", () => {
        const attached = {
            id: "ap",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host",
            card: {},
        };
        // enchanted artifact ("host") → matches
        expect(
            tappedTrig.matches(
                artifactTappedEvent({
                    permanentId: "host",
                    controllerId: "p2",
                }),
                attached
            )
        ).toBe(true);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({
                    permanentId: "host",
                    controllerId: "p2",
                }),
                attached
            )
        ).toBe(true);
        // a DIFFERENT artifact → no match
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({
                    permanentId: "other",
                    controllerId: "p2",
                }),
                attached
            )
        ).toBe(false);
        // unattached aura → no match
        expect(
            tappedTrig.matches(
                artifactTappedEvent({
                    permanentId: "host",
                    controllerId: "p2",
                }),
                { ...attached, attachedTo: undefined }
            )
        ).toBe(false);
    });

    it("resolves 2 damage to the host artifact's controller", () => {
        const ap = makeInstance(artifactPossession.id, {
            id: "ap",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ap], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(
            state,
            ap,
            "artifact-possession-ability",
            abilityActivatedEvent({ permanentId: "host", controllerId: "p2" })
        );
        expect(state.players[1].life).toBe(18);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(18);
    });
});

describe("Phyrexian Gremlins (tap-lock while tapped, CR 611.2 / 502.1)", () => {
    it("taps the target artifact and records the untap-lock", () => {
        const grem = makeInstance(phyrexianGremlins.id, {
            id: "grem",
            isTapped: true, // {T} cost already paid
        });
        const rock = vanilla("rock", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [grem] }),
                makePlayer("p2", { battlefield: [rock] }),
            ],
        });
        resolveActivated(state, grem, "phyrexian-gremlins-tap-lock", [
            { type: "permanent", id: "rock" },
        ]);
        const liveRock = state.players[1].battlefield.find(
            (c) => c.id === "rock"
        )!;
        expect(liveRock.isTapped).toBe(true);
        expect(liveRock.untapLockedBy).toEqual(["grem"]);
    });

    it("keeps the locked artifact tapped through its controller's untap step", () => {
        const grem = makeInstance(phyrexianGremlins.id, {
            id: "grem",
            isTapped: true,
        });
        const rock = vanilla("rock", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
            isTapped: true,
            untapLockedBy: ["grem"],
        });
        const state = makeState({
            phase: "UNTAP",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [grem] }),
                makePlayer("p2", { battlefield: [rock] }),
            ],
        });
        untapStep(state);
        const liveRock = state.players[1].battlefield.find(
            (c) => c.id === "rock"
        )!;
        expect(liveRock.isTapped).toBe(true); // lock holds — Gremlin still tapped
    });

    it("frees the artifact once the Gremlin untaps (SBA prunes the lock)", () => {
        const grem = makeInstance(phyrexianGremlins.id, {
            id: "grem",
            isTapped: false, // Gremlin untapped on a prior turn
        });
        const rock = vanilla("rock", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
            isTapped: true,
            untapLockedBy: ["grem"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [grem] }),
                makePlayer("p2", { battlefield: [rock] }),
            ],
        });
        checkStateBasedActions(state);
        const liveRock = state.players[1].battlefield.find(
            (c) => c.id === "rock"
        )!;
        expect(liveRock.untapLockedBy).toBeUndefined();

        // Now the artifact's controller's untap step untaps it.
        state.phase = "UNTAP";
        state.activePlayerId = "p2";
        untapStep(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "rock")!.isTapped
        ).toBe(false);
    });
});

describe("Xenic Poltergeist ({1}{B}{B} 1/1 Spirit — {T}: animate target noncreature artifact until your next upkeep)", () => {
    function setup(): {
        state: GameState;
        xenic: CardInstanceState;
        ring: CardInstanceState;
    } {
        const state = makeState();
        const xenic = makeInstance(xenicPoltergeist.id, {
            id: "xenic-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const ring = makeInstance(solRing.id, {
            id: "ring-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(xenic, ring);
        return { state, xenic, ring };
    }

    it("animates the target artifact to a creature with P/T = mana value", () => {
        const { state, xenic, ring } = setup();
        resolveActivated(state, xenic, "xenic-poltergeist-animate", [
            { type: "permanent", id: "ring-1" },
        ]);
        expect(ring.types).toContain("Creature");
        expect(ring.animation).toBeDefined();
        // Sol Ring MV 1 → 1/1; does NOT strip abilities (unlike the Song).
        expect(getEffectivePower(state, ring)).toBe(1);
        expect(getEffectiveToughness(state, ring)).toBe(1);
        expect(ring.abilitiesSuppressedBy).toBeUndefined();
        expect(hasManaAbility(ring)).toBe(true);
    });

    it("animation ends at the controller's next upkeep (CR 500.2)", () => {
        const { state, xenic, ring } = setup();
        resolveActivated(state, xenic, "xenic-poltergeist-animate", [
            { type: "permanent", id: "ring-1" },
        ]);
        expect(ring.animation).toBeDefined();
        // Run to p1's next upkeep: pass the rest of p1's turn, all of p2's, and
        // reach p1's UPKEEP. Advancing phases ticks durations at the boundary.
        for (let i = 0; i < 40; i++) {
            advancePhase(state);
            if (state.phase === "UPKEEP" && state.activePlayerId === "p1") {
                break;
            }
        }
        expect(state.phase).toBe("UPKEEP");
        expect(state.activePlayerId).toBe("p1");
        expect(ring.animation).toBeUndefined();
        expect(ring.types).not.toContain("Creature");
    });

    it("does NOT end at the OPPONENT's upkeep (player-scoped duration)", () => {
        const { state, xenic, ring } = setup();
        resolveActivated(state, xenic, "xenic-poltergeist-animate", [
            { type: "permanent", id: "ring-1" },
        ]);
        // Advance to p2's upkeep — p1's animation must survive it.
        for (let i = 0; i < 40; i++) {
            advancePhase(state);
            if (state.phase === "UPKEEP" && state.activePlayerId === "p2") {
                break;
            }
        }
        expect(state.activePlayerId).toBe("p2");
        expect(ring.animation).toBeDefined();
        expect(ring.types).toContain("Creature");
    });

    it("wire format: animated P/T and types survive projectPublicState", () => {
        const { state, xenic, ring } = setup();
        resolveActivated(state, xenic, "xenic-poltergeist-animate", [
            { type: "permanent", id: "ring-1" },
        ]);
        expect(getEffectivePower(state, ring)).toBe(1);
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
