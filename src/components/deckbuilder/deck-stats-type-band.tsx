import type { CardType } from "@convex/cards/types";
import { cn } from "~/lib/utils";

/** Fixed presence-order for the eight `CardType` members that get a
 *  categorical chart slot (dataviz skill color-formula.md: "assigned in
 *  sequence, never cycled" — color identity by FIXED index, never by
 *  count/rank, so a type keeps the same hue across every deck). CR-300.1
 *  alphabetical order among the eight (issue #2586):
 *  `bun run cr 300.1` lists artifact, battle, ... kindred, land, ...,
 *  sorcery — this list is that same order with `Kindred` removed, since the
 *  catalogue's `CardType` union has nine members but the validated chart
 *  palette (`CHART_CATEGORICAL_TOKENS`, src/index.css) has eight slots. Per
 *  the dataviz skill's anti-patterns.md ("cycling / generating hues past
 *  8" → "fold the tail into Other"), `Kindred` — the rarest of the nine in
 *  this catalogue — folds into the neutral "Other" segment below instead of
 *  taking a ninth generated hue. */
const TYPE_BAND_ORDER: readonly CardType[] = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Instant",
    "Land",
    "Planeswalker",
    "Sorcery",
];

interface TypeBandSegment {
    label: string;
    count: number;
    colorClass: string;
}

export interface DeckStatsTypeBandProps {
    /** `DeckStats.types` as-is — already counted (CR 300); a card with
     *  several types (an Artifact Creature) is counted once in EACH of its
     *  types, so segment widths sum to more than the Maindeck's card count
     *  on a deck with multi-type cards. This component only assigns colour
     *  slots and lays out the band; all counting happened in
     *  `computeDeckStats`. */
    counts: Record<string, number>;
}

/**
 * The Stats dialog's type band (issue #2586, dataviz skill) — a single
 * 100%-stacked bar showing the Maindeck's card-type mix, replacing the old
 * plain-text "Types" count list with a real chart. Segment color is
 * assigned by each type's FIXED position in {@link TYPE_BAND_ORDER}, never
 * by its count, so e.g. Creature is always the same hue whether it's the
 * deck's biggest or smallest type — the categorical-color non-negotiable
 * (dataviz skill: "color follows the entity, never its rank").
 */
export default function DeckStatsTypeBand({ counts }: DeckStatsTypeBandProps) {
    const known: TypeBandSegment[] = TYPE_BAND_ORDER.map((type, i) => ({
        label: type,
        count: counts[type] ?? 0,
        colorClass: `bg-chart-cat-${i + 1}`,
    })).filter((s) => s.count > 0);

    const otherCount = Object.entries(counts).reduce(
        (sum, [type, count]) =>
            TYPE_BAND_ORDER.includes(type as CardType) ? sum : sum + count,
        0
    );

    const segments: TypeBandSegment[] =
        otherCount > 0
            ? [
                  ...known,
                  {
                      label: "Other",
                      count: otherCount,
                      colorClass: "bg-surface-elevated",
                  },
              ]
            : known;

    if (segments.length === 0) {
        return (
            <p className="text-sm text-text-muted">
                No cards in the Maindeck yet.
            </p>
        );
    }

    return (
        <div>
            <div
                role="group"
                aria-label="Card types, share of type tags"
                // `gap-[2px]`: the surface-gap spacer between touching
                // segments (dataviz skill marks-and-anatomy.md "surface
                // gap"); `flexGrow`/`flexBasis: 0` per segment partitions
                // the band by count directly, same pattern as
                // `deck-stats-color-row.tsx`'s lands/nonlands split (issue
                // #2586).
                className="flex h-6 w-full gap-[2px] overflow-hidden rounded-sm bg-surface-elevated short-viewport:h-4"
            >
                {segments.map((s) => (
                    <div
                        key={s.label}
                        className={cn("h-full", s.colorClass)}
                        style={{ flexGrow: s.count, flexBasis: 0 }}
                        title={`${s.label}: ${s.count}`}
                    />
                ))}
            </div>

            {/* Legend — mandatory for 2+ series (dataviz skill: identity is
                never color-alone). */}
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                {segments.map((s) => (
                    <li key={s.label} className="flex items-center gap-1.5">
                        <span
                            className={cn(
                                "inline-block size-2 shrink-0 rounded-full",
                                s.colorClass
                            )}
                        />
                        <span className="text-text">{s.label}</span>
                        <span>{s.count}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
