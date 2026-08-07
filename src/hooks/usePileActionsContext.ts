import { createContext, useContext } from "react";
import type { Player } from "~/types/game";

/** The three pile tiles on the board's right rail (`board-piles.tsx`). */
export type PileZone = "library" | "graveyard" | "exile";

/** One entry in a pile tile's context menu. Deliberately NOT an
 *  `ActivatableAbility`: a pile verb has a plain label, no oracle text and no
 *  keep-priority modifier. */
export type PileAction = {
    key: string;
    label: string;
    onSelect: () => void;
};

/** Produces the context-menu verbs for one `(player, zone)` pile tile.
 *
 *  Unlike the battlefield-interaction (#2166) and controller-action (#2167)
 *  seams, this context carries a PLAIN FUNCTION rather than a hook. Those two
 *  inject something that must call React hooks at the consuming component's
 *  own top level; a pile verb set needs no per-mount state at all — the
 *  injector (the Manual Board container) already holds its mutations and its
 *  game id, so it can close over them once and hand down a pure descriptor
 *  factory. Keeping it hook-free means the resolver below can fall back to the
 *  component's OWN existing wiring without ever calling a hook conditionally. */
export type PileActionsSource = (
    player: Player,
    zone: PileZone
) => PileAction[];

/** `null` (no provider) means "the pile keeps its own built-in verbs" — see
 *  {@link usePileActions}. */
const PileActionsContext = createContext<PileActionsSource | null>(null);

/** Supplies pile verbs to every `PlayerLibrary` / `PlayerGraveyard` /
 *  `PlayerExile` beneath it (the Manual Game, PRD #2162 / issue #2169).
 *  Absent, each pile renders exactly the menu it renders today. */
export const PileActionsProvider = PileActionsContext.Provider;

/** A stable empty verb list — the fallback for the two piles that carry no
 *  built-in menu, so the identity never changes between renders. */
export const NO_PILE_ACTIONS: PileAction[] = [];

/** Resolves the verbs a pile tile should offer: the provider-supplied set when
 *  a provider is mounted, else `fallback` — the pile's OWN default wiring
 *  (`api.game.drawCard` / `mill` / `exileFromLibrary` for the library, nothing
 *  for the graveyard and exile). No hook is called on either branch, so the
 *  GRE board's render is unchanged whether or not a provider exists. */
export function usePileActions(
    player: Player,
    zone: PileZone,
    fallback: PileAction[]
): PileAction[] {
    const injected = useContext(PileActionsContext);
    return injected ? injected(player, zone) : fallback;
}
