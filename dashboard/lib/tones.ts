/**
 * The dashboard's five STATE tones, as ONE table (PRD #3148 S1).
 *
 * Role names, never chromatic ones (#2630): a light, a verdict word, a claim
 * mark and an UNAVAILABLE banner all mean "good" / "warn" / "bad" / "cannot
 * tell", and before the role tokens existed each reached for a `--series-N`
 * slot by hand. `unknown` is deliberately its OWN tone rather than a second
 * name for `bad`: "I could not tell" is not "this is wrong", and collapsing
 * the two is the exact confusion #2630 exists to kill. `neutral` is the fifth
 * — a value that is simply a value, with no verdict attached.
 *
 * One table, so a tone is NAMED once. Every badge, dot, rule and border in the
 * ported views resolves its classes here; a component that hard-codes
 * `text-state-warn` has quietly forked the vocabulary.
 *
 * shadcn's `badge` variants are about EMPHASIS (`default` / `secondary` /
 * `outline`), not about meaning, so a tone maps onto `outline` plus its own
 * colour rather than onto a variant per tone. That keeps the primitive
 * unmodified and shareable with the game app, which has no state tones at all.
 */

export const TONES = ["good", "warn", "bad", "unknown", "neutral"] as const;
export type Tone = (typeof TONES)[number];

/**
 * How SURE the dashboard is of the tone it is showing.
 *
 * `certain` is a measurement; `inferred` is a deduction the dashboard made
 * from indirect evidence, and it wears a DASHED edge so an operator can tell
 * them apart at a glance (issue #3144). It is a modifier ON a tone, never a
 * sixth tone: "probably running" is still `good`, and giving it its own colour
 * would have made confidence and verdict the same axis.
 */
export type Confidence = "certain" | "inferred";

interface ToneClasses {
    /** Badge/pill: an edge and a label in the tone, no fill. */
    badge: string;
    /** Text alone — a verdict word inside a sentence. */
    text: string;
    /** A filled dot or bar — a light, a chart key, a timeline band. */
    fill: string;
    /** A left rule on a framed section. */
    rule: string;
}

const TONE_CLASSES: Record<Tone, ToneClasses> = {
    good: {
        badge: "border-state-good text-state-good",
        text: "text-state-good",
        fill: "bg-state-good",
        rule: "border-l-state-good",
    },
    warn: {
        badge: "border-state-warn text-state-warn",
        text: "text-state-warn",
        fill: "bg-state-warn",
        rule: "border-l-state-warn",
    },
    bad: {
        badge: "border-state-bad text-state-bad",
        text: "text-state-bad",
        fill: "bg-state-bad",
        rule: "border-l-state-bad",
    },
    unknown: {
        badge: "border-state-unknown text-state-unknown",
        text: "text-state-unknown",
        fill: "bg-state-unknown",
        rule: "border-l-state-unknown",
    },
    neutral: {
        badge: "border-border text-muted-foreground",
        text: "text-muted-foreground",
        fill: "bg-state-neutral",
        rule: "border-l-border",
    },
};

/** The dashed edge that says "inferred, not measured" (#3144). */
const INFERRED_EDGE = "border-dashed";

export function toneBadgeClass(
    tone: Tone,
    confidence: Confidence = "certain"
): string {
    const base = TONE_CLASSES[tone].badge;
    return confidence === "inferred" ? `${base} ${INFERRED_EDGE}` : base;
}

export function toneTextClass(tone: Tone): string {
    return TONE_CLASSES[tone].text;
}

export function toneFillClass(tone: Tone): string {
    return TONE_CLASSES[tone].fill;
}

export function toneRuleClass(tone: Tone): string {
    return TONE_CLASSES[tone].rule;
}
