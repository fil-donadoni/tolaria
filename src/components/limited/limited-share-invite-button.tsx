import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import ActionButton from "~/components/board/action-button";
import { copyText } from "~/lib/clipboard";

/** "Share invite link" button for the Limited waiting room (issue #1245,
 *  PRD #1241 stories 15-16): mirrors the single-match share pattern
 *  (`WaitingForOpponent`'s `copyText` + toggled-label affordance) — copies
 *  `${origin}/limited/${eventId}` so an invited player who opens the link
 *  lands directly on this event. */
export default function LimitedShareInviteButton({
    eventId,
}: {
    eventId: Id<"limitedEvents">;
}) {
    const [copied, setCopied] = useState(false);

    function handleShare() {
        const link = `${window.location.origin}/limited/${eventId}`;
        void copyText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <ActionButton
            onClick={handleShare}
            label={copied ? "Link copied!" : "Share invite link"}
            tone="secondary"
        />
    );
}
