import {
    countArtifactsControlled,
    countDomain,
    countGraveyardCardTypes,
    DELIRIUM_CARD_TYPES,
    METALCRAFT_ARTIFACTS,
    THRESHOLD_CARDS,
    type EmblemInstance,
    type StaticEffectStateView,
} from "@convex/cards/types";
import { countDevotion } from "@convex/gre/layers";
import { COLOR_WORD_TO_CODE } from "@convex/gre/textChanges";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
import { toLayerState, type LayerPlayersInput } from "~/lib/effective-stats";

// Live counts for the count-based ability words of a card's oracle text
// (issue #5491). Ability words (CR 207.2c) carry no rules meaning of their
// own — they prefix a clause whose on/off state hangs on a number the player
// would otherwise count by hand. The card preview splices that number, for
// the card's controller, in a chip right after the word.
//
// ONE table drives both the preview builder and the oracle renderer: adding a
// word is adding a row, never a regex alternative or a union branch. Every
// count is the ENGINE's own pure function (ADR 0074: the client may import
// pure engine modules, never re-derive a rule), so a chip cannot disagree with
// the value the engine resolves against.

/** What the count is measured against. `atLeast` — the clause is on from `n`
 *  up (Delirium 4, Threshold 7); `atMost` — on from `n` down (Hellbent 0);
 *  `cap` — the count saturates at `n` (Domain 5). No goal = uncapped
 *  (Devotion): the chip shows the bare number with no met/unmet tone. */
export type AbilityWordGoal =
    | { atLeast: number }
    | { atMost: number }
    | { cap: number };

/** The controller-scoped board the count functions read. */
type CounterInput = {
    state: StaticEffectStateView;
    controllerId: string;
    /** The exact oracle text the row's pattern matched ("devotion to blue"),
     *  for a row whose count depends on a word inside its own phrase. */
    matched: string;
};

export type AbilityWordCounterRow = {
    /** Stable identity — the chip's `data-ability-word` and the per-paragraph
     *  one-chip-per-row key. */
    key: string;
    /** Regex SOURCE for the printed word or phrase, case-sensitive (the
     *  capitalized ability word, never lowercase reminder text). Kept as a
     *  string: a shared global `RegExp` carries a mutable `lastIndex` a React
     *  component cannot scan (React Compiler immutability). */
    pattern: string;
    /** Printed oracle forms the pattern must match — the guard that a row's
     *  pattern is not dead (`ability-word-counters.test.ts`). */
    oracleForms: readonly string[];
    goal?: AbilityWordGoal;
    /** The engine's count. ABSENT on a placeholder row: the word is declared
     *  with its goal but renders no chip until the mechanic gets an engine
     *  count — supplying this function is the whole activation. */
    count?: (input: CounterInput) => number;
    /** The count reads the matched text (Devotion's colour), so each distinct
     *  match is its own chip; otherwise one chip per row per paragraph (a
     *  Domain paragraph naming both the word and its phrase chips once). */
    perMatch?: true;
};

/** One computed counter, as the chip renders it. */
export type AbilityWordCounter = {
    key: string;
    /** One chip per `chipId` per paragraph — the row key, or the matched text
     *  for a `perMatch` row. */
    chipId: string;
    have: number;
    goal?: AbilityWordGoal;
    /** `null` for an uncapped count — there is no threshold to meet. */
    met: boolean | null;
};

/** THE table. Active rows carry `count`; placeholder rows only their word and
 *  goal (issue #5491 § Placeholder rows). */
export const ABILITY_WORD_COUNTERS: readonly AbilityWordCounterRow[] = [
    {
        // Domain — basic land types among lands you control (CR 305.6), 0–5.
        // Also the same count printed without the ability word.
        key: "domain",
        pattern: "Domain|basic land types? among lands you control",
        oracleForms: [
            "Domain — Tribal Flames deals X damage to any target, where X is the number of basic land types among lands you control.",
            "This spell costs {2} less to cast for each basic land type among lands you control.",
        ],
        goal: { cap: 5 },
        count: ({ state, controllerId }) => countDomain(state, controllerId),
    },
    {
        // Devotion to a single colour (CR 700.5) — uncapped. The two-colour
        // form is refused by the lookahead: the engine counts one colour only.
        key: "devotion",
        pattern:
            "[Dd]evotion to (?:white|blue|black|red|green)\\b(?! and (?:white|blue|black|red|green))",
        oracleForms: [
            "Look at the top X cards of your library, where X is your devotion to blue.",
        ],
        count: ({ state, controllerId, matched }) => {
            const word = matched.split(" ").at(-1)!;
            return countDevotion(state, controllerId, COLOR_WORD_TO_CODE[word]);
        },
        perMatch: true,
    },
    {
        key: "metalcraft",
        pattern: "Metalcraft",
        oracleForms: [
            "Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.",
        ],
        goal: { atLeast: METALCRAFT_ARTIFACTS },
        count: ({ state, controllerId }) =>
            countArtifactsControlled(state, controllerId),
    },
    {
        key: "delirium",
        pattern: "Delirium",
        oracleForms: [
            "Delirium — Unholy Heat deals 6 damage instead if there are four or more card types among cards in your graveyard.",
        ],
        goal: { atLeast: DELIRIUM_CARD_TYPES },
        count: ({ state, controllerId }) =>
            countGraveyardCardTypes(graveyardOf(state, controllerId)),
    },
    {
        key: "threshold",
        pattern: "Threshold",
        oracleForms: [
            "Threshold — Nimble Mongoose gets +2/+2 as long as seven or more cards are in your graveyard.",
        ],
        goal: { atLeast: THRESHOLD_CARDS },
        count: ({ state, controllerId }) =>
            graveyardOf(state, controllerId).length,
    },
    // Placeholder rows — declared, no engine count yet, so no chip.
    {
        key: "spell-mastery",
        pattern: "Spell mastery",
        oracleForms: [
            "Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, you gain 2 life.",
        ],
        goal: { atLeast: 2 },
    },
    {
        key: "descend-4",
        pattern: "Descend 4",
        oracleForms: [
            "Descend 4 — This creature gets +2/+0 as long as there are four or more permanent cards in your graveyard.",
        ],
        goal: { atLeast: 4 },
    },
    {
        key: "descend-8",
        pattern: "Descend 8",
        oracleForms: [
            "Descend 8 — This creature has flying as long as there are eight or more permanent cards in your graveyard.",
        ],
        goal: { atLeast: 8 },
    },
    {
        key: "hellbent",
        pattern: "Hellbent",
        oracleForms: [
            "Hellbent — This creature gets +2/+0 as long as you have no cards in hand.",
        ],
        goal: { atMost: 0 },
    },
    {
        key: "fateful-hour",
        pattern: "Fateful hour",
        oracleForms: [
            "Fateful hour — If you have 5 or less life, draw a card.",
        ],
        goal: { atMost: 5 },
    },
    {
        key: "formidable",
        pattern: "Formidable",
        oracleForms: [
            "Formidable — {1}{G}: Target creature gains trample. Activate only if creatures you control have total power 8 or greater.",
        ],
        goal: { atLeast: 8 },
    },
    {
        key: "coven",
        pattern: "Coven",
        oracleForms: [
            "Coven — At the beginning of combat on your turn, if you control three or more creatures with different powers, draw a card.",
        ],
        goal: { atLeast: 3 },
    },
    {
        key: "ferocious",
        pattern: "Ferocious",
        oracleForms: [
            "Ferocious — When this creature enters, if you control a creature with power 4 or greater, draw a card.",
        ],
        goal: { atLeast: 4 },
    },
    {
        key: "corrupted",
        pattern: "Corrupted",
        oracleForms: [
            "Corrupted — This creature gets +2/+2 as long as an opponent has three or more poison counters.",
        ],
        goal: { atLeast: 3 },
    },
    {
        key: "party",
        pattern: "your party",
        oracleForms: ["Draw a card for each creature in your party."],
        goal: { cap: 4 },
    },
];

/** Regex SOURCE matching any row's word or phrase — one alternation built from
 *  the table, so the renderer never names a word itself. */
export const ABILITY_WORD_SOURCE = `\\b(?:${ABILITY_WORD_COUNTERS.map(
    (row) => row.pattern
).join("|")})\\b`;

/** Each row's pattern anchored to a whole match. Non-global, so `.test()`
 *  keeps no `lastIndex` state and the instances are safe to share. */
const ANCHORED_ROWS = ABILITY_WORD_COUNTERS.map(
    (row) => [new RegExp(`^(?:${row.pattern})$`), row] as const
);

/** The row whose own pattern spans the WHOLE matched text. */
export function rowForMatch(
    matched: string
): AbilityWordCounterRow | undefined {
    return ANCHORED_ROWS.find(([re]) => re.test(matched))?.[1];
}

function graveyardOf(
    state: StaticEffectStateView,
    controllerId: string
): StaticEffectStateView["players"][number]["graveyard"] {
    return state.players.find((p) => p.id === controllerId)?.graveyard ?? [];
}

function isMet(have: number, goal: AbilityWordGoal | undefined) {
    if (!goal) return null;
    if ("atMost" in goal) return have <= goal.atMost;
    return have >= ("atLeast" in goal ? goal.atLeast : goal.cap);
}

/** The chip's text: `have/goal` against a threshold or cap, the bare count
 *  when uncapped (Devotion). */
export function formatAbilityWordCounter(counter: AbilityWordCounter): string {
    const goal = counter.goal;
    if (!goal) return String(counter.have);
    if ("atMost" in goal) return `${counter.have}/≤${goal.atMost}`;
    return `${counter.have}/${"atLeast" in goal ? goal.atLeast : goal.cap}`;
}

/** Computes, for `controllerId`, every active counter the paragraphs name —
 *  keyed by the exact matched text so the renderer resolves an occurrence to
 *  its counter. `null` when no paragraph names an active row (no chip, and no
 *  board projection paid for), or when `controllerId` is not a seat of
 *  `players` (no board to count — no chip rather than a false zero). */
export function computeAbilityWordCounters(
    paragraphs: readonly string[],
    players: LayerPlayersInput,
    controllerId: string,
    emblems?: EmblemInstance[],
    continuousEffects?: readonly ContinuousEffect[]
): Map<string, AbilityWordCounter> | null {
    if (!players.some((p) => p.id === controllerId)) return null;
    let state: StaticEffectStateView | null = null;
    const counters = new Map<string, AbilityWordCounter>();
    for (const text of paragraphs) {
        for (const match of text.matchAll(
            new RegExp(ABILITY_WORD_SOURCE, "g")
        )) {
            const matched = match[0];
            if (counters.has(matched)) continue;
            const row = rowForMatch(matched);
            if (!row?.count) continue;
            state ??= toLayerState(players, emblems, continuousEffects);
            const have = row.count({ state, controllerId, matched });
            counters.set(matched, {
                key: row.key,
                chipId: row.perMatch ? matched : row.key,
                have,
                goal: row.goal,
                met: isMet(have, row.goal),
            });
        }
    }
    return counters.size > 0 ? counters : null;
}
