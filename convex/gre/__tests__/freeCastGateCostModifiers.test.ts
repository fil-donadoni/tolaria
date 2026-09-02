// The cast-affordance gate and the cast PAYMENT must price the same cast the
// same way — for every zone/mechanism, not just the three that folded (issue
// #2981, follow-up of #2970).
//
// `bun run cr 118.6a`: "If an unpayable cost is increased by an effect or an
// additional cost is imposed, the cost is still unpayable. If an alternative
// cost is applied to an unpayable cost, including an effect that allows a
// player to cast a spell without paying its mana cost, the alternative cost may
// be paid."
//
// `bun run cr 118.9d`: "If an alternative cost is being paid to cast a spell,
// any additional costs, cost increases, and cost reductions that affect that
// spell are applied to that alternative cost. (See rule 601.2f.)"
//
// 118.6a names the "without paying its mana cost" waiver as an ALTERNATIVE
// cost, and 118.9d applies every increase and reduction to an alternative cost.
// So Thalia DOES tax a Dauthi Voidwalker free cast: the payment path
// (`announceCast` → `applyCostModifiers(getCostModifiers(...))`, which runs for
// every cast regardless of zone) was already right, and the GATE was the side
// that had to move.
//
// REGRESSION. `getLegalActions`'s per-mechanism cast branches each probe
// affordability against their own override cost, and only three of eleven
// folded the cost-modifier collector (hand, library-top, alternative-cost).
// The free-exile waiver probed an unmodified `{}` and returned early, so under
// any `costIncrease` static it reported the cast affordable unconditionally —
// and because the executor announces FIRST and taps afterwards, the offered
// cast parked in `pendingCast` with no exit but abort-announce-re-enumerate
// (the bot-freeze shape; for a human, a Cast button that leads nowhere).
//
// Every scenario asserts BOTH halves on the SAME board: the projected "cast"
// affordance AND the mana actually spent by the committed cast.

import { describe, it, expect } from "vitest";
import { announceCast } from "../../game";
import { getLegalActions } from "../rules";
import { castRawManaCost } from "../castCost";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
} from "../state";
import { getPlayer, type CardInstanceState, type GameState } from "../state";
import { mountain } from "../../cards/sets/lea";
import { gush } from "../../cards/sets/mmq/blue";
import { figureOfDestiny } from "../../cards/sets/eve/multicolor";
import { firebolt } from "../../cards/sets/ody/red";
import { thaliaGuardianOfThraben } from "../../cards/sets/dka/white";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness";
import type { Id } from "../../_generated/dataModel";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const announce = (
    harness: ReturnType<typeof makeMutationCtx>,
    cardInstanceId: string
) =>
    runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId,
        }
    );

/** Thalia, Guardian of Thraben on p2's board — "Noncreature spells cost {1}
 *  more to cast", any controller, so it reaches p1's spells too. */
const thalia = () =>
    makeInstance(thaliaGuardianOfThraben.id, {
        id: "thaliaG",
        controllerId: "p2",
        ownerId: "p2",
    });

describe("the free-exile cast gate folds cost modifiers (CR 118.6a / 118.9d, issue #2981)", () => {
    /** Dauthi Voidwalker's shape: Gush ({4}{U} Instant, NO target requirement,
     *  so it commits through `announceCast`'s no-target branch) sits in p2's
     *  exile under a cross-player grant carrying the free-cast waiver, while
     *  p2's Thalia taxes it {1} from the battlefield. `islands` untapped
     *  Islands on p1's board are the only mana in the scenario.
     *
     *  Gush's own `alternativeCosts` (return two Islands) is deliberately NOT
     *  announced here, and cannot leak into the gate either: the free-exile
     *  branch returns before the alternative-cost branch is reached. What is
     *  offered or refused below is the WAIVER's own affordability, nothing
     *  else. */
    function waivedExileBoard(opts: {
        pool: number;
        taxed: boolean;
    }): GameState {
        const exiled = makeInstance(gush.id, {
            id: "waivedGush",
            zone: "exile",
            controllerId: "p2",
            ownerId: "p2",
            castableFromExileBy: "p1",
            castFromExileWithoutPayingManaCost: true,
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    // Floating mana rather than untapped lands, so the payment
                    // half commits immediately instead of parking for
                    // `tapForPayment`: what is asserted below is the AMOUNT
                    // charged, never the tap UI. The affordability probe counts
                    // the pool and the board alike, so the gate half is
                    // unaffected by the choice.
                    manaPool: {
                        W: 0,
                        U: opts.pool,
                        B: 0,
                        R: 0,
                        G: 0,
                        C: 0,
                    },
                }),
                makePlayer("p2", {
                    exile: [exiled],
                    battlefield: opts.taxed ? [thalia()] : [],
                }),
            ],
        });
    }

    const waivedGush = (state: GameState) =>
        getPlayer(state, "p2").exile.find((c) => c.id === "waivedGush")!;

    /** The gate is asked exactly the way the cross-player grant reaches it:
     *  `player` is the zone's owner (p2), `casterId` is the caster (p1). */
    const gateOffersCast = (state: GameState) =>
        getLegalActions(
            state,
            getPlayer(state, "p2"),
            waivedGush(state),
            false,
            "p1"
        ).includes("cast");

    it("refuses the waived cast when the caster cannot pay a battlefield INCREASE", () => {
        // No mana at all for p1 and Thalia's {1} owed: the payment path parks
        // this cast unpayable in `pendingCast`.
        expect(gateOffersCast(waivedExileBoard({ pool: 0, taxed: true }))).toBe(
            false
        );
    });

    it("still offers the waived cast with no cost modifier on the board", () => {
        // The waiver's own cost is empty, so a board with no modifier and no
        // mana is still affordable — the fold must not make a free cast
        // unaffordable for free.
        expect(
            gateOffersCast(waivedExileBoard({ pool: 0, taxed: false }))
        ).toBe(true);
    });

    it("offers the waived cast under the increase once the caster can pay it, and the payment spends exactly that (CR 118.9d)", async () => {
        const state = waivedExileBoard({ pool: 1, taxed: true });
        expect(gateOffersCast(state)).toBe(true);

        // PAYMENT half — the same board, driven through the real mutation.
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await announce(harness, "waivedGush");

        const after = harness.state();
        // Committed, not parked: the gate and the payment agreed on {1}.
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.id)).toEqual(["waivedGush"]);
        // The {1} was actually spent — the waiver zeroed the printed {4}{U},
        // and the increase survived onto the empty cost. This is the assertion
        // the pre-fix gate could not reach: it offered the cast at zero.
        expect(getPlayer(after, "p1").manaPool.U).toBe(0);
    });
});

describe("a waived cast owes the increase but NOT the printed pips it waived (CR 202.1a / 118.6a, issue #2981 review)", () => {
    // Regression found reviewing the fold above. `coloredCostLeftover` read its
    // guild-hybrid pips off the card's PRINTED cost rather than off the cost
    // being paid — invisible while a waived cast probed a bare `{}`, whose
    // `totalRequired` is 0, so `canPotentiallyPayCost` returned early and never
    // reached that code. Folding an increase onto the empty cost makes
    // `totalRequired` positive, the probe runs, and it demanded the {R/W} the
    // waiver had just zeroed — pips no payment site charges. That is worse than
    // the bug this issue set out to fix: `assertLegalAction` reads the same
    // gate, so the cast became impossible rather than merely parked.
    //
    // Figure of Destiny ({R/W}) is the discriminating card: printed pip, waived
    // away, under an increase, with exactly enough mana for the increase alone.
    function board(taxed: boolean): GameState {
        const exiled = makeInstance(figureOfDestiny.id, {
            id: "waivedFigure",
            zone: "exile",
            controllerId: "p2",
            ownerId: "p2",
            castableFromExileBy: "p1",
            castFromExileWithoutPayingManaCost: true,
            // The object-scoped exile-cast tax (Elite Spellbinder's shape,
            // issue #2383) rather than Thalia: it reaches a CREATURE spell,
            // which "Noncreature spells cost {1} more" does not.
            ...(taxed ? { castFromExileCostIncrease: { X: 1 } } : {}),
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(mountain.id, {
                            id: "mtnH",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", { exile: [exiled] }),
            ],
        });
    }

    const figureIn = (state: GameState) =>
        getPlayer(state, "p2").exile.find((c) => c.id === "waivedFigure")!;

    it("offers the waived cast of a guild-hybrid card under an increase one land can pay", () => {
        // ONE Mountain. The increase is {1}; the printed {R/W} is waived. If the
        // probe re-charged the printed pip the total would be two and this would
        // read "not castable" — and `assertLegalAction` would then throw on the
        // cast the payment path prices at {1}.
        const taxed = board(true);
        expect(
            getLegalActions(
                taxed,
                getPlayer(taxed, "p2"),
                figureIn(taxed),
                false,
                "p1"
            )
        ).toContain("cast");

        // And the payment agrees on that same {1}: the two calls `announceCast`
        // makes, in its order, on this board.
        const paid = normalizeManaCost(
            castRawManaCost(taxed, figureIn(taxed), "exile") ?? {}
        );
        applyCostModifiers(
            paid,
            getCostModifiers(taxed, figureIn(taxed), "spell")
        );
        expect(paid).toEqual({ X: 1 });

        // Untaxed, the waiver is free and no mana is owed at all.
        const free = board(false);
        expect(
            getLegalActions(
                free,
                getPlayer(free, "p2"),
                figureIn(free),
                false,
                "p1"
            )
        ).toContain("cast");
    });
});

describe("the flashback cast gate folds cost modifiers (CR 118.9d / 601.2f, issue #2981)", () => {
    /** Firebolt in p1's graveyard (Flashback {4}{R}) plus `mountains` untapped
     *  Mountains, with Thalia optionally taxing it {1} from p2's board.
     *  Firebolt is a Sorcery, so it is noncreature and Thalia reaches it. */
    function flashbackBoard(opts: {
        mountains: number;
        taxed: boolean;
    }): GameState {
        const inGy = makeInstance(firebolt.id, {
            id: "gyBolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands: CardInstanceState[] = Array.from(
            { length: opts.mountains },
            (_, i) =>
                makeInstance(mountain.id, {
                    id: `mtnF-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
        );
        return makeState({
            players: [
                makePlayer("p1", { graveyard: [inGy], battlefield: lands }),
                makePlayer("p2", {
                    battlefield: opts.taxed ? [thalia()] : [],
                }),
            ],
        });
    }

    const gateOffersCast = (state: GameState) =>
        getLegalActions(
            state,
            getPlayer(state, "p1"),
            getPlayer(state, "p1").graveyard[0]
        ).includes("cast");

    it("offers the flashback cast at the untaxed cost with exactly its five lands", () => {
        expect(
            gateOffersCast(flashbackBoard({ mountains: 5, taxed: false }))
        ).toBe(true);
    });

    it("refuses it on the same five lands once an increase applies, and offers it on six", () => {
        // Flashback {4}{R} + Thalia's {1} = six. `announceCast` folds the same
        // {1} onto the flashback cost, so five lands would park unpayable.
        expect(
            gateOffersCast(flashbackBoard({ mountains: 5, taxed: true }))
        ).toBe(false);
        expect(
            gateOffersCast(flashbackBoard({ mountains: 6, taxed: true }))
        ).toBe(true);
    });
});
