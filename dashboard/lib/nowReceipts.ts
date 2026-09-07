import type { Tone } from "./tones";
import { plural } from "./format";
import type { ReceiptsSummary } from "./nowPayload";

/**
 * The batch's receipt figures (issue #3135, ported in PRD #3148 S2).
 *
 * Receipts render from `receiptsSummary`, never a raw list (PR #2545 review,
 * finding 3): a live batch measured 232 receipts, almost all `missing
 * session=…` markers, which blew this panel to 3000-8000px tall on a phone.
 * The aggregate is a row of stat boxes; only `wip`/`failed`/`blocking`/
 * `collision` rows print individually, capped server-side.
 */

/** Role → the order its stat box appears in. `missing` is the receipt guard's
 *  own marker role (`MissingReceipt`, lib/receipt.ts) and is spelled out as
 *  "missing session markers" — the literal "missing missing: 389" is the
 *  wording this replaced (#2632). */
const ROLE_ORDER = ["implement", "review", "fixup", "missing"];

export interface ReceiptStat {
    /** A glossary key — `role.<name>` for a role, a fixed key otherwise. */
    term: string;
    label: string;
    value: string;
    tone?: Tone;
}

export function receiptStats(summary: ReceiptsSummary): ReceiptStat[] {
    const byRole = new Map<string, number>();
    for (const c of summary.counts) {
        byRole.set(c.role, (byRole.get(c.role) ?? 0) + c.count);
    }
    const roles = [...byRole.keys()].sort((a, b) => {
        const ai = ROLE_ORDER.indexOf(a);
        const bi = ROLE_ORDER.indexOf(b);
        return (
            (ai === -1 ? ROLE_ORDER.length : ai) -
            (bi === -1 ? ROLE_ORDER.length : bi)
        );
    });
    const stats: ReceiptStat[] = [
        {
            term: "receipts.total",
            label: plural(summary.total, "receipt", "receipts"),
            value: String(summary.total),
        },
    ];
    for (const role of roles) {
        const count = byRole.get(role)!;
        stats.push(
            role === "missing"
                ? {
                      term: "receipts.missing",
                      label: `missing session ${plural(count, "marker", "markers")}`,
                      value: String(count),
                  }
                : { term: `role.${role}`, label: role, value: String(count) }
        );
    }
    const attention = (summary.interesting ?? []).length;
    stats.push({
        term: "receipts.attention",
        label: "needing attention",
        value: String(attention),
        tone: attention > 0 ? "warn" : "good",
    });
    return stats;
}
