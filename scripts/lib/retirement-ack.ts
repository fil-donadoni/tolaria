// The retirement-row acknowledgement gate (issue #3049, ADR 0114 §1).
//
// WHY THIS EXISTS. Once a card's hand-written definition is retired, its
// lockfile row is the ONLY copy of that card's behaviour. `check:oracle`
// already proves the row is what the compiler produces, and Guard C already
// proves a hand-written card round-trips — neither asks the question that
// matters after retirement: did a human LOOK at this row changing? A
// regenerated lockfile moves rows for all sorts of innocent reasons (a grammar
// rule lands, the corpus is re-pinned), and a marked row moving inside that
// churn is indistinguishable from the rest at a glance. It is not the same
// thing at all: for every other row a regression is recoverable from the
// hand-written twin sitting in `convex/cards/sets/**`; for a marked row there
// is no twin, and the diff is the whole record.
//
// So the marked rows a landing diff touches must be NAMED in the PR body. Same
// split Guard B and Guard C make and the same one `land` already applies to the
// preset scenario (ADR 0044) and the `check:ui` receipt: presence is offline
// and cheap and belongs in the gate; the judgement is a human's, recorded where
// review happens.
//
// This module is the pure half — diff text and PR body in, refusal string out
// — so every case is testable without git, `gh`, or a corpus.

import type { RetirementMarker } from "./oracle-retirements";

/** A marked lockfile row the landing diff adds, removes or rewrites. */
export interface ChangedRetiredRow {
    readonly oracleId: string;
    readonly name: string;
    /** The marker as it stands on whichever side of the diff carried one. When
     *  both sides do and they differ, the NEW side wins — that is the claim the
     *  merge would ship. */
    readonly marker: RetirementMarker;
    /** true when the row exists only on the `-` side: the marked row is being
     *  DELETED, the loudest case this gate has. */
    readonly removed: boolean;
}

/** The row shape this scanner needs — a structural subset of `CardRow`, so the
 *  parser does not depend on the compiler's types. */
interface ParsedRow {
    oracleId?: unknown;
    name?: unknown;
    retired?: unknown;
}

function asMarker(value: unknown): RetirementMarker | null {
    if (typeof value !== "object" || value === null) return null;
    const m = value as Record<string, unknown>;
    if (typeof m.at !== "string" || typeof m.issue !== "number") return null;
    return {
        at: m.at,
        issue: m.issue,
        ...(typeof m.pr === "number" ? { pr: m.pr } : {}),
    };
}

/**
 * Every marked row touched by a `git diff -U0 -- data/oracle-compiled.json`.
 *
 * The lockfile's serializer puts one card row per line (that is the whole
 * reason the file is committed), so a line-oriented scan is exact rather than
 * approximate: each `+`/`-` line either parses as a row object or is not one.
 * A trailing comma is stripped before parsing — the serializer emits one on
 * every row but the last, and a scanner that choked on it would silently see
 * only the final row of the file.
 *
 * A row is reported when EITHER side carries the marker: an added marker (the
 * retirement itself), a removed one (an un-retirement, or a marker lost to a
 * bad merge), and a marked row whose compiled definition changed all need the
 * same human look.
 */
export function changedRetiredRows(diff: string): ChangedRetiredRow[] {
    const added = new Map<string, ChangedRetiredRow>();
    const removed = new Map<string, ChangedRetiredRow>();
    for (const line of diff.split("\n")) {
        const sign = line[0];
        if (sign !== "+" && sign !== "-") continue;
        // `+++ b/…` / `--- a/…` are headers, never rows.
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        const body = line.slice(1).trim().replace(/,$/, "");
        if (!body.startsWith("{")) continue;
        let row: ParsedRow;
        try {
            row = JSON.parse(body) as ParsedRow;
        } catch {
            continue;
        }
        if (typeof row.oracleId !== "string" || typeof row.name !== "string") {
            continue;
        }
        const marker = asMarker(row.retired);
        if (marker === null) continue;
        (sign === "+" ? added : removed).set(row.oracleId, {
            oracleId: row.oracleId,
            name: row.name,
            marker,
            removed: false,
        });
    }
    const out: ChangedRetiredRow[] = [];
    for (const row of added.values()) out.push(row);
    for (const [oracleId, row] of removed) {
        if (added.has(oracleId)) continue;
        out.push({ ...row, removed: true });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const HEADING = /^(#{1,6})[ \t]*(.+?)[ \t]*$/;
const RETIRED_HEADING = /\bretired\b.*\brows?\b|\bretirement\b/i;

/**
 * The body text under the first `## Retired rows` heading, up to the next
 * heading at the same or shallower level. Same level-aware shape as
 * `scenarioSection` — a sub-heading inside the section is part of it.
 */
export function retirementSection(prBody: string): string | null {
    const lines = prBody.split("\n");
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
        const m = HEADING.exec(lines[i]);
        if (m && RETIRED_HEADING.test(m[2])) {
            start = i + 1;
            level = m[1].length;
            break;
        }
    }
    if (start === -1) return null;
    for (let i = start; i < lines.length; i++) {
        const m = HEADING.exec(lines[i]);
        if (m && m[1].length <= level) return lines.slice(start, i).join("\n");
    }
    return lines.slice(start).join("\n");
}

/**
 * `land`'s verdict on the retired rows a landing diff touches, or null to
 * allow.
 *
 * Acknowledgement is "the section exists and NAMES the card". Deliberately not
 * a checkbox or a fixed grammar: the point is that a human wrote down what
 * changed and why it is still correct, and a format strict enough to lint is a
 * format people satisfy without reading the row. Naming the card is the one
 * thing a copy-pasted template cannot do by accident, and it is what makes the
 * section useful to the next reader.
 *
 * The refusal names the card AND why its row is special, because "row changed,
 * acknowledge it" tells a reader nothing they can act on — the whole content
 * of this gate is that this particular row has no hand-written twin behind it.
 */
export function retirementRefusal(
    changed: readonly ChangedRetiredRow[],
    prBody: string
): string | null {
    if (changed.length === 0) return null;
    const section = retirementSection(prBody);
    const haystack = (section ?? "").toLowerCase();
    const unacknowledged = changed.filter(
        (row) => !haystack.includes(row.name.toLowerCase())
    );
    if (unacknowledged.length === 0) return null;
    const listed = unacknowledged
        .map(
            (row) =>
                `      - ${row.name}${row.removed ? " (row REMOVED)" : ""} — retired ${row.marker.at} under issue #${row.marker.issue}`
        )
        .join("\n");
    return (
        `the landing diff changes ${unacknowledged.length} retired lockfile row(s) that the PR body does not name.\n` +
        `    These cards have NO hand-written definition left (ADR 0114 §1): their row in ` +
        `data/oracle-compiled.json is the only copy of their behaviour, so a change to one is a behaviour\n` +
        `    change with nothing to fall back on — a regression here is silent, because nobody reads a file ` +
        `that no longer exists.\n` +
        listed +
        `\n    Add a \`## Retired rows\` section to the PR body naming each card and what changed about its row.`
    );
}
