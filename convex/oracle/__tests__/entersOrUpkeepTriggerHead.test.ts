// "When {self} enters and at the beginning of your upkeep" — ONE trigger head
// over two events (CR 603.2, CR 603.6a, CR 603.2b), issue #10552.
//
// The corpus prints this head on four cards (Deep Space 9, Old Rutstein,
// Grenzo, Crooked Jailer, Minsc & Boo, Timeless Heroes) and every one of them
// still refuses on its BODY, so no whole-card golden exists yet. What is
// pinned here instead:
//
//  1. the HEAD reads the printed span, and refuses its neighbours (fail-closed);
//  2. a real corpus card's line now compiles past the head — its gap moves to
//     the body, which is the backlog signal the head used to mask;
//  3. the compiled descriptor rebuilds an ability that fires on the source's
//     own entry and on its controller's upkeep, never the opponent's.

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type { PermanentView } from "../../cards/types";
import { compileCard } from "../compile";
import {
    headPronounReferent,
    matchSelfHead,
} from "../grammar/shared/triggerHead";
import { oracleCard } from "./oracle.fixture";

const HEAD = "When {self} enters and at the beginning of your upkeep";

describe("enters-or-upkeep trigger head — the head (CR 603.2)", () => {
    it("reads the printed span as one head naming the source", () => {
        const head = matchSelfHead(HEAD);
        expect(head).toEqual({ kind: "enters-or-upkeep" });
        expect(headPronounReferent(head!)).toBe("source");
    });

    it.each([
        // CR 603.2b — each player's upkeep is another head.
        "When {self} enters and at the beginning of each upkeep",
        // The corpus prints "when" only; "whenever" is unread.
        "Whenever {self} enters and at the beginning of your upkeep",
        // "or" joins two events of the same object; this is not that head.
        "When {self} enters or at the beginning of your upkeep",
        // Not a self subject.
        "When a creature enters and at the beginning of your upkeep",
    ])("refuses the neighbour %j", (span) => {
        expect(matchSelfHead(span)).toBeNull();
    });
});

describe("enters-or-upkeep trigger head — a corpus card compiles past it", () => {
    it("Old Rutstein's gap is its body now, never its head", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Old Rutstein",
                manaCost: "{1}{B}{G}",
                typeLine: "Legendary Creature — Human Peasant",
                oracleText:
                    "When Old Rutstein enters and at the beginning of your upkeep, mill a card. If a land card is milled this way, create a Treasure token. If a creature card is milled this way, create a 1/1 green Insect creature token. If a noncreature, nonland card is milled this way, create a Blood token.",
                power: "1",
                toughness: "4",
            })
        );
        expect(outcome.state).toBe("unparsed");
        const paths =
            outcome.state === "unparsed"
                ? outcome.gaps.map((g) => g.attribution?.path ?? [])
                : [];
        expect(paths.some((p) => p.includes("effect clause"))).toBe(true);
        for (const path of paths) expect(path).not.toContain("trigger head");
    });
});

describe("enters-or-upkeep trigger head — the rebuilt ability (CR 603.6a, CR 603.2b)", () => {
    const ability = resolveCompiledTrigger({
        id: "enters-or-upkeep-probe",
        oracleText: `${HEAD}, draw a card.`,
        head: { kind: "enters-or-upkeep" },
        effects: [{ op: "draw", player: "controller", count: 1 }],
    });
    const self = { id: "src", controllerId: "p1" } as PermanentView;

    it("is ONE ability over both events, not an ETB-only one", () => {
        expect(ability.event).toEqual(["PERMANENT_ENTERED", "PHASE_BEGIN"]);
        expect(ability.etbAbility).toBe(false);
    });

    it("fires on the source's own entry, not another permanent's", () => {
        const entered = (instanceId: string) => ({
            type: "PERMANENT_ENTERED" as const,
            instanceId,
            controllerId: "p1",
            cardId: "x",
            types: ["Creature" as const],
        });
        expect(ability.matches!(entered("src"), self)).toBe(true);
        expect(ability.matches!(entered("other"), self)).toBe(false);
    });

    it("fires at the beginning of its controller's upkeep only", () => {
        const phase = (phase: "UPKEEP" | "DRAW", activePlayerId: string) => ({
            type: "PHASE_BEGIN" as const,
            phase,
            activePlayerId,
        });
        expect(ability.matches!(phase("UPKEEP", "p1"), self)).toBe(true);
        expect(ability.matches!(phase("UPKEEP", "p2"), self)).toBe(false);
        expect(ability.matches!(phase("DRAW", "p1"), self)).toBe(false);
    });
});
