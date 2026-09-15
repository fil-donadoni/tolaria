// The consent toggle that reveals the deciding seat's hand in the verdict quiz
// (issue #3577, ADR 0128 §12).
//
// A judgement about a land drop is worthless without the hand that land would
// have enabled — and seeing that hand is seeing cards a player would not
// otherwise see. The cost is printed beside the control, not in a tooltip: it
// is the thing being consented to, so it has to be read before the click.

import { useId } from "react";
import {
    HAND_REVEAL_CONSENT,
    HAND_REVEAL_LABEL,
} from "./ai-decision-quiz-copy";

export default function AiDecisionQuizHandReveal({
    revealed,
    disabled,
    onChange,
}: {
    revealed: boolean;
    disabled: boolean;
    onChange: (revealed: boolean) => void;
}) {
    const consentId = useId();
    return (
        <label className="flex items-start gap-1.5 rounded-sm border border-signal-pending/40 px-1.5 py-1 text-[10px] leading-snug">
            <input
                type="checkbox"
                checked={revealed}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                aria-describedby={consentId}
                className="mt-0.5 shrink-0"
            />
            <span className="flex min-w-0 flex-col">
                <span className="font-medium text-text">
                    {HAND_REVEAL_LABEL}
                </span>
                <span
                    id={consentId}
                    className="break-words text-signal-pending"
                >
                    {HAND_REVEAL_CONSENT}
                </span>
            </span>
        </label>
    );
}
