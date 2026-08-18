// Theros Beyond Death (THB) — blue behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { thassasOracle } from "../blue";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

const FOREST = getCardByName("Forest").id;

function libCard(id: string, owner: string): CardInstanceState {
    return makeInstance(FOREST, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "library",
    });
}

/** A Thassa's Oracle permanent on the battlefield — the ETB fixtures below
 *  all use its OWN mana cost ({U}{U} = devotion 2) as the board's only
 *  devotion source, so `pushEtb` can trigger off it directly. */
function bluePermanent(id: string, owner: string): CardInstanceState {
    return makeInstance(thassasOracle.id, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });
}

/** Puts Thassa's Oracle's ETB trigger on the stack WITHOUT resolving it —
 *  mirrors `colorless.test.ts`'s `pushTrigger` (no target selection needed:
 *  the ability has no `TargetRequirement`). */
function pushEtb(state: GameState, source: CardInstanceState): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "thassas-oracle-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: ["Creature"],
        },
    } as StackItem);
}

function submitKeep(state: GameState, keep: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: keep,
    });
}

describe("Thassa's Oracle (CR 401.4 / 700.5 / 104.2a, issue #2070)", () => {
    it("declares the card and its ETB trigger", () => {
        expect(getCardByName("Thassa's Oracle")).toBe(thassasOracle);
        expect(thassasOracle.manaCost).toEqual({ U: 2 });
        expect(thassasOracle.power).toBe(1);
        expect(thassasOracle.toughness).toBe(3);
        expect(thassasOracle.triggeredAbilities).toHaveLength(1);
    });

    it("wins immediately when the library is empty (X >= 0 cards)", () => {
        const oracle = bluePermanent("oracle-empty-lib", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [oracle], library: [] }),
                makePlayer("p2"),
            ],
        });
        pushEtb(state, oracle);
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it("does NOT win with a library bigger than devotion, and puts the kept card on TOP", () => {
        const oracle = bluePermanent("oracle-big-lib", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [oracle],
                    library: [
                        libCard("c1", "p1"),
                        libCard("c2", "p1"),
                        libCard("c3", "p1"),
                        libCard("c4", "p1"),
                        libCard("c5", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushEtb(state, oracle);
        // Devotion is 2 ({U}{U}) — look at the top 2, suspend on the pick.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.keepTo).toBe("library-top");
        expect(head.candidateIds).toEqual(["c1", "c2"]);

        submitKeep(state, ["c2"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.gameOver).toBeUndefined();
        // "c2" is kept on the true TOP; nothing left the library (5 cards
        // total, still); "c1" (un-kept, random bottom) is somewhere below.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library[0].id).toBe("c2");
        expect(state.players[0].library).toHaveLength(5);
        expect(state.players[0].library.map((c) => c.id)).toContain("c1");
    });

    it("declining the optional keep still bottoms both looked-at cards and re-checks the win condition", () => {
        const oracle = bluePermanent("oracle-decline", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [oracle],
                    library: [libCard("c1", "p1"), libCard("c2", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        pushEtb(state, oracle);
        expect(resolveTopOfStack(state)).toBeNull();
        submitKeep(state, []); // "you may" — decline the keep entirely
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // Devotion (2) >= library count (still 2, nothing left) — wins even
        // on a decline.
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it("recomputes devotion AT RESOLUTION — a dead Oracle no longer contributes its own {U}{U} (CR 608.2b)", () => {
        const oracle = bluePermanent("oracle-dead", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [oracle],
                    library: [libCard("c1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        pushEtb(state, oracle);
        // Simulate the Oracle dying in response to its own trigger (e.g. a
        // removal spell resolved first) — the source leaves the battlefield
        // BEFORE this trigger resolves. With no other blue permanent,
        // devotion at resolution is 0, not 2.
        state.players[0].battlefield = [];
        resolveTopOfStack(state);
        // look <= 0 (devotion 0) — the lookDistribute leg is a no-op (CR
        // 608.2b, no suspend); devotion (0) is NOT >= library count (1), so
        // the game does not end. A version that read devotion BEFORE the
        // Oracle died (2) would incorrectly win here (2 >= 1).
        expect(state.gameOver).toBeUndefined();
        expect(state.players[0].library).toHaveLength(1);
    });
});
