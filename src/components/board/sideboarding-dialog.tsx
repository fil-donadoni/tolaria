import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PublicMatch } from "@convex/matches";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import { useGameContext } from "~/hooks/useGameContext";
import { buildPreviewBody } from "~/lib/preview-body";
import CardPreviewBody from "~/components/cards/card-preview-body";
import {
    moveAllToMaindeck,
    moveAllToSideboard,
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "~/lib/deckSideboard";
import { interstitialChoiceState } from "~/lib/play-draw-choice";
import SideboardSwapList from "./sideboard-swap-list";
import SideboardOpponentStatus from "./sideboard-opponent-status";

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

export default function SideboardingDialog({
    match,
    viewerId,
}: SideboardingDialogProps) {
    const submitSideboard = useMutation(api.game.submitSideboard);
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
    // Hover → the phase-2 computed preview (art + live oracle text) in the
    // middle column. Must stay above the early returns (rules-of-hooks).
    const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);

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

    const opponent = opponentSeat(match, viewerId);

    if (!seat || !seat.deck) {
        // Nothing for this client to sideboard (e.g. waiting on the opponent in
        // a 2-player Match). Show a passive waiting notice with the opponent's
        // ready-state (PRD #387 user story 21 / #397).
        return (
            <GameDialog open title="Sideboarding" dismissable={false}>
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

    // 2-player barrier: once the viewer has readied their own seat, the next
    // Game builds only after BOTH seats are ready (PRD #387 user story 19 /
    // #397). The projection reflects the viewer's own `ready` flag reactively;
    // until the opponent readies (and the build re-points the session) the
    // viewer sits on a waiting view showing the opponent's ready-state — the
    // editor is no longer re-openable, so the swap can't change post-ready.
    if (opponent && seat.ready) {
        return (
            <GameDialog open title="Sideboarding" dismissable={false}>
                <div className="flex flex-col gap-3 mt-1">
                    <p className="text-success-strong text-sm text-center font-beleren tracking-wide">
                        You are ready.
                    </p>
                    <p className="text-text-muted text-xs text-center">
                        The next game starts once both players are ready.
                    </p>
                    <SideboardOpponentStatus opponent={opponent} />
                </div>
            </GameDialog>
        );
    }

    // Maindeck size FLOOR = the seat's starting size (the Match deck copy's
    // current maindeck count — 60 constructed / 40 limited). The maindeck may
    // GROW past it (>60 allowed, QA sideboard revamp); only going UNDER is
    // blocked. The combined pool is preserved by the server.
    const lockedSize = seat.deck.maindeck.length;
    const sizeOk = split.cards.length >= lockedSize;
    // The play/draw chooser (previous Game's loser, CR 103.4) picks while
    // sideboarding their seat. `interstitialChoiceState` resolves the viewer's
    // role; the toggle shows only on the seat that is actually the chooser (and
    // only when a human prompt is required — bot-chooser is forced server-side).
    const choiceKind = interstitialChoiceState(match, viewerId).kind;
    const isChooser =
        choiceKind === "prompt" && match.playDrawChooserId === seat.id;

    const handleToSide = (cardId: string, all = false) =>
        setSplit((s) =>
            all ? moveAllToSideboard(s, cardId) : moveToSideboard(s, cardId)
        );
    const handleToMain = (cardId: string, all = false) =>
        setSplit((s) =>
            all ? moveAllToMaindeck(s, cardId) : moveToMaindeck(s, cardId)
        );
    const hoveredBody = hoveredCardId ? buildPreviewBody(hoveredCardId) : null;

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
                <p className="text-text-disabled text-xs text-center">
                    Swap cards between your Maindeck and Sideboard. Your
                    Maindeck must stay at {lockedSize}+ cards.
                </p>
                {/* FIXED row height (QA): the hovered-card preview used to size
                    the dialog, so a long-oracle card grew the panel, moved the
                    row out from under the pointer, dropped the hover and shrank
                    it back — a flicker loop. The row is now a stable, taller box
                    (capped to the viewport) and every column scrolls INSIDE it. */}
                <div className="flex h-[min(30rem,60vh)] gap-4">
                    <SideboardSwapList
                        title="Maindeck"
                        cards={split.cards}
                        moveLabel="→ Side"
                        onMove={handleToSide}
                        onHoverCard={setHoveredCardId}
                        countSuffix={` / ${lockedSize}+`}
                        disabled={submitting}
                        emptyMessage="No cards in the Maindeck."
                    />
                    {/* Middle preview column (phase 2, winner B): the computed
                        art + live oracle of the hovered card. Hidden on small
                        screens. */}
                    <div className="hidden h-full w-56 shrink-0 overflow-y-auto sm:block">
                        {hoveredBody ? (
                            <div className="card-preview-dock overflow-hidden rounded-2xl bg-surface">
                                <CardPreviewBody {...hoveredBody} size="sm" />
                            </div>
                        ) : (
                            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border-subtle/50 px-3 text-center text-[10px] text-text-disabled">
                                Hover a card to preview it
                            </div>
                        )}
                    </div>
                    <SideboardSwapList
                        title="Sideboard"
                        cards={split.sideboard}
                        moveLabel="→ Main"
                        onMove={handleToMain}
                        onHoverCard={setHoveredCardId}
                        disabled={submitting}
                        emptyMessage="No cards in the Sideboard."
                    />
                </div>
                {!sizeOk && (
                    <p className="text-danger-strong text-xs text-center">
                        Maindeck must hold at least {lockedSize} cards
                        (currently {split.cards.length}). The combined pool is{" "}
                        {total}.
                    </p>
                )}
                {isChooser && (
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-text-muted text-xs">
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
                                            ? "border-accent bg-accent-soft text-accent-strong"
                                            : "border-border-accent/40 bg-surface-elevated text-text-muted hover:bg-surface-elevated/80"
                                    }`}
                                >
                                    {opt === "play" ? "Play" : "Draw"}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {opponent && <SideboardOpponentStatus opponent={opponent} />}
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => void handleReady()}
                    disabled={!sizeOk || submitting}
                    className="mt-1 w-full"
                >
                    {submitting ? "Confirming…" : "Ready"}
                </Button>
            </div>
        </GameDialog>
    );
}
