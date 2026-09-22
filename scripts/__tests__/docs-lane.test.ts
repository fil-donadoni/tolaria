import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import {
    isDocPath,
    classifyChanges,
    parsePorcelainPaths,
    workingTreePaths,
    slugify,
    DOC_GATE_TESTS,
    DOC_GATE_TESTS_EXCLUDED,
    buildShipMergeCommand,
} from "../docs-lane";
import { BASE_BRANCH, ORIGIN_BASE } from "../lib/branches";
import { remoteBranchDeleteStep } from "../land";

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

    it("classifies each file inside a NEW untracked directory, never the directory", () => {
        // The shipped bug (issue #3668): plain `git status --porcelain`
        // collapses an all-untracked directory to `?? .out-of-scope/`, which
        // is not a doc path, so a lone new markdown file was refused.
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), "docs-lane-"));
        try {
            expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(
                0
            );
            const write = (rel: string) => {
                fs.mkdirSync(path.dirname(path.join(repo, rel)), {
                    recursive: true,
                });
                fs.writeFileSync(path.join(repo, rel), "x\n");
            };
            write(".out-of-scope/lenis-smooth-scroll.md");
            write(".claude/skills/new-skill/SKILL.md");
            write(".claude/skills/new-skill/run.sh");

            const paths = workingTreePaths(repo).sort();
            expect(paths).toEqual([
                ".claude/skills/new-skill/SKILL.md",
                ".claude/skills/new-skill/run.sh",
                ".out-of-scope/lenis-smooth-scroll.md",
            ]);
            // The program inside a new directory is refused on its own path,
            // not waved through (or refused) with its prose sibling.
            expect(classifyChanges(paths)).toEqual({
                docs: [
                    ".claude/skills/new-skill/SKILL.md",
                    ".out-of-scope/lenis-smooth-scroll.md",
                ],
                foreign: [".claude/skills/new-skill/run.sh"],
            });
        } finally {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });

    it("reduces a slug to something a branch name can hold", () => {
        expect(slugify("ADR 0101 — as-enters")).toBe("adr-0101-as-enters");
        expect(slugify("--messy--")).toBe("messy");
        expect(() => slugify("///")).toThrow();
    });
});

describe("docs-lane — the doc gate covers every guard that reads prose", () => {
    /**
     * Source mentions a repo documentation path in a way a guard would.
     *
     * `\.claude\/` is the WHOLE tree, not just `skills/` (issue #4376). The
     * docs lane now carries `.claude/skills/**\/*.md` and `.claude/rules/*.md`,
     * so the acceptance question became "does `check:docs` run every guard
     * that reads anything under `.claude/`?" — and the honest way to ask it is
     * the same sweep `git grep -l '\.claude/' scripts/__tests__` performs.
     * Widening it this way pulled in twelve files that name a RUNTIME
     * directory (`telemetry/`, `receipts/`, `~/.claude/projects`) or cite a
     * rule file in a header comment; each is now a row in
     * `DOC_GATE_TESTS_EXCLUDED` with the reason it guards no document.
     */
    const READS_DOCS =
        /"docs\/|docs\/adr|CONTEXT\.md|\.claude\/|\.md"|README\.md/;

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

    /**
     * Issue #4376's acceptance pin, stated as its own sweep rather than as a
     * clause of the regex above: the docs lane carries `.claude/skills/**\/*.md`
     * and `.claude/rules/*.md`, so every guard that reads ANYTHING under
     * `.claude/` must either be a guard `check:docs` runs or carry a recorded
     * reason why a prose edit cannot red it.
     *
     * The literal `".claude/"` is the same fixed string
     * `git grep -l '\.claude/' scripts/__tests__` matches — done in-process
     * because a `spawnSync` in a vitest worker cannot be interrupted by
     * `testTimeout`, and this sweep has no need of git.
     */
    it("every guard that reads .claude/** is covered or excluded-with-a-reason (issue #4376)", () => {
        const unclassified: string[] = [];
        let swept = 0;
        for (const file of fs.readdirSync(TESTS_DIR)) {
            if (!file.endsWith(".test.ts")) continue;
            const rel = path.posix.join("scripts", "__tests__", file);
            if (rel.endsWith("docs-lane.test.ts")) continue; // this file
            const src = fs.readFileSync(path.join(TESTS_DIR, file), "utf8");
            if (!src.includes(".claude/")) continue;
            swept++;
            if (
                !DOC_GATE_TESTS.includes(rel) &&
                !(rel in DOC_GATE_TESTS_EXCLUDED)
            )
                unclassified.push(rel);
        }
        // The sweep must find something, or the assertion below is vacuous.
        expect(
            swept,
            "no test mentions .claude/ — the sweep broke"
        ).toBeGreaterThan(10);
        expect(
            unclassified,
            `These guards read .claude/** but check:docs neither runs them nor records why not.\n` +
                `The docs lane carries .claude/skills/**/*.md and .claude/rules/*.md (issue #4376),\n` +
                `so add each to DOC_GATE_TESTS (and to check:docs:inner in package.json), or to\n` +
                `DOC_GATE_TESTS_EXCLUDED with the reason a prose edit cannot red it:\n` +
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
        expect(at(`git rebase ${ORIGIN_BASE}`)).toBeGreaterThan(
            at(`git fetch origin ${BASE_BRANCH}`)
        );
        expect(at("bun run check:docs")).toBeGreaterThan(
            at(`git rebase ${ORIGIN_BASE}`)
        );
        expect(at("git push --force-with-lease")).toBeGreaterThan(
            at("bun run check:docs")
        );
    });

    it("unsets GITHUB_TOKEN as the very first thing the locked shell does (issue #2579)", () => {
        // `NET_ENV` strips the bug-report PAT from the env docs-lane.ts hands
        // to `spawnSync("bun", [GATE, …])`, but that child is
        // `bun scripts/gate.ts`, which re-reads `.env.local` from its own cwd
        // and spreads `{...process.env}` onto the `sh -c` child — so the push
        // and the merge below saw the PAT again and 403'd AFTER the doc gate
        // had already run inside the lock. `land.ts` had fixed exactly this
        // (review round 3, B1); this lane shipped without it.
        expect(cmd.split(" && ")[0]).toBe("unset GITHUB_TOKEN");
        expect(cmd.indexOf("unset GITHUB_TOKEN")).toBeLessThan(
            cmd.indexOf("git push --force-with-lease")
        );
    });

    it("the unset actually clears a re-injected GITHUB_TOKEN for anything the locked shell runs, not just a string position (issue #2579)", () => {
        // A position assertion passes on a step that does not clear anything.
        // Take the EXACT first step `buildShipMergeCommand` produces and run
        // it through a real shell with GITHUB_TOKEN seeded as the `.env.local`
        // re-injection would leave it.
        const firstStep = cmd.split(" && ")[0];
        const r = spawnSync(
            "sh",
            ["-c", `${firstStep} && echo "TOKEN=[$GITHUB_TOKEN]"`],
            {
                encoding: "utf8",
                env: { ...process.env, GITHUB_TOKEN: "github_pat_leaked" },
            }
        );
        expect(r.stdout).toContain("TOKEN=[]");
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
        // The remote-branch delete goes through `remoteBranchDeleteStep`
        // (issue #2877), asserted verbatim so this test also proves the
        // lane doesn't reimplement or diverge from `land.ts`'s helper — see
        // `remoteBranchDeleteStep`'s own describe block in land.test.ts for
        // the DIAGNOSTIC-filtering behaviour it provides.
        expect(cmd).toContain(remoteBranchDeleteStep("docs/adr-0101"));
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
