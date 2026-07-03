#!/usr/bin/env bun
/**
 * resolve() → effects[] migration classifier (PRD #795, playbook #809).
 *
 * The single source of truth for the bulk-migration worklist. Parses every
 * resolve()/resolveSteps() closure in convex/cards/sets/, extracts the set of
 * SpellContext primitives each one calls, and buckets it against the CURRENT
 * Op vocabulary (derived live from EFFECT_OP_REGISTRY) plus the fold table
 * below. Re-run after every Op ships to regenerate the "what's left" backlog —
 * never hand-maintain a migration ticket list, regenerate it.
 *
 * Buckets:
 *   FREE       every clause maps onto an existing Op (or a composition of one
 *              + a structural construct, or a pure read) → migratable NOW.
 *   X-only     blocked solely on the chosen-cost X value construct (a cheap
 *              EffectValue extension, not an Op — playbook § Non-migratable).
 *   Op-blocked needs one/more Ops not yet implemented → belongs to that Op's
 *              cluster issue; a closure unblocks only when ALL its Ops ship.
 *
 * Usage:
 *   bun scripts/migration-classifier.mjs             # summary + Op backlog
 *   bun scripts/migration-classifier.mjs --free      # AFK-ready free-tranche, per module (+has-test)
 *   bun scripts/migration-classifier.mjs --batches   # per-set free batches (issue sizing)
 *   bun scripts/migration-classifier.mjs --plan      # full simulated wave plan + issue total
 *
 * Heuristic caveat: reads (ctx.get.../is.../has... getters) are assumed
 * declaratively expressible via ref/if/forEach, so FREE is an UPPER bound — a
 * complex selection may kick back to manual review at transcription time.
 *
 * Delayed-trigger body union (ADR 0048): the `delayedTrigger` Op persists its
 * body INLINE, so a scheduling closure's effect includes its delayed BODY —
 * the body template's primitives are unioned into the scheduling closure
 * (matched by trigger id: string literal or same-file const). Two tracked
 * grammar gaps are marked with pseudo-blockers so they never surface as FREE:
 *   $eventFieldCapture  the payload is built from trigger-event fields
 *                       (Venom, Battering Ram, Nafs Asp — needs $event.<field>)
 *   $listCapture        a list-valued capture (Venomous Breath — the Op's
 *                       capture map is single-value only)
 *   $unresolvedDelayedBody  the scheduled trigger id could not be matched to
 *                       a same-file template (conservative: stays blocked)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { EFFECT_OP_REGISTRY } from "../convex/cards/mechanicsRegistry.ts";

const SETS_ROOT = "convex/cards/sets";

// Covered primitives = the SpellContext binding of every registered Op (live,
// so adding an Op to EFFECT_OP_REGISTRY expands the free-tranche automatically).
const COVERED = new Set(
    EFFECT_OP_REGISTRY.map((r) => r.binding)
        .filter((b) => b.startsWith("SpellContext."))
        .map((b) => b.slice("SpellContext.".length))
);

// Composition: primitive → base Op (must be covered) + a structural construct.
// These are NOT new Ops (orthogonality: existing Op + forEach), so they are
// FREE today. See CLAUDE.md § Primitive reuse.
const COMPOSITION = { dealDamageToEach: "dealDamage", destroyAll: "destroy" };

const X_PRIMITIVE = "getX";
const isRead = (n) => /^(get|is|has)/.test(n) && n !== X_PRIMITIVE;

// Planned-Op fold: primitive(s) → the single Op cluster that will implement
// them, in ship order (architecture-setting first, then by frequency). Drives
// the simulated wave plan. Primitives absent here stay residual (protocol or
// below-the-line long-tail).
const OP_SEQUENCE = [
    // delayedTrigger SHIPPED (issue #838, ADR 0048) — scheduleDelayedTrigger
    // is now COVERED live via EFFECT_OP_REGISTRY; row removed from the plan.
    ["moveZone", ["moveCardById", "returnToHand", "returnToBattlefield"]],
    ["pump", ["addTemporaryPTBuff"]],
    ["counters", ["addCounter", "removeCounter"]],
    ["tapUntap", ["tap", "untap"]],
    ["grantAbility", ["grantStaticAbility"]],
    ["libraryLook", ["peekLibraryTop", "reorderLibraryTop", "shuffleLibrary"]],
    [
        "preventDamage",
        [
            "preventNextNDamageToTarget",
            "preventAllCombatDamage",
            "preventAllCombatDamageToAndBy",
        ],
    ],
    ["regenerate", ["applyRegenerationShield"]],
    ["createToken", ["createToken"]],
    ["gainControl", ["gainControl"]],
    ["optionChoice", ["requestOptionChoice"]],
    ["addMana", ["addManaTo"]],
    ["coinFlip", ["requestCoinFlip"]],
    ["Xvalue", [X_PRIMITIVE]], // value-grammar extension, not an Op
];

function walk(dir) {
    let out = [];
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        const s = statSync(p);
        if (s.isDirectory()) {
            if (e !== "__tests__") out = out.concat(walk(p));
        } else if (e.endsWith(".ts") && e !== "index.ts") {
            out.push(p);
        }
    }
    return out;
}

// Balanced-brace extraction of every resolve:/resolveSteps: closure body, with
// its start offset (to find the enclosing card name).
function closures(src) {
    const out = [];
    const re = /(resolve|resolveSteps)\s*:/g;
    let m;
    while ((m = re.exec(src))) {
        const brace = src.indexOf("{", re.lastIndex);
        if (brace < 0) continue;
        let depth = 0;
        let j = brace;
        for (; j < src.length; j++) {
            const c = src[j];
            if (c === "{") depth++;
            else if (c === "}") {
                depth--;
                if (depth === 0) {
                    j++;
                    break;
                }
            }
        }
        out.push({ body: src.slice(brace, j), start: m.index });
    }
    return out;
}

function cardNameBefore(src, pos) {
    const before = src.slice(0, pos);
    const names = [...before.matchAll(/name:\s*"([^"]+)"/g)];
    return names.length ? names[names.length - 1][1] : null;
}

const testCache = {};
function hasPerCardTest(setFile, name) {
    if (!name) return false;
    const tf = join(
        dirname(setFile),
        "__tests__",
        basename(setFile, ".ts") + ".test.ts"
    );
    if (!(tf in testCache))
        testCache[tf] = existsSync(tf) ? readFileSync(tf, "utf8") : null;
    return testCache[tf] ? testCache[tf].includes(name) : false;
}

/** Primitives called by a closure body that no registered Op covers. */
function blockersOf(body) {
    const called = [
        ...new Set(
            [...body.matchAll(/ctx\.([a-zA-Z]+)\s*\(/g)].map((x) => x[1])
        ),
    ];
    return called.filter(
        (c) =>
            !COVERED.has(c) &&
            !isRead(c) &&
            !COMPOSITION[c] &&
            c !== X_PRIMITIVE
    );
}

function collect() {
    const items = [];
    for (const f of walk(SETS_ROOT)) {
        const src = readFileSync(f, "utf8");
        const mod = f.replace(SETS_ROOT + "/", "");
        const cls = closures(src);
        // --- Delayed-trigger body union (ADR 0048) ------------------------
        // Same-file string consts, to resolve identifier trigger ids
        // (e.g. NEXT_UPKEEP_DRAW_TRIGGER_ID = "next-upkeep-cantrip").
        const constTable = {};
        for (const m of src.matchAll(
            /const\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]+)"/g
        )) {
            constTable[m[1]] = m[2];
        }
        const resolveIdToken = (tok) =>
            tok.startsWith('"') ? tok.slice(1, -1) : constTable[tok];
        // A DelayedTriggerDef body is the `resolve:` closure whose preceding
        // window carries `timing: "next-…"` (the field unique to the template
        // shape); its trigger id is the last `id:` in that window. The window
        // spans back to the previous closure's end so no earlier closure's
        // fields leak in (comments between the fields are fine).
        const templateBlockers = {};
        let prevEnd = 0;
        for (const { body, start } of cls) {
            const window = src.slice(Math.max(prevEnd, start - 800), start);
            prevEnd = start + body.length;
            if (!/timing:\s*"next-/.test(window)) continue;
            const idMatch = [
                ...window.matchAll(/\bid:\s*("[^"]+"|[A-Za-z_$][\w$]*)/g),
            ].pop();
            if (!idMatch) continue;
            const id = resolveIdToken(idMatch[1]);
            if (id !== undefined) templateBlockers[id] = blockersOf(body);
        }
        for (const { body, start } of cls) {
            const called = [
                ...new Set(
                    [...body.matchAll(/ctx\.([a-zA-Z]+)\s*\(/g)].map(
                        (x) => x[1]
                    )
                ),
            ];
            const blockers = blockersOf(body);
            if (body.includes("scheduleDelayedTrigger(")) {
                // Union the scheduled body's primitives into the scheduling
                // closure — the `delayedTrigger` Op must express the body
                // inline (ADR 0048), so the closure unblocks only when the
                // body's primitives are covered too.
                for (const m of body.matchAll(
                    /scheduleDelayedTrigger\(\s*[^,]+,\s*("[^"]+"|[A-Za-z_$][\w$]*)/g
                )) {
                    const id = resolveIdToken(m[1]);
                    const bodyBlockers =
                        id !== undefined ? templateBlockers[id] : undefined;
                    if (bodyBlockers) blockers.push(...bodyBlockers);
                    else blockers.push("$unresolvedDelayedBody");
                }
                // Tracked grammar gaps (ADR 0048) — never FREE.
                if (/\bevent\.[A-Za-z]/.test(body)) {
                    blockers.push("$eventFieldCapture");
                }
                if (/\.join\(/.test(body)) blockers.push("$listCapture");
            }
            const name = cardNameBefore(src, start);
            items.push({
                mod,
                set: mod.split("/")[0],
                file: f,
                name,
                blockers: new Set(blockers),
                usesX: called.includes(X_PRIMITIVE),
                hasTest: hasPerCardTest(f, name),
            });
        }
    }
    return items;
}

const items = collect();
const total = items.length;
const free = items.filter((i) => i.blockers.size === 0 && !i.usesX);
const xOnly = items.filter((i) => i.blockers.size === 0 && i.usesX);
const opBlocked = items.filter((i) => i.blockers.size > 0);
const mode = process.argv[2];

if (mode === "--free") {
    const byMod = {};
    for (const i of free) (byMod[i.mod] ??= []).push(i);
    console.log(
        `FREE-tranche: ${free.length} closures across ${Object.keys(byMod).length} modules\n`
    );
    for (const mod of Object.keys(byMod).sort()) {
        const cards = byMod[mod];
        const ready = cards.filter((c) => c.hasTest).length;
        console.log(`${mod}  (${cards.length} free, ${ready} AFK-ready)`);
        for (const c of cards)
            console.log(
                `    ${c.hasTest ? "✓" : "✗no-test"}  ${c.name ?? "?"}`
            );
    }
} else if (mode === "--batches") {
    const setStats = {};
    for (const i of free) {
        const s = (setStats[i.set] ??= { total: 0, ready: 0 });
        s.total++;
        if (i.hasTest) s.ready++;
    }
    console.log("Free-tranche batch issues (1 per set):\n");
    for (const [set, s] of Object.entries(setStats).sort(
        (a, b) => b[1].total - a[1].total
    )) {
        console.log(
            `  ${set.padEnd(8)} ${String(s.total).padStart(3)} cards  (${s.ready} AFK-ready, ${s.total - s.ready} need test)`
        );
    }
    console.log(`\n${Object.keys(setStats).length} free-tranche batch issues`);
} else if (mode === "--plan") {
    for (const i of items) i.done = i.blockers.size === 0 && !i.usesX;
    // Free-tranche batched per-set: a substantial set (≥3 free) is 1 issue,
    // split at ~50 cards/PR to keep review tractable; all tiny sets (<3) fold
    // into one "misc small sets" issue.
    const PR_CAP = 50;
    const freeBySet = {};
    for (const i of free) freeBySet[i.set] = (freeBySet[i.set] || 0) + 1;
    let freeIssues = 0;
    let tinyBundle = 0;
    for (const n of Object.values(freeBySet)) {
        if (n < 3) tinyBundle = 1;
        else freeIssues += Math.ceil(n / PR_CAP);
    }
    freeIssues += tinyBundle;
    console.log(
        `FREE-tranche: ${free.length} closures → ${freeIssues} batch issues (per-set, ~${PR_CAP}/PR, tiny sets bundled)\n`
    );
    const covered = new Set();
    let opImpl = 0;
    for (const [name, prims] of OP_SEQUENCE) {
        prims.forEach((p) => covered.add(p));
        let n = 0;
        for (const i of items) {
            if (i.done) continue;
            const ok =
                [...i.blockers].every((b) => covered.has(b)) &&
                (!i.usesX || covered.has(X_PRIMITIVE));
            if (ok) {
                i.done = true;
                n++;
            }
        }
        opImpl++;
        console.log(
            `  ${name.padEnd(14)} +impl & migrate ${String(n).padStart(3)} closures (folded into 1 issue)`
        );
    }
    const residual = items.filter((i) => !i.done).length;
    console.log(
        `\nResidual (protocol + long-tail Ops, stays resolve()): ${residual}`
    );
    const totalIssues = 1 + freeIssues + opImpl;
    console.log("\n=== PRE-FILED ISSUE TOTAL ===");
    console.log(`  infra/skeleton         1`);
    console.log(`  free-tranche batches  ${String(freeIssues).padStart(2)}`);
    console.log(`  Op impl+migrate       ${String(opImpl).padStart(2)}`);
    console.log(`  ${"".padStart(23, "-")}`);
    console.log(`  TOTAL                 ${totalIssues}`);
} else {
    console.log(`Migration classifier — ${total} closures in ${SETS_ROOT}\n`);
    console.log(
        `  FREE (migratable now):   ${free.length}  (${Math.round((free.length / total) * 100)}%)`
    );
    console.log(
        `    of which AFK-ready:    ${free.filter((i) => i.hasTest).length}  (has per-card test)`
    );
    console.log(
        `    need test first:       ${free.filter((i) => !i.hasTest).length}`
    );
    console.log(`  X-only blocked:          ${xOnly.length}`);
    console.log(`  Op-blocked:              ${opBlocked.length}\n`);
    const missing = {};
    for (const i of opBlocked)
        for (const b of i.blockers) missing[b] = (missing[b] || 0) + 1;
    console.log("New-Op backlog (blocked-closure count):");
    for (const [k, v] of Object.entries(missing)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)) {
        console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
    console.log(
        `\nCovered Ops (live from EFFECT_OP_REGISTRY): ${[...COVERED].sort().join(", ")}`
    );
}
