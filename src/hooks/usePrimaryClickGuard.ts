import { useCallback, useLayoutEffect, useRef } from "react";

/** How long the controller's morphing primary pill ignores pointer clicks
 *  after the action it shows changes (issue #10973). Long enough to swallow
 *  a double click or a reflex click aimed at the PREVIOUS action ("Pass"
 *  turning into "Attack with all" / "No Blockers" under the cursor), short
 *  enough that a deliberate click on the new action is never noticed. */
export const PRIMARY_ARMING_WINDOW_MS = 400;

/** Pure rule behind {@link usePrimaryClickGuard}: a click is honoured unless
 *  it lands within {@link PRIMARY_ARMING_WINDOW_MS} of the last change of the
 *  primary's identity. `changedAt` is `null` when the identity has not
 *  changed since the surface mounted — nothing morphed under the cursor. */
export function isPrimaryClickArmed(
    changedAt: number | null,
    now: number
): boolean {
    return changedAt === null || now - changedAt >= PRIMARY_ARMING_WINDOW_MS;
}

/** Arming-window guard for the centre slot every controller surface draws
 *  (desktop pod, portrait command row, landscape strip — issue #10973).
 *
 *  `key` is the identity of the descriptor the slot currently shows (its
 *  `ControllerAction.key`, or `undefined` for the idle placeholder). Returns
 *  `guard`, which wraps the button's click handler so any activation of the
 *  button itself (pointer, or Enter/Space on the focused button) within the
 *  window after `key` changes is dropped. Visual-free by design: nothing is
 *  disabled or re-rendered, so geometry never moves. The game's global
 *  hotkeys do not go through here — they keep their own pending-intent
 *  gating. */
export function usePrimaryClickGuard(
    key: string | undefined
): (onClick: (() => void) | undefined) => (() => void) | undefined {
    const lastKey = useRef(key);
    const changedAt = useRef<number | null>(null);

    // A layout effect runs in the same commit that paints the new `key`, so
    // no click can land on the new action before the window is recorded —
    // a passive effect would leave a sub-frame gap after a default-priority
    // (subscription-driven) render.
    useLayoutEffect(() => {
        if (lastKey.current === key) return;
        lastKey.current = key;
        changedAt.current = Date.now();
    }, [key]);

    return useCallback(
        (onClick: (() => void) | undefined) =>
            onClick &&
            (() => {
                if (!isPrimaryClickArmed(changedAt.current, Date.now())) return;
                onClick();
            }),
        []
    );
}
