import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationError } from "~/lib/mutation-error";
import { copyMinified } from "~/lib/clipboard";
import { Banner } from "~/components/ui/banner";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";

type ErrorToastProps = {
    /** The Convex error to surface, or `null` to hide the toast. */
    error: MutationError | null;
    /** Game whose full state is bundled with the copied error payload. */
    gameId: Id<"games">;
    onDismiss: () => void;
};

/** Danger toast for Convex errors. Shows the short error title and a button
 *  that copies the full error content together with the current game state,
 *  minified, to the clipboard. The full state is fetched lazily — only while
 *  an error is showing. Errors persist until dismissed (no auto-hide) so the
 *  copy action is always reachable. */
export default function ErrorToast({
    error,
    gameId,
    onDismiss,
}: ErrorToastProps) {
    const [copied, setCopied] = useState(false);

    const state = useQuery(api.game.getFullState, error ? { gameId } : "skip");

    if (!error) return null;

    function handleCopy() {
        copyMinified({ error: error?.detail, state });
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        // Mobile (#1819): capped to `w-[calc(100vw-2rem)] max-w-sm` so the
        // toast always keeps a 1rem margin from both screen edges on a
        // narrow phone (390px) instead of the old unbounded-content width,
        // which could run edge-to-edge (or past it) with a long error
        // title. Anchored via {@link ABOVE_CONTROLLER_BAR} — the SAME
        // measured-seam pattern `bug-report-button.tsx` uses — so it clears
        // the portrait bottom bar whatever height it currently measures
        // (a wrapped, two-line DECLARE_ATTACKERS bar is taller than the old
        // hardcoded `bottom-24`/96px this replaces). `md:bottom-24` keeps
        // the EXACT prior desktop/landscape inset, where no bar is mounted
        // and the CSS var falls back to its unrelated default.
        <div
            className={`fixed left-1/2 -translate-x-1/2 z-modal w-[calc(100vw-2rem)] max-w-sm ${ABOVE_CONTROLLER_BAR} md:bottom-24`}
        >
            <Banner
                tone="danger"
                role="alert"
                className="gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2"
            >
                <span className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <p className="min-w-0 flex-1 truncate font-beleren text-xs tracking-wide px-1 sm:px-2 sm:text-sm">
                        {error.title}
                    </p>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="shrink-0 font-beleren text-xs tracking-wide border border-danger/45 rounded-sm px-1.5 py-0.5 hover:bg-danger/20 transition-colors sm:px-2"
                    >
                        {copied ? "Copied!" : "Copy"}
                    </button>
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss error"
                        className="shrink-0 font-beleren text-sm leading-none px-1 hover:text-parchment transition-colors"
                    >
                        ×
                    </button>
                </span>
            </Banner>
        </div>
    );
}
