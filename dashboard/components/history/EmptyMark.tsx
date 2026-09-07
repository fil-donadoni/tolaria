/**
 * The empty-CELL mark (PRD #3148 S3) — one em dash, quieter than a figure.
 *
 * It replaces `<span class='mini'>—</span>`, which the vanilla tables spelled
 * out at a dozen call sites across three formatters. The distinction it
 * carries is real and worth a component: a per-role subtotal of `$0` means
 * "that role did nothing here", while a GRAND total of `$0` is a measurement —
 * so the grand total never falls back to this and the subtotals always do
 * (#2634).
 *
 * `aria-hidden`, with the reading carried by the cell's own column header: a
 * screen reader announcing "em dash" in eleven consecutive cells is noise, and
 * an empty cell is already the absence of a value.
 */
export function EmptyMark() {
    return (
        <span className="text-muted-foreground/60" aria-hidden="true">
            —
        </span>
    );
}
