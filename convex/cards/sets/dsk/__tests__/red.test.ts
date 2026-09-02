// Per-card behavior tests for red cards in `convex/cards/sets/dsk/red.ts`
// (Duskmourn: House of Horror, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.ts.
//
// Fear of Missing Out (issue #2421): the "when this creature enters, discard
// a card, then draw a card" clause was previously wired as CardDefinition-
// level `effects` — the spell-resolution slot, which the engine runs ONLY
// once, at cast-resolution time. Rebuilt as an `enteredTrigger` (a real CR
// 603.2 triggered ability), these tests prove it fires off the generic
// PERMANENT_ENTERED event on every entry path, not only a cast.

import { describe, it, expect } from "vitest";
import { enduringCourage, fearOfMissingOut } from "..";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    processPendingActionTriggers,
    putReanimatedSetOnBattlefield,
    exileWithAttachments,
    returnExiledForSource,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getCardByName } from "../../../index";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import type { GameEvent } from "../../../types";

function submitDiscard(
    state: ReturnType<typeof makeState>,
    cardInstanceId: string
): void {
    const pending = state.pendingChoices![0];
    expect(pending.kind).toBe("discard-hand");
    applyPendingChoiceSubmit(state, {
        playerId: pending.playerId,
        stackItemId: pending.stackItemId,
        step: pending.step,
        choiceId: pending.choiceId,
        cardInstanceIds: [cardInstanceId],
    });
}

describe("Fear of Missing Out (CR 603.2 ETB — discard then draw, issue #2421)", () => {
    it("cast normally: the discard-then-draw fires exactly once (no regression)", () => {
        const hand1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib1 = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [hand1], library: [lib1] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, fearOfMissingOut.id, "p1");
        resolveTopOfStack(state); // resolves the spell: creature enters, ETB trigger goes on the stack
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fear-of-missing-out-etb"
            )
        ).toBe(true);
        expect(resolveTopOfStack(state)).toBeNull(); // resolves the trigger, suspends on the discard choice
        submitDiscard(state, "h1");

        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(p1.hand.map((c) => c.id)).toEqual(["lib1"]);
        expect(p1.library).toHaveLength(0);
        // Fires exactly once — no leftover trigger for the same source.
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === "fear-of-missing-out-etb"
            )
        ).toHaveLength(0);
    });

    it("reanimation (non-cast entry, #2421 regression target): the ETB fires when put onto the battlefield from the graveyard", () => {
        const hand1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib1 = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const grave = makeInstance(fearOfMissingOut.id, {
            id: "graveyard-fomo",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [hand1],
                    library: [lib1],
                    graveyard: [grave],
                }),
                makePlayer("p2"),
            ],
        });

        state.players[0].graveyard = [];
        putReanimatedSetOnBattlefield(state, [
            { card: grave, controllerId: "p1" },
        ]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "graveyard-fomo")
        ).toBe(true);

        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the discard choice
        submitDiscard(state, "h1");

        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(p1.hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("blink (second non-cast entry path, exile-and-return): the ETB fires again on the returning object", () => {
        const hand1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib1 = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const fomo = makeInstance(fearOfMissingOut.id, {
            id: "fomo",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fomo],
                    hand: [hand1],
                    library: [lib1],
                }),
                makePlayer("p2"),
            ],
        });

        exileWithAttachments(state, "fomo", {
            sourceId: "blink-source",
            returnTapped: false,
        });
        expect(state.players[0].battlefield.some((c) => c.id === "fomo")).toBe(
            false
        );
        returnExiledForSource(state, "blink-source");
        expect(state.players[0].battlefield.some((c) => c.id === "fomo")).toBe(
            true
        );

        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the discard choice
        submitDiscard(state, "h1");

        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(p1.hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("the ETB ability is visible through the real client-facing projection (wire format)", () => {
        const fomo = makeInstance(fearOfMissingOut.id, {
            id: "fomo",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fomo] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "fomo",
                controllerId: "p1",
                cardId: fearOfMissingOut.id,
                types: ["Enchantment", "Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);

        const projected = projectPublicState(state, 1, "p1");
        const slimStack = projected.stack.find(
            (s) => s.triggeredAbilityId === "fear-of-missing-out-etb"
        );
        expect(slimStack).toBeDefined();
        expect(slimStack!.triggerSourceId).toBe("fomo");
    });
});

const MOUNTAIN = getCardByName("Mountain").id; // Land
const BEARS = getCardByName("Balduvian Bears").id; // Creature
const BOLT = getCardByName("Lightning Bolt").id; // Instant
const WRATH = getCardByName("Wrath of God").id; // Sorcery

/** Four DISTINCT card types among cards in p1's graveyard — delirium ON
 *  (CR 207.2c ability word; the threshold the card's own text states). */
function deliriumGraveyard(): CardInstanceState[] {
    return [MOUNTAIN, BEARS, BOLT, WRATH].map((cardId, i) =>
        makeInstance(cardId, {
            id: `gy${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        })
    );
}

const ATTACK_EVENT: GameEvent = {
    type: "ATTACKERS_DECLARED",
    attackingPlayerId: "p1",
    attackerIds: ["fomo"],
};

/** p1 attacks with Fear of Missing Out; p2 has a tapped creature to untap.
 *  `graveyard` decides whether delirium is on. */
function attackingBoard(graveyard: CardInstanceState[]): {
    state: GameState;
    fomo: CardInstanceState;
} {
    const fomo = makeInstance(fearOfMissingOut.id, {
        id: "fomo",
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
        isTapped: true,
    });
    const victim = makeInstance(BEARS, {
        id: "victim",
        controllerId: "p1",
        ownerId: "p1",
        isTapped: true,
    });
    const state = makeState({
        phase: "DECLARE_ATTACKERS",
        players: [
            makePlayer("p1", { battlefield: [fomo, victim], graveyard }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: ["fomo"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    return { state, fomo };
}

/** Drives the CR 603.3d target announcement through the REAL machinery — the
 *  `kind:"trigger"` PendingTarget raised by the GRE, finalized by `game.ts`. */
function announceTarget(state: GameState, targetId: string): void {
    expect(raiseTriggerTargetSelection(state)).toBe(true);
    state.pendingTarget!.selected = [{ type: "permanent", id: targetId }];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Fear of Missing Out — delirium attack trigger (CR 508.1m / 603.4 / 500.8)", () => {
    it("does not trigger at all when delirium is off at check time (CR 603.4)", () => {
        // Three distinct types only — one short of delirium.
        const { state } = attackingBoard(deliriumGraveyard().slice(0, 3));
        expect(collectTriggers(state, [ATTACK_EVENT])).toHaveLength(0);
    });

    it("triggers on the attack when delirium is on, and untaps the announced target plus queues an additional combat phase (CR 500.8)", () => {
        const { state } = attackingBoard(deliriumGraveyard());
        const triggers = collectTriggers(state, [ATTACK_EVENT]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        announceTarget(state, "victim");

        expect(resolveTopOfStack(state)).not.toBeNull();

        const victim = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(victim.isTapped).toBe(false);
        expect(state.extraPhases).toEqual([{ kind: "combat" }]);

        // SURFACE (wire format): the untap must survive the projection the
        // client actually renders — a hand-built view would not prove it.
        const projected = projectPublicState(state, 1, "p1");
        const projectedVictim = projected.players[0].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(projectedVictim.isTapped).toBe(false);
    });

    it("is removed from the stack with NO untap and NO extra combat when delirium turns off before it resolves (CR 603.4)", () => {
        const { state } = attackingBoard(deliriumGraveyard());
        const triggers = collectTriggers(state, [ATTACK_EVENT]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        announceTarget(state, "victim");

        // Delirium falls to three card types while the trigger is on the
        // stack (the Sorcery leaves the graveyard).
        state.players[0].graveyard = state.players[0].graveyard.filter(
            (c) => c.id !== "gy3"
        );

        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);

        const victim = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(victim.isTapped).toBe(true);
        expect(state.extraPhases ?? []).toEqual([]);
    });

    it("triggers only for the FIRST attack each turn, so the extra combat it created does not fire it again (CR 603.2)", () => {
        const { state } = attackingBoard(deliriumGraveyard());
        expect(collectTriggers(state, [ATTACK_EVENT])).toHaveLength(1);
        // Same turn, second combat phase, same permanent re-declared.
        expect(collectTriggers(state, [ATTACK_EVENT])).toHaveLength(0);
    });

    it("does not fire when a DIFFERENT creature attacks alone (CR 508.1m, self-scoped)", () => {
        const { state } = attackingBoard(deliriumGraveyard());
        expect(
            collectTriggers(state, [
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: ["victim"],
                },
            ])
        ).toHaveLength(0);
    });
});

// --- Enduring Courage — entry-triggered pump + haste (issue #2085) ----------
//
// A pure DSL card on already-exercised Ops (`pump`, `grantAbility`), so the
// catalogue sweep and the generated smoke test cover its BODY. What they cannot
// see is that the two Ops land on the TRIGGERING permanent — the censused
// `$event.instanceId` object ref (ADR 0049) — rather than on the source or on
// nothing at all, which is exactly the failure mode a passing static sweep
// hides. Driven through the real cast → entry → trigger-scan → resolve path.

describe("Enduring Courage — whenever another creature you control enters (CR 603.6a, issue #2085)", () => {
    function boardWithCourage(): GameState {
        const courage = makeInstance(enduringCourage.id, {
            id: "courage",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [courage] }),
                makePlayer("p2"),
            ],
        });
    }

    /** Casts `cardId` for `playerId` and runs the resulting entry trigger to
     *  resolution — the production path, not a synthetic event. */
    function castAndResolve(
        state: GameState,
        cardId: string,
        playerId: string
    ): CardInstanceState {
        pushSpell(state, cardId, playerId);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const player = state.players.find((p) => p.id === playerId)!;
        return player.battlefield.find(
            (c) =>
                (c.card as { id?: string }).id === cardId && c.id !== "courage"
        )!;
    }

    it("gives the ENTERING creature +2/+0 and haste until end of turn", () => {
        const state = boardWithCourage();

        const bears = castAndResolve(state, grizzlyBears.id, "p1");

        // CR 613.4c layer 7c — a 2/2 becomes a 4/2, toughness untouched.
        expect(getEffectivePower(state, bears)).toBe(4);
        expect(getEffectiveToughness(state, bears)).toBe(2);
        // CR 613.1f layer 6 / 702.10a — haste on the creature that entered.
        expect(bears.staticAbilities).toContain("haste");
    });

    it("does not pump Enduring Courage itself — 'ANOTHER creature you control'", () => {
        const state = boardWithCourage();

        castAndResolve(state, grizzlyBears.id, "p1");

        const courage = state.players[0].battlefield.find(
            (c) => c.id === "courage"
        )!;
        expect(getEffectivePower(state, courage)).toBe(3);
        expect(courage.staticAbilities).not.toContain("haste");
    });

    it("does not fire for an opponent's creature (CR 109.5 — 'you control')", () => {
        const state = boardWithCourage();

        const theirs = castAndResolve(state, grizzlyBears.id, "p2");

        expect(getEffectivePower(state, theirs)).toBe(2);
        expect(theirs.staticAbilities).not.toContain("haste");
        expect(state.stack).toHaveLength(0);
    });
});
