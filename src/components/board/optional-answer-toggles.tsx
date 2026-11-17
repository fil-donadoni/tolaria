import { Checkbox } from "~/components/ui/checkbox";
import type { OptionalAnswerControl } from "~/hooks/useOptionalAnswer";
import type { OptionalAnswer } from "~/lib/yields";

const TOGGLES: { answer: OptionalAnswer; label: string; title: string }[] = [
    {
        answer: "yes",
        label: "Always yes",
        title: "Answer yes now, and every time this prompt comes back for a card with this name. Manage yields removes it.",
    },
    {
        answer: "skip",
        label: "Always skip",
        title: "Decline now, and every time this prompt comes back for a card with this name. Manage yields removes it.",
    },
];

/** **Auto-answer** toggles on the optional-action prompt (issue #9863): two
 *  mutually exclusive checkboxes, "Always yes" (costless prompts only) and
 *  "Always skip". Turning one on records the rule and answers the current
 *  prompt; while that submit is in flight both are disabled. The label is the
 *  hit area, `--control-h` tall, like the **Auto-order** toggle. */
export default function OptionalAnswerToggles({
    control,
}: {
    control: OptionalAnswerControl;
}) {
    const offered = TOGGLES.filter((t) =>
        t.answer === "yes" ? control.offerYes : control.offerSkip
    );
    if (offered.length === 0) return null;
    return (
        <div
            data-optional-answer-toggles
            className="flex flex-wrap items-center justify-center gap-x-4"
        >
            {offered.map((t) => (
                <label
                    key={t.answer}
                    data-optional-answer-toggle={t.answer}
                    title={t.title}
                    className="flex min-h-[var(--control-h)] cursor-pointer items-center gap-2 px-2 text-xs text-text-muted"
                >
                    <Checkbox
                        checked={control.answering === t.answer}
                        disabled={control.answering !== null}
                        onCheckedChange={(checked) => {
                            if (checked) control.answerAlways(t.answer);
                        }}
                    />
                    {t.label}
                </label>
            ))}
        </div>
    );
}
