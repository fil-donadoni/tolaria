// PROTOTYPE (issue #4433) — Variant A2 "Spotlight v2" (owner picked A):
// dimmed board; the source on top laid out like a stack row (art, name, mana,
// controller, Oracle excerpt); a 3D coin tossed per round — two side by side
// for a two-player round — whose result is HELD on screen before the next
// toss; a readable history underneath; consequence once the series ends.
import { Panel } from "~/components/ui/panel";
import ProtoCoin3D from "./proto-coin-3d";
import ProtoFlipHistory from "./proto-flip-history";
import ProtoSourceRow from "./proto-source-row";
import {
    isGood,
    seatName,
    type ProtoFlip,
    type ProtoScenario,
} from "./prototype-scenarios";
import type { ProtoSequence } from "./use-proto-sequence";

export const VARIANT_A2_NAME = "Spotlight v2";

function caption(flip: ProtoFlip): string {
    const who = seatName(flip.flipper);
    const you = flip.flipper === "you";
    if (flip.outcome === "win")
        return you ? "You win the flip" : `${who} wins the flip`;
    if (flip.outcome === "lose")
        return you ? "You lose the flip" : `${who} loses the flip`;
    // Face-only flip (CR 705.2): nobody wins or loses — say what the face does.
    return flip.face === "heads" ? "Heads — no damage" : "Tails — 1 damage";
}

export default function VariantA2Spotlight({
    scenario,
    seq,
    reduceMotion,
}: {
    scenario: ProtoScenario;
    seq: ProtoSequence;
    reduceMotion: boolean;
}) {
    const total = scenario.rounds.length;
    const done = seq.phase !== "revealing";
    const idx = seq.spinning >= 0 ? seq.spinning : Math.max(0, seq.showing);
    const round = scenario.rounds[idx];
    const inAir = seq.spinning === idx;
    const two = round.length > 1;
    const size = two ? 92 : 112;
    const oneSeat =
        new Set(scenario.rounds.flat().map((f) => f.flipper)).size === 1;
    const heading = two
        ? `Round ${idx + 1}`
        : total > 1 || scenario.plannedRounds
          ? `Flip ${idx + 1}${scenario.plannedRounds ? ` of up to ${scenario.plannedRounds}` : ""}`
          : null;
    const who = oneSeat
        ? `${seatName(round[0].flipper)} ${round[0].flipper === "you" ? "flip" : "flips"} a coin`
        : "You and Bot each flip a coin";

    return (
        <div
            className="absolute inset-0 z-modal flex cursor-pointer items-center justify-center modal-scrim"
            onClick={seq.skipToEnd}
        >
            <Panel
                density="compact"
                className="flex w-[min(94vw,460px)] flex-col items-center gap-4 px-5 py-4"
            >
                <ProtoSourceRow scenario={scenario} />

                <div className="flex flex-col items-center gap-0.5">
                    <p className="text-display text-sm text-text">{who}</p>
                    {heading && (
                        <p className="text-[11px] text-text-muted">{heading}</p>
                    )}
                </div>

                <div className="flex items-start justify-center gap-10 pt-2">
                    {round.map((flip, k) => (
                        <div
                            key={`${idx}-${k}`}
                            className="flex w-32 flex-col items-center gap-3"
                        >
                            <ProtoCoin3D
                                face={flip.face}
                                phase={inAir ? "tossing" : "landed"}
                                durationMs={seq.spinMs}
                                size={size}
                                tone={isGood(flip) ? "good" : "bad"}
                                reduceMotion={reduceMotion}
                            />
                            <div className="flex min-h-9 flex-col items-center gap-0.5 pt-2 text-center">
                                {two && (
                                    <span
                                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                            flip.flipper === "you"
                                                ? "bg-signal-self/15 text-signal-self-strong"
                                                : "bg-signal-opponent/15 text-signal-opponent-strong"
                                        }`}
                                    >
                                        {seatName(flip.flipper)}
                                    </span>
                                )}
                                {!inAir && (
                                    <span
                                        className={`text-xs font-semibold ${isGood(flip) ? "text-success-strong" : "text-danger"}`}
                                    >
                                        {caption(flip)}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <ProtoFlipHistory
                    scenario={scenario}
                    landed={seq.landed}
                    done={done}
                />

                {done ? (
                    <div className="flex flex-col items-center gap-0.5 text-center">
                        {scenario.stopNote && (
                            <p className="text-[11px] text-text-muted">
                                {scenario.stopNote}
                            </p>
                        )}
                        <p className="text-display text-sm text-text">
                            {scenario.consequence}
                        </p>
                    </div>
                ) : (
                    <p className="text-[10px] text-text-disabled">
                        Click to skip to the result
                    </p>
                )}
            </Panel>
        </div>
    );
}
