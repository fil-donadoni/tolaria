import { createContext, useContext } from "react";

/** Whether the viewer may see the card preview's Engine view slot (issue
 *  #7430). Defaults to CLOSED: a render with no provider (a test, a surface
 *  mounted outside the app shell) shows nothing, which is also the fail-closed
 *  behaviour the predicate gives while the user query is in flight. A context
 *  rather than a Convex hook in the slot itself so the slot — rendered by every
 *  preview surface — needs no `ConvexProvider` of its own. */
export const EngineViewAccessContext = createContext<boolean>(false);

export function useCanViewEngineView(): boolean {
    return useContext(EngineViewAccessContext);
}
