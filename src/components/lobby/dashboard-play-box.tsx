import type { Doc, Id } from "@convex/_generated/dataModel";
import type { Difficulty } from "@convex/gre";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import ActionButton from "~/components/board/action-button";
import ManaSymbol from "../cards/mana-symbol";
import DifficultySelector from "./difficulty-selector";

interface DashboardPlayBoxProps {
    selectedDeck: LobbyDeck | null;
    openGames: Array<Doc<"games">> | undefined;
    difficulty: Difficulty;
    onDifficultyChange: (difficulty: Difficulty) => void;
    onCreateSolo: () => void;
    onCreateVsAi: () => void;
    onCreateMultiplayer: () => void;
    onJoin: (gameId: Id<"games">) => void;
    onChangeDeck: () => void;
    busy?: boolean;
}

export default function DashboardPlayBox({
    selectedDeck,
    openGames,
    difficulty,
    onDifficultyChange,
    onCreateSolo,
    onCreateVsAi,
    onCreateMultiplayer,
    onJoin,
    onChangeDeck,
    busy = false,
}: DashboardPlayBoxProps) {
    const canPlay = !!selectedDeck && !busy;

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

                <div className="mb-3 flex justify-start">
                    <DifficultySelector
                        value={difficulty}
                        onChange={onDifficultyChange}
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
                                    <span className="font-medium">
                                        {g.name}
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
