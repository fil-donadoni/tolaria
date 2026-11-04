// Mentor (CR 702.134) — a TRIGGERED-ability keyword expanded from the bare
// `staticAbilities` string at the `getDefinition` seam (ADR 0054). A card
// declares only `staticAbilities: ["mentor"]`; `expandMentor` injects the attack
// trigger, so a card can neither print the keyword and enforce nothing nor carry
// the trigger without the keyword.
//
// CR 702.134a — "Whenever this creature attacks, put a +1/+1 counter on target
// attacking creature with power less than this creature's power." The power
// comparison is part of the TARGET, so it is `powerBelowSource`: checked as the
// trigger goes on the stack, and again by the CR 608.2b gate, which reads the
// source's last known information if the source has left.
//
// CR 702.134b — each instance triggers separately: one injected entry per
// matching string. Identical instances share an id, so they auto-order instead
// of raising a CR 603.3b prompt between two identical abilities.
//
// CR 702.134c — "mentors" happens when the ability RESOLVES. `mentorResolution`
// tells the resolution path to queue `CREATURE_MENTORED`; a fizzled mentor
// (CR 608.2b) reaches no such point.

import type { CardDefinition, TriggeredAbility } from "../types";
import { attacksTrigger } from "./triggers/attacksTrigger";

const MENTOR_KEYWORD = "mentor";
const MENTOR_TRIGGER_ID = "mentor";

const MENTOR_ORACLE_TEXT =
    "Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)";

/** CR 702.134a — the synthesized attack trigger for one instance of mentor. */
export function mentorTrigger(): TriggeredAbility {
    return {
        ...attacksTrigger({
            id: MENTOR_TRIGGER_ID,
            oracleText: MENTOR_ORACLE_TEXT,
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
                powerBelowSource: true,
            },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        }),
        mentorResolution: true,
    };
}

/** ADR 0054 keyword expansion — injects one CR 702.134a trigger per declared
 *  instance of mentor (CR 702.134b). Returns the input unchanged without the
 *  keyword; never mutates it; idempotent. */
export function expandMentor(def: CardDefinition): CardDefinition {
    const instances = (def.staticAbilities ?? []).filter(
        (s) => s.trim().toLowerCase() === MENTOR_KEYWORD
    );
    if (instances.length === 0) return def;
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === MENTOR_TRIGGER_ID)) return def;
    return {
        ...def,
        triggeredAbilities: [...existing, ...instances.map(mentorTrigger)],
    };
}
