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
//
// …WHERE IT GUARDS SOMETHING (issue #9868). The refusal exists for the readers
// named above. An ability with none of them — a pure Effect Script holding no
// `$event` read, no intervening-if, no imperative body — resolves to the same
// board whatever its event carries, so withholding the stack over a field it
// cannot read only loses a position the rebuild would have reproduced: every
// "whenever a creature you control dies" payoff watching a TOKEN die
// (CR 111.7). `abilityReadsTriggerEvent` is that question, asked of the
// ability; for an ability that answers no, an unnameable field is left out of
// the declared event instead of refusing it, and the rebuild check
// (`triggerEventFingerprint`) stops comparing fields nothing can read.

import type {
    EffectOp,
    GameEvent,
    TargetSelection,
    TriggeredAbility,
} from "../cards/types";
import { findTriggeredAbility } from "./copy";
import type { StackItem } from "./state";
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
        encodedCardIds: "scalar",
    },
    // CR 615.1a — damage a shield prevented. `preventionWatchId` names the
    // delayed trigger that fired on it; the fired trigger never reads it back
    // (its body reads `amount`), so it travels verbatim.
    DAMAGE_PREVENTED: {
        sourceInstanceId: "object",
        target: "target",
        amount: "scalar",
        isCombat: "scalar",
        sourceColors: "scalar",
        preventionWatchId: "scalar",
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
        creatureSubtypes: "scalar",
        damagedBySources: "objectList",
        creaturePower: "scalar",
        creatureToughness: "scalar",
        combatPartnerIds: "objectList",
        attachmentsBeforeLeave: "objectList",
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
        manaValue: "scalar",
        isToken: "scalar",
        enteredTapped: "scalar",
        departedAs: "scalar",
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
        // CR 603.10a (issue #1372) — a plain counter-kind → count map.
        countersBeforeLeave: "scalar",
        attachedToBeforeLeave: "object",
        attachmentsBeforeLeave: "objectList",
        linkedExileBeforeLeave: "objectList",
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
        spellCastFromZone: "scalar",
        priorSpellCount: "scalar",
        casterSpellCountThisTurn: "scalar",
        casterSpellTypeCountsThisTurn: "scalar",
        manaSpentToCast: "scalar",
        spellManaValue: "scalar",
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
    // CR 707.10 — a spell was copied. Both the copy and its original may be on
    // the stack while the trigger is; the original may also be gone.
    SPELL_COPIED: {
        copierId: "player",
        spellInstanceId: "object",
        originalSpellInstanceId: "object",
        spellCardId: "scalar",
        spellTypes: "scalar",
        spellSubtypes: "scalar",
        spellColors: "scalar",
        fromCastCopyTrigger: "scalar",
    },
    // CR 701.26a — a permanent became tapped (Tap). `manaProduced` is a `ManaCost`,
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
    // CR 708.8 — the permanent just turned face up, still on the battlefield.
    PERMANENT_TURNED_FACE_UP: {
        permanentId: "object",
        controllerId: "player",
    },
    // CR 701.27e — the permanent just transformed, still on the battlefield.
    PERMANENT_TRANSFORMED: {
        permanentId: "object",
        controllerId: "player",
    },
    // CR 702.134c — the mentor may have left the battlefield; the name-and-seat
    // walk refuses an object it cannot name.
    CREATURE_MENTORED: {
        mentorId: "object",
        mentoredId: "object",
        controllerId: "player",
    },
    PERMANENT_EXERTED: {
        permanentId: "object",
        controllerId: "player",
        permanentTypes: "scalar",
        permanentSubtypes: "scalar",
        asAttacks: "scalar",
    },
    // CR 702.154c — an attacker enlisted a creature, tapping it as the cost.
    CREATURE_ENLISTED: {
        attackerId: "object",
        enlistedId: "object",
        controllerId: "player",
        enlistedPower: "scalar",
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
    // CR 509.3c — one attacker that became blocked.
    ATTACKER_BLOCKED: {
        attackerId: "object",
        attackerControllerId: "player",
        attackerTypes: "scalar",
        attackerSubtypes: "scalar",
    },
    // CR 509.3a — one creature declared as a blocker.
    BLOCKER_DECLARED: {
        blockerId: "object",
        blockerControllerId: "player",
        blockerTypes: "scalar",
        blockerSubtypes: "scalar",
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
    // CR 603.10a — a card that left its owner's graveyard (issue #9423); the
    // instance id names the card, now in `toZone`.
    CARD_LEFT_GRAVEYARD: {
        ownerId: "player",
        cardInstanceId: "object",
        cardId: "scalar",
        toZone: "scalar",
        types: "scalar",
        isToken: "scalar",
        battlefieldCohort: "residue",
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
        byTriggeredAbilityId: "scalar",
    },
    LEVEL_GAINED: {
        instanceId: "object",
        controllerId: "player",
        level: "scalar",
        previousLevel: "scalar",
        types: "scalar",
        subtypes: "scalar",
    },
    // CR 701.37a — a permanent became monstrous (the transition only).
    PERMANENT_BECAME_MONSTROUS: {
        instanceId: "object",
        controllerId: "player",
        count: "scalar",
        types: "scalar",
        subtypes: "scalar",
    },
    // CR 702.94a — a card revealed through its miracle window (the linked
    // trigger's event; no card-def ability watches it).
    MIRACLE_REVEALED: {
        playerId: "player",
        cardInstanceId: "object",
    },
    // CR 115.1 / 702.21a — something became a target (Ward watches it).
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
    // CR 701.13a — a batch of exiled cards (Exile), each with its own origin zone.
    // A nested array of object ids is a shape this vocabulary does not carry:
    // refused rather than approximated.
    CARDS_EXILED: { cards: "residue" },
    // CR 400.3 — a batch of cards put into a library, each with its origin
    // zone (issue #3242). Same nested shape as CARDS_EXILED, same refusal.
    CARDS_PUT_INTO_LIBRARY: { cards: "residue" },
    LIBRARY_SEARCHED: { playerId: "player", libraryOwnerId: "player" },
    // CR 702.174c — the player who gave the gift.
    GIFT_GIVEN: { playerId: "player" },
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
 *  a sweep is counting. `omitted` names the fields left out of an event whose
 *  ability cannot read it (`readByAbility: false`); always empty otherwise. */
export type TriggerEventLowering =
    | { ok: true; event: ScenarioTriggerEvent; omitted: string[] }
    | { ok: false; fields: string[] };

/** The Effect Script selector sets the interpreter fills from the firing
 *  event rather than from the board (`selectForEachMembers`,
 *  `effects/interpreter.ts`): CR 508.3b "those creatures" and the CR 607.2a
 *  pile a departed source held. Matched as a string wherever it sits in the
 *  script, key or value, so the object-selector spelling
 *  `{ exiledWithSource: true }` is caught by the same test. */
const EVENT_READING_SCRIPT_WORDS: ReadonlySet<string> = new Set([
    "eventAttackers",
    "exiledWithSource",
]);

/** The reserved ref prefix the interpreter resolves from the firing event
 *  (`resolveEventRef`, ADR 0049). */
const EVENT_REF_PREFIX = "$event.";

/** Whether an Effect Script holds ANY read of the firing event. Deliberately a
 *  walk over every string in the data, not over the Op grammar: a read nested
 *  in a position this function never heard of (a `capture`, a granted
 *  ability's body, a filter) is still found, and the one error it can make is
 *  the safe one — calling a script a reader that is not. */
export function effectScriptReadsTriggerEvent(
    effects: readonly EffectOp[] | undefined
): boolean {
    const walk = (node: unknown): boolean => {
        if (typeof node === "string") {
            return (
                node.startsWith(EVENT_REF_PREFIX) ||
                EVENT_READING_SCRIPT_WORDS.has(node)
            );
        }
        if (Array.isArray(node)) return node.some(walk);
        if (node !== null && typeof node === "object") {
            return Object.entries(node).some(
                ([key, value]) =>
                    EVENT_READING_SCRIPT_WORDS.has(key) || walk(value)
            );
        }
        return false;
    };
    return walk(effects ?? []);
}

/**
 * CR 603.2 / 603.4 (issue #9868) — whether resolving this ability can read the
 * event it fired on. The readers are the ones `resolveTopOfStack` hands the
 * event to: the intervening-if re-check, an imperative `resolve(ctx, event)`,
 * stepped and modal bodies (imperative, or not walked here — a reader until
 * shown otherwise), and an Effect Script's `$event` reads. `aiEffects` is the
 * Bot's reading of the same ability and is held to the same question.
 *
 * `false` is the strong answer and the only one that relaxes anything, so
 * every doubt resolves to `true`.
 */
export function abilityReadsTriggerEvent(
    ability: Pick<
        TriggeredAbility,
        | "interveningIf"
        | "resolve"
        | "resolveSteps"
        | "modes"
        | "effects"
        | "aiEffects"
    >
): boolean {
    if (ability.interveningIf || ability.resolve) return true;
    if (ability.resolveSteps && ability.resolveSteps.length > 0) return true;
    if (ability.modes && ability.modes.length > 0) return true;
    return (
        effectScriptReadsTriggerEvent(ability.effects) ||
        effectScriptReadsTriggerEvent(ability.aiEffects)
    );
}

/** The same question asked of a trigger ON THE STACK, through the lookup its
 *  resolution uses (`findTriggeredAbility`). An emblem's ability is
 *  not a card definition's and one that cannot be found resolves as nothing
 *  this function can vouch for: both are readers. */
export function stackTriggerReadsItsEvent(item: StackItem): boolean {
    if (item.triggeredAbilityId === undefined) return true;
    if (item.emblemSourceId !== undefined) return true;
    const ability = findTriggeredAbility(item, item.triggeredAbilityId);
    return ability === undefined || abilityReadsTriggerEvent(ability);
}

/**
 * CR 603.2 — one firing event, lowered.
 *
 * `readByAbility` defaults to `true`, the fail-closed reading: every field the
 * spec cannot name blocks. Passed `false` (`stackTriggerReadsItsEvent`), such a
 * field is left out and reported in `omitted` instead — the ability resolves
 * identically without it. An event TYPE the vocabulary does not know blocks
 * either way: the resolution branch is gated on the item carrying an event,
 * and there is no member to declare.
 */
export function lowerTriggerEvent(
    event: GameEvent,
    ports: TriggerEventLoweringPorts,
    readByAbility: boolean = true
): TriggerEventLowering {
    const kinds = EVENT_FIELD_KINDS[event.type] as
        | Record<string, EventFieldKind>
        | undefined;
    if (!kinds) return { ok: false, fields: ["type"] };
    const fields: Record<string, ScenarioEventValue> = {};
    const blocked: string[] = [];
    const record = event as unknown as Record<string, unknown>;
    const keyList = Object.keys(record).sort();
    for (let i = 0; i < keyList.length; i++) {
        const key = keyList[i];
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
            // Present but not a list is the one shape this walk must not
            // guess about: an empty list resolves as "no objects", which a
            // "damaged by" / "attacked with" clause reads as a different
            // board (CR 603.2).
            if (!Array.isArray(value)) {
                blocked.push(key);
                continue;
            }
            const ids = value as string[];
            const refs: ScenarioObjectRef[] = [];
            let lost = false;
            for (let j = 0; j < ids.length; j++) {
                const id = ids[j];
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
    if (blocked.length > 0 && readByAbility) {
        return { ok: false, fields: blocked };
    }
    return {
        ok: true,
        event: {
            type: event.type,
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
        },
        omitted: blocked,
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
    // The declared event is AUTHORED as often as it is lowered (ADR 0044 — a
    // preset scenario is hand-edited and the DB is the source of truth), and
    // `resolveTopOfStack` gates the trigger branch on the item carrying an
    // event at all, never on its SHAPE. So an event naming no member of the
    // union, or a field the table classifies differently, would reach
    // `interveningIf` / `resolve(ctx, event)` / every `$event.<field>` ref as
    // an object whose every read is `undefined` — a different board, silently.
    // Checked here with the same throw discipline `seedDeclaredStack`'s `pick`
    // already applies to a name it cannot find.
    const kinds = EVENT_FIELD_KINDS[declared.type as GameEvent["type"]] as
        | Record<string, EventFieldKind>
        | undefined;
    if (!kinds) {
        throw new Error(
            `rebuildTriggerEvent: "${declared.type}" is not a GameEvent type (CR 603.2) — no row in EVENT_FIELD_KINDS.`
        );
    }
    const out: Record<string, unknown> = { type: declared.type };
    const entries2 = Object.entries(declared.fields ?? {});
    for (let i = 0; i < entries2.length; i++) {
        const [key, value] = entries2[i];
        const kind = kinds[key];
        const declaredKind =
            value.kind === "objects" ? "objectList" : value.kind;
        if (!kind || kind === "residue" || kind !== declaredKind) {
            throw new Error(
                `rebuildTriggerEvent: "${declared.type}.${key}" is declared as "${value.kind}", but the vocabulary says "${kind ?? "(no such field)"}".`
            );
        }
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

/** The label `stackFingerprint` embeds for a trigger's firing event.
 *
 *  `readByAbility: false` (issue #9868) renders the TYPE alone. The check
 *  exists to catch a rebuild that lost a fact the resolution reads; an ability
 *  that reads none has no such fact, and its declared event may legitimately
 *  be missing the fields the spec could not name — comparing them would
 *  refuse exactly the positions the omission exists to keep. */
export function triggerEventFingerprint(
    event: GameEvent,
    ports: TriggerEventFingerprintPorts,
    readByAbility: boolean = true
): string {
    if (!readByAbility) return `${event.type}(unread)`;
    const kinds = EVENT_FIELD_KINDS[event.type] as
        | Record<string, EventFieldKind>
        | undefined;
    const record = event as unknown as Record<string, unknown>;
    const parts: string[] = [];
    const keyList = Object.keys(record).sort();
    for (let i = 0; i < keyList.length; i++) {
        const key = keyList[i];
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
            // A non-array renders as `(not a list)` rather than as an empty
            // one — the lowering refuses it, and two different shapes must
            // never render alike here.
            if (!Array.isArray(value)) {
                parts.push(`${key}=(not a list)`);
                continue;
            }
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
