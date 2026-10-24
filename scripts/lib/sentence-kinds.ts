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
 * There is NO committed list. The kinds are types, so there is nothing at
 * runtime to census: the source text of `effectClause.ts` is the authority,
 * and the census is a relation between two revisions of it —
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
 * commit) is a declared skip, `broken` (git failed) is a red.
 */
import {
    baseArtifact,
    gitRunner,
    type BaseArtifactOutcome,
    type GitRunner,
} from "./base-artifact";

export const EFFECT_CLAUSE_PATH =
    "convex/oracle/grammar/shared/effectClause.ts";

/**
 * The member types the union may carry WITHOUT a `kind`: the Verb Frame
 * layer (`kind?: undefined`, `verbFrames.ts`), by design not a row of the
 * table. Any other member must declare its kind, or the census throws — a
 * parser that skipped what it did not recognise would let a kind enter
 * unseen, and an empty set is a subset of anything (review of PR #6562).
 */
const KINDLESS_MEMBERS: ReadonlySet<string> = new Set(["FrameChainIR"]);

/**
 * The kinds `EffectSentenceIR` declares, read off the grammar's source: one
 * per top-level `    | ` member between `export type EffectSentenceIR =` and
 * the next line at column 0 — `readonly kind: "<name>"` at the member's own
 * indentation (ten spaces for a multi-line member, inline for a one-line
 * `| { readonly kind: "…" }`). Nested object types sit deeper and are not
 * kinds. STRICT: a member that yields no kind and is not a `KINDLESS_MEMBERS`
 * alias throws, as does a union that yields none at all; the kinds are types,
 * so the source text is the only authority and it must be read whole.
 */
export function effectSentenceKinds(source: string): string[] {
    const start = source.indexOf("export type EffectSentenceIR =");
    if (start === -1)
        throw new Error(`${EFFECT_CLAUSE_PATH}: no \`EffectSentenceIR\` union`);
    const rest = source.slice(start + "export type EffectSentenceIR =".length);
    const end = rest.search(/\n(?=\S)/);
    const body = end === -1 ? rest : rest.slice(0, end);
    const kinds: string[] = [];
    // Members start at four spaces with `| `; whatever follows up to the next
    // such line (doc comments included) is the member's text.
    const members = body.split(/^(?= {4}\| )/m).slice(1);
    for (const member of members) {
        const text = member.slice(6);
        // The next member's doc comment rides along; it is not the member.
        const code = text
            .split("\n")
            .filter((line) => !/^\s*(?:\/\*\*|\*|\/\/)/.test(line))
            .join("\n")
            .trim()
            .replace(/;$/, "");
        const alias = /^([A-Za-z_]\w*)$/.exec(code);
        if (alias !== null) {
            if (KINDLESS_MEMBERS.has(alias[1]!)) continue;
            throw new Error(
                `${EFFECT_CLAUSE_PATH}: \`EffectSentenceIR\` member \`${alias[1]}\` is an alias the kind census cannot read — inline its kind, or add it to KINDLESS_MEMBERS if it carries none by design`
            );
        }
        const m =
            /^\{ readonly kind: "([^"]+)"/.exec(text) ??
            /^ {10}readonly kind: "([^"]+)";/m.exec(text);
        if (m === null)
            throw new Error(
                `${EFFECT_CLAUSE_PATH}: \`EffectSentenceIR\` member without a readable \`kind\` — ${text.split("\n")[0]?.trim()}`
            );
        kinds.push(m[1]!);
    }
    if (kinds.length === 0)
        throw new Error(
            `${EFFECT_CLAUSE_PATH}: \`EffectSentenceIR\` yields no kinds — the union moved or was respelled; the census cannot read it`
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
    return {
        kind: "tree",
        kinds: effectSentenceKinds(outcome.text),
        at: outcome.at,
    };
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
