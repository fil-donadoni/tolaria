import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    baseLedger,
    ledgerReportForRepo,
    licensedWidening,
    repoWidening,
    SCANNED,
    scanCitations,
    scanRepo,
    sourcesAt,
} from "../check-cr-citations.ts";
import {
    baselineSites,
    confirmLine,
    emptyLedger,
    entryKey,
    formatReport,
    initialLedger,
    ledgerReport,
    normalizeLine,
    parseLedger,
    planWidening,
    pruneStale,
    reportIsClean,
    serializeLedger,
    treeCitations,
    wideningOf,
    widenLedger,
    type Citation,
    type Ledger,
    type Widening,
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
    baseBaseline: Map<string, number> | null = new Map(),
    widened: Widening | null = null
) {
    return ledgerReport({
        citations,
        ledger,
        rules,
        baseBaseline,
        widened,
    });
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
            reportIsClean(
                report(citations, baseline, rulesV2, new Map([[key, 1]]))
            )
        ).toBe(true);
    });
});

describe("the baseline only shrinks", () => {
    const line = cite(SECTION, "the affected player chooses the order");
    const citations = citationsOf([{ file: FILE, text: line }]);
    const key = entryKey(SECTION, normalizeLine(line));
    const grown = initialLedger(citations);

    it("reds on a baseline entry the base branch's ledger does not have", () => {
        const r = report(citations, grown, rulesV1, new Map());
        expect(r.grown).toHaveLength(1);
        expect(r.grown[0]).toMatchObject({ id: SECTION, status: "baseline" });
        expect(formatReport(r, false)).toContain("the baseline only shrinks");
    });

    it("passes the same entry when the base branch has it", () => {
        expect(
            reportIsClean(
                report(citations, grown, rulesV1, new Map([[key, 1]]))
            )
        ).toBe(true);
    });

    it("reds on a baseline entry recording more sites than the base branch's — a raised count is one more unchecked site", () => {
        const two = citationsOf([
            { file: FILE, text: line },
            { file: TWIN, text: line },
        ]);
        const raised: Ledger = {
            ...grown,
            entries: grown.entries.map((e) => ({ ...e, sites: 2 })),
        };
        const r = report(two, raised, rulesV1, new Map([[key, 1]]));
        expect(r.unrecorded).toHaveLength(0);
        expect(r.grown.map((e) => e.sites)).toEqual([2]);
        expect(formatReport(r, false)).toContain("more sites than the base");
        expect(
            reportIsClean(report(two, raised, rulesV1, new Map([[key, 2]])))
        ).toBe(true);
    });

    it("skips the comparison — and says so — when there is no base ledger to compare with", () => {
        const r = report(citations, grown, rulesV1, null);
        expect(r.grown).toHaveLength(0);
        expect(r.baselineChecked).toBe(false);
    });
});

describe("a tokenizer widening may add baseline entries — and nothing else may (issue #3697)", () => {
    // The merge-base tree makes two citations. The tokenizer the merge-base
    // ledger was kept with saw only SEEN (so the ledger records only it);
    // the widened tokenizer sees both. The fixture stands in for the
    // tokenizer change by giving the base ledger the narrower view.
    const SEEN = cite(ONCE, "once per event");
    const UNCOVERED = cite(BACK_FACE, "a back face entering");
    const beforeTree = [{ file: FILE, text: `${SEEN}\n${UNCOVERED}` }];
    const before = citationsOf(beforeTree);
    const base = initialLedger(citationsOf([{ file: FILE, text: SEEN }]));
    const baseKeys = baselineSites(base);
    const { uncovered: widening, lost } = wideningOf(before, base);
    const widened = widening;
    const seenKey = entryKey(ONCE, normalizeLine(SEEN));
    const uncoveredKey = entryKey(BACK_FACE, normalizeLine(UNCOVERED));

    it("uncovers exactly what the merge-base ledger lacks — never a citation the pre-widening tokenizer already saw — and loses nothing", () => {
        expect([...widening.keys()]).toEqual([uncoveredKey]);
        expect(widening.get(uncoveredKey)?.sites).toEqual([
            { file: FILE, line: 2 },
        ]);
        expect(lost).toEqual([]);
    });

    it("a change that re-keys or narrows what a citation is loses merge-base entries, and is refused — widen is never regenerate", () => {
        // The merge-base ledger records SEEN once; a tokenizer that keys
        // lines differently makes SEEN nowhere on the same tree (every
        // citation there looks new instead).
        const rekeyed = citationsOf([
            { file: FILE, text: `${cite(ONCE, "once per event, rekeyed")}` },
        ]);
        const w = wideningOf(rekeyed, base);
        expect(w.lost.map((e) => entryKey(e.id, e.line))).toEqual([seenKey]);
        expect(w.uncovered.size).toBe(1);
        const p = planWidening({
            tokenizerChanged: true,
            widening: w.uncovered,
            lost: w.lost,
            ledger: base,
            afterCitations: rekeyed,
            ids,
        });
        expect(p.kind).toBe("refused");
        if (p.kind === "refused") expect(p.why).toMatch(/narrows or re-keys/);
        expect(
            licensedWidening({
                tokenizerChanged: true,
                widening: w.uncovered,
                lost: w.lost,
            })
        ).toBeNull();
        // Fewer sites of a recorded line is a loss too.
        const twice = initialLedger(
            citationsOf([
                { file: FILE, text: SEEN },
                { file: TWIN, text: SEEN },
            ])
        );
        expect(wideningOf(before, twice).lost).toHaveLength(1);
    });

    it("a widening that adds only tokenizer-visible citations is green; the same entry with no widening in the diff is still grown", () => {
        const { ledger, added } = widenLedger(base, widening, before);
        expect(added).toEqual([
            {
                id: BACK_FACE,
                line: normalizeLine(UNCOVERED),
                sites: 1,
                status: "baseline",
            },
        ]);
        const licensed = report(before, ledger, rulesV1, baseKeys, widened);
        expect(reportIsClean(licensed)).toBe(true);
        expect(licensed.widened).toBe(1);
        expect(licensed.grown).toHaveLength(0);

        const unlicensed = report(before, ledger, rulesV1, baseKeys, null);
        expect(unlicensed.grown.map((e) => entryKey(e.id, e.line))).toEqual([
            uncoveredKey,
        ]);
        expect(unlicensed.widened).toBe(0);
        expect(formatReport(unlicensed, false)).toContain(
            "bun run cr:ledger widen"
        );
    });

    it("an entry whose line also changed in the diff reds — the widening never produced it, and never records it", () => {
        const edited = cite(BACK_FACE, "a back face entering face up");
        const after = citationsOf([{ file: FILE, text: `${SEEN}\n${edited}` }]);
        const editedKey = entryKey(BACK_FACE, normalizeLine(edited));
        const regenerated: Ledger = {
            ...base,
            entries: [
                ...base.entries,
                {
                    id: BACK_FACE,
                    line: normalizeLine(edited),
                    sites: 1,
                    status: "baseline",
                },
            ],
        };
        const r = report(after, regenerated, rulesV1, baseKeys, widened);
        expect(r.grown.map((e) => entryKey(e.id, e.line))).toEqual([editedKey]);
        expect(r.widened).toBe(0);

        const { added, gone } = widenLedger(base, widening, after);
        expect(added).toHaveLength(0);
        expect(gone).toBe(1);
    });

    it("re-baselining an already-recorded citation reds — a `confirmed` entry turned back is grown, not widened", () => {
        const confirmedBase = confirmLine(
            base,
            citationsOf([{ file: FILE, text: SEEN }]),
            rulesV1,
            before
        ).ledger;
        const w = wideningOf(before, confirmedBase);
        expect(w.uncovered.has(seenKey)).toBe(false);
        expect(w.lost).toEqual([]);
        const turnedBack: Ledger = {
            ...confirmedBase,
            entries: confirmedBase.entries.map((e) =>
                e.id === ONCE
                    ? {
                          id: e.id,
                          line: e.line,
                          sites: e.sites,
                          status: "baseline",
                      }
                    : e
            ),
        };
        const r = report(
            citationsOf([{ file: FILE, text: SEEN }]),
            turnedBack,
            rulesV1,
            baselineSites(confirmedBase),
            w.uncovered
        );
        expect(r.grown.map((e) => entryKey(e.id, e.line))).toEqual([seenKey]);
    });

    it("confirmed entries survive a widening untouched — one the branch already confirmed is skipped, not re-entered", () => {
        const branch = confirmLine(
            base,
            citationsOf([{ file: FILE, text: UNCOVERED }]),
            rulesV1,
            before
        ).ledger;
        const confirmedEntry = structuredClone(
            branch.entries.find((e) => e.id === BACK_FACE)
        );
        expect(confirmedEntry?.status).toBe("confirmed");
        const { ledger, added, alreadyRecorded } = widenLedger(
            branch,
            widening,
            before
        );
        expect(added).toHaveLength(0);
        expect(alreadyRecorded).toBe(1);
        expect(ledger.entries).toEqual(branch.entries);
        expect(ledger.entries.find((e) => e.id === BACK_FACE)).toEqual(
            confirmedEntry
        );
    });

    it("a site the branch added stays unchecked: the entry takes the smaller count and the extra site reds as new-sites", () => {
        const after = citationsOf([
            ...beforeTree,
            { file: TWIN, text: UNCOVERED },
        ]);
        const { ledger, added } = widenLedger(base, widening, after);
        expect(added[0].sites).toBe(1);
        const r = report(after, ledger, rulesV1, baseKeys, widened);
        expect(r.grown).toHaveLength(0);
        expect(r.unrecorded).toHaveLength(1);
        expect(r.unrecorded[0]).toMatchObject({
            reason: "new-sites",
            recordedSites: 1,
        });
        // A hand-raised count under the widened key is not licensed either:
        // the widening had one site there, so two is one unchecked site.
        const raised: Ledger = {
            ...ledger,
            entries: ledger.entries.map((e) =>
                e.id === BACK_FACE ? { ...e, sites: 2 } : e
            ),
        };
        const hand = report(after, raised, rulesV1, baseKeys, widened);
        expect(hand.unrecorded).toHaveLength(0);
        expect(hand.grown.map((e) => entryKey(e.id, e.line))).toEqual([
            uncoveredKey,
        ]);
        expect(hand.widened).toBe(0);
    });

    describe("the command's decision", () => {
        const plan = (over: Partial<Parameters<typeof planWidening>[0]>) =>
            planWidening({
                tokenizerChanged: true,
                widening,
                lost: [],
                ledger: base,
                afterCitations: before,
                ids,
                ...over,
            });

        it("refuses when the tokenizer is unchanged against the merge-base", () => {
            const p = plan({ tokenizerChanged: false });
            expect(p.kind).toBe("refused");
            if (p.kind === "refused") expect(p.why).toMatch(/unchanged/);
        });

        it("refuses when the changed tokenizer uncovers nothing", () => {
            const p = plan({ widening: new Map() });
            expect(p.kind).toBe("refused");
            if (p.kind === "refused")
                expect(p.why).toMatch(/nothing was widened/);
        });

        it("enters what it uncovered as baseline, and leaves an unresolvable id to the existence scan", () => {
            const bogus = cite("999.9z", "no such rule");
            const wider = wideningOf(
                citationsOf([
                    { file: FILE, text: `${SEEN}\n${UNCOVERED}\n${bogus}` },
                ]),
                base
            ).uncovered;
            const p = plan({
                widening: wider,
                afterCitations: citationsOf([
                    { file: FILE, text: `${SEEN}\n${UNCOVERED}\n${bogus}` },
                ]),
            });
            expect(p.kind).toBe("ok");
            if (p.kind !== "ok") return;
            expect(p.added.map((e) => e.status)).toEqual(["baseline"]);
            expect(p.added[0].id).toBe(BACK_FACE);
            expect(p.unresolvable.map((c) => c.id)).toEqual(["999.9z"]);
            expect(p.ledger.entries.some((e) => e.id === "999.9z")).toBe(false);
        });
    });
});

describe("the merge-base tree is read out of the object store, byte-exact", () => {
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const git = (args: string[]) =>
        execFileSync("git", args, {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 64 << 20,
        });

    it("lists every SCANNED file HEAD tracks, and every sampled file matches `git show`", () => {
        const sources = sourcesAt(ROOT, "HEAD");
        // `-z` on both sides: without it git quotes a non-ASCII path.
        const expected = git(["ls-tree", "-r", "--name-only", "-z", "HEAD"])
            .split("\0")
            .filter((f) => SCANNED.test(f));
        expect(sources.map((s) => s.file)).toEqual(expected);
        // This file carries multi-byte characters (the em dashes above), so
        // a slice by string length instead of byte size would misalign every
        // file after it.
        const self = "scripts/__tests__/cr-citation-ledger.test.ts";
        const probes = [
            self,
            ...expected.filter((_, i) => i % 400 === 0),
            expected[expected.length - 1],
        ];
        for (const file of probes) {
            const source = sources.find((s) => s.file === file);
            expect(source, file).toBeDefined();
            expect(source!.text, file).toBe(git(["show", `HEAD:${file}`]));
        }
    });

    it("the tokenizer at HEAD, on the merge-base tree, sees exactly what the merge-base ledger records — a tokenizer change without its `widen` cannot land", () => {
        // Whole-tree invariant beside the one above: if this checkout changed
        // the tokenizer, every citation it newly makes of the merge-base tree
        // must already be in the ledger (a `widen` was run), and nothing the
        // merge-base recorded may have been lost (it is a widening, not a
        // re-keying). An unchanged tokenizer skips the merge-base read.
        const base = baseLedger(ROOT);
        if (base === null) return; // no base ledger in this clone — the gate says so
        const w = repoWidening(base, ROOT);
        expect(
            w.lost.map((e) => `CR ${e.id}  ${e.line}`),
            "merge-base citations the current tokenizer no longer makes"
        ).toEqual([]);
        const ledger = parseLedger(
            readFileSync(join(ROOT, "data/cr/citations-ledger.json"), "utf8")
        );
        const recorded = new Set(
            ledger.entries.map((e) => entryKey(e.id, e.line))
        );
        // A key the branch's own tree no longer makes — it corrected that
        // line — is not entered by `widen` (it would be stale on arrival);
        // the corrected line is a new citation the gate reds until confirmed.
        const now = treeCitations(scanRepo(ROOT).citations);
        expect(
            [...w.widening.keys()].filter(
                (k) => !recorded.has(k) && now.has(k)
            ),
            "citations the widened tokenizer uncovered that `bun run cr:ledger widen` has not recorded"
        ).toEqual([]);
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
        const r = report(two, baseline, rulesV1, new Map([[key, 1]]));
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
