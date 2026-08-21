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
import EmptyState from "~/components/ui/empty-state";
import { copyText } from "~/lib/clipboard";
import { formatJoinCode } from "@convex/joinCodes";

type WaitingForOpponentProps = {
    gameId: Id<"games">;
    /** The table's short join code (issue #2649), when it has one. Present
     *  only on a public Arena table and only while it is still `waiting` —
     *  `joinWaitingGame` clears it as the second seat is filled, so this
     *  screen is the code's ENTIRE lifetime on screen. A code nobody can read
     *  is not a feature: this is where the host reads and copies it. */
    joinCode?: string;
    onLeave: () => void;
};

/** Multiplayer holding screen shown while a created game waits for its second
 *  player (`game.status === "waiting"`). Shares the general page layout
 *  (ambient ground + opaque signal Panel, PRD #589). Two ways to bring a
 *  friend in: "Share" copies an invite link (`/join/<gameId>`) — a friend who
 *  opens it lands on the join antechamber, picks a deck, and is credited into
 *  this game — or they type the join code into the lobby's "Join by code"
 *  action, which needs nothing but the six characters shown here. */
export default function WaitingForOpponent({
    gameId,
    joinCode,
    onLeave,
}: WaitingForOpponentProps) {
    const [copied, setCopied] = useState(false);
    const [codeCopied, setCodeCopied] = useState(false);

    function handleShare() {
        const link = `${window.location.origin}/join/${gameId}`;
        void copyText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    function handleCopyCode() {
        if (!joinCode) return;
        // The RAW code is what the other player must type; the grouping dash
        // is a reading aid, not part of the value.
        void copyText(joinCode);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 1500);
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
                    {/* The literal "waiting for opponent" moment the issue
                        names (#2592): nothing else on this surface until a
                        second player joins, offered with the one action that
                        fills the empty space. */}
                    <EmptyState
                        className="text-center"
                        message={
                            joinCode
                                ? "Share the join code, or send an invite link."
                                : "Share this game ID so a friend can join."
                        }
                        description={
                            joinCode ? (
                                <span className="flex flex-col items-center gap-1">
                                    <span className="text-xs uppercase tracking-wide text-text-muted">
                                        Join code
                                    </span>
                                    <span className="font-mono text-2xl tracking-[0.25em] text-parchment">
                                        {formatJoinCode(joinCode)}
                                    </span>
                                </span>
                            ) : (
                                <span className="font-mono">
                                    Game ID: {gameId}
                                </span>
                            )
                        }
                        action={
                            <span className="flex flex-wrap items-center justify-center gap-2">
                                {joinCode && (
                                    <Button onClick={handleCopyCode}>
                                        {codeCopied
                                            ? "Code copied!"
                                            : "Copy join code"}
                                    </Button>
                                )}
                                <Button
                                    variant={joinCode ? "secondary" : "primary"}
                                    onClick={handleShare}
                                >
                                    {copied
                                        ? "Link copied!"
                                        : "Share invite link"}
                                </Button>
                            </span>
                        }
                    />
                </PanelBody>
                <PanelFooter className="justify-center">
                    <Button variant="secondary" onClick={onLeave}>
                        Leave
                    </Button>
                </PanelFooter>
            </Panel>
        </div>
    );
}
