// Standing each-step engines — the return to hand family (issue #5628,
// ADR 0151, PRD #5160).
//
// The defect: Sunken Hope's trigger has the player whose upkeep it is return
// a creature it controls to its owner's hand (`$event.activePlayerId`,
// `phaseScope: "each"`, CR 603.2b), and issue #5575 left it reading NOTHING
// on every board — the Latent Floor, the same on the board where only its
// controller has creatures. On a real board the bounce is now read per side
// (`EachPlayerSide.bounceUnits`): the chooser's cheapest creature, net of its
// worth back in hand (the `returnsToHand` sweep outcome), a side with no
// creature losing nothing; the opponent's loss minus the controller's.
//
// Readings run through the PRODUCTION leaf (`permanentRealisedValue`,
// `cardValue` with the hand term's lens) over the real registry definition.
import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState } from "../../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import {
    cardValue,
    handLatentLens,
    permanentRealisedValue,
} from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { MAX_LATENT_SCRIPT_VALUE } from "../../cardValue";
import { isEachStepEngineScript } from "../opValuers";
import { island } from "../../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { sunkenHope } from "../../../cards/sets/pls/blue.cards";

const HOPE = sunkenHope().id;
const BASIC = island().id;
const BEAR = grizzlyBears().id;

interface Side {
    creatures: number;
    hope?: "board" | "hand";
}

function cards(
    pid: string,
    id: string,
    n: number,
    where: CardInstanceState["zone"]
): CardInstanceState[] {
    return Array.from({ length: n }, () =>
        makeInstance(id, { controllerId: pid, ownerId: pid, zone: where })
    );
}

/** p1 controls (or holds) Sunken Hope; each side controls three Islands and
 *  `creatures` Grizzly Bears, two Grizzly Bears in hand. */
function board(own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...cards(pid, BEAR, 2, "hand"),
                ...(s.hope === "hand" ? cards(pid, HOPE, 1, "hand") : []),
            ],
            library: cards(pid, BEAR, 20, "library"),
            battlefield: [
                ...(s.hope === "board"
                    ? cards(pid, HOPE, 1, "battlefield")
                    : []),
                ...cards(pid, BASIC, 3, "battlefield"),
                ...cards(pid, BEAR, s.creatures, "battlefield"),
            ],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** Sunken Hope's own worth on p1's board: its realised value minus the flat
 *  presence every permanent carries. */
function hopeWorth(state: GameState): number {
    const hope = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, hope) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

describe("a standing each-step return to hand reads the board (issue #5628)", () => {
    it("the family's script is read by the Differential", () => {
        const t = sunkenHope().triggeredAbilities![0];
        expect(isEachStepEngineScript((t.effects ?? t.aiEffects)!)).toBe(true);
    });

    it("Sunken Hope is worth what it takes from the side with creatures, and the sign flips on the mirror", () => {
        // A side with no creature returns nothing.
        const theirs = board({ creatures: 0, hope: "board" }, { creatures: 2 });
        const mine = board({ creatures: 2, hope: "board" }, { creatures: 0 });
        expect(hopeWorth(theirs)).toBeGreaterThan(0);
        expect(hopeWorth(mine)).toBeLessThan(0);
        expect(hopeWorth(theirs)).toBeCloseTo(-hopeWorth(mine), 6);
        for (const s of [theirs, mine]) {
            expect(Math.abs(hopeWorth(s))).toBeLessThan(
                MAX_LATENT_SCRIPT_VALUE
            );
        }
    });

    it("two even sides net out to a measured zero, never the Latent Floor", () => {
        const even = board({ creatures: 1, hope: "board" }, { creatures: 1 });
        expect(hopeWorth(even)).toBeCloseTo(0, 6);
    });

    it("hand face equals board face on the same board, whatever the sign", () => {
        const faces = (own: number, opp: number) => {
            const held = board(
                { creatures: own, hope: "hand" },
                { creatures: opp }
            );
            const inHand = held.players[0].hand.find(
                (c) => String(c.card.id) === HOPE
            )!;
            return {
                handFace: cardValue(
                    held,
                    inHand,
                    handLatentLens(held, "p1", inHand)
                ),
                boardFace: hopeWorth(
                    board({ creatures: own, hope: "board" }, { creatures: opp })
                ),
            };
        };
        const takes = faces(0, 2);
        expect(takes.handFace).toBeGreaterThan(0);
        expect(takes.handFace).toBeCloseTo(takes.boardFace, 6);
        const costs = faces(2, 0);
        expect(costs.handFace).toBeLessThan(0);
        expect(costs.handFace).toBeCloseTo(costs.boardFace, 6);
    });
});
