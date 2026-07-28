import { Minus } from "lucide-react";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";

/** The caller-side `top-*`/`right-*` inset every real mount MUST pass as
 *  `className` (`pending-choice-prompt.tsx`, `pile-division-picker.tsx`) —
 *  a single source of truth for the value the inline contract comment below
 *  documents, so the two real mounts and the pairing test in
 *  `__tests__/minimize-choice-button.test.tsx` can never drift apart (#1770
 *  second review round: they previously each hardcoded `top-2.5 right-2.5`
 *  independently, which let a caller-side regression to `top-1.5 right-1.5`
 *  slide through unnoticed). */
export const MINIMIZE_BUTTON_INSET = "top-2.5 right-2.5";

/** Minimize affordance shared by the blocking choice dialog surfaces (the
 *  `PendingChoicePrompt` banner and the library-pick modal — issue #315).
 *  Collapses the dialog to the board indicator; a pure view toggle that
 *  leaves the Pending Choice and its buffered selection untouched. */
export default function MinimizeChoiceButton({
    className = "",
}: {
    className?: string;
}) {
    const { minimize } = useMinimizedChoice();

    return (
        <button
            type="button"
            onClick={(e) => {
                // The banner host is a drag handle (`cursor-move`); don't let
                // the click start a drag.
                e.stopPropagation();
                minimize();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Minimize choice dialog"
            title="Minimize"
            // `before:-inset-2.5` (#1770 mobile QA sweep touch-target audit):
            // an invisible 44px hit box around the 24px glyph — this corner
            // affordance sits in a dense dialog header where growing the
            // VISIBLE button would crowd the title text below it, so the hit
            // area grows instead of the visual size (the phase-sheet grab
            // handle's `h-12` wrapping a visually tiny pill is the same idea,
            // just via padding rather than a pseudo-element there).
            //
            // Contract for every mount: the CALLER's own `top-*`/`right-*`
            // inset (the `className` prop) must be >= this `-inset-2.5`
            // (10px) overhang, or the panel edge clips the pseudo-hit box
            // before it reaches 44px (#1770 second review round: `top-1.5
            // right-1.5` = 6px inset clipped 4px, delivering ~40px —
            // `pending-choice-prompt.tsx` and `pile-division-picker.tsx` both
            // now pass the shared {@link MINIMIZE_BUTTON_INSET} constant
            // (`top-2.5 right-2.5`), exactly matching the overhang).
            className={`relative flex h-6 w-6 items-center justify-center rounded-sm text-text-disabled hover:text-text-muted transition-colors cursor-pointer before:absolute before:-inset-2.5 before:content-[''] ${className}`}
        >
            <Minus className="h-4 w-4" />
        </button>
    );
}
