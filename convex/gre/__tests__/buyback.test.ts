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
import { getPlayer, resolveTopOfStack, type PendingTarget } from "../state";
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
