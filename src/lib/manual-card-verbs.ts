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
//
// `ManualHandInteraction` (issue #2347) lives HERE rather than in
// `board-hand-card.tsx`: that file's default export is a React component, and
// `react-refresh/only-export-components` requires a component file to export
// only components — a plain `createContext` value export there breaks the
// fast-refresh boundary. This module already owns the verb vocabulary the
// context carries, and (unlike `manual-runtime.ts`) makes no "pure, no React"
// claim, so it is the natural home — the same reasoning that put
// `BattlefieldInteractionHook` in its own `useXContext.ts` file, minus the
// need for a *hook-carrying* context: `BoardHandCard` (unlike
// `BoardBattlefield`) doesn't call a "real hook" when the provider is absent,
// it just skips a `null` branch, so a plain value context is enough.

import { createContext, useContext } from "react";
import type { ProjectedManualCard } from "@convex/manual";
import type { ActivatableAbility } from "~/components/board/battlefield-card";
import type { ManualDispatch, RequestVerbInput } from "./manual-runtime";
import {
    findManualAnchor,
    permanentAnchorSelector,
} from "./manual-verb-anchor";

/** The injected Manual Board seam for `BoardHandCard` (issue #2347) — splits
 *  the ONE thing `handInteractive={false}` used to opt out of into the TWO
 *  things it actually meant: "no cast dispatch" (still true in Manual Mode,
 *  which has no `gameStates` row for `playCard`/`announceCast`/
 *  `activateAbility` to land in) and "no ability menu" (now wrong — issue
 *  #2347's whole point). Present ⇒ `BoardHandCard` renders ONLY the manual
 *  verb menu (`manualHandVerbs`/`dispatchManualCardVerb` below) and never
 *  wires its GRE cast/play pipeline to the DOM. Absent (every GRE board — the
 *  default) ⇒ `BoardHandCard` is byte-for-byte unchanged.
 *
 *  Looked up by instance id, never a `ProjectedManualCard` object, so
 *  `board-hand-card.tsx` never needs to know that manual-only shape. */
export type ManualHandInteraction = {
    /** The verb list for one hand card, by instance id. Absent/unknown id ⇒
     *  no menu — the same fail-closed default `ActivatableAbilityMenu`
     *  already applies to an empty list. */
    getVerbs: (cardId: string) => ActivatableAbility[];
    /** Dispatches one selected verb id for one hand card. */
    activate: (cardId: string, abilityId: string) => void;
};

/** `null` (no provider) means "every GRE board" — see
 *  {@link useManualHandInteraction}. */
const ManualHandInteractionContext =
    createContext<ManualHandInteraction | null>(null);

/** Supplies the manual hand interaction to every `BoardHandCard` beneath it
 *  (`manual-board-view.tsx`). Absent, `BoardHandCard` runs its real GRE
 *  cast/play/Cycling pipeline, byte-for-byte today's behaviour. */
export const ManualHandInteractionProvider =
    ManualHandInteractionContext.Provider;

/** Returns the injected manual hand interaction, or `null` on every GRE
 *  board — `BoardHandCard`'s own signal to fall through to its real cast/play
 *  pipeline. */
export function useManualHandInteraction(): ManualHandInteraction | null {
    return useContext(ManualHandInteractionContext);
}

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

/** Zones a hand card can be sent to from its verb menu (issue #2347) —
 *  `MOVE_TARGETS` minus "hand" itself, plus "battlefield" first (the single
 *  most common hand action, per the issue's symptom). `dispatchManualCardVerb`
 *  already handles a `move:battlefield` id (it drives the same `move:` branch
 *  the battlefield verbs' `Move to hand` uses), so no new dispatch shape is
 *  needed here — only a new list. */
const HAND_MOVE_TARGETS = [
    { zone: "battlefield", label: "Play to battlefield" },
    { zone: "graveyard", label: "Move to graveyard" },
    { zone: "exile", label: "Move to exile" },
    { zone: "library", label: "Move to library (top)" },
] as const;

/** The verb list for one hand card, in menu order (issue #2347): the four
 *  {@link HAND_MOVE_TARGETS} moves, then face-down/up, then the note. Rides
 *  the SAME synthetic-`ActivatableAbility` encoding and
 *  {@link dispatchManualCardVerb} as {@link manualBattlefieldVerbs} — a hand
 *  card is just a narrower verb list over the same card.
 *
 *  Deliberately NOT offered: `tap`, every `counter:*`, `clear-damage`,
 *  `clear-arrows` — all battlefield-only state a card sitting in hand cannot
 *  carry. */
export function manualHandVerbs(
    card: ProjectedManualCard
): ActivatableAbility[] {
    const verbs: ActivatableAbility[] = [];
    for (const target of HAND_MOVE_TARGETS) {
        verbs.push({ id: `move:${target.zone}`, oracleText: target.label });
    }
    verbs.push({
        id: "face",
        oracleText: card.faceDown ? "Turn face up" : "Turn face down",
    });
    verbs.push({ id: "note", oracleText: "Set note…" });
    return verbs;
}

/** Applies one verb id from {@link manualBattlefieldVerbs} or
 *  {@link manualHandVerbs} to `card`. Unknown ids are ignored — the menu is
 *  the only producer, so an unknown id can only mean a stale render, never a
 *  state change worth guessing at. */
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
