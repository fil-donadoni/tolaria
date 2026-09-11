// The lowering sweep: how many Bot decisions could a Verdict be filed on today,
// and what makes the rest unjudgeable (issue #3461, PRD #3397).
//
// WHY THIS EXISTS. The thirteen spec-widening issues filed before it all came
// from the same method — a tester hit a refusal in a live game, screenshotted
// it, someone read the prose. Six screenshots produced five distinct causes and
// three duplicates: that samples whatever happened to be on the board, and it
// cannot say which gap costs the most verdicts. The gap is mechanically
// enumerable, so this enumerates it.
//
// The one number is **the share of Bot decisions a verdict could be filed on**.
// Everything else here is the breakdown that orders the work:
//
//  * REFUSALS — `lowerDecision`'s frozen `VerdictRefusalKind`, the actual cause
//    of unjudgeability, one per decision;
//  * DROPPED — every `specFromState` message, normalised to its message CLASS
//    rather than its interpolated text, counted by the decisions it touched. A
//    dropped entry is lossiness, not necessarily a refusal: a decision can be
//    judgeable and still have lost the mana pool;
//  * RESIDUE — the non-allowlisted KEYS of the three state types, derived from
//    `scenarioBuilder`'s own allowlists rather than a hand-copied list, so a
//    field added to `GameState` tomorrow appears here without editing this
//    file. That is also this half's second use: a **drift alarm**, since a new
//    field added without a decision about the spec silently becomes a new
//    refusal cause, and here it becomes a line of output the first time it
//    fires.
//
// Determinism is the contract: fixed seeds, fixed `iterations`, never
// wall-clock. The same seeds print the same table, byte for byte.
//
// Not a gate and it holds no gate mutex — the runner is env-gated
// (`loweringSweep.bot.test.ts`, the `bun run selfplay` pattern), so `test:bot`
// collects it and skips it.

import {
    CARD_STATE_ALLOWLIST,
    GAME_STATE_ALLOWLIST,
    PLAYER_STATE_ALLOWLIST,
    specFromState,
} from "@convex/gre/scenarioBuilder";
import {
    lowerDecision,
    VERDICT_REFUSAL_KINDS,
    type VerdictRefusalKind,
} from "@convex/gre/ai/verdicts/lowering";
import { describeMove } from "@convex/gre/describeMove";
import { createInitialGameState } from "@convex/gre";
import {
    search,
    type GameState,
    type CardInstanceState,
    type PlayerState,
} from "@convex/gre";
import { presetToPlayerInput } from "./decks";
import { runHeadlessGame, type GameEndReason } from "./playGame";

/** The three state types the residue half walks, in report order. */
export type ResidueScope = "card" | "player" | "game";

/** The zones `specFromState` actually lowers card-by-card. A library is only
 *  ever COUNTED by the lowering, so its instances carry no residue anyone could
 *  act on and scanning them would drown the table in every drawable card. */
const LOWERED_ZONES = [
    "battlefield",
    "hand",
    "graveyard",
    "exile",
] as const satisfies readonly (keyof PlayerState)[];

export type LoweringSweepConfig = {
    /** Preset deck ids, one per seat. */
    deckA: string;
    deckB: string;
    /** How many games. Seeds are `seed + gameIndex`, so the set is fixed. */
    games: number;
    seed: number;
    /** ISMCTS budget, in ITERATIONS — never `timeMs`, which would make the
     *  table machine-dependent and the sweep unreproducible. */
    iterations: number;
};

/** One row of a ranked table: a cause, and the decisions it touched. */
export type SweepRow = {
    label: string;
    decisions: number;
};

export type LoweringSweepReport = {
    config: LoweringSweepConfig;
    games: number;
    /** How each game ended — a sweep whose games all hit a harness guard is
     *  measuring the guard, not the lowering, so the reason mix is reported. */
    endReasons: Record<string, number>;
    /** Every SEARCHED decision, across all games: one per node where the
     *  harness asked `search` for a move and got one back. Two kinds of node
     *  are therefore NOT in this denominator — a resolution node (discard,
     *  scry, may-pay: driven by `chooseResolution`, never by the search) and a
     *  node where `search` returned null and the harness fell back to the only
     *  enumerated move. The second would have lowered as `single-candidate`,
     *  so excluding it makes the judgeable share read slightly HIGH; it is
     *  excluded anyway because a forced move is not a decision a Verdict could
     *  state a preference about. Mulligan keep/mull nodes ARE included — they
     *  are searched, ~4 per game, and they are why `no-decision-owed` has a
     *  small non-zero floor. */
    decisions: number;
    /** …of which a Verdict could be filed on. THE number. */
    judgeable: number;
    /** One entry per {@link VerdictRefusalKind}, zeros included: a kind that
     *  never fires is a finding, and it disappears if the table only carries
     *  what it saw. */
    refusals: Record<VerdictRefusalKind, number>;
    /** `specFromState` message classes, by decisions touched. */
    dropped: SweepRow[];
    /** Non-allowlisted state keys, by decisions touched, per scope. */
    residue: Record<ResidueScope, SweepRow[]>;
};

/** What one decision contributed — the unit the sweep accumulates, exposed so
 *  it can be tested without running a game. */
export type DecisionObservation = {
    /** `null` when the decision is judgeable. */
    refusal: VerdictRefusalKind | null;
    /** Message CLASSES, deduplicated: a decision that drops four cards' worth
     *  of the same residue shape is ONE decision the class made lossy, not
     *  four, or a wide board would outvote a systematic gap. */
    droppedClasses: string[];
    /** Residue keys, deduplicated per scope, same reasoning. */
    residue: Record<ResidueScope, string[]>;
};

/** The class a `dropped[]` message belongs to: the message with every
 *  interpolation masked.
 *
 *  Deliberately GENERIC — a mask per interpolation SHAPE, never a table of the
 *  37 message texts, which would be a hand-copied list that rots the next time
 *  someone adds a `dropped.push`. A new message classifies itself the first
 *  time it fires, which is exactly what the drift alarm needs.
 *
 *  Order matters: quotes first (a quoted phase name must not survive into the
 *  paren mask), the card-label prefix while its own parentheses are still
 *  there, then parentheses, then the numeric shapes.
 *
 *  ONE site deliberately splits: the `priority:` message interpolates a whole
 *  CLAUSE ("held by the active player, with a pass already banked" vs "held by
 *  the non-active player"), and those are two different facts about the
 *  position, not two renderings of one. They stay two rows. */
export function droppedMessageClass(message: string): string {
    let out = message.replace(/"[^"]*"/g, '"…"');
    // `Grizzly Bears (opp, graveyard): …` — the per-card prefix `lowerCard`
    // builds. Masked whole: the card NAME is the single most interpolated
    // token in the whole report and says nothing about the class.
    const card =
        /^.+? \((?:me|opp)(?:, (?:battlefield|hand|graveyard|exile))?\): /;
    if (card.test(out)) {
        out = out.replace(card, "<card>: ");
    } else {
        out = out.replace(/^(me|opp)\b/, "<seat>");
    }
    // Innermost-out, so nested parentheses collapse to one mask.
    let previous: string;
    do {
        previous = out;
        out = out.replace(/\([^()]*\)/g, "(…)");
    } while (out !== previous);
    // A slash-joined field list (`reportCharacteristicDrift`'s
    // `drifted.join("/")`) — one site that would otherwise rank as up to
    // fifteen separate causes, one per subset of the characteristics that
    // drifted.
    out = out.replace(/\b\w+(?:\/\w+)+\b/g, "<fields>");
    // Engine constants (phase names, …) — `A_B` shaped, so no English word can
    // be caught by accident.
    out = out.replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, "<CONST>");
    // A floating mana pool prints as its own contents (`2R 1G`), which would
    // otherwise be one class per colour combination.
    out = out.replace(/(?:\b\d+[WUBRGC]\b\s*)+/g, "<mana> ");
    return out.replace(/\d+/g, "N").replace(/\s+/g, " ").trim();
}

/** Keys present on `value` that no allowlist accounts for — the same
 *  complement `reportCardResidue` / `reportPlayerStateResidue` /
 *  `reportGameStateResidue` report, re-derived from the allowlists themselves
 *  so this file holds no copy of them. */
function residueKeys(value: object, allowlist: ReadonlySet<string>): string[] {
    return Object.keys(value).filter(
        (key) =>
            !allowlist.has(key) &&
            (value as Record<string, unknown>)[key] !== undefined
    );
}

/** Observe ONE decision: is it judgeable, what did the lowering drop, and what
 *  state does no allowlist cover. Pure. */
export function observeDecision(
    state: GameState,
    botId: string,
    chosenDescription: string
): DecisionObservation {
    const outcome = lowerDecision(state, botId, chosenDescription);

    // The dropped tally is taken from `specFromState` DIRECTLY, not from the
    // refusal's own `dropped`: `stack-not-empty` refuses before the lowering
    // ever runs, and reading its (empty) list would make that refusal look
    // lossless.
    const droppedClasses = new Set<string>();
    try {
        for (const message of specFromState(state, { mySeatId: botId })
            .dropped) {
            droppedClasses.add(droppedMessageClass(message));
        }
    } catch (error) {
        droppedClasses.add(
            `<specFromState threw> ${droppedMessageClass(
                error instanceof Error ? error.message : `${error}`
            )}`
        );
    }

    const card = new Set<string>();
    const player = new Set<string>();
    for (const seat of state.players) {
        for (const key of residueKeys(seat, PLAYER_STATE_ALLOWLIST)) {
            player.add(key);
        }
        for (const zone of LOWERED_ZONES) {
            for (const instance of seat[zone] as CardInstanceState[]) {
                for (const key of residueKeys(instance, CARD_STATE_ALLOWLIST)) {
                    card.add(key);
                }
            }
        }
    }

    return {
        refusal: outcome.ok ? null : outcome.kind,
        droppedClasses: [...droppedClasses],
        residue: {
            card: [...card],
            player: [...player],
            game: residueKeys(state, GAME_STATE_ALLOWLIST),
        },
    };
}

/** Accumulates observations into a report. Separate from the game loop so a
 *  test can feed it hand-built observations. */
export class LoweringSweepTally {
    private decisions = 0;
    private judgeable = 0;
    private readonly refusals = Object.fromEntries(
        VERDICT_REFUSAL_KINDS.map((kind) => [kind, 0])
    ) as Record<VerdictRefusalKind, number>;
    private readonly dropped = new Map<string, number>();
    private readonly residue: Record<ResidueScope, Map<string, number>> = {
        card: new Map(),
        player: new Map(),
        game: new Map(),
    };
    private readonly endReasons = new Map<string, number>();
    private games = 0;

    add(observation: DecisionObservation): void {
        this.decisions += 1;
        if (observation.refusal === null) this.judgeable += 1;
        else this.refusals[observation.refusal] += 1;
        for (const label of observation.droppedClasses) {
            bump(this.dropped, label);
        }
        for (const scope of ["card", "player", "game"] as const) {
            for (const key of observation.residue[scope]) {
                bump(this.residue[scope], key);
            }
        }
    }

    endGame(reason: GameEndReason): void {
        this.games += 1;
        bump(this.endReasons, reason);
    }

    report(config: LoweringSweepConfig): LoweringSweepReport {
        return {
            config,
            games: this.games,
            endReasons: Object.fromEntries(
                [...this.endReasons].sort(byCountThenLabel)
            ),
            decisions: this.decisions,
            judgeable: this.judgeable,
            refusals: { ...this.refusals },
            dropped: rank(this.dropped),
            residue: {
                card: rank(this.residue.card),
                player: rank(this.residue.player),
                game: rank(this.residue.game),
            },
        };
    }
}

function bump(counter: Map<string, number>, key: string): void {
    counter.set(key, (counter.get(key) ?? 0) + 1);
}

/** Count descending, then label ascending — a total order, so two runs of the
 *  same seeds print the same rows in the same sequence. */
function byCountThenLabel(a: [string, number], b: [string, number]): number {
    return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

function rank(counter: Map<string, number>): SweepRow[] {
    return [...counter]
        .sort(byCountThenLabel)
        .map(([label, decisions]) => ({ label, decisions }));
}

/**
 * Play `config.games` deterministic self-play games and observe EVERY Bot
 * decision on the way.
 *
 * The observation hook is the harness's own injectable `searchFn`: it runs the
 * production `search`, then lowers the position the search just decided on.
 * That keeps `playGame.ts` untouched — the loop the sweep measures is the loop
 * self-play already runs, with nothing added for measurement's sake.
 */
export function runLoweringSweep(
    config: LoweringSweepConfig
): LoweringSweepReport {
    const tally = new LoweringSweepTally();
    for (let game = 0; game < config.games; game++) {
        const seed = config.seed + game;
        const players = [
            presetToPlayerInput(config.deckA, 0, "A"),
            presetToPlayerInput(config.deckB, 1, "B"),
        ];
        const state = createInitialGameState(players, seed);
        const observing: typeof search = (
            position,
            playerId,
            budget,
            searchSeed,
            knowledge
        ) => {
            const move = search(
                position,
                playerId,
                budget,
                searchSeed,
                knowledge
            );
            if (move) {
                tally.add(
                    observeDecision(
                        position,
                        playerId,
                        describeMove(move, position)
                    )
                );
            }
            return move;
        };
        const result = runHeadlessGame(
            state,
            { id: "A", budget: { iterations: config.iterations } },
            { id: "B", budget: { iterations: config.iterations } },
            seed,
            observing
        );
        tally.endGame(result.reason);
    }
    return tally.report(config);
}

/** The ranked table, as text. Pure — a caller prints it. */
export function formatLoweringReport(report: LoweringSweepReport): string {
    const { config } = report;
    const lines: string[] = [
        "LOWERING SWEEP (issue #3461) — which Bot decisions can carry a Verdict",
        `  decks     ${config.deckA} vs ${config.deckB}`,
        `  games     ${report.games} (seeds ${config.seed}..${config.seed + config.games - 1}, ${config.iterations} iterations)`,
        `  ended     ${Object.entries(report.endReasons)
            .map(([reason, count]) => `${reason}=${count}`)
            .join(" ")}`,
        "",
        `  JUDGEABLE ${report.judgeable} / ${report.decisions} decisions (${share(report.judgeable, report.decisions)})`,
        "",
        "  Headless self-play is a PERFECT-INFORMATION corpus: no hand carries",
        "  PLACEHOLDER_CARD_ID, so the hidden-hand note and the `lowering-threw`",
        "  refusal it drives are structurally absent here. This share is the",
        "  engine's ceiling, not the debug panel's success rate in a browser.",
        "",
    ];

    const refusalRows = VERDICT_REFUSAL_KINDS.map((kind) => ({
        label: kind,
        decisions: report.refusals[kind],
    })).sort(
        (a, b) =>
            b.decisions - a.decisions ||
            (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    );

    lines.push(
        ...section(
            "REFUSALS — why a decision could not become a Verdict (FIRST cause only)",
            refusalRows,
            report.decisions
        )
    );
    lines.push(
        "  A refusal is the first check that fired, in `lowerDecision`'s own",
        "  order — so a zero here means 'never the first cause', never 'never",
        "  present'. What is PRESENT is the DROPPED table below, which is taken",
        "  from `specFromState` directly on every decision, refused or not.",
        ""
    );
    lines.push(
        ...section(
            "DROPPED — specFromState message classes, by decisions touched",
            report.dropped,
            report.decisions
        )
    );
    lines.push(
        "  The three `live-only state not captured` rows are the RESIDUE tables",
        "  below, rolled up with their keys masked away — read them there, not",
        "  as three separate causes at the top of this one.",
        ""
    );
    for (const scope of ["game", "player", "card"] as const) {
        lines.push(
            ...section(
                `RESIDUE (${scope}) — keys no allowlist covers, by decisions touched`,
                report.residue[scope],
                report.decisions
            )
        );
    }
    return lines.join("\n");
}

function section(title: string, rows: SweepRow[], total: number): string[] {
    const lines = [title];
    if (rows.length === 0) {
        lines.push("  (none)", "");
        return lines;
    }
    for (const row of rows) {
        lines.push(
            `  ${String(row.decisions).padStart(7)}  ${share(
                row.decisions,
                total
            ).padStart(6)}  ${row.label}`
        );
    }
    lines.push("");
    return lines;
}

function share(count: number, total: number): string {
    return total === 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;
}
