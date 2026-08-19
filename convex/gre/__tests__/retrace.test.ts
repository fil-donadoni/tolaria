// Retrace capability tests (CR 702.81). Built once here for the whole keyword,
// the way `flashback.test.ts` is built for CR 702.34, and covering the entire
// GRE → game.ts → UI path the capability crosses:
//   - the grant producer sweep (convex/gre/retrace.ts: emblem grant + the
//     printed `staticAbilities: ["retrace"]` keyword channel)
//   - the cast affordance gate (getLegalActions offers "cast" from the
//     graveyard only when BOTH the printed mana cost and the land discard are
//     payable — retrace ADDS a cost, it does not replace one)
//   - the real cast-commit seam (locateCastSource / castRawManaCost /
//     graveyardCastStackFlags / finalizeTargetSelection /
//     recordCastAlternativeHandCostPick / tryAutoCommitPendingCast exported
//     from game.ts and driven in the order announceCast drives them — the
//     project has no convex-test harness, issue #944)
//   - ALL THREE cast-commit paths charge the CR 702.81a discard, not just the
//     targeted one: the `announceCast` no-target path (driven end to end
//     through the registered mutation's own `_handler`), the targeted path's
//     mana park, and the `castExtraHandCostLegs` seam they all read (the issue
//     #2358 review's finding 1 — see the block at the foot of this file)
//   - the NO-EXILE divergence from Flashback: a retraced instant returns to the
//     graveyard on resolution (CR 608.2m) and is retraceable again
//   - precedence: a card that ALSO has flashback takes the cheaper mechanism
//   - the frontend wiring SURFACE: projectPublicState tags the viewer's own
//     graveyard card with `castKind: "retrace"`
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    resolveTopOfStack,
    removeFromZone,
    getPlayer,
    type GameState,
    type StackItem,
    type PendingTarget,
} from "../state";
import { getLegalActions } from "../rules";
import {
    hasRetrace,
    hasPrintedRetrace,
    hasGrantedRetrace,
    findRetraceCastable,
    canPayRetraceDiscard,
    RETRACE_COST_LEGS,
} from "../retrace";
import {
    announceCast,
    locateCastSource,
    castRawManaCost,
    castExtraHandCostLegs,
    graveyardCastStackFlags,
    finalizeTargetSelection,
    recordCastAlternativeHandCostPick,
    tryAutoCommitPendingCast,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../__tests__/gameMutationHarness";
import type { Id } from "../../_generated/dataModel";
import { WRENN_AND_SIX_EMBLEM_ID } from "../../cards/emblems";
import { lightningBolt } from "../../cards/sets/lea/red";
import { firebolt } from "../../cards/sets/ody/red";
import {
    grizzlyBears,
    mountain,
    plains,
    wrathOfGod,
} from "../../cards/sets/lea";

/** The Wrenn and Six emblem as it lives in `GameState.emblems` (CR 114) — the
 *  ONLY producer of a retrace grant in the pool. */
function wrennEmblem(ownerId: string) {
    return {
        id: `emblem-${ownerId}`,
        ownerId,
        emblemId: WRENN_AND_SIX_EMBLEM_ID,
        name: "Wrenn and Six emblem",
        text: "Instant and sorcery cards in your graveyard have retrace.",
    };
}

describe("Retrace capability (CR 702.81)", () => {
    describe("the grant producers (convex/gre/retrace.ts)", () => {
        it("the emblem grants retrace to an instant in its OWNER's graveyard", () => {
            const bolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [bolt] }),
                    makePlayer("p2"),
                ],
                emblems: [wrennEmblem("p1")],
            });
            expect(hasGrantedRetrace(state, bolt)).toBe(true);
            expect(hasRetrace(state, bolt)).toBe(true);
            expect(
                findRetraceCastable(state, getPlayer(state, "p1"), bolt.id)
            ).toBeDefined();
        });

        it("without the emblem nothing in the graveyard has retrace", () => {
            const bolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [bolt] }),
                    makePlayer("p2"),
                ],
            });
            expect(hasRetrace(state, bolt)).toBe(false);
            expect(
                findRetraceCastable(state, getPlayer(state, "p1"), bolt.id)
            ).toBeUndefined();
        });

        it("the grant does NOT reach a card type outside its wording (a creature)", () => {
            // "INSTANT AND SORCERY cards in your graveyard have retrace" — the
            // `cardTypes` filter is fail-closed, so a creature card is untouched.
            const bear = makeInstance(grizzlyBears.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [bear] }),
                    makePlayer("p2"),
                ],
                emblems: [wrennEmblem("p1")],
            });
            expect(hasRetrace(state, bear)).toBe(false);
        });

        it("the grant NEVER reaches a land (CR 305.1 — a land is never a spell)", () => {
            const land = makeInstance(mountain.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [land] }),
                    makePlayer("p2"),
                ],
                emblems: [wrennEmblem("p1")],
            });
            expect(hasRetrace(state, land)).toBe(false);
        });

        it("the grant is scoped to its OWNER's graveyard, never the opponent's", () => {
            // CR 114.3 — "cards in YOUR graveyard". p2's identical instant is
            // untouched by p1's emblem.
            const mine = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const theirs = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [mine] }),
                    makePlayer("p2", { graveyard: [theirs] }),
                ],
                emblems: [wrennEmblem("p1")],
            });
            expect(hasRetrace(state, mine)).toBe(true);
            expect(hasRetrace(state, theirs)).toBe(false);
        });

        it("PRINTED retrace works through the ordinary keyword channel, with no emblem", () => {
            // CR 702.81a — the keyword itself, `staticAbilities: ["retrace"]`.
            const printed = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
                staticAbilities: ["retrace"],
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [printed] }),
                    makePlayer("p2"),
                ],
            });
            expect(hasPrintedRetrace(printed)).toBe(true);
            expect(hasGrantedRetrace(state, printed)).toBe(false);
            expect(hasRetrace(state, printed)).toBe(true);
        });
    });

    describe("the additional cost (CR 702.81a — discard a land card)", () => {
        it("is the shared CostLegs hand leg for exactly one LAND card", () => {
            expect(RETRACE_COST_LEGS).toEqual({
                hand: {
                    action: "discard",
                    requirements: [{ filter: { type: "Land" }, count: 1 }],
                },
            });
        });

        it("is payable with a land in hand and unpayable without one", () => {
            const bolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const land = makeInstance(mountain.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const bear = makeInstance(grizzlyBears.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const withLand = makePlayer("p1", {
                graveyard: [bolt],
                hand: [land],
            });
            const nonlandOnly = makePlayer("p1", {
                graveyard: [bolt],
                hand: [bear],
            });
            expect(canPayRetraceDiscard(withLand, bolt.id)).toBe(true);
            expect(canPayRetraceDiscard(nonlandOnly, bolt.id)).toBe(false);
        });
    });

    describe("cast affordance from the graveyard (getLegalActions)", () => {
        function stateWithRetraceBolt(opts: {
            mana?: number;
            hand?: "land" | "nonland" | "empty";
        }): { state: GameState; boltId: string } {
            const bolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const hand =
                opts.hand === "land"
                    ? [
                          makeInstance(mountain.id, {
                              zone: "hand",
                              controllerId: "p1",
                              ownerId: "p1",
                          }),
                      ]
                    : opts.hand === "nonland"
                      ? [
                            makeInstance(grizzlyBears.id, {
                                zone: "hand",
                                controllerId: "p1",
                                ownerId: "p1",
                            }),
                        ]
                      : [];
            const p1 = makePlayer("p1", {
                graveyard: [bolt],
                hand,
                manaPool: {
                    W: 0,
                    U: 0,
                    B: 0,
                    R: opts.mana ?? 1,
                    G: 0,
                    C: 0,
                },
            });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                emblems: [wrennEmblem("p1")],
            });
            return { state, boltId: bolt.id };
        }

        function actions(state: GameState, id: string) {
            const card = getPlayer(state, "p1").graveyard.find(
                (c) => c.id === id
            )!;
            return getLegalActions(state, getPlayer(state, "p1"), card);
        }

        it('offers "cast" with the printed mana cost payable AND a land in hand', () => {
            const { state, boltId } = stateWithRetraceBolt({ hand: "land" });
            expect(actions(state, boltId)).toEqual(["cast"]);
        });

        it("does NOT offer cast with no land in hand (CR 702.81a additional cost)", () => {
            const { state, boltId } = stateWithRetraceBolt({ hand: "nonland" });
            expect(actions(state, boltId)).toEqual([]);
        });

        it("does NOT offer cast when the PRINTED mana cost is unaffordable", () => {
            // CR 702.81a — retrace is an ADDITIONAL cost: the card's own mana
            // cost is still paid in full, unlike Flashback/Escape.
            const { state, boltId } = stateWithRetraceBolt({
                mana: 0,
                hand: "land",
            });
            expect(actions(state, boltId)).toEqual([]);
        });
    });

    describe("the real cast seam + NO exile on resolution (CR 608.2m)", () => {
        function retraceState() {
            const bolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const land = makeInstance(mountain.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", {
                graveyard: [bolt],
                hand: [land],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                emblems: [wrennEmblem("p1")],
            });
            return { state, bolt, land };
        }

        it("locateCastSource claims the graveyard card via retrace and keeps the PRINTED mana cost", () => {
            const { state, bolt } = retraceState();
            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                bolt.id
            );
            expect(src.zone).toBe("graveyard");
            expect(src.card?.id).toBe(bolt.id);
            expect(src.viaRetrace).toBe(true);
            // CR 702.81a — ADDITIONAL, not alternative: no cost replacement.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                R: 1,
            });
        });

        it("graveyardCastStackFlags sets castFromGraveyard and NOT exileOnResolve", () => {
            const { state, bolt } = retraceState();
            const flags = graveyardCastStackFlags(state, bolt, "graveyard");
            expect(flags.castFromGraveyard).toBe(true);
            // The headline divergence from Flashback (CR 702.34a exiles).
            expect(flags.exileOnResolve).toBeUndefined();
            // Retrace is not Escape either — nothing "escaped".
            expect(flags.escaped).toBeUndefined();
        });

        it("resolves back into the GRAVEYARD and is retraceable again", () => {
            const { state, bolt } = retraceState();
            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                bolt.id
            );
            const removed = removeFromZone(
                getPlayer(state, "p1"),
                bolt.id,
                src.zone
            );
            const stackItem: StackItem = {
                ...removed,
                castById: "p1",
                targets: [{ type: "player", id: "p2" }],
                ...graveyardCastStackFlags(state, removed, src.zone),
            };
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            const p1 = getPlayer(state, "p1");
            expect(getPlayer(state, "p2").life).toBe(17);
            // CR 608.2m — the instant is put into its owner's GRAVEYARD, not
            // exiled: this is what makes retrace repeatable.
            expect(p1.graveyard.some((c) => c.id === bolt.id)).toBe(true);
            expect(p1.exile.some((c) => c.id === bolt.id)).toBe(false);
            // …and it still has retrace, so a second land in hand buys another cast.
            const again = p1.graveyard.find((c) => c.id === bolt.id)!;
            expect(hasRetrace(state, again)).toBe(true);
        });

        it("pays the land discard through the cast's hand-cost picker end to end", () => {
            const { state, bolt, land } = retraceState();
            // Two lands in hand, so the picker is a REAL choice and parks
            // rather than auto-resolving.
            const land2 = makeInstance(mountain.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            getPlayer(state, "p1").hand.push(land2);

            const pt: PendingTarget = {
                playerId: "p1",
                cardInstanceId: bolt.id,
                targetType: "any",
                count: 1,
                selected: [{ type: "player", id: "p2" }],
            };
            finalizeTargetSelection(state, pt, "p1");

            // CR 702.81a / 601.2f — the discard leg is parked on the cast.
            expect(state.pendingCast?.alternativeCostHandChoice).toBeDefined();
            expect(tryAutoCommitPendingCast(state, "p1")).toBeNull();

            recordCastAlternativeHandCostPick(state, "p1", [land.id]);
            const committed = tryAutoCommitPendingCast(state, "p1");
            expect(committed).not.toBeNull();

            resolveTopOfStack(state);
            const p1 = getPlayer(state, "p1");
            // The discarded land is in the graveyard (discarded, not exiled) —
            // so it could itself be replayed by an effect that plays lands from
            // there. The OTHER land is untouched.
            expect(p1.graveyard.some((c) => c.id === land.id)).toBe(true);
            expect(p1.hand.some((c) => c.id === land.id)).toBe(false);
            expect(p1.hand.some((c) => c.id === land2.id)).toBe(true);
            // And the spell itself is back in the graveyard, not exiled.
            expect(p1.graveyard.some((c) => c.id === bolt.id)).toBe(true);
            expect(p1.exile.some((c) => c.id === bolt.id)).toBe(false);
            expect(getPlayer(state, "p2").life).toBe(17);
        });
    });

    describe("precedence — a cheaper graveyard mechanism wins (must-NOT row)", () => {
        it("a FLASHBACK sorcery under the emblem is claimed by flashback, not retrace", () => {
            // Firebolt is a sorcery WITH flashback, so under the emblem it has
            // both mechanisms. Retrace costs strictly more (printed cost + a
            // discarded land), so `locateCastSource` must take flashback — and
            // the resulting cast must still exile on resolution.
            const fb = makeInstance(firebolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const land = makeInstance(mountain.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [fb], hand: [land] }),
                    makePlayer("p2"),
                ],
                emblems: [wrennEmblem("p1")],
            });
            expect(hasRetrace(state, fb)).toBe(true);
            const src = locateCastSource(state, getPlayer(state, "p1"), fb.id);
            expect(src.viaRetrace).toBeUndefined();
            // CR 702.34a — the flashback cost replaces the printed {R}.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                X: 4,
                R: 1,
            });
            expect(
                graveyardCastStackFlags(state, fb, "graveyard").exileOnResolve
            ).toBe(true);
        });
    });

    describe("frontend wiring — projectPublicState tags the affordance", () => {
        function project(state: GameState) {
            return projectPublicState(state, 1, "p1");
        }

        it('tags the viewer\'s own retrace card castKind: "retrace" with legalActions', () => {
            const bolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const land = makeInstance(mountain.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        graveyard: [bolt],
                        hand: [land],
                        manaPool: {
                            W: 0,
                            U: 0,
                            B: 0,
                            R: 1,
                            G: 0,
                            C: 0,
                        },
                    }),
                    makePlayer("p2"),
                ],
                emblems: [wrennEmblem("p1")],
            });
            const projected = project(state);
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === bolt.id
            )!;
            expect(slim.castKind).toBe("retrace");
            expect(slim.legalActions).toEqual(["cast"]);
        });

        it("attaches NO castKind when nothing grants retrace", () => {
            const bolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [bolt] }),
                    makePlayer("p2"),
                ],
            });
            const slim = project(state).players[0].graveyard.find(
                (c) => c.id === bolt.id
            )!;
            expect(slim.castKind).toBeUndefined();
            expect(slim.legalActions).toBeUndefined();
        });

        it("never tags the OPPONENT's graveyard card, even under their own emblem", () => {
            const theirs = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { graveyard: [theirs] }),
                ],
                emblems: [wrennEmblem("p2")],
            });
            const slim = project(state).players[1].graveyard.find(
                (c) => c.id === theirs.id
            )!;
            expect(slim.castKind).toBeUndefined();
        });
    });
});

// ---------------------------------------------------------------------------
// The NO-TARGET cast-commit path (issue #2358 review, finding 1).
//
// `RETRACE_COST_LEGS` used to be consumed at exactly ONE site,
// `finalizeTargetSelection` — reachable only from target selection. A retrace
// cast of a NON-targeting instant/sorcery goes through `announceCast`'s
// no-target branch instead, which built its hand-cost picker from the card's
// declared additional cost alone: the spell committed with
// `alternativeCostHandChoice === undefined` and discarded no land at all. A
// straight CR 702.81a violation, and it removed the only thing bounding the
// no-exile recast loop (`canPayRetraceDiscard`'s doc).
//
// Wrath of God (`lea/white.ts`) is the shape: a Sorcery with NO
// `targetRequirement`, so the Wrenn and Six emblem grants it retrace and its
// cast can only commit down this path. Driven through the REGISTERED mutation's
// own `_handler` (`gameMutationHarness`, the established seam — this project has
// no convex-test package, issue #944), never a reimplementation of
// `announceCast`'s body, which would share the bug's premise.
type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

/** p1 under the Wrenn and Six emblem, with Wrath of God in the graveyard,
 *  `{W}{W}{W}{W}` already floating (so mana is never the gate) and `lands`
 *  land cards in hand. Two lands make the retrace discard a REAL choice, so
 *  the cast parks on the picker rather than auto-resolving it. */
function wrathRetraceBoard(lands: number): GameState {
    const wrath = makeInstance(wrathOfGod.id, {
        id: "wrath",
        zone: "graveyard",
        controllerId: "p1",
        ownerId: "p1",
    });
    const hand = Array.from({ length: lands }, (_, i) =>
        makeInstance(plains.id, {
            id: `land-${i}`,
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                graveyard: [wrath],
                hand,
                manaPool: { W: 4, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        emblems: [wrennEmblem("p1")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const announceWrath = (harness: ReturnType<typeof makeMutationCtx>) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId: "wrath",
        }
    );

describe("announceCast — a NON-targeting retrace cast pays the land discard (CR 702.81a, issue #2358)", () => {
    it("Wrath of God from the graveyard: the cast parks on the discard picker, and the picked land actually leaves hand for the graveyard", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(wrathRetraceBoard(2)),
        ]);
        await announceWrath(harness);

        // THE headline assertion. Before the fix the no-target branch folded no
        // retrace leg, so there was no picker at all: the spell went straight
        // onto the stack with both lands still in hand.
        const parked = harness.state();
        expect(parked.stack).toHaveLength(0);
        expect(parked.pendingCast?.alternativeCostHandChoice).toEqual({
            action: "discard",
            requirements: [{ filter: { type: "Land" }, count: 1 }],
            excludeInstanceId: "wrath",
        });
        expect(parked.players[0].hand.map((c) => c.id)).toEqual([
            "land-0",
            "land-1",
        ]);

        // …and the rest of the path is the ordinary hand-cost one: pick, commit.
        const state = parked;
        recordCastAlternativeHandCostPick(state, "p1", ["land-0"]);
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();

        const p1 = getPlayer(state, "p1");
        // CR 702.81a — the land was DISCARDED (graveyard, not exile), the other
        // one is untouched, and the spell is on the stack.
        expect(p1.hand.map((c) => c.id)).toEqual(["land-1"]);
        expect(p1.graveyard.map((c) => c.id)).toContain("land-0");
        expect(p1.exile.map((c) => c.id)).not.toContain("land-0");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe("wrath");
        expect(state.pendingCast).toBeUndefined();
    });

    it("is REFUSED outright with no land in hand (CR 601.2h — an unpayable cost can't be paid)", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(wrathRetraceBoard(0)),
        ]);
        await expect(announceWrath(harness)).rejects.toThrow();
        // Nothing moved: no partial cast, no stack item, no park.
        const after = harness.state();
        expect(after.stack).toHaveLength(0);
        expect(after.pendingCast).toBeUndefined();
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual(["wrath"]);
    });
});

describe("finalizeTargetSelection — a FORCED retrace discard survives the mana park (CR 601.2f, issue #2358)", () => {
    it("carries the auto-resolved pick on pendingCast so the deferred commit charges it", () => {
        // The third commit path. `parkForSacrifice` only fires on an INCOMPLETE
        // hand choice, so a forced pick (exactly ONE land in hand) falls through
        // it already resolved; with mana not yet covered the cast then parks in
        // the `else` branch — which used to spread no `alternativeCostHandChoice`
        // at all, and `tryAutoCommitPendingCast` reads the choice off
        // `pendingCast` and nowhere else. The land was never discarded.
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(mountain.id, {
            id: "land",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [bolt],
                    hand: [land],
                    // Empty pool: {R} is NOT covered, so the cast parks.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
            emblems: [wrennEmblem("p1")],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "bolt",
            targetType: "any",
            count: 1,
            selected: [{ type: "player", id: "p2" }],
        };
        finalizeTargetSelection(state, pt, "p1");

        expect(state.stack).toHaveLength(0);
        expect(
            state.pendingCast?.alternativeCostHandChoice?.pickedCardIds
        ).toEqual(["land"]);

        // Mana arrives (the `tapForPayment` half, elided) and the deferred
        // commit charges the retrace discard.
        getPlayer(state, "p1").manaPool.R = 1;
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        const p1 = getPlayer(state, "p1");
        expect(p1.hand).toHaveLength(0);
        expect(p1.graveyard.map((c) => c.id)).toContain("land");
        expect(state.stack).toHaveLength(1);
    });
});

describe("castExtraHandCostLegs is the ONE authority every cast-commit path reads (issue #2358 review)", () => {
    it("folds the retrace leg only for a retrace cast, and the card's own discard leg always", () => {
        expect(castExtraHandCostLegs(undefined, {})).toEqual([]);
        expect(castExtraHandCostLegs(undefined, { viaRetrace: true })).toEqual([
            RETRACE_COST_LEGS,
        ]);
        // CR 118.8 + 702.81a on the same cast: both legs, declared cost first.
        expect(
            castExtraHandCostLegs(
                { discard: { count: 1 } },
                { viaRetrace: true }
            )
        ).toEqual([
            {
                hand: {
                    action: "discard",
                    requirements: [{ filter: {}, count: 1 }],
                },
            },
            RETRACE_COST_LEGS,
        ]);
    });

    it("every buildCastHandCostChoice call in game.ts sources its extraLegs from the seam", () => {
        // The structural half of finding 1: the bug was one cast-commit path
        // that simply forgot the leg while type-checking clean. `extraLegs` is
        // now a REQUIRED parameter (so a new site cannot omit it) and this scan
        // is what stops a new site from passing a hand-rolled list instead.
        const src = fs
            .readFileSync(
                path.resolve(__dirname, "..", "..", "game.ts"),
                "utf8"
            )
            .split("\n");
        const sites: string[] = [];
        const offenders: string[] = [];
        for (let i = 0; i < src.length; i++) {
            if (!/buildCastHandCostChoice\($/.test(src[i].trim())) continue;
            let end = i;
            while (end < src.length && !/^\s*\);\s*$/.test(src[end])) end += 1;
            const call = src.slice(i, end + 1).join("\n");
            sites.push(`convex/game.ts:${i + 1}`);
            if (!call.includes("castExtraHandCostLegs(")) {
                offenders.push(`convex/game.ts:${i + 1}`);
            }
        }
        // The scan must actually REACH the code: three cast-commit paths build
        // this picker today (`finalizeTargetSelection`, and `announceCast`'s
        // alternative-cost and normal no-target branches). A fourth is not
        // forbidden — it just has to make the same decision, through the seam.
        expect(sites.length).toBeGreaterThanOrEqual(3);
        expect(
            offenders,
            "a cast-commit path building its hand-cost picker without " +
                "`castExtraHandCostLegs` charges no retrace discard (CR 702.81a) " +
                "and no card-declared discard cost (CR 118.8). Call the seam."
        ).toEqual([]);
    });
});
