import { useState } from "react";
import CardPreviewFace from "./card-preview-face";
import CardPreviewModeToggle, {
    type CardPreviewMode,
} from "./card-preview-mode-toggle";
import type { PreviewBodyContent } from "~/lib/preview-body";
import { getPreviewPreferenceDefault } from "~/lib/preview-preference-store";

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
    /** The SECOND face's content, when this object has one. Two producers, one
     *  composition (issue #2904): the printed identity of a copy permanent
     *  (`copiedFrom`, CR 707.2), or the real card behind a face-down object for
     *  a viewer entitled to look at it (CR 708.5 / CR 406.3). Null → one face. */
    originalBody?: PreviewBodyContent | null;
    /** Labels over the two faces. Default to the copy treatment's
     *  Current / Original; a face-down object passes its own pair, because
     *  "Current" would claim the anonymous face is this card's live identity
     *  when it is the whole card the viewer is being shown instead of it. */
    primaryFaceLabel?: string;
    secondaryFaceLabel?: string;
    /** Render a `Copy` badge on the single face (spell copy on the stack). */
    showCopyBadge?: boolean;
    /** Forwarded to `CardPreviewFace` — the desktop lateral zoom
     *  (`CardPreviewDock`) renders the Engine View slot compact (issue
     *  #2728); every other host omits it for the full slot. */
    compactEngineView?: boolean;
};

const LABEL_CLASS =
    "px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted";

export default function CardPreviewBody({
    size,
    onImageLoaded,
    imageLoaded,
    originalBody,
    showCopyBadge,
    compactEngineView,
    primaryFaceLabel = "Current",
    secondaryFaceLabel = "Original",
    ...content
}: CardPreviewBodyProps) {
    // Seeded from the user's saved Settings default (issue #2595,
    // `~/lib/preview-preference-store`), NOT a live binding — the lazy
    // `useState` initializer reads it exactly once, at mount. A preview
    // already open when the Settings value changes elsewhere keeps whatever
    // the viewer toggled it to (see `SettingsPreviewSection`'s docblock).
    const [toggledMode, setToggledMode] = useState<CardPreviewMode>(
        getPreviewPreferenceDefault
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
                    <div className={LABEL_CLASS}>{primaryFaceLabel}</div>
                    <CardPreviewFace
                        {...content}
                        size={size}
                        onImageLoaded={onImageLoaded}
                        imageLoaded={imageLoaded}
                        compactEngineView={compactEngineView}
                    />
                </div>
                <div className="flex flex-1 min-w-0 flex-col">
                    <div className={LABEL_CLASS}>{secondaryFaceLabel}</div>
                    <CardPreviewFace
                        {...originalBody}
                        size={size}
                        compactEngineView={compactEngineView}
                    />
                </div>
            </div>
        );
    }

    if (mode === "printed" && content.printedImageSrc) {
        return (
            <div className="flex w-full flex-col">
                {!isManualGame && (
                    <CardPreviewModeToggle
                        mode={mode}
                        onChange={setToggledMode}
                    />
                )}
                <img
                    src={content.printedImageSrc}
                    alt={
                        isManualGame
                            ? content.displayName
                            : `${content.displayName} (printed)`
                    }
                    className="w-full card-corner"
                    onLoad={onImageLoaded}
                />
            </div>
        );
    }

    return (
        <>
            {content.printedImageSrc && !isManualGame && (
                <CardPreviewModeToggle mode={mode} onChange={setToggledMode} />
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
                compactEngineView={compactEngineView}
            />
        </>
    );
}
