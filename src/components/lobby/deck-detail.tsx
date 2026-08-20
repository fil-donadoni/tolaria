import { useMemo, useState } from "react";
import { FORMAT_RULES } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cardBase } from "~/lib/cardSizing";
import { computeDeckStats } from "~/lib/deckStats";
import ManaSymbol from "../cards/mana-symbol";
import ActionButton from "../board/action-button";
import { Button } from "../ui/button";
import { Banner } from "../ui/banner";
import GameDialog from "../ui/game-dialog";
import DeckStatsCurveChart from "../deckbuilder/deck-stats-curve-chart";
import ManaPileView from "./mana-pile-view";

// Issue #2056 defect 1: this was a bare, un-floored three-way CSS clamp —
// the same shape that collapsed the deckbuilder's tiles below legibility on
// a short-and-wide viewport, just with a plain viewport-height unit instead
// of the dynamic one (which is why the original four-site sweep's
// dvh-specific guard missed it; the widened guard now catches every
// viewport-height unit). Routes through the shared floor like every other
// card-size clamp.
const CARD_BASE = cardBase("8rem", "20vw", "19vh");

interface DeckDetailProps {
    deck: LobbyDeck;
    isSelected: boolean;
    onBack: () => void;
    onSelect: () => void;
    onDelete?: () => void;
    /** Opens the deck editor (`/decks/$slug/edit` for a user deck,
     *  `/presets/$slug/edit` for a preset, admin-gated by the route). Absent
     *  for a preset when the viewer isn't an admin — same gate the "My
     *  Decks"/"Preset Decks" panels apply (`lobby.tsx`'s `renderPresetActions`). */
    onEdit?: () => void;
}

export default function DeckDetail({
    deck,
    isSelected,
    onBack,
    onSelect,
    onDelete,
    onEdit,
}: DeckDetailProps) {
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Mana curve (PRD #2405 D15, issue #2591): the same pure stat the
    // deckbuilder's Stats dialog computes, reused rather than re-derived. A
    // Manual (Cockatrice) deck's catalogue-only cards aren't in the card
    // registry `computeDeckStats` reads (ADR 0080 — no `CardDefinition` is
    // ever hydrated for one), so its curve renders all-zero by the same
    // "unresolvable contributes nothing" rule the Stats dialog already
    // follows — not a bug, just nothing to chart for a format the engine
    // never validates.
    const curve = useMemo(
        () => computeDeckStats(deck.cards).curve,
        [deck.cards]
    );

    return (
        <div className="flex w-full flex-col gap-4 p-6 text-text">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                <div className="flex items-center gap-3">
                    <ActionButton
                        onClick={onBack}
                        label="← Back"
                        tone="ghost"
                    />
                    <h1 className="text-xl font-bold font-beleren text-parchment">
                        {deck.name}
                    </h1>
                    <div className="flex items-center gap-1 text-xl">
                        {deck.colors.map((c) => (
                            <ManaSymbol key={c} symbol={c} />
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:flex-1">
                    <span className="text-xs text-text-muted">
                        {deck.cards.length} cards ·{" "}
                        {FORMAT_RULES[deck.format].label}
                    </span>
                    {deck.description && (
                        <p className="text-sm text-text-muted">
                            {deck.description}
                        </p>
                    )}
                    <div className="flex items-center gap-2 md:ml-auto">
                        {onEdit && (
                            <ActionButton
                                onClick={onEdit}
                                label="Edit"
                                tone="secondary"
                            />
                        )}
                        {onDelete && (
                            <ActionButton
                                onClick={() => setConfirmDelete(true)}
                                label="Delete"
                                tone="destructive"
                            />
                        )}
                        <Button
                            variant="primary"
                            onClick={onSelect}
                            disabled={isSelected}
                        >
                            {isSelected ? "Selected" : "Play"}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Legality (PRD #2405 D15, issue #2591) — same reasons list the
                Play box's illegal-deck banner shows, so a deck reads
                identically wherever its legality is surfaced. A Manual
                (Cockatrice) deck validates nothing (ADR 0080) and is always
                "legal", so this never renders for one. */}
            {!deck.isLegal && (
                <Banner tone="danger" role="status" aria-live="polite">
                    <p className="font-semibold">
                        This deck is not legal for its format.
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                        {deck.reasons.map((r) => (
                            <li
                                key={`${r.code}:${r.message}`}
                                className="text-danger-strong/90"
                            >
                                {r.message}
                            </li>
                        ))}
                    </ul>
                </Banner>
            )}

            <div className="flex flex-col gap-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Mana Curve
                </h2>
                <DeckStatsCurveChart curve={curve} />
            </div>

            <div
                style={
                    {
                        "--card-w": CARD_BASE,
                        "--card-h": `calc(${CARD_BASE} * 7 / 5)`,
                    } as React.CSSProperties
                }
            >
                <ManaPileView
                    cards={deck.cards}
                    catalogueBacked={deck.format === "manual"}
                />
            </div>

            <GameDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={`Delete "${deck.name}"?`}
                subtitle="This action cannot be undone."
            >
                <div className="flex justify-end gap-2 mt-4">
                    <ActionButton
                        onClick={() => setConfirmDelete(false)}
                        label="Cancel"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={() => {
                            setConfirmDelete(false);
                            onDelete?.();
                        }}
                        label="Delete"
                        tone="destructive"
                    />
                </div>
            </GameDialog>
        </div>
    );
}
