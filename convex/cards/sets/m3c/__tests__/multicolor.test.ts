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
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { registerTokenDefinition, getDefinition } from "../../../index";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import {
    raiseTriggerTargetSelection,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";

const satyaAetherfluxGenius = getDefinition(
    "3b964bbe-54cc-425c-9cc6-c877f82af7ba"
);

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

// ─────────────────────────────────────────────────────────────────────────────
// Bloodbraid Challenger (issue #3216) — the first CASCADE card (CR 702.85).
// This is the FULL-PATH test the per-Op interpreter suite cannot give: the
// keyword string on a real catalogue card, expanded at the `getDefinition`
// seam, collected off the stack at the real cast choke point
// (`emitSpellCastEvent` → `collectSelfCastTriggers`), resolved above its own
// spell, and landing a free spell on the stack.
const bloodbraidChallenger = getDefinition(
    "fbca967e-578f-4b05-b697-2e2ee1a40dfb"
);

const BBC_CHEAP_ID = "test-bbc-cheap";
registerTokenDefinition({
    id: BBC_CHEAP_ID,
    name: BBC_CHEAP_ID,
    rarity: "common",
    manaCost: { X: 2 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 }],
});
const BBC_LAND_ID = "test-bbc-land";
registerTokenDefinition({
    id: BBC_LAND_ID,
    name: BBC_LAND_ID,
    rarity: "common",
    types: ["Land"],
});

describe("Bloodbraid Challenger — Cascade (CR 702.85), Haste (CR 702.10), Escape (CR 702.138)", () => {
    function libraryCard(cardId: string, id: string): CardInstanceState {
        return makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
    }

    it("declares cascade and haste as keyword strings and escape as data — no imperative body (ADR 0045)", () => {
        expect(bloodbraidChallenger.staticAbilities).toContain("cascade");
        expect(bloodbraidChallenger.staticAbilities).toContain("haste");
        expect(bloodbraidChallenger.escape).toEqual({
            mana: { X: 3, R: 1, G: 1 },
            exile: { count: 3 },
        });
        expect(bloodbraidChallenger.resolve).toBeUndefined();
        expect(bloodbraidChallenger.effects).toBeUndefined();
    });

    it("the keyword string is expanded into ONE CR 702.85a cast trigger whose whole body is the `cascade` Op (ADR 0054)", () => {
        const triggers = (bloodbraidChallenger.triggeredAbilities ?? []).filter(
            (t) => t.id === "cascade"
        );
        expect(triggers).toHaveLength(1);
        expect(triggers[0].event).toBe("SPELL_CAST");
        // CR 702.85a — "functions only while the spell with cascade is on the
        // stack": the marker is what makes `collectSelfCastTriggers` see it.
        expect(triggers[0].functionsFromStack).toBe(true);
        expect(triggers[0].effects).toEqual([
            { op: "cascade", player: "controller" },
        ]);
    });

    it("casting it puts the cascade trigger ABOVE the spell, and resolving that trigger exiles down to the first cheaper nonland card and offers it FREE (CR 603.3b / 702.85a)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        libraryCard(BBC_LAND_ID, "bbcLand"),
                        libraryCard(BBC_CHEAP_ID, "bbcHit"),
                        libraryCard(BBC_LAND_ID, "bbcRest"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(
            state,
            "fbca967e-578f-4b05-b697-2e2ee1a40dfb",
            "p1"
        );
        emitSpellCastEvent(state, spell);
        processPendingActionTriggers(state);
        // The trigger sits ABOVE its own spell — the free spell therefore
        // resolves BEFORE the creature that cascaded.
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(spell.id);
        expect(state.stack[1].triggeredAbilityId).toBe("cascade");
        expect(state.stack[1].triggerSourceId).toBe(spell.id);

        // Resolve the trigger: mana value 5, so the walk stops on the mana
        // value 2 sorcery, skipping the land above it.
        resolveTopOfStack(state);
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "bbcHit",
            "bbcLand",
        ]);
        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        // The free spell is on top of the cascading creature (CR 608.2f), with
        // NO mana spent — the fixture has an empty pool.
        expect(state.stack.map((s) => s.id)).toEqual([spell.id, "bbcHit"]);
        // The rest went back to the bottom, under the untouched card.
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "bbcRest",
            "bbcLand",
        ]);
    });

    it("CR 702.85c — a spell with TWO instances of cascade triggers twice, as two distinct stack objects", () => {
        const TWICE_ID = "test-bbc-double-cascade";
        registerTokenDefinition({
            id: TWICE_ID,
            name: TWICE_ID,
            rarity: "rare",
            manaCost: { X: 5 },
            types: ["Creature"],
            subtypes: ["Elf"],
            power: 1,
            toughness: 1,
            staticAbilities: ["cascade", "cascade"],
        });
        const def = getDefinition(TWICE_ID);
        const ids = (def.triggeredAbilities ?? []).map((t) => t.id);
        expect(ids).toEqual(["cascade", "cascade-2"]);
    });
});
