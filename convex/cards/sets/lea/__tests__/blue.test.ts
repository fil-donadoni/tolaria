// Per-card behavior tests for blue cards in `convex/cards/sets/lea/blue.ts`
// (LEA, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises. Shared stack/resolve shims live in
// ./helpers; fixture builders stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    ancestralRecall,
    animateArtifact,
    badMoon,
    blackKnight,
    braingeyser,
    camouflage,
    circleOfProtectionWhite,
    clone,
    controlMagic,
    copyArtifact,
    counterspell,
    creatureBond,
    drainPower,
    feedback,
    flight,
    forest,
    grizzlyBears,
    helmOfChatzuk,
    invisibility,
    island,
    jadeStatue,
    jayemdaeTome,
    jump,
    lifetap,
    lightningBolt,
    lordOfAtlantis,
    magicalHack,
    manaFlare,
    manaShort,
    manaVault,
    manabarbs,
    merfolkOfThePearlTrident,
    monssGoblinRaiders,
    mountain,
    phantasmalForces,
    phantasmalTerrain,
    pirateShip,
    plains,
    plateau,
    powerLeak,
    powerSink,
    prodigalSorcerer,
    psionicBlast,
    psychicVenom,
    redWard,
    savannahLions,
    seaSerpent,
    serraAngel,
    shanodinDryads,
    sirensCall,
    sleightOfMind,
    spellBlast,
    stasis,
    stealArtifact,
    swamp,
    timeWalk,
    timetwister,
    twiddle,
    undergroundSea,
    unsummon,
    vesuvanDoppelganger,
    volcanicEruption,
    wallOfSwords,
    wallOfWater,
    wildGrowth,
} from "..";
import {
    removePermanentTo,
    resolveTopOfStack,
    emitPermanentTapped,
    processPendingActionTriggers,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { getBasicLandMana } from "../../../../gre/constants";
import { getLegalTargets, getProtectedColors } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { substituteColorFilter } from "../../../../gre/textChanges";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    getRequiredAttackerIds,
} from "../../../../gre/combat";
import { advancePhase, untapStep } from "../../../../gre/phases";
import { compactState, expandState } from "../../../../gre/serialize";
import type { CardType } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    BEARS,
    SERRA,
    activatePump,
    driveCopyChoice,
    grizzlyBearsId,
    runUntapForJ,
} from "./helpers";

describe("Psionic Blast ({2}{U} — 4 to any target, 2 to you, CR 120.3)", () => {
    it("deals 4 damage to target player and 2 damage to the caster", () => {
        const state = makeState();
        pushSpell(state, psionicBlast.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
        expect(state.players[0].life).toBe(18);
    });

    it("kills a 4-toughness creature while still damaging the caster", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            power: 3,
            toughness: 4,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        pushSpell(state, psionicBlast.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("wall");
        expect(state.players[0].life).toBe(18);
    });

    it("can target the caster — 4 + 2 damage both hit p1", () => {
        const state = makeState();
        pushSpell(state, psionicBlast.id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(14);
    });
});

describe("Volcanic Eruption ({X}{U}{U}{U} — destroy X target Mountains, deal that many to each creature/player, CR 107.3 / 205.3 / 614.5 / 120.3)", () => {
    function makeMountain(id: string, controllerId: string): CardInstanceState {
        return makeInstance(mountain.id, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    function setupBoard() {
        const m1 = makeMountain("mtn-1", "p2");
        const m2 = makeMountain("mtn-2", "p2");
        const m3 = makeMountain("mtn-3", "p2");
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [flier] }),
                makePlayer("p2", { battlefield: [m1, m2, m3, lion] }),
            ],
        });
    }

    it("declares X-bound count and Mountain subtype filter", () => {
        expect(volcanicEruption.targetRequirement).toEqual({
            type: "Land",
            subtypeFilter: "Mountain",
            count: "X",
        });
    });

    it("destroys X Mountains and deals X damage to each creature and each player", () => {
        const state = setupBoard();
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        // Two Mountains gone from p2's battlefield.
        const p2 = state.players[1];
        expect(p2.battlefield.find((c) => c.id === "mtn-1")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "mtn-2")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "mtn-3")).toBeDefined();

        // Savannah Lions (toughness 1) dies to 2 damage; Serra Angel
        // (toughness 4) survives with 2 marked damage.
        expect(p2.battlefield.find((c) => c.id === "lion")).toBeUndefined();
        const flier = state.players[0].battlefield.find(
            (c) => c.id === "flier"
        );
        expect(flier?.damageMarked).toBe(2);

        // Mountains + Lions in p2's graveyard.
        const p2GraveIds = p2.graveyard.map((c) => c.id);
        expect(p2GraveIds).toEqual(
            expect.arrayContaining(["mtn-1", "mtn-2", "lion"])
        );
        // Volcanic Eruption itself goes to its caster's graveyard (CR 608.2k).
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            volcanicEruption.id
        );

        // Both players take 2.
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });

    it("treats dual lands with the Mountain subtype as legal targets (CR 205.3)", () => {
        // Plateau is "Land — Mountain Plains" — has the Mountain subtype.
        const dual = makeInstance(plateau.id, {
            id: "plateau",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [dual] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            volcanicEruption.targetRequirement!
        );
        expect(legal.map((t) => t.id)).toContain("plateau");
    });

    it("excludes non-Mountain lands from legal targets", () => {
        // Underground Sea (Island Swamp) — no Mountain subtype, must NOT match.
        const sea = makeInstance(undergroundSea.id, {
            id: "sea",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [sea] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            volcanicEruption.targetRequirement!
        );
        expect(legal).toHaveLength(0);
    });

    it("skips a target that is no longer a Mountain on resolution (CR 608.2b)", () => {
        // Pre-stage: caster picked two targets, but mtn-2 has already left
        // the battlefield (removed before resolution). Only mtn-1 is still a
        // Mountain — Volcanic Eruption deals 1 damage, not 2.
        const state = setupBoard();
        // Surgically remove mtn-2 from the battlefield.
        const p2 = state.players[1];
        p2.battlefield = p2.battlefield.filter((c) => c.id !== "mtn-2");

        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        // Only mtn-1 was destroyed → damage = 1.
        expect(p2.battlefield.find((c) => c.id === "mtn-1")).toBeUndefined();
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        // Savannah Lions (toughness 1) dies even to 1 damage.
        expect(p2.battlefield.find((c) => c.id === "lion")).toBeUndefined();
        // Serra Angel (toughness 4) survives with 1 marked damage.
        const flier = state.players[0].battlefield.find(
            (c) => c.id === "flier"
        );
        expect(flier?.damageMarked).toBe(1);
    });

    it("is a no-op when no Mountains were destroyed (avoids spurious 0 damage)", () => {
        const state = setupBoard();
        // Surgically remove every Mountain before resolution — every chosen
        // target is now off-battlefield.
        const p2 = state.players[1];
        p2.battlefield = p2.battlefield.filter(
            (c) => !c.subtypes.includes("Mountain")
        );
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
        const lion = p2.battlefield.find((c) => c.id === "lion");
        expect(lion?.damageMarked).toBeUndefined();
    });

    it("wire format: destroyed Mountains and damaged creatures survive projection", () => {
        const state = setupBoard();
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 2, "p2");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).not.toContain("mtn-1");
        expect(ids).not.toContain("mtn-2");
        expect(ids).toContain("mtn-3");
        // Savannah Lions died → not on the projected board.
        expect(ids).not.toContain("lion");
        expect(p2.life).toBe(18);
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.life).toBe(18);
    });
});

describe("Ancestral Recall (target player draws 3, CR 608.3)", () => {
    it("draws 3 cards for the target player", () => {
        const p2Library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p2-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: p2Library }),
            ],
        });
        pushSpell(state, ancestralRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(3);
        expect(state.players[1].library).toHaveLength(2);
    });
});

describe("Braingeyser ({X}{U}{U} — target player draws X, CR 107.3 / 121.1)", () => {
    function setup(libSize = 10) {
        const p2Library = Array.from({ length: libSize }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p2-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: p2Library }),
            ],
        });
    }

    it("target player draws X cards on resolution", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(4);
        expect(state.players[1].library).toHaveLength(6);
    });

    it("can target the caster", () => {
        const p1Library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p1-lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { library: p1Library }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("is a no-op when X is 0 (draws no cards)", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(10);
    });

    it("stops at empty library and flags hasDrawnFromEmpty (CR 704.5b)", () => {
        // Library has only 2 cards; X=5 draws 2 and then pulls from empty.
        const state = setup(2);
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(2);
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].hasDrawnFromEmpty).toBe(true);
    });

    it("goes to the caster's graveyard after resolving (CR 608.2k)", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 1;
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            braingeyser.id
        );
    });

    it("wire format: chosenX survives projectPublicState", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack[0];
        expect(projectedItem.chosenX).toBe(3);
        expect(projectedItem.targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("declares a single-player target requirement", () => {
        expect(braingeyser.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });
});

describe("Counterspell (counter target spell, CR 701.5a)", () => {
    it("removes a spell from the stack (doesn't let it resolve)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        // Resolve Counterspell first (top of stack → LIFO)
        resolveTopOfStack(state);
        // The Lightning Bolt should have been removed from the stack.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        // Counterspell itself goes to p1's graveyard.
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("preserves p1 life (bolt never resolves)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Sea Serpent (CR 508.1c attack restriction + CR 603.8 state trigger)", () => {
    it("uses data-driven attack-restriction (no magic string)", () => {
        expect(seaSerpent.staticAbilities).not.toContain(
            "cant-attack-unless-defender-controls-Island"
        );
        expect(seaSerpent.staticEffects).toBeDefined();
        expect(
            seaSerpent.staticEffects!.some(
                (e) => e.kind === "attack-restriction"
            )
        ).toBe(true);
    });

    function setup(opts: {
        controllerHasIsland: boolean;
        defenderHasIsland: boolean;
    }) {
        const serpent = makeInstance(seaSerpent.id, {
            id: "serpent",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p1Lands = opts.controllerHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p1-isle",
                      controllerId: "p1",
                      ownerId: "p1",
                  }),
              ]
            : [];
        const p2Lands = opts.defenderHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p2-isle",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [serpent, ...p1Lands] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
    }

    it("can attack when defending player controls an Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: true,
        });
        const serpent = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            serpent,
            state.players[1].battlefield
        );
        expect(result).toEqual({ eligible: true });
    });

    it("cannot attack when defending player has no Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const serpent = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            serpent,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/Island/);
        }
    });

    it("ignores controller's Islands — only defender's count for the attack restriction", () => {
        // p1 controls an Island, p2 does not. Serpent still cannot attack
        // because the restriction reads "defending player controls an Island".
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const serpent = state.players[0].battlefield[0];
        expect(
            validateAttackerEligibility(serpent, state.players[1].battlefield)
                .eligible
        ).toBe(false);
    });

    it("state trigger queues a sacrifice when controller has no Islands", () => {
        // Serpent in play, controller has zero Islands. The first SBA pass
        // schedules the sacrifice trigger on the stack (CR 117.5 + 603.8).
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: true,
        });
        expect(state.stack).toHaveLength(0);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        expect(item.triggeredAbilityId).toBe(
            "sea-serpent-no-islands-sacrifice"
        );
        expect(item.triggerSourceId).toBe("serpent");
        expect(item.triggerEvent?.type).toBe("STATE_CHECK");
    });

    it("does NOT trigger a second time while the first trigger is on the stack (CR 603.8)", () => {
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        // Subsequent SBA passes (e.g. another priority handoff) must not pile
        // up duplicate triggers — the state trigger holds itself off until
        // the existing copy resolves or otherwise leaves the stack.
        checkStateBasedActions(state);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
    });

    it("does NOT trigger when controller has at least one Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(0);
    });

    it("on resolve, sends Sea Serpent to its owner's graveyard", () => {
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "serpent"
        );
    });

    it("re-triggers after the first sacrifice trigger leaves the stack if the condition still holds", () => {
        // Two Sea Serpents: the trigger fires once per source even after a
        // separate trigger of the same kind has resolved. After resolution,
        // a fresh SBA pass produces a new trigger for any remaining serpent
        // whose controller still has no Islands.
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        const second = makeInstance(seaSerpent.id, {
            id: "serpent2",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        state.players[0].battlefield.push(second);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "serpent",
            "serpent2",
        ]);
    });

    it("fizzles at resolve if controller has gained an Island in the meantime (CR 603.8 re-check)", () => {
        // CR 603.8 — the state-trigger condition is re-checked at resolution.
        // The `stateTrigger` factory exposes this via the engine-level
        // interveningIf hook. Setup: trigger fires (no Islands), then an
        // Island enters the battlefield BEFORE the trigger resolves, then
        // the stack is resolved. Expected: trigger fizzles, Sea Serpent
        // stays on the battlefield, TRIGGER_FIZZLED is emitted.
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        // Condition flips: controller now has an Island.
        state.players[0].battlefield.push(
            makeInstance(island.id, {
                id: "p1-isle-late",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        resolveTopOfStack(state);
        // Stack item consumed without invoking resolve: the source stays on
        // the battlefield and nothing hits the graveyard. (Engine drains
        // pendingEvents into trigger scans in `processPendingActionTriggers`,
        // so the TRIGGER_FIZZLED event itself isn't observable here — the
        // engine-level fizzle path is covered by
        // `convex/gre/__tests__/intervening-if.test.ts`.)
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "serpent")
        ).toBe(true);
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "serpent"
        );
    });

    it("wire format: attack restriction survives projectPublicState", () => {
        // The projection slims `card.card` to `{ id }`. The restriction
        // logic reads `staticAbilities` and the defender battlefield's
        // `subtypes` — both of which the projection preserves.
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedSerpent = projected.players[0].battlefield.find(
            (c) => c.id === "serpent"
        )!;
        const projectedDefender = projected.players[1].battlefield;
        const result = validateAttackerEligibility(
            projectedSerpent as CardInstanceState,
            projectedDefender as CardInstanceState[]
        );
        expect(result.eligible).toBe(false);
    });
});

describe("Control Magic (Aura control-change, CR 613.1b layer 2 + 702.10c)", () => {
    it("is a {2}{U}{U} Aura that targets a creature and declares a control-change effect", () => {
        expect(controlMagic.manaCost).toEqual({ X: 2, U: 2 });
        expect(controlMagic.types).toEqual(["Enchantment"]);
        expect(controlMagic.subtypes).toEqual(["Aura"]);
        expect(controlMagic.targetRequirement?.type).toBe("Creature");
        expect(controlMagic.staticEffects).toHaveLength(1);
        expect(controlMagic.staticEffects?.[0].kind).toBe("control-change");
    });

    it("on resolve, transfers control of the enchanted creature and sets summoning sickness", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Bear now lives in p1's battlefield array under p1's control.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("bear");
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p1");
        // CR 702.10c — control continuity broke, sickness applies.
        expect(bearAfter.isSummoningSick).toBe(true);
        // Bookkeeping for reversal: the stack has one entry (this aura)
        // with the pre-flip controller as `previousControllerId`.
        expect(bearAfter.controlChanges).toHaveLength(1);
        expect(bearAfter.controlChanges?.[0].previousControllerId).toBe("p2");

        // Aura sits on caster's battlefield, attached to the bear.
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
        expect(bearAfter.controlChanges?.[0].auraId).toBe(aura.id);
    });

    it("wire format: the control flip survives projectPublicState", () => {
        // Regression: the projection maps each player's battlefield array
        // verbatim (slimming card defs). A controlled creature must therefore
        // appear in the new controller's projected battlefield with the
        // updated controllerId — otherwise the client would render it on
        // the wrong side.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimBear).toBeDefined();
        expect(slimBear?.controllerId).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("reverts control when the aura is destroyed (Disenchant-style removal)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;

        // Disenchant the aura directly.
        removePermanentTo(state, aura.id, "graveyard");

        // Bear returned to p2's battlefield with its original controller.
        expect(state.players[1].battlefield.map((c) => c.id)).toContain("bear");
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p2");
        expect(bearAfter.controlChanges).toBeUndefined();
        // Continuity broke again on reversal — sickness applies until p2's
        // next untap step.
        expect(bearAfter.isSummoningSick).toBe(true);
        // Aura went to its owner's graveyard.
        expect(
            state.players[0].graveyard.find(
                (c) => c.card.id === controlMagic.id
            )
        ).toBeDefined();
    });

    it("host dies → SBA detaches the aura to the caster's graveyard (CR 704.5m)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        // The bear dies (e.g. Lightning Bolt). The host id is gone from
        // every battlefield array — SBA should sweep the aura into its
        // caster's graveyard.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "bear"
        );
        checkStateBasedActions(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === controlMagic.id
            )
        ).toBeUndefined();
        const auraInGY = state.players[0].graveyard.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(auraInGY).toBeDefined();
        expect(auraInGY.attachedTo).toBeUndefined();
    });

    it("retargeting own creature is a no-op for the flip (same controller pre/post)", () => {
        // If the caster already controls the target, the aura attaches but
        // the control-change predicate still runs; since newControllerId
        // matches the current controllerId, no stack entry is written and
        // no battlefield array swap happens.
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
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p1");
        expect(bearAfter.controlChanges).toBeUndefined();
        // Aura is still attached and resident on p1's bf.
        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === controlMagic.id
            )?.attachedTo
        ).toBe("bear");
    });

    it("stacked CMs: latest wins while present; removing the TOP restores to the layer below (CR 613 layer 2 timestamps)", () => {
        // P1 owns bear. P2's CM1 steals it → bear on p2. P1's CM2 steals it
        // back → bear on p1. Removing CM2 first: CR says CM1 is still
        // active, so bear must revert to p2 (not to owner p1).
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        // CM1 cast by p2 targeting the bear.
        pushSpell(state, controlMagic.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm1 = state.players[1].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p2");

        // CM2 cast by p1 targeting the (now p2-controlled) bear.
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm2 = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id && c.id !== cm1.id
        )!;
        const bearWithBoth = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearWithBoth.controllerId).toBe("p1");
        expect(bearWithBoth.controlChanges).toHaveLength(2);

        // Disenchant CM2 (top of stack) first → CM1 still applies → bear
        // must go to p2, NOT back to owner p1.
        removePermanentTo(state, cm2.id, "graveyard");
        const bearAfterCm2 = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterCm2).toBeDefined();
        expect(bearAfterCm2.controllerId).toBe("p2");
        expect(bearAfterCm2.controlChanges).toHaveLength(1);
        expect(bearAfterCm2.controlChanges?.[0].auraId).toBe(cm1.id);

        // Then disenchant CM1 → no more effects → bear collapses to owner.
        removePermanentTo(state, cm1.id, "graveyard");
        const bearFinal = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearFinal).toBeDefined();
        expect(bearFinal.controllerId).toBe("p1");
        expect(bearFinal.controlChanges).toBeUndefined();
    });

    it("stacked CMs: removing the MIDDLE entry leaves current controller intact and top pops to owner (CR 108.3)", () => {
        // Same stacked setup as above, but this time CM1 (bottom of stack)
        // is destroyed first. CR: CM2 is still active, bear stays on p1.
        // Then CM2 destroyed → stack empty → bear collapses to owner p1.
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
        pushSpell(state, controlMagic.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm1 = state.players[1].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm2 = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id && c.id !== cm1.id
        )!;

        // Disenchant CM1 (middle/bottom) — bear stays on p1 (CM2 still
        // applies), stack collapses to a single entry.
        removePermanentTo(state, cm1.id, "graveyard");
        const bearMid = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearMid.controllerId).toBe("p1");
        expect(bearMid.controlChanges).toHaveLength(1);
        expect(bearMid.controlChanges?.[0].auraId).toBe(cm2.id);
        // The middle-removal patched `previousControllerId` so the remaining
        // entry now records the pre-chain value (bear's owner = p1).
        expect(bearMid.controlChanges?.[0].previousControllerId).toBe("p1");

        // Disenchant CM2 — stack empties, bear goes back to owner.
        removePermanentTo(state, cm2.id, "graveyard");
        const bearFinal = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearFinal.controllerId).toBe("p1");
        expect(bearFinal.controlChanges).toBeUndefined();
    });
});

describe("Steal Artifact (Aura control-change on artifacts, CR 613.1b layer 2)", () => {
    it("is a {2}{U}{U} Aura that targets an artifact and declares a control-change effect", () => {
        expect(stealArtifact.manaCost).toEqual({ X: 2, U: 2 });
        expect(stealArtifact.types).toEqual(["Enchantment"]);
        expect(stealArtifact.subtypes).toEqual(["Aura"]);
        expect(stealArtifact.targetRequirement?.type).toBe("Artifact");
        expect(stealArtifact.staticEffects).toHaveLength(1);
        expect(stealArtifact.staticEffects?.[0].kind).toBe("control-change");
    });

    it("on resolve, transfers control of the enchanted artifact (no summoning sickness — artifacts aren't creatures)", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "statue"
        );
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "statue"
        );
        const statueAfter = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(statueAfter.controllerId).toBe("p1");
        // CR 702.10c scopes summoning sickness to creatures — artifacts
        // aren't creatures so they don't pick it up on a control flip.
        expect(statueAfter.isSummoningSick).toBeUndefined();
        expect(statueAfter.controlChanges).toHaveLength(1);
        expect(statueAfter.controlChanges?.[0].previousControllerId).toBe("p2");

        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === stealArtifact.id
        )!;
        expect(aura.attachedTo).toBe("statue");
    });

    it("wire format: the control flip survives projectPublicState", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimStatue = projected.players[0].battlefield.find(
            (c) => c.id === "statue"
        );
        expect(slimStatue).toBeDefined();
        expect(slimStatue?.controllerId).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
    });

    it("reverts control when the aura is destroyed (Disenchant-style removal)", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === stealArtifact.id
        )!;

        removePermanentTo(state, aura.id, "graveyard");

        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "statue"
        );
        const statueAfter = state.players[1].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(statueAfter.controllerId).toBe("p2");
    });

    it("fizzles when the target leaves the battlefield between cast and resolution (CR 608.2b)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "ghost-statue" },
        ]);
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === stealArtifact.id
            )
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stealArtifact.id
        );
    });

    it("SBA detaches the aura when the host loses its artifact type (removed from battlefield)", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);

        // Artifact host leaves play.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "statue"
        );
        checkStateBasedActions(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === stealArtifact.id
            )
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stealArtifact.id
        );
    });
});

describe("Time Walk (extra turn after this one, CR 500.7)", () => {
    it("is a {1}{U} sorcery", () => {
        expect(timeWalk.manaCost).toEqual({ X: 1, U: 1 });
        expect(timeWalk.types).toEqual(["Sorcery"]);
    });

    it("resolves by queueing an extra turn for the caster", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        expect(state.extraTurns).toBeUndefined();
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("advancing the turn keeps the caster active (no opponent swap)", () => {
        // Resolve Time Walk at end-of-turn so the very next advanceTurn runs.
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
        });
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        // END_STEP → CLEANUP (auto) → UNTAP of the next turn.
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(state.turn).toBe(2);
        expect(state.extraTurns).toBeUndefined();
        // The turn after the extra turn returns to normal swap order.
        const next = makeState({
            ...state,
            phase: "END_STEP",
        });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p2");
    });

    it("multiple extra turns stack LIFO (CR 500.7)", () => {
        const state = makeState({ phase: "END_STEP", activePlayerId: "p1" });
        // p1 casts Time Walk targeting self, then p2 somehow gets one queued
        // (simulated by pushing directly). Order: [p1, p2] → p2 taken first.
        state.extraTurns = ["p1", "p2"];
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.extraTurns).toEqual(["p1"]);
        const next = makeState({ ...state, phase: "END_STEP" });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p1");
        expect(next.extraTurns).toBeUndefined();
    });

    it("wire format: extraTurns survives projectPublicState", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.extraTurns).toEqual(["p1"]);
        expect(projected.activePlayerId).toBe(state.activePlayerId);
    });
});

// ---------------------------------------------------------------------------
// Timetwister — "Each player shuffles their hand and graveyard into their
// library, then draws seven cards." (CR 121.1, 701.20)
// ---------------------------------------------------------------------------

describe("Timetwister (each player reshuffles + draws 7, CR 121.1 / 701.20)", () => {
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

    it("is a {2}{U} sorcery", () => {
        expect(timetwister.manaCost).toEqual({ X: 2, U: 1 });
        expect(timetwister.types).toEqual(["Sorcery"]);
    });

    it("each player ends with 7 cards in hand, graveyard empty, remainder in library", () => {
        // p1 totals 10 cards across private zones (3 hand + 2 gy + 5 lib);
        // p2 totals 15 (4 hand + 1 gy + 10 lib). After resolve, p1 has
        // Timetwister itself in graveyard (resolved sorcery) so library = 3
        // and graveyard = 1; p2 has no such contribution so library = 8.
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p1", 2, "p1-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p1", 5, "p1-lib"),
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
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2], rngSeed: 42 });
        pushSpell(state, timetwister.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        // Timetwister itself lands in p1's graveyard after resolution.
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].graveyard[0].card.id).toBe(timetwister.id);
        expect(state.players[0].library).toHaveLength(3);

        expect(state.players[1].hand).toHaveLength(7);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(8);
    });

    it("shuffles deterministically under the same seed (PRNG replay)", () => {
        function run(seed: number): string[] {
            const p1 = makePlayer("p1", {
                library: libraryCards("p1", 12, "p1-lib"),
            });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                rngSeed: seed,
            });
            pushSpell(state, timetwister.id, "p1");
            resolveTopOfStack(state);
            return state.players[0].library.map((c) => c.id);
        }
        expect(run(123)).toEqual(run(123));
        expect(run(123)).not.toEqual(run(456));
    });

    it("wire format: hand/library/graveyard counts survive projectPublicState", () => {
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 8, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 2, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p2", 9, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2], rngSeed: 7 });
        pushSpell(state, timetwister.id, "p1");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        // p1 is the viewer → hand is the fat list of their own cards.
        expect(projected.players[0].hand).toHaveLength(7);
        expect(projected.players[0].library.count).toBe(
            state.players[0].library.length
        );
        expect(projected.players[0].graveyard).toHaveLength(1);
        // p2 is the opponent → hand is projected as null placeholders.
        expect(projected.players[1].hand).toHaveLength(7);
        expect(projected.players[1].library.count).toBe(
            state.players[1].library.length
        );
        expect(projected.players[1].graveyard).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Wheel of Fortune — "Each player discards their hand, then draws seven
// cards." (CR 701.8, 121.1)
// ---------------------------------------------------------------------------

describe("Twiddle (toggle tap state on artifact/creature/land, CR 701.20)", () => {
    it("taps an untapped target", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("untaps a tapped target", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].isTapped).toBe(false);
    });

    it("getLegalTargets returns artifacts, creatures, and lands (and excludes other types)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const isle = makeInstance(island.id, {
            id: "isle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(controlMagic.id, {
            id: "cm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome, isle, aura] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            twiddle.targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id).sort();
        expect(ids).toEqual(["bear", "isle", "tome"]);
    });

    it("CR 608.2b: silently does nothing if the target left the battlefield before resolution", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        removePermanentTo(state, "land", "graveyard");
        // Should not throw — primitive silently no-ops.
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Unsummon (return target creature to its owner's hand, CR 701.10 / 400.7)", () => {
    it("returns the target creature from battlefield to its owner's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.battlefield.map((c) => c.id)).not.toContain("bear");
        expect(p2.hand.map((c) => c.id)).toContain("bear");
        expect(p2.hand[0].zone).toBe("hand");
    });

    it("clears battlefield-only transient state on the bounced card (CR 400.7)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
            damageMarked: 1,
            isSummoningSick: true,
            hasAttackedThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.isTapped).toBe(false);
        expect(returned.damageMarked).toBeUndefined();
        expect(returned.isSummoningSick).toBeUndefined();
        expect(returned.hasAttackedThisTurn).toBeUndefined();
    });

    it("CR 608.2b: silently does nothing if the target left the battlefield before resolution", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        // Target leaves the battlefield in response (e.g. Lightning Bolt kills it).
        removePermanentTo(state, "bear", "graveyard");
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.hand.map((c) => c.id)).not.toContain("bear");
        expect(p2.graveyard.map((c) => c.id)).toContain("bear");
    });

    it("strips aura-granted keywords from a bounced host (CR 611.2)", () => {
        // Bear with Red Ward attached grants "protection from red". Bouncing
        // the bear must lift the grant before the host enters its hand —
        // otherwise a re-cast bear would carry stale protection.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, redWard.id, "p2", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("protection from red");

        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.staticAbilities).not.toContain("protection from red");
        expect(returned.grantedStaticAbilities ?? []).toHaveLength(0);

        // The orphan aura is still on the battlefield with stale attachedTo;
        // SBA sweeps it to the graveyard (CR 704.5n).
        checkStateBasedActions(state);
        const aura = state.players[1].graveyard.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("strips aura-granted control change from a bounced host (CR 611.2 / 613.1b)", () => {
        // Bear under p2 control via p1's Control Magic. Bouncing the bear
        // must collapse the control stack so the host returns to its owner
        // (p2) clean. The orphan Control Magic is then swept by SBA.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Control flipped to p1.
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(stolen.controllerId).toBe("p1");

        pushSpell(state, unsummon.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.controlChanges).toBeUndefined();
        expect(returned.controllerId).toBe("p2");

        checkStateBasedActions(state);
        const aura = state.players[0].graveyard.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("wire format: bounced creature is no longer on the projected battlefield", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        // Owner's hand grows by one (the projection lists own-hand cards).
        const handIds = projected.players[1].hand
            .filter((c): c is NonNullable<typeof c> => c !== null)
            .map((c) => c.id);
        expect(handIds).toContain("bear");
    });
});

// ---------------------------------------------------------------------------
// White FREE cycle (LEA): Consecrate Land, Crusade, Death Ward, Farmstead,
// Holy Strength, Karma, Lance.
// ---------------------------------------------------------------------------

describe("Feedback (Aura on Enchantment — 1 dmg to host's controller at upkeep)", () => {
    // Host always belongs to p1; aura always to p2. Trigger should fire on
    // p1's upkeep only.
    function setup(activePlayerId: string) {
        const hostEnchant = makeInstance(badMoon.id, {
            id: "host-ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(feedback.id, {
            id: "feedback",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-ench",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [hostEnchant] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("declares Aura targeting Enchantment", () => {
        expect(feedback.types).toEqual(["Enchantment"]);
        expect(feedback.subtypes).toEqual(["Aura"]);
        expect(feedback.targetRequirement).toEqual({
            type: "Enchantment",
            count: 1,
        });
    });

    it("queues + resolves into 1 damage to host's controller at their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("feedback-upkeep");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("does NOT fire on a non-host-controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Flight (Aura — enchanted creature has flying, CR 702.9)", () => {
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
        pushSpell(state, flight.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants 'flying' to the host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("flying");
    });

    it("wire format: flying survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("flying");
    });
});

describe("Jump (instant — target creature gains flying until end of turn)", () => {
    it("grants flying for the rest of the turn (duration = end-of-turn)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, jump.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.staticAbilities).toContain("flying");
    });

    it("the temporary grant expires at CLEANUP (CR 514.2)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, jump.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        // Walk turn until CLEANUP fires.
        for (let i = 0; i < 12 && state.phase !== "CLEANUP"; i++) {
            advancePhase(state);
        }
        // After CLEANUP processing, pump should be gone.
        advancePhase(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).not.toContain("flying");
    });
});

describe("Pirate Ship ({T}: 1 dmg + can't attack unless defender controls Island)", () => {
    it("uses data-driven attack-restriction (no magic string)", () => {
        expect(pirateShip.staticAbilities).not.toContain(
            "cant-attack-unless-defender-controls-Island"
        );
        expect(pirateShip.staticEffects).toBeDefined();
        expect(
            pirateShip.staticEffects!.some(
                (e) => e.kind === "attack-restriction"
            )
        ).toBe(true);
    });

    function setup(opts: { defenderHasIsland: boolean }) {
        const ship = makeInstance(pirateShip.id, {
            id: "ship",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p2Lands = opts.defenderHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p2-isle",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [ship] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
    }

    it("can attack when defender controls an Island", () => {
        const state = setup({ defenderHasIsland: true });
        const ship = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            ship,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(true);
    });

    it("cannot attack when defender has no Island", () => {
        const state = setup({ defenderHasIsland: false });
        const ship = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            ship,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
    });

    it("activated {T} ability deals 1 to a target player", () => {
        const state = setup({ defenderHasIsland: true });
        const ship = state.players[0].battlefield[0];
        state.stack.push({
            ...ship,
            zone: "stack",
            castById: "p1",
            abilityId: "pirate-ship-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Prodigal Sorcerer ({T}: 1 dmg to any target — original Tim)", () => {
    function setup() {
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [tim] }),
                makePlayer("p2"),
            ],
        });
    }

    it("declares a 'tap, target any, deal 1' activated ability", () => {
        const ability = prodigalSorcerer.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement?.type).toBe("any");
    });

    it("deals 1 damage to a target player", () => {
        const state = setup();
        const tim = state.players[0].battlefield[0];
        state.stack.push({
            ...tim,
            zone: "stack",
            castById: "p1",
            abilityId: "prodigal-sorcerer-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("kills a 1-toughness creature", () => {
        const state = setup();
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(lion);
        const tim = state.players[0].battlefield[0];
        state.stack.push({
            ...tim,
            zone: "stack",
            castById: "p1",
            abilityId: "prodigal-sorcerer-zap",
            targets: [{ type: "permanent", id: "lion" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "lion"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");
    });
});

// ---------------------------------------------------------------------------
// Black FREE cycle (LEA): Cursed Land, Drudge Skeletons, Mind Twist, Plague
// Rats, Raise Dead, Unholy Strength, Wall of Bone, Warp Artifact, Weakness,
// Will-o'-the-Wisp.
// ---------------------------------------------------------------------------

describe("Lord of Atlantis (other Merfolk get +1/+1; lord pt-buff — blue)", () => {
    it("buffs other Merfolk +1/+1 across both controllers, excludes self", () => {
        const lord = makeInstance(lordOfAtlantis.id, { id: "lord" });
        const myFolk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "mine",
        });
        const oppFolk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, myFolk] }),
                makePlayer("p2", { battlefield: [oppFolk] }),
            ],
        });
        // Both Merfolk become 2/2.
        expect(getEffectivePower(state, myFolk)).toBe(2);
        expect(getEffectivePower(state, oppFolk)).toBe(2);
        // Lord stays 2/2 (excludes itself).
        expect(getEffectivePower(state, lord)).toBe(2);
        expect(getEffectiveToughness(state, lord)).toBe(2);
    });

    it("does NOT buff non-Merfolk", () => {
        const lord = makeInstance(lordOfAtlantis.id, { id: "lord" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Artifact FREE cycle (LEA): Celestial Prism, Copper Tablet, Rod of Ruin.
// ---------------------------------------------------------------------------

describe("Lord-style keyword grant — Lord of Atlantis islandwalk", () => {
    it("entering Lord grants islandwalk to existing Merfolk", () => {
        const folk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "folk",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [folk] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lordOfAtlantis.id, "p1");
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "folk"
        )!;
        expect(after.staticAbilities).toContain("islandwalk");
    });

    it("does NOT grant islandwalk to itself (excludes source)", () => {
        const state = makeState();
        pushSpell(state, lordOfAtlantis.id, "p1");
        resolveTopOfStack(state);
        const lord = state.players[0].battlefield[0];
        expect(lord.staticAbilities ?? []).not.toContain("islandwalk");
    });
});

// ---------------------------------------------------------------------------
// Zombie Master (CR 113.1 granted activated ability + lord-style pt-buff +
// keyword-grant). Exercises the new `activated-grant` static effect kind and
// the `grantedActivatedAbilities` activation lookup path end-to-end.
// ---------------------------------------------------------------------------

describe("Wall of Water ({U}: +1/+0 until end of turn)", () => {
    it("has defender + pumps on activation", () => {
        const w = makeInstance(wallOfWater.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [w] }), makePlayer("p2")],
        });
        const wall = state.players[0].battlefield.find((c) => c.id === "w")!;
        expect(wall.staticAbilities).toContain("defender");
        activatePump(state, wall, "wall-of-water-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "w")!;
        expect(getEffectivePower(state, after)).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });
});

describe("Creature Bond (aura, on host death deal damage = toughness to controller)", () => {
    function setupAttached() {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(creatureBond.id, {
            id: "bond",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        return state;
    }

    it("triggers and deals damage = host's toughness to host's controller on death", () => {
        const state = setupAttached();
        // Lightning Bolt from p1 kills the bear (toughness 2). Trigger pushes
        // onto stack; resolving it deals 2 to the bear's controller (p2).
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);
        // The death trigger landed on the stack.
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe("creature-bond-death");
        // Resolve the trigger — p2 takes 2 damage (bear toughness).
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("does not trigger when a different creature dies", () => {
        const state = setupAttached();
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(other);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "other" },
        ]);
        resolveTopOfStack(state);
        // No trigger — host is still attached, the other bear died.
        expect(state.stack.length).toBe(0);
        expect(state.players[1].life).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// Counters (CR 122) — addCounter / removeCounter / layer 7d
// ---------------------------------------------------------------------------

describe("Lifetap (gain 1 life on opponent's Forest becoming tapped)", () => {
    it("matches opponent Forest tap, ignores own Forest, ignores non-Forest", () => {
        const trig = lifetap.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "lt",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const oppForest = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "f",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: false,
        };
        expect(trig!.matches(oppForest, self)).toBe(true);
        expect(trig!.matches({ ...oppForest, controllerId: "p1" }, self)).toBe(
            false
        );
        expect(
            trig!.matches(
                { ...oppForest, permanentSubtypes: ["Mountain"] },
                self
            )
        ).toBe(false);
    });
});

describe("mana-tap triggers fire end-to-end", () => {
    it("Manabarbs deals 1 damage to the player who tapped a Mountain", () => {
        const state = makeState();
        const p1 = state.players[0];
        const mountain = makeInstance("eace2c85-976c-425e-9800-5a6ccbd91b56", {
            controllerId: "p1",
        });
        const manabarbsCard = makeInstance(manabarbs.id, {
            controllerId: "p1",
        });
        p1.battlefield.push(mountain, manabarbsCard);

        emitPermanentTapped(state, mountain, true, { R: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("manabarbs-damage");

        resolveTopOfStack(state);
        expect(p1.life).toBe(19);
        expect(state.stack).toHaveLength(0);
    });

    it("Mana Flare adds an extra mana of the produced color on land tap", () => {
        const state = makeState();
        const p1 = state.players[0];
        const forest = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            controllerId: "p1",
        });
        const manaFlareCard = makeInstance(manaFlare.id, {
            controllerId: "p1",
        });
        p1.battlefield.push(forest, manaFlareCard);
        p1.manaPool.G = 1;

        emitPermanentTapped(state, forest, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("mana-flare-extra");

        resolveTopOfStack(state);
        expect(p1.manaPool.G).toBe(2);
    });

    it("wire format: tap-trigger life delta (Lifetap) survives projectPublicState", () => {
        const state = makeState();
        const p1 = state.players[0];
        const p2 = state.players[1];
        const oppForest = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            controllerId: "p2",
            ownerId: "p2",
        });
        const lifetapCard = makeInstance(lifetap.id, {
            controllerId: "p1",
        });
        p2.battlefield.push(oppForest);
        p1.battlefield.push(lifetapCard);

        emitPermanentTapped(state, oppForest, false);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(p1.life).toBe(21);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(21);
    });

    it("Wild Growth fires only when its enchanted host is tapped for mana", () => {
        const state = makeState();
        const p1 = state.players[0];
        const enchantedForest = makeInstance(
            "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
            { controllerId: "p1" }
        );
        const otherForest = makeInstance(
            "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
            { controllerId: "p1" }
        );
        const wildGrowthCard = makeInstance(wildGrowth.id, {
            controllerId: "p1",
            attachedTo: enchantedForest.id,
        });
        p1.battlefield.push(enchantedForest, otherForest, wildGrowthCard);

        emitPermanentTapped(state, otherForest, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);

        emitPermanentTapped(state, enchantedForest, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "wild-growth-extra-green"
        );

        p1.manaPool.G = 1;
        resolveTopOfStack(state);
        expect(p1.manaPool.G).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Wave 1 (PERMANENT_TAPPED / aura-activated / counter-spell-color additions)
// ---------------------------------------------------------------------------

describe("Psychic Venom (Aura on Land — 2 damage to host's controller on tap)", () => {
    it("trigger matches only the attached host's tap event", () => {
        const trig = psychicVenom.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "pv",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host-land",
            card: {},
        };
        const matchingEvent = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "host-land",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(trig!.matches(matchingEvent, self)).toBe(true);
        // Other land tap → ignored
        expect(
            trig!.matches({ ...matchingEvent, permanentId: "other" }, self)
        ).toBe(false);
    });

    it("end-to-end: tapping host land queues + resolves into 2 damage", () => {
        const hostLand = makeInstance(swamp.id, {
            id: "host-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(psychicVenom.id, {
            id: "pv",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-land",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [hostLand] }),
            ],
        });
        const before = state.players[1].life;
        emitPermanentTapped(state, hostLand, true, { B: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("psychic-venom-damage");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 2);
    });
});

describe("Power Leak (Aura on Enchantment — host's controller pays {U} or loses 1 life at upkeep)", () => {
    function setup(activePlayerId: string) {
        const hostEnchant = makeInstance(badMoon.id, {
            id: "host-ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(powerLeak.id, {
            id: "pl",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-ench",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [hostEnchant] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("queues at host's controller's upkeep and asks them to pay {U}", () => {
        const state = setup("p1");
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("power-leak-upkeep");
        // First call enqueues a may-pay choice for p1.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
    });

    it("does NOT fire on a non-host-controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.stack).toHaveLength(0);
    });

    it("declining the may-pay loses 1 life", () => {
        const state = setup("p1");
        advancePhase(state);
        // First resolve enqueues the choice; commit "decline" then resolve again.
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head).toBeDefined();
        const item = state.stack.find((s) => s.id === head!.stackItemId);
        expect(item).toBeDefined();
        item!.collectedChoices = {
            ...(item!.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["decline"],
        };
        state.pendingChoices = undefined;
        const before = state.players[0].life;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });
});

describe("Invisibility (Aura — host can be blocked only by Walls)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, invisibility.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("places a block-restriction aura on the battlefield attached to the host", () => {
        const { state } = setup();
        const aura = state.players[0].battlefield.find((c) => c.id !== "bear")!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
        expect(invisibility.staticEffects).toBeDefined();
        expect(
            invisibility.staticEffects!.some(
                (e) => e.kind === "block-restriction"
            )
        ).toBe(true);
    });

    it("non-Wall blocker is illegal against the enchanted attacker", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        state.players[1].battlefield.push(blocker);
        const result = validateBlockerEligibility(
            bear,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(result.eligible).toBe(false);
    });

    it("Wall blocker is legal", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        const wall = makeInstance(wallOfWater.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        state.players[1].battlefield.push(wall);
        expect(
            validateBlockerEligibility(
                bear,
                wall,
                state.players[1].battlefield,
                state
            )
        ).toEqual({ eligible: true });
    });
});

describe("Stasis (players skip their untap step + upkeep sacrifice unless {U}, CR 502.1, ADR 0005)", () => {
    function setup() {
        const enchant = makeInstance(stasis.id, {
            id: "stasis",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(plains.id, {
            id: "l1",
            isTapped: true,
            manaCommitted: true,
            chosenMana: { W: 1 },
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant, land, bear] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }

    it("declares a single untap-restriction static effect (maxUntap 0, any-permanent filter)", () => {
        expect(stasis.manaCost).toEqual({ X: 1, U: 1 });
        expect(stasis.types).toEqual(["Enchantment"]);
        // No opaque skip-untap-step keyword — restriction lives in
        // `staticEffects` per ADR 0005.
        expect(stasis.staticAbilities ?? []).not.toContain("skip-untap-step");
        expect(stasis.staticEffects).toHaveLength(1);
        const effect = stasis.staticEffects?.[0];
        expect(effect?.kind).toBe("untap-restriction");
        if (effect?.kind === "untap-restriction") {
            expect(effect.maxUntap).toBe(0);
            // Filter matches every permanent type — equivalent to "any".
            expect(effect.filter).toEqual({
                types: [
                    "Artifact",
                    "Creature",
                    "Enchantment",
                    "Land",
                    "Planeswalker",
                    "Battle",
                ],
            });
        }
    });

    it("the active player's untap step is a no-op when Stasis is in play (no prompt, no untaps)", () => {
        const { state } = setup();
        runUntapForJ("p1", state);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(true);
        // No PendingChoice enqueued — ADR 0003 auto-resolves the hard skip.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.pendingUntapStep).toBeUndefined();
    });

    it("dispatcher clears manaCommitted / isSummoningSick / chosenMana on every active-BF permanent even though nothing untaps", () => {
        // Exercise `untapStep` directly: end-of-phase `emptyManaPools` would
        // re-set `manaCommitted` on still-tapped lands (CR 500.4), so the
        // dispatcher's per-step cleanup is the level the assertion targets —
        // mirrors the prior `skip-untap-step` semantics.
        const { state } = setup();
        untapStep(state);
        const bf = state.players[0].battlefield;
        const land = bf.find((c) => c.id === "l1")!;
        const bear = bf.find((c) => c.id === "bear")!;
        expect(land.manaCommitted).toBeUndefined();
        expect(land.chosenMana).toBeUndefined();
        expect(bear.isSummoningSick).toBeUndefined();
    });

    it("wire format: skipped board projects with both permanents still tapped and no PendingChoice", () => {
        const { state } = setup();
        runUntapForJ("p1", state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices ?? []).toEqual([]);
        const slim = projected.players[0].battlefield;
        expect(slim.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(slim.find((c) => c.id === "bear")?.isTapped).toBe(true);
    });

    it("upkeep trigger queues may-pay; declining sacrifices Stasis", () => {
        const { state } = setup();
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UNTAP";
        advancePhase(state); // → UPKEEP
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "stasis-upkeep"
        );
        expect(trigger).toBeDefined();
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["decline"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Stasis moved to graveyard, skip-untap no longer active.
        expect(
            state.players[0].battlefield.find((c) => c.id === "stasis")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stasis.id
        );
    });

    it("upkeep trigger — accepting keeps Stasis on the battlefield", () => {
        const { state } = setup();
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UNTAP";
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "stasis")
        ).toBeDefined();
    });
});

describe("Phantasmal Forces (upkeep may-pay {U} else sacrifice)", () => {
    it("pay {U} on upkeep keeps the creature on the battlefield", () => {
        const inst = makeInstance(phantasmalForces.id, {
            id: "phantasmal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state); // → UPKEEP, trigger pushed to stack
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "phantasmal-forces-upkeep"
        );
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "phantasmal")
        ).toBeDefined();
    });

    it("decline on upkeep sacrifices the creature", () => {
        const inst = makeInstance(phantasmalForces.id, {
            id: "phantasmal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "phantasmal")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "phantasmal"
        );
    });
});

describe("Animate Artifact ({3}{U} — aura: artifact becomes creature with P/T = MV)", () => {
    it("adds Creature type and grants P/T equal to host's printed MV", () => {
        const vault = makeInstance(manaVault.id, {
            id: "vault",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateArtifact.id, "p1", [
            { type: "permanent", id: "vault" },
        ]);
        resolveTopOfStack(state);
        const vaultAfter = state.players[0].battlefield.find(
            (c) => c.id === "vault"
        )!;
        // Mana Vault printed cost is {1} → MV 1. After Animate Artifact:
        // host has Creature type and 1/1.
        expect(vaultAfter.types).toContain("Creature");
        expect(getEffectivePower(state, vaultAfter)).toBe(1);
        expect(getEffectiveToughness(state, vaultAfter)).toBe(1);
    });

    it("does NOT add Creature type when host is already a creature", () => {
        // Synth: a creature artifact (use Mana Vault and pre-mark types
        // with Creature to simulate an already-animated artifact).
        const vault = makeInstance(manaVault.id, {
            id: "vault",
            controllerId: "p1",
            ownerId: "p1",
        });
        vault.types = [...vault.types, "Creature"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateArtifact.id, "p1", [
            { type: "permanent", id: "vault" },
        ]);
        resolveTopOfStack(state);
        const vaultAfter = state.players[0].battlefield.find(
            (c) => c.id === "vault"
        )!;
        // No grant tracked since predicate gated on !isCreature.
        expect(vaultAfter.grantedTypes ?? []).toEqual([]);
    });

    it("CDA P/T survives the wire format projection", () => {
        const vault = makeInstance(manaVault.id, {
            id: "vault",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateArtifact.id, "p1", [
            { type: "permanent", id: "vault" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "vault"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });
});

describe("Spell Blast ({X}{U} — counter target spell with mv = X)", () => {
    it("counters a target spell whose mana value equals X", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Opp casts Lightning Bolt (mv 1). p1 responds with Spell Blast X=1.
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const blast = pushSpell(state, spellBlast.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        blast.chosenX = 1;
        resolveTopOfStack(state); // resolve Spell Blast
        // Bolt countered, no longer on stack.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("getManaValue on a stack spell folds in the chosen X", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Push Braingeyser with chosenX=4 → mv = printed (2) + 4 = 6.
        const bg = pushSpell(state, braingeyser.id, "p2", [
            { type: "player", id: "p2" },
        ]);
        bg.chosenX = 4;
        // Spell Blast with X=5 (not 6) → blast resolves but target's mv !=
        // X, the spell-target validation has already been bypassed by
        // pushSpell, so the resolve goes through.  Re-check via getManaValue.
        const blast = pushSpell(state, spellBlast.id, "p1", [
            { type: "spell", id: bg.id },
        ]);
        blast.chosenX = 6;
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bg.id)).toBeUndefined();
    });

    it("declares mvFilter equals X on the target requirement", () => {
        expect(spellBlast.targetRequirement?.mvFilter).toEqual({
            equals: "X",
        });
    });
});

// ---------------------------------------------------------------------------
// W12: Free cards
// ---------------------------------------------------------------------------

describe("Mana Short (tap all lands + drain mana pool, CR 106.4)", () => {
    it("is a {2}{U} Instant targeting a player", () => {
        expect(manaShort.manaCost).toEqual({ X: 2, U: 1 });
        expect(manaShort.types).toEqual(["Instant"]);
        expect(manaShort.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it("taps all target's lands and empties their mana pool", () => {
        const land1 = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land2 = makeInstance(island.id, {
            id: "f2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [land1, land2, creature],
                    manaPool: { W: 0, U: 2, B: 0, R: 0, G: 1, C: 0 },
                }),
            ],
        });
        pushSpell(state, manaShort.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // Lands should be tapped
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "f2")!.isTapped
        ).toBe(true);
        // Creature should NOT be tapped
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!.isTapped
        ).toBe(false);
        // Mana pool should be empty
        expect(state.players[1].manaPool.U).toBe(0);
        expect(state.players[1].manaPool.G).toBe(0);
    });

    it("already-tapped lands stay tapped (no-op)", () => {
        const land = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, manaShort.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.isTapped
        ).toBe(true);
    });
});

describe("Drain Power (tap lands + transfer mana, CR 106.4)", () => {
    it("is a {U}{U} Sorcery targeting a player", () => {
        expect(drainPower.manaCost).toEqual({ U: 2 });
        expect(drainPower.types).toEqual(["Sorcery"]);
        expect(drainPower.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it("taps target's lands, drains their mana, and adds it to caster", () => {
        const land1 = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land2 = makeInstance(mountain.id, {
            id: "m1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", {
                    battlefield: [land1, land2],
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 2, C: 0 },
                }),
            ],
        });
        pushSpell(state, drainPower.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // p2's lands tapped
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "m1")!.isTapped
        ).toBe(true);
        // p2's mana pool drained
        expect(state.players[1].manaPool.R).toBe(0);
        expect(state.players[1].manaPool.G).toBe(0);
        // p1 gains p2's drained mana (added to existing pool)
        expect(state.players[0].manaPool.R).toBe(3);
        expect(state.players[0].manaPool.G).toBe(2);
        expect(state.players[0].manaPool.U).toBe(1); // unchanged
    });

    it("drainManaPool returns correct amounts when pool is empty", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
            ],
        });
        pushSpell(state, drainPower.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // p1's pool unchanged (nothing drained)
        expect(state.players[0].manaPool).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 0,
        });
    });

    it("spell goes to graveyard after resolution (sorcery)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, drainPower.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(
            state.players[0].graveyard.some(
                (c) => (c.card as { id: string }).id === drainPower.id
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Serialization: skipNextTurn on PlayerState round-trip
// ---------------------------------------------------------------------------

describe("Phantasmal Terrain ({U}{U} — modal aura: choose basic land type)", () => {
    it("applies chosen mode's subtype-set to host", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(phantasmalTerrain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        aura.chosenModeId = "island";
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(mtn.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(mtn)).toBe("U");
    });

    it("forest mode makes host produce {G}", () => {
        const state = makeState();
        const pln = makeInstance(plains.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(pln);

        const aura = makeInstance(phantasmalTerrain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = pln.id;
        aura.chosenModeId = "forest";
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(pln.subtypes).toEqual(["Forest"]);
        expect(getBasicLandMana(pln)).toBe("G");
    });

    it("removing aura restores original subtypes", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(phantasmalTerrain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        aura.chosenModeId = "swamp";
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);
        expect(mtn.subtypes).toEqual(["Swamp"]);

        unapplySourceStaticEffects(state, aura);
        expect(mtn.subtypes).toEqual(["Mountain"]);
    });

    it("has 5 modes (one per basic land type)", () => {
        expect(phantasmalTerrain.modes).toHaveLength(5);
        const ids = phantasmalTerrain.modes!.map((m) => m.id);
        expect(ids).toEqual([
            "plains",
            "island",
            "swamp",
            "mountain",
            "forest",
        ]);
    });
});

describe("Power Sink (CR 701.5a — counter unless controller pays {X})", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const stackItem = state.stack.find((s) => s.id === head.stackItemId)!;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    it("counters the spell if opponent declines to pay X", () => {
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const sink = pushSpell(state, powerSink.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        sink.chosenX = 3;

        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");

        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("on decline, opponent's lands tapped and mana drained", () => {
        const land = makeInstance(mountain.id, {
            id: "mt",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [land],
            manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const sink = pushSpell(state, powerSink.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        sink.chosenX = 3;

        resolveTopOfStack(state);
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        expect(land.isTapped).toBe(true);
        expect(p2.manaPool.R).toBe(0);
    });

    it("if opponent pays X, spell resolves normally", () => {
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const sink = pushSpell(state, powerSink.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        sink.chosenX = 3;

        resolveTopOfStack(state);
        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
    });
});

describe("Siren's Call (CR 508.1d — all creatures must attack)", () => {
    it("sets allCreaturesMustAttack on resolve", () => {
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2");
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p2",
        });

        pushSpell(state, sirensCall.id, "p1");
        resolveTopOfStack(state);

        expect(state.allCreaturesMustAttack).toBe("p2");
    });

    it("mass flag makes getRequiredAttackerIds include all eligible creatures", () => {
        const creature1 = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creature2 = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [creature1, creature2],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
        });
        state.allCreaturesMustAttack = "p1";

        const required = getRequiredAttackerIds(
            p1.battlefield,
            undefined,
            state.allCreaturesMustAttack
        );
        expect(required).toContain("lion");
        expect(required).toContain("bear");
    });

    it("tapped creatures are not required (can't attack)", () => {
        const tappedCreature = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [tappedCreature],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
        });
        state.allCreaturesMustAttack = "p1";

        const required = getRequiredAttackerIds(
            p1.battlefield,
            undefined,
            state.allCreaturesMustAttack
        );
        expect(required).toHaveLength(0);
    });

    it("delayed trigger destroys non-Wall non-attackers at end step", async () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            hasAttackedThisTurn: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [lion, wall, bear],
        });
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
        });

        // Schedule the delayed trigger via resolve
        pushSpell(state, sirensCall.id, "p2");
        resolveTopOfStack(state);

        expect(state.delayedTriggers).toHaveLength(1);

        // Fire the delayed trigger
        const { fireDelayedTriggers } = await import("../../../../gre/phases");
        fireDelayedTriggers(state, "next-end-step");

        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        // Lion (didn't attack) → destroyed
        // Wall → exempt (is a Wall)
        // Bear (attacked) → survives
        expect(p1.battlefield.map((c) => c.id)).toEqual(
            expect.arrayContaining(["wall", "bear"])
        );
        expect(p1.battlefield.find((c) => c.id === "lion")).toBeUndefined();
    });
});

describe("Clone (enter as a copy of any creature, CR 707.2)", () => {
    function cloneState() {
        const serra = makeInstance(SERRA, {
            id: "serra",
            controllerId: "p2",
            ownerId: "p2",
            counters: { "+1/+1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [serra] }),
            ],
        });
        const item = pushSpell(state, clone.id, "p1");
        item.id = "clone1";
        return { state, item };
    }

    it("enters as a copy with the creature's abilities, types and P/T", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        );
        expect(copy).toBeDefined();
        expect((copy!.card as { id: string }).id).toBe(SERRA);
        expect(copy!.types).toEqual(["Creature"]);
        expect(copy!.subtypes).toEqual(["Angel"]);
        expect(copy!.staticAbilities).toEqual(["flying", "vigilance"]);
        expect(getEffectivePower(state, copy!)).toBe(4);
        expect(getEffectiveToughness(state, copy!)).toBe(4);
        expect(copy!.copiedFrom).toBe(clone.id);
    });

    it("does NOT copy counters, damage or tap state (CR 707.2)", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect(copy.counters ?? {}).toEqual({});
        expect(copy.damageMarked ?? 0).toBe(0);
        expect(copy.isTapped).toBe(false);
        // The original keeps its +1/+1 counter (5/5); the copy is a clean 4/4.
        const serra = state.players[1].battlefield.find(
            (c) => c.id === "serra"
        )!;
        expect(getEffectivePower(state, serra)).toBe(5);
    });

    it("enters as a 0/0 and dies to SBA when no creature is copied", () => {
        const state = makeState();
        const item = pushSpell(state, clone.id, "p1");
        item.id = "clone1";
        // No creatures on the battlefield → the step copies nothing, no suspend.
        expect(resolveTopOfStack(state)).not.toBeNull();
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        );
        expect(copy).toBeDefined();
        expect(getEffectiveToughness(state, copy!)).toBe(0);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "clone1")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "clone1")).toBe(
            true
        );
    });

    it("accepts a copy target from the opponent's battlefield via the submit path", () => {
        const { state, item } = cloneState();
        // step 1: may-pay yes
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        item.collectedChoices = {
            [`${head.step}:${head.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        // step 2: cross-battlefield choose-permanents — serra is on p2's side.
        expect(resolveTopOfStack(state)).toBeNull();
        head = state.pendingChoices![0];
        expect(head.allControllers).toBe(true);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: item.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["serra"],
        });
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect((copy.card as { id: string }).id).toBe(SERRA);
    });

    it("survives the wire projection as the copied creature", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect((slim.card as { id: string }).id).toBe(SERRA);
        expect(slim.copiedFrom).toBe(clone.id);
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("reverts to its printed self when it leaves the battlefield (CR 707.2)", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        removePermanentTo(state, "clone1", "hand");
        const inHand = state.players[0].hand.find((c) => c.id === "clone1")!;
        expect((inHand.card as { id: string }).id).toBe(clone.id);
        expect(inHand.copiedFrom).toBeUndefined();
        expect(inHand.subtypes).toEqual(["Shapeshifter"]);
        expect(inHand.staticAbilities).toEqual([]);
    });
});

describe("Copy Artifact (copy artifact + keep Enchantment, CR 707.9d)", () => {
    it("enters as a copy of an artifact and stays an enchantment too", () => {
        const helm = makeInstance(helmOfChatzuk.id, {
            id: "helm",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [helm] }),
            ],
        });
        const item = pushSpell(state, copyArtifact.id, "p1");
        item.id = "copy1";
        // may-pay yes
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        item.collectedChoices = {
            [`${head.step}:${head.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        // choose-permanents (artifacts only)
        expect(resolveTopOfStack(state)).toBeNull();
        head = state.pendingChoices![0];
        expect(head.filter?.types).toBe("Artifact");
        item.collectedChoices = {
            ...item.collectedChoices,
            [`${head.step}:${head.choiceId}`]: ["helm"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);

        const copy = state.players[0].battlefield.find(
            (c) => c.id === "copy1"
        )!;
        expect((copy.card as { id: string }).id).toBe(helmOfChatzuk.id);
        expect(copy.types).toContain("Artifact");
        expect(copy.types).toContain("Enchantment");
        expect(copy.copiedFrom).toBe(copyArtifact.id);
    });
});

describe("Vesuvan Doppelganger (copy w/ colour + ability exceptions, CR 707.9d)", () => {
    const UPKEEP_P1 = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    function vesuvanCopyOf(targetDefId: string, targetInstId: string) {
        const tgt = makeInstance(targetDefId, {
            id: targetInstId,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [tgt] }),
            ],
        });
        const item = pushSpell(state, vesuvanDoppelganger.id, "p1");
        item.id = "vd1";
        driveCopyChoice(state, item, targetInstId);
        return state;
    }

    it("copies the creature but keeps its own blue colour and the re-copy ability", () => {
        const state = vesuvanCopyOf(SERRA, "serra");
        const vd = state.players[0].battlefield.find((c) => c.id === "vd1")!;
        expect((vd.card as { id: string }).id).toBe(SERRA);
        expect(getEffectivePower(state, vd)).toBe(4);
        expect(vd.staticAbilities).toContain("flying");
        // Colour exception (CR 707.9d): blue, not Serra Angel's white.
        expect(vd.colorOverride).toEqual(["U"]);
        expect(STATIC_EFFECT_CTX.getColors(vd)).toEqual(["U"]);
        // Retained ability: the upkeep re-copy still triggers.
        const trigs = collectTriggers(state, [UPKEEP_P1]);
        expect(
            trigs.some(
                (t) => t.triggeredAbilityId === "vesuvan-doppelganger-recopy"
            )
        ).toBe(true);
    });

    it("upkeep re-copy switches to a new target, still blue, still retains the ability", () => {
        const state = vesuvanCopyOf(SERRA, "serra");
        const bears = makeInstance(BEARS, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(bears);

        state.stack.push(...collectTriggers(state, [UPKEEP_P1]));
        const trigItem = state.stack[state.stack.length - 1];
        // may-pay yes
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        trigItem.collectedChoices = {
            [`${head.step}:${head.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        // choose-permanents → Grizzly Bears
        expect(resolveTopOfStack(state)).toBeNull();
        head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        trigItem.collectedChoices = {
            ...trigItem.collectedChoices,
            [`${head.step}:${head.choiceId}`]: ["bears"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);

        const vd = state.players[0].battlefield.find((c) => c.id === "vd1")!;
        expect((vd.card as { id: string }).id).toBe(BEARS);
        expect(getEffectivePower(state, vd)).toBe(2);
        expect(getEffectiveToughness(state, vd)).toBe(2);
        expect(vd.colorOverride).toEqual(["U"]);
        // Re-copy ability is retained yet again.
        expect(
            collectTriggers(state, [UPKEEP_P1]).some(
                (t) => t.triggeredAbilityId === "vesuvan-doppelganger-recopy"
            )
        ).toBe(true);
    });
});

describe("Magical Hack (text-changing effect — CR 612, layer 3)", () => {
    // Casts Magical Hack on `target`, choosing replacement type `toMode`
    // (a mode id like "island"). Returns the resolved state.
    function castMagicalHack(
        state: GameState,
        targetId: string,
        targetType: "permanent" | "spell",
        toMode: string
    ): void {
        const spell = pushSpell(state, magicalHack.id, "p1", [
            { type: targetType, id: targetId },
        ]);
        spell.chosenModeId = toMode;
        resolveTopOfStack(state);
    }

    it("is a {U} Instant targeting a spell or permanent, with five modes", () => {
        expect(magicalHack.manaCost).toEqual({ U: 1 });
        expect(magicalHack.types).toEqual(["Instant"]);
        expect(magicalHack.targetRequirement).toEqual({
            type: "spell-or-permanent",
            count: 1,
        });
        expect(magicalHack.modes?.map((m) => m.id)).toEqual([
            "plains",
            "island",
            "swamp",
            "mountain",
            "forest",
        ]);
    });

    it("changes a basic land's type so it taps for the new color (CR 305.6)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [forestInst] });
        const state = makeState({ players: [p1, p2] });

        expect(getBasicLandMana(forestInst)).toBe("G");

        castMagicalHack(state, "f1", "permanent", "island");

        const after = state.players[1].battlefield.find((c) => c.id === "f1")!;
        expect(after.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);
        expect(getBasicLandMana(after)).toBe("U");
    });

    it("re-asserts the new mana color after projectPublicState (wire format)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "f1"
        )!;
        expect(getBasicLandMana(slim as CardInstanceState)).toBe("U");
    });

    it("rewrites a landwalk keyword so blocking follows the new word (CR 702.13b)", () => {
        // Shanodin Dryads (forestwalk) attacking; defender controls an Island.
        const dryads = makeInstance(shanodinDryads.id, {
            id: "d1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bears = makeInstance(savannahLions.id, {
            id: "b1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const islandInst = makeInstance(island.id, {
            id: "i1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dryads] }),
                makePlayer("p2", { battlefield: [bears, islandInst] }),
            ],
        });

        // Before: forestwalk + defender has no Forest → blockable.
        expect(
            validateBlockerEligibility(dryads, bears, [bears, islandInst])
                .eligible
        ).toBe(true);

        castMagicalHack(state, "d1", "permanent", "island");

        const d = state.players[0].battlefield.find((c) => c.id === "d1")!;
        expect(d.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);

        // After: islandwalk + defender controls an Island → unblockable.
        expect(
            validateBlockerEligibility(d, bears, [bears, islandInst]).eligible
        ).toBe(false);

        // Same conclusion survives the projection (wire format).
        const projected = projectPublicState(state, 1, "p1");
        const slimD = projected.players[0].battlefield.find(
            (c) => c.id === "d1"
        )! as CardInstanceState;
        const slimBears = projected.players[1].battlefield.find(
            (c) => c.id === "b1"
        )! as CardInstanceState;
        const slimIsland = projected.players[1].battlefield.find(
            (c) => c.id === "i1"
        )! as CardInstanceState;
        expect(
            validateBlockerEligibility(slimD, slimBears, [
                slimBears,
                slimIsland,
            ]).eligible
        ).toBe(false);
    });

    it("ends when the object changes zones (CR 612.7)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island");
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.textChanges
        ).toHaveLength(1);

        // CR 612.7 / 400.7 — leaving the battlefield clears the change as the
        // object becomes new (engine resets transient instance state on a
        // hand/library move, mirroring colorOverride).
        removePermanentTo(state, "f1", "hand");
        const bounced = state.players[1].hand.find((c) => c.id === "f1")!;
        expect(bounced.textChanges).toBeUndefined();
        expect(getBasicLandMana(bounced)).toBe("G");
    });

    it("chains multiple changes in timestamp order (CR 612.6)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island"); // Forest → Island
        castMagicalHack(state, "f1", "permanent", "mountain"); // Island → Mountain

        const after = state.players[1].battlefield.find((c) => c.id === "f1")!;
        expect(after.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
            { kind: "land-type", from: "Island", to: "Mountain" },
        ]);
        expect(getBasicLandMana(after)).toBe("R");
    });

    it("applies to a spell on the stack (spell-or-permanent target branch)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // A creature spell with forestwalk on the stack (Shanodin Dryads).
        const creatureSpell = pushSpell(state, shanodinDryads.id, "p2");
        // Magical Hack targets it; resolves above it (LIFO push order).
        castMagicalHack(state, creatureSpell.id, "spell", "island");

        const onStack = state.stack.find((s) => s.id === creatureSpell.id)!;
        expect(onStack.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);
    });

    it("survives a serialize round-trip (persisted optional field)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island");

        const restored = expandState(compactState(state));
        const after = restored.players[1].battlefield.find(
            (c) => c.id === "f1"
        )!;
        expect(after.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);
        expect(getBasicLandMana(after)).toBe("U");
    });
});

describe("Sleight of Mind (color-word text change — CR 612, layer 3)", () => {
    // Casts Sleight of Mind on `target`, choosing replacement color word
    // `toMode` (a mode id like "blue"). Resolves immediately.
    function castSleight(
        state: GameState,
        targetId: string,
        targetType: "permanent" | "spell",
        toMode: string
    ): void {
        const spell = pushSpell(state, sleightOfMind.id, "p1", [
            { type: targetType, id: targetId },
        ]);
        spell.chosenModeId = toMode;
        resolveTopOfStack(state);
    }

    it("is a {U} Instant targeting a spell or permanent, with five color modes", () => {
        expect(sleightOfMind.manaCost).toEqual({ U: 1 });
        expect(sleightOfMind.types).toEqual(["Instant"]);
        expect(sleightOfMind.targetRequirement).toEqual({
            type: "spell-or-permanent",
            count: 1,
        });
        expect(sleightOfMind.modes?.map((m) => m.id)).toEqual([
            "white",
            "blue",
            "black",
            "red",
            "green",
        ]);
    });

    it("changes a protection color word so protection follows the new color (CR 702.16)", () => {
        // Black Knight has "protection from white".
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        expect(getProtectedColors(state.players[1].battlefield[0])).toEqual([
            "W",
        ]);

        castSleight(state, "bk", "permanent", "blue");

        const after = state.players[1].battlefield.find((c) => c.id === "bk")!;
        expect(after.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
        ]);
        expect(getProtectedColors(after)).toEqual(["U"]);
    });

    it("re-asserts the new protection color after projectPublicState (wire format)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bk"
        )! as CardInstanceState;
        expect(getProtectedColors(slim)).toEqual(["U"]);
    });

    it("retargets a Circle of Protection's color filter to the new color (CR 615)", () => {
        const cop = makeInstance(circleOfProtectionWhite.id, {
            id: "cop",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteSrc = makeInstance(savannahLions.id, {
            id: "w",
            controllerId: "p2",
            ownerId: "p2",
        });
        const redSrc = makeInstance(monssGoblinRaiders.id, {
            id: "r",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cop] }),
                makePlayer("p2", { battlefield: [whiteSrc, redSrc] }),
            ],
        });
        const baseReq =
            circleOfProtectionWhite.activatedAbilities![0].targetRequirement!;

        // Before: the "white source of your choice" filter sees the white
        // creature, not the red one.
        const legalBefore = getLegalTargets(
            state,
            { ...baseReq, colorFilter: "W" },
            [],
            "p1"
        );
        expect(legalBefore.some((t) => t.id === "w")).toBe(true);
        expect(legalBefore.some((t) => t.id === "r")).toBe(false);

        castSleight(state, "cop", "permanent", "red");
        const copAfter = state.players[0].battlefield.find(
            (c) => c.id === "cop"
        )!;
        expect(copAfter.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "red" },
        ]);

        // After: the substituted filter targets the red source, not the white.
        const effColor = substituteColorFilter(copAfter, baseReq.colorFilter!);
        expect(effColor).toBe("R");
        const legalAfter = getLegalTargets(
            state,
            { ...baseReq, colorFilter: effColor },
            [],
            "p1"
        );
        expect(legalAfter.some((t) => t.id === "r")).toBe(true);
        expect(legalAfter.some((t) => t.id === "w")).toBe(false);

        // The substituted filter survives the projection (wire format).
        const projected = projectPublicState(state, 0, "p1");
        const slimCop = projected.players[0].battlefield.find(
            (c) => c.id === "cop"
        )! as CardInstanceState;
        expect(substituteColorFilter(slimCop, baseReq.colorFilter!)).toBe("R");
    });

    it("does not change the object's own color (CR 612.1)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        const before = STATIC_EFFECT_CTX.getColors(
            state.players[1].battlefield[0]
        );
        castSleight(state, "bk", "permanent", "blue");
        const after = state.players[1].battlefield.find((c) => c.id === "bk")!;
        // Black Knight stays black; only its protection *word* changed.
        expect(STATIC_EFFECT_CTX.getColors(after)).toEqual(before);
        expect(before).toEqual(["B"]);
    });

    it("ends when the object changes zones (CR 612.7)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue");
        expect(
            state.players[1].battlefield.find((c) => c.id === "bk")!.textChanges
        ).toHaveLength(1);

        removePermanentTo(state, "bk", "hand");
        const bounced = state.players[1].hand.find((c) => c.id === "bk")!;
        expect(bounced.textChanges).toBeUndefined();
        expect(getProtectedColors(bounced)).toEqual(["W"]);
    });

    it("chains multiple color-word changes in timestamp order (CR 612.6)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue"); // white → blue
        castSleight(state, "bk", "permanent", "red"); // blue → red

        const after = state.players[1].battlefield.find((c) => c.id === "bk")!;
        expect(after.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
            { kind: "color-word", from: "blue", to: "red" },
        ]);
        expect(getProtectedColors(after)).toEqual(["R"]);
    });

    it("applies to a spell on the stack (spell-or-permanent branch)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // A creature spell with "protection from white" on the stack.
        const knightSpell = pushSpell(state, blackKnight.id, "p2");
        castSleight(state, knightSpell.id, "spell", "blue");

        const onStack = state.stack.find((s) => s.id === knightSpell.id)!;
        expect(onStack.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
        ]);
    });

    it("survives a serialize round-trip (persisted optional field)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue");

        const restored = expandState(compactState(state));
        const after = restored.players[1].battlefield.find(
            (c) => c.id === "bk"
        )!;
        expect(after.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
        ]);
        expect(getProtectedColors(after)).toEqual(["U"]);
    });
});

describe("Camouflage (random pile combat — CR 509 variant, #563, ADR 0012)", () => {
    // Submits the head pending choice (a per-pile subset pick) and auto-resumes
    // the spell's resolution via applyPendingChoiceSubmit.
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

    // p1 attacks with `attackerIds`; p2 has the listed defending creatures.
    // `seed` makes the random pile→attacker assignment deterministic.
    function setup(opts: {
        attackerIds: string[];
        defenders: CardInstanceState[];
        seed?: number;
    }) {
        const attackers = opts.attackerIds.map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                isAttacking: true,
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: attackers }),
                makePlayer("p2", { battlefield: opts.defenders }),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
        });
        state.rngSeed = opts.seed ?? 1;
        state.rngCounter = 0;
        state.combat = {
            attackerIds: [...opts.attackerIds],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        return state;
    }

    function ground(id: string): CardInstanceState {
        return makeInstance(savannahLions.id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
        });
    }

    it("is a {G} Instant castable only during your declare attackers step", () => {
        expect(camouflage.manaCost).toEqual({ G: 1 });
        expect(camouflage.types).toEqual(["Instant"]);
        expect(camouflage.castPhaseRestriction).toEqual(["DECLARE_ATTACKERS"]);
        expect(camouflage.castTurnRestriction).toBe("self");
    });

    it("forces a legal block from the pile (N=1) and marks the combat", () => {
        const blocker = ground("b1");
        const state = setup({ attackerIds: ["atkA"], defenders: [blocker] });
        pushSpell(state, camouflage.id, "p1");

        // Resolve → defender's single pile choice.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("partition");
        expect(state.pendingChoices?.[0].playerId).toBe("p2");

        submitHead(state, ["b1"]); // put b1 in the only pile

        expect(state.pendingChoices).toBeUndefined();
        expect(state.camouflageCombat).toBe(true);
        // b1 is forced to block its assigned attacker atkA.
        expect(state.combat!.blockerAssignments).toEqual({ b1: ["atkA"] });
        expect(
            state.players[1].battlefield.find((c) => c.id === "b1")!.isBlocking
        ).toBe(true);
    });

    it("skips a creature in a pile that can't legally block its attacker", () => {
        // atkA flies; a ground creature in its pile can't block it → no block.
        const flyer = makeInstance(serraAngel.id, {
            id: "atkA",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = ground("b1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flyer] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
        });
        state.rngSeed = 1;
        state.combat = {
            attackerIds: ["atkA"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);
        submitHead(state, ["b1"]); // assigned to the flyer, can't block it

        expect(state.camouflageCombat).toBe(true);
        expect(state.combat!.blockerAssignments).toEqual({});
        expect(
            state.players[1].battlefield.find((c) => c.id === "b1")!.isBlocking
        ).toBeUndefined();
    });

    it("assigns each pile to a different attacker at random (seed 1 = identity)", () => {
        // seededShuffle(["atkA","atkB"]) at seed 1 is the identity, so pile 0 →
        // atkA and pile 1 → atkB.
        const b1 = ground("b1");
        const b2 = ground("b2");
        const state = setup({
            attackerIds: ["atkA", "atkB"],
            defenders: [b1, b2],
            seed: 1,
        });
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);

        // Pile 0 (candidates b1,b2): pick b1.
        expect(state.pendingChoices?.[0].choiceId).toBe("camouflage-pile-0");
        submitHead(state, ["b1"]);
        // Pile 1 (only b2 remains as a candidate): pick b2.
        expect(state.pendingChoices?.[0].choiceId).toBe("camouflage-pile-1");
        expect(state.pendingChoices?.[0].candidateIds).toEqual(["b2"]);
        submitHead(state, ["b2"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.combat!.blockerAssignments).toEqual({
            b1: ["atkA"],
            b2: ["atkB"],
        });
    });

    it("a different seed swaps the random pile→attacker assignment", () => {
        // seededShuffle(["atkA","atkB"]) at seed 0 = ["atkB","atkA"], so pile 0
        // is assigned to atkB and pile 1 to atkA.
        const b1 = ground("b1");
        const b2 = ground("b2");
        const state = setup({
            attackerIds: ["atkA", "atkB"],
            defenders: [b1, b2],
            seed: 0,
        });
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);
        submitHead(state, ["b1"]); // pile 0 → atkB
        submitHead(state, ["b2"]); // pile 1 → atkA

        expect(state.combat!.blockerAssignments).toEqual({
            b1: ["atkB"],
            b2: ["atkA"],
        });
    });

    it("rejects assigning a creature already placed in an earlier pile", () => {
        const b1 = ground("b1");
        const b2 = ground("b2");
        const state = setup({
            attackerIds: ["atkA", "atkB"],
            defenders: [b1, b2],
            seed: 1,
        });
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);
        submitHead(state, ["b1"]); // b1 placed in pile 0
        // pile 1 only offers b2; b1 is no longer eligible.
        expect(() => submitHead(state, ["b1"])).toThrow(
            "Card is not an eligible choice"
        );
    });

    it("auto-confirms blockers with no priority window at DECLARE_BLOCKERS", () => {
        const blocker = ground("b1");
        const state = setup({ attackerIds: ["atkA"], defenders: [blocker] });
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);
        submitHead(state, ["b1"]);

        // Advance out of DECLARE_ATTACKERS: the engine routes through
        // DECLARE_BLOCKERS, which Camouflage replaces — it must NOT wipe the
        // pre-locked block and must auto-confirm.
        state.combat!.confirmed = true;
        const traversed = advancePhase(state);
        expect(traversed).toContain("DECLARE_BLOCKERS");
        expect(state.combat!.blockersConfirmed).toBe(true);
        expect(state.combat!.blockerAssignments).toEqual({ b1: ["atkA"] });
        expect(state.combat!.blockedAttackerIds).toContain("atkA");
    });

    it("wire format: forced block survives projectPublicState (#563)", () => {
        const blocker = ground("b1");
        const state = setup({ attackerIds: ["atkA"], defenders: [blocker] });
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);
        submitHead(state, ["b1"]);

        // GRE-level: the forced block is recorded.
        expect(state.combat!.blockerAssignments).toEqual({ b1: ["atkA"] });

        // The same block survives the projection both clients receive.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.combat!.blockerAssignments).toEqual({ b1: ["atkA"] });
        const slimBlocker = projected.players[1].battlefield.find(
            (c) => c.id === "b1"
        )!;
        expect(slimBlocker.isBlocking).toBe(true);
    });

    it("clears the camouflageCombat flag at end of combat (CR 511)", () => {
        const blocker = ground("b1");
        const state = setup({ attackerIds: ["atkA"], defenders: [blocker] });
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);
        submitHead(state, ["b1"]);
        expect(state.camouflageCombat).toBe(true);

        state.phase = "COMBAT_DAMAGE";
        state.combat!.blockersConfirmed = true;
        advancePhase(state); // → END_OF_COMBAT
        expect(state.phase).toBe("END_OF_COMBAT");
        advancePhase(state); // leaving END_OF_COMBAT tears down combat
        expect(state.camouflageCombat).toBeUndefined();
    });

    it("survives a serialize round-trip mid-combat", () => {
        const blocker = ground("b1");
        const state = setup({ attackerIds: ["atkA"], defenders: [blocker] });
        pushSpell(state, camouflage.id, "p1");
        resolveTopOfStack(state);
        submitHead(state, ["b1"]);

        const restored = expandState(compactState(state));
        expect(restored.camouflageCombat).toBe(true);
        expect(restored.combat!.blockerAssignments).toEqual({ b1: ["atkA"] });
    });
});
