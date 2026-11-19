import type {
    SideboardPoolRow,
    SideboardTileHandlers,
    SideboardZone,
} from "~/lib/sideboard-pool";
import SideboardCardTile from "./sideboard-card-tile";

/** A long Sideboard column splits in two from this many cards (wide only). */
const SPLIT_FROM = 7;

/** One type column (issue #9820): cards cascaded top-down, each showing its
 *  printed name bar, the last one whole. `split` breaks a long column in two.
 *  Width is the `--card-w` var the editor sets per breakpoint. */
export default function SideboardCascade({
    title,
    count,
    rows,
    zone,
    split = false,
    ...handlers
}: {
    /** Column heading; omitted for the Sideboard's single column. */
    title?: string;
    count: number;
    rows: SideboardPoolRow[];
    zone: SideboardZone;
    split?: boolean;
} & SideboardTileHandlers) {
    const half = Math.ceil(rows.length / 2);
    const cols =
        split && rows.length >= SPLIT_FROM
            ? [rows.slice(0, half), rows.slice(half)]
            : [rows];
    return (
        <div
            data-cascade={title ?? zone}
            style={{ width: cols.length > 1 ? undefined : "var(--card-w)" }}
        >
            {title && (
                <div
                    className="mb-1.5 flex items-baseline justify-between text-xs"
                    style={{ width: "var(--card-w)" }}
                >
                    <span className="text-parchment">{title}</span>
                    <span className="text-text-muted tabular-nums">
                        {count}
                    </span>
                </div>
            )}
            <div className="flex gap-5">
                {cols.map((col, ci) => (
                    <ol
                        key={ci}
                        className="flex flex-col"
                        style={{ width: "var(--card-w)" }}
                    >
                        {col.map((r, i) => (
                            <SideboardCardTile
                                key={r.cardId}
                                row={r}
                                zone={zone}
                                last={i === col.length - 1}
                                {...handlers}
                            />
                        ))}
                    </ol>
                ))}
            </div>
        </div>
    );
}
