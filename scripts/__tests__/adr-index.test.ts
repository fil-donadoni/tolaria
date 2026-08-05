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
 * **Keyed by FILENAME, not by number.** Two ADR numbers are legitimately shared
 * (0020 and 0021 each cover two records, annotated `⚠️ (number shared)` in the
 * index), so a number-keyed check would either report a false duplicate or
 * silently accept one of the pair standing in for the other.
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
