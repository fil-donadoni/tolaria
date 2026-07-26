import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import ActionButton from "~/components/board/action-button";
import { copyText } from "~/lib/clipboard";

/** Link-copy button for a Limited Event (issue #1245, PRD #1241 stories
 *  15-16): mirrors the single-match share pattern (`WaitingForOpponent`'s
 *  `copyText` + toggled-label affordance) — copies
 *  `${origin}/limited/${eventId}` so whoever opens the link lands directly on
 *  this event.
 *
 *  The label follows what the link can actually DO. While the event is `open`
 *  it is an INVITE: the recipient can still claim a free Seat. Once the event
 *  has started `joinLimitedEvent` rejects every newcomer and there is no
 *  spectator mode, so the link is only a way back to the event for people
 *  already seated — calling that an "invite" promises something the server
 *  refuses. The button stays available for the whole lifetime (issue #1578:
 *  a started event's direct link must remain recoverable in-app), it just
 *  stops advertising itself as an invitation. */
export default function LimitedShareInviteButton({
    eventId,
    canInvite,
}: {
    eventId: Id<"limitedEvents">;
    /** True while the event is still `open` — i.e. the link can bring in a
     *  new player. False once started: the link only navigates. */
    canInvite: boolean;
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
            label={
                copied
                    ? "Link copied!"
                    : canInvite
                      ? "Share invite link"
                      : "Copy event link"
            }
            tone="secondary"
        />
    );
}
