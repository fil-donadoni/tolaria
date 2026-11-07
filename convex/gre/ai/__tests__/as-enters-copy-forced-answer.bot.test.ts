/**
 * The search answers an as-enters copy, and prices entry counters (issue #8177).
 *
 * An as-enters copy (CR 614.1c, CR 707.5) parks the permanent behind a choice
 * with no in-tree candidate generator, so `decidingPlayer` returns `null` there.
 * The walk used to stop and score the spell spent with no body anywhere, which
 * is why the Bot never cast Phantasmal Image or Phyrexian Metamorph.
 *
 * The hand term read a creature's printed body, so Moonshadow (a 7/7 entering
 * with six -1/-1 counters, CR 122.6) was worth more held than cast.
 */

import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import { tryGetCardByName } from "../../../cards";
import { cardValueById, entryCounterPtDelta } from "../../cardValue";
import { describeMove } from "../../describeMove";
import { cardValue } from "../../evaluate";
import { getEffectivePT } from "../../layers";
import { enumerateMoves } from "../../moves";
import { advanceToDecision, applyMoveInSearch } from "../../search";
import type { GameState } from "../../state";
import { buildPositionFromSpec } from "../blade/build";
import { forcedChoiceAnswer } from "../choiceCandidates";

type SpecCard = ScenarioSpec["cards"][number];

const IMAGE: SpecCard = {
    name: "Phantasmal Image",
    owner: "me",
    zone: "hand",
};
const ISLANDS: SpecCard = {
    name: "Island",
    owner: "me",
    zone: "battlefield",
    count: 2,
};

/** Cast the clone and resolve it up to its as-enters copy choice. */
function atTheWindow(board: SpecCard[]): GameState {
    const s = buildPositionFromSpec({
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 0,
        libraryCount: 20,
        cards: [IMAGE, ISLANDS, ...board],
    } as ScenarioSpec);
    const me = s.activePlayerId;
    const cast = enumerateMoves(s, me).find((m) =>
        describeMove(m, s).includes("Phantasmal Image")
    );
    if (!cast) throw new Error("the clone is not castable");
    applyMoveInSearch(s, me, cast);
    const opp = s.players.find((p) => p.id !== me)!.id;
    applyMoveInSearch(s, opp, { kind: "pass" });
    expect(s.pendingChoices?.[0]?.asEntersKind).toBe("copy");
    return s;
}

const onBoard = (name: string, owner: "me" | "opp"): SpecCard => ({
    name,
    owner,
    zone: "battlefield",
});

describe("the search answers an as-enters copy (CR 707.5, issue #8177)", () => {
    it("copies the best body on either side of the board", () => {
        const s = atTheWindow([
            onBoard("Grizzly Bears", "me"),
            onBoard("Serra Angel", "opp"),
        ]);
        const answer = forcedChoiceAnswer(s, s.pendingChoices![0]!);
        const angel = s.players
            .flatMap((p) => p.battlefield)
            .find((c) => getEffectivePT(s, c).power === 4)!;
        expect(answer).toMatchObject({
            kind: "resolution-choice",
            cardInstanceIds: [angel.id],
        });
    });

    it("the walk gets past the window, and the clone enters as the copy", () => {
        const s = atTheWindow([onBoard("Serra Angel", "opp")]);
        advanceToDecision(s);
        const me = s.players.find((p) => p.id === s.activePlayerId)!;
        expect(s.pendingChoices ?? []).toHaveLength(0);
        const creatures = me.battlefield.filter((c) =>
            c.types.includes("Creature")
        );
        expect(creatures.map((c) => getEffectivePT(s, c))).toMatchObject([
            { power: 4, toughness: 4 },
        ]);
    });
});

describe("a creature in hand is priced by the body it enters with (CR 122.6, issue #8177)", () => {
    const moonshadow = tryGetCardByName("Moonshadow")!;

    it("reads fixed P/T counters, and nothing it cannot know in hand", () => {
        expect(entryCounterPtDelta(moonshadow)).toEqual({
            power: -6,
            toughness: -6,
        });
        expect(
            entryCounterPtDelta({
                entersWith: {
                    counters: [
                        { type: "+1/+1", count: "X" },
                        { type: "charge", count: 3 },
                    ],
                },
            })
        ).toEqual({ power: 0, toughness: 0 });
    });

    it("the latent worth reads the entered body, not the printed 7/7", () => {
        expect(cardValueById(moonshadow.id)).toBeLessThan(
            cardValueById(tryGetCardByName("Serra Angel")!.id)
        );
    });

    it("the hand term reads it too: the same worth by instance as by id", () => {
        const s = buildPositionFromSpec({
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
            cards: [{ name: "Moonshadow", owner: "me", zone: "hand" }],
        } as ScenarioSpec);
        const held = s.players
            .flatMap((p) => p.hand)
            .find((c) => c.card.id === moonshadow.id)!;
        expect(cardValue(s, held)).toBeCloseTo(cardValueById(moonshadow.id));
    });
});
