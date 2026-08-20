import { X } from "lucide-react";
import type { FilterTag } from "./filterTags";

export interface AppliedFilterTagsProps {
    tags: FilterTag[];
    onRemove: (tag: FilterTag) => void;
    onClearAll: () => void;
}

/**
 * The applied-filters TAG ROW (issue #2585, PRD #2405 slice 6).
 *
 * With the filter controls behind a sheet/popover, this row is the only thing
 * on screen that still says WHAT is being filtered — so it renders at every
 * viewport, never folded and never behind a disclosure. It renders NOTHING when
 * no filter is active, which is what hands the deck pane back the whole band's
 * height on tablet and desktop (`scripts/ui-gate/budgets.json` §deck-builder:
 * "the height has to come from the header leaving the band").
 *
 * The chips are a VIEW of the URL-backed filter set (`useFilterSearchParams`),
 * not a second copy of it: `describeActiveFilters` derives them and each chip's
 * × applies that tag's own `remove` through the existing writers.
 */
export default function AppliedFilterTags({
    tags,
    onRemove,
    onClearAll,
}: AppliedFilterTagsProps) {
    if (tags.length === 0) return null;
    return (
        <div
            data-applied-filters=""
            className="flex basis-full flex-wrap items-center gap-1.5"
        >
            <span className="text-label text-text-muted">Filters</span>
            {tags.map((tag) => (
                <span
                    key={tag.id}
                    data-filter-tag={tag.id}
                    className="flex items-center gap-1 rounded-full border border-border-subtle/60 bg-surface-elevated/40 py-0.5 pl-2.5 pr-0.5 text-xs text-parchment"
                >
                    {tag.label}
                    <button
                        type="button"
                        aria-label={tag.removeLabel}
                        onClick={() => onRemove(tag)}
                        style={{
                            minHeight: "var(--control-h-sm)",
                            minWidth: "var(--control-h-sm)",
                        }}
                        className="flex items-center justify-center rounded-full text-text-muted transition hover:text-parchment"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}
            <button
                type="button"
                onClick={onClearAll}
                style={{ minHeight: "var(--control-h-sm)" }}
                className="rounded-sm px-2 text-xs text-text-muted underline-offset-2 transition hover:text-parchment hover:underline"
            >
                Clear all
            </button>
        </div>
    );
}
