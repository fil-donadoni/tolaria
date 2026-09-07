/**
 * The dashboard's own control treatment (PRD #3148 S2).
 *
 * WHY THIS IS NOT `src/components/ui/button.tsx`. That primitive's whole
 * appearance is `btn-base` / `btn-tone-*`, custom utilities declared in
 * `src/index.css` — the GAME's skin, with its parchment plates, its ivory
 * glow and its dark-only palette. The dashboard deliberately does not import
 * that stylesheet (ADR 0117: its own Tailwind entry, no Beleren, no keyrune,
 * and a real light theme), so those class names resolve to nothing here and a
 * `<Button>` on this page renders as unskinned text.
 *
 * So the Now view's controls are plain `<button>` elements wearing these
 * classes, built only from the shadcn tokens the dashboard DOES define. One
 * declaration per role, here, because "constants are shared" — a component
 * that spells its own hover state has quietly forked the vocabulary.
 *
 * Colour is never the only carrier on this page, so nothing here encodes
 * state; a tone comes from `tones.ts` and rides on top.
 */

/** The shared focus ring — one definition, so every control on the page
 *  announces focus the same way. */
export const FOCUS_RING =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** A small pressable control: a Watch, a Release, a copy affordance. */
export const CONTROL_CLASS =
    `inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs ` +
    `font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed ` +
    `disabled:opacity-60 ${FOCUS_RING}`;

/** The emphasised rung — the verdict band's Stop/Resume, a dialog's Confirm. */
export const CONTROL_PRIMARY_CLASS =
    `inline-flex items-center gap-1 rounded-md border border-transparent bg-primary px-2.5 py-1 ` +
    `text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 ` +
    `disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

/** A borderless control that only shows on hover/focus — the tail drawer's
 *  Follow/Jump toggles. */
export const CONTROL_QUIET_CLASS =
    `inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground ` +
    `transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`;

/**
 * A native form control — a `<select>`, a text/search box, a date picker
 * (PRD #3148 S3).
 *
 * NATIVE, deliberately. The History filter bar renders five comboboxes and two
 * date pickers, and the dashboard has no shadcn `select` primitive; adding one
 * would mean a popover, a listbox and its keyboard model for a control the
 * platform already ships with typeahead, a native picker on every OS and no
 * bundle cost. What was missing was never behaviour, only that it looked
 * nothing like the rest of the page — which is one class, here.
 *
 * `accent-color` is what makes the date picker's own calendar follow the
 * dashboard's theme instead of the browser default.
 */
export const FIELD_CLASS =
    `border-border bg-card text-foreground h-8 rounded-md border px-2 text-xs ` +
    `[accent-color:var(--primary)] ${FOCUS_RING}`;

/** A filter chip: a value of the current split, on or off. The pressed state
 *  is `aria-pressed`, and the fill follows it — colour is never the only
 *  carrier, so the border changes with it. */
export const CHIP_CLASS =
    `rounded-full border px-2 py-0.5 text-xs transition-colors ` +
    `aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary ` +
    `border-border text-muted-foreground hover:text-foreground ${FOCUS_RING}`;
