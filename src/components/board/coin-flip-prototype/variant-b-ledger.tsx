// PROTOTYPE (issue #4433) — Variant B "Ledger": dimmed board, wide panel. The
// card (name + Oracle excerpt) sits on the left like a card frame; the right is
// a grid — one LANE per flipper, one COLUMN per round. Every slot is visible
// from the start (dashed), coins land left to right, a stop marker shows where
// the series ended; Squee's unflipped slots stay dashed and greyed.
import { Panel } from "~/components/ui/panel";
import ProtoCoin from "./proto-coin";
import {
    flipperLine,
    seatName,
    type ProtoScenario,
    type Seat,
} from "./prototype-scenarios";
import type { ProtoSequence } from "./use-proto-sequence";

export const VARIANT_B_NAME = "Ledger";

export default function VariantBLedger({
    scenario,
    seq,
    reduceMotion,
}: {
    scenario: ProtoScenario;
    seq: ProtoSequence;
    reduceMotion: boolean;
}) {
    const lanes: Seat[] = [
        ...new Set(scenario.rounds.flat().map((f) => f.flipper)),
    ];
    const total = scenario.rounds.length;
    // Unknown-length series (Mana Clash) grow column by column — no spoiler.
    const slots = scenario.plannedRounds ?? Math.min(total, seq.landed + 1);
    const coin = total > 8 ? 34 : total > 4 ? 44 : 64;
    const done = seq.phase !== "revealing";
    return (
        <div
            className="absolute inset-0 z-modal flex cursor-pointer items-center justify-center modal-scrim"
            onClick={seq.skipToEnd}
        >
            <Panel
                density="compact"
                className="flex w-[min(96vw,860px)] flex-col gap-3 px-5 py-4 sm:flex-row sm:items-stretch"
            >
                <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-border-accent/50 bg-surface-elevated/60 p-3 sm:w-56">
                    <p className="text-display text-sm text-text">
                        {scenario.sourceName}
                    </p>
                    <p className="text-[11px] leading-snug text-text-muted">
                        {scenario.oracleExcerpt}
                    </p>
                    <p className="mt-auto text-[11px] text-text">
                        Controller: {seatName(scenario.sourceController)}
                    </p>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p className="text-xs text-text">
                        {flipperLine(scenario, seq.phase !== "revealing")}
                    </p>
                    <div className="overflow-x-auto">
                        <table className="border-separate border-spacing-1">
                            <thead>
                                <tr>
                                    <th />
                                    {Array.from({ length: slots }).map(
                                        (_, c) => (
                                            <th
                                                key={c}
                                                className="text-[10px] font-normal text-text-disabled"
                                            >
                                                {c + 1}
                                            </th>
                                        )
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {lanes.map((seat) => (
                                    <tr key={seat}>
                                        <td className="pr-2 text-xs text-text-muted">
                                            {seatName(seat)}
                                        </td>
                                        {Array.from({ length: slots }).map(
                                            (_, c) => {
                                                const flip = scenario.rounds[
                                                    c
                                                ]?.find(
                                                    (f) => f.flipper === seat
                                                );
                                                const isStop =
                                                    done &&
                                                    c === total - 1 &&
                                                    !!scenario.stopNote;
                                                return (
                                                    <td
                                                        key={c}
                                                        className={
                                                            isStop
                                                                ? "rounded-md outline outline-2 outline-offset-1 outline-border-accent"
                                                                : ""
                                                        }
                                                    >
                                                        {flip ? (
                                                            <ProtoCoin
                                                                flip={flip}
                                                                state={
                                                                    c <
                                                                    seq.landed
                                                                        ? "landed"
                                                                        : c ===
                                                                            seq.spinning
                                                                          ? "spinning"
                                                                          : "pending"
                                                                }
                                                                spinMs={
                                                                    seq.spinMs
                                                                }
                                                                size={coin}
                                                                reduceMotion={
                                                                    reduceMotion
                                                                }
                                                            />
                                                        ) : (
                                                            <div
                                                                className={`rounded-full border-dashed ${done ? "border border-border/40 opacity-40" : "border-2 border-border/60"}`}
                                                                style={{
                                                                    width: coin,
                                                                    height: coin,
                                                                }}
                                                                title="Not flipped"
                                                            />
                                                        )}
                                                    </td>
                                                );
                                            }
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="min-h-10">
                        {done ? (
                            <>
                                {scenario.stopNote && (
                                    <p className="text-[11px] text-text-muted">
                                        ⟂ {scenario.stopNote}
                                    </p>
                                )}
                                <p className="text-display text-sm text-text">
                                    {scenario.consequence}
                                </p>
                            </>
                        ) : (
                            <p className="text-[10px] text-text-disabled">
                                Click anywhere to skip to the result
                            </p>
                        )}
                    </div>
                </div>
            </Panel>
        </div>
    );
}
