import { cn } from "~/lib/utils";
import type { EditingSurfaceAction } from "./editing-surface-action";

/** One CTA pill in a Peek Panel's or Inspect Overlay's action row.
 *
 *  The height is `var(--control-h)`, the pointer-aware control token (ADR
 *  0101 §2, issue #2581): 32px on a fine pointer, **44px under
 *  `@media (pointer: coarse)`** — the WCAG 2.5.8 / platform touch target the
 *  acceptance criteria ask for. Hard-coding 44 here would make the desktop
 *  row needlessly chunky AND put a second opinion on the token; hard-coding
 *  `min-h-11` (Tailwind's 44px) would silently drift the day the token moves.
 */
export default function EditingActionButton({
    action,
    className,
    stopPropagation = false,
}: {
    action: EditingSurfaceAction;
    className?: string;
    /** Keep the click off an ancestor's dismiss handler. The Inspect
     *  Overlay's `tapAnywhereCloses` mode sets it on the PRIMARY action only
     *  (PRD #2405 D15): every other tap closes the overlay, but "Pick" must
     *  pick rather than be swallowed by the dismiss. */
    stopPropagation?: boolean;
}) {
    return (
        <button
            type="button"
            data-editing-action={action.label}
            data-primary={action.primary ? "true" : undefined}
            disabled={action.disabled}
            onClick={(event) => {
                if (stopPropagation) event.stopPropagation();
                action.onSelect();
            }}
            style={{ minHeight: "var(--control-h)" }}
            className={cn(
                "flex items-center justify-center rounded-full border px-3 text-display text-[13px] tracking-wide transition disabled:opacity-40",
                action.primary
                    ? "border-accent bg-accent text-surface-base"
                    : "border-accent/50 bg-surface-elevated text-accent-strong",
                className
            )}
        >
            {action.label}
        </button>
    );
}
