// Stat chip pair (Zelda TotK): `from ▸ to` in two boxed cells (issue #595).
// Generic — life totals, deck counts, before/after values. When `to` is
// omitted it renders a single chip. Material lives in `.stat-chip` (index.css).

export default function StatChip({
    from,
    to,
}: {
    from: string | number;
    to?: string | number;
}) {
    return (
        <span
            data-slot="stat-chip"
            className="inline-flex items-center gap-1.5"
        >
            <span className="stat-chip flex h-7 min-w-7 items-center justify-center rounded px-2 font-beleren text-sm">
                {from}
            </span>
            {to !== undefined && (
                <>
                    <span className="text-accent">▸</span>
                    <span className="stat-chip flex h-7 min-w-7 items-center justify-center rounded px-2 font-beleren text-sm">
                        {to}
                    </span>
                </>
            )}
        </span>
    );
}
