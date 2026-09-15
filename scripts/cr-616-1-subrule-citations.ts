#!/usr/bin/env bun
/**
 * CR 616.1c / 616.1d mis-citation guard (ADR 0098, issue #3014).
 *
 * The same "resolvable but wrong" question `cr-118-4-life-payment.ts` asks,
 * for the next narrow, mechanically decidable shape. CR 616.1 is the ordered
 * procedure the affected player follows when several replacement/prevention
 * effects want one event; its lettered steps are PRIORITY TIERS, each about a
 * specific kind of effect:
 *
 * - printed CR 616.1c: an effect that makes an object enter as a COPY of
 *   another object must be chosen first;
 * - printed CR 616.1d: an effect that makes a card enter with its BACK FACE UP
 *   must be chosen first.
 *
 * Neither says anything about a replacement applying only once per event —
 * that is CR 614.5 ("a replacement effect doesn't invoke itself repeatedly; it
 * gets only one opportunity to affect an event") — nor about the affected
 * player choosing the order, which is CR 616.1e ("any of the applicable effects
 * may be chosen") under the CR 616.1 lead-in. Triage of issue #2054 found ten
 * comments citing the two letters for exactly those two claims (corrected in
 * issue #3013); both ids resolve, so the existence scan was green throughout.
 *
 * The guard fires on the CLAIM VOCABULARY on the line, never on the id alone:
 * transform is implemented (CR 701.27 Transform, ADR 0067), so a genuine
 * `CR 616.1d` citation about a card entering with its back face up is correct
 * and passes, as does a `CR 616.1c` citation that names a copy. Both ids are
 * checked for both claims — a regression that swaps the letter is the same bug.
 *
 * MEASURED against the nine lines issue #3013 corrected (ade72cfc1): all three
 * `616.1c` ordering sites trip the guard; three of the six `616.1d` sites do.
 * The three it misses carry their claim on the NEXT comment line, or no claim
 * vocabulary at all — blind spots 1 and 2 below.
 *
 * REMAINING BLIND SPOTS (measured, not fixed here — narrowing scope, not a
 * defeat of the guard's purpose):
 * 1. A citation or its claim WRAPPED ACROSS TWO COMMENT LINES — "honoring
 *    CR 616.1d (a given" + "replacement applies once …" on the next line — is
 *    invisible: `cites` and `claim` are both anchored to a single line, the
 *    same hole `check-cr-citations.ts` documents. A multi-line window was
 *    measured and rejected by both earlier guards. Keep the citation, its
 *    `CR ` prefix and its claim on one line.
 * 2. A claim phrased outside the vocabulary — "(repeatable, …)", "can only
 *    fire one time" — passes. The vocabulary is the words the corrected sites
 *    actually used plus CR 614.5's own ("itself", "one opportunity").
 * 3. `legitimate` wins over `claim`: a line that says "once" AND "back face"
 *    passes, whatever it meant. The trade is the same one the CR 118.4 guard
 *    makes for its `X` cost — a regex cannot tell "once the back face is up"
 *    from "applies once per event (see the back face)", and a false positive
 *    on a correct transform citation is the worse error.
 *
 * Usage: run through `bun run cr:lint` (this module has no CLI of its own).
 * Suppress a deliberate counter-example with a trailing `cr-cite-ok` comment.
 */
import {
    scanMisattributions,
    type MisattributionHit,
    type MisattributionRule,
} from "./lib/cr-misattribution.ts";

/**
 * Files that quote a wrong CR 616.1c/616.1d citation ON PURPOSE — this guard's
 * own header, the sweep's CLI advice, its regression test, and the findings
 * drawer (which exists to describe defects, not commit them).
 */
export const EXEMPT = [
    "docs/findings/",
    "scripts/cr-616-1-subrule-citations.ts",
    "scripts/check-cr-citations.ts",
    "scripts/__tests__/cr-616-1-subrule-citations.test.ts",
];

/**
 * The id on a line that says `CR ` — prefixed, or bare inside a slash-list
 * ("CR 614.5 / 616.1d"), the same widening the existence scan's second pass
 * makes. `(?<![\d.])` keeps "1616.1d" or "3.616.1d" from matching.
 */
function citedOnCrLine(id: string): RegExp {
    return new RegExp(`\\bCR\\b.*(?<![\\d.])${id.replaceAll(".", "\\.")}\\b`);
}

/** The once-per-event claim (CR 614.5), in the words the corrected sites used
 *  ("applies once per event", "re-trigger", "isn't re-intercepted") and the
 *  printed rule's own ("invoke itself", "one opportunity"). */
const ONCE_PER_EVENT =
    /\bonce\b|\bre-?(?:trigger|intercept|appl(?:y|ie))|\binvokes? itself\b|\bone opportunity\b/i;

/** The affected-player-orders-them claim (CR 616.1 / 616.1e). */
const CHOOSES_THE_ORDER =
    /\border(?:s|ed|ing)?\b|\baffected player\b|\bAPNAP\b/i;

/** What printed CR 616.1c is about: an object entering as a copy. */
const ENTERS_AS_A_COPY = /\bcop(?:y|ies|ied)\b/i;

/** What printed CR 616.1d is about: a card entering back face up (transform,
 *  convert, double-faced cards). */
const ENTERS_BACK_FACE_UP =
    /\bback[- ]face\b|\btransform|\bconvert|\bdouble-faced\b|\bm?dfcs?\b/i;

const SUBRULES = [
    {
        cited: "616.1c",
        subject: "copy-as-it-enters",
        legitimate: ENTERS_AS_A_COPY,
    },
    {
        cited: "616.1d",
        subject: "enters-back-face-up",
        legitimate: ENTERS_BACK_FACE_UP,
    },
];

const CLAIMS = [
    {
        claim: ONCE_PER_EVENT,
        claimName: "a replacement applies only once per event",
        rightRule: "CR 614.5",
    },
    {
        claim: CHOOSES_THE_ORDER,
        claimName: "the affected player chooses the order",
        rightRule: "CR 616.1e (or bare CR 616.1)",
    },
];

export type SubruleRule = MisattributionRule & {
    cited: string;
    subject: string;
    claimName: string;
    rightRule: string;
};

/** Every (subrule, claim) pair — both letters are checked for both claims. */
export const RULES: readonly SubruleRule[] = SUBRULES.flatMap((s) =>
    CLAIMS.map((c) => ({
        ...s,
        ...c,
        needle: s.cited,
        cites: citedOnCrLine(s.cited),
    }))
);

export type SubruleHit = MisattributionHit<SubruleRule>;

/** Flags every line citing CR 616.1c/616.1d for a claim that subrule does not
 *  make, unless the line names what the subrule is actually about. */
export function scanSubruleMiscitations(
    sources: Iterable<{ file: string; text: string }>
): SubruleHit[] {
    return scanMisattributions(sources, RULES, EXEMPT);
}

/** One reportable line, formatted for the CLI and the test failure message. */
export function formatSubruleHit(hit: SubruleHit): string {
    const { cited, subject, claimName, rightRule } = hit.rule;
    return (
        `  ${hit.file}:${hit.line}  CR ${cited} is ${subject}, not "${claimName}" — that's ${rightRule}` +
        `\n      ${hit.text.slice(0, 160)}`
    );
}
