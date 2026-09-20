/**
 * `gaps:sync` — the ONE filer of every computed Gap (ADR 0137, PRD issue
 * #3820, issues #3829, #3974 and #3869). PURE planning: `gaps-sync.ts` does
 * the I/O (the `gh`-backed tracker, the write-back).
 *
 * This module holds the SHAPE of a filing, the tracker seam and the sync
 * decision; the five COMPUTED kinds live in `gap-kinds.ts`. `grammar` is here,
 * because it is the one kind whose issue number is written back into an `ops`
 * row rather than into `claims`.
 *
 * ── Scope of the `grammar` kind ─────────────────────────────────────────
 *
 * Grammar Gaps here are the DERIVED OP CENSUS rows of `data/grammar-gaps.json`
 * (`check-gaps.ts`, ADR 0105 § 7.3): bounded and shrink-only, so "one issue
 * per gap" is a closed set. The per-fragment backlog `oracle:report --gaps`
 * ranks per Target is a different, unbounded list — not this command's.
 *
 * An Op-census gap carries NO corpus or per-Target count. The key FORMAT is
 * shared with `rankGrammarGaps` (`opGapKey`), but the compiler attributes a
 * refused line to the slot that got furthest — never to an Op — so no
 * Fragment ever lands on an `(op) › …` key (0 of ~34k in the lockfile the day
 * this was measured, issue #3974). The first version read those counts anyway
 * and filed 87 bodies all saying "0 cards, no Target"; the body says what the
 * gap is instead of printing a number that is zero by construction. **The
 * other five kinds are counted per Target for real** — their keys come from
 * quarantine reasons, Bot Gap keys, card names and slot signatures, which
 * every Target card's own lockfile row carries.
 *
 * The `## Unlocks` pass — an engine issue declaring the gap keys it unblocks,
 * and the native `blocked by` edge this writes from it (issue #4052) — is the
 * last section of this file, with its own header.
 *
 * ── Parent: umbrellas partition by BAND (issue #4056) ──────────────────
 *
 * Three kinds are partitioned — `grammar` under the Grammar Rules umbrellas,
 * `mechanic` under the Ops umbrellas (new and existing Ops alike), `bot` under
 * the Bot Gaps umbrellas — one umbrella per band, `BAND_UMBRELLAS`. The band
 * is the COMPUTED one of `backlog:triage`: the strongest Target among the
 * cards the gap reaches (`strongestCardBand`), so the umbrella is chosen by the
 * same rule that computes the band and the partition cannot drift from the
 * axis it partitions (issue #3851 decision 7). An open issue whose band is
 * recomputed MOVES to its new band's umbrella — up or down, the board follows
 * the Target List — except out of a `P0` umbrella, which is hand-set only.
 *
 * ── The ORIGIN band (issue #4158) ──────────────────────────────────────
 *
 * The computed band answers "which Target needs this gap?", not "which work
 * spawned it?". A gap born of P0 work (a Grammar Rule landing under a P0
 * umbrella) is P0 too — an umbrella closes only when its last child does, and
 * `effectivePriority` already says children inherit their parent's urgency
 * (issue #3212). A P0 umbrella is hand-set, so nothing computed can put a gap
 * there; the RUN can, because whoever launches it knows which band the work
 * belonged to: `gaps:sync --band P0` (and `land`, which derives the band from
 * the issue the landed branch names). Only `P0` acts — for every other value
 * the computed band stays the authority — and only on a gap this run CREATES
 * or one with no home (no parent, or a retired one): an existing issue is
 * never pulled up, and `planMove` never moves one back out of a P0 umbrella.
 *
 * A partitioned gap with NO computed band is residue: filed under its
 * family's P3 umbrella (`KIND_FALLBACK`, issue #4110), and an existing one
 * keeps its current parent — `gaps-sync.ts` lists it. The exception is a
 * parent in `RETIRED_UMBRELLAS` (issue #3972, the Op-gap pile this replaced,
 * and PRD #3820, the old fallback): a gap there moves to its fallback, so
 * neither holds computed gaps any more.
 *
 * The other kinds parent under their Target's set umbrella when there is one,
 * else their own P3 umbrella (`KIND_FALLBACK`). GitHub caps a parent at 100 sub-issues; a band holds a
 * bounded slice of the backlog, which is what keeps the cap unreachable, and
 * `syncGaps` still refuses up front, before any write, a run whose creates and
 * moves would push ANY parent past it.
 *
 * ── Idempotency ────────────────────────────────────────────────────────
 *
 * Every allowlist `ops` row was seeded pointing at PRD issue #3820
 * (`PRD_ISSUE`) until `gaps:sync` filed its own — that placeholder IS the
 * "unfiled" state (`data/grammar-gaps.json`'s own `note`). Every other kind is
 * unfiled while no `claims` row carries its `(kind, key)`. A filed gap's issue
 * is read back: CLOSED is left alone (a gap closes through its PR, ADR 0137),
 * OPEN gets its body rewritten only when the computed body differs, so a
 * second run against unchanged inputs writes nothing.
 *
 * A body may name its own issue number (the `hand-tail` kind prints the marker
 * line the closing PR must add), which no caller can know before the issue
 * exists — so a filing's body is a FUNCTION of the issue number, and a create
 * is followed by one patch when the two differ. Every later run compares
 * `body(currentIssue)`, so that patch happens exactly once per issue.
 */

import type { Allowlist } from "../check-gaps";
import { declaredSection } from "./declared-section";
import type { Band } from "./backlog-triage";
import type { Lockfile } from "./oracle-lockfile";
import {
    claimId,
    GAP_KINDS,
    quarantineClass,
    splitClaimId,
    type ClaimRow,
    type GapKind,
} from "./targets";

/** The placeholder every allowlist row was seeded with: "not filed yet". */
export const PRD_ISSUE = 3820;

/** The umbrella families the partition knows (issue #4056). */
export type UmbrellaFamily = "grammar-rules" | "ops" | "bot-gaps";

/** The kinds parented by band, and the family each one files under. A kind
 *  missing here keeps the set-umbrella / PRD parent. */
export const PARTITIONED_KINDS: Readonly<
    Partial<Record<GapKind, UmbrellaFamily>>
> = {
    grammar: "grammar-rules",
    mechanic: "ops",
    bot: "bot-gaps",
};

/** A band an umbrella holds — `P0` too, although no rule computes it. */
export type UmbrellaBand = "P0" | Band;

/**
 * One umbrella per (family, band). `P0` umbrellas are the owner's: nothing is
 * filed into one and nothing is moved out of one. The umbrella's board
 * `Priority` IS its band — set by hand once, at creation, and inherited by its
 * children (issue #3212).
 */
export const BAND_UMBRELLAS: Readonly<
    Record<UmbrellaFamily, Readonly<Record<UmbrellaBand, number>>>
> = {
    "grammar-rules": { P0: 4091, P1: 4092, P2: 4093, P3: 4094 },
    ops: { P0: 4095, P1: 4096, P2: 4097, P3: 4098 },
    "bot-gaps": { P0: 4099, P1: 4100, P2: 4101, P3: 4102 },
};

/**
 * The fallback parent of each kind — its LOWEST band (issue #4110): a gap the
 * rule cannot band is deliberately-later work, never the parent PRD's band.
 * A partitioned kind falls back to its family's P3 umbrella; a kind with no
 * family yet has one P3 umbrella of its own.
 */
export const KIND_FALLBACK: Readonly<Record<GapKind, number>> = {
    grammar: BAND_UMBRELLAS["grammar-rules"].P3,
    mechanic: BAND_UMBRELLAS.ops.P3,
    bot: BAND_UMBRELLAS["bot-gaps"].P3,
    scenario: 4111,
    migration: 4112,
    "hand-tail": 4113,
};

/**
 * Parents a gap is moved OFF, to its band umbrella or its fallback: issue
 * #3972 (the Op-gap pile the partition replaced) and PRD #3820, the old
 * fallback — it is closing, and a gap under it inherits its P0 band (issue
 * #3212), the opposite of what an unranked gap deserves (issue #4110).
 */
export const RETIRED_UMBRELLAS: ReadonlySet<number> = new Set([
    3972,
    PRD_ISSUE,
]);

/** The band `parent` stands for within `family`, or null when it is not one
 *  of that family's umbrellas. */
export function umbrellaBand(
    family: UmbrellaFamily,
    parent: number | null
): UmbrellaBand | null {
    if (parent === null) return null;
    for (const [band, n] of Object.entries(BAND_UMBRELLAS[family]))
        if (n === parent) return band as UmbrellaBand;
    return null;
}

/** GitHub's hard cap on sub-issues per parent. */
export const SUB_ISSUE_CAP = 100;

/** Labels per kind, the issue #3869 table — `ready-for-agent` on every one,
 *  because a computed gap is work an agent can pick up as filed. */
export const GAP_LABELS: Readonly<Record<GapKind, readonly string[]>> = {
    grammar: ["ready-for-agent", "area:mechanics"],
    mechanic: ["ready-for-agent", "area:mechanics"],
    scenario: ["ready-for-agent", "area:mechanics"],
    bot: ["ready-for-agent", "area:game-bot"],
    "hand-tail": ["ready-for-agent", "area:cards", "hand-tail"],
    migration: ["ready-for-agent", "area:cards", "migration"],
};

export const GRAMMAR_GAP_LABELS = GAP_LABELS.grammar;

/**
 * The title prefix of each kind — the search term `GhGapTracker` prefetches a
 * kind's filed issues by, and the reason two kinds never share a title shape.
 */
export const GAP_TITLE_PREFIX: Readonly<Record<GapKind, string>> = {
    grammar: "Grammar Gap:",
    mechanic: "Quarantine (mechanic):",
    scenario: "Quarantine (scenario):",
    bot: "Bot Gap:",
    "hand-tail": "Hand Tail:",
    migration: "Migration:",
};

/**
 * One issue `gaps:sync` will create or reconcile.
 *
 * `currentIssue` is `null` exactly when nothing has been filed for this
 * `(kind, key)` yet. `body` takes the issue's own number so a body may quote
 * it (module header).
 */
export interface GapFiling {
    readonly kind: GapKind;
    /** Stable within the kind — the key schemes are `GAP_KINDS`'s doc. */
    readonly key: string;
    readonly currentIssue: number | null;
    readonly title: string;
    readonly labels: readonly string[];
    /** The set code whose umbrella should parent this issue, or null. */
    readonly parentSetCode: string | null;
    /** The parent to use when `parentSetCode` names no live umbrella. */
    readonly fallbackParent: number;
    /**
     * The COMPUTED band of a partitioned kind (`withPartitionBands`): its band
     * umbrella wins over `parentSetCode` / `fallbackParent`. Absent or null =
     * not partitioned, or residue.
     */
    readonly band?: Band | null;
    readonly body: (issue: number) => string;
}

export function grammarGapTitle(key: string): string {
    return `${GAP_TITLE_PREFIX.grammar} ${key}`;
}

export function renderOpGapBody(op: string, key: string): string {
    return [
        `Op census gap (ADR 0105 § 7.3, ADR 0137): \`${op}\` is \`implemented\` in the Mechanics Registry, but no Compiled Definition emits it.`,
        "",
        `The work is the Grammar Rule that emits \`${op}\` — find the Oracle clause forms the hand-written cards using \`${op}\` express, and teach a slot or shared sub-grammar to lower them to it, with golden fixtures per form. Or retire the Op, if nothing should emit it.`,
        "",
        `No card count here: the compiler attributes a refused line to the slot that got furthest, never to an Op, so an Op gap has no corpus or per-Target figure of its own. Which clause forms matter most is \`bun run oracle:report --gaps\`'s question.`,
        "",
        `Closes when the rule lands: \`bun run check:gaps\` then forces the allowlist row (\`data/grammar-gaps.json\`, key \`${key}\`) out — the allowlist only shrinks.`,
        "",
        "Parent: the Grammar Rules umbrella of this gap's computed band — `gaps:sync` moves it when the band is recomputed (issue #4056).",
    ].join("\n");
}

/** One filing per allowlist row. */
export function buildGrammarGapFilings(allowlist: Allowlist): GapFiling[] {
    return allowlist.ops.map((row) => {
        const body = renderOpGapBody(row.op, row.key);
        return {
            kind: "grammar" as const,
            key: row.key,
            currentIssue: row.issue === PRD_ISSUE ? null : row.issue,
            title: grammarGapTitle(row.key),
            labels: GAP_LABELS.grammar,
            parentSetCode: null,
            fallbackParent: KIND_FALLBACK.grammar,
            body: () => body,
        };
    });
}

// ── Band partition — the cards each partitioned gap reaches (issue #4056) ─

/** The `grammar` key of an Op-census row names its Op after this prefix. */
const OP_KEY_PREFIX = "(op) › ";

/**
 * `claimId` → the oracle ids a partitioned gap REACHES — what its band is
 * computed over:
 *
 *   - `grammar` `(op) › <Op>` — the catalogue cards whose hand-written
 *     definition uses the Op (`opUsers`): the cards whose Oracle text needs the
 *     rule that emits it. The lockfile cannot say — no fragment is ever
 *     attributed to an Op, and no compiled row emits it by definition;
 *   - `mechanic` — the cards whose quarantine reasons map to the class
 *     (`quarantineClass`, the key the filer used);
 *   - `bot` — the cards carrying the key as their `CardRow.botGap` (a
 *     `played` row's stale key excluded).
 *
 * Every lockfile card, not only the ranked ones: the band asks which Target
 * the gap reaches at all, and `cardBandIndex` already ignores a card no
 * ranked Target holds.
 */
export function partitionCardIndex(
    lock: Pick<Lockfile, "cards">,
    opUsers: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const add = (id: string, oracleId: string): void => {
        let set = out.get(id);
        if (set === undefined) out.set(id, (set = new Set()));
        set.add(oracleId);
    };
    for (const row of lock.cards) {
        for (const reason of row.quarantineReasons ?? []) {
            const cls = quarantineClass(reason);
            if (cls.kind === "mechanic")
                add(claimId("mechanic", cls.key), row.oracleId);
        }
        // `botGapOf`'s pair check (`gap-kinds.ts`), re-stated rather than
        // imported — that module imports this one: a key with no verdict, or
        // a `played` row's stale key, is never filed, so it lends no band.
        if (
            row.botGap !== undefined &&
            row.botReach !== undefined &&
            row.botReach !== "played"
        )
            add(claimId("bot", row.botGap), row.oracleId);
    }
    for (const [op, ids] of opUsers)
        for (const id of ids)
            add(claimId("grammar", `${OP_KEY_PREFIX}${op}`), id);
    return out;
}

/**
 * Stamp each PARTITIONED filing with its computed band — `bandOf` is the
 * triage's cards source over the filing's reached cards. Every other filing
 * is returned unchanged.
 */
export function withPartitionBands(
    filings: readonly GapFiling[],
    bandOf: (filing: GapFiling) => Band | null
): GapFiling[] {
    return filings.map((filing) =>
        PARTITIONED_KINDS[filing.kind] === undefined
            ? filing
            : { ...filing, band: bandOf(filing) }
    );
}

// ── Tracker ──────────────────────────────────────────────────────────────

export interface TrackedIssue {
    readonly state: "OPEN" | "CLOSED";
    readonly body: string;
    /** The native parent, null when none — read with the issue, so deciding a
     *  move costs no call of its own. */
    readonly parent?: number | null;
}

/** One open issue of the tracker, as the orphan-card pass reads it. */
export interface TrackedIssueSummary {
    readonly number: number;
    readonly title: string;
    readonly labels: readonly string[];
}

export interface GapTracker {
    /** null when the issue does not exist. Anything else THROWS: read as null
     *  a transient failure would file a duplicate and orphan the real issue
     *  (issue #3974). */
    getIssue(number: number): TrackedIssue | null;
    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
        parent: number;
    }): number;
    updateBody(number: number, body: string): void;
    /** Re-parent `child` under `parent` — the partition's move (issue #4056). */
    setParent(child: number, parent: number): void;
    /** How many sub-issues `parent` holds right now. */
    subIssueCount(parent: number): number;
    /** The open, `prd`-labelled `[<CODE>] … set rollout` issue, or null. */
    findSetUmbrella(setCode: string): number | null;
    /** Every OPEN issue carrying `label`. */
    listOpen(label: string): readonly TrackedIssueSummary[];
    addLabel(number: number, label: string): void;
    comment(number: number, body: string): void;
    /** Every OPEN issue whose body may carry an `## Unlocks` section — the
     *  candidates {@link parseUnlocks} reads (issue #4052). */
    listUnlockSources(): readonly UnlockSource[];
    /** The issues `issue` is NATIVELY blocked by, right now. */
    blockedBy(issue: number): readonly number[];
    /** Wire the native `blocked by` edge, and confirm it by reading back —
     *  `gh issue edit --add-blocked-by` exits non-zero when SOME of the
     *  listed edges already exist, so its status says nothing either way. */
    addBlockedBy(issue: number, blocker: number): void;
}

export type GapSyncAction = {
    readonly action: "create" | "update" | "noop" | "skip-closed";
    readonly kind: GapKind;
    readonly key: string;
    readonly issue: number;
};

/** One re-parent the partition performed (issue #4056). */
export interface GapMove {
    readonly kind: GapKind;
    readonly key: string;
    readonly issue: number;
    readonly from: number | null;
    readonly to: number;
}

export interface GapSyncResult {
    readonly actions: readonly GapSyncAction[];
    readonly moves: readonly GapMove[];
    /** `claimId(kind, key)` → the issue number the allowlist must record. */
    readonly updatedRows: ReadonlyMap<string, number>;
}

/** The band umbrella `filing` belongs under, or null — not partitioned, or
 *  residue. */
export function bandUmbrellaOf(filing: GapFiling): number | null {
    const family = PARTITIONED_KINDS[filing.kind];
    if (
        family === undefined ||
        filing.band === undefined ||
        filing.band === null
    )
        return null;
    return BAND_UMBRELLAS[family][filing.band];
}

/**
 * The family's P0 umbrella when the run's origin band is `P0` and `filing`'s
 * kind is partitioned, else null (issue #4158). The ONE place the origin band
 * acts — see the header. Any other band, or no band, is a null.
 */
export function originUmbrellaOf(
    filing: GapFiling,
    originBand: UmbrellaBand | undefined
): number | null {
    if (originBand !== "P0") return null;
    const family = PARTITIONED_KINDS[filing.kind];
    return family === undefined ? null : BAND_UMBRELLAS[family].P0;
}

/** The parent to file `filing` under — the origin band's P0 umbrella, else its
 *  band umbrella, else its Target's set umbrella, else the kind's own
 *  fallback (`KIND_FALLBACK`). */
function parentOf(
    filing: GapFiling,
    tracker: GapTracker,
    originBand: UmbrellaBand | undefined
): number {
    const origin = originUmbrellaOf(filing, originBand);
    if (origin !== null) return origin;
    const umbrella = bandUmbrellaOf(filing);
    if (umbrella !== null) return umbrella;
    if (filing.parentSetCode === null) return filing.fallbackParent;
    return (
        tracker.findSetUmbrella(filing.parentSetCode) ?? filing.fallbackParent
    );
}

/**
 * Where an EXISTING open issue must move, or null (issue #4056):
 *
 *   - banded → its band umbrella, unless it is already there or sits in its
 *     family's hand-set `P0` umbrella;
 *   - residue (or an unpartitioned kind) → nowhere, unless it has no parent
 *     or its parent is a retired umbrella, in which case the kind's fallback
 *     (`KIND_FALLBACK`, its lowest band) — or, when the run's origin band is
 *     `P0`, its family's P0 umbrella (issue #4158): a homeless gap of P0 work
 *     is P0 work.
 */
export function planMove(
    filing: GapFiling,
    parent: number | null,
    originBand?: UmbrellaBand
): number | null {
    const homeless = parent === null || RETIRED_UMBRELLAS.has(parent);
    if (homeless) {
        const origin = originUmbrellaOf(filing, originBand);
        if (origin !== null) return origin;
    }
    const target = bandUmbrellaOf(filing);
    if (target === null) {
        // No parent at all is a create whose parent write failed — as much a
        // gap with nowhere to live as one under a retired umbrella.
        // A fallback is never retired (`KIND_FALLBACK`'s test), so this can
        // never move an issue onto the parent it already has.
        return homeless ? filing.fallbackParent : null;
    }
    if (parent === target) return null;
    if (umbrellaBand(PARTITIONED_KINDS[filing.kind]!, parent) === "P0")
        return null;
    return target;
}

/**
 * Create, update, move or leave alone — one decision per filing, entirely
 * through `tracker`. Reads every filed issue first and refuses, before any
 * write, a run whose creates and moves would push ANY parent past GitHub's
 * sub-issue cap: an issue created and then left unparented is the failure
 * this guards (issue #3974), and a run spans several parents, so the count is
 * per parent.
 *
 * `originBand` is the band of the work that triggered the run (issue #4158):
 * `P0` files every partitioned create, and every homeless gap, under its
 * family's P0 umbrella; anything else changes nothing.
 */
export function syncGaps(
    filings: readonly GapFiling[],
    tracker: GapTracker,
    originBand?: UmbrellaBand
): GapSyncResult {
    const existing = new Map<string, TrackedIssue | null>();
    for (const filing of filings) {
        if (filing.currentIssue !== null) {
            existing.set(
                claimId(filing.kind, filing.key),
                tracker.getIssue(filing.currentIssue)
            );
        }
    }
    const isCreate = (filing: GapFiling): boolean =>
        filing.currentIssue === null ||
        existing.get(claimId(filing.kind, filing.key)) === null;

    // Resolve each create's parent ONCE — `findSetUmbrella` is a network call
    // and the cap check and the create itself must agree on the answer.
    const parents = new Map<string, number>();
    const moveTo = new Map<string, number>();
    const incoming = new Map<number, number>();
    for (const filing of filings) {
        const id = claimId(filing.kind, filing.key);
        let parent: number | null;
        if (isCreate(filing)) {
            parent = parentOf(filing, tracker, originBand);
            parents.set(id, parent);
        } else {
            const current = existing.get(id)!;
            if (current.state === "CLOSED") continue;
            parent = planMove(filing, current.parent ?? null, originBand);
            if (parent === null) continue;
            moveTo.set(id, parent);
        }
        incoming.set(parent, (incoming.get(parent) ?? 0) + 1);
    }
    for (const [parent, n] of incoming) {
        const children = tracker.subIssueCount(parent);
        if (children + n > SUB_ISSUE_CAP) {
            throw new Error(
                `gaps:sync: issue #${parent} holds ${children} sub-issues; ${n} more would pass GitHub's cap of ${SUB_ISSUE_CAP} — nothing was filed`
            );
        }
    }

    const actions: GapSyncAction[] = [];
    const moves: GapMove[] = [];
    const updatedRows = new Map<string, number>();
    for (const filing of filings) {
        const id = claimId(filing.kind, filing.key);
        const common = { kind: filing.kind, key: filing.key };
        if (isCreate(filing)) {
            const issue = tracker.createIssue({
                title: filing.title,
                body: filing.body(0),
                labels: filing.labels,
                parent: parents.get(id)!,
            });
            // The body may quote the issue's own number, which only exists now.
            const settled = filing.body(issue);
            if (settled !== filing.body(0)) tracker.updateBody(issue, settled);
            updatedRows.set(id, issue);
            actions.push({ action: "create", ...common, issue });
            continue;
        }
        const issue = filing.currentIssue!;
        const current = existing.get(id)!;
        if (current.state === "CLOSED") {
            actions.push({ action: "skip-closed", ...common, issue });
            continue;
        }
        const to = moveTo.get(id);
        if (to !== undefined) {
            tracker.setParent(issue, to);
            moves.push({ ...common, issue, from: current.parent ?? null, to });
        }
        const body = filing.body(issue);
        if (current.body === body) {
            actions.push({ action: "noop", ...common, issue });
            continue;
        }
        tracker.updateBody(issue, body);
        actions.push({ action: "update", ...common, issue });
    }
    return { actions, moves, updatedRows };
}

/**
 * Apply a sync's `updatedRows` onto the allowlist document. A `grammar` row's
 * number goes on its `ops` row (the census's own shape, issue #3824); every
 * other kind takes a `claims` row. The shrink-only `ops` MEMBERSHIP
 * `check:gaps` guards is never touched — only an existing row's `issue`.
 *
 * Existing `claims` rows are KEPT, never pruned: a quarantine class that stops
 * appearing has an issue that is still open, and dropping its row would
 * re-file the same issue the day the class comes back. `gaps-sync.ts` reports
 * such a row instead, so a stale issue is visible rather than silent. Rows are
 * re-sorted by kind then key so two runs over one tree write one file.
 *
 * A no-op input returns the SAME object (reference equality), so a caller can
 * skip writing the file when nothing changed.
 */
export function applyUpdatedIssues(
    allowlist: Allowlist,
    updatedRows: ReadonlyMap<string, number>
): Allowlist {
    if (updatedRows.size === 0) return allowlist;
    const ops = allowlist.ops.map((row) => {
        const next = updatedRows.get(claimId("grammar", row.key));
        return next === undefined || next === row.issue
            ? row
            : { ...row, issue: next };
    });
    const claims = new Map<string, ClaimRow>(
        (allowlist.claims ?? []).map(
            (row) => [claimId(row.kind, row.key), row] as const
        )
    );
    for (const [id, issue] of updatedRows) {
        const { kind, key } = splitClaimId(id);
        if (kind === "grammar") continue;
        claims.set(id, { kind, key, issue });
    }
    const sorted = [...claims.values()].sort((a, b) =>
        a.kind !== b.kind
            ? a.kind < b.kind
                ? -1
                : 1
            : a.key < b.key
              ? -1
              : a.key > b.key
                ? 1
                : 0
    );
    return sorted.length === 0
        ? { ...allowlist, ops }
        : { ...allowlist, ops, claims: sorted };
}

// ── `## Unlocks` — the engine issue a gap is blocked by (issue #4052) ─────
//
// The dependency between an engine capability and the Grammar Gap it unblocks
// used to be body prose, and prose is not an edge: `queue:plan` defers a pick
// on the body's `## Blocked by` refs and the board draws the native
// relationship, so a gap whose rule cannot be written yet was picked, worked
// on, and found unbuildable after the worktree existed.
//
// So an ENGINE issue declares what it unlocks, in its own body, and the SCRIPT
// writes the edge — issue #3851 decision 2, "parents and blockers are written
// by the script, never by hand; 470 hand-maintained edges rot in a week". The
// declaration is a key, never a number: the gap's issue does not exist yet when
// the engine issue is filed, and the key does.
//
// Both forms of the edge are written, because they feed different readers and
// neither substitutes for the other (`/to-tickets`' own rule):
//
//   - the NATIVE edge, wired here, is what the board and the dependency graph
//     show — a body-only dependency reads as ready work to a human scanning it;
//   - the body's `## Blocked by` section, which is what `queue:plan` parses.
//
// The body section is composed INTO the filing's body (`withUnlockBlockers`)
// rather than patched on afterwards. `syncGaps` rewrites a body whenever it
// differs from the computed one, so a section appended after the fact would be
// stripped by the next run and re-appended by the one after it — a body edit
// per run, forever.

/** One issue whose body may declare an `## Unlocks` section. */
export interface UnlockSource {
    readonly number: number;
    readonly body: string;
}

/** A declared line that wired no edge — always REPORTED, never dropped: a
 *  typo in a gap key is only visible if the run says the key matched nothing. */
export interface UnlockResidue {
    readonly issue: number;
    /** The line as the body carries it. */
    readonly line: string;
    readonly reason: "unreadable" | "no-such-gap";
}

export type UnlockEdgeAction = {
    readonly action: "link" | "noop" | "skip-self";
    /** The gap issue — the blocked side. */
    readonly blocked: number;
    /** The engine issue — the blocker. */
    readonly blocker: number;
    readonly claim: string;
};

const UNLOCKS_HEADING = /^#{1,6}\s+unlocks\s*$/i;
/** A bare Op name — an identifier, which is exactly what prose is not. */
const OP_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
/** The separator a grammar gap key joins its slot and shape with. */
const GAP_KEY_SEPARATOR = " › ";
/** The `- #N — why` suffix this repo writes on every other ref list. */
const WHY_SUFFIX = " — ";

/**
 * The claim ids one `## Unlocks` line could mean, in resolution order.
 *
 * Three accepted forms, and NOTHING is inferred from prose — a line matching
 * none of them is refused by the caller rather than guessed at:
 *
 *   - `<kind>: <key>` — the general form, for any of the six kinds;
 *   - `<slot> › <shape>` — a bare Grammar Gap key, the kind being implied;
 *   - `<opName>` — a bare Op name, AUTO-FILLED to the `(op) › <name>` grammar
 *     key. This is the common case (an issue that adds an Op unblocks that
 *     Op's census gap) and it costs the author no lookup.
 *
 * A trailing ` — <why>` is tried as a second candidate, never as the first:
 * a quarantine key is a free-text compiler diagnostic and may contain an em
 * dash of its own, so the whole line is offered to the gap index before its
 * truncation is. Resolution is against FILED gaps, so neither candidate is a
 * guess — an unmatched line is residue.
 */
export function unlockCandidates(item: string): string[] {
    const forms = (text: string): string[] => {
        const t = text
            .trim()
            .replace(/^`(.*)`$/s, "$1")
            .trim();
        if (t === "") return [];
        const kinded = /^([a-z][a-z-]*):\s*(.+)$/.exec(t);
        if (
            kinded !== null &&
            (GAP_KINDS as readonly string[]).includes(kinded[1]!)
        ) {
            return [claimId(kinded[1] as GapKind, kinded[2]!.trim())];
        }
        if (t.includes(GAP_KEY_SEPARATOR)) return [claimId("grammar", t)];
        if (OP_NAME.test(t))
            return [claimId("grammar", `(op)${GAP_KEY_SEPARATOR}${t}`)];
        return [];
    };
    const whole = forms(item);
    // The LAST separator, not the first: the `— why` is a suffix, so splitting
    // at the first one truncates a key that carries an em dash of its own into
    // a prefix that matches nothing and loses the candidate that would have.
    const at = item.lastIndexOf(WHY_SUFFIX);
    const truncated = at === -1 ? [] : forms(item.slice(0, at));
    return [...whole, ...truncated.filter((c) => !whole.includes(c))];
}

/**
 * Read one body's `## Unlocks` section. Returns the candidate claim ids per
 * declared line plus the lines no form could read — `null` when the body has
 * no such section at all, which is not the same as one declaring nothing.
 * Fenced code is not markdown here — `declaredSection` owns that, and why.
 */
export function parseUnlocks(
    body: string
): { lines: { raw: string; candidates: string[] }[] } | null {
    const section = declaredSection(body, UNLOCKS_HEADING);
    if (section === null) return null;
    return {
        lines: section.map(({ raw, item }) => ({
            raw,
            candidates: item === null ? [] : unlockCandidates(item),
        })),
    };
}

/**
 * Resolve every declaration against the gaps this run actually knows —
 * `known` is the claim id of every FILING, not only of every filed issue, so
 * a gap created by this same run is matched too.
 *
 * `blockers` maps a claim id to the engine issues that unlock it, sorted and
 * deduplicated so two runs over one tree compose one body.
 */
export function planUnlockEdges(
    sources: readonly UnlockSource[],
    known: ReadonlySet<string>
): {
    blockers: Map<string, number[]>;
    residue: UnlockResidue[];
} {
    const blockers = new Map<string, Set<number>>();
    const residue: UnlockResidue[] = [];
    for (const source of sources) {
        const parsed = parseUnlocks(source.body);
        if (parsed === null) continue;
        for (const line of parsed.lines) {
            if (line.candidates.length === 0) {
                residue.push({
                    issue: source.number,
                    line: line.raw,
                    reason: "unreadable",
                });
                continue;
            }
            const hit = line.candidates.find((c) => known.has(c));
            if (hit === undefined) {
                residue.push({
                    issue: source.number,
                    line: line.raw,
                    reason: "no-such-gap",
                });
                continue;
            }
            let set = blockers.get(hit);
            if (set === undefined) blockers.set(hit, (set = new Set()));
            set.add(source.number);
        }
    }
    return {
        blockers: new Map(
            [...blockers].map(([claim, set]) => [
                claim,
                [...set].sort((a, b) => a - b),
            ])
        ),
        residue,
    };
}

/** The body section `queue:plan` parses — the prose half of the edge. */
export function renderUnlockBlockedBy(issues: readonly number[]): string {
    return [
        "## Blocked by",
        "",
        ...issues.map(
            (n) =>
                `- #${n} — the engine issue that unblocks this gap, wired by \`gaps:sync\`.`
        ),
    ].join("\n");
}

/**
 * Compose each filing's `## Blocked by` section into its body. A filing
 * nothing unlocks is returned UNCHANGED (reference equality), so the
 * idempotent-noop decision of `syncGaps` is untouched for every other gap.
 */
export function withUnlockBlockers(
    filings: readonly GapFiling[],
    blockers: ReadonlyMap<string, readonly number[]>
): GapFiling[] {
    return filings.map((filing) => {
        const issues = blockers.get(claimId(filing.kind, filing.key));
        if (issues === undefined || issues.length === 0) return filing;
        const section = renderUnlockBlockedBy(issues);
        const inner = filing.body;
        return { ...filing, body: (issue) => `${inner(issue)}\n\n${section}` };
    });
}

/**
 * Wire the native edge for every resolved declaration, once. `issueOf` is the
 * gap issue per claim id AFTER `syncGaps` — a gap created this run included.
 *
 * Reads the existing edges back before writing: the tracker's `addBlockedBy`
 * is the only write, and an edge already there is a `noop`, which is what
 * makes a second run against unchanged inputs write nothing.
 *
 * ADD-ONLY, deliberately. A retracted declaration recomputes its `## Blocked
 * by` section away on the next run, but the native edge stays: dropping it
 * would mean reading every gap issue's edges back each run to find the ones
 * nobody declares any more, and then deleting edges this pass did not write —
 * a human's `blocked by` on a gap issue is not this script's to remove.
 * Retracting an edge is `gh issue edit <gap> --remove-blocked-by <engine>`, by
 * hand. Closing the engine issue needs nothing: GitHub renders a closed
 * blocker as satisfied.
 */
export function syncUnlockEdges(
    blockers: ReadonlyMap<string, readonly number[]>,
    issueOf: ReadonlyMap<string, number>,
    tracker: GapTracker
): UnlockEdgeAction[] {
    const actions: UnlockEdgeAction[] = [];
    for (const [claim, engineIssues] of blockers) {
        const blocked = issueOf.get(claim);
        if (blocked === undefined) continue;
        const existing = new Set(tracker.blockedBy(blocked));
        for (const blocker of engineIssues) {
            // An issue cannot block itself, and GitHub refuses the edge —
            // but it is reachable: an engine issue may declare a gap whose own
            // issue is itself after a key is reused. REPORTED, never silently
            // dropped: a declaration that wires nothing and prints nothing is
            // the failure mode the residue pass exists to close.
            if (blocker === blocked) {
                actions.push({ action: "skip-self", blocked, blocker, claim });
                continue;
            }
            if (existing.has(blocker)) {
                actions.push({ action: "noop", blocked, blocker, claim });
                continue;
            }
            tracker.addBlockedBy(blocked, blocker);
            actions.push({ action: "link", blocked, blocker, claim });
        }
    }
    return actions;
}
