import { useState } from "react";
import CardPreviewFace from "./card-preview-face";
import type { PreviewBodyContent } from "~/lib/preview-body";

// Composes the card-preview content shown by all three surfaces (desktop
// anchored dock, hover/hold dock, mobile overlay). Normally one face; for a copy
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

/** Phase-2 toggle (winner B): the computed live-text face is the default
 *  (modern oracle, granted/lost abilities, effective P/T); the "printed card"
 *  surface shows the original printing as-is. Hidden when the card has no
 *  printed identity (tokens). */
function PrintedToggle({
    mode,
    onChange,
}: {
    mode: "computed" | "printed";
    onChange: (mode: "computed" | "printed") => void;
}) {
    return (
        <div className="mx-3 mt-2 flex justify-center gap-1 rounded-sm bg-surface-elevated/60 p-0.5">
            {(["computed", "printed"] as const).map((m) => (
                <button
                    key={m}
                    type="button"
                    data-preview-mode={m}
                    onClick={() => onChange(m)}
                    className={`rounded-sm px-2 py-0.5 text-[10px] ${
                        mode === m
                            ? "bg-accent-soft/50 text-parchment"
                            : "text-text-muted hover:text-parchment"
                    }`}
                >
                    {m === "computed" ? "Live text" : "Printed card"}
                </button>
            ))}
        </div>
    );
}

export default function CardPreviewBody({
    size,
    onImageLoaded,
    imageLoaded,
    originalBody,
    showCopyBadge,
    ...content
}: CardPreviewBodyProps) {
    const [toggledMode, setToggledMode] = useState<"computed" | "printed">(
        "computed"
    );
    // Manual Game (issue #2346): every computed field is genuinely empty for
    // a manual card (ADR 0080 — no hydrated CardDefinition, no oracle text,
    // no granted abilities, no effective P/T), so the live-text face is never
    // worth showing. Force the printed card image and hide the toggle instead
    // of letting the player land on the useless default. `content.isManualGame`
    // is the explicit discriminator forwarded through the shared game context
    // (`~/lib/manual-game-context`) — never a sniff on a missing definition,
    // which would also hide a GRE card whose definition genuinely failed to
    // resolve (a real bug that must stay visible).
    const isManualGame = !!content.isManualGame;
    const mode = isManualGame ? "printed" : toggledMode;
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

    if (mode === "printed" && content.printedImageSrc) {
        return (
            <div className="flex w-full flex-col">
                {!isManualGame && (
                    <PrintedToggle mode={mode} onChange={setToggledMode} />
                )}
                <img
                    src={content.printedImageSrc}
                    alt={
                        isManualGame
                            ? content.displayName
                            : `${content.displayName} (printed)`
                    }
                    className="w-full rounded-2xl"
                    onLoad={onImageLoaded}
                />
            </div>
        );
    }

    return (
        <>
            {content.printedImageSrc && !isManualGame && (
                <PrintedToggle mode={mode} onChange={setToggledMode} />
            )}
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
