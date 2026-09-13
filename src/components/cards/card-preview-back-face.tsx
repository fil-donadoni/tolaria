import { useState } from "react";
import { ART_CROP_RATIO } from "~/lib/images";
import { formatOracleText } from "~/lib/oracle-text";
import OracleParagraph from "./oracle-paragraph";
import type { PreviewBackFaceHalf } from "~/lib/preview-body";

// CR 712.1 / 712.8a (issue #3552) — the back face of a double-faced card that
// is showing its front, as a labelled subordinate section inside the front
// face's text column (so the `split` layout's scroll container carries it, the
// same placement the inset half uses). Always rendered, never behind a toggle:
// the dock and the long-press overlay are transient, and a click there would
// close the surface the player is trying to read. Carries its own art because
// the back of a double-faced printing is a different picture.
export type CardPreviewBackFaceProps = {
    half: PreviewBackFaceHalf;
    size: "sm" | "md";
};

export default function CardPreviewBackFace({
    half,
    size,
}: CardPreviewBackFaceProps) {
    const compact = size === "sm";
    const sectionSize = compact ? "text-xs" : "text-sm";
    const manaSize = compact ? "text-sm" : "text-base";
    // Same `art` WebP → art_crop JPG fallback as `CardPreviewFace`, keyed to
    // the primary URL so a preview that switches cards retries the WebP.
    const [jpgFallbackFor, setJpgFallbackFor] = useState<string | null>(null);

    return (
        <div
            data-card-preview-back-face
            className="border-t border-border-subtle pt-2"
        >
            <div className="border border-border-subtle rounded-md p-2 space-y-1 bg-surface-raised/40">
                <div
                    className={`${sectionSize} font-semibold uppercase tracking-wide text-text-muted`}
                >
                    {half.label}
                </div>
                <div className="flex items-start gap-2">
                    {half.imageSrc && (
                        // Out-of-flow img in a ratio box, for the reason
                        // `CardPreviewFace` documents: an in-flow img would
                        // size the box to the source's own aspect.
                        <div
                            className="relative w-1/3 shrink-0 overflow-hidden rounded-sm"
                            style={{ aspectRatio: ART_CROP_RATIO }}
                        >
                            <img
                                src={
                                    jpgFallbackFor === half.imageSrc
                                        ? (half.imageFallbackSrc ??
                                          half.imageSrc)
                                        : half.imageSrc
                                }
                                className="absolute inset-0 w-full h-full block select-none object-cover"
                                alt={half.name}
                                decoding="async"
                                onError={() => {
                                    if (
                                        jpgFallbackFor !== half.imageSrc &&
                                        half.imageFallbackSrc
                                    )
                                        setJpgFallbackFor(half.imageSrc);
                                }}
                            />
                        </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold truncate">
                                {half.name}
                            </span>
                            {half.manaCost && (
                                <span
                                    className={`shrink-0 ${manaSize} leading-none`}
                                >
                                    {formatOracleText(half.manaCost)}
                                </span>
                            )}
                        </div>
                        <div className="text-text-muted">{half.typeLine}</div>
                        {half.statLine && (
                            <div className="font-semibold">{half.statLine}</div>
                        )}
                    </div>
                </div>
                {half.oracleParagraphs.map((p, i) => (
                    <div key={`back-oracle-${i}`}>
                        <OracleParagraph text={p} milestones={null} />
                    </div>
                ))}
            </div>
        </div>
    );
}
