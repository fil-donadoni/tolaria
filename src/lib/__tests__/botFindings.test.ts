// Bot Findings admin page — filter predicates (issue #4177). Pure, over a
// minimal slice of each row shape.
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import {
    adminErrorText,
    countedFindings,
    distinctSorted,
    filterByVisibility,
    isCopyable,
    isStaleFinding,
    triageFindings,
    matchesClassFilters,
    matchesFindingFilters,
    EMPTY_CLASS_FILTERS,
    EMPTY_FINDING_FILTERS,
    type BotFindingClassRow,
    type BotFindingRow,
} from "../botFindings";

const FINDING = {
    name: "Grist, the Hunger Tide",
    targets: ["vintage-cube"],
    cause: "never-chosen",
    blame: "bot",
    status: "open",
} as unknown as BotFindingRow;

const CLASS = {
    key: "never-chosen › Sorcery › draw",
    cause: "never-chosen",
    blame: "bot",
    targetCounts: [
        { target: "vintage-cube", count: 3 },
        { target: "premodern-metagame", count: 0 },
    ],
} as unknown as BotFindingClassRow;

describe("distinctSorted", () => {
    it("returns the distinct, sorted, defined values of a column", () => {
        expect(
            distinctSorted(
                [{ v: "b" }, { v: "a" }, { v: "b" }, { v: undefined }],
                (r) => r.v
            )
        ).toEqual(["a", "b"]);
    });
});

describe("matchesFindingFilters", () => {
    it("passes everything under the empty filter", () => {
        expect(matchesFindingFilters(FINDING, EMPTY_FINDING_FILTERS)).toBe(
            true
        );
    });

    it("narrows by Target List", () => {
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                target: "premodern-metagame",
            })
        ).toBe(false);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                target: "vintage-cube",
            })
        ).toBe(true);
    });

    it("narrows by cause, blame and status", () => {
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                cause: "position-unmodelled",
            })
        ).toBe(false);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                blame: "harness",
            })
        ).toBe(false);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                status: "resolved",
            })
        ).toBe(false);
    });

    it("narrows by a case-insensitive card-name substring", () => {
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                query: "hunger",
            })
        ).toBe(true);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                query: "nonexistent",
            })
        ).toBe(false);
    });
});

describe("matchesClassFilters", () => {
    it("passes everything under the empty filter", () => {
        expect(matchesClassFilters(CLASS, EMPTY_CLASS_FILTERS)).toBe(true);
    });

    it("narrows by Target List, requiring a POSITIVE count on that Target", () => {
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                target: "vintage-cube",
            })
        ).toBe(true);
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                target: "premodern-metagame",
            })
        ).toBe(false);
    });

    it("narrows the class key by substring — the Ops/keywords filter", () => {
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                query: "draw",
            })
        ).toBe(true);
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                query: "destroy",
            })
        ).toBe(false);
    });
});

// ── Human findings (issue #4182) ─────────────────────────────────────────

const sweep = (extra: object = {}) =>
    ({
        oracleId: "o-s",
        source: "sweep",
        name: "Sweep",
        botHash: "h1",
        measuredAt: "at",
        ...extra,
    }) as unknown as BotFindingRow;
const human = (extra: object = {}) =>
    ({
        oracleId: "o-h",
        source: "human",
        name: "Human",
        botHash: "",
        measuredAt: "at",
        ...extra,
    }) as unknown as BotFindingRow;

describe("human findings — triage, snooze and the counted set", () => {
    const ROWS = [
        sweep(),
        human({ reproducers: ["blade: x"] }),
        human({ oracleId: "o-t" }),
        sweep({ oracleId: "o-z", snoozedAt: 1, snoozeReason: "r" }),
        human({ oracleId: "o-ts", snoozedAt: 1, snoozeReason: "r" }),
    ];

    it("counts admitted, unsnoozed rows only", () => {
        expect(countedFindings(ROWS).map((r) => r.oracleId)).toEqual([
            "o-s",
            "o-h",
        ]);
    });

    it("buckets an unsnoozed human report without a reproducer as triage", () => {
        expect(triageFindings(ROWS).map((r) => r.oracleId)).toEqual(["o-t"]);
    });

    it("lists everything but triage, narrowed by snooze", () => {
        const ids = (v: "active" | "snoozed" | "all") =>
            filterByVisibility(ROWS, v).map((r) => r.oracleId);
        expect(ids("active")).toEqual(["o-s", "o-h"]);
        expect(ids("snoozed")).toEqual(["o-z", "o-ts"]);
        expect(ids("all")).toEqual(["o-s", "o-h", "o-z", "o-ts"]);
    });

    it("offers the copy affordance to an admitted row and never to triage", () => {
        expect(isCopyable(sweep())).toBe(true);
        expect(isCopyable(human({ reproducers: ["saved"] }))).toBe(true);
        expect(isCopyable(human())).toBe(false);
    });

    it("never judges a human report stale — it has no Bot hash to compare", () => {
        const m = { botHash: "h1" } as never;
        expect(isStaleFinding(sweep({ botHash: "old" }), m)).toBe(true);
        expect(isStaleFinding(human(), m)).toBe(false);
    });

    it("reads a server refusal in its own words and hides anything else", () => {
        expect(adminErrorText(new ConvexError("A snooze needs a reason"))).toBe(
            "A snooze needs a reason"
        );
        expect(adminErrorText(new Error("[Request ID: x] Server Error"))).toBe(
            "Something went wrong — the change was not saved."
        );
    });
});
