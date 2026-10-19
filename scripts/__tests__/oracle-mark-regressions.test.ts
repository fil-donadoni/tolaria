import { describe, expect, it } from "vitest";
import {
    insertCompilerGapMarkers,
    isExempting,
    planRegressionMarkers,
    scanCompilerGapMarkers,
    type RegressedCard,
    type RegressionGap,
} from "../lib/compiler-gap-markers";

// `oracle:mark-regressions` (issue #5988): a card a grammar change stopped
// round-tripping gets its Guard C marker written, when — and only when — the
// marker is transcription: an `unparsed` verdict whose every gap has a filed
// Grammar Gap issue.

const keyOf = (gap: RegressionGap): string => `k › ${gap.fragment}`;
const FILED: Record<string, number> = {
    "k › Prevent all combat damage.": 4590,
    "k › Search your library.": 4591,
};
const issueOf = (key: string): number | undefined => FILED[key];

const unparsed = (name: string, ...fragments: string[]): RegressedCard => ({
    name,
    kind: "unparsed",
    detail: "",
    gaps: fragments.map((fragment) => ({ fragment, reason: "r" })),
});

describe("planRegressionMarkers", () => {
    it("marks an unparsed card with one marker per distinct filed gap", () => {
        const plan = planRegressionMarkers(
            [
                unparsed(
                    "Fog",
                    "Prevent all combat damage.",
                    "Prevent all combat damage."
                ),
            ],
            keyOf,
            issueOf
        );
        expect(plan.report).toEqual([]);
        expect(plan.mark.get("Fog")).toEqual([
            { fragment: "Prevent all combat damage.", issue: 4590 },
        ]);
    });

    it("reports a mismatch and a card with no Oracle text, never marks them", () => {
        const plan = planRegressionMarkers(
            [
                { name: "Paladin", kind: "mismatch", detail: "expected …" },
                { name: "Bears", kind: "no-oracle-text", detail: "missing" },
            ],
            keyOf,
            issueOf
        );
        expect(plan.mark.size).toBe(0);
        expect(plan.report.map((r) => [r.card, r.problem])).toEqual([
            ["Paladin", "mismatch"],
            ["Bears", "no-oracle-text"],
        ]);
    });

    it("reports a card with an unfiled gap and marks none of its gaps — one marker would exempt it whole", () => {
        const plan = planRegressionMarkers(
            [unparsed("Tutor", "Search your library.", "Never filed.")],
            keyOf,
            issueOf
        );
        expect(plan.mark.size).toBe(0);
        expect(plan.report).toHaveLength(1);
        expect(plan.report[0]).toMatchObject({
            card: "Tutor",
            problem: "unfiled",
        });
        expect(plan.report[0]!.detail).toContain("k › Never filed.");
    });

    it("reports a fragment the marker regex would not read back, rather than writing it", () => {
        const plan = planRegressionMarkers(
            [unparsed("Potion", "Search your library.\n• Target player")],
            (gap) => keyOf({ ...gap, fragment: "Search your library." }),
            issueOf
        );
        expect(plan.mark.size).toBe(0);
        expect(plan.report[0]).toMatchObject({
            card: "Potion",
            problem: "unwritable",
        });
    });
});

const SOURCE = [
    "// Fog — {G} Instant.",
    "export const fog = defineCard(() => ({",
    '    name: "Fog",',
    "}));",
    "",
    "export const tutor = defineCard(() => ({",
    '    name: "Tutor",',
    "}));",
    "",
];

describe("insertCompilerGapMarkers", () => {
    const mark = new Map([
        ["Fog", [{ fragment: "Prevent all combat damage.", issue: 4590 }]],
        ["Tutor", [{ fragment: "Search your library.", issue: 4591 }]],
    ]);

    it("writes markers Guard C attaches to their own card — into the doc paragraph, or a new one", () => {
        const { lines, written } = insertCompilerGapMarkers(SOURCE, mark);
        expect(written).toEqual(["Fog", "Tutor"]);
        const markers = scanCompilerGapMarkers(lines).filter(isExempting);
        expect(markers.map((m) => [m.card, m.fragment, m.issue])).toEqual([
            ["Fog", "Prevent all combat damage.", 4590],
            ["Tutor", "Search your library.", 4591],
        ]);
        expect(lines.slice(0, 2)).toEqual([
            "// Fog — {G} Instant.",
            "// compiler-gap: Prevent all combat damage. (#4590)",
        ]);
    });

    it("leaves a card whose anchor the file lacks to the caller", () => {
        const { lines, written } = insertCompilerGapMarkers(
            SOURCE,
            new Map([["Elsewhere", mark.get("Fog")!]])
        );
        expect(written).toEqual([]);
        expect(lines).toEqual(SOURCE);
    });

    it("a second run finds the written card exempt, so it writes nothing", () => {
        const once = insertCompilerGapMarkers(SOURCE, mark).lines;
        const exempt = new Set(
            scanCompilerGapMarkers(once)
                .filter(isExempting)
                .map((m) => m.card)
        );
        const again = planRegressionMarkers(
            [
                unparsed("Fog", "Prevent all combat damage."),
                unparsed("Tutor", "Search your library."),
            ].filter((c) => !exempt.has(c.name)),
            keyOf,
            issueOf
        );
        expect(again.mark.size).toBe(0);
        expect(insertCompilerGapMarkers(once, again.mark).lines).toEqual(once);
    });
});
