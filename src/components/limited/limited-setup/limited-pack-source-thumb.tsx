// One thumbnail of the Pack Source strip (PRD #5383): the source's Feature
// Card art and name; a source the event type cannot use is disabled with its
// reason.
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";
import { cn } from "~/lib/utils";

export default function LimitedPackSourceThumb({
    source,
    selected,
    disabledReason,
    onSelect,
}: {
    source: PackSourceInfo;
    selected: boolean;
    /** Why the source cannot be chosen; `null` when it can. */
    disabledReason: string | null;
    onSelect: () => void;
}) {
    const imageId =
        source.featureCardId !== null
            ? resolveCardImageId(source.featureCardId)
            : null;
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabledReason !== null}
            data-pack-source-thumb={source.key}
            onClick={onSelect}
            className={cn(
                "flex min-h-[var(--control-h)] w-28 shrink-0 flex-col overflow-hidden rounded-sm border text-left transition",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                    ? "border-accent"
                    : "border-border-strong hover:border-accent/60"
            )}
        >
            {imageId ? (
                <img
                    src={getArtCropImageUrl(imageId)}
                    alt=""
                    loading="lazy"
                    className="h-14 w-full object-cover"
                />
            ) : (
                <span aria-hidden="true" className="h-14 w-full bg-surface" />
            )}
            <span className="truncate px-1.5 pt-1 text-xs text-parchment">
                {source.name}
            </span>
            <span className="truncate px-1.5 pb-1 text-[11px] text-text-muted">
                {disabledReason ?? " "}
            </span>
        </button>
    );
}
