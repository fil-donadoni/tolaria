/**
 * The Bot Reach Findings report merged over the lockfile, findings-only cards
 * included (issue #4180). `mergeBotVerdicts` (`oracle-bot-reach.ts`) walks the
 * lockfile's rows only; a hand-written card the lockfile has no row for — its
 * Bot Gap class exists nowhere else — is merged here. Kept out of
 * `oracle-bot-reach.ts` on purpose: that file is a compiler-hash input, and a
 * `gaps:sync` concern must not force an `oracle:compile`.
 */
import type { CardRow } from "./oracle-lockfile";
import {
    mergeBotVerdicts,
    type BotGapVerdict,
    type FindingsArtifact,
} from "./oracle-bot-reach";

/**
 * A merged Bot verdict. `name` and `targets` are set only on a card the
 * lockfile has no row for: the filer has no row to read its name from, and the
 * Targets the report measured it under are its only Target attribution.
 */
export interface BotFindingVerdict extends BotGapVerdict {
    readonly name?: string;
    readonly targets?: readonly string[];
}

/**
 * {@link mergeBotVerdicts} plus the report's `hand-written` rows the lockfile
 * has no row for — one input more, never a second verdict for a card both
 * hold. A findings-only row is stale under a moved Bot hash, like every other.
 * A `compiled` row with no lockfile row is an orphan of a card that left the
 * corpus: ignored, never stale, or one orphan would hold every `bot` claim
 * open until `bot:reach` rewrote the report.
 */
export function mergeAllBotVerdicts(
    findings: FindingsArtifact | null,
    lockCards: readonly CardRow[],
    currentBotHash: string
): {
    readonly merged: ReadonlyMap<string, BotFindingVerdict>;
    readonly stale: readonly string[];
} {
    const base = mergeBotVerdicts(findings, lockCards, currentBotHash);
    const merged = new Map<string, BotFindingVerdict>(base.merged);
    const stale = [...base.stale];
    const lockIds = new Set(lockCards.map((row) => row.oracleId));
    for (const report of findings?.findings ?? []) {
        if (
            lockIds.has(report.oracleId) ||
            report.outcome === "unplayable" ||
            report.source !== "hand-written"
        )
            continue;
        if (findings!.header.botHash !== currentBotHash)
            stale.push(report.oracleId);
        else
            merged.set(report.oracleId, {
                outcome: report.outcome,
                gap: report.gap,
                name: report.name,
                targets: report.targets,
            });
    }
    return { merged, stale: stale.sort() };
}
