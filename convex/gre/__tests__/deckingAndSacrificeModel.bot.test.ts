// The three gaps an Underworld Breach / Black Lotus / Brain Freeze probe found
// in the Bot, none of them a horizon problem:
//
//   1. the SEARCH's mana model never sacrificed a `{T}, Sacrifice` source, so a
//      Black Lotus sat tapped on the battlefield forever and could never become
//      escape fodder — every graveyard-as-resource line was structurally
//      invisible at ANY depth;
//   2. `evaluate` could not see a LIBRARY at all, so decking (CR 104.3c /
//      704.5b) was not an objective the search could pursue;
//   3. `evaluate` valued a GRAVEYARD at nothing, so filling one's own was pure
//      loss and self-milling for fodder could never be chosen.
//
// The decision-level guard is the blade entry "decking: casts the storm kill
// that recurs its own Black Lotus". These are the mechanism-level guards.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import { seatPlayerId } from "../ai/blade/matcher";
import type { BladeScenario } from "../ai/blade/types";
import { applyMoveInSearch } from "../search";
import { applyMoveForSearch } from "../applyMove";
import { enumerateMoves, type Move } from "../moves";
import { evaluate, WIN_SCORE } from "../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { tryGetDefinition } from "../../cards";
import type { CardInstanceState, GameState } from "../state";

const nameOf = (c: CardInstanceState) =>
    tryGetDefinition((c.card as { id?: string }).id ?? "")?.name ?? "?";

function board(
    cards: BladeScenario["spec"]["cards"],
    libraryCount = 20
): GameState {
    return buildBladeState({
        label: "unit",
        spec: {
            cards,
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 1 },
        tier: "stretch",
        expect: { moves: [{ kind: "pass" }] },
    });
}

/** A board whose only mana is `source`, plus a one-mana spell to spend it on. */
function payWith(source: string): {
    state: GameState;
    me: string;
    move: Extract<Move, { kind: "cast-spell" }>;
} {
    const state = board([
        { name: source, owner: "me", zone: "battlefield", tapped: false },
        { name: "Ancestral Recall", owner: "me", zone: "hand" },
    ]);
    const me = seatPlayerId(state, "me");
    const move = enumerateMoves(state, me).find(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell"
    )!;
    return { state, me, move };
}

describe("the search models a sacrifice-cost mana source leaving play", () => {
    // BOTH copies of `applyTapPlan` — `search.ts`'s and `applyMove.ts`'s. They
    // are deliberately separate copies (issue #111), so they need the same fix
    // and the same guard; a test covering one would let the other rot.
    it.each([
        [
            "applyMoveInSearch (search.ts)",
            (s: GameState, p: string, m: Move) => {
                applyMoveInSearch(s, p, m);
                return s;
            },
        ],
        [
            "applyMoveForSearch (applyMove.ts)",
            (s: GameState, p: string, m: Move) => applyMoveForSearch(s, p, m),
        ],
    ])(
        "%s puts a Black Lotus in the graveyard after it pays for a spell",
        (_label, apply) => {
            const { state, me, move } = payWith("Black Lotus");
            const after = apply(state, me, move);
            const p = after.players.find((x) => x.id === me)!;
            expect(p.battlefield.map(nameOf)).not.toContain("Black Lotus");
            expect(p.graveyard.map(nameOf)).toContain("Black Lotus");
        }
    );

    // The other half: a source whose cost is a bare {T} must still merely tap.
    // Without this the guard above is satisfied by binning every mana source.
    it.each(["Mox Sapphire", "Island"])(
        "%s is only TAPPED by paying, never sacrificed",
        (source) => {
            const { state, me, move } = payWith(source);
            applyMoveInSearch(state, me, move);
            const p = state.players.find((x) => x.id === me)!;
            const src = p.battlefield.find((c) => nameOf(c) === source);
            expect(src).toBeDefined();
            expect(src!.isTapped).toBe(true);
            expect(p.graveyard.map(nameOf)).not.toContain(source);
        }
    );
});

describe("evaluate sees the library (CR 104.3c / 704.5b)", () => {
    /** Both libraries at `n`, then the opponent's trimmed to `oppLib`. */
    function withLibraries(oppLib: number, mine = 20): GameState {
        const state = board(
            [{ name: "Black Lotus", owner: "me", zone: "battlefield" }],
            mine
        );
        const me = seatPlayerId(state, "me");
        const opp = state.players.find((x) => x.id !== me)!;
        opp.library = opp.library.slice(0, oppLib);
        return state;
    }

    it("is EXACTLY flat above the decking horizon — narrow support", () => {
        const h = DEFAULT_EVAL_WEIGHTS.deckingHorizon;
        const me = seatPlayerId(withLibraries(h), "me");
        const base = evaluate(withLibraries(h), me);
        for (const oppLib of [h, h + 1, h + 8, h + 20]) {
            expect(evaluate(withLibraries(oppLib), me)).toBe(base);
        }
    });

    it("climbs monotonically as the opponent's library runs out", () => {
        const me = seatPlayerId(withLibraries(12), "me");
        const scores = [11, 9, 6, 3, 1].map((n) =>
            evaluate(withLibraries(n), me)
        );
        for (let i = 1; i < scores.length; i++) {
            expect(scores[i]).toBeGreaterThan(scores[i - 1]);
        }
    });

    it("puts an empty opponent library in the WON band, and an empty own library in the LOST band", () => {
        const me = seatPlayerId(withLibraries(0), "me");
        expect(evaluate(withLibraries(0), me)).toBeGreaterThan(WIN_SCORE / 2);
        // Mirror: my own library empty while theirs is not.
        const mirror = board(
            [{ name: "Black Lotus", owner: "me", zone: "battlefield" }],
            20
        );
        const meId = seatPlayerId(mirror, "me");
        mirror.players.find((x) => x.id === meId)!.library = [];
        expect(evaluate(mirror, meId)).toBeLessThan(-WIN_SCORE / 2);
    });

    it("cancels when BOTH libraries are equally short — the term is a margin, not a bias", () => {
        const me = seatPlayerId(board([], 20), "me");
        const scores = [20, 12, 6, 1].map((n) =>
            evaluate(
                board(
                    [{ name: "Black Lotus", owner: "me", zone: "battlefield" }],
                    n
                ),
                me
            )
        );
        for (const s of scores) expect(s).toBe(scores[0]);
    });
});

describe("evaluate values a graveyard a play-from-graveyard engine can cast", () => {
    function withGraveyard(gy: number, breach: boolean): GameState {
        const cards: BladeScenario["spec"]["cards"] = [
            { name: "Black Lotus", owner: "me", zone: "battlefield" },
        ];
        if (breach)
            cards.push({
                name: "Underworld Breach",
                owner: "me",
                zone: "battlefield",
            });
        if (gy > 0)
            cards.push({
                name: "Lightning Bolt",
                owner: "me",
                zone: "graveyard",
                count: gy,
            });
        return board(cards, 20);
    }

    it("is EXACTLY zero with no engine on the battlefield, however full the graveyard", () => {
        const me = seatPlayerId(withGraveyard(0, false), "me");
        const base = evaluate(withGraveyard(0, false), me);
        for (const gy of [1, 4, 8, 20]) {
            expect(evaluate(withGraveyard(gy, false), me)).toBe(base);
        }
    });

    it("prices the graveyard off the GRANT's own exile count, not a card name", () => {
        const me = seatPlayerId(withGraveyard(0, true), "me");
        const w = DEFAULT_EVAL_WEIGHTS;
        // Underworld Breach exiles three OTHERS, so one cast consumes four
        // cards: three of graveyard is still zero casts, four is one.
        const at = (gy: number) => evaluate(withGraveyard(gy, true), me);
        const zero = at(0);
        expect(at(3)).toBe(zero);
        expect(at(4)).toBe(zero + w.graveyardEngineWeight);
        expect(at(8)).toBe(zero + 2 * w.graveyardEngineWeight);
    });

    it("is capped, so an enormous graveyard cannot dominate the leaf", () => {
        const me = seatPlayerId(withGraveyard(0, true), "me");
        const w = DEFAULT_EVAL_WEIGHTS;
        const capped =
            evaluate(withGraveyard(0, true), me) +
            w.graveyardEngineCap * w.graveyardEngineWeight;
        expect(
            evaluate(withGraveyard(4 * w.graveyardEngineCap, true), me)
        ).toBe(capped);
        expect(
            evaluate(withGraveyard(4 * w.graveyardEngineCap + 40, true), me)
        ).toBe(capped);
    });
});
