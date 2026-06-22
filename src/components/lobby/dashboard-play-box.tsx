import type { Doc, Id } from "@convex/_generated/dataModel";
import type { Difficulty } from "@convex/gre";
import type { LobbyDeck } from "~/lib/deckTypes";
import type { MatchFormat } from "~/lib/session";
import { cn } from "~/lib/utils";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import ActionButton from "~/components/board/action-button";
import ManaSymbol from "../cards/mana-symbol";
import DifficultySelector from "./difficulty-selector";
import MatchFormatSelector from "./match-format-selector";
import AiDeckSelector from "./ai-deck-selector";

/** An open (waiting) game enriched with its owning Match's format (PRD #387 /
 *  #397). The joiner inherits the creator's `bestOf`, so the format is shown in
 *  the join row BEFORE committing. */
export type OpenGame = Doc<"games"> & { bestOf: 1 | 3 };

interface DashboardPlayBoxProps {
    selectedDeck: LobbyDeck | null;
    openGames: Array<OpenGame> | undefined;
    difficulty: Difficulty;
    onDifficultyChange: (difficulty: Difficulty) => void;
    /** Bo1/Bo3 selection (PRD #387). Flows into Match creation as `bestOf`. */
    matchFormat: MatchFormat;
    onMatchFormatChange: (format: MatchFormat) => void;
    /** All decks selectable as the AI opponent's deck (user + preset). */
    decks: LobbyDeck[];
    /** Selected AI opponent deck presetId, or null to mirror the player. */
    aiDeckId: string | null;
    onAiDeckChange: (presetId: string | null) => void;
    onCreateSolo: () => void;
    onCreateVsAi: () => void;
    onCreateMultiplayer: () => void;
    onJoin: (gameId: Id<"games">) => void;
    onChangeDeck: () => void;
    busy?: boolean;
    /** #155: a user holds at most one active game. While one exists, creating
     *  or joining is blocked client-side (the server rejects it anyway). */
    hasActiveGame?: boolean;
}

export default function DashboardPlayBox({
    selectedDeck,
    openGames,
    difficulty,
    onDifficultyChange,
    matchFormat,
    onMatchFormatChange,
    decks,
    aiDeckId,
    onAiDeckChange,
    onCreateSolo,
    onCreateVsAi,
    onCreateMultiplayer,
    onJoin,
    onChangeDeck,
    busy = false,
    hasActiveGame = false,
}: DashboardPlayBoxProps) {
    // An illegal selected deck cannot start a Game (ADR 0036, issue #512). The
    // server re-validates authoritatively; this disables Play up front so the
    // user can't fire a mutation that will only be rejected.
    const deckLegal = !selectedDeck || selectedDeck.isLegal;
    const canPlay = !!selectedDeck && deckLegal && !busy && !hasActiveGame;

    return (
        <Panel tone="accent">
            <PanelHeader title="Play" />
            <PanelBody>
                {selectedDeck ? (
                    <div className="flex flex-col md:flex-row flex-wrap justify-between items-center gap-3 mb-8">
                        <div className="flex gap-4">
                            <span className="text-lg font-semibold text-parchment">
                                {selectedDeck.name}
                            </span>

                            <div className="flex items-center gap-1 text-xl">
                                {selectedDeck.colors.map((c) => (
                                    <ManaSymbol key={c} symbol={c} />
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between w-full">
                            {selectedDeck.kind === "user" && (
                                <span className="rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong/80">
                                    Custom
                                </span>
                            )}
                            <ActionButton
                                onClick={onChangeDeck}
                                label="Change deck"
                                tone="secondary"
                            />
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-text-muted">
                        Select a deck to start playing.
                    </p>
                )}

                {selectedDeck && !selectedDeck.isLegal && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="mb-4 rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger"
                    >
                        <p className="font-semibold">
                            This deck is not legal for its format and cannot
                            start a game.
                        </p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                            {selectedDeck.reasons.map((r) => (
                                <li
                                    key={`${r.code}:${r.message}`}
                                    className="text-danger/90"
                                >
                                    {r.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="mb-3 flex flex-wrap items-end justify-start gap-4">
                    <MatchFormatSelector
                        value={matchFormat}
                        onChange={onMatchFormatChange}
                        disabled={busy}
                    />
                    <DifficultySelector
                        value={difficulty}
                        onChange={onDifficultyChange}
                        disabled={busy}
                    />
                    <AiDeckSelector
                        decks={decks}
                        value={aiDeckId}
                        onChange={onAiDeckChange}
                        disabled={busy}
                    />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <ActionButton
                        onClick={onCreateVsAi}
                        disabled={!canPlay}
                        label="Play vs AI"
                        tone="primary"
                    />
                    <ActionButton
                        onClick={onCreateSolo}
                        disabled={!canPlay}
                        label="Solo Game"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={onCreateMultiplayer}
                        disabled={!canPlay}
                        label="Create Multiplayer"
                        tone="secondary"
                    />
                </div>

                {openGames && openGames.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Open games to join
                        </p>
                        <div className="flex flex-col gap-2">
                            {openGames.map((g) => (
                                <button
                                    key={g._id}
                                    onClick={() => onJoin(g._id)}
                                    disabled={!canPlay}
                                    className={cn(
                                        "flex items-center justify-between rounded-sm border px-4 py-2 text-sm transition",
                                        "bg-surface-elevated/30 border-border-subtle/30 text-text hover:bg-surface-elevated/50",
                                        "disabled:cursor-not-allowed disabled:opacity-40"
                                    )}
                                >
                                    <span className="flex items-center gap-2 font-medium">
                                        {g.name}
                                        <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                                            {g.bestOf === 3 ? "Bo3" : "Bo1"}{" "}
                                            Match
                                        </span>
                                    </span>
                                    <span className="text-xs text-text-muted">
                                        {g.players.length}/2 · Join →
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </PanelBody>
        </Panel>
    );
}
