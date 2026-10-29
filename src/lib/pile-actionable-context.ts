import { createContext } from "react";

/** Ids of the pile cards that have a legal action for the viewer (issue
 *  #6917). `CardsPile` provides it so the collapsed stack and every tile of its
 *  opened dialog (fan or grid) ring from ONE set, decided by
 *  `cardHasLegalAction` in the owning zone surface. */
export const PileActionableContext = createContext<ReadonlySet<string>>(
    new Set()
);
