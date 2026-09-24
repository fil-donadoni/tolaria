/**
 * Target Lists (issue #3867, wayfinder issue #3848, map issue #3846) — the
 * roadmap's objectives as DATA: a deck list, a name list, a set, a format
 * pool, each one row of `data/targets.json`. A new objective is a row, never
 * code.
 *
 * The registry REFERENCES the sources that already exist — the Tier 1 lists,
 * the metagame import, the Vintage Cube worklist, the vendored MTGJSON sets,
 * the lockfile's `poolIn` formats — and moves none of them.
 *
 * Fail-closed, like the Tier 1 reader it generalises: an unresolved name, a
 * duplicate, a malformed row or list throws. A Target whose denominator could
 * shrink silently would report progress that does not exist.
 *
 * Reads the LOCKFILE, never the corpus — the lockfile carries one row per
 * corpus card, and only it is committed, so every figure here is reproducible
 * offline on a clean checkout.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPORTED_FORMATS } from "../oracle-corpus";
import { corpusNameIndex } from "./card-names";
import { gapOf, poolTarget } from "./grammar-gaps";
import type { QuarantineReason } from "../../convex/oracle/types";
import type { CardRow, Lockfile } from "./oracle-lockfile";
import { validateDecks, type Tier1Deck } from "./tier1-decks";

/** Path of the registry, relative to the repo root. */
export const TARGETS_PATH = "data/targets.json";

export const TARGET_KINDS = [
    "deck-list",
    "name-list",
    "set",
    "format",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/**
 * How a Target completes (issue #4519). `playable` (the default) is the v1
 * gate of ADR 0143: every card `ready` or hand-written, the hand tail
 * declared by name and held to the registry-global `handTailFloor`. `ready`
 * is stricter: EVERY card `ready`, so the floor does not apply — a gap that
 * holds one of the Target's cards owes a `grammar` claim however few corpus
 * cards carry it, and a `hand-tail` claim or marker never settles the card.
 */
export const COMPLETION_MODES = ["playable", "ready"] as const;
export type CompletionMode = (typeof COMPLETION_MODES)[number];

/**
 * One registered Target List.
 *
 * `source` by kind:
 * - `deck-list` — a `{ decks }` file (60 + 15 each); `path#slug` names one
 *   deck, a bare path the union of every deck in the file;
 * - `name-list` — a text file, one card name per line, `#` comments;
 * - `set` — a vendored MTGJSON set file (`data/json/<SET>.json`);
 * - `format` — a format of the lockfile's `poolIn` (`REPORTED_FORMATS`).
 *
 * `priority` is the rank order of Grammar Gaps — priority 1 first, then 2, …,
 * corpus as tie-break. Changing the order is editing these integers, by the
 * owner, in a PR. A Target with no priority is measured, not ranked by.
 */
export interface TargetRow {
    readonly id: string;
    readonly kind: TargetKind;
    readonly source: string;
    readonly priority?: number;
    /**
     * Whether `check:targets` holds this Target to the Coverage Invariant
     * (issue #3868). Opt-in, because an invariant over every registered card
     * is red the day it lands — 12k corpus cards were unclaimed then — and a
     * standing RED blocks every pick. A Target opts in once its claims are
     * filed (`gaps:sync`, issue #3869); an un-enforced one is reported only.
     * A hand-authoring issue may close on the invariant's word only for a
     * card of an ENFORCED Target.
     */
    readonly enforced?: boolean;
    /** How the Target completes — absent means `"playable"` (issue #4519). */
    readonly completion?: CompletionMode;
}

export interface TargetRegistry {
    /**
     * A Grammar Gap whose rule would unlock fewer corpus cards than this is
     * below the floor: a card whose residual gaps ALL sit below it is Hand
     * Tail. Measured as the gap's corpus `refuses` — the cards in all of
     * Magic that carry it (wayfinder issue #3848: a rule that pays for two
     * cards is a per-card script in grammar's clothing).
     */
    readonly handTailFloor: number;
    /** Whether `gaps:sync` files hand-tail issues — for cards of `enforced`
     *  Targets only (issue #4219). Read by the filer, not here. */
    readonly handTailFiling: boolean;
    readonly targets: readonly TargetRow[];
}

/** Parse and VALIDATE the registry. Every rule is a denominator guard. */
export function parseTargetRegistry(
    text: string,
    path = TARGETS_PATH
): TargetRegistry {
    const fail = (message: string): never => {
        throw new Error(`${path}: ${message}`);
    };
    let doc: TargetRegistry;
    try {
        doc = JSON.parse(text) as TargetRegistry;
    } catch (err) {
        return fail(`does not parse: ${(err as Error).message}`);
    }
    if (!Number.isInteger(doc.handTailFloor) || doc.handTailFloor < 1)
        fail("`handTailFloor` must be a positive integer");
    if (typeof doc.handTailFiling !== "boolean")
        fail("`handTailFiling` must be a boolean");
    if (!Array.isArray(doc.targets) || doc.targets.length === 0)
        fail("`targets` must be a non-empty array");

    const ids = new Set<string>();
    const priorities = new Map<number, string>();
    for (const row of doc.targets) {
        if (
            typeof row.id !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)
        )
            fail(
                `a target has no kebab-case \`id\` (${JSON.stringify(row.id)})`
            );
        if (ids.has(row.id)) fail(`duplicate target id \`${row.id}\``);
        ids.add(row.id);
        if (!(TARGET_KINDS as readonly string[]).includes(row.kind))
            fail(
                `${row.id}: unknown kind \`${row.kind}\` (one of: ${TARGET_KINDS.join(", ")})`
            );
        if (typeof row.source !== "string" || row.source.length === 0)
            fail(`${row.id}: no \`source\``);
        if (
            row.kind === "format" &&
            !(REPORTED_FORMATS as readonly string[]).includes(row.source)
        )
            fail(
                `${row.id}: unknown format \`${row.source}\` (one of: ${REPORTED_FORMATS.join(", ")})`
            );
        if (row.priority !== undefined) {
            if (!Number.isInteger(row.priority) || row.priority < 1)
                fail(`${row.id}: \`priority\` must be a positive integer`);
            const other = priorities.get(row.priority);
            if (other !== undefined)
                fail(
                    `${row.id} and ${other} share priority ${row.priority} — the rank order must be total`
                );
            priorities.set(row.priority, row.id);
        }
        if (row.enforced !== undefined && typeof row.enforced !== "boolean")
            fail(`${row.id}: \`enforced\` must be a boolean`);
        if (
            row.completion !== undefined &&
            !(COMPLETION_MODES as readonly unknown[]).includes(row.completion)
        )
            fail(
                `${row.id}: unknown \`completion\` \`${String(row.completion)}\` (one of: ${COMPLETION_MODES.join(", ")})`
            );
    }
    return doc;
}

export function readTargetRegistry(root: string): TargetRegistry {
    return parseTargetRegistry(
        readFileSync(join(root, TARGETS_PATH), "utf8"),
        TARGETS_PATH
    );
}

/** One card of a resolved Target. */
export interface TargetCard {
    readonly oracleId: string;
    /** The lockfile's own name, not the list's spelling. */
    readonly name: string;
}

export interface ResolvedTarget {
    readonly row: TargetRow;
    /** Distinct cards, sorted by name. */
    readonly cards: readonly TargetCard[];
}

/** Everything a resolution reads, built once per lockfile. */
export interface ResolveContext {
    readonly root: string;
    readonly lock: Pick<Lockfile, "cards">;
    readonly byName: ReadonlyMap<string, CardRow>;
    readonly byOracleId: ReadonlyMap<string, CardRow>;
}

export function resolveContext(
    root: string,
    lock: Pick<Lockfile, "cards">
): ResolveContext {
    return {
        root,
        lock,
        byName: corpusNameIndex(lock),
        byOracleId: new Map(lock.cards.map((c) => [c.oracleId, c] as const)),
    };
}

/** Each printed card of an MTGJSON set file, reprints included. */
export function mtgjsonSetCards(
    json: unknown
): Array<{ name: string; oracleId?: string }> {
    const cards = (json as { data?: { cards?: unknown[] } }).data?.cards;
    if (!Array.isArray(cards) || cards.length === 0)
        throw new Error("an MTGJSON set file with no `data.cards`");
    return cards.map((raw) => {
        const card = raw as {
            name?: unknown;
            identifiers?: { scryfallOracleId?: unknown };
        };
        if (typeof card.name !== "string" || card.name.length === 0)
            throw new Error("an MTGJSON set card with no name");
        const id = card.identifiers?.scryfallOracleId;
        return typeof id === "string" && id.length > 0
            ? { name: card.name, oracleId: id }
            : { name: card.name };
    });
}

/** The card names of a deck-list source, main and sideboard together. */
function deckListNames(row: TargetRow, root: string): string[] {
    const [file, slug] = row.source.split("#");
    const doc = JSON.parse(readFileSync(join(root, file!), "utf8")) as {
        decks: readonly Tier1Deck[];
    };
    validateDecks(doc.decks, file!);
    const decks =
        slug === undefined
            ? doc.decks
            : doc.decks.filter((deck) => deck.slug === slug);
    if (decks.length === 0)
        throw new Error(
            `${TARGETS_PATH}: ${row.id} names deck \`${slug}\`, which ${file} does not hold`
        );
    return decks.flatMap((deck) =>
        [...deck.main, ...deck.sideboard].map((entry) => entry.name)
    );
}

/**
 * The names of a name-list source. A name listed twice throws: a list is a
 * record of what someone chose, and a duplicate is a typo in that record —
 * deduplicating it would hide whichever card was meant.
 */
export function parseNameList(text: string, where: string): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const raw of text.split("\n")) {
        const name = raw.replace(/#.*$/, "").trim();
        if (name.length === 0) continue;
        const key = name.toLowerCase();
        if (seen.has(key))
            throw new Error(`${where}: \`${name}\` is listed twice`);
        seen.add(key);
        names.push(name);
    }
    if (names.length === 0) throw new Error(`${where}: no names`);
    return names;
}

/**
 * A registered Target as the set of cards it requires — every one a lockfile
 * row, or a throw.
 */
export function resolveTarget(
    row: TargetRow,
    ctx: ResolveContext
): ResolvedTarget {
    const where = `${TARGETS_PATH} ${row.id}`;
    const rows = new Map<string, CardRow>();
    const byNameOrThrow = (names: readonly string[], dedupe: boolean): void => {
        for (const name of names) {
            const card = ctx.byName.get(name);
            if (card === undefined)
                throw new Error(
                    `${where}: \`${name}\` is not carried by the Oracle lockfile under exactly one ` +
                        `oracle id — fix the list, or re-pin the corpus ` +
                        `(bun run oracle:corpus && bun run oracle:compile)`
                );
            if (!dedupe && rows.has(card.oracleId))
                throw new Error(
                    `${where}: \`${name}\` resolves to ${card.name}, which the list already names`
                );
            rows.set(card.oracleId, card);
        }
    };
    const byIdOrThrow = (ids: ReadonlySet<string>): void => {
        for (const id of ids) {
            const card = ctx.byOracleId.get(id);
            if (card === undefined)
                throw new Error(
                    `${where}: oracle id ${id} is not in the pinned corpus — re-pin it ` +
                        `(bun run oracle:corpus && bun run oracle:compile)`
                );
            rows.set(id, card);
        }
    };

    switch (row.kind) {
        case "deck-list":
            // A deck names a card in main AND side, and two decks share cards:
            // repetition is the format, not a typo.
            byNameOrThrow(deckListNames(row, ctx.root), true);
            break;
        case "name-list":
            byNameOrThrow(
                parseNameList(
                    readFileSync(join(ctx.root, row.source), "utf8"),
                    where
                ),
                false
            );
            break;
        case "set":
            for (const card of mtgjsonSetCards(
                JSON.parse(readFileSync(join(ctx.root, row.source), "utf8"))
            )) {
                // The oracle id first; the printed name when MTGJSON's id is
                // one the corpus does not carry (LEG's Arboria ships its
                // scryfallId in the scryfallOracleId field). Both are an
                // identity — a card neither resolves still throws.
                const byId = ctx.byOracleId.get(card.oracleId ?? "");
                if (byId !== undefined) rows.set(byId.oracleId, byId);
                else byNameOrThrow([card.name], true);
            }
            break;
        case "format":
            byIdOrThrow(poolTarget(ctx.lock, row.source));
            break;
        default: {
            const never: never = row.kind;
            throw new Error(`${where}: unknown kind ${String(never)}`);
        }
    }
    if (rows.size === 0) throw new Error(`${where}: resolves to no cards`);
    return {
        row,
        cards: [...rows.values()]
            .map((c) => ({ oracleId: c.oracleId, name: c.name }))
            .sort((a, b) =>
                a.name < b.name
                    ? -1
                    : a.name > b.name
                      ? 1
                      : a.oracleId < b.oracleId
                        ? -1
                        : 1
            ),
    };
}

// ── Coverage ───────────────────────────────────────────────────────────────

/**
 * Where the tooling stands on a Target card (CONTEXT.md § Coverage
 * Invariant) — exactly one per card, computed from the lockfile, the
 * allowlist's claims and the card markers, in this order (issue #3868):
 *
 * - `ready` — the lockfile row compiles;
 * - `quarantine` — it compiles, is held back, and EVERY quarantine reason
 *   belongs to a class with a `mechanic`/`scenario` claim: no silent
 *   quarantine;
 * - `gap-pending` — unparsed, at least one residual Grammar Gap sits at or
 *   above the floor, and EVERY such gap has a `grammar` claim (or an `ops`
 *   row): the grammar owes it, and an issue says so;
 * - `hand-tail` — every residual gap below the floor, and the card has a
 *   `hand-tail` claim (issue open, card not yet written) or a `hand-tail:`
 *   marker on its hand-written definition;
 * - `unclaimed` — anything else: nobody has decided anything, or a decision
 *   has no issue. `check:targets` reds it on an enforced Target.
 *
 * The state is GAP-derived: a `hand-tail:` marker never outranks a gap. The
 * one exception is a protocol card — a marked card whose hand-written body is
 * a closure the compiler now produces a definition beside (Guard C's
 * `incomparable`): it is Hand Tail by construction whatever its row, since no
 * Effect Script can equal a closure and equality is unproven. Its exit route
 * is a report line, never a red.
 */
export const COVERAGE_STATES = [
    "ready",
    "quarantine",
    "gap-pending",
    "hand-tail",
    "unclaimed",
] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

/**
 * The allowlist claim kinds the Coverage Invariant reads, from
 * `data/grammar-gaps.json`'s `claims` (issue #3868). The key per kind:
 *
 * - `grammar` — a Grammar Gap key (`gapOf(fragment).key`); the file's `ops`
 *   rows claim their `(op) › …` keys under this kind too;
 * - `mechanic` / `scenario` — a quarantine class key (`quarantineClass`);
 * - `bot` — a Bot Gap key (`botGaps[].key`), the class of a `frozen` card;
 * - `hand-tail` — a card name.
 *
 * `gaps:sync` (issue #3869) is the filer that writes them; this reads them.
 */
/**
 * Every kind `gaps:sync` FILES (issue #3869) — the six of the issue body, one
 * stable key scheme each:
 *
 * - `grammar` — a Grammar Gap key (`gapOf(fragment).key`, `opGapKey(op)`);
 * - `mechanic` / `scenario` — a quarantine class key (`quarantineClass`);
 * - `bot` — a Bot Gap key (`botGaps[].key`, `<cause> › <form>[ › <ops>]`,
 *   issue #3830) — also the claim a `frozen` card's `bot-unreachable`
 *   quarantine reason needs (`quarantineClass`, issue #4061);
 * - `hand-tail` — a card name;
 * - `migration` — the slot signature of the graduates' compiled definitions,
 *   i.e. the grammar rules that now produce them.
 *
 * {@link CLAIM_KINDS} is the SUBSET the Coverage Invariant reads back. The two
 * differ on purpose: `migration` is work the grammar owes nobody's Target
 * card, so a card is never `unclaimed` for want of one — but it still takes a
 * row, because the row is what makes the filer idempotent. `bot` IS read
 * back: a `frozen` card is quarantined `bot-unreachable`, and the `bot` claim
 * on its Bot Gap key is what settles it (issue #4061).
 */
export const GAP_KINDS = [
    "grammar",
    "mechanic",
    "scenario",
    "bot",
    "hand-tail",
    "migration",
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export const CLAIM_KINDS = [
    "grammar",
    "mechanic",
    "scenario",
    "bot",
    "hand-tail",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export interface ClaimRow {
    readonly kind: GapKind;
    readonly key: string;
    /** The open issue that settles the claim. Liveness is the network
     *  sweep's question, as for Guard B — never health's. */
    readonly issue: number;
}

/**
 * The one identity of a claim — a kind and a key, joined by a TAB. The
 * separator is what `parseClaimRows` forbids inside a key: a key carrying one
 * would split back into the wrong pair, the written `claims` row would never
 * match the recomputed id, and the filer would create a fresh duplicate issue
 * on every run, forever. Quarantine keys embed free-text compiler
 * diagnostics, so "no key ever contains a tab" is enforced, not assumed.
 */
export function claimId(kind: GapKind, key: string): string {
    return `${kind}\t${key}`;
}

/** The inverse of {@link claimId} — splits at the FIRST tab, never all of
 *  them, so the round trip survives whatever `parseClaimRows` let through. */
export function splitClaimId(id: string): { kind: GapKind; key: string } {
    const at = id.indexOf("\t");
    if (at === -1) throw new Error(`not a claim id: ${JSON.stringify(id)}`);
    return {
        kind: id.slice(0, at) as GapKind,
        key: id.slice(at + 1),
    };
}

/**
 * Every row of the allowlist document that carries an issue, validated.
 * Fail-closed: a row of an unknown kind, with no key or no issue, or twice,
 * throws — a row the reader skipped would be a card red for no reason it could
 * print, and a duplicate is two issues for one decision. A typo in a `bot` or
 * `migration` row therefore reds exactly as loudly as one in a coverage kind,
 * though the invariant never reads those two back.
 *
 * `ops` rows are `grammar` rows in the census's own shape (issue #3824): the
 * `kind` is implied by which array the row sits in, never written twice.
 */
export function parseClaimRows(
    doc: {
        readonly ops?: readonly {
            readonly key?: unknown;
            readonly issue?: unknown;
        }[];
        readonly claims?: readonly Partial<Record<keyof ClaimRow, unknown>>[];
    },
    path = "data/grammar-gaps.json"
): ClaimRow[] {
    const fail = (message: string): never => {
        throw new Error(`${path}: ${message}`);
    };
    const rows: ClaimRow[] = [];
    const seen = new Set<string>();
    const add = (kind: unknown, key: unknown, issue: unknown): void => {
        if (!(GAP_KINDS as readonly unknown[]).includes(kind))
            fail(
                `claim ${JSON.stringify(key)}: unknown kind \`${String(kind)}\` (one of: ${GAP_KINDS.join(", ")})`
            );
        if (typeof key !== "string" || key.length === 0)
            fail(`a \`${String(kind)}\` claim has no \`key\``);
        if (/[\t\n]/.test(key as string))
            fail(
                `a \`${String(kind)}\` claim's \`key\` contains a tab or newline — \`claimId\` joins on a tab, so such a key never round-trips and the gap would be re-filed on every run`
            );
        if (!Number.isInteger(issue) || (issue as number) <= 0)
            fail(
                `claim \`${String(key)}\`: \`issue\` is ${JSON.stringify(issue)}, want a positive integer`
            );
        const id = claimId(kind as GapKind, key as string);
        if (seen.has(id))
            fail(`claim \`${String(key)}\` (${String(kind)}) is listed twice`);
        seen.add(id);
        rows.push({
            kind: kind as GapKind,
            key: key as string,
            issue: issue as number,
        });
    };
    if (doc.claims !== undefined && !Array.isArray(doc.claims))
        fail("`claims` must be an array");
    for (const row of doc.ops ?? []) add("grammar", row.key, row.issue);
    for (const row of doc.claims ?? []) add(row.kind, row.key, row.issue);
    return rows;
}

/**
 * The COVERAGE claims of the allowlist document, as `claimId`s — the four
 * kinds of {@link CLAIM_KINDS}. A `migration` row is validated by
 * {@link parseClaimRows} and then dropped here: it settles no card's state.
 */
export function parseClaims(
    doc: Parameters<typeof parseClaimRows>[0],
    path = "data/grammar-gaps.json"
): Set<string> {
    return new Set(
        parseClaimRows(doc, path)
            .filter((row) =>
                (CLAIM_KINDS as readonly string[]).includes(row.kind)
            )
            .map((row) => claimId(row.kind, row.key))
    );
}

/**
 * The class a quarantine reason belongs to — what ONE claim covers for every
 * card that carries it. The key is the reason's kind and detail, minus the
 * `<card> (<oracle id>): ` prefix a validator detail opens with, so two cards
 * quarantined for the same reason share one key. `planned-op`,
 * `planned-mechanic` and `ungrantable-keyword` are the engine missing a
 * mechanic; the rest are the card's generated checks (ADR 0105 § 7.1).
 *
 * `bot-unreachable` is the one reason that is neither: the card compiled and
 * passed its checks, and the Bot-play sweep found it `frozen`. Its detail IS
 * the card's Bot Gap key (`oracle-compile.ts`), so its class is kind `bot`
 * keyed VERBATIM on that key — the same claim the Bot Gap filer writes for
 * the key, and so the one row that settles the card (issue #4061).
 */
export function quarantineClass(reason: QuarantineReason): {
    kind: "mechanic" | "scenario" | "bot";
    key: string;
} {
    if (reason.kind === "bot-unreachable")
        return { kind: "bot", key: reason.detail };
    const detail = reason.detail.replace(/^.+? \([0-9a-f-]{36}\): /, "");
    return {
        kind:
            reason.kind === "planned-op" ||
            reason.kind === "planned-mechanic" ||
            reason.kind === "ungrantable-keyword"
                ? "mechanic"
                : "scenario",
        key: `${reason.kind} › ${detail}`,
    };
}

export interface CoverageContext {
    readonly floor: number;
    /** Oracle ids covered by a HAND-WRITTEN definition today. */
    readonly handWritten: ReadonlySet<string>;
    /** Oracle ids whose hand-written card carries a well-formed `hand-tail:`. */
    readonly handTail: ReadonlySet<string>;
    /**
     * Oracle ids of the hand-written cards whose body is a closure the
     * compiler now produces a definition beside — Guard C's `incomparable`,
     * read through `roundTripCard` off the committed catalogue.
     */
    readonly closure: ReadonlySet<string>;
    /** The allowlist's claims, as `claimId`s (`parseClaims`). */
    readonly claims: ReadonlySet<string>;
    readonly byOracleId: ReadonlyMap<string, CardRow>;
    /** Each unparsed card's distinct Grammar Gap keys. */
    readonly gapKeys: (row: CardRow) => readonly string[];
    /** Gap key → the corpus cards that carry it (its `refuses`). */
    readonly leverage: ReadonlyMap<string, number>;
}

/**
 * Per-gap corpus leverage and per-card gap keys, over the whole lockfile —
 * the SAME gap key `rankGrammarGaps` groups by, so a card's gaps here are the
 * rows of the ranked backlog.
 */
export function gapIndex(lock: Pick<Lockfile, "cards" | "fragments">): {
    gapKeys: (row: CardRow) => readonly string[];
    leverage: ReadonlyMap<string, number>;
} {
    const keyOfFragment = lock.fragments.map((f) => gapOf(f).key);
    const gapKeys = (row: CardRow): string[] => [
        ...new Set((row.gaps ?? []).map((i) => keyOfFragment[i]!)),
    ];
    const leverage = new Map<string, number>();
    for (const row of lock.cards) {
        if (row.state !== "unparsed") continue;
        for (const key of gapKeys(row))
            leverage.set(key, (leverage.get(key) ?? 0) + 1);
    }
    return { gapKeys, leverage };
}

export interface CoverageVerdict {
    readonly state: CoverageState;
    /** Present iff `state === "unclaimed"`: the first missing claim. */
    readonly why?: string;
}

/** THE state computation — `oracle:report --targets` and `check:targets`
 *  both read it, so there is no second definition of the five states. */
export function coverageVerdict(
    row: CardRow,
    ctx: CoverageContext,
    completion: CompletionMode = "playable"
): CoverageVerdict {
    // A `ready` Target has no Hand Tail: the floor does not apply (issue #4519).
    const floor = completion === "ready" ? 1 : ctx.floor;
    const marked = ctx.handTail.has(row.oracleId);
    if (marked && ctx.closure.has(row.oracleId)) return { state: "hand-tail" };
    if (row.state === "ready") return { state: "ready" };
    if (row.state === "quarantine") {
        // Fail closed: a held card with no reason is the silent quarantine.
        if ((row.quarantineReasons ?? []).length === 0)
            return {
                state: "unclaimed",
                why: "quarantine row carries no reason to claim",
            };
        const open = (row.quarantineReasons ?? [])
            .map(quarantineClass)
            .find((c) => !ctx.claims.has(claimId(c.kind, c.key)));
        return open === undefined
            ? { state: "quarantine" }
            : {
                  state: "unclaimed",
                  why: `quarantine class \`${open.key}\` has no \`${open.kind}\` claim`,
              };
    }
    // One gap at or above the floor is grammar owed: once those rules land,
    // whatever stays below the floor makes the card Hand Tail — so a card with
    // mixed gaps is pending, never stuck with no green state.
    const keys = ctx.gapKeys(row);
    const above = keys.filter((key) => (ctx.leverage.get(key) ?? 0) >= floor);
    if (above.length > 0) {
        const open = above.find(
            (key) => !ctx.claims.has(claimId("grammar", key))
        );
        return open === undefined
            ? { state: "gap-pending" }
            : {
                  state: "unclaimed",
                  why: `gap \`${open}\` (${ctx.leverage.get(open)} corpus cards, floor ${floor}) has no \`grammar\` claim`,
              };
    }
    if (completion === "ready") {
        const settledByHandTail =
            marked || ctx.claims.has(claimId("hand-tail", row.name));
        return {
            state: "unclaimed",
            why:
                (keys.length === 0
                    ? "no Grammar Gap attributed"
                    : "no gap holds it that a `grammar` claim covers") +
                (settledByHandTail
                    ? "; its `hand-tail` claim or marker does not satisfy a `ready` Target"
                    : "") +
                " — a `ready` Target completes at 100 % ready, so it owes a Grammar Rule, never Hand Tail",
        };
    }
    if (marked || ctx.claims.has(claimId("hand-tail", row.name)))
        return { state: "hand-tail" };
    return {
        state: "unclaimed",
        why:
            (keys.length === 0
                ? "no Grammar Gap attributed"
                : `every gap below the floor (${ctx.floor})`) +
            " and neither a `hand-tail` claim nor a `hand-tail:` marker",
    };
}

export function coverageState(
    row: CardRow,
    ctx: CoverageContext,
    completion: CompletionMode = "playable"
): CoverageState {
    return coverageVerdict(row, ctx, completion).state;
}

/** A `hand-tail:` card the tooling has caught up with. */
export interface MigrableCard {
    readonly name: string;
    readonly why: string;
}

export interface TargetCoverage {
    readonly id: string;
    readonly kind: TargetKind;
    readonly priority?: number;
    readonly enforced: boolean;
    /** How the Target completes (issue #4519). */
    readonly completion: CompletionMode;
    readonly total: number;
    /** Card names per coverage state, sorted. */
    readonly byState: Readonly<Record<CoverageState, readonly string[]>>;
    /** `ready ∪ hand-written` — the v1 gate, a figure apart from the invariant. */
    readonly playable: number;
    /** The cards that are neither, by name in list order — `total - playable`. */
    readonly unplayable: readonly string[];
    /** Every card whose state is not `ready`, in list order — what a `ready`
     *  Target still owes (issue #4519). */
    readonly notReady: readonly string[];
    readonly migrable: readonly MigrableCard[];
    /** Every `unclaimed` card with the claim it lacks, in list order. */
    readonly unclaimed: readonly MigrableCard[];
    /** Hand-written closure cards whose Oracle text now compiles — compare
     *  behaviour by hand, marker or not. Reported, never red. */
    readonly closureCompiles: readonly string[];
}

/**
 * A `hand-tail:` card is migrable when its lockfile row is `ready` (retire
 * the hand-written definition, ADR 0114) or when one of its residual gaps has
 * climbed to the floor (it re-enters the grammar queue).
 */
export function migrableReason(
    row: CardRow,
    ctx: CoverageContext
): string | undefined {
    if (!ctx.handTail.has(row.oracleId)) return undefined;
    // A protocol card graduates by hand, off the `incomparable` report line.
    if (ctx.closure.has(row.oracleId)) return undefined;
    if (row.state === "ready")
        return "row is ready — retire the hand-written definition (oracle:retire)";
    const above = ctx
        .gapKeys(row)
        .filter((key) => (ctx.leverage.get(key) ?? 0) >= ctx.floor);
    if (above.length === 0) return undefined;
    const key = above[0]!;
    return `gap at the floor — \`${key}\` unlocks ${ctx.leverage.get(key)} corpus cards (floor ${ctx.floor}); flip the marker to compiler-gap:`;
}

export function targetCoverage(
    target: ResolvedTarget,
    ctx: CoverageContext
): TargetCoverage {
    const byState: Record<CoverageState, string[]> = {
        ready: [],
        quarantine: [],
        "gap-pending": [],
        "hand-tail": [],
        unclaimed: [],
    };
    const completion = target.row.completion ?? "playable";
    const unplayable: string[] = [];
    const notReady: string[] = [];
    const migrable: MigrableCard[] = [];
    const unclaimed: MigrableCard[] = [];
    const closureCompiles: string[] = [];
    for (const card of target.cards) {
        const row = ctx.byOracleId.get(card.oracleId)!;
        const { state, why: missing } = coverageVerdict(row, ctx, completion);
        byState[state].push(card.name);
        if (state !== "ready") notReady.push(card.name);
        if (missing !== undefined)
            unclaimed.push({ name: card.name, why: missing });
        if (ctx.closure.has(card.oracleId)) closureCompiles.push(card.name);
        if (state !== "ready" && !ctx.handWritten.has(card.oracleId))
            unplayable.push(card.name);
        // A `ready` Target has no Hand Tail to migrate: its hand-tail marker is
        // already an `unclaimed` red (issue #4519).
        const why =
            completion === "ready" ? undefined : migrableReason(row, ctx);
        if (why !== undefined) migrable.push({ name: card.name, why });
    }
    return {
        id: target.row.id,
        kind: target.row.kind,
        ...(target.row.priority === undefined
            ? {}
            : { priority: target.row.priority }),
        enforced: target.row.enforced === true,
        completion,
        total: target.cards.length,
        byState,
        playable: target.cards.length - unplayable.length,
        unplayable,
        notReady,
        migrable,
        unclaimed,
        closureCompiles,
    };
}

/**
 * The Coverage Invariant's reds for ONE Target, one line each — `check:targets`
 * reds on them (enforced Targets only) and `targetCompleted` reads them as the
 * second v1-gate clause (ADR 0143), so "green" has one definition.
 */
export function coverageReds(coverage: TargetCoverage): string[] {
    return [
        ...coverage.unclaimed.map(
            ({ name, why }) => `${coverage.id}: ${name} — unclaimed: ${why}`
        ),
        ...coverage.migrable.map(
            ({ name, why }) =>
                `${coverage.id}: ${name} — hand-tail marker: ${why}`
        ),
    ];
}
