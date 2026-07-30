// Board-state-conditional keyword grant gated on NON-BATTLEFIELD player
// state (hand size, CR 611.2c "as long as ..."), issue #1379.
//
// CORRECTED VERDICT. This suite originally shipped with the OPPOSITE, FALSE
// conclusion — "the existing `refreshCounterGatedStatics` SBA re-apply sweep
// is sufficient, no new live-read path is needed" — which a review on PR
// #1837 disproved. `checkStateBasedActions` DOES run that sweep, but NOT
// every state-changing mutation calls `checkStateBasedActions` before
// persisting a stable, priority-awaiting position. In particular
// `announceCast` (`game.ts`) moves a card hand→stack via `removeFromZone`
// and then calls `saveGameState` with ZERO SBA pass anywhere in the path
// (confirmed by inspection: no `checkStateBasedActions` / `refreshCounterGatedStatics`
// call in `announceCast`'s handler body, nor in `emitSpellCastEvent` /
// `processPendingActionTriggers` / `drainAutoPasses`, the three functions it
// calls after the move). `tryAutoCommitPendingCast`, `summonCompanion`, and
// `declareMulligan` share the same gap. Casting is the single most common way
// a hand shrinks to the ≤1 threshold Carnage Interpreter's clause names, so
// the persisted state the OPPONENT responds against — the entire window a
// spell sits on the stack — could carry a stale keyword.
//
// THE FIX (this PR, `game.ts`'s `saveGameState`). `saveGameState` is the SOLE
// writer of the `gameStates` row (every other DB write in `game.ts` targets a
// different table — `gameTicks`, `games`, `matches`, …) — every stable
// position in the ENTIRE engine flows through it before it is persisted and
// projected to either client, regardless of which caller reached it. It now
// calls `refreshCounterGatedStatics(state)` unconditionally, immediately
// before packing the state for storage: the same idempotent, SBA-free
// re-materialization sweep `checkStateBasedActions` already runs at the top
// of its own fixpoint loop (`gre/sba.ts`), just ALSO run at the one choke
// point every caller passes through whether or not it remembered to run SBAs
// first. "A persisted state always has freshly-materialized conditional
// statics" is now an invariant of persistence itself, not of any particular
// caller's discipline.
//
// This suite now has two parts:
//   1. The ORIGINAL four `checkStateBasedActions`-driven tests, kept as
//      regression coverage of a real (if narrower than first believed)
//      mechanism — commenting out `refreshCounterGatedStatics` at
//      `gre/sba.ts` still fails these.
//   2. The reviewer's actual counterexample, below: a hand-size-gated
//      `menace` grant, a card LEAVING THE HAND VIA THE REAL CAST PATH
//      (`announceCast`, the exact mutation the review named — not a
//      hand-rolled `removeFromZone`), landed through the REAL `saveGameState`
//      (via the registered mutation's own `_handler`, not a reimplementation),
//      then read back at a load-bearing site (`validateMinimumBlockers`, wire
//      format). This test FAILS if the `refreshCounterGatedStatics` call is
//      reverted from `saveGameState` (verified manually — see the PR
//      receipt) — the original four tests, exercising only
//      `checkStateBasedActions` directly, could never have caught the bug
//      the review found because none of them drives the cast path.
//
// Fixture: synthetic test-only cards (Carnage Interpreter itself, CLU 26,
// `cards/sets/clu/multicolor.ts`, was a commented-out stub when this test was
// written — its `{1}{B/R}{B/R}` guild-hybrid cost has since become declarable
// and payable, and the card shipped with issue #1927; the synthetic fixture is
// kept because it isolates the hand-size condition from the real card's other
// abilities) registered via the sanctioned test-only seam
// `registerTokenDefinition` (already used this way by
// `gre/__tests__/intervening-if.test.ts` and others — `allCards`, the
// catalogue every catalogue-wide sweep enumerates, is built from the STATIC
// `setModules` list, not this dynamic registry, so a synthetic test card is
// invisible to those sweeps).
import { describe, it, expect, beforeAll } from "vitest";
import { applySourceStaticEffects } from "../state";
import { checkStateBasedActions } from "../sba";
import type { GameState, CardInstanceState } from "../state";
import { expandState } from "../serialize";
import { registerTokenDefinition } from "../../cards";
import type {
    CardDefinition,
    PermanentView,
    StaticEffectStateView,
} from "../../cards/types";
import { EFFECT_AFFECTS_SELF } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getMinimumBlockers, validateMinimumBlockers } from "../combat";
import { projectPublicState } from "../../gameProjections";
import { announceCast } from "../../game";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

const TEST_CARD_ID = "test-hand-gated-menace-creature";
const FILLER_SPELL_ID = "test-hand-shrink-filler-instant";

/** "As long as YOU have `max` or fewer cards in hand" (CR 611.2c). Finds
 *  "you" (the grant's own controller) inside `StaticEffectStateView.players[]`
 *  by `id` rather than assuming array position — Carnage Interpreter's exact
 *  gate, generalized to a parameter so the threshold isn't hard-coded. */
function controllerHandSizeAtMost(max: number) {
    return (
        source: PermanentView,
        state: StaticEffectStateView
        // `ctx` (StaticEffectContext) is unused — the gate only needs hand
        // size, not colour/type/subtype lookups. Trailing param omitted;
        // still structurally assignable to `StaticKeywordGrant["condition"]`.
    ): boolean => {
        const controller = state.players.find(
            (p) => p.id === source.controllerId
        );
        // `hand` is OPTIONAL on `StaticEffectStateView` (issue #1379 review
        // finding — see `cards/types.ts`): NOT every call site building this
        // view has real hand data on hand (`gre/constants.ts`'s
        // `manaLayerView`, a mana ability's battlefields-only P/T read, has
        // none). An unavailable hand must NOT satisfy a "≤ N cards in hand"
        // claim the engine cannot currently verify — the conservative
        // direction is `false`, never a numeric fallback that could flip the
        // predicate true. A fabricated `0` used to do exactly that: 0 ≤ N for
        // every N ≥ 0, so the gate silently read as SATISFIED at a call site
        // with no hand to check, rather than "unknown".
        if (!controller || controller.hand === undefined) return false;
        return controller.hand.length <= max;
    };
}

const testCard: CardDefinition = {
    id: TEST_CARD_ID,
    name: "Test Hand-Gated Menace Creature",
    rarity: "common",
    oracleText:
        "As long as you have one or fewer cards in hand, this creature has menace.",
    types: ["Creature"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: EFFECT_AFFECTS_SELF,
            condition: controllerHandSizeAtMost(1),
            keyword: "menace",
        },
    ],
};

/** A free (0-cost) Instant, cast in the "real cast path" describe block below
 *  to shrink a hand hand→stack through `announceCast` itself — zero mana
 *  payment means the announce call takes the immediate-commit branch of the
 *  handler (no picker, no separate commit mutation), so ONE mutation call is
 *  the whole repro. Never resolved (the test only inspects the POST-cast,
 *  persisted state), so it needs no `effects`/`resolve`. */
const fillerSpell: CardDefinition = {
    id: FILLER_SPELL_ID,
    name: "Test Hand-Shrink Filler Instant",
    rarity: "common",
    oracleText: "Test-only instant with no effect, cast to shrink a hand.",
    types: ["Instant"],
    manaCost: {},
};

beforeAll(() => {
    registerTokenDefinition(testCard);
    registerTokenDefinition(fillerSpell);
});

function makeHandCard(id: string): CardInstanceState {
    return {
        id,
        card: { id: "test-hand-filler-card" },
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
    };
}

function makeCreature(): CardInstanceState {
    return {
        id: "menace-creature",
        card: { id: TEST_CARD_ID },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
        staticAbilities: [],
        isTapped: false,
    };
}

function makeBoard(handSize: number): {
    state: GameState;
    creature: CardInstanceState;
} {
    const creature = makeCreature();
    const hand = Array.from({ length: handSize }, (_, i) =>
        makeHandCard(`hand-${i}`)
    );
    const state = makeState({
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [creature], hand }),
            makePlayer("p2"),
        ],
    });
    applySourceStaticEffects(state, creature);
    return { state, creature };
}

describe("hand-size-gated keyword-grant (CR 611.2c, issue #1379) — SBA-sweep path", () => {
    it("has no menace with a normal hand (2 cards)", () => {
        const { creature } = makeBoard(2);
        expect(creature.staticAbilities).not.toContain("menace");
        expect(getMinimumBlockers(creature)).toBe(1);
    });

    it("has menace at ETB when the hand is already ≤1 card", () => {
        const { creature } = makeBoard(1);
        expect(creature.staticAbilities).toContain("menace");
        expect(getMinimumBlockers(creature)).toBe(2);
    });

    // The load-bearing regression: hand size changes via DRAW/DISCARD, never
    // via the battlefield. Proves the SBA resync sweep (not a per-write
    // event) is what keeps the cached `staticAbilities` array live — for
    // whichever paths DO call `checkStateBasedActions` before their next
    // stable read (NOT every path does — see the "real cast path" suite
    // below for the counterexample this one can't catch).
    it("gains menace once discarded down to 1 card, re-evaluated via checkStateBasedActions", () => {
        const { state, creature } = makeBoard(2);
        expect(creature.staticAbilities).not.toContain("menace");

        // Discard: a hand-size change with NO battlefield write at all.
        const player = state.players.find((p) => p.id === "p1")!;
        player.hand = player.hand.slice(0, 1);
        checkStateBasedActions(state);

        expect(creature.staticAbilities).toContain("menace");
        expect(getMinimumBlockers(creature)).toBe(2);
    });

    it("loses menace once a card is drawn back above the threshold", () => {
        const { state, creature } = makeBoard(1);
        expect(creature.staticAbilities).toContain("menace");

        // Draw: same non-battlefield write, opposite direction.
        const player = state.players.find((p) => p.id === "p1")!;
        player.hand = [...player.hand, makeHandCard("drawn")];
        checkStateBasedActions(state);

        expect(creature.staticAbilities).not.toContain("menace");
        expect(getMinimumBlockers(creature)).toBe(1);
    });

    // End-to-end combat legality (CR 509.1b/c) — the actual load-bearing read
    // site (`confirmBlockers` in `game.ts`), not just the cached-array check
    // above.
    it("enforces the two-blocker minimum via validateMinimumBlockers once menace is live", () => {
        const { state, creature } = makeBoard(2);
        const player = state.players.find((p) => p.id === "p1")!;
        player.hand = player.hand.slice(0, 1);
        checkStateBasedActions(state);
        expect(creature.staticAbilities).toContain("menace");

        state.combat = {
            attackerIds: [creature.id],
            confirmed: false,
            blockerAssignments: { b1: [creature.id] },
            blockersConfirmed: false,
            damageConfirmed: false,
        };

        const oneBlocker = validateMinimumBlockers(state);
        expect(oneBlocker.ok).toBe(false);
        if (!oneBlocker.ok) expect(oneBlocker.reason).toMatch(/menace/i);

        state.combat.blockerAssignments = {
            b1: [creature.id],
            b2: [creature.id],
        };
        expect(validateMinimumBlockers(state)).toEqual({ ok: true });
    });

    // Wire format (`gameProjections.ts`) — `staticAbilities` survives
    // `slimCard`'s spread unchanged (only `card`/`knownTo`/`stormSnapshot` are
    // stripped), so the live-resynced menace keyword reads identically
    // server-side and after `projectPublicState`. No client reducer keys off
    // "menace" specifically (combat legality is enforced server-side in
    // `confirmBlockers`); the client only needs the raw keyword to survive
    // the projection for a generic keyword badge, which this pins.
    it("survives projectPublicState for both hand sizes", () => {
        const low = makeBoard(1);
        checkStateBasedActions(low.state);
        const projectedLow = projectPublicState(low.state, 1, "p1");
        const slimLow = projectedLow.players[0].battlefield.find(
            (c) => c.id === low.creature.id
        )!;
        expect(slimLow.staticAbilities).toContain("menace");

        const high = makeBoard(3);
        checkStateBasedActions(high.state);
        const projectedHigh = projectPublicState(high.state, 1, "p1");
        const slimHigh = projectedHigh.players[0].battlefield.find(
            (c) => c.id === high.creature.id
        )!;
        expect(slimHigh.staticAbilities).not.toContain("menace");
    });
});

// ─── The real cast path (issue #1379 review counterexample) ────────────────
//
// Drives the REGISTERED `announceCast` mutation's own `_handler` against an
// in-memory stub `MutationCtx` — same harness discipline as
// `convex/__tests__/gameTicks.test.ts` / `seatOwnership.test.ts` (this repo
// has no convex-test harness). Unlike the suite above, NOTHING in this test
// calls `checkStateBasedActions` or `refreshCounterGatedStatics` directly —
// the only thing that can keep the persisted menace grant correct is
// `saveGameState`'s own sweep, exercised transitively through the real
// mutation call.
type Row = Record<string, unknown>;

type MutationHandler<A, R> = {
    _handler: (ctx: MutationCtx, args: A) => Promise<R>;
};

const runAnnounceCast = (ctx: MutationCtx, args: Row) =>
    (announceCast as unknown as MutationHandler<Row, null>)._handler(ctx, args);

/** Same in-memory stub `MutationCtx` shape as `gameTicks.test.ts` /
 *  `seatOwnership.test.ts`: generic over table name (`games` / `gameStates` /
 *  `gameTicks`), authenticated as `userId` via the `"<userId>|session1"`
 *  subject those two suites already established works against
 *  `assertCallerOwnsSeat`. */
function makeCtx(userId: string, seeds: Row[]) {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });
    let nextIdBySeq = 0;

    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => {
                const id = `${table}-new-${nextIdBySeq++}`;
                docs.set(id, { ...doc, _id: id, __table: table });
                return id;
            },
            patch: async (id: string, patch: Row) => {
                docs.set(id, { ...docs.get(id), ...patch });
            },
            query: (table: string) => ({
                withIndex: (_name: string, fn?: (q: unknown) => unknown) => {
                    const eqs: [string, unknown][] = [];
                    const builder = {
                        eq: (field: string, value: unknown) => {
                            eqs.push([field, value]);
                            return builder;
                        },
                    };
                    fn?.(builder);
                    const rows = [...docs.values()].filter(
                        (d) =>
                            d.__table === table &&
                            eqs.every(([f, v]) => d[f] === v)
                    );
                    const ordered = { first: async () => rows[0] ?? null };
                    return {
                        collect: async () => rows,
                        first: async () => rows[0] ?? null,
                        order: () => ordered,
                    };
                },
            }),
        },
        scheduler: { runAfter: async () => undefined },
    };

    return {
        ctx: ctx as unknown as MutationCtx,
        doc: (id: string) => docs.get(id)!,
    };
}

describe("hand-size-gated menace survives the REAL cast path (issue #1379 review counterexample)", () => {
    it("announceCast shrinks a hand to 1 card hand→stack; saveGameState's own refresh is what keeps the PERSISTED menace correct — no explicit SBA call anywhere in this test", async () => {
        const creature = makeCreature();
        const fillerInstant = makeInstance(FILLER_SPELL_ID, {
            id: "filler-instant-1",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const padding = makeHandCard("padding");

        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [creature],
                    hand: [fillerInstant, padding],
                }),
                makePlayer("p2"),
            ],
        });
        // ETB materialization at hand size 2 — no menace yet, mirrors the
        // engine's real `finalizeSpellResolution` / permanent-entry path.
        applySourceStaticEffects(state, creature);
        expect(creature.staticAbilities).not.toContain("menace");

        const stub = makeCtx("p1", [
            {
                _id: "game-1",
                __table: "games",
                name: "Game",
                status: "playing",
                players: [{ id: "p1" }, { id: "p2" }],
                createdAt: 0,
                updatedAt: 0,
            },
            {
                _id: "gs-1",
                __table: "gameStates",
                gameId: "game-1",
                seq: 1,
                state,
                updatedAt: 0,
            },
        ]);

        // THE REAL CAST PATH: the registered `announceCast` mutation, not a
        // hand-rolled `removeFromZone`. The filler spell is free ({} cost),
        // so this single call takes the handler's immediate-commit branch —
        // moves hand→stack, then calls the REAL `saveGameState`.
        await runAnnounceCast(stub.ctx, {
            gameId: "game-1" as unknown as Id<"games">,
            playerId: "p1",
            cardInstanceId: fillerInstant.id,
        });

        const persisted = stub.doc("gs-1");
        expect(persisted.seq).toBe(2);
        const persistedState = expandState(
            persisted.state as Record<string, unknown>
        );

        const p1Persisted = persistedState.players.find((p) => p.id === "p1")!;
        // The hand shrank hand→stack: only the padding card is left.
        expect(p1Persisted.hand).toHaveLength(1);
        expect(persistedState.stack).toHaveLength(1);
        expect(persistedState.stack[0].id).toBe(fillerInstant.id);

        // THE REGRESSION. No line in this test (or in `announceCast`'s own
        // handler — confirmed by inspection, see the header) calls
        // `checkStateBasedActions` / `refreshCounterGatedStatics`. The ONLY
        // thing that can have refreshed the menace grant for the new hand
        // size is `saveGameState`'s own sweep. This assertion FAILS if that
        // call is reverted from `saveGameState` — verified manually: reverted
        // the production fix, ran this test, watched it fail with `menace`
        // absent from `staticAbilities`; restored the fix, watched it pass.
        const persistedCreature = p1Persisted.battlefield.find(
            (c) => c.id === creature.id
        )!;
        expect(persistedCreature.staticAbilities).toContain("menace");

        // Load-bearing read site (CR 509.1b/702.111a), on the PERSISTED
        // state — the same shape `confirmBlockers` (`game.ts`) consults.
        persistedState.combat = {
            attackerIds: [persistedCreature.id],
            confirmed: false,
            blockerAssignments: { b1: [persistedCreature.id] },
            blockersConfirmed: false,
            damageConfirmed: false,
        };
        const oneBlocker = validateMinimumBlockers(persistedState);
        expect(oneBlocker.ok).toBe(false);

        persistedState.combat.blockerAssignments = {
            b1: [persistedCreature.id],
            b2: [persistedCreature.id],
        };
        expect(validateMinimumBlockers(persistedState)).toEqual({ ok: true });

        // Wire format — the same bytes a real client would receive.
        const projected = projectPublicState(
            persistedState,
            persisted.seq as number,
            "p1"
        );
        const slimCreature = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === creature.id)!;
        expect(slimCreature.staticAbilities).toContain("menace");
    });
});
