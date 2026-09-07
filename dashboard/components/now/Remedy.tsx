import { Fragment } from "react";
import { CopyButton } from "../CopyButton";
import { splitRemedy } from "../../lib/verdict";

/**
 * The verdict's "Next step" line (PRD #3148 S2).
 *
 * The engine words a remedy as PROSE with its literals in backticks, so the
 * prose renders as prose and each literal gets a `<code>` plus its own copy
 * affordance carrying exactly that span — never a button that copies an
 * English sentence. See `splitRemedy` for the rest of the reasoning.
 */
export function Remedy({ remedy }: { remedy: string }) {
    const parts = splitRemedy(remedy);
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {parts.map((part, i) =>
                i % 2 === 0 ? (
                    <Fragment key={i}>{part}</Fragment>
                ) : (
                    <Fragment key={i}>
                        <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                            {part}
                        </code>
                        <CopyButton text={part} />
                    </Fragment>
                )
            )}
        </span>
    );
}
