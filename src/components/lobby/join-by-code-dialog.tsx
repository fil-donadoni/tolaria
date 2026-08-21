// "Join by code" code-entry step (issue #2649, ADR 0101 §10 Arena action set).
//
// The lobby's other three Arena actions fire their mutation on click; this one
// needs six characters first, so it takes the same shape as the vs-AI setup
// dialog: the action opens a dialog, the dialog collects its one input, and
// only Confirm fires the mutation.
//
// Everything about the code's VALIDITY is the server's call. This component
// checks only that six alphabet characters have been typed — enough to keep
// Confirm inert on an obviously unfinished code, and deliberately NOT a
// pre-flight lookup: resolving a code client-side is exactly what the ticket
// forbids, and a "does this code exist?" probe would turn the code space into
// an enumerable oracle. A typed code that is wrong comes back as a server
// error, rendered here verbatim.

import { useState } from "react";

import { JOIN_CODE_LENGTH, normalizeJoinCode } from "@convex/joinCodes";
import GameDialog from "~/components/ui/game-dialog";
import { Input } from "~/components/ui/input";
import { Banner } from "~/components/ui/banner";
import ActionButton from "~/components/board/action-button";

interface JoinByCodeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Fires the join mutation. Rejects with the server's message, which is
     *  the ONLY thing that decides whether a code was any good. */
    onSubmit: (code: string) => Promise<void>;
}

export default function JoinByCodeDialog({
    open,
    onOpenChange,
    onSubmit,
}: JoinByCodeDialogProps) {
    const [raw, setRaw] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    // A reopened dialog starts clean — a stale "not joinable" banner from the
    // last attempt would read as a verdict on the code about to be typed.
    // Cleared on the way OUT rather than in an effect on `open`: every close
    // path this dialog has (Cancel, Esc, backdrop, a successful join) goes
    // through here, and resetting in an effect is a cascading render the
    // `react-hooks/set-state-in-effect` rule rightly rejects.
    function close() {
        setRaw("");
        setError(null);
        setPending(false);
        onOpenChange(false);
    }

    const code = normalizeJoinCode(raw);

    async function handleSubmit() {
        if (!code || pending) return;
        setPending(true);
        setError(null);
        try {
            await onSubmit(code);
            close();
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : "Could not join that table. Try again."
            );
            setPending(false);
        }
    }

    return (
        <GameDialog
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
            title="Join by code"
            subtitle="Type the code the host of the table shared with you."
            footer={
                <>
                    <ActionButton
                        onClick={close}
                        label="Cancel"
                        tone="secondary"
                        disabled={pending}
                    />
                    <ActionButton
                        onClick={() => void handleSubmit()}
                        label={pending ? "Joining…" : "Join table"}
                        tone="primary"
                        // Project rule: a button firing a mutation is inert
                        // while that mutation is in flight.
                        disabled={pending || !code}
                    />
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <label
                    className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"
                    htmlFor="join-code-input"
                >
                    Join code
                    <Input
                        id="join-code-input"
                        value={raw}
                        onChange={(e) => {
                            setRaw(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSubmit();
                        }}
                        // `maxLength` allows for the grouping dash a host is
                        // likely to copy along with the code; the normalizer
                        // strips it.
                        maxLength={JOIN_CODE_LENGTH + 2}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="ABC-123"
                        aria-invalid={error ? true : undefined}
                        aria-describedby="join-code-hint"
                        disabled={pending}
                        className="text-center font-mono text-lg uppercase tracking-[0.3em]"
                    />
                </label>
                <p id="join-code-hint" className="text-xs text-text-muted">
                    {JOIN_CODE_LENGTH} characters. Case doesn&apos;t matter, and
                    the dash is optional. The letters I, L, O and U are never
                    used — if you see one, it&apos;s a 1 or a 0.
                </p>
                {error && (
                    <Banner tone="danger" role="alert">
                        {error}
                    </Banner>
                )}
            </div>
        </GameDialog>
    );
}
