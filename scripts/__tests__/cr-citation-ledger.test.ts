import { describe, it, expect } from "vitest";
import {
    ledgerReportForRepo,
    scanCitations,
    scanRepo,
} from "../check-cr-citations.ts";
import {
    confirmLine,
    emptyLedger,
    entryKey,
    formatReport,
    initialLedger,
    ledgerReport,
    normalizeLine,
    parseLedger,
    pruneStale,
    reportIsClean,
    serializeLedger,
    type Citation,
    type Ledger,
} from "../lib/cr-ledger.ts";
import { printedRule, ruleHash, rulesOf, type Rule } from "../lib/cr-rules.ts";

/**
 * CR citation ledger (ADR 0133, issue #3674).
 *
 * `bun run cr:lint` reds on a citation with no ledger entry (or more sites
 * than its entry records), a confirmed entry whose rule text changed, a
 * baseline entry the base branch does not have, and a stale entry. This test
 * drives the SAME pure report over a fixture CR document — never the vendored
 * one, so a `cr:sync` cannot move these assertions — plus one whole-tree
 * assertion so the committed ledger cannot drift from the tree either way.
 *
 * Fixture lines interpolate their ids: this file is a tracked `.ts`, so a
 * literal `CR <id>` here would be picked up by the existence scan and the
 * targeted scans. (The ledger itself exempts this file by name.)
 */

const ONCE = "614.5";
const BACK_FACE = "616.1d";
const SECTION = "616.1";

const doc = (once: string) =>
    [
        "1. Game Concepts",
        "",
        "1. Game Concepts",
        "100. General",
        "100.1. These Magic rules apply to any Magic game with two or more players.",
        "614. Replacement Effects",
        `${ONCE}. ${once}`,
        "616. Interaction of Replacement and/or Prevention Effects",
        `${SECTION}. If two or more replacement and/or prevention effects are attempting to modify the way an event affects an object or player, the affected player chooses one to apply.`,
        `${BACK_FACE} If any of the replacement and/or prevention effects would cause a card to enter the battlefield with its back face up, one of them must be chosen.`,
        "Glossary",
        "Credits",
    ].join("\n");

const CR_V1 = doc(
    "A replacement effect doesn't invoke itself repeatedly; it gets only one opportunity to affect an event."
);
/** The same document after a `cr:sync` that reworded 614.5. */
const CR_V2 = doc(
    "A replacement effect gets only one opportunity to affect an event or any modified events that may replace it."
);

const rulesV1 = rulesOf(CR_V1);
const rulesV2 = rulesOf(CR_V2);
const ids = new Set(rulesV1.map((r) => r.id));

const cite = (id: string, claim: string, indent = "") =>
    `${indent}// CR ${id} — ${claim}`;

function citationsOf(sources: { file: string; text: string }[]): Citation[] {
    return scanCitations(sources, ids).citations;
}

const FILE = "convex/gre/fixture.ts";
const TWIN = "convex/gre/twin.ts";

function report(
    citations: Citation[],
    ledger: Ledger,
    rules: Rule[] = rulesV1,
    baseBaselineKeys: Set<string> | null = new Set()
) {
    return ledgerReport({ citations, ledger, rules, baseBaselineKeys });
}

/** Confirms the one line of `citations` against `rules`, tree = that line. */
function confirmed(citations: Citation[], rules: Rule[] = rulesV1): Ledger {
    return confirmLine(emptyLedger(), citations, rules, citations).ledger;
}

describe("the committed ledger is exact against the tracked tree (issue #3674)", () => {
    it("every citation in the tree has an entry that still matches its rule, and no entry is stale", () => {
        const r = ledgerReportForRepo(scanRepo().citations);
        expect(
            formatReport(r, true),
            "The CR citation ledger and the tree disagree. `bun run cr:ledger` lists what is open;\n" +
                "`bun run cr:ledger confirm <file>:<line>` records a checked citation, `prune` drops stale entries:\n"
        ).toBe("");
        expect(reportIsClean(r)).toBe(true);
    });
});

describe("a new citation is red until confirmed", () => {
    const line = cite(BACK_FACE, "a replacement applies once per event");
    const citations = citationsOf([{ file: FILE, text: line }]);

    it("reds on a citation with no ledger entry, naming the line and printing the rule", () => {
        const r = report(citations, emptyLedger());
        expect(r.unrecorded).toHaveLength(1);
        expect(r.unrecorded[0]).toMatchObject({
            id: BACK_FACE,
            line: normalizeLine(line),
            reason: "unrecorded",
            sites: [{ file: FILE, line: 1 }],
        });
        const text = formatReport(r, false);
        expect(text).toContain(`${FILE}:1`);
        expect(text).toContain("with its back face up");
        expect(text).toContain("bun run cr:ledger confirm <file>:<line>");
        expect(reportIsClean(r)).toBe(false);
    });

    it("is green once confirmed against the printed rule", () => {
        const { ledger, confirmed: entries } = confirmLine(
            emptyLedger(),
            citations,
            rulesV1,
            citations
        );
        expect(entries).toEqual([
            {
                id: BACK_FACE,
                line: normalizeLine(line),
                sites: 1,
                status: "confirmed",
                ruleHash: ruleHash(printedRule(rulesV1, BACK_FACE)!),
            },
        ]);
        expect(reportIsClean(report(citations, ledger))).toBe(true);
    });

    it("refuses to confirm an id that resolves to nothing", () => {
        const bogus = citationsOf([{ file: FILE, text: cite("999.9z", "x") }]);
        expect(() => confirmLine(emptyLedger(), bogus, rulesV1, bogus)).toThrow(
            /resolves to no rule/
        );
    });

    it("a `cr-cite-ok` line still needs an entry — the ledger asks whether the line was read, not whether it is wrong", () => {
        const c = citationsOf([
            {
                file: FILE,
                text: `${cite(BACK_FACE, "counter-example")} cr-cite-ok`,
            },
        ]);
        expect(c).toHaveLength(1);
        expect(report(c, emptyLedger()).unrecorded).toHaveLength(1);
        expect(reportIsClean(report(c, confirmed(c)))).toBe(true);
    });
});

describe("a confirmed entry reopens when its rule's text changes", () => {
    const line = cite(ONCE, "a replacement applies once per event");
    const citations = citationsOf([{ file: FILE, text: line }]);
    const ledger = confirmed(citations);

    it("is green on the document it was confirmed against", () => {
        expect(reportIsClean(report(citations, ledger, rulesV1))).toBe(true);
    });

    it("reds as drifted on the reworded document, and re-confirms under the new text", () => {
        const r = report(citations, ledger, rulesV2);
        expect(r.drifted).toHaveLength(1);
        expect(r.drifted[0]).toMatchObject({ id: ONCE, reason: "drifted" });
        expect(r.unrecorded).toHaveLength(0);
        expect(formatReport(r, false)).toContain(
            "text changed since confirmation"
        );

        const again = confirmLine(ledger, citations, rulesV2, citations).ledger;
        expect(reportIsClean(report(citations, again, rulesV2))).toBe(true);
    });

    it("leaves a BASELINE entry alone when the rule changes — it was never checked", () => {
        const baseline = initialLedger(citations);
        const key = entryKey(ONCE, normalizeLine(line));
        expect(
            reportIsClean(report(citations, baseline, rulesV2, new Set([key])))
        ).toBe(true);
    });
});

describe("the baseline only shrinks", () => {
    const line = cite(SECTION, "the affected player chooses the order");
    const citations = citationsOf([{ file: FILE, text: line }]);
    const key = entryKey(SECTION, normalizeLine(line));
    const grown = initialLedger(citations);

    it("reds on a baseline entry the base branch's ledger does not have", () => {
        const r = report(citations, grown, rulesV1, new Set());
        expect(r.grown).toHaveLength(1);
        expect(r.grown[0]).toMatchObject({ id: SECTION, status: "baseline" });
        expect(formatReport(r, false)).toContain("the baseline only shrinks");
    });

    it("passes the same entry when the base branch has it", () => {
        expect(
            reportIsClean(report(citations, grown, rulesV1, new Set([key])))
        ).toBe(true);
    });

    it("skips the comparison — and says so — when there is no base ledger to compare with", () => {
        const r = report(citations, grown, rulesV1, null);
        expect(r.grown).toHaveLength(0);
        expect(r.baselineChecked).toBe(false);
    });
});

describe("editing a confirmed line reopens it; moving it does not", () => {
    const line = cite(BACK_FACE, "a card entering with its back face up");
    const ledger = confirmed(citationsOf([{ file: FILE, text: line }]));

    it("an edited claim is a new citation (unrecorded) and leaves the old entry stale", () => {
        const edited = citationsOf([
            { file: FILE, text: cite(BACK_FACE, "a card entering face down") },
        ]);
        const r = report(edited, ledger);
        expect(r.unrecorded).toHaveLength(1);
        expect(r.stale).toHaveLength(1);
        expect(r.stale[0].line).toBe(normalizeLine(line));
        expect(formatReport(r, false)).toContain("bun run cr:ledger prune");
    });

    it("the same line in another file, at another line number, with other indentation, stays green", () => {
        const moved = citationsOf([
            {
                file: "convex/gre/elsewhere.ts",
                text: `\n\n\n${cite(BACK_FACE, "a card entering with its back face up", "        ")}`,
            },
        ]);
        expect(reportIsClean(report(moved, ledger))).toBe(true);
    });
});

describe("an entry counts its sites — a copy of a recorded line is a new, unchecked citation", () => {
    const line = cite(SECTION, "the affected player chooses");
    const one = citationsOf([{ file: FILE, text: line }]);
    const two = citationsOf([
        { file: FILE, text: line },
        { file: TWIN, text: `\n${line}` },
    ]);

    it("a line duplicated across files is one entry, every site listed", () => {
        const r = report(two, emptyLedger());
        expect(r.unrecorded).toHaveLength(1);
        expect(r.unrecorded[0].sites).toEqual([
            { file: FILE, line: 1 },
            { file: TWIN, line: 2 },
        ]);
    });

    it("a second site of a line recorded once is red, naming the count, even under `baseline`", () => {
        const baseline = initialLedger(one);
        expect(baseline.entries[0].sites).toBe(1);
        const key = entryKey(SECTION, normalizeLine(line));
        const r = report(two, baseline, rulesV1, new Set([key]));
        expect(r.unrecorded).toHaveLength(1);
        expect(r.unrecorded[0]).toMatchObject({
            reason: "new-sites",
            recordedSites: 1,
        });
        expect(formatReport(r, false)).toContain("1 new site(s)");
        expect(formatReport(r, false)).toContain("bun run cr:ledger confirm");
    });

    it("confirming the line records every site the tree makes, and is green", () => {
        const { ledger, confirmed: entries } = confirmLine(
            initialLedger(one),
            one,
            rulesV1,
            two
        );
        expect(entries[0]).toMatchObject({ sites: 2, status: "confirmed" });
        expect(reportIsClean(report(two, ledger))).toBe(true);
    });

    it("one site fewer is a stale count that prune lowers — never raises", () => {
        const ledger = confirmLine(emptyLedger(), one, rulesV1, two).ledger;
        const r = report(one, ledger);
        expect(r.stale).toHaveLength(1);
        expect(reportIsClean(r)).toBe(false);
        const { ledger: pruned, pruned: touched } = pruneStale(ledger, one);
        expect(touched).toHaveLength(1);
        expect(pruned.entries[0].sites).toBe(1);
        expect(reportIsClean(report(one, pruned))).toBe(true);
        expect(pruneStale(pruned, two).pruned).toHaveLength(0);
        expect(pruneStale(pruned, two).ledger.entries[0].sites).toBe(1);
    });
});

describe("stale entries are red, and prune drops them", () => {
    const line = cite(ONCE, "once per event");
    const citations = citationsOf([{ file: FILE, text: line }]);
    const ledger = confirmed(citations);

    it("an entry matching no line in the tree is red", () => {
        const r = report([], ledger);
        expect(r.stale).toHaveLength(1);
        expect(reportIsClean(r)).toBe(false);
    });

    it("prune removes exactly the stale entries", () => {
        const { ledger: pruned, pruned: dropped } = pruneStale(ledger, []);
        expect(dropped).toHaveLength(1);
        expect(pruned.entries).toHaveLength(0);
        expect(pruneStale(ledger, citations).pruned).toHaveLength(0);
    });
});

describe("exemption", () => {
    it("an exempt file needs no entry; a sibling with a similar name is not exempt", () => {
        const exempt = citationsOf([
            {
                file: "docs/findings/2026-09-15-x.md",
                text: cite(ONCE, "wrong on purpose"),
            },
            {
                file: "scripts/__tests__/cr-citations.test.ts",
                text: cite(ONCE, "fixture"),
            },
        ]);
        expect(exempt).toHaveLength(2);
        expect(reportIsClean(report(exempt, emptyLedger()))).toBe(true);

        const sibling = citationsOf([
            {
                file: "scripts/__tests__/cr-something-else.test.ts",
                text: cite(ONCE, "not exempt"),
            },
        ]);
        expect(report(sibling, emptyLedger()).unrecorded).toHaveLength(1);
    });
});

describe("the ledger file", () => {
    const a = cite(ONCE, "once");
    const b = cite(BACK_FACE, "back face");
    const citations = citationsOf([{ file: FILE, text: `${b}\n${a}` }]);

    it("serializes one entry per line, sorted by id then line, and parses back", () => {
        const { ledger } = confirmLine(
            initialLedger(citations),
            citationsOf([{ file: FILE, text: a }]),
            rulesV1,
            citations
        );
        const text = serializeLedger(ledger);
        const rows = text.split("\n").filter((l) => l.startsWith("        {"));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain(`"id":"${ONCE}"`);
        expect(rows[0]).toContain('"sites":1,"status":"confirmed"');
        expect(rows[1]).toContain(`"id":"${BACK_FACE}"`);
        expect(rows[1]).toContain('"sites":1,"status":"baseline"');
        expect(rows[1]).not.toContain("ruleHash");
        expect(serializeLedger(parseLedger(text))).toBe(text);
    });

    it("rejects a baseline entry carrying a hash, a confirmed entry without one, a missing site count, and a duplicate", () => {
        const entry = (extra: object) =>
            JSON.stringify({
                generator: "x",
                entries: [{ id: ONCE, line: "// x", sites: 1, ...extra }],
            });
        expect(() =>
            parseLedger(
                entry({ status: "baseline", ruleHash: "0123456789abcdef" })
            )
        ).toThrow(/baseline entry carries no/);
        expect(() => parseLedger(entry({ status: "confirmed" }))).toThrow(
            /16-hex/
        );
        expect(() =>
            parseLedger(entry({ status: "baseline", sites: 0 }))
        ).toThrow(/positive integer/);
        expect(() =>
            parseLedger(
                JSON.stringify({
                    entries: [
                        {
                            id: ONCE,
                            line: "// x",
                            sites: 1,
                            status: "baseline",
                        },
                        {
                            id: ONCE,
                            line: "// x",
                            sites: 1,
                            status: "baseline",
                        },
                    ],
                })
            )
        ).toThrow(/duplicate/);
        expect(() => parseLedger("{}")).toThrow(/entries/);
    });

    it("normalizes whitespace only", () => {
        expect(normalizeLine("   //  CR   x \t y  ")).toBe("// CR x y");
    });
});
