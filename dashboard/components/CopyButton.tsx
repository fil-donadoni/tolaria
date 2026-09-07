import { useEffect, useRef, useState } from "react";
import { CONTROL_CLASS } from "../lib/controls";

/**
 * Copies one literal to the clipboard (PRD #3148 S2), ported from
 * `now-nav.js`'s `copyCommand` and `now-verdict-band.js`'s copy affordance.
 *
 * THE LABEL SAYS "Copy <literal>", NOT "Copy the command <literal>" (PR #2837
 * review, finding 2). Only five of the seven `REMEDY` values backtick a
 * command: `orphans` backticks the label `in-progress` and `feed` backticks
 * `ready-for-agent`, both GitHub label names you paste into `gh`, not things
 * you run. A screen reader announcing "Copy the command ready-for-agent" is
 * simply wrong, and sniffing "does this look like a command" would be a guess
 * this component has no business making.
 *
 * A denied clipboard permission must not look like a successful copy, so the
 * failure has its own word.
 */
export function CopyButton({
    text,
    label = "copy",
    title,
    what,
}: {
    text: string;
    label?: string;
    title?: string;
    /** What the literal IS, when the literal alone does not say. "Copy
     *  9f8e7d6c-5b4a-…" announces a uuid and nothing else; "Copy batch id
     *  9f8e7d6c-5b4a-…" says which one. Omitted for a remedy's own literal,
     *  where the literal is already the whole answer. */
    what?: string;
}) {
    const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        []
    );

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setState("copied");
        } catch {
            setState("failed");
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 1200);
    };

    return (
        <button
            type="button"
            className={CONTROL_CLASS}
            title={title ?? "Copy"}
            aria-label={what ? `Copy ${what} ${text}` : `Copy ${text}`}
            onClick={() => void copy()}
        >
            {state === "idle"
                ? label
                : state === "copied"
                  ? "copied"
                  : "copy failed"}
        </button>
    );
}
