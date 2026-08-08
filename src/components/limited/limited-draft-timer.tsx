import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { pickTimerSecondsForCardsRemaining } from "@convex/limited/pickTimerSchedule";
import { cn } from "~/lib/utils";

/** Both full-motion and reduced-motion redraw on the SAME once-a-second
 *  cadence (issue #2238). Full motion pairs each tick with a 1s linear CSS
 *  `transition-transform`, so the browser interpolates smoothly between
 *  ticks — genuinely continuous motion from a cheap once-a-second wake-up,
 *  never an animated layout property (the repo's motion pass rule, #598,
 *  amended in `src/index.css` for informational motion). Reduced motion
 *  drops the transition class, so the SAME tick lands as a visible discrete
 *  step instead of an interpolated glide — "keeps moving, never frozen,
 *  never hidden" without a second code path. */
const TICK_MS = 1000;

/** Seconds remaining at/under which the countdown reads as urgent (issue
 *  #1114/#1243; unchanged by #2238). Because the bar's fill is always
 *  relative to THIS Pick's own allowance (full at every Pick, regardless of
 *  length), the bar alone can't say "this Pick started short" — the tone is
 *  the only channel left that can, and a Pick whose whole allowance is at or
 *  under this threshold is born urgent for free: `remainingSeconds` can
 *  never exceed the Pick's total, so it starts at/under the threshold too. */
const URGENT_THRESHOLD_SECONDS = 10;

type Phase = "normal" | "urgent" | "expired";

function phaseOf(remainingSeconds: number): Phase {
    if (remainingSeconds <= 0) return "expired";
    return remainingSeconds <= URGENT_THRESHOLD_SECONDS ? "urgent" : "normal";
}

function announcementFor(phase: Phase, remainingSeconds: number): string {
    return phase === "expired" ? "Auto-picking…" : `${remainingSeconds}s left`;
}

/** The Pick Timer (glossary term, `CONTEXT.md`; issue #1114/#1243, redesigned
 *  #2238 for visibility): a full-width bar, mounted directly above the
 *  Booster's card grid, that starts FULL at the beginning of every Pick and
 *  drains to empty by the deadline — so fill level means the same thing at
 *  every Pick regardless of that Pick's own length, and the DRAIN RATE
 *  itself is the signal (a 5s Pick visibly races, a 40s Pick creeps). The
 *  remaining-seconds readout is attached to the bar itself — there is no
 *  second copy of the countdown anywhere else.
 *
 *  `pickDeadline` is a server-written EPOCH MS timestamp
 *  (`convex/limitedEvents.ts`, `convex/limited/draftEngine.ts`'s timer
 *  stamping) — this component only ever diffs against `Date.now()` locally,
 *  never counts down the server-pushed integer directly (it would
 *  drift/freeze between Convex pushes). `cardsRemaining` is the CURRENT
 *  pack's card count (`seat.currentPack.length`), which is exactly what the
 *  server used to look up THIS Pick's allowance
 *  (`pickTimerSecondsForCardsRemaining`, `assignFreshPack`) — re-deriving the
 *  total client-side from the SAME pure schedule function keeps the schedule
 *  single-authority instead of adding a second server-written field.
 *
 *  Renders nothing — no reserved layout space — when the event has no timer
 *  configured or nothing is currently timed for this seat (`pickDeadline`
 *  absent): timer-off events, and the final card of a pack (no real choice
 *  left to time). */
export default function LimitedDraftTimer({
    pickDeadline,
    cardsRemaining,
}: {
    pickDeadline: number | null;
    cardsRemaining: number;
}) {
    const reduceMotion = useReducedMotion();
    const [now, setNow] = useState(() => Date.now());

    // No synchronous `setNow(Date.now())` here on purpose (react-hooks/
    // set-state-in-effect) — the very first tick after `pickDeadline`
    // changes is at most `TICK_MS` stale, and staleness can only ever make
    // `remainingMs` read HIGHER than the true value, which the `fraction`
    // clamp below caps at 1 anyway. That is exactly "starts full at the
    // beginning of every Pick" — the harmless direction to be wrong in.
    useEffect(() => {
        if (pickDeadline === null) return;
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, [pickDeadline]);

    const remainingMs =
        pickDeadline === null ? 0 : Math.max(0, pickDeadline - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const phase = phaseOf(remainingSeconds);
    const urgent = phase !== "normal";

    // The visible bar+number tick every second and are `aria-hidden` — the
    // accessible surface is the separate `role="timer"` live region below,
    // whose text only changes at a PHASE transition (entering urgent,
    // expiring), never on every second-tick. A live region that mutates
    // every second for a 40s countdown is exactly the "announces on every
    // tick" failure mode the redesign is asked to avoid.
    const phaseRef = useRef<Phase>(phase);
    const [announcement, setAnnouncement] = useState(() =>
        announcementFor(phase, remainingSeconds)
    );
    useEffect(() => {
        if (phase !== phaseRef.current) {
            phaseRef.current = phase;
            setAnnouncement(announcementFor(phase, remainingSeconds));
        }
    }, [phase, remainingSeconds]);

    if (pickDeadline === null) return null;

    const totalSeconds =
        pickTimerSecondsForCardsRemaining(cardsRemaining) ??
        // Defensive only — the schedule invariant (assignFreshPack stamps
        // `pickDeadline` from the SAME `cardsRemaining` this component
        // receives) should make this unreachable. Falling back to the
        // remaining seconds keeps the bar rendering (near-full, no crash)
        // rather than dividing by zero if the invariant is ever violated.
        Math.max(remainingSeconds, 1);
    const totalMs = totalSeconds * 1000;
    const fraction = Math.min(1, Math.max(0, remainingMs / totalMs));

    return (
        <div
            data-slot="pick-timer"
            className="relative h-3 w-full shrink-0 overflow-hidden rounded-sm border border-border-accent/30 bg-surface-elevated/50"
        >
            {/* Fresh DOM node per Pick (`key={pickDeadline}`) — without it, a
             *  full-motion CSS transition would interpolate from the PREVIOUS
             *  Pick's near-empty fill up to this Pick's fresh full fill,
             *  reading as a "regrow" glitch instead of an instant reset. */}
            <div
                key={pickDeadline}
                data-pick-timer-fill
                aria-hidden="true"
                className={cn(
                    "h-full w-full origin-left",
                    urgent ? "bg-danger/70" : "bg-accent-strong/60",
                    !reduceMotion &&
                        "transition-transform duration-1000 ease-linear"
                )}
                style={{ transform: `scaleX(${fraction})` }}
            />
            <span
                data-pick-timer-readout
                aria-hidden="true"
                className={cn(
                    "pointer-events-none absolute inset-0 flex items-center justify-end pr-2 text-xs font-semibold tabular-nums",
                    urgent ? "text-danger-strong" : "text-text"
                )}
            >
                {announcementFor(phase, remainingSeconds)}
            </span>
            <span role="timer" aria-live="polite" className="sr-only">
                {announcement}
            </span>
        </div>
    );
}
