import { formatOracleText } from "~/lib/oracle-text";
import OracleParagraph from "./oracle-paragraph";
import type { PreviewInsetHalf, PreviewSplitHalf } from "~/lib/preview-body";

// One labelled half of a two-part card, inside the face's text column so the
// `split` layout's scroll container carries it: the inset half of an
// Adventure / Omen frame (CR 715.2 / 722.2) or a split card's half (CR 709,
// issue #5490). Its own name, cost, type line and text, visually subordinate to
// the face's header; the label is what stops it reading as a live
// characteristic of the half the face is actually about. No art: both kinds
// share one illustration with the face, which already renders it.
export type CardPreviewHalfSectionProps = {
    half: PreviewInsetHalf | PreviewSplitHalf;
    size: "sm" | "md";
};

export default function CardPreviewHalfSection({
    half,
    size,
}: CardPreviewHalfSectionProps) {
    const compact = size === "sm";
    const sectionSize = compact ? "text-xs" : "text-sm";
    const manaSize = compact ? "text-sm" : "text-base";

    return (
        <div
            data-card-preview-half={half.label}
            className="border-t border-border-subtle pt-2"
        >
            <div className="border border-border-subtle rounded-md p-2 space-y-1 bg-surface-raised/40">
                <div
                    className={`${sectionSize} font-semibold uppercase tracking-wide text-text-muted`}
                >
                    {half.label}
                </div>
                <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold truncate">{half.name}</span>
                    {half.manaCost && (
                        <span className={`shrink-0 ${manaSize} leading-none`}>
                            {formatOracleText(half.manaCost)}
                        </span>
                    )}
                </div>
                <div className="text-text-muted">{half.typeLine}</div>
                {half.oracleParagraphs.map((p, i) => (
                    <div key={`half-oracle-${i}`}>
                        <OracleParagraph text={p} counters={null} />
                    </div>
                ))}
            </div>
        </div>
    );
}
