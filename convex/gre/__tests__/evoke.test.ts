// Evoke capability tests (CR 702.74, issue #900). Built once here, reused by
// every evoke card (Solitude, Grief). Covers the whole GRE → game.ts → UI
// path the capability crosses:
//   - `def.evoke` resolves through the SAME `getAlternativeCost` /
//     `affordableAlternativeCosts` authority as the generic `alternativeCosts[]`
//     array (convex/gre/alternativeCost.ts)
//   - the real cast-commit seam tags the resulting stack item `evoked: true`
//     (`tryAutoCommitPendingCast`, convex/game.ts) — mirrors the Force of
//     Will / pitch-cost.test.ts pattern (this project has no convex-test
//     harness for game.ts mutations, ADR 0001, so the REAL exported commit
//     function is driven directly over a manually-parked `pendingCast`)
//   - the `evoked` marker riding onto the resulting permanent for free (a
//     stack item IS its CardInstanceState, the `escaped` precedent) via
//     `resolveTopOfStack`
//   - the second half of CR 702.74a — `evokeTrigger`'s check-time `condition`
//     sacrifices an EVOKED permanent on ETB, and leaves a HARD-CAST permanent
//     alone — through the real ETB trigger path (`collectTriggers` +
//     `resolveTopOfStack`)
//   - serialization round-trip of `evoked` and `notedManaSpentOnCast`
//   - spent-mana-color tracking (issue #900's second half): a permanent
//     carries `notedManaSpentOnCast` from its originating cast, readable by a
//     LATER triggered ability's check-time `condition` — proven on a synthetic
//     probe (non-hybrid cost) AND, since issue #1927, on the shipped consumer
//     Vibrance (ECL), whose GUILD-HYBRID evoke cost is paid with real mana
//   - the frontend wiring SURFACE: projectPublicState carries both fields
import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    getPlayer,
    normalizeManaCost,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../alternativeCost";
import { tryAutoCommitPendingCast, finalizeTargetSelection } from "../../game";
import { collectTriggers } from "../triggers";
import { raiseTriggerTargetSelection } from "../rules";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { grief } from "../../cards/sets/mh2/black";
import { solitude } from "../../cards/sets/mh2/white";
import { darkRitual } from "../../cards/sets/lea/black";
import { forest, grizzlyBears, serraAngel } from "../../cards/sets/lea";
import { counterspell } from "../../cards/sets/lea/blue";
import { regrowth } from "../../cards/sets/lea/green";
import { vibrance } from "../../cards/sets/ecl/multicolor";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

describe("Evoke — cost lookup (CR 702.74a, convex/gre/alternativeCost.ts)", () => {
    it("getAlternativeCost resolves def.evoke by its own id (reference equality)", () => {
        expect(getAlternativeCost(grief, "evoke")).toBe(grief.evoke);
        expect(getAlternativeCost(solitude, "evoke")).toBe(solitude.evoke);
    });

    it("affordableAlternativeCosts offers the evoke variant when a matching hand card is available", () => {
        const griefInst = handCard(grief.id, "grief");
        const ritual = handCard(darkRitual.id, "ritual");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [griefInst, ritual] }),
                makePlayer("p2"),
            ],
        });
        const alts = affordableAlternativeCosts(
            state,
            state.players[0],
            griefInst
        );
        expect(alts.some((a) => a.id === "evoke")).toBe(true);
    });

    it("affordableAlternativeCosts omits evoke with no matching hand card", () => {
        const griefInst = handCard(grief.id, "grief");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [griefInst] }),
                makePlayer("p2"),
            ],
        });
        const alts = affordableAlternativeCosts(
            state,
            state.players[0],
            griefInst
        );
        expect(alts.some((a) => a.id === "evoke")).toBe(false);
    });
});

describe("Evoke — cast commit tags the stack item (CR 601.2h / 118.9)", () => {
    function griefEvokeCast(): GameState {
        const griefInst = handCard(grief.id, "grief");
        const ritual = handCard(darkRitual.id, "ritual");
        const oppCard = handCard(grizzlyBears.id, "opp-card", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [griefInst, ritual] }),
                makePlayer("p2", { hand: [oppCard] }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "grief",
            manaCost: {},
            tappedLandIds: [],
            evoked: true,
            alternativeCostHandChoice: {
                action: "exile",
                requirements: [{ filter: { color: "B" }, count: 1 }],
                excludeInstanceId: "grief",
                pickedCardIds: ["ritual"],
            },
        };
        return state;
    }

    it("commits: exiles the black card, stacks Grief tagged evoked", () => {
        const state = griefEvokeCast();
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        const p1 = state.players[0];
        expect(p1.exile.map((c) => c.id)).toEqual(["ritual"]);
        expect(p1.hand.map((c) => c.id)).not.toContain("grief");
        const stackItem = state.stack.find((s) => s.id === "grief");
        expect(stackItem).toBeDefined();
        expect((stackItem as StackItem).evoked).toBe(true);
    });
});

describe("Evoke — CR 702.74a sacrifice-on-ETB", () => {
    /** Resolves the top of stack, then fires+resolves every ETB trigger for
     *  `instanceId`. Mirrors escape.test.ts's ETB-trigger drive pattern. */
    function enterAndResolveTriggers(
        state: GameState,
        instanceId: string,
        cardId: string
    ): void {
        resolveTopOfStack(state);
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId,
                controllerId: "p1",
                cardId,
                types: ["Creature"],
            },
        ]);
        state.stack.push(...triggers);
        // Auto-commit every mid-resolution choice (Grief's `choose-hand-card`
        // suspends even with a single forced candidate — CR 608.2 choices
        // always round-trip through the Pending Choice queue, there is no
        // silent auto-resolve) by picking the first `count` offered
        // candidates, mirroring `commitHeadChoice` in pending-choices.test.ts.
        let guard = 0;
        while (state.stack.length > 0 && guard++ < 20) {
            const pending = state.pendingChoices;
            if (pending && pending.length > 0) {
                const head = pending[0];
                // CR 603.3b (ADR 0058) — Grief's ETB + evoke-sacrifice are two
                // distinct simultaneous triggers, so the flush suspends on a
                // `trigger-order` choice with the batch held off-stack. Land it
                // (collection order) so the triggers reach the stack, then loop.
                if (head.kind === "trigger-order") {
                    resolveTriggerOrder(state);
                    continue;
                }
                const item = state.stack.find(
                    (s) => s.id === head.stackItemId
                ) as StackItem;
                const count =
                    typeof head.count === "number"
                        ? head.count
                        : head.count.max;
                const picks = (head.candidateIds ?? []).slice(0, count);
                item.collectedChoices = {
                    ...(item.collectedChoices ?? {}),
                    [`${head.step}:${head.choiceId}`]: picks,
                };
                state.pendingChoices =
                    pending.length > 1 ? pending.slice(1) : undefined;
                continue;
            }
            resolveTopOfStack(state);
        }
    }

    it("an EVOKED Grief resolves its ETB (opponent discards) then sacrifices itself", () => {
        const griefStack: StackItem = {
            ...handCard(grief.id, "grief"),
            zone: "stack",
            castById: "p1",
            evoked: true,
        };
        const oppCard = handCard(grizzlyBears.id, "opp-card", "p2");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [oppCard] })],
        });
        state.stack.push(griefStack);
        enterAndResolveTriggers(state, "grief", grief.id);

        // The ETB effect fired: the opponent's sole nonland card was
        // discarded (forced pick, no suspension).
        expect(state.players[1].hand).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "opp-card")
        ).toBe(true);
        // CR 702.74a — evoked, so it's sacrificed: NOT on the battlefield,
        // IS in its owner's graveyard.
        expect(state.players[0].battlefield.some((c) => c.id === "grief")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "grief")).toBe(
            true
        );
    });

    it("a HARD-CAST Grief (no evoke) resolves its ETB and survives", () => {
        const griefStack: StackItem = {
            ...handCard(grief.id, "grief"),
            zone: "stack",
            castById: "p1",
        };
        const oppCard = handCard(grizzlyBears.id, "opp-card", "p2");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [oppCard] })],
        });
        state.stack.push(griefStack);
        enterAndResolveTriggers(state, "grief", grief.id);

        // ETB effect still fires (unconditional on evoke).
        expect(state.players[1].hand).toHaveLength(0);
        // Not evoked: Grief stays on the battlefield.
        expect(state.players[0].battlefield.some((c) => c.id === "grief")).toBe(
            true
        );
        expect(state.players[0].graveyard.some((c) => c.id === "grief")).toBe(
            false
        );
    });
});

// Solitude is a resolve() card with a VISIBLE ETB effect (exile a creature,
// grant its controller life). Since issue #1193 the "up to one other target
// creature" is a REAL target chosen when the ETB trigger is PUT ON THE STACK
// (CR 603.3d), declared as a `targetRequirement` with `excludeSource` — not a
// resolution-time choice. This drives the ETB through the REAL trigger path
// (collectTriggers → raiseTriggerTargetSelection → finalizeTargetSelection →
// resolveTopOfStack) and asserts the exile, the last-known-information power
// read (life gained equals the target's power read BEFORE exile), and the
// CR 603.3d "other" self-exclusion (Solitude itself is off the candidate set,
// so it survives its own ETB).
describe("Solitude ETB (CR 603.3d — exile up to one other creature, LKI life gain)", () => {
    /** Puts a resolved Solitude on p1's battlefield (optionally alongside p2's
     *  Serra Angel, power 4) and fires Solitude's ETB onto the stack, leaving
     *  its target slot un-set (the trigger-target machinery locks it next). */
    function setupSolitudeEtb(withSerra = true): GameState {
        const solitudePermanent = makeInstance(solitude.id, {
            id: "solitude",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const serra = makeInstance(serraAngel.id, {
            id: "serra",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [solitudePermanent] }),
                makePlayer("p2", {
                    battlefield: withSerra ? [serra] : [],
                }),
            ],
        });
        // Fire Solitude's self-ETB and put it on the stack (targets un-set).
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "solitude",
                controllerId: "p1",
                cardId: solitude.id,
                types: ["Creature"],
            },
        ]).filter((t) => t.triggeredAbilityId === "solitude-etb");
        state.stack.push(...triggers);
        return state;
    }

    /** Drives the CR 603.3d target choice: raise the kind:"trigger" PendingTarget
     *  then finalize the chosen (or empty) target set onto the on-stack trigger. */
    function chooseSolitudeTarget(state: GameState, id: string | null): void {
        const raised = raiseTriggerTargetSelection(state);
        expect(raised).toBe(true);
        state.pendingTarget!.selected = id ? [{ type: "permanent", id }] : [];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
    }

    it("raises a kind:'trigger' target on the controller (CR 603.3d)", () => {
        const state = setupSolitudeEtb();
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.kind).toBe("trigger");
        expect(state.pendingTarget?.playerId).toBe("p1");
        expect(state.pendingTarget?.targetType).toBe("Creature");
    });

    it("with no OTHER creature, the up-to-one trigger locks an empty target and resolves as a no-op (CR 603.3d 'other' self-exclusion)", () => {
        const state = setupSolitudeEtb(false); // only Solitude on the board
        // None legal (Solitude excludes itself), min 0 → no prompt, empty lock.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "solitude-etb"
        )!;
        expect(trig.targets).toEqual([]);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "solitude")
        ).toBe(true);
    });

    it("exiles the chosen creature and its controller gains life equal to its power read BEFORE exile (LKI)", () => {
        const state = setupSolitudeEtb();
        chooseSolitudeTarget(state, "serra"); // p2's Serra Angel (power 4)
        resolveTopOfStack(state);

        // (a) The target is exiled from the battlefield.
        expect(state.players[1].battlefield.some((c) => c.id === "serra")).toBe(
            false
        );
        expect(state.players[1].exile.some((c) => c.id === "serra")).toBe(true);
        // (b) Its controller (p2) gained life equal to its power (4), read
        // while it was still on the battlefield — a post-exile read would see
        // 0, so 24 proves the LKI ordering.
        expect(state.players[1].life).toBe(24);
        // (c) Solitude itself was NOT exiled by its own ETB (the "other"
        // exclusion held through the real resolution).
        expect(
            state.players[0].battlefield.some((c) => c.id === "solitude")
        ).toBe(true);
    });

    it("'up to one' — choosing zero targets is legal and exiles nothing", () => {
        const state = setupSolitudeEtb();
        chooseSolitudeTarget(state, null);
        resolveTopOfStack(state);
        // Serra survives, nobody gains life.
        expect(state.players[1].battlefield.some((c) => c.id === "serra")).toBe(
            true
        );
        expect(state.players[1].life).toBe(20);
    });
});

describe("Evoke — serialization (CR 702.74a)", () => {
    it("round-trips the evoked flag on a battlefield permanent", () => {
        const griefPermanent = makeInstance(grief.id, {
            id: "grief",
            controllerId: "p1",
            ownerId: "p1",
            evoked: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [griefPermanent] }),
                makePlayer("p2"),
            ],
        });
        const restored = expandState(compactState(state));
        const back = restored.players[0].battlefield.find(
            (c) => c.id === "grief"
        );
        expect(back?.evoked).toBe(true);
    });
});

describe("Evoke — frontend wiring SURFACE (projectPublicState)", () => {
    it("evoked survives the wire projection", () => {
        const griefPermanent = makeInstance(grief.id, {
            id: "grief",
            controllerId: "p1",
            ownerId: "p1",
            evoked: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [griefPermanent] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "grief"
        );
        expect(slim?.evoked).toBe(true);
    });
});

// Spent-mana-color tracking (issue #900's second half): a permanent
// entering via casting carries the per-colour mana spent as
// `notedManaSpentOnCast`, readable by a LATER triggered ability's check-time
// `condition` — the "if {R}{R} was spent to cast it" shape (Vibrance/Deceit/
// Wistfulness, ECL, shipped by issue #1927, are the real consumers). A
// synthetic probe card exercises the bare engine capability here on a
// NON-hybrid cost; the hybrid-evoke combination the Incarnations actually use
// is proven on Vibrance itself in the last describe block of this file.
const SPENT_MANA_PROBE_ID = "test:spent-mana-color-probe";
const spentManaProbe: CardDefinition = {
    id: SPENT_MANA_PROBE_ID,
    rarity: "common",
    name: "Spent Mana Probe",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    noteManaSpent: true,
    triggeredAbilities: [
        enteredTrigger({
            id: "probe-rr-etb",
            oracleText:
                "When this creature enters, if {R}{R} was spent to cast it, draw a card.",
            scope: "self",
            condition: (_event, self) =>
                (self.notedManaSpentOnCast?.R ?? 0) >= 2,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
};
registerTokenDefinition(spentManaProbe);

describe("Spent-mana-color tracking (CR 106.4 / 202.3, issue #900)", () => {
    it("resolveTopOfStack snapshots notedManaSpent onto notedManaSpentOnCast at ETB", () => {
        const probe = makeInstance(SPENT_MANA_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
        });
        const stackItem: StackItem = {
            ...probe,
            zone: "stack",
            castById: "p1",
            notedManaSpent: { R: 2 },
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(stackItem);
        resolveTopOfStack(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(onBoard?.notedManaSpentOnCast).toEqual({ R: 2 });
    });

    it("a triggered ability's check-time condition reads it correctly: {R}{R} spent fires the trigger", () => {
        const probe = makeInstance(SPENT_MANA_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
        });
        const stackItem: StackItem = {
            ...probe,
            zone: "stack",
            castById: "p1",
            notedManaSpent: { R: 2 },
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(stackItem);
        resolveTopOfStack(state);
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "probe",
                controllerId: "p1",
                cardId: SPENT_MANA_PROBE_ID,
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
    });

    it("condition is false when less than {R}{R} was spent — trigger never fires", () => {
        const probe = makeInstance(SPENT_MANA_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
        });
        const stackItem: StackItem = {
            ...probe,
            zone: "stack",
            castById: "p1",
            notedManaSpent: { R: 1, C: 2 },
        };
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(stackItem);
        resolveTopOfStack(state);
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "probe",
                controllerId: "p1",
                cardId: SPENT_MANA_PROBE_ID,
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("round-trips notedManaSpentOnCast on a battlefield permanent", () => {
        const probe = makeInstance(SPENT_MANA_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            notedManaSpentOnCast: { R: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [probe] }),
                makePlayer("p2"),
            ],
        });
        const restored = expandState(compactState(state));
        const back = restored.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(back?.notedManaSpentOnCast).toEqual({ R: 2 });
    });

    it("notedManaSpentOnCast survives the wire projection", () => {
        const probe = makeInstance(SPENT_MANA_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            notedManaSpentOnCast: { R: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [probe] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(slim?.notedManaSpentOnCast).toEqual({ R: 2 });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Evoke × GUILD-HYBRID cost × spent-mana-colour condition (issue #1927)
//
// The one genuinely NEW combination the ECL Elemental Incarnations introduce,
// and the reason it earns a hand-written test even though every Op in their
// Effect Scripts is already exercised elsewhere: nothing above proves that a
// HYBRID pip records the colour it was actually PAID with. The evoke coverage
// above is Solitude/Grief — a non-mana pitch leg, no colours to note — and the
// `notedManaSpentOnCast` coverage above is a synthetic probe with a FIXED
// `{1}{R}{R}` cost, where the noted colours are forced by the cost itself.
//
// Vibrance's evoke cost is {R/G}{R/G} (CR 202.1a): the SAME cost can be paid
// with two red, two green, or one of each, and only the payment decides which
// of its two ETB halves fires ("if {R}{R} was spent" / "if {G}{G} was spent",
// CR 106.4 / 202.3, a CR 603.4 check-time condition). Everything below is
// driven through the real seams — the evoke cost is read off the card's own
// `evoke.mana` (never hand-written), paid by `tryAutoCommitPendingCast`, and
// the halves are selected by the real `collectTriggers` scan — because
// hand-setting `notedManaSpentOnCast` would assume away the very step under
// test.
// ═══════════════════════════════════════════════════════════════════════════
describe("Evoke × guild-hybrid cost × spent-mana-colour (CR 202.1a / 106.4 / 702.74a — Vibrance)", () => {
    /** Casts Vibrance for its OWN declared evoke cost with `pool` floating,
     *  through the real cast-commit seam. p1's library holds one Forest so the
     *  green half has something to find. */
    function evokeVibranceWith(pool: Record<string, number>): GameState {
        const vib = handCard(vibrance.id, "vib");
        const libForest = makeInstance(forest.id, {
            id: "lib-forest",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [vib], library: [libForest] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        Object.assign(state.players[0].manaPool, pool);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "vib",
            // The cost under test comes from the CARD, not from this test.
            manaCost: normalizeManaCost(vibrance.evoke!.mana!),
            tappedLandIds: [],
            evoked: true,
        };
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        return state;
    }

    /** Resolves Vibrance off the stack, then returns the ETB triggers the real
     *  scan produces — i.e. after every check-time `condition` has run. */
    function enterAndCollectEtb(state: GameState): StackItem[] {
        resolveTopOfStack(state);
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "vib",
                controllerId: "p1",
                cardId: vibrance.id,
                types: ["Creature"],
            },
        ]);
        // Collecting a BATCH of simultaneous triggers also raises the CR 603.3b
        // stacking-order prompt (its `stackItemId` is the off-stack batch, not
        // a real item). Which half FIRED is orthogonal to the order they are
        // put on the stack in, and each test below resolves a single half, so
        // drop the ordering prompt rather than answer it.
        state.pendingChoices = undefined;
        return triggers;
    }

    function abilityIds(triggers: StackItem[]): (string | undefined)[] {
        return triggers.map((t) => t.triggeredAbilityId);
    }

    /** Resolves the whole stack, auto-committing any mid-resolution choice by
     *  taking the first `count` candidates (the green half's library search). */
    function drainStack(state: GameState): void {
        let guard = 0;
        while (state.stack.length > 0 && guard++ < 20) {
            const pending = state.pendingChoices;
            if (pending && pending.length > 0) {
                const head = pending[0];
                const item = state.stack.find(
                    (s) => s.id === head.stackItemId
                ) as StackItem;
                const count =
                    typeof head.count === "number"
                        ? head.count
                        : head.count.max;
                const picks = (head.candidateIds ?? []).slice(0, count);
                item.collectedChoices = {
                    ...(item.collectedChoices ?? {}),
                    [`${head.step}:${head.choiceId}`]: picks,
                };
                state.pendingChoices =
                    pending.length > 1 ? pending.slice(1) : undefined;
                continue;
            }
            resolveTopOfStack(state);
        }
    }

    it("the {R/G}{R/G} evoke cost is really PAID with two red mana and notes {R}: 2", () => {
        const state = evokeVibranceWith({ R: 2 });
        // Both pips came out of the pool — a hybrid pip treated as free (the
        // pre-#1738 bug) would leave the mana floating.
        expect(state.players[0].manaPool.R).toBe(0);
        const item = state.stack.find((s) => s.id === "vib") as StackItem;
        expect(item.evoked).toBe(true);
        expect(item.notedManaSpent).toEqual({ R: 2 });
    });

    it("two RED mana: the {R}{R} half fires, the {G}{G} half does not", () => {
        const state = evokeVibranceWith({ R: 2 });
        const triggers = enterAndCollectEtb(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "vib"
        );
        expect(onBoard?.notedManaSpentOnCast).toEqual({ R: 2 });

        const ids = abilityIds(triggers);
        expect(ids).toContain("vibrance-etb-damage");
        expect(ids).not.toContain("vibrance-etb-land");
        // CR 702.74a — the evoke sacrifice half is unconditional on colour.
        expect(ids).toContain("evoke-sacrifice");

        // Resolve the red half through the REAL CR 603.3d target path.
        state.stack.push(
            triggers.find(
                (t) => t.triggeredAbilityId === "vibrance-etb-damage"
            )!
        );
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "player", id: "p2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
        // The green half's payload never happened.
        expect(state.players[0].life).toBe(20);
    });

    it("two GREEN mana flips it: the {G}{G} half fires, the {R}{R} half does not", () => {
        const state = evokeVibranceWith({ G: 2 });
        expect(state.players[0].manaPool.G).toBe(0);
        const triggers = enterAndCollectEtb(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "vib"
        );
        expect(onBoard?.notedManaSpentOnCast).toEqual({ G: 2 });

        const ids = abilityIds(triggers);
        expect(ids).toContain("vibrance-etb-land");
        expect(ids).not.toContain("vibrance-etb-damage");

        // Resolve the green half: fetch the Forest to hand, gain 2 life.
        state.stack.push(
            triggers.find((t) => t.triggeredAbilityId === "vibrance-etb-land")!
        );
        drainStack(state);
        expect(state.players[0].hand.some((c) => c.id === "lib-forest")).toBe(
            true
        );
        expect(state.players[0].life).toBe(22);
        // The red half's payload never happened.
        expect(state.players[1].life).toBe(20);
    });

    it("a SPLIT payment ({R}{G}) satisfies neither half — both conditions need two of ONE colour", () => {
        const state = evokeVibranceWith({ R: 1, G: 1 });
        const triggers = enterAndCollectEtb(state);
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "vib"
        );
        expect(onBoard?.notedManaSpentOnCast).toEqual({ R: 1, G: 1 });

        const ids = abilityIds(triggers);
        expect(ids).not.toContain("vibrance-etb-damage");
        expect(ids).not.toContain("vibrance-etb-land");
        // Only the evoke sacrifice remains.
        expect(ids).toEqual(["evoke-sacrifice"]);
    });
});

// ---------------------------------------------------------------------------
// Issue #2412 fixup round 2 (PR review finding): `evoked` was NOT cleared by
// `resetStackTransientState` — the same shared STACK-exit chokepoint issue
// #2137 fixed for `buybackPaid` — even though `convex/game.ts` stamps it
// directly onto the `StackItem` literal at cast commit (the same seam as
// `buybackPaid`), not just onto the eventual battlefield permanent. A
// COUNTERED evoked spell rode `evoked: true` into the graveyard untouched,
// and the next HARD recast's `{ ...card, ...(isEvokeCost ? {...} : {}) }`
// spread in `finalizeTargetSelection` never CLEARED it (that conditional
// spread is `{}` whenever the new cast doesn't pay evoke) — so a hard-cast
// Grief/Solitude/Fury/Subtlety/Endurance would incorrectly sacrifice itself
// on ETB. Reproduced with shipped cards only, driven through the real
// `finalizeTargetSelection` cast-commit path, mirroring
// `buyback.test.ts`'s "countered → graveyard → Regrowth → UNPAID recast"
// regression exactly.
// ---------------------------------------------------------------------------
describe("Evoke — countered → graveyard → Regrowth → HARD recast does not leak (CR 400.7 / issue #2412 fixup)", () => {
    it("a HARD recast after evoke+counter+Regrowth does not still read evoked:true and does not self-sacrifice", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });

        // 1. Cast Grief EVOKED — stamp evoked:true directly on the stack item
        //    (the cost-payment plumbing that produces this stamp is already
        //    covered by the "cast commit tags the stack item" describe block
        //    above; this test is about the EXIT, not the payment).
        const grief1 = pushSpell(state, grief.id, "p1");
        grief1.evoked = true;

        // 2. Counter it — SpellContext.counter()'s default "graveyard"
        //    destination, exactly like the buyback regression.
        const counterer = pushSpell(state, counterspell.id, "p2");
        const ctx = buildSpellContext(state, counterer);
        ctx.counter({ type: "spell", id: grief1.id });

        const afterCounter = getPlayer(state, "p1");
        const inGraveyard = afterCounter.graveyard.find(
            (c) => c.id === grief1.id
        );
        expect(inGraveyard).toBeDefined();
        // The core assertion the fix guarantees: a COUNTERED evoked spell
        // reaches the graveyard with no memory of having been evoked.
        expect((inGraveyard as { evoked?: boolean }).evoked).toBe(undefined);

        // 3. Regrowth returns it to hand.
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: grief1.id, playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const inHand = getPlayer(state, "p1").hand.find(
            (c) => c.id === grief1.id
        );
        expect(inHand).toBeDefined();
        expect((inHand as { evoked?: boolean }).evoked).toBe(undefined);

        // 4. Recast, HARD (no evoke), through the real production cast-commit
        //    path (`finalizeTargetSelection`). Grief costs {2}{B}{B} — fund
        //    the pool (black covers both the coloured pips and the generic).
        getPlayer(state, "p1").manaPool.B = 4;
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: grief1.id,
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        const recast = state.stack.find((s) => s.id === grief1.id);
        expect(recast).toBeDefined();
        expect(recast?.evoked).toBe(undefined);

        // 5. Resolve to the battlefield and re-run the real ETB trigger scan.
        //    A hard-cast Grief must NOT offer the evoke-sacrifice trigger —
        //    on pre-fix code the stale `evoked: true` survives step 4's
        //    spread and this would incorrectly appear.
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === grief1.id)
        ).toBe(true);
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: grief1.id,
                controllerId: "p1",
                cardId: grief.id,
                types: ["Creature"],
            },
        ]);
        expect(triggers.map((t) => t.triggeredAbilityId)).not.toContain(
            "evoke-sacrifice"
        );
    });
});
