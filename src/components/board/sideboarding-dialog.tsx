import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { PublicMatch } from "@convex/matches";
import GameDialog from "~/components/ui/game-dialog";
import { storeSession } from "~/lib/session";
import {
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "~/lib/deckSideboard";
import { interstitialChoiceState } from "~/lib/play-draw-choice";
import SideboardSwapList from "./sideboard-swap-list";

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

export default function SideboardingDialog({
    match,
    viewerId,
}: SideboardingDialogProps) {
    const submitSideboard = useMutation(api.game.submitSideboard);
    const setReady = useMutation(api.game.setReady);

    const seats = useMemo(() => sideboardableSeats(match), [match]);
    // Index of the seat currently being sideboarded (Solo readies seats in turn).
    const [seatIdx, setSeatIdx] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    // The play/draw pick. Persists across seat advances so the chooser's choice
    // (made while sideboarding their seat) reaches the FINAL `setReady` that
    // triggers the build — in Solo the chooser may not be the last seat readied.
    const [playDraw, setPlayDraw] = useState<"play" | "draw">("play");

    const seat = seats[seatIdx];
    // Working split for the current seat, seeded from its Match deck copy. Keyed
    // by seat id so advancing reseeds from the freshly-projected deck.
    const [split, setSplit] = useState<SideboardSplit>(() => ({
        cards: (seat?.deck?.maindeck ?? []).map((c) => ({ ...c })),
        sideboard: (seat?.deck?.sideboard ?? []).map((c) => ({ ...c })),
    }));
    const [splitSeatId, setSplitSeatId] = useState<string | undefined>(
        seat?.id
    );
    if (seat && seat.id !== splitSeatId) {
        // Reseed when the active seat changes (sequential Solo readies).
        setSplit({
            cards: (seat.deck?.maindeck ?? []).map((c) => ({ ...c })),
            sideboard: (seat.deck?.sideboard ?? []).map((c) => ({ ...c })),
        });
        setSplitSeatId(seat.id);
    }

    if (!seat || !seat.deck) {
        // Nothing for this client to sideboard (e.g. waiting on the opponent in
        // a 2-player Match). Show a passive waiting notice.
        return (
            <GameDialog open title="Sideboarding" dismissable={false}>
                <p className="text-zinc-400 text-sm text-center mt-1">
                    Waiting for the other player to finish sideboarding…
                </p>
            </GameDialog>
        );
    }

    // Maindeck size is LOCKED to the seat's starting size (the Match deck copy's
    // current maindeck count). Ready is blocked until the working maindeck
    // matches it again (issue #395).
    const lockedSize = seat.deck.maindeck.length;
    const sizeOk = split.cards.length === lockedSize;
    // The play/draw chooser (previous Game's loser, CR 103.4) picks while
    // sideboarding their seat. `interstitialChoiceState` resolves the viewer's
    // role; the toggle shows only on the seat that is actually the chooser (and
    // only when a human prompt is required — bot-chooser is forced server-side).
    const choiceKind = interstitialChoiceState(match, viewerId).kind;
    const isChooser =
        choiceKind === "prompt" && match.playDrawChooserId === seat.id;

    const handleToSide = (cardId: string) =>
        setSplit((s) => moveToSideboard(s, cardId));
    const handleToMain = (cardId: string) =>
        setSplit((s) => moveToMaindeck(s, cardId));

    const handleReady = async () => {
        if (!sizeOk || submitting) return;
        setSubmitting(true);
        try {
            await submitSideboard({
                matchId: match.matchId,
                seatId: seat.id,
                maindeck: split.cards,
                sideboard: split.sideboard,
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
                // (same viewer seat) and reload onto the fresh board.
                storeSession(gameId, viewerId);
                window.location.reload();
                return;
            }
            // More seats to sideboard on this client (Solo) — advance. The
            // play/draw pick is preserved across the advance.
            if (seatIdx + 1 < seats.length) {
                setSeatIdx(seatIdx + 1);
            }
            setSubmitting(false);
        } catch {
            // A race may have advanced the Match; reload to resync.
            window.location.reload();
        }
    };

    const total = split.cards.length + split.sideboard.length;

    return (
        <GameDialog
            open
            title="Sideboarding"
            subtitle={
                seats.length > 1
                    ? `${seat.name} — seat ${seatIdx + 1} of ${seats.length}`
                    : seat.name
            }
            size="wide"
            dismissable={false}
        >
            <div className="flex flex-col gap-3 mt-1">
                <p className="text-zinc-500 text-xs text-center">
                    Swap cards between your Maindeck and Sideboard. Your
                    Maindeck must stay at {lockedSize} cards.
                </p>
                <div className="flex gap-4">
                    <SideboardSwapList
                        title="Maindeck"
                        cards={split.cards}
                        moveLabel="→ Side"
                        onMove={handleToSide}
                        countSuffix={` / ${lockedSize}`}
                        disabled={submitting}
                        emptyMessage="No cards in the Maindeck."
                    />
                    <SideboardSwapList
                        title="Sideboard"
                        cards={split.sideboard}
                        moveLabel="→ Main"
                        onMove={handleToMain}
                        disabled={submitting}
                        emptyMessage="No cards in the Sideboard."
                    />
                </div>
                {!sizeOk && (
                    <p className="text-danger-strong text-xs text-center">
                        Maindeck must hold exactly {lockedSize} cards (currently{" "}
                        {split.cards.length}). The combined pool is {total}.
                    </p>
                )}
                {isChooser && (
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-zinc-400 text-xs">
                            You lost the last game — choose:
                        </span>
                        <div className="flex gap-2">
                            {(["play", "draw"] as const).map((opt) => (
                                <button
                                    key={opt}
                                    type="button"
                                    disabled={submitting}
                                    onClick={() => setPlayDraw(opt)}
                                    className={`rounded-sm border px-3 py-1 text-xs font-beleren tracking-wide transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                                        playDraw === opt
                                            ? "border-amber-500/60 bg-amber-700/30 text-amber-200"
                                            : "border-zinc-600/45 bg-zinc-800/40 text-zinc-300 hover:bg-zinc-700/40"
                                    }`}
                                >
                                    {opt === "play" ? "Play" : "Draw"}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <button
                    type="button"
                    onClick={() => void handleReady()}
                    disabled={!sizeOk || submitting}
                    className="mt-1 w-full py-2.5 rounded-sm bg-amber-700/30 border border-amber-500/45 text-amber-200 font-beleren tracking-wide hover:bg-amber-600/30 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {submitting ? "Confirming…" : "Ready"}
                </button>
            </div>
        </GameDialog>
    );
}
