/**
 * The dashboard glossary (#2629) — one authority for every abbreviation the
 * page renders, in both views.
 *
 * The dashboard prints the engine's own vocabulary: `pct`, `pri`, `spans`,
 * `cmd_bucket`, `model_req`, `impl '`, `orch $`, `×`, `?`, `·`, `→`. None of
 * it is decodable at a glance, and before this module none of it was explained
 * anywhere. Every entry here is `{ label, tip }`: a human label to render in
 * place of the raw token, and a sentence saying what the term COUNTS or MEANS
 * — never a restatement of its name ("cmd_bucket: the command bucket" is the
 * failure mode this file exists to prevent).
 *
 * ## Why this module is pure
 *
 * Zero DOM access, zero imports: `scripts/__tests__/dashboard-glossary.test.ts`
 * runs in the `node` vitest project and imports this file directly, so the
 * completeness guard CALLS `lookupTerm` rather than grepping a string of
 * JavaScript. The DOM half of the feature lives in `tooltip.js`.
 *
 * ## Qualified keys
 *
 * A term can mean different things in different tables — `messages` is
 * `count(*)` of assistant messages in `llm` and `sum(msgs)` in `agent_runs`;
 * `total_seconds` is tool wall-clock in `spans` and subagent wall-clock in
 * `agent_runs`. Those get QUALIFIED keys (`llm.messages`), and `lookupTerm`
 * resolves `"<scope>.<term>"` by exact match first, then by falling back to
 * the bare term. So a surface can always declare the qualified form and get
 * the most specific entry that exists.
 *
 * The same hazard runs the other way, which is why NOTHING here is keyed on a
 * glyph: `×` is the orphan mark in the claims table and a count of fixup
 * rounds in the History issues table. Keys are semantic (`claim.orphan`,
 * `fixups`); the glyph is what the surface renders, not what it declares.
 *
 * ## Completeness
 *
 * The guard iterates the SERVER's vocabularies — `DIMENSIONS`/`METRICS` in
 * `telemetry-serve.ts`, `CLAIM_STAGES`, `CLAIM_VERDICT_STATES`,
 * `LOOP_VERDICT_STATES` — and asserts each resolves here. It is pointed
 * upstream on purpose: a test that walked this file's own keys would pass
 * forever and guard nothing. A dimension added server-side with no human label
 * reds the suite.
 */

/**
 * @typedef {{ label: string, tip: string }} GlossaryEntry
 */

/** @type {Record<string, GlossaryEntry>} */
export const GLOSSARY = {
    // ─────────────────────────────────────────────────────────────────────
    // Fact tables (`table=` in every /api/query body)
    // ─────────────────────────────────────────────────────────────────────
    spans: {
        label: "tool calls",
        tip: "One row per completed tool call, paired from the pre/post hook events. Durations are stamped in whole seconds, so a sub-second call reads as 0.",
    },
    llm: {
        label: "messages",
        tip: "One row per assistant message, read from the session transcripts. The only place real token counts and cost live — the hook payload carries usage on ~0.03% of events.",
    },
    agent_runs: {
        label: "subagent runs",
        tip: "One row per subagent, rebuilt from the message rows after every ingest. Wall clock is first-to-last message, not the spawn span: a backgrounded spawn returns immediately and its span measures the launch.",
    },

    // ─────────────────────────────────────────────────────────────────────
    // Dimensions — columns a query may group on or filter by
    // ─────────────────────────────────────────────────────────────────────
    day: {
        label: "date",
        tip: "Local calendar date the row was recorded on. The bucket every daily series is grouped into.",
    },
    hour: {
        label: "hour of day",
        tip: "Local hour, 0–23, with the date thrown away — this stacks every Tuesday 3pm together, so it shows the shape of a working day, not a timeline.",
    },
    tool: {
        label: "tool",
        tip: "Which tool the call invoked — Bash, Read, Edit, Agent, Skill, an MCP tool.",
    },
    kind: {
        label: "call category",
        tip: "What the call was doing, coarser than the tool name: gate:full, gate:check, gate:partial, subagent, skill, bash.",
    },
    role: {
        label: "role",
        tip: "Which job in the loop the work was attributed to — implement, review, fixup, support, orchestrator, or unclassified when nothing said.",
    },
    agent_type: {
        label: "agent type",
        tip: "The subagent definition that ran: general-purpose, Explore, a cavecrew agent. Empty for main-thread work.",
    },
    model_req: {
        label: "model requested",
        tip: "The model named in the Agent spawn. Empty means the spawn passed none and inherited the session's tier — the leak the spawn guard exists to catch.",
    },
    skill: {
        label: "skill",
        tip: "The skill the call ran under, when a Skill invocation was in scope.",
    },
    cmd_bucket: {
        label: "command family",
        tip: "A Bash command sorted into one of gate, test, git, gh, bun, convex, fs, other — so thousands of distinct command lines collapse into something groupable.",
    },
    session: {
        label: "session",
        tip: "The Claude Code session the row came from. High-cardinality, so it is groupable but deliberately absent from the filter pickers.",
    },
    model: {
        label: "model",
        tip: "The model that produced the row.",
    },
    "agent_runs.model": {
        label: "model",
        tip: "The model the subagent actually ran on, taken as the most common model across its own messages.",
    },
    effort: {
        label: "reasoning effort",
        tip: "The reasoning-effort setting the message was produced at, when the transcript recorded one.",
    },
    surface: {
        label: "surface",
        tip: "Where the message was produced: main (the session's own thread), subagent (a spawned agent), or sidechain.",
    },

    // ─────────────────────────────────────────────────────────────────────
    // Metrics — the SQL aggregates a query may select
    // ─────────────────────────────────────────────────────────────────────
    calls: {
        label: "calls",
        tip: "How many tool calls completed. One per pre/post pair — a call that never returned is not counted at all.",
    },
    runs: {
        label: "runs",
        tip: "How many subagents ran. One per spawned agent, not per Agent tool call — a backgrounded spawn that never started produces no run.",
    },
    messages: {
        label: "messages",
        tip: "How many assistant messages were produced.",
    },
    "agent_runs.messages": {
        label: "messages",
        tip: "Assistant messages produced by these subagent runs, summed. A proxy for how long an agent ground on its task — cost is roughly quadratic in this number.",
    },
    total_seconds: {
        label: "total time",
        tip: "Wall clock summed over every tool call in the group. Overlapping background calls are counted separately, so this can exceed elapsed real time.",
    },
    "agent_runs.total_seconds": {
        label: "total time",
        tip: "Wall clock summed over the subagent runs in the group, first message to last. Parallel agents overlap, so this exceeds elapsed real time by design.",
    },
    avg_seconds: {
        label: "average time",
        tip: "Mean wall clock of a tool call in the group.",
    },
    "agent_runs.avg_seconds": {
        label: "average time",
        tip: "Mean wall clock of a subagent run in the group.",
    },
    max_seconds: {
        label: "slowest",
        tip: "The single slowest tool call in the group — what a mean hides.",
    },
    "agent_runs.max_seconds": {
        label: "longest run",
        tip: "The single longest subagent run in the group — what a mean hides.",
    },
    cost_usd: {
        label: "cost",
        tip: "US dollars, priced per model from the token counts on each message. An estimate from the published rates, not a billed figure.",
    },
    "agent_runs.cost_usd": {
        label: "cost",
        tip: "US dollars attributed to these subagent runs, summed from their own messages. Excludes the parent's tokens spent reading the result back.",
    },
    avg_cost_usd: {
        label: "cost per run",
        tip: "Mean dollars a subagent run in the group cost.",
    },
    output_tokens: {
        label: "output tokens",
        tip: "Tokens the model generated — the expensive half of the bill, roughly 5× the input rate.",
    },
    "agent_runs.output_tokens": {
        label: "output tokens",
        tip: "Tokens generated across these subagent runs.",
    },
    input_tokens: {
        label: "input tokens",
        tip: "Fresh, uncached tokens sent to the model. Excludes anything served from the prompt cache.",
    },
    cache_read_tokens: {
        label: "cache reads",
        tip: "Tokens served from the prompt cache, at a tenth of the input rate. A long context re-reads its whole prefix every message, so this dominates every other token count.",
    },
    cache_write_tokens: {
        label: "cache writes",
        tip: "Tokens written into the prompt cache, at 1.25× the input rate. Paid once per prefix, then recovered on every message that reuses it.",
    },
    avg_output_tokens: {
        label: "average output",
        tip: "Mean tokens generated per message — how verbose a model or role is, independent of how many times it was called.",
    },

    // ─────────────────────────────────────────────────────────────────────
    // Claim stages — how far a claimed issue has actually got
    // ─────────────────────────────────────────────────────────────────────
    "stage.claimed": {
        label: "claimed",
        tip: "The issue is assigned and labelled in-progress, and nothing else exists yet — no worktree, no branch, no PR.",
    },
    "stage.worktree": {
        label: "worktree",
        tip: "A local worktree exists for the issue, so an agent got as far as starting. Nothing has been pushed.",
    },
    "stage.branch pushed": {
        label: "branch pushed",
        tip: "The branch reached the remote but no pull request was opened — the shape of a run that died between push and PR.",
    },
    "stage.PR open": {
        label: "PR open",
        tip: "A pull request exists and is waiting on review or on the merge-train.",
    },
    "stage.merging": {
        label: "merging",
        tip: "The pull request is being rebased, re-gated and merged. The only stage where the shared gate mutex is held on this issue's behalf.",
    },

    // ─────────────────────────────────────────────────────────────────────
    // Claim verdicts — whether a claim is still being worked
    // ─────────────────────────────────────────────────────────────────────
    "claim.live": {
        label: "live",
        tip: "Someone is plausibly still on it: the evidence on disk and on the remote is consistent with work in flight. Rendered as ·",
    },
    "claim.orphan": {
        label: "orphan",
        tip: "The claim is stale with nothing to show for it — no worktree, no branch, no PR — so the issue is held out of the queue by a run that is gone. Rendered as ×",
    },
    "claim.suspect": {
        label: "suspect",
        tip: "Something does not line up — artefacts exist but the claim is old, or they disagree with each other. Worth a look before unclaiming, not safe to reap automatically. Rendered as ?",
    },

    // ─────────────────────────────────────────────────────────────────────
    // Loop verdict — the one-line health call for the whole AFK loop
    // ─────────────────────────────────────────────────────────────────────
    "loop.NEEDS ATTENTION": {
        label: "needs attention",
        tip: "The loop is running but something is wrong that it cannot fix on its own — orphaned claims, failed reads, a queue it is not draining.",
    },
    "loop.STALLED": {
        label: "stalled",
        tip: "The driver is alive and armed but no pass has finished recently. Distinct from stopped: nothing asked it to halt.",
    },
    "loop.STOPPED": {
        label: "stopped",
        tip: "The driver was deliberately halted — a stop file is present, or it disarmed itself after hitting a budget or pass ceiling.",
    },
    "loop.RUNNING": {
        label: "running",
        tip: "The driver process is alive, armed, and passes are completing.",
    },
    "loop.IDLE": {
        label: "idle",
        tip: "No driver is running and nothing is wrong. The resting state, not a fault.",
    },

    // ─────────────────────────────────────────────────────────────────────
    // Loop-status panel abbreviations
    // ─────────────────────────────────────────────────────────────────────
    pct: {
        label: "budget used",
        tip: "Percentage of the weighted usage window the pass ended on, read back from `bun run usage:window`. Reads n/a when no budget ceiling is configured; the driver fails closed and stops if a configured ceiling cannot be read.",
    },
    pri: {
        label: "priority",
        tip: "The issue's Priority field on the project board — P0, P1, P2 — which is the queue's first sort key. An em dash means the board has no priority set.",
    },
    queue: {
        label: "queue depth",
        tip: "Issues labelled ready-for-agent before → after the pass. Unchanged across a pass is the tell for a loop that ran and drained nothing.",
    },

    // ─────────────────────────────────────────────────────────────────────
    // History per-role time and cost columns
    // ─────────────────────────────────────────────────────────────────────
    impl_min: {
        label: "implement minutes",
        tip: "Minutes of subagent wall clock spent implementing, summed across every implement run — not elapsed time, which is shorter when they run in parallel.",
    },
    impl_cost: {
        label: "implement cost",
        tip: "Dollars spent by implement subagents.",
    },
    impl_model: {
        label: "implement tier",
        tip: "The model the implement work actually ran on — the check on whether a spawn passed a tier or silently inherited the session's.",
    },
    rev_min: {
        label: "review minutes",
        tip: "Minutes of subagent wall clock spent reviewing.",
    },
    rev_cost: {
        label: "review cost",
        tip: "Dollars spent by review subagents.",
    },
    fixups: {
        label: "fixup rounds",
        tip: "How many times a pull request came back blocking and had to be handed to a fixup agent. Zero is the intended case; three is the shape of a missing producer census.",
    },
    fix_min: {
        label: "fixup minutes",
        tip: "Minutes of subagent wall clock spent on fixup rounds — time the issue cost beyond its first implementation.",
    },
    fix_cost: {
        label: "fixup cost",
        tip: "Dollars spent on fixup rounds.",
    },
    other_min: {
        label: "support minutes",
        tip: "Minutes of subagent wall clock that belonged to no named role — investigators, mapping runs, everything spawned in support of the work.",
    },
    other_cost: {
        label: "support cost",
        tip: "Dollars spent by support subagents.",
    },
    orch_cost: {
        label: "orchestrator cost",
        tip: "Dollars burned by the main thread itself — reading receipts, running the merge-train, holding the whole pass in context. Charged to no issue.",
    },
    wall_min: {
        label: "elapsed minutes",
        tip: "Minutes from the session's first message to its last. Always less than the role minutes summed, because subagents run in parallel.",
    },
    family: {
        label: "work family",
        tip: "The kind of work the issue was, grouped so unlike things are not averaged together.",
    },

    // ─────────────────────────────────────────────────────────────────────
    // History card subtitles (#2633) — the one-line question each chart
    // card answers. `label` doubles as the card's own heading (kept in sync
    // with the static `<h2>` in telemetry-dashboard.html); `tip` is the
    // subtitle sentence the card renders ahead of any per-query detail it
    // adds itself (stacking behaviour, "top 18, descending", …).
    // ─────────────────────────────────────────────────────────────────────
    "card.over-time": {
        label: "Over time",
        tip: "How the selected metric moved day by day.",
    },
    "card.ranking": {
        label: "Ranking",
        tip: "Which values of the current split-by dimension cost the most.",
    },
    "card.table": {
        label: "Table",
        tip: "Every metric for the current slice, side by side.",
    },
};

/**
 * Resolve a declared term to its glossary entry.
 *
 * Exact key first, then — for a qualified `"<scope>.<term>"` — the bare term.
 * So `spans.day` falls back to `day` (one meaning across all three tables)
 * while `agent_runs.messages` hits its own entry (a different meaning from
 * `llm.messages`).
 *
 * @param {string} term
 * @returns {GlossaryEntry | undefined}
 */
export function lookupTerm(term) {
    if (typeof term !== "string" || term === "") return undefined;
    const exact = Object.prototype.hasOwnProperty.call(GLOSSARY, term)
        ? GLOSSARY[term]
        : undefined;
    if (exact) return exact;
    const dot = term.indexOf(".");
    if (dot === -1) return undefined;
    const bare = term.slice(dot + 1);
    return Object.prototype.hasOwnProperty.call(GLOSSARY, bare)
        ? GLOSSARY[bare]
        : undefined;
}
