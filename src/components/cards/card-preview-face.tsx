import { useState } from "react";
import { ART_CROP_RATIO } from "~/lib/images";
import { formatOracleText } from "~/lib/oracle-text";
import CardImageLoader from "./card-image-loader";
import TokenPlaceholder from "./token-placeholder";
import CardPreviewAbilities from "./card-preview-abilities";
import CardPreviewCounters from "./card-preview-counters";
import CardPreviewNotedMana from "./card-preview-noted-mana";
import OracleParagraph from "./oracle-paragraph";
import type { PreviewBodyContent } from "~/lib/preview-body";

// One card-preview FACE: the art crop + rules text for a single identity.
// `CardPreviewBody` renders one of these normally, or two side by side
// (current + original) for a copy permanent (CR 707.2). `size` scales the text
// chrome ("sm" = compact desktop dock, "md" = larger mobile overlay).
export type CardPreviewFaceProps = PreviewBodyContent & {
    size: "sm" | "md";
    onImageLoaded?: () => void;
    imageLoaded?: boolean;
    /** How the face arranges its two halves inside the host's flex container.
     *
     *  `"stacked"` (default, every board/lobby surface — unchanged) is a
     *  COLUMN host: full-width art box on its fixed `ART_CROP_RATIO`, rules
     *  text below.
     *
     *  `"split"` is a ROW host — the Inspect Overlay in landscape (PRD #2405,
     *  issue #2583): the art takes a fixed share of the width at full height
     *  and the text takes the rest and scrolls, so a long oracle text never
     *  crops the art and the art never pushes the text off a 390px-tall
     *  screen. The face stays ONE component across both because everything
     *  between the two halves — oracle paragraphs, P/T, counters, noted mana,
     *  owner — is identical; only the two wrappers' classes differ. */
    layout?: "stacked" | "split";
};

export default function CardPreviewFace({
    cardName,
    displayName,
    imageSrc,
    imageFallbackSrc,
    types,
    subtypes,
    staticAbilities,
    manaCost,
    typeLine,
    oracleParagraphs,
    bodyAbilities,
    hasBody,
    hasPT,
    effPower,
    effToughness,
    basePower,
    baseToughness,
    ptModified,
    counterDisplays,
    notedMana,
    colorName,
    ownerName,
    attachedToName,
    skipNextUntap,
    milestones,
    size,
    onImageLoaded,
    imageLoaded = true,
    layout = "stacked",
}: CardPreviewFaceProps) {
    const split = layout === "split";
    const compact = size === "sm";
    const textPad = compact ? "p-3" : "p-4";
    const textBase = compact ? "text-xs" : "text-sm";
    const nameSize = compact ? "" : "text-base";
    const manaSize = compact ? "text-sm" : "text-base";
    const ptSize = compact ? "text-sm" : "text-base";
    const ptBaseSize = compact ? "text-xs" : "text-sm";
    const sectionSize = compact ? "text-xs" : "text-sm";

    // `art` WebP-first with art_crop-JPG fallback (old printings lack the
    // `art` rendition — see src/lib/images.ts). Keyed to the primary URL (not
    // a boolean) so a face that switches identity re-tries WebP for the new
    // card instead of inheriting the previous card's failure — the same state
    // pattern CardImage uses.
    const [jpgFallbackFor, setJpgFallbackFor] = useState<string | null>(null);

    return (
        <>
            {/* Fixed ART_CROP_RATIO box: the `art` WebP (626×457) and the
                art_crop JPG (563×451) differ slightly in aspect, so the img
                object-covers the box and the layout never shifts on fallback.

                The img is taken OUT OF FLOW (`absolute inset-0`) and the box
                clips — not a detail. Every preview surface (dock, anchored,
                mobile overlay) is a COLUMN FLEX container, so this box is a
                flex item with `min-height: auto`: its automatic minimum size is
                its content's min-content height, which overrides the
                aspect-ratio height. An in-flow img can't resolve `h-full`
                against that indefinite height, falls back to its intrinsic
                aspect, and stretches the box — `object-fit` never gets a say,
                since the element is sized TO the image. Landscape art (nearly
                the whole catalogue) lands close enough to 563/451 that nothing
                shows; a Saga's art_crop is PORTRAIT (Urza's Saga is 312×752)
                and blew the preview into a tall column. Out of flow the
                min-content height is 0, so the ratio is authoritative again and
                `object-cover` centre-crops whatever aspect the source has.
                Same shape as `stack-row.tsx`, which already had it right. */}
            <div
                className={
                    split
                        ? "relative w-[45%] shrink-0 self-stretch overflow-hidden"
                        : "relative w-full overflow-hidden"
                }
                // In `split` the host row's height is authoritative, so the
                // ratio must NOT also constrain the box (it would fight
                // `self-stretch` and reintroduce the overflow this layout
                // exists to remove).
                style={split ? undefined : { aspectRatio: ART_CROP_RATIO }}
            >
                {imageSrc ? (
                    <>
                        <img
                            src={
                                jpgFallbackFor === imageSrc
                                    ? (imageFallbackSrc ?? imageSrc)
                                    : imageSrc
                            }
                            className="absolute inset-0 w-full h-full block select-none object-cover"
                            alt={cardName}
                            decoding="async"
                            style={{
                                WebkitTouchCallout: "none",
                            }}
                            onLoad={onImageLoaded}
                            onError={() => {
                                // `art` WebP missing (old printing) → retry as
                                // art_crop jpg; a second failure ends the loader.
                                if (
                                    jpgFallbackFor !== imageSrc &&
                                    imageFallbackSrc
                                )
                                    setJpgFallbackFor(imageSrc);
                                else onImageLoaded?.();
                            }}
                        />
                        {!imageLoaded && <CardImageLoader />}
                    </>
                ) : (
                    <TokenPlaceholder
                        name={displayName}
                        types={types}
                        subtypes={subtypes}
                        power={effPower ?? basePower}
                        toughness={effToughness ?? baseToughness}
                        staticAbilities={staticAbilities}
                    />
                )}
            </div>
            <div
                className={`${textPad} ${textBase} text-text space-y-2 overflow-y-auto ${
                    split ? "min-h-0 min-w-0 flex-1" : ""
                }`}
            >
                <div className="flex items-baseline justify-between gap-2">
                    <span className={`font-semibold ${nameSize} truncate`}>
                        {displayName}
                    </span>
                    {manaCost && (
                        <span className={`shrink-0 ${manaSize} leading-none`}>
                            {formatOracleText(manaCost)}
                        </span>
                    )}
                </div>
                <div className="text-text-muted">{typeLine}</div>
                {oracleParagraphs && (
                    <div className="border-t border-border-subtle pt-2 space-y-1.5 text-text">
                        {oracleParagraphs.map((p, i) => (
                            <div key={`oracle-${i}`}>
                                <OracleParagraph
                                    text={p}
                                    milestones={milestones}
                                />
                            </div>
                        ))}
                    </div>
                )}
                {hasBody && <CardPreviewAbilities abilities={bodyAbilities} />}
                {hasPT && (
                    <div
                        className={`text-right font-semibold ${ptSize} border-t border-border-subtle pt-2 flex justify-end items-baseline gap-2`}
                    >
                        <span
                            className={
                                ptModified ? "text-success-strong" : "text-text"
                            }
                        >
                            {effPower ?? 0}/{effToughness ?? 0}
                        </span>
                        {ptModified && (
                            <span
                                className={`text-danger-strong ${ptBaseSize} font-normal`}
                            >
                                ({basePower}/{baseToughness})
                            </span>
                        )}
                    </div>
                )}
                <CardPreviewCounters counters={counterDisplays} />
                <CardPreviewNotedMana noted={notedMana} />
                {colorName && (
                    <div
                        className={`border-t border-border-subtle pt-2 ${sectionSize} font-semibold text-accent-strong`}
                    >
                        Color: {colorName}
                    </div>
                )}
                {attachedToName && (
                    <div
                        className={`border-t border-border-subtle pt-2 ${sectionSize} font-semibold text-accent-strong`}
                    >
                        Attached to: {attachedToName}
                    </div>
                )}
                {skipNextUntap && (
                    <div
                        className={`border-t border-border-subtle pt-2 ${sectionSize} font-semibold text-danger-strong`}
                    >
                        Doesn't untap during its controller's next untap step.
                    </div>
                )}
                {ownerName && (
                    <div
                        className={`text-text-muted border-t border-border-subtle pt-2 ${sectionSize} italic`}
                    >
                        Owner: {ownerName}
                    </div>
                )}
            </div>
        </>
    );
}
