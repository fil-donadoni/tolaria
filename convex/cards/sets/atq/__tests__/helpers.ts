// Shared test shims for the ATQ per-colour test files (ADR 0043 split):
// stack-push / resolve helpers, synthetic event builders, and vanilla bodies
// reused across the colour modules' describe blocks. Fixture builders
// (makeInstance/makePlayer/makeState/pushSpell) stay in
// convex/cards/__tests__/setup.ts.

import { expect } from "vitest";
import { titaniasSong, energyFlux } from "..";
import { solRing } from "../../lea";
import { makeInstance, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import type {
    CardType,
    BlockersConfirmedEvent,
    GameEvent,
} from "../../../types";

export function submitChoice(
    state: GameState,
    cardInstanceIds: string[]
): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

// --- helpers ---------------------------------------------------------------

/** Push an activated ability onto the stack with its cost assumed already
 *  paid (mirrors post-`activateAbility` state), then resolve it. */
export function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** A vanilla creature instance not backed by a registered definition — used as
 *  a generic blocker/attacker body in combat tests. */
export function vanilla(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        staticAbilities: [],
        power,
        toughness,
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

// ===========================================================================
// Value triggers & counter creatures (#276)
// ===========================================================================

/** Pushes a triggered ability onto the stack with the same shape
 *  `collectTriggers` builds (triggeredAbilityId + triggerEvent), then resolves
 *  it. For may-pay triggers that suspend, accepts the prompt by writing
 *  `collectedChoices` and re-invoking — mirroring the verified Soul Net /
 *  Ivory Cup flow in lea.test.ts. */
export function fireTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    mayPayAccept?: boolean
): void {
    const item: StackItem = {
        ...source,
        id: `trig-${triggeredAbilityId}`,
        castById: source.controllerId,
        zone: "stack",
        triggeredAbilityId,
        // The engine reads `ctx.sourceInstanceId` from `triggerSourceId`
        // (state.ts:resolveTopOfStack) — the source permanent on the
        // battlefield, not the synthetic stack-item id.
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    };
    state.stack.push(item);
    const first = resolveTopOfStack(state);
    if (mayPayAccept === undefined) return;
    // Suspended on a may-pay pending choice. Answer it and resume.
    expect(first).toBeNull();
    const pending = state.pendingChoices![0];
    const stackItem = state.stack.find((s) => s.id === pending.stackItemId)!;
    const key = `${pending.step}:${pending.choiceId}`;
    stackItem.collectedChoices = {
        [key]: [mayPayAccept ? "yes" : "no"],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

/** Builds a full BLOCKERS_CONFIRMED event (CR 509.1h). Only the subtype/id
 *  fields are scenario-relevant; the controller/type fields are filled with
 *  defaults so the literal satisfies the GameEvent union. */
export function blockEvent(
    attackerId: string,
    blockerId: string,
    blockerSubtypes: string[]
): BlockersConfirmedEvent {
    return {
        type: "BLOCKERS_CONFIRMED",
        attackerId,
        attackerControllerId: "p1",
        attackerTypes: ["Artifact", "Creature"],
        attackerSubtypes: ["Construct"],
        blockerId,
        blockerControllerId: "p2",
        blockerTypes: ["Creature"],
        blockerSubtypes,
    };
}

/** No mana substitutions active (no Sunglasses of Urza etc.). */
export function getManaSubstitutionsEmpty(): [] {
    return [];
}

// ---------------------------------------------------------------------------
// Cluster B — "ability activated" trigger event (issue #285)
// PERMANENT_TAPPED (CR 701.20a) + ABILITY_ACTIVATED (CR 602.1) punishers.
// ---------------------------------------------------------------------------

/** Synthetic ABILITY_ACTIVATED event over an artifact (CR 602.1). */
export function abilityActivatedEvent(overrides: {
    permanentId: string;
    controllerId: string;
    permanentTypes?: CardType[];
    abilityId?: string;
}): GameEvent {
    return {
        type: "ABILITY_ACTIVATED" as const,
        permanentId: overrides.permanentId,
        controllerId: overrides.controllerId,
        permanentTypes:
            overrides.permanentTypes ?? (["Artifact"] as CardType[]),
        permanentSubtypes: [],
        abilityId: overrides.abilityId ?? "some-ability",
    };
}

/** Synthetic PERMANENT_TAPPED event over an artifact (CR 701.20a). */
export function artifactTappedEvent(overrides: {
    permanentId: string;
    controllerId: string;
    permanentTypes?: CardType[];
}): GameEvent {
    return {
        type: "PERMANENT_TAPPED" as const,
        permanentId: overrides.permanentId,
        controllerId: overrides.controllerId,
        permanentTypes:
            overrides.permanentTypes ?? (["Artifact"] as CardType[]),
        permanentSubtypes: [],
        forMana: false,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cluster F — animate noncreature artifact (#288)
// ─────────────────────────────────────────────────────────────────────────────

/** Puts Titania's Song on `p1`'s battlefield and a Sol Ring artifact on the
 *  given controller's battlefield, then applies the Song's continuous effects
 *  to the board (mirrors `finalizeSpellResolution`). Returns both instances. */
export function withTitaniasSong(controller: "p1" | "p2" = "p1"): {
    state: GameState;
    song: CardInstanceState;
    ring: CardInstanceState;
} {
    const state = makeState();
    const song = makeInstance(titaniasSong.id, {
        id: "song-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const ring = makeInstance(solRing.id, {
        id: "ring-1",
        controllerId: controller,
        zone: "battlefield",
    });
    state.players[0].battlefield.push(song);
    state.players[controller === "p1" ? 0 : 1].battlefield.push(ring);
    applySourceStaticEffects(state, song);
    return { state, song, ring };
}

// ─────────────────────────────────────────────────────────────────────────────
// Choose-body-on-entry creatures (cluster G, #289). New engine capability:
// `option-pick` PendingChoice (ctx.requestOptionChoice) + persistent
// ctx.setSelfBody. Driven through the same resolveSteps suspend/replay path as
// Vesuvan Doppelganger, and committed through applyPendingChoiceSubmit (the
// `selectResolutionChoice` backend mutation entry point) for the integration
// layer.
// ─────────────────────────────────────────────────────────────────────────────

export const UPKEEP_P1 = {
    type: "PHASE_BEGIN" as const,
    phase: "UPKEEP" as const,
    activePlayerId: "p1",
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster N (#291) — grant a triggered ability to a filtered set. Energy Flux:
// "All artifacts have 'At the beginning of your upkeep, sacrifice this artifact
// unless you pay {2}.'" CR 113.1 (granted ability) + CR 611 (continuous
// filtered set) + CR 603.6a (your-upkeep trigger) + CR 118 (mana payment).
// ─────────────────────────────────────────────────────────────────────────────

/** Puts Energy Flux on `p1`'s battlefield and a Sol Ring (an Artifact) on the
 *  given controller's battlefield, then applies the grant to the board
 *  (mirrors `finalizeSpellResolution`). Returns both instances. */
export function withEnergyFlux(controller: "p1" | "p2" = "p1"): {
    state: GameState;
    flux: CardInstanceState;
    ring: CardInstanceState;
} {
    const state = makeState();
    const flux = makeInstance(energyFlux.id, {
        id: "flux-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const ring = makeInstance(solRing.id, {
        id: "ring-1",
        controllerId: controller,
        zone: "battlefield",
    });
    state.players[0].battlefield.push(flux);
    state.players[controller === "p1" ? 0 : 1].battlefield.push(ring);
    applySourceStaticEffects(state, flux);
    return { state, flux, ring };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cluster O — minor isolated extensions (#292)
// ─────────────────────────────────────────────────────────────────────────────

/** Fires an enteredTrigger by pushing a synthetic PERMANENT_ENTERED stack item
 *  (mirrors `collectTriggers` + `buildTriggerItem`) and resolving it. */
export function fireEntered(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string
): void {
    fireTrigger(state, source, triggeredAbilityId, {
        type: "PERMANENT_ENTERED",
        instanceId: source.id,
        controllerId: source.controllerId,
        types: source.types,
    });
}
