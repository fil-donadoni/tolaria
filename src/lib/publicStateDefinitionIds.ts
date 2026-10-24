import type { Player, StackItem } from "~/types/game";

/** A card reference as every projected zone carries it: the slim `{ id }`
 *  plus, for the owner's own view of a face-down object, the identity it
 *  hides (`knownCardId`, issue #1735). */
type ZoneCardRef = { card: { id: string }; knownCardId?: string };

/** A permanent's granted abilities name the GRANTING card's definition
 *  (`getDefinition(grant.sourceCardId)` in the UI and the engine). */
type GrantHolder = {
    grantedActivatedAbilities?: { sourceCardId: string }[];
    grantedTriggeredAbilities?: { sourceCardId: string }[];
};

/** The printed cards an instance stands in for (issue #5617), which the
 *  engine reads back when the stand-in ends: a copy's original
 *  (`copiedFrom`), a transformed permanent's front
 *  (`transformedFrom`), an Adventure's or split half's parent. The server's
 *  Manifest walker (`convex/definitionManifest.ts`) names the same ones. */
type StandInHolder = {
    copiedFrom?: string;
    transformedFrom?: string;
    adventureOf?: string;
    splitHalfOf?: string;
};

/**
 * Every definition id a PROJECTED game state names, each once, in zone
 * order: both players' battlefield, graveyard, exile, hand (the viewer's;
 * the opponent's is `null`s), revealed hand, library (whole when shown, else
 * the viewer-known cards, ADR 0026), companion, the stack, the phased-out
 * bundles, the off-stack trigger batch, the granting card of every granted
 * ability, and the printed card every stand-in (a copy, a transformed face, an
 * Adventure or split half) stands in for. What the board must be able to resolve before it shows
 * the snapshot (`useDefinitionsResident`, issue #5615), and what it preloads
 * art for. The server's `stateDefinitionIds` (`convex/definitionManifest.ts`)
 * walks the ENGINE state for the Manifest; this one walks the wire shape.
 */
export function publicStateDefinitionIds(state: {
    players: readonly Player[];
    stack?: readonly StackItem[];
    phasedOut?: readonly { cards: readonly ZoneCardRef[] }[];
    pendingTriggerBatch?: readonly ZoneCardRef[];
}): string[] {
    const ids = new Set<string>();
    const add = (
        c: (ZoneCardRef & GrantHolder & StandInHolder) | null | undefined
    ) => {
        if (!c) return;
        ids.add(c.card.id);
        if (c.knownCardId !== undefined) ids.add(c.knownCardId);
        for (const standIn of [
            c.copiedFrom,
            c.transformedFrom,
            c.adventureOf,
            c.splitHalfOf,
        ]) {
            if (standIn !== undefined) ids.add(standIn);
        }
        for (const grant of [
            ...(c.grantedActivatedAbilities ?? []),
            ...(c.grantedTriggeredAbilities ?? []),
        ]) {
            ids.add(grant.sourceCardId);
        }
    };
    for (const p of state.players) {
        for (const c of p.battlefield) add(c);
        for (const c of p.graveyard) add(c);
        for (const c of p.exile) add(c);
        for (const c of p.hand) add(c);
        for (const c of p.revealedHand ?? []) add(c);
        if (Array.isArray(p.library)) {
            for (const c of p.library) add(c);
        } else {
            for (const k of p.library.known ?? []) add(k.card);
        }
        add(p.companion?.instance);
        // CR 400.11a — the viewer's own outside-the-game holder, and a Wish
        // pick's candidates (which may be ANOTHER seat's, under a controlled
        // cast — so never in this seat's Manifest).
        for (const c of p.outsideGame ?? []) add(c);
        for (const c of p.outsideGamePeek ?? []) add(c);
    }
    for (const c of state.stack ?? []) add(c);
    for (const bundle of state.phasedOut ?? []) {
        for (const c of bundle.cards) add(c);
    }
    for (const c of state.pendingTriggerBatch ?? []) add(c);
    return [...ids];
}
