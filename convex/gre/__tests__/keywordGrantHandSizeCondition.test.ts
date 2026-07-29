// Board-state-conditional keyword grant gated on NON-BATTLEFIELD player
// state (hand size, CR 611.2c "as long as ..."), issue #1379.
//
// `StaticKeywordGrant.condition` (issue #1095, Kavu Runner) already lets a
// `keyword-grant` static effect gate on board state, re-evaluated every SBA
// pass by `refreshCounterGatedStatics` (`gre/sba.ts` → `gre/state.ts`). Every
// EXISTING conditional grant happens to be gated on something that changes
// via a battlefield write (a permanent entering/leaving/gaining a colour),
// which is itself a "stable transition" that runs `checkStateBasedActions`.
// Hand size is different: it changes on draw/discard, events that never
// touch the battlefield directly — the open question #1379 raises is
// whether the SAME re-apply sweep still catches it, or whether a hand-size
// gate needs its own live-read path bypassing the mutation-synced
// `staticAbilities` cache entirely.
//
// This suite proves it DOES stay live through the existing sweep: every
// state-changing mutation in the real engine (`game.ts` action handlers,
// `pendingChoiceSubmit.ts`, `search.ts`, `playLand.ts`, the stack-resolution
// loop in `state.ts`) calls `checkStateBasedActions` before the position is
// considered stable, and `checkStateBasedActions` runs
// `refreshCounterGatedStatics` on every pass (`gre/sba.ts` — unconditionally,
// at the TOP of the fixpoint loop). A hand-size change is therefore always
// followed by a resync before the next stable state is read — in particular
// before the combat-legality read sites (`combat.ts`'s
// `getMinimumBlockers`/`validateMinimumBlockers`, CR 509.1b/702.111a) that
// `confirmBlockers` (`game.ts`) consults against a freshly-loaded, already-
// resynced state. No new live-read helper is needed; `StaticEffectStateView`
// only needed the small `id`/`hand` plumbing (added alongside this test) so
// a hand-size predicate can be written with the SAME `condition` signature
// Kavu Runner already uses.
//
// Fixture: a synthetic test-only card (Carnage Interpreter itself, CLU 26,
// `cards/sets/clu/multicolor.ts`, is STILL a commented-out stub — blocked on
// issue #782's unrelated hybrid-mana-cost gap, `{1}{B/R}{B/R}`, not on
// anything this issue fixes) registered via the sanctioned test-only seam
// `registerTokenDefinition` (already used this way by
// `gre/__tests__/intervening-if.test.ts` and others). It mirrors Carnage
// Interpreter's exact clause: "As long as you have one or fewer cards in
// hand, this creature ... has menace."
//
// Exercised through `checkStateBasedActions` (never `refreshCounterGatedStatics`
// directly) — a hand-built call to the refresh helper would stay green even
// if the `gre/sba.ts` wiring were deleted, exactly the weakness a reviewer
// flagged on the Kavu Runner PR (#1811).
import { describe, it, expect, beforeAll } from "vitest";
import { applySourceStaticEffects } from "../state";
import { checkStateBasedActions } from "../sba";
import type { GameState, CardInstanceState } from "../state";
import { registerTokenDefinition } from "../../cards";
import type {
    CardDefinition,
    PermanentView,
    StaticEffectStateView,
} from "../../cards/types";
import { EFFECT_AFFECTS_SELF } from "../../cards/types";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { getMinimumBlockers, validateMinimumBlockers } from "../combat";
import { projectPublicState } from "../../gameProjections";

const TEST_CARD_ID = "test-hand-gated-menace-creature";

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
        return (controller?.hand.length ?? 0) <= max;
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

beforeAll(() => {
    registerTokenDefinition(testCard);
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

describe("hand-size-gated keyword-grant (CR 611.2c, issue #1379)", () => {
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
    // event) is what keeps the cached `staticAbilities` array live.
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
