// Evolve (CR 702.100a) — "Whenever a creature you control enters, if that
// creature's power is greater than this creature's power and/or that creature's
// toughness is greater than this creature's toughness, put a +1/+1 counter on
// this creature."
//
// Expanded from the bare `staticAbilities: ["evolve"]` string by
// `expandKeywordTriggers` (`keywordTriggers.ts`, ADR 0054), one trigger per
// instance: CR 702.100d — multiple instances each trigger separately, and the
// second to resolve checks again against the counter the first one put on.

import type { PermanentFilter } from "../filters";
import { readEffectivePT } from "../effectivePT";
import type {
    CounterAddedEvent,
    EffectOp,
    PermanentEnteredEvent,
    PermanentView,
    TriggeredAbility,
    TriggerStateView,
} from "../types";
import { counterAddedTrigger } from "./triggers/counterAddedTrigger";
import { enteredTrigger } from "./triggers/enteredTrigger";

export const EVOLVE_KEYWORD = "evolve";
export const EVOLVE_TRIGGER_ID = "evolve";

const PLUS_ONE_COUNTER = "+1/+1";
const CREATURE_FILTER: PermanentFilter = { types: "Creature" };

interface Stats {
    readonly power: number;
    readonly toughness: number;
}

function liveStats(self: PermanentView, state?: TriggerStateView): Stats {
    return state
        ? readEffectivePT(self, state)
        : { power: self.power ?? 0, toughness: self.toughness ?? 0 };
}

/** The entering creature's power and toughness now, or `undefined` once it is
 *  no creature: a noncreature permanent has neither (CR 208.3).
 *
 *  An object that has left since the trigger went on the stack answers with
 *  its last known information (CR 608.2h), stamped by `removePermanentTo` as
 *  `departedAs`. That stamp wins over the live lookup because a same-id
 *  permanent back on the battlefield is a new object (CR 400.7). With neither,
 *  the creature left before the trigger was even collected, and the event's own
 *  entry snapshot is the last thing known of it. */
function enteredStats(
    event: PermanentEnteredEvent,
    state?: TriggerStateView
): Stats | undefined {
    if (event.departedAs) {
        return event.departedAs.isCreature ? event.departedAs : undefined;
    }
    for (const player of state?.players ?? []) {
        const live = player.battlefield.find((c) => c.id === event.instanceId);
        if (live) {
            return live.types.includes("Creature")
                ? liveStats(live as unknown as PermanentView, state)
                : undefined;
        }
    }
    if (event.power === undefined || event.toughness === undefined) {
        return undefined;
    }
    return { power: event.power, toughness: event.toughness };
}

/** The intervening-if of CR 702.100a, checked as the ability triggers and again
 *  as it resolves (CR 603.4). Power is compared to power and toughness to
 *  toughness, never across. A noncreature source fails it: a creature can't
 *  have a greater power or toughness than a noncreature permanent (CR 702.100c). */
function enteredCreatureOutgrowsSource(
    event: PermanentEnteredEvent,
    self: PermanentView,
    state?: TriggerStateView
): boolean {
    if (!self.types.includes("Creature")) return false;
    const entered = enteredStats(event, state);
    if (!entered) return false;
    const source = liveStats(self, state);
    return entered.power > source.power || entered.toughness > source.toughness;
}

/** Evolve's CR 702.100a triggered ability. The source entering is no special
 *  case: it is never greater than itself. */
export function evolveTrigger(): TriggeredAbility {
    return enteredTrigger({
        id: EVOLVE_TRIGGER_ID,
        oracleText:
            "Evolve (Whenever a creature you control enters, if that creature has greater power or toughness than this creature, put a +1/+1 counter on this creature.)",
        scope: "yours",
        filter: CREATURE_FILTER,
        condition: enteredCreatureOutgrowsSource,
        interveningIf: enteredCreatureOutgrowsSource,
        effects: [
            {
                op: "counters",
                action: "add",
                counter: PLUS_ONE_COUNTER,
                target: { ref: "$source" },
                count: 1,
            },
        ],
    });
}

/** CR 702.100b — a creature "evolves" when one or more +1/+1 counters are put on
 *  it as a result of its evolve ability resolving. A replacement that leaves no
 *  counter announces nothing, so the creature has not evolved, and one that adds
 *  to the count is still one event. */
function isEvolution(event: CounterAddedEvent): boolean {
    return event.byTriggeredAbilityId === EVOLVE_TRIGGER_ID;
}

/** "Whenever this creature evolves, …" (CR 702.100b): the engine half a card
 *  printing that line builds on. */
export function evolvedTrigger(args: {
    id: string;
    oracleText: string;
    effects: EffectOp[];
}): TriggeredAbility {
    return counterAddedTrigger({
        ...args,
        scope: "self",
        counterType: PLUS_ONE_COUNTER,
        condition: isEvolution,
    });
}
