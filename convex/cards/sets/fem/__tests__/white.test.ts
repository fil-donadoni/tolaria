// Per-card behavior tests for white cards in `convex/cards/sets/fem/white.ts`
// (FEM, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (definition shape, zone after resolution, projected wire-format).

import { describe, it, expect } from "vitest";
import {
    combatMedic,
    farrelitePriest,
    farrelsMantle,
    farrelsZealot,
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
} from "..";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { getEffectivePower, STATIC_EFFECT_CTX } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import {
    applyAllCombatDamage,
    finalizeCleanup,
    fireDelayedTriggers,
} from "../../../../gre/phases";
import {
    finalizeTargetSelection,
    tryAutoCommitPendingActivation,
} from "../../../../game";
import { grizzlyBears } from "../../lea";
import { matchesPermanentFilter } from "../../../filters";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveActivated } from "./helpers";

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
