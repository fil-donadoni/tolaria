// Per-card behavior tests for EOE blue cards (`convex/cards/sets/eoe/blue.ts`).
// Consult the Star Charts exercises the Kicker capability (CR 702.33) + the
// `lookDistribute` Op with a `count` look size (lands you control): put one card into
// hand, or two when kicked. The lookDistribute mechanics are proven generically in
// interpreter.test.ts; here we assert the look size and take count are wired.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { buildDrawEvent } from "../../../../gre/state";
import { buildStateView } from "../../../../gre/replacements";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { tryAutoCommitPendingCast } from "../../../../game";
import { affordableAlternativeCosts } from "../../../../gre/alternativeCost";
import { getLegalActions } from "../../../../gre/rules";
import { getDefinition, registerTokenDefinition } from "../../../index";
import type { EffectOp, ManaCost } from "../../../types";

const consultTheStarCharts = getDefinition(
    "a16a6555-2e3a-4587-aacd-0307d696b26c"
);
const plains = getDefinition("b1623d57-4729-4796-b3f7-f1837a05c6ed");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

const lands = (n: number) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(plains.id, {
            id: `land-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );

const library = (ids: string[]) =>
    ids.map((cid) =>
        makeInstance(grizzlyBears.id, {
            id: cid,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

function submitKeep(state: GameState, keep: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: keep,
    });
}

describe("Consult the Star Charts (Kicker {1}{U}, CR 702.33 / 401.4)", () => {
    it("looks at the top X cards where X is lands you control, keeping one unkicked", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: lands(2),
                    library: library(["a", "b", "c"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, consultTheStarCharts.id, "p1");
        // Suspends on a look-top pick over exactly the top 2 (= lands).
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].candidateIds?.length).toBe(2);
        submitKeep(state, ["a"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        expect(state.players[0].hand.length).toBe(1);
    });

    it("keeps two cards when kicked", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: lands(3),
                    library: library(["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        const item: StackItem = pushSpell(state, consultTheStarCharts.id, "p1");
        item.kickerPayments = { kicker: 1 };
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].candidateIds?.length).toBe(3);
        submitKeep(state, ["a", "b"]);
        expect(state.players[0].hand.length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Quantum Riddler — the draw-replacement half (CR 614 / CR 121.2a, ADR 0061),
// the enters trigger (CR 603.6a) and the Warp half (CR 702.185). This is the
// first shipping user of the seam's `modify-count` outcome, so the count
// semantics of a MULTI-card draw instruction are asserted rather than assumed.
// ---------------------------------------------------------------------------

const quantumRiddler = getDefinition("120be808-ff3b-4fca-96a1-4db6b9825856");

function riddler(controllerId = "p1", id = "riddler") {
    return makeInstance(quantumRiddler.id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** A synthetic sorcery whose only effect is a DSL `draw` Op, registered under a
 *  test id so the catalogue sweep never sees it — the same device the
 *  Hullbreacher tests use to drive an EFFECT draw through `resolveTopOfStack`. */
function registerDrawSpell(id: string, count: number): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 1 },
        types: ["Sorcery"],
        effects: [{ op: "draw", player: "controller", count } as EffectOp],
    });
    return id;
}

/** A `ManaCost` in the shape `pendingCast.manaCost` wants, read off the
 *  definition rather than hand-copied: `ManaCost` permits the variable `{X}`
 *  spelling, which this card's warp cost does not use. A changed warp cost
 *  therefore changes what the cast below actually pays. */
function fixedManaCost(cost: ManaCost): Record<string, number> {
    return Object.fromEntries(
        Object.entries(cost).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number"
        )
    );
}

function libraryOf(n: number, ownerId = "p1") {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `${ownerId}-lib-${i}`,
            controllerId: ownerId,
            ownerId,
            zone: "library",
        })
    );
}

describe("Quantum Riddler (CR 614 / CR 121.2a / CR 702.185 — issue #3294)", () => {
    const replacement = quantumRiddler.drawReplacement!;

    describe("the replacement's scope (CR 614)", () => {
        // The predicate reads hand size off the REAL replacement state view
        // (`buildStateView`), not a hand-built object — a view that dropped
        // `handSize` would silently read `undefined` and fail open.
        function appliesFor(opts: {
            handSize: number;
            drawingPlayer: string;
        }): boolean {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: libraryOf(opts.handSize).map((c) => ({
                            ...c,
                            zone: "hand" as const,
                        })),
                        battlefield: [riddler("p1")],
                    }),
                    makePlayer("p2"),
                ],
            });
            const event = buildDrawEvent(state, opts.drawingPlayer, 1, false);
            return replacement.applies(
                event,
                { controllerId: "p1" } as never,
                buildStateView(state)
            );
        }

        it("applies to the controller's own draw with an EMPTY hand", () => {
            expect(appliesFor({ handSize: 0, drawingPlayer: "p1" })).toBe(true);
        });

        it("applies at exactly ONE card in hand ('one or fewer')", () => {
            expect(appliesFor({ handSize: 1, drawingPlayer: "p1" })).toBe(true);
        });

        it("does NOT apply once the controller holds two cards", () => {
            expect(appliesFor({ handSize: 2, drawingPlayer: "p1" })).toBe(
                false
            );
        });

        it("does NOT apply to an OPPONENT's draw ('you would draw')", () => {
            expect(appliesFor({ handSize: 0, drawingPlayer: "p2" })).toBe(
                false
            );
        });
    });

    describe("count semantics through the real draw seam (CR 121.2a)", () => {
        function stateWithRiddler(opts: {
            spellId: string;
            handSize?: number;
            withRiddler?: boolean;
        }): GameState {
            const hand = Array.from({ length: opts.handSize ?? 0 }, (_, i) =>
                makeInstance(grizzlyBears.id, {
                    id: `held-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                })
            );
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand,
                        library: libraryOf(8),
                        battlefield:
                            opts.withRiddler === false ? [] : [riddler("p1")],
                    }),
                    makePlayer("p2", { library: libraryOf(8, "p2") }),
                ],
            });
            pushSpell(state, opts.spellId, "p1");
            return state;
        }

        it("a one-card draw yields TWO cards", () => {
            const id = registerDrawSpell("test-riddler-draw-1", 1);
            const state = stateWithRiddler({ spellId: id });
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(2);
        });

        it("'draw 3' with an empty hand yields FOUR cards, not six", () => {
            // CR 121.2a — "An instruction to draw multiple cards can be
            // modified by replacement effects that refer to the number of
            // cards drawn. This modification occurs before considering any of
            // the individual card draws." So the Oracle's "you draw that many
            // cards plus one instead" is ONE extra card for the whole
            // instruction: 3 + 1 = 4. The seam fires once per card, so the
            // agreement is load-bearing and asserted, not assumed — the FIRST
            // card takes the +1 bump and the hand is then at two, which
            // switches this card's own condition off for the rest of the
            // instruction. Six would be the per-card reading; three would mean
            // the replacement never fired at all.
            const id = registerDrawSpell("test-riddler-draw-3", 3);
            const state = stateWithRiddler({ spellId: id });
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(4);
            expect(state.players[0].library).toHaveLength(4);
        });

        it("'draw 2' from a hand of one also yields exactly one extra card", () => {
            // Hand 1 → the instruction is modified once: 2 + 1 = 3 drawn, hand 4.
            const id = registerDrawSpell("test-riddler-draw-2", 2);
            const state = stateWithRiddler({ spellId: id, handSize: 1 });
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(4);
        });

        it("with two cards already in hand the instruction is untouched", () => {
            const id = registerDrawSpell("test-riddler-draw-full-hand", 2);
            const state = stateWithRiddler({ spellId: id, handSize: 2 });
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(4);
        });

        it("TWO Sphinxes compound: 'draw a card' becomes three, not two", () => {
            // CR 616.1f — "Once the chosen effect has been applied, this
            // process is repeated (taking into account only replacement or
            // prevention effects that would now be applicable) until there are
            // no more left to apply" — and CR 614.5 gives each effect one
            // opportunity, its own example compounding two doubling
            // replacements to 8 rather than 4. Both Sphinxes see a hand of
            // zero, so both apply: 1 → 2 → 3. Two would mean only the first
            // one was ever consulted.
            const id = registerDrawSpell("test-riddler-two-sphinxes", 1);
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: libraryOf(8),
                        battlefield: [
                            riddler("p1", "riddler-a"),
                            riddler("p1", "riddler-b"),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, id, "p1");
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(3);
        });

        it("the clause is gone once the Sphinx is not on the battlefield", () => {
            const id = registerDrawSpell("test-riddler-no-source", 1);
            const state = stateWithRiddler({
                spellId: id,
                withRiddler: false,
            });
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(1);
        });

        it("an OPPONENT's draw is never modified", () => {
            const id = registerDrawSpell("test-riddler-opponent-draw", 1);
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: libraryOf(8),
                        battlefield: [riddler("p1")],
                    }),
                    makePlayer("p2", { library: libraryOf(8, "p2") }),
                ],
            });
            pushSpell(state, id, "p2");
            resolveTopOfStack(state);
            expect(state.players[1].hand).toHaveLength(1);
        });
    });

    describe("the enters trigger (CR 603.2 / CR 603.6a)", () => {
        it("goes on the stack, and its own draw is replaced by the Sphinx that just entered", () => {
            const state = makeState({
                players: [
                    makePlayer("p1", { library: libraryOf(8) }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, quantumRiddler.id, "p1");
            resolveTopOfStack(state);

            // CR 603.3 — the trigger uses the stack, it never auto-resolves.
            expect(state.stack).toHaveLength(1);
            expect(state.players[0].hand).toHaveLength(0);

            resolveTopOfStack(state);
            // The controller's hand was empty as the trigger resolved and the
            // Sphinx was already on the battlefield, so its own ETB draw is
            // the replaced one: "draw a card" becomes two.
            expect(state.players[0].hand).toHaveLength(2);
        });
    });

    describe("Warp {1}{U} (CR 702.185)", () => {
        function riddlerInHand() {
            return makeInstance(quantumRiddler.id, {
                id: "riddler-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
        }

        function stateWithRiddlerInHand(pool: { U?: number; C?: number }) {
            const card = riddlerInHand();
            const state = makeState({
                players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
            });
            state.players[0].manaPool.U = pool.U ?? 0;
            state.players[0].manaPool.C = pool.C ?? 0;
            return { state, card };
        }

        it("declares the warp cost among the card's alternative costs", () => {
            const { state, card } = stateWithRiddlerInHand({ U: 1, C: 1 });
            expect(
                affordableAlternativeCosts(state, state.players[0], card).map(
                    (a) => a.id
                )
            ).toContain("warp");
        });

        it("makes 'cast' legal on exactly {1}{U} — nowhere near the printed {3}{U}{U}", () => {
            // `getLegalActions` is the affordability gate (the alternative-cost
            // enumeration above is not), so this is the assertion that actually
            // rides the warp cost's own numbers: two mana is enough only
            // because the warp cost is {1}{U}.
            const { state, card } = stateWithRiddlerInHand({ U: 1, C: 1 });
            expect(getLegalActions(state, state.players[0], card)).toContain(
                "cast"
            );
        });

        it("and illegal with nothing floating — the warp cost is still a COST", () => {
            const { state, card } = stateWithRiddlerInHand({});
            expect(
                getLegalActions(state, state.players[0], card)
            ).not.toContain("cast");
        });

        it("the warp cast resolves, then exiles at the next end step with the window opening the turn after", () => {
            const card = riddlerInHand();
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [card], library: libraryOf(8) }),
                    makePlayer("p2"),
                ],
            });
            state.turn = 3;
            state.players[0].manaPool.U = 1;
            state.players[0].manaPool.C = 1;
            state.pendingCast = {
                playerId: "p1",
                cardInstanceId: "riddler-hand",
                // The card's OWN warp cost, never a hand-copied literal: a
                // definition whose warp cost changed must move this test.
                manaCost: fixedManaCost(quantumRiddler.warp!.mana!),
                tappedLandIds: [],
                warped: true,
            };
            expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
            // CR 702.185c — the warp cast is recorded as one.
            expect(state.players[0].spellsWarpedThisTurn).toBe(1);

            resolveTopOfStack(state); // the spell → the permanent
            resolveTopOfStack(state); // its enters trigger
            expect(
                state.players[0].battlefield.some(
                    (c) => c.id === "riddler-hand"
                )
            ).toBe(true);
            expect(state.players[0].hand).toHaveLength(2);

            // CR 702.185a — "exile the permanent this spell becomes at the
            // beginning of the next end step".
            fireDelayedTriggers(state, "next-end-step");
            resolveTopOfStack(state);
            const exiled = state.players[0].exile.find(
                (c) => c.id === "riddler-hand"
            )!;
            expect(exiled).toBeDefined();
            expect(exiled.warpExiled).toBe(true);
            // "Its owner may cast this card AFTER THE CURRENT TURN HAS ENDED."
            expect(exiled.castableFromExileBy).toBe("p1");
            expect(exiled.castableFromExileFromTurn).toBe(4);
        });
    });
});
