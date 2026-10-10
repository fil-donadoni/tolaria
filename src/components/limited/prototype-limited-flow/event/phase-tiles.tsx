// PROTOTYPE — throwaway. The phase's tiles, laid into whatever grid the
// variant gives (`className` = grid columns). Wide tiles span the row.
import { cn } from "~/lib/utils";
import DecksInTile from "./decks-in-tile";
import DraftProgressTile from "./draft-progress-tile";
import InviteTile from "./invite-tile";
import PicksTile from "./picks-tile";
import PoolTile from "./pool-tile";
import RoundTile from "./round-tile";
import SeatsTile from "./seats-tile";
import SettingsTile from "./settings-tile";
import StandingsBoard from "./standings-board";
import WinnerBanner from "./winner-banner";
import type { EventProto } from "./use-event-proto";

export default function PhaseTiles({
    p,
    className,
    roundCta = false,
    pairRound = false,
}: {
    p: EventProto;
    className?: string;
    /** Show "Play match" inside the round tile too (when the hero is off
     *  screen, e.g. variant C on phones). */
    roundCta?: boolean;
    /** Games: round tile beside the standings (wide panes) instead of
     *  stacked full-width. */
    pairRound?: boolean;
}) {
    const viewer = p.seats[0];
    const wide = "col-span-full";
    return (
        <div
            className={cn(
                "grid gap-3",
                p.phase === "playing" && pairRound
                    ? "items-start xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
                    : className
            )}
        >
            {p.phase === "waiting" && (
                <>
                    <SeatsTile p={p} />
                    <SettingsTile openDecklists={p.openDecklists} />
                    <InviteTile onCopy={() => p.log("copy invite")} />
                </>
            )}
            {p.phase === "drafting" && (
                <>
                    <DraftProgressTile seats={p.seats} />
                    <PicksTile viewer={viewer} />
                </>
            )}
            {p.phase === "building" && (
                <>
                    <DecksInTile seats={p.seats} />
                    <PoolTile viewer={viewer} />
                </>
            )}
            {p.phase === "playing" && (
                <>
                    <RoundTile
                        seats={p.seats}
                        onPlay={() => p.log("play match")}
                        showCta={roundCta}
                        className={pairRound ? undefined : wide}
                    />
                    <StandingsBoard
                        phase={p.phase}
                        seats={p.seats}
                        className={pairRound ? undefined : wide}
                    />
                </>
            )}
            {p.phase === "finished" && (
                <>
                    <WinnerBanner seats={p.seats} className={wide} />
                    <StandingsBoard
                        phase={p.phase}
                        seats={p.seats}
                        className={wide}
                    />
                </>
            )}
        </div>
    );
}
