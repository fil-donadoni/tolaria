// Your Tables (PRD #5334 stories 6–9, issue #5344): every Match and Limited
// Event the player is seated at, as art tiles. Capped at ONE row — two tiles
// on a phone, four from `md` — with a "Show all (N)" toggle; the cap is CSS,
// so it follows the viewport without measuring it.
import { useState } from "react";
import { LOBBY_BG } from "~/components/ui/ambient-backgrounds";
import type { TableRow } from "~/lib/lobbyHome";
import { cn } from "~/lib/utils";
import HomeArtCard from "./home-art-card";

/** Tiles in one row: the grid's column count below / from `md`. */
const ROW = { base: 2, md: 4 } as const;

interface YourTablesSectionProps {
    rows: readonly TableRow[];
    onOpen: (row: TableRow) => void;
}

export default function YourTablesSection({
    rows,
    onOpen,
}: YourTablesSectionProps) {
    const [showAll, setShowAll] = useState(false);
    const overflows = rows.length > ROW.base;
    return (
        <section
            data-home-section="tables"
            aria-labelledby="home-tables-heading"
            className="flex flex-col gap-2"
        >
            <div className="flex items-center justify-between">
                <h2
                    id="home-tables-heading"
                    className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted"
                >
                    Your Tables · {rows.length}
                </h2>
                {overflows && (
                    <button
                        type="button"
                        aria-expanded={showAll}
                        onClick={() => setShowAll(!showAll)}
                        className={cn(
                            "text-xs text-text-muted underline hover:text-parchment",
                            // From `md` a row holds four: with four or fewer
                            // there is nothing hidden to show.
                            rows.length <= ROW.md && "md:hidden"
                        )}
                    >
                        {showAll ? "Show less" : `Show all (${rows.length})`}
                    </button>
                )}
            </div>
            {rows.length === 0 ? (
                <p className="text-xs text-text-disabled">
                    You're not seated anywhere.
                </p>
            ) : (
                <div
                    data-tables-capped={!showAll}
                    className={cn(
                        "grid grid-cols-2 gap-3 md:grid-cols-4",
                        !showAll &&
                            "[&>*:nth-child(n+3)]:hidden md:[&>*:nth-child(n+3):nth-child(-n+4)]:flex"
                    )}
                >
                    {rows.map((row, i) => (
                        <HomeArtCard
                            key={row.key}
                            art={{ image: LOBBY_BG[(i + 2) % LOBBY_BG.length] }}
                            chip={row.phase}
                            title={row.title}
                            titleClass="text-base"
                            line={row.line}
                            onClick={() => onOpen(row)}
                            className="h-36"
                            seam={{ "data-home-table": row.kind }}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
