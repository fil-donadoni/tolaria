// PROTOTYPE — throwaway. The new lobby home (grilled 2026-10-09): Play
// (Constructed · Limited), Last Match (one-click replay of the saved setup),
// Your Tables (every Match / Limited Event you're seated at, with its phase).
import type { LobbyDeck } from "~/lib/deckTypes";
import { limitedEventStatusChip } from "~/lib/limitedEventStatus";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import FeaturedDeckArt from "../featured-deck-art";
import ProtoStartButton from "./proto-start-button";
import { stepsFor, firstOpenStep, type MatchSetup } from "./match-setup-logic";

const CHIP_LABEL = {
    open: "Waiting for players",
    drafting: "Draft",
    building: "Deckbuild",
    playing: "Rounds",
    done: "Done",
} as const;

export interface ProtoActiveMatch {
    name: string;
    phase: string;
}

interface ProtoHomeProps {
    last: MatchSetup;
    decks: LobbyDeck[];
    activeMatch: ProtoActiveMatch | null;
    events: LimitedEventSummaryView[];
    onConstructed: () => void;
    onLimited: () => void;
    onReplay: () => void;
    onEditLast: () => void;
}

export default function ProtoHome(p: ProtoHomeProps) {
    const steps = stepsFor(p.last, p.decks);
    const lastComplete = firstOpenStep(steps) === steps.length;
    const myDeck = p.decks.find((d) => d.presetId === p.last.myDeckId);

    return (
        <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Play
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(
                        [
                            ["Constructed", "Bring a deck — vs Bot, solo or a human", p.onConstructed],
                            ["Limited", "Sealed & Draft events", p.onLimited],
                        ] as const
                    ).map(([title, hint, go]) => (
                        <button
                            key={title}
                            type="button"
                            onClick={go}
                            className="flex h-28 flex-col justify-end rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-4 text-left hover:border-accent/60"
                        >
                            <span className="font-display text-2xl text-parchment">
                                {title} →
                            </span>
                            <span className="text-xs text-text-muted">{hint}</span>
                        </button>
                    ))}
                </div>
            </section>

            {lastComplete && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        Last Match
                    </h2>
                    <div className="flex items-center gap-3 rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-2">
                        <FeaturedDeckArt
                            featuredCardId={myDeck?.featuredCardId ?? null}
                            className="aspect-[16/10] w-24 rounded-sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-parchment">
                            {steps.map((s) => s.summary).join(" · ")}
                        </span>
                        <button
                            type="button"
                            onClick={p.onEditLast}
                            className="text-xs text-text-muted underline"
                        >
                            Change
                        </button>
                        <ProtoStartButton ready onStart={p.onReplay} label="Play again →" />
                    </div>
                </section>
            )}

            <section className="flex flex-col gap-2">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Your Tables
                </h2>
                {!p.activeMatch && p.events.length === 0 && (
                    <p className="text-xs text-text-disabled">
                        You're not seated anywhere.
                    </p>
                )}
                <div className="flex flex-col gap-1.5">
                    {p.activeMatch && (
                        <div className="flex items-center justify-between rounded-sm border border-border-strong bg-surface/70 px-3 py-2 text-sm">
                            <span className="text-parchment">{p.activeMatch.name}</span>
                            <span className="text-xs text-text-muted">
                                Constructed · {p.activeMatch.phase} · Resume →
                            </span>
                        </div>
                    )}
                    {p.events.map((e) => (
                        <div
                            key={e._id}
                            className="flex items-center justify-between rounded-sm border border-border-strong bg-surface/70 px-3 py-2 text-sm"
                        >
                            <span className="text-parchment">{e.label ?? `${e.type === "draft" ? "Draft" : "Sealed"} event`}</span>
                            <span className="text-xs text-text-muted">
                                Limited · {CHIP_LABEL[limitedEventStatusChip(e)]} · Open →
                            </span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
