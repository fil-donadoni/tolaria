/**
 * `gaps:sync`'s six kinds (issue #3869) — a SYNTHETIC lockfile, a synthetic
 * registry of FORMAT Targets (they resolve off `poolIn`, so no file is read)
 * and a STUB tracker, so every count below is derivable by hand and no test
 * here touches the network or the committed corpus.
 *
 * `gap-issues.test.ts` owns the `grammar` kind and the create / update /
 * idempotent-noop / closed-stays-closed decision; this file owns the five
 * kinds built on top of it and the orphan-card pass.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    cardBandIndex,
    strongestCardBand,
    type Band,
} from "../lib/backlog-triage";
import {
    GAP_LABELS,
    applyUpdatedIssues,
    BAND_UMBRELLAS,
    KIND_FALLBACK,
    buildGrammarGapFilings,
    originUmbrellaOf,
    partitionCardIndex,
    PRD_ISSUE,
    planUnlockEdges,
    RETIRED_UMBRELLAS,
    SUB_ISSUE_CAP,
    withPartitionBands,
    syncGaps,
    syncUnlockEdges,
    withUnlockBlockers,
    type GapFiling,
    type GapTracker,
    type TrackedIssue,
    type TrackedIssueSummary,
    type UnlockSource,
} from "../lib/gap-issues";
import {
    botCauseOf,
    buildBotGapFilings,
    buildFragmentGapFilings,
    buildHandTailFilings,
    enforcedCardIds,
    buildMigrationFilings,
    buildQuarantineFilings,
    cardsNamedByTitle,
    inScopeBotGapKeys,
    orphanCardActions,
    prioritySlices,
    unlockingRule,
    type Graduate,
    type KindInputs,
} from "../lib/gap-kinds";
import { parseOriginBand, staleClaims } from "../gaps-sync";
import { botGapKey, type BotGapVerdict } from "../lib/oracle-bot-reach";
import type { CardRow, FragmentRow, Lockfile } from "../lib/oracle-lockfile";
import {
    claimId,
    coverageVerdict,
    GAP_KINDS,
    gapIndex,
    parseClaims,
    resolveContext,
    resolveTarget,
    type TargetRegistry,
} from "../lib/targets";

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Two priority Targets, both formats — resolved from `poolIn`, no disk. */
const REGISTRY: TargetRegistry = {
    handTailFloor: 3,
    handTailFiling: false,
    targets: [
        {
            id: "format-premodern",
            kind: "format",
            source: "premodern",
            priority: 1,
        },
        {
            id: "format-vintage",
            kind: "format",
            source: "vintage",
            priority: 2,
        },
    ],
};

function fragment(text: string): FragmentRow {
    return { text, reason: "no slot consumed the line", cards: 1 };
}

/** `refuses`-by-construction: N unparsed cards sharing one fragment index. */
function unparsed(
    oracleId: string,
    name: string,
    gaps: number[],
    poolIn?: CardRow["poolIn"]
): CardRow {
    return {
        oracleId,
        name,
        state: "unparsed",
        gaps,
        ...(poolIn === undefined ? {} : { poolIn }),
    };
}

/**
 * Two inert `ready` cards, one per priority Target: `resolveTarget` throws on
 * a Target that resolves to NO cards (a denominator that could shrink silently
 * is the whole point of the registry's fail-closed reader), and a `ready` row
 * counts for no gap and no quarantine class, so every figure below is still
 * derivable by hand.
 */
const FILLER: CardRow[] = [
    {
        oracleId: "f-1",
        name: "Filler Premodern",
        state: "ready",
        opsUsed: [],
        poolIn: ["premodern"],
    },
    {
        oracleId: "f-2",
        name: "Filler Vintage",
        state: "ready",
        opsUsed: [],
        poolIn: ["vintage"],
    },
];

function quarantined(
    oracleId: string,
    name: string,
    reasons: { kind: string; detail: string }[],
    poolIn?: CardRow["poolIn"]
): CardRow {
    return {
        oracleId,
        name,
        state: "quarantine",
        opsUsed: [],
        quarantineReasons: reasons as CardRow["quarantineReasons"],
        ...(poolIn === undefined ? {} : { poolIn }),
    };
}

/**
 * The gap keys here are `(no slot) › <shape>` — `gapOf` on an unattributed
 * fragment whose reason is the router's. Written out so a test can assert a
 * key without re-deriving it.
 */
const NARROW_GAP = "(no slot) › a one-off line";

function inputs(
    lock: Pick<Lockfile, "cards" | "fragments">,
    over: Partial<KindInputs> = {},
    registry: TargetRegistry = REGISTRY
): KindInputs {
    const ctx = resolveContext("/tmp/gaps-sync-no-such-root", lock);
    const slices = prioritySlices(registry, ctx);
    return {
        lock,
        slices,
        ranked: new Set(slices.flatMap((slice) => [...slice.ids])),
        filed: new Map(),
        floor: registry.handTailFloor,
        handTailFiling: registry.handTailFiling,
        enforced: new Set(slices.flatMap((slice) => [...slice.ids])),
        handTail: new Set(),
        ...gapIndex(lock),
        ...over,
    };
}

class StubTracker implements GapTracker {
    private next = 5000;
    readonly issues = new Map<number, TrackedIssue>();
    readonly created: Array<{
        title: string;
        labels: readonly string[];
        parent: number;
    }> = [];
    readonly umbrellas = new Map<string, number>();
    /** Native parent per issue — written by a create and by `setParent`. */
    readonly parents = new Map<number, number>();
    readonly moves: Array<{ child: number; parent: number }> = [];
    /** Sub-issues per parent BEFORE this run, for the cap. */
    readonly childCounts = new Map<number, number>();
    open: TrackedIssueSummary[] = [];
    readonly added: Array<{ issue: number; label: string }> = [];
    readonly comments: Array<{ issue: number; body: string }> = [];
    updateCalls = 0;

    getIssue(number: number): TrackedIssue | null {
        const issue = this.issues.get(number);
        if (issue === undefined) return null;
        const parent = this.parents.get(number);
        return parent === undefined ? issue : { ...issue, parent };
    }

    setParent(child: number, parent: number): void {
        this.moves.push({ child, parent });
        this.parents.set(child, parent);
    }

    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
        parent: number;
    }): number {
        this.created.push({
            title: input.title,
            labels: input.labels,
            parent: input.parent,
        });
        const number = this.next++;
        this.issues.set(number, { state: "OPEN", body: input.body });
        this.parents.set(number, input.parent);
        return number;
    }

    updateBody(number: number, body: string): void {
        this.updateCalls += 1;
        this.issues.set(number, { state: "OPEN", body });
    }

    findSetUmbrella(setCode: string): number | null {
        return this.umbrellas.get(setCode) ?? null;
    }

    /** 0 unless a test seeds `childCounts` — far below `SUB_ISSUE_CAP`, so
     *  the cap refusal fires only where a test asks for it. */
    subIssueCount(parent: number): number {
        return this.childCounts.get(parent) ?? 0;
    }

    listOpen(): readonly TrackedIssueSummary[] {
        return this.open;
    }

    addLabel(number: number, label: string): void {
        this.added.push({ issue: number, label });
    }

    comment(number: number, body: string): void {
        this.comments.push({ issue: number, body });
    }

    /** The `## Unlocks` pass has its own file (`gap-issues.test.ts`); here the
     *  tracker only has to satisfy the seam. */
    listUnlockSources(): readonly UnlockSource[] {
        return [];
    }

    blockedBy(): readonly number[] {
        return [];
    }

    addBlockedBy(): void {}
}

/** Sync `filings`, then sync the SAME filings with their new issue numbers —
 *  the second pass is what "a second run changes nothing" means. */
function syncTwice(
    filings: readonly GapFiling[],
    tracker = new StubTracker()
): { tracker: StubTracker; second: ReturnType<typeof syncGaps> } {
    const first = syncGaps(filings, tracker);
    const filed = new Map(
        first.actions.map((a) => [claimId(a.kind, a.key), a.issue] as const)
    );
    const second = syncGaps(
        filings.map((f) => ({
            ...f,
            currentIssue: filed.get(claimId(f.kind, f.key)) ?? f.currentIssue,
        })),
        tracker
    );
    return { tracker, second };
}

// ── mechanic / scenario ─────────────────────────────────────────────────

const CHANGELING = {
    kind: "planned-mechanic",
    detail: 'Woodland Changeling (aaaaaaaa-0000-4000-8000-000000000001): keyword "changeling" is not implemented in the Mechanics Registry',
};
const SMOKE = {
    kind: "smoke-scenario",
    detail: 'Onulet (aaaaaaaa-0000-4000-8000-000000000002): Op "moveZone" changes zones on an object the canned generator does not model',
};

describe("the mechanic and scenario kinds — one issue per quarantine class", () => {
    const lock = {
        fragments: [],
        cards: [
            quarantined(
                "q-1",
                "Woodland Changeling",
                [CHANGELING],
                ["premodern"]
            ),
            quarantined("q-2", "Changeling Titan", [CHANGELING]),
            quarantined("q-3", "Onulet", [SMOKE], ["premodern", "vintage"]),
            ...FILLER,
        ],
    };

    it("files a mechanic class with area:mechanics, the per-Target body and both measures named", () => {
        const filings = buildQuarantineFilings(inputs(lock), "mechanic");
        expect(filings).toHaveLength(1);
        const filing = filings[0]!;
        expect(filing.kind).toBe("mechanic");
        expect(filing.key).toBe(
            'planned-mechanic › keyword "changeling" is not implemented in the Mechanics Registry'
        );
        expect(filing.labels).toEqual([
            "ready-for-agent",
            "enhancement",
            "area:mechanics",
        ]);
        const body = filing.body(7001);
        // Two cards carry the class; only one of them is in the premodern pool.
        expect(body).toContain("- format-premodern (format, priority 1): 1");
        expect(body).toContain("- format-vintage (format, priority 2): 0");
        expect(body).toContain("- corpus: 2");
        expect(body).toContain("measure: cards held by this class");
        expect(body).toContain("Woodland Changeling");
        expect(body).toContain("Rank 1 of 1 in kind `mechanic`");
    });

    it("files a scenario class separately, under area:mechanics too", () => {
        const filings = buildQuarantineFilings(inputs(lock), "scenario");
        expect(filings.map((f) => f.key)).toEqual([
            'smoke-scenario › Op "moveZone" changes zones on an object the canned generator does not model',
        ]);
        expect(filings[0]!.kind).toBe("scenario");
        expect(filings[0]!.body(1).includes("smoke-skip class")).toBe(true);
    });

    it("a class already carrying a claim reconciles that issue instead of creating a second", () => {
        const key =
            'planned-mechanic › keyword "changeling" is not implemented in the Mechanics Registry';
        const filings = buildQuarantineFilings(
            inputs(lock, {
                filed: new Map([[claimId("mechanic", key), 4242]]),
            }),
            "mechanic"
        );
        expect(filings[0]!.currentIssue).toBe(4242);
    });

    it("a second run against the tracker it just wrote to creates nothing and edits nothing", () => {
        const { tracker, second } = syncTwice(
            buildQuarantineFilings(inputs(lock), "mechanic")
        );
        expect(tracker.created).toHaveLength(1);
        expect(second.actions.map((a) => a.action)).toEqual(["noop"]);
        expect(second.updatedRows.size).toBe(0);
        expect(tracker.updateCalls).toBe(0);
    });

    it("a class that disappears from the lockfile closes nothing — it is simply no longer filed", () => {
        const tracker = new StubTracker();
        syncGaps(buildQuarantineFilings(inputs(lock), "mechanic"), tracker);
        // The keyword landed: the same cards compile, the class is gone.
        const gone = {
            fragments: [],
            cards: lock.cards.map((card) =>
                card.state === "quarantine"
                    ? {
                          ...card,
                          state: "ready" as const,
                          quarantineReasons: [],
                      }
                    : card
            ),
        };
        const after = syncGaps(
            buildQuarantineFilings(inputs(gone), "mechanic"),
            tracker
        );
        expect(after.actions).toEqual([]);
        expect(tracker.getIssue(5000)).toMatchObject({
            state: "OPEN",
            body: expect.stringContaining("changeling"),
        });
    });
});

// ── bot ─────────────────────────────────────────────────────────────────

/** A `ready` card the sweep saw the Bot not play, under `key`. */
function botRow(
    oracleId: string,
    name: string,
    key: string,
    poolIn?: CardRow["poolIn"],
    botReach: "ignored" | "frozen" = "ignored"
): CardRow {
    return {
        oracleId,
        name,
        state: botReach === "frozen" ? "quarantine" : "ready",
        opsUsed: [],
        botReach,
        botGap: key,
        ...(botReach === "frozen"
            ? {
                  quarantineReasons: [
                      { kind: "bot-unreachable", detail: key },
                  ] as CardRow["quarantineReasons"],
              }
            : {}),
        ...(poolIn === undefined ? {} : { poolIn }),
    };
}

const NEVER_CHOSEN = "never-chosen › Enchantment › destroy";
const UNMODELLED = "position-unmodelled › Instant target:spell";
const UNRANKED = "never-chosen › Creature › (no Ops)";

describe("the bot kind — one issue per Bot Gap key, scoped to the ranked Targets (issue #4061)", () => {
    const lock = {
        fragments: [],
        cards: [
            botRow("b-1", "Aura of Doom", NEVER_CHOSEN, ["premodern"]),
            botRow("b-2", "Doom Aura", NEVER_CHOSEN),
            botRow("b-3", "Counterspell Variant", UNMODELLED, ["vintage"]),
            // Carried by NO ranked card: measured, not filed.
            botRow("b-4", "Grizzly Unranked", UNRANKED),
            // `played` rows carry no key; a stale one must not file a gap.
            {
                oracleId: "b-5",
                name: "Played Card",
                state: "ready" as const,
                opsUsed: [],
                botReach: "played" as const,
                botGap: UNRANKED,
                poolIn: ["premodern" as const],
            },
            ...FILLER,
        ],
    };

    it("files an in-scope key with the Bot Gap title, GAP_LABELS.bot, a rank line and a per-Target block", () => {
        const filings = buildBotGapFilings(inputs(lock));
        expect(filings.map((f) => f.key)).toEqual([NEVER_CHOSEN, UNMODELLED]);
        const filing = filings[0]!;
        expect(filing.kind).toBe("bot");
        expect(filing.title).toBe(`Bot Gap: ${NEVER_CHOSEN}`);
        expect(filing.labels).toEqual([
            "ready-for-agent",
            "enhancement",
            "area:game-bot",
        ]);
        expect(filing.fallbackParent).toBe(KIND_FALLBACK.bot);
        const body = filing.body(7001);
        expect(body.split("\n")[0]).toBe(
            "Rank 1 of 2 in kind `bot` — lexicographic on the priority Targets, corpus as tie-break (issue #3869)."
        );
        // Two cards carry the key; only one is in the premodern pool.
        expect(body).toContain(
            "Per registered Target, priority order (measure: cards the Bot does not play):"
        );
        expect(body).toContain("- format-premodern (format, priority 1): 1");
        expect(body).toContain("- format-vintage (format, priority 2): 0");
        expect(body).toContain("- corpus: 2");
        expect(body).toContain("Cards held (2): Aura of Doom, Doom Aura");
        expect(body).toContain("**A card the search never picks.**");
        expect(body).toContain("Outcome: `ignored`");
    });

    it("reads the cause back out of `botGapKey`'s own output, for every cause", () => {
        const causes = [
            "no-legal-move",
            "position-unmodelled",
            "unanswerable-input",
            "no-progress",
            "harness-error",
            "never-chosen",
        ] as const;
        for (const cause of causes) {
            const key = botGapKey(
                { outcome: "ignored", cause, form: "Sorcery" },
                ["draw"]
            )!;
            expect(botCauseOf(key)).toBe(cause);
        }
    });

    it("says what each cause MEANS — the text differs, the filing rule does not", () => {
        const [, unmodelled] = buildBotGapFilings(inputs(lock));
        expect(unmodelled!.body(1)).toContain(
            "**A gap in the sweep's harness, not in the Bot's judgement.**"
        );
    });

    it("never files a key no ranked card carries, nor a `played` row's stale key", () => {
        const keys = buildBotGapFilings(inputs(lock)).map((f) => f.key);
        expect(keys).not.toContain(UNRANKED);
        expect(inScopeBotGapKeys(lock.cards, inputs(lock).ranked)).toEqual([
            NEVER_CHOSEN,
            UNMODELLED,
        ]);
    });

    it("files once — a second run against the tracker it wrote to creates and edits nothing", () => {
        const { tracker, second } = syncTwice(buildBotGapFilings(inputs(lock)));
        expect(tracker.created.map((c) => c.title)).toEqual([
            `Bot Gap: ${NEVER_CHOSEN}`,
            `Bot Gap: ${UNMODELLED}`,
        ]);
        expect(second.actions.map((a) => a.action)).toEqual(["noop", "noop"]);
        expect(second.updatedRows.size).toBe(0);
        expect(tracker.updateCalls).toBe(0);
    });

    it("writes the issue number back as a `claims` row of kind `bot`", () => {
        const tracker = new StubTracker();
        const result = syncGaps(buildBotGapFilings(inputs(lock)), tracker);
        const doc = applyUpdatedIssues({ ops: [] }, result.updatedRows);
        expect(doc.claims).toEqual([
            { kind: "bot", key: NEVER_CHOSEN, issue: 5000 },
            { kind: "bot", key: UNMODELLED, issue: 5001 },
        ]);
    });

    it("a claimed key reconciles its issue, and is rewritten only when its body differs", () => {
        const tracker = new StubTracker();
        const first = syncGaps(buildBotGapFilings(inputs(lock)), tracker);
        const filed = new Map(
            [...first.updatedRows].map(([id, n]) => [id, n] as const)
        );
        const again = buildBotGapFilings(inputs(lock, { filed }));
        expect(again[0]!.currentIssue).toBe(5000);
        expect(syncGaps(again, tracker).actions.map((a) => a.action)).toEqual([
            "noop",
            "noop",
        ]);
        // A third card joins the key: its body changes, so it is rewritten.
        const grown = {
            ...lock,
            cards: [
                ...lock.cards,
                botRow("b-6", "Third Aura", NEVER_CHOSEN, ["premodern"]),
            ],
        };
        const actions = syncGaps(
            buildBotGapFilings(inputs(grown, { filed })),
            tracker
        ).actions;
        expect(actions.map((a) => `${a.action}:${a.issue}`)).toEqual([
            "update:5000",
            "noop:5001",
        ]);
    });

    it("a frozen key says the cards are withheld — its claim is the Coverage Invariant's", () => {
        const frozen = {
            fragments: [],
            cards: [
                botRow(
                    "z-1",
                    "Frozen Card",
                    "no-legal-move › Artifact",
                    ["premodern"],
                    "frozen"
                ),
                ...FILLER,
            ],
        };
        const [filing] = buildBotGapFilings(inputs(frozen));
        expect(filing!.key).toBe("no-legal-move › Artifact");
        expect(filing!.body(1)).toContain("Outcome: `frozen`");
        // …and the scenario filer no longer claims it: one kind, one filer.
        expect(buildQuarantineFilings(inputs(frozen), "scenario")).toEqual([]);
    });

    it("an engine issue declaring `bot: <key>` in `## Unlocks` gets the native blocked-by edge", () => {
        const filings = buildBotGapFilings(inputs(lock));
        const known = new Set(filings.map((f) => claimId(f.kind, f.key)));
        const { blockers, residue } = planUnlockEdges(
            [
                {
                    number: 4200,
                    body: `## Unlocks\n\n- bot: ${NEVER_CHOSEN} — values destroy on enchantments`,
                },
            ],
            known
        );
        expect(residue).toEqual([]);
        const tracker = new StubTracker();
        const edges = new Map<number, number[]>();
        tracker.blockedBy = (issue: number) => edges.get(issue) ?? [];
        tracker.addBlockedBy = (issue: number, blocker: number) => {
            edges.set(issue, [...(edges.get(issue) ?? []), blocker]);
        };
        const synced = syncGaps(withUnlockBlockers(filings, blockers), tracker);
        const issue = synced.updatedRows.get(claimId("bot", NEVER_CHOSEN))!;
        expect(tracker.issues.get(issue)!.body).toContain(
            "## Blocked by\n\n- #4200"
        );
        expect(syncUnlockEdges(blockers, synced.updatedRows, tracker)).toEqual([
            {
                action: "link",
                blocked: issue,
                blocker: 4200,
                claim: claimId("bot", NEVER_CHOSEN),
            },
        ]);
        expect(edges.get(issue)).toEqual([4200]);
    });

    it("a class found ONLY on a hand-written card (issue #4406) — no lockfile `botReach` at all — is filed too", () => {
        // `b-7` never compiled `ready` and carries no `botReach`: the
        // lockfile's own sweep never played it. The Findings report is the
        // ONLY source that measured it — the definition it actually ships.
        const handWrittenOnly: CardRow = {
            oracleId: "b-7",
            name: "Hand-Written Aura",
            state: "unparsed",
            poolIn: ["premodern"],
        };
        const key = "never-chosen › Enchantment › choice";
        const botFindings = new Map<string, BotGapVerdict>([
            ["b-7", { outcome: "ignored", gap: key }],
        ]);
        const withHandWritten = {
            ...lock,
            cards: [...lock.cards, handWrittenOnly],
        };
        const withoutMerge = buildBotGapFilings(inputs(withHandWritten));
        expect(withoutMerge.map((f) => f.key)).not.toContain(key);

        const withMerge = buildBotGapFilings(
            inputs(withHandWritten, { botFindings })
        );
        const filing = withMerge.find((f) => f.key === key);
        expect(filing).toBeDefined();
        expect(filing!.body(1)).toContain("Hand-Written Aura");
        // Every OTHER key, filed off the lockfile alone, is unaffected.
        expect(withMerge.map((f) => f.key)).toEqual(
            expect.arrayContaining([NEVER_CHOSEN, UNMODELLED])
        );
        // Idempotent, like every other kind: a second run against the
        // tracker it wrote to creates and edits nothing.
        const { second } = syncTwice(withMerge);
        expect(second.actions.map((a) => a.action)).toEqual(
            withMerge.map(() => "noop")
        );
    });
});

// ── hand-tail ───────────────────────────────────────────────────────────

describe("the hand-tail kind — one issue per CARD, gated by handTailFiling", () => {
    // The widespread gap refuses EXACTLY three cards — the floor itself, so a
    // `>` where the rule says `>=` flips all three into the hand tail — and
    // NARROW_GAP two, below it.
    const lock = {
        fragments: [fragment("a widespread line"), fragment("a one-off line")],
        cards: [
            unparsed("w-1", "Wide One", [0], ["premodern"]),
            unparsed("w-2", "Wide Two", [0], ["premodern"]),
            unparsed("t-1", "Tail Card", [1], ["premodern", "vintage"]),
            unparsed("m-1", "Mixed Card", [0, 1], ["premodern"]),
            ...FILLER,
        ],
    };

    it("files nothing while `handTailFiling` is false, and reports the card as held", () => {
        const { filings, held } = buildHandTailFilings(inputs(lock));
        expect(filings).toEqual([]);
        expect(held.map((f) => f.key)).toEqual(["Tail Card"]);
    });

    it("files exactly the below-floor card once the flag is true — a mixed card stays the grammar kind's", () => {
        const { filings, held } = buildHandTailFilings(
            inputs(lock, { handTailFiling: true })
        );
        expect(held).toEqual([]);
        expect(filings.map((f) => f.key)).toEqual(["Tail Card"]);
        // "Mixed Card" carries the widespread gap too (leverage 3 ≥ floor 3):
        // it is `gap-pending`, not Hand Tail (issue #3868).
        expect(filings.map((f) => f.key)).not.toContain("Mixed Card");
        expect(filings[0]!.labels).toEqual([
            "ready-for-agent",
            "enhancement",
            "area:cards",
            "hand-tail",
        ]);
    });

    it("names the fragment, the below-floor gap with its leverage, and the exact marker line the closing PR must add", () => {
        const { filings } = buildHandTailFilings(
            inputs(lock, { handTailFiling: true })
        );
        const body = filings[0]!.body(4321);
        expect(body).toContain("`a one-off line`");
        // NARROW_GAP refuses Tail Card and Mixed Card: leverage 2, below the
        // floor of 3.
        expect(body).toContain(
            `gap \`${NARROW_GAP}\` — leverage 2 corpus cards`
        );
        expect(body).toContain("// hand-tail: a one-off line (#4321)");
        expect(body).toContain("- format-premodern (format, priority 1): 1");
    });

    it("the marker line quotes the issue's OWN number — the create is followed by exactly one patch", () => {
        const { filings } = buildHandTailFilings(
            inputs(lock, { handTailFiling: true })
        );
        const tracker = new StubTracker();
        const result = syncGaps(filings, tracker);
        const issue = result.actions[0]!.issue;
        expect(tracker.getIssue(issue)!.body).toContain(
            `// hand-tail: a one-off line (#${issue})`
        );
        expect(tracker.updateCalls).toBe(1);
        // …and the NEXT run sees the settled body, so it patches nothing.
        const second = syncGaps(
            filings.map((f) => ({ ...f, currentIssue: issue })),
            tracker
        );
        expect(second.actions.map((a) => a.action)).toEqual(["noop"]);
        expect(tracker.updateCalls).toBe(1);
    });

    it("a card already carrying a `hand-tail:` marker is settled and never filed again", () => {
        const { filings, held } = buildHandTailFilings(
            inputs(lock, {
                handTailFiling: true,
                handTail: new Set(["t-1"]),
            })
        );
        expect(filings).toEqual([]);
        expect(held).toEqual([]);
    });

    it("a card no PRIORITY Target ranks is never filed — nobody's ranked objective needs it", () => {
        const orphanLock = {
            fragments: [...lock.fragments, fragment("an orphan's own line")],
            cards: [...lock.cards, unparsed("x-1", "Orphan Card", [2])],
        };
        const { filings } = buildHandTailFilings(
            inputs(orphanLock, { handTailFiling: true })
        );
        expect(filings.map((f) => f.key)).toEqual(["Tail Card"]);
    });

    it("files only cards inside an enforced Target — a ranked card outside it is held, and the flag stays true (issue #4219)", () => {
        const scoped = new Set(["t-1"]);
        const both = {
            fragments: [fragment("a one-off line")],
            cards: [
                unparsed("t-1", "Scoped Tail", [0], ["premodern"]),
                unparsed("t-2", "Ranked Tail", [0], ["premodern"]),
                ...FILLER,
            ],
        };
        const { filings, held } = buildHandTailFilings(
            inputs(both, { handTailFiling: true, enforced: scoped })
        );
        expect(filings.map((f) => f.key)).toEqual(["Scoped Tail"]);
        expect(held.map((f) => f.key)).toEqual(["Ranked Tail"]);
        expect(filings[0]!.body(1)).toContain("Rank 1 of 1 in kind");
    });

    it("with the flag false every ranked below-floor card is held, scope or not", () => {
        const both = {
            fragments: [fragment("a one-off line")],
            cards: [
                unparsed("t-1", "Scoped Tail", [0], ["premodern"]),
                unparsed("t-2", "Ranked Tail", [0], ["premodern"]),
                ...FILLER,
            ],
        };
        const { filings, held } = buildHandTailFilings(
            inputs(both, { enforced: new Set(["t-1"]) })
        );
        expect(filings).toEqual([]);
        expect(held.map((f) => f.key).sort()).toEqual([
            "Ranked Tail",
            "Scoped Tail",
        ]);
    });

    it("a hand-written card whose compiler-gap names a gap that has fallen below the floor lands here", () => {
        // The widespread gap refuses only this card once its siblings compile:
        // leverage 1 < floor 3, and no `hand-tail:` marker vouches for it.
        const fallen = {
            fragments: [fragment("a widespread line")],
            cards: [unparsed("w-1", "Wide One", [0], ["premodern"]), ...FILLER],
        };
        const { filings } = buildHandTailFilings(
            inputs(fallen, { handTailFiling: true })
        );
        expect(filings.map((f) => f.key)).toEqual(["Wide One"]);
        expect(filings[0]!.body(9)).toContain(
            "`compiler-gap:` here instead would claim the grammar still owes the rule"
        );
    });
});

// ── migration ───────────────────────────────────────────────────────────

function graduate(
    name: string,
    slots: string[],
    over: Partial<Graduate> = {}
): Graduate {
    return {
        oracleId: `g-${name}`,
        name,
        module: "convex/cards/sets/lea/white.ts",
        tests: [],
        slots,
        ...over,
    };
}

describe("the migration kind — graduates cluster by the rule that unlocked them", () => {
    const lock = { fragments: [], cards: FILLER };

    it("clusters by slot signature, never per card", () => {
        const filings = buildMigrationFilings(inputs(lock), [
            graduate("Air Elemental", ["keyword-line"]),
            graduate("Bad Moon", ["static"]),
            graduate("Black Ward", ["keyword-line"]),
            graduate("Castle", ["static", "keyword-line"]),
        ]);
        expect(filings.map((f) => f.key).sort()).toEqual([
            "keyword-line",
            "keyword-line + static",
            "static",
        ]);
        const cluster = filings.find((f) => f.key === "keyword-line")!;
        expect(cluster.labels).toEqual([
            "ready-for-agent",
            "enhancement",
            "area:cards",
            "migration",
        ]);
        const body = cluster.body(1);
        expect(body).toContain("Air Elemental");
        expect(body).toContain("Black Ward");
        expect(body).not.toContain("Bad Moon");
    });

    it("`unlockingRule` folds a repeated slot and sorts, so one cluster is one key", () => {
        expect(unlockingRule(["static", "keyword-line", "static"])).toBe(
            "keyword-line + static"
        );
        expect(unlockingRule([])).toBe("(no slot)");
    });

    it("the body lists each card's module and the test files naming it, and the ADR 0114 retirement steps", () => {
        const filings = buildMigrationFilings(inputs(lock), [
            graduate("Onulet", ["activated"], {
                tests: ["convex/cards/__tests__/atqArtifacts.test.ts"],
            }),
        ]);
        const body = filings[0]!.body(1);
        expect(body).toContain("convex/cards/sets/lea/white.ts");
        expect(body).toContain("convex/cards/__tests__/atqArtifacts.test.ts");
        expect(body).toContain("oracle:retire");
        expect(body).toContain("ADR 0114");
    });

    it("a second run reconciles the same cluster and writes nothing", () => {
        const filings = buildMigrationFilings(inputs(lock), [
            graduate("Onulet", ["activated"]),
        ]);
        const { tracker, second } = syncTwice(filings);
        expect(tracker.created).toHaveLength(1);
        expect(second.actions.map((a) => a.action)).toEqual(["noop"]);
    });
});

// ── the rank ────────────────────────────────────────────────────────────

describe("the rank — lexicographic on the priority Targets, corpus as tie-break", () => {
    it("puts the class the highest-priority Target holds most of first", () => {
        const lock = {
            fragments: [],
            cards: [
                // Class A: one premodern card, three in the corpus.
                quarantined("a-1", "A One", [CHANGELING], ["premodern"]),
                quarantined("a-2", "A Two", [CHANGELING]),
                quarantined("a-3", "A Three", [CHANGELING]),
                // Class B: two premodern cards, two in the corpus.
                quarantined("b-1", "B One", [SMOKE], ["premodern"]),
                quarantined("b-2", "B Two", [SMOKE], ["premodern"]),
                ...FILLER,
            ],
        };
        const both = [
            ...buildQuarantineFilings(inputs(lock), "mechanic"),
            ...buildQuarantineFilings(inputs(lock), "scenario"),
        ];
        // Ranked WITHIN a kind, so each is rank 1 of 1 — but the premodern
        // count each body prints is what the order would read.
        expect(both[0]!.body(1)).toContain(
            "- format-premodern (format, priority 1): 1"
        );
        expect(both[1]!.body(1)).toContain(
            "- format-premodern (format, priority 1): 2"
        );
    });

    it("orders two classes of ONE kind by the top Target's count, corpus last", () => {
        const other = {
            kind: "planned-mechanic",
            detail: 'X (aaaaaaaa-0000-4000-8000-000000000009): keyword "flanking" is not implemented in the Mechanics Registry',
        };
        const lock = {
            fragments: [],
            cards: [
                quarantined("a-1", "A One", [CHANGELING]),
                quarantined("a-2", "A Two", [CHANGELING]),
                quarantined("a-3", "A Three", [CHANGELING]),
                quarantined("b-1", "B One", [other], ["premodern"]),
                ...FILLER,
            ],
        };
        const filings = buildQuarantineFilings(inputs(lock), "mechanic");
        // "flanking" has 1 premodern card, "changeling" has 0 — priority 1
        // beats a corpus of 3.
        expect(filings.map((f) => f.key)).toEqual([
            'planned-mechanic › keyword "flanking" is not implemented in the Mechanics Registry',
            'planned-mechanic › keyword "changeling" is not implemented in the Mechanics Registry',
        ]);
        expect(filings[0]!.body(1)).toContain("Rank 1 of 2 in kind `mechanic`");
        expect(filings[1]!.body(1)).toContain("Rank 2 of 2 in kind `mechanic`");
    });
});

// ── the orphan card pass ────────────────────────────────────────────────

describe("orphan card issues — ready-for-human, once", () => {
    const byName = (name: string): string | undefined =>
        ({ "Tail Card": "t-1", "Orphan Card": "x-1" })[name];
    const registered = new Set(["t-1"]);

    it("reads the card names out of a `[card]` title, and only names the lockfile carries", () => {
        expect(cardsNamedByTitle("[card] Orphan Card — ships plain", byName)) //
            .toEqual(["Orphan Card"]);
        expect(
            cardsNamedByTitle("[card] Tail Card + Orphan Card — pair", byName)
        ).toEqual(["Tail Card", "Orphan Card"]);
        // Not a per-card title, and a name nothing resolves: both yield none,
        // so a real slice is never labelled `ready-for-human` on a guess.
        expect(cardsNamedByTitle("[APC] Free tranche — Green", byName)).toEqual(
            []
        );
        expect(
            cardsNamedByTitle("[card] Not A Card — whatever", byName)
        ).toEqual([]);
    });

    it("labels and comments on an issue whose cards no Target requires", () => {
        const actions = orphanCardActions(
            [
                {
                    number: 900,
                    title: "[card] Orphan Card — ships plain",
                    labels: ["area:cards"],
                },
            ],
            byName,
            registered
        );
        expect(actions).toHaveLength(1);
        expect(actions[0]!.cards).toEqual(["Orphan Card"]);
        expect(actions[0]!.comment).toContain("Which objective needs");
        expect(actions[0]!.comment).toContain("`Orphan Card`");
        expect(actions[0]!.comment).toContain("wontfix");
    });

    it("never touches an issue naming a card a Target DOES require, even beside an orphan", () => {
        expect(
            orphanCardActions(
                [
                    {
                        number: 901,
                        title: "[card] Tail Card + Orphan Card — pair",
                        labels: ["area:cards"],
                    },
                ],
                byName,
                registered
            )
        ).toEqual([]);
    });

    it("is idempotent — an issue already labelled `ready-for-human` gets no second comment", () => {
        expect(
            orphanCardActions(
                [
                    {
                        number: 900,
                        title: "[card] Orphan Card — ships plain",
                        labels: ["area:cards", "ready-for-human"],
                    },
                ],
                byName,
                registered
            )
        ).toEqual([]);
    });
});

// ── The duplicate-key guard (review of PR #3978) ────────────────────────

describe("one claimId, one filing", () => {
    it("dedupes two cards sharing a name — 38 lockfile names are carried by two rows", () => {
        // Both rows are unparsed, both below the floor, both ranked. Filing
        // both would create two issues for one `hand-tail` claim key, keep
        // only the second in `updatedRows`, then flip that one issue's body
        // between the two cards on every later run.
        const lock = {
            fragments: [fragment("a one-off line")],
            cards: [
                unparsed("dup-a", "Inferno", [0], ["premodern"]),
                unparsed("dup-b", "Inferno", [0], ["vintage"]),
                ...FILLER,
            ],
        };
        const { filings } = buildHandTailFilings(
            inputs(lock, { handTailFiling: true })
        );
        expect(filings.map((f) => f.key)).toEqual(["Inferno"]);
        const tracker = new StubTracker();
        expect(syncGaps(filings, tracker).actions).toHaveLength(1);
        expect(tracker.created).toHaveLength(1);
    });
});

// ── enforced-without-priority (review of PR #3978) ──────────────────────

describe("the ranked set is priority ∪ enforced", () => {
    it("an enforced Target with no priority still gets its below-floor cards filed", () => {
        // `check:targets` reds an enforced Target's unclaimed card, so a card
        // it holds needs a filer even when nothing ranks it.
        const registry: TargetRegistry = {
            handTailFloor: 3,
            handTailFiling: true,
            targets: [
                {
                    id: "format-premodern",
                    kind: "format",
                    source: "premodern",
                    priority: 1,
                },
                {
                    id: "format-vintage",
                    kind: "format",
                    source: "vintage",
                    enforced: true,
                },
            ],
        };
        const lock = {
            fragments: [fragment("a one-off line")],
            cards: [
                unparsed("v-1", "Enforced Only", [0], ["vintage"]),
                ...FILLER,
            ],
        };
        const ctx = resolveContext("/tmp/gaps-sync-no-such-root", lock);
        const slices = prioritySlices(registry, ctx);
        const ranked = new Set(slices.flatMap((slice) => [...slice.ids]));
        // Priority alone leaves the enforced Target's card out…
        expect(ranked.has("v-1")).toBe(false);
        for (const row of registry.targets) {
            if (row.enforced !== true || row.priority !== undefined) continue;
            for (const card of resolveTarget(row, ctx).cards)
                ranked.add(card.oracleId);
        }
        expect(ranked.has("v-1")).toBe(true);
        const { filings } = buildHandTailFilings(
            inputs(
                lock,
                {
                    handTailFiling: true,
                    ranked,
                    enforced: enforcedCardIds(registry, ctx),
                },
                registry
            )
        );
        expect(filings.map((f) => f.key)).toContain("Enforced Only");
    });
});

// ── grammar — fragment gaps of an enforced Target (issue #4219) ─────────

describe("the grammar kind files fragment gaps of enforced Targets, and the claim settles the card", () => {
    // The widespread gap refuses EXACTLY three cards — the floor itself — and
    // NARROW_GAP two, below it. Only `w-1` and `t-1` are in an enforced Target.
    const WIDE_GAP = "(no slot) › a widespread line";
    const lock = {
        fragments: [fragment("a widespread line"), fragment("a one-off line")],
        cards: [
            unparsed("w-1", "Wide One", [0], ["premodern"]),
            unparsed("w-2", "Wide Two", [0], ["premodern"]),
            unparsed("w-3", "Wide Three", [0], ["vintage"]),
            unparsed("t-1", "Tail One", [1], ["premodern"]),
            unparsed("t-2", "Tail Two", [1], ["vintage"]),
            ...FILLER,
        ],
    };
    const enforced = new Set(["w-1", "t-1"]);

    it("files one issue per gap at or above the floor that an enforced card carries — and none for a below-floor gap or a card outside", () => {
        const filings = buildFragmentGapFilings(inputs(lock, { enforced }));
        expect(filings.map((f) => f.key)).toEqual([WIDE_GAP]);
        expect(filings[0]!.title).toBe(`Grammar Gap: ${WIDE_GAP}`);
        const body = filings[0]!.body(4321);
        expect(body).toContain("3 corpus cards carry it (floor 3)");
        expect(body).toContain("Fragment refused: `a widespread line`");
        expect(body).toContain("Enforced-Target cards held (1): Wide One");
        expect(body).not.toContain("Wide Two");
    });

    it("files nothing while no Target is enforced", () => {
        expect(
            buildFragmentGapFilings(inputs(lock, { enforced: new Set() }))
        ).toEqual([]);
    });

    it("a `ready` Target's card owes a grammar claim for a BELOW-floor gap too (issue #4519)", () => {
        // t-1 carries NARROW_GAP (2 corpus cards, floor 3) and sits in a
        // `completion: "ready"` Target: the floor does not apply to it.
        const filings = buildFragmentGapFilings(
            inputs(lock, {
                enforced: new Set(["t-1"]),
                floorless: new Set(["t-1"]),
            })
        );
        expect(filings.map((f) => f.key)).toEqual([NARROW_GAP]);
        expect(filings[0]!.body(1)).toContain(
            "Enforced-Target cards held (1): Tail One"
        );
    });

    it("a `ready` Target's card is never filed as hand-tail — it owes grammar", () => {
        const tail = inputs(lock, {
            handTailFiling: true,
            enforced: new Set(["t-1"]),
            ranked: new Set(["t-1"]),
        });
        expect(buildHandTailFilings(tail).filings.map((f) => f.key)).toEqual([
            "Tail One",
        ]);
        expect(
            buildHandTailFilings({ ...tail, floorless: new Set(["t-1"]) })
                .filings
        ).toEqual([]);
    });

    it("skips a card that is not `unparsed` — a ready or quarantined card owes no grammar claim", () => {
        const mixed = {
            fragments: lock.fragments,
            cards: [
                unparsed("w-1", "Wide One", [0], ["premodern"]),
                {
                    ...unparsed("w-2", "Wide Ready", [0], ["premodern"]),
                    state: "ready" as const,
                    opsUsed: [],
                },
                unparsed("w-3", "Wide Three", [0], ["vintage"]),
                unparsed("w-4", "Wide Four", [0], ["vintage"]),
                ...FILLER,
            ],
        };
        const filings = buildFragmentGapFilings(
            inputs(mixed, { enforced: new Set(["w-2"]) })
        );
        expect(filings).toEqual([]);
    });

    it("the claim is a `claims` row of kind `grammar` — and it moves the card out of `unclaimed`", () => {
        const tracker = new StubTracker();
        const result = syncGaps(
            buildFragmentGapFilings(inputs(lock, { enforced })),
            tracker
        );
        const doc = applyUpdatedIssues(
            { ops: [{ key: "(op) › drain", op: "drain", issue: PRD_ISSUE }] },
            result.updatedRows
        );
        expect(doc.claims).toEqual([
            { kind: "grammar", key: WIDE_GAP, issue: 5000 },
        ]);
        expect(doc.ops).toEqual([
            { key: "(op) › drain", op: "drain", issue: PRD_ISSUE },
        ]);

        const { gapKeys, leverage } = gapIndex(lock);
        const wide = lock.cards[0]!;
        const verdict = (claims: Set<string>) =>
            coverageVerdict(wide, {
                floor: 3,
                handWritten: new Set(),
                handTail: new Set(),
                closure: new Set(),
                claims,
                byOracleId: new Map(),
                gapKeys,
                leverage,
            }).state;
        expect(verdict(new Set())).toBe("unclaimed");
        expect(verdict(parseClaims(doc))).toBe("gap-pending");
    });

    it("an `ops` row still takes its number on `ops`, never `claims`", () => {
        const doc = applyUpdatedIssues(
            { ops: [{ key: "(op) › drain", op: "drain", issue: PRD_ISSUE }] },
            new Map([[claimId("grammar", "(op) › drain"), 4000]])
        );
        expect(doc.ops[0]!.issue).toBe(4000);
        expect(doc.claims).toBeUndefined();
    });

    it("files once — a second run creates and edits nothing", () => {
        const first = new StubTracker();
        const result = syncGaps(
            buildFragmentGapFilings(inputs(lock, { enforced })),
            first
        );
        const filed = new Map(result.updatedRows);
        const again = buildFragmentGapFilings(
            inputs(lock, { enforced, filed })
        );
        expect(again[0]!.currentIssue).toBe(5000);
        expect(syncGaps(again, first).actions.map((a) => a.action)).toEqual([
            "noop",
        ]);
    });

    it("a fragment-gap claim goes stale like any other; an `(op) ›` one stays `check:gaps`'s", () => {
        const filed = new Map([
            [claimId("grammar", WIDE_GAP), 7001],
            [claimId("grammar", "(op) › addMana"), 7002],
        ]);
        expect(staleClaims(filed, [])).toEqual([
            { kind: "grammar", key: WIDE_GAP, issue: 7001 },
        ]);
    });

    it("the gap reaches the unparsed cards that carry it, so the triage can band it", () => {
        const { gapKeys } = gapIndex(lock);
        const reached = partitionCardIndex(lock, new Map(), gapKeys);
        expect(
            [...(reached.get(claimId("grammar", WIDE_GAP)) ?? [])].sort()
        ).toEqual(["w-1", "w-2", "w-3"]);
        expect(
            partitionCardIndex(lock, new Map()).has(
                claimId("grammar", WIDE_GAP)
            )
        ).toBe(false);
    });
});

// ── stale claims (review of PR #3978) ───────────────────────────────────

describe("staleClaims — a row no filing referenced", () => {
    it("names the rows whose gap is gone, and never an `ops` row", () => {
        const filings = buildMigrationFilings(
            { ...inputs({ fragments: [], cards: FILLER }) },
            [graduate("Onulet", ["activated"])]
        );
        const filed = new Map([
            [claimId("migration", "activated"), 7001],
            [claimId("migration", "renamed-slot"), 7002],
            [claimId("grammar", "(op) › addMana"), 7003],
        ]);
        expect(staleClaims(filed, filings)).toEqual([
            { kind: "migration", key: "renamed-slot", issue: 7002 },
        ]);
    });
});

// ── umbrellas partitioned by band (issue #4056) ─────────────────────────

describe("umbrellas partition by band — the triage's cards source picks the parent (issue #4056)", () => {
    /** One card per ranked Target, plus one no ranked Target holds. */
    const INDEX = cardBandIndex(
        [
            { id: "premodern-metagame", ids: ["c-p1"] },
            { id: "vintage-cube", ids: ["c-p2"] },
            { id: "format-premodern", ids: ["c-p3"] },
        ],
        (id) =>
            (({
                "premodern-metagame": "P1",
                "vintage-cube": "P2",
                "format-premodern": "P3",
            })[id] as Band | undefined) ?? null
    );
    const GRAMMAR = BAND_UMBRELLAS["grammar-rules"];
    const OPS = BAND_UMBRELLAS.ops;
    const BOTS = BAND_UMBRELLAS["bot-gaps"];
    /** The Target umbrella of a family — the umbrella that Target's band held
     *  under the band-letter keying this replaced. */
    const [METAGAME, CUBE, POOL] = [
        "premodern-metagame",
        "vintage-cube",
        "format-premodern",
    ] as const;

    /** `gaps-sync.ts`'s composition, over synthetic inputs. */
    function banded(
        filings: readonly GapFiling[],
        lock: Pick<Lockfile, "cards">,
        opUsers: ReadonlyMap<string, ReadonlySet<string>> = new Map()
    ): GapFiling[] {
        const reached = partitionCardIndex(lock, opUsers);
        return withPartitionBands(
            filings,
            (f) =>
                strongestCardBand(
                    reached.get(claimId(f.kind, f.key)) ?? [],
                    INDEX
                )?.target ?? null
        );
    }

    /** Three Op-census rows: one reached by a P1 card, one only by a P3
     *  card, one by no ranked card at all (residue). */
    const OPS_ALLOWLIST = {
        ops: [
            { key: "(op) › drain", op: "drain", issue: PRD_ISSUE },
            { key: "(op) › flicker", op: "flicker", issue: PRD_ISSUE },
            { key: "(op) › oddity", op: "oddity", issue: PRD_ISSUE },
        ],
    };
    const OP_USERS = new Map([
        ["drain", new Set(["c-p1", "c-p3"])],
        ["flicker", new Set(["c-p3"])],
        ["oddity", new Set(["c-unranked"])],
    ]);

    it("files a grammar gap under the Grammar Rules umbrella of its band — P1 and P3 — and residue under the family's P3", () => {
        const filings = banded(
            buildGrammarGapFilings(OPS_ALLOWLIST),
            { cards: [] },
            OP_USERS
        );
        expect(filings.map((f) => [f.key, f.target])).toEqual([
            ["(op) › drain", METAGAME],
            ["(op) › flicker", POOL],
            ["(op) › oddity", null],
        ]);
        const tracker = new StubTracker();
        syncGaps(filings, tracker);
        expect(tracker.created.map((c) => [c.title, c.parent])).toEqual([
            ["Grammar Gap: (op) › drain", GRAMMAR[METAGAME]],
            ["Grammar Gap: (op) › flicker", GRAMMAR[POOL]],
            ["Grammar Gap: (op) › oddity", GRAMMAR[POOL]],
        ]);
    });

    it("a residue gap already filed keeps its current parent — it is never swept into a band", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4500, { state: "OPEN", body: "x" });
        tracker.parents.set(4500, 3838);
        const [residue] = banded(
            buildGrammarGapFilings({
                ops: [{ key: "(op) › oddity", op: "oddity", issue: 4500 }],
            }),
            { cards: [] },
            OP_USERS
        );
        const result = syncGaps([residue!], tracker);
        expect(result.moves).toEqual([]);
        expect(tracker.parents.get(4500)).toBe(3838);
    });

    it("a band recomputed to a stronger value moves the issue once — a second run moves nothing", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4501, { state: "OPEN", body: "x" });
        // Filed under P3 when only the set card used the Op; a tier1 card now
        // uses it too, so the band is P1.
        tracker.parents.set(4501, GRAMMAR[POOL]);
        const filings = banded(
            buildGrammarGapFilings({
                ops: [{ key: "(op) › drain", op: "drain", issue: 4501 }],
            }),
            { cards: [] },
            OP_USERS
        ).map((f) => ({ ...f, body: () => "x" }));
        const first = syncGaps(filings, tracker);
        expect(first.moves).toEqual([
            {
                kind: "grammar",
                key: "(op) › drain",
                issue: 4501,
                from: GRAMMAR[POOL],
                to: GRAMMAR[METAGAME],
            },
        ]);
        expect(tracker.parents.get(4501)).toBe(GRAMMAR[METAGAME]);
        const second = syncGaps(filings, tracker);
        expect(second.moves).toEqual([]);
        expect(tracker.moves).toHaveLength(1);
        expect(second.actions.map((a) => a.action)).toEqual(["noop"]);
    });

    it("never moves an issue out of its family's hand-set P0 umbrella", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4502, { state: "OPEN", body: "x" });
        tracker.parents.set(4502, GRAMMAR.P0);
        const filings = banded(
            buildGrammarGapFilings({
                ops: [{ key: "(op) › flicker", op: "flicker", issue: 4502 }],
            }),
            { cards: [] },
            OP_USERS
        );
        expect(syncGaps(filings, tracker).moves).toEqual([]);
        expect(tracker.parents.get(4502)).toBe(GRAMMAR.P0);
    });

    it("empties a retired umbrella: a banded child moves to its band, a residue child to its family's P3", () => {
        const [retired] = [...RETIRED_UMBRELLAS];
        const tracker = new StubTracker();
        for (const n of [4503, 4504]) {
            tracker.issues.set(n, { state: "OPEN", body: "x" });
            tracker.parents.set(n, retired!);
        }
        const filings = banded(
            buildGrammarGapFilings({
                ops: [
                    { key: "(op) › flicker", op: "flicker", issue: 4503 },
                    { key: "(op) › oddity", op: "oddity", issue: 4504 },
                ],
            }),
            { cards: [] },
            OP_USERS
        );
        syncGaps(filings, tracker);
        expect(tracker.parents.get(4503)).toBe(GRAMMAR[POOL]);
        expect(tracker.parents.get(4504)).toBe(GRAMMAR[POOL]);
    });

    it("the Ops umbrellas partition the mechanic kind the same way — a new Op and an existing mechanic alike", () => {
        const PLANNED_OP = {
            kind: "planned-op",
            detail: 'Drain Card (aaaaaaaa-0000-4000-8000-000000000011): Op "drainEverything" is not in the Mechanics Registry',
        };
        const lock = {
            fragments: [],
            cards: [
                quarantined(
                    "c-p2",
                    "Cube Changeling",
                    [CHANGELING],
                    ["premodern"]
                ),
                quarantined("c-p3", "Leg Changeling", [CHANGELING]),
                quarantined("c-p1", "Drain Card", [PLANNED_OP], ["premodern"]),
                ...FILLER,
            ],
        };
        const filings = banded(
            buildQuarantineFilings(inputs(lock), "mechanic"),
            lock
        );
        const tracker = new StubTracker();
        syncGaps(filings, tracker);
        expect(
            tracker.created
                .map((c) => [c.title.split(" › ")[0], c.parent])
                .sort()
        ).toEqual(
            [
                ["Quarantine (mechanic): planned-mechanic", OPS[CUBE]],
                ["Quarantine (mechanic): planned-op", OPS[METAGAME]],
            ].sort()
        );
    });

    it("a Bot Gap's band is the highest Target among the cards carrying its key — a played row's stale key lends nothing", () => {
        const KEY = "never-chosen › Enchantment › destroy";
        const lock = {
            fragments: [],
            cards: [
                botRow("c-p2", "Cube Aura", KEY, ["premodern"]),
                botRow("c-p3", "Leg Aura", KEY),
                // Its key is stale by contract: were it counted, the band
                // would be P1.
                {
                    oracleId: "c-p1",
                    name: "Played Aura",
                    state: "ready" as const,
                    opsUsed: [],
                    botReach: "played" as const,
                    botGap: KEY,
                },
                ...FILLER,
            ],
        };
        const filings = banded(buildBotGapFilings(inputs(lock)), lock);
        expect(filings.map((f) => [f.key, f.target])).toEqual([[KEY, CUBE]]);
        const tracker = new StubTracker();
        tracker.issues.set(4505, { state: "OPEN", body: "x" });
        tracker.parents.set(4505, PRD_ISSUE);
        syncGaps(
            filings.map((f) => ({ ...f, currentIssue: 4505 })),
            tracker
        );
        expect(tracker.parents.get(4505)).toBe(BOTS[CUBE]);
    });

    it("an unpartitioned kind files under its own P3 umbrella when no set umbrella claims it", () => {
        const lock = {
            fragments: [],
            cards: [
                quarantined("c-p1", "Onulet", [SMOKE], ["premodern"]),
                ...FILLER,
            ],
        };
        const filings = banded(
            buildQuarantineFilings(inputs(lock), "scenario"),
            lock
        );
        expect(filings[0]!.target).toBeUndefined();
        const tracker = new StubTracker();
        syncGaps(filings, tracker);
        expect(tracker.created[0]!.parent).toBe(KIND_FALLBACK.scenario);
    });

    it("counts MOVES against the cap, and refuses before any write", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4506, { state: "OPEN", body: "x" });
        tracker.parents.set(4506, [...RETIRED_UMBRELLAS][0]!);
        tracker.childCounts.set(GRAMMAR[POOL], SUB_ISSUE_CAP);
        const filings = banded(
            buildGrammarGapFilings({
                ops: [{ key: "(op) › flicker", op: "flicker", issue: 4506 }],
            }),
            { cards: [] },
            OP_USERS
        );
        expect(() => syncGaps(filings, tracker)).toThrow(/cap of 100/);
        expect(tracker.moves).toEqual([]);
    });
    it("moves every kind OFF PRD #3820 to its fallback — partitioned residue and unpartitioned kinds alike — once (issue #4110)", () => {
        const lock = {
            fragments: [],
            cards: [
                quarantined("c-x", "Onulet", [SMOKE], ["premodern"]),
                ...FILLER,
            ],
        };
        const scenario = banded(
            buildQuarantineFilings(inputs(lock), "scenario"),
            lock
        ).map((f) => ({ ...f, currentIssue: 4600, body: () => "x" }));
        const [oddity] = banded(
            buildGrammarGapFilings({
                ops: [{ key: "(op) › oddity", op: "oddity", issue: 4601 }],
            }),
            { cards: [] },
            OP_USERS
        ).map((f) => ({ ...f, body: () => "x" }));
        const tracker = new StubTracker();
        for (const n of [4600, 4601]) {
            tracker.issues.set(n, { state: "OPEN", body: "x" });
            tracker.parents.set(n, PRD_ISSUE);
        }
        syncGaps([...scenario, oddity!], tracker);
        expect(tracker.parents.get(4600)).toBe(KIND_FALLBACK.scenario);
        expect(tracker.parents.get(4601)).toBe(GRAMMAR[POOL]);
        expect(syncGaps([...scenario, oddity!], tracker).moves).toEqual([]);
        expect(tracker.moves).toHaveLength(2);
    });

    it("an open gap with NO parent at all — a create whose parent write failed — moves to its fallback", () => {
        const [oddity] = banded(
            buildGrammarGapFilings({
                ops: [{ key: "(op) › oddity", op: "oddity", issue: 4603 }],
            }),
            { cards: [] },
            OP_USERS
        ).map((f) => ({ ...f, body: () => "x" }));
        const tracker = new StubTracker();
        tracker.issues.set(4603, { state: "OPEN", body: "x" });
        const result = syncGaps([oddity!], tracker);
        expect(result.moves).toEqual([
            {
                kind: "grammar",
                key: "(op) › oddity",
                issue: 4603,
                from: null,
                to: GRAMMAR[POOL],
            },
        ]);
        expect(syncGaps([oddity!], tracker).moves).toEqual([]);
    });

    it("an unpartitioned kind hand-placed under any other parent keeps it", () => {
        const lock = {
            fragments: [],
            cards: [
                quarantined("c-x", "Onulet", [SMOKE], ["premodern"]),
                ...FILLER,
            ],
        };
        const scenario = banded(
            buildQuarantineFilings(inputs(lock), "scenario"),
            lock
        ).map((f) => ({ ...f, currentIssue: 4602, body: () => "x" }));
        const tracker = new StubTracker();
        tracker.issues.set(4602, { state: "OPEN", body: "x" });
        tracker.parents.set(4602, 3838);
        expect(syncGaps(scenario, tracker).moves).toEqual([]);
        expect(tracker.parents.get(4602)).toBe(3838);
    });

    it("every kind's fallback is its LOWEST-ranked Target's umbrella — never a PRD", () => {
        expect(KIND_FALLBACK.grammar).toBe(GRAMMAR[POOL]);
        expect(KIND_FALLBACK.mechanic).toBe(OPS[POOL]);
        expect(KIND_FALLBACK.bot).toBe(BOTS[POOL]);
        expect(KIND_FALLBACK["hand-tail"]).toBe(
            BAND_UMBRELLAS["hand-tail"][POOL]
        );
        for (const parent of Object.values(KIND_FALLBACK))
            expect(RETIRED_UMBRELLAS.has(parent)).toBe(false);
        expect(RETIRED_UMBRELLAS.has(PRD_ISSUE)).toBe(true);
    });

    it("a Hand Tail card files under the Hand Tail umbrella of the Target lending its band, and residue under the lowest-ranked one (ADR 0143)", () => {
        // Three cards, each below the floor on its own gap: one in the
        // metagame, one in the cube, one in no ranked Target (`c-x`).
        const lock = {
            fragments: [
                fragment("a first line"),
                fragment("a second line"),
                fragment("a third line"),
            ],
            cards: [
                unparsed("c-p1", "Tail Metagame", [0]),
                unparsed("c-p2", "Tail Cube", [1]),
                unparsed("c-x", "Tail Off Road", [2]),
                ...FILLER,
            ],
        };
        const ids = new Set(["c-p1", "c-p2", "c-x"]);
        const filings = banded(
            buildHandTailFilings(
                inputs(lock, {
                    handTailFiling: true,
                    ranked: ids,
                    enforced: ids,
                })
            ).filings,
            lock
        );
        expect(
            Object.fromEntries(filings.map((f) => [f.key, f.target]))
        ).toEqual({
            "Tail Metagame": METAGAME,
            "Tail Cube": CUBE,
            "Tail Off Road": null,
        });
        const tracker = new StubTracker();
        syncGaps(filings, tracker);
        expect(
            Object.fromEntries(
                tracker.created.map((c) => [
                    c.title.replace("Hand Tail: ", ""),
                    c.parent,
                ])
            )
        ).toEqual({
            "Tail Metagame": BAND_UMBRELLAS["hand-tail"][METAGAME],
            "Tail Cube": BAND_UMBRELLAS["hand-tail"][CUBE],
            "Tail Off Road": BAND_UMBRELLAS["hand-tail"][POOL],
        });
    });

    it("only an UNPARSED row is a Hand Tail card the partition can reach", () => {
        const reached = partitionCardIndex(
            {
                cards: [
                    unparsed("h-1", "Tail One", [0]),
                    {
                        oracleId: "h-2",
                        name: "Ready One",
                        state: "ready",
                        opsUsed: [],
                    },
                ],
            },
            new Map()
        );
        expect([
            ...(reached.get(claimId("hand-tail", "Tail One")) ?? []),
        ]).toEqual(["h-1"]);
        expect(reached.has(claimId("hand-tail", "Ready One"))).toBe(false);
    });
});

// ── the ORIGIN band — a gap born of P0 work files under P0 (issue #4158) ──

describe("gaps:sync --band — the origin band files a P0 run's gaps under P0 (issue #4158)", () => {
    const GRAMMAR = BAND_UMBRELLAS["grammar-rules"];
    const OPS = BAND_UMBRELLAS.ops;
    const BOTS = BAND_UMBRELLAS["bot-gaps"];
    const [METAGAME, CUBE, POOL] = [
        "premodern-metagame",
        "vintage-cube",
        "format-premodern",
    ] as const;

    /** A filing of `kind` whose band is lent by `target`, unfiled unless
     *  `currentIssue`. */
    function gap(
        kind: GapFiling["kind"],
        target: GapFiling["target"],
        currentIssue: number | null = null
    ): GapFiling {
        return {
            kind,
            key: `${kind}-key`,
            currentIssue,
            title: `${kind} gap`,
            labels: ["ready-for-agent"],
            parentSetCode: null,
            fallbackParent: KIND_FALLBACK[kind],
            ...(target === undefined ? {} : { target }),
            body: () => "x",
        };
    }

    const PARTITIONED = [
        gap("grammar", METAGAME),
        gap("mechanic", CUBE),
        gap("bot", METAGAME),
    ];

    it("P0: a created bot, grammar and mechanic gap each lands in its OWN family's P0 umbrella, whatever band was computed", () => {
        const tracker = new StubTracker();
        syncGaps(PARTITIONED, tracker, "P0");
        expect(tracker.created.map((c) => [c.title, c.parent])).toEqual([
            ["grammar gap", GRAMMAR.P0],
            ["mechanic gap", OPS.P0],
            ["bot gap", BOTS.P0],
        ]);
    });

    it("P0: a residue gap (no computed band) of P0 work files under P0 too — not the family's P3", () => {
        const tracker = new StubTracker();
        syncGaps([gap("bot", null)], tracker, "P0");
        expect(tracker.created[0]!.parent).toBe(BOTS.P0);
    });

    it("a second run with NO band leaves the gap in P0 — nothing moves out of a P0 umbrella", () => {
        const tracker = new StubTracker();
        const first = syncGaps([gap("bot", METAGAME)], tracker, "P0");
        const issue = [...first.updatedRows.values()][0]!;
        const second = syncGaps([gap("bot", METAGAME, issue)], tracker);
        expect(second.moves).toEqual([]);
        expect(tracker.parents.get(issue)).toBe(BOTS.P0);
    });

    it("no band, and every non-P0 band, is today's behaviour: the computed band's umbrella", () => {
        for (const band of [undefined, "P1", "P2", "P3"] as const) {
            const tracker = new StubTracker();
            syncGaps(PARTITIONED, tracker, band);
            expect(tracker.created.map((c) => c.parent)).toEqual([
                GRAMMAR[METAGAME],
                OPS[CUBE],
                BOTS[METAGAME],
            ]);
        }
    });

    it("an existing open gap sitting in a P1 umbrella is NOT pulled up by a P0 run", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4700, { state: "OPEN", body: "x" });
        tracker.parents.set(4700, BOTS[METAGAME]);
        const result = syncGaps([gap("bot", METAGAME, 4700)], tracker, "P0");
        expect(result.moves).toEqual([]);
        expect(tracker.parents.get(4700)).toBe(BOTS[METAGAME]);
    });

    it("a HOMELESS gap — no parent, or one under a retired umbrella — goes to P0 in a P0 run, to its fallback otherwise", () => {
        for (const parent of [undefined, PRD_ISSUE]) {
            const p0 = new StubTracker();
            const plain = new StubTracker();
            for (const t of [p0, plain]) {
                t.issues.set(4701, { state: "OPEN", body: "x" });
                if (parent !== undefined) t.parents.set(4701, parent);
            }
            syncGaps([gap("bot", null, 4701)], p0, "P0");
            syncGaps([gap("bot", null, 4701)], plain);
            expect(p0.parents.get(4701)).toBe(BOTS.P0);
            expect(plain.parents.get(4701)).toBe(BOTS[POOL]);
        }
    });

    it("a HOMELESS gap WITH a computed band goes to P0 in a P0 run — the origin outranks the band; to its band otherwise", () => {
        for (const parent of [undefined, PRD_ISSUE]) {
            const p0 = new StubTracker();
            const plain = new StubTracker();
            for (const t of [p0, plain]) {
                t.issues.set(4702, { state: "OPEN", body: "x" });
                if (parent !== undefined) t.parents.set(4702, parent);
            }
            syncGaps([gap("bot", METAGAME, 4702)], p0, "P0");
            syncGaps([gap("bot", METAGAME, 4702)], plain);
            expect(p0.parents.get(4702)).toBe(BOTS.P0);
            expect(plain.parents.get(4702)).toBe(BOTS[METAGAME]);
        }
    });

    it("a create reports the umbrella it was filed under", () => {
        const tracker = new StubTracker();
        const { actions } = syncGaps([gap("bot", METAGAME)], tracker, "P0");
        expect(actions[0]).toMatchObject({ action: "create", parent: BOTS.P0 });
    });

    it("kinds outside the partition — scenario, migration — ignore the band", () => {
        for (const kind of ["scenario", "migration"] as const) {
            expect(originUmbrellaOf(gap(kind, undefined), "P0")).toBeNull();
            const tracker = new StubTracker();
            syncGaps([gap(kind, undefined)], tracker, "P0");
            expect(tracker.created[0]!.parent).toBe(KIND_FALLBACK[kind]);
        }
    });

    it("the P0 umbrella counts against GitHub's sub-issue cap like any other parent", () => {
        const tracker = new StubTracker();
        tracker.childCounts.set(BOTS.P0, SUB_ISSUE_CAP);
        expect(() => syncGaps([gap("bot", METAGAME)], tracker, "P0")).toThrow(
            new RegExp(`#${BOTS.P0} holds ${SUB_ISSUE_CAP} sub-issues`)
        );
        expect(tracker.created).toEqual([]);
    });
});

describe("gaps-sync main hands the parsed origin band to syncGaps", () => {
    // `main()` reads the network, so the one argument that carries the band
    // from `parseOriginBand` into `syncGaps` cannot be run under test; a flag
    // parsed and then dropped is exactly the failure issue #4158 exists to end.
    // Pinned by SHAPE, the same way `land.test.ts` pins the locked command.
    it("passes `originBand` as syncGaps's third argument", () => {
        const source = readFileSync("scripts/gaps-sync.ts", "utf8");
        expect(source).toMatch(
            /syncGaps\(\s*withUnlockBlockers\(filings, blockers\),\s*tracker,\s*originBand\s*\)/
        );
    });
});

describe("parseOriginBand — the flag is the only channel into a hand-set P0 umbrella", () => {
    it("reads `--band P0` and `--band=P0`; absent is undefined", () => {
        expect(parseOriginBand(["--band", "P0"])).toBe("P0");
        expect(parseOriginBand(["--dry-run", "--band=P2"])).toBe("P2");
        expect(parseOriginBand(["--dry-run"])).toBeUndefined();
    });

    it("refuses an unknown or missing value — a typo read as `no band` would file one band too low, silently", () => {
        expect(() => parseOriginBand(["--band", "p0"])).toThrow(/got "p0"/);
        expect(() => parseOriginBand(["--band=P9"])).toThrow(/got "P9"/);
        expect(() => parseOriginBand(["--band"])).toThrow(/got nothing/);
    });
});

describe("GAP_LABELS carries the filing stamp (issue #4457)", () => {
    // docs/agents/triage-labels.md § Every new issue is stamped at filing:
    // one type and one area on every computed issue; the band comes from the
    // umbrella every gap issue is parented to, so no kind carries one.
    const TYPES = ["bug", "enhancement", "prd", "user-report"];
    it.each(GAP_KINDS)("%s: exactly one type and exactly one area:*", (k) => {
        const labels = GAP_LABELS[k];
        expect(labels.filter((l) => TYPES.includes(l))).toHaveLength(1);
        expect(labels.filter((l) => l.startsWith("area:"))).toHaveLength(1);
        expect(labels.filter((l) => l.startsWith("model:"))).toEqual([]);
    });
});
