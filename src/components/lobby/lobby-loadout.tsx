import { FORMAT_RULES } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { lobbyActionGate } from "~/lib/lobbyGate";
import type { LobbyModeTile } from "~/lib/lobbyModes";
import type { MatchFormat, PlayMode } from "~/lib/session";
import { cn } from "~/lib/utils";
import { Panel } from "~/components/ui/panel";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import ManaSymbol from "../cards/mana-symbol";
import FeaturedDeckArt from "./featured-deck-art";
import MatchFormatSelector from "./match-format-selector";

interface LobbyLoadoutProps {
    deck: LobbyDeck | null;
    /** Arena | Cockatrice (ADR 0101 §10, issue #2591). The lobby filters the
     *  shelves by it and clears an incompatible selection on toggle; this
     *  component only has to cope with a stale mismatch defensively (a
     *  persisted mode from before this deck existed, a race on first load). */
    mode: PlayMode;
    /** The Mode Tile currently selected. Its `title` NAMES the one primary
     *  action, and its `needsDeck` decides whether the deck gate applies —
     *  which is why the tile is passed whole rather than as a label string. */
    tile: LobbyModeTile;
    matchFormat: MatchFormat;
    onMatchFormatChange: (format: MatchFormat) => void;
    /** Runs the mutation the selected tile stands for. Dispatch lives in
     *  `lobby.tsx` (it owns every `useMutation`); this component owns only
     *  whether the action is offered. */
    onPrimary: () => void;
    /** Arena-only 5th entry point (issue #2649) — a table you were told the
     *  code for. Not a Mode Tile: it is a way INTO someone else's "Open a
     *  table", not a fifth thing to start. */
    onJoinByCode: () => void;
    onEditDeck: () => void;
    onChangeDeck: () => void;
    busy?: boolean;
    /** #155: a user holds at most one active game. While one exists, creating
     *  or joining is blocked client-side (the server rejects it anyway). */
    hasActiveGame?: boolean;
}

/**
 * The Loadout (ADR 0103 §6, issue #2726) — the active deck, its match
 * settings, and THE primary action.
 *
 * Replaces the v3 Play box's four competing plates with one ivory plate whose
 * label is the selected Mode Tile's title, so the surface always answers "what
 * happens if I press the bright thing" with the picture the player just chose.
 * Everything the Play box gated is gated here unchanged (ADR 0080 / issues
 * #512, #155, #2591): an illegal deck, a deck whose format does not match the
 * game mode, an empty Manual Deck, an action already in flight, and an active
 * game held elsewhere.
 */
export default function LobbyLoadout({
    deck,
    mode,
    tile,
    matchFormat,
    onMatchFormatChange,
    onPrimary,
    onJoinByCode,
    onEditDeck,
    onChangeDeck,
    busy = false,
    hasActiveGame = false,
}: LobbyLoadoutProps) {
    // The SHARED gate (`~/lib/lobbyGate`) — the same one `lobby.tsx` hands to
    // `OpenTablesStrip`, so a table row can never be joinable under a
    // condition this panel's primary action refuses.
    const { isCockatrice, deckMatchesMode, manualDeckHasCards, canAct } =
        lobbyActionGate({ deck, mode, busy, hasActiveGame });
    // Limited is a NAVIGATION, not a game creation: gating it behind the deck
    // picker would make the Limited entry point unreachable for a player with
    // no Constructed deck at all, which is exactly the player most likely to
    // want a Sealed pool.
    const canRunPrimary = tile.needsDeck ? canAct : !busy;

    return (
        <Panel tone="accent" className="flex flex-col overflow-hidden p-0">
            <div className="relative h-40 shrink-0">
                <FeaturedDeckArt
                    featuredCardId={deck?.featuredCardId ?? null}
                    objectPosition="object-[50%_30%]"
                    className="absolute inset-0 h-full w-full"
                />
                <div
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(180deg, rgba(0,0,0,0) 18%, rgba(0,0,0,0.88) 100%)",
                    }}
                />
                <div className="absolute inset-x-4 bottom-3 flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        Active deck
                    </span>
                    <span className="text-display truncate text-2xl leading-none text-parchment">
                        {deck?.name ?? "No deck selected"}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                        {deck && deck.colors.length > 0 && (
                            <span className="flex shrink-0 items-center gap-0.5">
                                {deck.colors.map((c) => (
                                    <ManaSymbol
                                        key={c}
                                        symbol={c}
                                        className="size-4"
                                    />
                                ))}
                            </span>
                        )}
                        <span className="truncate text-xs text-text-muted">
                            {deck
                                ? [
                                      `${deck.cards.length} cards`,
                                      FORMAT_RULES[deck.format].label,
                                      deck.description,
                                  ]
                                      .filter(Boolean)
                                      .join(" · ")
                                : "Pick a deck from the shelves below"}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-end gap-3">
                    <MatchFormatSelector
                        value={matchFormat}
                        onChange={onMatchFormatChange}
                        disabled={busy}
                    />
                    <span
                        className={cn(
                            "rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                            !deck
                                ? "border-[var(--hairline)] text-text-disabled"
                                : deck.isLegal
                                  ? "border-success/50 text-success"
                                  : "border-danger/60 text-danger-strong"
                        )}
                    >
                        {!deck ? "No deck" : deck.isLegal ? "Legal" : "Illegal"}
                    </span>
                    <span className="flex-1" />
                    {deck && (
                        <>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={onEditDeck}
                                title={`Edit ${deck.name}`}
                            >
                                Edit
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onChangeDeck}
                            >
                                Change deck
                            </Button>
                        </>
                    )}
                </div>

                {deck && !deck.isLegal && (
                    <Banner tone="danger" role="status" aria-live="polite">
                        <p className="font-semibold">
                            This deck is not legal for its format and cannot
                            start a game.
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

                <div className="flex flex-col gap-2">
                    <Button
                        variant="primary"
                        size="lg"
                        className="w-full"
                        disabled={!canRunPrimary}
                        onClick={onPrimary}
                    >
                        {/* The arrow is `aria-hidden` so the plate's
                            ACCESSIBLE NAME is exactly the Mode Tile's title.
                            That is what lets one query distinguish this single
                            action from the tile that named it — the tile's own
                            name is its whole visible text (chip + title +
                            line). */}
                        {tile.title}
                        <span aria-hidden>→</span>
                    </Button>
                    {!isCockatrice && (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="w-full"
                            disabled={!canAct}
                            onClick={onJoinByCode}
                        >
                            Join by code
                        </Button>
                    )}
                </div>

                {deck && (
                    <p className="text-xs text-text-muted" role="note">
                        {!deckMatchesMode
                            ? isCockatrice
                                ? "This deck isn't a Manual Deck — pick one, or switch to Arena mode."
                                : "This is a Manual Deck — switch to Cockatrice mode to play it, or pick a different deck."
                            : isCockatrice
                              ? manualDeckHasCards
                                  ? "Cockatrice mode: no rules enforced, every printed card available."
                                  : "This Manual Deck is empty — add cards before starting a game."
                              : "Arena mode: every rule is enforced by the engine."}
                    </p>
                )}
            </div>
        </Panel>
    );
}
