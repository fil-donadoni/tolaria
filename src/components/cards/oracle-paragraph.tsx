import { Fragment, type ReactNode } from "react";
import { formatOracleText } from "~/lib/oracle-text";
import {
    MILESTONE_WORD_SOURCE,
    type Milestone,
} from "~/lib/graveyard-milestones";
import MilestoneChip from "./milestone-chip";

// Renders one oracle-text paragraph. When `milestones` are supplied (an in-game
// preview), it splices a live progress chip (MilestoneChip) directly after each
// graveyard ability word — Delirium / Threshold — reflecting the controller's
// current graveyard state. Without milestones (deck builder, no game context)
// it falls back to plain symbol-formatted text.
export default function OracleParagraph({
    text,
    milestones,
}: {
    text: string;
    milestones: Map<string, Milestone> | null;
}) {
    if (!milestones) return <>{formatOracleText(text)}</>;

    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    // Fresh regex per render — a shared global with a mutable `lastIndex` can't
    // be scanned from inside a component (React Compiler immutability).
    for (const match of text.matchAll(new RegExp(MILESTONE_WORD_SOURCE, "g"))) {
        const end = match.index + match[0].length;
        // Emit the run of text up to and including the ability word, then the
        // chip right after it.
        parts.push(
            <Fragment key={`seg-${key}`}>
                {formatOracleText(text.slice(lastIndex, end))}
            </Fragment>
        );
        const milestone = milestones.get(match[1].toLowerCase());
        if (milestone) {
            parts.push(
                <MilestoneChip key={`chip-${key}`} milestone={milestone} />
            );
        }
        lastIndex = end;
        key++;
    }
    if (parts.length === 0) return <>{formatOracleText(text)}</>;
    parts.push(
        <Fragment key="seg-end">
            {formatOracleText(text.slice(lastIndex))}
        </Fragment>
    );
    return <>{parts}</>;
}
