// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-countdown=C`). Never merge.
// Variant C: the countdown IS the table. The real seat ring (you + the Bots,
// pass arrows) with the number in the middle — the wait teaches who you are
// drafting with and which way the packs travel.
import { ArrowLeft, ArrowRight } from "lucide-react";
import { passDirection } from "@convex/limited/draftEngine";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedTableRingView from "../limited-table-ring-view";
import {
    PROTOTYPE_TICK_CSS,
    skipPrototypeCountdown,
} from "./prototypeCountdownStore";

export default function PrototypeCountdownTableIntro({
    seconds,
    event,
    round,
}: {
    seconds: number;
    event: LimitedEventView;
    round: number;
}) {
    const bots = event.seats.filter((s) => s.isBot).length;
    const humans = event.seats.length - bots;
    const left = passDirection(round) === 1;
    const Arrow = left ? ArrowLeft : ArrowRight;
    return (
        <div
            data-prototype="countdown-table-intro"
            role="dialog"
            aria-label="Draft starting"
            className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-4 bg-surface-base/95 p-6 text-text backdrop-blur-md"
        >
            <style>{PROTOTYPE_TICK_CSS}</style>
            <p className="text-sm tracking-[0.3em] text-text-muted uppercase">
                Your table — {event.seats.length} seats · {humans}{" "}
                {humans === 1 ? "player" : "players"} · {bots} Bots
            </p>
            <div className="relative w-full max-w-2xl">
                <LimitedTableRingView event={event} round={round} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
                    <span className="text-xs tracking-[0.2em] text-text-muted uppercase">
                        Pack {round + 1} opens in
                    </span>
                    <span
                        key={seconds}
                        role="timer"
                        className="text-8xl leading-none font-bold text-accent-strong tabular-nums"
                        style={{
                            animation: "prototype-count-tick 0.4s ease-out",
                        }}
                    >
                        {seconds}
                    </span>
                    <span className="flex items-center gap-1.5 rounded-full border border-border-accent/40 bg-surface-elevated px-3 py-1 text-sm">
                        <Arrow className="h-4 w-4" aria-hidden="true" />
                        Packs pass {left ? "left" : "right"}
                    </span>
                </div>
            </div>
            <p className="max-w-md text-center text-sm text-text-muted">
                Pick one card, pass the rest. The player before you decides what
                you see next.
            </p>
            <button
                type="button"
                onClick={skipPrototypeCountdown}
                className="rounded-sm border border-border-accent/40 px-4 py-2 text-sm tracking-wide text-text-muted uppercase transition-colors hover:text-parchment"
            >
                Start now
            </button>
        </div>
    );
}
