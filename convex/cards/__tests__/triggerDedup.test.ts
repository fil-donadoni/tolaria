// Catalogue-wide guard for the multi-event trigger standard (CR 603.2).
//
// A single Oracle sentence that fires on several distinct engine events — the
// canonical case is "put into a graveyard from anywhere" = CREATURE_DIED +
// CARD_DISCARDED + CARD_MILLED — MUST be expressed as ONE `TriggeredAbility`
// with an ARRAY `event: GameEventType[]`, matched by the engine's trigger scan
// (`triggerHandlesEventType`, gre/triggers.ts). The obsolete shape emits one
// near-duplicate ability per event kind; every duplicate renders the SAME
// Oracle line again on the stack / in the inspector (Worldspine Wurm showed its
// shuffle clause three times — the bug this guard prevents from recurring).
//
// The guard flags the COLLAPSIBLE shape only: two+ triggered abilities with the
// SAME `oracleText` that listen on DISTINCT scalar `event` kinds. That pair is
// exactly the multi-event case an array-`event` subsumes. A same-`oracleText`
// pair sharing ONE event kind is a different pattern (role discrimination in
// `matches` + distinct `$event` captures, e.g. Venom's attacker-vs-blocker
// split) that an array `event` cannot express — not flagged here.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { GameEventType } from "../types";

describe("Trigger dedup — one Oracle line = one TriggeredAbility (CR 603.2)", () => {
    it("no card splits one oracleText across DISTINCT scalar-event triggers", () => {
        const offenders: string[] = [];

        for (const card of getAllCards()) {
            const triggers = card.triggeredAbilities ?? [];
            if (triggers.length < 2) continue;

            // Per oracleText, gather the set of distinct scalar event kinds. An
            // array `event` is already the collapsed form and is exempt.
            const eventsByOracle = new Map<string, Set<GameEventType>>();
            for (const t of triggers) {
                if (Array.isArray(t.event)) continue;
                const set = eventsByOracle.get(t.oracleText) ?? new Set();
                set.add(t.event);
                eventsByOracle.set(t.oracleText, set);
            }
            for (const [oracle, events] of eventsByOracle) {
                if (events.size > 1) {
                    offenders.push(
                        `${card.name}: "${oracle.slice(0, 55)}" split across ${[...events].join(" + ")} — collapse into one array-\`event\` trigger`
                    );
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
