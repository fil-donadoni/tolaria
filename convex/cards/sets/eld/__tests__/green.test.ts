// Once Upon a Time (ELD, issue #790) — the free-first-spell-this-game
// alternative cost. `lookDistribute`'s own resolution shape (look 5, keep a
// creature/land, bottom the rest in random order) is already covered by the
// catalogue-wide Effect Script static sweep + auto-generated smoke test (the
// per-Op regime, `.claude/rules/gre-development.md`), so this file focuses on
// what's genuinely NEW about this card: it's the first `alternativeCosts[]`
// entry authored alongside a DSL `effects[]` script rather than `resolve()`,
// and its condition (`first-spell-this-game`) is exercised end-to-end through
// the real cost-collapse + cast-legality + commit path.
import { describe, it, expect } from "vitest";
import { onceUponATime, questingBeast } from "../green";
import { grizzlyBears } from "../../lea/green";
import { wallOfVapor } from "../../leg/blue";
import { forest } from "../../lea/colorless";
import {
    dealDamageFromPermanentToPlayer,
    resolveTopOfStack,
} from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { applyAllCombatDamage } from "../../../../gre/phases";
import { validateBlockerEligibility } from "../../../../gre/combat";
import {
    anyCombatDamageUnpreventableStatic,
    isCombatDamageUnpreventable,
} from "../../../../gre/combatDamagePrevention";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../../../../gre/alternativeCost";
import { teferiHeroOfDominaria } from "../../dom/multicolor";
import {
    getLegalActions,
    getLegalTargets,
    raiseTriggerTargetSelection,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { tryAutoCommitPendingCast } from "../../../../game";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

describe("Once Upon a Time — free alt cost (CR 118.9, issue #790)", () => {
    const inst = handCard(onceUponATime.id, "ouat");

    it("getAlternativeCost resolves the leg-free free-cast variant by id", () => {
        const alt = getAlternativeCost(onceUponATime, "free-first-spell");
        expect(alt).toBeDefined();
        expect(alt?.mana).toBeUndefined();
        expect(alt?.permanent).toBeUndefined();
        expect(alt?.life).toBeUndefined();
        expect(alt?.hand).toBeUndefined();
        expect(alt?.condition).toEqual({ kind: "first-spell-this-game" });
    });

    it("is offered as affordable when the caster hasn't cast a spell this game", () => {
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const alts = affordableAlternativeCosts(state, state.players[0], inst);
        expect(alts.some((a) => a.id === "free-first-spell")).toBe(true);
    });

    it("is NOT offered once the caster has already cast a spell this game", () => {
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].spellsCastThisGame = 1;
        const alts = affordableAlternativeCosts(state, state.players[0], inst);
        expect(alts.some((a) => a.id === "free-first-spell")).toBe(false);
    });
});

describe("Once Upon a Time — cast legality via the free alt cost (convex/gre/rules.ts)", () => {
    it("'cast' is legal with ZERO mana when it's the caster's first spell this game", () => {
        const inst = handCard(onceUponATime.id, "ouat");
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // No mana anywhere — only the free alt cost makes this legal.
        const actions = getLegalActions(state, state.players[0], inst);
        expect(actions).toContain("cast");
    });

    it("'cast' is illegal with zero mana once the caster's first spell is spent", () => {
        const inst = handCard(onceUponATime.id, "ouat");
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].spellsCastThisGame = 1;
        const actions = getLegalActions(state, state.players[0], inst);
        expect(actions).not.toContain("cast");
    });
});

describe("Once Upon a Time — commit + resolution (CR 118.9 / 601.2h, 401.4)", () => {
    // Mirrors dash.test.ts / pitch-cost.test.ts's pattern: this project has no
    // convex-test harness for game.ts mutations (ADR 0001), so the REAL
    // exported commit function is driven directly over a manually-parked
    // `pendingCast` with the mana cost already collapsed to `{}` — the exact
    // shape `announceCast`'s `chosenAltCost.mana ?? {}` produces for a
    // leg-free alternative cost (convex/game.ts).
    function freeCastState(): GameState {
        const ouatInst = handCard(onceUponATime.id, "ouat", "p1");
        // A mix of creatures, a land, and an ineligible instant — "b" (the
        // land, Forest) is the one kept, proving the filter's "Creature or
        // Land" eligibility actually holds for a real land card.
        const libSpec: [string, string][] = [
            ["a", grizzlyBears.id],
            ["b", forest.id],
            ["c", grizzlyBears.id],
            ["d", forest.id],
            ["e", onceUponATime.id],
        ];
        const libCards = libSpec.map(([id, cardId]) =>
            makeInstance(cardId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [ouatInst], library: libCards }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "ouat",
            manaCost: {},
            tappedLandIds: [],
        };
        return state;
    }

    it("commits for zero mana and stacks the spell", () => {
        const state = freeCastState();
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        expect(state.players[0].manaPool).toEqual(expect.objectContaining({}));
        expect(state.stack.some((s) => s.id === "ouat")).toBe(true);
        expect(state.players[0].hand.map((c) => c.id)).not.toContain("ouat");
    });

    it("resolves via lookDistribute: looks at the top 5, keeps the chosen card, bottoms the rest", () => {
        const state = freeCastState();
        tryAutoCommitPendingCast(state, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.candidateIds).toEqual(["a", "b", "c", "d", "e"]);
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b"],
        });
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("b");
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "a",
            "c",
            "d",
            "e",
        ]);
    });
});

describe("Once Upon a Time — free alt cost survives projectPublicState (wire format)", () => {
    it("'cast' stays legal (via the free alt cost) after projection, with zero mana", () => {
        const inst = handCard(onceUponATime.id, "ouat");
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimCard = projected.players[0].hand[0];
        expect(slimCard).toBeDefined();
        expect(slimCard?.legalActions).toContain("cast");
    });
});

// ---------------------------------------------------------------------------
// Questing Beast (ELD, issue #2395)
//
// The card's load-bearing clause is source-side unpreventable COMBAT damage
// (CR 615.12). Prevention in this engine is not one chokepoint but NINE, and a
// gate that forgets to ask about the immunity fails SILENTLY — the card passes
// its own happy-path test and is stopped by whichever shield was missed. So
// the block below is one `it` per chokepoint, derived from a producer census
// of every prevention site rather than from the implementation, plus the two
// must-NOT rows (CR 510.1c assignment restrictions, and noncombat damage).
// ---------------------------------------------------------------------------
describe("Questing Beast — unpreventable combat damage (CR 615.12)", () => {
    /** p1 (active) attacks with Questing Beast, unblocked, into p2 at 20. */
    function qbAttacks() {
        const qb = makeInstance(questingBeast.id, {
            id: "qb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        return makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [qb] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["qb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
    }

    /** p2 blocks Questing Beast with `blocker`; the damage step does not
     *  re-validate block legality (CR 509.1b is checked at declaration), so a
     *  fixture may seat any blocker to reach the PERMANENT damage branch. */
    function qbBlockedBy(blocker: ReturnType<typeof makeInstance>) {
        const qb = makeInstance(questingBeast.id, {
            id: "qb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        blocker.isBlocking = true;
        return makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [qb] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["qb"],
                confirmed: true,
                blockerAssignments: { blk: ["qb"] },
                blockersConfirmed: true,
            },
        });
    }

    const p2Life = (s: GameState) => s.players.find((p) => p.id === "p2")!.life;

    // --- chokepoint 1: the blanket Fog short-circuit (phases.ts) -----------
    it("connects through a Fog (preventAllCombatDamageThisTurn)", () => {
        const state = qbAttacks();
        state.preventAllCombatDamageThisTurn = true;
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(16);
    });

    it("the SAME Fog still stops a creature the Beast's controller does NOT control", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = qbBlockedBy(blocker);
        state.preventAllCombatDamageThisTurn = true;
        applyAllCombatDamage(state, { qb: { blk: 4 } });
        const qb = state.players[0].battlefield.find((c) => c.id === "qb");
        // The 2/2 blocker is p2's, so its damage stays fogged...
        expect(qb?.damageMarked ?? 0).toBe(0);
        // ...while the Beast's own damage went through and killed it (SBA).
        expect(state.players[1].battlefield.some((c) => c.id === "blk")).toBe(
            false
        );
    });

    // --- chokepoint 2: one-shot source→player prevention effect ------------
    it("connects through a one-shot preventionEffect, and does NOT consume it", () => {
        const state = qbAttacks();
        state.preventionEffects = [
            {
                sourceInstanceId: "qb",
                playerId: "p2",
                duration: { phase: "end-of-turn" },
            },
        ];
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(16);
        // CR 615.12 — "existing damage prevention shields won't be reduced by
        // damage that can't be prevented".
        expect(state.preventionEffects).toHaveLength(1);
    });

    // --- chokepoint 3: per-player source-matched shield --------------------
    it("connects through a playerDamagePrevention shield, unspent", () => {
        const state = qbAttacks();
        state.playerDamagePrevention = [
            {
                playerId: "p2",
                match: {},
                mode: "all",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(16);
        expect(state.playerDamagePrevention?.[0].remaining).toBe(1);
    });

    // --- chokepoint 4: target-keyed absorption shield (player branch) ------
    it("connects through a targetPreventionShield on the player, unspent", () => {
        const state = qbAttacks();
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p2",
                remaining: 10,
                duration: { phase: "end-of-turn" },
            },
        ];
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(16);
        expect(state.targetPreventionShields?.[0].remaining).toBe(10);
    });

    // --- chokepoint 5: target-keyed absorption shield (permanent branch) ---
    it("connects through a targetPreventionShield on the blocking creature", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = qbBlockedBy(blocker);
        state.targetPreventionShields = [
            {
                targetType: "permanent",
                targetId: "blk",
                remaining: 10,
                duration: { phase: "end-of-turn" },
            },
        ];
        applyAllCombatDamage(state, { qb: { blk: 4 } });
        expect(state.players[1].battlefield.some((c) => c.id === "blk")).toBe(
            false
        );
        expect(state.targetPreventionShields?.[0].remaining).toBe(10);
    });

    // --- chokepoint 6: the continuous target-side static (Wall of Vapor) ---
    it("connects through a combat-damage-prevention static on the blocker", () => {
        const wall = makeInstance(wallOfVapor.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = qbBlockedBy(wall);
        applyAllCombatDamage(state, { qb: { blk: 4 } });
        // Wall of Vapor prevents combat damage from creatures it blocks — but
        // not from Questing Beast, so the 0/1 Wall dies to the 4 damage.
        expect(state.players[1].battlefield.some((c) => c.id === "blk")).toBe(
            false
        );
    });

    // --- chokepoint 7: combatDamageImmunity, both directions ---------------
    it("connects through a combatDamageImmunity shield on the blocker", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = qbBlockedBy(blocker);
        state.combatDamageImmunity = [
            { instanceId: "blk", duration: { phase: "end-of-turn" } },
        ];
        applyAllCombatDamage(state, { qb: { blk: 4 } });
        expect(state.players[1].battlefield.some((c) => c.id === "blk")).toBe(
            false
        );
    });

    it("connects through a combatDamageImmunity shield on the Beast ITSELF", () => {
        const state = qbAttacks();
        state.combatDamageImmunity = [
            { instanceId: "qb", duration: { phase: "end-of-turn" } },
        ];
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(16);
    });

    // --- chokepoint 8: source-scoped prevention shield ---------------------
    it("connects through a source-scoped prevention shield naming the Beast", () => {
        const state = qbAttacks();
        state.sourcePreventionShields = [
            { sourceIds: ["qb"], combatOnly: true },
        ];
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(16);
    });

    // MUST-NOT row: CR 510.1c is an ASSIGNMENT restriction, not a CR 615
    // prevention — a creature that assigns no combat damage produces no damage
    // event for CR 615.12 to protect. Same shield list, opposite answer.
    it("is STILL stopped by a CR 510.1c 'assigns no combat damage' mark", () => {
        const state = qbAttacks();
        state.sourcePreventionShields = [
            { sourceIds: ["qb"], combatOnly: true, assignsNone: true },
        ];
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(20);
    });

    // --- chokepoint 9: Forcefield's damage cap -----------------------------
    it("connects through a Forcefield damage cap, leaving it unspent", () => {
        const state = qbAttacks();
        state.damageCapShields = [{ playerId: "p2", maxDamage: 1 }];
        applyAllCombatDamage(state, {});
        expect(p2Life(state)).toBe(16);
        expect(state.damageCapShields).toHaveLength(1);
    });

    // MUST-NOT row: the clause is COMBAT damage only.
    it("does NOT make the Beast's NONCOMBAT damage unpreventable", () => {
        const state = qbAttacks();
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p2",
                remaining: 10,
                duration: { phase: "end-of-turn" },
            },
        ];
        const qb = state.players[0].battlefield.find((c) => c.id === "qb")!;
        dealDamageFromPermanentToPlayer(state, qb, "p1", "p2", 3);
        expect(p2Life(state)).toBe(20);
        expect(state.targetPreventionShields?.[0].remaining).toBe(7);
    });

    // MUST-NOT row: "creatures YOU control", not every creature.
    it("the predicate rejects a creature the Beast's controller does not control", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = qbBlockedBy(blocker);
        const qb = state.players[0].battlefield.find((c) => c.id === "qb")!;
        expect(isCombatDamageUnpreventable(state, qb)).toBe(true);
        expect(isCombatDamageUnpreventable(state, blocker)).toBe(false);
    });

    it("extends to OTHER creatures its controller controls, not just itself", () => {
        const state = qbAttacks();
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        state.players[0].battlefield.push(bears);
        state.combat!.attackerIds.push("bears");
        state.preventAllCombatDamageThisTurn = true;
        applyAllCombatDamage(state, { qb: { blk: 4 } });
        expect(p2Life(state)).toBe(14); // 4 + 2, both through the Fog
    });

    it("the immunity dies with the Beast (live query, CR 611.2)", () => {
        const state = qbAttacks();
        const qb = state.players[0].battlefield.find((c) => c.id === "qb")!;
        expect(anyCombatDamageUnpreventableStatic(state)).toBe(true);
        state.players[0].battlefield = [];
        expect(anyCombatDamageUnpreventableStatic(state)).toBe(false);
        expect(isCombatDamageUnpreventable(state, qb)).toBe(false);
    });

    it("survives the wire projection (the bot only ever sees the projection)", () => {
        const state = qbAttacks();
        const projected = projectPublicState(state, 1, "p1");
        const pQb = projected.players[0].battlefield.find(
            (c) => c.id === "qb"
        )!;
        expect(
            isCombatDamageUnpreventable(projected as never, pQb as never)
        ).toBe(true);
    });
});

describe("Questing Beast — can't be blocked by power 2 or less (CR 509.1b)", () => {
    function attackerAndBlocker(blockerPower: number) {
        const qb = makeInstance(questingBeast.id, {
            id: "qb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            power: blockerPower,
            toughness: blockerPower,
        });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [qb] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, qb, blocker };
    }

    it("rejects a power-2 blocker", () => {
        const { state, qb, blocker } = attackerAndBlocker(2);
        const res = validateBlockerEligibility(
            qb,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("accepts a power-3 blocker", () => {
        const { state, qb, blocker } = attackerAndBlocker(3);
        const res = validateBlockerEligibility(
            qb,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
});

describe("Questing Beast — combat damage to an opponent hits their planeswalker", () => {
    /** p1 attacks with Questing Beast, unblocked. `pwOwner` gets a 6-loyalty
     *  Teferi so the 4 damage leaves a readable residue rather than a death. */
    function qbVsPlaneswalker(pwOwner: "p1" | "p2") {
        const qb = makeInstance(questingBeast.id, {
            id: "qb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const pw = makeInstance(teferiHeroOfDominaria.id, {
            id: "pw",
            controllerId: pwOwner,
            ownerId: pwOwner,
            counters: { loyalty: 6 },
        });
        return makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: pwOwner === "p1" ? [qb, pw] : [qb],
                }),
                makePlayer("p2", {
                    battlefield: pwOwner === "p2" ? [pw] : [],
                }),
            ],
            combat: {
                attackerIds: ["qb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
    }

    const loyaltyOf = (s: GameState, ownerIdx: number) =>
        s.players[ownerIdx].battlefield.find((c) => c.id === "pw")?.counters
            ?.loyalty;

    it("deals THAT MUCH damage to the damaged opponent's planeswalker", () => {
        const state = qbVsPlaneswalker("p2");
        applyAllCombatDamage(state, {});
        expect(state.players[1].life).toBe(16);
        // CR 603.3d — the trigger is on the stack with an un-set target slot.
        // The opponent controls exactly one planeswalker, so the engine's
        // sole-legal-target auto-select locks it with no prompt (project
        // convention: never prompt a choice with no real option) and
        // `raiseTriggerTargetSelection` reports "nothing to ask".
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "pw" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        // CR 120.3c / 704.5i — 4 combat damage dealt, 4 loyalty removed.
        expect(loyaltyOf(state, 1)).toBe(2);
    });

    it("cannot touch a planeswalker the Beast's OWN controller controls", () => {
        const state = qbVsPlaneswalker("p1");
        applyAllCombatDamage(state, {});
        expect(state.players[1].life).toBe(16);
        // No legal target on the damaged player's side, so nothing is raised
        // and the trigger does nothing on resolution (CR 603.3d / 608.2b).
        raiseTriggerTargetSelection(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(loyaltyOf(state, 0)).toBe(6);
    });

    it("target legality survives the wire projection", () => {
        const state = qbVsPlaneswalker("p2");
        const req = questingBeast.triggeredAbilities![0].targetRequirement!;
        const projected = projectPublicState(state, 1, "p1");
        const legal = getLegalTargets(
            projected as never,
            req,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal.map((t) => t.id)).toEqual(["pw"]);

        // ...and the mirror case offers nothing: the same requirement over a
        // board where only the Beast's controller has a planeswalker.
        const own = projectPublicState(qbVsPlaneswalker("p1"), 1, "p1");
        expect(
            getLegalTargets(own as never, req, NO_TARGETING_SOURCE, "p1")
        ).toEqual([]);
    });
});
