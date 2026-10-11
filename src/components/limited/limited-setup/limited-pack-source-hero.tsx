// The Pack Source showcase's hero (PRD #5383, prototype setup variant B): the
// selected source as a large Feature Card art, its one-line description and
// implemented share, with previous/next controls (top corners on phones).
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";
import { implementedShare } from "~/lib/limited/limitedSetup";
import { Button } from "~/components/ui/button";

function shareLabel(source: PackSourceInfo): string {
    const share = implementedShare(source);
    if (share !== null) return `${Math.round(share * 100)}% implemented`;
    const cube = source.sets.find((s) => s.isCube === true);
    const count = cube?.availableCardCount ?? 0;
    return `${count} card${count === 1 ? "" : "s"} available`;
}

export default function LimitedPackSourceHero({
    source,
    onPrevious,
    onNext,
}: {
    source: PackSourceInfo;
    onPrevious: () => void;
    onNext: () => void;
}) {
    const imageId =
        source.featureCardId !== null
            ? resolveCardImageId(source.featureCardId)
            : null;
    return (
        <figure
            data-pack-source-hero={source.key}
            className="relative m-0 flex min-h-56 flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface-elevated"
        >
            {imageId && (
                <img
                    src={getArtCropImageUrl(imageId)}
                    alt=""
                    data-card-face="art"
                    className="absolute inset-0 h-full w-full object-cover"
                />
            )}
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-surface-base via-surface-base/60 to-transparent"
            />
            <Button
                variant="ghost"
                size="sm"
                aria-label="Previous Pack Source"
                onClick={onPrevious}
                className="absolute top-2 left-2 z-10 md:top-1/2 md:-translate-y-1/2"
            >
                <ChevronLeft />
            </Button>
            <Button
                variant="ghost"
                size="sm"
                aria-label="Next Pack Source"
                onClick={onNext}
                className="absolute top-2 right-2 z-10 md:top-1/2 md:-translate-y-1/2"
            >
                <ChevronRight />
            </Button>
            <figcaption className="relative flex flex-col gap-1 px-4 py-3">
                <span className="heading-panel text-xl">{source.name}</span>
                <span className="text-sm text-parchment">
                    {source.description}
                </span>
                <span className="text-xs text-text-muted">
                    {shareLabel(source)}
                </span>
            </figcaption>
        </figure>
    );
}
