// The Bot Findings copy-to-session payload (ADR 0141 § 9, PRD #4174, issue
// #4178): a pure function from a finding or a class to the text a Claude Code
// session starts from. Two branches, chosen by the class's state:
//
//   - the class carries an issue → `/next-issue <N>` plus the context the issue
//     cannot carry (the card in focus, the reproducer, the measurement sha and
//     Bot hash);
//   - it does not → a filing-ready brief.
//
// The cause prose is NEVER written here: a class row carries `causeText`, read
// from the filer (`botCauseText`, `scripts/lib/gap-kinds.ts`, seeded by
// `scripts/lib/bot-findings-seed.ts`) — the issue's body and this brief cannot
// tell two stories about one class. Both branches end with the line naming how
// the loop closes.
import {
    findingTraceText,
    type BotFindingClassRow,
    type BotFindingMeasurement,
    type BotFindingRow,
} from "@/lib/botFindings";

/** How the loop closes — the last line of every payload. */
export const LOOP_CLOSE_LINE =
    "Close the loop: land a `must` blade entry for the class (`/bot-slice`), then re-measure with `bun run bot:reach` and `bun run seed:bot-findings`.";

/** The reproducer labels naming a finding's position: the ones a human
 *  attached, then the class's proving `must` entry. Distinct, in that order. */
export function findingReproducers(
    finding: Pick<BotFindingRow, "reproducers">,
    cls: Pick<BotFindingClassRow, "provingEntry"> | undefined
): string[] {
    return [
        ...new Set([
            ...(finding.reproducers ?? []),
            ...(cls?.provingEntry === undefined ? [] : [cls.provingEntry]),
        ]),
    ];
}

function measurementLine(m: BotFindingMeasurement | null): string {
    return m === null
        ? "Measurement: none seeded on this deployment."
        : `Measurement: sha ${m.sha}, Bot hash ${m.botHash}, measured ${m.measuredAt}.`;
}

function reproducerLines(labels: readonly string[]): string[] {
    return labels.length === 0
        ? ["Reproducer: none attached."]
        : labels.map((label) => `Reproducer: ${label}`);
}

/** The card block: name, outcome, cause, gap key, and the search's own
 *  evidence for a `never-chosen` card. */
function cardLines(finding: BotFindingRow): string[] {
    const lines = [
        `Card in focus: ${finding.name} (oracle id ${finding.oracleId})`,
        `Outcome: ${finding.outcome}${finding.cause === undefined ? "" : `, cause \`${finding.cause}\``}`,
    ];
    if (finding.trace !== undefined)
        lines.push("", "Decision trace:", findingTraceText(finding.trace));
    return lines;
}

function classBriefLines(cls: BotFindingClassRow): string[] {
    return [`Bot Gap key: \`${cls.key}\``, "", cls.causeText];
}

/** The payload for ONE card. */
export function findingPayload(
    finding: BotFindingRow,
    cls: BotFindingClassRow | undefined,
    measurement: BotFindingMeasurement | null
): string {
    const context = [
        ...cardLines(finding),
        ...(cls === undefined ? [] : [`Class: \`${cls.key}\``]),
        ...reproducerLines(findingReproducers(finding, cls)),
        measurementLine(measurement),
    ];
    if (cls?.issue !== undefined)
        return [
            `/next-issue ${cls.issue}`,
            "",
            "Context the issue cannot carry:",
            ...context.map((line) => (line === "" ? line : `- ${line}`)),
            "",
            LOOP_CLOSE_LINE,
        ].join("\n");
    return [
        "No issue is filed for this class yet (`bun run gaps:sync` is the only filer). Brief:",
        "",
        ...(cls === undefined ? [] : [...classBriefLines(cls), ""]),
        ...context,
        "",
        LOOP_CLOSE_LINE,
    ].join("\n");
}

/** The payload for a whole class: ONE brief naming every card it holds —
 *  the fix is per class, never per card (ADR 0102). */
export function classPayload(
    cls: BotFindingClassRow,
    findings: readonly BotFindingRow[],
    measurement: BotFindingMeasurement | null
): string {
    const members = findings
        .filter((f) => f.gap === cls.key)
        .sort((a, b) => a.name.localeCompare(b.name));
    const cards = [
        `Cards (${members.length}):`,
        ...members.map(
            (f) =>
                `- ${f.name} — ${f.outcome}${f.cause === undefined ? "" : `, \`${f.cause}\``}`
        ),
    ];
    const context = [
        `Class: \`${cls.key}\``,
        ...reproducerLines(
            cls.provingEntry === undefined ? [] : [cls.provingEntry]
        ),
        measurementLine(measurement),
    ];
    if (cls.issue !== undefined)
        return [
            `/next-issue ${cls.issue}`,
            "",
            "Context the issue cannot carry:",
            ...context.map((line) => `- ${line}`),
            "",
            ...cards,
            "",
            LOOP_CLOSE_LINE,
        ].join("\n");
    return [
        "No issue is filed for this class yet (`bun run gaps:sync` is the only filer). Brief:",
        "",
        ...classBriefLines(cls),
        "",
        ...context,
        "",
        ...cards,
        "",
        LOOP_CLOSE_LINE,
    ].join("\n");
}
