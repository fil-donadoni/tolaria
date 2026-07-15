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
//     LATER triggered ability's check-time `condition` — proven via a
//     synthetic probe (no shipped card consumes this yet; Vibrance/Deceit/
//     Wistfulness remain blocked on the separate hybrid-ManaCost gap, #782)
//   - the frontend wiring SURFACE: projectPublicState carries both fields
import { describe, it, expect } from "vitest";
import { resolveTopOfStack, type GameState, type StackItem } from "../state";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../alternativeCost";
import { tryAutoCommitPendingCast } from "../../game";
import { collectTriggers } from "../triggers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { grief } from "../../cards/sets/mh2/black";
import { solitude } from "../../cards/sets/mh2/white";
import { darkRitual } from "../../cards/sets/lea/black";
import { grizzlyBears, serraAngel } from "../../cards/sets/lea";
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
// grant its controller life). The card-testing convention makes a GRE outcome
// test mandatory: this drives the ETB through the REAL trigger path
// (collectTriggers → resolveTopOfStack, suspend on the choose-permanents
// choice → commit → resume) and asserts the exile, the last-known-information
// power read (life gained equals the target's power read BEFORE exile), and
// the CR 109.2 "up to one OTHER" self-exclusion (Solitude itself is off the
// candidate filter, so it survives its own ETB).
describe("Solitude ETB (CR 603.6a — exile up to one other creature, LKI life gain)", () => {
    /** Puts a resolved Solitude on p1's battlefield alongside p2's Serra Angel
     *  (power 4), fires Solitude's ETB, and resolves up to the choose-permanents
     *  suspension. Returns the parked state (pendingChoices populated). */
    function setupSolitudeEtb(): GameState {
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
                makePlayer("p2", { battlefield: [serra] }),
            ],
        });
        // Fire Solitude's self-ETB and put it on the stack.
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
        // First resolve suspends on the requestChoice (returns null).
        resolveTopOfStack(state);
        return state;
    }

    /** Stores picks into the head pending choice's collectedChoices and shifts
     *  the queue (mirrors selectResolutionChoice / commitHeadChoice). */
    function commitHeadChoice(state: GameState, picks: string[]): void {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find(
            (s) => s.id === head.stackItemId
        ) as StackItem;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        state.pendingChoices = queue.length > 1 ? queue.slice(1) : undefined;
    }

    it("suspends on a choose-permanents choice whose filter EXCLUDES Solitude itself (CR 109.2 'other')", () => {
        const state = setupSolitudeEtb();
        const head = state.pendingChoices?.[0];
        expect(head).toBeDefined();
        expect(head!.kind).toBe("choose-permanents");
        expect(head!.zone).toBe("battlefield");
        // "up to one OTHER" — Solitude's own id is on the exclude list, so it
        // can never be picked as its own ETB target.
        expect(head!.filter?.excludeInstanceIds).toContain("solitude");
    });

    it("exiles the chosen creature and its controller gains life equal to its power read BEFORE exile (LKI)", () => {
        const state = setupSolitudeEtb();
        // p2's Serra Angel (power 4) is chosen.
        commitHeadChoice(state, ["serra"]);
        resolveTopOfStack(state);

        // (a) The target is exiled from the battlefield.
        expect(
            state.players[1].battlefield.some((c) => c.id === "serra")
        ).toBe(false);
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
        commitHeadChoice(state, []);
        resolveTopOfStack(state);
        // Serra survives, nobody gains life.
        expect(
            state.players[1].battlefield.some((c) => c.id === "serra")
        ).toBe(true);
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
// Wistfulness need this once the SEPARATE hybrid-ManaCost gap, #782, ships).
// No shipped card consumes this yet, so a synthetic probe card exercises the
// engine capability end-to-end.
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
