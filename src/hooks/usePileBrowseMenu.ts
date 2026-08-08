import { useState } from "react";
import type { PileAction } from "./usePileActionsContext";

/** Return shape of {@link usePileBrowseMenu} — everything a pile tile
 *  (`PlayerLibrary` / `PlayerGraveyard` / `PlayerExile`) needs to wire its
 *  `CardsPile` and its `ContextMenu` so the two never both open on the same
 *  click (issue #2345). */
type PileBrowseMenu = {
    /** `pileActions` with `Browse pile…` prepended as the FIRST item —
     *  render this in the `ContextMenuContent`, not the raw `pileActions`. */
    menuActions: PileAction[];
    /** Pass straight through to `CardsPile`'s `open` prop. */
    open: boolean | undefined;
    /** Pass straight through to `CardsPile`'s `onOpenChange` prop. */
    onOpenChange: ((open: boolean) => void) | undefined;
    /** Pass straight through to `CardsPile`'s `hasContextMenu` prop. */
    hasContextMenu: boolean;
};

/** Wires a pile tile's context menu to its own browse dialog.
 *
 *  Left click is this app's context-menu gesture. A pile tile with actions
 *  wraps its collapsed stack in a `ContextMenuTrigger` — but the collapsed
 *  stack ALSO has its own click-to-browse affordance, and a bare click fires
 *  both: the dialog opens (covering the board) and the menu opens invisibly
 *  underneath it. Fixing this by having `CardsPile` `stopPropagation()` would
 *  make the dialog unreachable on any pile that has both.
 *
 *  Instead: whenever the tile carries actions, the collapsed stack's click no
 *  longer opens the dialog directly (`CardsPile`'s `hasContextMenu` prop) —
 *  it defers to the ancestor menu, and browsing becomes that menu's own FIRST
 *  item, `Browse pile…`, expressed in the exact same `PileAction` shape as
 *  every other pile verb.
 *
 *  `externalOpen`/`externalOnOpenChange` are the pile component's OWN
 *  `open`/`onOpenChange` props (the #336 portrait-chip controlled mode, where
 *  a chip elsewhere drives the dialog and the collapsed stack is suppressed
 *  entirely — no click-collision is possible there, so this hook defers to
 *  the caller unchanged whenever they are supplied). Only when the pile is
 *  NOT chip-controlled does this hook lift its own open state so `Browse
 *  pile…` has something to drive. */
export function usePileBrowseMenu(
    pileActions: PileAction[],
    externalOpen: boolean | undefined,
    externalOnOpenChange: ((open: boolean) => void) | undefined
): PileBrowseMenu {
    const [browseOpen, setBrowseOpen] = useState(false);
    const chipControlled = externalOpen !== undefined;
    const hasMenu = pileActions.length > 0;

    if (chipControlled) {
        return {
            menuActions: hasMenu
                ? [
                      {
                          key: "browse",
                          label: "Browse pile…",
                          onSelect: () => externalOnOpenChange?.(true),
                      },
                      ...pileActions,
                  ]
                : pileActions,
            open: externalOpen,
            onOpenChange: externalOnOpenChange,
            // The chip already suppresses the collapsed stack (CardsPile's
            // own `controlled` branch) — no click-collision to guard against.
            hasContextMenu: false,
        };
    }

    return {
        menuActions: hasMenu
            ? [
                  {
                      key: "browse",
                      label: "Browse pile…",
                      onSelect: () => setBrowseOpen(true),
                  },
                  ...pileActions,
              ]
            : pileActions,
        open: hasMenu ? browseOpen : undefined,
        onOpenChange: hasMenu ? setBrowseOpen : undefined,
        hasContextMenu: hasMenu,
    };
}
