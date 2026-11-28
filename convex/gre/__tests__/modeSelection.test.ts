// Pure grammar of an announce-time mode list (ADR 0094) — CR 700.2a / 700.2d /
// 608.2c / 609.3 / 601.4. The end-to-end announcement and resolution run in
// `convex/__tests__/modalCardinality.test.ts`.

import { describe, expect, it } from "vitest";
import {
    announceableModeCombinations,
    maxModeCount,
    modeInstanceTargetGroups,
    modeInstances,
    modeSelectionBounds,
    normalizeChosenModeIds,
    priorTargetsOfSameModeInstance,
    recordModeTargetGroup,
    validateChosenModeIds,
    type ModeSelectionFacts,
} from "../modeSelection";
import type { ModeSelection, TargetSelection } from "../../cards/types";

const MODES = [{ id: "a" }, { id: "b" }, { id: "c" }];
const NO_FACTS: ModeSelectionFacts = { controls: () => false, kicked: false };
const t = (id: string): TargetSelection => ({ type: "permanent", id });

describe("modeSelectionBounds (CR 601.4 conditional count)", () => {
    const kickedUpgrade: ModeSelection = {
        min: 1,
        max: 1,
        when: { condition: { kicked: true }, min: 1, max: 3 },
    };
    it("absent = exactly one", () => {
        expect(modeSelectionBounds(undefined, NO_FACTS)).toEqual({
            min: 1,
            max: 1,
            repeats: false,
        });
    });
    it("a holding `when` replaces the bounds; a failing one leaves them", () => {
        expect(modeSelectionBounds(kickedUpgrade, NO_FACTS).max).toBe(1);
        expect(
            modeSelectionBounds(kickedUpgrade, { ...NO_FACTS, kicked: true })
                .max
        ).toBe(3);
        expect(maxModeCount(kickedUpgrade)).toBe(3);
    });
});

describe("normalizeChosenModeIds (CR 608.2c / 700.2d)", () => {
    it("sorts into printed order, keeping repeats consecutive", () => {
        expect(normalizeChosenModeIds(MODES, ["c", "a", "c", "b"])).toEqual([
            "a",
            "b",
            "c",
            "c",
        ]);
    });
});

describe("validateChosenModeIds", () => {
    const run = (
        selection: ModeSelection | undefined,
        ids: string[],
        legal: string[] = ["a", "b", "c"]
    ) =>
        validateChosenModeIds({
            modes: MODES,
            selection,
            ids,
            facts: NO_FACTS,
            isModeLegal: (id) => legal.includes(id),
            ownerName: "Probe",
        });

    it("rejects an empty or unknown announcement", () => {
        expect(() => run(undefined, [])).toThrow(/must choose a mode/);
        expect(() => run(undefined, ["z"])).toThrow(/Unknown mode id "z"/);
    });
    it("CR 700.2d — repeats only when allowed", () => {
        expect(() => run({ min: 2, max: 2 }, ["a", "a"])).toThrow(
            /more than once/
        );
        expect(run({ min: 2, max: 2, repeats: true }, ["a", "a"])).toEqual([
            "a",
            "a",
        ]);
    });
    it("CR 609.3 — the minimum shrinks to what is legally reachable", () => {
        expect(() => run({ min: 3, max: 3 }, ["a", "b"])).toThrow(/at least 3/);
        expect(run({ min: 3, max: 3 }, ["b", "a"], ["a", "b"])).toEqual([
            "a",
            "b",
        ]);
        // With repeats one legal mode fills every slot — no shortfall.
        expect(() =>
            run({ min: 3, max: 3, repeats: true }, ["a"], ["a"])
        ).toThrow(/at least 3/);
    });
});

describe("mode instance targets (ADR 0094)", () => {
    const targeted = [
        { id: "a", targetRequirement: { type: "Creature" as const, count: 1 } },
        { id: "b" },
        {
            id: "c",
            targetRequirement: { type: "Artifact" as const, count: 1 },
            additionalTargetRequirements: [
                { type: "Enchantment" as const, count: 1 },
            ],
        },
    ];

    it("flattens every instance's groups in order, tagged by instance", () => {
        expect(
            modeInstanceTargetGroups(targeted, ["a", "b", "c", "a"]).map(
                (g) => [g.requirement.type, g.instance]
            )
        ).toEqual([
            ["Creature", 0],
            ["Artifact", 2],
            ["Enchantment", 2],
            ["Creature", 3],
        ]);
    });

    it("slices the flat target list by the stored spans", () => {
        expect(
            modeInstances(["a", "b", "c"], [1, 0, 2], [t("x"), t("y"), t("z")])
        ).toEqual([
            { modeId: "a", targets: [t("x")] },
            { modeId: "b", targets: [] },
            { modeId: "c", targets: [t("y"), t("z")] },
        ]);
        // One instance owns everything — the pre-ADR-0094 read.
        expect(modeInstances(["a"], undefined, [t("x")])).toEqual([
            { modeId: "a", targets: [t("x")] },
        ]);
    });

    it("refuses to guess spans for several instances", () => {
        expect(() => modeInstances(["a", "a"], undefined, [t("x")])).toThrow(
            /modeTargetCounts/
        );
        expect(() => modeInstances(["a", "a"], [1, 1], [t("x")])).toThrow(
            /cover 2 targets/
        );
    });

    it("tallies group picks per instance and scopes 'another target' to one instance", () => {
        const pt = {
            groupModeInstances: [2, 2, 3],
            modeTargetCounts: [0, 0, 0, 0],
        };
        recordModeTargetGroup(pt, 1);
        // Next group still belongs to instance 2: its earlier pick is visible.
        expect(priorTargetsOfSameModeInstance(pt, [t("x")])).toEqual([t("x")]);
        recordModeTargetGroup(pt, 1);
        // Next group opens instance 3: CR 700.2d — nothing is excluded.
        expect(priorTargetsOfSameModeInstance(pt, [t("x"), t("y")])).toEqual(
            []
        );
        recordModeTargetGroup(pt, 1);
        expect(pt.modeTargetCounts).toEqual([0, 0, 2, 1]);
        expect(pt.groupModeInstances).toBeUndefined();
    });
});

// CR 700.2i — "Choose up to five {P} worth of modes. You may choose the same
// mode more than once." The Season cycle's shape: one-, two- and three-{P}
// modes under a five-{P} budget.
describe("pawprint budget (CR 700.2i / 107.18)", () => {
    const PAW_MODES = [
        { id: "one", pawprints: 1 },
        { id: "two", pawprints: 2 },
        { id: "three", pawprints: 3 },
    ];
    const SEASON: ModeSelection = {
        min: 1,
        max: 5,
        repeats: true,
        pawprintBudget: 5,
    };
    const validate = (ids: string[]) =>
        validateChosenModeIds({
            modes: PAW_MODES,
            selection: SEASON,
            ids,
            facts: NO_FACTS,
            isModeLegal: () => true,
            ownerName: "Season",
        });
    it("accepts any list whose summed {P} fits the budget", () => {
        expect(validate(["three", "two"])).toEqual(["two", "three"]);
        expect(validate(["one", "one", "one", "one", "one"])).toHaveLength(5);
    });
    it("refuses a list over the budget, even under the mode count", () => {
        expect(() => validate(["three", "three"])).toThrow(/at most 5 \{P\}/);
        expect(() => validate(["two", "two", "two"])).toThrow(/at most 5/);
    });
    it("the Bot enumerates exactly the fifteen lists within five {P}", () => {
        const lists = announceableModeCombinations({
            modes: PAW_MODES,
            selection: SEASON,
            facts: NO_FACTS,
            isModeLegal: () => true,
            ownerName: "Season",
        });
        expect(lists.map((l) => l.join("+"))).toEqual([
            "one",
            "two",
            "three",
            "one+one",
            "one+two",
            "one+three",
            "two+two",
            "two+three",
            "one+one+one",
            "one+one+two",
            "one+one+three",
            "one+two+two",
            "one+one+one+one",
            "one+one+one+two",
            "one+one+one+one+one",
        ]);
    });
});
