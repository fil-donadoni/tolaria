import CardPreviewFace from "./card-preview-face";
import type { PreviewBodyContent } from "~/lib/preview-body";

// Composes the card-preview content shown by all three surfaces (desktop
// anchored dock, hold-zoom dock, mobile overlay). Normally one face; for a copy
// permanent (CR 707.2) it renders TWO faces side by side — the CURRENT
// (presented) identity and the ORIGINAL (printed) identity — each with a small
// label, mirroring Arena's copy treatment. A spell copy on the stack (CR
// 707.10 — Fork, storm) has no distinct printed identity, so it gets a `Copy`
// badge on the single face instead of a second face.
export type CardPreviewBodyProps = PreviewBodyContent & {
    size: "sm" | "md";
    onImageLoaded?: () => void;
    imageLoaded?: boolean;
    /** Printed original identity of a copy permanent (from `copiedFrom`). When
     *  present the preview renders two labeled faces (Current + Original). */
    originalBody?: PreviewBodyContent | null;
    /** Render a `Copy` badge on the single face (spell copy on the stack). */
    showCopyBadge?: boolean;
};

const LABEL_CLASS =
    "px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted";

export default function CardPreviewBody({
    size,
    onImageLoaded,
    imageLoaded,
    originalBody,
    showCopyBadge,
    ...content
}: CardPreviewBodyProps) {
    if (originalBody) {
        return (
            <div className="flex w-full items-stretch">
                <div className="flex flex-1 min-w-0 flex-col border-r border-border-subtle">
                    <div className={LABEL_CLASS}>Current</div>
                    <CardPreviewFace
                        {...content}
                        size={size}
                        onImageLoaded={onImageLoaded}
                        imageLoaded={imageLoaded}
                    />
                </div>
                <div className="flex flex-1 min-w-0 flex-col">
                    <div className={LABEL_CLASS}>Original</div>
                    <CardPreviewFace {...originalBody} size={size} />
                </div>
            </div>
        );
    }

    return (
        <>
            {showCopyBadge && (
                <div className="px-3 pt-2">
                    <span className="inline-block rounded-sm bg-accent-strong/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
                        Copy
                    </span>
                </div>
            )}
            <CardPreviewFace
                {...content}
                size={size}
                onImageLoaded={onImageLoaded}
                imageLoaded={imageLoaded}
            />
        </>
    );
}
