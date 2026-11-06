// One row of the Limited Deck Archive's origin list: the origin's derived
// label and its deck count. `origin: null` is the unclassified group (a
// Limited deck with no Limited Origin). Presentational — selection lives in
// `LimitedDeckArchivePanel`.
import { originGroupLabel } from "@/lib/limitedArchiveLabels";

export default function LimitedArchiveOriginRow({
    origin,
    deckCount,
    selected,
    onSelect,
}: {
    origin: string | null;
    deckCount: number;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex w-full items-baseline justify-between gap-2 rounded-sm border px-3 py-2 text-left transition-colors ${
                selected
                    ? "border-border-accent bg-surface-elevated/60"
                    : "border-border-subtle hover:border-border-accent/60"
            }`}
        >
            <span className="font-semibold text-text">
                {originGroupLabel(origin)}
            </span>
            <span className="text-xs text-text-muted">{deckCount}</span>
        </button>
    );
}
