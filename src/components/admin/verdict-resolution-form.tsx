import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ReviewPosition } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import { answerLetter, draftState } from "./verdict-review-model";

/**
 * Settle a contested position (issue #3582, ADR 0128 §6): one answer is right,
 * or none is, and every answer not accepted is rejected WITH a reason. Nothing
 * is removed — the rejected judgement stays in the Verdict Store, and the
 * resolution is a new object beside it.
 *
 * The server re-checks the decision against the position as it stands when
 * the button is pressed: an answer that arrived while this form was open
 * refuses the resolution, and the message says to reload.
 *
 * Disabled while the action is in flight (project-wide convention).
 */
export default function VerdictResolutionForm({
    position,
    onResolved,
}: {
    position: ReviewPosition;
    onResolved: () => void;
}) {
    const resolve = useAction(api.verdictReviewActions.resolve);
    const [accepted, setAccepted] = useState<string | null | undefined>(
        undefined
    );
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const state = draftState(position, accepted, reasons);

    async function submit() {
        if (!state.ready || saving) return;
        setSaving(true);
        setError(null);
        try {
            await resolve({
                ...state.draft,
                ...(note.trim() ? { note: note.trim() } : {}),
            });
            onResolved();
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : "Could not resolve"
            );
        } finally {
            setSaving(false);
        }
    }

    const choices = [
        ...position.verdicts.map((verdict, index) => ({
            value: verdict.verdictId as string | null,
            label: `Answer ${answerLetter(index)} is right`,
        })),
        { value: null, label: "None of them is right" },
    ];

    return (
        <form
            aria-label="Resolve this position"
            className="flex flex-col gap-3 rounded-sm border border-border-accent/40 p-3"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <fieldset className="flex flex-col gap-1" disabled={saving}>
                <legend className="text-label">Decision</legend>
                {choices.map((choice) => (
                    <label
                        key={choice.value ?? "none"}
                        className="flex items-center gap-2 text-sm text-text"
                    >
                        <input
                            type="radio"
                            name={`accepted-${position.positionKey}`}
                            checked={accepted === choice.value}
                            onChange={() => setAccepted(choice.value)}
                        />
                        {choice.label}
                    </label>
                ))}
            </fieldset>
            {accepted !== undefined &&
                position.verdicts.map((verdict, index) =>
                    verdict.verdictId === accepted ? null : (
                        <label
                            key={verdict.verdictId}
                            className="flex flex-col gap-1 text-sm text-text"
                        >
                            Why Answer {answerLetter(index)} is wrong
                            <textarea
                                rows={2}
                                disabled={saving}
                                value={reasons[verdict.verdictId] ?? ""}
                                onChange={(event) =>
                                    setReasons((current) => ({
                                        ...current,
                                        [verdict.verdictId]: event.target.value,
                                    }))
                                }
                                className="input-field w-full px-2 py-1 text-sm"
                            />
                        </label>
                    )
                )}
            <label className="flex flex-col gap-1 text-sm text-text">
                Note (optional)
                <input
                    type="text"
                    disabled={saving}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="input-field w-full px-2 py-1 text-sm"
                />
            </label>
            {!state.ready && (
                <p className="text-xs text-text-muted">{state.missing}</p>
            )}
            {error && (
                <p className="break-words text-xs text-danger-strong">
                    {error}
                </p>
            )}
            <div>
                <Button
                    type="submit"
                    size="sm"
                    disabled={!state.ready || saving}
                >
                    {saving ? "Resolving…" : "Record resolution"}
                </Button>
            </div>
        </form>
    );
}
