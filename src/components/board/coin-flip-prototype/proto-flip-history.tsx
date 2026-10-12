// PROTOTYPE (issue #4433) — readable history of the landed flips, replacing
// the cryptic "Y:H" chips. One-player series: numbered steps, each a small
// coin face + "Win"/"Lose" (unflipped slots after the stop say so). Two-player
// rounds: a You/Bot table, one column per round, tails marked with its damage.
import { MoonGlyph, SunGlyph } from "./proto-coin-glyphs";
import {
    isGood,
    seatName,
    type ProtoFlip,
    type ProtoScenario,
    type Seat,
} from "./prototype-scenarios";

function MiniCoin({ flip }: { flip: ProtoFlip }) {
    const good = isGood(flip);
    return (
        <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                good
                    ? "border-success/70 bg-success-soft/50 text-success-strong"
                    : "border-danger/60 bg-danger/15 text-danger"
            }`}
            title={flip.face === "heads" ? "Heads" : "Tails"}
        >
            {flip.face === "heads" ? (
                <SunGlyph className="h-4 w-4" />
            ) : (
                <MoonGlyph className="h-4 w-4" />
            )}
        </span>
    );
}

export default function ProtoFlipHistory({
    scenario,
    landed,
    done,
}: {
    scenario: ProtoScenario;
    landed: number;
    done: boolean;
}) {
    const rounds = scenario.rounds.slice(0, landed);
    const seats: Seat[] = [
        ...new Set(scenario.rounds.flat().map((f) => f.flipper)),
    ];
    if (scenario.rounds.length < 2 || rounds.length === 0) return null;

    if (seats.length === 1) {
        const ghosts =
            done && scenario.plannedRounds
                ? scenario.plannedRounds - scenario.rounds.length
                : 0;
        return (
            <ol className="flex max-w-full flex-wrap justify-center gap-2">
                {rounds.map((round, i) => {
                    const f = round[0];
                    return (
                        <li
                            key={i}
                            className="flex flex-col items-center gap-0.5"
                        >
                            <MiniCoin flip={f} />
                            <span
                                className={`text-[10px] ${isGood(f) ? "text-success-strong" : "text-danger"}`}
                            >
                                {i + 1} ·{" "}
                                {f.outcome === "win"
                                    ? "Win"
                                    : f.outcome === "lose"
                                      ? "Lose"
                                      : f.face}
                            </span>
                        </li>
                    );
                })}
                {Array.from({ length: ghosts }).map((_, k) => (
                    <li
                        key={`g${k}`}
                        className="flex flex-col items-center gap-0.5 opacity-50"
                    >
                        <span className="h-6 w-6 rounded-full border border-dashed border-border" />
                        <span className="text-[10px] text-text-disabled">
                            {rounds.length + k + 1} · not flipped
                        </span>
                    </li>
                ))}
            </ol>
        );
    }

    return (
        <div className="max-w-full overflow-x-auto">
            <table className="border-separate border-spacing-x-1 border-spacing-y-0.5 text-[10px]">
                <thead>
                    <tr>
                        <th className="pr-1 text-left font-normal text-text-disabled">
                            Round
                        </th>
                        {rounds.map((_, i) => (
                            <th
                                key={i}
                                className="font-normal text-text-disabled"
                            >
                                {i + 1}
                            </th>
                        ))}
                        <th className="pl-2 text-left font-normal text-text-disabled">
                            Damage
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {seats.map((seat) => {
                        const flips = rounds.map(
                            (r) => r.find((f) => f.flipper === seat)!
                        );
                        const dmg = flips.filter(
                            (f) => f.face === "tails"
                        ).length;
                        return (
                            <tr key={seat}>
                                <td className="pr-1 text-text-muted">
                                    {seatName(seat)}
                                </td>
                                {flips.map((f, i) => (
                                    <td key={i}>
                                        <MiniCoin flip={f} />
                                    </td>
                                ))}
                                <td
                                    className={`pl-2 font-semibold ${dmg ? "text-danger" : "text-text-muted"}`}
                                >
                                    {dmg ? `−${dmg}` : "0"}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
