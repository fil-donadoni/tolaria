// Buyback capability (CR 702.27) — the cost-system infra built once and
// reused by every buyback card (issue #1200). Mirrors
// `convex/gre/__tests__/kicker.test.ts`'s structure/rationale: the project
// has no convex-test harness for game.ts mutations (ADR 0001), so this drives
// the REAL exported pieces `announceCast` uses — `resolveBuybackChoice`
// (validation) and `finalizeTargetSelection` (cost fold + `buybackPaid`
// snapshot on the stack item) — over the real GRE state, in the same order
// the mutation would. The resolution-side redirect
// (`finalizeSpellResolution` routing to the owner's hand) is driven directly
// through `resolveTopOfStack`.
//
// Corpse Dance (the card #1200 asked for) SHIPPED with issue #1967, which
// built the top-of-graveyard selector its other clause was blocked on — the
// real-card end-to-end buyback assertion lives with it in
// `convex/cards/sets/tmp/__tests__/black.test.ts` ("with buyback paid, Corpse
// Dance returns to its owner's HAND while the reanimation still happens").
// The synthetic probe card below stays: it isolates the COST-SYSTEM plumbing
// (validation, fold, flag snapshot, serialization round-trip) from any one
// card's effect body, exactly like kicker.test.ts's `kickerAltProbe`.

import { describe, it, expect } from "vitest";
import { resolveBuybackChoice, finalizeTargetSelection } from "../../game";
import { foldBuybackCost as foldBuybackCostForSearch } from "../kicker";
import {
    buildSpellContext,
    getPlayer,
    resolveTopOfStack,
    type PendingTarget,
} from "../state";
import { compactState, expandState } from "../serialize";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { grizzlyBears } from "../../cards/sets/lea";
import { counterspell } from "../../cards/sets/lea/blue";
import { regrowth } from "../../cards/sets/lea/green";

// A synthetic probe card carrying a Buyback cost (CR 702.27a — an ADDITIONAL
// mana cost) and an empty effect body — the resolution-routing tests only
// care about WHERE the card ends up, not what it does on resolution.
const BUYBACK_PROBE_ID = "test:buyback-probe";
const buybackProbe: CardDefinition = {
    id: BUYBACK_PROBE_ID,
    rarity: "common",
    name: "Buyback Probe",
    manaCost: { B: 1 },
    types: ["Instant"],
    buyback: { X: 2 }, // Buyback {2}
    effects: [],
};
registerTokenDefinition(buybackProbe);

describe("Buyback — cost validation (CR 702.27)", () => {
    it("returns false for an absent/false request", () => {
        expect(resolveBuybackChoice(buybackProbe, undefined)).toBe(false);
        expect(resolveBuybackChoice(buybackProbe, false)).toBe(false);
    });

    it("accepts a paid buyback for a card that declares one", () => {
        expect(resolveBuybackChoice(buybackProbe, true)).toBe(true);
    });

    it("rejects a paid request for a card with no buyback cost", () => {
        expect(() => resolveBuybackChoice(grizzlyBears, true)).toThrow();
    });
});

describe("Buyback — cost fold + flag snapshot (CR 702.27a / 601.2f)", () => {
    it("folds the buyback cost into the paid mana and stamps buybackPaid on the stack item", () => {
        // Buyback Probe: {B}; Buyback {2}. Paid total = {2}{B} = 3 mana.
        const probe = makeInstance(BUYBACK_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "probe1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    // 3 black covers {2}{B} (2 generic + 1 coloured) — B pays
                    // generic too.
                    manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "probe1",
            targetType: "any",
            count: 0,
            selected: [],
            buybackPaid: true,
        };
        finalizeTargetSelection(state, pt, "p1");
        // All 3 black mana consumed (base {B} + buyback {2}).
        expect(getPlayer(state, "p1").manaPool.B).toBe(0);
        // The spell is on the stack carrying the buyback flag.
        const onStack = state.stack.find((s) => s.id === "probe1");
        expect(onStack?.buybackPaid).toBe(true);
    });

    it("pays only the base cost when buyback isn't paid", () => {
        const probe = makeInstance(BUYBACK_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "probe2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "probe2",
            targetType: "any",
            count: 0,
            selected: [],
        };
        finalizeTargetSelection(state, pt, "p1");
        // Only {B} paid → 2 black remain.
        expect(getPlayer(state, "p1").manaPool.B).toBe(2);
        const onStack = state.stack.find((s) => s.id === "probe2");
        expect(onStack?.buybackPaid).toBeUndefined();
    });
});

describe("Buyback — resolution redirect (CR 702.27a)", () => {
    it("a paid buyback spell returns to its owner's hand instead of the graveyard", () => {
        const state = makeState();
        const item = pushSpell(state, BUYBACK_PROBE_ID, "p1");
        item.buybackPaid = true;
        resolveTopOfStack(state);
        const p1 = getPlayer(state, "p1");
        expect(p1.hand.some((c) => c.id === item.id)).toBe(true);
        expect(p1.graveyard.some((c) => c.id === item.id)).toBe(false);
        expect(state.stack.length).toBe(0);
    });

    it("an unpaid buyback spell goes to the graveyard as normal", () => {
        const state = makeState();
        const item = pushSpell(state, BUYBACK_PROBE_ID, "p1");
        resolveTopOfStack(state);
        const p1 = getPlayer(state, "p1");
        expect(p1.graveyard.some((c) => c.id === item.id)).toBe(true);
        expect(p1.hand.some((c) => c.id === item.id)).toBe(false);
        expect(state.stack.length).toBe(0);
    });
});

describe("Buyback — recast after returning to hand does not leak (fixup, issue #1200)", () => {
    it("a spell that came back to hand via paid buyback goes to the GRAVEYARD on a later UNPAID recast", () => {
        // Regression for the review finding: `finalizeSpellResolution`'s
        // buyback-to-hand branch used to push the resolved stack item
        // straight into `owner.hand` WITHOUT stripping stack-only fields, so
        // `buybackPaid: true` physically survived on the hand-card object.
        // `finalizeTargetSelection`'s cast-commit spread
        // (`{ ...card, ..., ...(buybackPaid ? { buybackPaid: true } : {}) }`)
        // only OVERRIDES `buybackPaid` when the NEW cast pays it — when it
        // doesn't, that spread is `{}` and the stale `true` from `...card`
        // silently rode onto the fresh stack item, sending the spell back to
        // hand for free on every subsequent cast.
        const probe = makeInstance(BUYBACK_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "probeRecast",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    // Two casts at {2}{B} = 3 mana each.
                    manaPool: { W: 0, U: 0, B: 6, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        // First cast: pay buyback → resolves back to hand instead of the
        // graveyard.
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "probeRecast",
                targetType: "any",
                count: 0,
                selected: [],
                buybackPaid: true,
            },
            "p1"
        );
        resolveTopOfStack(state);
        const afterFirstCast = getPlayer(state, "p1");
        expect(afterFirstCast.hand.some((c) => c.id === "probeRecast")).toBe(
            true
        );
        // The hand card must NOT carry the stack-only buybackPaid snapshot
        // forward — this is the core assertion the fix guarantees.
        const handCard = afterFirstCast.hand.find(
            (c) => c.id === "probeRecast"
        ) as { buybackPaid?: boolean } | undefined;
        expect(handCard?.buybackPaid).toBeUndefined();

        // Second cast: do NOT pay buyback this time.
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "probeRecast",
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        resolveTopOfStack(state);

        const p1 = getPlayer(state, "p1");
        expect(p1.graveyard.some((c) => c.id === "probeRecast")).toBe(true);
        expect(p1.hand.some((c) => c.id === "probeRecast")).toBe(false);
    });
});

describe("Buyback — serialization round-trip (schema drift guard, CR 702.27)", () => {
    it("preserves a stack item's buybackPaid across compact/expand", () => {
        const state = makeState();
        const item = pushSpell(state, BUYBACK_PROBE_ID, "p1");
        item.buybackPaid = true;
        const round = expandState(compactState(state));
        const restored = round.stack.find((s) => s.id === item.id);
        expect(restored?.buybackPaid).toBe(true);
        // And the restored item still resolves to hand (not graveyard).
        resolveTopOfStack(round);
        const p1 = getPlayer(round, "p1");
        expect(p1.hand.some((c) => c.id === item.id)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Issue #2137: `buybackPaid` was cleared in exactly ONE place —
// `resetStackTransientState`, reached only from the buyback-to-hand branch
// above. A paid-buyback spell that instead got COUNTERED never touched that
// branch, so `buybackPaid: true` rode into the graveyard/exile/library/hand
// untouched — and every cast branch in `convex/game.ts` builds its new stack
// item as `{ ...card, ...(buybackPaid ? { buybackPaid: true } : {}) }`, a
// spread that is `{}` (and therefore does not CLEAR the field) whenever the
// NEW cast doesn't pay buyback. So a spell paid-buyback once, then countered
// once, then recast UNPAID would resolve back to hand for free forever,
// defeating CR 702.27's additional cost. Fixed by generalizing the shared
// exit chokepoint (`resetStackTransientState`, formerly narrower
// `clearCastKickerSnapshot`) to run at every non-battlefield stack exit, not
// just the buyback-hand one — see its doc comment in `convex/gre/state.ts`.
// ---------------------------------------------------------------------------
describe("Buyback — a COUNTERED spell drops buybackPaid at every SpellContext.counter() destination (CR 400.7 / issue #2137)", () => {
    function counterAPaidBuybackProbe(
        destination: "exile" | "library-top" | "hand"
    ) {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const probe = pushSpell(state, BUYBACK_PROBE_ID, "p1");
        probe.buybackPaid = true;
        // A throwaway counter spell — only its presence on the stack is
        // needed to obtain a `SpellContext`; `SpellContext.counter()` reads
        // no field of its OWN item, only the target's.
        const counterer = pushSpell(state, counterspell.id, "p2");
        const ctx = buildSpellContext(state, counterer);
        ctx.counter({ type: "spell", id: probe.id }, destination);
        return { state, probeId: probe.id };
    }

    it("exile — No More Lies-style redirect strips buybackPaid", () => {
        const { state, probeId } = counterAPaidBuybackProbe("exile");
        const inExile = getPlayer(state, "p1").exile.find(
            (c) => c.id === probeId
        );
        expect(inExile).toBeDefined();
        expect((inExile as { buybackPaid?: boolean }).buybackPaid).toBe(
            undefined
        );
    });

    it("library-top — Memory Lapse-style redirect strips buybackPaid", () => {
        const { state, probeId } = counterAPaidBuybackProbe("library-top");
        const inLibrary = getPlayer(state, "p1").library.find(
            (c) => c.id === probeId
        );
        expect(inLibrary).toBeDefined();
        expect((inLibrary as { buybackPaid?: boolean }).buybackPaid).toBe(
            undefined
        );
    });

    it("hand — Remand-style redirect strips buybackPaid (the branch that used to run NO reset at all)", () => {
        const { state, probeId } = counterAPaidBuybackProbe("hand");
        const inHand = getPlayer(state, "p1").hand.find(
            (c) => c.id === probeId
        );
        expect(inHand).toBeDefined();
        expect((inHand as { buybackPaid?: boolean }).buybackPaid).toBe(
            undefined
        );
    });
});

// Non-blocking gap flagged in PR #2412 review round 2: `moveSpellFromStack`
// (`SpellContext.moveSpellFromStack`, the Subtlety CR 701.6-adjacent "put
// target spell on top/bottom of its owner's library" effect — NOT a counter,
// CR 113.6g) shares `resetStackTransientState` with `counter()`'s
// library-top/exile/hand branches but had no `buybackPaid` coverage of its
// own. Genuinely reachable with a paid-buyback spell (Subtlety can target
// any spell on the stack, including one cast with buyback paid), unlike the
// resolve-side redirects (`exileOnResolve`/`shuffleIntoLibraryOnResolve`/
// `reboundFromHand`) which are mutually exclusive with buyback by
// construction (a spell mid-resolution already chose its own destination).
describe("Buyback — moveSpellFromStack (Subtlety) strips buybackPaid (CR 701.6 counter-adjacent / issue #2137)", () => {
    it("top — a paid-buyback spell put on top of its library carries no buybackPaid", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const probe = pushSpell(state, BUYBACK_PROBE_ID, "p1");
        probe.buybackPaid = true;
        // A throwaway spell on the stack — only its presence is needed to
        // obtain a `SpellContext`; `moveSpellFromStack` reads no field of its
        // OWN item, only the target's.
        const subtletySource = pushSpell(state, counterspell.id, "p2");
        const ctx = buildSpellContext(state, subtletySource);
        ctx.moveSpellFromStack({ type: "spell", id: probe.id }, "library-top");

        const inLibrary = getPlayer(state, "p1").library.find(
            (c) => c.id === probe.id
        );
        expect(inLibrary).toBeDefined();
        expect((inLibrary as { buybackPaid?: boolean }).buybackPaid).toBe(
            undefined
        );
    });

    it("bottom — a paid-buyback spell put on the bottom of its library carries no buybackPaid", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const probe = pushSpell(state, BUYBACK_PROBE_ID, "p1");
        probe.buybackPaid = true;
        const subtletySource = pushSpell(state, counterspell.id, "p2");
        const ctx = buildSpellContext(state, subtletySource);
        ctx.moveSpellFromStack(
            { type: "spell", id: probe.id },
            "library-bottom"
        );

        const inLibrary = getPlayer(state, "p1").library.find(
            (c) => c.id === probe.id
        );
        expect(inLibrary).toBeDefined();
        expect((inLibrary as { buybackPaid?: boolean }).buybackPaid).toBe(
            undefined
        );
    });
});

describe("Buyback — countered → graveyard → Regrowth → UNPAID recast (issue #2137, proven to fail against pre-fix code)", () => {
    it("does NOT return to hand on resolution after a later recast that does not pay buyback", () => {
        // The full reproduction from the issue, shipped cards only:
        //   1. p1 casts the buyback probe WITH buyback paid.
        //   2. p2's Counterspell counters it (CR 608.2b) — the spell never
        //      reaches its own buyback-to-hand redirect, so it heads to the
        //      GRAVEYARD (counter()'s default destination) still carrying
        //      `buybackPaid: true` on pre-fix code.
        //   3. Regrowth returns it from the graveyard to hand — the record
        //      rides along untouched on pre-fix code.
        //   4. p1 recasts it WITHOUT paying buyback, through the real
        //      `finalizeTargetSelection` (the production cast-commit path).
        //      On pre-fix code the stale `buybackPaid: true` survives the
        //      `{ ...card, ...(buybackPaid ? {...} : {}) }` spread and the
        //      spell resolves back to hand again for free — CR 702.27's
        //      additional cost defeated on every cast after the first.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    // Only the BASE {B} cost — not enough to pay buyback
                    // {2}{B} — so a return to hand on the final resolve can
                    // only be the bug, never an accidental second payment.
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        // 1. Cast with buyback paid (bypassing cost payment — the payment
        //    plumbing itself is covered by the "cost fold + flag snapshot"
        //    describe block above; this test is about the EXIT, not the
        //    payment).
        const probe = pushSpell(state, BUYBACK_PROBE_ID, "p1");
        probe.buybackPaid = true;

        // 2. Counter it — default "graveyard" destination.
        const counterer = pushSpell(state, counterspell.id, "p2");
        const ctx = buildSpellContext(state, counterer);
        ctx.counter({ type: "spell", id: probe.id });

        const afterCounter = getPlayer(state, "p1");
        const inGraveyard = afterCounter.graveyard.find(
            (c) => c.id === probe.id
        );
        expect(inGraveyard).toBeDefined();
        // The core assertion the fix guarantees: a COUNTERED buyback spell
        // reaches the graveyard with no memory of having paid buyback.
        expect((inGraveyard as { buybackPaid?: boolean }).buybackPaid).toBe(
            undefined
        );

        // 3. Regrowth returns it to hand.
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: probe.id, playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const inHand = getPlayer(state, "p1").hand.find(
            (c) => c.id === probe.id
        );
        expect(inHand).toBeDefined();
        expect((inHand as { buybackPaid?: boolean }).buybackPaid).toBe(
            undefined
        );

        // 4. Recast, UNPAID, through the real production cast-commit path.
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: probe.id,
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        const recast = state.stack.find((s) => s.id === probe.id);
        expect(recast).toBeDefined();
        expect(recast?.buybackPaid).toBe(undefined);

        resolveTopOfStack(state);
        const p1 = getPlayer(state, "p1");
        // The spell must resolve to the GRAVEYARD, exactly like any other
        // unpaid buyback spell — NOT back to hand for free.
        expect(p1.graveyard.some((c) => c.id === probe.id)).toBe(true);
        expect(p1.hand.some((c) => c.id === probe.id)).toBe(false);
    });
});

// Issue #2081 fixup (review round 1, low finding) — `convex/gre/kicker.ts`'s
// `foldBuybackCost` is a SECOND, independent copy of `game.ts`'s private
// same-named helper (duplicated rather than imported because `game.ts` is
// the mutation SURFACE, not a library the search sandboxes depend on, and
// this issue's batch forbids editing `game.ts` to add an export — see
// `foldBuybackCost`'s own doc comment in `kicker.ts`). Two independent copies
// of a cost rule with no guard is exactly the drift class this repo keeps
// paying for, so this test asserts the two AGREE by driving each through its
// own real entry point over the SAME printed cost and comparing the total
// extra mana charged, rather than importing either implementation into the
// other (game.ts's copy is unexported by design, and this PR may not export
// it).
describe("Buyback — foldBuybackCost stays in sync between the search-sandbox copy (gre/kicker.ts) and game.ts's private commit-path copy (issue #2081 fixup)", () => {
    it("both copies fold the identical extra mana onto the printed cost", () => {
        // Buyback Probe: {B}; Buyback {2}. Paid total = {2}{B} = 3 mana.
        const probe = makeInstance(BUYBACK_PROBE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: "probeDrift",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [probe],
                    manaPool: { W: 0, U: 0, B: 5, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const before = getPlayer(state, "p1").manaPool.B;
        // game.ts's REAL commit path — the same `finalizeTargetSelection`
        // call the "cost fold + flag snapshot" describe block above drives.
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "probeDrift",
                targetType: "any",
                count: 0,
                selected: [],
                buybackPaid: true,
            },
            "p1"
        );
        const chargedByGameTs = before - getPlayer(state, "p1").manaPool.B;

        // The search-sandbox's own copy, folded independently over the SAME
        // printed cost ({B}) it would see at enumeration time.
        const cost: Record<string, number> = { B: 1 };
        foldBuybackCostForSearch(cost, buybackProbe, true);
        const chargedByKickerTs = Object.values(cost).reduce(
            (a, b) => a + b,
            0
        );

        expect(chargedByKickerTs).toBe(chargedByGameTs);
        expect(chargedByGameTs).toBe(3); // {2}{B} — sanity, not the drift guard itself
    });
});
