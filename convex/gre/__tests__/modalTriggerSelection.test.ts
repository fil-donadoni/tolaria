// CR 700.2 / 603.3c — a modal TRIGGERED ability declaring a `ModeSelection`
// ("choose three —"): the announcement raises the count, every chosen mode's
// targets are announced as the ability goes on the stack (CR 603.3d / 700.2c),
// and the instances run in printed order, each on its own slice of the targets.

import { afterEach, describe, it, expect } from "vitest";
import type { GameState } from "../state";
import { resolveTopOfStack } from "../state";
import { raiseTriggerTargetSelection } from "../rules";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { legalActions } from "../legalActions";
import { compactState, expandState } from "../serialize";
import { findPermanent } from "../lookup";
import {
    advanceTargetGroupOrFinalize,
    cancelTriggerTargetSelection,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    bear,
    CHOOSE_THREE,
    MODES,
    modalBoard,
    modalTriggerCard,
    releaseModalTriggerCards,
} from "./modalTriggerSelection.fixture";

afterEach(releaseModalTriggerCards);

function submit(state: GameState, ids: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

const isTapped = (state: GameState, id: string) =>
    findPermanent(state, id)?.isTapped;

describe("modal trigger cardinality — the announcement (CR 603.3c)", () => {
    it("raises the declared count over the choosable modes, before any target", () => {
        const { state, trig } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("trigger-mode");
        expect(head.count).toBe(3);
        expect(head.options?.map((o) => o.id)).toEqual(MODES.map((m) => m.id));
        expect(head.options?.[0].oracleText).toBe("You gain 2 life.");
        expect(trig.targets).toBeUndefined();
        expect(state.pendingTarget).toBeUndefined();
    });

    it("crosses the wire projection with its count and options intact", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.count).toBe(3);
        expect(head.options?.map((o) => o.oracleText)).toEqual(
            MODES.map((m) => m.oracleText)
        );
    });

    it("legal actions are one per announceable list", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        const actions = legalActions(state);
        expect(actions).toHaveLength(4); // C(4, 3)
    });

    it("a mode with no legal target is not offered (CR 700.2b)", () => {
        // No creature anywhere: `tap` and `untap` have no legal target.
        const sixModes = [
            ...MODES,
            { ...MODES[0], id: "gain-b" },
            { ...MODES[0], id: "gain-c" },
        ];
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE, sixModes));
        raiseTriggerTargetSelection(state);
        expect(state.pendingChoices![0].options?.map((o) => o.id)).toEqual([
            "gain",
            "draw",
            "gain-b",
            "gain-c",
        ]);
    });

    it("exactly the minimum choosable announces them with no prompt", () => {
        const threeModes = MODES.filter((m) => m.id !== "untap");
        const { state, trig } = modalBoard(
            modalTriggerCard(CHOOSE_THREE, threeModes),
            { p2: [bear("b", "p2")] }
        );
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(trig.chosenModeIds).toEqual(["gain", "tap", "draw"]);
        expect(trig.targets).toEqual([{ type: "permanent", id: "b" }]);
        expect(trig.modeTargetCounts).toEqual([0, 1, 0]);
    });

    it("fewer choosable modes than the minimum removes the ability (CR 603.3d)", () => {
        // No creature anywhere: only `gain` and `draw` can be chosen.
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE));
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("a range offers every size within it", () => {
        const { state } = modalBoard(
            modalTriggerCard({ min: 1, max: 2 }, [MODES[0], MODES[3]])
        );
        raiseTriggerTargetSelection(state);
        expect(state.pendingChoices![0].count).toEqual({ min: 1, max: 2 });
        expect(legalActions(state)).toHaveLength(3);
    });

    it("a conditional count reads the announcer's board", () => {
        const card = modalTriggerCard(
            {
                min: 1,
                max: 1,
                when: {
                    condition: { controls: { types: ["Creature"] } },
                    min: 2,
                    max: 2,
                },
            },
            MODES
        );
        const without = modalBoard(card, { p2: [bear("b", "p2")] });
        raiseTriggerTargetSelection(without.state);
        expect(without.state.pendingChoices![0].count).toBe(1);
        const withBear = modalBoard(card, { p1: [bear("a", "p1")] });
        raiseTriggerTargetSelection(withBear.state);
        expect(withBear.state.pendingChoices![0].count).toBe(2);
    });
});

describe("modal trigger cardinality — the submission (CR 700.2d)", () => {
    it("refuses a repeat the list does not allow, and a wrong count", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        expect(() => submit(state, ["gain", "gain", "draw"])).toThrow(
            /more than once/
        );
        expect(() => submit(state, ["gain", "draw"])).toThrow(/at least 3/);
        expect(() => submit(state, ["gain", "tap", "untap", "draw"])).toThrow(
            /at most 3/
        );
        expect(() => submit(state, ["gain", "tap", "nope"])).toThrow(
            /Not a legal mode/
        );
    });

    it("a repeats list accepts the same mode, in sequence", () => {
        const { state, trig } = modalBoard(
            modalTriggerCard({ min: 3, max: 3, repeats: true }, [
                MODES[0],
                MODES[3],
            ])
        );
        raiseTriggerTargetSelection(state);
        expect(state.pendingChoices![0].modeRepeats).toBe(true);
        submit(state, ["draw", "gain", "draw"]);
        expect(trig.chosenModeIds).toEqual(["gain", "draw", "draw"]);
        resolveTopOfStack(state);
        const me = state.players[0];
        expect(me.life).toBe(22);
        expect(me.hand).toHaveLength(2);
    });

    it("a repeats list with one choosable mode fills every slot with no prompt", () => {
        const { state, trig } = modalBoard(
            modalTriggerCard({ min: 3, max: 3, repeats: true }, [
                MODES[0],
                MODES[1],
            ])
        );
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.chosenModeIds).toEqual(["gain", "gain", "gain"]);
    });
});

describe("modal trigger cardinality — targets and resolution (CR 700.2c)", () => {
    it("runs the instances in printed order, whatever the submission's order", () => {
        const { state, trig } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        submit(state, ["untap", "gain", "tap"]);
        expect(trig.chosenModeIds).toEqual(["gain", "tap", "untap"]);
        // CR 700.2d — both instances may target the same object; each group
        // has one legal target, so each auto-selects.
        expect(trig.targets).toEqual([
            { type: "permanent", id: "b" },
            { type: "permanent", id: "b" },
        ]);
        expect(trig.modeTargetCounts).toEqual([0, 1, 1]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
        // Tap, then untap. The reverse order would leave it tapped.
        expect(isTapped(state, "b")).toBe(false);
    });

    it("walks a real target choice per instance, each reading its own slice", () => {
        const { state, trig } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("x", "p2"), bear("y", "p2", true)],
        });
        raiseTriggerTargetSelection(state);
        submit(state, ["gain", "tap", "untap"]);

        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        expect(pt.groupModeInstances).toEqual([1, 2]);
        expect(pt.chosenModeIds).toEqual(["gain", "tap", "untap"]);

        pt.selected = [{ type: "permanent", id: "x" }];
        advanceTargetGroupOrFinalize(state, pt, "p1");
        expect(state.pendingTarget?.groupModeInstances).toEqual([2]);
        const next = state.pendingTarget!;
        next.selected = [{ type: "permanent", id: "y" }];
        advanceTargetGroupOrFinalize(state, next, "p1");

        expect(state.pendingTarget).toBeUndefined();
        expect(trig.targets).toEqual([
            { type: "permanent", id: "x" },
            { type: "permanent", id: "y" },
        ]);
        expect(trig.modeTargetCounts).toEqual([0, 1, 1]);
        resolveTopOfStack(state);
        expect(isTapped(state, "x")).toBe(true);
        expect(isTapped(state, "y")).toBe(false);
    });

    it("a mandatory group's selection declined removes the whole ability", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("x", "p2"), bear("y", "p2")],
        });
        raiseTriggerTargetSelection(state);
        submit(state, ["gain", "tap", "untap"]);
        cancelTriggerTargetSelection(state);
        expect(state.stack).toHaveLength(0);
    });

    it("targetless instances resolve with no target list at all", () => {
        const { state, trig } = modalBoard(
            modalTriggerCard({ min: 2, max: 2 }, [
                MODES[0],
                MODES[3],
                { ...MODES[0], id: "gain-again" },
            ])
        );
        raiseTriggerTargetSelection(state);
        submit(state, ["gain", "draw"]);
        expect(trig.targets).toBeUndefined();
        expect(trig.modeTargetCounts).toEqual([0, 0]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("the spans and the raised count survive the snapshot round trip", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("x", "p2"), bear("y", "p2", true)],
        });
        raiseTriggerTargetSelection(state);
        const raised = expandState(compactState(state));
        expect(raised.pendingChoices![0].count).toBe(3);
        submit(raised, ["gain", "tap", "untap"]);

        const parked = expandState(compactState(raised));
        const pt = parked.pendingTarget!;
        expect(pt.groupModeInstances).toEqual([1, 2]);
        pt.selected = [{ type: "permanent", id: "x" }];
        advanceTargetGroupOrFinalize(parked, pt, "p1");
        const second = expandState(compactState(parked));
        const pt2 = second.pendingTarget!;
        pt2.selected = [{ type: "permanent", id: "y" }];
        advanceTargetGroupOrFinalize(second, pt2, "p1");

        const final = expandState(compactState(second));
        expect(final.stack[0].modeTargetCounts).toEqual([0, 1, 1]);
        resolveTopOfStack(final);
        expect(isTapped(final, "x")).toBe(true);
        expect(isTapped(final, "y")).toBe(false);
    });
});
