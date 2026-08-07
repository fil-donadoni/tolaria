import { useState } from "react";
import type { Player } from "~/types/game";
import type { PlayerInteraction } from "~/hooks/usePlayerInteraction";
import CornerFiligreeFrame from "~/components/ui/corner-filigree-frame";
import AnimatedLifeTotal from "./animated-life-total";
import PlayerPoisonCounters from "./player-poison-counters";
import PlayerEnergyCounters from "./player-energy-counters";

type PlayerNameplateProps = {
    player: Player;
    interaction: PlayerInteraction;
    /** Extra classes appended by the layout (e.g. absolute positioning on the
     *  spatial board). */
    className?: string;
    /** Portrait-only compact variant (#1814 round-2 fixup) — see the
     *  dedicated doc block below `PlayerNameplate` for the full account. */
    compact?: boolean;
};

/** Box-shadow ring/glow for the nameplate, by interaction state, using only
 *  semantic tokens (ADR 0007 — no chromatic Tailwind). Precedence: an
 *  actionable targeting / damage-assignment state (accent-strong, matching the
 *  target arrows) wins over the seat-coloured priority ring (accent = you,
 *  secondary-accent = opponent). */
function nameplateShadow(
    hasPriority: boolean,
    isTargetable: boolean,
    isDamagePickable: boolean,
    isPlayerPicked: boolean
): string | undefined {
    const STRONG = "var(--color-accent-strong)";
    if (isTargetable) {
        return `0 0 0 2px ${STRONG}, 0 0 16px 1px color-mix(in oklab, ${STRONG} 45%, transparent)`;
    }
    if (isDamagePickable) {
        return isPlayerPicked
            ? `0 0 0 3px ${STRONG}, 0 0 20px 2px color-mix(in oklab, ${STRONG} 55%, transparent)`
            : `0 0 0 2px ${STRONG}, 0 0 16px 1px color-mix(in oklab, ${STRONG} 45%, transparent)`;
    }
    if (hasPriority) {
        // Teal for both seats — the gold priority ring read as too close to the
        // accent-strong life total to notice.
        const ring = "var(--color-secondary-accent)";
        return `0 0 0 2px ${ring}, 0 0 18px 1px color-mix(in oklab, ${ring} 40%, transparent)`;
    }
    return undefined;
}

/** Presentational life total + nameplate shared by the classic life chrome
 *  (`player-life.tsx`) and the spatial board (`board-player.tsx`), slice
 *  #280. Compact box framed by the shared corner filigree: a large
 *  accent-strong life total over an uppercase, muted name. The seat-coloured
 *  priority ring and the targeting / damage-choice ring are box-shadows from
 *  the flags computed by {@link usePlayerInteraction}; the click handler is
 *  wired by the caller via `interaction.handleClick`.
 *
 *  Carries `data-arrow-anchor-player` so a spell/ability that targets a player
 *  (e.g. Lightning Bolt to the face) can attach its arrow
 *  (`target-arrows-overlay.tsx` / `board-arrows.tsx`).
 *
 *  **`compact` (#1814 round-2 fixup).** Portrait's viewer nameplate grows
 *  UPWARD out of a band the battlefield's own inset must reserve for it
 *  (`PORTRAIT_NAMEPLATE_BAND_H`, `portrait-board-bands.ts`) — review round 1
 *  sized that reservation to the DESKTOP nameplate's worst case (~91px:
 *  life + name on separate lines, each counter its own row) and paid for it
 *  by shrinking the battlefield to unusably small (untappable, <44px wide)
 *  cards on a 667px phone. `compact` is the fix: ONE row — life, name, and
 *  BOTH counter badges inline, every piece with an explicit `leading-none`
 *  (or a fixed-height glyph) so the row's height is exactly the tallest
 *  child's font-size, never an inherited/ambiguous line-height. Collapsing
 *  three-to-five rows into one is what lets the reserved band shrink from
 *  ~91px to `PORTRAIT_NAMEPLATE_BAND_H` (~26px content + a small rendering
 *  safety margin, see that constant for the exact box math) while still
 *  showing every field the desktop nameplate shows. Desktop/landscape and the
 *  classic `player-life.tsx` never pass `compact` — their box is unchanged. */
export default function PlayerNameplate({
    player,
    interaction,
    className = "",
    compact = false,
}: PlayerNameplateProps) {
    const { hasPriority, isTargetable, isDamageTargetPickable } = interaction;

    // Manual Board life editing (PRD #2162 / issue #2169). Both affordances
    // are OPT-IN through fields the GRE `usePlayerInteraction` never sets, so
    // on the real board `lifeEditable` is false, `onLifeWheel` is undefined,
    // and every branch below collapses to exactly the markup shipped before:
    // no wheel listener, no wrapper element, no input.
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const onLifeCommit = interaction.onLifeCommit;
    const lifeEditable = interaction.lifeEditable === true && !!onLifeCommit;
    const onLifeWheel = interaction.onLifeWheel;

    function commitLife() {
        setEditing(false);
        const next = Number.parseInt(draft, 10);
        if (!Number.isNaN(next) && next !== player.life) onLifeCommit?.(next);
    }

    /** The life total, wrapped in its click-to-edit affordance when the
     *  injected interaction offers one. Not a component — a render helper, so
     *  the two nameplate variants (compact / full) share one definition
     *  without duplicating the editing branch. */
    function lifeTotal(isCompact: boolean) {
        const total = (
            <AnimatedLifeTotal
                key={player.id}
                life={player.life}
                compact={isCompact}
            />
        );
        if (!lifeEditable) return total;
        if (editing) {
            return (
                <input
                    autoFocus
                    aria-label="Life total"
                    data-life-input={player.id}
                    className={`bg-surface-strong text-center font-bold text-text ${
                        isCompact ? "w-10 text-sm" : "w-16 text-2xl"
                    }`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitLife}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commitLife();
                        if (e.key === "Escape") setEditing(false);
                    }}
                />
            );
        }
        return (
            <span
                className="cursor-pointer"
                data-life-editable={player.id}
                onClick={(e) => {
                    e.stopPropagation();
                    setDraft(String(player.life));
                    setEditing(true);
                }}
            >
                {total}
            </span>
        );
    }

    const interactive =
        (isTargetable && !interaction.isDivideTarget) || isDamageTargetPickable;
    const boxShadow = nameplateShadow(
        hasPriority,
        isTargetable,
        isDamageTargetPickable,
        interaction.isPlayerPicked
    );

    return (
        <div
            data-arrow-anchor-player={player.id}
            onClick={interaction.handleClick}
            onWheel={onLifeWheel ? (e) => onLifeWheel(e.deltaY) : undefined}
            style={{ boxShadow }}
            // Class-constant linkage (#1814 round-3 fixup): `border` (1px ×
            // 2 edges, unconditional on this box) is
            // `PORTRAIT_NAMEPLATE_BORDER_PX` in `portrait-board-bands.ts`;
            // the compact variant's `py-0.5` (0.125rem × 2 edges × 16px) is
            // `PORTRAIT_NAMEPLATE_PADDING_PX` there. Those constants build
            // `PORTRAIT_NAMEPLATE_MAX_H` — the reserved band's real worst
            // case — by mirroring these two literals, not by re-measuring
            // the DOM, so a class edited here without a matching edit there
            // silently reopens the #1814 overlap. `board-player.test.tsx`
            // ("compact nameplate variant follows the portrait seam") pins
            // both class strings verbatim — that test is the mechanical
            // guard: a rename here fails it immediately instead of drifting.
            className={`relative shrink-0 rounded-sm bg-surface/90 border border-border-subtle/80 text-center backdrop-blur-md transition-shadow duration-200 ${
                compact ? "px-3 py-0.5" : "px-5 py-2"
            } ${interactive ? "cursor-pointer" : ""} ${className}`}
        >
            {/* Nit (#1814 round-3 review): the compact box is a 24px-tall
             *  (border + py-0.5 + one 18px row) container — a size-14 corner
             *  filigree's arcs overlap each other inside it. size=8 fits the
             *  smaller box without the overlap; the full (non-compact) box
             *  keeps size=14. */}
            <CornerFiligreeFrame overlay size={compact ? 8 : 14} subtle />
            {/* key by player.id so a solo-mode viewer swap (different player
             *  rendered at the same seat position) remounts the animator with a
             *  fresh baseline instead of animating a phantom life delta — the
             *  swap is only a change of view, not a real life change. */}
            {compact ? (
                // Single row — see the `compact` doc above. `flex-nowrap` so a
                // long name never wraps the row onto a second line (which
                // would blow the reserved band's exact height budget); a name
                // that doesn't fit truncates instead via `truncate` + a max
                // width, not by growing taller.
                <div className="flex flex-nowrap items-center justify-center gap-1.5">
                    {lifeTotal(true)}
                    <span className="max-w-16 truncate text-[9px] leading-none uppercase tracking-[0.15em] text-text-muted">
                        {player.name}
                    </span>
                    <PlayerPoisonCounters
                        count={player.poisonCounters}
                        compact
                    />
                    <PlayerEnergyCounters
                        count={player.energyCounters}
                        compact
                    />
                </div>
            ) : (
                <>
                    {lifeTotal(false)}
                    <div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-text-muted">
                        {player.name}
                    </div>
                    <PlayerPoisonCounters count={player.poisonCounters} />
                    <PlayerEnergyCounters count={player.energyCounters} />
                </>
            )}
            {/* The Monarch designation moved off the nameplate to a marker-card
             *  tile beside the piles (`player-monarch-tile.tsx`, #1305). */}
            {/* CR 601.2d — a divide-target player keeps its candidate ring (via
             *  `isTargetable`) but the [−] N [+] stepper now lives inside the
             *  divide dialog (`divide-target-list.tsx`), not on the nameplate. */}
        </div>
    );
}
