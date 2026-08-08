// Per-card behavior tests for red cards in `convex/cards/sets/clb/red.ts`
// (CLB, split by colour per ADR 0043). Fixture builders live in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import type { CardType } from "../../../types";
import { gutTrueSoulZealot } from "../red";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type PlayerState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { emitAttackersDeclaredEvents } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { tokenPrintIdFor } from "../../../tokenPrintLookup";
import { getDefinition } from "../../../index";

/** Declares `attackerIds` as attackers through the REAL production entry
 *  point (`emitAttackersDeclaredEvents`, CR 508.1) rather than hand-building
 *  the trigger stack item — see Adeline's suite (`sets/mid/__tests__/
 *  white.test.ts`) for the same rationale: a hand-built stack item never
 *  runs `collectTriggers`, so `matches` is never actually exercised. */
function declareAttackers(state: GameState, attackerIds: string[]): void {
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
}

function setupState(p1Overrides: Partial<PlayerState> = {}): GameState {
    return makeState({
        players: [makePlayer("p1", p1Overrides), makePlayer("p2")],
    });
}

/** A generic artifact permanent (any base creature card, its `types`
 *  overridden) — the `atq/__tests__` fixture convention for a minimal
 *  artifact when no bespoke definition is needed. */
function artifactFixture(id: string): ReturnType<typeof makeInstance> {
    return makeInstance(grizzlyBears.id, {
        id,
        types: ["Artifact"] as CardType[],
        subtypes: [],
        power: undefined,
        toughness: undefined,
    });
}

function skeletonTokens(state: GameState) {
    return state.players[0].battlefield.filter(
        (c) => c.isToken && c.subtypes?.includes("Skeleton")
    );
}

describe("Gut, True Soul Zealot attack trigger (CR 508.1) — optional sacrifice, 'if you do'", () => {
    it("fires when you attack even if Gut herself doesn't (CR ruling: Gut doesn't have to attack)", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const other = makeInstance(grizzlyBears.id, { id: "other" });
        const state = setupState({ battlefield: [gut, other] });

        declareAttackers(state, [other.id]);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "gut-true-soul-zealot-attack-sacrifice"
        );
    });

    it("does NOT fire when the opponent attacks (matches the ATTACKING player, not attacker identity)", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const oppAttacker = makeInstance(grizzlyBears.id, {
            id: "opp-attacker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gut] }),
                makePlayer("p2", { battlefield: [oppAttacker] }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });

        declareAttackers(state, [oppAttacker.id]);
        expect(state.stack).toHaveLength(0);
    });

    it("with NO other creature/artifact to sacrifice, resolves as a no-op (min:0 clamps to 0 available)", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const state = setupState({ battlefield: [gut] });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(skeletonTokens(state)).toHaveLength(0);
    });

    it("offers the OPTIONAL sacrifice (min:0) and DECLINING creates no token", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const fodder = makeInstance(grizzlyBears.id, { id: "fodder" });
        const state = setupState({ battlefield: [gut, fodder] });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const head = state.pendingChoices?.[0];
        expect(head).toBeDefined();
        expect(head!.kind).toBe("sacrifice-permanents");
        expect(head!.count).toEqual({ min: 0, max: 1 });

        // Decline: submit an empty pick.
        applyPendingChoiceSubmit(state, {
            playerId: head!.playerId,
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: [],
        });

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(skeletonTokens(state)).toHaveLength(0);
        // The declined fodder is still alive.
        expect(
            state.players[0].battlefield.some((c) => c.id === fodder.id)
        ).toBe(true);
    });

    it("sacrificing ANOTHER creature creates a tapped-and-attacking 4/1 black Skeleton with menace", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const fodder = makeInstance(grizzlyBears.id, { id: "fodder" });
        const state = setupState({ battlefield: [gut, fodder] });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [fodder.id],
        });

        // The sacrificed creature is gone.
        expect(
            state.players[0].battlefield.some((c) => c.id === fodder.id)
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.card.id === fodder.card.id)
        ).toBe(true);

        const tokens = skeletonTokens(state);
        expect(tokens).toHaveLength(1);
        const token = tokens[0];
        expect(token.power).toBe(4);
        expect(token.toughness).toBe(1);
        // Tokens carry no real `colors` field on their synthesized
        // definition — color is derived from a synthetic black mana-cost
        // pip `createTokenPermanents` (`gre/state.ts`) registers from
        // `TokenSpec.colors`, the same indirection every colored token uses.
        expect(getDefinition(token.card.id as string).manaCost).toEqual({
            B: 1,
        });
        expect(token.staticAbilities).toContain("menace");
        expect(token.controllerId).toBe("p1");
        // CR 508.4 — enters ALREADY tapped and ALREADY attacking.
        expect(token.isTapped).toBe(true);
        expect(token.isAttacking).toBe(true);
        expect(state.combat?.attackerIds).toContain(token.id);
    });

    it("sacrificing an ARTIFACT (the disjunctive 'or') also creates the Skeleton", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const rock = artifactFixture("rock");
        const state = setupState({ battlefield: [gut, rock] });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [rock.id],
        });

        expect(state.players[0].battlefield.some((c) => c.id === rock.id)).toBe(
            false
        );
        expect(skeletonTokens(state)).toHaveLength(1);
    });

    it("Gut itself is NOT a legal sacrifice pick (CR 602.1 'another')", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const fodder = makeInstance(grizzlyBears.id, { id: "fodder" });
        const state = setupState({ battlefield: [gut, fodder] });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [gut.id],
            })
        ).toThrow("Card does not match the required filter");
    });

    it("wires the Skeleton's art from the reverse-linked Scryfall lockfile (CR 111)", () => {
        const expected = tokenPrintIdFor(gutTrueSoulZealot.id, "Skeleton");
        expect(expected).toBeDefined();
    });
});

describe("Gut, True Soul Zealot attack trigger — wire format (projectPublicState)", () => {
    it("the created token's stats, menace and attacking status survive the projection", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const fodder = makeInstance(grizzlyBears.id, { id: "fodder" });
        const state = setupState({ battlefield: [gut, fodder] });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [fodder.id],
        });

        const token = skeletonTokens(state)[0];
        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;

        expect(slimToken.power).toBe(4);
        expect(slimToken.toughness).toBe(1);
        expect(slimToken.staticAbilities).toContain("menace");
        expect(slimToken.isTapped).toBe(true);
        expect(slimToken.isAttacking).toBe(true);
    });
});
