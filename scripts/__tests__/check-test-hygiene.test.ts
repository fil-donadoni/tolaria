import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { HEALTH_SCRIPTS } from "../lib/health-step";
import {
    HYGIENE_CORPUS_FLOOR,
    hygieneVerdict,
    type HygieneReport,
} from "../lib/test-hygiene";

/**
 * The test-suite hygiene census (issue #4490): a `health` step that keeps the
 * identity-test classifier's two purge classes at zero repo-wide.
 *
 * What is tested here is the VERDICT and the WIRING, never the census over
 * the real tree: that scan loads the whole catalogue and walks every test
 * file, which is exactly the cost the issue keeps out of every PR-phase gate.
 * The classifier's own rules are proven in `identity-test-classifier.test.ts`
 * and the dry run in `purge-identity-tests.test.ts`; this file proves that a
 * non-zero count of either class, a bad allow-list entry, or a sweep that
 * scanned nothing each turns the step red with a message naming the fix.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
) as { scripts: Record<string, string> };

/** A report with both classes at zero over a real-sized corpus. */
const clean = (): HygieneReport => ({
    files: HYGIENE_CORPUS_FLOOR.files + 800,
    blocks: HYGIENE_CORPUS_FLOOR.blocks + 16_000,
    identity: { flagged: 0, allowListed: 196 },
    opOnly: { blocks: 0, cards: 0, onPureDslCards: 600 },
    stale: [],
    ambiguous: [],
    rows: [],
});

describe("check:test-hygiene — the verdict (issue #4490)", () => {
    it("is green when both classes are at zero and the allow-list is clean", () => {
        expect(hygieneVerdict(clean())).toEqual({ ok: true, findings: [] });
    });

    it("reds on an identity block, naming it and the two honest fixes", () => {
        const r = clean();
        r.identity.flagged = 1;
        r.rows.push(
            "identity\tsrc/lib/__tests__/x.test.ts:11\tdefaults > is 3\t"
        );
        const v = hygieneVerdict(r);
        expect(v.ok).toBe(false);
        expect(v.findings.join("\n")).toMatch(/1 identity block/);
        expect(v.findings.join("\n")).toContain(
            "src/lib/__tests__/x.test.ts:11 — defaults > is 3"
        );
        expect(v.findings.join("\n")).toMatch(/delete it/);
        expect(v.findings.join("\n")).toMatch(/identity-test-allowlist\.json/);
    });

    it("reds on an Op-only block, naming it", () => {
        const r = clean();
        r.opOnly.blocks = 1;
        r.rows.push(
            "op-only\tconvex/cards/sets/lea/__tests__/red.test.ts:118\tLightning Bolt > deals 3\tLightning Bolt"
        );
        const v = hygieneVerdict(r);
        expect(v.ok).toBe(false);
        expect(v.findings.join("\n")).toMatch(/1 Op-only block/);
        expect(v.findings.join("\n")).toContain(
            "convex/cards/sets/lea/__tests__/red.test.ts:118 — Lightning Bolt > deals 3"
        );
    });

    it("reds on a stale allow-list entry and on an ambiguous one", () => {
        const stale = clean();
        stale.stale = ["a/__tests__/b.test.ts :: d > t"];
        expect(hygieneVerdict(stale).ok).toBe(false);
        expect(hygieneVerdict(stale).findings.join("\n")).toMatch(
            /1 stale allow-list entry[\s\S]*a\/__tests__\/b\.test\.ts :: d > t/
        );

        const ambiguous = clean();
        ambiguous.ambiguous = ["a/__tests__/b.test.ts :: d > t"];
        expect(hygieneVerdict(ambiguous).ok).toBe(false);
        expect(hygieneVerdict(ambiguous).findings.join("\n")).toMatch(
            /1 ambiguous allow-list entry/
        );
    });

    it("reds when the sweep scanned fewer files or blocks than the floor", () => {
        const noFiles = clean();
        noFiles.files = 0;
        noFiles.blocks = 0;
        const v = hygieneVerdict(noFiles);
        expect(v.ok).toBe(false);
        expect(v.findings.join("\n")).toMatch(/corpus below floor/);

        const fewBlocks = clean();
        fewBlocks.blocks = HYGIENE_CORPUS_FLOOR.blocks - 1;
        expect(hygieneVerdict(fewBlocks).ok).toBe(false);
    });

    it("lists every finding, not just the first", () => {
        const r = clean();
        r.identity.flagged = 2;
        r.opOnly.blocks = 1;
        r.stale = ["x"];
        const v = hygieneVerdict(r);
        expect(v.findings.join("\n")).toMatch(/2 identity block/);
        expect(v.findings.join("\n")).toMatch(/1 Op-only block/);
        expect(v.findings.join("\n")).toMatch(/1 stale/);
    });
});

describe("check:test-hygiene — the wiring", () => {
    it("is a package script that runs the census", () => {
        expect(pkg.scripts["check:test-hygiene"]).toBe(
            "bun scripts/check-test-hygiene.ts"
        );
    });

    it("is a health step, after check:targets", () => {
        expect(HEALTH_SCRIPTS).toContain("check:test-hygiene");
        expect(HEALTH_SCRIPTS.indexOf("check:test-hygiene")).toBeGreaterThan(
            HEALTH_SCRIPTS.indexOf("check:targets")
        );
    });

    // Never a PR-phase gate (issue #4490): scanned rather than enumerated, so
    // a script newly composed from `check:pr` or `check:all` is caught too.
    it("no other package script invokes it", () => {
        const callers = Object.entries(pkg.scripts)
            .filter(
                ([name, body]) =>
                    name !== "check:test-hygiene" &&
                    body.includes("check:test-hygiene")
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });

    it("enters the guard cache before importing the classifier or the registry", () => {
        const src = fs.readFileSync(
            path.join(ROOT, "scripts/check-test-hygiene.ts"),
            "utf8"
        );
        const enter = src.indexOf("enterGuardCache({");
        const purgeImport = src.indexOf('import("./purge-identity-tests")');
        expect(enter).toBeGreaterThan(-1);
        expect(purgeImport).toBeGreaterThan(enter);
        // The declared inputs cover the corpus, the registry and both scripts.
        expect(src).toContain("...CARD_REGISTRY_GLOBS");
        expect(src).toContain("...TEST_CORPUS_GLOBS");
        expect(src).toContain('"scripts/purge-identity-tests.ts"');
        expect(src).toContain('"scripts/check-test-hygiene.ts"');
    });
});

/**
 * Issue #4686: the census is a `health` step, so the FIRST time an author
 * learns that a constant-pin or object-identity block owes an allow-list row
 * is when the base tip goes RED — unless the authoring tier says so first.
 * Both PR #4666 (retitled an allow-listed block) and PR #4667 (added a
 * re-export identity guard) landed green while `convex/CLAUDE.md` still
 * described the pre-#4489 card-set guard ("allowlist empty, meant to stay
 * empty"). The rule lives in prose where the mistake is made; this keeps the
 * prose from silently dropping it again — anchored to the SECTION an author
 * reads (the sentence pasted elsewhere in the file does not count), and it
 * names both guards, so the card-set PR-phase one cannot be written out
 * either (the first draft of this fix did exactly that).
 */
describe("check:test-hygiene — the authoring tier names it (issue #4686)", () => {
    /** The body of the `## <heading>` section, up to the next `## `. */
    const section = (rel: string, heading: string): string => {
        const doc = fs.readFileSync(path.join(ROOT, rel), "utf8");
        const start = doc.indexOf(`\n## ${heading}`);
        expect(start, `${rel}: no section "## ${heading}"`).toBeGreaterThan(-1);
        const rest = doc.slice(start + 1);
        const end = rest.indexOf("\n## ", 1);
        return end === -1 ? rest : rest.slice(0, end);
    };

    it("convex/CLAUDE.md § Card testing convention names both identity guards and the allow-list", () => {
        const body = section("convex/CLAUDE.md", "Card testing convention");
        // The PR-phase guard over convex/cards/sets/** (issue #2363) …
        expect(body).toContain("identity-only-card-tests.test.ts");
        // … and the repo-wide health census (issue #4490) with its allow-list.
        expect(body).toContain("check:test-hygiene");
        expect(body).toContain("scripts/lib/identity-test-allowlist.json");
        // The pre-#4489 claim, in any wording: an allow-list nobody may add to.
        expect(body).not.toMatch(/allow[-\s]?list[^.]*\bempty\b/i);
    });

    it("/next-issue § 3 Implement tells the author to run the census before the PR", () => {
        const body = section(
            ".claude/skills/next-issue/SKILL.md",
            "3. Implement"
        );
        expect(body).toContain("check:test-hygiene");
        expect(body).toContain("scripts/lib/identity-test-allowlist.json");
    });
});
