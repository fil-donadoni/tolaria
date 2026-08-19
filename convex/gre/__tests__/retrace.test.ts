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
//   - the NO-EXILE divergence from Flashback: a retraced instant returns to the
//     graveyard on resolution (CR 608.2m) and is retraceable again
//   - precedence: a card that ALSO has flashback takes the cheaper mechanism
//   - the frontend wiring SURFACE: projectPublicState tags the viewer's own
//     graveyard card with `castKind: "retrace"`
import { describe, it, expect } from "vitest";
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
    locateCastSource,
    castRawManaCost,
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
import { WRENN_AND_SIX_EMBLEM_ID } from "../../cards/emblems";
import { lightningBolt } from "../../cards/sets/lea/red";
import { firebolt } from "../../cards/sets/ody/red";
import { grizzlyBears, mountain } from "../../cards/sets/lea";

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
