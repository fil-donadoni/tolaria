// Suspend (CR 702.62) — the keyword's two exile-zone triggered abilities,
// expanded implicitly from the `"suspend N"` keyword string (ADR 0054).
//
// 702.62a Suspend is a keyword that represents three abilities. The first is a
//         static ability that functions while the card with suspend is in a
//         player's hand. The second and third are triggered abilities that
//         function in the exile zone. "Suspend N—[cost]" means "If you could
//         begin to cast this card by putting it onto the stack from your hand,
//         you may pay [cost] and exile it with N time counters on it. This
//         action doesn't use the stack," and "At the beginning of your upkeep,
//         if this card is suspended, remove a time counter from it," and "When
//         the last time counter is removed from this card, if it's exiled, you
//         may play it without paying its mana cost if able. If you don't, it
//         remains exiled. If you cast a creature spell this way, it gains
//         haste until you lose control of the spell or the permanent it
//         becomes."
// 702.62b A card is "suspended" if it's in the exile zone, has suspend, and has
//         a time counter on it.
//
// Three abilities, two homes — the Impending shape (`impending.ts`):
//   1. The STATIC hand ability is a special action (CR 116.2f), engine
//      infrastructure in `convex/gre/suspend.ts`: the cost is
//      `CardDefinition.suspend`, N is read off this module's keyword string.
//   2. The two TRIGGERED abilities are injected here, at the `getDefinition`
//      seam, from the one `"suspend N"` string — so a card declares the
//      keyword and the cost and nothing else, and can never print suspend
//      with nothing enforcing it. Both carry `zone: "exile"` (CR 113.6b), the
//      All Hallow's Eve path of `collectTriggers`' zone scan.
//
// The third ability is Vanishing's "when the last time counter is removed"
// shape (CR 702.63a) keyed off `COUNTER_REMOVED` reaching zero, so it fires
// however the last counter leaves — the upkeep removal or any other effect.
// Its body is the shipped `castDuringResolution` Op naming the card itself
// (`{ thisCard: true }`), free, land-inclusive ("play it"), with the haste
// rider; a decline or an impossible cast leaves the card where it is, which is
// "it remains exiled" — no clause of its own.
//
// 702.62c (the "could begin to cast" check honours prohibitions) and 702.62d
// (the free cast follows the alternative-cost rules) are the special action's
// and the Op's respectively: `couldBeginToCastFromHand` (gre/suspend.ts) and
// `castChosenSpell`'s `free` leg.

import type {
    CardDefinition,
    GameEvent,
    PermanentView,
    TriggerStateView,
    TriggeredAbility,
} from "../types";
import { phaseTrigger } from "./triggers/phaseTrigger";

/** CR 702.62a — the counter suspend counts down. */
export const SUSPEND_TIME_COUNTER = "time";

const SUSPEND_PATTERN = /^suspend (\d+)$/i;

/** Ids of the two synthesized triggered abilities. */
export const SUSPEND_UPKEEP_TRIGGER_ID = "suspend-upkeep";
export const SUSPEND_CAST_TRIGGER_ID = "suspend-last-counter";

/** `N` from a card's `"suspend N"` keyword string, or null when the card
 *  carries none. */
export function parseSuspend(
    staticAbilities: readonly string[] | undefined
): number | null {
    const abilityList = staticAbilities ?? [];
    for (let i = 0; i < abilityList.length; i++) {
        const match = SUSPEND_PATTERN.exec(abilityList[i]);
        if (match) return Number(match[1]);
    }
    return null;
}

/** The exiled card `id`, wherever its owner's exile is, or undefined. */
function exiledCard(
    state: TriggerStateView | undefined,
    id: string
): { counters?: Readonly<Record<string, number>> } | undefined {
    const playerList = state?.players ?? [];
    for (let i = 0; i < playerList.length; i++) {
        const found = playerList[i].exile?.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

/** CR 702.62b — the source of a suspend trigger is suspended: in exile, with
 *  a time counter on it. "Has suspend" needs no read here: the trigger exists
 *  only on a card whose definition carries the keyword (the expansion below
 *  is its one author), and no effect removes an exiled card's abilities. */
function isSuspendedIn(
    state: TriggerStateView | undefined,
    self: Pick<PermanentView, "id">
): boolean {
    const card = exiledCard(state, self.id);
    return (card?.counters?.[SUSPEND_TIME_COUNTER] ?? 0) > 0;
}

/** CR 702.62a — the second ability: "At the beginning of your upkeep, if this
 *  card is suspended, remove a time counter from it." An intervening-if (CR
 *  603.4), checked as the step begins and again on resolution. */
function suspendUpkeepTrigger(): TriggeredAbility {
    return phaseTrigger({
        id: SUSPEND_UPKEEP_TRIGGER_ID,
        oracleText:
            "At the beginning of your upkeep, if this card is suspended, remove a time counter from it.",
        phase: "UPKEEP",
        scope: "your",
        zone: "exile",
        interveningIf: (_event, self, state) => isSuspendedIn(state, self),
        effects: [
            {
                op: "counters",
                action: "remove",
                counter: SUSPEND_TIME_COUNTER,
                target: { ref: "$source" },
                count: 1,
            },
        ],
    });
}

/** CR 702.62a — the third ability: "When the last time counter is removed
 *  from this card, if it's exiled, you may play it without paying its mana
 *  cost if able. If you don't, it remains exiled. If you cast a creature spell
 *  this way, it gains haste until you lose control of the spell or the
 *  permanent it becomes." */
function suspendCastTrigger(): TriggeredAbility {
    return {
        id: SUSPEND_CAST_TRIGGER_ID,
        oracleText:
            "When the last time counter is removed from this card, if it's exiled, you may play it without paying its mana cost if able. If you don't, it remains exiled. If you cast a creature spell this way, it gains haste until you lose control of the spell or the permanent it becomes.",
        event: "COUNTER_REMOVED",
        zone: "exile",
        matches: (event: GameEvent, self: PermanentView) =>
            event.type === "COUNTER_REMOVED" &&
            event.instanceId === self.id &&
            event.counterType === SUSPEND_TIME_COUNTER &&
            // "the LAST time counter" — only the removal that empties it.
            event.remaining === 0,
        // CR 603.4 — "if it's exiled", re-checked on resolution.
        interveningIf: (_event, self, state) =>
            exiledCard(state, self.id) !== undefined,
        effects: [
            {
                op: "castDuringResolution",
                card: { thisCard: true },
                player: "controller",
                source: "exile",
                free: true,
                // "play it" — a land would be played (CR 116.2a / 305.9).
                includesLand: true,
                hasteUntilControlLost: true,
            },
        ],
    };
}

/** ADR 0054 — a no-op unless the card carries `"suspend N"`. Appends the two
 *  exile-zone triggered abilities; never mutates the input. Idempotent: skips
 *  a definition that already carries the synthesized triggers. */
export function expandSuspend(def: CardDefinition): CardDefinition {
    if (parseSuspend(def.staticAbilities) === null) return def;
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === SUSPEND_UPKEEP_TRIGGER_ID)) return def;
    return {
        ...def,
        triggeredAbilities: existing.concat([
            suspendUpkeepTrigger(),
            suspendCastTrigger(),
        ]),
    };
}
