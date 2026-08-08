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
// `ManualCardInteraction` (issue #2347) lives HERE rather than in
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
import type { CardInstance } from "~/types/game";
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
export type ManualCardInteraction = {
    /** The verb list for one card, wherever it is. An unknown card, or one in
     *  a zone with no verbs, yields `[]` — the same fail-closed default
     *  `ActivatableAbilityMenu` already applies to an empty list.
     *
     *  Takes the CARD, not its id: a card the projected state does not index
     *  — a library card listed in the peek dialog, which the projection
     *  deliberately renders as `{ count }` and never enumerates — still has
     *  to get a menu. The board's implementation prefers its own indexed copy
     *  and falls back to the passed card. */
    getVerbs: (card: CardInstance) => ActivatableAbility[];
    /** Dispatches one selected verb id for one card. */
    activate: (card: CardInstance, abilityId: string) => void;
};

/** `null` (no provider) means "every GRE board" — see
 *  {@link useManualCardInteraction}. */
const ManualCardInteractionContext =
    createContext<ManualCardInteraction | null>(null);

/** Supplies the manual card interaction to every card surface beneath it
 *  (`manual-board-view.tsx`) — the hand (`BoardHandCard`) and, since the QA
 *  round-3 pass, the pile browse dialogs and the library peek. Absent,
 *  `BoardHandCard` runs its real GRE cast/play/Cycling pipeline and the pile
 *  dialogs render inert art, byte-for-byte today's behaviour. */
export const ManualCardInteractionProvider =
    ManualCardInteractionContext.Provider;

/** Returns the injected manual card interaction, or `null` on every GRE
 *  board — `BoardHandCard`'s own signal to fall through to its real cast/play
 *  pipeline. */
export function useManualCardInteraction(): ManualCardInteraction | null {
    return useContext(ManualCardInteractionContext);
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
    // The back row's two columns (the manual stand-in for the GRE board's
    // automatic land/non-land split — see `ManualCardInstance.backColumn`).
    // Offered as verbs as well as by drag, because the drag reads the drop's
    // horizontal position and a precise sideways gesture is not something a
    // touch device gives you. Pointless on a card in the combat lane: that
    // card is not in the back row at all.
    if (card.lane !== "combat") {
        verbs.push(
            { id: "column:left", oracleText: "Move to left column" },
            { id: "column:right", oracleText: "Move to right column" }
        );
    }
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
    card: ProjectedManualCard,
    /** Seats a reveal would open this card to — every OTHER player. Empty (the
     *  default) drops the Reveal verb rather than offering one that reveals to
     *  nobody. */
    revealTo: readonly string[] = []
): ActivatableAbility[] {
    const verbs: ActivatableAbility[] = [];
    for (const target of HAND_MOVE_TARGETS) {
        verbs.push({ id: `move:${target.zone}`, oracleText: target.label });
    }
    verbs.push({
        id: "face",
        oracleText: card.faceDown ? "Turn face up" : "Turn face down",
    });
    // Manual-mode QA round 3, item 3 — showing ONE card across the table
    // (Duress, "look at this"), the per-card half of the nameplate's
    // "Reveal hand". Additive and permanent, like the server verb: there is
    // no un-reveal, because at a table a card that has been seen has been
    // seen.
    if (revealTo.length > 0) {
        verbs.push({ id: "reveal", oracleText: "Reveal to opponent" });
    }
    verbs.push({ id: "note", oracleText: "Set note…" });
    return verbs;
}

/** Every zone a card can be sent to, in menu order — the source of
 *  {@link manualPileCardVerbs}' move list, minus wherever the card already
 *  is. */
const ALL_MOVE_TARGETS = [
    { zone: "battlefield", label: "Put onto battlefield" },
    { zone: "hand", label: "Move to hand" },
    { zone: "graveyard", label: "Move to graveyard" },
    { zone: "exile", label: "Move to exile" },
    { zone: "library", label: "Move to library (top)" },
] as const;

/**
 * The verb list for a card sitting in a PILE — graveyard, exile, or the
 * library as listed by the peek dialog.
 *
 * Those cards used to be inert art: the only way to act on one was the pile
 * tile's own "Move top card to …", which reaches exactly one card and only
 * the top one. Now every card in the browse dialog carries the same
 * left-click verb menu the hand and the battlefield already had.
 *
 * The card's own zone is dropped from the move list — "Move to graveyard" on
 * a card already in the graveyard is a no-op that still writes a log line.
 * `tap` and the counter verbs stay battlefield-only, exactly as they are for
 * a hand card.
 */
export function manualPileCardVerbs(
    card: ProjectedManualCard,
    revealTo: readonly string[] = []
): ActivatableAbility[] {
    const verbs: ActivatableAbility[] = [];
    for (const target of ALL_MOVE_TARGETS) {
        if (target.zone === card.zone) continue;
        verbs.push({ id: `move:${target.zone}`, oracleText: target.label });
    }
    verbs.push({
        id: "face",
        oracleText: card.faceDown ? "Turn face up" : "Turn face down",
    });
    if (revealTo.length > 0) {
        verbs.push({ id: "reveal", oracleText: "Reveal to opponent" });
    }
    verbs.push({ id: "note", oracleText: "Set note…" });
    return verbs;
}

/** The verb list for a card in ANY zone — the one entry point every card
 *  surface calls, so a card gets the same menu whether it is rendered on the
 *  battlefield, in the hand, in a pile browse dialog or in the library peek.
 *  A battlefield permanent's list carries no reveal verb: it is already
 *  face-up to everyone unless it is face-down, which has its own verb. */
export function manualVerbsForZone(
    card: ProjectedManualCard,
    revealTo: readonly string[] = []
): ActivatableAbility[] {
    if (card.zone === "battlefield") return manualBattlefieldVerbs(card);
    if (card.zone === "hand") return manualHandVerbs(card, revealTo);
    return manualPileCardVerbs(card, revealTo);
}

/** Applies one verb id from {@link manualBattlefieldVerbs},
 *  {@link manualHandVerbs} or {@link manualPileCardVerbs} to `card`. Unknown ids are ignored — the menu is
 *  the only producer, so an unknown id can only mean a stale render, never a
 *  state change worth guessing at. */
export function dispatchManualCardVerb(
    card: ProjectedManualCard,
    verbId: string,
    dispatch: ManualDispatch,
    requestVerbInput: RequestVerbInput,
    /** Seats the `reveal` verb opens the card to — see {@link manualHandVerbs}.
     *  Empty means the verb was never offered, so an id that reaches here
     *  anyway (stale render) is dropped rather than dispatched to nobody. */
    revealTo: readonly string[] = []
): void {
    if (verbId === "reveal") {
        if (revealTo.length > 0) {
            dispatch.reveal({
                instanceId: card.id,
                toPlayerIds: [...revealTo],
            });
        }
        return;
    }
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
    if (verbId === "column:left" || verbId === "column:right") {
        dispatch.setBackColumn({
            instanceId: card.id,
            column: verbId === "column:left" ? "left" : "right",
        });
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
