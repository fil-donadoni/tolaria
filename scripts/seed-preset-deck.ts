#!/usr/bin/env bun
/**
 * `bun run seed:preset <slug|--all> [--dry-run]` — register Premodern Tier 1
 * lists from `data/premodern-tier1-decks.json` as Preset Decks (issue #3168;
 * `--all` is issue #3254).
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
 * `--all` is the SWEEP this file's own header used to name as the pending
 * second entry point ("a sweep seeding all six Tier 1 lists once #2719's card
 * slices land — is the moment to extract it, before the two copies drift").
 * That moment arrived: #3204/#3205/#3206 took Parallax Replenish to 21/21 and
 * nothing in the pipeline noticed, because the last card of a decklist is
 * landed by a card slice whose own diff has no idea it was the last one. So
 * the write is now `scripts/lib/seed-preset-run.ts`, shared by both entry
 * points, and the obligation is written into CLAUDE.md § Development cycle and
 * `/next-issue` § Land where the pipeline will meet it.
 *
 * The sweep REPORTS the blocked decks rather than failing on them — being
 * blocked is the normal state of a list nobody has finished, and the rejects
 * are the interesting half of the output, the same posture `seed:backlog`
 * takes. It exits non-zero only when a deck that IS seedable could not be
 * written.
 */

import { dirname, join } from "node:path";
import { tryGetCardByName } from "../convex/cards/index";
import { buildPresetPayload } from "./lib/preset-deck-seed";
import { seedPreset } from "./lib/seed-preset-run";
import { readTier1Decks } from "./lib/tier1-decks";

// This checkout's root. The canonical list and the card registry are
// git-tracked, so they are read from HERE — from a worktree, the primary's
// copy is a different branch's (issue #3187).
const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Every Tier 1 list is a Premodern deck; the format is not a CLI choice. */
const FORMAT = "premodern" as const;

export interface SeedPresetArgs {
    /** The one list to seed. Empty exactly when `all` is set. */
    slug: string;
    /** Sweep every list in the canonical file (issue #3254). */
    all: boolean;
    dryRun: boolean;
}

export function parseArgs(argv: string[]): SeedPresetArgs {
    const positional = argv.filter((a) => !a.startsWith("--"));
    const all = argv.includes("--all");
    const slug = positional[0] ?? "";
    if (all && slug) {
        throw new Error(
            "pass a slug OR --all, not both — --all sweeps every list"
        );
    }
    if (!all && !slug) {
        throw new Error("usage: bun run seed:preset <slug|--all> [--dry-run]");
    }
    return { slug, all, dryRun: argv.includes("--dry-run") };
}

/** One deck's outcome in a sweep, so the report and the exit code are decided
 *  from data rather than from console side effects. */
export interface SweepRow {
    slug: string;
    name: string;
    /** `seedable` — every card resolved and the list is legal offline;
     *  `blocked` — it is not, with `problems` saying why (the normal state of
     *  a list nobody has finished);
     *  `failed` — it WAS seedable and the deployment refused the write. */
    state: "seedable" | "blocked" | "failed";
    action?: string;
    problems?: string[];
}

/** Builds the payload for one deck and, unless `dryRun`, writes it. Shared by
 *  both entry points so "what counts as seedable" has ONE definition: the card
 *  registry resolving every name plus the offline legality check inside
 *  `buildPresetPayload`. */
export function seedOne(
    deck: ReturnType<typeof readTier1Decks>["decks"][number],
    suppliedOn: string,
    dryRun: boolean
): SweepRow {
    const { payload, problems } = buildPresetPayload(
        deck,
        FORMAT,
        suppliedOn,
        (name) => tryGetCardByName(name)
    );
    if (!payload) {
        return {
            slug: deck.slug,
            name: deck.name,
            state: "blocked",
            problems,
        };
    }
    if (dryRun) {
        return { slug: deck.slug, name: deck.name, state: "seedable" };
    }
    const res = seedPreset(deck.slug, payload);
    if (res.error) {
        return {
            slug: deck.slug,
            name: deck.name,
            state: "failed",
            problems: [res.error],
        };
    }
    return {
        slug: deck.slug,
        name: deck.name,
        state: "seedable",
        action: res.action,
    };
}

function main(): void {
    const [, , ...argv] = process.argv;
    let args: SeedPresetArgs;
    try {
        args = parseArgs(argv);
    } catch (err) {
        console.error(`seed:preset: ${(err as Error).message}`);
        process.exit(1);
    }

    // The canonical file and the registry both live in the repo, so they are
    // read from wherever this runs; only the DEPLOYMENT write needs the
    // primary checkout, whose `.env.local` names the deployment.
    const file = readTier1Decks(ROOT);

    if (args.all) {
        const rows = file.decks.map((d) =>
            seedOne(d, file.source.suppliedOn, args.dryRun)
        );
        for (const row of rows) {
            if (row.state === "blocked") continue;
            const verb = args.dryRun
                ? `${DIM}would seed${RESET}`
                : row.state === "failed"
                  ? `${RED}✗ refused${RESET}`
                  : `${GREEN}✓ ${row.action}${RESET}`;
            console.log(`${verb} ${DIM}→ presetDecks/${row.slug}${RESET}`);
            for (const p of row.problems ?? []) {
                console.error(`${DIM}    ${p}${RESET}`);
            }
        }
        // The blocked half LAST and together: it is the part a reader acts on,
        // and burying it between successes is how a list nobody finished stays
        // unnoticed — the exact failure this sweep exists to end.
        const blocked = rows.filter((r) => r.state === "blocked");
        for (const row of blocked) {
            console.log(
                `${DIM}· not yet playable${RESET} ${row.name} ${DIM}(${row.slug})${RESET}`
            );
            for (const p of row.problems ?? []) {
                console.log(`${DIM}    ${p}${RESET}`);
            }
        }
        const seeded = rows.filter((r) => r.state === "seedable").length;
        const failed = rows.filter((r) => r.state === "failed").length;
        console.log(
            `${DIM}${rows.length} list(s): ${seeded} ${args.dryRun ? "seedable" : "seeded"}, ` +
                `${blocked.length} not yet playable${failed > 0 ? `, ${failed} refused` : ""}${RESET}`
        );
        // A BLOCKED deck is not a failure — it is the normal state of a list
        // whose cards nobody has finished. Only a deck that was seedable and
        // could not be written is.
        if (failed > 0) process.exit(1);
        return;
    }

    const deck = file.decks.find((d) => d.slug === args.slug);
    if (!deck) {
        const known = file.decks.map((d) => d.slug).join(", ");
        console.error(
            `${RED}seed:preset: no list with slug "${args.slug}"${RESET}\n` +
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
        `${deck.name} ${DIM}(${args.slug})${RESET} — ${payload.cards.length} maindeck, ` +
            `${payload.sideboard.length} sideboard, colours ${payload.colors.join("") || "—"}`
    );

    if (args.dryRun) {
        console.log(`${DIM}--dry-run: nothing written${RESET}`);
        return;
    }

    const res = seedPreset(args.slug, payload);
    if (res.error) {
        console.error(
            `${RED}seed:preset: the deployment refused the write${RESET}\n` +
                `${DIM}  ${res.error}${RESET}`
        );
        process.exit(1);
    }
    console.log(
        `${GREEN}✓ ${res.action}${RESET} ${DIM}→ presetDecks/${args.slug}${RESET}`
    );
}

if (import.meta.main) main();
