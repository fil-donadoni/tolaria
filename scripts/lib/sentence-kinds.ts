/**
 * The shrink-only census of `EffectSentenceIR` kinds (issue #6557, the
 * compositional grammar pilot; issue #6714, a relation between two trees).
 *
 * The effect-clause grammar has two layers: a TABLE of whole-sentence kinds,
 * each an anchored shape with its own lowering case, and the Verb Frame layer
 * (`convex/oracle/grammar/shared/verbFrames.ts`), where a sentence is read as
 * Op-shaped frames joined by Composition Rules. The pilot's direction is that
 * the table only SHRINKS: a kind may leave — absorbed by frames — and never
 * enter.
 *
 * There is NO committed list. The authority is the `EFFECT_SENTENCE_KINDS`
 * array in `effectClause.ts` (issue #6621), which a type-level assertion
 * there ties to the union both ways; the census is a relation between two
 * revisions of its source text —
 *
 *   - on a branch: the kinds at HEAD must be a subset of the kinds at the
 *     merge-base with the base branch (the whole branch is one change);
 *   - on the base tip (merge-base = HEAD): the kinds at HEAD must be a
 *     subset of the kinds at `HEAD^` — the per-commit contract.
 *
 * A committed list was the first cut (PR #6562): every kind the base gained
 * while the PR sat in the queue was a red lane plus a repair round, because
 * a `human-input` list never regenerates and a baseline you refresh beside
 * the thing it guards guards nothing. Read off two trees, a
 * branch that retires one kind rebases onto a base that retired another
 * with neither a conflict nor a red — `sentence-kinds.test.ts` proves it on
 * a real `git rebase`.
 *
 * The baseline tree is read through `lib/base-artifact.ts`, so its three
 * outcomes apply: `text` is checked, `unavailable` (no base ref, a root
 * commit) is a declared skip, `broken` (git failed) is a red. A baseline
 * that predates the array is a declared skip too (once: the landing of
 * issue #6621 itself).
 */
import {
    baseArtifact,
    gitRunner,
    type BaseArtifactOutcome,
    type GitRunner,
} from "./base-artifact";

export const EFFECT_CLAUSE_PATH =
    "convex/oracle/grammar/shared/effectClause.ts";

const KIND_ARRAY_OPEN = "export const EFFECT_SENTENCE_KINDS = [";

/**
 * The kinds `EFFECT_SENTENCE_KINDS` declares in `source`, or `null` when the
 * source predates the array (the baseline tree of the change that introduced
 * it). The array is the one authority (issue #6621); a type-level assertion
 * in `effectClause.ts` ties it to the `EffectSentenceIR` union, so reading
 * the literal is exact and no prettier reflow of the union can move it.
 * STRICT: comments are dropped, then the body must be string literals and
 * commas ONLY — a spread, an identifier or an empty array throws, because a
 * reader that skipped what it did not recognise would let a kind enter
 * unseen, and an empty set is a subset of anything (review of PR #6562).
 */
export function readKindArray(source: string): string[] | null {
    const start = source.indexOf(KIND_ARRAY_OPEN);
    if (start === -1) return null;
    const rest = source.slice(start + KIND_ARRAY_OPEN.length);
    const end = rest.indexOf("] as const");
    if (end === -1)
        throw new Error(
            `${EFFECT_CLAUSE_PATH}: \`EFFECT_SENTENCE_KINDS\` is not closed by \`] as const\``
        );
    const body = rest
        .slice(0, end)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
    const kinds = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    if (body.replace(/"[^"]+"/g, "").replace(/[\s,]/g, "") !== "")
        throw new Error(
            `${EFFECT_CLAUSE_PATH}: \`EFFECT_SENTENCE_KINDS\` holds something other than string literals — the census cannot read it`
        );
    if (kinds.length === 0)
        throw new Error(
            `${EFFECT_CLAUSE_PATH}: \`EFFECT_SENTENCE_KINDS\` yields no kinds`
        );
    return kinds;
}

/** The kinds at a revision that must carry the array (HEAD): absent is a red. */
export function effectSentenceKinds(source: string): string[] {
    const kinds = readKindArray(source);
    if (kinds === null)
        throw new Error(
            `${EFFECT_CLAUSE_PATH}: no \`EFFECT_SENTENCE_KINDS\` array — the census reads the kinds from it (issue #6621)`
        );
    return kinds;
}

/** The only violation left: a kind at HEAD the baseline tree does not declare. */
export type KindViolation = { readonly kind: "grown"; readonly name: string };

/**
 * The tree HEAD's kinds may not exceed: its kinds and the `<rev>:<path>`
 * they were read from, or the reason there is none (a declared skip).
 */
export type KindBaseline =
    | {
          readonly kind: "tree";
          readonly kinds: readonly string[];
          readonly at: string;
      }
    | { readonly kind: "none"; readonly why: string };

export interface KindCensusResult {
    readonly violations: readonly KindViolation[];
    readonly headCount: number;
    readonly baseline: KindBaseline;
}

/** The census, pure over its two inputs: the kinds at HEAD and the baseline. */
export function auditSentenceKinds(input: {
    readonly head: readonly string[];
    readonly baseline: KindBaseline;
}): KindCensusResult {
    const violations: KindViolation[] = [];
    const head = new Set(input.head);
    if (input.baseline.kind === "tree") {
        const before = new Set(input.baseline.kinds);
        for (const name of [...head].sort())
            if (!before.has(name)) violations.push({ kind: "grown", name });
    }
    return { violations, headCount: head.size, baseline: input.baseline };
}

/**
 * The source of `effectClause.ts` at the baseline tree: the merge-base with
 * the base branch, or — when that merge-base IS `HEAD` (the base tip, or a
 * detached worktree at it), where `baseArtifact` would compare the file with
 * itself — the parent commit `HEAD^`, resolved to its sha. On the tip this
 * is a ONE-COMMIT contract by decision (issue #6714): a kind that reached the
 * base outside the queue is caught by the landing that carried it, not by a
 * later health run. Pure given its runner, so every branch has a fixture.
 */
export function baselineKindsSource(git: GitRunner): BaseArtifactOutcome {
    const base = baseArtifact(git, EFFECT_CLAUSE_PATH);
    if (base.kind !== "text") return base;
    const head = git(["rev-parse", "HEAD"]);
    if (!head.ok)
        return {
            kind: "broken",
            detail: `git rev-parse HEAD failed: ${head.error}`,
        };
    const mergeBase = base.at.slice(0, base.at.indexOf(":"));
    if (mergeBase !== head.out.trim()) return base;
    const parent = git(["rev-parse", "--verify", "--quiet", "HEAD^^{commit}"]);
    if (!parent.ok)
        return {
            kind: "unavailable",
            why: `HEAD is the base tip and a root commit — no parent tree to shrink against`,
        };
    const at = `${parent.out.trim()}:${EFFECT_CLAUSE_PATH}`;
    if (!git(["cat-file", "-e", at]).ok)
        return {
            kind: "unavailable",
            why: `HEAD is the base tip and its parent does not carry ${EFFECT_CLAUSE_PATH} (the file's first revision)`,
        };
    const show = git(["show", at]);
    if (!show.ok)
        return {
            kind: "broken",
            detail: `git show ${at} failed: ${show.error}`,
        };
    return { kind: "text", text: show.out, at };
}

/**
 * The baseline for `auditSentenceKinds`, from the real repository at `root`.
 * `broken` is thrown, never skipped: a guard that cannot read its baseline is
 * a guard that is not there (`lib/base-artifact.ts`).
 */
export function baselineSentenceKinds(root: string): KindBaseline {
    return baselineFromOutcome(baselineKindsSource(gitRunner(root)));
}

export function baselineFromOutcome(
    outcome: BaseArtifactOutcome
): KindBaseline {
    if (outcome.kind === "broken")
        throw new Error(
            `the baseline ${EFFECT_CLAUSE_PATH} could not be read — ${outcome.detail}\n` +
                `    This is NOT a skip: a guard that cannot read its baseline is a guard that is not there.`
        );
    if (outcome.kind === "unavailable")
        return { kind: "none", why: outcome.why };
    const kinds = readKindArray(outcome.text);
    if (kinds === null)
        return {
            kind: "none",
            why: `${outcome.at} predates \`EFFECT_SENTENCE_KINDS\` (issue #6621) — nothing to shrink against once`,
        };
    return { kind: "tree", kinds, at: outcome.at };
}

export function renderSentenceKinds(result: KindCensusResult): string {
    const baseline =
        result.baseline.kind === "tree"
            ? `shrink verified against ${result.baseline.at} (${result.baseline.kinds.length} kinds)`
            : `no baseline tree — ${result.baseline.why} — shrink check SKIPPED`;
    if (result.violations.length === 0)
        return `✓ kinds: ${result.headCount} effect-sentence kinds at HEAD; ${baseline}`;
    const lines = [
        `✗ kinds: ${result.violations.length} violation(s) of the shrink-only sentence-kind census:\n`,
    ];
    for (const v of result.violations)
        lines.push(
            `  - ${v.name}: a kind the baseline tree does not declare — the table only shrinks (issue #6557): read the sentence as Verb Frames instead, or retire a kind for it`
        );
    lines.push(
        `\n  The kinds are read off ${EFFECT_CLAUSE_PATH} at HEAD and at the baseline tree; ${baseline}.`
    );
    return lines.join("\n");
}
