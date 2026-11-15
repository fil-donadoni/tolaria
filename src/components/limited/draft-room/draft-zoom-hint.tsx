import { Keycap } from "~/components/ui/keycap";
import { HOTKEYS } from "~/lib/hotkeys";

/** One-time hint (issue #9166): hover reads a card, ⌘/Ctrl + scroll resizes
 *  the pack. Visibility lives in `useDraftZoomHint`. */
export default function DraftZoomHint({
    onDismiss,
}: {
    onDismiss: () => void;
}) {
    return (
        <div
            data-slot="draft-zoom-hint"
            role="status"
            className="fixed bottom-6 left-1/2 z-[950] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border-accent/60 bg-surface-elevated px-5 py-2.5 text-sm text-text shadow-2xl"
        >
            <span>
                <strong>Hover</strong> a card to read it ·{" "}
                <Keycap
                    hotkey={HOTKEYS.draftResizePack}
                    className="align-middle"
                />
                <span className="sr-only">Command or Control + scroll</span> to
                resize the whole pack
            </span>
            <button
                type="button"
                aria-label="Dismiss hint"
                onClick={onDismiss}
                className="text-text-muted hover:text-parchment"
            >
                ✕
            </button>
        </div>
    );
}
