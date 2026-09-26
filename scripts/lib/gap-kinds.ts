/**
 * The five computed Gap kinds `gaps:sync` files beside `grammar` (issue
 * #3869): `mechanic`, `scenario`, `hand-tail`, `migration` and `bot` (issue
 * #4061, over the Bot-play sweep of issue #3830).
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
    KIND_FALLBACK,
    type GapFiling,
} from "./gap-issues";
import { gapOf } from "./grammar-gaps";
import type { BotGapVerdict } from "./oracle-bot-reach";
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

/**
 * The cards something RANKS or HOLDS to the invariant — the union of every
 * priority Target's cards and every enforced Target's (see
 * {@link KindInputs.ranked}). One definition, read by `gaps:sync` to scope a
 * filing and by `check:gaps` to scope what must be filed, so the two can
 * never disagree about which gap is owed an issue.
 */
export function rankedCardIds(
    registry: TargetRegistry,
    ctx: ResolveContext,
    slices: readonly TargetSlice[] = prioritySlices(registry, ctx)
): Set<string> {
    const ranked = new Set(slices.flatMap((slice) => [...slice.ids]));
    for (const row of registry.targets) {
        if (row.enforced !== true || row.priority !== undefined) continue;
        for (const card of resolveTarget(row, ctx).cards)
            ranked.add(card.oracleId);
    }
    return ranked;
}

/**
 * The cards of every ENFORCED Target — the ones `check:targets` reds when
 * unclaimed, so the ones a hand-tail issue is owed for
 * ({@link KindInputs.enforced}). A `completion: "ready"` Target (issue #4519)
 * is owed its claims whether or not it is enforced: enforcing it would red
 * `check:targets` on every card until the filer has run, a standing RED that
 * blocks every pick, so the filer's scope reads the completion mode itself.
 */
export function enforcedCardIds(
    registry: TargetRegistry,
    ctx: ResolveContext
): Set<string> {
    const ids = new Set<string>();
    for (const row of registry.targets) {
        if (row.enforced !== true && row.completion !== "ready") continue;
        for (const card of resolveTarget(row, ctx).cards)
            ids.add(card.oracleId);
    }
    return ids;
}

/**
 * The cards of every `completion: "ready"` Target — the ones the hand-tail
 * floor does not apply to (issue #4519): a gap holding one owes a `grammar`
 * claim however few corpus cards carry it, and the card is never owed a
 * `hand-tail` claim ({@link KindInputs.floorless}).
 */
export function floorlessCardIds(
    registry: TargetRegistry,
    ctx: ResolveContext
): Set<string> {
    const ids = new Set<string>();
    for (const row of registry.targets) {
        if (row.completion !== "ready") continue;
        for (const card of resolveTarget(row, ctx).cards)
            ids.add(card.oracleId);
    }
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
    /** `data/targets.json`'s flag: whether hand-tail issues are FILED at all. */
    readonly handTailFiling: boolean;
    /**
     * The cards of ENFORCED Targets — the ones a claim is OWED for.
     * `check:targets` reds only an enforced Target's unclaimed card, and
     * `format-premodern` alone ranks ~1,850 below-floor cards nobody owes a
     * claim, so a ranked card outside this set is computed and reported as
     * held, never filed (issue #4219). Read by the `hand-tail` filer (behind
     * `handTailFiling`) and by {@link buildFragmentGapFilings}.
     */
    readonly enforced: ReadonlySet<string>;
    /**
     * The cards of `completion: "ready"` Targets (issue #4519,
     * {@link floorlessCardIds}) — the hand-tail floor does not apply to them:
     * every gap owes a `grammar` claim and none owes a `hand-tail` one. Absent
     * means none.
     */
    readonly floorless?: ReadonlySet<string>;
    readonly gapKeys: (row: CardRow) => readonly string[];
    readonly leverage: ReadonlyMap<string, number>;
    /** Oracle ids already carrying a well-formed `hand-tail:` marker. */
    readonly handTail: ReadonlySet<string>;
    /**
     * The Bot Reach Findings report merged over the lockfile (issue #4406,
     * `mergeBotVerdicts`) — oracle id → the verdict for the card's SHIPPED
     * definition. Absent exactly when no report was read (`gaps:sync` always
     * reads the committed one; a test that does not care about hand-written
     * Bot Gaps omits it and falls back to the lockfile's own `botReach`).
     */
    readonly botFindings?: ReadonlyMap<string, BotGapVerdict>;
    /**
     * Oracle id → the lowest-numbered OPEN issue whose `## Cards` section
     * names the card (`openCardIssueIndex`, issue #4515) — the input a
     * card-keyed kind adopts from instead of filing a duplicate. Absent means
     * no adoption (a dry run makes no network call).
     */
    readonly openCardIssues?: ReadonlyMap<string, number>;
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
    /** A card-keyed draft names its card, so the filer can adopt the open
     *  issue already about it (issue #4515). */
    readonly oracleId?: string;
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
 * The open issue a card-keyed draft adopts (issue #4515): the card's entry in
 * `openCardIssues`, unless the claim already records a DIFFERENT issue — a
 * recorded claim is reconciled as it always was. Keyed by card, so the kinds
 * keyed by gap, class or rule (no `oracleId`) never adopt.
 */
function adoption(draft: Draft, inputs: KindInputs): { adopts?: number } {
    if (draft.oracleId === undefined) return {};
    const open = inputs.openCardIssues?.get(draft.oracleId);
    if (open === undefined) return {};
    const recorded = inputs.filed.get(claimId(draft.kind, draft.key));
    return recorded === undefined || recorded === open ? { adopts: open } : {};
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
        ...adoption(draft, inputs),
        title: draft.title,
        labels: GAP_LABELS[kind],
        parentSetCode: draft.parentSetCode,
        fallbackParent: KIND_FALLBACK[kind],
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

// ── grammar — one issue per FRAGMENT gap of an enforced Target ─────────

/**
 * The Grammar Gaps an ENFORCED Target's cards are held by: one issue per gap
 * key at or above `handTailFloor`, the `grammar` claim `coverageVerdict` looks
 * for before it lets such a card leave `unclaimed` (issue #4219). The `ops`
 * rows of the allowlist are the other half of the kind
 * (`buildGrammarGapFilings`), keyed `(op) › <Op>`; this half is keyed by
 * `gapOf(fragment).key` and its claim lives in `claims`, not `ops`.
 *
 * Scoped to enforced Targets, like hand-tail: a ranked-only Target owes no
 * claim, and its own gaps enter the day it is enforced.
 */
export function buildFragmentGapFilings(inputs: KindInputs): GapFiling[] {
    const held = new Map<string, Set<string>>();
    for (const row of inputs.lock.cards) {
        if (row.state !== "unparsed") continue;
        if (!inputs.enforced.has(row.oracleId)) continue;
        for (const key of inputs.gapKeys(row)) {
            if (
                (inputs.leverage.get(key) ?? 0) < inputs.floor &&
                !inputs.floorless?.has(row.oracleId)
            )
                continue;
            let ids = held.get(key);
            if (ids === undefined) held.set(key, (ids = new Set()));
            ids.add(row.oracleId);
        }
    }
    if (held.size === 0) return [];

    const samples = new Map<string, string[]>();
    for (const fragment of inputs.lock.fragments) {
        const key = gapOf(fragment).key;
        if (!held.has(key)) continue;
        const seen = samples.get(key) ?? [];
        if (seen.length < 3 && !seen.includes(fragment.text))
            seen.push(fragment.text);
        samples.set(key, seen);
    }
    const nameOf = new Map(
        inputs.lock.cards.map((c) => [c.oracleId, c.name] as const)
    );
    const drafts: Draft[] = [...held].map(([key, ids]) => {
        const corpus = inputs.leverage.get(key) ?? 0;
        const counts = inputs.slices.map(
            (slice) => [...ids].filter((id) => slice.ids.has(id)).length
        );
        const names = [...ids]
            .map((id) => nameOf.get(id))
            .filter((name): name is string => name !== undefined)
            .sort();
        return {
            kind: "grammar" as const,
            key,
            title: title(GAP_TITLE_PREFIX.grammar, key),
            parentSetCode: topSetCode(inputs.slices, ids),
            counts,
            corpus,
            render: () =>
                [
                    `A **Grammar Gap** the compiler cannot consume: \`${key}\` — ${corpus} corpus cards carry it (floor ${inputs.floor}), and it holds cards of an \`enforced\` Target, which \`check:targets\` reds until this gap has an issue.`,
                    "",
                    ...(samples.get(key) ?? []).map(
                        (text) =>
                            `Fragment refused: \`${text.replace(/\s+/g, " ").trim()}\``
                    ),
                    "",
                    perTargetBlock(
                        inputs.slices,
                        counts,
                        corpus,
                        "cards of a priority Target held by this gap"
                    ),
                    "",
                    `Enforced-Target cards held (${names.length}): ${names.join(", ")}`,
                    "",
                    "The work is `/grammar-rule` on this key. The gap disappears when the rule lands and no card carries it — this issue closes through that PR, never by `gaps:sync`.",
                ].join("\n"),
        };
    });
    return rank(drafts, inputs, "grammar");
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
    /** Computed and REPORTED but not filed — flag off, or the card is
     *  outside every enforced Target. */
    readonly held: readonly GapFiling[];
} {
    const fragmentText = (row: CardRow): string | undefined => {
        const index = row.gaps?.[0];
        if (index === undefined) return undefined;
        return inputs.lock.fragments[index]?.text;
    };

    const drafts: Draft[] = [];
    const outOfScope: Draft[] = [];
    for (const row of inputs.lock.cards) {
        if (row.state !== "unparsed") continue;
        if (!inputs.ranked.has(row.oracleId)) continue;
        if (inputs.handTail.has(row.oracleId)) continue;
        // A `ready` Target's card is owed a Grammar Rule, never Hand Tail.
        if (inputs.floorless?.has(row.oracleId)) continue;
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
        (inputs.enforced.has(row.oracleId) ? drafts : outOfScope).push({
            kind: "hand-tail",
            key: row.name,
            oracleId: row.oracleId,
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
    if (!inputs.handTailFiling)
        return {
            filings: [],
            held: rank([...drafts, ...outOfScope], inputs, "hand-tail"),
        };
    return {
        filings: rank(drafts, inputs, "hand-tail"),
        held: rank(outOfScope, inputs, "hand-tail"),
    };
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

// ── bot — one issue per Bot Gap KEY (issue #4061) ────────────────────────

/**
 * What each Bot Gap cause MEANS, so a reader triages the issue without
 * re-deriving the sweep (`BotReachCause`, `convex/gre/ai/botReach.ts`). Only
 * the text differs per cause: the filing rule is the same for every one.
 */
const BOT_CAUSE_TEXT: Readonly<Record<string, string>> = {
    "never-chosen":
        "**A card the search never picks.** The move that plays each card below is legal and affordable, and the search picks another move in BOTH main phases of the turn (`REACH_WINDOWS`, `convex/gre/ai/botReach.ts`). Read the DecisionTrace before assuming a cause: it may be a valuation gap — seam 3 of the Bot reachability walk (`OP_VALUERS` + `OP_BENEFICENCE`, `docs/guides/bot-reachability.md`), the Bot does not WANT the card because what its Ops do is valued at nothing or less — or a timing preference the sweep's positions do not yet pose.",
    "position-unmodelled":
        "**A gap in the sweep's harness, not in the Bot's judgement.** The generated position could not pose these cards at all — the engine refuses a human the cast too (no legal target, an additional cost the seeded board cannot pay, a mana cost the seeded lands cannot produce). The work is teaching the sweep's position (`botReachSpec`, `convex/gre/ai/botReach.ts`) the shape; the Bot may well play the card once posed.",
    "no-progress":
        "**A harness limit.** The follow-through did not settle inside the sweep's step budget (`MAX_FOLLOW_THROUGH_STEPS`); every decision in it was answered. Not a claim about the Bot — raise the budget or shorten the follow-through, then re-read the verdict.",
    "harness-error":
        "**A harness limit.** Playing the card threw inside the sweep: a generated definition reached a GRE path that refuses it. The sweep failed, not the card — find the throw, then re-read the verdict.",
    "no-legal-move":
        "**The Bot cannot reach the card.** The engine offers a human the action, and no move the Bot enumerates uses it — seam 1 of the Bot reachability walk (`enumerateMoves`). The card is `frozen`: withheld from the catalogue until this closes.",
    "unanswerable-input":
        "**The Bot cannot finish the card.** Its follow-through owes an input no legal move answers — seam 2 of the Bot reachability walk (the choice surface). The card is `frozen`: withheld from the catalogue until this closes.",
};

/**
 * The cause a Bot Gap key opens with (`botGapKey`: `<cause> › <form>…`). The
 * separator is `oracle-bot-reach.ts`'s, restated rather than imported: that
 * module is a compiler-hash input, and pulling it here would drag the engine
 * into `gaps:sync`. Parity is pinned by `gaps-sync.test.ts`, which splits
 * `botGapKey`'s own output for every cause.
 */
export function botCauseOf(key: string): string {
    return key.split(" › ")[0] ?? "";
}

/**
 * A card's merged Bot verdict — the Findings report's, when `botFindings`
 * carries one for it, else the lockfile row's own `botReach`/`botGap`
 * (`mergeBotVerdicts`'s rule, restated over one row at a time so a caller with
 * no report to hand still gets the lockfile's answer for free).
 */
function mergedBotVerdict(
    row: CardRow,
    findings?: ReadonlyMap<string, BotGapVerdict>
): BotGapVerdict | undefined {
    const found = findings?.get(row.oracleId);
    if (found !== undefined) return found;
    return row.botReach === undefined
        ? undefined
        : { outcome: row.botReach, gap: row.botGap };
}

/**
 * A card's Bot Gap key, when it carries one — present iff the merged verdict
 * is not `played`, and the pair is re-checked here rather than trusted: a
 * `played` verdict with a stale key would file a gap for a card the Bot
 * plays.
 */
function botGapOf(
    row: CardRow,
    findings?: ReadonlyMap<string, BotGapVerdict>
): string | undefined {
    const verdict = mergedBotVerdict(row, findings);
    return verdict !== undefined && verdict.outcome !== "played"
        ? verdict.gap
        : undefined;
}

/**
 * The Bot Gap keys `gaps:sync` owes an issue: a key at least one RANKED card
 * carries (`KindInputs.ranked` — priority ∪ enforced). The rest stay in the
 * lockfile's `botGaps` table, reported and not filed, and enter the filer the
 * day their Target takes a priority, exactly like a hand-tail card. Sorted,
 * so `check:gaps` prints one list per tree.
 */
export function inScopeBotGapKeys(
    cards: readonly CardRow[],
    ranked: ReadonlySet<string>,
    findings?: ReadonlyMap<string, BotGapVerdict>
): string[] {
    const keys = new Set<string>();
    for (const row of cards) {
        const key = botGapOf(row, findings);
        if (key !== undefined && ranked.has(row.oracleId)) keys.add(key);
    }
    return [...keys].sort();
}

/**
 * One issue per Bot Gap KEY (issue #4061), under the rules every other
 * computed kind follows: scoped to the ranked Targets, ranked per Target,
 * the measure named beside each number, parented under the top Target's
 * umbrella else PRD #3820. The corpus count is every card carrying the key —
 * the lockfile's `botGaps[].cards` — so the body's corpus line and the table
 * agree.
 *
 * The same key is the claim a `frozen` card's `bot-unreachable` quarantine
 * needs (`quarantineClass`), so filing a frozen key is exactly what takes its
 * cards out of `unclaimed` — the `mechanic` / `scenario` pattern.
 */
export function buildBotGapFilings(inputs: KindInputs): GapFiling[] {
    const byKey = new Map<string, { ids: Set<string>; frozen: boolean }>();
    for (const row of inputs.lock.cards) {
        const verdict = mergedBotVerdict(row, inputs.botFindings);
        if (verdict === undefined || verdict.outcome === "played") continue;
        const key = verdict.gap;
        if (key === undefined) continue;
        let entry = byKey.get(key);
        if (entry === undefined) {
            entry = { ids: new Set(), frozen: false };
            byKey.set(key, entry);
        }
        entry.ids.add(row.oracleId);
        if (verdict.outcome === "frozen") entry.frozen = true;
    }

    const nameOf = new Map(
        inputs.lock.cards.map((c) => [c.oracleId, c.name] as const)
    );
    const drafts: Draft[] = [];
    for (const [key, entry] of byKey) {
        if (![...entry.ids].some((id) => inputs.ranked.has(id))) continue;
        const counts = inputs.slices.map(
            (slice) => [...entry.ids].filter((id) => slice.ids.has(id)).length
        );
        const held = [...entry.ids]
            .map((id) => nameOf.get(id))
            .filter((name): name is string => name !== undefined)
            .sort();
        const cause = botCauseOf(key);
        drafts.push({
            kind: "bot",
            key,
            title: title(GAP_TITLE_PREFIX.bot, key),
            parentSetCode: topSetCode(inputs.slices, entry.ids),
            counts,
            corpus: entry.ids.size,
            render: () =>
                [
                    `A **Bot Gap** (ADR 0105 § 7.2): the Bot-play sweep (\`oracle:compile\`, issue #3830) does not see the Bot play the cards below, and every one of them fails the same way — cause \`${cause}\`.`,
                    "",
                    BOT_CAUSE_TEXT[cause] ??
                        `Cause \`${cause}\` has no triage text in \`gap-kinds.ts\` yet — read \`BotReachCause\` in \`convex/gre/ai/botReach.ts\`.`,
                    "",
                    `Bot Gap key (\`botGaps[].key\` in \`data/oracle-compiled.json\`): \`${key}\``,
                    entry.frozen
                        ? "Outcome: `frozen` — the cards are withheld (quarantine `bot-unreachable`); this issue's claim is what the Coverage Invariant reads for them."
                        : "Outcome: `ignored` — the cards ship; the Bot just does not play them.",
                    "",
                    perTargetBlock(
                        inputs.slices,
                        counts,
                        entry.ids.size,
                        "cards the Bot does not play"
                    ),
                    "",
                    `Cards held (${held.length}): ${held.slice(0, 60).join(", ")}${held.length > 60 ? `, … (+${held.length - 60})` : ""}`,
                    "",
                    "The gap disappears when the sweep's next verdict plays every card above — `oracle:compile` re-plays a card whenever its definition or the Bot changes. This issue closes through the PR that does it, never by `gaps:sync`. A behaviour change to the Bot owes a `must` blade entry (`/bot-slice`).",
                ].join("\n"),
        });
    }
    return rank(drafts, inputs, "bot");
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
