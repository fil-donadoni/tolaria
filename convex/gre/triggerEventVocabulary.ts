// The EVENT a triggered ability fired on, in the scenario spec's vocabulary
// (issue #3516, PRD #3397, ADR 0127).
//
// WHY A TRIGGER NEEDS ONE AT ALL. `placeTriggersOnStack` always stamps
// `triggerEvent` on the item it builds (`gre/triggers.ts`), and the resolution
// path READS it: the branch that resolves a triggered ability is guarded by
// `top.triggerEvent` at all (`gre/state.ts`), CR 603.4's intervening-if is
// re-checked against it, an imperative `resolve(ctx, event)` takes it as its
// second argument, and every `$event.<field>` ref in an Effect Script flattens
// one of its fields through `EVENT_FIELD_REGISTRY` (ADR 0049). So a trigger
// declared WITHOUT its event does not merely lose decoration — it resolves to
// a different board, or does not resolve at all.
//
// WHAT IS NAMEABLE. An event is a flat record of three things: plain values
// (an amount, a phase, a type line), PLAYER ids, and OBJECT ids. The first
// travel verbatim; the second become seats; the third become the spec's own
// name-and-seat references, because every rebuild reassigns instance ids. The
// table below classifies EVERY field of EVERY `GameEvent` member — the mapped
// type makes a field added to an event a `tsc` error here rather than a fact
// that silently rides as residue.
//
// FAIL-CLOSED. A field whose value the spec cannot name (an object that is in
// no zone the spec describes — a token that has ceased to exist, a card in a
// library) is reported by NAME, and the call site withholds the whole stack:
// the same rule `lowerStack` already applies to an announcement it cannot
// carry.

import type { GameEvent, TargetSelection } from "../cards/types";
import type {
    ScenarioObjectRef,
    ScenarioStackTarget,
    ScenarioTriggerEvent,
    ScenarioEventValue,
} from "../debugScenarioSpec";

/** How one field of one event type travels into the spec.
 *
 *  - `scalar` — a value with no identity in it (a number, a boolean, a phase,
 *    a card definition id, a type line): copied verbatim.
 *  - `player` — a `PlayerState.id`: lowered to a seat.
 *  - `object` / `objectList` — a `CardInstanceState.id` (or a list of them):
 *    lowered to a name-and-seat reference.
 *  - `target` — a `TargetSelection`: lowered through the same four shapes an
 *    announced target uses.
 *  - `residue` — a shape this vocabulary does not express. Always a refusal
 *    when the field is present. */
export type EventFieldKind =
    | "scalar"
    | "player"
    | "object"
    | "objectList"
    | "target"
    | "residue";

/** Every field of ONE event member, classified. `-?` so an OPTIONAL field must
 *  be classified too: a field absent from this table is the one thing the
 *  walk below cannot judge. */
type EventFieldKinds<T extends GameEvent["type"]> = {
    [K in Exclude<
        keyof Extract<GameEvent, { type: T }>,
        "type"
    >]-?: EventFieldKind;
};

/**
 * `(event type, field) → how it travels`. Exhaustive over the `GameEvent`
 * union in BOTH directions: a new member needs a row, a new field on a member
 * needs a cell, and `tsc` reds on either.
 */
export const EVENT_FIELD_KINDS: {
    [T in GameEvent["type"]]: EventFieldKinds<T>;
} = {
    // CR 119.3 / 120.3 — damage dealt. The source may be a permanent, a spell
    // already in a graveyard, or an object that has ceased to exist; the walk
    // refuses the last case rather than guessing.
    DAMAGE_DEALT: {
        sourceInstanceId: "object",
        sourceControllerId: "player",
        target: "target",
        amount: "scalar",
        isCombat: "scalar",
        sourceColors: "scalar",
        sourceTypes: "scalar",
        sourceSubtypes: "scalar",
        sourceStaticAbilities: "scalar",
    },
    // CR 500.1 — a step or phase began.
    PHASE_BEGIN: { phase: "scalar", activePlayerId: "player" },
    // CR 603.10 — the dying creature's last known information. The creature
    // itself is in its owner's graveyard for a card, and NOWHERE for a token
    // (CR 111.7), which is a refusal.
    CREATURE_DIED: {
        creatureInstanceId: "object",
        creatureControllerId: "player",
        creatureOwnerId: "player",
        creatureTypes: "scalar",
        damagedBySources: "objectList",
        creaturePower: "scalar",
        creatureToughness: "scalar",
        combatPartnerIds: "objectList",
    },
    // CR 603.6a — a permanent entered.
    PERMANENT_ENTERED: {
        instanceId: "object",
        controllerId: "player",
        cardId: "scalar",
        types: "scalar",
        wasCast: "scalar",
        wasPlayed: "scalar",
        enteredFromGraveyard: "scalar",
        power: "scalar",
        toughness: "scalar",
        isToken: "scalar",
    },
    // CR 603.6c / 603.10 — a permanent left the battlefield.
    PERMANENT_LEFT: {
        instanceId: "object",
        controllerId: "player",
        ownerId: "player",
        cardId: "scalar",
        types: "scalar",
        subtypes: "scalar",
        wasAura: "scalar",
        attachedToBeforeLeave: "object",
        attachmentsBeforeLeave: "objectList",
        toZone: "scalar",
        cause: "scalar",
        causerControllerId: "player",
    },
    // CR 601.2i — a spell was cast. Its instance is on the stack while the
    // trigger is, so the reference is a stack index.
    SPELL_CAST: {
        casterId: "player",
        spellInstanceId: "object",
        spellCardId: "scalar",
        spellTypes: "scalar",
        spellSubtypes: "scalar",
        spellColors: "scalar",
        priorSpellCount: "scalar",
        casterSpellCountThisTurn: "scalar",
    },
    // CR 702.33d — a Kicker was paid.
    SPELL_KICKED: {
        casterId: "player",
        spellInstanceId: "object",
        spellCardId: "scalar",
        kickerId: "scalar",
        spellTypes: "scalar",
        spellSubtypes: "scalar",
        spellColors: "scalar",
    },
    // CR 701.20a — a permanent became tapped. `manaProduced` is a `ManaCost`,
    // plain data with no identity in it.
    PERMANENT_TAPPED: {
        permanentId: "object",
        controllerId: "player",
        permanentTypes: "scalar",
        permanentSubtypes: "scalar",
        forMana: "scalar",
        manaProduced: "scalar",
        manaTriggersResolved: "scalar",
    },
    PERMANENT_UNTAPPED: {
        permanentId: "object",
        controllerId: "player",
        permanentTypes: "scalar",
        permanentSubtypes: "scalar",
    },
    PERMANENT_EXERTED: {
        permanentId: "object",
        controllerId: "player",
        permanentTypes: "scalar",
        permanentSubtypes: "scalar",
        asAttacks: "scalar",
    },
    // CR 602.2 — an ability was activated. `abilityId` is a definition-level
    // id, not an instance one.
    ABILITY_ACTIVATED: {
        permanentId: "object",
        controllerId: "player",
        permanentTypes: "scalar",
        permanentSubtypes: "scalar",
        abilityId: "scalar",
    },
    // CR 603.8 — the state-trigger sweep carries no payload at all.
    STATE_CHECK: {},
    // CR 603.4 — an intervening-if came back false.
    TRIGGER_FIZZLED: {
        triggerSourceId: "object",
        triggeredAbilityId: "scalar",
        reason: "scalar",
    },
    // CR 508.1 — the whole declaration as one event.
    ATTACKERS_DECLARED: {
        attackingPlayerId: "player",
        attackerIds: "objectList",
    },
    // CR 509.1h — one attacker/blocker pair.
    BLOCKERS_CONFIRMED: {
        attackerId: "object",
        attackerControllerId: "player",
        attackerTypes: "scalar",
        attackerSubtypes: "scalar",
        attackerToughness: "scalar",
        attackerColors: "scalar",
        blockerId: "object",
        blockerControllerId: "player",
        blockerTypes: "scalar",
        blockerSubtypes: "scalar",
        blockerToughness: "scalar",
        blockerColors: "scalar",
    },
    ATTACKER_UNBLOCKED: {
        attackerId: "object",
        attackerControllerId: "player",
        attackerTypes: "scalar",
        attackerSubtypes: "scalar",
    },
    // CR 121.1 — cards drawn. No card identity rides the event.
    CARD_DRAWN: {
        playerId: "player",
        count: "scalar",
        drawIndexThisTurn: "scalar",
        isTurnBasedDrawStepDraw: "scalar",
    },
    // CR 701.9a — the discarded card is in its owner's graveyard.
    CARD_DISCARDED: {
        playerId: "player",
        cardInstanceId: "object",
        cardId: "scalar",
        cause: "scalar",
    },
    CARD_MILLED: {
        ownerId: "player",
        cardInstanceId: "object",
        cardId: "scalar",
        types: "scalar",
    },
    CARD_PUT_INTO_GRAVEYARD: {
        ownerId: "player",
        cardInstanceId: "object",
        cardId: "scalar",
        fromZone: "scalar",
        types: "scalar",
    },
    LIFE_LOST: { playerId: "player", amount: "scalar", fromDamage: "scalar" },
    LIFE_GAINED: { playerId: "player", amount: "scalar" },
    COUNTER_REMOVED: {
        instanceId: "object",
        controllerId: "player",
        counterType: "scalar",
        removed: "scalar",
        remaining: "scalar",
    },
    COUNTER_ADDED: {
        instanceId: "object",
        controllerId: "player",
        counterType: "scalar",
        added: "scalar",
        total: "scalar",
        types: "scalar",
        subtypes: "scalar",
    },
    LEVEL_GAINED: {
        instanceId: "object",
        controllerId: "player",
        level: "scalar",
        previousLevel: "scalar",
        types: "scalar",
        subtypes: "scalar",
    },
    // CR 115.7 / 702.21a — something became a target.
    BECAME_TARGET: {
        target: "target",
        sourceKind: "scalar",
        targetControllerId: "player",
        sourceControllerId: "player",
        sourceInstanceId: "object",
    },
    // CR 111.1 — tokens created. The event counts them; it names none.
    TOKENS_CREATED: {
        controllerId: "player",
        count: "scalar",
        types: "scalar",
        subtypes: "scalar",
    },
    // CR 701.19a — a batch of exiled cards, each with its own origin zone.
    // A nested array of object ids is a shape this vocabulary does not carry:
    // refused rather than approximated.
    CARDS_EXILED: { cards: "residue" },
    LIBRARY_SEARCHED: { playerId: "player", libraryOwnerId: "player" },
};

/** What the lowering needs from its caller to name the ids in an event: the
 *  spec's own resolvers, which live where the cards were placed. Each returns
 *  `undefined` for "this vocabulary cannot name it", which is a refusal. */
export type TriggerEventLoweringPorts = {
    object: (instanceId: string) => ScenarioObjectRef | undefined;
    player: (playerId: string) => "me" | "opp" | undefined;
    target: (target: TargetSelection) => ScenarioStackTarget | undefined;
};

/** `{ ok: true }` with the lowered event, or the FIELD NAMES that blocked it —
 *  one per field, because "which field costs the most verdicts" is the number
 *  a sweep is counting. */
export type TriggerEventLowering =
    | { ok: true; event: ScenarioTriggerEvent }
    | { ok: false; fields: string[] };

/** CR 603.2 — one firing event, lowered. */
export function lowerTriggerEvent(
    event: GameEvent,
    ports: TriggerEventLoweringPorts
): TriggerEventLowering {
    const kinds = EVENT_FIELD_KINDS[event.type] as
        | Record<string, EventFieldKind>
        | undefined;
    if (!kinds) return { ok: false, fields: ["type"] };
    const fields: Record<string, ScenarioEventValue> = {};
    const blocked: string[] = [];
    const record = event as unknown as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
        if (key === "type") continue;
        const value = record[key];
        if (value === undefined) continue;
        const kind = kinds[key];
        if (!kind || kind === "residue") {
            blocked.push(key);
            continue;
        }
        if (kind === "scalar") {
            fields[key] = { kind: "scalar", value: value as never };
            continue;
        }
        if (kind === "player") {
            const seat = ports.player(String(value));
            if (!seat) blocked.push(key);
            else fields[key] = { kind: "player", seat };
            continue;
        }
        if (kind === "object") {
            const ref = ports.object(String(value));
            if (!ref) blocked.push(key);
            else fields[key] = { kind: "object", ref };
            continue;
        }
        if (kind === "objectList") {
            const ids = Array.isArray(value) ? (value as string[]) : [];
            const refs: ScenarioObjectRef[] = [];
            let lost = false;
            for (const id of ids) {
                const ref = ports.object(String(id));
                if (!ref) {
                    lost = true;
                    break;
                }
                refs.push(ref);
            }
            if (lost) blocked.push(key);
            else fields[key] = { kind: "objects", refs };
            continue;
        }
        const lowered = ports.target(value as TargetSelection);
        if (!lowered) blocked.push(key);
        else fields[key] = { kind: "target", target: lowered };
    }
    if (blocked.length > 0) return { ok: false, fields: blocked };
    return {
        ok: true,
        event: {
            type: event.type,
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
        },
    };
}

/** The inverse ports: the rebuild resolves a reference against the board it
 *  has just placed. A reference that resolves to nothing is a THROW at the
 *  call site, never a silently different event — the same rule
 *  `seedDeclaredStack` applies to a name it cannot find. */
export type TriggerEventRebuildPorts = {
    object: (ref: ScenarioObjectRef) => string;
    player: (seat: "me" | "opp") => string;
    target: (target: ScenarioStackTarget) => TargetSelection;
};

/** CR 603.2 — one declared event, rebuilt into the shape the resolution reads.
 *  The result is a `GameEvent` by construction of the table above: every field
 *  it can carry is a field of that member. */
export function rebuildTriggerEvent(
    declared: ScenarioTriggerEvent,
    ports: TriggerEventRebuildPorts
): GameEvent {
    const out: Record<string, unknown> = { type: declared.type };
    for (const [key, value] of Object.entries(declared.fields ?? {})) {
        switch (value.kind) {
            case "scalar":
                out[key] = value.value;
                break;
            case "player":
                out[key] = ports.player(value.seat);
                break;
            case "object":
                out[key] = ports.object(value.ref);
                break;
            case "objects":
                out[key] = value.refs.map((ref) => ports.object(ref));
                break;
            case "target":
                out[key] = ports.target(value.target);
                break;
        }
    }
    return out as unknown as GameEvent;
}

/** How a live event RENDERS for the rebuild check (`stackFingerprint`): the
 *  type plus every field, ids replaced by what can be OBSERVED about the
 *  object or player they name. Sorted, so two events differing only in key
 *  order render alike. */
export type TriggerEventFingerprintPorts = {
    object: (instanceId: string) => string;
    player: (playerId: string) => string;
    target: (target: TargetSelection) => string;
};

/** The label `stackFingerprint` embeds for a trigger's firing event. */
export function triggerEventFingerprint(
    event: GameEvent,
    ports: TriggerEventFingerprintPorts
): string {
    const kinds = EVENT_FIELD_KINDS[event.type] as
        | Record<string, EventFieldKind>
        | undefined;
    const record = event as unknown as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
        if (key === "type") continue;
        const value = record[key];
        if (value === undefined) continue;
        const kind = kinds?.[key];
        if (kind === "player") {
            parts.push(`${key}=${ports.player(String(value))}`);
        } else if (kind === "object") {
            parts.push(`${key}=${ports.object(String(value))}`);
        } else if (kind === "objectList") {
            const ids = Array.isArray(value) ? (value as string[]) : [];
            parts.push(
                `${key}=[${ids.map((id) => ports.object(id)).join(",")}]`
            );
        } else if (kind === "target") {
            parts.push(`${key}=${ports.target(value as TargetSelection)}`);
        } else {
            parts.push(`${key}=${JSON.stringify(value)}`);
        }
    }
    return `${event.type}(${parts.join(" ")})`;
}
