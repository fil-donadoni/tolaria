import type {
    PendingCast,
    PendingActivation,
    PendingTarget,
} from "~/types/game";
import { cardRingClass } from "./card-ring";
import { expectedInputAdmits, type ExpectedInputView } from "./expected-input";

/** The `actionable` ring authority (ADR 0103 §8, issue #6917).
 *
 *  ONE predicate — {@link cardHasLegalAction} — answers "does this card have a
 *  legal action for the viewer right now". Every zone feeds it the sources its
 *  click already uses (the projected `legalActions`, `canSummon` /
 *  `canTurnFaceUp`, the per-ability `canActivate` list, the mana-source
 *  affordability), so a ring can never disagree with the click: the surface
 *  derives its enabled state, its pointer cursor AND its ring from this one
 *  answer.
 *
 *  Priority is gated through the Expected Input derivation (ADR 0047), never a
 *  bare `priorityPlayerId` comparison. */

/** The slice of the game context the plain-Priority window reads. */
export type ActionWindowView = ExpectedInputView & {
    playerId: string;
    pendingCast?: PendingCast | null;
    pendingActivation?: PendingActivation | null;
    pendingTarget?: PendingTarget | null;
};

/** The viewer holds Priority in a PLAIN window: the game waits on a `priority`
 *  input from the viewer's seat and no cast, activation payment or target pick
 *  is open. Mid-resolution choices and combat declarations are already not a
 *  `priority` input to the Expected Input derivation. In solo mode the viewer
 *  is the seat holding Priority, so the ring follows that seat. */
export function isPlainPriorityWindow(view: ActionWindowView): boolean {
    return (
        expectedInputAdmits(view, {
            playerId: view.playerId,
            expect: "priority",
        }) &&
        !view.pendingCast &&
        !view.pendingActivation &&
        !view.pendingTarget
    );
}

/** What a zone's click can do for one card. Every field is a source the zone
 *  already computes to enable that click; absent ≡ none. */
export type CardActionSources = {
    /** The projected per-card `legalActions` (hand, graveyard, exile, library
     *  top): `cast` / `play` present ⇒ that action is legal now. */
    legalActions?: readonly string[];
    /** Companion slot summon (`companion.canSummon`, CR 702.139a). */
    canSummon?: boolean;
    /** Morph turn-face-up special action (`canTurnFaceUp`, CR 702.37e). */
    canTurnFaceUp?: boolean;
    /** Activated abilities offered on the card by the zone's `canActivate`
     *  checks (hand / graveyard / battlefield menus). */
    activatableAbilityCount?: number;
    /** An untapped Mana Ability source that can be activated now (CR 605.3a). */
    manaSourceActivatable?: boolean;
};

/** Whether the card has a legal action for the viewer: the Priority window is
 *  open AND at least one source offers an enabled option. */
export function cardHasLegalAction(
    windowOpen: boolean,
    sources: CardActionSources
): boolean {
    if (!windowOpen) return false;
    const legal = sources.legalActions ?? [];
    return (
        legal.includes("cast") ||
        legal.includes("play") ||
        sources.canSummon === true ||
        sources.canTurnFaceUp === true ||
        (sources.activatableAbilityCount ?? 0) > 0 ||
        sources.manaSourceActivatable === true
    );
}

/** The ring class for an actionable card, `""` otherwise. Surfaces apply it
 *  only when no other role owns the card (`vs.ringClass`, picker rings). */
export function actionableRingClass(actionable: boolean): string {
    return actionable ? cardRingClass("actionable") : "";
}

/** A zone card as the source builders read it: the projected fields only. */
type ProjectedZoneCard = {
    legalActions?: readonly string[];
    castKind?: unknown;
    castableFromExileBy?: string;
    castableFromExileIncludesLand?: boolean;
    types?: readonly string[];
};

/** Keep only `action` out of the projected `legalActions`. A zone button offers
 *  exactly one action, so only that one may enable it (and ring the card). */
function onlyAction(
    card: ProjectedZoneCard,
    action: "cast" | "play"
): CardActionSources {
    return {
        legalActions: card.legalActions?.includes(action) ? [action] : [],
    };
}

/** Graveyard (CR 702.34 flashback, CR 113.6 graveyard abilities, CR 305.1
 *  land play): an activated ability wins; else a card with no `castKind` is a
 *  land play and one with a `castKind` a flashback-style cast. */
export function graveyardActionSources(
    card: ProjectedZoneCard,
    activatableAbilityCount: number
): CardActionSources {
    if (activatableAbilityCount > 0) return { activatableAbilityCount };
    if (card.legalActions === undefined) return {};
    return onlyAction(card, card.castKind === undefined ? "play" : "cast");
}

/** Exile (CR 601.3 / 305.9): only the viewer's own cast permission; a land
 *  needs the explicit play-includes-land grant. */
export function exileActionSources(
    card: ProjectedZoneCard,
    viewerId: string
): CardActionSources {
    if (card.castableFromExileBy !== viewerId) return {};
    const isLand = card.types?.includes("Land") ?? false;
    if (isLand && card.castableFromExileIncludesLand !== true) return {};
    return onlyAction(card, isLand ? "play" : "cast");
}

/** Library top (Courser of Kruphix / Bolas's Citadel): the projection only
 *  tags the playable top card; a land is played, anything else cast. */
export function libraryTopActionSources(
    card: ProjectedZoneCard
): CardActionSources {
    if (card.legalActions === undefined) return {};
    return onlyAction(card, card.types?.includes("Land") ? "play" : "cast");
}
