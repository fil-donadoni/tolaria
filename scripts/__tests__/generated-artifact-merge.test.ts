import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    CORPUS_CACHE_REL,
    MERGE_DRIVER_NAME,
    planResolution,
    REGENERATE_MARKER,
    REGENERATED_ARTIFACTS,
} from "../lib/generated-artifacts";
import { CORPUS_PATH } from "../oracle-corpus";
import {
    buildLockedCommand,
    rebaseStep,
    resolveGeneratedArtifactsStep,
} from "../land";

/**
 * Guards for issue #3069 — "a generated artifact is regenerated, not merged".
 *
 * Two committed `data/` artifacts carry WHOLE-FILE state (content hashes,
 * tallies) on adjacent lines, so two PRs moving two DIFFERENT fields collided
 * on rebase and the resolution had to be done by hand — a resolution that is
 * never a judgement call, since every byte is derived.
 *
 * The mechanism is a `merge=regenerated` driver plus a single regeneration at
 * the rebased tip. The real-git block below is the one that matters: it builds
 * a miniature repo with the same shape of artifact and proves the rebase now
 * completes untouched, that the result is byte-identical to a fresh
 * regeneration, and — the counterfactual — that WITHOUT the attribute the very
 * same two branches still conflict.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const DRIVER = join(REPO_ROOT, "scripts", "merge-driver-regenerated.ts");
const RESOLVER = join(REPO_ROOT, "scripts", "resolve-generated-artifacts.ts");

describe("generated-artifact class — wiring", () => {
    it(".gitattributes names exactly the regenerated artifacts", () => {
        const text = readFileSync(join(REPO_ROOT, ".gitattributes"), "utf8");
        const rows = text
            .split("\n")
            .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
            .map((l) => l.trim());
        expect(rows).toEqual(
            REGENERATED_ARTIFACTS.map(
                (a) => `${a.path} merge=${MERGE_DRIVER_NAME}`
            )
        );
    });

    it("every regenerated artifact is committed and its generator script exists", () => {
        const pkg = JSON.parse(
            readFileSync(join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        for (const artifact of REGENERATED_ARTIFACTS) {
            const tracked = spawnSync(
                "git",
                ["ls-files", "--error-unmatch", artifact.path],
                { cwd: REPO_ROOT }
            );
            expect(tracked.status, `${artifact.path} is not tracked`).toBe(0);
            expect(pkg.scripts[artifact.script]).toBeTruthy();
        }
    });

    it("the worktree bootstrap registers the driver `.gitattributes` names", () => {
        // The bootstrap is node-builtins-only (it runs before `bun install`),
        // so it cannot import MERGE_DRIVER_NAME — this is what keeps the
        // hand-typed copy honest.
        const src = readFileSync(
            join(REPO_ROOT, "scripts", "bootstrap-worktree.ts"),
            "utf8"
        );
        expect(src).toContain(
            `const MERGE_DRIVER_NAME = "${MERGE_DRIVER_NAME}"`
        );
        expect(src).toContain(
            '"bun scripts/merge-driver-regenerated.ts %O %A %B %P"'
        );
        expect(src).toContain(".driver`, MERGE_DRIVER_COMMAND)");
    });

    it("the corpus path has one authority", () => {
        expect(CORPUS_PATH.endsWith(CORPUS_CACHE_REL)).toBe(true);
    });

    it("land regenerates between the rebase and the lane gate", () => {
        const cmd = buildLockedCommand({
            branch: "fix/issue-3069",
            pr: 1,
            primaryCheckout: "/repo",
            worktree: "/repo/wt",
            merge: true,
            teardown: true,
        });
        const rebaseAt = cmd.indexOf(rebaseStep());
        const resolveAt = cmd.indexOf(resolveGeneratedArtifactsStep());
        const gateAt = cmd.indexOf("bun run check:lane");
        expect(rebaseAt).toBeGreaterThanOrEqual(0);
        expect(resolveAt).toBeGreaterThan(rebaseAt);
        expect(gateAt).toBeGreaterThan(resolveAt);
    });

    it("the rebase step clears the marker ONLY on the abort path", () => {
        const step = rebaseStep();
        const clear = `rm -f "$(git rev-parse --git-path ${REGENERATE_MARKER})"`;
        expect(step).toContain(clear);
        // After `--abort`, never before the rebase: a pre-rebase clear would
        // erase the debt from a rebase the developer ran by hand.
        expect(step.indexOf(clear)).toBeGreaterThan(
            step.indexOf("git rebase --abort")
        );
        expect(step.indexOf(clear)).toBeGreaterThan(
            step.indexOf("git rebase origin/main")
        );
    });
});

describe("generated-artifact class — what is NOT in it (issue #3069 asks for this explicitly)", () => {
    it("the card index is immune by shape: per-row, sorted by name, no whole-file state", () => {
        expect(REGENERATED_ARTIFACTS.map((a) => a.path)).not.toContain(
            "data/card-index.json"
        );
        const index = JSON.parse(
            readFileSync(join(REPO_ROOT, "data", "card-index.json"), "utf8")
        ) as Array<Record<string, unknown>>;
        // A bare array — no header object to hold a hash or a tally.
        expect(Array.isArray(index)).toBe(true);
        // `backfill-card-index.ts` sorts with `localeCompare` — the point is
        // the ORDER being total and content-independent, not which collation.
        const names = index.map((r) => r.name as string);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
        for (const row of index.slice(0, 200)) {
            expect(Object.keys(row)).not.toContain("contentHash");
        }
    });

    it("the compiled pool is immune by shape: a bare array, no header", () => {
        const pool = JSON.parse(
            readFileSync(
                join(REPO_ROOT, "data", "oracle-compiled-pool.json"),
                "utf8"
            )
        ) as unknown;
        expect(Array.isArray(pool)).toBe(true);
        expect(REGENERATED_ARTIFACTS.map((a) => a.path)).not.toContain(
            "data/oracle-compiled-pool.json"
        );
    });
});

describe("planResolution", () => {
    it("does nothing when the driver marked nothing", () => {
        expect(
            planResolution({ markedPaths: ["", "  "], corpusPresent: true })
        ).toEqual({ kind: "none" });
    });

    it("regenerates each marked artifact once, deduped", () => {
        const plan = planResolution({
            markedPaths: [
                "data/oracle-compiled.json",
                "data/oracle-compiled.json",
                "data/oracle-legality.json",
            ],
            corpusPresent: true,
        });
        expect(plan.kind).toBe("regenerate");
        if (plan.kind !== "regenerate") return;
        expect(plan.artifacts.map((a) => a.path)).toEqual([
            "data/oracle-compiled.json",
            "data/oracle-legality.json",
        ]);
    });

    it("REFUSES with the existing remediation when the corpus cache is absent", () => {
        const plan = planResolution({
            markedPaths: ["data/oracle-compiled.json"],
            corpusPresent: false,
        });
        expect(plan.kind).toBe("refuse");
        if (plan.kind !== "refuse") return;
        expect(plan.message).toContain(CORPUS_CACHE_REL);
        expect(plan.message).toContain("bun run oracle:corpus");
        expect(plan.message).toContain("bun run oracle:compile");
    });

    it("refuses a marked path that is not in the class rather than guessing", () => {
        const plan = planResolution({
            markedPaths: ["data/card-index.json"],
            corpusPresent: true,
        });
        expect(plan.kind).toBe("refuse");
        if (plan.kind !== "refuse") return;
        expect(plan.message).toContain("data/card-index.json");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Real git, real driver, real resolver — a miniature repo whose artifact has
// the same shape as the Oracle lockfile: a header of whole-file state (two
// hashes and a tally) on adjacent lines, over per-row content.
// ─────────────────────────────────────────────────────────────────────────

const GENERATOR = `
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const which = process.argv[2];
const path = which === "legality" ? "data/oracle-legality.json" : "data/oracle-compiled.json";
const compiler = readFileSync("input/compiler.txt", "utf8").trim();
const registry = readFileSync("input/registry.txt", "utf8").trim();
const cards = readFileSync("input/cards.txt", "utf8").trim().split("\\n").filter(Boolean).sort();
const h = (s) => createHash("sha256").update(s).digest("hex");

const lines = ["{"];
lines.push('    "compilerHash": "' + h(compiler) + '",');
lines.push('    "registryHash": "' + h(registry) + '",');
lines.push('    "contentHash": "' + h(cards.join(",")) + '",');
lines.push('    "count": ' + cards.length + ",");
lines.push('    "cards": [');
cards.forEach((c, i) => lines.push('        ' + JSON.stringify(c) + (i === cards.length - 1 ? "" : ",")));
lines.push("    ]");
lines.push("}");
writeFileSync(path, lines.join("\\n") + "\\n");
`;

describe("generated-artifact merge driver (real git, real resolver)", () => {
    let dir: string;
    let repo: string;

    function git(args: string[], cwd = repo): string {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
        return r.stdout.trim();
    }

    function generate(): void {
        for (const which of ["compile", "legality"]) {
            const r = spawnSync("bun", ["gen.mjs", which], {
                cwd: repo,
                encoding: "utf8",
            });
            if (r.status !== 0) throw new Error(`gen ${which}: ${r.stderr}`);
        }
    }

    /**
     * Every input file carries two independently-editable lines, far enough
     * apart to merge cleanly. That is the real shape of the bug: the compiler
     * SOURCE two PRs touch merges fine, and it is the DERIVED whole-file field
     * — one hash, computed over all of it — that collides.
     */
    function baseInput(): string {
        return (
            ["branch:0", ...Array(20).fill("pad"), "main:0"].join("\n") + "\n"
        );
    }

    /** Edit one side's line of an input, regenerate both artifacts, commit. */
    function move(
        input: string,
        side: "branch" | "main",
        value: string,
        message: string
    ): void {
        const path = join(repo, "input", `${input}.txt`);
        const next = readFileSync(path, "utf8")
            .split("\n")
            .map((l) => (l.startsWith(`${side}:`) ? `${side}:${value}` : l))
            .join("\n");
        writeFileSync(path, next);
        generate();
        git(["add", "-A"]);
        git(["commit", "-m", message]);
    }

    /**
     * `resolve`, not `join` — the production bug this fixture failed to catch:
     * in a linked worktree `--git-path` answers with an ABSOLUTE path, and
     * `join` concatenates it into nothing.
     */
    function markerPath(cwd = repo): string {
        return resolve(
            cwd,
            git(["rev-parse", "--git-path", REGENERATE_MARKER], cwd)
        );
    }

    function rebaseOntoMain(): { status: number | null; output: string } {
        const r = spawnSync("sh", ["-c", rebaseStep()], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, output: r.stdout + r.stderr };
    }

    function runResolver(): { status: number | null; output: string } {
        const r = spawnSync("bun", [RESOLVER], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, output: r.stdout + r.stderr };
    }

    function useDriver(): void {
        writeFileSync(
            join(repo, ".gitattributes"),
            REGENERATED_ARTIFACTS.map(
                (a) => `${a.path} merge=${MERGE_DRIVER_NAME}`
            ).join("\n") + "\n"
        );
        git(["add", ".gitattributes"]);
        git(["commit", "-m", "gitattributes"]);
        git(["config", `merge.${MERGE_DRIVER_NAME}.name`, "regenerated"]);
        git([
            "config",
            `merge.${MERGE_DRIVER_NAME}.driver`,
            `bun ${DRIVER} %O %A %B %P`,
        ]);
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-regen-test-"));
        repo = join(dir, "repo");
        mkdirSync(join(repo, "input"), { recursive: true });
        mkdirSync(join(repo, "data"), { recursive: true });

        spawnSync("git", ["init", "-b", "main", repo], { cwd: dir });
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test"]);
        // `origin/main` is what `rebaseStep()` fetches; a self-remote keeps
        // the test offline while exercising the real command.
        git(["config", "remote.origin.url", repo]);
        git([
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ]);

        writeFileSync(join(repo, "gen.mjs"), GENERATOR);
        writeFileSync(
            join(repo, "package.json"),
            JSON.stringify({
                name: "stub",
                scripts: {
                    "oracle:compile": "bun gen.mjs compile",
                    "oracle:legality": "bun gen.mjs legality",
                },
            }) + "\n"
        );
        writeFileSync(join(repo, "input", "compiler.txt"), baseInput());
        writeFileSync(join(repo, "input", "registry.txt"), baseInput());
        writeFileSync(join(repo, "input", "cards.txt"), "Alpha\nBeta\n");
        // The corpus cache is gitignored in the real repo; here its mere
        // presence is what `planResolution` reads.
        writeFileSync(join(repo, CORPUS_CACHE_REL), "corpus");
        writeFileSync(join(repo, ".gitignore"), `${CORPUS_CACHE_REL}\n`);
        generate();
        git(["add", "-A"]);
        git(["commit", "-m", "base"]);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    /**
     * `branch` moves `branchInput`, main moves `mainInput`, both regenerate.
     * Returns after the rebase attempt.
     */
    function divergeAndRebase(
        branchInput: string,
        mainInput: string
    ): { status: number | null; output: string } {
        git(["checkout", "-q", "-b", "branch"]);
        move(branchInput, "branch", "branch-value", "branch moves a field");
        git(["checkout", "-q", "main"]);
        move(mainInput, "main", "main-value", "main moves a field");
        git(["checkout", "-q", "branch"]);
        return rebaseOntoMain();
    }

    it("WITHOUT the attribute, two branches moving DIFFERENT adjacent fields conflict (the bug)", () => {
        const r = divergeAndRebase("registry", "compiler");
        expect(r.status).not.toBe(0);
        expect(r.output).toContain("data/oracle-compiled.json");
    });

    it("with the driver, DIFFERENT fields rebase with no manual resolution and regenerate byte-identically", () => {
        useDriver();
        const r = divergeAndRebase("registry", "compiler");
        expect(r.status, r.output).toBe(0);
        expect(existsSync(markerPath())).toBe(true);
        expect(readFileSync(markerPath(), "utf8")).toContain(
            "data/oracle-compiled.json"
        );

        const resolved = runResolver();
        expect(resolved.status, resolved.output).toBe(0);
        expect(existsSync(markerPath())).toBe(false);

        // Byte-identical to a fresh regeneration of the rebased tree, and
        // committed — not left dirty for the lane gate to trip over.
        const committed = readFileSync(
            join(repo, "data", "oracle-compiled.json"),
            "utf8"
        );
        generate();
        expect(
            readFileSync(join(repo, "data", "oracle-compiled.json"), "utf8")
        ).toBe(committed);
        expect(git(["status", "--porcelain"])).toBe("");
        // Both sides' input edits survived — the artifact reflects the merged
        // tree, not either side's stale copy.
        expect(
            readFileSync(join(repo, "input", "registry.txt"), "utf8")
        ).toContain("branch:branch-value");
        expect(
            readFileSync(join(repo, "input", "compiler.txt"), "utf8")
        ).toContain("main:main-value");
    });

    it("with the driver, the SAME field rebases with no manual resolution", () => {
        useDriver();
        const r = divergeAndRebase("compiler", "compiler");
        expect(r.status, r.output).toBe(0);
        const resolved = runResolver();
        expect(resolved.status, resolved.output).toBe(0);
        expect(git(["status", "--porcelain"])).toBe("");
    });

    it("covers the legality artifact too, not just the lockfile", () => {
        useDriver();
        divergeAndRebase("registry", "compiler");
        expect(readFileSync(markerPath(), "utf8")).toContain(
            "data/oracle-legality.json"
        );
        const resolved = runResolver();
        expect(resolved.status, resolved.output).toBe(0);
        const committed = readFileSync(
            join(repo, "data", "oracle-legality.json"),
            "utf8"
        );
        generate();
        expect(
            readFileSync(join(repo, "data", "oracle-legality.json"), "utf8")
        ).toBe(committed);
    });

    it("REFUSES rather than committing a wrong artifact when the corpus cache is absent", () => {
        useDriver();
        const r = divergeAndRebase("registry", "compiler");
        expect(r.status, r.output).toBe(0);
        rmSync(join(repo, CORPUS_CACHE_REL));

        const resolved = runResolver();
        expect(resolved.status).not.toBe(0);
        expect(resolved.output).toContain("bun run oracle:corpus");
        // Nothing was amended, nothing was left staged: the land fails here,
        // so no artifact reaches `main` at all.
        expect(git(["status", "--porcelain"])).toBe("");
    });

    it("keeps a CLEAN 3-way merge and marks nothing (the driver is not a blanket take-ours)", () => {
        // Exercised on the driver directly: an artifact whose two sides changed
        // disjoint regions merges textually, and forcing a regeneration there
        // would turn today's clean landing into a refusal on any machine
        // without the corpus cache.
        const base = join(repo, "m.base");
        const ours = join(repo, "m.ours");
        const theirs = join(repo, "m.theirs");
        writeFileSync(base, "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
        writeFileSync(ours, "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n");
        writeFileSync(theirs, "one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n");

        const r = spawnSync(
            "bun",
            [DRIVER, base, ours, theirs, "data/oracle-compiled.json"],
            { cwd: repo, encoding: "utf8" }
        );
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(readFileSync(ours, "utf8")).toBe(
            "ONE\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n"
        );
        expect(existsSync(markerPath())).toBe(false);
    });

    it("restores OURS byte-for-byte when the 3-way merge conflicts — never conflict markers", () => {
        const base = join(repo, "m.base");
        const ours = join(repo, "m.ours");
        const theirs = join(repo, "m.theirs");
        writeFileSync(base, "hash: base\n");
        writeFileSync(ours, "hash: ours\n");
        writeFileSync(theirs, "hash: theirs\n");

        const r = spawnSync(
            "bun",
            [DRIVER, base, ours, theirs, "data/oracle-compiled.json"],
            { cwd: repo, encoding: "utf8" }
        );
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(readFileSync(ours, "utf8")).toBe("hash: ours\n");
        expect(readFileSync(ours, "utf8")).not.toContain("<<<<<<<");
        expect(readFileSync(markerPath(), "utf8")).toContain(
            "data/oracle-compiled.json"
        );
    });

    it("works in a LINKED WORKTREE — the shape every issue branch is built in", () => {
        // The regression this pins: `git rev-parse --git-path` returns a
        // relative path in a plain checkout and an ABSOLUTE one in a linked
        // worktree, so a resolver that `join`s it onto the toplevel finds no
        // marker, exits 0, and lets the side-taken artifact through. Every
        // other case in this file runs in a plain checkout, where the bug is
        // invisible.
        useDriver();
        git(["checkout", "-q", "-b", "branch"]);
        move("registry", "branch", "branch-value", "branch moves a field");
        git(["checkout", "-q", "main"]);
        move("compiler", "main", "main-value", "main moves a field");
        git(["checkout", "-q", "main"]);

        const wt = join(dir, "linked");
        git(["worktree", "add", "-q", wt, "branch"]);
        // The corpus cache is gitignored, so a fresh worktree has none — this
        // is also the "can it regenerate here at all?" half of the fixture.
        writeFileSync(join(wt, CORPUS_CACHE_REL), "corpus");

        const rebased = spawnSync("sh", ["-c", rebaseStep()], {
            cwd: wt,
            encoding: "utf8",
        });
        expect(rebased.status, rebased.stdout + rebased.stderr).toBe(0);
        expect(markerPath(wt).startsWith(wt)).toBe(false); // absolute, elsewhere
        expect(existsSync(markerPath(wt))).toBe(true);

        const resolved = spawnSync("bun", [RESOLVER], {
            cwd: wt,
            encoding: "utf8",
        });
        expect(resolved.status, resolved.stdout + resolved.stderr).toBe(0);
        expect(existsSync(markerPath(wt))).toBe(false);

        const committed = readFileSync(
            join(wt, "data", "oracle-compiled.json"),
            "utf8"
        );
        const regen = spawnSync("bun", ["gen.mjs", "compile"], { cwd: wt });
        expect(regen.status).toBe(0);
        expect(
            readFileSync(join(wt, "data", "oracle-compiled.json"), "utf8")
        ).toBe(committed);
        expect(git(["status", "--porcelain"], wt)).toBe("");
    });

    it("a REFUSED resolution leaves the marker as an undischarged debt", () => {
        useDriver();
        divergeAndRebase("registry", "compiler");
        rmSync(join(repo, CORPUS_CACHE_REL));

        expect(spawnSync("bun", [RESOLVER], { cwd: repo }).status).not.toBe(0);
        // Still marked: the debt is discharged by a regeneration, never by
        // having been looked at once. A marker cleared here would let the NEXT
        // land — whose rebase may well be conflict-free — ship the side-taken
        // artifact.
        expect(existsSync(markerPath())).toBe(true);
        expect(spawnSync("bun", [RESOLVER], { cwd: repo }).status).not.toBe(0);
    });

    it("does not mark anything when nothing conflicted", () => {
        useDriver();
        git(["checkout", "-q", "-b", "branch"]);
        writeFileSync(join(repo, "unrelated.txt"), "branch\n");
        git(["add", "-A"]);
        git(["commit", "-m", "branch touches nothing generated"]);
        git(["checkout", "-q", "main"]);
        move("compiler", "main", "main-value", "main moves a field");
        git(["checkout", "-q", "branch"]);

        const r = rebaseOntoMain();
        expect(r.status, r.output).toBe(0);
        expect(existsSync(markerPath())).toBe(false);
        const resolved = runResolver();
        expect(resolved.status, resolved.output).toBe(0);
    });
});
