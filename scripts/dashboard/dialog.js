/**
 * Shared modal-dialog focus trap (#2636).
 *
 * Extracted from `shortcuts.js` (#2635), the first place this dashboard
 * built a `role="dialog" aria-modal="true"` overlay with Tab cycling. The
 * action-confirmation dialog (`actions.js`, #2636) is the SECOND consumer of
 * that same keyboard contract — per this repo's "extract after the second"
 * convention the shared mechanics move here rather than being duplicated a
 * second time.
 *
 * Deliberately just the trap, not a whole dialog component: the two
 * consumers' markup differs enough (a static shortcut list vs. a per-click
 * confirmation body with Confirm/Cancel) that a shared "build a dialog"
 * abstraction would be fighting two different shapes for no shared benefit.
 * Only the KEYBOARD CONTRACT — cycle Tab/Shift+Tab inside the dialog's own
 * focusable descendants — is actually identical, so only that moves.
 */

/** Elements a keyboard user can land on inside a trapped dialog. */
export const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Cycles Tab/Shift+Tab between `root`'s first and last focusable descendant.
 * `root` is passed in explicitly — unlike `shortcuts.js`'s original private
 * `trapFocus`, which looked its sheet element up from module state — so this
 * function has no idea which dialog is open; the caller already knows.
 *
 * A no-op when `root` is falsy or empty (nothing to trap into), so a caller
 * can call this unconditionally from its own keydown handler without first
 * checking whether its dialog exists.
 */
export function trapFocus(root, e, doc) {
    if (e.key !== "Tab") return;
    const focusables = root
        ? [...root.querySelectorAll(FOCUSABLE_SELECTOR)]
        : [];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = doc.activeElement;
    const inside = root.contains(active);
    if (e.shiftKey ? active === first || !inside : active === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
    }
}
