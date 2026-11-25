/**
 * What a Bot-play replay leaves behind when it does not land (issue #10737).
 *
 * WHY. The replay's wall cut two sweeps in a row on 2026-11-25, at 3192 and
 * 4880 of 9258 cards. Nothing was kept and, the cadence counting landed sweeps
 * only, the next run started again from zero: the `maint` runner was held back
 * to back. So a replay keeps, outside the job worktree, the verdicts it played
 * (the journal) and the fact that it started (the attempt).
 *
 * The journal is append-only, one JSON line a verdict, each carrying the Bot
 * hash and the definition hash it was played under, the cache rule of the
 * lockfile itself. A line of another hash, and a line torn by a kill, is
 * skipped. A `harness-error` is never written: it measured the machine, and
 * carrying it would make a resumed sweep differ from an uninterrupted one.
 *
 * The replay is pinned to one host (`bot-replay`, ADR 0159), so the files are
 * that machine's own.
 */
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BotReachVerdict } from "../../convex/gre/ai/botReach";
import type { CompiledDefinition } from "../../convex/oracle/types";
import type { BotReplayAttempt } from "./bot-replay-cadence";
import { definitionHash } from "./oracle-bot-reach";

/** The replay's files — under the home directory, outside every worktree. */
export function botReplayDir(home: string = homedir()): string {
    return join(home, ".cache", "tolaria", "bot-replay");
}

export function botReplayJournalPath(dir: string = botReplayDir()): string {
    return join(dir, "journal.jsonl");
}

interface JournalLine {
    readonly botHash: string;
    readonly oracleId: string;
    readonly definitionHash: string;
    readonly verdict: BotReachVerdict;
}

/** The lines of `botHash`; unreadable ones are skipped. */
function journalLines(path: string, botHash: string): JournalLine[] {
    if (!existsSync(path)) return [];
    const lines: JournalLine[] = [];
    for (const text of readFileSync(path, "utf8").split("\n")) {
        try {
            const line = JSON.parse(text) as JournalLine;
            if (line.botHash === botHash && line.verdict?.outcome !== undefined)
                lines.push(line);
        } catch {
            // Blank, or torn by the kill that cut the sweep.
        }
    }
    return lines;
}

/** How many verdicts are journaled under `botHash`. */
export function journaledCount(path: string, botHash: string): number {
    return journalLines(path, botHash).length;
}

export interface ReplayJournal {
    /** Verdicts of the cards asked for, played under this very Bot and
     *  definition. */
    readonly known: ReadonlyMap<string, BotReachVerdict>;
    /** The cards left to play. */
    readonly missing: ReadonlyMap<string, CompiledDefinition>;
    readonly record: (oracleId: string, verdict: BotReachVerdict) => void;
}

/** Opens the journal for a sweep of `definitions`. Lines of another Bot are
 *  dropped from the file: one Bot's verdicts is all it ever holds. */
export function openReplayJournal(
    path: string,
    botHash: string,
    definitions: ReadonlyMap<string, CompiledDefinition>
): ReplayJournal {
    const kept = journalLines(path, botHash);
    mkdirSync(dirname(path), { recursive: true });
    // Renamed into place: a kill here must not lose the journal it compacts.
    const compacted = `${path}.${process.pid}.tmp`;
    writeFileSync(
        compacted,
        kept.map((l) => `${JSON.stringify(l)}\n`).join("")
    );
    renameSync(compacted, path);
    const known = new Map<string, BotReachVerdict>();
    for (const line of kept) {
        const definition = definitions.get(line.oracleId);
        if (
            definition !== undefined &&
            definitionHash(definition) === line.definitionHash
        )
            known.set(line.oracleId, line.verdict);
    }
    return {
        known,
        missing: new Map([...definitions].filter(([id]) => !known.has(id))),
        record(oracleId, verdict) {
            if (verdict.cause === "harness-error") return;
            appendFileSync(
                path,
                `${JSON.stringify({
                    botHash,
                    oracleId,
                    definitionHash: definitionHash(definitions.get(oracleId)),
                    verdict,
                } satisfies JournalLine)}\n`
            );
        },
    };
}

function attemptPath(dir: string): string {
    return join(dir, "attempt.json");
}

/** Written before the sweep starts, so a killed run counts too. */
export function writeReplayAttempt(
    attempt: { readonly botHash: string; readonly startedAtMs: number },
    dir: string = botReplayDir()
): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        attemptPath(dir),
        JSON.stringify({
            ...attempt,
            journaledBefore: journaledCount(
                botReplayJournalPath(dir),
                attempt.botHash
            ),
        })
    );
}

/** The last replay this machine started, with what its journal holds for
 *  `treeBotHash`; null when there is none to read. */
export function readReplayAttempt(
    treeBotHash: string,
    dir: string = botReplayDir()
): BotReplayAttempt | null {
    try {
        const raw = JSON.parse(readFileSync(attemptPath(dir), "utf8")) as {
            botHash?: unknown;
            startedAtMs?: unknown;
            journaledBefore?: unknown;
        };
        if (
            typeof raw.botHash !== "string" ||
            typeof raw.startedAtMs !== "number" ||
            typeof raw.journaledBefore !== "number"
        )
            return null;
        return {
            startedAtMs: raw.startedAtMs,
            resumable:
                raw.botHash === treeBotHash &&
                journaledCount(botReplayJournalPath(dir), treeBotHash) >
                    raw.journaledBefore,
        };
    } catch {
        return null;
    }
}
