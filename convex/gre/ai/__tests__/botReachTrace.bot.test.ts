// The decision behind a Bot Findings refusal (issue #4179) — the projection is
// BOUNDED whatever the search weighed, because it is committed in
// `data/bot-reach-findings.json` once per refused card.

import { describe, expect, it } from "vitest";
import type { EvalTerms } from "../../evaluate";
import type { CandidateTrace, DecisionTrace } from "../../search";
import type { Move } from "../../moves";
import {
    BOT_REACH_TRACE_LABEL_MAX,
    BOT_REACH_TRACE_MAX_CANDIDATES,
    projectBotReachTrace,
} from "../botReachTrace";

/** The per-row byte cap the artifact is held to: the largest projection the
 *  bounds allow — every candidate slot filled, every label at its cap, every
 *  term non-zero on both sides — serializes under it. */
const TRACE_ROW_BYTES_MAX = 4096;

/** Every `EvalTerms` key — `satisfies` makes a new term red here, so the
 *  worst case below stays the worst case. */
const TERM_KEYS = Object.keys({
    life: true,
    hand: true,
    creatures: true,
    permanents: true,
    mana: true,
    finiteManaUses: true,
    manaDevelopment: true,
    colorCoverage: true,
    flexibility: true,
    library: true,
    graveyard: true,
    graveyardReach: true,
} satisfies Record<keyof EvalTerms, true>) as (keyof EvalTerms)[];

function terms(v: number): EvalTerms {
    return Object.fromEntries(TERM_KEYS.map((k) => [k, v])) as EvalTerms;
}

function candidate(
    label: string,
    visits: number,
    move: Move,
    value = 123.456789
): CandidateTrace {
    return {
        label,
        move,
        visits,
        meanReward: 0.123456,
        meanMargin: 1,
        avail: visits,
        eval: {
            self: terms(value),
            opp: terms(-value),
            margin: 0,
            danger: 0,
            total: -98765.4321,
        },
    };
}

const PASS: Move = { kind: "pass" };
const cast = (id: string): Move =>
    ({ kind: "cast-spell", cardInstanceId: id }) as Move;

function trace(candidates: CandidateTrace[], chosen: string): DecisionTrace {
    return {
        botId: "p1",
        chosen,
        iterationsCompleted: 48,
        iterationsRequested: 48,
        elapsedMs: 12.3,
        stoppedBy: "iterations",
        mechanism: "mean-reward",
        candidates,
    };
}

describe("projectBotReachTrace (issue #4179)", () => {
    it("chosen first, the card's move second, then alternatives by visits", () => {
        const t = trace(
            [
                candidate("Pass", 30, PASS),
                candidate("Cast Bear", 10, cast("bear")),
                candidate("Cast Card", 5, cast("card")),
            ],
            "Pass"
        );
        const { cardMove, search } = projectBotReachTrace(t, PASS, "card");
        expect(cardMove).toBe("weighed");
        expect(search!.candidates.map((c) => [c.role, c.label])).toEqual([
            ["chosen", "Pass"],
            ["card", "Cast Card"],
            ["alternative", "Cast Bear"],
        ]);
        expect(search!.weighed).toBe(3);
        expect(search!.mechanism).toBe("mean-reward");
    });

    it("no trace → the root fate alone; a card move absent from the candidates is unexpanded", () => {
        expect(projectBotReachTrace(null, null, "card", "pruned")).toEqual({
            cardMove: "pruned",
        });
        const t = trace([candidate("Pass", 30, PASS)], "Pass");
        expect(projectBotReachTrace(t, PASS, "card").cardMove).toBe(
            "unexpanded"
        );
    });

    // Review of issue #4179, finding 1: a card can lose one move at the root
    // (a collapsed target, a pruned mode) and still be weighed through
    // another — then the search's answer is the answer.
    it("a weighed card move outranks the root fate", () => {
        const t = trace(
            [
                candidate("Pass", 30, PASS),
                candidate("Cast Card", 5, cast("card")),
            ],
            "Pass"
        );
        expect(
            projectBotReachTrace(t, PASS, "card", "collapsed").cardMove
        ).toBe("weighed");
    });

    // Review of issue #4179, finding 3: labels are not unique, so the chosen
    // candidate is the edge whose MOVE is the one returned — here the
    // less-visited of two same-label edges.
    it("identifies the chosen candidate by its move, never by its label", () => {
        const bearA = cast("bolt-a");
        const bearB = { ...cast("bolt-b") };
        const t = trace(
            [
                candidate("cast Bolt → Grizzly Bears", 30, bearA),
                candidate("cast Bolt → Grizzly Bears", 10, bearB),
                candidate("Cast Card", 5, cast("card")),
            ],
            "cast Bolt → Grizzly Bears"
        );
        const { search } = projectBotReachTrace(t, bearB, "card");
        const chosen = search!.candidates.find((c) => c.role === "chosen")!;
        expect(chosen.visits).toBe(10);
    });

    it("an unavailable breakdown records no terms", () => {
        const c = { ...candidate("Pass", 3, PASS), unavailable: true };
        const { search } = projectBotReachTrace(
            trace([c], "Pass"),
            PASS,
            "card"
        );
        expect(search!.candidates[0]!.terms).toBeUndefined();
    });

    it("drops zero terms and rounds to two decimals", () => {
        const c = candidate("Pass", 3, PASS);
        c.eval.self.life = 20.004;
        c.eval.opp.life = 18;
        c.eval.self.hand = 0;
        c.eval.opp.hand = 0;
        const { search } = projectBotReachTrace(
            trace([c], "Pass"),
            PASS,
            "card"
        );
        const t = search!.candidates[0]!.terms!;
        expect(t.life).toEqual([20, 18]);
        expect(t.hand).toBeUndefined();
        expect(search!.candidates[0]!.meanReward).toBe(0.12);
    });

    it("stays under the per-row cap however much the search weighed", () => {
        // Multi-byte on purpose: the cap is in BYTES, as the file is.
        const long = "É".repeat(500);
        const many = Array.from({ length: 40 }, (_, i) =>
            candidate(`${long}${i}`, 100 - i, cast(`c${i}`))
        );
        const projected = projectBotReachTrace(
            trace(many, `${long}0`),
            cast("c0"),
            "c39"
        );
        const { search } = projected;
        expect(search!.candidates).toHaveLength(BOT_REACH_TRACE_MAX_CANDIDATES);
        expect(search!.candidates[1]!.role).toBe("card");
        for (const c of search!.candidates)
            expect(c.label.length).toBeLessThanOrEqual(
                BOT_REACH_TRACE_LABEL_MAX
            );
        expect(
            Buffer.byteLength(JSON.stringify(projected), "utf8")
        ).toBeLessThanOrEqual(TRACE_ROW_BYTES_MAX);
    });
});
