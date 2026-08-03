// Per-card behavior tests for blue cards in `convex/cards/sets/drk/blue.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    amnesia,
    apprenticeWizard,
    danceOfMany,
    deepWater,
    drowned,
    electricEel,
    erosion,
    fellwarStone,
    flood,
    ghostShip,
    giantShark,
    manaVortex,
    merfolkAssassin,
    mindBomb,
    psychicAllergy,
    riptide,
    sunkenCity,
    waterWurm,
} from "..";
import {
    FOREST,
    UPKEEP,
    answerChoice,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { applyLandManaReplacement } from "../../../../gre/constants";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { finalizeCleanup } from "../../../../gre/phases";
import {
    getLegalTargets,
    raiseTriggerTargetSelection,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getDefinition, getCardByName } from "../../../index";

// ═══════════════════════════════════════════════════════════════════════════
// BLUE free tranche (#412)
// ═══════════════════════════════════════════════════════════════════════════

describe("Amnesia — reveal hand, discard all nonland cards (CR 701.8)", () => {
    it("discards nonland cards and keeps lands", () => {
        const islandId = getCardByName("Island").id;
        const bolt = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "spell",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const land = makeInstance(islandId, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [bolt, land] }),
            ],
        });
        pushSpell(state, amnesia.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // Nonland discarded, land kept.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land"]);
        expect(state.players[1].graveyard.some((c) => c.id === "spell")).toBe(
            true
        );
    });
});

describe("Apprentice Wizard — {U},{T}: add {C}{C}{C} (CR 605.1a mana ability)", () => {
    it("declares a non-stack mana ability producing three colorless", () => {
        const ab = apprenticeWizard.activatedAbilities![0];
        expect(ab.useStack).toBe(false);
        expect(ab.cost).toEqual({ tap: true, mana: { U: 1 } });
        expect(ab.manaProduced).toEqual({ C: 3 });
        expect(apprenticeWizard.power).toBe(0);
        expect(apprenticeWizard.toughness).toBe(1);
    });
});

describe("Erosion — upkeep destroy enchanted land unless pay {1} or 1 life (CR 603.6a / 117.3a)", () => {
    function setup() {
        const land = makeInstance(getCardByName("Island").id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(erosion.id, {
            id: "erosion",
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
        return { state, aura };
    }

    it("fires at the enchanted land's controller upkeep (host-controller scope)", () => {
        const { state } = setup();
        const fires = (p: string) =>
            collectTriggers(state, [UPKEEP(p) as never]).some(
                (t) => t.triggeredAbilityId === "erosion-upkeep-tax"
            );
        expect(fires("p2")).toBe(true); // land controller's upkeep
        expect(fires("p1")).toBe(false); // not the aura controller's
    });

    it("declining both payments destroys the enchanted land", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "erosion-upkeep-tax", UPKEEP("p2"));
        // Decline {1}, then decline 1 life → land destroyed.
        answerChoice(state, ["decline"]);
        answerChoice(state, ["decline"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
    });

    it("paying 1 life keeps the land (CR 118.4)", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "erosion-upkeep-tax", UPKEEP("p2"));
        answerChoice(state, ["decline"]); // decline {1}
        answerChoice(state, ["yes"]); // pay 1 life
        expect(state.players[1].battlefield.some((c) => c.id === "land")).toBe(
            true
        );
        expect(state.players[1].life).toBe(19);
    });
});

describe("Flood — {U}{U}: tap target creature without flying (CR 701.20a / 702.9)", () => {
    it("only non-flyers are legal targets (excludeAbility)", () => {
        const ground = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flyer = makeInstance(getCardByName("Serra Angel").id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flyer] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            flood.activatedAbilities![0].targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("ground");
        expect(legal).not.toContain("flyer");
    });

    it("taps the targeted non-flyer", () => {
        const fl = makeInstance(flood.id, { id: "flood", controllerId: "p1" });
        const ground = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fl] }),
                makePlayer("p2", { battlefield: [ground] }),
            ],
        });
        resolveActivated(state, fl, "flood-tap", [
            { type: "permanent", id: "ground" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
                ?.isTapped
        ).toBe(true);
    });
});

describe("Ghost Ship — flying + regenerate (CR 702.9 / 701.15a)", () => {
    it("carries flying and a regenerate activated ability", () => {
        expect(ghostShip.staticAbilities).toContain("flying");
        expect(ghostShip.power).toBe(2);
        expect(ghostShip.toughness).toBe(4);
        const ab = ghostShip.activatedAbilities![0];
        expect(ab.cost).toEqual({ mana: { U: 3 } });
    });

    it("the regenerate ability stacks a shield consumed by the next destroy", () => {
        const gs = makeInstance(ghostShip.id, {
            id: "gs",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gs] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gs, "ghost-ship-regenerate", []);
        const inPlay = state.players[0].battlefield.find((c) => c.id === "gs")!;
        expect(inPlay.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Giant Shark — attack restriction, combat pump, sacrifice-on-no-Islands", () => {
    it("can't attack unless the defending player controls an Island (CR 508.1c)", () => {
        const restriction = giantShark.staticEffects!.find(
            (e) => e.kind === "attack-restriction"
        );
        if (restriction?.kind !== "attack-restriction") {
            throw new Error("missing attack-restriction");
        }
        const withIsland = [{ subtypes: ["Island"] }] as never;
        const noIsland = [{ subtypes: ["Forest"] }] as never;
        expect(restriction.predicate({} as never, withIsland)).toBe(true);
        expect(restriction.predicate({} as never, noIsland)).toBe(false);
    });

    it("pumps +2/+0 only when the paired creature has marked damage (CR 120.3)", () => {
        const shark = makeInstance(giantShark.id, {
            id: "shark",
            controllerId: "p1",
        });
        const blocker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            damageMarked: 1, // already dealt damage this turn
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shark] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        const basePower = getEffectivePower(state, shark);
        const event = {
            type: "BLOCKERS_CONFIRMED" as const,
            attackerId: "shark",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Shark"],
            blockerId: "blocker",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: ["Bear"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, shark, "giant-shark-combat-pump", event);
        const pumped = state.players[0].battlefield.find(
            (c) => c.id === "shark"
        )!;
        expect(getEffectivePower(state, pumped)).toBe(basePower + 2);
        expect(pumped.staticAbilities).toContain("trample");
    });

    it("does NOT pump when the paired creature has no marked damage", () => {
        const shark = makeInstance(giantShark.id, {
            id: "shark",
            controllerId: "p1",
        });
        const blocker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shark] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        const basePower = getEffectivePower(state, shark);
        const event = {
            type: "BLOCKERS_CONFIRMED" as const,
            attackerId: "shark",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Shark"],
            blockerId: "blocker",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: ["Bear"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, shark, "giant-shark-combat-pump", event);
        expect(getEffectivePower(state, shark)).toBe(basePower);
    });

    it("sacrifices itself when its controller controls no Islands (CR 603.8)", () => {
        const shark = makeInstance(giantShark.id, {
            id: "shark",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shark] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, shark, "giant-shark-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "shark")
        ).toBeUndefined();
    });
});

describe("Mana Vortex — cast-counter, each-upkeep land sac, no-lands self-sac", () => {
    it("counters itself on cast if the controller can't sacrifice a land", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Mana Vortex spell on the stack, plus its cast trigger above it.
        const spell = pushSpell(state, manaVortex.id, "p1");
        const source = makeInstance(manaVortex.id, {
            id: spell.id,
            controllerId: "p1",
        });
        resolveTrigger(state, source, "mana-vortex-cast-counter", {
            type: "SPELL_CAST",
            spellInstanceId: spell.id,
            casterId: "p1",
        } as StackItem["triggerEvent"]);
        // No land to sacrifice → the spell is countered (no permanent enters).
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    it("each player sacrifices a land at their upkeep (CR 603.6a)", () => {
        const vortex = makeInstance(manaVortex.id, {
            id: "vortex",
            controllerId: "p1",
        });
        const land = makeInstance(getCardByName("Island").id, {
            id: "p2-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vortex] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveTrigger(state, vortex, "mana-vortex-upkeep-sac", UPKEEP("p2"));
        answerChoice(state, ["p2-land"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-land")
        ).toBeUndefined();
    });

    it("sacrifices itself when no lands remain (CR 603.8)", () => {
        const vortex = makeInstance(manaVortex.id, {
            id: "vortex",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vortex] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, vortex, "mana-vortex-no-lands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vortex")
        ).toBeUndefined();
    });
});

describe("Merfolk Assassin — destroy target creature with islandwalk (CR 605 / 701.7)", () => {
    it("only islandwalkers are legal targets", () => {
        const walker = makeInstance(getCardByName("Segovian Leviathan").id, {
            id: "walker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const plain = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "plain",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [walker, plain] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            merfolkAssassin.activatedAbilities![0].targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("walker");
        expect(legal).not.toContain("plain");
    });

    it("destroys the targeted islandwalker", () => {
        const ma = makeInstance(merfolkAssassin.id, {
            id: "ma",
            controllerId: "p1",
        });
        const walker = makeInstance(getCardByName("Segovian Leviathan").id, {
            id: "walker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ma] }),
                makePlayer("p2", { battlefield: [walker] }),
            ],
        });
        resolveActivated(state, ma, "merfolk-assassin-destroy", [
            { type: "permanent", id: "walker" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "walker")
        ).toBeUndefined();
    });
});

describe("Mind Bomb — each player may discard up to 3, damage = 3 − discarded (CR 701.8 / 119)", () => {
    it("a player who discards nothing takes 3 damage", () => {
        // Empty hands → no discard prompt → each player takes the full 3.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, mindBomb.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
        expect(state.players[1].life).toBe(17);
    });

    it("discarding reduces the damage (3 − discarded)", () => {
        const c1 = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "c1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const c2 = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "c2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [c1, c2] }), makePlayer("p2")],
        });
        pushSpell(state, mindBomb.id, "p1");
        resolveTopOfStack(state); // suspends at p1's discard choice
        answerChoice(state, ["c1", "c2"]); // p1 discards 2 → takes 1
        expect(state.players[0].life).toBe(19); // 20 - (3 - 2)
        expect(state.players[1].life).toBe(17); // p2 discarded 0 → takes 3
    });
});

describe("Psychic Allergy — choose color, damage per nontoken permanent, upkeep sac-2-Islands", () => {
    it("deals damage equal to the chosen color's nontoken permanents at each opponent's upkeep", () => {
        const allergy = makeInstance(psychicAllergy.id, {
            id: "allergy",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: "U", // chose blue
        });
        const blueA = makeInstance(getCardByName("Air Elemental").id, {
            id: "blueA",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blueB = makeInstance(getCardByName("Air Elemental").id, {
            id: "blueB",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [allergy] }),
                makePlayer("p2", { battlefield: [blueA, blueB] }),
            ],
        });
        resolveTrigger(
            state,
            allergy,
            "psychic-allergy-opponent-upkeep",
            UPKEEP("p2")
        );
        // 2 blue nontoken permanents → 2 damage to p2.
        expect(state.players[1].life).toBe(18);
    });

    it("destroys itself at the controller's upkeep when no Islands to sacrifice (CR 117.3a)", () => {
        const allergy = makeInstance(psychicAllergy.id, {
            id: "allergy",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: "U",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [allergy] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            allergy,
            "psychic-allergy-own-upkeep",
            UPKEEP("p1")
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "allergy")
        ).toBeUndefined();
    });
});

describe("Riptide — tap all blue creatures (CR 701.20a / 202.2)", () => {
    it("taps blue creatures of either controller, spares nonblue", () => {
        const blue1 = makeInstance(getCardByName("Air Elemental").id, {
            id: "blue1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blue2 = makeInstance(getCardByName("Air Elemental").id, {
            id: "blue2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const white = makeInstance(getCardByName("Savannah Lions").id, {
            id: "white",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blue1] }),
                makePlayer("p2", { battlefield: [blue2, white] }),
            ],
        });
        pushSpell(state, riptide.id, "p1");
        resolveTopOfStack(state);
        const tapped = (id: string) =>
            [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].find((c) => c.id === id)?.isTapped === true;
        expect(tapped("blue1")).toBe(true);
        expect(tapped("blue2")).toBe(true);
        expect(tapped("white")).toBe(false);
    });
});

describe("Sunken City — blue anthem + upkeep maintenance (CR 611 / 603.6a)", () => {
    function setup() {
        const city = makeInstance(sunkenCity.id, {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blue = makeInstance(getCardByName("Air Elemental").id, {
            id: "blue",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [city, blue] }),
                makePlayer("p2"),
            ],
        });
        return { state, city, blue };
    }

    it("blue creatures get +1/+1 (anthem) and survives the wire projection", () => {
        const { state, blue } = setup();
        // Air Elemental base 4/4 → 5/5 with the anthem.
        expect(getEffectivePower(state, blue)).toBe(5);
        expect(getEffectiveToughness(state, blue)).toBe(5);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "blue"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });

    it("sacrifices itself at upkeep when {U}{U} is declined (CR 117.3a)", () => {
        const { state, city } = setup();
        resolveTrigger(state, city, "sunken-city-upkeep", UPKEEP("p1"));
        answerChoice(state, ["decline"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "city")
        ).toBeUndefined();
    });

    it("paying {U}{U} keeps it (backend may-pay path)", () => {
        const { state, city } = setup();
        state.players[0].manaPool = { U: 2 };
        state.stack.push(
            ...collectTriggers(state, [UPKEEP("p1") as never]).filter(
                (t) => t.triggeredAbilityId === "sunken-city-upkeep"
            )
        );
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "city")).toBe(
            true
        );
        void city;
    });
});

describe("Water Wurm — +0/+1 while an opponent controls an Island (CR 613.4 layer 7a CDA)", () => {
    function setup(opponentHasIsland: boolean) {
        const wurm = makeInstance(waterWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p2bf = opponentHasIsland
            ? [
                  makeInstance(getCardByName("Island").id, {
                      id: "isl",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wurm] }),
                makePlayer("p2", { battlefield: p2bf }),
            ],
        });
        return { state, wurm };
    }

    it("is 1/1 with no opposing Island, 1/2 when an opponent controls one", () => {
        const off = setup(false);
        expect(getEffectivePower(off.state, off.wurm)).toBe(1);
        expect(getEffectiveToughness(off.state, off.wurm)).toBe(1);
        const on = setup(true);
        expect(getEffectivePower(on.state, on.wurm)).toBe(1);
        expect(getEffectiveToughness(on.state, on.wurm)).toBe(2);
    });

    it("the conditional CDA survives the wire projection (mandatory)", () => {
        const { state } = setup(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wurm"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Deep Water (CR 614 — lands produce {U} instead of their type)", () => {
    it("arms the per-turn replacement for the activating controller", () => {
        const dw = makeInstance(deepWater.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [dw];
        resolveActivated(state, dw, "deep-water-replace");
        expect(state.landManaReplacedToBlueThisTurn).toContain("p1");
    });

    it("rewrites a tapped land's output to {U} of the same quantity", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const forest = makeInstance(FOREST, { controllerId: "p1" });
        // A Forest taps for {G}; Deep Water rewrites it to {U}.
        const out = applyLandManaReplacement(state, "p1", forest, { G: 1 });
        expect(out).toEqual({ U: 1 });
    });

    it("preserves quantity for a multi-mana land (2 → {U}{U})", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const land = makeInstance(FOREST, { controllerId: "p1" });
        // Hypothetical {G}{G} land output — only the TYPE changes (CR 614).
        expect(applyLandManaReplacement(state, "p1", land, { G: 2 })).toEqual({
            U: 2,
        });
    });

    it("does not affect non-land mana sources (Fellwar Stone stays its colour)", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        expect(applyLandManaReplacement(state, "p1", rock, { R: 1 })).toEqual({
            R: 1,
        });
    });

    it("does not affect a player who hasn't activated Deep Water", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const forest = makeInstance(FOREST, { controllerId: "p2" });
        expect(applyLandManaReplacement(state, "p2", forest, { G: 1 })).toEqual(
            {
                G: 1,
            }
        );
    });

    it("expires at CLEANUP (until end of turn, CR 514.2)", () => {
        const state = makeState({ phase: "CLEANUP" });
        state.landManaReplacedToBlueThisTurn = ["p1"];
        finalizeCleanup(state);
        expect(state.landManaReplacedToBlueThisTurn).toBeUndefined();
    });

    it("survives projection — a {U} pool produced under Deep Water is visible", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const forest = makeInstance(FOREST, { controllerId: "p1" });
        const out = applyLandManaReplacement(state, "p1", forest, { G: 1 });
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        for (const [c, n] of Object.entries(out)) {
            state.players[0].manaPool[c as "U"] += n as number;
        }
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.U).toBe(1);
        expect(projected.players[0].manaPool.G).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Dance of Many (C4 — Copy-as-token, #421)
//   CR 707.2 token copy + CR 603.10 leave-linkage (both directions) + CR 603.6a
//   upkeep "sacrifice unless you pay {U}{U}" (reuses the LEG C7 trigger).
// ---------------------------------------------------------------------------

/** Build the firing PERMANENT_ENTERED event for `source` (Dance's ETB). */
const ENTERED = (source: CardInstanceState): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_ENTERED" as const,
        instanceId: source.id,
        controllerId: source.controllerId,
        types: source.types,
    }) as StackItem["triggerEvent"];

/** Place Dance of Many on p1's battlefield with a nontoken creature to copy. */
function danceSetup(copyTargetId: string) {
    const target = makeInstance(copyTargetId, {
        id: "orig",
        controllerId: "p1",
        ownerId: "p1",
    });
    const dance = makeInstance(danceOfMany.id, {
        id: "dance",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [dance, target] }),
            makePlayer("p2"),
        ],
    });
    return { state, dance, target };
}

/** Push Dance's ETB trigger onto the stack WITHOUT resolving, so the CR 603.3d
 *  copy target can be locked through the real machinery
 *  (`raiseTriggerTargetSelection` → `finalizeTargetSelection`). Mirrors the
 *  `resolveTrigger` helper's push but stops short of `resolveTopOfStack`, and
 *  leaves `targets` unset (the target slot the target pass fills). Keeps
 *  `triggerSourceId` so scope/source resolution works. Returns the on-stack
 *  trigger item. */
function pushDanceEtb(state: GameState, dance: CardInstanceState): StackItem {
    state.stack.push({
        ...dance,
        zone: "stack",
        castById: dance.controllerId,
        triggeredAbilityId: "dance-of-many-etb",
        triggerSourceId: dance.id,
        triggerEvent: ENTERED(dance),
    });
    return state.stack[state.stack.length - 1];
}

/** Drives Dance's ETB target choice through the real CR 603.3d machinery, then
 *  resolves. When `pickId` is the sole legal creature the target auto-locks
 *  (`raiseTriggerTargetSelection` returns false); with 2+ candidates a real
 *  choice is owed, driven via `pendingTarget.selected` + `finalizeTargetSelection`.
 *  Returns the freshly created copy-token instance. */
function fireEtbAndCopy(
    state: GameState,
    dance: CardInstanceState,
    pickId: string
): CardInstanceState {
    pushDanceEtb(state, dance);
    if (raiseTriggerTargetSelection(state)) {
        state.pendingTarget!.selected = [{ type: "permanent", id: pickId }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
    }
    resolveTopOfStack(state);
    const token = state.players[0].battlefield.find((c) => c.isToken);
    if (!token) throw new Error("no copy-token created");
    return token;
}

describe("Dance of Many — definition (modern Scryfall oracle, ADR 0004)", () => {
    it("is a {U}{U} Enchantment with the real Scryfall id", () => {
        expect(danceOfMany.id).toBe("13453abe-3f05-4956-8493-382d7d2af699");
        expect(danceOfMany.manaCost).toEqual({ U: 2 });
        expect(danceOfMany.types).toEqual(["Enchantment"]);
    });

    it("carries all four triggered abilities (ETB / two LTBs / upkeep)", () => {
        const ids = danceOfMany.triggeredAbilities?.map((a) => a.id) ?? [];
        expect(ids).toEqual([
            "dance-of-many-etb",
            "dance-of-many-exile-token",
            "dance-of-many-sacrifice-self",
            "dance-of-many-upkeep",
        ]);
    });

    it("declares the CR 603.3d target requirement on its ETB: one NONTOKEN creature (issue #1195)", () => {
        const etb = danceOfMany.triggeredAbilities?.find(
            (a) => a.id === "dance-of-many-etb"
        );
        // "create a token that's a copy of target nontoken creature" — the
        // target is chosen at stack placement (CR 603.3d), not resolution.
        // `isToken: false` (issue #1195) is the "nontoken" clause — FIXED, no
        // longer a documented divergence.
        expect(etb?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            isToken: false,
        });
    });

    it("is registered by id and name", () => {
        expect(getDefinition(danceOfMany.id)).toBe(danceOfMany);
        expect(getCardByName("Dance of Many")).toBe(danceOfMany);
    });

    it("excludes a TOKEN creature from the legal copy targets (CR 111.5, issue #1195 — previously an incorrectly-legal target)", () => {
        const dance = makeInstance(danceOfMany.id, {
            id: "dance-nontoken-check",
            controllerId: "p1",
            ownerId: "p1",
        });
        const tokenCreature = makeInstance(getCardByName("Serra Angel").id, {
            id: "a-token",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const nontoken = makeInstance(getCardByName("Serra Angel").id, {
            id: "a-nontoken",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dance, tokenCreature, nontoken],
                }),
                makePlayer("p2"),
            ],
        });
        const etb = danceOfMany.triggeredAbilities!.find(
            (a) => a.id === "dance-of-many-etb"
        )!;
        const legal = getLegalTargets(
            state,
            etb.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).not.toContain("a-token");
        expect(legal).toContain("a-nontoken");
    });
});

describe("Dance of Many — ETB token copy (CR 707.2)", () => {
    it("creates a token that is a copy of the target creature's copiable values", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // CR 707.2 — copiable values: types, P/T, abilities from the printed def.
        expect(token.isToken).toBe(true);
        expect(token.power).toBe(4);
        expect(token.toughness).toBe(4);
        expect(token.staticAbilities).toContain("flying");
        expect(token.staticAbilities).toContain("vigilance");
        // Effective P/T (through the layer pipeline) matches the copied creature.
        expect(getEffectivePower(state, token)).toBe(4);
        expect(getEffectiveToughness(state, token)).toBe(4);
        // Provenance + reverse linkage are wired (CR 603.10 anchor).
        expect(token.createdBy).toBe("dance");
        expect(dance.linkedTokenId).toBe(token.id);
    });

    it("copies a vanilla creature's P/T (Grizzly Bears 2/2)", () => {
        const { state, dance } = danceSetup(getCardByName("Grizzly Bears").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        expect(getEffectivePower(state, token)).toBe(2);
        expect(getEffectiveToughness(state, token)).toBe(2);
    });

    it("auto-locks the sole legal creature — no choice raised (CR 603.3d)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const trig = pushDanceEtb(state, dance);
        // Only one creature on the battlefield: a mandatory single target with
        // exactly one candidate auto-selects; no PendingTarget is raised.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "orig" }]);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("raises a target choice when 2+ creatures are legal (CR 603.3d)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        // A second creature makes the copy target a real choice.
        const second = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(second);
        const trig = pushDanceEtb(state, dance);
        // Two legal candidates → a real choice is owed.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.kind).toBe("trigger");
        // The controller picks the opponent's creature; finalize locks it onto
        // the on-stack trigger, then it resolves into a copy token.
        state.pendingTarget!.selected = [{ type: "permanent", id: "bears" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        expect(trig.targets).toEqual([{ type: "permanent", id: "bears" }]);
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken);
        expect(token).toBeDefined();
        // Copied Grizzly Bears' copiable P/T (CR 707.2).
        expect(getEffectivePower(state, token!)).toBe(2);
        expect(getEffectiveToughness(state, token!)).toBe(2);
    });
});

describe("Dance of Many — leave-linkage (CR 603.10)", () => {
    it("exiles the token when the enchantment leaves the battlefield", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // Dance leaves play (e.g. destroyed).
        removePermanentTo(state, dance.id, "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // Dance's exile-token LTB
        // The token is exiled — it ceases to exist (CR 111.7 SBA), so it is on
        // no battlefield and in no public zone.
        const onBattlefield = state.players.some((p) =>
            p.battlefield.some((c) => c.id === token.id)
        );
        expect(onBattlefield).toBe(false);
    });

    it("sacrifices the enchantment when the token leaves the battlefield", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // The token leaves play (e.g. dies in combat).
        removePermanentTo(state, token.id, "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // Dance's sacrifice-self LTB
        const danceStillThere = state.players[0].battlefield.some(
            (c) => c.id === "dance"
        );
        expect(danceStillThere).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "dance")).toBe(
            true
        );
    });

    it("the token-leaves trigger fires ONLY for this enchantment's own token", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        fireEtbAndCopy(state, dance, "orig");
        // An unrelated creature leaving must NOT fire the sacrifice-self trigger.
        const other = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(other);
        removePermanentTo(state, other.id, "graveyard");
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_LEFT",
                instanceId: "other",
                controllerId: "p1",
                ownerId: "p1",
                types: ["Creature"],
                wasAura: false,
                toZone: "graveyard",
            } as never,
        ]);
        expect(
            triggers.some(
                (t) => t.triggeredAbilityId === "dance-of-many-sacrifice-self"
            )
        ).toBe(false);
    });
});

describe("Dance of Many — upkeep pay-{U}{U}-or-sacrifice (reuses LEG C7, CR 603.6a / 117.3a)", () => {
    const UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
        ({
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: playerId,
        }) as StackItem["triggerEvent"];

    it("declining the {U}{U} payment sacrifices the enchantment (CR 701.16)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        resolveTrigger(state, dance, "dance-of-many-upkeep", UPKEEP("p1"));
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield.some((c) => c.id === "dance")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "dance")).toBe(
            true
        );
    });

    it("paying {U}{U} keeps the enchantment on the battlefield (CR 118)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        state.players[0].manaPool = { U: 2 };
        resolveTrigger(state, dance, "dance-of-many-upkeep", UPKEEP("p1"));
        answerChoice(state, ["yes"]);
        expect(state.players[0].battlefield.some((c) => c.id === "dance")).toBe(
            true
        );
    });

    it("fires only at the controller's OWN upkeep (scope: your)", () => {
        const { state } = danceSetup(getCardByName("Serra Angel").id);
        expect(
            collectTriggers(state, [UPKEEP("p1") as never]).some(
                (t) => t.triggeredAbilityId === "dance-of-many-upkeep"
            )
        ).toBe(true);
        expect(
            collectTriggers(state, [UPKEEP("p2") as never]).some(
                (t) => t.triggeredAbilityId === "dance-of-many-upkeep"
            )
        ).toBe(false);
    });

    it("backend integration: declining via applyMayPaySubmit sacrifices it (GRE → mutation → state)", () => {
        const { state } = danceSetup(getCardByName("Serra Angel").id);
        state.stack.push(...collectTriggers(state, [UPKEEP("p1") as never]));
        // Resolve the upkeep tax trigger (the ETB/LTBs do not fire on a plain
        // upkeep event); it suspends at the may-pay choice.
        let suspended = false;
        while (state.stack.length > 0) {
            const before = state.stack.length;
            const res = resolveTopOfStack(state);
            if (res === null && state.pendingChoices?.length) {
                suspended = true;
                break;
            }
            if (state.stack.length === before) break;
        }
        expect(suspended).toBe(true);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "dance")).toBe(
            false
        );
    });
});

describe("Dance of Many — wire format (mandatory): copied P/T survives projection", () => {
    it("the copy-token's P/T survive projectPublicState (CR 707.2)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // GRE (fat state) assertion.
        expect(getEffectivePower(state, token)).toBe(4);
        expect(getEffectiveToughness(state, token)).toBe(4);
        // Same assertion after the network projection (the projection strips
        // card.card to { id }; the copy overwrote card.id with the copied def,
        // so the slim instance still reads the copied P/T).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(slim).toBeDefined();
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Dance of Many — serialization round-trip (linkedTokenId, CR 603.10)", () => {
    it("persists the linkedTokenId leave-linkage anchor across compact/expand", async () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        const { compactState, expandState } =
            await import("../../../../gre/serialize");
        const restored = expandState(compactState(state));
        const restoredDance = restored.players[0].battlefield.find(
            (c) => c.id === "dance"
        )!;
        expect(restoredDance.linkedTokenId).toBe(token.id);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Free tranche — Multicolor (#416)
// ───────────────────────────────────────────────────────────────────────────

describe("Drowned — {1}{U} 1/1 Zombie, {B}: Regenerate (CR 701.15a)", () => {
    it("is a 1/1 Zombie for {1}{U}", () => {
        expect(drowned.manaCost).toEqual({ X: 1, U: 1 });
        expect(drowned.types).toEqual(["Creature"]);
        expect(drowned.subtypes).toEqual(["Zombie"]);
        expect(drowned.power).toBe(1);
        expect(drowned.toughness).toBe(1);
        expect(drowned.activatedAbilities![0].cost).toEqual({ mana: { B: 1 } });
    });

    it("the {B} ability stacks a regeneration shield (CR 701.15a)", () => {
        const d = makeInstance(drowned.id, { id: "d", controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [d] }), makePlayer("p2")],
        });
        resolveActivated(state, d, "drowned-regenerate", []);
        const inPlay = state.players[0].battlefield.find((c) => c.id === "d")!;
        expect(inPlay.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Electric Eel — ETB self-damage + {R}{R} pump (CR 603.6a / 611.1)", () => {
    it("is a 1/1 Fish for {U}", () => {
        expect(electricEel.manaCost).toEqual({ U: 1 });
        expect(electricEel.subtypes).toEqual(["Fish"]);
        expect(electricEel.power).toBe(1);
        expect(electricEel.toughness).toBe(1);
    });

    it("its ETB trigger deals 1 damage to its controller (CR 603.6a)", () => {
        const eel = makeInstance(electricEel.id, {
            id: "eel",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eel] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, eel, "electric-eel-etb-damage", {
            type: "PERMANENT_ENTERED",
            instanceId: "eel",
            controllerId: "p1",
            types: ["Creature"],
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(19);
    });

    it("the {R}{R} ability pumps +2/+0 and self-damages 1 (CR 611.1)", () => {
        const eel = makeInstance(electricEel.id, {
            id: "eel",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eel] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, eel, "electric-eel-pump", []);
        expect(getEffectivePower(state, eel)).toBe(3); // 1 + 2
        expect(getEffectiveToughness(state, eel)).toBe(1);
        expect(state.players[0].life).toBe(19);
    });

    it("wire format: the +2/+0 buff survives projectPublicState", () => {
        const eel = makeInstance(electricEel.id, {
            id: "eel",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eel] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, eel, "electric-eel-pump", []);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "eel"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });
});
