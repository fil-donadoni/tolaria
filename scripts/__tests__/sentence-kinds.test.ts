// The shrink-only census of effect-sentence kinds (issue #6557, issue #6714):
// the kinds read off `effectClause.ts` at HEAD are a subset of those at the
// baseline tree — the merge-base with the base branch, `HEAD^` on the base
// tip. No committed list. Pure over its inputs, so each exit is pinned with
// its own input; the baseline reader is pinned on a fake runner per outcome;
// and a REAL `git rebase` proves the design's point: a branch that retires
// one kind rebases onto a base that retired another with no conflict and no
// red, while a kind added on the branch reds (issue #6714 acceptance).

import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitResult, GitRunner } from "../lib/base-artifact";
import { ORIGIN_BASE } from "../lib/branches";
import { scrubGitRepoEnv } from "../lib/git-repo-env";
import {
    auditSentenceKinds,
    baselineFromOutcome,
    baselineKindsSource,
    baselineSentenceKinds,
    EFFECT_CLAUSE_PATH,
    effectSentenceKinds,
    renderSentenceKinds,
} from "../lib/sentence-kinds";

const SOURCE = `
export type AmountIR = { readonly kind: "flat" };

export type EffectSentenceIR =
    | FrameChainIR
    | {
          /** doc */
          readonly kind: "draw";
          readonly nested: { readonly kind: "not-a-sentence-kind" };
      }
    | {
          readonly kind: "pump";
      }
    | { readonly kind: "regenerate" }
    | { readonly kind: "forced-block"; readonly count: number };

export type LibraryRouteIR = { readonly kind: "elsewhere" };
`;

describe("effectSentenceKinds reads the union off the source", () => {
    it("takes the member kinds at the union's indentation, multi-line and one-line, and nothing deeper or later", () => {
        expect(effectSentenceKinds(SOURCE)).toEqual([
            "draw",
            "pump",
            "regenerate",
            "forced-block",
        ]);
    });

    it("the real tree: the pilot's four retired kinds are gone, and HEAD's kinds are a subset of the baseline tree's", () => {
        const head = effectSentenceKinds(
            readFileSync(EFFECT_CLAUSE_PATH, "utf8")
        );
        for (const retired of [
            "search-library-to-hand",
            "search-library-to-battlefield",
            "search-library-to-top",
            "shuffle-searched-library",
        ])
            expect(head).not.toContain(retired);
        const baseline = baselineSentenceKinds(process.cwd());
        expect(
            auditSentenceKinds({ head, baseline }).violations,
            baseline.kind === "tree" ? baseline.at : baseline.why
        ).toEqual([]);
    });
});

describe("auditSentenceKinds — every exit", () => {
    const tree = (...kinds: string[]) =>
        ({ kind: "tree", kinds, at: "abc123:x.ts" }) as const;

    it("passes when HEAD's kinds are a subset of the baseline's — a retired kind is the normal case", () => {
        const r = auditSentenceKinds({
            head: ["draw", "pump"],
            baseline: tree("draw", "pump", "retired-one"),
        });
        expect(r.violations).toEqual([]);
        expect(r.headCount).toBe(2);
        expect(renderSentenceKinds(r)).toContain("✓ kinds: 2");
    });

    it("reds a kind at HEAD the baseline tree does not declare — adding a kind reds it", () => {
        const r = auditSentenceKinds({
            head: ["brand-new", "draw", "pump"],
            baseline: tree("draw", "pump"),
        });
        expect(r.violations).toEqual([{ kind: "grown", name: "brand-new" }]);
        expect(renderSentenceKinds(r)).toContain("brand-new");
    });

    it("leaves the shrink check unrun with no baseline tree, and says so", () => {
        const r = auditSentenceKinds({
            head: ["brand-new"],
            baseline: { kind: "none", why: "no base ref" },
        });
        expect(r.violations).toEqual([]);
        expect(renderSentenceKinds(r)).toContain("SKIPPED");
        expect(renderSentenceKinds(r)).toContain("no base ref");
    });
});

const ok = (out: string): GitResult => ({ ok: true, out });
const no = (error: string): GitResult => ({ ok: false, error });

/** The happy path on a branch, with named steps overridable per test. */
function runner(
    overrides: Partial<
        Record<string, (args: readonly string[]) => GitResult>
    > = {}
): GitRunner & { seen: string[] } {
    const seen: string[] = [];
    const fake = ((args: readonly string[]) => {
        const step = args[0] ?? "";
        seen.push(args.join(" "));
        const override = overrides[step];
        if (override !== undefined) return override(args);
        switch (step) {
            case "rev-parse":
                return args[1] === "HEAD" ? ok("head456\n") : ok("true\n");
            case "merge-base":
                return ok("base123\n");
            case "cat-file":
                return ok("");
            case "show":
                return ok(SOURCE);
            default:
                return no(`unexpected git ${step}`);
        }
    }) as GitRunner & { seen: string[] };
    fake.seen = seen;
    return fake;
}

describe("baselineKindsSource — which tree is the baseline", () => {
    it("on a branch: the merge-base with the base branch", () => {
        const git = runner();
        const out = baselineKindsSource(git);
        expect(out).toEqual({
            kind: "text",
            text: SOURCE,
            at: `base123:${EFFECT_CLAUSE_PATH}`,
        });
        expect(baselineFromOutcome(out)).toEqual({
            kind: "tree",
            kinds: ["draw", "pump", "regenerate", "forced-block"],
            at: `base123:${EFFECT_CLAUSE_PATH}`,
        });
    });

    it("on the base tip (merge-base = HEAD): HEAD^, never the file against itself", () => {
        const git = runner({ "merge-base": () => ok("head456\n") });
        const out = baselineKindsSource(git);
        expect(out.kind).toBe("text");
        expect(out.kind === "text" && out.at).toBe(
            `HEAD^:${EFFECT_CLAUSE_PATH}`
        );
        expect(git.seen).toContain(`show HEAD^:${EFFECT_CLAUSE_PATH}`);
    });

    it("on the base tip with no parent carrying the file: a declared skip", () => {
        const git = runner({
            "merge-base": () => ok("head456\n"),
            "cat-file": (args) =>
                args[2]?.startsWith("HEAD^:") ? no("missing") : ok(""),
        });
        const out = baselineKindsSource(git);
        expect(out.kind).toBe("unavailable");
        expect(baselineFromOutcome(out).kind).toBe("none");
    });

    it("no base ref in this clone: a declared skip, not a red", () => {
        const git = runner({
            "rev-parse": (args) =>
                args.includes("--verify") ? no("no such ref") : ok("true\n"),
        });
        expect(baselineKindsSource(git).kind).toBe("unavailable");
    });

    it("git failing on the comparison is broken, and baselineFromOutcome throws it", () => {
        const git = runner({ "merge-base": () => no("fatal: boom") });
        const out = baselineKindsSource(git);
        expect(out.kind).toBe("broken");
        expect(() => baselineFromOutcome(out)).toThrow(/NOT a skip/);
    });
});

/** A union of four kinds, each member wide enough that two edits far apart rebase without a conflict. */
function union(kinds: readonly string[]): string {
    const members = kinds
        .map(
            (k) => `    | {
          /** ${k}: a whole-sentence shape of the table. */
          readonly kind: "${k}";
          readonly text: string;
      }`
        )
        .join("\n");
    return `export type EffectSentenceIR =\n    | FrameChainIR\n${members};\n\nexport type Other = { readonly kind: "x" };\n`;
}

describe("sentence-kinds — a real git rebase (issue #6714)", () => {
    let repo: string;
    const git = (...args: string[]): string => {
        const env = { ...process.env };
        scrubGitRepoEnv(env);
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout;
    };
    const runnerHere: GitRunner = (args) => {
        const env = { ...process.env };
        scrubGitRepoEnv(env);
        const r = spawnSync("git", [...args], {
            cwd: repo,
            encoding: "utf8",
            env,
        });
        return r.status === 0
            ? { ok: true, out: r.stdout }
            : { ok: false, error: r.stderr.trim() };
    };
    const writeUnion = (kinds: readonly string[]): void => {
        mkdirSync(dirname(join(repo, EFFECT_CLAUSE_PATH)), {
            recursive: true,
        });
        writeFileSync(join(repo, EFFECT_CLAUSE_PATH), union(kinds));
    };
    const audit = () =>
        auditSentenceKinds({
            head: effectSentenceKinds(
                readFileSync(join(repo, EFFECT_CLAUSE_PATH), "utf8")
            ),
            baseline: baselineFromOutcome(baselineKindsSource(runnerHere)),
        });
    const base = ORIGIN_BASE.slice("origin/".length);

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "sentence-kinds-"));
        git("init", "-q", "-b", base);
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
        writeUnion(["alpha", "beta", "gamma", "delta"]);
        git("add", ".");
        git("commit", "-q", "-m", "seed: four kinds");
        git("update-ref", `refs/remotes/${ORIGIN_BASE}`, "HEAD");
        git("switch", "-q", "-c", "feat/issue-1");
    });
    afterEach(() =>
        rmSync(repo, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("a branch retiring one kind rebases onto a base that retired another: no conflict, no red", () => {
        writeUnion(["alpha", "beta", "gamma"]); // the branch retires delta
        git("commit", "-q", "-am", "branch: retire delta");
        git("switch", "-q", base);
        writeUnion(["beta", "gamma", "delta"]); // the base retires alpha
        git("commit", "-q", "-am", "base: retire alpha");
        git("update-ref", `refs/remotes/${ORIGIN_BASE}`, "HEAD");
        git("switch", "-q", "feat/issue-1");
        git("rebase", "-q", ORIGIN_BASE); // throws on a conflict
        const r = audit();
        expect(
            effectSentenceKinds(
                readFileSync(join(repo, EFFECT_CLAUSE_PATH), "utf8")
            )
        ).toEqual(["beta", "gamma"]);
        expect(r.baseline.kind).toBe("tree");
        expect(r.violations).toEqual([]);
    });

    it("a kind added on the branch reds against the merge-base", () => {
        writeUnion(["alpha", "beta", "gamma", "delta", "epsilon"]);
        git("commit", "-q", "-am", "branch: add epsilon");
        const r = audit();
        expect(r.baseline.kind === "tree" && r.baseline.at).toMatch(
            new RegExp(`^[0-9a-f]{40}:${EFFECT_CLAUSE_PATH}$`)
        );
        expect(r.violations).toEqual([{ kind: "grown", name: "epsilon" }]);
    });

    it("on the base tip the baseline is HEAD^: a retirement passes, an addition reds", () => {
        git("switch", "-q", base);
        writeUnion(["alpha", "beta", "gamma"]);
        git("commit", "-q", "-am", "base: retire delta");
        git("update-ref", `refs/remotes/${ORIGIN_BASE}`, "HEAD");
        let r = audit();
        expect(r.baseline.kind === "tree" && r.baseline.at).toBe(
            `HEAD^:${EFFECT_CLAUSE_PATH}`
        );
        expect(r.violations).toEqual([]);
        writeUnion(["alpha", "beta", "gamma", "zeta"]);
        git("commit", "-q", "-am", "base: add zeta");
        git("update-ref", `refs/remotes/${ORIGIN_BASE}`, "HEAD");
        r = audit();
        expect(r.violations).toEqual([{ kind: "grown", name: "zeta" }]);
    });

    it("the seed commit on the base tip has no parent: a declared skip", () => {
        git("switch", "-q", base);
        const r = audit();
        expect(r.baseline.kind).toBe("none");
        expect(r.violations).toEqual([]);
    });
});
