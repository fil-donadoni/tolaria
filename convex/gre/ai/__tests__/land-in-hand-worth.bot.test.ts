/**
 * A land in hand is priced by its holder's land count (issue #4932).
 *
 * `forcedChoiceAnswer` sheds the chooser's least valuable cards by
 * `prospectiveCardWorth`. A land held in hand used to price flat whatever its
 * holder had in play, so a player with no lands discarded them first and kept
 * spells it could not cast. CR 701.9b: the discarding player chooses, and the
 * bot's choice is the cheapest cards by worth.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { resolveTopOfStack } from "../../state";
import { enumerateMoves } from "../../moves";
import { applyMoveInSearch } from "../../search";
import { buildPositionFromSpec } from "../blade/build";
import { forcedChoiceAnswer } from "../choiceCandidates";
import { landInHandWorth, prospectiveCardWorth } from "../candidateValue";

type SpecCard = ScenarioSpec["cards"][number];

const idOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

/** Mind Rot (discard two, CR 701.9b) resolved up to the opponent's discard,
 *  the opponent holding `oppLands` lands in play. */
function midMindRot(oppHand: SpecCard[], oppLands: number): GameState {
    const s = buildPositionFromSpec({
        cards: [{ name: "Mind Rot", owner: "me", zone: "hand" }, ...oppHand],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: Math.max(4, oppLands),
        libraryCount: 20,
    });
    const me = s.activePlayerId;
    const opp = s.players.find((p) => p.id !== me)!;
    opp.battlefield = opp.battlefield
        .filter((c) => !c.types.includes("Land"))
        .concat(
            opp.battlefield
                .filter((c) => c.types.includes("Land"))
                .slice(0, oppLands)
        );
    const mindRot = s.players
        .find((p) => p.id === me)!
        .hand.find((c) => idOf(c) === getCardByName("Mind Rot").id)!;
    const cast = enumerateMoves(s, me).find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === mindRot.id &&
            (m.targets ?? []).every(
                (t) => t.type !== "player" || t.id === opp.id
            )
    );
    if (!cast) throw new Error("no Mind Rot cast at the opponent");
    applyMoveInSearch(s, me, cast);
    resolveTopOfStack(s);
    return s;
}

/** The card ids the chooser sheds under `forcedChoiceAnswer`. */
function shedIds(s: GameState): string[] {
    const choice = s.pendingChoices![0]!;
    const move = forcedChoiceAnswer(s, choice);
    if (!move || move.kind !== "resolution-choice")
        throw new Error("no forced answer");
    const opp = s.players.find((p) => p.id === choice.playerId)!;
    return (move.cardInstanceIds ?? []).map(
        (id) => idOf(opp.hand.find((c) => c.id === id)!) ?? ""
    );
}

const FOREST = getCardByName("Forest").id;
const ANGEL = getCardByName("Serra Angel").id;
const COUNTER = getCardByName("Counterspell").id;

const HAND: SpecCard[] = [
    { name: "Forest", owner: "opp", zone: "hand" },
    { name: "Serra Angel", owner: "opp", zone: "hand" },
    { name: "Counterspell", owner: "opp", zone: "hand" },
];

describe("landInHandWorth — the curve (issue #4932)", () => {
    it("falls with the holder's land count and lands on the flat worth at the flood point", () => {
        const w = [0, 1, 2, 3, 4, 5, 9].map((n) => landInHandWorth(n, 30));
        expect(w[0]).toBe(70);
        for (let i = 1; i < 5; i++) expect(w[i]).toBeLessThan(w[i - 1]!);
        expect(w[5]).toBe(30);
        expect(w[6]).toBe(30);
    });
});

describe("forcedChoiceAnswer — a land-light player keeps its land (issue #4932)", () => {
    it("CR 701.9b: at zero lands the discard of two sheds the spells, not the only land", () => {
        const s = midMindRot(HAND, 0);
        expect(shedIds(s).sort()).toEqual([ANGEL, COUNTER].sort());
    });

    it("at the flood point a land in hand is worth today's flat 30: it is shed first", () => {
        const s = midMindRot(HAND, 5);
        const opp = s.players.find((p) => p.id !== s.activePlayerId)!;
        const land = opp.hand.find((c) => idOf(c) === FOREST)!;
        expect(prospectiveCardWorth(s, land)).toBe(30);
        expect(shedIds(s)).toContain(FOREST);
    });

    it("a land NOT in hand (battlefield) keeps its flat worth whatever the land count", () => {
        const s = midMindRot(HAND, 0);
        const opp = s.players.find((p) => p.id !== s.activePlayerId)!;
        const inHand = opp.hand.find((c) => idOf(c) === FOREST)!;
        const flat = prospectiveCardWorth(
            { ...s, players: s.players.map((p) => ({ ...p, hand: [] })) },
            inHand
        );
        expect(flat).toBe(30);
    });
});
