// Standing each-step engines — the discard at random family (issue #5624,
// ADR 0151, PRD #5160).
//
// The defect: Bottomless Pit's trigger has the player whose upkeep it is
// discard a card at random (`$event.activePlayerId`, `phaseScope: "each"`,
// CR 603.2b), and issue #5575 left it reading NOTHING on every board — the
// Latent Floor, the same on the board where only its controller holds cards.
// On a real board the discard is now read per side
// (`EachPlayerSide.randomDiscardUnits`): the MEAN of that player's hand times
// the count (CR 701.9b — random, not the chooser's cheapest), an empty hand
// losing nothing; the opponent's loss minus the controller's.
//
// Readings run through the PRODUCTION leaf (`permanentRealisedValue`,
// `cardValue` with the hand term's lens) over the real registry definition.
import { describe, expect, it } from "vitest";
import { registeredDefinitions } from "../../../cards";
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
import { forest } from "../../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";

function pitId(): string {
    for (const def of registeredDefinitions()) {
        if (def.name === "Bottomless Pit") return def.id;
    }
    throw new Error("Bottomless Pit is not in the registry");
}

const PIT = pitId();
const BASIC = forest().id;
const BEAR = grizzlyBears().id;

interface Side {
    hand: number;
    pit?: "board" | "hand";
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

/** p1 controls (or holds) Bottomless Pit; each side controls three Forests
 *  and holds `hand` Grizzly Bears. */
function board(own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...cards(pid, BEAR, s.hand, "hand"),
                ...(s.pit === "hand" ? cards(pid, PIT, 1, "hand") : []),
            ],
            library: cards(pid, BEAR, 20, "library"),
            battlefield: [
                ...(s.pit === "board" ? cards(pid, PIT, 1, "battlefield") : []),
                ...cards(pid, BASIC, 3, "battlefield"),
            ],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** Bottomless Pit's own worth on p1's board: its realised value minus the
 *  flat presence every permanent carries. */
function pitWorth(state: GameState): number {
    const pit = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, pit) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

describe("a standing each-step discard at random reads the board (issue #5624)", () => {
    it("the family's script is read by the Differential", () => {
        const def = [...registeredDefinitions()].find((d) => d.id === PIT)!;
        const t = def.triggeredAbilities![0];
        expect(isEachStepEngineScript((t.effects ?? t.aiEffects)!)).toBe(true);
    });

    it("Bottomless Pit is worth what it takes from the side holding cards, and the sign flips on the mirror", () => {
        // CR 701.9b — an empty hand discards nothing.
        const theirs = board({ hand: 0, pit: "board" }, { hand: 3 });
        const mine = board({ hand: 3, pit: "board" }, { hand: 0 });
        expect(pitWorth(theirs)).toBeGreaterThan(0);
        expect(pitWorth(mine)).toBeLessThan(0);
        expect(pitWorth(theirs)).toBeCloseTo(-pitWorth(mine), 6);
        for (const s of [theirs, mine]) {
            expect(Math.abs(pitWorth(s))).toBeLessThan(MAX_LATENT_SCRIPT_VALUE);
        }
    });

    it("hand face equals board face on the same board, whatever the sign", () => {
        const faces = (own: number, opp: number) => {
            const held = board({ hand: own, pit: "hand" }, { hand: opp });
            const inHand = held.players[0].hand.find(
                (c) => String(c.card.id) === PIT
            )!;
            return {
                handFace: cardValue(
                    held,
                    inHand,
                    handLatentLens(held, "p1", inHand)
                ),
                boardFace: pitWorth(
                    board({ hand: own, pit: "board" }, { hand: opp })
                ),
            };
        };
        const takes = faces(0, 3);
        expect(takes.handFace).toBeGreaterThan(0);
        expect(takes.handFace).toBeCloseTo(takes.boardFace, 6);
        const costs = faces(3, 0);
        expect(costs.handFace).toBeLessThan(0);
        expect(costs.handFace).toBeCloseTo(costs.boardFace, 6);
    });
});
