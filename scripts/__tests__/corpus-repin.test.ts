import { describe, expect, it } from "vitest";
import {
    corpusDate,
    needsRollup,
    planAcknowledgements,
    planClaims,
    repinBranch,
    repinPrBody,
    REPIN_BRANCH_PREFIX,
    retiredRowLines,
    rollupIssueBody,
    rowFieldChanges,
    type RepinFacts,
    type UnclaimedCard,
} from "../lib/corpus-repin";
import type { CardRow } from "../lib/oracle-lockfile";
import type { ReadyRegression } from "../lib/oracle-state-regressions";
import {
    acknowledgedNames,
    retirementRefusal,
    retirementSection,
} from "../lib/retirement-ack";
import { claimId } from "../lib/targets";

// Issue #6387: the weekly corpus re-pin settles, unattended, the three things
// that block a re-pin's merge — the same three issue #6367 settled by hand.

const ERRATA: ReadyRegression = {
    oracleId: "e1",
    name: "Phyrexian Arena",
    to: "unparsed",
};
const LEFT: ReadyRegression = {
    oracleId: "a1",
    name: "A-Deal Gone Bad",
    to: "absent",
};

const row = (over: Partial<CardRow>): CardRow =>
    ({
        oracleId: "d1",
        name: "Dragon Engine",
        state: "ready",
        poolIn: ["premodern"],
        definition: { name: "Dragon Engine", subtypes: ["Construct"] },
        retired: { at: "2026-09-18", issue: 4027 },
        ...over,
    }) as unknown as CardRow;

describe("corpus re-pin naming", () => {
    it("dates the run by Scryfall's updated_at and names its branch", () => {
        expect(corpusDate("2026-10-22T09:01:54.353+00:00")).toBe("2026-10-22");
        expect(repinBranch("2026-10-22")).toBe(
            `${REPIN_BRANCH_PREFIX}2026-10-22`
        );
        expect(() => corpusDate("")).toThrow(/not a date/);
    });
});

describe("planAcknowledgements", () => {
    it("a card that left the corpus is intended; any other loss is tracked by the roll-up", () => {
        const [errata, left] = planAcknowledgements(
            [ERRATA, LEFT],
            6400,
            "2026-10-29"
        );
        expect(errata).toMatchObject({ oracleId: "e1", trackedBy: 6400 });
        expect(errata).not.toHaveProperty("intended");
        expect(left).toMatchObject({ oracleId: "a1", intended: true });
        expect(left).not.toHaveProperty("trackedBy");
    });

    it("refuses a tracked loss with no roll-up to point at", () => {
        expect(() => planAcknowledgements([ERRATA], null, "d")).toThrow(
            /no roll-up/
        );
        expect(planAcknowledgements([LEFT], null, "d")).toHaveLength(1);
    });

    it("owes a roll-up only when a tracked loss or a claim needs one", () => {
        expect(needsRollup([LEFT], [])).toBe(false);
        expect(needsRollup([ERRATA], [])).toBe(true);
        expect(needsRollup([], [{ target: "t", name: "n", why: "w" }])).toBe(
            true
        );
    });
});

describe("planClaims", () => {
    it("writes each settleable card's missing claim to the roll-up, once per claim", () => {
        const cards: UnclaimedCard[] = [
            {
                target: "set-apc",
                name: "Phyrexian Arena",
                why: "gap",
                missing: { kind: "grammar", key: "k" },
            },
            {
                target: "format-premodern",
                name: "Phyrexian Arena",
                why: "gap",
                missing: { kind: "grammar", key: "k" },
            },
            { target: "t", name: "Bare", why: "no reason to claim" },
        ];
        const { rows, unsettled } = planClaims(cards, 6400);
        expect([...rows]).toEqual([[claimId("grammar", "k"), 6400]]);
        expect(unsettled.map((u) => u.name)).toEqual(["Bare"]);
    });
});

describe("retiredRowLines", () => {
    const before = row({});
    const after = row({
        definition: {
            name: "Dragon Engine",
            subtypes: ["Dragon", "Construct"],
        },
    } as Partial<CardRow>);

    it("names the re-derived fields, card name first — the line `land` accepts", () => {
        expect(rowFieldChanges(before, after)).toEqual(["definition.subtypes"]);
        const lines = retiredRowLines(
            [
                {
                    oracleId: "d1",
                    name: "Dragon Engine",
                    marker: { at: "2026-09-18", issue: 4027 },
                    change: "changed",
                },
            ],
            new Map([["d1", before]]),
            new Map([["d1", after]]),
            "2026-10-22"
        );
        expect(lines).toEqual([
            expect.stringMatching(
                /^- Dragon Engine — re-derived by the compiler from the 2026-10-22 Oracle text \(definition\.subtypes changed\)/
            ),
        ]);
        const body = `## Retired rows\n\n${lines.join("\n")}\n\n## Preset scenario\n`;
        expect(acknowledgedNames(retirementSection(body)!)).toEqual(
            new Set(["dragon engine"])
        );
    });

    it("refuses a removed retirement marker — a corpus cannot do that", () => {
        expect(() =>
            retiredRowLines(
                [
                    {
                        oracleId: "d1",
                        name: "Dragon Engine",
                        marker: { at: "2026-09-18", issue: 4027 },
                        change: "marker-removed",
                    },
                ],
                new Map(),
                new Map(),
                "d"
            )
        ).toThrow(/retirement marker/);
    });
});

describe("the bodies", () => {
    const facts: RepinFacts = {
        date: "2026-10-29",
        fromDate: "2026-10-22",
        counts: { total: 35100, ready: 6480, quarantine: 360, unparsed: 28260 },
        fromCounts: { total: 35093, ready: 6474 },
        regressions: [ERRATA, LEFT],
        lossGaps: new Map([["e1", ["triggered › effect clause › You draw"]]]),
        unclaimed: [
            {
                target: "set-apc",
                name: "Phyrexian Arena",
                why: "gap",
                missing: { kind: "grammar", key: "k" },
            },
        ],
    };

    it("the roll-up lists every tracked loss under `## Cards` and every claim", () => {
        const body = rollupIssueBody(facts);
        expect(body).toContain("| Phyrexian Arena | unparsed |");
        expect(body).toContain("| set-apc | Phyrexian Arena | `grammar` `k` |");
        expect(body).toMatch(/## Cards\n\n- Phyrexian Arena\n/);
        expect(body).not.toContain("A-Deal Gone Bad");
        expect(body).toMatch(/## Band\n\nP1 — /);
    });

    it("the PR body carries the sections `land` reads", () => {
        const retired = ["- Dragon Engine — re-derived by the compiler"];
        const body = repinPrBody(facts, 6400, retired, 1);
        expect(body).toContain("## Preset scenario");
        expect(body).toContain("check:ui: no walk owed");
        expect(
            retirementRefusal(
                [
                    {
                        oracleId: "d1",
                        name: "Dragon Engine",
                        marker: { at: "2026-09-18", issue: 4027 },
                        change: "changed",
                    },
                ],
                body
            )
        ).toBeNull();
        expect(repinPrBody(facts, null, [], 0)).not.toContain(
            "## Retired rows"
        );
    });
});
