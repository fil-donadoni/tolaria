import { playerHasRestriction } from "@convex/gre/playerRestrictions";
import { useGameContext } from "~/hooks/useGameContext";

/** "Can't cast spells" badge shown beside the life total in
 *  {@link PlayerNameplate} — CR 702.50b: the player resolved an epic spell, a
 *  game-long lock no permanent carries, so nothing on the battlefield would
 *  otherwise tell anyone it is there. Renders nothing for an unlocked player. */
type PlayerCastLockProps = {
    playerId: string;
    /** Portrait compact nameplate — inline in the life row, no own `mt-0.5`. */
    compact?: boolean;
};

export default function PlayerCastLock({
    playerId,
    compact = false,
}: PlayerCastLockProps) {
    const { playerRestrictions } = useGameContext();
    if (
        !playerHasRestriction(
            { playerRestrictions },
            playerId,
            "cantCastSpells"
        )
    )
        return null;

    return (
        <div
            className={`${compact ? "" : "mt-0.5"} inline-flex items-center leading-none text-danger-strong`}
            title="Can't cast spells for the rest of the game"
            aria-label="Can't cast spells"
            data-testid={`cast-lock-${playerId}`}
        >
            <svg
                viewBox="0 0 16 16"
                width="11"
                height="11"
                role="img"
                aria-hidden="true"
                fill="none"
            >
                {/* Card outline (a spell). */}
                <rect
                    x="3.5"
                    y="2"
                    width="9"
                    height="12"
                    rx="1.2"
                    fill="currentColor"
                    opacity="0.22"
                    stroke="currentColor"
                    strokeWidth="1.2"
                />
                {/* The strike-through: no cast. */}
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
