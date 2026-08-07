import { createContext, useContext } from "react";
import type { Player } from "~/types/game";
import {
    usePlayerInteraction,
    type PlayerInteraction,
} from "~/hooks/usePlayerInteraction";

/** A player-nameplate interaction hook: a function of the seat's `Player` that
 *  returns a {@link PlayerInteraction}. The context carries the HOOK ITSELF,
 *  never its result — exactly like
 *  {@link BattlefieldInteractionHook} (`useBattlefieldInteractionContext.ts`,
 *  issue #2166) and for the same reason: `BoardPlayer` mounts once per seat
 *  behind `BoardSurface`'s `{opponent && …}` / `{me && …}` conditionals, so the
 *  call must happen unconditionally inside `BoardPlayer`'s own render, at the
 *  exact spot the direct call lives today. Hoisting a pre-computed RESULT into
 *  `BoardSurface` would put a hook call behind those conditionals and break the
 *  rules-of-hooks contract the moment a seat appears or disappears. */
export type PlayerInteractionHook = (player: Player) => PlayerInteraction;

/** `null` (no provider) means "use the real hook" — see
 *  {@link usePlayerInteractionHook}. */
const PlayerInteractionContext = createContext<PlayerInteractionHook | null>(
    null
);

/** Supplies an alternate player interaction hook to every `BoardPlayer`
 *  beneath it (the Manual Game, PRD #2162 / issue #2169). Absent, `BoardPlayer`
 *  falls back to the real {@link usePlayerInteraction}, byte-for-byte today's
 *  behaviour. */
export const PlayerInteractionProvider = PlayerInteractionContext.Provider;

/** Returns the interaction hook `BoardPlayer` must call — the
 *  provider-supplied one when present, else the real
 *  {@link usePlayerInteraction}. The CALLER invokes the returned function
 *  unconditionally, once, at its own top level: this hook only selects WHICH
 *  function to call, it never calls it. */
export function usePlayerInteractionHook(): PlayerInteractionHook {
    const injected = useContext(PlayerInteractionContext);
    return injected ?? usePlayerInteraction;
}
