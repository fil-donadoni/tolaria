import { Layers } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { CatalogueCount } from "./card-profiles-model";
import CardProfilesColourBar from "./card-profiles-colour-bar";
import CardProfilesInfoTip from "./card-profiles-info-tip";

interface CardProfilesCatalogueRowProps {
    entry: CatalogueCount;
    active: boolean;
    onToggle: () => void;
    onEdit: () => void;
    /** Opens the sweep board on this row (issue #8905). */
    onSweep: () => void;
}

/** One catalogue row of the rail: a filter toggle (id, `tagged · proposed?`
 *  counts, the computed colour bar) beside its Edit button. */
export default function CardProfilesCatalogueRow({
    entry,
    active,
    onToggle,
    onEdit,
    onSweep,
}: CardProfilesCatalogueRowProps) {
    const { row, tagged, proposed, signature } = entry;
    return (
        <div
            className={`flex items-start gap-1 rounded-sm border px-2 py-1.5 text-xs ${
                active
                    ? "border-accent text-parchment"
                    : "border-border-subtle/30 text-text"
            }`}
        >
            <button
                type="button"
                aria-pressed={active}
                title={row.description}
                onClick={onToggle}
                className="flex min-w-0 flex-1 flex-col gap-1 text-left"
            >
                <span className="flex items-baseline justify-between gap-2">
                    <span>{row.id}</span>
                    <span className="text-text-muted">
                        {tagged} · {proposed}?
                    </span>
                </span>
                <CardProfilesColourBar signature={signature} />
            </button>
            <CardProfilesInfoTip label={`About ${row.id} counts`}>
                {`${tagged} cards a human reviewed as ${row.id}; ${proposed}? cards the census proposed it for and nobody reviewed yet. ${row.gloss.when}`}
            </CardProfilesInfoTip>
            <button
                type="button"
                aria-label={`Edit ${row.id}`}
                onClick={onEdit}
                className="text-text-muted hover:text-text"
            >
                Edit
            </button>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Sweep ${row.id}`}
                title={`Sweep ${row.id}`}
                onClick={onSweep}
            >
                <Layers aria-hidden="true" />
            </Button>
        </div>
    );
}
