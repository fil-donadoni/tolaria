// PROTOTYPE (issue #4433) — Variant C "Ribbon": the board stays UNDIMMED. A
// compact ribbon docks at the top-centre; small coins tick into a strip at the
// accelerated pace; the Oracle excerpt is one truncated line (full on hover).
// Still blocking in the engine — only the presentation is light.
import ProtoCoin from "./proto-coin";
import {
    flipperLine,
    seatName,
    type ProtoScenario,
} from "./prototype-scenarios";
import type { ProtoSequence } from "./use-proto-sequence";

export const VARIANT_C_NAME = "Ribbon";

export default function VariantCRibbon({
    scenario,
    seq,
    reduceMotion,
}: {
    scenario: ProtoScenario;
    seq: ProtoSequence;
    reduceMotion: boolean;
}) {
    const done = seq.phase !== "revealing";
    const total = scenario.rounds.length;
    return (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-modal flex justify-center px-4">
            <div
                className="pointer-events-auto flex w-[min(96vw,640px)] cursor-pointer flex-col gap-2 rounded-xl border border-border-accent/60 bg-surface-elevated/95 px-4 py-3 shadow-lg"
                onClick={seq.skipToEnd}
            >
                <div className="flex items-baseline gap-2">
                    <span className="text-display text-sm text-text">
                        {scenario.sourceName}
                    </span>
                    <span className="text-xs text-text-muted">
                        · {flipperLine(scenario, seq.phase !== "revealing")}
                    </span>
                    {!done && (
                        <span className="ml-auto text-[10px] text-text-disabled">
                            click = skip
                        </span>
                    )}
                </div>
                <p
                    className="truncate text-[11px] italic text-text-muted"
                    title={scenario.oracleExcerpt}
                >
                    {scenario.oracleExcerpt}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                    {scenario.rounds
                        .slice(0, Math.min(total, seq.landed + 1))
                        .map((round, r) => (
                            <div
                                key={r}
                                className={`flex items-center gap-0.5 rounded-full ${round.length > 1 ? "border border-border/50 p-0.5" : ""}`}
                                title={round
                                    .map((f) => seatName(f.flipper))
                                    .join(" / ")}
                            >
                                {round.map((flip, k) => (
                                    <ProtoCoin
                                        key={k}
                                        flip={flip}
                                        state={
                                            r < seq.landed
                                                ? "landed"
                                                : r === seq.spinning
                                                  ? "spinning"
                                                  : "pending"
                                        }
                                        spinMs={seq.spinMs}
                                        size={30}
                                        reduceMotion={reduceMotion}
                                    />
                                ))}
                            </div>
                        ))}
                    {scenario.plannedRounds &&
                        done &&
                        Array.from({
                            length: scenario.plannedRounds - total,
                        }).map((_, k) => (
                            <div
                                key={`g${k}`}
                                className="h-[30px] w-[30px] rounded-full border border-dashed border-border/40 opacity-40"
                            />
                        ))}
                </div>
                {done && (
                    <p className="text-xs text-text">
                        {scenario.stopNote ? `${scenario.stopNote}. ` : ""}
                        <span className="text-display">
                            {scenario.consequence}
                        </span>
                    </p>
                )}
            </div>
        </div>
    );
}
