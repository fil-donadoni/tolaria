// Bot reachability for Emblazoned Golem's distinct-colour Kicker {X}
// (CR 107.3a / 601.2h, issue #4506).
//
// `.claude/rules/gre-development.md` § Bot reachability. A "spend only
// coloured mana on X, no more than one of each colour" Kicker needs the
// enumerator to do two things the plain Kicker {X} case (issue #2141,
// `kickerXBot.bot.test.ts`) doesn't: bound its X axis by DISTINCT reachable
// colours rather than a flat generic ceiling (`maxAffordableDistinctColorX`),
// and pick an actual colour SET per candidate X (`greedyDistinctColorMatch`)
// so the Move it emits is one `announceCast` will accept — the fold in
// `normalizeManaCost` throws on a missing/mismatched colour set, so an
// enumerated move with no `chosenXColors` would freeze the bot exactly as a
// missing `chosenX` did for issue #2141.
//
// No new valuation seam: the kicked value is `entersWith.counters` (engine
// infra), not an Effect Script Op — nothing for `OP_VALUERS` to censo.

import { describe, it, expect } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { emblazonedGolem } from "../../cards/sets/apc/colorless.cards";
import {
    plains,
    island,
    swamp,
    mountain,
    forest,
} from "../../cards/sets/lea/colorless.cards";

const GOLEM = "golem";

/** p1 holds Emblazoned Golem ({2}) with the given untapped lands. */
function board(lands: { id: string; def: string }[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(emblazonedGolem().id, {
                        id: GOLEM,
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                battlefield: lands.map((l) =>
                    makeInstance(l.def, {
                        id: l.id,
                        zone: "battlefield",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function golemCasts(state: GameState): Move[] {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === GOLEM
    );
}

const kicked = (m: Move) =>
    m.kind === "cast-spell" && (m.kickerPayments?.kicker ?? 0) > 0;
const xOf = (m: Move) => (m.kind === "cast-spell" ? m.chosenX : undefined);
const colorsOf = (m: Move) =>
    m.kind === "cast-spell" ? m.chosenXColors : undefined;

function tapped(state: GameState): number {
    return getPlayer(state, "p1").battlefield.filter((c) => c.isTapped).length;
}

describe("Emblazoned Golem — Bot reachability (CR 107.3a / 601.2h, issue #4506)", () => {
    it("bounds X by DISTINCT reachable colours, not a flat generic count: five Plains cap at X = 1", () => {
        const lands = Array.from({ length: 5 }, (_, i) => ({
            id: `pl${i}`,
            def: plains().id,
        }));
        const casts = golemCasts(board(lands));
        // {2} generic leaves three Plains — all the SAME colour, so the
        // distinct-colour ceiling is 1, not 3 (the plain-Kicker-{X} shape
        // `kickerXBot.bot.test.ts` covers would offer 0..3 here).
        expect(casts.filter(kicked).map(xOf).sort()).toEqual([0, 1]);
        // Unkicked stays the one `undefined`-X variant (CR 601.2b).
        expect(casts.filter((m) => !kicked(m)).map(xOf)).toEqual([undefined]);
    });

    it("EVERY kicked variant carries a chosenXColors the server's fold accepts", () => {
        const lands = [
            { id: "pl", def: plains().id },
            { id: "is", def: island().id },
            { id: "sw", def: swamp().id },
            { id: "mo", def: mountain().id },
            { id: "fo", def: forest().id },
        ];
        const casts = golemCasts(board(lands));
        for (const m of casts.filter(kicked)) {
            const x = xOf(m) ?? 0;
            if (x === 0) {
                expect(colorsOf(m)).toBeUndefined();
                continue;
            }
            const colors = colorsOf(m);
            expect(colors).toHaveLength(x);
            expect(new Set(colors)).toHaveProperty("size", x); // distinct
            expect(colors?.every((c) => c !== "C")).toBe(true);
        }
    });

    it("one land of each colour: the printed {2} claims two, so the ceiling is 3, not 5", () => {
        const lands = [
            { id: "pl", def: plains().id },
            { id: "is", def: island().id },
            { id: "sw", def: swamp().id },
            { id: "mo", def: mountain().id },
            { id: "fo", def: forest().id },
        ];
        const casts = golemCasts(board(lands));
        expect(Math.max(...casts.filter(kicked).map((m) => xOf(m) ?? 0))).toBe(
            3
        );
    });

    it("the GREEDY sandbox (applyMoveForSearch) charges {2} + the chosen colours and the Golem enters with X counters", () => {
        const lands = [
            { id: "pl", def: plains().id },
            { id: "is", def: island().id },
            { id: "sw", def: swamp().id },
            { id: "mo", def: mountain().id },
            { id: "fo", def: forest().id },
        ];
        const state = board(lands);
        const move = golemCasts(state).find((m) => kicked(m) && xOf(m) === 3)!;
        const after = applyMoveForSearch(state, "p1", move);
        expect(tapped(after)).toBe(5);
        const golem = getPlayer(after, "p1").battlefield.find(
            (c) => c.id === GOLEM
        )!;
        expect(golem.counters?.["+1/+1"]).toBe(3);
    });

    it("the ISMCTS sandbox (applyMoveInSearch) charges the same plan and announces the same X", () => {
        const lands = [
            { id: "pl", def: plains().id },
            { id: "is", def: island().id },
            { id: "sw", def: swamp().id },
            { id: "mo", def: mountain().id },
            { id: "fo", def: forest().id },
        ];
        const state = board(lands);
        const move = golemCasts(state).find((m) => kicked(m) && xOf(m) === 3)!;
        const world = structuredClone(state);
        applyMoveInSearch(world, "p1", move);
        expect(tapped(world)).toBe(5);
        expect(world.stack[0]?.chosenX).toBe(3);
    });
});
