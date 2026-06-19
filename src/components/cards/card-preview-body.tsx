import { ART_CROP_RATIO } from "~/lib/images";
import { formatOracleText } from "~/lib/oracle-text";
import CardImageLoader from "./card-image-loader";
import TokenPlaceholder from "./token-placeholder";
import CardPreviewAbilities from "./card-preview-abilities";
import CardPreviewCounters from "./card-preview-counters";
import type { DisplayAbilities } from "~/lib/card-utils";
import type { CounterDisplay } from "~/lib/counters";

// Shared visual body for both card preview surfaces: the desktop center-left
// fixed dock and the mobile centered long-press overlay (ADR 0009). Both show
// the same art + rules content; only the framing/positioning differs, so the
// content lives here once and each surface wraps it. `size` scales the text
// chrome ("sm" = compact desktop dock, "md" = larger mobile overlay).
export type CardPreviewBodyProps = {
    cardName: string;
    displayName: string;
    imageSrc: string | null;
    types: string[];
    subtypes: string[];
    staticAbilities: string[];
    manaCost: string | null;
    typeLine: string;
    oracleParagraphs: string[] | null;
    bodyAbilities: DisplayAbilities;
    hasBody: boolean;
    hasPT: boolean;
    effPower?: number;
    effToughness?: number;
    basePower?: number;
    baseToughness?: number;
    ptModified: boolean;
    counterDisplays: CounterDisplay[];
    colorName: string | null;
    ownerName: string | null;
    size: "sm" | "md";
    onImageLoaded?: () => void;
    imageLoaded?: boolean;
};

export default function CardPreviewBody({
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
    colorName,
    ownerName,
    size,
    onImageLoaded,
    imageLoaded = true,
}: CardPreviewBodyProps) {
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
                className={`${textPad} ${textBase} text-white space-y-2 overflow-y-auto`}
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
                <div className="text-zinc-300">{typeLine}</div>
                {oracleParagraphs && (
                    <div className="border-t border-zinc-700 pt-2 space-y-1.5 text-zinc-100">
                        {oracleParagraphs.map((p, i) => (
                            <div key={`oracle-${i}`}>{formatOracleText(p)}</div>
                        ))}
                    </div>
                )}
                {hasBody && <CardPreviewAbilities abilities={bodyAbilities} />}
                {hasPT && (
                    <div
                        className={`text-right font-semibold ${ptSize} border-t border-zinc-700 pt-2 flex justify-end items-baseline gap-2`}
                    >
                        <span
                            className={
                                ptModified ? "text-emerald-400" : "text-white"
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
                {colorName && (
                    <div
                        className={`border-t border-zinc-700 pt-2 ${sectionSize} font-semibold text-[var(--color-accent-strong)]`}
                    >
                        Color: {colorName}
                    </div>
                )}
                {ownerName && (
                    <div
                        className={`text-zinc-400 border-t pt-2 ${sectionSize} italic`}
                    >
                        Owner: {ownerName}
                    </div>
                )}
            </div>
        </>
    );
}
