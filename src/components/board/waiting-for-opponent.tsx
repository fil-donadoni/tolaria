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
 *  (ambient ground + opaque signal Panel, PRD #589). "Share" copies an invite
 *  link (`/join/<gameId>`) — a friend who opens it lands on the join
 *  antechamber, picks a deck, and is credited into this game. */
export default function WaitingForOpponent({
    gameId,
    onLeave,
}: WaitingForOpponentProps) {
    const [copied, setCopied] = useState(false);

    function handleShare() {
        const link = `${window.location.origin}/join/${gameId}`;
        void copyText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        // `h-dvh` is legitimate here — this is a `/game` surface, where the
        // shell shows no header band and `<main>` IS the viewport (allowlisted
        // in `shell-height-claims.guard.test.tsx`). What is NOT legitimate is
        // hiding this root's overflow: it is a flex child of `<main>`, so a
        // Panel taller than the viewport would be CLIPPED with no scrollbar
        // anywhere to reach it (issue #2274, the lobby's shape). The ambient
        // ring is clipped by `AmbientPageGround`'s own `absolute inset-0
        // overflow-hidden`, so nothing here needs the class.
        <div className="relative flex h-dvh flex-col items-center justify-center bg-surface-base text-text">
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
