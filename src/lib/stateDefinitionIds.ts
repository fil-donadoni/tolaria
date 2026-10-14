import type { Player, StackItem } from "~/types/game";

/** A card reference as every projected zone carries it: the slim `{ id }`
 *  plus, for the owner's own view of a face-down object, the identity it
 *  hides (`knownCardId`, issue #1735). */
type ZoneCard = { card: { id: string }; knownCardId?: string };

/**
 * Every definition id a projected game state names, in zone order: both
 * players' battlefield, graveyard, exile, hand (the viewer's; the opponent's
 * is `null`s), revealed hand, library (whole when shown, else the
 * viewer-known cards, ADR 0026) and the stack — each once. What the board
 * must be able to resolve before it renders (`useDefinitionsResident`, issue
 * #5615), and what it preloads art for.
 */
export function stateDefinitionIds(state: {
    players: readonly Player[];
    stack?: readonly StackItem[];
}): string[] {
    const ids = new Set<string>();
    const add = (c: ZoneCard | null | undefined) => {
        if (!c) return;
        ids.add(c.card.id);
        if (c.knownCardId !== undefined) ids.add(c.knownCardId);
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
    }
    for (const c of state.stack ?? []) add(c);
    return [...ids];
}
