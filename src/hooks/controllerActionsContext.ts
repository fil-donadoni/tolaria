import { createContext, useContext } from "react";
import {
    useControllerActions,
    type ControllerState,
} from "./useControllerActions";

/** The controller's action-descriptor SOURCE — a hook, not its computed value
 *  (#2167, mirroring the battlefield interaction context PRD #2162 mandates).
 *  A caller invokes whatever this resolves to exactly like a hook. */
export type ControllerActionsSource = () => ControllerState;

/** Default: today's hook. Absent any provider, every controller layout keeps
 *  reading from `useControllerActions` exactly as before — nothing a player
 *  observes changes.
 *
 *  Carrying the HOOK itself, rather than its computed value, is load-bearing.
 *  `controller.tsx` mounts exactly ONE of the three layouts per render (the
 *  #335 seam), and each layout must call its action-descriptor source
 *  unconditionally, at a stable position, for the rules of hooks to hold. A
 *  context that instead carried the descriptor VALUE would need some
 *  component to call a hook to produce that value in the first place — and
 *  that component would have to be mounted regardless of which layout is
 *  active, which is exactly what the single-mount switch avoids doing (the
 *  hook call lives inside the layouts, not the parent, precisely so it is
 *  never evaluated by a branch that isn't rendered). Injecting the function
 *  reference sidesteps that: every layout calls
 *  `useControllerActionsSource()()` — one hook call, one evaluation, no
 *  conditional hook, whichever layout is mounted or whichever source a
 *  provider (e.g. a future Manual Game) supplies. */
export const ControllerActionsContext =
    createContext<ControllerActionsSource>(useControllerActions);

/** Read the current action-descriptor source. Call the result like a hook —
 *  it may itself call hooks (the default `useControllerActions` does). */
export function useControllerActionsSource(): ControllerActionsSource {
    return useContext(ControllerActionsContext);
}
