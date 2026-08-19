#!/usr/bin/env bun
/**
 * CR keyword-citation semantics (ADR 0098, issue #2429 follow-up).
 *
 * `check-cr-citations.ts` asks whether a cited id EXISTS. This scan asks the
 * next question — whether it says what the line claims — for the one block
 * where the answer is mechanically decidable: the keyword actions (CR 701) and
 * keyword abilities (CR 702). Every section there is titled with the term it
 * defines ("701.23. Search"), so a line that names a keyword and cites a
 * DIFFERENT keyword's section is wrong by construction, with no judgement call
 * left over.
 *
 * WHY THIS BLOCK AND WHY NOW. Wizards inserts new keyword actions in
 * alphabetical order, which renumbers every later section on every few
 * revisions (Behold, Create, Double, Goad, Investigate… all landed inside 701).
 * Citations written against an older document therefore rot into ids that still
 * resolve and now mean something else — "CR 701.19 search" points at
 * Regenerate, "CR 701.16 sacrifice" at Investigate. The existence sweep is
 * blind to all of it by construction, and 793 such sites stood in this repo
 * when this guard was written — the largest mis-citation cluster it had.
 *
 * The defence is that keyword NAMES are the stable key, not numbers: the term
 * table below is keyed on the CR's own section titles and resolved to ids at
 * scan time, so the next renumbering does not rot the table — it reds the gate
 * on the citations the renumbering invalidated, which is exactly the event
 * nobody has ever noticed by hand.
 *
 * EVERY citation on a line is checked, not the line as a whole: a citation
 * passes when the line names ITS keyword, or when the cited rule's own text
 * uses the term the line names (Annihilator's text says "sacrifices", so
 * "sacrifice … CR 702.86a" is fine). Line-level would have been useless on the
 * shape that hides these — "CR 701.7 / 701.19c" on a can't-be-regenerated
 * comment anchors on the second id and waves the stale first one through.
 *
 * PRECISION over recall, deliberately. Terms that collide with ordinary
 * engineering English (`activate`, `cast`, `play`, `convert`, `reach`, …) are
 * excluded from EVIDENCE entirely — see AMBIGUOUS — while still anchoring their
 * own citations and remaining perfectly citable. Two limits follow, both
 * accepted: a citation on a line that names no keyword is invisible (the
 * sweep that fixed the standing 793 had to grep those by hand), and so is a
 * comment whose keyword wrapped onto the neighbouring line — keep the citation
 * and its keyword on ONE line, the same rule the existence sweep already asks
 * for.
 *
 * Usage: run through `bun run cr:lint` (this module has no CLI of its own).
 * Suppress a deliberate counter-example with a trailing `cr-cite-ok` comment.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CR_PATH = join(ROOT, "data/cr/comprehensive-rules.txt");

/**
 * Files that quote wrong citations ON PURPOSE. The findings drawer exists to
 * describe defects, this guard's own header names the shape it catches, and
 * ADR 0098 shows an illustrative slash-list.
 */
export const EXEMPT = [
    "docs/findings/",
    "scripts/cr-keyword-citations.ts",
    "scripts/check-cr-citations.ts",
    "scripts/__tests__/cr-keyword-citations.test.ts",
    "docs/adr/0098-",
];

/** Inline escape hatch for a deliberate counter-example on one line. */
export const SUPPRESS = "cr-cite-ok";

/**
 * Section titles this scan does NOT use as evidence, because the word is
 * ordinary engineering or Magic prose long before it is a keyword. They stay
 * citable — they are simply never taken as proof that a line MEANS them.
 *
 * `Counter` is the expensive one: the repo's dominant sense is a +1/+1 or
 * loyalty counter (CR 122), not the keyword action, so the term table below
 * detects it only in its verb-with-an-object shape.
 */
export const AMBIGUOUS = new Set([
    // "the defender" is the defending player far more often than the keyword —
    // it is what made banding's own CR 702.22j-k damage-assignment comment read
    // as a Defender citation.
    "Defender",
    "Activate",
    "Cast",
    "Play",
    "Create",
    "Double",
    "Triple",
    "Convert",
    "Support",
    "Learn",
    "Vote",
    "Explore",
    "Assist",
    "Visit",
    "Gift",
    "Solved",
    "Training",
    "Reach",
    "Escape",
    "Flash",
    "Partner",
    "Crew",
    "Champion",
    "Storm",
    "Echo",
    "Recover",
    "Surge",
    "Melee",
    "Mentor",
    "Riot",
    "Craft",
    "Plot",
    "Squad",
    "Backup",
    "Bargain",
    "Toxic",
    "Blitz",
    "Casualty",
    "Enlist",
    "Read Ahead",
    "Harmonize",
    "Mobilize",
    "Heal",
    "Recruit",
    "Harness",
    "Endure",
    "Adapt",
    "Absorb",
    "Fuse",
    "Fading",
    "Fear",
    "Persist",
    "Mutate",
    "Boast",
    "Cleave",
    "Prototype",
    "Offering",
    "Epic",
    "Frenzy",
    "Shadow",
    "Amplify",
    "Provoke",
    "Ripple",
    "Devour",
    "Unleash",
    "Cipher",
    "Evolve",
    "Extort",
    "Tribute",
    "Outlast",
    "Dash",
    "Exploit",
    "Renown",
    "Awaken",
    "Ingest",
    "Myriad",
    "Skulk",
    "Emerge",
    "Escalate",
    "Fabricate",
    "Undaunted",
    "Improvise",
    "Aftermath",
    "Afflict",
    "Ascend",
    "Demonstrate",
    "Disturb",
    "Decayed",
    "Encore",
    "Spree",
    "Saddle",
    "Impending",
    "Exhaust",
    "Disguise",
    "Forage",
    "Suspect",
    "Cloak",
    "Discover",
    "Incubate",
    "Connive",
    "Amass",
    "Meld",
    "Exert",
    "Assemble",
    "Bolster",
    "Manifest",
    "Populate",
    "Detain",
    "Clash",
    "Fateseal",
    "Abandon",
    "Planeswalk",
    "Set in Motion",
]);

/**
 * Extra surface forms per keyword, beyond the title itself. The key is the CR
 * section title verbatim — a title that stops matching is a renamed section and
 * throws, rather than silently detecting nothing.
 */
export const TERMS: Record<string, RegExp[]> = {
    Regenerate: [/\bregenerat\w*/i, /\bregen\b/i, /\bregen shield/i],
    Sacrifice: [/\bsacrific\w*/i, /\bsac\b/i],
    Search: [/\bsearch\w*/i, /\btutor\w*/i, /\bfail(s|ed|ing)? to find\b/i],
    Destroy: [/\bdestroy\w*/i, /\bdestruction\b/i],
    Discard: [/\bdiscard\w*/i],
    Exile: [/\bexil(e|es|ed|ing)\b/i],
    Mill: [/\bmill(s|ed|ing)?\b/i],
    Shuffle: [/\bshuffl\w*/i],
    Reveal: [/\breveal\w*/i],
    Investigate: [/\binvestigat\w*/i, /\bclue token/i],
    Scry: [/\bscry\w*/i, /\bscried\b/i],
    Surveil: [/\bsurveil\w*/i],
    Fight: [/\bfight\w*/i, /\bfought\b/i],
    Exchange: [/\bexchang\w*/i],
    Goad: [/\bgoad\w*/i],
    Attach: [/\battach\w*/i],
    Transform: [/\btransform\w*/i],
    Proliferate: [/\bproliferat\w*/i],
    Monstrosity: [/\bmonstrosit\w*/i, /\bmonstrous\b/i],
    Behold: [/\bbehold\w*/i],
    "Tap and Untap": [/\buntap\w*/i, /\btap(s|ped|ping)?\b/i],
    Landwalk: [
        /\blandwalk\b/i,
        /\b(swamp|island|forest|mountain|plains|legend|desert|snow)walk\b/i,
    ],
    // In a Magic comment "protection" is the keyword far more often than the
    // English noun; the narrow "protection from" form missed "double
    // protection" and "the protection quality".
    Protection: [/\bprotection\b/i],
    "Double Strike": [/\bdouble strike\b/i],
    "First Strike": [/\bfirst strike\b/i],
    "Cumulative Upkeep": [/\bcumulative upkeep\b/i],
    "Split Second": [/\bsplit second\b/i],
    // Renamed by Wizards; the repo (and every card printed before the change)
    // still says "totem armor".
    "Umbra Armor": [/\b(umbra|totem) armor\b/i],
    "Living Weapon": [/\bliving weapon\b/i],
    "Battle Cry": [/\bbattle cry\b/i],
    "Level Up": [/\blevel up\b/i, /\blevel counter/i],
    "Aura Swap": [/\baura swap\b/i],
    // Inflected forms the bare title misses: "cycled", "kicked", "phased out".
    Cycling: [/\bcycl(e|es|ed|ing)\w*/i],
    Kicker: [/\bkick(s|er|ers|ed|ing)?\b/i],
    // A bare "phase" is the turn structure; only the keyword's own phrasing
    // counts as evidence.
    Phasing: [/\bphasing\b/i, /\bphas(e|es|ed)[\s-]+(in|out)\b/i],
    "Hidden Agenda": [/\bhidden agenda\b/i],
    Counter: [
        // The keyword action only — never the +1/+1 / loyalty / poison object.
        /\bcounter(s|ed|ing)?\s+(that\s+|the\s+|target\s+|a\s+|an\s+)?\w*\s*(spell|ability)/i,
        // "countered"/"countering" are only ever the keyword action — a
        // +1/+1 or loyalty counter is never countered.
        /\bcounter(ed|ing)\b/i,
        /\buncounterable\b/i,
    ],
};

/**
 * Anchor-only forms, used when a term's EVIDENCE pattern is deliberately
 * narrow. Naming the keyword you cite is weaker proof than meaning a different
 * one, so the two directions do not need the same strictness: "counter → exile
 * (CR 701.6a)" anchors on the bare word, while only the verb-with-an-object
 * shape is ever taken as evidence that a line means the keyword action.
 */
export const ANCHOR_TERMS: Record<string, RegExp[]> = {
    Counter: [/\bcounter\w*/i],
    Phasing: [/\bphas(e|es|ed|ing)\w*/i],
};

export type KeywordIndex = {
    /** section title → section id, e.g. "Search" → "701.23". */
    idOf: Map<string, string>;
    /** section id → title. */
    titleOf: Map<string, string>;
    /** section id → its full text, lowercased. */
    textOf: Map<string, string>;
};

/**
 * Titles of the 701/702 blocks, read from the vendored document. Deriving them
 * rather than hardcoding is the whole point: the ids move, the titles do not.
 */
export function keywordIndex(crPath = CR_PATH): KeywordIndex {
    const lines = readFileSync(crPath, "utf8")
        .replace(/\r/g, "")
        .replace(/[\u2028\u2029]/g, "\n")
        .split("\n");
    const body = lines.slice(lines.lastIndexOf("1. Game Concepts"));
    const idOf = new Map<string, string>();
    const titleOf = new Map<string, string>();
    const textOf = new Map<string, string>();
    let current: string | null = null;
    for (const line of body) {
        // A keyword section header is the id, a dot, and a Title Case name with
        // no sentence punctuation — "701.23. Search", "702.108. Living Weapon",
        // "702.101. More Than Meets the Eye", "702.166. Start Your Engines!".
        const header = line.match(
            /^(70[12]\.\d+)\.\s+([A-Z][A-Za-z'!,\- ]*[A-Za-z!])$/
        );
        if (header) {
            current = header[1];
            idOf.set(header[2], current);
            titleOf.set(current, header[2]);
            textOf.set(current, "");
        } else if (
            /^\d{3}(\.\d+[a-z]{0,2})?\.?\s/.test(line) &&
            !/^70[12]\.\d/.test(line)
        ) {
            // Lettered subrules ("701.23a …") continue the open section; a rule
            // id outside the two blocks closes it.
            current = null;
        }
        if (current) {
            textOf.set(
                current,
                `${textOf.get(current)}\n${line.toLowerCase()}`
            );
        }
    }
    if (!idOf.has("Search") || !idOf.has("Deathtouch")) {
        throw new Error(
            "CR keyword sections did not parse — the vendored document's layout changed."
        );
    }
    return { idOf, titleOf, textOf };
}

/** `Level Up` → /\blevel\s+up(s|ed|ing)?\b/i — the conservative word form. */
function titlePattern(title: string): RegExp {
    return new RegExp(
        `\\b${title.toLowerCase().replace(/\s+/g, "\\s+")}(s|d|es|ed|ing)?\\b`,
        "i"
    );
}

export type TermSets = {
    /** Proof the line MEANS the section it cites. Every title qualifies. */
    anchor: Map<string, RegExp[]>;
    /**
     * Proof the line means some OTHER section. Ambiguous titles are excluded:
     * "player"/"cast"/"convert" in a comment says nothing about intent.
     */
    evidence: Map<string, RegExp[]>;
};

/** Term sets per keyword id: title-derived, plus the TERMS overrides. */
export function detectionTerms(index: KeywordIndex): TermSets {
    // A TERMS key that no longer names a section is a stale table, not a no-op
    // — that is how the "Totem Armor" → "Umbra Armor" rename surfaced.
    for (const title of Object.keys(TERMS)) {
        if (!index.idOf.has(title)) {
            throw new Error(
                `TERMS names "${title}", which is not a CR 701/702 section title in the vendored document.`
            );
        }
    }
    const anchor = new Map<string, RegExp[]>();
    const evidence = new Map<string, RegExp[]>();
    for (const [title, id] of index.idOf) {
        const patterns = TERMS[title] ?? [titlePattern(title)];
        anchor.set(id, ANCHOR_TERMS[title] ?? patterns);
        if (!AMBIGUOUS.has(title)) evidence.set(id, patterns);
    }
    return { anchor, evidence };
}

/** A citation to a 701/702 section, with its optional subrule letter. */
const KEYWORD_CITATION = /\bCR\s?(70[12]\.\d+)([a-z]{0,2})\b/g;
/** Bare ids on a line that already mentions `CR ` — the slash-list shape. */
const BARE_KEYWORD_ID = /\b(70[12]\.\d+)([a-z]{0,2})\b/g;

export type KeywordHit = {
    file: string;
    line: number;
    text: string;
    /** Sections the line cites. */
    cited: string[];
    /** Cited sections the line neither names nor is explained by. */
    offending: string[];
    /** Keyword sections the line's prose names. */
    named: string[];
};

/**
 * Flags every keyword citation on a line that names a keyword — EACH cited
 * section has to be anchored or explained, not merely one of them. Per-citation
 * is what reaches inside a slash-list: "CR 701.7, 701.19c" on a line about
 * regeneration anchors on the second id, and a line-level rule would wave the
 * first one through forever.
 *
 * Pure over `(file, text)` pairs so the guard can drive it with fixtures.
 */
export function scanKeywordCitations(
    sources: Iterable<{ file: string; text: string }>,
    index: KeywordIndex
): { hits: KeywordHit[]; scanned: number } {
    const { anchor, evidence } = detectionTerms(index);
    const hits: KeywordHit[] = [];
    let scanned = 0;
    for (const { file, text } of sources) {
        if (EXEMPT.some((p) => file.startsWith(p))) continue;
        if (!text.includes("CR ")) continue;
        text.split("\n").forEach((line, i) => {
            if (line.includes(SUPPRESS)) return;
            const cited = new Set<string>();
            for (const m of line.matchAll(KEYWORD_CITATION)) cited.add(m[1]);
            if (cited.size && line.includes("CR ")) {
                for (const m of line.matchAll(BARE_KEYWORD_ID)) cited.add(m[1]);
            }
            if (!cited.size) return;
            scanned++;
            const named = new Set<string>();
            for (const [id, patterns] of evidence) {
                if (patterns.some((re) => re.test(line))) named.add(id);
            }
            if (!named.size) return;
            const offending = [...cited].filter((id) => {
                // Anchored: the line names the keyword this id defines. Checked
                // against the ANCHOR set, so "Escape—{R}{R}, exile five cards
                // (CR 702.138)" passes on the word "Escape" it names.
                if (anchor.get(id)?.some((re) => re.test(line))) return false;
                // Explained: this rule's own text uses the term the line names
                // — Annihilator's "defending player sacrifices N permanents" is
                // why "sacrifice … CR 702.86a" is a correct citation.
                const body = index.textOf.get(id) ?? "";
                for (const namedId of named) {
                    const patterns = evidence.get(namedId) ?? [];
                    if (patterns.some((re) => re.test(body))) return false;
                }
                return true;
            });
            if (!offending.length) return;
            hits.push({
                file,
                line: i + 1,
                text: line.trim(),
                cited: [...cited],
                offending,
                named: [...named],
            });
        });
    }
    return { hits, scanned };
}

/** One reportable line, formatted for the CLI and the test failure message. */
export function formatHit(hit: KeywordHit, index: KeywordIndex): string {
    const cited = hit.offending
        .map((id) => `${id} = ${index.titleOf.get(id) ?? "?"}`)
        .join(", ");
    const meant = hit.named
        .map((id) => `${index.titleOf.get(id)} is ${id}`)
        .join(", ");
    return `  ${hit.file}:${hit.line}\n      cites ${cited}\n      line names ${meant}\n      ${hit.text.slice(0, 120)}`;
}
