import type { Hotkey } from "~/lib/hotkeys";

/** One call-to-action a card-editing surface offers for the selected card —
 *  "→ Side", "→ Pool", "Pick", "Move to…", "Inspect" (PRD #2405, issue #2583).
 *
 *  The primitives (Peek Panel, Inspect Overlay) render these; they never
 *  invent one. The CTA SET is what makes a Peek Panel a deckbuilder's or a
 *  Draft Room's, so the surface supplies it — which is also why this type
 *  lives beside the primitives rather than inside either surface. */
export interface EditingSurfaceAction {
    /** Visible label; also the React key, so it is unique within a set. */
    label: string;
    onSelect: () => void;
    /** The surface's main path (Pick, → Side) — filled treatment. At most one
     *  per set; also the action exempted from "tap anywhere closes" in the
     *  Inspect Overlay. */
    primary?: boolean;
    disabled?: boolean;
    /** The hotkey that does what this CTA does (Draft Room: Enter picks, `S`
     *  sideboards the Selected Card) — its declaration in `~/lib/hotkeys`, so
     *  the button's keycap and `aria-keyshortcuts` are the binding's own
     *  (issue #9833). Only for an action on the SELECTED card: the key acts
     *  on the selection, never on whichever card a menu was opened from. */
    hotkey?: Hotkey;
}
