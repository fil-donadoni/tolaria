/**
 * Generate `AGENTS.md` (and the nested mirrors) from the Claude Code sources.
 *
 * WHY THIS EXISTS. Three harnesses run against this repo and they do not read
 * the same files. Verified against each project's own documentation, not from
 * memory:
 *
 *   | Harness     | Root file                   | `.claude/rules/*` | Nested                     |
 *   | ----------- | --------------------------- | ----------------- | -------------------------- |
 *   | Claude Code | `CLAUDE.md`                 | loaded, resident  | on first file access       |
 *   | Codex       | `AGENTS.md` (never CLAUDE)  | INVISIBLE         | by cwd, git root -> cwd    |
 *   | opencode    | `AGENTS.md`, CLAUDE.md only |                   |                            |
 *   |             | as a fallback if it is absent | INVISIBLE       | NOT SUPPORTED              |
 *
 * Two consequences drive everything below. First, `AGENTS.md` exists, so
 * opencode never falls back to `CLAUDE.md` — before this script that meant an
 * opencode session read a 5,213-byte stub and nothing else. Second, neither
 * Codex nor opencode can see `.claude/rules/**` at all, which is where the
 * per-card ban lives (`bot-development.md`: "Fix the class, never the card —
 * no card names in identifiers, no per-card registries (ADR 0102)"). A DeepSeek
 * session built exactly the per-card combo registry ADR 0102 forbids. It could
 * not have known: that sentence existed in one file, and its harness does not
 * read that file.
 *
 * So the rules are INLINED into `AGENTS.md` rather than referenced. A pointer
 * would put us back to relying on the agent to go and read it, which is the
 * failure this replaces.
 *
 * WHY GENERATED RATHER THAN HAND-MAINTAINED. `AGENTS.md` and the `.opencode/`
 * mirror were both hand-maintained, and both rotted: the mirror froze in July
 * while `.claude/rules/` moved repeatedly, and `AGENTS.md` never gained the Bot
 * rules at all. This repo's own doctrine is that a rule which CAN be enforced
 * mechanically belongs in a script the gate runs. `agents-md-drift.test.ts` is
 * that gate.
 *
 * THE 32 KiB CEILING IS REAL. Codex stops adding project docs once the combined
 * size reaches `project_doc_max_bytes`, 32 KiB by default, and that setting
 * lives in the user's `~/.codex/config.toml` — it cannot be shipped in the
 * repo. An oversized `AGENTS.md` is therefore truncated SILENTLY, losing
 * whatever sits at the end. The drift test asserts the budget so the failure is
 * loud and local instead.
 *
 * Usage: `bun run agents:build` (writes), `bun run agents:build --check`
 * (exits 1 on drift, printing which file).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Codex's default `project_doc_max_bytes`. Not a style preference — past this
 * the tail of the file is dropped without a warning.
 */
export const CODEX_DOC_MAX_BYTES = 32 * 1024;

/**
 * The nested tier, as {source read by Claude Code} -> {mirror read by Codex}.
 * opencode reaches the sources directly through `opencode.json`'s
 * `instructions` globs, which is why those globs and this list must agree.
 */
export const NESTED_MIRRORS: ReadonlyArray<{ source: string; mirror: string }> =
    [
        { source: "convex/CLAUDE.md", mirror: "convex/AGENTS.md" },
        { source: "src/CLAUDE.md", mirror: "src/AGENTS.md" },
    ];

const GENERATED_BANNER = `<!-- GENERATED FILE — DO NOT EDIT.
     Source: CLAUDE.md + .claude/rules/*.md
     Regenerate: bun run agents:build
     Guarded by: scripts/__tests__/agents-md-drift.test.ts
     Edit the source, never this file. -->`;

/**
 * Each resident rule index opens by explaining that it is an index and that
 * the full text is loaded on demand from a nested `CLAUDE.md`. That paragraph
 * is true for Claude Code and FALSE here — Codex and opencode get the text
 * inlined below, not lazily. Dropping it is the one edit this generator makes
 * to a source body, and it is why the marker is an exact literal rather than a
 * fuzzy match: a silent no-op would ship a false statement to two harnesses.
 */
const INDEX_PREAMBLE_MARKER = "**This file is the index;";

/**
 * CLAUDE.md's own § Path-specific rules explains the two-tier mechanism —
 * resident index, full text loaded on first access to the directory. That is
 * Claude Code behaviour and it is wrong for both consumers of this file: Codex
 * scopes nested docs by CWD and opencode has no nested tier at all. The
 * inlined rule set below supersedes it, so carrying the section here would
 * ship a contradiction AND spend ~950 bytes of a 32 KiB budget saying
 * something false.
 */
const SUPERSEDED_SECTION = "### Path-specific rules";

/** Drop one `###` section, from its heading to the next heading of any level. */
function stripSection(body: string, heading: string): string {
    const start = body.indexOf(heading);
    if (start === -1) return body;
    const rest = body.slice(start + heading.length);
    const nextHeading = /\n#{1,3} /.exec(rest);
    return nextHeading
        ? body.slice(0, start) + rest.slice(nextHeading.index + 1)
        : body.slice(0, start);
}

/** Strip YAML frontmatter, which is harness-specific metadata, not prose. */
function stripFrontmatter(body: string): string {
    const match = /^---\n[\s\S]*?\n---\n/.exec(body);
    return match ? body.slice(match[0].length) : body;
}

/** Drop the leading `# Heading` line so sections can be re-levelled. */
function stripH1(body: string): string {
    return body.replace(/^#\s+[^\n]*\n/, "");
}

/**
 * Remove the "this file is an index, full text loads on demand" paragraph.
 * Returns the body unchanged when the marker is absent (`bot-development.md`
 * has no such paragraph — it was never split).
 */
function stripIndexPreamble(body: string): string {
    const start = body.indexOf(INDEX_PREAMBLE_MARKER);
    if (start === -1) return body;
    const end = body.indexOf("\n\n", start);
    if (end === -1) return body.slice(0, start).trimEnd() + "\n";
    return (body.slice(0, start) + body.slice(end + 2)).replace(
        /\n{3,}/g,
        "\n\n"
    );
}

function ruleFiles(): string[] {
    const dir = path.join(REPO_ROOT, ".claude", "rules");
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => path.join(".claude", "rules", f));
}

/** Read a source file, normalising to LF and a single trailing newline. */
function read(rel: string): string {
    return fs
        .readFileSync(path.join(REPO_ROOT, rel), "utf8")
        .replace(/\r\n/g, "\n")
        .replace(/\n+$/, "\n");
}

/** Title of a markdown document, taken from its H1. */
function titleOf(body: string): string {
    return /^#\s+([^\n]*)/.exec(body)?.[1]?.trim() ?? "Rules";
}

export function buildRootAgentsMd(): string {
    const claudeMd = read("CLAUDE.md");

    const parts: string[] = [
        GENERATED_BANNER,
        "",
        "# AGENTS.md",
        "",
        "Project instructions for **Codex** and **opencode**. Claude Code reads",
        "`CLAUDE.md` and `.claude/rules/*.md` instead; this file is generated from",
        "exactly those sources so all three harnesses act on the same rules.",
        "",
        "Everything below the horizontal rule is the path-specific rule set. Claude",
        "Code loads it lazily, per directory; Codex and opencode cannot, so it is",
        "inlined here in full. The deeper reference material lives in",
        "`convex/CLAUDE.md` and `src/CLAUDE.md` — read the one that covers the code",
        "you are touching.",
        "",
        stripSection(
            stripH1(stripFrontmatter(claudeMd)),
            SUPERSEDED_SECTION
        ).trim(),
        "",
        "---",
        "",
        "# Path-specific rules (inlined)",
        "",
    ];

    for (const rel of ruleFiles()) {
        const body = stripIndexPreamble(stripFrontmatter(read(rel)));
        parts.push(`## ${titleOf(body).replace(/\s*—\s*resident index$/, "")}`);
        parts.push("");
        parts.push(`<!-- source: ${rel} -->`);
        parts.push("");
        // Re-level so the rule file's own `##` sections nest under the `##`
        // heading added above; otherwise they would be siblings of it.
        parts.push(stripH1(body).trim().replace(/^## /gm, "### "));
        parts.push("");
    }

    return (
        parts
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trimEnd() + "\n"
    );
}

export function buildNestedMirror(sourceRel: string): string {
    const body = stripFrontmatter(read(sourceRel));
    return (
        [
            GENERATED_BANNER.replace(
                "Source: CLAUDE.md + .claude/rules/*.md",
                `Source: ${sourceRel}`
            ),
            "",
            body.trim(),
        ].join("\n") + "\n"
    );
}

/** Every generated artifact, as {path relative to repo root} -> {content}. */
export function buildAll(): Map<string, string> {
    const out = new Map<string, string>();
    out.set("AGENTS.md", buildRootAgentsMd());
    for (const { source, mirror } of NESTED_MIRRORS) {
        out.set(mirror, buildNestedMirror(source));
    }
    return out;
}

function main(): void {
    const check = process.argv.includes("--check");
    const generated = buildAll();
    const drifted: string[] = [];

    for (const [rel, content] of generated) {
        const abs = path.join(REPO_ROOT, rel);
        const current = fs.existsSync(abs)
            ? fs.readFileSync(abs, "utf8")
            : null;
        if (current === content) continue;
        if (check) {
            drifted.push(rel);
        } else {
            fs.writeFileSync(abs, content);
            console.log(`  wrote ${rel} (${Buffer.byteLength(content)} bytes)`);
        }
    }

    const rootBytes = Buffer.byteLength(generated.get("AGENTS.md")!);
    if (rootBytes > CODEX_DOC_MAX_BYTES) {
        console.error(
            `✗ AGENTS.md is ${rootBytes} bytes, over Codex's ${CODEX_DOC_MAX_BYTES} ` +
                `default project_doc_max_bytes by ${rootBytes - CODEX_DOC_MAX_BYTES}.\n` +
                `  Codex truncates silently past that, so the tail of the rules would ` +
                `be lost.\n  Trim CLAUDE.md or a rule index — that also lowers the ` +
                `resident budget.`
        );
        process.exit(1);
    }

    if (check && drifted.length > 0) {
        console.error(
            `✗ generated agent context is stale:\n${drifted
                .map((f) => `    ${f}`)
                .join("\n")}\n  Run: bun run agents:build`
        );
        process.exit(1);
    }

    console.log(
        check
            ? `✓ agent context in sync (AGENTS.md ${rootBytes}/${CODEX_DOC_MAX_BYTES} bytes)`
            : `✓ agent context generated (AGENTS.md ${rootBytes}/${CODEX_DOC_MAX_BYTES} bytes)`
    );
}

if (import.meta.main) main();
