/**
 * One legend entry (PRD #3148 S3) — a colour chip and the series it stands
 * for.
 *
 * The colour arrives as a `var(--series-N)` string rather than a class,
 * because which slot a series holds is decided at runtime by
 * `historyColors.ts` and bound to the ENTITY, not to its rank in the current
 * view. A `style` here and a `fill` on the mark both read the same variable,
 * so the chip and its bars cannot come out different colours.
 */
export function SeriesSwatch({
    color,
    label,
}: {
    color: string;
    label: string;
}) {
    return (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: color }}
            />
            {label}
        </span>
    );
}
