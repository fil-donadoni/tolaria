/**
 * The tree walk and the rollout answer an as-enters discard (issue #8296).
 *
 * "If this artifact would enter, you may discard a land card instead" (CR
 * 614.1a) has no in-tree candidate generator, so `decidingPlayer` returns `null`
 * at it. The walk used to stop right there and score the leaf with the spell
 * spent and the permanent still staged, before the opponent's turn every other
 * line pays for at the horizon, so casting read better than playing the land.
 * `advanceToDecision` now applies the forced answer: the reading the live Brain
 * submits (`asEntersDiscardPays`).
 */

import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { enumerateMoves } from "../../moves";
import { describeMove } from "../../describeMove";
import { advanceToDecision, applyMoveInSearch } from "../../search";
import { asEntersDiscardPays } from "../asEntersDiscard";
import { buildPositionFromSpec } from "../blade/build";
import { forcedChoiceAnswer } from "../choiceCandidates";

type SpecCard = ScenarioSpec["cards"][number];

const MOX: SpecCard = { name: "Mox Diamond", owner: "me", zone: "hand" };
const handForest = (count: number): SpecCard => ({
    name: "Forest",
    owner: "me",
    zone: "hand",
    count,
});
const playForest = (count: number): SpecCard => ({
    name: "Forest",
    owner: "me",
    zone: "battlefield",
    count,
});

/** Cast the Mox and resolve it up to its as-enters discard: the state the walk
 *  used to score as a leaf. */
function atTheWindow(spec: Partial<ScenarioSpec>): GameState {
    const s = buildPositionFromSpec({
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 0,
        libraryCount: 20,
        cards: [],
        ...spec,
    } as ScenarioSpec);
    const me = s.activePlayerId;
    const cast = enumerateMoves(s, me).find((m) =>
        describeMove(m, s).includes("Mox Diamond")
    );
    if (!cast) throw new Error("the Mox is not castable");
    applyMoveInSearch(s, me, cast);
    const opp = s.players.find((p) => p.id !== me)!.id;
    applyMoveInSearch(s, opp, { kind: "pass" });
    expect(s.pendingChoices?.[0]?.kind).toBe("discard-hand");
    return s;
}

const myBattlefield = (s: GameState) =>
    s.players.find((p) => p.id === s.activePlayerId)!.battlefield.length;

describe("the search answers an as-enters discard (CR 614.1a, issue #8296)", () => {
    it("declines on the last land while the drop is open: the land stays in hand", () => {
        const s = atTheWindow({ cards: [MOX, handForest(1)] });
        const answer = forcedChoiceAnswer(s, s.pendingChoices![0]);
        expect(answer).toMatchObject({
            kind: "resolution-choice",
            cardInstanceIds: [],
        });
    });

    it("pays out of a spare land past the drop: the permanent enters", () => {
        const s = atTheWindow({
            cards: [MOX, handForest(1), playForest(1)],
            landsPlayed: { me: 1 },
        });
        const before = myBattlefield(s);
        expect(advanceToDecision(s)).not.toBeNull();
        expect(s.pendingChoices ?? []).toEqual([]);
        expect(s.stagedEntries ?? []).toEqual([]);
        expect(myBattlefield(s)).toBe(before + 1);
    });

    it("the walk gets past the window rather than scoring a half-resolved leaf", () => {
        const s = atTheWindow({ cards: [MOX, handForest(1)] });
        expect(advanceToDecision(s)).not.toBeNull();
        expect(s.stagedEntries ?? []).toEqual([]);
    });

    it("the policy keeps the land only while it is still the mana development", () => {
        const reading = (
            landsInHand: number,
            landsInPlay: number,
            landDropOpen: boolean
        ) => asEntersDiscardPays({ landsInHand, landsInPlay, landDropOpen });
        expect(reading(0, 6, false)).toBe(false);
        expect(reading(1, 1, true)).toBe(false);
        expect(reading(1, 4, true)).toBe(true);
        expect(reading(1, 1, false)).toBe(true);
        expect(reading(2, 0, true)).toBe(true);
    });
});
