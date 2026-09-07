import { useRef } from "react";
import { CONTROL_CLASS, CONTROL_PRIMARY_CLASS } from "../../lib/controls";
import { ACTION_LABEL, coerceIssue, type ActionId } from "../../lib/actions";
import { requestAction } from "../../lib/confirm";

/**
 * A button that raises a confirmation for one reversible driver action
 * (#2636), ported in PRD #3148 S2.
 *
 * It never SENDS anything: it names the action and the row it belongs to and
 * hands both to the confirmation dialog, which is the only thing that talks to
 * `/api/action`. That separation is why a poll landing mid-click is harmless —
 * the dialog lives outside this tree and holds no reference back to the button
 * that raised it.
 *
 * `claim.release` with no legible issue number renders NOTHING rather than a
 * button: the server refuses a non-integer issue by design
 * (`ACTION_ALLOW_LIST`, #2628), so a malformed row fails closed here instead
 * of opening a dialog for a request that would 400 (#2636 review round 1,
 * finding 1).
 */
export function ActionButton({
    action,
    issue,
    emphasis = "quiet",
}: {
    action: ActionId;
    issue?: number | string;
    emphasis?: "quiet" | "primary";
}) {
    const ref = useRef<HTMLButtonElement>(null);
    const coerced = coerceIssue(issue);
    if (action === "claim.release" && coerced === undefined) return null;
    const label = action === "claim.release" ? "Release" : ACTION_LABEL[action];
    const description =
        action === "claim.release"
            ? `Release the claim on #${coerced}`
            : ACTION_LABEL[action];
    return (
        <button
            ref={ref}
            type="button"
            className={
                emphasis === "primary" ? CONTROL_PRIMARY_CLASS : CONTROL_CLASS
            }
            aria-label={description}
            onClick={() =>
                requestAction({
                    action,
                    issue: coerced,
                    opener: ref.current,
                })
            }
        >
            {label}
        </button>
    );
}
