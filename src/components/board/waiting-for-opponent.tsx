import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import AmbientPageGround from "~/components/ui/ambient-page-ground";
import {
    Panel,
    PanelHeader,
    PanelBody,
    PanelFooter,
} from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { copyText } from "~/lib/clipboard";

type WaitingForOpponentProps = {
    gameId: Id<"games">;
    onLeave: () => void;
};

/** Multiplayer holding screen shown while a created game waits for its second
 *  player (`game.status === "waiting"`). Shares the general page layout
 *  (ambient ground + opaque signal Panel, PRD #589). "Share" copies a deep-link
 *  invite (`/?join=<gameId>`) — a friend who opens it is auto-credited into
 *  this game from the lobby once they pick a deck. */
export default function WaitingForOpponent({
    gameId,
    onLeave,
}: WaitingForOpponentProps) {
    const [copied, setCopied] = useState(false);

    function handleShare() {
        const link = `${window.location.origin}/?join=${gameId}`;
        void copyText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <div className="relative flex h-dvh flex-col items-center justify-center overflow-hidden bg-surface-base text-text">
            <AmbientPageGround ring />
            <Panel className="relative z-10 w-full max-w-sm">
                <PanelHeader title="Waiting for opponent" />
                <PanelBody className="items-center text-center">
                    <p className="text-sm text-text-muted">
                        Share this game ID so a friend can join.
                    </p>
                    <p className="font-mono text-sm text-text-muted">
                        Game ID: {gameId}
                    </p>
                </PanelBody>
                <PanelFooter className="justify-center">
                    <Button variant="secondary" onClick={onLeave}>
                        Leave
                    </Button>
                    <Button onClick={handleShare}>
                        {copied ? "Link copied!" : "Share invite link"}
                    </Button>
                </PanelFooter>
            </Panel>
        </div>
    );
}
