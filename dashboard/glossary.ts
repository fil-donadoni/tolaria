/**
 * The cockpit's glossary (#2629, rewritten for issue #5652) — one authority
 * for every caption the page prints.
 *
 * Every entry is `{ label, tip }`: a human label to render, and a sentence
 * saying what the figure COUNTS or MEANS and where it comes from — never a
 * restatement of its name. The figures are `scripts/lib/workflow-trends.ts`'s
 * (the weekly report's aggregation) and the machine readings'
 * (`telemetry:budget`, `telemetry:latency`); the tips name the same rules
 * `docs/guides/github-pipeline.md` § weekly-report documents.
 *
 * Zero imports, zero DOM: rendering lives in `components/Term.tsx`, whose `id`
 * is `TermId` — the literal union of this table's keys — so a typo is a
 * compile error rather than a tooltip that never appears.
 */

export interface GlossaryEntry {
    /** The human label rendered in place of the key. */
    label: string;
    /** What the term COUNTS or MEANS — never a restatement of its name. */
    tip: string;
}

export const GLOSSARY = {
    // Throughput
    merged: {
        label: "PRs merged",
        tip: "PRs merged into the base branch inside the window, whoever merged them.",
    },
    prsPerHour: {
        label: "PRs per hour",
        tip: "PRs merged divided by the window's hours, nights included — the number ADR 0154's 10 issues an hour is measured against.",
    },
    issuesNet: {
        label: "issues closed − opened",
        tip: "Issues closed minus issues opened in the window, from GitHub's search counts. Positive: the backlog shrank.",
    },
    ready: {
        label: "ready-for-agent",
        tip: "Open issues labelled `ready-for-agent` when the cockpit read GitHub: the queue the passes drain.",
    },
    drainDays: {
        label: "days to drain",
        tip: "`ready-for-agent` divided by the issues closed per day in the window, new issues excluded — ADR 0156's drain forecast.",
    },
    netDrainDays: {
        label: "days to drain, net",
        tip: "`ready-for-agent` divided by (closed − opened) per day: the forecast counting the issues that keep arriving. Blank when the backlog is not shrinking.",
    },
    // Failed landings
    failedRate: {
        label: "failed landings",
        tip: "`land-failed` episodes divided by every landing attempt that ended (merged PRs plus episodes). ADR 0156 Amendment I expects 5–10 %.",
    },
    episodes: {
        label: "episodes",
        tip: "One PR head failing for one reason, however many attempts it took: a re-label with no new push and the same cause is the same episode.",
    },
    attempts: {
        label: "landing attempts",
        tip: "Merged PRs plus failed-landing episodes in the window.",
    },
    // RED episodes
    redEpisodes: {
        label: "RED episodes",
        tip: "A RED `health` status on the base opens one; later REDs and AMBERs join it; the next GREEN closes it. INFRA decides nothing.",
    },
    stillRed: {
        label: "still RED",
        tip: "Episodes no GREEN has closed yet: their hours run to the window's end.",
    },
    ownerFree: {
        label: "closed without the owner",
        tip: "Share of the episodes closed with no RED of them reaching the RED ladder's stop rung (its owner issue). Target: at least 80 %.",
    },
    hoursToGreen: {
        label: "hours to green",
        tip: "Median / p90 hours from an episode's first RED to the GREEN that closed it. Target: p90 under 6 h.",
    },
    // Flaky tests
    flaky: {
        label: "flaky",
        tip: "A test file the queue's one re-run cured (`queue-lane`), or a health step a fresh run turned GREEN (`health`).",
    },
    flakyIssues: {
        label: "flaky issues filed",
        tip: "`Flaky test:` / `Flaky health step:` issues opened in the window.",
    },
    // Cost
    passes: {
        label: "passes",
        tip: "`afk-pass` runs that ended in the window, on every machine, read from each run's JSON record.",
    },
    passIssues: {
        label: "issues",
        tip: "Distinct issues those passes worked.",
    },
    passTotal: {
        label: "total",
        tip: "The passes' `total_cost_usd` summed — Claude's list-price figure, not a share of the subscription.",
    },
    perIssue: {
        label: "$ per issue",
        tip: "Median / p90 over issues of every pass of that issue summed.",
    },
    model: {
        label: "model",
        tip: "The model tier (opus, sonnet, fable, haiku) that drew most of the issue's weighted tokens across its passes; `(unrecorded)` when the passes recorded none.",
    },
    area: {
        label: "area",
        tip: "The issue's `area:*` label; `(none)` without one.",
    },
    allowanceShare: {
        label: "allowance share per issue",
        tip: "`telemetry:budget`: each `/next-ticket` issue's weighted tokens as a share of the declared weekly allowance, median / p90. Blank where no allowance is declared.",
    },
    // Latency
    passMinutes: {
        label: "minutes per pass",
        tip: "Median / p90 wall clock of the `afk-pass` runs, from their records.",
    },
    queueHours: {
        label: "hours in the queue",
        tip: "Median / p90 hours from a merged PR's last `ready-to-land` label to its merge.",
    },
    sessionMinutes: {
        label: "session minutes",
        tip: "`telemetry:latency`: median / p90 wall clock of the `/next-ticket` sessions on that machine.",
    },
    // Runners
    idle: {
        label: "idle",
        tip: "Online on GitHub and running no job: the next job for its labels goes here.",
    },
    busy: {
        label: "busy",
        tip: "Online and running a job.",
    },
    offline: {
        label: "offline",
        tip: "GitHub has not heard from it: the machine is off or asleep, or the runner is paused (`bun run runner status` on that machine).",
    },
} as const satisfies Record<string, GlossaryEntry>;

/** Every key the table declares. */
export type TermId = keyof typeof GLOSSARY;
