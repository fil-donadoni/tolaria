/**
 * The vendored Comprehensive Rules as RULES — the parser and slicer behind
 * `bun run cr <id>` (ADR 0098), extracted so the citation ledger
 * (`cr-ledger.ts`, ADR 0133) hashes exactly the text the CLI prints.
 *
 * That identity is load-bearing: a `confirmed` ledger entry asserts that a
 * human printed the rule and checked the line against it, and the hash it
 * carries is only evidence of that if it is computed over the same bytes the
 * human read. One parser, one selector, both consumers.
 *
 * Bun-only APIs (`import.meta.dir`) stay out of here — the regression guards
 * import this module under vitest/node.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CR_PATH = join(ROOT, "data/cr/comprehensive-rules.txt");

export type Rule = { id: string; text: string };

/**
 * Line splitting for the official document.
 *
 * Two normalisations, both load-bearing:
 *
 *   - `\r` — the file is CRLF.
 *   - **U+2028 LINE SEPARATOR** — WotC's exporter emits it for a paragraph
 *     break INSIDE a rule (509.1b's evasion-ability paragraph, 205.4c's). JS
 *     does not treat it as a line terminator and `.` does not match it, so a
 *     rule whose body contains one used to fail the `^id … $` match entirely
 *     and get swallowed as a continuation of the PREVIOUS rule — `cr 509.1b`
 *     answered "no such rule" about a rule that plainly exists, which is the
 *     exact failure this tool exists to prevent.
 *
 * The document also opens with a table of contents repeating every section
 * header verbatim ("605. Mana Abilities" appears twice), so the body starts at
 * the LAST occurrence of "1. Game Concepts" and the glossary at the last
 * "Glossary".
 */
export function splitDocument(raw: string): {
    body: string[];
    glossary: string[];
} {
    const lines = raw
        .replace(/\r/g, "")
        .replace(/[\u2028\u2029]/g, "\n")
        .split("\n");
    const bodyStart = lines.lastIndexOf("1. Game Concepts");
    const glossaryStart = lines.lastIndexOf("Glossary");
    const creditsStart = lines.lastIndexOf("Credits");
    if (bodyStart < 0 || glossaryStart < 0) {
        throw new Error(
            "CR text does not have the expected structure — re-run `bun run cr sync`"
        );
    }
    return {
        body: lines.slice(bodyStart, glossaryStart),
        glossary: lines.slice(
            glossaryStart + 1,
            creditsStart > glossaryStart ? creditsStart : lines.length
        ),
    };
}

/**
 * A rule starts a line: "605. Mana Abilities", "605.1. Some activated…",
 * "605.1a An activated ability…". Everything after it (examples, continuation
 * lines) belongs to that rule until the next rule id.
 */
const RULE_START = /^(\d{3}(?:\.\d+[a-z]{0,2})?)\.?\s+(.*)$/;

export function parseRules(body: string[]): Rule[] {
    const rules: Rule[] = [];
    for (const line of body) {
        const m = line.match(RULE_START);
        if (m) {
            rules.push({ id: m[1], text: `${m[1]}${line.slice(m[1].length)}` });
            continue;
        }
        if (!rules.length) continue;
        if (!line.trim()) continue;
        rules[rules.length - 1].text += `\n${line}`;
    }
    return rules;
}

/** Every rule of a CR document given as text — the fixture path for tests. */
export function rulesOf(raw: string): Rule[] {
    return parseRules(splitDocument(raw).body);
}

/** Every rule of the vendored document. */
export function loadRules(crPath = CR_PATH): Rule[] {
    return rulesOf(readFileSync(crPath, "utf8"));
}

/** `605` matches 605, 605.1, 605.1a; `605.1` matches 605.1 and 605.1a. */
export function selectRules(rules: Rule[], query: string): Rule[] {
    const exact = rules.filter((r) => r.id === query);
    const descendants = rules.filter(
        (r) =>
            r.id !== query &&
            r.id.startsWith(query) &&
            isDescendant(query, r.id)
    );
    return [...exact, ...descendants];
}

function isDescendant(parent: string, child: string): boolean {
    const rest = child.slice(parent.length);
    // "605" → ".1" / ".1a";  "605.1" → "a";  never "605" → "6" (a different rule)
    return parent.includes(".")
        ? /^[a-z]{1,2}$/.test(rest)
        : /^\.\d+[a-z]{0,2}$/.test(rest);
}

/**
 * What `bun run cr <id>` prints for `id`, or `null` when nothing resolves —
 * the text a confirming reader sees, and therefore the text the ledger hashes.
 */
export function printedRule(rules: Rule[], id: string): string | null {
    const hits = selectRules(rules, id);
    return hits.length ? hits.map((r) => r.text).join("\n\n") : null;
}

/** The ledger's fingerprint of a printed rule: sha256, first 16 hex chars. */
export function ruleHash(printed: string): string {
    return createHash("sha256").update(printed).digest("hex").slice(0, 16);
}
