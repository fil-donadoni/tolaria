import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationError } from "~/lib/mutation-error";
import { copyMinified } from "~/lib/clipboard";

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
        <div className="fixed left-1/2 bottom-24 -translate-x-1/2 z-100">
            <div className="relative bg-surface border border-danger/45 rounded-sm px-4 py-2 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex items-center gap-3">
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-danger/45" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-danger/45" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-danger/45" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-danger/45" />
                <p className="font-beleren text-danger-strong text-sm tracking-wide px-2">
                    {error.title}
                </p>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="font-beleren text-danger-strong text-xs tracking-wide border border-danger/45 rounded-sm px-2 py-0.5 hover:bg-danger/20 transition-colors"
                >
                    {copied ? "Copied!" : "Copy"}
                </button>
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="Dismiss error"
                    className="font-beleren text-danger-strong text-sm leading-none px-1 hover:text-danger transition-colors"
                >
                    ×
                </button>
            </div>
        </div>
    );
}
