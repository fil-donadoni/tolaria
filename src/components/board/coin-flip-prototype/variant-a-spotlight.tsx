// PROTOTYPE (issue #4433) — Variant A "Spotlight": dimmed board, ONE big coin
// re-flipped per round (two side by side for Mana Clash), landed results as a
// small tally strip underneath. Closest to today's overlay.
import { Panel } from "~/components/ui/panel";
import ProtoCoin from "./proto-coin";
import {
    faceLabel,
    flipperLine,
    isGood,
    seatName,
    type ProtoScenario,
} from "./prototype-scenarios";
import type { ProtoSequence } from "./use-proto-sequence";

export const VARIANT_A_NAME = "Spotlight";

export default function VariantASpotlight({
    scenario,
    seq,
    reduceMotion,
}: {
    scenario: ProtoScenario;
    seq: ProtoSequence;
    reduceMotion: boolean;
}) {
    const total = scenario.rounds.length;
    const focusIdx =
        seq.spinning >= 0 ? seq.spinning : Math.max(0, seq.landed - 1);
    const focus = scenario.rounds[focusIdx];
    const roundLabel =
        total > 1
            ? `${focus.length > 1 ? "Round" : "Flip"} ${focusIdx + 1}${
                  seq.phase === "revealing" ? "" : ` of ${total}`
              }`
            : null;
    return (
        <div
            className="absolute inset-0 z-modal flex cursor-pointer items-center justify-center modal-scrim"
            onClick={seq.skipToEnd}
        >
            <Panel
                density="compact"
                className="flex w-[min(92vw,420px)] flex-col items-center gap-4 px-6 py-5"
            >
                <div className="flex w-full flex-col gap-1 text-center">
                    <p className="text-display text-base text-text">
                        {scenario.sourceName}
                    </p>
                    <p className="text-xs italic text-text-muted">
                        “{scenario.oracleExcerpt}”
                    </p>
                    <p className="text-xs text-text">
                        {flipperLine(scenario, seq.phase !== "revealing")}
                    </p>
                </div>

                <div className="flex items-end gap-6">
                    {focus.map((flip, i) => (
                        <div
                            key={`${focusIdx}-${i}`}
                            className="flex flex-col items-center gap-1"
                        >
                            <ProtoCoin
                                flip={flip}
                                state={
                                    seq.spinning === focusIdx
                                        ? "spinning"
                                        : "landed"
                                }
                                spinMs={seq.spinMs}
                                size={96}
                                reduceMotion={reduceMotion}
                            />
                            {focus.length > 1 && (
                                <span className="text-xs text-text-muted">
                                    {seatName(flip.flipper)}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
                {roundLabel && (
                    <p className="text-xs text-text-muted">{roundLabel}</p>
                )}

                {total > 1 && (
                    <div className="flex max-w-full flex-wrap justify-center gap-1">
                        {scenario.rounds
                            .slice(0, seq.landed)
                            .map((round, r) => (
                                <span
                                    key={r}
                                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted"
                                >
                                    {round.map((f) => (
                                        <span
                                            key={f.flipper}
                                            className={`mx-0.5 ${isGood(f) ? "text-accent-strong" : "text-danger"}`}
                                        >
                                            {round.length > 1
                                                ? `${seatName(f.flipper)[0]}:`
                                                : ""}
                                            {faceLabel(f)[0]}
                                        </span>
                                    ))}
                                </span>
                            ))}
                        {scenario.plannedRounds &&
                            seq.phase !== "revealing" &&
                            Array.from({
                                length: scenario.plannedRounds - total,
                            }).map((_, k) => (
                                <span
                                    key={`g${k}`}
                                    className="rounded border border-dashed border-border/60 px-1.5 py-0.5 text-[10px] text-text-disabled"
                                >
                                    –
                                </span>
                            ))}
                    </div>
                )}

                {seq.phase !== "revealing" && (
                    <>
                        {scenario.stopNote && (
                            <p className="text-xs text-text-muted">
                                {scenario.stopNote}
                            </p>
                        )}
                        <p className="text-display text-sm text-text">
                            {scenario.consequence}
                        </p>
                    </>
                )}
                {seq.phase === "revealing" && (
                    <p className="text-[10px] text-text-disabled">
                        Click to skip to the result
                    </p>
                )}
            </Panel>
        </div>
    );
}
