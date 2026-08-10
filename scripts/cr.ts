#!/usr/bin/env bun
/**
 * Comprehensive Rules lookup against the VENDORED official text
 * (`data/cr/comprehensive-rules.txt`, ADR 0098).
 *
 * Why a local file and not a WebFetch: a CR lookup happens dozens of times per
 * card/mechanic. Fetching the 976 KB official document (or a third-party mirror
 * page) costs the whole document's tokens per query and is model-summarised —
 * lossy and non-deterministic. Slicing the vendored text returns ONLY the
 * requested subrule (~200–2000 chars), verbatim, offline.
 *
 * Usage:
 *   bun run cr 605            # section header + every subrule under 605
 *   bun run cr 605.1          # 605.1 and its lettered subrules (605.1a, …)
 *   bun run cr 605.1a         # exactly that subrule
 *   bun run cr grep "mana ability"     # rule ids + first line of each hit
 *   bun run cr grep -f "library"       # -f/--full: full text of each hit
 *   bun run cr glossary "Mana Ability" # glossary entry
 *   bun run cr version        # vendored effective date + source URLs
 *   bun run cr check          # ONLINE: is a newer CR published? (exit 1 if yes)
 *   bun run cr sync           # ONLINE: download the newest CR, rewrite VERSION
 *
 * `check`/`sync` are the only commands that touch the network. Everything else
 * is offline, which is what keeps this usable inside the gate and inside agents
 * with no WebFetch permission.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CR_PATH = join(ROOT, "data/cr/comprehensive-rules.txt");
const VERSION_PATH = join(ROOT, "data/cr/VERSION.json");
const INDEX_URL = "https://magic.wizards.com/en/rules";

type Version = {
    effectiveDate: string;
    fileName: string;
    txtUrl: string;
    pdfUrl: string;
    indexUrl: string;
    sha256: string;
    vendoredAt: string;
};

type Rule = { id: string; text: string };

function readVersion(): Version {
    return JSON.parse(readFileSync(VERSION_PATH, "utf8")) as Version;
}

/**
 * The document opens with a table of contents that repeats every section
 * header verbatim ("605. Mana Abilities" appears twice). The body starts at the
 * LAST occurrence of "1. Game Concepts"; the glossary at the last "Glossary".
 */
function splitDocument(raw: string): { body: string[]; glossary: string[] } {
    const lines = raw.replace(/\r/g, "").split("\n");
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

function parseRules(body: string[]): Rule[] {
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

function loadRules(): Rule[] {
    return parseRules(splitDocument(readFileSync(CR_PATH, "utf8")).body);
}

/** `605` matches 605, 605.1, 605.1a; `605.1` matches 605.1 and 605.1a. */
function selectRules(rules: Rule[], query: string): Rule[] {
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

function firstLine(text: string): string {
    return text.split("\n")[0];
}

function cmdRule(query: string): number {
    const hits = selectRules(loadRules(), query);
    if (!hits.length) {
        console.error(
            `No CR rule ${query} in the vendored ${readVersion().effectiveDate} text.`
        );
        return 1;
    }
    console.log(hits.map((r) => r.text).join("\n\n"));
    return 0;
}

function cmdGrep(pattern: string, full: boolean): number {
    let re: RegExp;
    try {
        re = new RegExp(pattern, "i");
    } catch {
        console.error(`Not a valid regex: ${pattern}`);
        return 1;
    }
    const hits = loadRules().filter((r) => re.test(r.text));
    if (!hits.length) {
        console.error(`No CR rule matches /${pattern}/i.`);
        return 1;
    }
    console.log(
        hits.map((r) => (full ? r.text : firstLine(r.text))).join("\n")
    );
    return 0;
}

function cmdGlossary(term: string): number {
    const { glossary } = splitDocument(readFileSync(CR_PATH, "utf8"));
    const needle = term.trim().toLowerCase();
    const entries: { term: string; body: string[] }[] = [];
    for (const line of glossary) {
        if (!line.trim()) continue;
        const prev = entries[entries.length - 1];
        // A glossary term is a short line immediately preceded by a blank line;
        // the parser approximates that as "line follows a completed entry".
        if (!prev || prev.body.length) entries.push({ term: line, body: [] });
        else prev.body.push(line);
    }
    const hits = entries.filter((e) => e.term.toLowerCase().includes(needle));
    if (!hits.length) {
        console.error(`No glossary entry matching "${term}".`);
        return 1;
    }
    console.log(hits.map((e) => [e.term, ...e.body].join("\n")).join("\n\n"));
    return 0;
}

function cmdVersion(): number {
    const v = readVersion();
    console.log(
        [
            `CR effective ${v.effectiveDate} (vendored ${v.vendoredAt})`,
            `txt   ${v.txtUrl}`,
            `pdf   ${v.pdfUrl}`,
            `index ${v.indexUrl}`,
        ].join("\n")
    );
    return 0;
}

/**
 * The rules page links the current document; the filename carries its date
 * ("MagicCompRules 20260807.txt" — note the literal space). The link lives
 * inside a JSON-escaped blob in the page payload, so `/` arrives as `/`:
 * unescape before matching, or the URL is invisible.
 */
async function latestPublished(): Promise<{
    url: string;
    effectiveDate: string;
}> {
    const res = await fetch(INDEX_URL, {
        headers: { "User-Agent": "tolaria-cr-sync (github.com/tolaria)" },
    });
    if (!res.ok) throw new Error(`${INDEX_URL} → HTTP ${res.status}`);
    const html = (await res.text())
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        )
        .replace(/&amp;/g, "&");
    const dated = [
        ...html.matchAll(
            /https?:\/\/media\.wizards\.com\/\d{4}\/downloads\/MagicCompRules[%\s_-]*(\d{4})(\d{2})(\d{2})\.txt/gi
        ),
    ]
        .map((m) => ({
            url: m[0].replace(/ /g, "%20"),
            effectiveDate: `${m[1]}-${m[2]}-${m[3]}`,
        }))
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    if (!dated.length) {
        throw new Error(
            `No MagicCompRules .txt link found on ${INDEX_URL} — the page layout changed, check it by hand.`
        );
    }
    return dated[dated.length - 1];
}

async function cmdCheck(): Promise<number> {
    const vendored = readVersion();
    const latest = await latestPublished();
    if (latest.effectiveDate <= vendored.effectiveDate) {
        console.log(
            `CR up to date — vendored ${vendored.effectiveDate}, published ${latest.effectiveDate}.`
        );
        return 0;
    }
    console.log(
        [
            `NEWER CR PUBLISHED — vendored ${vendored.effectiveDate}, published ${latest.effectiveDate}.`,
            `Run \`bun run cr:sync\`, then re-check the rules the diff touches.`,
            latest.url,
        ].join("\n")
    );
    return 1;
}

async function cmdSync(): Promise<number> {
    const vendored = readVersion();
    const latest = await latestPublished();
    if (latest.effectiveDate === vendored.effectiveDate) {
        console.log(
            `Already on the published CR (${vendored.effectiveDate}) — nothing to do.`
        );
        return 0;
    }
    const res = await fetch(latest.url, {
        headers: { "User-Agent": "tolaria-cr-sync (github.com/tolaria)" },
    });
    if (!res.ok) throw new Error(`${latest.url} → HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(CR_PATH, text);
    const compact = latest.effectiveDate.replace(/-/g, "");
    const next: Version = {
        effectiveDate: latest.effectiveDate,
        fileName: `MagicCompRules ${compact}.txt`,
        txtUrl: latest.url,
        pdfUrl: latest.url.replace(/\.txt$/i, ".pdf"),
        indexUrl: INDEX_URL,
        sha256: createHash("sha256").update(text).digest("hex"),
        vendoredAt: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(VERSION_PATH, `${JSON.stringify(next, null, 4)}\n`);
    console.log(
        [
            `CR updated ${vendored.effectiveDate} → ${latest.effectiveDate}.`,
            `Diff the two documents and re-verify every mechanic the changes touch.`,
        ].join("\n")
    );
    return 0;
}

function usage(): number {
    console.error(
        [
            "usage:",
            "  bun run cr <rule>              e.g. 605, 605.1, 605.1a",
            "  bun run cr grep [-f] <regex>   -f prints full rule text",
            "  bun run cr glossary <term>",
            "  bun run cr version",
            "  bun run cr check              ONLINE — newer CR published?",
            "  bun run cr sync               ONLINE — download the newest CR",
        ].join("\n")
    );
    return 2;
}

async function main(): Promise<number> {
    const [cmd, ...rest] = process.argv.slice(2);
    if (!cmd) return usage();
    switch (cmd) {
        case "grep": {
            const full = rest[0] === "-f" || rest[0] === "--full";
            const pattern = (full ? rest.slice(1) : rest).join(" ");
            return pattern ? cmdGrep(pattern, full) : usage();
        }
        case "glossary":
            return rest.length ? cmdGlossary(rest.join(" ")) : usage();
        case "version":
            return cmdVersion();
        case "check":
            return await cmdCheck();
        case "sync":
            return await cmdSync();
        default:
            return /^\d{3}(\.\d+[a-z]{0,2})?$/.test(cmd)
                ? cmdRule(cmd)
                : usage();
    }
}

main().then(
    (code) => process.exit(code),
    (err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
);
