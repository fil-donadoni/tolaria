/**
 * The Bot Findings seed payload (ADR 0141 § 4, issue #4176) — PURE over the
 * committed files `scripts/seed-bot-findings.ts` reads: the measurement
 * artifact (`data/bot-reach-findings.json`), the `gaps:sync` claims
 * (`data/grammar-gaps.json`) and the card index.
 *
 * What it decides:
 *
 *  - which artifact rows are FINDINGS (a non-`played` verdict — `ignored` or
 *    `frozen`; an `unplayable` card ships no definition, so nothing was played
 *    and nothing is owed) and which are merely `played` ids, sent so a stored
 *    finding the Bot now plays can record it;
 *  - one class per Bot Gap key, whose prose is the FILER'S own
 *    ({@link botCauseText}, `gap-kinds.ts`) — the page shows the words the
 *    issue was filed with, never a second copy of them;
 *  - the honesty numbers: cards of the measured Targets, how many of them were
 *    actually played, and the hand-written catalogue cards no Target measures.
 */

import type {
    FindingClass,
    MeasuredFinding,
    SeedPayload,
} from "../../convex/botFindingsCore";
import { botCauseOf, botCauseText } from "./gap-kinds";
import type { FindingsArtifact } from "./oracle-bot-reach";
import type { ClaimRow } from "./targets";

/** A `data/card-index.json` row, as far as the seed reads it. */
export interface CardIndexEntry {
    readonly oracleId?: string;
    readonly firstPrintId?: string;
    readonly source?: string;
}

/**
 * The hand-written catalogue, by oracle id → the print id its definition is
 * registered under: a card-index row the compiler did not produce, joined to
 * a registered definition through its first print. The join
 * `target-bot-reach.ts` measures with — one copy, so "hand-written" means the
 * same card set on the page and in the sweep.
 */
export function handWrittenPrintIds(
    index: readonly CardIndexEntry[],
    registeredPrintIds: Iterable<string>
): Map<string, string> {
    const oracleIdByPrintId = new Map<string, string>();
    for (const e of index) {
        if (e.source === "compiled" || !e.oracleId || !e.firstPrintId) continue;
        oracleIdByPrintId.set(e.firstPrintId, e.oracleId);
    }
    const handWritten = new Map<string, string>();
    for (const printId of registeredPrintIds) {
        const oracleId = oracleIdByPrintId.get(printId);
        if (oracleId !== undefined && !handWritten.has(oracleId))
            handWritten.set(oracleId, printId);
    }
    return handWritten;
}

export interface SeedInputs {
    readonly artifact: FindingsArtifact;
    readonly claims: readonly ClaimRow[];
    readonly cardIndex: readonly CardIndexEntry[];
    /** {@link handWrittenPrintIds}' keys. */
    readonly handWritten: ReadonlySet<string>;
}

export function buildBotFindingsPayload(inputs: SeedInputs): SeedPayload {
    const { artifact } = inputs;
    const printIdOf = new Map<string, string>();
    for (const e of inputs.cardIndex)
        if (e.oracleId && e.firstPrintId && !printIdOf.has(e.oracleId))
            printIdOf.set(e.oracleId, e.firstPrintId);
    const issueOf = new Map(
        inputs.claims
            .filter((c) => c.kind === "bot")
            .map((c) => [c.key, c.issue] as const)
    );

    const findings: MeasuredFinding[] = [];
    const played: string[] = [];
    const byKey = new Map<string, MeasuredFinding[]>();
    for (const row of artifact.findings) {
        if (row.outcome === "played") {
            played.push(row.oracleId);
            continue;
        }
        if (row.outcome === "unplayable") continue;
        const printId = printIdOf.get(row.oracleId);
        const finding: MeasuredFinding = {
            oracleId: row.oracleId,
            name: row.name,
            targets: [...row.targets],
            outcome: row.outcome,
            ...(printId === undefined ? {} : { printId }),
            ...(row.cause === undefined ? {} : { cause: row.cause }),
            ...(row.form === undefined ? {} : { form: row.form }),
            ...(row.gap === undefined ? {} : { gap: row.gap }),
            ...(row.blame === undefined ? {} : { blame: row.blame }),
            ...(row.source === undefined ? {} : { compileSource: row.source }),
        };
        findings.push(finding);
        if (finding.gap !== undefined) {
            const members = byKey.get(finding.gap) ?? [];
            members.push(finding);
            byKey.set(finding.gap, members);
        }
    }

    const classes: FindingClass[] = [...byKey.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, members]) => {
            const cause = botCauseOf(key);
            const issue = issueOf.get(key);
            return {
                key,
                cause,
                // Every member carries the same key, hence the same cause,
                // hence the same blame (`blameFor` is a function of cause).
                blame: members[0]!.blame ?? "bot",
                causeText: botCauseText(cause),
                cardCount: members.length,
                targetCounts: artifact.targets.map((target) => ({
                    target,
                    count: members.filter((m) => m.targets.includes(target))
                        .length,
                })),
                ...(issue === undefined ? {} : { issue }),
            };
        });

    const measuredIds = new Set(artifact.findings.map((f) => f.oracleId));
    let unmeasuredHandWrittenCount = 0;
    for (const id of inputs.handWritten)
        if (!measuredIds.has(id)) unmeasuredHandWrittenCount++;

    return {
        measurement: {
            ...artifact.header,
            targets: [...artifact.targets],
            targetCardCount: artifact.findings.length,
            measuredCount: artifact.findings.filter(
                (f) => f.outcome !== "unplayable"
            ).length,
            unmeasuredHandWrittenCount,
        },
        findings,
        played,
        classes,
    };
}
