// MH3 white — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import {
    createTokenPermanents,
    resolveTopOfStack,
} from "../../../../gre/state";
import { getDefinition } from "../../../index";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { collectTriggers } from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { guideOfSouls, ocelotPride, phelia } from "../white";
import {
    grantCityBlessing,
    hasCityBlessing,
} from "../../../../gre/cityBlessing";
import { balduvianBears } from "../../ice/green";
import { forest } from "../../lea/colorless";

describe("Guide of Souls — ETB (CR 603.6a): another creature entering", () => {
    it("gains 1 life and 1 energy when ANOTHER creature you control enters", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "entering-creature",
                controllerId: "p1",
                cardId: "some-other-creature",
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
        expect(state.players[0].energyCounters).toBe(1);
    });

    it("does NOT trigger on its own ETB (CR 109.2 self-exclusion)", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "guide2",
                controllerId: "p1",
                cardId: guideOfSouls.id,
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("does NOT trigger on an opponent's creature entering", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "their-creature",
                controllerId: "p2",
                cardId: "some-other-creature",
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("does NOT trigger on a non-creature permanent entering", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "a-land",
                controllerId: "p1",
                cardId: "some-land",
                types: ["Land"],
            },
        ]);
        expect(triggers).toHaveLength(0);
    });
});

/** Put Guide of Souls' attack trigger on the stack, mirroring the collector's
 *  ATTACKERS_DECLARED shape (CR 508.1) — a real combat sequence isn't needed
 *  to exercise the targeted-trigger + mayPay + counters/addSubtype pipeline. */
function attackTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "guide-attack-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "guide-of-souls-attack",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: source.controllerId,
            attackerIds: [source.id],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

describe("Guide of Souls — attack trigger (CR 603.3d target + mayPay {E}{E}{E} + CR 122.1c/613.1d)", () => {
    it("targets the sole attacking creature, and on PAY puts two +1/+1 counters + a flying counter + becomes an Angel", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guideAtk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [guide],
                    energyCounters: 3,
                }),
                makePlayer("p2"),
            ],
        });
        attackTriggerOnStack(state, guide);

        // CR 603.3d — a single legal attacking creature auto-selects (no
        // real choice owed, so `raiseTriggerTargetSelection` returns false —
        // it returns true only when a PendingTarget is raised).
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        const trig = state.stack.find((s) => s.id === "guide-attack-trig")!;
        expect(trig.targets).toEqual([{ type: "permanent", id: "guideAtk" }]);

        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.cost).toEqual({ energy: 3 });
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        expect(state.players[0].energyCounters).toBe(0);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "guideAtk"
        )!;
        expect(after.counters).toEqual({ "+1/+1": 2, flying: 1 });
        // CR 122.1c / 613.4d — the flying counter GRANTS flying.
        expect(after.staticAbilities).toContain("flying");
        // CR 613.1d layer 4 — "becomes an Angel in addition to its other types".
        expect(after.subtypes).toContain("Angel");
        expect(after.subtypes).toContain("Human"); // "in addition to" — printed kept
        expect(after.subtypes).toContain("Cleric");

        // Wire format — every observable field here (counters, staticAbilities,
        // subtypes) is board-visible and must survive the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "guideAtk"
        )!;
        expect(slim.counters).toEqual({ "+1/+1": 2, flying: 1 });
        expect(slim.staticAbilities).toContain("flying");
        expect(slim.subtypes).toContain("Angel");
    });

    it("does nothing on DECLINE — no counters, no Angel, energy unspent", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guideDecline",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [guide],
                    energyCounters: 3,
                }),
                makePlayer("p2"),
            ],
        });
        attackTriggerOnStack(state, guide);
        raiseTriggerTargetSelection(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(state.players[0].energyCounters).toBe(3);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "guideDecline"
        )!;
        expect(after.counters).toBeUndefined();
        expect(after.staticAbilities).not.toContain("flying");
        expect(after.subtypes).not.toContain("Angel");
    });

    it("removes the trigger from the stack when no attacking creature is a legal target (CR 603.3c)", () => {
        // Guide of Souls itself is not attacking and no other creature is
        // either — the "target attacking creature" requirement has no legal
        // candidate, so the mandatory-target trigger is removed (CR 603.3c),
        // never reaching the may-pay decision.
        const guide = makeInstance(guideOfSouls.id, {
            id: "guideNoTarget",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        attackTriggerOnStack(state, guide);
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(
            state.stack.find((s) => s.id === "guide-attack-trig")
        ).toBeUndefined();
    });
});

// Phelia, Exuberant Shepherd — {1}{W} 2/2 Legendary Dog, Flash (MH3, issue
// #1320, parent #917). "Whenever Phelia attacks, exile up to one other
// target nonland permanent. At the beginning of the next end step, return
// that card to the battlefield under its owner's control. If it entered
// under your control, put a +1/+1 counter on Phelia." First card to exercise
// the delayed-trigger CONTROLLER-vs-OWNER branch (issue #1320): the fired
// delayed trigger reads the returned permanent's post-return controller and
// compares it against the captured caster, adding a +1/+1 counter on Phelia
// only when they match. The attack trigger's "up to one other target nonland
// permanent" is a REAL target chosen at stack placement (CR 603.3d,
// `targetRequirement` + `raiseTriggerTargetSelection`), not a
// resolution-time choice.

/** Puts Phelia's attack trigger on the stack, mirroring Guide of Souls'
 *  `attackTriggerOnStack` helper (ATTACKERS_DECLARED, CR 508.1). The trigger
 *  now carries a `targetRequirement`, so `raiseTriggerTargetSelection` runs
 *  before resolving (see `choosePheliaTarget`). */
function pheliaAttackTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "phelia-attack-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "phelia-attack",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: source.controllerId,
            attackerIds: [source.id],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen target
 *  (or the empty "decline" set) onto the on-stack trigger. */
function choosePheliaTarget(state: GameState, targetId: string | null) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = targetId
        ? [{ type: "permanent", id: targetId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Phelia — attack trigger (CR 603.6a exile + CR 603.7a delayed return)", () => {
    it("exiles the chosen OTHER nonland permanent and schedules a next-end-step return", () => {
        const p = makeInstance(phelia.id, {
            id: "phelia1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pheliaAttackTriggerOnStack(state, p);
        choosePheliaTarget(state, "target1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(
            state.players[1].battlefield.find((c) => c.id === "target1")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("target1");
        expect(state.delayedTriggers?.length).toBe(1);
        expect(state.delayedTriggers?.[0]?.payload).toMatchObject({
            cardId: "target1",
            ownerId: "p2",
            casterControllerId: "p1",
            sourceId: "phelia1",
        });
    });

    it("wire: the exiled card is pinned under Phelia via exiledByPermanentId (QA: show it like Banishing Light)", () => {
        const p = makeInstance(phelia.id, {
            id: "phelia1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pheliaAttackTriggerOnStack(state, p);
        choosePheliaTarget(state, "target1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        // The resolve stamps `exiledBySourceId` (linkExileToSource), which
        // buildExileAssociation turns into the mechanism-agnostic pin the
        // board renders under the host (AttachedCardsCluster). Must survive
        // the projection for BOTH viewers — the target is opponent-owned, so
        // the link leg that scans every owner's exile zone is what catches it.
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const exiled = projected.players[1].exile.find(
                (c) => c.id === "target1"
            )!;
            expect(exiled.exiledByPermanentId).toBe("phelia1");
        }
    });

    it("excludes lands and Phelia herself — no legal target, resolves as a no-op (CR 603.3c)", () => {
        const p = makeInstance(phelia.id, {
            id: "phelia2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "land1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, land] }),
                makePlayer("p2"),
            ],
        });
        const trig = pheliaAttackTriggerOnStack(state, p);
        // No legal nonland candidate exists (only Phelia herself — excluded by
        // `excludeSource` — and a land, excluded by `excludeTypes`). CR 603.3d
        // "up to one" with none legal: the engine locks an empty target set,
        // no PendingTarget is raised, and the trigger resolves as a no-op.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingTarget).toBeUndefined();
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("when a real choice IS owed, the raised PendingTarget carries the exclusion filters (CR 109.1 / 601.2c) so the interactive choice can't offer/accept a land or Phelia herself", () => {
        // A legal nonland opponent creature exists alongside Phelia and a land,
        // so `raiseTriggerTargetSelection` raises an interactive PendingTarget
        // (real choice, count 0..1) rather than auto-resolving. The bug: the
        // raised choice dropped `excludeInstanceIds` (self) + `excludeTypes`
        // (nonland), so the client rendered — and `selectTarget` accepted —
        // Phelia/a land. Assert both filters now ride on the PendingTarget
        // (they plumb BOTH the client clickability mirror and the server gate).
        const p = makeInstance(phelia.id, {
            id: "pheliaX",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "landX",
            controllerId: "p1",
            ownerId: "p1",
        });
        const legal = makeInstance(balduvianBears.id, {
            id: "legalX",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, land] }),
                makePlayer("p2", { battlefield: [legal] }),
            ],
        });
        pheliaAttackTriggerOnStack(state, p);
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.excludeInstanceIds).toContain("pheliaX");
        expect(state.pendingTarget!.excludeTypes).toContain("Land");
    });

    it("does nothing when the controller declines (up to one)", () => {
        const p = makeInstance(phelia.id, {
            id: "phelia3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pheliaAttackTriggerOnStack(state, p);
        choosePheliaTarget(state, null);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "target3")
        ).toBeDefined();
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });
});

describe("Phelia — delayed-trigger controller/owner branch (issue #1320)", () => {
    function exileAndScheduleReturn(
        state: GameState,
        p: CardInstanceState,
        targetId: string
    ) {
        pheliaAttackTriggerOnStack(state, p);
        choosePheliaTarget(state, targetId);
        resolveTopOfStack(state);
    }

    it("puts a +1/+1 counter on Phelia when the returned permanent enters under YOUR control (owner === Phelia's controller)", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaA",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A permanent Phelia's controller (p1) both owns AND controls —
        // returns under p1's control, matching the caster.
        const own = makeInstance(balduvianBears.id, {
            id: "own1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, own] }),
                makePlayer("p2"),
            ],
        });
        exileAndScheduleReturn(state, p, "own1");
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);

        const returned = state.players[0].battlefield.find(
            (c) => c.id === "own1"
        );
        expect(returned).toBeDefined();
        expect(returned?.controllerId).toBe("p1");
        const pheliaAfter = state.players[0].battlefield.find(
            (c) => c.id === "pheliaA"
        )!;
        expect(pheliaAfter.counters).toEqual({ "+1/+1": 1 });

        // Wire format — the counter is board-visible.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "pheliaA"
        )!;
        expect(slim.counters).toEqual({ "+1/+1": 1 });
    });

    it("does NOT put a counter when the returned permanent enters under its OWNER's control, not yours (opponent's permanent)", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaB",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(balduvianBears.id, {
            id: "theirs1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        exileAndScheduleReturn(state, p, "theirs1");
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "theirs1"
        );
        expect(returned).toBeDefined();
        expect(returned?.controllerId).toBe("p2");
        const pheliaAfter = state.players[0].battlefield.find(
            (c) => c.id === "pheliaB"
        )!;
        expect(pheliaAfter.counters).toBeUndefined();
    });

    it("does NOT put a counter when the exiled permanent's controller differs from its owner — it returns under the OWNER, not the previous (Phelia's) controller", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaC",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Owned by p2, but currently CONTROLLED by p1 (Phelia's controller,
        // e.g. a stolen permanent) at the moment it's exiled. CR 800.4a — a
        // returned object enters under its OWNER's control, so it comes
        // back to p2, not p1, even though p1 controlled it going in.
        const stolen = makeInstance(balduvianBears.id, {
            id: "stolen1",
            controllerId: "p1",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, stolen] }),
                makePlayer("p2"),
            ],
        });
        exileAndScheduleReturn(state, p, "stolen1");
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "stolen1"
        );
        expect(returned).toBeDefined();
        expect(returned?.controllerId).toBe("p2"); // back to its OWNER
        const pheliaAfter = state.players[0].battlefield.find(
            (c) => c.id === "pheliaC"
        )!;
        expect(pheliaAfter.counters).toBeUndefined();
    });

    it("skips the counter placement cleanly when Phelia herself has left the battlefield before the trigger fires", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaD",
            controllerId: "p1",
            ownerId: "p1",
        });
        const own = makeInstance(balduvianBears.id, {
            id: "own2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, own] }),
                makePlayer("p2"),
            ],
        });
        exileAndScheduleReturn(state, p, "own2");
        // Phelia leaves the battlefield before the delayed trigger fires.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "pheliaD"
        );
        expect(() => {
            fireDelayedTriggers(state, "next-end-step");
            while (state.stack.length > 0) resolveTopOfStack(state);
        }).not.toThrow();
        const returned = state.players[0].battlefield.find(
            (c) => c.id === "own2"
        );
        expect(returned).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ocelot Pride — {W} 1/1 Cat (MH3, issue #1461). The integration test for four
// capability tickets shipped just before it: the `lifeGainedThisTurn` CR 603.4
// intervening-if (#1457), the `enteredThisTurn` card-filter clause (#1458),
// the `createTokenCopy` Op (#1459) and Ascend / the City's Blessing (#1460).
// ─────────────────────────────────────────────────────────────────────────────

const OCELOT_ID = ocelotPride.id;

const endStepEvent = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "END_STEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** p1's board: Ocelot Pride alone; p1's end step, turn 3. */
function ocelotSetup(): GameState {
    const ocelot = makeInstance(OCELOT_ID, {
        id: "ocelot",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        phase: "END_STEP",
        activePlayerId: "p1",
        turn: 3,
        players: [
            makePlayer("p1", { battlefield: [ocelot] }),
            makePlayer("p2"),
        ],
    });
}

/** Creates a REAL token on p1's battlefield (a synthesized token definition,
 *  exactly as `createToken` would), then re-stamps `enteredOnTurn` so the test
 *  can place it in this turn or a previous one. Real tokens (not hand-built
 *  instances) matter here: `createTokenCopy` copies the SOURCE's copiable
 *  characteristics off its card definition (CR 707.2). */
function makeBoardToken(
    state: GameState,
    name: string,
    enteredOnTurn: number
): CardInstanceState {
    const [id] = createTokenPermanents(
        state,
        {
            name,
            types: ["Creature"],
            subtypes: [name],
            power: 1,
            toughness: 1,
        },
        "p1"
    );
    const token = state.players[0].battlefield.find((c) => c.id === id)!;
    token.enteredOnTurn = enteredOnTurn;
    return token;
}

/** Puts Ocelot Pride's end-step trigger on the stack and resolves it. */
function resolveOcelotTrigger(state: GameState): void {
    const source = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "ocelot")!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "ocelot-pride-end-step",
        triggerSourceId: source.id,
        triggerEvent: endStepEvent(state.activePlayerId),
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Every non-Ocelot permanent p1 controls (i.e. the tokens on the board). */
const p1Tokens = (state: GameState) =>
    state.players[0].battlefield.filter((c) => c.id !== "ocelot");

const catTokens = (state: GameState) =>
    p1Tokens(state).filter((c) => c.subtypes?.includes("Cat"));

describe("Ocelot Pride — intervening-if 'if you gained life this turn' (CR 603.4)", () => {
    it("does not even trigger when no life was gained this turn", () => {
        const state = ocelotSetup();
        const triggers = collectTriggers(state, [
            endStepEvent("p1") as never,
        ]).filter((t) => t.triggeredAbilityId === "ocelot-pride-end-step");
        expect(triggers).toHaveLength(0);
    });

    it("triggers on YOUR end step once life was gained (CR 500.1 scope)", () => {
        const state = ocelotSetup();
        state.lifeGainedThisTurn = { p1: 3 };
        expect(
            collectTriggers(state, [endStepEvent("p1") as never]).filter(
                (t) => t.triggeredAbilityId === "ocelot-pride-end-step"
            )
        ).toHaveLength(1);
        // …but NOT on the opponent's end step ("your end step").
        expect(
            collectTriggers(state, [endStepEvent("p2") as never]).filter(
                (t) => t.triggeredAbilityId === "ocelot-pride-end-step"
            )
        ).toHaveLength(0);
    });

    it("fizzles on resolution if the life gain is gone by then (CR 603.4)", () => {
        const state = ocelotSetup();
        state.lifeGainedThisTurn = { p1: 2 };
        const source = state.players[0].battlefield[0];
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "ocelot-pride-end-step",
            triggerSourceId: source.id,
            triggerEvent: endStepEvent("p1"),
            targets: [],
        });
        // The tally is cleared while the trigger sits on the stack.
        state.lifeGainedThisTurn = {};
        resolveTopOfStack(state);
        expect(p1Tokens(state)).toHaveLength(0);
    });
});

describe("Ocelot Pride — no city's blessing: exactly one Cat token (CR 111.1)", () => {
    it("creates a single 1/1 white Cat and copies nothing", () => {
        const state = ocelotSetup();
        makeBoardToken(state, "Soldier", state.turn);
        state.lifeGainedThisTurn = { p1: 1 };
        resolveOcelotTrigger(state);
        const cats = catTokens(state);
        expect(cats).toHaveLength(1);
        expect(cats[0].isToken).toBe(true);
        expect(cats[0].power).toBe(1);
        expect(cats[0].toughness).toBe(1);
        // CR 110.5 — the token's colour is encoded as a synthetic mana cost on
        // the synthesized token definition.
        expect(getDefinition(cats[0].card.id as string).manaCost).toEqual({
            W: 1,
        });
        // The pre-existing token was NOT copied — the blessing gate is closed
        // (even though it DID enter this turn).
        expect(p1Tokens(state)).toHaveLength(2);

        // The Cat survives the wire projection (CR 111 — it is board-visible).
        const projected = projectPublicState(state, 1, "p1");
        const slimCats = projected.players[0].battlefield.filter(
            (c) => c.id !== "ocelot" && c.subtypes?.includes("Cat")
        );
        expect(slimCats).toHaveLength(1);
    });
});

describe("Ocelot Pride — with the city's blessing (CR 702.131b / 707.2)", () => {
    it("copies every token that entered this turn, INCLUDING the Cat just created", () => {
        // Board: one token that entered THIS turn (copied) and one that
        // entered a PREVIOUS turn (not copied — the #1458 clause reads the
        // real `enteredOnTurn` stamp against `state.turn`).
        const state = ocelotSetup();
        makeBoardToken(state, "Soldier", state.turn);
        makeBoardToken(state, "Goblin", state.turn - 2);
        state.lifeGainedThisTurn = { p1: 5 };
        grantCityBlessing(state, "p1");
        expect(hasCityBlessing(state, "p1")).toBe(true);

        resolveOcelotTrigger(state);

        // 2 pre-existing tokens + the new Cat + 2 copies (Cat + fresh-token).
        expect(p1Tokens(state)).toHaveLength(5);
        // Two Cats: the created one and its copy.
        expect(catTokens(state)).toHaveLength(2);
        // The stale (previous-turn) token was NOT copied — still exactly one.
        expect(
            p1Tokens(state).filter((c) => c.subtypes?.includes("Goblin"))
        ).toHaveLength(1);
        // The fresh token WAS copied — now two.
        expect(
            p1Tokens(state).filter((c) => c.subtypes?.includes("Soldier"))
        ).toHaveLength(2);
    });

    it("does NOT cascade: the copies the loop creates are not themselves copied (CR 608.2i)", () => {
        // The frozen-set property is the crux of this card. Every copy the
        // `forEach` body creates is ALSO "a token you control that entered
        // this turn", so a set re-selected per iteration would loop forever
        // (or at least double). `execForEach` selects its members ONCE at
        // construct entry and persists them, so the final count is exactly
        // `2 * (tokens that entered this turn, including the new Cat)`.
        const state = ocelotSetup();
        makeBoardToken(state, "Soldier", state.turn);
        makeBoardToken(state, "Goblin", state.turn);
        makeBoardToken(state, "Zombie", state.turn);
        state.lifeGainedThisTurn = { p1: 1 };
        grantCityBlessing(state, "p1");

        resolveOcelotTrigger(state);

        // Frozen set = { fresh-a, fresh-b, fresh-c, new Cat } = 4 members →
        // 4 copies. Total tokens = 3 pre-existing + 1 Cat + 4 copies = 8.
        // A cascading (re-selected) set would produce strictly more.
        expect(p1Tokens(state)).toHaveLength(8);
        expect(catTokens(state)).toHaveLength(2);
        // Every permanent p1 controls that is a token entered this turn — all
        // of them, since the copies are stamped on creation too.
        expect(
            p1Tokens(state).filter((c) => c.enteredOnTurn === state.turn)
        ).toHaveLength(8);
    });

    it("copies only YOUR tokens — an opponent's fresh token is untouched (CR 109.5)", () => {
        const state = ocelotSetup();
        createTokenPermanents(
            state,
            {
                name: "Soldier",
                types: ["Creature"],
                subtypes: ["Soldier"],
                power: 1,
                toughness: 1,
            },
            "p2"
        );
        state.lifeGainedThisTurn = { p1: 1 };
        grantCityBlessing(state, "p1");

        resolveOcelotTrigger(state);

        // Only the new Cat + its own copy on p1's side.
        expect(p1Tokens(state)).toHaveLength(2);
        expect(state.players[1].battlefield).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The "Then" ordering when the Cat token itself turns Ascend on.
//
// Ocelot Pride carries Ascend, so the Cat token created by the FIRST clause can
// be the tenth permanent that grants the blessing — and the SECOND clause ("Then
// if you have the city's blessing…") must already see it. Gatherer ruling:
// "If the creature token created by Ocelot Pride's last ability is your tenth
// permanent, you'll get the city's blessing before the ability would check to
// see if you have the city's blessing."
//
// CR 702.131b makes the permanent form of Ascend a STATIC ability ("any time you
// control ten or more permanents…"), true at all times (CR 604.1) — NOT a
// state-based action, which by CR 704.3 would only be checked at the next
// priority, i.e. after this ability has finished resolving. Evaluating Ascend
// only in the SBA sweep silently dropped the whole second clause here.
// ─────────────────────────────────────────────────────────────────────────────
describe("Ocelot Pride — the Cat token IS the tenth permanent (CR 702.131b / 604.1)", () => {
    /** Ocelot Pride + `count - 1` lands = `count` permanents for p1, no
     *  blessing yet. */
    function ocelotSetupWith(count: number): GameState {
        const state = ocelotSetup();
        for (let i = 0; i < count - 1; i++) {
            state.players[0].battlefield.push(
                makeInstance(forest.id, {
                    id: `bf-forest-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        state.lifeGainedThisTurn = { p1: 1 };
        return state;
    }

    it("grants the blessing mid-resolution, so the Cat gets copied", () => {
        const state = ocelotSetupWith(9);
        expect(hasCityBlessing(state, "p1")).toBe(false);

        resolveOcelotTrigger(state);

        expect(hasCityBlessing(state, "p1")).toBe(true);
        // The Cat is the tenth permanent → "Then" sees the blessing → the only
        // token that entered this turn (the Cat) is copied: 2 Cat tokens.
        expect(catTokens(state)).toHaveLength(2);
        // ...and nothing else was created (the lands are not tokens).
        expect(p1Tokens(state).filter((c) => c.isToken)).toHaveLength(2);
    });

    it("still does nothing extra when the Cat is only the NINTH permanent", () => {
        const state = ocelotSetupWith(8);

        resolveOcelotTrigger(state);

        expect(hasCityBlessing(state, "p1")).toBe(false);
        expect(catTokens(state)).toHaveLength(1);
    });

    it("survives the wire: the client sees both Cats and the designation", () => {
        const state = ocelotSetupWith(9);
        resolveOcelotTrigger(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.cityBlessingIds).toContain("p1");
        const slimCats = projected.players[0].battlefield.filter(
            (c) => c.id !== "ocelot" && c.subtypes?.includes("Cat")
        );
        expect(slimCats).toHaveLength(2);
    });
});
