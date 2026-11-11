import type { FlipFaceDamage, FlipRecord } from "@convex/gre/types";
import { flipCaption, flipTone } from "~/lib/random-reveal-flip";
import { faceDamageCaption } from "~/lib/random-reveal-rounds";
import CoinFlipAnimation from "~/components/board/coin-flip-animation";
import ControllerChip from "~/components/board/controller-chip";

/** Coin diameter when a round tosses two coins side by side: both fit the
 *  overlay panel at the narrowest viewport. */
const ROUND_COIN_SIZE = 84;

/** One round of a Flip Sequence several players flip each round (CR 705.2 —
 *  Mana Clash): the round's coins tossed side by side, each under its seat
 *  chip. A coin of an effect that deals damage per face is captioned with its
 *  face and what it costs ("Tails — 1 damage"); otherwise with the flip's
 *  win/loss. Every coin tosses for `durationMs`, so they land together. */
export default function FlipRoundCoins({
    round,
    faceDamage,
    seatName,
    viewerId,
    durationMs,
    skipped,
    onLanded,
}: {
    round: readonly FlipRecord[];
    faceDamage?: FlipFaceDamage;
    seatName: (id: string) => string;
    viewerId: string;
    durationMs: number;
    skipped: boolean;
    onLanded: () => void;
}) {
    return (
        <div
            data-testid="flip-round-coins"
            className="flex flex-wrap items-start justify-center gap-x-6 gap-y-2"
        >
            {round.map((flip) => (
                <div
                    key={flip.flipperId}
                    data-testid="flip-round-seat"
                    className="flex flex-col items-center gap-1"
                >
                    <ControllerChip
                        name={seatName(flip.flipperId)}
                        mine={flip.flipperId === viewerId}
                    />
                    <CoinFlipAnimation
                        face={flip.face}
                        tone={flipTone(flip)}
                        caption={
                            faceDamage
                                ? faceDamageCaption(flip.face, faceDamage)
                                : flipCaption(
                                      flip,
                                      seatName(flip.flipperId),
                                      flip.flipperId === viewerId
                                  )
                        }
                        durationMs={durationMs}
                        size={ROUND_COIN_SIZE}
                        skipped={skipped}
                        onLanded={onLanded}
                    />
                </div>
            ))}
        </div>
    );
}
