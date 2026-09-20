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
import type {
    CompiledTriggerCondition,
    CompiledTriggerHead,
    CompiledTriggeredAbility,
} from "../cards/compiledTriggers";
import type {
    EffectObjectSelector,
    EffectOp,
    KickerCost,
    TargetRequirement,
} from "../cards/types";
import type { TriggerConditionIR } from "./grammar/shared/condition";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import {
    headPronounReferent,
    type TriggerHeadIR,
} from "./grammar/shared/triggerHead";
import {
    declareTargets,
    lowerSentence,
    SentenceWalk,
    type SiteAntecedents,
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
                      filter: CREATURE_FILTER,
                  }
                : { kind: "entered", scope: head.scope };
        case "dies":
            // CR 603.6 — the event IS `CREATURE_DIED`, so the head carries no
            // type filter: a second authority on the same fact is a second
            // thing to get wrong.
            return { kind: "died", scope: head.scope };
        case "attacks":
            // CR 508.3a — `self` is the head as it shipped before the scoped
            // reading existed, and the field is OMITTED there rather than
            // written: a compiled "whenever this creature attacks" must stay
            // the same descriptor it has always been, byte for byte, or every
            // such card churns in the lockfile for no behaviour change.
            return head.scope === "self"
                ? { kind: "attacks" }
                : { kind: "attacks", scope: head.scope };
        case "attacks-or-blocks":
            return { kind: "attacks-or-blocks", scope: head.scope };
        case "combat-damage-to-player":
            return { kind: "combat-damage-to-player" };
        case "damage-dealt":
            return {
                kind: "damage-dealt",
                source: head.source,
                recipient: head.recipient,
            };
        case "damage-taken":
            return { kind: "damage-taken", scope: head.scope };
        case "phase":
            return { kind: "phase", phase: head.phase, scope: head.scope };
        case "spell-cast":
            return head.filter !== undefined
                ? { kind: "spell-cast", scope: head.scope, filter: head.filter }
                : { kind: "spell-cast", scope: head.scope };
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
    return {
        ...(playerField !== null
            ? { player: { ref: `$event.${playerField}` } }
            : {}),
        ...(damagedOpponent !== null
            ? { player: damagedOpponent, opponent: damagedOpponent }
            : {}),
        // CR 120.3 — "that much" after a damage head is the damage dealt.
        ...(head.kind === "damage-dealt" || head.kind === "damage-taken"
            ? { amount: { ref: "$event.amount" } }
            : {}),
        ...(head.kind === "dies" ? { card: { ref: "$event.card" } } : {}),
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
                : { ref: "$event.combatant" },
    };
}

/** CR 603.4 — the condition IR to the engine's shape. */
function lowerCondition(
    condition: TriggerConditionIR,
    head: TriggerHeadIR
): CompiledTriggerCondition | string {
    switch (condition.kind) {
        case "controls":
            return {
                kind: "controls",
                filter: condition.filter,
                atLeast: condition.atLeast,
            };
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
    }
}

export function lowerTriggeredAbility(input: {
    readonly id: string;
    readonly oracleText: string;
    /** CR 201.5 — the card's printed name, for the prompts a body emits. */
    readonly cardName: string;
    readonly head: TriggerHeadIR;
    readonly condition?: TriggerConditionIR;
    readonly effects: readonly EffectSentenceIR[];
    /** CR 702.33e — the card's kicker costs, for a sentence that reads them. */
    readonly kickers?: readonly KickerCost[];
}): LowerTriggerResult {
    const condition =
        input.condition !== undefined
            ? lowerCondition(input.condition, input.head)
            : undefined;
    if (typeof condition === "string") return { ok: false, reason: condition };
    const antecedents = headAntecedents(input.head);
    const walk = new SentenceWalk();
    const ops: EffectOp[] = [];
    for (const sentence of input.effects) {
        // CR 107.3 — a triggered ability has no cost and announces nothing,
        // so an X in its body has no value to read.
        const result = lowerSentence(sentence, walk, {
            allowX: false,
            selfName: input.cardName,
            antecedents,
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
    // CR 603.3d — a triggered ability's targets are announced as it goes on
    // the stack. `declareTargets` writes at most one and REFUSES more, which
    // is the same ceiling and the same refusal the activated site pays.
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
            ...(declared.targetRequirement !== undefined
                ? { targetRequirement: declared.targetRequirement }
                : {}),
            effects: ops,
        },
    };
}
