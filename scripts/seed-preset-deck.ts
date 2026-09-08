#!/usr/bin/env bun
/**
 * `bun run seed:preset <slug> [--dry-run]` — register ONE Premodern Tier 1
 * list from `data/premodern-tier1-decks.json` as a Preset Deck (issue #3168).
 *
 * Why this exists: Preset Decks are rows in the `presetDecks` table (ADR 0033
 * / PRD #466), and the only writer was `createPreset`, driven by a human in
 * the Admin deck editor. `convex/decks.ts` points at a `seedPresets` migration
 * as the seed path; that migration appears in two comments and no code. So
 * "seed the Preset Decks" (issue #2719) named work with no tool, and six
 * 75-card lists were going to be retyped by hand.
 *
 * Two constraints inherited from `seed-scenario.ts`, for the same reasons:
 *
 *  1. **It runs in the PRIMARY CHECKOUT.** `.env.local` carries
 *     `CONVEX_DEPLOYMENT` and a linked worktree does not have it — a seed run
 *     from `../tolaria-issue-N` either finds no deployment or, worse, a
 *     different one.
 *  2. **It is UPSERT-BY-SLUG.** `seedPresetDirect` patches the row under the
 *     canonical slug instead of inserting a duplicate, so re-seeding after a
 *     card slice lands is the normal way to use this.
 *
 * NOT A GATE, and it cannot be one: the written row is DEPLOYMENT-LOCAL
 * (#770/#1455, like a debug scenario). `data/premodern-tier1-decks.json` stays
 * the source of truth; this is the reproducible bridge to a deployment. A
 * developer with no local deployment is not failing anything.
 *
 * `--dry-run` builds and validates the payload and prints it, touching no
 * deployment — which is also what makes the refusal paths testable offline.
 *
 * The `convex run` call is INLINE here, where `seed-scenario.ts` factors its
 * equivalent into `scripts/lib/seed-scenario-run.ts`. That split exists
 * because two callers need it (the per-PR CLI and the backlog sweep); this
 * has one. A second entry point — a sweep seeding all six Tier 1 lists once
 * #2719's card slices land — is the moment to extract it, before the two
 * copies drift.
 */

import { spawnSync } from "node:child_process";
import { tryGetCardByName } from "../convex/cards/index";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { buildPresetPayload } from "./lib/preset-deck-seed";
import { readTier1Decks } from "./lib/tier1-decks";
import { primaryCheckout } from "./lib/primary-checkout";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Every Tier 1 list is a Premodern deck; the format is not a CLI choice. */
const FORMAT = "premodern" as const;

export function parseArgs(argv: string[]): { slug: string; dryRun: boolean } {
    const positional = argv.filter((a) => !a.startsWith("--"));
    const slug = positional[0] ?? "";
    if (!slug) {
        throw new Error("usage: bun run seed:preset <slug> [--dry-run]");
    }
    return { slug, dryRun: argv.includes("--dry-run") };
}

function main(): void {
    const [, , ...argv] = process.argv;
    let slug: string;
    let dryRun: boolean;
    try {
        ({ slug, dryRun } = parseArgs(argv));
    } catch (err) {
        console.error(`seed:preset: ${(err as Error).message}`);
        process.exit(1);
    }

    // The canonical file and the registry both live in the repo, so they are
    // read from wherever this runs; only the DEPLOYMENT write needs the
    // primary checkout.
    const root = primaryCheckout();
    const file = readTier1Decks(root);
    const deck = file.decks.find((d) => d.slug === slug);
    if (!deck) {
        const known = file.decks.map((d) => d.slug).join(", ");
        console.error(
            `${RED}seed:preset: no list with slug "${slug}"${RESET}\n` +
                `${DIM}  known slugs: ${known}${RESET}`
        );
        process.exit(1);
    }

    const { payload, problems } = buildPresetPayload(
        deck,
        FORMAT,
        file.source.suppliedOn,
        (name) => tryGetCardByName(name)
    );
    if (!payload) {
        console.error(
            `${RED}seed:preset: ${deck.name} cannot be seeded${RESET}`
        );
        for (const p of problems) console.error(`${DIM}  ${p}${RESET}`);
        process.exit(1);
    }

    console.log(
        `${deck.name} ${DIM}(${slug})${RESET} — ${payload.cards.length} maindeck, ` +
            `${payload.sideboard.length} sideboard, colours ${payload.colors.join("") || "—"}`
    );

    if (dryRun) {
        console.log(`${DIM}--dry-run: nothing written${RESET}`);
        return;
    }

    const res = spawnSync(
        "npx",
        [
            "convex",
            "run",
            "decks:seedPresetDirect",
            JSON.stringify({ expectedSlug: slug, input: payload }),
        ],
        { cwd: root, encoding: "utf8", timeout: 120_000 }
    );
    if (res.error || res.status !== 0) {
        const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
        console.error(
            `${RED}seed:preset: the deployment refused the write${RESET}\n` +
                `${DIM}  ${res.error?.message ?? convexRunErrorMessage(out)}${RESET}`
        );
        process.exit(1);
    }
    let action = "written";
    try {
        action =
            (JSON.parse((res.stdout ?? "").trim()) as { action?: string })
                .action ?? action;
    } catch {
        // A return-shape change must not turn a successful write into a
        // reported failure — same tolerance as `seedScenario`.
    }
    console.log(
        `${GREEN}✓ ${action}${RESET} ${DIM}→ presetDecks/${slug}${RESET}`
    );
}

if (import.meta.main) main();
