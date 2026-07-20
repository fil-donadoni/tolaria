import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationError } from "~/lib/mutation-error";
import { copyMinified } from "~/lib/clipboard";
import { Banner } from "~/components/ui/banner";

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
        <div className="fixed left-1/2 bottom-24 -translate-x-1/2 z-modal">
            <Banner tone="danger" role="alert">
                <span className="flex items-center gap-3">
                    <p className="font-beleren text-sm tracking-wide px-2">
                        {error.title}
                    </p>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="font-beleren text-xs tracking-wide border border-danger/45 rounded-sm px-2 py-0.5 hover:bg-danger/20 transition-colors"
                    >
                        {copied ? "Copied!" : "Copy"}
                    </button>
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss error"
                        className="font-beleren text-sm leading-none px-1 hover:text-parchment transition-colors"
                    >
                        ×
                    </button>
                </span>
            </Banner>
        </div>
    );
}
