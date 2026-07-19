// Per-card behavior tests for black cards in `convex/cards/sets/arn/black.ts`
// (ARN, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (effective P/T, damage, zone, combat outcome).

import { describe, it, expect } from "vitest";
import {
    cuombajjWitches,
    elHajjaj,
    ergRaiders,
    guardianBeast,
    hasranOgress,
    jununEfreet,
    juzamDjinn,
    khabalGhoul,
    oubliette,
    sorceressQueen,
} from "..";
import {
    animateArtifact,
    blackLotus,
    flight,
    grizzlyBears,
    plains,
    shatter,
    stealArtifact,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    getLegalTargets,
    raiseTriggerTargetSelection,
} from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    applyControlChange,
    type CardInstanceState,
    destroyWithReplacements,
    type GameState,
    phaseInBundle,
    phaseOutPermanent,
    regenerateOrDestroy,
    removePermanentTo,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import {
    resolveActivated,
    resolveTrigger,
    answerChoice,
    upkeepEvent,
    endStepEvent,
} from "./helpers";

describe("Juzám Djinn (upkeep: 1 damage to you)", () => {
    it("deals 1 to its controller on upkeep", () => {
        const juzam = makeInstance(juzamDjinn.id, { id: "juzam" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [juzam] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, juzam, "juzam-djinn-upkeep", upkeepEvent("p1"));
        expect(state.players[0].life).toBe(19);
    });
});

describe("Junún Efreet (upkeep: sacrifice unless pay {B}{B})", () => {
    function setup() {
        const efreet = makeInstance(jununEfreet.id, { id: "junun" });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [efreet] }),
                makePlayer("p2"),
            ],
        });
    }
    it("declining the payment sacrifices it", () => {
        const state = setup();
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "junun-efreet-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
    });
    it("paying keeps it on the battlefield", () => {
        const state = setup();
        state.players[0].manaPool = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 0 };
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "junun-efreet-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["yes"]);
        expect(state.players[0].battlefield).toHaveLength(1);
    });
});

describe("Hasran Ogress (attacks: 3 damage to you unless pay {2})", () => {
    function setup() {
        const ogress = makeInstance(hasranOgress.id, { id: "ogress" });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [ogress] }),
                makePlayer("p2"),
            ],
        });
    }
    it("declining deals 3 to its controller", () => {
        const state = setup();
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "hasran-ogress-attack",
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["ogress"],
            } as StackItem["triggerEvent"]
        );
        answerChoice(state, ["decline"]);
        expect(state.players[0].life).toBe(17);
    });
});

describe("El-Hajjâj (whenever it deals damage, gain that much life)", () => {
    it("gains life equal to combat damage dealt", () => {
        const elh = makeInstance(elHajjaj.id, {
            id: "elh",
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elh] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, elh, "el-hajjaj-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "elh",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 1,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Khabál Ghoul (end step: +1/+1 per creature that died this turn)", () => {
    it("adds counters equal to deaths this turn", () => {
        const ghoul = makeInstance(khabalGhoul.id, { id: "ghoul" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ghoul] }),
                makePlayer("p2"),
            ],
        });
        state.deathsThisTurn = 3;
        resolveTrigger(state, ghoul, "khabal-ghoul-end-step", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const after = state.players[0].battlefield[0];
        expect(after.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(state, after)).toBe(4);
    });
});

describe("Erg Raiders (end step: 2 damage to you unless it attacked / just arrived, CR 603.3e/603.4)", () => {
    const ability = ergRaiders.triggeredAbilities!.find(
        (a) => a.id === "erg-raiders-end-step"
    )!;

    it("is a 2/3 Human Warrior costing {1}{B}", () => {
        expect(ergRaiders.power).toBe(2);
        expect(ergRaiders.toughness).toBe(3);
        expect(ergRaiders.subtypes).toEqual(["Human", "Warrior"]);
        expect(ergRaiders.manaCost).toEqual({ X: 1, B: 1 });
    });

    it("deals 2 damage to you at end step when it didn't attack", () => {
        const erg = makeInstance(ergRaiders.id, { id: "erg" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        // It triggers (didn't attack, not summoning sick)...
        expect(ability.matches(endStepEvent("p1"), erg, state)).toBe(true);
        resolveTrigger(state, erg, "erg-raiders-end-step", endStepEvent("p1"));
        expect(state.players[0].life).toBe(18);
    });

    it("deals no damage when it attacked this turn (CR 603.4 intervening-if)", () => {
        const erg = makeInstance(ergRaiders.id, {
            id: "erg",
            hasAttackedThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        // Intervening-if blocks it both at trigger time and at resolve time.
        expect(ability.matches(endStepEvent("p1"), erg, state)).toBe(false);
        resolveTrigger(state, erg, "erg-raiders-end-step", endStepEvent("p1"));
        expect(state.players[0].life).toBe(20);
    });

    it("does not trigger the turn it came under your control (CR 603.3e)", () => {
        const erg = makeInstance(ergRaiders.id, {
            id: "erg",
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        expect(ability.matches(endStepEvent("p1"), erg, state)).toBe(false);
    });

    it("only fires on its own controller's end step, not the opponent's", () => {
        const erg = makeInstance(ergRaiders.id, { id: "erg" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        expect(ability.matches(endStepEvent("p2"), erg, state)).toBe(false);
    });
});

describe("Sorceress Queen ({T}: target other creature base 0/2)", () => {
    it("sets the target's base power and toughness to 0/2, +counter = 1/3", () => {
        const queen = makeInstance(sorceressQueen.id, { id: "queen" });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [queen] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, queen, "sorceress-queen-set", [
            { type: "permanent", id: "victim" },
        ]);
        const v = state.players[1].battlefield.find((c) => c.id === "victim")!;
        expect(getEffectivePower(state, v)).toBe(0);
        expect(getEffectiveToughness(state, v)).toBe(2);
        // 7b set then 7c counter (CR 613.4): 0/2 + a +1/+1 counter = 1/3.
        v.counters = { "+1/+1": 1 };
        expect(getEffectivePower(state, v)).toBe(1);
        expect(getEffectiveToughness(state, v)).toBe(3);
    });
    it("cannot target itself (excludeInstanceIds via getTargetRequirement)", () => {
        const queen = makeInstance(sorceressQueen.id, { id: "queen" });
        const other = makeInstance(grizzlyBears.id, { id: "other" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [queen, other] }),
                makePlayer("p2"),
            ],
        });
        const ability = sorceressQueen.activatedAbilities![0];
        const req = ability.getTargetRequirement!(
            { ...queen } as never,
            state as never
        );
        const legal = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(legal).toContain("other");
        expect(legal).not.toContain("queen");
    });
});

describe("Oubliette (phasing CR 702.26)", () => {
    /** Oubliette controlled by p1, enchanting/targeting p2's creature, which
     *  itself carries an Aura. Returns the assembled state plus handles. */
    function setup() {
        const oubl = makeInstance(oubliette.id, {
            id: "oubl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creature = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            counters: { "+1/+1": 2 },
        });
        const aura = makeInstance(flight.id, {
            id: "flight-1",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [oubl, aura] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        return { state, oubl, creature, aura };
    }

    /** Puts Oubliette's ETB trigger on the stack with its target slot
     *  UN-set (`targets: undefined`) and `triggerSourceId` pinned to the
     *  source enchantment, mirroring Phelia's `pheliaAttackTriggerOnStack`.
     *  `raiseTriggerTargetSelection` then locks or asks for the CR 603.3d
     *  target before `resolveTopOfStack` runs the phase-out. */
    function oublietteTriggerOnStack(
        state: GameState,
        source: CardInstanceState
    ): StackItem {
        const trig: StackItem = {
            ...source,
            id: "oubliette-trig",
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "oubliette-phase-out",
            triggerSourceId: source.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: source.id,
                controllerId: source.controllerId,
                types: ["Enchantment"],
            } as StackItem["triggerEvent"],
            targets: undefined,
        };
        state.stack.push(trig);
        return trig;
    }

    it("declares the CR 603.3d target requirement: target creature", () => {
        expect(oubliette.triggeredAbilities?.[0]?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });

    it("phases out the creature with its Aura, silently (no events, no graveyard)", () => {
        const { state } = setup();
        state.pendingEvents = undefined;
        const bundleId = phaseOutPermanent(state, "bear", {
            returnOn: { kind: "source-leaves", sourceId: "oubl" },
            onPhaseIn: { tap: true },
        });
        expect(bundleId).not.toBeNull();
        // Creature + aura are gone from every battlefield...
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "flight-1")
        ).toBeUndefined();
        // ...held in one bundle (host + aura), not in any graveyard...
        expect(state.phasedOut).toHaveLength(1);
        expect(state.phasedOut![0].cards).toHaveLength(2);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(0);
        // ...and the silent move emits no enters/leaves triggers.
        expect(state.pendingEvents ?? []).toHaveLength(0);
    });

    it("returns the creature tapped and still enchanted when Oubliette leaves", () => {
        const { state } = setup();
        phaseOutPermanent(state, "bear", {
            returnOn: { kind: "source-leaves", sourceId: "oubl" },
            onPhaseIn: { tap: true },
        });
        expect(state.phasedOut).toHaveLength(1);
        // Oubliette leaving the battlefield ends the duration → phase in.
        removePermanentTo(state, "oubl", "graveyard");
        const bear = state.players[1].battlefield.find((c) => c.id === "bear");
        expect(bear).toBeDefined();
        expect(bear!.isTapped).toBe(true); // "Tap that creature as it phases in"
        expect(bear!.counters?.["+1/+1"]).toBe(2); // counters preserved
        const aura = state.players[0].battlefield.find(
            (c) => c.id === "flight-1"
        );
        expect(aura).toBeDefined();
        expect(aura!.attachedTo).toBe("bear"); // still attached
        expect(state.phasedOut ?? []).toHaveLength(0);
    });

    it("does not return the bundle when an unrelated permanent leaves", () => {
        const { state } = setup();
        phaseOutPermanent(state, "bear", {
            returnOn: { kind: "source-leaves", sourceId: "oubl" },
        });
        // The aura's controller (p1) sacrifices something else — bundle stays.
        const filler = makeInstance(plains.id, { id: "filler" });
        state.players[0].battlefield.push(filler);
        removePermanentTo(state, "filler", "graveyard");
        expect(state.phasedOut).toHaveLength(1);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("phaseIn can be invoked directly by bundle id", () => {
        const { state } = setup();
        const bundleId = phaseOutPermanent(state, "bear", {
            returnOn: { kind: "untap-cycle" },
        })!;
        expect(phaseInBundle(state, bundleId)).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
        expect(phaseInBundle(state, bundleId)).toBe(false); // already gone
    });

    it("ETB trigger auto-locks the sole legal creature and phases it out (CR 603.3d, full path)", () => {
        const { state, oubl } = setup();
        const trig = oublietteTriggerOnStack(state, oubl);
        // Only the bear is a legal creature target — a sole mandatory target
        // auto-selects, so no PendingTarget is raised (returns false) and the
        // engine locks `trig.targets` to the bear.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "bear" }]);
        expect(state.pendingTarget).toBeUndefined();

        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.phasedOut).toHaveLength(1);
        expect(state.phasedOut![0].returnOn).toEqual({
            kind: "source-leaves",
            sourceId: "oubl",
        });
    });

    it("with 2+ legal creatures, raises a PendingTarget and phases out the chosen one (CR 603.3d)", () => {
        const { state, oubl } = setup();
        // A second creature (p1's own) makes the target a real choice.
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(other);

        oublietteTriggerOnStack(state, oubl);
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "permanent", id: "bear" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );

        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.phasedOut).toHaveLength(1);
        // The unchosen creature is untouched.
        expect(
            state.players[0].battlefield.find((c) => c.id === "other")
        ).toBeDefined();
    });
});

describe("Cuombajj Witches (opponent-chosen second target, CR 115.4 / 608.2)", () => {
    /** Build a board: p1 controls the Witches, both players have a vanilla
     *  creature to ping. `aladdinsRing` isn't a creature — use Juzám Djinn as a
     *  damageable body on each side. */
    function setup() {
        const witches = makeInstance(cuombajjWitches.id, {
            id: "witches",
            controllerId: "p1",
        });
        const myBody = makeInstance(juzamDjinn.id, {
            id: "p1-body",
            controllerId: "p1",
        });
        const oppBody = makeInstance(juzamDjinn.id, {
            id: "p2-body",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [witches, myBody] }),
                makePlayer("p2", { battlefield: [oppBody] }),
            ],
        });
        return { state, witches };
    }

    it("resolution suspends for the opponent's pick before any damage lands", () => {
        const { state, witches } = setup();
        // Controller's target (ping 1): the opponent's body.
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "permanent", id: "p2-body" },
        ]);

        // No damage yet — both pings land only after the opponent picks (so
        // ping 1 isn't double-applied across the suspend/resume of the resolve
        // step). Life and damageMarked are still pristine.
        const oppBody = state.players[1].battlefield.find(
            (c) => c.id === "p2-body"
        )!;
        expect(oppBody.damageMarked).toBeUndefined();
        expect(state.players[0].life).toBe(20);

        // Resolution suspended: a choose-damage-target choice is owed to the
        // OPPONENT (p2), not the controller.
        const head = state.pendingChoices?.[0];
        expect(head).toBeDefined();
        expect(head!.kind).toBe("choose-damage-target");
        expect(head!.playerId).toBe("p2");
        // Candidate set spans every player + every damageable permanent.
        expect(head!.candidatePlayerIds).toEqual(["p1", "p2"]);
        expect(new Set(head!.candidateIds)).toEqual(
            new Set(["witches", "p1-body", "p2-body"])
        );
    });

    it("opponent's pick of a player lands the second ping on that player", () => {
        const { state, witches } = setup();
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "permanent", id: "p2-body" },
        ]);
        // Opponent (p2) chooses to ping the controller (p1).
        answerChoice(state, ["p1"]);

        expect(state.players[0].life).toBe(19); // p1 took 1 from ping 2
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-body")!
                .damageMarked
        ).toBe(1); // ping 1 still on p2's body
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("opponent's pick of a permanent lands the second ping on that permanent", () => {
        const { state, witches } = setup();
        // Controller's ping 1 targets p2 (the player).
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "player", id: "p2" },
        ]);
        // Opponent (p2) chooses to ping the controller's own body — both pings
        // now land.
        answerChoice(state, ["p1-body"]);
        expect(state.players[1].life).toBe(19); // ping 1 hit p2
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-body")!
                .damageMarked
        ).toBe(1); // ping 2 hit p1's body
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("both pings can hit the same player (controller and opponent both choose it)", () => {
        const { state, witches } = setup();
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "player", id: "p1" },
        ]);
        answerChoice(state, ["p1"]);
        expect(state.players[0].life).toBe(18); // 1 + 1
    });

    it("definition snapshot: {B}{B} 1/3 Human Wizard with the tap ability", () => {
        expect(cuombajjWitches.manaCost).toEqual({ B: 2 });
        expect(cuombajjWitches.power).toBe(1);
        expect(cuombajjWitches.toughness).toBe(3);
        expect(cuombajjWitches.subtypes).toEqual(["Human", "Wizard"]);
        const ability = cuombajjWitches.activatedAbilities![0];
        expect(ability.cost.tap).toBe(true);
        expect(ability.targetRequirement).toEqual({ type: "any", count: 1 });
    });

    it("wire format: the opponent's pending choice survives projection", () => {
        const { state, witches } = setup();
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "permanent", id: "p2-body" },
        ]);
        // The choice is owed to p2 — project from p2's viewpoint and assert the
        // candidate allow-lists the frontend reads are intact across the wire.
        const projected = projectPublicState(state, 1, "p2");
        const head = projected.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-damage-target");
        expect(head?.playerId).toBe("p2");
        expect(head?.candidatePlayerIds).toEqual(["p1", "p2"]);
        expect(new Set(head?.candidateIds)).toEqual(
            new Set(["witches", "p1-body", "p2-body"])
        );
    });
});

describe("Guardian Beast (permanent-guard while untapped, CR 611)", () => {
    /** p1 controls Guardian Beast + a noncreature artifact (Black Lotus). */
    function setup(opts: { beastTapped?: boolean } = {}) {
        const beast = makeInstance(guardianBeast.id, {
            id: "beast",
            controllerId: "p1",
            isTapped: opts.beastTapped ?? false,
        });
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beast, lotus] }),
                makePlayer("p2"),
            ],
        });
        return { state, beast, lotus };
    }

    const onBattlefield = (state: GameState, id: string) =>
        state.players.some((p) => p.battlefield.some((c) => c.id === id));
    const controllerOf = (state: GameState, id: string) =>
        state.players.find((p) => p.battlefield.some((c) => c.id === id))?.id;

    describe("indestructible (CR 702.12)", () => {
        it("a guarded artifact survives 'destroy' while the Beast is untapped", () => {
            const { state } = setup();
            const destroyed = destroyWithReplacements(state, "lotus");
            expect(destroyed).toBe(false);
            expect(onBattlefield(state, "lotus")).toBe(true);
        });

        it("the artifact is destroyed once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            const destroyed = destroyWithReplacements(state, "lotus");
            expect(destroyed).toBe(true);
            expect(onBattlefield(state, "lotus")).toBe(false);
        });

        it("integration: resolving Shatter at the artifact is a no-op while untapped", () => {
            const { state } = setup();
            pushSpell(state, shatter.id, "p2", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            expect(onBattlefield(state, "lotus")).toBe(true);
        });

        it("integration: Shatter destroys the artifact once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            pushSpell(state, shatter.id, "p2", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            expect(onBattlefield(state, "lotus")).toBe(false);
        });

        it("does not protect the Beast's controller's OTHER creatures, nor artifacts of another player", () => {
            // Only noncreature artifacts the Beast's controller controls are
            // guarded. A regular creature p1 controls is still destructible,
            // and an opponent's artifact is unguarded.
            const { state } = setup();
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
            });
            const oppLotus = makeInstance(blackLotus.id, {
                id: "opp-lotus",
                controllerId: "p2",
                ownerId: "p2",
            });
            state.players[0].battlefield.push(bear);
            state.players[1].battlefield.push(oppLotus);
            expect(regenerateOrDestroy(state, "bear")).toBe(true);
            expect(destroyWithReplacements(state, "opp-lotus")).toBe(true);
        });
    });

    describe("can't be targeted (CR 702.16b-style)", () => {
        it("getLegalTargets excludes the guarded artifact while untapped", () => {
            const { state } = setup();
            const targets = getLegalTargets(state, shatter.targetRequirement!, [
                "R",
            ]);
            expect(targets.some((t) => t.id === "lotus")).toBe(false);
        });

        it("getLegalTargets includes the artifact once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            const targets = getLegalTargets(state, shatter.targetRequirement!, [
                "R",
            ]);
            expect(targets.some((t) => t.id === "lotus")).toBe(true);
        });

        it("wire format: the targeting ban survives projection", () => {
            const { state } = setup();
            const projected = projectPublicState(state, 1, "p1");
            const targets = getLegalTargets(
                projected as unknown as GameState,
                shatter.targetRequirement!,
                ["R"]
            );
            expect(targets.some((t) => t.id === "lotus")).toBe(false);
        });
    });

    describe("can't be enchanted (CR 303.4)", () => {
        it("an Aura cast at the guarded artifact fizzles to the graveyard while untapped", () => {
            const { state } = setup();
            // Animate Artifact targets a noncreature artifact.
            pushSpell(state, animateArtifact.id, "p1", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            // Aura did not attach — it fizzled to its owner's graveyard.
            const aura = state.players[0].graveyard.find(
                (c) => (c.card as { id?: string }).id === animateArtifact.id
            );
            expect(aura).toBeDefined();
            const lotus = state.players[0].battlefield.find(
                (c) => c.id === "lotus"
            )!;
            expect(lotus.attachedTo).toBeUndefined();
            // The artifact stays a noncreature (Animate Artifact never applied).
            expect(lotus.types.includes("Creature")).toBe(false);
        });

        it("the Aura attaches once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            pushSpell(state, animateArtifact.id, "p1", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            const lotus = state.players[0].battlefield.find(
                (c) => c.id === "lotus"
            )!;
            expect(lotus.types.includes("Creature")).toBe(true);
        });
    });

    describe("control can't be changed (CR 613.1b)", () => {
        it("applyControlChange is a no-op on the guarded artifact while untapped", () => {
            const { state } = setup();
            applyControlChange(state, "lotus", "p2", "src-1");
            expect(controllerOf(state, "lotus")).toBe("p1");
        });

        it("control changes once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            applyControlChange(state, "lotus", "p2", "src-1");
            expect(controllerOf(state, "lotus")).toBe("p2");
        });

        it("integration: Steal Artifact can't steal the guarded artifact while untapped", () => {
            const { state } = setup();
            pushSpell(state, stealArtifact.id, "p2", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            // The aura fizzles (can't enchant), so control never changes.
            expect(controllerOf(state, "lotus")).toBe("p1");
        });
    });

    it("definition snapshot: 2/4 Beast, {3}{B}, single permanent-guard", () => {
        expect(guardianBeast.power).toBe(2);
        expect(guardianBeast.toughness).toBe(4);
        expect(guardianBeast.manaCost).toEqual({ X: 3, B: 1 });
        const guards = (guardianBeast.staticEffects ?? []).filter(
            (e) => e.kind === "permanent-guard"
        );
        expect(guards).toHaveLength(1);
    });
});
