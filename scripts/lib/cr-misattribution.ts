/**
 * The shared skeleton of the targeted "resolvable but wrong" CR-citation scans
 * run by `bun run cr:lint` (ADR 0098, issue #3014).
 *
 * `check-cr-citations.ts` asks whether a cited id EXISTS. A targeted scan asks
 * a narrower question for one mechanically decidable shape: a line that cites
 * a given rule while stating a claim that rule plainly does not make. Each such
 * scan is a list of rules over one line at a time:
 *
 * - `cites`   — the line cites the id under suspicion;
 * - `claim`   — the line states the claim that id is wrongly cited for;
 * - `legitimate` (optional) — the line names what the id IS about, so the
 *   citation is defensible and the line passes. This is what keeps a scan from
 *   degrading into a blanket ban on a perfectly valid id.
 *
 * What stays in each scan's own module is the part that needs judgement: the
 * regexes, the measured false negatives, and the files that quote the wrong
 * shape on purpose (`EXEMPT`). What lives here is the part that does not: the
 * file walk, the per-file needle prefilter, the line split and the trailing
 * `cr-cite-ok` escape hatch — identical across every scan that uses it.
 *
 * Every match is anchored to ONE LOGICAL line (`cr-lines.ts`, issue #2514):
 * a comment line ending mid-citation is joined with its continuation, so a
 * citation wrapped across two comment lines — or a claim that starts on the
 * line after the id — is seen whole. What stays invisible, as for every other
 * scan, is a claim that continues past a line which does not end on the
 * citation itself.
 */
import { citationLines, lineAt } from "./cr-lines.ts";

/** Inline escape hatch for a deliberate counter-example on one line. */
export const SUPPRESS = "cr-cite-ok";

export type MisattributionRule = {
    /** Plain substring a file must contain for this rule to be worth a line scan. */
    needle: string;
    cites: RegExp;
    claim: RegExp;
    legitimate?: RegExp;
};

export type MisattributionHit<R extends MisattributionRule> = {
    file: string;
    line: number;
    text: string;
    rule: R;
};

/**
 * Flags every line that matches a rule's `cites` and `claim` but not its
 * `legitimate`. One hit per (line, rule): a line that trips two rules reports
 * both. Pure over `(file, text)` pairs so a scan can be driven with fixtures
 * (proof-of-failure, regression test). The regexes must not carry the `g`
 * flag — `test()` on a global regex is stateful across lines.
 */
export function scanMisattributions<R extends MisattributionRule>(
    sources: Iterable<{ file: string; text: string }>,
    rules: readonly R[],
    exempt: readonly string[]
): MisattributionHit<R>[] {
    const hits: MisattributionHit<R>[] = [];
    for (const { file, text } of sources) {
        if (exempt.some((p) => file.startsWith(p))) continue;
        const live = rules.filter((rule) => text.includes(rule.needle));
        if (!live.length) continue;
        for (const logical of citationLines(text)) {
            const line = logical.text;
            if (line.includes(SUPPRESS)) continue;
            for (const rule of live) {
                const cites = line.match(rule.cites);
                if (!cites || !rule.claim.test(line)) continue;
                if (rule.legitimate?.test(line)) continue;
                hits.push({
                    file,
                    line: lineAt(logical, cites.index ?? 0).line,
                    text: line.replace(/\s+/g, " ").trim(),
                    rule,
                });
            }
        }
    }
    return hits;
}
