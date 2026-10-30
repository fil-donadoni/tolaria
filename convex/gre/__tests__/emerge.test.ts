// Emerge capability tests (CR 702.119, issue #3218). No catalogue card ships
// against Emerge yet — Crabomination's ETB is blocked on a random graveyard
// pick (issue #1702) — so SYNTHETIC probe cards exercise the capability end to
// end, the `dash.test.ts` / `evoke.test.ts` precedent. Covers:
//   - `def.emerge` resolves through the shared alternative-cost authority
//     (`getAlternativeCost` / `affordableAlternativeCosts`), and the
//     "emerge from [quality]" filter decides which permanents can pay it
//     (CR 702.119b)
//   - the "cast" legality gate prices the cast with the largest reduction a
//     victim can buy (CR 702.119a, `canPotentiallyPayCost`)
//   - both halves of CR 702.119c through the REAL mutations: a forced victim
//     reduces at announcement, a real choice parks UNREDUCED and reduces the
//     moment `selectSacrifice` names the victim — by THAT victim's mana value
//   - the reduction is generic-only and applied after increases (CR 601.2f)
//   - an emerge cost of any other shape is refused, catalogue-wide
//     (`emergeCostShapeError`)
import { describe, it, expect } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../alternativeCost";
import { getLegalActions } from "../rules";
import { getPlayer, type CardInstanceState, type GameState } from "../state";
import { announceCast, selectSacrifice } from "../../game";
import { tryAutoCommitPendingCast } from "../activation";
import { nextOwedPayment } from "../owedPayment";
import { pickForOwedPayment } from "../paymentPicks";
import { emergeCostShapeError } from "../emerge";
import { getAllCards } from "../../cards";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    grizzlyBears,
    solRing,
    juggernaut,
    swamp,
} from "../../cards/sets/lea/index.cards";
import { triskelion, ornithopter } from "../../cards/sets/atq/colorless.cards";
import { crawWurm } from "../../cards/sets/lea/green.cards";
import { thaliaGuardianOfThraben } from "../../cards/sets/dka/white.cards";

// Crabomination's numbers: printed {4}{B}{B}, "Emerge from artifact {5}{B}{B}".
const ARTIFACT_PROBE_ID = "test:emerge-from-artifact-probe";
const artifactProbe: CardDefinition = {
    id: ARTIFACT_PROBE_ID,
    rarity: "common",
    name: "Emerge From Artifact Probe",
    manaCost: { X: 4, B: 2 },
    emerge: {
        id: "emerge",
        description: "Emerge from artifact {5}{B}{B}",
        mana: { X: 5, B: 2 },
        permanent: {
            action: "sacrifice",
            count: 1,
            filter: { types: "Artifact" },
        },
    },
    types: ["Creature"],
    subtypes: ["Crab", "Demon"],
    power: 5,
    toughness: 5,
};
registerTokenDefinition(artifactProbe);

// A NONCREATURE emerge spell (plain emerge — sacrifice a creature), so
// Thalia's "noncreature spells cost {1} more" reaches it: printed {5}{U},
// emerge {4}{U}.
const SORCERY_PROBE_ID = "test:emerge-sorcery-probe";
const sorceryProbe: CardDefinition = {
    id: SORCERY_PROBE_ID,
    rarity: "common",
    name: "Emerge Sorcery Probe",
    manaCost: { X: 5, U: 1 },
    emerge: {
        id: "emerge",
        description: "Emerge {4}{U}",
        mana: { X: 4, U: 1 },
        permanent: {
            action: "sacrifice",
            count: 1,
            filter: { types: "Creature" },
        },
    },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 }],
};
registerTokenDefinition(sorceryProbe);

/** A TAPPED permanent of p1's: a cost candidate, never a mana source, so the
 *  pool is the only mana in each scenario. */
function tappedOf(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isTapped: true,
    });
}

function board(opts: {
    probeId?: string;
    battlefield: CardInstanceState[];
    pool: Partial<Record<"U" | "B", number>>;
    p2Battlefield?: CardInstanceState[];
}): GameState {
    const probe = makeInstance(opts.probeId ?? ARTIFACT_PROBE_ID, {
        id: "probe",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [probe],
                battlefield: opts.battlefield,
                manaPool: {
                    W: 0,
                    U: opts.pool.U ?? 0,
                    B: opts.pool.B ?? 0,
                    R: 0,
                    G: 0,
                    C: 0,
                },
            }),
            makePlayer("p2", { battlefield: opts.p2Battlefield ?? [] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const probeIn = (state: GameState) =>
    getPlayer(state, "p1").hand.find((c) => c.id === "probe")!;

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId: string;
};

const announceEmerge = (harness: ReturnType<typeof makeMutationCtx>) =>
    runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId: "probe",
            alternativeCostId: "emerge",
        }
    );

type SacrificeArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const pickVictim = (
    harness: ReturnType<typeof makeMutationCtx>,
    cardInstanceId: string
) =>
    runMutation<SacrificeArgs, void>(
        selectSacrifice as unknown as Handler<SacrificeArgs, void>,
        harness.ctx,
        { gameId: "game-1" as Id<"games">, playerId: "p1", cardInstanceId }
    );

describe("Emerge — cost lookup and the [quality] filter (CR 702.119a/b)", () => {
    it("getAlternativeCost resolves def.emerge by its own id (reference equality)", () => {
        expect(getAlternativeCost(artifactProbe, "emerge")).toBe(
            artifactProbe.emerge
        );
    });

    it("emerge from artifact is offered with a NONCREATURE artifact and with an artifact creature, never with a non-artifact creature", () => {
        const offered = (battlefield: CardInstanceState[]) => {
            const state = board({ battlefield, pool: {} });
            return affordableAlternativeCosts(
                state,
                getPlayer(state, "p1"),
                probeIn(state)
            ).some((a) => a.id === "emerge");
        };
        expect(offered([tappedOf(solRing().id, "ring")])).toBe(true);
        expect(offered([tappedOf(juggernaut().id, "jugg")])).toBe(true);
        expect(offered([tappedOf(grizzlyBears().id, "bears")])).toBe(false);
        expect(offered([])).toBe(false);
    });
});

describe("Emerge — cast legality prices the largest reduction (CR 702.119a / 601.2f)", () => {
    it("'cast' is legal on {B}{B} with a mana-value-6 artifact to sacrifice: {5}{B}{B} − 6 = {B}{B}", () => {
        // The printed {4}{B}{B} needs six mana — only the emerge cost, reduced
        // by Triskelion's mana value, fits the pool.
        const state = board({
            battlefield: [tappedOf(triskelion().id, "tris")],
            pool: { B: 2 },
        });
        expect(
            getLegalActions(state, getPlayer(state, "p1"), probeIn(state))
        ).toContain("cast");
    });

    it("'cast' is NOT legal on {B}{B} when the only artifact has mana value 0", () => {
        const state = board({
            battlefield: [tappedOf(ornithopter().id, "thopter")],
            pool: { B: 2 },
        });
        expect(
            getLegalActions(state, getPlayer(state, "p1"), probeIn(state))
        ).not.toContain("cast");
    });
});

describe("Emerge — announcement and payment through the real mutations (CR 702.119c)", () => {
    it("a FORCED victim reduces at announcement: the spell commits on {B}{B} and the artifact is sacrificed", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                board({
                    battlefield: [tappedOf(triskelion().id, "tris")],
                    pool: { B: 2 },
                })
            ),
        ]);
        await announceEmerge(harness);

        const state = harness.state();
        expect(state.pendingCast).toBeUndefined();
        const p1 = getPlayer(state, "p1");
        expect(p1.manaPool.B).toBe(0);
        expect(p1.battlefield.some((c) => c.id === "tris")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "tris")).toBe(true);
        expect(state.stack.map((s) => s.id)).toEqual(["probe"]);
    });

    it("the reduction never touches coloured pips: a mana-value-6 victim against {5}{B}{B} leaves exactly {B}{B} owed", async () => {
        // Two UNTAPPED Swamps make the cast affordable without covering it
        // from the pool, so it parks on `tapForPayment` with its total showing.
        const swamps = [0, 1].map((i) =>
            makeInstance(swamp().id, {
                id: `swamp-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                board({
                    battlefield: [tappedOf(triskelion().id, "tris"), ...swamps],
                    pool: {},
                })
            ),
        ]);
        await announceEmerge(harness);

        const pc = harness.state().pendingCast;
        expect(pc?.manaCost).toEqual({ B: 2 });
        expect(pc?.emergeReductionOwed).toBeUndefined();
    });

    it("a REAL choice parks UNREDUCED, then reduces by the PICKED victim's mana value and commits", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                board({
                    battlefield: [
                        tappedOf(triskelion().id, "tris"),
                        tappedOf(solRing().id, "ring"),
                    ],
                    pool: { B: 2 },
                })
            ),
        ]);
        await announceEmerge(harness);

        const parked = harness.state().pendingCast;
        expect(parked?.manaCost).toEqual({ X: 5, B: 2 });
        expect(parked?.emergeReductionOwed).toBe(true);

        await pickVictim(harness, "tris");

        const state = harness.state();
        expect(state.pendingCast).toBeUndefined();
        const p1 = getPlayer(state, "p1");
        expect(p1.manaPool.B).toBe(0);
        expect(p1.graveyard.some((c) => c.id === "tris")).toBe(true);
        // Exactly one victim: the other artifact stays.
        expect(p1.battlefield.some((c) => c.id === "ring")).toBe(true);
        expect(state.stack.map((s) => s.id)).toEqual(["probe"]);
    });

    it("picking the CHEAPER victim reduces by its own mana value only, and the cast waits for the rest", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                board({
                    battlefield: [
                        tappedOf(triskelion().id, "tris"),
                        tappedOf(solRing().id, "ring"),
                    ],
                    pool: { B: 2 },
                })
            ),
        ]);
        await announceEmerge(harness);
        await pickVictim(harness, "ring");

        const pc = harness.state().pendingCast;
        // Sol Ring's mana value is 1: {5}{B}{B} − 1 = {4}{B}{B}, which {B}{B}
        // does not cover — and the reduction is applied once, flag cleared.
        expect(pc?.manaCost).toEqual({ X: 4, B: 2 });
        expect(pc?.emergeReductionOwed).toBeUndefined();
        expect(
            getPlayer(harness.state(), "p1").battlefield.some(
                (c) => c.id === "ring"
            )
        ).toBe(true);
    });

    it("applies the reduction AFTER a cost increase (CR 601.2f): Thalia's {1} is absorbed by a mana-value-6 victim, so {U} pays", async () => {
        // {4}{U} + {1} (Thalia) − 6 (Craw Wurm) = {U}. Reducing before the
        // increase would floor the generic at 0 FIRST and then add Thalia's
        // {1}, leaving {1}{U} — which {U} cannot pay.
        const thalia = makeInstance(thaliaGuardianOfThraben().id, {
            id: "thalia",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = board({
            probeId: SORCERY_PROBE_ID,
            battlefield: [tappedOf(crawWurm().id, "wurm")],
            pool: { U: 1 },
            p2Battlefield: [thalia],
        });
        expect(
            getLegalActions(state, getPlayer(state, "p1"), probeIn(state))
        ).toContain("cast");

        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await announceEmerge(harness);

        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(getPlayer(after, "p1").manaPool.U).toBe(0);
        expect(
            getPlayer(after, "p1").graveyard.some((c) => c.id === "wurm")
        ).toBe(true);
        expect(after.stack.map((s) => s.id)).toEqual(["probe"]);
    });
});

describe("Emerge — the chosen victim must still be there to pay (CR 601.2h / 702.119c)", () => {
    it("a victim that left the battlefield after the pick makes the commit stale: no spell on the stack for the reduction alone", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                board({
                    battlefield: [
                        tappedOf(triskelion().id, "tris"),
                        tappedOf(solRing().id, "ring"),
                        makeInstance(swamp().id, {
                            id: "swamp-0",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                    pool: { B: 1 },
                })
            ),
        ]);
        await announceEmerge(harness);
        await pickVictim(harness, "tris");

        // Parked on mana with the reduction applied ({B}{B}). The victim is
        // then sacrificed elsewhere (a mana ability, CR 605.3a) and the pool
        // filled: the cost's sacrifice can no longer be paid.
        const state = structuredClone(harness.state());
        expect(state.pendingCast?.manaCost).toEqual({ B: 2 });
        const p1 = getPlayer(state, "p1");
        const tris = p1.battlefield.find((c) => c.id === "tris")!;
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "tris");
        p1.graveyard.push({ ...tris, zone: "graveyard" });
        p1.manaPool.B = 2;

        tryAutoCommitPendingCast(state, "p1");

        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p1").hand.some((c) => c.id === "probe")).toBe(
            true
        );
    });
});

describe("Emerge — the live fallback picker names the largest victim (CR 702.119a)", () => {
    it("answers a parked emerge selection with the highest-mana-value permanent, not the cheapest", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                board({
                    battlefield: [
                        tappedOf(solRing().id, "ring"),
                        tappedOf(triskelion().id, "tris"),
                    ],
                    pool: { B: 2 },
                })
            ),
        ]);
        await announceEmerge(harness);
        const state = harness.state();
        const owed = nextOwedPayment(state, "p1");
        expect(owed?.kind).toBe("cast:sacrificeSelection");
        const answer = pickForOwedPayment(state, "p1", owed!);
        expect(answer).toMatchObject({ cardInstanceIdEach: ["tris"] });
    });
});

describe("Emerge — definition shape (CR 702.119a, emergeCostShapeError)", () => {
    it("accepts a mana leg plus ONE sacrificed permanent", () => {
        expect(emergeCostShapeError(artifactProbe.emerge!)).toBeUndefined();
        expect(emergeCostShapeError(sorceryProbe.emerge!)).toBeUndefined();
    });

    it("refuses a second victim, a return action, a missing mana leg and an extra leg", () => {
        const base = artifactProbe.emerge!;
        for (const bad of [
            { ...base, permanent: { ...base.permanent!, count: 2 } },
            {
                ...base,
                permanent: { ...base.permanent!, action: "return" as const },
            },
            { ...base, mana: undefined },
            { ...base, life: 2 },
        ]) {
            expect(emergeCostShapeError(bad)).toBeDefined();
        }
    });

    it("catalogue guard: every shipped emerge cost has that shape", () => {
        const offenders = getAllCards()
            .filter((card) => card.emerge !== undefined)
            .map((card) => [card.name, emergeCostShapeError(card.emerge!)])
            .filter(([, error]) => error !== undefined);
        expect(offenders).toEqual([]);
    });
});
