import { useEffect, useRef } from "react";
import type { FlipFace } from "@convex/gre/types";
import type { PendingChoice } from "~/types/game";
import RandomRevealOverlay from "~/components/board/random-reveal-overlay";
import { GAME_ID, ME, OPP } from "./specimen-fixtures";

/** Mana Clash's printing: its art crop, name and cost head the source row. */
const MANA_CLASH = "72955141-d990-459f-adbe-7d3d0f5f6c95";

/** An eight-round clash (caster / you): long enough that the You/Rival table
 *  is at its widest the lane is likely to see. */
const ROUNDS: readonly (readonly [FlipFace, FlipFace])[] = [
    ["heads", "tails"],
    ["tails", "tails"],
    ["heads", "tails"],
    ["tails", "tails"],
    ["tails", "heads"],
    ["tails", "tails"],
    ["heads", "tails"],
    ["heads", "heads"],
];

/** The Rival casts Mana Clash at you: the Rival is the flipper who acks, so
 *  this viewer's overlay never submits anything. */
const CLASH: PendingChoice = {
    stackItemId: "specimen-clash",
    step: 0,
    choiceId: "mana-clash-rounds",
    playerId: OPP,
    kind: "random-reveal",
    count: 1,
    prompt: "Flip a coin",
    randomKind: "coin",
    sides: 2,
    flips: ROUNDS.flatMap(([theirs, mine], round) => [
        { flipperId: OPP, face: theirs, outcome: "none" as const, round },
        { flipperId: ME, face: mine, outcome: "none" as const, round },
    ]),
    faceDamage: { heads: 0, tails: 1 },
    source: { cardId: MANA_CLASH, controllerId: OPP },
    oracleExcerpt:
        "You and target opponent each flip a coin. Mana Clash deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.",
};

/** The two-player Random Reveal (CR 705.2, issue #5520) over a fixed screen,
 *  the way the board mounts it. On mount it plays the viewer's click-to-end,
 *  so the lane measures the finished clash — every round in the table and the
 *  consequence line — rather than whichever hold between tosses it settles in.
 *  A viewer's click never acks. */
export default function RandomRevealRoundsSpecimen() {
    const layer = useRef<HTMLDivElement>(null);
    useEffect(() => {
        layer.current
            ?.querySelector<HTMLElement>(
                '[data-testid="random-reveal-overlay"]'
            )
            ?.click();
    }, []);
    return (
        <div
            ref={layer}
            data-random-reveal-specimen
            className="fixed inset-0 z-modal"
        >
            <RandomRevealOverlay
                choice={CLASH}
                playerId={ME}
                gameId={GAME_ID}
            />
        </div>
    );
}
