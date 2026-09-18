/**
 * The five computed Gap kinds `gaps:sync` files beside `grammar` (issue
 * #3869): `mechanic`, `scenario`, `hand-tail`, `migration` — and `bot`, whose
 * sweep (issue #3830) is not built, so its builder lives in `gap-issues.ts`
 * returning nothing.
 *
 * PURE over its inputs: the lockfile, the resolved Targets, the allowlist's
 * filed rows and the marker/graduate sets `coverage-context.ts` reads off the
 * committed tree. `gaps-sync.ts` does every byte of I/O.
 *
 * ── Two measures, never mixed (grill, issue #3867) ───────────────────────
 *
 * The `hand-tail` FLOOR is a gap's corpus `refuses` — the cards in all of
 * Magic that carry it (`gapIndex().leverage`). The per-Target figures in every
 * body are what that Target GAINS or HOLDS, and each one names its measure
 * beside the number, because "unlocks 12" and "holds 12" are different claims
 * about the same gap.
 *
 * ── The rank ─────────────────────────────────────────────────────────────
 *
 * Within a kind, filings are ordered lexicographically on the priority
 * Targets — Target 1's count, then Target 2's, … — with the corpus count as
 * the tie-break and the key last, so the order is total and two runs over one
 * lockfile print one list. The rank is the body's leading line: an issue that
 * cannot carry a numeric field can still say where it sits.
 */

import {
    GAP_LABELS,
    GAP_TITLE_PREFIX,
    PRD_ISSUE,
    type GapFiling,
} from "./gap-issues";
import type { CardRow, Lockfile } from "./oracle-lockfile";
import {
    claimId,
    quarantineClass,
    resolveTarget,
    type GapKind,
    type ResolveContext,
    type TargetKind,
    type TargetRegistry,
} from "./targets";

/** One priority Target, resolved to the oracle ids it requires. */
export interface TargetSlice {
    readonly id: string;
    readonly kind: TargetKind;
    readonly priority: number;
    /** The set code whose umbrella parents this Target's issues, or null. */
    readonly setCode: string | null;
    readonly ids: ReadonlySet<string>;
}

function setCodeOf(kind: TargetKind, source: string): string | null {
    if (kind !== "set") return null;
    const m = /([^/]+)\.json$/i.exec(source);
    return m === null ? null : m[1]!.toUpperCase();
}

/**
 * The registry's PRIORITY Targets, resolved and in rank order — "a Target with
 * no priority is measured, not ranked by" (`targets.ts`).
 */
export function prioritySlices(
    registry: TargetRegistry,
    ctx: ResolveContext
): TargetSlice[] {
    return registry.targets
        .filter((row) => row.priority !== undefined)
        .slice()
        .sort((a, b) => a.priority! - b.priority!)
        .map((row) => ({
            id: row.id,
            kind: row.kind,
            priority: row.priority!,
            setCode: setCodeOf(row.kind, row.source),
            ids: new Set(resolveTarget(row, ctx).cards.map((c) => c.oracleId)),
        }));
}

/** The union of EVERY registered Target — a card outside it is owed nothing. */
export function registeredCardIds(
    registry: TargetRegistry,
    ctx: ResolveContext
): Set<string> {
    const ids = new Set<string>();
    for (const row of registry.targets)
        for (const card of resolveTarget(row, ctx).cards)
            ids.add(card.oracleId);
    return ids;
}

/** Everything the five builders read, built once per run. */
export interface KindInputs {
    readonly lock: Pick<Lockfile, "cards" | "fragments">;
    readonly slices: readonly TargetSlice[];
    /**
     * Union of the PRIORITY Targets' cards — the cards a hand-tail issue may
     * be filed for. Not every REGISTERED card: the six format pools between
     * them register 31,913 cards, 12,109 of which sit below the floor today,
     * and filing an issue per card of a Target nobody ranked is the flood the
     * registry's own rule already rules out — "a Target with no priority is
     * measured, not ranked by" (`targets.ts`). A hand-tail issue IS ranked
     * work: it carries a rank line and parents under its Target's umbrella,
     * neither of which an unranked Target has. Such a card enters the filer
     * the day its Target takes a priority.
     *
     * ENFORCED Targets are in it too, priority or not: `check:targets` reds an
     * enforced Target's below-floor card as `unclaimed` the moment nobody has
     * claimed it, and a red with no filer behind it is a standing block
     * (review of PR #3978). So the set is priority ∪ enforced — the cards
     * something either ranks or holds to the invariant.
     */
    readonly ranked: ReadonlySet<string>;
    /** `claimId(kind, key)` → the issue already filed for it. */
    readonly filed: ReadonlyMap<string, number>;
    readonly floor: number;
    /** `data/targets.json`'s flag: whether hand-tail issues are FILED yet
     *  (false until the APC pilot is accepted, issue #3837). */
    readonly handTailFiling: boolean;
    readonly gapKeys: (row: CardRow) => readonly string[];
    readonly leverage: ReadonlyMap<string, number>;
    /** Oracle ids already carrying a well-formed `hand-tail:` marker. */
    readonly handTail: ReadonlySet<string>;
}

/** A filing before its rank is known — the rank needs the whole kind. */
interface Draft {
    readonly kind: GapKind;
    readonly key: string;
    readonly title: string;
    readonly parentSetCode: string | null;
    /** Per-slice count, aligned to `KindInputs.slices`, then the corpus. */
    readonly counts: readonly number[];
    readonly corpus: number;
    /** The body under its rank line — takes the issue's own number. */
    readonly render: (issue: number) => string;
}

/** `- premodern-metagame (deck-list, priority 1): 4 (measure: cards held)` */
function perTargetBlock(
    slices: readonly TargetSlice[],
    counts: readonly number[],
    corpus: number,
    measure: string
): string {
    if (slices.length === 0)
        return `Corpus: ${corpus} (measure: ${measure}). No registered Target List (\`data/targets.json\`) carries a priority.`;
    const lines = slices.map(
        (slice, i) =>
            `- ${slice.id} (${slice.kind}, priority ${slice.priority}): ${counts[i]}`
    );
    return [
        `Per registered Target, priority order (measure: ${measure}):`,
        ...lines,
        `- corpus: ${corpus}`,
    ].join("\n");
}

/**
 * Rank the drafts of one kind and turn them into filings. Lexicographic on the
 * per-slice counts, corpus as tie-break, key last — a total order.
 */
function rank(
    drafts: readonly Draft[],
    inputs: KindInputs,
    kind: GapKind
): GapFiling[] {
    const sorted = [...drafts].sort((a, b) => {
        for (let i = 0; i < a.counts.length; i++) {
            const d = (b.counts[i] ?? 0) - (a.counts[i] ?? 0);
            if (d !== 0) return d;
        }
        return (
            b.corpus - a.corpus || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        );
    });
    // One claimId, one issue. Two drafts can share one — a `hand-tail` key is
    // a card NAME, and 38 names are carried by two lockfile rows — and filing
    // both would create two issues for one row, keep only the second in
    // `updatedRows`, then flip that issue's body between the two cards on
    // every later run (review of PR #3978). The first in rank order wins.
    const seen = new Set<string>();
    const unique = sorted.filter((draft) => {
        const id = claimId(draft.kind, draft.key);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    return unique.map((draft, i) => ({
        kind: draft.kind,
        key: draft.key,
        currentIssue: inputs.filed.get(claimId(draft.kind, draft.key)) ?? null,
        title: draft.title,
        labels: GAP_LABELS[kind],
        parentSetCode: draft.parentSetCode,
        fallbackParent: PRD_ISSUE,
        body: (issue: number) =>
            `Rank ${i + 1} of ${unique.length} in kind \`${kind}\` — lexicographic on the priority Targets, corpus as tie-break (issue #3869).\n\n${draft.render(issue)}`,
    }));
}

/** The highest-priority slice holding any of `ids`, for the parent link. */
function topSetCode(
    slices: readonly TargetSlice[],
    ids: ReadonlySet<string>
): string | null {
    for (const slice of slices)
        for (const id of ids) if (slice.ids.has(id)) return slice.setCode;
    return null;
}

/** GitHub renders a long title unhelpfully; the KEY stays whole in the body. */
function title(prefix: string, key: string): string {
    const flat = key.replace(/\s+/g, " ").trim();
    return `${prefix} ${flat.length > 140 ? `${flat.slice(0, 137)}…` : flat}`;
}

// ── mechanic / scenario — the quarantine classes ─────────────────────────

/**
 * One issue per quarantine class: the `mechanic` kind is the engine missing a
 * mechanic (`planned-op`, `planned-mechanic`, `ungrantable-keyword`), the
 * `scenario` kind is a card-dependent smoke-skip the generated scenario cannot
 * exercise (ADR 0105 § 7.1). `quarantineClass` is the ONE key scheme, shared
 * with the Coverage Invariant's `mechanic`/`scenario` claims (issue #3868), so
 * filing a class is exactly what lets its cards leave `unclaimed`.
 */
export function buildQuarantineFilings(
    inputs: KindInputs,
    kind: "mechanic" | "scenario"
): GapFiling[] {
    const classes = new Map<
        string,
        { detail: string; ids: Set<string>; corpus: number }
    >();
    for (const row of inputs.lock.cards) {
        if (row.state !== "quarantine") continue;
        for (const reason of row.quarantineReasons ?? []) {
            const cls = quarantineClass(reason);
            if (cls.kind !== kind) continue;
            let entry = classes.get(cls.key);
            if (entry === undefined) {
                entry = { detail: reason.detail, ids: new Set(), corpus: 0 };
                classes.set(cls.key, entry);
            }
            if (entry.ids.has(row.oracleId)) continue;
            entry.ids.add(row.oracleId);
            entry.corpus += 1;
        }
    }

    const nameOf = new Map(
        inputs.lock.cards.map((c) => [c.oracleId, c.name] as const)
    );
    const drafts: Draft[] = [...classes].map(([key, entry]) => {
        const counts = inputs.slices.map(
            (slice) => [...entry.ids].filter((id) => slice.ids.has(id)).length
        );
        const held = [...entry.ids]
            .map((id) => nameOf.get(id))
            .filter((name): name is string => name !== undefined)
            .sort();
        return {
            kind,
            key,
            title: title(GAP_TITLE_PREFIX[kind], key),
            parentSetCode: topSetCode(inputs.slices, entry.ids),
            counts,
            corpus: entry.corpus,
            render: () =>
                [
                    kind === "mechanic"
                        ? "A **quarantine class the engine owes a mechanic** (ADR 0105 § 7.1): every card below compiles, and every one is held back until the keyword or Op is implemented in the Mechanics Registry."
                        : "A **card-dependent smoke-skip class** (ADR 0105 § 7.1): the generated scenario cannot exercise these cards, so the compiler holds them. Either the generator learns the shape, or each card earns a hand-written test.",
                    "",
                    `Class key (\`quarantineClass\`, issue #3868): \`${key}\``,
                    `One reason verbatim: ${entry.detail}`,
                    "",
                    perTargetBlock(
                        inputs.slices,
                        counts,
                        entry.corpus,
                        "cards held by this class"
                    ),
                    "",
                    `Cards held (${held.length}): ${held.slice(0, 60).join(", ")}${held.length > 60 ? `, … (+${held.length - 60})` : ""}`,
                    "",
                    "The class disappears when no card carries the reason any more — this issue closes through the PR that does it, never by `gaps:sync`.",
                ].join("\n"),
        };
    });
    return rank(drafts, inputs, kind);
}

// ── hand-tail — one issue per CARD ──────────────────────────────────────

/**
 * A Target card whose residual gaps ALL sit below `handTailFloor`: the grammar
 * will never pay for it, so it is hand-written. A card with ANY gap at or
 * above the floor belongs to the `grammar` kind — it is `gap-pending`, not
 * Hand Tail (issue #3868).
 *
 * A card already carrying a well-formed `hand-tail:` marker is settled and is
 * not filed again. A hand-WRITTEN card whose `compiler-gap:` names a gap that
 * has since fallen below the floor lands here by the same rule: its row is
 * still `unparsed`, every residual gap is below the floor, and no `hand-tail:`
 * marker vouches for it yet.
 */
export function buildHandTailFilings(inputs: KindInputs): {
    /** Filed this run — empty while `handTailFiling` is false. */
    readonly filings: readonly GapFiling[];
    /** Computed and REPORTED but not filed — the same list, flag off. */
    readonly held: readonly GapFiling[];
} {
    const fragmentText = (row: CardRow): string | undefined => {
        const index = row.gaps?.[0];
        if (index === undefined) return undefined;
        return inputs.lock.fragments[index]?.text;
    };

    const drafts: Draft[] = [];
    for (const row of inputs.lock.cards) {
        if (row.state !== "unparsed") continue;
        if (!inputs.ranked.has(row.oracleId)) continue;
        if (inputs.handTail.has(row.oracleId)) continue;
        const keys = inputs.gapKeys(row);
        if (keys.length === 0) continue;
        if (keys.some((key) => (inputs.leverage.get(key) ?? 0) >= inputs.floor))
            continue;

        const ids = new Set([row.oracleId]);
        const counts = inputs.slices.map((slice) =>
            slice.ids.has(row.oracleId) ? 1 : 0
        );
        const leading = keys
            .slice()
            .sort(
                (a, b) =>
                    (inputs.leverage.get(b) ?? 0) -
                        (inputs.leverage.get(a) ?? 0) ||
                    (a < b ? -1 : a > b ? 1 : 0)
            )[0]!;
        const oneLine = (fragmentText(row) ?? leading)
            .replace(/\s+/g, " ")
            .trim();
        drafts.push({
            kind: "hand-tail",
            key: row.name,
            title: `${GAP_TITLE_PREFIX["hand-tail"]} ${row.name}`,
            parentSetCode: topSetCode(inputs.slices, ids),
            counts,
            corpus: inputs.leverage.get(leading) ?? 0,
            render: (issue) =>
                [
                    `**${row.name}** is Hand Tail: every Grammar Gap it still carries sits below the floor of ${inputs.floor} corpus cards (measure: the gap's corpus \`refuses\` — the cards in all of Magic that carry it). A rule that pays for fewer than that is a per-card script in grammar's clothing (wayfinder issue #3848), so this card is written by hand.`,
                    "",
                    `Fragment the grammar cannot consume: \`${oneLine}\``,
                    ...keys
                        .slice()
                        .sort()
                        .map(
                            (key) =>
                                `- gap \`${key}\` — leverage ${inputs.leverage.get(key) ?? 0} corpus cards (floor ${inputs.floor})`
                        ),
                    "",
                    perTargetBlock(
                        inputs.slices,
                        counts,
                        1,
                        "1 when the Target requires this card"
                    ),
                    "",
                    "The closing PR writes the card by hand and adds this marker line above its definition anchor:",
                    "",
                    "```ts",
                    `// hand-tail: ${oneLine} (#${issue})`,
                    "```",
                    "",
                    "`check:targets` reads that marker back (issue #3868); a `compiler-gap:` here instead would claim the grammar still owes the rule, which below the floor it does not.",
                ].join("\n"),
        });
    }
    const ranked = rank(drafts, inputs, "hand-tail");
    return inputs.handTailFiling
        ? { filings: ranked, held: [] }
        : { filings: [], held: ranked };
}

// ── migration — the graduates, clustered by the rule that unlocked them ──

/** One hand-written card the compiler now reproduces exactly. */
export interface Graduate {
    readonly oracleId: string;
    readonly name: string;
    /** The set module the hand-written definition lives in. */
    readonly module: string;
    /** Test files naming the card — a superset of its per-card tests. */
    readonly tests: readonly string[];
    /** The slots the compiled definition came out of — its unlocking rules. */
    readonly slots: readonly string[];
}

/** The cluster key of a graduate: the grammar slots that now produce it. */
export function unlockingRule(slots: readonly string[]): string {
    const distinct = [...new Set(slots)].sort();
    return distinct.length === 0 ? "(no slot)" : distinct.join(" + ");
}

/**
 * One issue per UNLOCKING RULE, never per card (issue #3869): the hand-written
 * cards whose own Oracle text the compiler now reads back into the same
 * definition (Guard C verdict `equal`) are graduates, and they graduate in
 * clusters — every card that compiles through one slot signature retires by
 * the same steps (ADR 0114).
 *
 * A CLOSURE card is never here: verdict `incomparable` proves the text
 * compiles, never that the definition equals the closure, so equality is
 * unproven and the exit is `oracle:report`'s "compare behaviour by hand" line
 * (grill, issue #3867).
 */
export function buildMigrationFilings(
    inputs: KindInputs,
    graduates: readonly Graduate[]
): GapFiling[] {
    const clusters = new Map<string, Graduate[]>();
    for (const graduate of graduates) {
        const key = unlockingRule(graduate.slots);
        const bucket = clusters.get(key);
        if (bucket === undefined) clusters.set(key, [graduate]);
        else bucket.push(graduate);
    }

    const drafts: Draft[] = [...clusters].map(([key, members]) => {
        const ids = new Set(members.map((m) => m.oracleId));
        const counts = inputs.slices.map(
            (slice) => [...ids].filter((id) => slice.ids.has(id)).length
        );
        const sorted = [...members].sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0
        );
        return {
            kind: "migration" as const,
            key,
            title: title(
                GAP_TITLE_PREFIX.migration,
                `${key} — ${members.length} card(s)`
            ),
            parentSetCode: topSetCode(inputs.slices, ids),
            counts,
            corpus: members.length,
            render: () =>
                [
                    `${members.length} hand-written card(s) now round-trip through the grammar rules of \`${key}\` — the compiler reads each card's own Oracle text back into that same definition (Guard C verdict \`equal\`). The hand-written twin is redundant: retire it (ADR 0114).`,
                    "",
                    perTargetBlock(
                        inputs.slices,
                        counts,
                        members.length,
                        "graduates of this rule"
                    ),
                    "",
                    "| card | module | test files naming it |",
                    "| --- | --- | --- |",
                    ...sorted.map(
                        (m) =>
                            `| ${m.name} | \`${m.module}\` | ${m.tests.length === 0 ? "none" : m.tests.map((t) => `\`${t}\``).join(", ")} |`
                    ),
                    "",
                    "Retirement steps, per card (ADR 0114):",
                    "",
                    "1. `bun run oracle:retire <card>` — records the equivalence proof in `data/oracle-retirements.json` and stamps the lockfile row;",
                    "2. delete the hand-written definition from its module;",
                    "3. rewrite each per-card test onto the registry seam — the behaviour is still owed a test, the DEFINITION is not. The third column lists every test file that names the card, which is a superset: a file may only use it as a fixture.",
                    "",
                    "A closure card is deliberately absent from this cluster: `incomparable` proves the text compiles, never that the definition equals the closure (issue #3867).",
                ].join("\n"),
        };
    });
    return rank(drafts, inputs, "migration");
}

// ── Orphan card issues — the two exits the owner chose ───────────────────

/** The template the sync leaves on an orphan card issue. */
export function orphanComment(cards: readonly string[]): string {
    const names = cards.map((c) => `\`${c}\``).join(", ");
    return [
        `Which objective needs ${names}? Add a Target row to \`data/targets.json\`, or close this as \`wontfix\`.`,
        "",
        `\`gaps:sync\` (issue #3869) files work per registered Target List. This issue names a card no Target requires, so no computed Gap will ever reach it and no agent will pick it up from the queue. The two exits are the ones above; labelling it \`ready-for-human\` is how the sync hands it back rather than touching it.`,
    ].join("\n");
}

/** `[card] Sunscape Apprentice + Nightscape Apprentice — moveZone …` */
const CARD_TITLE = /^\s*\[cards?\]\s*(.+?)\s*(?:—|–|\s-\s|\(|$)/i;

/** The card names an `area:cards` issue title claims, in title order. */
export function cardsNamedByTitle(
    issueTitle: string,
    byName: (name: string) => string | undefined
): string[] {
    const m = CARD_TITLE.exec(issueTitle);
    if (m === null) return [];
    const names: string[] = [];
    for (const raw of m[1]!.split(" + ")) {
        const name = raw.trim();
        if (name.length === 0) continue;
        if (byName(name) === undefined) return [];
        names.push(name);
    }
    return names;
}

export interface OrphanAction {
    readonly issue: number;
    readonly cards: readonly string[];
    readonly comment: string;
}

/**
 * Open `area:cards` issues naming ONLY cards no registered Target requires.
 * The sync never touches such an issue's own state: it labels it
 * `ready-for-human` and leaves one templated comment, the two exits the owner
 * chose (issue #3869). Already-labelled issues are skipped, which is what
 * makes a second run leave no second comment.
 *
 * A title whose card names the lockfile cannot resolve yields NO names, and an
 * issue with no names is left alone — a guess would label a real slice
 * `ready-for-human` and stall it.
 */
export function orphanCardActions(
    issues: readonly {
        readonly number: number;
        readonly title: string;
        readonly labels: readonly string[];
    }[],
    byName: (name: string) => string | undefined,
    registered: ReadonlySet<string>
): OrphanAction[] {
    const actions: OrphanAction[] = [];
    for (const issue of issues) {
        if (issue.labels.includes("ready-for-human")) continue;
        const cards = cardsNamedByTitle(issue.title, byName);
        if (cards.length === 0) continue;
        if (cards.some((name) => registered.has(byName(name)!))) continue;
        actions.push({
            issue: issue.number,
            cards,
            comment: orphanComment(cards),
        });
    }
    return actions;
}
