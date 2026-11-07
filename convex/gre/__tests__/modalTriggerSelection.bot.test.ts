// CR 700.2 / 603.3c — the Bot half of a modal trigger declaring a
// `ModeSelection`: every candidate is a submission the announcement accepts,
// the choice node keeps the strongest lists rather than the first printed, and
// a target group is signed by the mode instance that owns it.

import { afterEach, describe, it, expect } from "vitest";
import { raiseTriggerTargetSelection } from "../rules";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { enumerateMoves } from "../moves";
import { choiceCandidates, CHOICE_TOP_K } from "../ai/choiceCandidates";
import { misdirectedTargetCount } from "../ai/beneficence";
import type { AbilityMode } from "../../cards/types";
import {
    bear,
    CHOOSE_THREE,
    MODES,
    modalBoard,
    modalTriggerCard,
    releaseModalTriggerCards,
} from "./modalTriggerSelection.fixture";

afterEach(releaseModalTriggerCards);

/** Six modes: `draw-big` is by far the strongest and printed LAST, so a truncation
 *  in printed order loses it. */
const SIX_MODES: AbilityMode[] = [
    ...["a", "b", "c", "d", "e"].map((id) => ({
        id,
        label: id,
        oracleText: `${id}.`,
        effects: [
            {
                op: "gainLife" as const,
                player: "controller" as const,
                amount: 1,
            },
        ],
    })),
    {
        id: "draw-big",
        label: "Draw three cards",
        oracleText: "Draw three cards.",
        effects: [
            { op: "draw" as const, player: "controller" as const, count: 3 },
        ],
    },
];

describe("modal trigger cardinality — the Bot answers it (CR 700.2)", () => {
    it("candidates are exactly the announceable lists, each accepted by the submit", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        const choice = state.pendingChoices![0];
        const candidates = choiceCandidates(state, choice);
        expect(candidates.map((c) => c.key).sort()).toEqual(
            [
                "trigger-mode:gain+tap+untap",
                "trigger-mode:gain+tap+draw",
                "trigger-mode:gain+untap+draw",
                "trigger-mode:tap+untap+draw",
            ].sort()
        );
        for (const candidate of candidates) {
            const { state: fresh } = modalBoard(
                modalTriggerCard(CHOOSE_THREE),
                { p2: [bear("b", "p2")] }
            );
            raiseTriggerTargetSelection(fresh);
            const head = fresh.pendingChoices![0];
            const move = candidate.move;
            if (move.kind !== "resolution-choice") throw new Error(move.kind);
            applyPendingChoiceSubmit(fresh, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: move.cardInstanceIds,
            });
            expect(fresh.stack[0].chosenModeIds).toHaveLength(3);
        }
    });

    it("enumerates them as moves for the controller", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        const lists = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "resolution-choice"
        );
        expect(lists).toHaveLength(4);
    });

    it("a repeats list offers the multisets, which a distinct walk cannot express", () => {
        const { state } = modalBoard(
            modalTriggerCard({ min: 2, max: 2, repeats: true }, [
                MODES[0],
                MODES[3],
            ])
        );
        raiseTriggerTargetSelection(state);
        const keys = choiceCandidates(state, state.pendingChoices![0]).map(
            (c) => c.key
        );
        expect(keys).toEqual(
            expect.arrayContaining([
                "trigger-mode:gain+gain",
                "trigger-mode:gain+draw",
                "trigger-mode:draw+draw",
            ])
        );
    });

    it("a wide list keeps the strongest lines through the top-K cut", () => {
        const { state } = modalBoard(modalTriggerCard(CHOOSE_THREE, SIX_MODES));
        raiseTriggerTargetSelection(state);
        const candidates = choiceCandidates(state, state.pendingChoices![0]);
        expect(candidates).toHaveLength(CHOICE_TOP_K); // of C(6, 3) = 20
        for (const candidate of candidates) {
            expect(candidate.key).toContain("draw-big");
        }
    });

    it("signs a target group by the instance that owns it, at its own slot", () => {
        // `burn` hurts, `pump` helps: pointing the SECOND group at an opponent's
        // creature is misdirected only when it reads `pump`'s script.
        const burn: AbilityMode = {
            id: "burn",
            label: "Burn",
            oracleText: "Burn.",
            targetRequirement: { type: ["Creature"], count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        };
        const pump: AbilityMode = {
            id: "pump",
            label: "Pump",
            oracleText: "Pump.",
            targetRequirement: { type: ["Creature"], count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        };
        const { state } = modalBoard(
            modalTriggerCard({ min: 2, max: 2 }, [burn, pump, MODES[0]]),
            { p1: [bear("mine", "p1")], p2: [bear("theirs", "p2")] }
        );
        raiseTriggerTargetSelection(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["burn", "pump"],
        });
        const count = (id: string) =>
            misdirectedTargetCount(
                state,
                {
                    kind: "submit-target",
                    targets: [{ type: "permanent", id }],
                } as Parameters<typeof misdirectedTargetCount>[1],
                "p1"
            );
        // Group one: the `burn` instance.
        expect(count("mine")).toBe(1);
        expect(count("theirs")).toBe(0);

        const pt = state.pendingTarget!;
        pt.priorSelected = [{ type: "permanent", id: "theirs" }];
        pt.modeTargetCounts = [1, 0];
        pt.groupModeInstances = [1];
        pt.selected = [];
        // Group two: the `pump` instance, read at its OWN slot 0.
        expect(count("theirs")).toBe(1);
        expect(count("mine")).toBe(0);
    });
});
