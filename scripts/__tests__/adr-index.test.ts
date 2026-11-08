import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * The ADR index is complete (issue #2191).
 *
 * CLAUDE.md has always said "every new ADR MUST add its row to
 * `docs/adr/README.md` … an ADR without an index row is incomplete". Nothing
 * enforced it, and by the time this guard was written **two** records had
 * slipped through — 0080 (Manual Mode beside the GRE) and 0081 (the card
 * catalogue stays in code), both `accepted`, both invisible to anyone reading
 * the index.
 *
 * That is the whole failure mode: the README is described in CLAUDE.md as the
 * *queryable* index — the thing you read FIRST to discover which records exist.
 * A record missing from it is not merely undocumented, it is unfindable, and
 * the next design pass re-litigates a decision that was already made.
 *
 * **Keyed by FILENAME, not by number**, for the completeness half: a row and a
 * record are the same thing only if they name the same file.
 *
 * The NUMBER is guarded separately (issue #3527). It used to be un-guardable:
 * `0020` and `0021` each covered two unrelated records, so the index warned
 * readers to "rely on the slug, not the number" and 101 citations of the form
 * `ADR 0020` were undecidable without opening the file. The duplicates were
 * renumbered to `0125` / `0126` and every citation rewritten, which makes the
 * number an identifier again — and an identifier nothing enforces goes back to
 * being a slug within one careless `cp`.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ADR_DIR = path.join(REPO_ROOT, "docs", "adr");

const adrFiles = (): string[] =>
    fs
        .readdirSync(ADR_DIR)
        .filter((f) => /^\d{4}-.+\.md$/.test(f))
        .sort();

const index = (): string =>
    fs.readFileSync(path.join(ADR_DIR, "README.md"), "utf8");

describe("docs/adr/README.md is the complete index", () => {
    it("finds a real corpus", () => {
        // A guard whose corpus silently became empty passes forever.
        expect(adrFiles().length).toBeGreaterThan(50);
    });

    it("links every ADR file", () => {
        const missing = adrFiles().filter((f) => !index().includes(f));
        expect(
            missing,
            `ADR file(s) with no row in docs/adr/README.md — add one per CLAUDE.md § Domain docs:\n${missing.join("\n")}`
        ).toEqual([]);
    });

    it("has no row pointing at a file that does not exist", () => {
        const linked = Array.from(
            index().matchAll(/\]\((\d{4}-[a-z0-9-]+\.md)\)/g)
        ).map((m) => m[1]);
        expect(linked.length).toBeGreaterThan(50);
        const orphans = Array.from(new Set(linked)).filter(
            (f) => !fs.existsSync(path.join(ADR_DIR, f))
        );
        expect(
            orphans,
            `index row(s) pointing at a missing file:\n${orphans.join("\n")}`
        ).toEqual([]);
    });
});

describe("ADR numbers identify exactly one record (issue #3527)", () => {
    it("has no duplicate number", () => {
        const byNumber = new Map<string, string[]>();
        for (const file of adrFiles()) {
            const n = file.slice(0, 4);
            byNumber.set(n, [...(byNumber.get(n) ?? []), file]);
        }
        const shared = [...byNumber.entries()].filter(
            ([, files]) => files.length > 1
        );
        expect(
            shared.map(([n, files]) => `${n}: ${files.join(", ")}`),
            "two records share a number — a citation of the form `ADR NNNN` " +
                "cannot say which one it means. Take the next free number for " +
                "the newer record and rewrite its citations."
        ).toEqual([]);
    });

    it("never opens a record with somebody else's number", () => {
        // Only the records that USE the `# ADR NNNN — …` convention are
        // checked. Roughly ninety open with a prose title instead, and this
        // guard is about a heading that CONTRADICTS its filename (0008 opened
        // `# ADR 0007 — …` for months), not about imposing a house style on
        // the rest.
        const wrong: string[] = [];
        for (const file of adrFiles()) {
            const head = fs
                .readFileSync(path.join(ADR_DIR, file), "utf8")
                .split("\n")[0];
            const m = /^#\s*ADR\s+(\d{4})\b/.exec(head);
            if (m && m[1] !== file.slice(0, 4)) {
                wrong.push(`${file} opens "${head.trim()}"`);
            }
        }
        expect(
            wrong,
            `ADR heading names a different number than its filename:\n${wrong.join("\n")}`
        ).toEqual([]);
    });
});

/**
 * The index `Status` column agrees with the records (issue #8699).
 *
 * A reader of the index must see which decisions were amended or superseded
 * WITHOUT opening 167 files (owner, 2026-11-07). The column grammar:
 * `active` | `proposed` | `amended by NNNN[, NNNN]` | `superseded by NNNN`.
 * `docs/research/adr-audit-2026-11-07.md` seeded it.
 *
 * Both directions are guarded: a record whose own status text says it was
 * amended/superseded by an ADR cannot sit as `active` in the index, and a row
 * that says it was amended/superseded must be backed by a line in the record's
 * status text naming the ADR — otherwise the row is a claim nobody can verify
 * from the file.
 */

const STATUS_GRAMMAR =
    /^(active|proposed|amended by \d{4}(, \d{4})*|superseded by \d{4})$/;

const rowStatuses = (): Map<string, { status: string; file: string }> => {
    const rows = new Map<string, { status: string; file: string }>();
    for (const line of index().split("\n")) {
        const cells = line.split("|").map((c) => c.trim());
        // ["", "0005", decision, status, "[file](file)", ""]
        if (cells.length !== 6 || !/^\d{4}$/.test(cells[1])) continue;
        const file = /\]\((\d{4}-[a-z0-9-]+\.md)\)/.exec(cells[4])?.[1] ?? "";
        rows.set(cells[1], { status: cells[3], file });
    }
    return rows;
};

/** The record's status text: everything before the first non-status `##`. */
const statusRegion = (file: string): string => {
    const out: string[] = [];
    for (const line of fs
        .readFileSync(path.join(ADR_DIR, file), "utf8")
        .split("\n")
        .slice(1)) {
        if (/^##\s/.test(line) && !/^##\s+status\b/i.test(line)) break;
        out.push(line);
    }
    return out.join("\n");
};

const SAYS_MOVED_ON =
    /\b(amended|superseded)\s+by\s+(?:\[?ADR\s+|\[?)?(\d{4})/gi;

describe("docs/adr/README.md Status column (issue #8699)", () => {
    it("has a status on every row, in the grammar", () => {
        const rows = rowStatuses();
        expect(rows.size).toBeGreaterThan(50);
        const bad = [...rows].filter(([, r]) => !STATUS_GRAMMAR.test(r.status));
        expect(
            bad.map(([n, r]) => `${n}: "${r.status}"`),
            "Status must be `active`, `proposed`, `amended by NNNN[, NNNN]` or `superseded by NNNN`"
        ).toEqual([]);
    });

    it("names only ADR numbers that exist, never its own", () => {
        const numbers = new Set(adrFiles().map((f) => f.slice(0, 4)));
        const bad: string[] = [];
        for (const [n, r] of rowStatuses()) {
            for (const ref of r.status.match(/\d{4}/g) ?? []) {
                if (!numbers.has(ref) || ref === n) {
                    bad.push(`${n}: "${r.status}" names ${ref}`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it("does not call a record active when its own status says it moved on", () => {
        const bad: string[] = [];
        for (const [n, r] of rowStatuses()) {
            if (!/^(active|proposed)$/.test(r.status) || !r.file) continue;
            const m = [...statusRegion(r.file).matchAll(SAYS_MOVED_ON)][0];
            if (m)
                bad.push(`${n} is "${r.status}" but its status says "${m[0]}"`);
        }
        expect(
            bad,
            "set the row's Status to `amended by NNNN` / `superseded by NNNN`"
        ).toEqual([]);
    });

    it("backs every amended/superseded row with a line in the record", () => {
        const bad: string[] = [];
        for (const [n, r] of rowStatuses()) {
            const m = /^(amended|superseded) by (.+)$/.exec(r.status);
            if (!m || !r.file) continue;
            const named = new Set(
                [...statusRegion(r.file).matchAll(SAYS_MOVED_ON)].map(
                    (x) => x[2]
                )
            );
            const refs = m[2].split(", ");
            if (!refs.some((ref) => named.has(ref))) {
                bad.push(
                    `${n} says "${r.status}" but ${r.file} status text names none of them`
                );
            }
        }
        expect(
            bad,
            "add `Amended by ADR NNNN (date)` / `Superseded by ADR NNNN (date)` to the record's status text"
        ).toEqual([]);
    });
});
