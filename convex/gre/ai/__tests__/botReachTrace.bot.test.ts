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

const TERM_KEYS: (keyof EvalTerms)[] = [
    "life",
    "hand",
    "creatures",
    "permanents",
    "mana",
    "finiteManaUses",
    "manaDevelopment",
    "colorCoverage",
    "flexibility",
    "library",
    "graveyard",
    "graveyardReach",
];

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
        const { cardMove, search } = projectBotReachTrace(t, "card");
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
        expect(projectBotReachTrace(null, "card", "pruned")).toEqual({
            cardMove: "pruned",
        });
        const t = trace([candidate("Pass", 30, PASS)], "Pass");
        expect(projectBotReachTrace(t, "card").cardMove).toBe("unexpanded");
    });

    it("an unavailable breakdown records no terms", () => {
        const c = { ...candidate("Pass", 3, PASS), unavailable: true };
        const { search } = projectBotReachTrace(trace([c], "Pass"), "card");
        expect(search!.candidates[0]!.terms).toBeUndefined();
    });

    it("drops zero terms and rounds to two decimals", () => {
        const c = candidate("Pass", 3, PASS);
        c.eval.self.life = 20.004;
        c.eval.opp.life = 18;
        c.eval.self.hand = 0;
        c.eval.opp.hand = 0;
        const { search } = projectBotReachTrace(trace([c], "Pass"), "card");
        const t = search!.candidates[0]!.terms!;
        expect(t.life).toEqual([20, 18]);
        expect(t.hand).toBeUndefined();
        expect(search!.candidates[0]!.meanReward).toBe(0.12);
    });

    it("stays under the per-row cap however much the search weighed", () => {
        const long = "X".repeat(500);
        const many = Array.from({ length: 40 }, (_, i) =>
            candidate(`${long}${i}`, 100 - i, cast(`c${i}`))
        );
        const projected = projectBotReachTrace(trace(many, `${long}0`), "c39");
        const { search } = projected;
        expect(search!.candidates).toHaveLength(BOT_REACH_TRACE_MAX_CANDIDATES);
        expect(search!.candidates[1]!.role).toBe("card");
        for (const c of search!.candidates)
            expect(c.label.length).toBeLessThanOrEqual(
                BOT_REACH_TRACE_LABEL_MAX
            );
        expect(JSON.stringify(projected).length).toBeLessThanOrEqual(
            TRACE_ROW_BYTES_MAX
        );
    });
});
