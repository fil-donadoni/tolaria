import { useRef, useState } from "react";
import { Modal } from "../Modal";
import { CONTROL_CLASS, CONTROL_PRIMARY_CLASS } from "../../lib/controls";
import { ACTION_LABEL, effectFor, postAction } from "../../lib/actions";
import { dismissAction, usePendingAction } from "../../lib/confirm";

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
        inFlight.current = true;
        setBusy(true);
        setError(null);
        const extra =
            pending.action === "claim.release" ? { issue: pending.issue } : {};
        const result = await postAction(pending.action, extra);
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
                <button
                    type="button"
                    className={CONTROL_CLASS}
                    disabled={busy}
                    onClick={close}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    className={CONTROL_PRIMARY_CLASS}
                    disabled={busy}
                    onClick={() => void confirm()}
                >
                    {busy ? "Working…" : "Confirm"}
                </button>
            </div>
        </Modal>
    );
}
