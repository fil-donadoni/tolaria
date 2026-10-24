// The shrink-only census of effect-sentence kinds (issue #6557, issue #6714):
// the kinds read off `effectClause.ts` at HEAD are a subset of those at the
// baseline tree — the merge-base with the base branch, `HEAD^` on the base
// tip. No committed list. Pure over its inputs, so each exit is pinned with
// its own input; the baseline reader is pinned on a fake runner per outcome;
// and a REAL `git rebase` proves the design's point through the shipped
// path: a branch that retires one kind rebases onto a base that retired
// another with no conflict and no red, while a kind added on the branch reds
// (issue #6714 acceptance).

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
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
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
    readKindArray,
    renderSentenceKinds,
} from "../lib/sentence-kinds";

const SOURCE = `
export type AmountIR = { readonly kind: "flat" };

/** Docs may mention "not-a-kind" in prose. */
export const EFFECT_SENTENCE_KINDS = [
    "draw",
    // a comment with "quoted" text
    "pump", "regenerate",
    /* block */ "forced-block",
] as const;

export type EffectSentenceIR = FrameChainIR | { readonly kind: "later" };
`;

describe("effectSentenceKinds reads EFFECT_SENTENCE_KINDS off the source — strictly", () => {
    it("takes the array's string literals, comments dropped, and nothing outside the array", () => {
        expect(effectSentenceKinds(SOURCE)).toEqual([
            "draw",
            "pump",
            "regenerate",
            "forced-block",
        ]);
    });

    it("survives any spelling of the array body — one line, trailing comma or none", () => {
        const oneLine = SOURCE.replace(
            /\[[\s\S]*?\] as const/,
            '["draw", "pump", "regenerate", "forced-block"] as const'
        );
        expect(effectSentenceKinds(oneLine)).toEqual(
            effectSentenceKinds(SOURCE)
        );
    });

    it("throws on an element that is not a string literal — a kind cannot enter behind a spread or a name", () => {
        expect(() =>
            effectSentenceKinds(SOURCE.replace('"pump",', '...MORE, "pump",'))
        ).toThrow(/something other than string literals/);
        expect(() =>
            effectSentenceKinds(SOURCE.replace('"pump",', 'PUMP, "pump",'))
        ).toThrow(/something other than string literals/);
    });

    it("throws on an empty array — an empty set is a subset of anything", () => {
        expect(() =>
            effectSentenceKinds(
                SOURCE.replace(/\[[\s\S]*?\] as const/, "[] as const")
            )
        ).toThrow(/yields no kinds/);
    });

    it("throws when the array is not closed by `] as const`", () => {
        expect(() =>
            effectSentenceKinds(SOURCE.replace("] as const", "]"))
        ).toThrow(/not closed/);
    });

    it("throws at HEAD with no array; readKindArray says null, so a baseline predating it can be skipped", () => {
        const none = "export type EffectSentenceIR = FrameChainIR;\n";
        expect(() => effectSentenceKinds(none)).toThrow(
            /no `EFFECT_SENTENCE_KINDS` array/
        );
        expect(readKindArray(none)).toBeNull();
    });

    it("the real tree: the pilots' retired kinds (four of pilot 1, three of pilot 2) are gone, and HEAD's kinds are a subset of the baseline tree's", () => {
        const head = effectSentenceKinds(
            readFileSync(EFFECT_CLAUSE_PATH, "utf8")
        );
        for (const retired of [
            "search-library-to-hand",
            "search-library-to-battlefield",
            "search-library-to-top",
            "shuffle-searched-library",
            // …and of pilot 2 (issue #6630), absorbed by the sacrifice frame.
            "sacrifice",
            "sacrifice-source",
            "sacrifice-unless",
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
                if (args[1] === "HEAD") return ok("head456\n");
                if (args.includes("HEAD^^{commit}")) return ok("parent789\n");
                return ok("true\n");
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

    it("on the base tip (merge-base = HEAD): the parent's sha, never the file against itself", () => {
        const git = runner({ "merge-base": () => ok("head456\n") });
        const out = baselineKindsSource(git);
        expect(out.kind).toBe("text");
        expect(out.kind === "text" && out.at).toBe(
            `parent789:${EFFECT_CLAUSE_PATH}`
        );
        expect(git.seen).toContain(`show parent789:${EFFECT_CLAUSE_PATH}`);
    });

    it("on the base tip with no parent, or a parent without the file: a declared skip", () => {
        const root = runner({
            "merge-base": () => ok("head456\n"),
            "rev-parse": (args) =>
                args.includes("HEAD^^{commit}")
                    ? no("")
                    : args[1] === "HEAD"
                      ? ok("head456\n")
                      : ok("true\n"),
        });
        const atRoot = baselineKindsSource(root);
        expect(atRoot.kind).toBe("unavailable");
        expect(baselineFromOutcome(atRoot).kind).toBe("none");
        const firstRevision = runner({
            "merge-base": () => ok("head456\n"),
            "cat-file": (args) =>
                args[2]?.startsWith("parent789:") ? no("missing") : ok(""),
        });
        expect(baselineKindsSource(firstRevision).kind).toBe("unavailable");
    });

    it("no base ref in this clone: a declared skip, not a red", () => {
        const git = runner({
            "rev-parse": (args) =>
                args.includes("--verify") ? no("no such ref") : ok("true\n"),
        });
        expect(baselineKindsSource(git).kind).toBe("unavailable");
    });

    it("a baseline tree that predates the array is a declared skip, not a red", () => {
        const old = baselineFromOutcome({
            kind: "text",
            text: "export type EffectSentenceIR = FrameChainIR;\n",
            at: "base123:x.ts",
        });
        expect(old.kind).toBe("none");
        expect(old.kind === "none" && old.why).toContain("predates");
    });

    it("git failing on the comparison is broken, and baselineFromOutcome throws it", () => {
        const git = runner({ "merge-base": () => no("fatal: boom") });
        const out = baselineKindsSource(git);
        expect(out.kind).toBe("broken");
        expect(() => baselineFromOutcome(out)).toThrow(/NOT a skip/);
    });
});

/** The array, one kind per line, so two edits far apart rebase without a conflict. */
function union(kinds: readonly string[]): string {
    const members = kinds.map((k) => `    "${k}",`).join("\n\n\n");
    return `export const EFFECT_SENTENCE_KINDS = [\n${members}\n] as const;\n\nexport type Other = { readonly kind: "x" };\n`;
}

describe("sentence-kinds — a real git rebase through the shipped path (issue #6714)", () => {
    let repo: string;
    const savedEnv: Record<string, string | undefined> = {};
    // `baselineSentenceKinds(repo)` runs the production git runner, which
    // keeps the process environment: a hook's `GIT_DIR` would point it at
    // the wrong repository, so the keys are scrubbed for this block.
    beforeAll(() => {
        for (const key of Object.keys(process.env))
            if (key.startsWith("GIT_")) savedEnv[key] = process.env[key];
        scrubGitRepoEnv(process.env);
    });
    afterAll(() => {
        for (const [key, value] of Object.entries(savedEnv))
            if (value !== undefined) process.env[key] = value;
    });
    const git = (...args: string[]): string => {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout;
    };
    const writeUnion = (kinds: readonly string[]): void => {
        mkdirSync(dirname(join(repo, EFFECT_CLAUSE_PATH)), {
            recursive: true,
        });
        writeFileSync(join(repo, EFFECT_CLAUSE_PATH), union(kinds));
    };
    /** `check:gaps`'s composition, verbatim, on the fixture repository. */
    const audit = () =>
        auditSentenceKinds({
            head: effectSentenceKinds(
                readFileSync(join(repo, EFFECT_CLAUSE_PATH), "utf8")
            ),
            baseline: baselineSentenceKinds(repo),
        });
    const base = ORIGIN_BASE.slice("origin/".length);
    const SHA_AT = new RegExp(`^[0-9a-f]{40}:${EFFECT_CLAUSE_PATH}$`);

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
        expect(r.baseline.kind === "tree" && r.baseline.at).toMatch(SHA_AT);
        expect(r.violations).toEqual([]);
    });

    it("a kind added on the branch reds against the merge-base", () => {
        writeUnion(["alpha", "beta", "gamma", "delta", "epsilon"]);
        git("commit", "-q", "-am", "branch: add epsilon");
        const r = audit();
        expect(r.baseline.kind === "tree" && r.baseline.at).toMatch(SHA_AT);
        expect(r.violations).toEqual([{ kind: "grown", name: "epsilon" }]);
    });

    it("on the base tip the baseline is HEAD^: a retirement passes, an addition reds", () => {
        git("switch", "-q", base);
        writeUnion(["alpha", "beta", "gamma"]);
        git("commit", "-q", "-am", "base: retire delta");
        git("update-ref", `refs/remotes/${ORIGIN_BASE}`, "HEAD");
        let r = audit();
        expect(r.baseline.kind === "tree" && r.baseline.at).toBe(
            `${git("rev-parse", "HEAD^").trim()}:${EFFECT_CLAUSE_PATH}`
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
