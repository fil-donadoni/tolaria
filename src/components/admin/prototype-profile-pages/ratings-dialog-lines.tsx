// PROTOTYPE — throwaway. Dialog "lines": the Card Profiles D idiom applied to a
// number. The half-point bar on top, then one compact line per comparison group
// the card belongs to (scope, colour, cost, type, rarity, each archetype):
// group · rank in it · its distribution · the cards just above and just below.
// Answers "is it too high FOR A BLUE TWO-DROP?" group by group.
import { useMemo } from "react";
import {
    RatingDialogShell,
    RatingStepBar,
    Thumb,
    type RatingDialogProps,
} from "./ratings-dialog-shared";
import { RATING_STEPS, toStep } from "./ratings-dialog-utils";
import { usePeek } from "./ratings-dialog-peek";
import type { ProtoRatingCard } from "./proto-data";

const COLS = "9.5rem 5.5rem 7rem minmax(0, 1fr) 1px minmax(0, 1fr)";
const NEIGHBOURS = 8;
const THUMB = { width: "w-8", sizes: "32px" };

interface Group {
    label: string;
    members: ProtoRatingCard[];
}

function groupsOf(card: ProtoRatingCard, all: readonly ProtoRatingCard[]) {
    const colourKey = (c: ProtoRatingCard) =>
        [...c.colors].sort().join("") || "Colourless";
    const groups: Group[] = [
        { label: "Scope", members: [...all] },
        {
            label: `Colour ${colourKey(card)}`,
            members: all.filter((c) => colourKey(c) === colourKey(card)),
        },
        {
            label: `Mana value ${card.manaValue}`,
            members: all.filter((c) => c.manaValue === card.manaValue),
        },
        ...card.types.map((t) => ({
            label: t,
            members: all.filter((c) => c.types.includes(t)),
        })),
        {
            label: `Rarity ${card.rarity}`,
            members: all.filter((c) => c.rarity === card.rarity),
        },
        ...card.archetypes.map((a) => ({
            label: a,
            members: all.filter((c) => c.archetypes.includes(a)),
        })),
    ];
    return groups;
}

function GroupLine({
    group,
    card,
    onPeek,
}: {
    group: Group;
    card: ProtoRatingCard;
    onPeek: (cardId: string, e: React.MouseEvent) => void;
}) {
    const r = card.rating ?? 0;
    const others = group.members.filter((c) => c.cardId !== card.cardId);
    const above = others
        .filter((c) => (c.rating ?? 0) > r)
        .sort(
            (a, b) =>
                (a.rating ?? 0) - (b.rating ?? 0) ||
                a.name.localeCompare(b.name)
        );
    const below = others
        .filter((c) => (c.rating ?? 0) < r)
        .sort(
            (a, b) =>
                (b.rating ?? 0) - (a.rating ?? 0) ||
                a.name.localeCompare(b.name)
        );
    const tied = others.length - above.length - below.length;
    const counts = RATING_STEPS.map(
        (s) => group.members.filter((c) => toStep(c.rating ?? 0) === s).length
    );
    const peak = Math.max(1, ...counts);
    return (
        <div
            className="grid items-center gap-2 border-t border-border-subtle/20 px-1 py-1"
            style={{ gridTemplateColumns: COLS }}
        >
            <span className="truncate font-mono text-xs text-text">
                {group.label}
            </span>
            <span className="font-mono text-xs text-parchment">
                #{above.length + 1}
                <span className="text-text-muted">
                    /{group.members.length}
                    {tied > 0 && ` =${tied}`}
                </span>
            </span>
            <span className="flex h-6 items-end gap-px">
                {RATING_STEPS.map((s, i) => (
                    <span
                        key={s}
                        title={`${s.toFixed(1)}: ${counts[i]}`}
                        className={
                            "flex-1 rounded-t-xs " +
                            (toStep(r) === s
                                ? "bg-accent-strong"
                                : "bg-text-muted/40")
                        }
                        style={{
                            height: `${Math.max(6, (counts[i] / peak) * 100)}%`,
                        }}
                    />
                ))}
            </span>
            <span className="flex min-w-0 items-center justify-end gap-0.5 overflow-hidden">
                {above.length === 0 && (
                    <span className="text-[10px] text-text-disabled">
                        top of the group
                    </span>
                )}
                {above
                    .slice(0, NEIGHBOURS)
                    .reverse()
                    .map((c) => (
                        <Thumb
                            key={c.cardId}
                            card={c}
                            onPeek={onPeek}
                            {...THUMB}
                        />
                    ))}
            </span>
            <span className="h-6 w-px bg-accent-strong" />
            <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                {below.slice(0, NEIGHBOURS).map((c) => (
                    <Thumb key={c.cardId} card={c} onPeek={onPeek} {...THUMB} />
                ))}
                {below.length === 0 && (
                    <span className="text-[10px] text-text-disabled">
                        bottom of the group
                    </span>
                )}
            </span>
        </div>
    );
}

export default function RatingsDialogLines(props: RatingDialogProps) {
    const { card, all, api } = props;
    const { onPeek, layer } = usePeek();
    const groups = useMemo(
        () => (card ? groupsOf(card, all) : []),
        [card, all]
    );
    return (
        <RatingDialogShell props={props}>
            {card && (
                <div className="flex flex-col gap-3">
                    <RatingStepBar card={card} api={api} />
                    <section className="flex flex-col">
                        <header
                            className="grid gap-2 px-1 pb-1 text-[9px] tracking-wide text-text-muted uppercase"
                            style={{ gridTemplateColumns: COLS }}
                        >
                            <span>Group</span>
                            <span>Rank</span>
                            <span>Distribution</span>
                            <span className="text-right">Just above</span>
                            <span />
                            <span>Just below</span>
                        </header>
                        {groups.map((g) => (
                            <GroupLine
                                key={g.label}
                                group={g}
                                card={card}
                                onPeek={onPeek}
                            />
                        ))}
                    </section>
                    <p className="text-[10px] text-text-disabled">
                        =N: cards tied with this one. Thumbnails: hover or
                        right-click for the preview, click for a peek.
                    </p>
                    {layer}
                </div>
            )}
        </RatingDialogShell>
    );
}
