// The Combo Census (ADR 0164 § 2, issue #8417): per Combo Corpus entry, does
// the play Bot finish the combo from the assembled position?
//
// The position is the entry lowered to a `ScenarioSpec` and built by the blade's
// one builder (`buildPositionFromSpec`), so a census position and a blade
// position cannot be built two ways. The opponent passes throughout (the
// CR 732.2a shape): the reading isolates the Bot's own ability to finish from
// any interaction. Fixed iterations and fixed seeds, never the clock, so two
// runs on one tree print one report.
//
// It is a REPORT, never a gate and never a blade entry generator: a reading
// asserts nothing about the tree. `scripts/combos-census.ts` reads the corpus
// and hands the entries in; nothing here may reach the corpus file or the module
// describing it (`combo-corpus-seam.test.ts`), hence the structural slice below.

import { tryGetCardByName } from "../../../cards";
import { basicLandsForColors } from "../../../cards/colors";
import type { CardDefinition, Color } from "../../../cards/types";
import type { ScenarioCard, ScenarioSpec } from "../../../debugScenarioSpec";
import { enumerateMoves, type Move } from "../../moves";
import { makeRng } from "../../rng";
import {
    advanceToDecision,
    applyMoveInSearch,
    moveKey,
    searchWithTrace,
} from "../../search";
import type { GameState } from "../../state";
import { usesCard } from "../botReachTrace";
import { recordRepetition, type RepetitionHistory } from "../repetition";
import { buildPositionFromSpec } from "./build";
import { instanceIdsForName, seatPlayerId } from "./matcher";

/** The slice of a corpus entry the census reads. */
export type ComboCensusPiece = {
    readonly name: string;
    /** Spellbook zone letters, any one of which satisfies the piece. */
    readonly zones: readonly string[];
    readonly quantity: number;
    readonly state?: {
        readonly battlefield?: string;
        readonly usedFace?: number;
    };
};

export type ComboCensusEntry = {
    readonly id: string;
    readonly pieces: readonly ComboCensusPiece[];
    readonly produces: readonly string[];
    readonly manaNeeded: string;
};

// ── What the combo produces ─────────────────────────────────────────────────

/** Ordered strongest first: an entry takes the strongest of its features. */
export const PRODUCES_CLASSES = ["terminal", "lock", "non-terminal"] as const;
export type ProducesClass = (typeof PRODUCES_CLASSES)[number];

/** Spellbook feature names that end the game for an opponent. "Near-infinite
 *  damage to creatures" is deliberately absent: it kills no player. */
const TERMINAL_FEATURES: ReadonlySet<string> = new Set([
    "Win the game",
    "Each opponent loses the game",
    "Infinite damage",
    "Near-infinite damage",
    "Near-infinite damage to one opponent",
    "Near-infinite damage to all players",
    "Infinite lifeloss",
    "Infinite mill",
    "Infinite mill for target opponent",
    "Near-infinite mill",
]);

const LOCK_FEATURES: ReadonlySet<string> = new Set(["Lock"]);

/** The strongest class among `produces`; an unknown feature is non-terminal. */
export function classifyProduces(produces: readonly string[]): ProducesClass {
    if (produces.some((f) => TERMINAL_FEATURES.has(f))) return "terminal";
    if (produces.some((f) => LOCK_FEATURES.has(f))) return "lock";
    return "non-terminal";
}

// ── The position ────────────────────────────────────────────────────────────

/** Preference order among a piece's zones, so one entry always assembles one
 *  position. A Spellbook `C` (command zone) has no two-player meaning. */
const ZONE_BY_LETTER: readonly (readonly [
    string,
    NonNullable<ScenarioCard["zone"]>,
])[] = [
    ["B", "battlefield"],
    ["H", "hand"],
    ["G", "graveyard"],
    ["E", "exile"],
    ["L", "library"],
];

/** The seats' library, nonbasic, noncreature and nonwhite because the entries
 *  whose prerequisites name the library ask exactly that of it ("no basic lands
 *  in library", "no white cards", "no creature cards"). Its size sits under the
 *  nearest multiple of seven below a 20 life total for the same reason. */
const LIBRARY_FILLER = "Urza's Mine";
const LIBRARY_SIZE = 14;

const MANA_SYMBOL = /\{([^}]+)\}/g;
const COPY_STATE = /^as a copy of (.+)$/;

/** Colored pips by color plus the total, the two facts a land base must meet. */
type ManaNeed = { colored: Map<Color, number>; total: number };

function colorOfSymbol(symbol: string): Color | undefined {
    return (["W", "U", "B", "R", "G"] as const).find((c) =>
        symbol.split("/").includes(c)
    );
}

function needOfManaText(text: string): ManaNeed {
    const need: ManaNeed = { colored: new Map(), total: 0 };
    for (const [, symbol] of text.matchAll(MANA_SYMBOL)) {
        const generic = Number(symbol);
        if (Number.isInteger(generic)) {
            need.total += generic;
            continue;
        }
        if (symbol === "X") continue;
        const color = colorOfSymbol(symbol);
        if (color) {
            need.colored.set(color, (need.colored.get(color) ?? 0) + 1);
        }
        need.total += 1;
    }
    return need;
}

function needOfCost(def: CardDefinition): ManaNeed {
    const cost = def.manaCost ?? {};
    const need: ManaNeed = { colored: new Map(), total: 0 };
    for (const color of ["W", "U", "B", "R", "G"] as const) {
        const pips = cost[color] ?? 0;
        if (pips > 0) need.colored.set(color, pips);
        need.total += pips;
    }
    need.total +=
        (typeof cost.X === "number" ? cost.X : 0) +
        (cost.generic ?? 0) +
        (cost.C ?? 0);
    return need;
}

/** Two needs met by ONE land base: the larger of each, never the sum. */
function coverNeeds(a: ManaNeed, b: ManaNeed): ManaNeed {
    const colored = new Map(a.colored);
    for (const [color, pips] of b.colored) {
        colored.set(color, Math.max(colored.get(color) ?? 0, pips));
    }
    return { colored, total: Math.max(a.total, b.total) };
}

/** Two costs paid one after the other, unlike {@link coverNeeds}. */
function sumNeeds(a: ManaNeed, b: ManaNeed): ManaNeed {
    const colored = new Map(a.colored);
    for (const [color, pips] of b.colored) {
        colored.set(color, (colored.get(color) ?? 0) + pips);
    }
    return { colored, total: a.total + b.total };
}

/** The name a piece is placed under: a two-faced card's face the combo uses,
 *  else its front. `scenarioBuilder` places a modal back face up; a transforming
 *  back face has no card name, so its entry reads unmeasurable. */
function pieceCardName(piece: ComboCensusPiece): string {
    const [front, back] = piece.name.split(" // ");
    return piece.state?.usedFace === 2 && back ? back : front;
}

function pieceZone(piece: ComboCensusPiece): NonNullable<ScenarioCard["zone"]> {
    return (
        ZONE_BY_LETTER.find(([letter]) => piece.zones.includes(letter))?.[1] ??
        "battlefield"
    );
}

/** The land base: every colored pip its own basic, the rest cycling through the
 *  colors asked for (`basicLandsForColors` falls back to Plains for none). */
function landPlacements(need: ManaNeed): ScenarioCard[] {
    const lands: ScenarioCard[] = [];
    let placed = 0;
    for (const [color, pips] of need.colored) {
        const [name] = basicLandsForColors([color]);
        lands.push({ name, owner: "me", zone: "battlefield", count: pips });
        placed += pips;
    }
    const cycle = basicLandsForColors(need.colored.keys());
    for (let i = placed; i < need.total; i++) {
        lands.push({
            name: cycle[i % cycle.length],
            owner: "me",
            zone: "battlefield",
        });
    }
    return lands;
}

/** CR 303.4 / CR 704.5m — an Aura on the battlefield must enchant something
 *  or it falls off at the first state-based check, so a battlefield Aura piece
 *  is attached to the first other placement its enchant accepts. An Aura that
 *  enchants a card in a graveyard, or finds no host, stays unattached. */
function auraHost(
    def: CardDefinition,
    self: string,
    placed: readonly ScenarioCard[]
): string | undefined {
    if (!def.subtypes?.includes("Aura")) return undefined;
    const req = def.targetRequirement;
    if (!req || req.zone === "graveyard") return undefined;
    const accepted = Array.isArray(req.type) ? req.type : [req.type];
    return placed.find((candidate) => {
        if (candidate.name === self || candidate.zone !== "battlefield") {
            return false;
        }
        const types = tryGetCardByName(candidate.name)?.types ?? [];
        return types.some((t) => accepted.some((a) => a === t));
    })?.name;
}

/**
 * Lower an entry to the position it names: each piece in its zone under the
 * Bot's control, lands covering `manaNeeded`, the Bot holding priority in its
 * own precombat main.
 *
 * `manaNeeded` is unreliable on the casting half (a 143-placement census of the
 * corpus: a hand piece with a real cost and an empty `manaNeeded`, the mana left
 * to the prose "you have enough mana to cast it"), and a piece the land base
 * cannot pay for would read as a Bot miss. So the base covers `manaNeeded` AND
 * the hand pieces' own costs. Prose prerequisites are otherwise not read.
 *
 * Throws on a piece no card resolves to (`assemblyFailure` reads that first).
 */
export function comboPositionSpec(entry: ComboCensusEntry): ScenarioSpec {
    const cards = (name: string): CardDefinition => {
        const def = tryGetCardByName(name);
        if (!def) throw new Error(`${entry.id}: no card named "${name}"`);
        return def;
    };
    const handCost = entry.pieces
        .filter((p) => pieceZone(p) === "hand")
        .map((p) => needOfCost(cards(pieceCardName(p))))
        .reduce(sumNeeds, { colored: new Map(), total: 0 });
    const lands = landPlacements(
        coverNeeds(needOfManaText(entry.manaNeeded), handCost)
    );
    const pieces: ScenarioCard[] = entry.pieces.map((piece) => {
        const copyOf = COPY_STATE.exec(piece.state?.battlefield ?? "")?.[1];
        return {
            name: pieceCardName(piece),
            owner: "me",
            zone: pieceZone(piece),
            ...(piece.quantity > 1 ? { count: piece.quantity } : {}),
            ...(copyOf && tryGetCardByName(copyOf) ? { copyOf } : {}),
        };
    });
    const placed = [...pieces, ...lands];
    return {
        phase: "PRECOMBAT_MAIN",
        // `libraryCount` zero empties both seats' synthetic base library: the
        // filler below is the whole of each.
        libraryCount: 0,
        cards: [
            ...pieces.map((card) => {
                if (card.zone !== "battlefield") return card;
                const attachedTo = auraHost(
                    cards(card.name),
                    card.name,
                    placed
                );
                return attachedTo ? { ...card, attachedTo } : card;
            }),
            ...lands,
            ...(["me", "opp"] as const).map(
                (owner): ScenarioCard => ({
                    name: LIBRARY_FILLER,
                    owner,
                    zone: "library",
                    count: LIBRARY_SIZE,
                })
            ),
        ],
    };
}

// ── The play-out ────────────────────────────────────────────────────────────

/** What ended a play-out short of a win or the ply cap: a window nobody can
 *  answer (a choice kind with no generator), or an engine throw, which ends only
 *  this play-out, the way `runHeadlessGame` contains one. */
export type ComboHalt = "stall" | "engine-error";

export type ComboPlayOut = {
    won: boolean;
    /** Some Move the Bot chose used a piece of the combo. */
    touched: boolean;
    /** Decisions the Bot made: the unit of the ply cap. */
    plies: number;
    /** Every Move the Bot chose, keyed: what "two runs agree" is checked on. */
    line: string[];
    halt?: ComboHalt;
};

/** A guard on the opponent's own answers between two Bot decisions; a position
 *  that spins here is reported as a stall. */
const MAX_PASSIVE_ANSWERS = 500;

/** CR 732.2a shape: the passive seat passes, declares no block, and otherwise
 *  gives the first legal answer to a choice the engine owes it. */
function passiveMove(state: GameState, playerId: string): Move | undefined {
    const moves = enumerateMoves(state, playerId);
    return (
        moves.find((m) => m.kind === "pass") ??
        moves.find(
            (m) => m.kind === "declare-blockers" && m.assignments.length === 0
        ) ??
        moves[0]
    );
}

/** Why the builder refuses this entry's position, or undefined when it builds: a
 *  piece the catalogue has no card for (a corpus ahead of it, a transforming
 *  back face), an attachment the engine rejects. */
function assemblyFailure(entry: ComboCensusEntry): string | undefined {
    try {
        buildPositionFromSpec(comboPositionSpec(entry), undefined, entry.id);
        return undefined;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** Play one entry out at one budget and one seed. */
export function playOutCombo(
    entry: ComboCensusEntry,
    iterations: number,
    seed: number,
    plyCap: number
): ComboPlayOut {
    const state = buildPositionFromSpec(
        comboPositionSpec(entry),
        undefined,
        entry.id
    );
    const botId = seatPlayerId(state, "me");
    const pieceIds = entry.pieces.flatMap((p) => [
        ...instanceIdsForName(state, pieceCardName(p)),
    ]);
    const rng = makeRng(seed);
    let history: RepetitionHistory | undefined;
    let touched = false;
    const line: string[] = [];
    let passiveAnswers = 0;
    let halt: ComboHalt | undefined;
    try {
        while (!state.gameOver) {
            const decider = advanceToDecision(state);
            if (state.gameOver) break;
            if (decider === null) {
                halt = "stall";
                break;
            }
            if (decider !== botId) {
                const answer = passiveMove(state, decider);
                if (!answer || ++passiveAnswers > MAX_PASSIVE_ANSWERS) {
                    halt = "stall";
                    break;
                }
                applyMoveInSearch(state, decider, answer);
                continue;
            }
            // The cap is read here, at the Bot's next decision, so the last
            // Move it was allowed still resolves: a kill on the last ply counts.
            if (line.length >= plyCap) break;
            const move =
                searchWithTrace(
                    state,
                    botId,
                    { iterations },
                    Math.floor(rng() * 0x7fffffff),
                    undefined,
                    history
                ).move ?? enumerateMoves(state, botId)[0];
            if (!move) {
                halt = "stall";
                break;
            }
            touched ||= pieceIds.some((id) => usesCard(move, id));
            history = recordRepetition(history, state, botId, move);
            line.push(moveKey(move));
            applyMoveInSearch(state, botId, move);
            passiveAnswers = 0;
        }
    } catch {
        halt = "engine-error";
    }
    return {
        won: state.gameOver?.winnerId === botId,
        touched,
        plies: line.length,
        line,
        ...(halt ? { halt } : {}),
    };
}

// ── The reading ─────────────────────────────────────────────────────────────

export const COMBO_READINGS = [
    "Executable",
    "Initiated",
    "Untouched",
    "unmeasurable",
] as const;
export type ComboReading = (typeof COMBO_READINGS)[number];

export type ComboCensusRow = {
    id: string;
    pieces: string[];
    producesClass: ProducesClass;
    reading: ComboReading;
    /** The lowest budget at which every seed won: Executable rows only. */
    lowestBudget?: number;
    /** Why no reading was attempted: unmeasurable rows only. */
    unmeasurableBecause?: string;
    /** Play-outs a halt ended early, so the reading may understate the Bot. */
    halts?: number;
};

export type ComboCensusOptions = {
    /** Ascending: the first at which every seed wins is the row's budget. */
    budgets: readonly number[];
    seeds: readonly number[];
    plyCap: number;
};

/** The top budget is `difficulty.ts`'s `medium` preset, the default Bot, and the
 *  one below it a quarter of that, so a row's budget says how easily the combo
 *  falls. Two seeds, the first the blade's own default, so a win is not one lucky
 *  rollout. Sixteen Bot decisions are about one round: its whole first turn, with
 *  all the position's mana, and the opponent's turn. That also keeps a plain
 *  attack out of Executable unless one swing kills. */
export const COMBO_CENSUS_OPTIONS: ComboCensusOptions = {
    budgets: [100, 400],
    seeds: [0xb1ade, 0xc0b0],
    plyCap: 16,
};

/** Read one entry. Executable: every seed wins at some budget. Otherwise
 *  Initiated when any play-out used a piece, else Untouched. A non-terminal
 *  `produces` has nothing a play-out could read until the loop detector emits
 *  a certificate (ADR 0164 § 2), and a lock stays measured because the census is
 *  what surfaces it as Untouched (ADR 0164 § Consequences). */
export function censusEntry(
    entry: ComboCensusEntry,
    options: ComboCensusOptions = COMBO_CENSUS_OPTIONS
): ComboCensusRow {
    const row = {
        id: entry.id,
        pieces: entry.pieces.map((p) => p.name),
        producesClass: classifyProduces(entry.produces),
    };
    if (row.producesClass === "non-terminal") {
        return {
            ...row,
            reading: "unmeasurable",
            unmeasurableBecause: "no terminal outcome",
        };
    }
    const failure = assemblyFailure(entry);
    if (failure !== undefined) {
        return {
            ...row,
            reading: "unmeasurable",
            unmeasurableBecause: failure,
        };
    }
    let touched = false;
    let halts = 0;
    for (const iterations of options.budgets) {
        let allWon = true;
        for (const seed of options.seeds) {
            const out = playOutCombo(entry, iterations, seed, options.plyCap);
            touched ||= out.touched;
            if (out.halt) halts++;
            if (!out.won) {
                allWon = false;
                // Touched is settled: the remaining seeds could change nothing
                // this budget reads.
                if (touched) break;
            }
        }
        if (allWon) {
            return {
                ...row,
                reading: "Executable",
                lowestBudget: iterations,
                ...(halts > 0 ? { halts } : {}),
            };
        }
    }
    return {
        ...row,
        reading: touched ? "Initiated" : "Untouched",
        ...(halts > 0 ? { halts } : {}),
    };
}

/** One row per entry, in corpus order. `onRow` streams progress on a long run. */
export function collectComboCensus(
    entries: readonly ComboCensusEntry[],
    options: ComboCensusOptions = COMBO_CENSUS_OPTIONS,
    onRow?: (row: ComboCensusRow) => void
): ComboCensusRow[] {
    return entries.map((entry) => {
        const row = censusEntry(entry, options);
        onRow?.(row);
        return row;
    });
}

// ── The report ──────────────────────────────────────────────────────────────

type ClassCounts = Record<ComboReading, number> & { entries: number };

function emptyCounts(): ClassCounts {
    return {
        entries: 0,
        Executable: 0,
        Initiated: 0,
        Untouched: 0,
        unmeasurable: 0,
    };
}

export type ComboCensusSummary = {
    total: ClassCounts;
    byClass: Record<ProducesClass, ClassCounts>;
    /** Rows a halt touched, whatever their reading. */
    halted: number;
};

export function summarizeComboCensus(
    rows: readonly ComboCensusRow[]
): ComboCensusSummary {
    const summary: ComboCensusSummary = {
        total: emptyCounts(),
        byClass: {
            terminal: emptyCounts(),
            lock: emptyCounts(),
            "non-terminal": emptyCounts(),
        },
        halted: 0,
    };
    for (const row of rows) {
        for (const counts of [
            summary.total,
            summary.byClass[row.producesClass],
        ]) {
            counts.entries++;
            counts[row.reading]++;
        }
        if (row.halts) summary.halted++;
    }
    return summary;
}

function countsLine(label: string, counts: ClassCounts): string {
    const cells = COMBO_READINGS.map((r) => String(counts[r]).padStart(13));
    return `  ${label.padEnd(12)} ${String(counts.entries).padStart(7)}${cells.join("")}`;
}

/** The counts per reading and class: the head of the report, and what a PR
 *  pastes. No wall-clock, so two runs on one tree print the same bytes. */
export function formatComboCensusSummary(
    rows: readonly ComboCensusRow[],
    options: ComboCensusOptions = COMBO_CENSUS_OPTIONS
): string {
    const summary = summarizeComboCensus(rows);
    const header = COMBO_READINGS.map((r) => r.padStart(13)).join("");
    return [
        `== combo census (ADR 0164) — ${rows.length} entries, budgets ${options.budgets.join("/")}, ${options.seeds.length} seeds, ply cap ${options.plyCap}`,
        `  ${"class".padEnd(12)} ${"entries".padStart(7)}${header}`,
        ...PRODUCES_CLASSES.map((c) => countsLine(c, summary.byClass[c])),
        countsLine("total", summary.total),
        `  ${summary.halted} rows with a play-out a halt ended early`,
    ].join("\n");
}

function formatRow(row: ComboCensusRow): string {
    const budget = row.lowestBudget === undefined ? "-" : `${row.lowestBudget}`;
    const notes = [
        row.unmeasurableBecause,
        row.halts ? `${row.halts} halted` : undefined,
    ].filter((n) => n !== undefined);
    return [
        `  ${row.id}`,
        row.producesClass,
        row.reading,
        budget,
        row.pieces.join(" + "),
        ...(notes.length > 0 ? [`(${notes.join("; ")})`] : []),
    ].join("  ");
}

/** The whole report: the summary, then every row grouped by reading and, inside
 *  a reading, by class. Rows keep corpus order, so a re-run diffs by line. */
export function formatComboCensus(
    rows: readonly ComboCensusRow[],
    options: ComboCensusOptions = COMBO_CENSUS_OPTIONS
): string {
    const out = [formatComboCensusSummary(rows, options)];
    for (const reading of COMBO_READINGS) {
        const inReading = rows.filter((r) => r.reading === reading);
        out.push(`\n== ${reading} (${inReading.length})`);
        for (const producesClass of PRODUCES_CLASSES) {
            const group = inReading.filter(
                (r) => r.producesClass === producesClass
            );
            if (group.length === 0) continue;
            out.push(`-- ${producesClass} (${group.length})`);
            out.push(...group.map(formatRow));
        }
    }
    return out.join("\n");
}
