import { useRef, useState } from "react";
import { Modal } from "../Modal";
import { CONTROL_CLASS, CONTROL_PRIMARY_CLASS } from "../../lib/controls";
import { ACTION_LABEL, effectFor, postAction } from "../../lib/actions";
import {
    dismissAction,
    getPendingAction,
    usePendingAction,
} from "../../lib/confirm";

/**
 * The confirmation before any action is sent (#2636, ported in PRD #3148 S2).
 *
 * ONE dialog for every action button on the page, mounted OUTSIDE the sections
 * that raise it — deliberately, because a ten-second poll lands while it is
 * open. The button that raised it may not even exist by the time Confirm is
 * pressed; nothing here holds a reference back to it, only the action, the
 * issue and the element to return focus to.
 *
 * ── THE RE-ENTRANCY GUARD IS NOT THE `disabled` ATTRIBUTE ─────────────────
 *
 * `disabled` is a UI reflection for sighted and assistive users; whether it
 * also suppresses a synthetic or double-dispatched click is not something this
 * component gets to assume (browsers vary, and a script-dispatched click is
 * not user interaction at all). The AC — "a double click cannot send two" — is
 * enforced by refusing to START a second request while one is outstanding,
 * whatever reached the listener.
 *
 * A REFUSAL LEAVES THE DIALOG OPEN with the reason on it (AC): the operator
 * can retry or cancel, and the copyable command the remedy also renders is
 * still on the page underneath — that IS the fallback, with nothing further to
 * build.
 */
export function ConfirmDialog({ onSuccess }: { onSuccess: () => void }) {
    const pending = usePendingAction();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);

    const close = () => {
        // Cleared on close, not only after a resolved fetch (#2636 review
        // round 1, finding 4): Escape/backdrop/Cancel can close the dialog
        // while a request is still out, and a latch left set would silently
        // swallow the NEXT dialog's Confirm — no fetch, no error, nothing
        // visibly wrong.
        inFlight.current = false;
        setBusy(false);
        setError(null);
        dismissAction();
    };

    const confirm = async () => {
        if (!pending || inFlight.current) return;
        // Captured by IDENTITY, not just truthiness (#2636 review round 1,
        // finding 4). Cancelling nulls the pending action, but cancelling and
        // then opening a DIFFERENT one reassigns it to a new object — a
        // `!getPendingAction()` check alone misses that second case entirely,
        // and the stale response would then dismiss, and fire `onSuccess` for,
        // a confirmation the operator has not answered yet.
        const own = pending;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        const extra =
            own.action === "claim.release" ? { issue: own.issue } : {};
        const result = await postAction(own.action, extra);
        if (getPendingAction() !== own) return;
        inFlight.current = false;
        if (result.ok) {
            close();
            onSuccess();
            return;
        }
        setBusy(false);
        setError(result.error || "the action was refused");
    };

    return (
        <Modal
            overlay="confirm"
            open={pending !== null}
            onClose={close}
            title={pending ? ACTION_LABEL[pending.action] : ""}
            description={
                pending ? effectFor(pending.action, pending.issue) : undefined
            }
        >
            {error ? (
                <div
                    role="alert"
                    className="border-state-bad text-state-bad rounded-md border border-l-2 px-3 py-2 text-xs"
                >
                    {error}
                </div>
            ) : null}
            <div className="flex justify-end gap-2">
                {/*
                    Cancel stays ENABLED while a request is out. There is no
                    reason to make an operator wait one out, and the close path
                    already supports it — Escape and the backdrop could always
                    do this, so a Cancel button that could not was the odd one.
                */}
                <button type="button" className={CONTROL_CLASS} onClick={close}>
                    Cancel
                </button>
                {/*
                    `aria-disabled`, not `disabled`. Two reasons, and the
                    second is the one that matters:

                    - `disabled` on the button the operator has just pressed
                      moves focus to `<body>` mid-interaction.
                    - `disabled` would also make the re-entrancy latch
                      UNTESTABLE, because the browser refuses the second click
                      before any of this component's code runs — and a guard
                      nothing can exercise is a guard nobody knows still works
                      (measured: with `disabled`, deleting the latch left every
                      test green). With `aria-disabled` the second click
                      reaches the handler and `inFlight` is what refuses it,
                      which is the AC — "a double click cannot send two" —
                      enforced HERE rather than delegated to a host behaviour
                      this module does not control.
                */}
                <button
                    type="button"
                    className={CONTROL_PRIMARY_CLASS}
                    aria-disabled={busy}
                    onClick={() => void confirm()}
                >
                    {busy ? "Working…" : "Confirm"}
                </button>
            </div>
        </Modal>
    );
}
