import type { Player } from "~/types/game";
import type { PlayerInteraction } from "~/hooks/usePlayerInteraction";
import AnimatedLifeTotal from "./animated-life-total";
import PlayerPoisonCounters from "./player-poison-counters";

type PlayerNameplateProps = {
    player: Player;
    interaction: PlayerInteraction;
    /** Extra classes appended by the layout (e.g. absolute positioning on the
     *  spatial board). */
    className?: string;
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
 *  #280. Bracketed compact box (Panel corner-bracket motif): a large
 *  accent-strong life total over an uppercase, muted name. The seat-coloured
 *  priority ring and the targeting / damage-choice ring are box-shadows from
 *  the flags computed by {@link usePlayerInteraction}; the click handler is
 *  wired by the caller via `interaction.handleClick`.
 *
 *  Carries `data-arrow-anchor-player` so a spell/ability that targets a player
 *  (e.g. Lightning Bolt to the face) can attach its arrow
 *  (`target-arrows-overlay.tsx` / `board-arrows.tsx`). */
export default function PlayerNameplate({
    player,
    interaction,
    className = "",
}: PlayerNameplateProps) {
    const { hasPriority, isTargetable, isDamageTargetPickable } = interaction;

    const interactive = isTargetable || isDamageTargetPickable;
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
            style={{ boxShadow }}
            className={`relative shrink-0 rounded-sm bg-surface/90 border border-border-subtle/80 px-5 py-2 text-center backdrop-blur-md transition-shadow duration-200 ${
                interactive ? "cursor-pointer" : ""
            } ${className}`}
        >
            <span className="absolute top-1 left-1 w-2.5 h-2.5 border-t border-l border-border-accent/50" />
            <span className="absolute top-1 right-1 w-2.5 h-2.5 border-t border-r border-border-accent/50" />
            <span className="absolute bottom-1 left-1 w-2.5 h-2.5 border-b border-l border-border-accent/50" />
            <span className="absolute bottom-1 right-1 w-2.5 h-2.5 border-b border-r border-border-accent/50" />
            <AnimatedLifeTotal life={player.life} />
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {player.name}
            </div>
            <PlayerPoisonCounters count={player.poisonCounters} />
        </div>
    );
}
