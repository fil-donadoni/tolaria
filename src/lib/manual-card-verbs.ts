// Manual card verbs (PRD #2162, issue #2169).
//
// Every per-card manual action is expressed as a synthetic
// {@link ActivatableAbility} — `{ id, oracleText }` — so it rides the board's
// EXISTING `ActivatableAbilityMenu`: the desktop left-click context menu and,
// on touch, the action sheet Manual Mode never had before the swap. The verb id
// is the whole payload: {@link dispatchManualCardVerb} parses it back and calls
// the matching manual mutation. No new UI, no new menu component.
//
// The two parameterised verbs (custom counter, note) collect their input
// through the shared anchored popover (`requestVerbInput`, issue #2170)
// instead of `window.prompt` — anchored to THIS card's own element
// (`permanentAnchorSelector`), never a native dialog.

import type { ProjectedManualCard } from "@convex/manual";
import type { ActivatableAbility } from "~/components/board/battlefield-card";
import type { ManualDispatch, RequestVerbInput } from "./manual-runtime";
import {
    findManualAnchor,
    permanentAnchorSelector,
} from "./manual-verb-anchor";

/** Zones a battlefield permanent can be sent to from its verb menu. */
const MOVE_TARGETS = [
    { zone: "hand", label: "Move to hand" },
    { zone: "graveyard", label: "Move to graveyard" },
    { zone: "exile", label: "Move to exile" },
    { zone: "library", label: "Move to library (top)" },
] as const;

/** The verb list for one battlefield permanent, in menu order. */
export function manualBattlefieldVerbs(
    card: ProjectedManualCard
): ActivatableAbility[] {
    const damage = card.counters?.damage ?? 0;
    const verbs: ActivatableAbility[] = [
        { id: "tap", oracleText: card.isTapped ? "Untap" : "Tap" },
        {
            id: "face",
            oracleText: card.faceDown ? "Turn face up" : "Turn face down",
        },
        { id: "counter:+1/+1", oracleText: "Add a +1/+1 counter" },
        { id: "counter:-1/-1", oracleText: "Add a -1/-1 counter" },
        { id: "counter:damage", oracleText: "Add a damage counter" },
    ];
    if (damage > 0)
        verbs.push({ id: "clear-damage", oracleText: "Clear damage" });
    // Only offered when the card has an outgoing arrow to remove (issue
    // #2171 AC: "an arrow can be removed from the acting card's menu") — the
    // card that DREW the arrow is the acting one, never the card it points
    // at, matching `manualSetArrow`'s per-source `arrows[]` field.
    if (card.arrows && card.arrows.length > 0)
        verbs.push({ id: "clear-arrows", oracleText: "Remove arrow(s)" });
    verbs.push(
        { id: "counter:custom", oracleText: "Custom counter…" },
        { id: "note", oracleText: "Set note…" }
    );
    for (const target of MOVE_TARGETS) {
        verbs.push({ id: `move:${target.zone}`, oracleText: target.label });
    }
    return verbs;
}

/** Applies one verb id from {@link manualBattlefieldVerbs} to `card`. Unknown
 *  ids are ignored — the menu is the only producer, so an unknown id can only
 *  mean a stale render, never a state change worth guessing at. */
export function dispatchManualCardVerb(
    card: ProjectedManualCard,
    verbId: string,
    dispatch: ManualDispatch,
    requestVerbInput: RequestVerbInput
): void {
    if (verbId === "tap") {
        dispatch.setTapped({ instanceId: card.id, tapped: !card.isTapped });
        return;
    }
    if (verbId === "face") {
        dispatch.setFaceDown({
            instanceId: card.id,
            faceDown: !card.faceDown,
        });
        return;
    }
    if (verbId === "clear-damage") {
        const damage = card.counters?.damage ?? 0;
        if (damage > 0) {
            dispatch.adjustCounter({
                instanceId: card.id,
                type: "damage",
                delta: -damage,
            });
        }
        return;
    }
    if (verbId === "clear-arrows") {
        dispatch.clearArrow({ instanceId: card.id });
        return;
    }
    if (verbId === "counter:custom") {
        requestVerbInput(findManualAnchor(permanentAnchorSelector(card.id)), {
            kind: "text",
            title: "Counter type",
            defaultValue: "",
            onConfirm: (type) => {
                const trimmed = type.trim();
                if (trimmed) {
                    dispatch.adjustCounter({
                        instanceId: card.id,
                        type: trimmed,
                        delta: 1,
                    });
                }
            },
        });
        return;
    }
    if (verbId.startsWith("counter:")) {
        dispatch.adjustCounter({
            instanceId: card.id,
            type: verbId.slice("counter:".length),
            delta: 1,
        });
        return;
    }
    if (verbId === "note") {
        requestVerbInput(findManualAnchor(permanentAnchorSelector(card.id)), {
            kind: "text",
            title: "Note",
            defaultValue: card.note ?? "",
            onConfirm: (text) =>
                dispatch.setNote({ instanceId: card.id, text }),
        });
        return;
    }
    if (verbId.startsWith("move:")) {
        const zone = verbId.slice("move:".length);
        if (
            zone === "hand" ||
            zone === "graveyard" ||
            zone === "exile" ||
            zone === "library" ||
            zone === "battlefield"
        ) {
            dispatch.moveCard({ instanceId: card.id, toZone: zone });
        }
    }
}
