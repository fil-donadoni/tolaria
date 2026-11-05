// Persist (CR 702.79) and Undying (CR 702.93): one sentence differing only in the
// counter kind, so `returnWithCounterTrigger` takes that kind as its only axis.
//
// Both reach a permanent printed or through a grant, so the trigger comes from the
// live keyword multiset (`liveKeywordTriggers.ts`), never from the definition: each
// occurrence is one instance. A second instance's return finds no card (CR 400.7).
//
// The source has left when this triggers. CR 603.10a makes it look back, and the
// look-back (`lookBackSelf`, `gre/copy.ts`) answers with the multiset the permanent
// left with: a grant counts though its source or duration is gone by the scan.

import type { PermanentLeftEvent, TriggeredAbility } from "../types";
import { leftTrigger } from "./triggers/leftTrigger";

export const PERSIST_KEYWORD = "persist";
export const UNDYING_KEYWORD = "undying";

/** The trigger for one counter kind; the prose reads for persist, and undying is
 *  the same with "+1/+1" in both places (a Young Wolf comes back a 2/2).
 *
 *  THE EVENT. "This permanent is put into a graveyard from the battlefield": a
 *  `PERMANENT_LEFT` with `toZone: "graveyard"`, NOT `CREATURE_DIED`, because the
 *  rule says permanent, and a persist creature that has stopped being a creature
 *  still persists when it is destroyed. A departure a replacement sends elsewhere
 *  (exiled instead, CR 614.1a) is not one, and the event's `toZone` says so.
 *
 *  THE CONDITION. "If it had no -1/-1 counters on it" is an intervening-if (CR
 *  603.4: checked as it triggers and again on resolution) read off the event's
 *  `countersBeforeLeave` last known information. Never off the card in the
 *  graveyard: that is a new object (CR 400.7) whose counters ceased to exist (CR
 *  122.2), so the condition would always hold and the permanent would return
 *  forever. The snapshot is immutable, so the re-check answers as the first did.
 *  A -1/-1 counter removed by CR 704.5q annihilation in an EARLIER check is gone
 *  (the Kitchen Finks loop); one annihilated in the SAME check that killed it is
 *  still in the snapshot (CR 704.8).
 *
 *  THE RETURN. One `moveZone` of `$source` from the graveyard to the battlefield.
 *  "Under its OWNER's control" is that branch's default, and naming `controller`
 *  would be the bug: the trigger is controlled by whoever last controlled the
 *  permanent (CR 603.3a), not its owner. "With a -1/-1 counter on it" is
 *  `entersWithCounters`, given AS it enters (CR 614.1c), so every "whenever a
 *  creature enters" watcher sees it. It is a new object: no damage, no old
 *  counters, no attachments, no grant, summoning sick. A card that has left the
 *  graveyard before resolution cannot be found, and a token is never returned (CR
 *  111.7): the Op is a clean no-op either way. */
function returnWithCounterTrigger(spec: {
    id: string;
    oracleText: string;
    counter: string;
}): TriggeredAbility {
    const hadNoCounter = (event: PermanentLeftEvent): boolean =>
        (event.countersBeforeLeave?.[spec.counter] ?? 0) <= 0;
    return leftTrigger({
        id: spec.id,
        oracleText: spec.oracleText,
        scope: "self",
        toZone: "graveyard",
        // CR 603.4: as it triggers (`condition`, so one that died with the counter
        // never goes on the stack) AND on resolution (`interveningIf`).
        condition: hadNoCounter,
        interveningIf: hadNoCounter,
        effects: [
            {
                op: "moveZone",
                target: { ref: "$source" },
                from: "graveyard",
                to: "battlefield",
                entersWithCounters: { [spec.counter]: 1 },
            },
        ],
    });
}

/** CR 702.79a. */
export const PERSIST_TRIGGER: TriggeredAbility = returnWithCounterTrigger({
    id: "persist",
    oracleText:
        "Persist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)",
    counter: "-1/-1",
});

/** CR 702.93a. */
export const UNDYING_TRIGGER: TriggeredAbility = returnWithCounterTrigger({
    id: "undying",
    oracleText:
        "Undying (When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner's control with a +1/+1 counter on it.)",
    counter: "+1/+1",
});
