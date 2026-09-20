/**
 * The `$event.<field>` registry (ADR 0049, issue #865) — its own module, split
 * out of `mechanicsRegistry.ts` (issue #4127) because a CLIENT-reachable reader
 * needs it: a compiled trigger condition (`compiledTriggers.ts`) names "that
 * player" by an event field, and importing the whole Mechanics Registry for
 * one table put ~90 KB gzip of census prose into the `card-catalogue` chunk
 * (`scripts/check-bundle-size.ts`). `mechanicsRegistry.ts` re-exports every
 * name below, so it stays the single name authority.
 */

import type { GameEvent } from "./types";

// --- Event field registry (ADR 0049, issue #865) -----------------------------
// The name authority for `$event.<field>` refs read at a TRIGGER site: maps a
// (GameEventType, flat friendly field) pair to its value FAMILY (object /
// player — which decides the ref POSITION it is legal in) and a `resolve(event)`
// that FLATTENS the possibly-nested event shape to a single id string, so the
// ref stays single-level and the frozen ref grammar (ADR 0045) is untouched.
// Censused, not free-form: an unlisted field is a static validation failure,
// never a runtime skip (ADR 0049 — free-form `$event.<any field>` gives no
// static family and turns a wrong field into a silent no-op instead of a CI
// error, breaking validate.ts's dangling-ref guarantee). The table grows one
// row per migrated card. `TriggeredAbility.event` is statically known, so
// validation is exact per trigger.

export type EventFieldFamily =
    | "object"
    | "player"
    | "stack-object"
    | "graveyard-card"
    | "number";

export interface EventFieldRow {
    /** Value family — which decides the ref POSITION the field is legal in, and
     *  which PRESENCE recheck its consumer owes (CR 608.2b):
     *
     *   - `"object"` — a permanent instance id. Rechecked against the
     *     BATTLEFIELD at resolution (`resolveObjectRef`); a permanent that left
     *     skips the reading Op.
     *   - `"player"` — a player id. Nothing to recheck (a player does not leave
     *     a zone).
     *   - `"stack-object"` — a SPELL on the stack (issue #3206). Neither of the
     *     two above: a stack object is not a permanent, so a battlefield
     *     recheck would reject every one of them, and the presence question is
     *     "is it still ON THE STACK". That recheck is NOT duplicated here — it
     *     lives in `SpellContext.counter` (`gre/state.ts`), which already
     *     fizzles silently on a spell that has left (CR 608.2b, the same skip
     *     an announced target that departed gets). One authority, not two.
     *   - `"graveyard-card"` — the CARD a zone change put into a graveyard
     *     (issue #4127). CR 400.7e lets an ability that triggers on an object
     *     moving zones find the new object it became in the public zone it
     *     moved to, so the presence question is "is it still IN A
     *     GRAVEYARD", rechecked by `resolveObjectRef`. Legal ONLY in
     *     `moveZone`'s `target` position — the one Op with a graveyard-card
     *     executor — which the validator enforces.
     *   - `"number"` — a MAGNITUDE the event carries: "you gain THAT MUCH
     *     life" reads the damage a `DAMAGE_DEALT` dealt (CR 120.3). `resolve`
     *     flattens it to its decimal string like every other family flattens
     *     to a string, and `resolveValue` parses it back. Legal ONLY in a
     *     numeric (`EffectValue`) position; nothing to recheck — a number
     *     names no object that can leave a zone.
     *
     *  The validator checks the family against the ref's POSITION (a destroy
     *  target vs a player selector vs a `counter` target); a mismatch is a
     *  definition bug. */
    family: EventFieldFamily;
    /** Flattens the firing event to the single id the friendly field names, or
     *  undefined when the event carries no such id (e.g. DAMAGE_DEALT dealt to a
     *  permanent has no `damagedPlayer`). CR 608.2b — the reading Op then
     *  skips.
     *
     *  `sourceInstanceId` is the RESOLVING ability's own source permanent
     *  (`SpellContext.sourceInstanceId`), threaded in so a row can flatten a
     *  field that is only well-defined RELATIVE to the reading ability — the
     *  CR 509.1h pair complement, "the OTHER creature in the attacker/blocker
     *  pair" (`BLOCKERS_CONFIRMED.otherCombatant`, issue #2762). Almost every
     *  row ignores it: a field that reads straight off the event stays a pure
     *  function of the event, and a row that takes the second parameter is
     *  saying "this id has no meaning without knowing who is asking".
     *
     *  OPTIONAL for the CALLERS, not because a resolution can lack a source:
     *  `SpellContext.sourceInstanceId` is a non-optional `string`
     *  (`item.triggerSourceId ?? item.id`), and every capture path resolves
     *  inside the scheduling ability's OWN resolution, so the single
     *  interpreter call site always has it. The parameter is optional so a
     *  caller that only needs an ABSOLUTE row — the registry's own census
     *  tests — can pass the event alone. A relative row given no source
     *  returns undefined and the reading Op skips (CR 608.2h). */
    resolve: (
        event: GameEvent,
        sourceInstanceId?: string
    ) => string | undefined;
}

/** CR 508.1 — the ONE creature an `ATTACKERS_DECLARED` names, or undefined
 *  when the batch declared several (CR 608.2b — the reading Op then skips).
 *  Shared by the two rows that read it, so the flatten has one implementation
 *  whichever question is being asked of it. */
function soleDeclaredAttacker(event: GameEvent): string | undefined {
    return event.type === "ATTACKERS_DECLARED" && event.attackerIds.length === 1
        ? event.attackerIds[0]
        : undefined;
}

/** `(GameEventType, field) → { family, resolve }` (ADR 0049). Keyed by the
 *  literal event-type string so a lookup needs no event instance. */
export const EVENT_FIELD_REGISTRY: Record<
    string,
    Record<string, EventFieldRow>
> = {
    // CR 508.1 — attacker declaration. `ATTACKERS_DECLARED` carries the full
    // `attackerIds` list; `soleAttacker` FLATTENS it to a single id ONLY when
    // exactly one creature was declared (CR 702.83 Exalted's "attacks alone"),
    // and is undefined otherwise (CR 608.2b — the reading Op then skips). This
    // is the object-family field Exalted's expanded trigger pumps: the lone
    // attacker, which need not be the exalted source itself. Issue #699.
    ATTACKERS_DECLARED: {
        soleAttacker: {
            family: "object",
            resolve: soleDeclaredAttacker,
        },
        // CR 506.4 / 508.3a — "the attacking or blocking creature" this firing
        // is ABOUT: the one attacker a per-attacker firing
        // (`TriggeredAbility.perAttacker`) named. Its twin row on
        // `BLOCKER_DECLARED` names the blocker, so ONE ref —
        // `{ ref: "$event.combatant" }` — reads the creature on either side of
        // "whenever a creature attacks or blocks" (Powerstone Minefield),
        // which is what lets that Oracle line stay ONE `TriggeredAbility` with
        // an array `event` (CR 603.2).
        //
        // Shares `soleAttacker`'s flatten, and deliberately does not REPLACE
        // it: the two rows answer different questions off the same shape.
        // `soleAttacker` is CR 702.83's cardinality fact — "attacks ALONE",
        // read off the REAL batch event, undefined the moment a second
        // creature attacks. `combatant` is CR 508.3a's per-creature subject,
        // well-defined for every attacker in the batch and reached by the
        // synthetic single-attacker event the fan-out builds. Renaming either
        // into the other would make one of the two readings unsayable.
        combatant: {
            family: "object",
            resolve: soleDeclaredAttacker,
        },
    },
    // CR 509.3a — a creature declared as a blocker, once per creature. The
    // event carries exactly one, so `combatant` names it with no pair to
    // disambiguate (see `BlockerDeclaredEvent`).
    BLOCKER_DECLARED: {
        combatant: {
            family: "object",
            resolve: (e) =>
                e.type === "BLOCKER_DECLARED" ? e.blockerId : undefined,
        },
    },
    // CR 509.1h — the attacker/blocker pairing, emitted per attacker-blocker
    // PAIR (phases.ts), so a per-pair capture reads exactly one attacker and one
    // blocker even under multi-block / banding. Both ids are OBJECT refs
    // (permanents expected on the battlefield when the trigger fires).
    BLOCKERS_CONFIRMED: {
        attackerId: {
            family: "object",
            resolve: (e) =>
                e.type === "BLOCKERS_CONFIRMED" ? e.attackerId : undefined,
        },
        blockerId: {
            family: "object",
            resolve: (e) =>
                e.type === "BLOCKERS_CONFIRMED" ? e.blockerId : undefined,
        },
        // CR 509.1h (issue #2762) — the pair COMPLEMENT: "Whenever this
        // creature blocks or becomes blocked by a creature, THAT CREATURE …"
        // (Lim-Dûl's Cohort). Which of the two ids "that creature" names is
        // not a property of the event — it depends on which side of the pair
        // the READING ability's own source is on, and the same card fires with
        // its source as the attacker on one turn and as the blocker on the
        // next. That is what the second `resolve` parameter is for: this row
        // returns whichever id is NOT `sourceInstanceId`.
        //
        // Deliberately a censused ROW and not a new `EffectObjectSelector`
        // variant or a new reserved ref: the pair complement is a fact about
        // THIS event, so it belongs in the table that already censuses this
        // event's fields (ADR 0049), and the frozen ref grammar (ADR 0045)
        // needs no change at all — `{ ref: "$event.otherCombatant" }` is the
        // ordinary object-family `$event.<field>` shape the validator already
        // family-checks and `resolveObjectRef` already rechecks for
        // battlefield presence.
        //
        // FAIL-CLOSED when the source is NEITHER combatant — a symmetric
        // "whenever a creature blocks" trigger on some third permanent has no
        // "other" creature to name, so the reading Op skips (CR 608.2h — the
        // effect fails to determine the information) rather than silently
        // acting on the attacker. A card whose own source is SOMETIMES in the
        // pair therefore reads this row correctly for its own pair and no-ops
        // on every other one: this row is for the "THIS creature blocks or
        // becomes blocked" wording, and a genuinely symmetric "whenever a
        // creature blocks" card wants `attackerId`/`blockerId`, not a
        // complement. Same for the aura wording
        // ("whenever ENCHANTED creature blocks…", `combatPairKill`'s
        // `combatant: "enchanted"`): the pair contains the aura's HOST, never
        // the aura itself, so this row correctly declines to guess — that
        // scope needs its own row, and has no shipped DSL consumer yet.
        otherCombatant: {
            family: "object",
            resolve: (e, sourceInstanceId) => {
                if (e.type !== "BLOCKERS_CONFIRMED") return undefined;
                if (sourceInstanceId === undefined) return undefined;
                if (e.attackerId === sourceInstanceId) return e.blockerId;
                if (e.blockerId === sourceInstanceId) return e.attackerId;
                return undefined;
            },
        },
    },
    // CR 119.3 — damage to a target. `damagedPlayer` FLATTENS the nested
    // `TargetSelection` down to the player id (a single-level ref), or undefined
    // when the damage went to a permanent (no player was damaged). `damagedPermanent`
    // (issue #1078, Voracious Cobra: "whenever this creature deals combat damage
    // to a creature, destroy that creature") is the OBJECT-family twin: the
    // damaged permanent's instance id, or undefined when the damage went to a
    // player instead. `resolveObjectRef`'s generic `$event.<field>` branch
    // (ADR 0049) already resolves any object-family row through the same
    // battlefield-presence recheck `damagedPlayer` gets for players — no
    // interpreter change needed, just this census row.
    DAMAGE_DEALT: {
        damagedPlayer: {
            family: "player",
            resolve: (e) =>
                e.type === "DAMAGE_DEALT" && e.target.type === "player"
                    ? e.target.id
                    : undefined,
        },
        damagedPermanent: {
            family: "object",
            resolve: (e) =>
                e.type === "DAMAGE_DEALT" && e.target.type === "permanent"
                    ? e.target.id
                    : undefined,
        },
        // CR 120.3 — "whenever ~ deals damage, you gain THAT MUCH life": the
        // amount of damage the event dealt. The numeric twin of the two id
        // fields above (`EventFieldFamily` "number").
        amount: {
            family: "number",
            resolve: (e) =>
                e.type === "DAMAGE_DEALT" && Number.isFinite(e.amount)
                    ? String(e.amount)
                    : undefined,
        },
    },
    // CR 603.6a — "at the beginning of [step]". `activePlayerId` is the player
    // on whose step the event fired (issue #1066 — Collapsing Borders' "at the
    // beginning of EACH PLAYER'S upkeep, THAT PLAYER gains life…"). Unblocks a
    // `phaseTrigger({ scope: "each" })` DSL `effects[]` body: the factory's own
    // doc note ("effects only valid with scope: 'your'") holds for every OTHER
    // phase trigger because `ctx.controller` is the ability's controller, not
    // the scoped player — this ref reads the scoped player directly off the
    // firing event instead of `ctx.controller`, so an `each`-scope trigger can
    // target the right player without going imperative.
    PHASE_BEGIN: {
        activePlayerId: {
            family: "player",
            resolve: (e) =>
                e.type === "PHASE_BEGIN" ? e.activePlayerId : undefined,
        },
    },
    // CR 603.6a — "whenever a [permanent] enters, ... its controller ..."
    // (issue #1072 — Tectonic Instability: "tap all lands ITS CONTROLLER
    // controls" for ANY land entering, not just this permanent's own
    // controller). Unblocks a plain (non-`enteredTrigger`-scoped) `effects[]`
    // body from reading the entering permanent's controller directly off the
    // firing event, mirroring the `PHASE_BEGIN.activePlayerId` row above.
    PERMANENT_ENTERED: {
        controllerId: {
            family: "player",
            resolve: (e) =>
                e.type === "PERMANENT_ENTERED" ? e.controllerId : undefined,
        },
        // CR 603.6a / 701.3 / issue #1965 — "whenever a 1/1 creature you
        // control enters, ... attach it to THAT CREATURE" (Sword of the
        // Meek). A `zone: "graveyard"` triggered ability's effect can't name
        // the entering permanent any other way — it isn't an announced
        // target (CR 603.3d targeting is for the ability's OWN card, not the
        // event's subject) and there is no `$each`/`forEach` set here.
        // Mirrors `BECAME_TARGET.targetPermanent`'s object-family flattening:
        // `resolveObjectRef`'s generic `$event.<field>` branch (ADR 0049)
        // already resolves any object-family row through the
        // battlefield-presence recheck, so a permanent that left in
        // response (CR 608.2b) is a silent no-op with no interpreter change.
        instanceId: {
            family: "object",
            resolve: (e) =>
                e.type === "PERMANENT_ENTERED" ? e.instanceId : undefined,
        },
    },
    // CR 603.10 / 400.7 / issue #1940 — "whenever a permanent is returned to
    // a player's hand, THAT PLAYER discards a card" (Warped Devotion).
    // `PERMANENT_LEFT` already IS the battlefield-departure event (`toZone:
    // "hand"` narrows a `leftTrigger` to bounces) and already carries
    // `ownerId` (CR 109.5, last-known information) — this row is the ONLY
    // thing that was missing: a censused `$event.ownerId` read so a
    // `leftTrigger({ scope: "any", toZone: "hand" })` DSL `effects[]` body
    // can target the RETURNING permanent's owner (CR 108.3 — always the
    // owner's hand), which is the "that player" the ability acts on — NOT
    // necessarily the ability's own controller, since the trigger fires
    // symmetrically on either player's bounce. Mirrors
    // `PERMANENT_ENTERED.controllerId` above. (Owner-arbitrated rework of
    // issue #1940: an earlier draft shipped a dedicated
    // `PERMANENT_RETURNED_TO_HAND` event; review established `PERMANENT_LEFT`
    // already covers the "returned to hand" case per ADR 0001's one-event-
    // per-zone-of-origin rule, so the new event was retired in favor of this
    // single field row.)
    PERMANENT_LEFT: {
        ownerId: {
            family: "player",
            resolve: (e) =>
                e.type === "PERMANENT_LEFT" ? e.ownerId : undefined,
        },
    },
    // CR 121.1 / 117.3a / issue #1946 — "whenever a player draws a card, THAT
    // PLAYER loses 2 life unless they pay {2}" (Phyrexian Tyranny). The
    // drawing player is CR 117.3a's "triggering player" for the mayPay
    // decision — usually NOT the enchantment's controller. Mirrors
    // `PHASE_BEGIN.activePlayerId` (issue #1066): unblocks a `drawTrigger({
    // scope: "each", effects: [...] })` DSL body to read the drawing player
    // straight off the firing `CardDrawnEvent` via `{ ref: "$event.playerId"
    // }` instead of the plain `"controller"` selector, which under `scope:
    // "each"` resolves to the SOURCE's controller, not the player who drew.
    CARD_DRAWN: {
        playerId: {
            family: "player",
            resolve: (e) => (e.type === "CARD_DRAWN" ? e.playerId : undefined),
        },
    },
    // CR 603.2b / issue #1953 — "whenever another permanent you control becomes
    // the target of a spell or ability an opponent controls, you may return
    // THAT PERMANENT to its owner's hand" (Cloud Cover). Every card that read
    // `BECAME_TARGET` before this row acted on `self` (Ward, Nadu) or on an
    // announced target slot (Leovold draws, Sleeping Potion sacrifices
    // `$source`) — none needed to name the object that just became a target,
    // which is why the event had no censused field at all. `targetPermanent`
    // is the OBJECT-family flattening of the nested `TargetSelection`, exactly
    // mirroring `DAMAGE_DEALT.damagedPermanent`: undefined when a PLAYER became
    // the target (Cloud Cover's `matches` already excludes that case, but the
    // row must be total), so the reading Op skips per CR 608.2b. No interpreter
    // change — `resolveObjectRef`'s generic `$event.<field>` branch (ADR 0049)
    // already resolves any object-family row through the battlefield-presence
    // recheck, which is also what makes a permanent killed in response a silent
    // no-op rather than an error.
    // CR 702.33d / 603.2 / issue #1097 — "whenever a player kicks a spell"
    // (Saproling Infestation). The KICKING player is the kicked spell's
    // controller and is usually NOT the triggered ability's controller: the
    // ability is symmetric ("a player"), so the plain `"controller"` selector
    // resolves to the enchantment's controller, which is right for Saproling
    // Infestation's own "YOU create" but wrong for any later card that must
    // name the kicker ("that player draws a card"). Censused here so such a
    // card is DSL-expressible with no engine change, exactly as
    // `CARD_DRAWN.playerId` (issue #1946) and `PHASE_BEGIN.activePlayerId`
    // (issue #1066) did for their events.
    SPELL_KICKED: {
        casterId: {
            family: "player",
            resolve: (e) =>
                e.type === "SPELL_KICKED" ? e.casterId : undefined,
        },
    },
    // CR 700.4 / 400.7e / issue #4127 — "When enchanted creature dies, return
    // THAT CARD to its owner's hand" (Squee's Embrace). The dying creature is
    // a new object in its owner's graveyard by the time the trigger resolves
    // (CR 400.7), and CR 400.7e is the exception that lets a trigger on the
    // zone change find it there. The instance id survives the move to the
    // graveyard, so the row flattens `creatureInstanceId`; the family is
    // `graveyard-card`, NOT `object`, because `object` rechecks the
    // BATTLEFIELD — where the card never is again. A token that died has
    // ceased to exist (CR 704.5d) and is simply not found: the Op skips.
    CREATURE_DIED: {
        card: {
            family: "graveyard-card",
            resolve: (e) =>
                e.type === "CREATURE_DIED" ? e.creatureInstanceId : undefined,
        },
    },
    // CR 601.2i — a spell was cast. Two rows, both flattening the event that
    // `emitSpellCastEvent` (`gre/state.ts`) builds at the single cast choke
    // point (issue #3206).
    //
    // `spell` is the first `"stack-object"` field: the spell itself, as an
    // object a `counter` can act on. A triggered ability that counters the
    // spell that triggered it announces no target (CR 603.2), so `counter`'s
    // `EffectTargetRef` had nothing to name — this ref is what names it.
    // Mana Vortex (`sets/drk/blue.ts`) asked for exactly this row by name.
    SPELL_CAST: {
        spell: {
            family: "stack-object",
            resolve: (e) =>
                e.type === "SPELL_CAST" ? e.spellInstanceId : undefined,
        },
        caster: {
            family: "player",
            resolve: (e) => (e.type === "SPELL_CAST" ? e.casterId : undefined),
        },
    },
    // CR 603.2b / 109.5 / issue #3303 — "whenever this creature becomes the
    // target of a spell, this creature deals 2 damage to THAT SPELL'S
    // CONTROLLER" (Bonecrusher Giant). Every card that read `BECAME_TARGET`
    // before this row acted on `self`, on an announced slot, or on the object
    // that became the target (`targetPermanent` below) — none needed to name
    // the player on the OTHER side of the targeting, which is why the event's
    // `sourceControllerId` had no censused field. Player-family, exactly like
    // `SPELL_CAST.caster` and `SPELL_KICKED.casterId`: no interpreter change,
    // the generic `$event.<field>` branch (ADR 0049) resolves it.
    BECAME_TARGET: {
        sourceController: {
            family: "player",
            resolve: (e) =>
                e.type === "BECAME_TARGET" ? e.sourceControllerId : undefined,
        },
        targetPermanent: {
            family: "object",
            resolve: (e) =>
                e.type === "BECAME_TARGET" && e.target.type === "permanent"
                    ? e.target.id
                    : undefined,
        },
    },
};

/** The registry row for a `(GameEventType, field)` pair, or undefined when the
 *  event type has no such censused field (ADR 0049). The single decision point
 *  consulted by both the validator (family + census) and the interpreter
 *  (`resolve`). */
export function getEventFieldRow(
    eventType: string,
    field: string
): EventFieldRow | undefined {
    return EVENT_FIELD_REGISTRY[eventType]?.[field];
}

/** True when `field` is a censused `$event.<field>` for `eventType` (ADR 0049). */
export function isRegisteredEventField(
    eventType: string,
    field: string
): boolean {
    return getEventFieldRow(eventType, field) !== undefined;
}
