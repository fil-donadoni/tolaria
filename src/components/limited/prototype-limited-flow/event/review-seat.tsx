// PROTOTYPE — throwaway. One player in "Review the table": a big, obvious
// collapsible trigger (avatar, name, colours, record, chevron); inside, tabs
// Deck / Pick order and the card-size slider. Locked seats say when they
// unlock instead of expanding.
import { useState } from "react";
import { Bot, ChevronDown, Lock } from "lucide-react";
import SegmentedControl from "~/components/ui/segmented-control";
import { cn } from "~/lib/utils";
import CardImageGrid from "./card-image-grid";
import ManaPips from "./mana-pips";
import RankBadge from "./rank-badge";
import SeatAvatar from "./seat-avatar";
import ZoomSlider from "./zoom-slider";
import { deckGroups, pickCards } from "./review-groups";
import { recordText, type MockSeat } from "./event-mock";

type ReviewTab = "deck" | "picks";

export default function ReviewSeat({
    seat,
    locked,
    open,
    onToggle,
    zoom,
    onZoom,
}: {
    seat: MockSeat;
    locked: boolean;
    open: boolean;
    onToggle: () => void;
    zoom: number;
    onZoom: (v: number) => void;
}) {
    const [tab, setTab] = useState<ReviewTab>("deck");
    const expanded = open && !locked;
    return (
        <section
            className={cn(
                "overflow-hidden rounded-[var(--panel-radius)] border bg-surface/80 transition",
                expanded ? "border-accent/50" : "border-border-strong",
                locked && "bg-surface/40"
            )}
        >
            <button
                type="button"
                onClick={locked ? undefined : onToggle}
                aria-expanded={expanded}
                aria-disabled={locked}
                className={cn(
                    "flex w-full items-center gap-3 px-3 py-3 text-left sm:px-4",
                    locked ? "cursor-default" : "hover:bg-surface-elevated/50"
                )}
            >
                {seat.placement && <RankBadge rank={seat.placement} />}
                <SeatAvatar seat={seat} size="md" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                        <span
                            className={cn(
                                "truncate text-base font-semibold",
                                seat.isViewer
                                    ? "text-accent-strong"
                                    : "text-parchment"
                            )}
                        >
                            {seat.isViewer ? "You" : seat.name}
                        </span>
                        {seat.kind === "bot" && (
                            <span className="flex shrink-0 items-center gap-0.5 rounded-sm bg-surface-elevated px-1 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                                <Bot className="size-3" /> bot
                            </span>
                        )}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-text-muted">
                        <ManaPips colors={seat.colors} size="sm" />
                        <span className="tabular-nums">
                            {recordText(seat.record)}
                        </span>
                        {locked && (
                            <span className="hidden truncate italic min-[420px]:inline">
                                · Revealed when the event ends
                            </span>
                        )}
                    </span>
                </span>
                {locked ? (
                    <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-strong text-text-disabled"
                        title="Revealed when the event ends"
                    >
                        <Lock className="size-4" />
                    </span>
                ) : (
                    <span
                        className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-full border transition",
                            expanded
                                ? "rotate-180 border-accent/60 bg-accent/15 text-accent-strong"
                                : "border-border-strong text-parchment"
                        )}
                    >
                        <ChevronDown className="size-5" />
                    </span>
                )}
            </button>
            {expanded && (
                <div className="flex flex-col gap-3 border-t border-[var(--hairline)] p-3 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <SegmentedControl
                            ariaLabel="Review view"
                            options={[
                                { value: "deck", label: "Deck · 40" },
                                { value: "picks", label: "Pick order · 45" },
                            ]}
                            value={tab}
                            onChange={setTab}
                        />
                        <ZoomSlider value={zoom} onChange={onZoom} />
                    </div>
                    {tab === "deck" ? (
                        deckGroups(seat.deck).map((g) => (
                            <div
                                key={g.label}
                                className="flex flex-col gap-1.5"
                            >
                                <h4 className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                    {g.label}
                                </h4>
                                <CardImageGrid cards={g.cards} zoom={zoom} />
                            </div>
                        ))
                    ) : (
                        <CardImageGrid
                            cards={pickCards(seat.picks)}
                            zoom={zoom}
                        />
                    )}
                </div>
            )}
        </section>
    );
}
