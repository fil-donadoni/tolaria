import type { FlipFaceDamage, FlipRecord } from "@convex/gre/types";
import { flipTone } from "~/lib/random-reveal-flip";
import { flipperDamage, roundCount } from "~/lib/random-reveal-rounds";
import ControllerChip from "~/components/board/controller-chip";
import CoinMoonGlyph from "~/components/board/coin-moon-glyph";
import CoinSunGlyph from "~/components/board/coin-sun-glyph";

/** The landed rounds of a Flip Sequence several players flip each round
 *  (CR 705.2 — Mana Clash), under the coins: one row per seat (You / the
 *  opponent), one column per landed round holding that seat's sun or moon
 *  mini-coin, then the seat's Damage total when the effect deals damage per
 *  face. Columns appear as rounds land, so the table never hints at how many
 *  rounds the sequence has. */
export default function FlipRoundTable({
    landed,
    flipperIds,
    faceDamage,
    seatName,
    viewerId,
}: {
    landed: readonly FlipRecord[];
    flipperIds: readonly string[];
    faceDamage?: FlipFaceDamage;
    seatName: (id: string) => string;
    viewerId: string;
}) {
    const rounds = roundCount(landed);
    if (rounds === 0) return null;
    const columns = Array.from({ length: rounds }, (_, i) => i);
    return (
        <div className="w-full overflow-x-auto">
            <table
                data-testid="flip-round-table"
                className="mx-auto border-separate border-spacing-x-1 border-spacing-y-1 text-[10px]"
            >
                <thead>
                    <tr className="text-text-disabled">
                        <th scope="col" className="sr-only">
                            Seat
                        </th>
                        {columns.map((round) => (
                            <th
                                key={round}
                                scope="col"
                                className="w-5 font-normal tabular-nums"
                            >
                                {round + 1}
                            </th>
                        ))}
                        {faceDamage && (
                            <th
                                scope="col"
                                className="pl-2 text-left font-semibold tracking-wide uppercase"
                            >
                                Damage
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {flipperIds.map((id) => (
                        <tr key={id} data-testid="flip-round-row">
                            <th scope="row" className="pr-1 text-left">
                                <ControllerChip
                                    name={seatName(id)}
                                    mine={id === viewerId}
                                />
                            </th>
                            {columns.map((round) => {
                                const flip = landed.find(
                                    (f) =>
                                        f.round === round && f.flipperId === id
                                );
                                if (!flip) return <td key={round} />;
                                const Glyph =
                                    flip.face === "tails"
                                        ? CoinMoonGlyph
                                        : CoinSunGlyph;
                                const good = flipTone(flip) === "good";
                                return (
                                    <td key={round} className="text-center">
                                        <span
                                            data-testid="flip-round-coin"
                                            data-face={flip.face}
                                            role="img"
                                            aria-label={
                                                flip.face === "heads"
                                                    ? "Heads"
                                                    : "Tails"
                                            }
                                            className={`inline-flex size-5 items-center justify-center rounded-full border ${
                                                good
                                                    ? "border-success-strong text-success-strong"
                                                    : "border-danger text-danger"
                                            }`}
                                        >
                                            <Glyph className="size-3" />
                                        </span>
                                    </td>
                                );
                            })}
                            {faceDamage && (
                                <td
                                    data-testid="flip-round-damage"
                                    className="pl-2 text-sm font-semibold text-text tabular-nums"
                                >
                                    {flipperDamage(landed, id, faceDamage)}
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
