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
