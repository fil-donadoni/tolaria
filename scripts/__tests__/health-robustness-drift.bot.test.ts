// The health reader and the blade audit agree on the finding line (issue
// #5016). A `.bot.test.ts` because it imports the blade module
// (`bot-suite-boundary.test.ts`); the reader's own tests are
// `health-robustness-drift.test.ts`.
import { describe, expect, it } from "vitest";
import {
    parseRobustnessDrift,
    ROBUSTNESS_FINDING_PREFIX,
} from "../lib/health-robustness-drift";
import {
    ROBUSTNESS_FINDING_PREFIX as BLADE_PREFIX,
    robustnessFindingRecords,
} from "../../convex/gre/ai/blade/robustness";

const PIN = "Sacrifice-for-draw outlet: casts the creature";

describe("health-robustness-drift × blade robustness (issue #5016)", () => {
    it("reads the line the blade module prints", () => {
        expect(ROBUSTNESS_FINDING_PREFIX).toBe(BLADE_PREFIX);
        const records = robustnessFindingRecords(
            {
                unlisted: [PIN],
                wrong: [],
                cleared: ['a "quoted" label'],
                malformed: [],
            },
            "the test"
        );
        expect(records.map((r) => r.test)).toEqual(["the test", "the test"]);
        const printed = records
            .map((r) => `${BLADE_PREFIX} ${JSON.stringify(r)}`)
            .join("\n");
        expect(
            parseRobustnessDrift(printed).map(({ kind, label, test }) => ({
                kind,
                label,
                test,
            }))
        ).toEqual(records);
    });
});
