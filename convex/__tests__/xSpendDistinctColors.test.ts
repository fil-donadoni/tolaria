// "Spend only colored mana on X. No more than one mana of each color may be
// spent this way." — `ManaCost.xSpendDistinctColors` (CR 107.3a / CR 601.2h,
// issue #4506 — Emblazoned Golem, split out of #2141/#3811).
//
// Unlike `xSpendColors` (a card-declared FIXED 1-2 colour set any X pip may
// draw from, issue #3811), this restriction leaves WHICH colours to the
// CASTER: they announce X distinct colours at CR 601.2b announcement — the
// same step that already makes them announce a hybrid pip's non-hybrid
// equivalent — and `normalizeManaCost` folds each into an ORDINARY
// single-colour pip. Once folded, the rest of the payment stack (auto-tap,
// `isManaCostCovered`, the castability ceiling) needs no changes at all —
// only the announce-time colour choice and its pre-choice CEILING
// (`maxAffordableDistinctColorX`) are new.
//
//  1. **Unit** — the normalized shape (`normalizeManaCost`), its validation
//     (count / distinctness / coloured-only), the ceiling
//     (`maxAffordableDistinctColorX`) and the colour PICK
//     (`greedyDistinctColorMatch`).
//  2. **Auto-tap** — the planner pays the folded pips from real lands.
//  3. **Full path** — Emblazoned Golem driven through the registered
//     `announceCast` mutation: missing/duplicate/wrong-count/colourless
//     colours are refused server-side; a legal pick reaches the stack and
//     resolves with X +1/+1 counters, visible through `projectPublicState`
//     (the wire-format proof `gre-development.md` requires for a board-visible
//     outcome).

import { describe, it, expect } from "vitest";
import {
    normalizeManaCost,
    isManaCostCovered,
    resolveTopOfStack,
    getPlayer,
    type GameState,
} from "../gre/state";
import { maxAffordableDistinctColorX } from "../gre/rules";
import { greedyDistinctColorMatch } from "../gre/payWith";
import { buildAutoTapSources, solveAutoTap } from "../gre/autoTap";
import { emblazonedGolem } from "../cards/sets/apc/colorless.cards";
import {
    swamp,
    mountain,
    plains,
    island,
    forest,
} from "../cards/sets/lea/colorless.cards";
import { announceCast } from "../game";
import { projectPublicState } from "../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const POOL0 = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const golemKicker = emblazonedGolem().kickers![0].mana!;

function withGolem(
    pool: Partial<typeof POOL0>,
    lands: { id: string; def: string }[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(emblazonedGolem().id, {
                        id: "golem",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: lands.map((l) =>
                    makeInstance(l.def, {
                        id: l.id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    })
                ),
                manaPool: { ...POOL0, ...pool },
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("normalizeManaCost folds a distinct-colour X into ordinary pips (CR 107.3a / 601.2h)", () => {
    it("X = 3, three distinct colours → one pip each", () => {
        expect(
            normalizeManaCost(golemKicker, {
                chosenX: 3,
                chosenXColors: ["W", "U", "B"],
            })
        ).toEqual({ W: 1, U: 1, B: 1 });
    });

    it("X = 0 owes nothing, even with no colours chosen", () => {
        expect(normalizeManaCost(golemKicker, { chosenX: 0 })).toEqual({});
    });

    it("throws when the chosen colours don't match X's count", () => {
        expect(() =>
            normalizeManaCost(golemKicker, {
                chosenX: 3,
                chosenXColors: ["W", "U"],
            })
        ).toThrow(/needs 3 chosen colour/);
    });

    it("throws on a repeated colour — no more than one mana of each colour", () => {
        expect(() =>
            normalizeManaCost(golemKicker, {
                chosenX: 2,
                chosenXColors: ["W", "W"],
            })
        ).toThrow(/forbids repeating/);
    });

    it("throws on a colourless pick — coloured mana only", () => {
        expect(() =>
            normalizeManaCost(golemKicker, {
                chosenX: 1,
                chosenXColors: ["C"] as unknown as (
                    | "W"
                    | "U"
                    | "B"
                    | "R"
                    | "G"
                )[],
            })
        ).toThrow(/requires coloured mana/);
    });
});

describe("greedyDistinctColorMatch / maxAffordableDistinctColorX (CR 107.3a — the caster's own reachable colours)", () => {
    it("five same-colour sources → only one distinct colour reachable", () => {
        const sources = Array.from({ length: 5 }, () => new Set<"W">(["W"]));
        expect(greedyDistinctColorMatch(sources)).toEqual(["W"]);
    });

    it("one source per colour → all five reachable", () => {
        const sources = (["W", "U", "B", "R", "G"] as const).map(
            (c) => new Set([c])
        );
        expect(greedyDistinctColorMatch(sources).sort()).toEqual([
            "B",
            "G",
            "R",
            "U",
            "W",
        ]);
    });

    it("Emblazoned Golem's ceiling: five Plains still cap at X = 1", () => {
        const lands = Array.from({ length: 5 }, (_, i) => ({
            id: `pl${i}`,
            def: plains().id,
        }));
        const state = withGolem({}, lands);
        const p1 = getPlayer(state, "p1");
        const fixed = normalizeManaCost(emblazonedGolem().manaCost!, {
            chosenX: 0,
        });
        expect(maxAffordableDistinctColorX(p1, p1.hand[0], fixed, state)).toBe(
            1
        );
    });

    it("one land of each colour, but the printed {2} needs two of them too → ceiling is 3, not 5", () => {
        const lands = [
            { id: "pl", def: plains().id },
            { id: "is", def: island().id },
            { id: "sw", def: swamp().id },
            { id: "mo", def: mountain().id },
            { id: "fo", def: forest().id },
        ];
        const state = withGolem({}, lands);
        const p1 = getPlayer(state, "p1");
        const fixed = normalizeManaCost(emblazonedGolem().manaCost!, {
            chosenX: 0,
        });
        expect(fixed).toEqual({ X: 2 });
        expect(maxAffordableDistinctColorX(p1, p1.hand[0], fixed, state)).toBe(
            3
        );
    });

    it("a sixth, colourless-irrelevant land raises the ceiling back to 5 — two lands are now free for the generic {2}", () => {
        const lands = [
            { id: "pl", def: plains().id },
            { id: "is", def: island().id },
            { id: "sw", def: swamp().id },
            { id: "mo", def: mountain().id },
            { id: "fo", def: forest().id },
            { id: "pl2", def: plains().id },
            { id: "is2", def: island().id },
        ];
        const state = withGolem({}, lands);
        const p1 = getPlayer(state, "p1");
        const fixed = normalizeManaCost(emblazonedGolem().manaCost!, {
            chosenX: 0,
        });
        expect(maxAffordableDistinctColorX(p1, p1.hand[0], fixed, state)).toBe(
            5
        );
    });
});

describe("auto-tap pays a distinct-colour X from the announced lands", () => {
    it("taps one Plains, one Island, one Swamp for X = 3 chosen {W}{U}{B}", () => {
        const lands = [
            { id: "pl", def: plains().id },
            { id: "is", def: island().id },
            { id: "sw", def: swamp().id },
            { id: "mo", def: mountain().id },
        ];
        const state = withGolem({}, lands);
        const p1 = getPlayer(state, "p1");
        const cost = normalizeManaCost(golemKicker, {
            chosenX: 3,
            chosenXColors: ["W", "U", "B"],
        });
        const plan = solveAutoTap(
            p1.manaPool,
            cost,
            [],
            buildAutoTapSources(p1.battlefield)
        );
        expect(plan).not.toBeNull();
        const tapped = plan!.map((s) => s.cardId).sort();
        expect(tapped).toEqual(["is", "pl", "sw"]);
    });

    it("a fourth Mountain can never pay any of the three chosen colours", () => {
        const cost = normalizeManaCost(golemKicker, {
            chosenX: 3,
            chosenXColors: ["W", "U", "B"],
        });
        expect(isManaCostCovered({ R: 3 }, cost)).toBe(false);
        expect(isManaCostCovered({ W: 1, U: 1, B: 1 }, cost)).toBe(true);
    });
});

describe("Emblazoned Golem full path — announceCast validates the distinct-colour pick (CR 601.2b)", () => {
    const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

    // Pool-funded (not lands): with no target requirement at all, a cast the
    // POOL alone covers reaches the stack in this one `announceCast` call —
    // no separate `selectTargets`/`tapForPayment` round trip needed, mirroring
    // `xSpendColors.test.ts`'s own full-path shape for a card whose cost the
    // pool exactly covers.
    async function announce(
        extra: Record<string, unknown>,
        pool: Partial<typeof POOL0> = {}
    ) {
        const harness = makeMutationCtx("p1", [gameStateSeed(withGolem(pool))]);
        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, cardInstanceId: "golem", ...extra }
        );
        return harness.state();
    }

    it("kicked for X = 2 with no colours chosen at all is refused", async () => {
        await expect(
            announce(
                { chosenX: 2, kickerPayments: { kicker: 1 } },
                { W: 2, U: 2, B: 2, R: 2, G: 2 }
            )
        ).rejects.toThrow(/exactly 2 distinct colour/);
    });

    it("kicked for X = 2 with a repeated colour is refused", async () => {
        await expect(
            announce(
                {
                    chosenX: 2,
                    kickerPayments: { kicker: 1 },
                    chosenXColors: ["W", "W"],
                },
                { W: 2, U: 2, B: 2, R: 2, G: 2 }
            )
        ).rejects.toThrow(/no colour twice/);
    });

    it("kicked for X = 2 with a colourless pick is refused", async () => {
        await expect(
            announce(
                {
                    chosenX: 2,
                    kickerPayments: { kicker: 1 },
                    chosenXColors: ["W", "C"],
                },
                { W: 2, U: 2, B: 2, R: 2, G: 2 }
            )
        ).rejects.toThrow(/colored mana only/);
    });

    it("unkicked cast (no kicker paid) sending colours anyway is refused", async () => {
        await expect(
            announce(
                { chosenX: 0, chosenXColors: ["W"] },
                { W: 2, U: 2, B: 2, R: 2, G: 2 }
            )
        ).rejects.toThrow(/has no distinct-colour X/);
    });

    it("kicked for X = 3 with {W}{U}{B} pool pays and enters with 3 +1/+1 counters, visible on the wire", async () => {
        const state = await announce(
            {
                chosenX: 3,
                kickerPayments: { kicker: 1 },
                chosenXColors: ["W", "U", "B"],
            },
            // {2} printed generic + {W}{U}{B} kicker X = 5 mana total.
            { W: 1, U: 1, B: 1, G: 2 }
        );
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].chosenX).toBe(3);
        resolveTopOfStack(state);
        const golem = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "golem"
        )!;
        expect(golem.counters?.["+1/+1"]).toBe(3);

        // Wire-format proof (gre-development.md § Wire format test) — the
        // projection strips fat fields; counters must survive it.
        const projected = projectPublicState(state, 1, "p1");
        const slimGolem = projected.players[0].battlefield.find(
            (c) => c.id === "golem"
        )!;
        expect(slimGolem.counters?.["+1/+1"]).toBe(3);
    });

    it("unkicked cast enters with no counters at all", async () => {
        // {2} printed generic only — no kicker paid, no X owed.
        const state = await announce({ chosenX: 0 }, { G: 2 });
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        const golem = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "golem"
        )!;
        expect(golem.counters?.["+1/+1"] ?? 0).toBe(0);
    });
});
