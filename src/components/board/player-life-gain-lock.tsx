import { playerHasRestriction } from "@convex/gre/playerRestrictions";
import { useGameContext } from "~/hooks/useGameContext";

/** "Can't gain life" badge shown beside the life total in
 *  {@link PlayerNameplate} — CR 119.7 / 611.2a: the player is under a
 *  game-long life-gain lock (Screaming Nemesis, Stigma Lasher), a
 *  player-scoped effect no permanent carries, so nothing on the battlefield
 *  would otherwise tell anyone it is there. Reads `playerRestrictions` from the
 *  shared {@link useGameContext} (never prop-drilled GameState) through the
 *  engine's own reader, and renders nothing for an unlocked player. The glyph
 *  is a crossed-out heart in the semantic `danger` token (ADR 0007 — no
 *  chromatic Tailwind), sized like the poison and energy badges. */
type PlayerLifeGainLockProps = {
    playerId: string;
    /** Portrait compact nameplate — mirrors {@link PlayerPoisonCounters}'s
     *  `compact`: inline in the life row, no own `mt-0.5`. */
    compact?: boolean;
};

export default function PlayerLifeGainLock({
    playerId,
    compact = false,
}: PlayerLifeGainLockProps) {
    const { playerRestrictions } = useGameContext();
    if (!playerHasRestriction({ playerRestrictions }, playerId, "cantGainLife"))
        return null;

    return (
        <div
            className={`${compact ? "" : "mt-0.5"} inline-flex items-center leading-none text-danger-strong`}
            title="Can't gain life for the rest of the game"
            aria-label="Can't gain life"
            data-testid={`life-gain-lock-${playerId}`}
        >
            <svg
                viewBox="0 0 16 16"
                width="11"
                height="11"
                role="img"
                aria-hidden="true"
                fill="none"
            >
                {/* Heart outline (life). */}
                <path
                    d="M8 13.5 2.6 8.3a3.2 3.2 0 0 1 4.6-4.5L8 4.6l.8-.8a3.2 3.2 0 0 1 4.6 4.5Z"
                    fill="currentColor"
                    opacity="0.22"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                />
                {/* The strike-through: no gain. */}
                <path
                    d="M2.5 13.5 13.5 2.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                />
            </svg>
        </div>
    );
}
