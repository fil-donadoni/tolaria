import type { Doc, Id } from "@convex/_generated/dataModel";
import { FORMAT_RULES } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Banner } from "~/components/ui/banner";
import ActionButton from "~/components/board/action-button";
import ManaSymbol from "../cards/mana-symbol";
import FeaturedDeckArt from "./featured-deck-art";

/** An open (waiting) game enriched with its owning Match's format (PRD #387 /
 *  #397). The joiner inherits the creator's `bestOf`, so the format is shown in
 *  the join row BEFORE committing. */
export type OpenGame = Doc<"games"> & { bestOf: 1 | 3 };

interface DashboardPlayBoxProps {
    selectedDeck: LobbyDeck | null;
    openGames: Array<OpenGame> | undefined;
    /** Opens the two-step vs-AI setup dialog (difficulty + match format + AI
     *  opponent deck). The match only starts once the dialog is confirmed. */
    onCreateVsAi: () => void;
    onCreateSolo: () => void;
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
    onCreateVsAi,
    onCreateSolo,
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
                {/* Featured-art HERO SPLASH of the selected deck (PRD #589,
                    issue #600): the resolved Featured Card's art under a bottom
                    fade that keeps the name + mana legible. A graceful fallback
                    paints when the deck has no resolvable art. */}
                <div className="relative h-40 w-full overflow-hidden rounded-md ring-1 ring-border-accent/40 sm:h-48">
                    <FeaturedDeckArt
                        featuredCardId={selectedDeck?.featuredCardId ?? null}
                        objectPosition="object-[center_30%]"
                        className="h-full w-full"
                    />
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-base via-surface-base/50 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-3 sm:p-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="truncate font-beleren text-xl tracking-wide text-parchment drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] sm:text-2xl">
                                    {selectedDeck?.name ?? "No deck selected"}
                                </span>
                                {selectedDeck && (
                                    <div className="flex shrink-0 items-center gap-0.5 text-lg">
                                        {selectedDeck.colors.map((c) => (
                                            <ManaSymbol
                                                key={c}
                                                symbol={c}
                                                className="size-5"
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="text-sm text-text drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                                {selectedDeck ? (
                                    <span className="flex items-center gap-2">
                                        {
                                            FORMAT_RULES[selectedDeck.format]
                                                .label
                                        }{" "}
                                        · {selectedDeck.cards.length} cards
                                        {selectedDeck.kind === "user" && (
                                            <span className="rounded-sm bg-accent-soft/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
                                                Custom
                                            </span>
                                        )}
                                    </span>
                                ) : (
                                    "Pick a deck from the lists below"
                                )}
                            </div>
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
