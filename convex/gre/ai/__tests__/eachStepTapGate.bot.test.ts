// A standing each-step engine's tapped-state intervening-if, read per side
// (issue #5578, ADR 0151, PRD #5160).
//
// The defect: Howling Mine's "if this artifact is untapped" (CR 603.4) was
// read against an untapped copy of the Mine on every side, so a Mine tapped
// on its controller's turn read exactly like an untapped one. On a real board
// it stays tapped through the opponent's next draw step and untaps in its
// controller's untap step (CR 502.3) before its controller's (CR 504.1) —
// unless an untap lock holds it, and then it feeds nobody.
//
// Every reading runs through the PRODUCTION leaf (`permanentRealisedValue`)
// over real registry definitions and asserts a direction, never a constant.
import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState } from "../../state";
import type { Phase } from "../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { permanentRealisedValue } from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { tappedOnNextStepOf } from "../latentBoard";
import { getAllCards } from "../../../cards";
import { howlingMine } from "../../../cards/sets/lea/colorless.cards";
import { stasis } from "../../../cards/sets/lea/blue.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import type {
    PermanentView,
    PhaseBeginEvent,
    TriggerStateView,
} from "../../../cards/types";

const MINE = howlingMine().id;
const BEAR = grizzlyBears().id;
const STASIS = stasis().id;

interface MineBoard {
    ownHand: number;
    oppHand: number;
    tapped?: boolean;
    active?: "p1" | "p2";
    phase?: Phase;
    /** A Stasis on the opponent's side (CR 502.3 hard skip). */
    stasis?: boolean;
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

/** p1 controls a Howling Mine; each side's hand is Grizzly Bears, its
 *  library twenty more. */
function board(b: MineBoard): GameState {
    const mine = makeInstance(MINE, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: b.tapped === true,
    });
    const p1 = makePlayer("p1", {
        hand: cards("p1", BEAR, b.ownHand, "hand"),
        library: cards("p1", BEAR, 20, "library"),
        battlefield: [mine],
    });
    const p2 = makePlayer("p2", {
        hand: cards("p2", BEAR, b.oppHand, "hand"),
        library: cards("p2", BEAR, 20, "library"),
        battlefield: b.stasis ? cards("p2", STASIS, 1, "battlefield") : [],
    });
    return makeState({
        players: [p1, p2],
        activePlayerId: b.active ?? "p1",
        priorityPlayerId: b.active ?? "p1",
        phase: b.phase ?? "PRECOMBAT_MAIN",
    });
}

/** The Mine's own worth on p1's board: its realised value minus the flat
 *  presence every permanent carries. */
function mineWorth(state: GameState): number {
    const mine = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, mine) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

describe("a tapped each-step engine misses the steps before it untaps (issue #5578)", () => {
    it("tapped on its controller's turn, the Mine skips the opponent's next draw and reads higher for its controller", () => {
        // Both players have room in hand: untapped, the two extra draws net
        // out; tapped, only the controller's (after its untap step) is left.
        const untapped = board({ ownHand: 2, oppHand: 2 });
        const tapped = board({ ownHand: 2, oppHand: 2, tapped: true });
        expect(mineWorth(tapped)).toBeGreaterThan(mineWorth(untapped));
    });

    it("tapped on the opponent's turn past its draw step, the Mine untaps before either next draw step", () => {
        const untapped = board({ ownHand: 1, oppHand: 4, active: "p2" });
        const tapped = board({
            ownHand: 1,
            oppHand: 4,
            active: "p2",
            tapped: true,
        });
        expect(mineWorth(tapped)).toBe(mineWorth(untapped));
    });

    it("under an untap lock that keeps it tapped, the engine reads 0 on both sides", () => {
        // Stasis skips every untap step (CR 502.3 hard skip): the Mine feeds
        // nobody, so its worth no longer depends on whose hand has room.
        const feedsOwn = board({
            ownHand: 1,
            oppHand: 7,
            tapped: true,
            stasis: true,
        });
        const feedsOpp = board({
            ownHand: 7,
            oppHand: 1,
            tapped: true,
            stasis: true,
        });
        expect(mineWorth(feedsOwn)).toBe(mineWorth(feedsOpp));
        // Unlocked, the same two boards read apart (the reading is live).
        expect(
            mineWorth(board({ ownHand: 1, oppHand: 7, tapped: true }))
        ).not.toBe(mineWorth(board({ ownHand: 7, oppHand: 1, tapped: true })));
    });
});

describe("tappedOnNextStepOf — CR 502.3 / 504.1 turn timeline", () => {
    const mineOf = (s: GameState) => s.players[0].battlefield[0];
    it("an untapped source stays untapped on every side", () => {
        const s = board({ ownHand: 0, oppHand: 0 });
        expect(tappedOnNextStepOf(s, mineOf(s), "p1")).toBe(false);
        expect(tappedOnNextStepOf(s, mineOf(s), "p2")).toBe(false);
    });

    it("tapped in its controller's upkeep, it misses this turn's draw step", () => {
        const s = board({
            ownHand: 0,
            oppHand: 0,
            tapped: true,
            phase: "UPKEEP",
        });
        expect(tappedOnNextStepOf(s, mineOf(s), "p1")).toBe(true);
        expect(tappedOnNextStepOf(s, mineOf(s), "p2")).toBe(true);
    });

    it("tapped in the opponent's upkeep, it misses the opponent's draw step this turn only", () => {
        const s = board({
            ownHand: 0,
            oppHand: 0,
            tapped: true,
            active: "p2",
            phase: "UPKEEP",
        });
        expect(tappedOnNextStepOf(s, mineOf(s), "p2")).toBe(true);
        expect(tappedOnNextStepOf(s, mineOf(s), "p1")).toBe(false);
    });

    it("a source-held lock keeps it tapped on its controller's step too", () => {
        const s = board({ ownHand: 0, oppHand: 0, tapped: true });
        mineOf(s).untapLockedBy = ["lock-source"];
        expect(tappedOnNextStepOf(s, mineOf(s), "p1")).toBe(true);
    });
});

describe("sourceTapCondition restates the interveningIf closure (issue #5578)", () => {
    it("every declaring ability's closure agrees with its declaration on a tapped and an untapped source", () => {
        const declaring = getAllCards().flatMap((def) =>
            (def.triggeredAbilities ?? []).filter(
                (t) => t.sourceTapCondition !== undefined
            )
        );
        // Howling Mine is the census (each-step, tapped-state intervening-if).
        expect(declaring.length).toBeGreaterThan(0);
        const event: PhaseBeginEvent = {
            type: "PHASE_BEGIN",
            phase: "DRAW",
            activePlayerId: "p1",
        };
        const state = board({ ownHand: 0, oppHand: 0 });
        for (const ability of declaring) {
            expect(ability.interveningIf).toBeDefined();
            for (const isTapped of [true, false]) {
                const self = {
                    ...state.players[0].battlefield[0],
                    isTapped,
                } as unknown as PermanentView;
                const closure = ability.interveningIf!(
                    event,
                    self,
                    state as unknown as TriggerStateView
                );
                const declared =
                    isTapped === (ability.sourceTapCondition === "tapped");
                expect(closure, ability.id).toBe(declared);
            }
        }
    });
});
