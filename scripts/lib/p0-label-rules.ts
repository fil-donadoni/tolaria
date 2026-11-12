/**
 * The table of label rules that rank an open issue at board `P0`
 * (ADR 0143 Amendment VII + X). ONE table: `issue:workflow-band` plans from it
 * and the `issue-band` workflow's `if:` is checked against it
 * (`scripts/__tests__/p0-label-rules.test.ts`), so a rule cannot be added to
 * one and forgotten in the other.
 *
 * A rule is a set of labels the issue must ALL carry; any one rule suffices.
 */
export interface P0LabelRule {
    /** Why the rule exists (for the plan's reason line). */
    readonly why: string;
    readonly labels: readonly string[];
}

export const P0_LABEL_RULES: readonly P0LabelRule[] = [
    { why: "workflow bug", labels: ["bug", "area:workflow"] },
    { why: "Bot fault", labels: ["bug", "bot-fault"] },
    { why: "user Bug Report", labels: ["user-report"] },
];

/** True when `labels` satisfy at least one rule. */
export function matchesP0Rule(labels: readonly string[]): boolean {
    return P0_LABEL_RULES.some((rule) =>
        rule.labels.every((l) => labels.includes(l))
    );
}

/** The rules rendered for a "needs …" reason line. */
export function describeP0Rules(): string {
    return P0_LABEL_RULES.map((rule) =>
        rule.labels.map((l) => `\`${l}\``).join(" + ")
    ).join(" or ");
}
