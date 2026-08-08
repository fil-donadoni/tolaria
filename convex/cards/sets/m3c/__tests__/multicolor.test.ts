// M3C multicolor — per-colour card behavior tests (ADR 0043 parallel test
// file). Satya, Aetherflux Genius (issue #1195) is a hand-written per-card
// test even though its effect is a DSL `effects[]` script: the auto-generated
// canned-scenario smoke test (`effectScriptSmoke.test.ts`) explicitly skips
// any script containing a `mayPay` Op (it always suspends for a live
// Pay/Skip decision it cannot answer), so this card is NOT covered by the
// catalogue-wide sweep — the "explicit skip, never silent pass" signal that
// calls for this file (`.claude/rules/gre-development.md` § DSL-first
// authoring).
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import { registerTokenDefinition, getDefinition } from "../../../index";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    raiseTriggerTargetSelection,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { satyaAetherfluxGenius } from "../multicolor";

// A nontoken {2}{G} (mana value 3) creature Satya's controller ALSO
// controls — the copy target. A non-trivial mana value distinct from the
// unconditional {E}{E} grant, so the mayPay-{E}-equal-to-mana-value amount
// (3) is never confusable with the flat attack-trigger grant (2).
const OTHER_CREATURE_ID = "test-satya-other-creature";
registerTokenDefinition({
    id: OTHER_CREATURE_ID,
    name: OTHER_CREATURE_ID,
    rarity: "common",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

function satyaAttackTriggerOnStack(
    state: GameState,
    satya: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...satya,
        id: "satya-attack-trig",
        zone: "stack",
        castById: satya.controllerId,
        triggeredAbilityId: "satya-aetherflux-genius-attack",
        triggerSourceId: satya.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: satya.controllerId,
            attackerIds: [satya.id],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives Satya's CR 603.3d "up to one" target choice through the real
 *  machinery (mirrors Phelia's `choosePheliaTarget`, mh3/__tests__/white.test.ts). */
function chooseSatyaTarget(state: GameState, targetId: string | null) {
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

describe("Satya, Aetherflux Genius — definition", () => {
    it("is registered by id", () => {
        expect(getDefinition(satyaAetherfluxGenius.id)).toBe(
            satyaAetherfluxGenius
        );
    });
});

describe("Satya — attack trigger targeting (CR 601.2c / 603.3d)", () => {
    it("excludes Satya herself (other), an opponent's creature (you control), and a token creature (nontoken) from the legal set", () => {
        const satya = makeInstance(satyaAetherfluxGenius.id, {
            id: "satya1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const own = makeInstance(OTHER_CREATURE_ID, {
            id: "own1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ownToken = makeInstance(OTHER_CREATURE_ID, {
            id: "ownToken1",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const theirs = makeInstance(OTHER_CREATURE_ID, {
            id: "theirs1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [satya, own, ownToken] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        // `excludeSource` is a DIRECTIVE `raiseTriggerTargetSelection`
        // resolves into `excludeInstanceIds` using the firing trigger's OWN
        // source id (`item.triggerSourceId`) — it is never itself checked
        // against a candidate by `getLegalTargets` (see `StructuralKey` in
        // `gre/targetFilters.ts`). Replicate that one-line resolution here to
        // exercise `getLegalTargets` directly against the fully-resolved
        // requirement, exactly as `raiseTriggerTargetSelection` would build it.
        const req = {
            ...satyaAetherfluxGenius.triggeredAbilities![0].targetRequirement!,
            excludeInstanceIds: ["satya1"],
        };
        const legal = getLegalTargets(
            state,
            req,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toEqual(["own1"]);
    });
});

describe("Satya — attack trigger resolution (CR 508.4 copy + CR 122.1 energy + CR 603.7 delayed sacrifice-or-pay)", () => {
    it("creates a TAPPED and ATTACKING copy of the chosen creature, joins the current combat, and grants {E}{E}", () => {
        const satya = makeInstance(satyaAetherfluxGenius.id, {
            id: "satyaAtk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = makeInstance(OTHER_CREATURE_ID, {
            id: "otherAtk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [satya, other] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["satyaAtk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        satyaAttackTriggerOnStack(state, satya);
        chooseSatyaTarget(state, "otherAtk");
        expect(resolveTopOfStack(state)).not.toBeNull();

        // Two permanents now share OTHER_CREATURE_ID's characteristics: the
        // original and the new tapped-and-attacking copy.
        const copy = state.players[0].battlefield.find(
            (c) => c.id !== "satyaAtk" && c.id !== "otherAtk"
        )!;
        expect(copy).toBeDefined();
        expect(copy.isToken).toBe(true);
        expect(copy.card.id).toBe(OTHER_CREATURE_ID);
        expect(copy.isTapped).toBe(true);
        // CR 508.4 — joined the CURRENT combat directly.
        expect(state.combat!.attackerIds).toEqual(["satyaAtk", copy.id]);
        // BLOCKING review finding (issue #1195, fix 1) — the token must be
        // attacking by BOTH engine representations: `combat.attackerIds`
        // membership (asserted above) AND the per-permanent `isAttacking`
        // flag, kept in sync by the shared `markAttacking` helper
        // (`gre/combat.ts`). Before that fix, this path only set the former,
        // leaving the token invisible to every `isAttacking`-keyed read
        // (layer statics, `combatRoleFilter` targeting,
        // `PermanentFilter.isAttacking`, `SpellContext.getIsAttacking`, and
        // — see the wire assertion below — the frontend's
        // blocker-assignment affordance).
        expect(copy.isAttacking).toBe(true);
        // Unconditional {E}{E} (CR 122.1).
        expect(state.players[0].energyCounters).toBe(2);
        // CR 603.7 — the delayed sacrifice-or-pay is scheduled.
        expect(state.delayedTriggers?.length).toBe(1);

        // Wire format — tap state, combat membership, isAttacking, and energy
        // are all board-visible. `isAttacking` specifically is what the
        // frontend's blocker-assignment click gate
        // (`useBattlefieldInteraction.tsx:514`) and combat-ring/offset
        // visual state (`useBattlefieldVisualState.ts`) read — a dropped flag
        // here is a silently unblockable attacker in the UI (issue #1195
        // review, fix 2).
        const projected = projectPublicState(state, 1, "p1");
        const slimCopy = projected.players[0].battlefield.find(
            (c) => c.id === copy.id
        )!;
        expect(slimCopy.isTapped).toBe(true);
        expect(slimCopy.isAttacking).toBe(true);
        expect(projected.combat!.attackerIds).toContain(copy.id);
        expect(projected.players[0].energyCounters).toBe(2);
    });

    it("declining the 'up to one' pick still grants {E}{E}, but schedules NO delayed trigger (no phantom sacrifice-that-token prompt)", () => {
        const satya = makeInstance(satyaAetherfluxGenius.id, {
            id: "satyaDecline",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = makeInstance(OTHER_CREATURE_ID, {
            id: "otherDecline",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [satya, other] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["satyaDecline"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        satyaAttackTriggerOnStack(state, satya);
        chooseSatyaTarget(state, null); // declines the up-to-one pick
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(state.players[0].battlefield).toHaveLength(2); // no copy made
        expect(state.players[0].energyCounters).toBe(2); // unconditional
        expect(state.delayedTriggers ?? []).toHaveLength(0);
        expect(state.combat!.attackerIds).toEqual(["satyaDecline"]);
    });

    it("with NO legal nontoken creature to copy, still grants {E}{E} and resolves as a no-op copy (CR 603.3c 'up to' with none legal)", () => {
        const satya = makeInstance(satyaAetherfluxGenius.id, {
            id: "satyaAlone",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [satya] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["satyaAlone"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const trig = satyaAttackTriggerOnStack(state, satya);
        // No legal candidate (only Satya herself, excluded by `excludeSource`)
        // — the engine locks an empty target set, no PendingTarget raised.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[0].energyCounters).toBe(2);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });
});

describe("Satya — delayed sacrifice-or-pay {E} equal to the token's mana value (CR 603.7 / 122.1 / 118.4)", () => {
    function attackAndCopy(state: GameState, satyaId: string, otherId: string) {
        const satya = state.players[0].battlefield.find(
            (c) => c.id === satyaId
        )!;
        satyaAttackTriggerOnStack(state, satya);
        chooseSatyaTarget(state, otherId);
        resolveTopOfStack(state);
        return state.players[0].battlefield.find(
            (c) => c.id !== satyaId && c.id !== otherId
        )!;
    }

    it("PAY: keeps the token, deducting {E} equal to its mana value (3)", () => {
        const satya = makeInstance(satyaAetherfluxGenius.id, {
            id: "satyaPay",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = makeInstance(OTHER_CREATURE_ID, {
            id: "otherPay",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                // Starts with 1 energy so paying the {E}{E}{E} (mana value 3)
                // cost after the attack trigger's unconditional {E}{E} (1+2=3)
                // is exactly affordable — proves the amount is really READ
                // from the copy's mana value, not a fixed literal.
                makePlayer("p1", {
                    battlefield: [satya, other],
                    energyCounters: 1,
                }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["satyaPay"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const copy = attackAndCopy(state, "satyaPay", "otherPay");
        expect(state.players[0].energyCounters).toBe(3); // 1 + the attack trigger's {E}{E}

        fireDelayedTriggers(state, "next-end-step");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.cost).toEqual({ energy: 3 }); // OTHER_CREATURE_ID's mana value
        // Wire format — the dynamically-derived cost survives the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0].cost).toEqual({ energy: 3 });

        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].energyCounters).toBe(0); // 3 - 3
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            copy.id
        );
    });

    it("DECLINE: sacrifices the token (a TOKEN ceases to exist, CR 704.5d), energy unspent", () => {
        const satya = makeInstance(satyaAetherfluxGenius.id, {
            id: "satyaDecline2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = makeInstance(OTHER_CREATURE_ID, {
            id: "otherDecline2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [satya, other] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["satyaDecline2"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const copy = attackAndCopy(state, "satyaDecline2", "otherDecline2");

        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(state.players[0].energyCounters).toBe(2); // unspent
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            copy.id
        );
    });
});
