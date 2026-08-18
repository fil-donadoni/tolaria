import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import {
    isDocPath,
    classifyChanges,
    parsePorcelainPaths,
    slugify,
    DOC_GATE_TESTS,
    DOC_GATE_TESTS_EXCLUDED,
    buildShipMergeCommand,
} from "../docs-lane";

/**
 * The documentation lane (`bun run wt:docs` / `bun run docs:ship`).
 *
 * The lane's whole justification is that it is CHEAP: a prose change owes
 * `check:docs` (seconds, no lock) instead of the heavy suite. That trade is
 * only sound while `check:docs` really covers the guards that read prose — so
 * the load-bearing test here is the census: a NEW guard that reads a
 * documentation file must be classified, or the lane silently stops covering
 * it and starts merging changes nothing checked.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TESTS_DIR = path.join(REPO_ROOT, "scripts", "__tests__");

describe("docs-lane — what the lane will carry", () => {
    it("accepts prose", () => {
        for (const p of [
            "docs/adr/0101-something.md",
            "docs/adr/README.md",
            "docs/findings/1712-note.md",
            "CONTEXT.md",
            "CLAUDE.md",
            ".claude/skills/new-card/SKILL.md",
            "README.md",
        ]) {
            expect(isDocPath(p), `expected doc: ${p}`).toBe(true);
        }
    });

    it("refuses anything that can reach the engine", () => {
        // The cheap gate is only defensible because none of these can ride it.
        for (const p of [
            "convex/gre/layers.ts",
            "convex/cards/sets/lea/red.ts",
            "src/components/board/Hand.tsx",
            "scripts/gate.ts",
            ".claude/hooks/deny-guard.sh",
            ".claude/settings.json",
            "package.json",
            "data/card-index.json",
        ]) {
            expect(isDocPath(p), `expected NOT doc: ${p}`).toBe(false);
        }
    });

    it("splits a mixed changeset so ship can refuse it whole", () => {
        const { docs, foreign } = classifyChanges([
            "docs/adr/0101-x.md",
            "convex/gre/layers.ts",
            "CONTEXT.md",
        ]);
        expect(docs).toEqual(["docs/adr/0101-x.md", "CONTEXT.md"]);
        expect(foreign).toEqual(["convex/gre/layers.ts"]);
    });

    it("reads porcelain paths without eating the first character", () => {
        // The shipped bug: the output was trimmed before splitting, which
        // removed the leading status space of the FIRST line only and shifted
        // its columns by one. `git add -- LAUDE.md` then failed with
        // `pathspec 'LAUDE.md' did not match any files`.
        const raw = [
            " M CLAUDE.md", // unstaged modification: leading space is DATA
            "?? docs/guides/",
            "A  docs/guides/afk-loop.md",
            "R  docs/old.md -> docs/new.md",
            '?? "docs/with space.md"',
            "",
        ].join("\n");

        expect(parsePorcelainPaths(raw)).toEqual([
            "CLAUDE.md",
            "docs/guides/",
            "docs/guides/afk-loop.md",
            "docs/new.md",
            "docs/with space.md",
        ]);
    });

    it("reduces a slug to something a branch name can hold", () => {
        expect(slugify("ADR 0101 — as-enters")).toBe("adr-0101-as-enters");
        expect(slugify("--messy--")).toBe("messy");
        expect(() => slugify("///")).toThrow();
    });
});

describe("docs-lane — the doc gate covers every guard that reads prose", () => {
    /** Source mentions a repo documentation path in a way a guard would. */
    const READS_DOCS =
        /"docs\/|docs\/adr|CONTEXT\.md|\.claude\/skills|\.md"|README\.md/;

    it("classifies every doc-reading guard as covered or excluded-with-a-reason", () => {
        const unclassified: string[] = [];
        for (const file of fs.readdirSync(TESTS_DIR)) {
            if (!file.endsWith(".test.ts")) continue;
            const rel = path.posix.join("scripts", "__tests__", file);
            if (rel.endsWith("docs-lane.test.ts")) continue; // this file
            const src = fs.readFileSync(path.join(TESTS_DIR, file), "utf8");
            if (!READS_DOCS.test(src)) continue;
            const covered = DOC_GATE_TESTS.includes(rel);
            const excluded = rel in DOC_GATE_TESTS_EXCLUDED;
            if (!covered && !excluded) unclassified.push(rel);
        }
        expect(
            unclassified,
            `These guards read documentation but check:docs neither runs them nor records why not.\n` +
                `Add each to DOC_GATE_TESTS (and to check:docs:inner in package.json), or to\n` +
                `DOC_GATE_TESTS_EXCLUDED with the reason it does not guard repo prose:\n` +
                unclassified.map((f) => `  ${f}`).join("\n")
        ).toEqual([]);
    });

    it("every exclusion carries a reason", () => {
        for (const [file, reason] of Object.entries(DOC_GATE_TESTS_EXCLUDED)) {
            expect(
                reason.trim().length,
                `empty reason for ${file}`
            ).toBeGreaterThan(20);
            expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
        }
    });

    it("every covered guard exists", () => {
        for (const file of DOC_GATE_TESTS) {
            expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
        }
    });

    it("check:docs runs exactly the covered guards — no drift between list and script", () => {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        const inner = pkg.scripts["check:docs:inner"];
        expect(
            inner,
            "check:docs:inner missing from package.json"
        ).toBeTruthy();

        const listed = (inner.match(/scripts\/__tests__\/[\w.-]+\.test\.ts/g) ??
            []) as string[];
        expect([...listed].sort()).toEqual([...DOC_GATE_TESTS].sort());
        // The lane's cost claim rests on this: no heavy gate hides in here.
        expect(inner).not.toMatch(
            /bun run (test|test:app|test:bot|check:all)\b/
        );
    });
});

describe("docs-lane — the landing runs under the merge lock (#2537)", () => {
    const cmd = buildShipMergeCommand({
        branch: "docs/adr-0101",
        pr: 2537,
        primary: "/repo",
        cwd: "/repo-docs",
    });

    it("re-gates the REBASED tree inside the lock, before pushing", () => {
        // `main` can move between the pre-PR push and acquiring the lock, so
        // the rebase, the doc gate and the force-push all belong in here — the
        // tree that lands is the tree that was checked.
        const at = (needle: string) => {
            const i = cmd.indexOf(needle);
            expect(i, `missing "${needle}" in: ${cmd}`).toBeGreaterThan(-1);
            return i;
        };
        expect(at("git rebase origin/main")).toBeGreaterThan(
            at("git fetch origin main")
        );
        expect(at("bun run check:docs")).toBeGreaterThan(
            at("git rebase origin/main")
        );
        expect(at("git push --force-with-lease")).toBeGreaterThan(
            at("bun run check:docs")
        );
    });

    it("keeps the lane cheap — the heavy suite is still not part of it", () => {
        expect(cmd).not.toMatch(/bun run (test|test:app|test:bot|check:all)\b/);
    });

    it("merges through pr-merge.ts, which survives the post-force-push settle", () => {
        // The lane force-pushes immediately before merging, so it had the
        // identical race land had (#2536).
        expect(cmd).toMatch(/bun '[^']*pr-merge\.ts' 2537/);
        expect(cmd).not.toContain("--delete-branch");
        const mergeIdx = cmd.indexOf("pr-merge.ts");
        expect(cmd.indexOf("git push --force-with-lease")).toBeLessThan(
            mergeIdx
        );
    });

    it("wraps ref cleanup and teardown so they cannot fail a landed merge", () => {
        expect(cmd).toContain(
            "(git push origin --delete 'docs/adr-0101' || true)"
        );
        expect(cmd).toContain(
            "(git -C '/repo' worktree remove --force '/repo-docs' || true)"
        );
        expect(cmd).toContain(
            "(git -C '/repo' branch -D 'docs/adr-0101' || true)"
        );
        const mergeIdx = cmd.indexOf("pr-merge.ts");
        expect(cmd.indexOf("git push origin --delete")).toBeGreaterThan(
            mergeIdx
        );
    });

    it("is syntactically valid shell", () => {
        const r = spawnSync("sh", ["-n", "-c", cmd], { encoding: "utf8" });
        expect(r.status, r.stderr).toBe(0);
    });
});
