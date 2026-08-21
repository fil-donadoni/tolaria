import type { Doc, Id } from "@convex/_generated/dataModel";
import { FORMAT_RULES } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Banner } from "~/components/ui/banner";
import ActionButton from "~/components/board/action-button";
import ManaSymbol from "../cards/mana-symbol";
import FeaturedDeckArt from "./featured-deck-art";
import MatchFormatSelector from "./match-format-selector";
import PlayModeSelector from "./play-mode-selector";
import type { MatchFormat, PlayMode } from "~/lib/session";

/** An open (waiting) game enriched with its owning Match's format (PRD #387 /
 *  #397). The joiner inherits the creator's `bestOf`, so the format is shown in
 *  the join row BEFORE committing. */
export type OpenGame = Doc<"games"> & { bestOf: 1 | 3 };

interface DashboardPlayBoxProps {
    selectedDeck: LobbyDeck | null;
    openGames: Array<OpenGame> | undefined;
    /** The explicit game-mode selector (ADR 0101 §10, issue #2591): Arena
     *  mode | Cockatrice mode. This DRIVES which action set renders and
     *  which decks are compatible — the inverse of the pre-#2591 flow, which
     *  derived "manual or not" from `selectedDeck.format`. The lobby is
     *  responsible for clearing an incompatible `selectedDeck` when the mode
     *  toggles (see `lobby.tsx`'s `handlePlayModeChange`); this component
     *  only has to cope with a stale mismatch defensively (a persisted mode
     *  from before this deck existed, a race on first load). */
    mode: PlayMode;
    onModeChange: (mode: PlayMode) => void;
    /** Opens the two-step vs-AI setup dialog (difficulty + match format + AI
     *  opponent deck). The match only starts once the dialog is confirmed. */
    onCreateVsAi: () => void;
    onCreateSolo: () => void;
    onCreateManual: () => void;
    onCreateMultiplayer: () => void;
    /** Opens the code-entry dialog (issue #2649). The 4th Arena action; the
     *  join mutation only fires once a code has been typed and confirmed, so
     *  this callback opens a dialog rather than joining. */
    onJoinByCode: () => void;
    onJoin: (gameId: Id<"games">) => void;
    onChangeDeck: () => void;
    /** Bo1/Bo3 for the Solo and Multiplayer actions (PRD #387). The
     *  vs-AI path owns its own copy of the selector inside its setup dialog;
     *  both write the same lobby-level state, so the choice is shared. */
    matchFormat: MatchFormat;
    onMatchFormatChange: (format: MatchFormat) => void;
    busy?: boolean;
    /** #155: a user holds at most one active game. While one exists, creating
     *  or joining is blocked client-side (the server rejects it anyway). */
    hasActiveGame?: boolean;
}

export default function DashboardPlayBox({
    selectedDeck,
    openGames,
    mode,
    onModeChange,
    onCreateVsAi,
    onCreateSolo,
    onCreateManual,
    onCreateMultiplayer,
    onJoinByCode,
    onJoin,
    onChangeDeck,
    matchFormat,
    onMatchFormatChange,
    busy = false,
    hasActiveGame = false,
}: DashboardPlayBoxProps) {
    // An illegal selected deck cannot start a Game (ADR 0036, issue #512). The
    // server re-validates authoritatively; this disables Play up front so the
    // user can't fire a mutation that will only be rejected.
    const deckLegal = !selectedDeck || selectedDeck.isLegal;

    const isCockatrice = mode === "cockatrice";
    // Manual Decks and the real engine are mutually exclusive by construction
    // (ADR 0080): `createGame` / `joinGame` / `createSoloGame` reject a
    // manual-format deck, and `createManualSoloGame` rejects a real one. The
    // MODE is now the explicit driver (issue #2591) — the lobby filters the
    // deck lists so a mismatch shouldn't normally reach here, but a stale
    // selection (mode toggled, or persisted from before this slice) is
    // handled fail-closed: the action set for the CURRENT mode is disabled
    // rather than silently dispatching the wrong mutation.
    const deckMatchesMode = !selectedDeck
        ? true
        : isCockatrice
          ? selectedDeck.format === "manual"
          : selectedDeck.format !== "manual";
    // The manual Format deliberately validates nothing (ADR 0080), so an empty
    // deck is "legal" — but a Manual Game with no cards is not a game.
    const manualDeckHasCards = (selectedDeck?.cards.length ?? 0) > 0;
    const emptyManualDeck = isCockatrice && !manualDeckHasCards;
    // One gate for every action in the CURRENT mode's set: a legal, mode-
    // matching, non-empty-if-manual deck, no other action in flight, no
    // active game already held (#155).
    const canAct =
        !!selectedDeck &&
        deckLegal &&
        deckMatchesMode &&
        !emptyManualDeck &&
        !busy &&
        !hasActiveGame;

    return (
        // Rich-ornament survivor (ADR 0101 §2): the "lobby hero". The ADR and
        // PRD #2405 name the surface but no component, and the lobby has no
        // literally-named hero — the Play box is its primary waiting surface,
        // so it is the one that keeps the filigree. Explicit opt-in: every
        // other lobby Panel gets the v3 brackets. The Panel gates the ornament
        // to viewports above 844x390 by itself.
        <Panel tone="accent" ornament>
            <PanelHeader title="Play" />
            <PanelBody>
                <PlayModeSelector
                    value={mode}
                    onChange={onModeChange}
                    disabled={busy}
                />

                {/* Compact selected-deck tile (ADR 0101 §10 / PRD #2405 D15:
                    "no big grainy art") — replaces the pre-#2591 full-bleed
                    hero splash with the same small-art row language the deck
                    list uses (`DeckListItem`), so a deck reads the same size
                    everywhere it's shown. */}
                <div className="flex items-center gap-3 rounded-sm border border-border-subtle bg-surface-elevated px-3 py-2.5">
                    <FeaturedDeckArt
                        featuredCardId={selectedDeck?.featuredCardId ?? null}
                        dim
                        className="h-12 w-12 shrink-0 rounded ring-1 ring-black/40"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-beleren text-sm tracking-wide text-parchment">
                                {selectedDeck?.name ?? "No deck selected"}
                            </span>
                            {selectedDeck && (
                                <div className="flex shrink-0 items-center gap-0.5 text-base">
                                    {selectedDeck.colors.map((c) => (
                                        <ManaSymbol
                                            key={c}
                                            symbol={c}
                                            className="size-4"
                                        />
                                    ))}
                                </div>
                            )}
                            {selectedDeck && !selectedDeck.isLegal && (
                                <span className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-strong">
                                    Illegal
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] uppercase tracking-wide text-text-disabled">
                            {selectedDeck
                                ? `${FORMAT_RULES[selectedDeck.format].label} · ${selectedDeck.cards.length} cards`
                                : "Pick a deck from the lists below"}
                        </span>
                    </div>
                    {selectedDeck && (
                        <div className="shrink-0">
                            <ActionButton
                                onClick={onChangeDeck}
                                label="Change deck"
                                tone="secondary"
                            />
                        </div>
                    )}
                </div>

                {selectedDeck && !selectedDeck.isLegal && (
                    <Banner tone="danger" role="status" aria-live="polite">
                        <p className="font-semibold">
                            This deck is not legal for its format and cannot
                            start a game.
                        </p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                            {selectedDeck.reasons.map((r) => (
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

                <MatchFormatSelector
                    value={matchFormat}
                    onChange={onMatchFormatChange}
                    disabled={busy}
                />

                {/* The action set is swapped by mode (ADR 0101 §10), not
                    merely gated per-button: Cockatrice offers only Solo table
                    / Open a table, Arena only Play vs Bot / Solo game / Open
                    a table / Join by code — the OTHER mode's actions don't
                    render at all, so "not offered" (issue #2591 AC) means
                    absent from the DOM, not just disabled.

                    Two columns in BOTH modes (issue #2649): Arena's 4th
                    action turned the old `grid-cols-3` into a 3+1 orphan row,
                    and a `grid-cols-4` puts four labels in ~85px each at
                    390px wide. 2x2 is the one arrangement that holds at every
                    viewport the UI gate walks. */}
                <div className="grid grid-cols-2 gap-3">
                    {isCockatrice ? (
                        <>
                            <ActionButton
                                onClick={onCreateManual}
                                disabled={!canAct}
                                label="Solo table"
                                tone="primary"
                            />
                            <ActionButton
                                onClick={onCreateMultiplayer}
                                disabled={!canAct}
                                label="Open a table"
                                tone="secondary"
                            />
                        </>
                    ) : (
                        <>
                            <ActionButton
                                onClick={onCreateVsAi}
                                disabled={!canAct}
                                label="Play vs Bot"
                                tone="primary"
                            />
                            <ActionButton
                                onClick={onCreateSolo}
                                disabled={!canAct}
                                label="Solo game"
                                tone="secondary"
                            />
                            <ActionButton
                                onClick={onCreateMultiplayer}
                                disabled={!canAct}
                                label="Open a table"
                                tone="secondary"
                            />
                            <ActionButton
                                onClick={onJoinByCode}
                                disabled={!canAct}
                                label="Join by code"
                                tone="secondary"
                            />
                        </>
                    )}
                </div>

                {selectedDeck && (
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

                {openGames && openGames.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Open games to join
                        </p>
                        <div className="flex flex-col gap-2">
                            {openGames.map((g) => {
                                // A table's mode is fixed at creation and the
                                // join mutations are mode-exclusive (ADR 0080),
                                // so a deck/mode mismatch can only produce a
                                // server rejection — disable the row instead.
                                const tableIsManual = g.mode === "manual";
                                const rowMatchesMode =
                                    tableIsManual === isCockatrice;
                                const canJoin = canAct && rowMatchesMode;
                                return (
                                    <button
                                        key={g._id}
                                        onClick={() => onJoin(g._id)}
                                        disabled={!canJoin}
                                        title={
                                            rowMatchesMode
                                                ? undefined
                                                : tableIsManual
                                                  ? "This is a Manual Game — switch to Cockatrice mode to join."
                                                  : "This is an Arena game — switch to Arena mode to join."
                                        }
                                        className={cn(
                                            "flex items-center justify-between rounded-sm border px-4 py-2 text-sm transition",
                                            "border-border-subtle bg-surface-elevated text-text hover:border-border-accent/60",
                                            "disabled:cursor-not-allowed disabled:opacity-40"
                                        )}
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            {g.name}
                                            <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                                                {g.bestOf === 3 ? "Bo3" : "Bo1"}{" "}
                                                Match
                                            </span>
                                            {tableIsManual && (
                                                <span className="rounded-sm border border-border-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                                    Manual Game
                                                </span>
                                            )}
                                        </span>
                                        <span className="text-xs text-text-muted">
                                            {g.players.length}/2 · Join →
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </PanelBody>
        </Panel>
    );
}
