// Manual card verbs (PRD #2162, issue #2169).
//
// Every per-card manual action is expressed as a synthetic
// {@link ActivatableAbility} — `{ id, oracleText }` — so it rides the board's
// EXISTING `ActivatableAbilityMenu`: the desktop left-click context menu and,
// on touch, the action sheet Manual Mode never had before the swap. The verb id
// is the whole payload: {@link dispatchManualCardVerb} parses it back and calls
// the matching manual mutation. No new UI, no new menu component.
//
// Parameterised verbs (custom counter, note) keep the native `window.prompt`
// the hand-written manual board used — that is today's behaviour verbatim, and
// issue #2170 replaces both prompts with real dialogs.
//
// Pure apart from the `window.prompt` calls the two parameterised verbs make.

import type { ProjectedManualCard } from "@convex/manual";
import type { ActivatableAbility } from "~/components/board/battlefield-card";
import type { ManualDispatch } from "./manual-runtime";

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
    dispatch: ManualDispatch
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
    if (verbId === "counter:custom") {
        // #2170 replaces the native prompt with a dialog; keeping it here is
        // today's behaviour unchanged, not a new one.
        const type = window.prompt("Counter type:");
        if (type?.trim()) {
            dispatch.adjustCounter({
                instanceId: card.id,
                type: type.trim(),
                delta: 1,
            });
        }
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
        const text = window.prompt("Note:", card.note ?? "");
        if (text !== null) dispatch.setNote({ instanceId: card.id, text });
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
