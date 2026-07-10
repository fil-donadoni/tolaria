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
};

export default function CardPreviewFace({
    cardName,
    displayName,
    imageSrc,
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
    milestones,
    size,
    onImageLoaded,
    imageLoaded = true,
}: CardPreviewFaceProps) {
    const compact = size === "sm";
    const textPad = compact ? "p-3" : "p-4";
    const textBase = compact ? "text-xs" : "text-sm";
    const nameSize = compact ? "" : "text-base";
    const manaSize = compact ? "text-sm" : "text-base";
    const ptSize = compact ? "text-sm" : "text-base";
    const ptBaseSize = compact ? "text-xs" : "text-sm";
    const sectionSize = compact ? "text-xs" : "text-sm";

    return (
        <>
            <div
                className="relative w-full"
                style={{ aspectRatio: ART_CROP_RATIO }}
            >
                {imageSrc ? (
                    <>
                        <img
                            src={imageSrc}
                            className="w-full h-full block select-none"
                            alt={cardName}
                            style={{
                                objectFit: "cover",
                                WebkitTouchCallout: "none",
                            }}
                            onLoad={onImageLoaded}
                            onError={onImageLoaded}
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
                className={`${textPad} ${textBase} text-text space-y-2 overflow-y-auto`}
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
                                ptModified ? "text-emerald-400" : "text-text"
                            }
                        >
                            {effPower ?? 0}/{effToughness ?? 0}
                        </span>
                        {ptModified && (
                            <span
                                className={`text-red-400 ${ptBaseSize} font-normal`}
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
