/**
 * The shrink-only census of `EffectSentenceIR` kinds (issue #6557, the
 * compositional grammar pilot).
 *
 * The effect-clause grammar has two layers: a TABLE of whole-sentence kinds,
 * each an anchored shape with its own lowering case, and the Verb Frame layer
 * (`convex/oracle/grammar/shared/verbFrames.ts`), where a sentence is read as
 * Op-shaped frames joined by Composition Rules. The pilot's direction is that
 * the table only SHRINKS: a kind may leave — absorbed by frames — and never
 * enter. `data/effect-sentence-kinds.json` is the committed list of the kinds
 * that remain, and this module is the census over it:
 *
 *   - the list must equal the kinds the SOURCE declares (`EffectSentenceIR`'s
 *     union, read off `effectClause.ts` — the kinds are types, so there is
 *     nothing at runtime to census; the source text is the authority);
 *   - the list may not have GROWN against its baseline: on a branch the list
 *     at the merge-base with the base branch, on the base tip its previous
 *     revision in history (`baselineSentenceKinds`).
 *
 * A kind that leaves is removed from both the source and the list in the same
 * commit; a kind someone adds reds the census twice — once as a source kind
 * the list does not carry, once as a grown list if they add the row too.
 */
import { spawnSync } from "node:child_process";
import { ORIGIN_BASE } from "./branches";

export const SENTENCE_KINDS_PATH = "data/effect-sentence-kinds.json";
export const EFFECT_CLAUSE_PATH =
    "convex/oracle/grammar/shared/effectClause.ts";

export interface SentenceKindsFile {
    readonly kinds: readonly string[];
}

/**
 * The kinds `EffectSentenceIR` declares, read off the grammar's source: every
 * `readonly kind: "<name>"` at the union member's own indentation — a
 * multi-line member's field, or a one-line `| { readonly kind: "…" }` member —
 * between `export type EffectSentenceIR =` and the next top-level
 * declaration. Nested object types sit deeper and are not kinds; a named
 * alias member (the frame layer, `kind?: undefined`) is not one either, by
 * design: `sentence-kinds.test.ts` pins both spellings and the alias.
 */
export function effectSentenceKinds(source: string): string[] {
    const start = source.indexOf("export type EffectSentenceIR =");
    if (start === -1)
        throw new Error(`${EFFECT_CLAUSE_PATH}: no \`EffectSentenceIR\` union`);
    const rest = source.slice(start + "export type EffectSentenceIR =".length);
    const end = rest.search(/\n(?:export |\/\*\*\n \*)/);
    const body = end === -1 ? rest : rest.slice(0, end);
    const kinds: string[] = [];
    // A member spelled over several lines carries its kind at ten spaces; one
    // spelled on a single line opens with `| { readonly kind: "…"`.
    for (const m of body.matchAll(
        /^(?: {10}readonly kind: "([^"]+)";| {4}\| \{ readonly kind: "([^"]+)")/gm
    ))
        kinds.push((m[1] ?? m[2])!);
    return kinds;
}

export type KindViolation =
    | { readonly kind: "undeclared"; readonly name: string }
    | { readonly kind: "retired"; readonly name: string }
    | { readonly kind: "grown"; readonly name: string }
    | { readonly kind: "duplicate"; readonly name: string }
    | { readonly kind: "unsorted" };

export interface KindCensusResult {
    readonly violations: readonly KindViolation[];
    readonly sourceCount: number;
    readonly committedCount: number;
    readonly baselineChecked: boolean;
}

/**
 * The census, pure over its three inputs: the kinds the source declares, the
 * committed list, and the list's previous revision (`null` when there is
 * none — the commit that introduces the file).
 */
export function auditSentenceKinds(input: {
    readonly source: readonly string[];
    readonly committed: SentenceKindsFile;
    readonly baseline: SentenceKindsFile | null;
}): KindCensusResult {
    const violations: KindViolation[] = [];
    const committed = input.committed.kinds;
    const seen = new Set<string>();
    for (const name of committed) {
        if (seen.has(name)) violations.push({ kind: "duplicate", name });
        seen.add(name);
    }
    const sorted = [...seen].sort();
    if (
        committed.length === seen.size &&
        committed.join("\n") !== sorted.join("\n")
    )
        violations.push({ kind: "unsorted" });
    const inSource = new Set(input.source);
    for (const name of [...inSource].sort())
        if (!seen.has(name)) violations.push({ kind: "undeclared", name });
    for (const name of sorted)
        if (!inSource.has(name)) violations.push({ kind: "retired", name });
    if (input.baseline !== null) {
        const before = new Set(input.baseline.kinds);
        for (const name of sorted)
            if (!before.has(name)) violations.push({ kind: "grown", name });
    }
    return {
        violations,
        sourceCount: inSource.size,
        committedCount: committed.length,
        baselineChecked: input.baseline !== null,
    };
}

export function parseSentenceKinds(text: string): SentenceKindsFile {
    const parsed = JSON.parse(text) as SentenceKindsFile;
    if (!Array.isArray(parsed.kinds))
        throw new Error(`${SENTENCE_KINDS_PATH}: no \`kinds\` array`);
    return parsed;
}

/**
 * The revision the list must not have grown against.
 *
 * On a branch: the list at the MERGE-BASE with the base branch — the whole
 * branch is one change, so a kind added in one commit and the list touched
 * again in the next cannot pass at `land` (review of PR #6562). On the base
 * tip itself, or in a detached worktree at it, the merge-base IS `HEAD` and
 * would compare the file with itself — the vacuity `baselineAllowlist`'s doc
 * records — so there the list's previous revision in history is the
 * baseline, the per-commit contract the Op allowlist keeps. `null` when
 * there is none: the commit that introduces the file.
 */
export function baselineSentenceKinds(root: string): SentenceKindsFile | null {
    const git = (args: string[]) =>
        spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const show = (at: string): SentenceKindsFile | null => {
        const out = git(["show", `${at}:${SENTENCE_KINDS_PATH}`]);
        return out.status === 0 ? parseSentenceKinds(out.stdout) : null;
    };
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const mergeBase = git(["merge-base", "HEAD", ORIGIN_BASE]);
    if (mergeBase.status === 0) {
        const at = mergeBase.stdout.trim();
        if (at !== "" && at !== head) return show(at);
    }
    const prev = git([
        "log",
        "--format=%H",
        "--skip=1",
        "-1",
        "HEAD",
        "--",
        SENTENCE_KINDS_PATH,
    ]);
    if (prev.status !== 0) return null;
    const at = prev.stdout.trim();
    if (at === "") return null;
    return show(at);
}

const EXITS: Record<KindViolation["kind"], string> = {
    undeclared:
        "the source declares a kind the list does not carry — the table only shrinks (issue #6557): read the sentence as Verb Frames instead, or retire a kind for it",
    retired:
        "the list carries a kind the source no longer declares — delete the row",
    grown: "the list grew against its previous revision — a kind never enters",
    duplicate: "listed twice",
    unsorted: "the list is kept sorted",
};

export function renderSentenceKinds(result: KindCensusResult): string {
    const baseline = result.baselineChecked
        ? "shrink verified against the list's baseline revision"
        : "no baseline revision of the list — shrink check SKIPPED";
    if (result.violations.length === 0)
        return `✓ kinds: ${result.committedCount} effect-sentence kinds, source and list agree; ${baseline}`;
    const lines = [
        `✗ kinds: ${result.violations.length} violation(s) of the shrink-only sentence-kind census:\n`,
    ];
    for (const v of result.violations)
        lines.push(
            `  - ${"name" in v ? v.name : SENTENCE_KINDS_PATH}: ${EXITS[v.kind]}`
        );
    lines.push(
        `\n  The kinds are read off ${EFFECT_CLAUSE_PATH}; the list is ${SENTENCE_KINDS_PATH}; ${baseline}.`
    );
    return lines.join("\n");
}
