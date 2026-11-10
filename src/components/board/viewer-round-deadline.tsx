import { useGameContext } from "~/hooks/useGameContext";
import LimitedRoundDeadline from "~/components/limited/limited-round-deadline";

/** The Limited Event round countdown on the board (issue #2308), shown on the
 *  VIEWER's nameplate only — the round's deadline is shared by both seats, so
 *  one copy is enough, and the viewer's is the one always in reach. Reuses the
 *  event page's `LimitedRoundDeadline` as-is (tick rate, urgency, terminal
 *  wording, `role="timer"`); renders nothing outside a round pairing with a
 *  configured deadline. Purely decorative: the round's close-out is the
 *  server's (`expireRoundDeadline`). */
export default function ViewerRoundDeadline({
    playerId,
}: {
    playerId: string;
}) {
    const { roundDeadlineAt, playerId: viewerId } = useGameContext();
    if (roundDeadlineAt === undefined || playerId !== viewerId) return null;
    return <LimitedRoundDeadline deadlineAt={roundDeadlineAt} />;
}
