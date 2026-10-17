import { Fragment, type ReactNode } from "react";
import { formatOracleText } from "~/lib/oracle-text";
import {
    ABILITY_WORD_SOURCE,
    type AbilityWordCounter,
} from "~/lib/ability-word-counters";
import AbilityWordChip from "./ability-word-chip";

// Renders one oracle-text paragraph. When `counters` are supplied (an in-game
// preview), it splices a live count chip (AbilityWordChip) directly after each
// count-based ability word or phrase the table names — one chip per word per
// paragraph, so "Domain — … basic land types among lands you control" carries
// the count once. Without counters (deck builder, card profile, back face) it
// falls back to plain symbol-formatted text.
export default function OracleParagraph({
    text,
    counters,
}: {
    text: string;
    counters: Map<string, AbilityWordCounter> | null;
}) {
    if (!counters) return <>{formatOracleText(text)}</>;

    const parts: ReactNode[] = [];
    const chipped = new Set<string>();
    let lastIndex = 0;
    // Fresh regex per render — a shared global with a mutable `lastIndex` can't
    // be scanned from inside a component (React Compiler immutability).
    for (const match of text.matchAll(new RegExp(ABILITY_WORD_SOURCE, "g"))) {
        const counter = counters.get(match[0]);
        if (!counter || chipped.has(counter.key)) continue;
        chipped.add(counter.key);
        const end = match.index + match[0].length;
        // Emit the run of text up to and including the word, then the chip.
        parts.push(
            <Fragment key={`seg-${counter.key}`}>
                {formatOracleText(text.slice(lastIndex, end))}
            </Fragment>,
            <AbilityWordChip key={`chip-${counter.key}`} counter={counter} />
        );
        lastIndex = end;
    }
    if (parts.length === 0) return <>{formatOracleText(text)}</>;
    parts.push(
        <Fragment key="seg-end">
            {formatOracleText(text.slice(lastIndex))}
        </Fragment>
    );
    return <>{parts}</>;
}
