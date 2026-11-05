// Triggered keywords derived from a permanent's LIVE keyword multiset.
//
// These keywords can arrive at runtime, through a static or a one-shot grant. The
// `getDefinition` keyword expansion reads only the printed list, so it would miss
// those. `card.staticAbilities` (`gre/layer6.ts`) already holds every grant, and a
// removal or a "loses all abilities" (CR 613.1f) has already taken the occurrence
// out. One occurrence is one instance of the keyword, and fires its own trigger,
// unless a row says `perPermanent`.
//
// Instances of one keyword are identical objects with one id, so `triggerOrderKey`
// auto-orders them: their order cannot change the outcome (ADR 0003).

import type { TriggeredAbility } from "../types";
import { DETHRONE_KEYWORD, DETHRONE_TRIGGER } from "./dethrone";
import { ENLIST_KEYWORD, ENLIST_TRIGGER } from "./enlist";
import { FLANKING_KEYWORD, FLANKING_TRIGGER } from "./flanking";
import { MELEE_KEYWORD, MELEE_TRIGGER } from "./melee";
import { PROVOKE_KEYWORD, PROVOKE_TRIGGER } from "./provoke";
import {
    PERSIST_KEYWORD,
    PERSIST_TRIGGER,
    UNDYING_KEYWORD,
    UNDYING_TRIGGER,
} from "./returnWithCounter";
import { TRAINING_KEYWORD, TRAINING_TRIGGER } from "./training";

const LIVE_KEYWORD_TRIGGERS: ReadonlyArray<{
    keyword: string;
    ability: TriggeredAbility;
    /** One ability however many occurrences: each firing event already stands
     *  for one instance. Enlist raises one event per cost paid, so a trigger per
     *  occurrence would fire twice for each payment (CR 702.154d). */
    perPermanent?: true;
}> = [
    { keyword: FLANKING_KEYWORD, ability: FLANKING_TRIGGER },
    { keyword: DETHRONE_KEYWORD, ability: DETHRONE_TRIGGER },
    { keyword: ENLIST_KEYWORD, ability: ENLIST_TRIGGER, perPermanent: true },
    { keyword: PROVOKE_KEYWORD, ability: PROVOKE_TRIGGER },
    { keyword: TRAINING_KEYWORD, ability: TRAINING_TRIGGER },
    { keyword: MELEE_KEYWORD, ability: MELEE_TRIGGER },
    { keyword: PERSIST_KEYWORD, ability: PERSIST_TRIGGER },
    { keyword: UNDYING_KEYWORD, ability: UNDYING_TRIGGER },
];

/** One ability per occurrence of each table keyword in the multiset, or one for a
 *  `perPermanent` row that has any. A client slim stack item may carry no list at
 *  all. */
export function liveKeywordTriggerInstances(
    staticAbilities: ReadonlyArray<string> | undefined
): TriggeredAbility[] {
    if (!staticAbilities) return [];
    return LIVE_KEYWORD_TRIGGERS.flatMap(
        ({ keyword, ability, perPermanent }) => {
            const occurrences = staticAbilities.filter((k) => k === keyword);
            return (perPermanent ? occurrences.slice(0, 1) : occurrences).map(
                () => ability
            );
        }
    );
}

/** The stack text of a trigger that no definition lists, by its ability id. */
export function liveKeywordTriggerOracleText(
    triggeredAbilityId: string
): string | null {
    const row = LIVE_KEYWORD_TRIGGERS.find(
        ({ ability }) => ability.id === triggeredAbilityId
    );
    return row?.ability.oracleText ?? null;
}
