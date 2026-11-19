import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PublicMatch } from "@convex/matches";
import GameDialog from "~/components/ui/game-dialog";
import { useGameContext } from "~/hooks/useGameContext";
import type { SideboardSplit } from "~/lib/deckSideboard";
import { interstitialChoiceState } from "~/lib/play-draw-choice";
import SideboardOpponentStatus from "./sideboard-opponent-status";
import SideboardEditor from "./sideboarding/sideboard-editor";
import LimitedRoundDeadline from "~/components/limited/limited-round-deadline";

/** The opponent seat in a 2-player Match (PRD #387 / #397), or null. The
 *  projection strips the opponent's deck contents but keeps their `ready` flag,
 *  so the opponent is identified as the seat that is NOT the viewer's. Solo and
 *  vs-AI have no human opponent to show a ready indicator for. */
function opponentSeat(
    match: PublicMatch,
    viewerId: string
): PublicMatch["players"][number] | null {
    if (match.solo || match.vsAi) return null;
    return match.players.find((p) => p.id !== viewerId) ?? null;
}

type SideboardingDialogProps = {
    match: PublicMatch;
    /** The viewer's seat id — re-pointed into the next Game's session. */
    viewerId: string;
};

/** Seats this client must sideboard, in Ready order. The seat is sideboardable
 *  when its (own/solo) deck copy is present in the projection. In Solo the human
 *  drives both seats sequentially; in vs-AI only the human seat (the bot
 *  auto-readies server-side); in 2-player only the viewer's own seat. */
function sideboardableSeats(match: PublicMatch): PublicMatch["players"] {
    const withDeck = match.players.filter((p) => p.deck !== undefined);
    if (match.vsAi) {
        // Bot seat (second) auto-readies with no swaps — the human never edits
        // it. Keep only the human seat(s).
        return withDeck.filter((_p, i) => i === 0);
    }
    return withDeck;
}

/** A seat's deck copy as a fresh, editable split. */
function seatSplit(seat: PublicMatch["players"][number]): SideboardSplit {
    return {
        cards: (seat.deck?.maindeck ?? []).map((c) => ({ ...c })),
        sideboard: (seat.deck?.sideboard ?? []).map((c) => ({ ...c })),
    };
}

/** The window's working state for one seat: the split it opened on (the
 *  Changes baseline and the size floor) and the split as edited. */
type SeatWindow = {
    seatId: string | undefined;
    start: SideboardSplit;
    split: SideboardSplit;
};

function openWindow(
    seat: PublicMatch["players"][number] | undefined
): SeatWindow {
    const start = seat ? seatSplit(seat) : { cards: [], sideboard: [] };
    return { seatId: seat?.id, start, split: start };
}

export default function SideboardingDialog({
    match,
    viewerId,
}: SideboardingDialogProps) {
    const submitSideboard = useMutation(api.gameTable.submitSideboard);
    const setReady = useMutation(api.game.setReady);
    const { onSwitchGame } = useGameContext();

    const seats = useMemo(() => sideboardableSeats(match), [match]);
    // Index of the seat currently being sideboarded (Solo readies seats in turn).
    const [seatIdx, setSeatIdx] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    // The play/draw pick. Persists across seat advances so the chooser's choice
    // (made while sideboarding their seat) reaches the FINAL `setReady` that
    // triggers the build — in Solo the chooser may not be the last seat readied.
    const [playDraw, setPlayDraw] = useState<"play" | "draw">("play");

    const seat = seats[seatIdx];
    // Keyed by seat id so advancing reseeds from the freshly-projected deck.
    const [win, setWin] = useState<SeatWindow>(() => openWindow(seat));
    if (seat && seat.id !== win.seatId) {
        // Reseed when the active seat changes (sequential Solo readies).
        setWin(openWindow(seat));
    }
    const setSplit = (f: (s: SideboardSplit) => SideboardSplit) =>
        setWin((w) => ({ ...w, split: f(w.split) }));

    const opponent = opponentSeat(match, viewerId);
    // A clocked Bo3's fixed sideboarding window (issue #2308): when it
    // closes the server readies every seat with its deck as it stands.
    const windowCountdown =
        match.sideboardDeadlineAt !== undefined ? (
            <LimitedRoundDeadline
                deadlineAt={match.sideboardDeadlineAt}
                closingLabel="Starting the next game…"
            />
        ) : null;

    if (!seat || !seat.deck) {
        // Nothing for this client to sideboard (e.g. waiting on the opponent in
        // a 2-player Match). Show a passive waiting notice with the opponent's
        // ready-state (PRD #387 user story 21 / #397).
        return (
            <GameDialog
                open
                align="center"
                title="Sideboarding"
                dismissable={false}
            >
                <div className="flex flex-col gap-3 mt-1">
                    <p className="text-text-muted text-sm text-center">
                        Waiting for the other player to finish sideboarding…
                    </p>
                    {opponent && (
                        <SideboardOpponentStatus opponent={opponent} />
                    )}
                </div>
            </GameDialog>
        );
    }

    // Maindeck size FLOOR = the seat's starting size (the Match deck copy's
    // maindeck count when the window opened — 60 constructed / 40 limited).
    // The maindeck may GROW past it (>60 allowed, QA sideboard revamp); only
    // going UNDER is blocked. The combined pool is preserved by the server.
    const lockedSize = win.start.cards.length;
    const sizeOk = win.split.cards.length >= lockedSize;
    // The play/draw chooser (previous Game's loser, CR 103.4) picks while
    // sideboarding their seat. `interstitialChoiceState` resolves the viewer's
    // role; the toggle shows only on the seat that is actually the chooser (and
    // only when a human prompt is required — bot-chooser is forced server-side).
    const choiceKind = interstitialChoiceState(match, viewerId).kind;
    const isChooser =
        choiceKind === "prompt" && match.playDrawChooserId === seat.id;
    // 2-player barrier: once the viewer has readied their own seat, the next
    // Game builds only after BOTH seats are ready (PRD #387 user story 19 /
    // #397). The projection reflects the viewer's own `ready` flag reactively;
    // until the opponent readies (and the build re-points the session) the
    // window stays up LOCKED — the swap can't change post-ready — and the
    // Ready dock says who it is waiting for.
    const readied = !!opponent && seat.ready;

    const handleReady = async () => {
        if (!sizeOk || submitting || readied) return;
        setSubmitting(true);
        try {
            await submitSideboard({
                matchId: match.matchId,
                seatId: seat.id,
                maindeck: win.split.cards,
                sideboard: win.split.sideboard,
            });
            // Always carry the current play/draw pick: the backend only applies
            // it on the final build and only relative to the recorded chooser,
            // so passing it from every seat is safe and survives Solo ordering.
            const { gameId } = await setReady({
                matchId: match.matchId,
                seatId: seat.id,
                choice: playDraw,
            });
            if (gameId) {
                // All seats ready → next Game built. Re-point the session to it
                // (same viewer seat) in-place. Must NOT full-page reload: the
                // route is a static `/game` and a reload re-requests it from the
                // host, which 404s on static hosts lacking an SPA fallback
                // (resume-from-home works only because it's a client-side nav
                // from `/`). The board is keyed by gameId, so a state swap
                // remounts it clean onto G2/G3.
                onSwitchGame(gameId as Id<"games">, viewerId);
                return;
            }
            // More seats to sideboard on this client (Solo) — advance. The
            // play/draw pick is preserved across the advance.
            if (seatIdx + 1 < seats.length) {
                setSeatIdx(seatIdx + 1);
            }
            setSubmitting(false);
        } catch {
            // A race may have advanced the Match. `match` is reactive (Convex
            // query upstream), so the dialog re-renders into the correct state
            // on its own — no full-page reload (which would 404, see above).
            // Clear the in-flight flag so the seat stays interactive.
            setSubmitting(false);
        }
    };

    const gameNumber = match.currentGameNumber + 1;
    const seatLabel =
        seats.length > 1
            ? `${seat.name} — seat ${seatIdx + 1} of ${seats.length}`
            : seat.name;

    return (
        <GameDialog
            open
            title="Sideboarding"
            subtitle={`${seatLabel} · before game ${gameNumber}`}
            size="sheet"
            dismissable={false}
        >
            <SideboardEditor
                start={win.start}
                split={win.split}
                onSplitChange={setSplit}
                lockedSize={lockedSize}
                gameNumber={gameNumber}
                isChooser={isChooser}
                playDraw={playDraw}
                onPlayDraw={setPlayDraw}
                opponent={opponent}
                countdown={windowCountdown}
                locked={submitting || readied}
                onReady={() => void handleReady()}
            />
        </GameDialog>
    );
}
