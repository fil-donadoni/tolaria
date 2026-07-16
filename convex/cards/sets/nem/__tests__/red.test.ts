// Per-card test for nem/red.ts — Seal of Fire. The "Sacrifice this: deal N
// damage to any target" shape (shared with tmp Mogg Fanatic) is exercised
// here via the GRE entry point: the self-sacrifice cost (`cost.sacrifice`) is
// paid by removing the source to the graveyard BEFORE the ability resolves off
// its stack-item clone, then `dealDamage` lands on the announced any-target.
// The convention (`.claude/rules/gre-development.md` § Card testing
// convention) mandates a GRE test asserting the damage + the permanent leaving
// for an activated ability, plus a wire-format re-assertion for the
// board-visible outcome.
import { describe, it, expect } from "vitest";
import { sealOfFire, arcMage } from "..";
import {
    getPlayer,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingTarget,
    type StackItem,
} from "../../../../gre/state";
import {
    finalizeTargetSelection,
    tryAutoCommitPendingActivation,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

/** Mirror of the game.ts commit path for a no-mana, no-tap self-sacrifice
 *  activated ability (`cost.sacrifice: true`): pay the cost by moving the
 *  source to the graveyard, then push the ability (a clone of the source) on
 *  the stack and resolve it. Asserts the exact engine ordering — the source is
 *  gone before the effect runs (CR 602.1 / 701.21). */
function sacrificeSelfActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    const stackItem: StackItem = {
        ...structuredClone(source),
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    };
    removePermanentTo(state, source.id, "graveyard");
    state.stack.push(stackItem);
    resolveTopOfStack(state);
}

describe("Seal of Fire (sacrifice-for-effect, CR 602.1 / 701.21 / 120.1)", () => {
    it("sacrifices itself to deal 2 damage to a player and lands in the graveyard", () => {
        const seal = makeInstance(sealOfFire.id, {
            id: "seal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [seal] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, seal, "seal-of-fire-sac", [
            { type: "player", id: "p2" },
        ]);

        // Damage dealt.
        expect(getPlayer(state, "p2").life).toBe(18);
        // The permanent left the battlefield (sacrificed as the cost).
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "seal")
        ).toBe(false);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "seal")
        ).toBe(true);
        // Ability fully resolved.
        expect(state.stack).toHaveLength(0);
    });

    it("can deal its 2 damage to a creature (any target)", () => {
        const seal = makeInstance(sealOfFire.id, { id: "seal" });
        const bear = makeInstance(sealOfFire.id, {
            // any 2+-toughness stand-in isn't needed; use a synthetic creature.
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Give the stand-in creature shape so damage marks without dying.
        bear.types = ["Creature"];
        bear.power = 3;
        bear.toughness = 3;
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [seal] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });

        sacrificeSelfActivated(state, seal, "seal-of-fire-sac", [
            { type: "permanent", id: "bear" },
        ]);

        expect(
            getPlayer(state, "p2").battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(2);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "seal")
        ).toBe(true);
    });

    it("the damage and the sacrifice survive the public projection (wire format)", () => {
        const seal = makeInstance(sealOfFire.id, {
            id: "seal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [seal] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, seal, "seal-of-fire-sac", [
            { type: "player", id: "p2" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(18);
        // The projection strips card.card to { id }; the sacrificed Seal is in
        // p1's graveyard on the wire, not the battlefield.
        expect(
            projected.players[0].battlefield.some((c) => c.id === "seal")
        ).toBe(false);
        expect(
            projected.players[0].graveyard.some((c) => c.id === "seal")
        ).toBe(true);
    });
});

describe("Arc Mage — {2}{R} 2/2 Spellshaper, activated divide-as-you-choose (CR 601.2d / 120.4)", () => {
    /** Build p1 with Arc Mage untapped on the battlefield, one hand card to
     *  pay the "Discard a card" cost, and enough mana for {2}{R}. */
    function setup() {
        const mage = makeInstance(arcMage.id, {
            id: "mage",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
        const discardMe = makeInstance(sealOfFire.id, {
            id: "discard-me",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mage],
                    hand: [discardMe],
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        return { state, mage };
    }

    /** Mirror the pendingTarget the activateAbility mutation builds for a divide
     *  ability (CR 601.2d): kind "ability", the divide total + the caster's
     *  assigned split ride on it, count capped at the total. */
    function abilityPendingTarget(
        selected: PendingTarget["selected"],
        divideAmounts?: Record<string, number>
    ): PendingTarget {
        return {
            playerId: "p1",
            cardInstanceId: "mage",
            targetType: "any",
            count: { min: 1, max: 2 },
            selected,
            kind: "ability",
            abilityId: "arc-mage-bolt",
            divideTotal: 2,
            ...(divideAmounts ? { divideAmounts } : {}),
        };
    }

    it("definitional: Spellshaper with a tap + discard + {2}{R} divide ability", () => {
        expect(arcMage.manaCost).toEqual({ X: 2, R: 1 });
        expect(arcMage.power).toBe(2);
        expect(arcMage.toughness).toBe(2);
        expect(arcMage.subtypes).toEqual(["Human", "Spellshaper"]);
        const ability = arcMage.activatedAbilities![0];
        expect(ability.cost.tap).toBe(true);
        expect(ability.cost.mana).toEqual({ X: 2, R: 1 });
        expect(ability.cost.discardFilter).toEqual({ filter: {}, count: 1 });
        expect(ability.targetRequirement?.divideAsChosen).toEqual({ total: 2 });
        expect(ability.targetRequirement?.count).toEqual({ min: 1 });
    });

    it("integration: divides 2 (1/1) across two targets through the real commit path", () => {
        const { state } = setup();
        const pt = abilityPendingTarget(
            [
                { type: "player", id: "p1" },
                { type: "player", id: "p2" },
            ],
            { "player:p1": 1, "player:p2": 1 }
        );
        state.pendingTarget = pt;
        // The discard cost defers to pendingActivation even with mana covered.
        finalizeTargetSelection(state, pt, "p1");
        const pa = state.pendingActivation!;
        expect(pa).toBeDefined();
        // Edit C — the divide split rides on the deferred payment.
        expect(pa.targetAmounts).toEqual({ "player:p1": 1, "player:p2": 1 });

        // Complete the "Discard a card" cost and auto-commit.
        pa.discardFilterChoice!.pickedCardIds = ["discard-me"];
        tryAutoCommitPendingActivation(state, "p1");

        // Cost paid: source tapped, card discarded, ability on the stack.
        expect(state.players[0].battlefield[0].isTapped).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "discard-me")
        ).toBe(true);
        const item = state.stack.find((s) => s.abilityId === "arc-mage-bolt")!;
        // Edit E — the split reached the resolving stack item.
        expect(item.targetAmounts).toEqual({ "player:p1": 1, "player:p2": 1 });

        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(19); // p1 took 1
        expect(state.players[1].life).toBe(19); // p2 took 1
    });

    it("a single target absorbs the whole 2 (auto ≥1-each fallback)", () => {
        const { state } = setup();
        const pt = abilityPendingTarget([{ type: "player", id: "p2" }]);
        state.pendingTarget = pt;
        finalizeTargetSelection(state, pt, "p1");
        const pa = state.pendingActivation!;
        pa.discardFilterChoice!.pickedCardIds = ["discard-me"];
        tryAutoCommitPendingActivation(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - 2
    });

    it("wire format: the divided damage survives projectPublicState", () => {
        const { state } = setup();
        const pt = abilityPendingTarget(
            [
                { type: "player", id: "p1" },
                { type: "player", id: "p2" },
            ],
            { "player:p1": 2 }
        );
        // p1 assigned 2, p2 0 → incomplete split, engine falls back to ≥1-each.
        state.pendingTarget = pt;
        finalizeTargetSelection(state, pt, "p1");
        const pa = state.pendingActivation!;
        pa.discardFilterChoice!.pickedCardIds = ["discard-me"];
        tryAutoCommitPendingActivation(state, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(19); // ≥1-each split: 1 each
        expect(projected.players[1].life).toBe(19);
    });
});
