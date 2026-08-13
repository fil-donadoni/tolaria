// nph blue — Gitaxian Probe (private look + draw, {U/P}) and Phyrexian
// Metamorph (copy-on-ETB Clone variant, {3}{U/P}). Both exercise the
// Phyrexian-mana cost (CR 107.4f); the generic cost-system pieces are covered
// in convex/gre/__tests__/phyrexian.test.ts. Deceiver Exarch's MODAL ETB
// trigger (CR 603.3c — untap yours / tap an opponent's) is covered here too.
import { describe, it, expect } from "vitest";
import { deceiverExarch, gitaxianProbe, phyrexianMetamorph } from "../blue";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { driveCopyChoice } from "../../lea/__tests__/helpers";
import { finalizeTargetSelection } from "../../../../game";
import { resolveTopOfStack } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { enumerateMoves } from "../../../../gre/moves";
import { applyMoveForSearch } from "../../../../gre/applyMove";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

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

// Deceiver Exarch — the catalogue's MODAL triggered ability (CR 603.3c, issue
// #2461): "When this creature enters, choose one — • Untap target permanent you
// control. • Tap target permanent an opponent controls." Each mode carries its
// own controller-filtered `targetRequirement` and its own Effect Script; the
// controller announces the mode as the trigger is put on the stack, BEFORE
// targets, and only the chosen mode's requirement constrains them (CR 700.2d).
// The engine-side rules that make that true are covered generically in
// `gre/__tests__/modalTriggers.test.ts`; this block is the card's own end-to-end
// proof that both arms actually fire.
describe("Deceiver Exarch ETB (modal: untap yours / tap an opponent's, CR 603.3c)", () => {
    /** Puts the ETB trigger on the stack un-announced (no mode, no targets) and
     *  runs the CR 603.3c announcement sweep — exactly what
     *  `placeTriggersOnStack` does for a real ETB. Returns the on-stack item and
     *  whether the sweep suspended on a player decision. */
    function announceEtb(state: GameState, exarch: StackItem) {
        const trig: StackItem = {
            ...exarch,
            id: "exarch-trig",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "deceiver-exarch-etb",
            triggerSourceId: exarch.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: exarch.id,
                controllerId: "p1",
                types: ["Creature"],
            } as StackItem["triggerEvent"],
        };
        state.stack.push(trig);
        const suspended = raiseTriggerTargetSelection(state);
        return { trig, suspended };
    }

    /** Submits the head `trigger-mode` choice through the SAME entry point the
     *  `submitResolutionChoice` mutation uses. */
    function announceMode(state: GameState, modeId: string) {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [modeId],
        });
    }

    function board(opts: {
        /** p1's board besides the Exarch itself. */
        ownTapped?: boolean;
        /** p2 controls an untapped Grizzly Bears. */
        opponentPermanent?: boolean;
        /** The Exarch itself is on the battlefield (it normally is — its ETB
         *  trigger is on the stack while the creature is in play). */
        exarchInPlay?: boolean;
    }) {
        const exarch = makeInstance(deceiverExarch.id, {
            id: "exarch",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ownBear = makeInstance(grizzlyBears.id, {
            id: "own-bear",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const theirBear = makeInstance(grizzlyBears.id, {
            id: "their-bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        ...(opts.exarchInPlay === false ? [] : [exarch]),
                        ...(opts.ownTapped ? [ownBear] : []),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: opts.opponentPermanent ? [theirBear] : [],
                }),
            ],
            activePlayerId: "p1",
        });
        return { state, exarch: exarch as StackItem, ownBear, theirBear };
    }

    it("announces the mode before targets; the tap arm taps the opponent's permanent", () => {
        // Both modes are choosable (the Exarch itself is a legal untap target,
        // the opponent's bear a legal tap target), so a real choice is owed.
        const { state, exarch, theirBear } = board({ opponentPermanent: true });
        const { trig, suspended } = announceEtb(state, exarch);
        expect(suspended).toBe(true);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("trigger-mode");
        expect(head.playerId).toBe("p1");
        expect(head.options?.map((o) => o.id)).toEqual([
            "untap-yours",
            "tap-theirs",
        ]);
        // CR 700.2d — no target is chosen before the mode is.
        expect(trig.targets).toBeUndefined();
        expect(state.pendingTarget).toBeUndefined();

        announceMode(state, "tap-theirs");
        expect(trig.chosenModeId).toBe("tap-theirs");
        // The opponent's bear is the ONLY legal target UNDER THIS MODE, so it
        // auto-selects. It would not if the Exarch's own untap requirement
        // still applied — that is CR 700.2d in one assertion.
        expect(trig.targets).toEqual([{ type: "permanent", id: "their-bear" }]);
        expect(state.pendingChoices).toBeUndefined();

        resolveTopOfStack(state);
        expect(theirBear.isTapped).toBe(true);
        // Tap state is board-visible, so it must survive the projection the
        // client actually reads (wire-format row of the card-testing table).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "their-bear"
        )!;
        expect(slim.isTapped).toBe(true);
    });

    it("the untap arm untaps the chosen own permanent", () => {
        const { state, exarch, ownBear } = board({
            ownTapped: true,
            opponentPermanent: true,
        });
        const { trig } = announceEtb(state, exarch);
        announceMode(state, "untap-yours");
        expect(trig.chosenModeId).toBe("untap-yours");
        // Two legal targets under this mode (the Exarch and the tapped bear),
        // so the controller is prompted through the ordinary trigger
        // PendingTarget rather than auto-selected.
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        expect(pt.cardInstanceId).toBe(trig.id);
        pt.selected = [{ type: "permanent", id: "own-bear" }];
        finalizeTargetSelection(state, pt, "p1");

        resolveTopOfStack(state);
        expect(ownBear.isTapped).toBe(false);
    });

    it("CR 603.3c — a mode with no legal target can't be chosen, so a sole choosable mode is announced with no prompt", () => {
        // The opponent controls nothing, so the tap mode is illegal; only the
        // untap mode remains and the engine announces it without asking.
        const { state, exarch, ownBear } = board({ ownTapped: true });
        const { trig } = announceEtb(state, exarch);
        expect(state.pendingChoices).toBeUndefined();
        expect(trig.chosenModeId).toBe("untap-yours");
        const pt = state.pendingTarget!;
        pt.selected = [{ type: "permanent", id: "own-bear" }];
        finalizeTargetSelection(state, pt, "p1");
        resolveTopOfStack(state);
        expect(ownBear.isTapped).toBe(false);
    });

    it("CR 603.3c — with no choosable mode the trigger is removed from the stack", () => {
        // The Exarch died in response, so neither player controls a permanent:
        // both modes are illegal, no mode is chosen, the ability does nothing.
        const { state, exarch } = board({ exarchInPlay: false });
        const { suspended } = announceEtb(state, exarch);
        expect(suspended).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingTarget).toBeUndefined();
    });
});
