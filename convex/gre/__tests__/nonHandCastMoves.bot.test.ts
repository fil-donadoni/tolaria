// The Bot's candidate set for a cast from a NON-hand zone (issue #2971).
//
// `enumerateMoves` fed `enumerateCastMoves` from three places — the hand, the
// retrace loop over the graveyard, and the library top — so every
// cast-from-exile and (non-retrace) cast-from-graveyard permission the engine
// ships was invisible to the Brain. The omission was silent by construction:
// `getLegalActions` returns "cast" for all of them, and the human client renders
// its exile Cast button off that very call, so nothing in the engine reported a
// disagreement. Only the candidate SET was missing.
//
// Two halves, tested here:
//   1. CANDIDATE SET — the Move is offered, priced through `castRawManaCost`
//      (`gre/castCost.ts`, the one authority the real commit paths read), and
//      never offered for a card no mechanism permits.
//   2. EXECUTOR — the Move is applicable in BOTH search sandboxes and produces
//      the same stack flags the real mutation stamps, asserted PER MECHANISM.
//
// Costs whose park the `cast-spell` Move cannot carry (escape's exile-N-others,
// a non-mana flashback cost) fail CLOSED: not enumerated, asserted below.

import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { getLegalActions } from "../rules";
import { graveyardCastMechanism } from "../castCost";
import { cloneGameState } from "../clone";
import { getPlayer, type CardInstanceState, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { island, mountain, forest, grizzlyBears } from "../../cards/sets/lea";
import { withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { firebolt } from "../../cards/sets/ody/red";
import { uroTitanOfNaturesWrath } from "../../cards/sets/thb/multicolor";
import { hogaakArisenNecropolis } from "../../cards/sets/mh1/multicolor";

type CastMove = Extract<Move, { kind: "cast-spell" }>;

const castsOf = (state: GameState, playerId: string): CastMove[] =>
    enumerateMoves(state, playerId).filter(
        (m): m is CastMove => m.kind === "cast-spell"
    );

const castOf = (
    state: GameState,
    playerId: string,
    instanceId: string
): CastMove | undefined =>
    castsOf(state, playerId).find((m) => m.cardInstanceId === instanceId);

/** `count` untapped basics of `def` on `owner`'s battlefield. */
function lands(
    def: { id: string },
    count: number,
    owner: string
): CardInstanceState[] {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(def.id, {
            id: `${owner}-land-${def.id.slice(0, 4)}-${i}`,
            controllerId: owner,
            ownerId: owner,
        })
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Candidate set — EXILE (CR 601.3)
// ═══════════════════════════════════════════════════════════════════════════

describe("enumerateMoves — a cast from EXILE (CR 601.3, issue #2971)", () => {
    /** Firebolt ({R} Sorcery) in `zoneOwnerId`'s exile, castable by `casterId`,
     *  with `casterId` holding `mountains` untapped Mountains. */
    function exileBoard(opts: {
        zoneOwner: "p1" | "p2";
        casterId: string;
        mountains: number;
        extra?: Partial<CardInstanceState>;
    }): GameState {
        const exiled = makeInstance(firebolt.id, {
            id: "exiledBolt",
            zone: "exile",
            controllerId: opts.zoneOwner,
            ownerId: opts.zoneOwner,
            castableFromExileBy: opts.casterId,
            ...opts.extra,
        });
        const mk = (id: "p1" | "p2") =>
            makePlayer(id, {
                ...(opts.zoneOwner === id ? { exile: [exiled] } : {}),
                ...(id === "p1"
                    ? { battlefield: lands(mountain, opts.mountains, "p1") }
                    : {}),
            });
        return makeState({ players: [mk("p1"), mk("p2")] });
    }

    it("offers the cast for a card in the caster's OWN exile under an open-ended grant", () => {
        const state = exileBoard({
            zoneOwner: "p1",
            casterId: "p1",
            mountains: 1,
        });
        // The affordance half has been complete for a long time — this asserts
        // the two now AGREE, which is the whole bug.
        const exiled = getPlayer(state, "p1").exile[0];
        expect(
            getLegalActions(state, getPlayer(state, "p1"), exiled)
        ).toContain("cast");
        const cast = castOf(state, "p1", "exiledBolt");
        expect(cast).toBeDefined();
        expect(cast!.castFromZone).toBe("exile");
        // {R} — one Mountain, the printed cost (no grant waiver here).
        expect(cast!.tapPlan).toHaveLength(1);
    });

    it("offers the cast for a card in an OPPONENT's exile under a cross-player grant (CR 400.7)", () => {
        // Dauthi Voidwalker / Robber of the Rich / Elite Spellbinder shape: the
        // card sits in its OWNER's exile while a DIFFERENT player holds the
        // permission. Scanning only the caster's own exile misses all three.
        const state = exileBoard({
            zoneOwner: "p2",
            casterId: "p1",
            mountains: 1,
        });
        const cast = castOf(state, "p1", "exiledBolt");
        expect(cast).toBeDefined();
        expect(cast!.castFromZone).toBe("exile");
        // …and the opponent, who does NOT hold the grant, is offered nothing.
        expect(castOf(state, "p2", "exiledBolt")).toBeUndefined();
    });

    it("prices a WAIVED exile grant at nothing (CR 601.3 — Dauthi Voidwalker's free cast)", () => {
        const state = exileBoard({
            zoneOwner: "p2",
            casterId: "p1",
            mountains: 0,
            extra: { castFromExileWithoutPayingManaCost: true },
        });
        const cast = castOf(state, "p1", "exiledBolt");
        expect(cast).toBeDefined();
        // No mana on the board at all, and the cast is still offered: the
        // enumerator reads `castRawManaCost`, which returns `{}` for the waiver.
        expect(cast!.tapPlan).toEqual([]);
    });

    it("plans the tap at the INCREASED cost for a taxed exile grant (issue #2383)", () => {
        // Elite Spellbinder: "A spell cast this way costs {2} more to cast",
        // stamped on the exiled CARD. Printed {R} + {2} = three lands, never
        // the printed cost alone.
        const taxed = exileBoard({
            zoneOwner: "p2",
            casterId: "p1",
            mountains: 3,
            extra: { castFromExileCostIncrease: { X: 2 } },
        });
        expect(castOf(taxed, "p1", "exiledBolt")!.tapPlan).toHaveLength(3);

        // Two lands is one short of the taxed total — and the Bot must not
        // offer a cast it cannot pay for (the announce-then-abort shape).
        const short = exileBoard({
            zoneOwner: "p2",
            casterId: "p1",
            mountains: 2,
            extra: { castFromExileCostIncrease: { X: 2 } },
        });
        expect(castOf(short, "p1", "exiledBolt")).toBeUndefined();
    });

    it("offers NEITHER play nor cast for a LAND in exile under a cast-only grant (CR 305.9)", () => {
        // A land is played, never cast, and this grant carries no
        // `castableFromExileIncludesLand` rider — so the card is legal for
        // neither action. A zone-blind widening of the candidate set would
        // offer a `cast-spell` the commit path then refuses to locate.
        const exiledLand = makeInstance(mountain.id, {
            id: "exiledLand",
            zone: "exile",
            controllerId: "p1",
            ownerId: "p1",
            castableFromExileBy: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    exile: [exiledLand],
                    battlefield: lands(mountain, 2, "p1"),
                }),
                makePlayer("p2"),
            ],
        });
        const offered = enumerateMoves(state, "p1").filter(
            (m) =>
                (m.kind === "cast-spell" || m.kind === "play-land") &&
                m.cardInstanceId === "exiledLand"
        );
        expect(offered).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Candidate set — GRAVEYARD (CR 702.34 / 702.51 / 702.138)
// ═══════════════════════════════════════════════════════════════════════════

describe("enumerateMoves — a cast from the GRAVEYARD (issue #2971)", () => {
    /** `card` in p1's graveyard, with p1 holding the given untapped basics. */
    function graveyardBoard(
        card: CardInstanceState,
        basics: { def: { id: string }; count: number }[]
    ): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [card],
                    battlefield: basics.flatMap((b) =>
                        lands(b.def, b.count, "p1")
                    ),
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("offers a FLASHBACK cast, priced at the flashback cost (CR 702.34a)", () => {
        // Firebolt: printed {R}, Flashback {4}{R}. Five Mountains is exactly
        // the flashback cost — pricing it at the PRINTED cost would plan a
        // one-land tap and announce a cast the server charges five for.
        const bolt = makeInstance(firebolt.id, {
            id: "gyBolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = graveyardBoard(bolt, [{ def: mountain, count: 5 }]);
        const cast = castOf(state, "p1", "gyBolt");
        expect(cast).toBeDefined();
        expect(cast!.castFromZone).toBe("graveyard");
        expect(cast!.tapPlan).toHaveLength(5);
    });

    it("does not offer a flashback cast the caster cannot pay for", () => {
        const bolt = makeInstance(firebolt.id, {
            id: "gyBolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = graveyardBoard(bolt, [{ def: mountain, count: 4 }]);
        expect(castOf(state, "p1", "gyBolt")).toBeUndefined();
    });

    it("offers the INTRINSIC graveyard permission (CR 702.51 — Hogaak's shape)", () => {
        // The one shipped card with `castableFromOwnGraveyard` is Hogaak,
        // whose cost is payable ONLY by convoke + delve
        // (`cantSpendManaToCast`) — a shape `planManaPayment` cannot plan, so
        // it enumerates nothing for a reason that predates this issue and has
        // nothing to do with the candidate set. A temporary definition carrying
        // the same flag over an ordinary {G} cost isolates the MECHANISM, which
        // is what this loop is responsible for.
        const INTRINSIC_PROBE = "test:intrinsic-graveyard-cast-probe";
        const probe: CardDefinition = {
            id: INTRINSIC_PROBE,
            rarity: "common",
            name: "Intrinsic Graveyard Probe",
            manaCost: { G: 1 },
            types: ["Creature"],
            subtypes: ["Bear"],
            power: 2,
            toughness: 2,
            castableFromOwnGraveyard: true,
        };
        withTemporaryDefinition(probe, () => {
            const card = makeInstance(INTRINSIC_PROBE, {
                id: "gyIntrinsic",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = graveyardBoard(card, [{ def: forest, count: 1 }]);
            // Guard the premise: a vacuous pass if the gate ever stops
            // permitting this.
            expect(
                getLegalActions(state, getPlayer(state, "p1"), card)
            ).toContain("cast");
            expect(castOf(state, "p1", "gyIntrinsic")?.castFromZone).toBe(
                "graveyard"
            );
        });
    });

    it("classifies Hogaak's intrinsic permission even though its convoke/delve cost is unplannable", () => {
        // The shipped instance of the mechanism, asserted at the layer that is
        // this issue's responsibility: the census says "intrinsic", so the loop
        // reaches it. Whether `planManaPayment` can build a tap plan for a
        // convoke+delve-only cost is a separate, pre-existing enumerator gap.
        const hogaak = makeInstance(hogaakArisenNecropolis.id, {
            id: "gyHogaak",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = graveyardBoard(hogaak, [{ def: forest, count: 2 }]);
        expect(
            graveyardCastMechanism(state, getPlayer(state, "p1"), hogaak, "p1")
        ).toBe("intrinsic");
    });

    it("offers the PER-CARD grant (CR 601.3 — Malcolm / Emry)", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "gyBears",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
            castableFromGraveyardBy: "p1",
        });
        const state = graveyardBoard(bears, [{ def: forest, count: 2 }]);
        expect(castOf(state, "p1", "gyBears")?.castFromZone).toBe("graveyard");
    });

    it("offers NOTHING for a graveyard card no mechanism permits", () => {
        // The fail-closed half. `getLegalActions`' final "cast is for all
        // non-land cards" fallback is zone-BLIND, so a candidate loop that
        // consulted only the gate would offer this cast and `locateCastSource`
        // would then refuse to locate it.
        const bears = makeInstance(grizzlyBears.id, {
            id: "gyPlain",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = graveyardBoard(bears, [{ def: forest, count: 4 }]);
        expect(castOf(state, "p1", "gyPlain")).toBeUndefined();
    });

    it("does NOT offer an ESCAPE cast — its exile-N-others cost is not carriable (fail closed)", () => {
        // CR 702.138a escape. `planCastCostPicks` has no branch for it, and
        // the Move has no field for the picked ids, so an enumerated escape cast
        // would be priced as if the exile were free and park unpayable at the
        // real mutation. Tracked at
        // docs/findings/2971-escape-and-flashback-cost-not-enumerable.md.
        const uro = makeInstance(uroTitanOfNaturesWrath.id, {
            id: "gyUro",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = Array.from({ length: 6 }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `fodder-${i}`,
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [uro, ...fodder],
                    battlefield: [
                        ...lands(forest, 3, "p1"),
                        ...lands(island, 3, "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        // The gate DOES permit it — which is exactly why the candidate set has
        // to decline it on its own terms rather than leaning on legality.
        expect(getLegalActions(state, getPlayer(state, "p1"), uro)).toContain(
            "cast"
        );
        expect(castOf(state, "p1", "gyUro")).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Executor — both sandboxes apply the Move with the real stack flags
// ═══════════════════════════════════════════════════════════════════════════

describe("search sandboxes apply a non-hand cast with the mutation's stack flags (issue #2971)", () => {
    /** Runs `move` through BOTH sandboxes and returns the stack item each
     *  produced. Asserted per mechanism, never once for the family: a missed
     *  flag fails no suite, it just makes the Bot model a game that does not
     *  exist. */
    function applyBoth(
        state: GameState,
        playerId: string,
        move: Move
    ): { greedy: GameState; tree: GameState } {
        const greedy = applyMoveForSearch(state, playerId, move);
        const tree = cloneGameState(state);
        applyMoveInSearch(tree, playerId, move);
        return { greedy, tree };
    }

    const stackItem = (s: GameState, id: string) =>
        s.stack.find((it) => it.id === id);

    it("FLASHBACK (CR 702.34a): leaves the graveyard and is stamped exileOnResolve + castFromGraveyard", () => {
        const bolt = makeInstance(firebolt.id, {
            id: "gyBolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [bolt],
                    battlefield: lands(mountain, 5, "p1"),
                }),
                makePlayer("p2"),
            ],
        });
        const move = castOf(state, "p1", "gyBolt")!;
        const { greedy, tree } = applyBoth(state, "p1", move);
        for (const after of [greedy, tree]) {
            const item = stackItem(after, "gyBolt");
            // `resolveTopOfStack` may already have resolved it in the greedy
            // leaf; the flags are what matter while it is on the stack.
            if (item) {
                expect(item.castFromGraveyard).toBe(true);
                // The flag that BOUNDS the line: without it the tree models a
                // flashback card as infinitely recastable.
                expect(item.exileOnResolve).toBe(true);
            }
            expect(
                getPlayer(after, "p1").graveyard.some((c) => c.id === "gyBolt")
            ).toBe(false);
        }
    });

    it("PER-CARD GRANT (CR 601.3): castFromGraveyard, and NOT exileOnResolve", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "gyBears",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
            castableFromGraveyardBy: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [bears],
                    battlefield: lands(forest, 2, "p1"),
                }),
                makePlayer("p2"),
            ],
        });
        const move = castOf(state, "p1", "gyBears")!;
        const { tree } = applyBoth(state, "p1", move);
        const item = stackItem(tree, "gyBears")!;
        expect(item.castFromGraveyard).toBe(true);
        expect(item.exileOnResolve).toBeUndefined();
        expect(item.escaped).toBeUndefined();
    });

    it("CROSS-PLAYER EXILE GRANT (CR 400.7): the card leaves the OPPONENT's exile, not the caster's", () => {
        // The shape a hard-coded `removeFromZone(player, …)` cannot express at
        // all: before the shared resolver both sandboxes threw
        // `Card <id> not found in hand` here.
        const exiled = makeInstance(firebolt.id, {
            id: "exiledBolt",
            zone: "exile",
            controllerId: "p2",
            ownerId: "p2",
            castableFromExileBy: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: lands(mountain, 1, "p1") }),
                makePlayer("p2", { exile: [exiled] }),
            ],
        });
        const move = castOf(state, "p1", "exiledBolt")!;
        const { greedy, tree } = applyBoth(state, "p1", move);
        for (const after of [greedy, tree]) {
            expect(getPlayer(after, "p2").exile).toHaveLength(0);
            const item = stackItem(after, "exiledBolt");
            if (item) {
                expect(item.castById).toBe("p1");
                // An exile cast is not a graveyard cast: no graveyard flags.
                expect(item.castFromGraveyard).toBeUndefined();
                expect(item.exileOnResolve).toBeUndefined();
            }
        }
    });

    it("a stale Move whose card no permitted source holds is SKIPPED, never thrown", () => {
        const exiled = makeInstance(firebolt.id, {
            id: "exiledBolt",
            zone: "exile",
            controllerId: "p1",
            ownerId: "p1",
            castableFromExileBy: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    exile: [exiled],
                    battlefield: lands(mountain, 1, "p1"),
                }),
                makePlayer("p2"),
            ],
        });
        const move = castOf(state, "p1", "exiledBolt")!;
        // Determinization can hand the tree a state in which the card has
        // already moved. The leaf must leave the position alone.
        const gone = cloneGameState(state);
        getPlayer(gone, "p1").exile = [];
        expect(() => applyMoveForSearch(gone, "p1", move)).not.toThrow();
        expect(() => applyMoveInSearch(gone, "p1", move)).not.toThrow();
        expect(gone.stack).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("enumeration is deterministic (issue #2971)", () => {
    it("produces byte-identical Moves across repeated calls on the same state", () => {
        const exiled = makeInstance(firebolt.id, {
            id: "exiledBolt",
            zone: "exile",
            controllerId: "p2",
            ownerId: "p2",
            castableFromExileBy: "p1",
        });
        const bolt = makeInstance(firebolt.id, {
            id: "gyBolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [bolt],
                    battlefield: lands(mountain, 6, "p1"),
                }),
                makePlayer("p2", { exile: [exiled] }),
            ],
        });
        const once = JSON.stringify(castsOf(state, "p1"));
        const twice = JSON.stringify(castsOf(state, "p1"));
        expect(twice).toBe(once);
        // Both zones reached, so the determinism claim covers both loops.
        expect(once).toContain('"castFromZone":"exile"');
        expect(once).toContain('"castFromZone":"graveyard"');
    });
});
