// PROTOTYPE — throwaway. Waiting: the invite link with a copy button.
import { Copy } from "lucide-react";
import { EVENT_META } from "./event-mock";
import TileFrame from "./tile-frame";

export default function InviteTile({
    onCopy,
    className,
}: {
    onCopy: () => void;
    className?: string;
}) {
    return (
        <TileFrame title="Invite" className={className}>
            <p className="text-xs text-text-muted">
                Anyone with the link can take an open seat until you start.
            </p>
            <div className="flex items-center gap-2 rounded-sm border border-border-strong bg-surface-base/60 py-1 pl-2.5 pr-1">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-parchment">
                    {EVENT_META.inviteUrl}
                </span>
                <button
                    type="button"
                    onClick={onCopy}
                    className="btn-base btn-tone-secondary inline-flex min-h-8 items-center gap-1 px-2.5 text-xs"
                >
                    <Copy className="size-3.5" /> Copy
                </button>
            </div>
        </TileFrame>
    );
}
