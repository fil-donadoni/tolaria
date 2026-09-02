// Extracting the `{ label, spec }` debug-scenario block out of a PR body
// (ADR 0044, issues #770 / #1455).
//
// WHY THIS EXISTS. CLAUDE.md § Development cycle step 7 has always said a PR
// shipping a new card or gameplay feature owes one preset scenario, and that a
// headless agent must NOT insert it — it emits the spec in the PR body and
// "the orchestrator registers it post-merge". ADR 0110 then retired the
// orchestrator: `/process-gh-issues`'s fan-out became `/next-issue`, one
// session per issue, and the replacement skill never inherited the
// registration step. Nothing else picked it up either — `land`, `pr-merge` and
// `check-lane` do not mention scenarios at all, so no gate ever reds on a
// missing one.
//
// Measured before writing this (2026-09-02, last 200 merged PRs): 42 carry a
// real spec, 37 explicitly say none is owed, 17 say nothing either way — while
// the `debugScenarios` table held 14 rows, the newest citing issue #2398. The
// specs were written, reviewed and merged; they were simply never inserted
// anywhere.
//
// This module is the parse half, kept pure and away from `gh` / Convex so it
// can be tested against real historical PR-body shapes. The seeding CLIs
// (`seed-scenario.ts`, `seed-scenario-backlog.ts`) and `land`'s pre-merge
// refusal all read the same classification, so authoring, enforcement and
// backfill can never disagree about what counts as a scenario block.
//
// TOLERANT ON PURPOSE. The historical corpus is not JSON: of the PR bodies
// carrying a spec, roughly half fence it as ```json and the rest as a bare
// fence holding a JS object literal — unquoted keys, single quotes, trailing
// commas. Refusing those would make the backfill useless on exactly the
// material it exists to recover. What this module does NOT tolerate is a spec
// that would load WRONG (see `validateScenarioCandidate`): those are reported,
// never silently repaired, because `normalizeScenarioSpec` is deliberately
// fail-open (it drops unknown fields and never throws) and would otherwise
// turn an authoring error into a quietly incorrect board.

import type { ScenarioSpec } from "../../convex/debugScenarioSpec";
import { normalizeScenarioSpec } from "../../convex/debugScenarioSpec";

/** A `## Preset scenario` section's verdict. */
export type ScenarioSectionKind =
    /** A block that parses and validates — ready to seed. */
    | "spec"
    /** The section exists and states that nothing is owed (a refactor, an
     *  engine capability no shipped card exposes yet). */
    | "none"
    /** The section exists and something in it looks like a spec, but it does
     *  not parse or does not validate. Deliberately NOT folded into "absent":
     *  a spec nobody can load is the failure this whole module exists to make
     *  visible, and reporting it as "you forgot one" would send the author
     *  looking in the wrong place. */
    | "malformed"
    /** No scenario section in the body at all. */
    | "absent";

export interface ScenarioCandidate {
    label: string;
    spec: ScenarioSpec;
    /** Free-text note from the block, forwarded to the row's `prompt`. */
    prompt?: string;
}

export interface ScenarioSectionVerdict {
    kind: ScenarioSectionKind;
    /** Present exactly when `kind === "spec"`. */
    candidate?: ScenarioCandidate;
    /** Present when `kind === "malformed"` — why it was rejected, for the
     *  refusal message and the backfill report. */
    problems?: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Section location
// ─────────────────────────────────────────────────────────────────────────

const HEADING = /^(#{1,6})[ \t]*(.+?)[ \t]*$/;
const SCENARIO_HEADING = /\b(?:preset|debug)\s+scenario\b/i;

/**
 * The body text under the first `# … Preset scenario …` heading, up to the
 * next heading at the SAME OR SHALLOWER level (a deeper sub-heading is part of
 * the section). Returns null when the body has no such heading.
 *
 * Level-aware rather than "up to the next `#`" because several shipped bodies
 * put a `### Spec` sub-heading inside the section, and cutting there would
 * drop the very block this is looking for.
 */
export function scenarioSection(prBody: string): string | null {
    const lines = prBody.split("\n");
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
        const m = HEADING.exec(lines[i]);
        if (m && SCENARIO_HEADING.test(m[2])) {
            start = i + 1;
            level = m[1].length;
            break;
        }
    }
    if (start === -1) return null;
    for (let i = start; i < lines.length; i++) {
        const m = HEADING.exec(lines[i]);
        if (m && m[1].length <= level) {
            return lines.slice(start, i).join("\n");
        }
    }
    return lines.slice(start).join("\n");
}

/** Phrasings a section uses to say nothing is owed. Matched against the
 *  section's opening prose only (the first ~400 chars), so a later sentence
 *  mentioning "none of the other cards" cannot mask a real omission. */
const NONE_OWED =
    /\b(?:none|nothing|not)\b[^.\n]{0,40}\b(?:owed|registrable|applicable|needed|required)\b|^\s*\**\s*none\b|\bno scenario\b|\bn\/a\b/i;

// ─────────────────────────────────────────────────────────────────────────
// Tolerant object-literal parsing
// ─────────────────────────────────────────────────────────────────────────

/**
 * JSON.parse, widened to the JS object literals half the historical corpus
 * uses: bare identifier keys, single-quoted strings, trailing commas.
 *
 * A hand-written scanner rather than a few regexes, because every regex form
 * of "quote the bare keys" also rewrites the inside of string VALUES — and a
 * scenario label routinely contains a colon ("Bot: Titania Orb") or an
 * apostrophe ("Bolas's Citadel"). The scanner tracks string state, so it only
 * ever rewrites structure.
 *
 * Never `eval`/`Function`: this parses text pulled from GitHub, and a PR body
 * is attacker-controllable by anyone who can open a PR.
 */
export function parseLooseObject(text: string): unknown {
    let out = "";
    let i = 0;
    let inString: '"' | "'" | null = null;
    while (i < text.length) {
        const ch = text[i];
        if (inString) {
            if (ch === "\\") {
                // Keep the escape pair intact; a `\'` inside a single-quoted
                // string becomes a bare `'` once re-quoted as double.
                const next = text[i + 1] ?? "";
                if (inString === "'" && next === "'") out += "'";
                else out += ch + next;
                i += 2;
                continue;
            }
            if (ch === inString) {
                out += '"';
                inString = null;
                i++;
                continue;
            }
            // A double quote inside a single-quoted string has to be escaped
            // once the string is re-quoted.
            out += ch === '"' ? '\\"' : ch;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = ch;
            out += '"';
            i++;
            continue;
        }
        // A bare identifier in KEY position — the next non-space character
        // after it is a colon. Anything else (`true`, `null`, a number) is
        // left alone and handled by JSON.parse.
        if (/[A-Za-z_$]/.test(ch)) {
            let j = i;
            while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j++;
            const word = text.slice(i, j);
            let k = j;
            while (k < text.length && /\s/.test(text[k])) k++;
            if (text[k] === ":") {
                out += `"${word}"`;
                i = j;
                continue;
            }
            out += word;
            i = j;
            continue;
        }
        out += ch;
        i++;
    }
    // Trailing commas before a closer, now that no string content can match.
    out = out.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(out) as unknown;
}

/**
 * Every candidate object in a section: fenced blocks first (```json or bare),
 * then a brace-balanced scan of the remaining prose for an inline literal, so
 * a body that wrote the spec without a fence at all is still recovered.
 * Returns the raw parsed values, unvalidated.
 */
export function extractObjects(section: string): unknown[] {
    const found: unknown[] = [];
    const fences = /```[a-zA-Z]*\s*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    let consumed = "";
    while ((m = fences.exec(section)) !== null) {
        consumed += m[0];
        for (const obj of balancedObjects(m[1])) {
            try {
                found.push(parseLooseObject(obj));
            } catch {
                // A fence that is prose, or a spec too broken to parse — the
                // caller reports it via `malformed`, which is driven by the
                // section text, not by this silence.
            }
        }
    }
    if (found.length > 0) return found;
    const rest = consumed ? section.split("```").join("\n") : section;
    for (const obj of balancedObjects(rest)) {
        try {
            found.push(parseLooseObject(obj));
        } catch {
            /* see above */
        }
    }
    return found;
}

/**
 * The UNBRACED PAIR: a fence that wrote `label: …` and `spec: { … }` as two
 * top-level lines with no enclosing object (PR #2897's shape). Recovered
 * rather than reported, because it is a real and unambiguous corpus shape —
 * the two fields are both there and in the right order, only the wrapper is
 * missing — and the whole point of the backfill is to recover specs somebody
 * actually wrote. Returns null when the text is not that shape.
 *
 * Deliberately narrow: it fires only when a `label:` line exists, a `spec:`
 * followed by a balanced object exists, and NO enclosing `{ label, spec }` was
 * found by the caller. It does not try to repair anything else.
 */
function recoverUnbracedPair(text: string): unknown | null {
    const label =
        /^[ \t]*["']?label["']?[ \t]*:[ \t]*(.+?)[ \t]*,?[ \t]*$/m.exec(text);
    if (!label) return null;
    const specAt = /^[ \t]*["']?spec["']?[ \t]*:/m.exec(text);
    if (!specAt) return null;
    const after = text.slice(specAt.index + specAt[0].length);
    const [specObj] = balancedObjects(after);
    if (!specObj) return null;
    const rawLabel = label[1].trim();
    // The label may or may not be quoted; a bare one is taken verbatim.
    const quoted = /^["'](.*)["']$/.exec(rawLabel);
    try {
        return {
            label: quoted ? quoted[1] : rawLabel,
            spec: parseLooseObject(specObj),
        };
    } catch {
        return null;
    }
}

/** Brace-balanced top-level `{…}` runs in `text`, ignoring braces inside
 *  strings. */
function balancedObjects(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = -1;
    let inString: '"' | "'" | null = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === inString) inString = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = ch;
            continue;
        }
        if (ch === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0 && start !== -1) {
                out.push(text.slice(start, i + 1));
                start = -1;
            }
            if (depth < 0) depth = 0;
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

const LEGAL_OWNERS = new Set(["me", "opp"]);
const LEGAL_ZONES = new Set([
    "hand",
    "battlefield",
    "library",
    "graveyard",
    "exile",
]);

/**
 * Turn a raw parsed object into a seedable candidate, or report why not.
 *
 * The load path (`normalizeScenarioSpec`) is deliberately FAIL-OPEN — its own
 * doc says it never throws and degrades a wholly malformed spec to an empty
 * board — which is right for loading a row someone already saved and wrong for
 * deciding whether to save one. So the checks here run against the RAW object,
 * before normalization can paper over them:
 *
 *  - `owner` outside `me`/`opp` is the one that matters in practice.
 *    `normalizeCard` maps anything unrecognised to `"me"`, so the shipped
 *    `owner: "p1"` / `"p2"` spelling (PR #2995 and others wrote it) loads
 *    happily with BOTH players' cards piled onto one side — a scenario that is
 *    silently the wrong board is worse than one that fails to seed.
 *  - a card with no `name` is dropped by `normalizeCard`, so a spec that
 *    normalizes to fewer cards than it declared has lost something.
 *  - an empty board after normalization means nothing survived at all.
 *
 * Card NAMES are not checked here — that needs the catalogue, and
 * `seedScenarioDirect` already rejects an unresolved name before write with
 * the offending names in the error. The CLI surfaces that as its own reason.
 */
export function validateScenarioCandidate(raw: unknown): {
    candidate?: ScenarioCandidate;
    problems: string[];
} {
    const problems: string[] = [];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { problems: ["not an object"] };
    }
    const obj = raw as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (!label) problems.push("missing a non-empty string `label`");
    const rawSpec = obj.spec;
    if (typeof rawSpec !== "object" || rawSpec === null) {
        problems.push("missing an object `spec`");
        return { problems };
    }
    const rawCards = (rawSpec as Record<string, unknown>).cards;
    const declared = Array.isArray(rawCards) ? rawCards.length : 0;
    if (declared === 0) problems.push("`spec.cards` is empty or not an array");
    for (const [i, c] of (Array.isArray(rawCards) ? rawCards : []).entries()) {
        if (typeof c !== "object" || c === null) {
            problems.push(`cards[${i}] is not an object`);
            continue;
        }
        const card = c as Record<string, unknown>;
        if (typeof card.name !== "string" || card.name.trim() === "") {
            problems.push(`cards[${i}] has no \`name\``);
        }
        if (card.owner !== undefined && !LEGAL_OWNERS.has(String(card.owner))) {
            problems.push(
                `cards[${i}] (${String(card.name)}) has owner "${String(card.owner)}" — must be "me" or "opp" (anything else silently loads as "me")`
            );
        }
        if (card.zone !== undefined && !LEGAL_ZONES.has(String(card.zone))) {
            problems.push(
                `cards[${i}] (${String(card.name)}) has zone "${String(card.zone)}" — must be one of ${[...LEGAL_ZONES].join(", ")}`
            );
        }
    }
    if (problems.length > 0) return { problems };

    const spec = normalizeScenarioSpec(rawSpec);
    if (spec.cards.length === 0) {
        return { problems: ["normalizes to an empty board"] };
    }
    if (spec.cards.length !== declared) {
        return {
            problems: [
                `normalization dropped ${declared - spec.cards.length} of ${declared} cards`,
            ],
        };
    }
    const prompt =
        typeof obj.prompt === "string" && obj.prompt.trim() !== ""
            ? obj.prompt.trim()
            : undefined;
    return {
        candidate: prompt ? { label, spec, prompt } : { label, spec },
        problems: [],
    };
}

// ─────────────────────────────────────────────────────────────────────────
// The one classification every caller shares
// ─────────────────────────────────────────────────────────────────────────

/** Does the section contain something that was TRYING to be a spec? Used to
 *  tell "you forgot one" (`absent`) from "yours does not load" (`malformed`). */
const LOOKS_LIKE_SPEC = /["']?label["']?\s*:/i;

export function classifyScenarioSection(
    prBody: string
): ScenarioSectionVerdict {
    const section = scenarioSection(prBody);
    if (section === null) {
        // A body with no heading may still carry a bare block (older PRs did).
        const loose = extractObjects(prBody).filter(
            (o) =>
                typeof o === "object" &&
                o !== null &&
                "label" in (o as object) &&
                "spec" in (o as object)
        );
        if (loose.length === 0) return { kind: "absent" };
        const { candidate, problems } = validateScenarioCandidate(loose[0]);
        return candidate
            ? { kind: "spec", candidate }
            : { kind: "malformed", problems };
    }
    const objects = extractObjects(section).filter(
        (o) =>
            typeof o === "object" &&
            o !== null &&
            "label" in (o as object) &&
            "spec" in (o as object)
    );
    if (objects.length > 0) {
        const { candidate, problems } = validateScenarioCandidate(objects[0]);
        return candidate
            ? { kind: "spec", candidate }
            : { kind: "malformed", problems };
    }
    const unbraced = recoverUnbracedPair(section);
    if (unbraced !== null) {
        const { candidate, problems } = validateScenarioCandidate(unbraced);
        return candidate
            ? { kind: "spec", candidate }
            : { kind: "malformed", problems };
    }
    if (LOOKS_LIKE_SPEC.test(section)) {
        return {
            kind: "malformed",
            problems: [
                "the section names a `label` but no `{ label, spec }` object could be parsed out of it",
            ],
        };
    }
    if (NONE_OWED.test(section.slice(0, 400))) return { kind: "none" };
    return { kind: "absent" };
}

// ─────────────────────────────────────────────────────────────────────────
// Who owes one
// ─────────────────────────────────────────────────────────────────────────

/**
 * Paths whose change can add or alter something a player can DO in a game —
 * the diffs CLAUDE.md step 7 means by "any new card/gameplay feature".
 *
 * Deliberately narrow: card definitions and the engine. A `src/**` change
 * already owes a `check:ui` receipt, scripts and docs own no gameplay, and
 * tests are excluded because a test-only diff adds no surface a scenario could
 * show. Narrow beats clever here — a predicate that refuses a PR nobody
 * believes owes a scenario is a predicate people route around.
 */
export function owesScenario(paths: string[]): boolean {
    return paths.some((p) => {
        if (/(?:^|\/)__tests__\//.test(p)) return false;
        if (/\.test\.tsx?$/.test(p)) return false;
        return (
            p.startsWith("convex/cards/sets/") || p.startsWith("convex/gre/")
        );
    });
}

/**
 * `land`'s pre-merge verdict, as a pure function of the two facts it has.
 * Returns a refusal string, or null to allow.
 *
 * A `malformed` block is refused even when the diff owes nothing: whoever
 * wrote it meant to ship a scenario, and letting it merge is how the corpus
 * filled up with specs that load onto the wrong side of the board.
 */
export function scenarioRefusal(
    verdict: ScenarioSectionVerdict,
    owes: boolean
): string | null {
    if (verdict.kind === "malformed") {
        return (
            "the PR's preset-scenario block does not load: " +
            (verdict.problems ?? []).join("; ") +
            " — fix the block, or state that none is owed"
        );
    }
    if (!owes) return null;
    if (verdict.kind === "absent") {
        return (
            "the landing diff touches `convex/cards/sets/**` or `convex/gre/**` but the PR body has no preset scenario " +
            "(ADR 0044, CLAUDE.md § Development cycle step 7). Add a `## Preset scenario` section with a " +
            '```json fenced `{ "label": …, "spec": { "cards": [ … ] } }` block, or say in that section that none is owed'
        );
    }
    return null;
}
