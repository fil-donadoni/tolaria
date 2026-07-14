// nph blue — Gitaxian Probe (private look + draw, {U/P}) and Phyrexian
// Metamorph (copy-on-ETB Clone variant, {3}{U/P}). Both exercise the
// Phyrexian-mana cost (CR 107.4f); the generic cost-system pieces are covered
// in convex/gre/__tests__/phyrexian.test.ts.
import { describe, it, expect } from "vitest";
import { gitaxianProbe, phyrexianMetamorph } from "../blue";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { driveCopyChoice } from "../../lea/__tests__/helpers";
import { finalizeTargetSelection } from "../../../../game";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { enumerateMoves } from "../../../../gre/moves";
import { applyMoveForSearch } from "../../../../gre/applyMove";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState } from "../../../../gre/state";

describe("Gitaxian Probe (look at target player's hand, draw; {U/P}, CR 107.4f)", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find((s) => s.id === head.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    function castAtOpponent() {
        const probe = makeInstance(gitaxianProbe.id, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const top = makeInstance(grizzlyBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const oppHand = [
            makeInstance(grizzlyBears.id, {
                id: "oh1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [probe], library: [top] }),
                makePlayer("p2", { hand: oppHand }),
            ],
        });
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "probe",
            targetType: "player",
            count: 1,
            selected: [{ type: "player", id: "p2" }],
        };
        finalizeTargetSelection(state, state.pendingTarget!, "p1");
        return state;
    }

    it("pays the {U/P} pip with 2 life by default, then looks and draws", () => {
        const state = castAtOpponent();
        // {U/P} paid with 2 life (no blue mana available).
        expect(state.players[0].life).toBe(18);
        // Resolve: suspends on the reveal-hand look, then re-resolves.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("reveal-hand");
        commitHead(state, []);
        resolveTopOfStack(state);
        // Drew a card: the library card is now in hand (the spell itself went to
        // the graveyard).
        expect(state.players[0].hand.some((c) => c.id === "top")).toBe(true);
        // The look stamped p2's hand knownTo the caster only (CR 401.4).
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);
    });

    it("wire format: the look survives projection AND stays private (mandatory)", () => {
        const state = castAtOpponent();
        resolveTopOfStack(state);
        commitHead(state, []);
        resolveTopOfStack(state);
        // The caster (p1) sees p2's known hand card as the real card.
        const forP1 = projectPublicState(state, 1, "p1");
        expect(forP1.players[1].hand[0]?.id).toBe("oh1");
        // Privacy (CR 701.18a — a private LOOK, not a public reveal): a viewer
        // who is NOT the caster never sees p2's hand card. Had the card used the
        // all-players `reveal` op instead of `markKnown(controller)`, this slot
        // would leak the real id. A non-participant spectator stands in for "any
        // other viewer" (p2 owns the hand and sees it natively).
        const forOther = projectPublicState(state, 1, "spectator");
        expect(forOther.players[1].hand[0]).toBeNull();
    });
});

describe("Phyrexian Metamorph (copy artifact/creature, {3}{U/P}, CR 707.2 / 107.4f)", () => {
    it("enters as a copy of a creature, staying an artifact", () => {
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
        const item = makeInstance(phyrexianMetamorph.id, {
            id: "metamorph",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        state.stack.push({
            ...item,
            zone: "stack",
            castById: "p1",
            targets: [],
        });
        driveCopyChoice(state, state.stack[0], "bear");
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "metamorph"
        )!;
        expect(copy).toBeDefined();
        // Copies the creature's P/T and keeps Artifact in addition (CR 707.9d).
        expect(getEffectivePower(state, copy)).toBe(2);
        expect(getEffectiveToughness(state, copy)).toBe(2);
        expect(copy.types).toContain("Creature");
        expect(copy.types).toContain("Artifact");
    });

    it("wire format: the copied P/T survives projection (mandatory)", () => {
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
        const item = makeInstance(phyrexianMetamorph.id, {
            id: "metamorph",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        state.stack.push({
            ...item,
            zone: "stack",
            castById: "p1",
            targets: [],
        });
        driveCopyChoice(state, state.stack[0], "bear");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "metamorph"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });

    it("no-target cast pays the {U/P} pip with 2 life (bot move path)", () => {
        // 20 life, {3} available but no blue mana → the Bot's cast move pays the
        // Phyrexian pip with 2 life (default split).
        const metamorph = makeInstance(phyrexianMetamorph.id, {
            id: "metamorph",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // A creature on the board so the copy-on-ETB Bot prune (#938) doesn't
        // suppress the cast (Metamorph has nothing to copy otherwise).
        const decoy = makeInstance(grizzlyBears.id, {
            id: "decoy",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    hand: [metamorph],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
                makePlayer("p2", { battlefield: [decoy] }),
            ],
        });
        const castMove = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "metamorph"
        );
        expect(castMove).toBeDefined();
        expect(
            castMove!.kind === "cast-spell" ? castMove!.payLife : undefined
        ).toBe(2);
        const next = applyMoveForSearch(state, "p1", castMove!);
        expect(next.players[0].life).toBe(18);
    });
});
