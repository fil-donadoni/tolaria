// The retirement marker and the gate that makes a change to a marked row
// reviewed rather than merely diffed (issue #3049, ADR 0114 §1).
//
// Every assertion here is over a PURE function, so none of it needs the 24 MB
// corpus cache — which matters more than usual for this feature: the marker's
// whole job is to guard cards whose hand-written definition no longer exists,
// and a guard that only runs where the corpus happens to be cached is a guard
// that is not there.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stampRetirements } from "../oracle-compile";
import { retirementProblems } from "../check-oracle-lockfile";
import {
    compilerSourceFiles,
    LOCKFILE_INPUT_SUMMARY,
    type CardRow,
} from "../lib/oracle-lockfile";
import {
    addRetirement,
    emptyRetirementLedger,
    parseRetirementLedger,
    serializeRetirementLedger,
    validateRetirementLedger,
    RETIREMENT_LEDGER_PATH,
    type RetirementEntry,
    type RetirementLedger,
} from "../lib/oracle-retirements";
import {
    acknowledgedNames,
    changedRetiredRows,
    retirementRefusal,
    retirementSection,
} from "../lib/retirement-ack";
import { refusalReason, type LandFacts } from "../land";

const ROOT = join(import.meta.dirname, "..", "..");

const ID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ID_B = "bbbbbbbb-0000-0000-0000-000000000002";

function entry(overrides: Partial<RetirementEntry> = {}): RetirementEntry {
    return {
        oracleId: ID_A,
        name: "Ashnod's Altar",
        retiredAt: "2026-09-02",
        issue: 2703,
        ...overrides,
    };
}

function ledgerOf(...entries: RetirementEntry[]): RetirementLedger {
    return { generator: "test", retirements: entries };
}

function row(overrides: Partial<CardRow> = {}): CardRow {
    return {
        oracleId: ID_A,
        name: "Ashnod's Altar",
        state: "ready",
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// The ledger
// ─────────────────────────────────────────────────────────────────────────

describe("the retirement ledger", () => {
    it("reports every structural problem at once, not the first", () => {
        const problems = validateRetirementLedger(
            ledgerOf(
                entry({ oracleId: ID_B, retiredAt: "2 Sept 2026" }),
                entry({ oracleId: ID_A, issue: 0 })
            )
        );
        // out-of-order, bad date, non-positive issue — all three, one run.
        expect(problems).toHaveLength(3);
        expect(problems.join("\n")).toMatch(/YYYY-MM-DD/);
        expect(problems.join("\n")).toMatch(/positive integer/);
        expect(problems.join("\n")).toMatch(/sorted by oracleId/);
    });

    it("rejects a card retired twice — one row, one provenance", () => {
        const problems = validateRetirementLedger(
            ledgerOf(entry(), entry({ issue: 2704 }))
        );
        expect(problems.join("\n")).toMatch(/duplicate oracleId/);
        expect(() => addRetirement(ledgerOf(entry()), entry())).toThrow(
            /already in/
        );
    });

    it("serializes deterministically, sorted, one retirement per line", () => {
        const text = serializeRetirementLedger(
            ledgerOf(
                entry({ oracleId: ID_B, name: "Northern Paladin" }),
                entry()
            )
        );
        const rows = text
            .split("\n")
            .filter((l) => l.trim().startsWith('{"oracleId"'));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain(ID_A);
        expect(rows[1]).toContain(ID_B);
        expect(validateRetirementLedger(parseRetirementLedger(text))).toEqual(
            []
        );
        expect(serializeRetirementLedger(parseRetirementLedger(text))).toBe(
            text
        );
    });

    it("refuses text that is not a ledger", () => {
        expect(() => parseRetirementLedger("{}")).toThrow(/retirements/);
    });

    it("the COMMITTED ledger is exactly what the serializer produces", () => {
        // The file is prettier-ignored, so nothing else re-derives its bytes: a
        // hand-edit would otherwise sit there until the next retirement rewrote
        // the file and buried the change in a reformat.
        const text = readFileSync(join(ROOT, RETIREMENT_LEDGER_PATH), "utf8");
        const ledger = parseRetirementLedger(text);
        expect(validateRetirementLedger(ledger)).toEqual([]);
        expect(serializeRetirementLedger(ledger)).toBe(text);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Stamping the marker onto the row
// ─────────────────────────────────────────────────────────────────────────

describe("stamping the marker onto the lockfile row", () => {
    it("marks only the named row, with `retired` as the row's LAST key", () => {
        const rows = [row(), row({ oracleId: ID_B, name: "Northern Paladin" })];
        const stamped = stampRetirements(rows, ledgerOf(entry({ pr: 3060 })));
        expect(stamped[1].retired).toBeUndefined();
        expect(stamped[0].retired).toEqual({
            at: "2026-09-02",
            issue: 2703,
            pr: 3060,
        });
        expect(Object.keys(stamped[0]).at(-1)).toBe("retired");
    });

    it("stops the compile when the entry names a card no row has", () => {
        expect(() =>
            stampRetirements([row({ oracleId: ID_B })], ledgerOf(entry()))
        ).toThrow(/marks nothing/);
    });

    it("stops the compile when the entry names a DIFFERENT card than it marks", () => {
        expect(() =>
            stampRetirements(
                [row({ name: "Northern Paladin" })],
                ledgerOf(entry())
            )
        ).toThrow(/names a different card/);
    });

    it("names every hashed input in the drift message a reader sees", () => {
        // The message that fires when the ledger is edited without
        // regenerating must SAY so. Hand-typed, it named only the compiler
        // sources, and the reader had no way to connect the red to the file
        // they had just edited — so the sentence is derived from the same
        // lists the hash walks, and this pins that.
        for (const file of compilerSourceFiles(ROOT)) {
            if (file.startsWith("convex/oracle/")) continue;
            expect(LOCKFILE_INPUT_SUMMARY).toContain(file);
        }
        expect(LOCKFILE_INPUT_SUMMARY).toContain("convex/oracle/**");
    });

    it("hashes the ledger into the lockfile's offline drift guard", () => {
        // Tier 1 is the only tier that runs on a clean checkout. A ledger
        // outside the hash makes "add a retirement, forget to compile"
        // invisible exactly there.
        expect(compilerSourceFiles(ROOT)).toContain(RETIREMENT_LEDGER_PATH);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// The offline consistency tier of `check:oracle`
// ─────────────────────────────────────────────────────────────────────────

describe("retirementProblems — every way a marker can be a lie", () => {
    const marked = row({ retired: { at: "2026-09-02", issue: 2703 } });

    it("passes when the ledger, the rows and the card index agree", () => {
        expect(
            retirementProblems(
                ledgerOf(entry()),
                { cards: [marked] },
                new Set()
            )
        ).toEqual([]);
    });

    it("reds when the ledger retires a card the lockfile has no row for", () => {
        expect(
            retirementProblems(
                ledgerOf(entry()),
                { cards: [] },
                new Set()
            ).join("\n")
        ).toMatch(/guards nothing/);
    });

    it("reds when the row carries no marker — a stale lockfile", () => {
        expect(
            retirementProblems(
                ledgerOf(entry()),
                { cards: [row()] },
                new Set()
            ).join("\n")
        ).toMatch(/no retirement marker/);
    });

    it("reds when the row's marker disagrees with the ledger on ANY axis", () => {
        // One case per field the marker carries: a comparison that folds a
        // field is a comparison that lets that field drift, and `pr` is the
        // one a partial check drops (it is the only optional one).
        for (const divergent of [
            entry({ issue: 9999 }),
            entry({ retiredAt: "2020-01-01" }),
            entry({ pr: 3060 }),
        ]) {
            expect(
                retirementProblems(
                    ledgerOf(divergent),
                    { cards: [marked] },
                    new Set()
                ).join("\n")
            ).toMatch(/disagrees with the ledger/);
        }
    });

    it("reds when a marked card STILL has a hand-written definition", () => {
        const problems = retirementProblems(
            ledgerOf(entry()),
            { cards: [marked] },
            new Set([ID_A])
        ).join("\n");
        expect(problems).toMatch(/still lists a HAND-WRITTEN definition/);
        expect(problems).toMatch(/only copy/);
    });

    it("reds when a row is marked but the ledger has no entry for it", () => {
        expect(
            retirementProblems(
                emptyRetirementLedger(),
                { cards: [marked] },
                new Set()
            ).join("\n")
        ).toMatch(/hand-added/);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Reading the marked rows out of a landing diff
// ─────────────────────────────────────────────────────────────────────────

const MARKED_A = `{"oracleId":"${ID_A}","name":"Ashnod's Altar","state":"ready","retired":{"at":"2026-09-02","issue":2703}}`;
const MARKED_B = `{"oracleId":"${ID_B}","name":"Northern Paladin","state":"ready","retired":{"at":"2026-09-02","issue":2703}}`;
const UNMARKED = `{"oracleId":"cccccccc-0000-0000-0000-000000000003","name":"Lightning Bolt","state":"ready"}`;

describe("changedRetiredRows", () => {
    it("finds a marked row on either side, ignores unmarked rows and headers", () => {
        const diff = [
            "diff --git a/data/oracle-compiled.json b/data/oracle-compiled.json",
            "--- a/data/oracle-compiled.json",
            "+++ b/data/oracle-compiled.json",
            "@@ -100 +100 @@",
            `-        ${UNMARKED},`,
            `+        ${MARKED_A},`,
            "@@ -200 +200 @@",
            `-        ${MARKED_B}`,
        ].join("\n");
        const changed = changedRetiredRows(diff);
        expect(changed.map((c) => c.name)).toEqual([
            "Ashnod's Altar",
            "Northern Paladin",
        ]);
        expect(changed[0].change).toBe("changed");
        // Present only on the `-` side, and no `+` line carries the row at
        // all: the row is gone from the file.
        expect(changed[1].change).toBe("row-removed");
    });

    it("tells a row that LOST its marker from a row that is gone", () => {
        // Both sides carry the row; only the `-` side carries the marker. The
        // row survives — calling that a deletion sent a reviewer looking for a
        // row that is sitting right there (review of this branch, finding 2).
        const unmarked = MARKED_A.replace(
            ',"retired":{"at":"2026-09-02","issue":2703}',
            ""
        );
        const changed = changedRetiredRows(
            [`-        ${MARKED_A},`, `+        ${unmarked},`].join("\n")
        );
        expect(changed).toHaveLength(1);
        expect(changed[0].change).toBe("marker-removed");
        expect(retirementRefusal(changed, "")).toMatch(/MARKER is removed/);
    });

    it("reports a row rewritten on both sides once, as a change not a removal", () => {
        const diff = [
            `-        ${MARKED_A},`,
            `+        ${MARKED_A.replace('"state":"ready"', '"state":"quarantine"')},`,
        ].join("\n");
        const changed = changedRetiredRows(diff);
        expect(changed).toHaveLength(1);
        expect(changed[0].change).toBe("changed");
    });

    it("tolerates the serializer's trailing comma and skips non-row lines", () => {
        expect(changedRetiredRows(`+        ${MARKED_A},`)).toHaveLength(1);
        expect(changedRetiredRows(`+    "generator": "x",`)).toEqual([]);
        expect(changedRetiredRows(`+        {not json`)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// The refusal
// ─────────────────────────────────────────────────────────────────────────

describe("retirementRefusal", () => {
    const changed = changedRetiredRows(`+        ${MARKED_A},`);

    it("allows a diff that touches no marked row", () => {
        expect(retirementRefusal([], "")).toBeNull();
    });

    it("refuses when the body has no retired-rows section, naming card and why", () => {
        const refusal = retirementRefusal(changed, "## Summary\n\nStuff.");
        expect(refusal).toMatch(/Ashnod's Altar/);
        expect(refusal).toMatch(/only copy of their behaviour/);
        expect(refusal).toMatch(/issue #2703/);
    });

    it("allows when the section names the card", () => {
        expect(
            retirementRefusal(
                changed,
                "## Retired rows\n\nAshnod's Altar — the row gained its marker; no compiled change.\n"
            )
        ).toBeNull();
    });

    it("refuses when the section exists but does not name the card", () => {
        expect(
            retirementRefusal(changed, "## Retired rows\n\nNone.\n")
        ).toMatch(/Ashnod's Altar/);
    });

    // ── The two fail-OPEN shapes a substring match let through (review of
    //    this branch, finding 1). Both are the worst outcome this gate has:
    //    it passes exactly when it should red.
    it("does not let a LONGER card's line acknowledge a shorter card", () => {
        const fog = `{"oracleId":"${ID_A}","name":"Fog","state":"ready","retired":{"at":"2026-09-02","issue":2703}}`;
        const fogBank = `{"oracleId":"${ID_B}","name":"Fog Bank","state":"ready","retired":{"at":"2026-09-02","issue":2703}}`;
        const both = changedRetiredRows(
            [`+        ${fog},`, `+        ${fogBank},`].join("\n")
        );
        const refusal = retirementRefusal(
            both,
            "## Retired rows\n\n- Fog Bank — quarantined by a grammar regression.\n"
        );
        expect(refusal).toMatch(/Fog\b/);
        expect(refusal).toMatch(/changes 1 retired/);
        // …and naming both cards allows it.
        expect(
            retirementRefusal(
                both,
                "## Retired rows\n\n- Fog Bank — quarantined.\n- Fog — row unchanged apart from the marker.\n"
            )
        ).toBeNull();
    });

    it("does not let ordinary prose acknowledge a one-word card name", () => {
        const fog = changedRetiredRows(
            `+        {"oracleId":"${ID_A}","name":"Fog","state":"ready","retired":{"at":"2026-09-02","issue":2703}},`
        );
        expect(
            retirementRefusal(
                fog,
                "## Retired rows\n\nNo retirements here; fixed an unrelated fog-of-war rendering glitch.\n"
            )
        ).toMatch(/Fog/);
    });

    it("reads a line's SUBJECT, not its prose", () => {
        const names = acknowledgedNames(
            "- **Fog Bank** — quarantined\n1. Storm Crow: state unchanged\n* Ashnod's Altar\nprose about fog and crows\n"
        );
        expect([...names].sort()).toEqual([
            "ashnod's altar",
            "fog bank",
            "prose about fog and crows",
            "storm crow",
        ]);
        expect(names.has("fog")).toBe(false);
    });

    it("reads the section level-aware, up to the next same-or-shallower heading", () => {
        const body =
            "## Retired rows\n\nAshnod's Altar.\n\n### Detail\n\nmore\n\n## Tests\n\nOther card names here.\n";
        expect(retirementSection(body)).toMatch(/Ashnod's Altar/);
        expect(retirementSection(body)).not.toMatch(/Other card names/);
        expect(retirementSection("## Summary\n\nx")).toBeNull();
    });
});

describe("land's refusal matrix carries the retirement refusal", () => {
    const facts = (overrides: Partial<LandFacts> = {}): LandFacts => ({
        branch: "feat/issue-3049",
        dirty: false,
        prState: "OPEN",
        prHeadRefName: "feat/issue-3049",
        skinReceiptInvalid: false,
        scenarioRefusal: null,
        retirementRefusal: null,
        ...overrides,
    });

    it("refuses on an unacknowledged marked row", () => {
        expect(refusalReason(facts({ retirementRefusal: "boom" }))).toBe(
            "boom"
        );
    });

    it("allows when there is nothing to acknowledge", () => {
        expect(refusalReason(facts())).toBeNull();
    });
});
