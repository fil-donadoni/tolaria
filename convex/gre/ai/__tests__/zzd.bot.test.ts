import { expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/registry";
import {
    collectVerdictReport,
    formatVerdictReport,
    testPositionKeysOf,
    verdictsFromRegistry,
} from "../verdicts";
it("d", () => {
    const d = verdictsFromRegistry();
    const t = formatVerdictReport(
        collectVerdictReport(d.verdicts, {
            gaps: d.gaps,
            testPositions: testPositionKeysOf(BLADE_SCENARIOS),
        }),
        0
    );
    console.log(
        "DEBT",
        (t.match(/debt \((\d+)\)/) ?? [])[1],
        "pairgaps",
        d.gaps.filter((g) => g.reason === "pair").length
    );
    expect(true).toBe(true);
});
