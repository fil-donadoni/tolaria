#!/usr/bin/env bun
/**
 * Stub-hygiene guard for the colour-split set modules
 * `convex/cards/sets/<code>/<colour>.ts` (ADR 0043; legacy flat
 * `sets/<code>.ts` still honoured).
 *
 * A "stub" is a commented-out card definition staged for a later cluster:
 *
 *   // tracked-by: #NNN
 *   // export const kjeldoranGuard: CardDefinition = {
 *   //     id: "...",
 *   //     name: "Kjeldoran Guard",
 *   //     ...
 *   // };
 *
 * Two failure modes this guard catches, both invisible to every other gate:
 *
 * 1. ORPHAN — a stub with no traceable disposition. The ICE rollout lost ~26
 *    cards this way: stubs left with only a bare `TODO(#628)` (the umbrella PRD)
 *    or nothing, with NO work issue tracking them.
 *
 * 2. DEAD DUPLICATE — a commented stub whose card is ALREADY implemented as an
 *    active def (reprints are modelled as an active `CardPrint`, never a
 *    commented stub). The commented block is leftover garbage that misleads the
 *    next reader into thinking the card is unimplemented.
 *
 * Rules (OFFLINE/static apart from the registry read `check-card-index` already
 * does, so it lives in `check:all`):
 *
 *   ORPHAN — every commented stub block must carry a disposition reference, in
 *   order of preference:
 *     - `tracked-by: #NNN` — an open work issue owns this stub (the convention)
 *     - `#NNN`             — any issue ref (legacy: a PRD/parent ref passes
 *                            offline; the ONLINE Phase-4 reconciliation in the
 *                            /new-set skill verifies it's an OPEN WORK issue)
 *     - `out of scope` / `out-of-scope` / `ADR NNNN` — permanently OOS
 *   New stubs SHOULD use `tracked-by: #NNN`.
 *
 *   DEAD DUPLICATE — a commented stub whose `name:` matches an active card in
 *   the registry is forbidden: delete the dead block (the card already ships).
 *
 * Run: bun scripts/check-stub-coverage.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { getAllCards } from "../convex/cards/index";

const SETS_DIR = resolve("convex/cards/sets");

// A commented-out card definition anchor.
const STUB_ANCHOR =
    /^\s*\/\/\s*export const\s+([A-Za-z0-9_]+)\s*(?::\s*(?:CardDefinition|CardPrint)\b|=\s*[A-Za-z_][A-Za-z0-9_]*\s*\()/;
const STUB_NAME = /^\s*\/\/\s*name:\s*"([^"]+)"/;
const IS_COMMENT = /^\s*\/\//;
// Any traceable disposition inside the stub's comment run.
const DISPOSITION = /tracked-by:\s*#\d+|#\d+|out[-\s]of[-\s]scope|ADR\s*\d+/i;

const activeNames = new Set(getAllCards().map((c) => c.name));

type Hit = { file: string; line: number; ident: string; name: string };
const orphans: Hit[] = [];
const deadDupes: Hit[] = [];
let stubCount = 0;

// Every set is a colour-split DIRECTORY `sets/<code>/` (ADR 0043), so collect
// each set's colour modules (`<colour>.ts`, barrel `index.ts` and `*.test.ts`
// excluded). A legacy flat `sets/<code>.ts` file is still honoured for safety.
// Returned paths are relative to SETS_DIR (e.g. `ice/black.ts`) so the orphan
// report points at the exact module.
const isSource = (f: string) =>
    f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts";

const files = readdirSync(SETS_DIR)
    .flatMap((entry) => {
        const full = join(SETS_DIR, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "__tests__") return [];
            return readdirSync(full)
                .filter(isSource)
                .map((f) => join(entry, f));
        }
        return isSource(entry) ? [entry] : [];
    })
    .sort();

for (const file of files) {
    const lines = readFileSync(join(SETS_DIR, file), "utf-8").split("\n");

    let i = 0;
    while (i < lines.length) {
        if (!IS_COMMENT.test(lines[i])) {
            i++;
            continue;
        }
        const start = i;
        while (i < lines.length && IS_COMMENT.test(lines[i])) i++;
        const run = lines.slice(start, i);

        // Anchors in this comment run, with each anchor's own `name:`.
        const anchorIdx: number[] = [];
        run.forEach((l, k) => {
            if (STUB_ANCHOR.test(l)) anchorIdx.push(k);
        });
        if (anchorIdx.length === 0) continue;

        const runHasDisposition = DISPOSITION.test(run.join("\n"));

        anchorIdx.forEach((k, a) => {
            const ident = run[k].match(STUB_ANCHOR)![1];
            const end =
                a + 1 < anchorIdx.length ? anchorIdx[a + 1] : run.length;
            let name = ident;
            for (let m = k; m < end; m++) {
                const nm = run[m].match(STUB_NAME);
                if (nm) {
                    name = nm[1];
                    break;
                }
            }
            const hit: Hit = { file, line: start + k + 1, ident, name };
            stubCount++;
            if (activeNames.has(name)) deadDupes.push(hit);
            else if (!runHasDisposition) orphans.push(hit);
        });
    }
}

if (orphans.length === 0 && deadDupes.length === 0) {
    console.log(
        `✓ stub-coverage: ${stubCount} commented stub(s) — all tracked, none duplicating an active card`
    );
    process.exit(0);
}

if (deadDupes.length) {
    console.error(
        `✗ stub-coverage: ${deadDupes.length} DEAD-DUPLICATE stub(s) — the card is already an active def; delete the commented block:\n`
    );
    for (const o of deadDupes)
        console.error(`  - ${o.file}:${o.line}  ${o.ident}  «${o.name}»`);
    console.error("");
}
if (orphans.length) {
    console.error(
        `✗ stub-coverage: ${orphans.length} ORPHAN stub(s) with no tracking reference:\n`
    );
    console.error(
        "Every commented-out card stub must declare a disposition in its comment block:\n" +
            "  • an open work issue:  // tracked-by: #NNN\n" +
            "  • permanently out of scope:  // out of scope — <reason / ADR NNNN>\n" +
            "A stub with neither is invisible to every gate and silently lost (the ICE incident).\n"
    );
    for (const o of orphans)
        console.error(`  - ${o.file}:${o.line}  ${o.ident}  «${o.name}»`);
    console.error("");
}
process.exit(1);
