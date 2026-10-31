#!/usr/bin/env bun
/**
 * Every hand-written card on the Vintage Cube list owes a Pick Rating
 * (issue #7629). A card named in `VINTAGE_CUBE_NAMES` joins `buildCubePool()`
 * the moment it is implemented, and `pickRatings.bot.test.ts` ("every pool
 * card is rated") then needs its id in `data/pick-ratings/vintage-cube.json`.
 *
 * WHY A SOURCE SCAN. The pool resolves names through the derived catalogue,
 * which a branch carries at its merge-base (ADR 0157): the new card is absent
 * locally, the test passes, and only the queue's lane — which regenerates
 * derived state — goes red (PR #7579). This guard reads the card SOURCE
 * (`convex/cards/sets/**` anchors: `id` + `name`), never the catalogue, so
 * `land:ready`'s pre-queue check sees the miss in the authoring session.
 *
 * Compiled (`ready`) cube cards are not scanned: they reach the pool through
 * the lockfile, and the lane's test covers them.
 *
 * Offline, ~1 s. Runs in `check:lane` on a diff that can move it
 * (`CHEAP_GUARDS`, issue #4963) and in `health`.
 *
 * Run: bun run check:cube-ratings
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { VINTAGE_CUBE_NAMES } from "../convex/cubes/vintageCubeNames";
import { CARD_ANCHOR, scanCardAnchors } from "./lib/compiler-gap-markers";
import { collectSetFiles } from "./lib/divergence-markers";

const RATINGS_PATH = "data/pick-ratings/vintage-cube.json";
/** An `id:` property: a string literal or a same-file string constant. */
const ID_LINE = /^(\s*)id:\s*(?:"([^"]+)"|([A-Za-z0-9_$]+)\s*,)/;
/** A module-level string constant — `id: FLICKERWISP_ID` names one. */
const STRING_CONST = /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*"([^"]+)"/;

export interface SourceCard {
    readonly name: string;
    /** `null` when the definition's `id:` cannot be read — a red for a cube
     *  card (fail-closed), never a silent skip. */
    readonly id: string | null;
    /** `<file>:<line>` of the anchor, for the red line. */
    readonly at: string;
}

/**
 * The `id` + `name` of every `defineCard(` anchor in one set file. The
 * definition's own `id:` is the LEAST indented one in its body: an ability's
 * sits deeper, and a factory call (`makeTriome({ … })`, `defineSplitCard`)
 * shifts the definition's without changing that order.
 */
export function scanSourceCards(
    lines: readonly string[],
    file: string
): SourceCard[] {
    const consts = new Map<string, string>();
    for (const line of lines) {
        const m = STRING_CONST.exec(line);
        if (m !== null) consts.set(m[1], m[2]);
    }
    const cards: SourceCard[] = [];
    for (const anchor of scanCardAnchors(lines).anchors) {
        let end = anchor.line;
        while (end < lines.length && !CARD_ANCHOR.test(lines[end])) end++;
        let best: RegExpExecArray | null = null;
        for (const line of lines.slice(anchor.line, end)) {
            const m = ID_LINE.exec(line);
            if (m !== null && (best === null || m[1].length < best[1].length))
                best = m;
        }
        const id =
            best === null ? null : (best[2] ?? consts.get(best[3]) ?? null);
        cards.push({ name: anchor.name, id, at: `${file}:${anchor.line}` });
    }
    return cards;
}

/** One red line per cube card no id of which is rated; empty = green. */
export function missingCubeRatings(
    cards: readonly SourceCard[],
    cubeNames: readonly string[],
    ratings: Readonly<Record<string, number>>
): string[] {
    const onCube = new Set(cubeNames);
    const byName = new Map<string, SourceCard[]>();
    for (const card of cards) {
        if (!onCube.has(card.name)) continue;
        byName.set(card.name, [...(byName.get(card.name) ?? []), card]);
    }
    const reds: string[] = [];
    for (const [name, defs] of byName) {
        const unresolved = defs.find((d) => d.id === null);
        if (unresolved !== undefined) {
            reds.push(
                `${unresolved.at}: \`${name}\` is on the Vintage Cube list but its definition's \`id:\` could not be read`
            );
            continue;
        }
        if (defs.some((d) => ratings[d.id!] !== undefined)) continue;
        reds.push(
            `${defs[0].at}: \`${name}\` is on the Vintage Cube list but ${RATINGS_PATH} has no rating for "${defs[0].id}" — add one (pickRatings.bot.test.ts reds on the lane)`
        );
    }
    return reds;
}

if (import.meta.main) {
    const root = process.cwd();
    const cards = collectSetFiles(
        join(root, "convex", "cards", "sets")
    ).flatMap((file) =>
        scanSourceCards(
            readFileSync(file, "utf8").split("\n"),
            relative(root, file)
        )
    );
    const { ratings } = JSON.parse(
        readFileSync(join(root, RATINGS_PATH), "utf8")
    ) as {
        ratings: Record<string, number>;
    };
    const reds = missingCubeRatings(cards, VINTAGE_CUBE_NAMES, ratings);
    for (const red of reds) console.error(`✗ ${red}`);
    if (reds.length > 0) process.exit(1);
    console.log(
        `✓ cube ratings (${cards.length} hand-written card(s) scanned; every one on the Vintage Cube list is rated)`
    );
}
