#!/usr/bin/env bun
/**
 * `bun run seed:preset <slug|--all> [--dry-run]` — register the 25 Premodern
 * metagame lists from `data/premodern-metagame-decks.json` AND the 10 Modern
 * ones from `data/modern-metagame-decks.json` (issue #8453) as Preset Decks
 * of their own Format (the source is the metagame file, issue #6675 — ONE
 * source for Preset Decks — where an archetype also had a hand-curated Tier 1
 * list the mtgtop8 list replaces it on the same slug). A slug both files name
 * is refused: `presetDecks` is keyed by slug, and two lists on one slug would
 * overwrite each other on every sweep.
 *
 * **A list is published at 75/75** (owner decision 2026-11-08): seedable only
 * when every copy of its main 60 AND sideboard 15 is playable by
 * `deckPlayability` (`scripts/lib/tier1-decks.ts`) — the same count
 * `oracle:report --decks` prints, never a second one — and every name resolves
 * in the card registry. The sweep is what publishes: `post-merge` runs it
 * locally after a landing that may move a card's state, the hosting build runs
 * it on production after every release, so a list goes live on the first
 * sweep after its last card lands, with nobody remembering to.
 *
 * Why this exists: Preset Decks are rows in the `presetDecks` table (ADR 0033
 * / PRD #466), and the only writer was `createPreset`, driven by a human in
 * the Admin deck editor. `convex/decks.ts` points at a `seedPresets` migration
 * as the seed path; that migration appears in two comments and no code. So
 * "seed the Preset Decks" named work with no tool, and six
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
 * (#770/#1455, like a debug scenario). `data/premodern-metagame-decks.json`
 * stays the source of truth; this is the reproducible bridge to a deployment. A
 * developer with no local deployment is not failing anything.
 *
 * `--dry-run` builds and validates the payload and prints it, touching no
 * deployment — which is also what makes the refusal paths testable offline.
 *
 * `--deploy` (issue #3499) flips constraint 1: instead of the primary
 * checkout's `.env.local`, the write goes to whatever `CONVEX_DEPLOY_KEY`
 * selects, from the current directory, with no env file involved. That is the
 * shape a hosting build needs, and `bun run seed:preset:deploy` — chained
 * after `convex deploy` in `vercel.json` — is the only intended caller: the
 * Card Definitions of a list are CODE and ship with the deploy, while the
 * Preset Deck referencing them is a ROW, and nothing wrote that row on
 * production. So a list could be live and unpickable, which is what happened
 * to Psychatog.
 *
 * `--prod` is the owner's door to the same production rows
 * BETWEEN releases: `bun run seed:preset:prod` sweeps every list from the
 * primary checkout with `convex run --prod`. That needs no deploy key: the
 * project is the one `.env.local` links, and auth is the developer's Convex CLI
 * login. Run `-- --dry-run` first. It is never chained into anything, because
 * a production write is the owner's act.
 *
 * **The canonical file wins on every deploy.** `seedPresetDirect` is
 * upsert-by-slug and deliberately overwriting (`convex/decks.ts` §
 * `presetSeedDecision`), and the sweep uses it unchanged: after a deploy every
 * seedable metagame row MATCHES `data/premodern-metagame-decks.json`. The
 * cost is stated rather than discovered — Admin edits to a CANONICAL slug are
 * not durable, and curating one of those lists means editing the canonical
 * file. The opposite contract exists for the opposite job (`presetsToSeed`
 * skips a slug already present); this entry point is not it.
 *
 * `--all` is the SWEEP this file's own header used to name as the pending
 * second entry point ("a sweep seeding all six Tier 1 lists once #2719's card
 * slices land — is the moment to extract it, before the two copies drift").
 * That moment arrived: #3204/#3205/#3206 took Parallax Replenish to 21/21 and
 * nothing in the pipeline noticed, because the last card of a decklist is
 * landed by a card slice whose own diff has no idea it was the last one. So
 * the write is now `scripts/lib/seed-preset-run.ts`, shared by both entry
 * points, and the obligation is written into CLAUDE.md § Development cycle and
 * `/next-ticket` § Land where the pipeline will meet it.
 *
 * The sweep REPORTS the blocked decks rather than failing on them — being
 * blocked is the normal state of a list nobody has finished, and the rejects
 * are the interesting half of the output, the same posture `seed:backlog`
 * takes. It exits non-zero only when a deck that IS seedable could not be
 * written.
 *
 * ONE other non-zero path, and it is deliberate: `--deploy` with no deploy key
 * in the environment. Chained into a build command, that exit reds the deploy —
 * for a configuration fault, not a write failure. The alternative is worse. A
 * renamed or dropped key would otherwise make the step exit 0 having seeded
 * nothing, on every deploy, forever: precisely the silence issue #3499 exists
 * to end. Nothing else here can fail a deploy.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tryGetCardByName } from "../convex/cards/index";
import type { CardDefinition } from "../convex/cards/types";
import {
    BANLIST_SEEDS,
    isBanlistFormatId,
    resolveBanlistEnforcement,
    type BanlistOverride,
    type FormatId,
} from "../convex/formats";
import { buildPresetPayload } from "./lib/preset-deck-seed";
import {
    resolveSeedTarget,
    seedPreset,
    type SeedTarget,
} from "./lib/seed-preset-run";
import { parseLockfile, type Lockfile } from "./lib/oracle-lockfile";
import { poolOracleIds } from "./oracle-compile";
import {
    readMetagameDecks,
    readModernMetagameDecks,
    type MetagameDeckFile,
} from "./premodern-metagame-import";
import {
    deckPlayability,
    isFullyPlayable,
    tier1Reports,
    type DeckPlayability,
    type Tier1Deck,
} from "./lib/tier1-decks";

// This checkout's root. The canonical list and the card registry are
// git-tracked, so they are read from HERE — from a worktree, the primary's
// copy is a different branch's (issue #3187).
const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** One canonical list file and the Format its decks are published under —
 *  the Format is the file's, never a CLI choice. */
export interface PresetSource {
    readonly format: FormatId;
    /** Where the lists come from, as the preset description names it. */
    readonly origin: string;
    readonly read: (root: string) => MetagameDeckFile;
}

/** Every list file the sweep publishes, in sweep order. */
export const PRESET_SOURCES: readonly PresetSource[] = [
    { format: "premodern", origin: "mtgtop8.com", read: readMetagameDecks },
    // The owner's lists of 2026-11-06 (issue #8276).
    { format: "modern", origin: "2026-11-06", read: readModernMetagameDecks },
];

/** One list, the file it came from, and how much of its 75 is playable. */
export interface SourcedDeck {
    readonly deck: Tier1Deck;
    readonly source: PresetSource;
    readonly playability: DeckPlayability;
}

/**
 * Every list of every source with its playability, refusing a slug two lists
 * share (the `presetDecks` key — the later list would overwrite the earlier
 * on every sweep). Pure over its inputs: the files are read by `source.read`,
 * the lockfile and the pool are handed in.
 */
export function sourcedDecks(
    files: readonly { source: PresetSource; file: MetagameDeckFile }[],
    lock: Lockfile,
    pool: ReadonlySet<string>
): SourcedDeck[] {
    const out: SourcedDeck[] = [];
    const owner = new Map<string, FormatId>();
    for (const { source, file } of files) {
        const reports = tier1Reports(file, lock, pool);
        file.decks.forEach((deck, i) => {
            const prior = owner.get(deck.slug);
            if (prior !== undefined) {
                throw new Error(
                    `duplicate Preset Deck slug "${deck.slug}" — named by the ${prior} AND the ${source.format} list; presetDecks is keyed by slug`
                );
            }
            owner.set(deck.slug, source.format);
            out.push({
                deck,
                source,
                playability: deckPlayability(deck, reports[i]),
            });
        });
    }
    return out;
}

/** The lists as this checkout holds them. */
function readSourcedDecks(): SourcedDeck[] {
    const lock = parseLockfile(
        readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
    );
    return sourcedDecks(
        PRESET_SOURCES.map((source) => ({ source, file: source.read(ROOT) })),
        lock,
        poolOracleIds()
    );
}

/** Why a list is not yet at 75/75, first missing card first. */
export function playabilityProblems(p: DeckPlayability): string[] {
    const total = p.mainTotal + p.sideTotal;
    const head = `${p.main + p.side}/${total} playable (main ${p.main}/${p.mainTotal}, side ${p.side}/${p.sideTotal}) — published at ${total}/${total}`;
    return [
        head,
        ...p.missing.map(
            (c) =>
                `missing: ${c.name} (${c.state}${c.blocker ? `: ${c.blocker}` : ""})`
        ),
    ];
}

/**
 * A canonical list's card name as a definition. The lists spell a
 * multi-face card by its combined Scryfall name (`Front // Back`, the
 * lockfile's key), which a compiled card registers but a hand-written
 * double-faced one does not — it is registered under its front face, the
 * name it carries. So: the name as written, else its front face.
 */
export function resolveListName(name: string): CardDefinition | null {
    const front = name.split(" // ")[0];
    return (
        tryGetCardByName(name) ??
        (front !== name ? tryGetCardByName(front) : null)
    );
}

/** The offline banlist a payload is checked against: the Format's code seed,
 *  resolved by name exactly as `convex/banlists.ts` resolves it pre-sync. */
function seedBanlist(format: FormatId): BanlistOverride | undefined {
    return isBanlistFormatId(format)
        ? resolveBanlistEnforcement(BANLIST_SEEDS[format], (name) =>
              tryGetCardByName(name)
          )
        : undefined;
}

export interface SeedPresetArgs {
    /** The one list to seed. Empty exactly when `all` is set. */
    slug: string;
    /** Sweep every list in the canonical file (issue #3254). */
    all: boolean;
    dryRun: boolean;
    /** Which deployment the write goes to — `--deploy` picks the one the
     *  deploy environment's key selects (issue #3499), `--prod` the linked
     *  project's production under the CLI login (issue #7341). */
    target: SeedTarget;
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
        throw new Error(
            "usage: bun run seed:preset <slug|--all> [--dry-run] [--deploy|--prod]"
        );
    }
    const deploy = argv.includes("--deploy");
    const prod = argv.includes("--prod");
    if (deploy && prod) {
        throw new Error(
            "pass --deploy OR --prod, not both — --deploy is the hosting build's key, --prod the owner's CLI login"
        );
    }
    return {
        slug,
        all,
        dryRun: argv.includes("--dry-run"),
        target: deploy ? "deployment" : prod ? "production" : "local",
    };
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
 *  both entry points so "what counts as seedable" has ONE definition: all 75
 *  copies playable (`isFullyPlayable`), the card registry resolving every
 *  name, and the offline legality check inside `buildPresetPayload`. */
export function seedOne(
    sourced: SourcedDeck,
    dryRun: boolean,
    target: SeedTarget = "local"
): SweepRow {
    const { deck, source, playability } = sourced;
    if (!isFullyPlayable(playability)) {
        return {
            slug: deck.slug,
            name: deck.name,
            state: "blocked",
            problems: playabilityProblems(playability),
        };
    }
    const { payload, problems } = buildPresetPayload(
        deck,
        source.format,
        source.origin,
        resolveListName,
        seedBanlist(source.format)
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
    const res = seedPreset(deck.slug, payload, target);
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

    // The canonical files and the registry all live in the repo, so they are
    // read from wherever this runs; only the DEPLOYMENT write needs the
    // primary checkout, whose `.env.local` names the deployment.
    let decks: SourcedDeck[];
    try {
        decks = readSourcedDecks();
    } catch (err) {
        console.error(`${RED}seed:preset: ${(err as Error).message}${RESET}`);
        process.exit(1);
    }

    // A deploy-time run has no env file and no operator watching it: the build
    // log is the only place the chosen deployment is ever visible, and a
    // missing key must read as a configuration failure there rather than as a
    // sweep that quietly seeded nothing (issue #3499).
    if (args.target === "deployment" && !args.dryRun) {
        const plan = resolveSeedTarget("deployment");
        if (plan.error) {
            console.error(`${RED}seed:preset --deploy: ${plan.error}${RESET}`);
            process.exit(1);
        }
        console.log(
            `${DIM}--deploy: writing to the deployment CONVEX_DEPLOY_KEY selects` +
                ` (canonical file wins on every deploy)${RESET}`
        );
    }

    // The owner's push between releases (issue #7341): say where the write
    // goes before it happens, since a production row is visible to every user.
    if (args.target === "production" && !args.dryRun) {
        const plan = resolveSeedTarget("production");
        if (plan.error) {
            console.error(`${RED}seed:preset --prod: ${plan.error}${RESET}`);
            process.exit(1);
        }
        console.log(
            `${DIM}--prod: writing to the PRODUCTION deployment of the project the` +
                ` primary checkout is linked to (canonical file wins)${RESET}`
        );
    }

    if (args.all) {
        const rows = decks.map((d) => seedOne(d, args.dryRun, args.target));
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

    const sourced = decks.find((d) => d.deck.slug === args.slug);
    if (!sourced) {
        const known = decks.map((d) => d.deck.slug).join(", ");
        console.error(
            `${RED}seed:preset: no list with slug "${args.slug}"${RESET}\n` +
                `${DIM}  known slugs: ${known}${RESET}`
        );
        process.exit(1);
    }
    const { deck, source, playability } = sourced;
    if (!isFullyPlayable(playability)) {
        console.error(
            `${RED}seed:preset: ${deck.name} is not yet playable${RESET}`
        );
        for (const p of playabilityProblems(playability))
            console.error(`${DIM}  ${p}${RESET}`);
        process.exit(1);
    }

    const { payload, problems } = buildPresetPayload(
        deck,
        source.format,
        source.origin,
        resolveListName,
        seedBanlist(source.format)
    );
    if (!payload) {
        console.error(
            `${RED}seed:preset: ${deck.name} cannot be seeded${RESET}`
        );
        for (const p of problems) console.error(`${DIM}  ${p}${RESET}`);
        process.exit(1);
    }

    console.log(
        `${deck.name} ${DIM}(${args.slug}, ${source.format})${RESET} — ${payload.cards.length} maindeck, ` +
            `${payload.sideboard.length} sideboard, colours ${payload.colors.join("") || "—"}`
    );

    if (args.dryRun) {
        console.log(`${DIM}--dry-run: nothing written${RESET}`);
        return;
    }

    const res = seedPreset(args.slug, payload, args.target);
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
