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

    // Decking is a RACE, not a resource: two equally short libraries must NOT
    // cancel, because the player who draws first is the one who loses (CR
    // 504.1 / 104.3c). While they did cancel, milling BOTH players read as
    // neutral and the bot spent surplus storm copies on itself.
    it("does not cancel when both libraries are equally short — the player drawing LATER is ahead", () => {
        const at = (n: number) => {
            const s = board(
                [{ name: "Black Lotus", owner: "me", zone: "battlefield" }],
                n
            );
            // The bot is the active player, past its draw step, so the
            // OPPONENT draws next and the bot is ahead in the race.
            s.activePlayerId = seatPlayerId(s, "me");
            return evaluate(s, seatPlayerId(s, "me"));
        };
        const scores = [12, 9, 5, 2, 1].map(at);
        for (let i = 1; i < scores.length; i++) {
            expect(scores[i]).toBeGreaterThan(scores[i - 1]);
        }
    });

    // Sub-terminal on purpose — see `deckOutDelta`'s own note for why a
    // terminal verdict here was withdrawn. What must hold is that the position
    // is NOT read as neutral: the player about to draw is strictly worse off.
    it("does not read BOTH libraries empty as neutral — the player drawing next is worse off", () => {
        const bothEmpty = (activeIsMe: boolean) => {
            const s = board(
                [{ name: "Black Lotus", owner: "me", zone: "battlefield" }],
                20
            );
            const me = seatPlayerId(s, "me");
            const opp = s.players.find((p) => p.id !== me)!;
            s.players.find((p) => p.id === me)!.library = [];
            opp.library = [];
            // PRECOMBAT_MAIN is past the active player's draw step, so the
            // NON-active player draws next and is the one who loses.
            s.activePlayerId = activeIsMe ? me : opp.id;
            return evaluate(s, me);
        };
        // Active = me, past my draw step, so the OPPONENT draws next and is the
        // one who loses: that orientation must score strictly higher.
        expect(bothEmpty(true)).toBeGreaterThan(bothEmpty(false));
    });

    // THE REGRESSION THIS SECTION EXISTS FOR. Once the opponent is decked the
    // position is won, but two won positions must still be ORDERED by how
    // safely they win (issue #138) — otherwise `materialSignal` clips them to
    // the same reward, the search cannot tell "keep my library" from "mill
    // myself too", and surplus storm copies get pointed at their own
    // controller by rollout noise. Observed in a real game: the bot emptied
    // both libraries and won only because the human drew first.
    //
    // SCOPE, and it is load-bearing: this board carries NO graveyard engine.
    // Spending your own library is NOT universally a loss — with a
    // play-from-graveyard engine out it converts a library card into escape
    // fodder, which is the whole first half of a Breach line. That direction is
    // asserted by "self-milling is still PREFERRED..." below; the two together
    // say what is actually true, and neither may be deleted alone.
    it("keeps the WON band ordered — on a board with NO graveyard engine, spending my own library is worth less", () => {
        const w = DEFAULT_EVAL_WEIGHTS;
        const won = (myLib: number) => {
            const s = board(
                [{ name: "Black Lotus", owner: "me", zone: "battlefield" }],
                20
            );
            const me = seatPlayerId(s, "me");
            const opp = s.players.find((p) => p.id !== me)!;
            opp.library = [];
            const mine = s.players.find((p) => p.id === me)!;
            mine.library = mine.library.slice(0, myLib);
            s.activePlayerId = me;
            return evaluate(s, me);
        };
        // Stops at ONE card, not zero: with both libraries empty the position
        // leaves the won band by design — `deckOutDelta` declines a terminal
        // verdict there (see its note), and the half-draw handicap resolves it
        // sub-terminally instead.
        const scores = [9, 6, 3, 1].map(won);
        // Every one of them is a win...
        for (const v of scores) expect(v).toBeGreaterThan(WIN_SCORE / 2);
        // ...strictly ordered, most own library first...
        for (let i = 1; i < scores.length; i++) {
            expect(scores[i]).toBeLessThan(scores[i - 1]);
        }
        // ...and the whole spread sits INSIDE the band `materialSignal` clips
        // at, which is what makes the ordering visible to the search at all.
        for (const v of scores) {
            expect(Math.abs(v - WIN_SCORE)).toBeLessThan(w.materialFull);
        }
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

    // THE COUNTERWEIGHT to "spending my own library is worth less". Self-milling
    // is a COST in cards and a GAIN in fodder, and with an engine out the gain
    // wins whenever the library is healthy — that is the first half of a real
    // Underworld Breach line (some Brain Freeze copies at your OWN face, to
    // fuel the escapes that build the storm count for the copies that kill).
    //
    // Measured with a 40-card library: pointing a 3-card mill at MYSELF scores
    // 178.0 against 118.0 for pointing it at the opponent, because the library
    // term is exactly zero that far above the horizon while the unlocked escape
    // pays `graveyardEngineWeight`. This test exists so a future re-calibration
    // of the decking weights cannot silently make self-milling never worth it.
    it("self-milling is still PREFERRED to milling the opponent while the library is healthy", () => {
        const mill = (myLib: number, oppLib: number, gy: number): number => {
            const s = board(
                [
                    { name: "Black Lotus", owner: "me", zone: "battlefield" },
                    {
                        name: "Underworld Breach",
                        owner: "me",
                        zone: "battlefield",
                    },
                    ...(gy > 0
                        ? [
                              {
                                  name: "Lightning Bolt",
                                  owner: "me" as const,
                                  zone: "graveyard" as const,
                                  count: gy,
                              },
                          ]
                        : []),
                ],
                60
            );
            const me = seatPlayerId(s, "me");
            const mine = s.players.find((p) => p.id === me)!;
            const opp = s.players.find((p) => p.id !== me)!;
            mine.library = mine.library.slice(0, myLib);
            opp.library = opp.library.slice(0, oppLib);
            s.activePlayerId = me;
            return evaluate(s, me);
        };
        // A 3-card mill from a graveyard of 5, both libraries healthy: at
        // MYSELF the graveyard reaches 8 (a second escape unlocked); at the
        // OPPONENT their library drops by 3 and my graveyard does not move.
        const atSelf = mill(37, 40, 8);
        const atOpponent = mill(40, 37, 5);
        expect(atSelf).toBeGreaterThan(atOpponent);
        // And it is the UNLOCKED CAST that pays, not the fodder as such: the
        // same self-mill into a graveyard of 3 — one short of Breach's
        // four-cards-per-cast — buys nothing and must not be preferred.
        expect(mill(37, 40, 3)).toBeLessThanOrEqual(mill(40, 37, 0));
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
