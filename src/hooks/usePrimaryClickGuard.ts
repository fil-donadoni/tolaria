import { useCallback, useEffect, useRef } from "react";

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
 *  `guard`, which wraps a click handler so a POINTER click within the window
 *  after `key` changes is dropped. Visual-free by design: nothing is
 *  disabled or re-rendered, so geometry never moves. Hotkeys do not go
 *  through here — they keep their own pending-intent gating. */
export function usePrimaryClickGuard(
    key: string | undefined
): (onClick: (() => void) | undefined) => (() => void) | undefined {
    const lastKey = useRef(key);
    const changedAt = useRef<number | null>(null);

    // React flushes passive effects before dispatching the next discrete
    // event, so a click can never observe the new `key` before this ran.
    useEffect(() => {
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
