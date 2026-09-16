#!/usr/bin/env bun
/**
 * CR 118.4 life-payment mis-citation guard (ADR 0098, issue #2559).
 *
 * `check-cr-citations.ts` asks whether a cited id EXISTS. `cr-keyword-citations.ts`
 * asks whether a CR 701/702 citation means what its line says. This is the same
 * "resolvable but wrong" question for one more narrow, mechanically decidable
 * shape: printed CR 118.4 is "Some costs include an {X} or an X. See rule 107.3."
 * — it says nothing about life. The rule that governs "you can't pay more life
 * than you have" and "paying life is losing life" is CR 119.4. A line citing
 * `CR 118.4` while describing a life payment is wrong by construction, the
 * same way a `CR 701.19` next to the word "sacrifice" is (example only, not a real citation — cr-cite-ok): the fix reads straight off the printed rule, no
 * judgement call left over.
 *
 * 93 of the 100 `CR 118.4` sites standing when this guard was written were
 * exactly this shape (issue #2559) — corrected to CR 119.4 in the same change.
 * The remaining sites cite `CR 118.4` for a genuine `{X}`/chosen-X-value cost
 * (Toxic Deluge's "pay X life") alongside CR 119.4 for the life-legality half —
 * both citations are correct there, so the guard exempts a line that names an
 * `X` cost placeholder rather than banning `CR 118.4` outright (a blanket ban
 * would also forbid that correct dual citation).
 *
 * PRECISION note: the "describes paying life" test is deliberately a plain
 * `\blife\b` match, not a life-payment parser — this guard exists to catch a
 * REGRESSION (someone re-typing `118.4` on a life-cost comment), not to certify
 * every existing `CR 118.4` site. A `CR 118.4` citation that is genuinely about
 * something else entirely (energy, mana) and happens not to mention "life" on
 * its own line is untouched, same as `cr-keyword-citations.ts` only sees a line
 * that names its keyword.
 *
 * REMAINING BLIND SPOTS (measured, not fixed here — narrowing scope, not a
 * defeat of the guard's purpose):
 * 1. A life claim that continues past a line which does not end on the
 *    citation itself is invisible: the scan reads logical lines
 *    (`lib/cr-lines.ts`, issue #2514), which join a comment line ending
 *    mid-citation — `CR` alone, or `CR 118.4` — with its continuation, and
 *    nothing else.
 * 2. `X_COST` matches ANY standalone `X` token on the line, not specifically
 *    an `{X}` cost — so a line like "// CR 118.4 — pay 2 life (see the X
 *    column of the table)." passes clean: the stray `X` suppresses the hit
 *    even though the line has nothing to do with a variable cost. This guard
 *    trades that false negative for avoiding a false positive on the genuine
 *    Toxic-Deluge-shaped dual citation (see above) — a plain regex can't tell
 *    "the X cost" from "the X column".
 *
 * Usage: run through `bun run cr:lint` (this module has no CLI of its own).
 * Suppress a deliberate counter-example with a trailing `cr-cite-ok` comment
 * (same escape hatch as `cr-keyword-citations.ts`). The file walk, line scan
 * and suppression are the skeleton shared with `cr-616-1-subrule-citations.ts`
 * (`lib/cr-misattribution.ts`); what stays here is the predicate.
 */
import {
    scanMisattributions,
    type MisattributionHit,
    type MisattributionRule,
} from "./lib/cr-misattribution.ts";

export { SUPPRESS } from "./lib/cr-misattribution.ts";

/**
 * Files that quote a wrong CR 118.4 citation ON PURPOSE — this guard's own
 * header, its regression test, and the findings drawer (which exists to
 * describe defects, not commit them).
 */
export const EXEMPT = [
    "docs/findings/",
    "scripts/cr-118-4-life-payment.ts",
    "scripts/check-cr-citations.ts",
    "scripts/__tests__/cr-118-4-life-payment.test.ts",
];

/**
 * A literal `CR 118.4` citation — the exact shape this guard's issue (#2559)
 * scoped and counted (100 sites). Deliberately NARROWER than the existence
 * scan's bare-id pass: a slash-listed `NNN.Nx / 118.4` (the may-pay/Kicker/
 * tap-mana-ability family — "CR 117.3a / 118.4", "CR 702.33a / 118.4" — quoted as example citation SHAPES only, not endorsed as correct — cr-cite-ok) is a
 * DIFFERENT, uncensused citation shape the issue explicitly left out of scope
 * ("a general resolvable-but-wrong scanner ... much larger work") — catching
 * it here would both overreach this guard's mandate and false-positive on
 * sites that are not life-payment claims at all (Kicker's total-owed doc).
 */
const PREFIXED_118_4 = /\bCR\s?118\.4\b/;

/** A line describing a claim about paying life (deliberately broad — see the
 *  module doc's PRECISION note). */
const LIFE_CLAIM = /\blife\b/i;

/** A line that names an `X` cost placeholder (CR 107.3) — the one shape where
 *  CR 118.4 is defensible ALONGSIDE a life claim (Toxic Deluge's "pay X life",
 *  Fire Covenant's "pay-X-life"). Matches a standalone `X` token so it catches
 *  `{X}`, "pay X life", and the hyphenated "pay-X-life" / "chosen-cost X,"
 *  shapes alike, without matching an ordinary word merely containing an x. */
const X_COST = /\bX\b/;

const RULES: readonly MisattributionRule[] = [
    {
        needle: "118.4",
        cites: PREFIXED_118_4,
        claim: LIFE_CLAIM,
        legitimate: X_COST,
    },
];

export type LifePaymentHit = MisattributionHit<MisattributionRule>;

/**
 * Flags every line citing `CR 118.4` that also describes paying life, unless
 * the same line names an `X` cost placeholder. Pure over `(file, text)` pairs
 * so the guard can be driven with fixtures (proof-of-failure, regression test).
 */
export function scanLifePaymentMiscitations(
    sources: Iterable<{ file: string; text: string }>
): LifePaymentHit[] {
    return scanMisattributions(sources, RULES, EXEMPT);
}

/** One reportable line, formatted for the CLI and the test failure message. */
export function formatLifePaymentHit(hit: LifePaymentHit): string {
    return `  ${hit.file}:${hit.line}\n      ${hit.text.slice(0, 160)}`;
}
