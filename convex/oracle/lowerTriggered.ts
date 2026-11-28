/**
 * Lowering: triggered-ability IR → `CompiledTriggeredAbility` (CR 113.3c,
 * ADR 0045 / ADR 0105).
 *
 * The output is a JSON-pure DESCRIPTOR, not a `TriggeredAbility`: that
 * interface's `matches` is a required closure and the compiler emits JSON only
 * (see `cards/compiledTriggers.ts` for the full argument). The descriptor is
 * rebuilt into the real ability at the registry seam, through the same
 * factories a hand-written card calls.
 *
 * Target slots are allocated by the SAME walk the activated site uses
 * (`lowerEffects.ts`), so a trigger's `{ target: 0 }` and the requirement that
 * declares it are assigned once, in sentence order — and the one-target
 * ceiling grammar v0 imposes is the shared one, not a second copy that could
 * drift.
 */

import type { PermanentFilter } from "../cards/filters";
import { namesHost } from "./grammar/shared/effectClause";
import type {
    CompiledTriggerCondition,
    CompiledTriggerHead,
    ControlsSubject,
    CompiledTriggeredAbility,
} from "../cards/compiledTriggers";
import type {
    EffectObjectSelector,
    EffectOp,
    KickerCost,
    TargetRequirement,
} from "../cards/types";
import type {
    ControlsSubjectIR,
    TriggerConditionIR,
} from "./grammar/shared/condition";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import {
    headPronounReferent,
    type TriggerHeadIR,
} from "./grammar/shared/triggerHead";
import {
    declareTargets,
    kickedValue,
    lowerSentence,
    SentenceWalk,
    type SiteAntecedents,
    TargetSlots,
} from "./lowerEffects";

export type LowerTriggerResult =
    | { readonly ok: true; readonly ability: CompiledTriggeredAbility }
    | { readonly ok: false; readonly reason: string };

/** CR 603.6a — the entering permanent's type narrowing, when the head has one. */
const CREATURE_FILTER: PermanentFilter = { types: ["Creature"] };

/** Head IR → the engine-side head descriptor. */
function lowerHead(head: TriggerHeadIR): CompiledTriggerHead {
    switch (head.kind) {
        case "enters":
            return head.creaturesOnly
                ? {
                      kind: "entered",
                      scope: head.scope,
                      // CR 202.3 / 208.1 — a mana-value or power floor rides
                      // the same filter.
                      filter: {
                          ...CREATURE_FILTER,
                          ...(head.manaValueAtLeast !== undefined
                              ? { manaValueAtLeast: head.manaValueAtLeast }
                              : {}),
                          ...(head.powerAtLeast !== undefined
                              ? { powerAtLeast: head.powerAtLeast }
                              : {}),
                      },
                  }
                : head.subtypes !== undefined
                  ? // CR 205.3 — a subtype narrowing rides the filter, and
                    // CR 111.1's "nontoken" beside it.
                    {
                        kind: "entered",
                        scope: head.scope,
                        filter: {
                            subtypes: [...head.subtypes],
                            ...(head.nontoken === true
                                ? { isToken: false }
                                : {}),
                        },
                    }
                  : head.permanentType !== undefined
                    ? // CR 205.2a — a card-type narrowing ("a land enters").
                      {
                          kind: "entered",
                          scope: head.scope,
                          filter: { types: [head.permanentType] },
                      }
                    : { kind: "entered", scope: head.scope };
        case "dies":
            // CR 603.6 — the event IS `CREATURE_DIED`, so the head carries no
            // type filter: a second authority on the same fact is a second
            // thing to get wrong.
            return { kind: "died", scope: head.scope };
        case "leaves":
            return { kind: "left", scope: head.scope };
        case "enters-or-leaves":
            return { kind: "enters-or-leaves" };
        case "enters-or-sacrificed":
            return { kind: "enters-or-sacrificed" };
        // CR 603.6c + CR 700.4 — "without dying" is every exit but the one to
        // a graveyard, for a creature of yours (the source among them).
        case "leaves-without-dying":
            return {
                kind: "left",
                scope: head.scope,
                filter: CREATURE_FILTER,
                toZone: ["exile", "hand", "library"],
            };
        case "sacrificed":
            return {
                kind: "sacrificed",
                scope: head.scope,
                filter: { types: [head.permanentType] },
            };
        case "library-searched":
            return { kind: "library-searched", scope: head.scope };
        case "gift-given":
            return { kind: "gift-given", scope: head.scope };
        case "expend":
            return { kind: "expend", scope: head.scope, amount: head.amount };
        case "foraged":
            return { kind: "foraged", scope: head.scope };
        case "life-gained":
            return { kind: "life-gained", scope: head.scope };
        case "life-gained-or-lost":
            return {
                kind: "life-gained-or-lost",
                scope: head.scope,
                duringYourTurn: head.duringYourTurn,
            };
        case "left-to-graveyard":
            return {
                kind: "left-to-graveyard",
                scope: head.scope,
                ...(head.permanentType !== undefined
                    ? { filter: { types: [head.permanentType] } }
                    : {}),
                // CR 205.3 — the subtype the head names ("a Food").
                ...(head.subtypes !== undefined
                    ? { filter: { subtypes: [...head.subtypes] } }
                    : {}),
                ...(head.ownedBy !== undefined
                    ? { ownedBy: head.ownedBy }
                    : {}),
                ...(head.causedBy !== undefined
                    ? { causedBy: head.causedBy }
                    : {}),
            };
        case "library-to-graveyard":
            return { kind: "library-to-graveyard" };
        case "power-reached":
            return { kind: "power-reached", atLeast: head.atLeast };
        case "class-level-gained":
            return { kind: "class-level-gained", level: head.level };
        case "graveyard-entry":
            return {
                kind: "graveyard-entry",
                graveyard: head.graveyard,
                ...(head.excludeSelf === true
                    ? { excludeSelf: true as const }
                    : {}),
                ...(head.colors !== undefined ? { colors: head.colors } : {}),
            };
        case "attacks":
            // CR 508.3a — `self` is the head as it shipped before the scoped
            // reading existed, and the field is OMITTED there rather than
            // written: a compiled "whenever this creature attacks" must stay
            // the same descriptor it has always been, byte for byte, or every
            // such card churns in the lockfile for no behaviour change.
            if (head.whileSaddled === true)
                return { kind: "attacks", whileSaddled: true };
            if (head.alone === true) return { kind: "attacks", alone: true };
            return head.scope === "self"
                ? { kind: "attacks" }
                : { kind: "attacks", scope: head.scope };
        case "attacks-or-blocks":
            return { kind: "attacks-or-blocks", scope: head.scope };
        case "blocks":
            return { kind: "blocks" };
        case "enters-or-attacks":
            return { kind: "enters-or-attacks" };
        case "enters-or-upkeep":
            return { kind: "enters-or-upkeep" };
        case "combat-damage-to-player":
            return { kind: "combat-damage-to-player" };
        case "damage-dealt":
            return {
                kind: "damage-dealt",
                source: head.source,
                recipient: head.recipient,
                ...(head.combat === true ? { combat: true as const } : {}),
            };
        case "damage-taken":
            return { kind: "damage-taken", scope: head.scope };
        case "attacks-unblocked":
            return { kind: "attacks-unblocked" };
        case "becomes-blocked":
            return { kind: "becomes-blocked" };
        case "turned-face-up":
            return { kind: "turned-face-up" };
        case "transforms":
            return { kind: "transforms" };
        case "becomes-tapped":
            return { kind: "tapped", scope: head.scope };
        case "tapped-for-mana":
            return { kind: "tapped-for-mana", scope: head.scope };
        case "becomes-target":
            return {
                kind: "became-target",
                ...(head.scope !== undefined ? { scope: head.scope } : {}),
                ...(head.by !== undefined ? { by: head.by } : {}),
            };
        case "cycled":
            return { kind: "cycled" };
        case "phase":
            return {
                kind: "phase",
                phase: head.phase,
                scope: head.scope,
                ...(head.phases !== undefined ? { phases: head.phases } : {}),
            };
        case "spell-cast":
            return {
                kind: "spell-cast",
                scope: head.scope,
                ...(head.filter !== undefined ? { filter: head.filter } : {}),
                ...(head.nthSpellThisTurn !== undefined
                    ? { nthSpellThisTurn: head.nthSpellThisTurn }
                    : {}),
            };
    }
}

/**
 * CR 603.2b — the `$event` player field naming the player a head
 * NAMES ("each PLAYER'S upkeep" → the player whose upkeep it is,
 * `PHASE_BEGIN.activePlayerId`), or null when the head names no player. The
 * one source of "that player" for both the body and an intervening-if, so the
 * two can never disagree about who it is.
 */
function namedPlayerField(head: TriggerHeadIR): string | null {
    return head.kind === "phase" && head.namesPlayer === true
        ? "activePlayerId"
        : null;
}

/**
 * CR 603.3d + CR 601.2c — "another target …" with no earlier target on a
 * triggered ability names a target other than the ability's own source, chosen
 * as the ability goes on the stack. That reading holds only behind a head
 * naming no other object the word could mean: "whenever enchanted creature
 * attacks, another target creature" and "whenever a creature enters, another
 * target creature" are other than THAT creature, so those heads stay refused.
 */
function anotherExcludesSource(head: TriggerHeadIR): boolean {
    switch (head.kind) {
        case "enters":
        case "attacks":
        case "dies":
        case "becomes-tapped":
            return head.scope === "self";
        case "enters-or-attacks":
        case "turned-face-up":
            return true;
        case "phase":
            return head.scope === "your";
        case "spell-cast":
            return head.scope === "you";
        default:
            return false;
    }
}

/**
 * The referents this head gives the body's anaphora.
 *
 * "that card" after a dies head is the card the creature became in its
 * owner's graveyard (CR 400.7e), whatever the head's scope — the event is the
 * same `CREATURE_DIED`, and so is the card it names.
 */
function headAntecedents(head: TriggerHeadIR): SiteAntecedents {
    const playerField = namedPlayerField(head);
    // CR 102.2 — "deals damage to AN OPPONENT" names the damaged player, who
    // is an opponent by the head's own words: both "that player" and "that
    // opponent" read `DAMAGE_DEALT.damagedPlayer`.
    const damagedOpponent =
        head.kind === "damage-dealt" && head.recipient === "opponent"
            ? { ref: "$event.damagedPlayer" }
            : null;
    // CR 102.1 — "deals damage to A PLAYER" names the damaged player too, but
    // not as an opponent: either player can be the one dealt damage, so "that
    // opponent" stays unbound behind this head. CR 510.1 — "deals combat
    // damage to a player" is the same head narrowed to combat damage, built
    // on the same `DAMAGE_DEALT` trigger, so it names the same player.
    const damagedPlayer =
        (head.kind === "damage-dealt" && head.recipient === "player") ||
        head.kind === "combat-damage-to-player"
            ? { ref: "$event.damagedPlayer" }
            : null;
    // CR 603.2 — "whenever a player / an opponent casts a spell"
    // names the caster, by the head's own words; behind "you" (and "you cast
    // this spell") the caster is the controller and "that player" is never
    // printed.
    const caster =
        head.kind === "spell-cast" &&
        (head.scope === "opponent" || head.scope === "any")
            ? { ref: "$event.caster" }
            : null;
    // CR 701.23a — "whenever an opponent searches their library" names the
    // searcher, who is "that player" of the body.
    const searcher =
        head.kind === "library-searched" ? { ref: "$event.playerId" } : null;
    return {
        // CR 506.2 + CR 508.5 — the source's own attack names the player it
        // attacks; this engine is two-player (ADR 0010), so that is the
        // source's controller's one opponent.
        // CR 508.1 + CR 509.1h — "attacks and isn't blocked" is the source's
        // own attack too: the defending player is still its opponent.
        // CR 509.3c — so is "becomes blocked": the source is the attacker.
        ...((head.kind === "attacks" && head.scope === "self") ||
        head.kind === "attacks-unblocked" ||
        head.kind === "becomes-blocked"
            ? { defendingPlayer: "opponent" as const }
            : {}),
        ...(playerField !== null
            ? { player: { ref: `$event.${playerField}` } }
            : {}),
        // CR 102.2 — "each opponent's turn" names the player as an opponent.
        ...(playerField !== null &&
        head.kind === "phase" &&
        head.scope === "opponents"
            ? { opponent: { ref: `$event.${playerField}` } }
            : {}),
        // CR 303.4b — "its controller" behind a host-tapped head is
        // the tapped land's controller, not the Aura's.
        ...(head.kind === "tapped-for-mana" && head.scope === "host"
            ? { landController: { ref: "$event.controllerId" } }
            : {}),
        // CR 603.6a + CR 110.2 — "its controller" / "that land's controller"
        // behind "whenever a land enters" is the entering land's controller
        // (`PERMANENT_ENTERED.controllerId`), not the source's.
        ...(head.kind === "enters" && head.permanentType === "Land"
            ? { landController: { ref: "$event.controllerId" } }
            : {}),
        // CR 106.12 + CR 602.2 — "whenever a player taps a land for mana"
        // names the player who tapped it, the land's controller.
        ...(head.kind === "tapped-for-mana" && head.scope === "any"
            ? { player: { ref: "$event.controllerId" } }
            : {}),
        ...(damagedOpponent !== null
            ? { player: damagedOpponent, opponent: damagedOpponent }
            : {}),
        ...(damagedPlayer !== null ? { player: damagedPlayer } : {}),
        ...(caster !== null ? { player: caster } : {}),
        ...(searcher !== null ? { player: searcher } : {}),
        // CR 603.2 + CR 608.2h — the spell a cast head fired on, for a stack
        // verb ("counter it"); `$event.spell` is the censused stack-object ref.
        ...(head.kind === "spell-cast"
            ? { spell: { ref: "$event.spell" } }
            : {}),
        // CR 120.3 — "that much" after a damage head is the damage dealt;
        // CR 119.9 — after a life-gain head, the life gained. The two-event
        // "gain or lose" head names no one amount, so it gives none.
        ...(head.kind === "damage-dealt" ||
        head.kind === "damage-taken" ||
        head.kind === "life-gained"
            ? { amount: { ref: "$event.amount" } }
            : {}),
        ...(head.kind === "dies" ||
        head.kind === "left-to-graveyard" ||
        head.kind === "graveyard-entry"
            ? { card: { ref: "$event.card" } }
            : {}),
        // CR 404.1 — only a head that pins the card's OWNER to the ability's
        // controller may put it back onto the battlefield: the engine returns
        // a card from a graveyard under the controller's control (CR 110.2a),
        // which is its owner's only here.
        ...(head.kind === "left-to-graveyard" && head.ownedBy === "you"
            ? { cardOwnedByController: true as const }
            : {}),
        // CR 303.4b — "that creature" behind an Aura's host-keyed head is the
        // enchanted creature, whose controller's step the head names.
        ...(head.kind === "phase" && head.scope === "host-controller"
            ? { creature: { ref: "$host" } }
            : {}),
        // CR 303.4b + CR 608.2h — "that creature" behind a head whose
        // subject is the Aura's host (it became tapped, or the target of a
        // spell or ability) is that host.
        ...((head.kind === "becomes-tapped" ||
            head.kind === "becomes-target") &&
        head.scope === "host"
            ? { creature: { ref: "$host" } }
            : {}),
        // CR 120.3 + CR 608.2h — "that creature" behind "deals damage to a
        // creature" is the creature the event dealt damage to.
        ...(head.kind === "damage-dealt" && head.recipient === "creature"
            ? { creature: { ref: "$event.damagedPermanent" } }
            : {}),
        // CR 303.4f — an "enters" head on another creature names the creature
        // an Aura returned by the effect attaches to.
        ...(head.kind === "enters" &&
        head.scope !== "self" &&
        head.creaturesOnly
            ? { enteringCreature: { ref: "$event.instanceId" } }
            : {}),
        // CR 607.2a — "the exiled card" behind the source's own departure
        // names what this object's linked exile instruction exiled. Read
        // here so the sentence parses; the card pass (`linkExile.ts`) then
        // refuses the pair, which no Op encodes without a duration.
        ...(head.kind === "leaves" ? { exiledCard: true as const } : {}),
        // CR 608.2h — "it". `headPronounReferent` is the ONE authority on
        // which object the head named (the grammar refuses the pronoun behind
        // a head that named none), and this turns its answer into the
        // selector: the source, or the attacking / blocking creature the
        // per-creature firing named (CR 508.3a / 509.3a — the censused
        // `$event.combatant` row, ADR 0049).
        ...pronounAntecedent(head),
    };
}

/** The `object` antecedent a head supplies, if any (see `headAntecedents`). */
function pronounAntecedent(head: TriggerHeadIR): {
    readonly object?: EffectObjectSelector;
} {
    const referent = headPronounReferent(head);
    if (referent === null) return {};
    return {
        object:
            referent === "source"
                ? { ref: "$source" }
                : referent === "host"
                  ? { ref: "$host" }
                  : { ref: "$event.combatant" },
    };
}

/**
 * CR 603.4 — the subject of a "controls no" count, as the engine reads it.
 * CR 506.2 — in a two-player game the defending player is the nonactive
 * player, the attacking source controller's one opponent: the same collapse
 * {@link headAntecedents} makes for the body's "defending player".
 */
const CONTROLS_SUBJECT: Record<ControlsSubjectIR, ControlsSubject> = {
    you: "you",
    "defending-player": "opponent",
    "a-player": "any-player",
};

/** CR 603.4 — the condition IR to the engine's shape. */
function lowerCondition(
    condition: TriggerConditionIR,
    head: TriggerHeadIR,
    kickers: readonly KickerCost[]
): CompiledTriggerCondition | string {
    switch (condition.kind) {
        case "kicked-permanent": {
            // CR 702.33e/f — a NAMED kicker's payment record, read off the
            // permanent entering. An unnamed "if it was kicked" reads the same
            // record when the card prints one single kicker: paying that cost
            // is all "kicked" can mean there (CR 702.33d).
            // CR 702.33d — behind "when you cast this spell" the record is the
            // spell's own, and both forms read it.
            const casting = head.kind === "spell-cast" && head.scope === "self";
            if (!casting && (head.kind !== "enters" || head.scope !== "self"))
                return '"if it was kicked" needs a head that fires when this permanent enters';
            if (condition.kicked.kind === "evidence" && casting)
                return '"if evidence was collected" is no gate behind a cast head';
            if (condition.kicked.kind === "gift" && casting)
                return '"if the gift was promised" is no gate behind a cast head';
            const value = kickedValue(condition.kicked, kickers);
            if (!value.ok) return value.reason;
            if (condition.kicked.kind === "any") {
                if (casting) return { kind: "spell-kicked" };
                const [lone, ...others] = kickers;
                return lone !== undefined &&
                    others.length === 0 &&
                    lone.multi !== true &&
                    lone.keyword === undefined
                    ? { kind: "kicker-paid", kickerId: lone.id }
                    : 'an unnamed "if it was kicked" gates a permanent only behind one single kicker (CR 702.33d)';
            }
            const paid = value.value as { additionalCostPaid?: string };
            if (paid.additionalCostPaid === undefined)
                return "a named kicker reads its own payment record";
            return { kind: "kicker-paid", kickerId: paid.additionalCostPaid };
        }
        case "controls": {
            if (!("atMost" in condition))
                return {
                    kind: "controls",
                    filter: condition.filter,
                    atLeast: condition.atLeast,
                };
            // CR 506.2 — "defending player" exists only behind the source's
            // own attack; the head's antecedents are the one authority on
            // that, as they are for the body's "defending player".
            if (
                condition.player === "defending-player" &&
                headAntecedents(head).defendingPlayer === undefined
            )
                return '"defending player" in the condition names no player the head introduced';
            return {
                kind: "controls",
                player: CONTROLS_SUBJECT[condition.player],
                filter: condition.filter,
                atMost: condition.atMost,
            };
        }
        case "controls-at-least":
            // CR 109.5 — "you" is the ability's controller, the shape the
            // singular "if you control a Goblin" lowers to; CR 102.2 — "an
            // opponent" is some opponent meeting the count.
            return condition.player === "you"
                ? {
                      kind: "controls",
                      filter: condition.filter,
                      atLeast: condition.atLeast,
                  }
                : {
                      kind: "controls",
                      player: "opponent",
                      filter: condition.filter,
                      atLeast: condition.atLeast,
                  };
        case "self-has-type":
            return { kind: "self-has-type", type: condition.type };
        case "self-on-battlefield":
            return { kind: "self-on-battlefield" };
        case "you-are-monarch":
            return { kind: "you-are-monarch" };
        case "you-have-max-speed":
            return { kind: "you-have-max-speed" };
        case "controls-more": {
            // CR 603.4 — "that player" must be a player the head introduced,
            // or the comparison is about nobody.
            if (condition.subject === "opponent")
                return {
                    kind: "controls-more",
                    subject: { kind: "opponent" },
                    than: condition.than,
                    filter: condition.filter,
                };
            if (condition.subject === "any-player")
                return {
                    kind: "controls-more",
                    subject: { kind: "any-player" },
                    than: condition.than,
                    filter: condition.filter,
                };
            const eventField = namedPlayerField(head);
            if (eventField === null)
                return '"that player" in the condition names no player the head introduced';
            return {
                kind: "controls-more",
                subject: { kind: "event-player", eventField },
                than: condition.than,
                filter: condition.filter,
            };
        }
        case "self-in-graveyard":
            // CR 404.2 — the bare zone is lowered by the caller, never as a
            // predicate; the pile-order clause is the predicate beside it.
            if (condition.creatureCardAbove === true)
                return { kind: "graveyard-creature-above" };
            return "a graveyard-zone condition is not a board predicate";
        case "basic-land-types": {
            // CR 305.6 — "among lands THAT PLAYER controls": the head must
            // name the player, or the condition counts nobody's lands.
            const eventField = namedPlayerField(head);
            if (eventField === null)
                return '"that player" in the condition names no player the head introduced';
            return {
                kind: "basic-land-types",
                player: { eventField },
                atLeast: condition.atLeast,
            };
        }
        case "no-mana-spent-to-cast":
            // CR 601.2h — "it" is the spell another player's (or any) cast
            // head introduced; "when you cast this spell" prints "this spell".
            return head.kind === "spell-cast" && head.scope !== "self"
                ? { kind: "no-mana-spent-to-cast" }
                : '"no mana was spent to cast it" needs a head that introduced the spell cast';
        case "no-mana-added-by-this-ability-this-turn":
            // The ability's once-per-turn quota, lifted into
            // `maxTriggersPerTurn` by `lowerTriggeredAbility`, never a gate.
            return "a per-turn quota is not a board predicate";
        case "life-changed-this-turn":
            // CR 119.3 + CR 603.4 — the per-turn tallies, the same shape on
            // both sides.
            return {
                kind: "life-changed-this-turn",
                player: condition.player,
                directions: [...condition.directions],
                combine: condition.combine,
            };
    }
}

/** The trigger heads whose `self` scope means the source has left the battlefield. */
const SELF_DEPARTURE_HEADS: ReadonlySet<TriggerHeadIR["kind"]> = new Set([
    "dies",
    "leaves",
    "left-to-graveyard",
    "enters-or-leaves",
    "sacrificed",
]);

/** CR 301.5a / CR 303.4b — the sentence acts on the source's host. */
function readsHost(sentence: EffectSentenceIR): boolean {
    return namesHost(sentence);
}

/** CR 113.6b — a (possibly optional) "return this card from your graveyard". */
function returnsSelfFromGraveyard(sentence: EffectSentenceIR): boolean {
    if (sentence.kind === "optional")
        return returnsSelfFromGraveyard(sentence.effect);
    return sentence.kind === "return-self-from-graveyard";
}

export function lowerTriggeredAbility(input: {
    readonly id: string;
    readonly oracleText: string;
    /** CR 201.5 — the card's printed name, for the prompts a body emits. */
    readonly cardName: string;
    readonly head: TriggerHeadIR;
    readonly condition?: TriggerConditionIR;
    /** CR 603.2 — "This ability triggers only twice each turn." */
    readonly maxTriggersPerTurn?: number;
    readonly effects: readonly EffectSentenceIR[];
    /** CR 702.33e — the card's kicker costs, for a sentence that reads them. */
    readonly kickers?: readonly KickerCost[];
    /** CR 107.3m — the card's printed mana cost has an {X} pip. */
    readonly castX?: boolean;
}): LowerTriggerResult {
    // CR 113.6b — "if this card is in your graveyard" is the ability's zone.
    // Only a phase head or another-permanent "enters" head has a factory that
    // functions from the graveyard.
    // CR 113.6b — a body that returns the SOURCE from the graveyard names the
    // zone it functions from (Squee, Goblin Nabob).
    const fromGraveyard =
        input.condition?.kind === "self-in-graveyard" ||
        input.effects.some(returnsSelfFromGraveyard);
    // Only the "if this card is in your graveyard" condition IS the zone; any
    // other intervening-if still lowers to a predicate.
    const zoneCondition =
        input.condition?.kind === "self-in-graveyard" &&
        input.condition.creatureCardAbove !== true;
    // CR 113.6b — an "enters" head on ANOTHER permanent (scope not `self`) also
    // has a graveyard-zone factory: `enteredTrigger` takes the zone, and the
    // graveyard scan fires it when a different permanent enters.
    const graveyardCapableHead =
        input.head.kind === "phase" ||
        (input.head.kind === "enters" && input.head.scope !== "self");
    if (fromGraveyard && !graveyardCapableHead)
        return {
            ok: false,
            reason: 'a graveyard-zone ability needs an "at the beginning of" or another-permanent "enters" head (CR 113.6b)',
        };
    // CR 603.4 — the cycled factory takes no intervening-if, so a condition
    // behind this head would be dropped silently: refuse it instead.
    // The state trigger likewise has no gate of its own beyond its predicate.
    if (
        (input.head.kind === "cycled" || input.head.kind === "power-reached") &&
        input.condition !== undefined
    )
        return {
            ok: false,
            reason: "an intervening-if behind a cycle head is not read",
        };
    // CR 603.4 — "if you haven't added mana with this ability this turn" is
    // the ability's once-per-turn quota, not a gate: only the phase factory
    // carries the cap, so any other head refuses rather than drop it.
    const onceEachTurn =
        input.condition?.kind === "no-mana-added-by-this-ability-this-turn";
    if (onceEachTurn && input.head.kind !== "phase")
        return {
            ok: false,
            reason: '"if you haven\'t added mana with this ability this turn" needs an "at the beginning of" head',
        };
    // CR 603.2 — "for the first time each turn" is the ability's own cap of
    // one; a printed limit sentence beside it would be a second count the
    // one `maxTriggersPerTurn` cannot hold, so the pair is refused.
    const firstTimeEachTurn =
        input.head.kind === "becomes-target" &&
        input.head.firstTimeEachTurn === true;
    if (
        firstTimeEachTurn &&
        (input.maxTriggersPerTurn !== undefined || onceEachTurn)
    )
        return {
            ok: false,
            reason: '"for the first time each turn" beside a second per-turn limit is not read',
        };
    // CR 603.2 — only a head whose factory counts triggerings per source can
    // carry the cap; any other refuses rather than drop it. The graveyard scan
    // does not count them either, so the cap would be lost there.
    if (
        input.maxTriggersPerTurn !== undefined &&
        (onceEachTurn ||
            fromGraveyard ||
            (input.head.kind !== "phase" &&
                input.head.kind !== "becomes-target" &&
                input.head.kind !== "life-gained" &&
                input.head.kind !== "life-gained-or-lost"))
    )
        return {
            ok: false,
            reason: "a per-turn trigger limit behind this head is not read",
        };
    // The graveyard scan does not count triggerings, so the cap would be lost.
    if (onceEachTurn && fromGraveyard)
        return {
            ok: false,
            reason: "a per-turn quota is not counted on a graveyard-zone ability",
        };
    // CR 603.10a + CR 301.5a — a leaves-the-battlefield trigger of the source
    // itself resolves after the Equipment has left, so "equipped creature"
    // would need the host as last-known information, which `$host` (seeded
    // from the live attachment) does not carry: refused rather than inert.
    // CR 303.4b — the same holds when the departing object IS the host ("when
    // enchanted creature dies, … enchanted creature"): it is gone by the time
    // the ability resolves, so `$host` names nothing.
    if (
        "scope" in input.head &&
        (input.head.scope === "self" || input.head.scope === "host") &&
        SELF_DEPARTURE_HEADS.has(input.head.kind) &&
        input.effects.some(readsHost)
    )
        return {
            ok: false,
            reason: "a leaves-the-battlefield trigger cannot read its source's host from the live attachment (CR 603.10a)",
        };
    const condition =
        input.condition !== undefined && !zoneCondition && !onceEachTurn
            ? lowerCondition(input.condition, input.head, input.kickers ?? [])
            : undefined;
    if (typeof condition === "string") return { ok: false, reason: condition };
    const headAntecedentsRead = headAntecedents(input.head);
    // CR 608.2c — a head whose subject is not the source names a creature a
    // later "that creature" may mean, beside any target the body announces.
    const antecedents: SiteAntecedents =
        "scope" in input.head && input.head.scope !== "self"
            ? { ...headAntecedentsRead, headSubjectIsObject: true as const }
            : headAntecedentsRead;
    // CR 608.2h — the head's "it" reaches the FIRST sentence and no further.
    // Every later sentence has a nearer antecedent by construction — the
    // object the sentence before it created, drew, moved or acted on ("…,
    // create a 1/1 Soldier token. Destroy it") — and the lowering can see only
    // some of those (an ANNOUNCED target, `selectorsFor`). Reading past the
    // first sentence would therefore bind "it" to the head's referent in
    // exactly the cases where it means something else, so the referent is
    // dropped instead and the pronoun is refused: the fail-closed half of
    // ADR 0105 § 2, a form earning its way back in with a rule and a fixture.
    const laterAntecedents: SiteAntecedents = {
        ...antecedents,
        ...(antecedents.object !== undefined
            ? { headNamedObject: true as const }
            : {}),
    };
    delete (laterAntecedents as { object?: unknown }).object;
    // CR 608.2h — "its controller" after the first sentence may mean an
    // object that sentence acted on, so the head's land is withheld there too.
    delete (laterAntecedents as { landController?: unknown }).landController;
    // CR 608.2b — "This ability still resolves if its target becomes
    // illegal" is the ability's, whichever sentence carries it. Only an
    // entered head's factory forwards it.
    const resolvesIfTargetsIllegal =
        input.head.kind === "enters" &&
        input.head.scope === "self" &&
        input.effects.some(
            (e) => e.kind === "exchange-control" && e.resolvesIfTargetIllegal
        );
    // CR 504.1 — "at the beginning of your draw step" fires after the
    // turn-based draw, the draw a body's "additional cards" are counted from.
    const ownDrawStep =
        input.head.kind === "phase" &&
        input.head.phase === "DRAW" &&
        input.head.scope === "your" &&
        input.head.phases === undefined;
    const sourceCastX =
        input.castX === true &&
        input.head.kind === "enters" &&
        input.head.scope === "self";
    const walk = new SentenceWalk(
        new TargetSlots(anotherExcludesSource(input.head))
    );
    const ops: EffectOp[] = [];
    for (const [index, sentence] of input.effects.entries()) {
        // CR 107.3 — a triggered ability has no cost and announces nothing,
        // so an X in its body has no value to read — except, CR 107.3m, the
        // card's own enters trigger, whose X is the one its spell was cast
        // with.
        const result = lowerSentence(sentence, walk, {
            allowX: false,
            ...(sourceCastX ? { sourceCastX: true as const } : {}),
            functionsFromGraveyard: fromGraveyard,
            ...(ownDrawStep ? { ownDrawStep: true as const } : {}),
            ...(resolvesIfTargetsIllegal
                ? { resolvesIfTargetsIllegal: true as const }
                : {}),
            selfName: input.cardName,
            antecedents: index === 0 ? antecedents : laterAntecedents,
            ...(input.kickers !== undefined ? { kickers: input.kickers } : {}),
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        ops.push(...result.value);
    }

    // CR 702.33g — as on the activated site, and unreachable for the same
    // reason: no `kickedTargetRequirement` twin on a triggered ability, so the
    // swap has nowhere to land if the grammar ever reads one here.
    if (walk.targets.kickedRequirement() !== undefined)
        return {
            ok: false,
            reason: "an ability cannot swap in a kicked target announcement (CR 702.33g)",
        };
    // CR 702.33g (issue #4220) — the OTHER encoding, refused here for the same
    // reason: only a SPELL's announcement filters its group list by the kicker
    // payment (`castAnnouncedTargetGroups`), so a gated group declared at this
    // site would be announced on every activation.
    if (walk.targets.hasKickerGatedGroup())
        return {
            ok: false,
            reason: "an ability cannot announce a target only if kicked (CR 702.33g)",
        };
    // CR 603.3d — a triggered ability's targets are announced as it goes on
    // the stack. `declareTargets` writes at most one and REFUSES more: the
    // engine can walk a trigger's `additionalTargetRequirements` (issue #8475),
    // but no compiled descriptor carries them yet.
    const declared: { targetRequirement?: TargetRequirement } = {};
    const targetError = declareTargets(declared, walk.targets.requirements());
    if (targetError !== null) return { ok: false, reason: targetError };

    return {
        ok: true,
        ability: {
            id: input.id,
            oracleText: input.oracleText,
            head: lowerHead(input.head),
            ...(condition !== undefined ? { condition } : {}),
            ...(onceEachTurn || firstTimeEachTurn
                ? { maxTriggersPerTurn: 1 }
                : {}),
            ...(input.maxTriggersPerTurn !== undefined
                ? { maxTriggersPerTurn: input.maxTriggersPerTurn }
                : {}),
            ...(fromGraveyard ? { zone: "graveyard" as const } : {}),
            ...(resolvesIfTargetsIllegal
                ? { resolvesIfTargetsIllegal: true as const }
                : {}),
            ...(declared.targetRequirement !== undefined
                ? { targetRequirement: declared.targetRequirement }
                : {}),
            effects:
                condition?.kind === "kicker-paid" ||
                condition?.kind === "spell-kicked"
                    ? // CR 603.4 — the load-bearing resolution-time gate, which
                      // also covers an ability COPY (CR 707.10) that never
                      // re-ran the check-time condition.
                      [
                          {
                              op: "if",
                              predicate: {
                                  left:
                                      condition.kind === "kicker-paid"
                                          ? {
                                                additionalCostPaid:
                                                    condition.kickerId,
                                            }
                                          : { kickerCount: true },
                                  op: "ge",
                                  right: 1,
                              },
                              then: ops,
                          },
                      ]
                    : ops,
        },
    };
}
