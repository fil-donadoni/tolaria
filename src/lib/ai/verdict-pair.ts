// The verdict quiz's Minimal Pair model: what a tester types, lowered into what
// the engine's derivation takes (issue #4800, PRD #4792, ADR 0148).
//
// A judge who rules a move wrong says WHICH wrong — always, or now — and for
// "now" names the Discriminant: the one factor whose change makes the same move
// right. `pairDerivation.ts` (issue #4795) copies the anchor's position with
// that factor changed; this module is the form's half of that call. It is PURE
// and imports only the derivation and the identity, never the engine's builder,
// which the browser loads on demand (`verdict-pair-build.ts`).
//
// ONE TABLE, NOT ONE FORM PER KIND. `PAIR_CHANGE_FIELDS` names the inputs each
// kind needs, and a single renderer draws them; `changeFromFields` is the
// matching reader. A new kind is a row here and an arm there — never a new
// component.

import type { ScenarioCard, ScenarioSpec } from "@convex/debugScenarioSpec";
import {
    verdictIdOf,
    type VerdictJudgement,
} from "@convex/gre/ai/verdicts/identity";
import {
    deriveRightHalfPosition,
    PairDerivationError,
    type DiscriminantChange,
    type PairPosition,
} from "@convex/gre/ai/verdicts/pairDerivation";
import {
    DISCRIMINANT_KINDS,
    type Discriminant,
    type DiscriminantKind,
    type VerdictCandidate,
    type VerdictClassification,
} from "@convex/gre/ai/verdicts/types";
import type { Phase } from "@convex/gre/types";
import { PHASE_GROUPS } from "~/lib/phase-labels";
import { QUIZ_SEAT, type VerdictQuiz } from "./verdict-quiz";

export { DISCRIMINANT_KINDS };
export type { Discriminant, DiscriminantKind };

/** What each kind means, in the words the picker shows. */
export const DISCRIMINANT_KIND_LABELS: Record<DiscriminantKind, string> = {
    card: "A card",
    step: "The step",
    life: "A life total",
    mana: "The mana available",
    stack: "The stack",
    sequence: "A move already made",
    other: "Other",
};

export type PairFieldRow = {
    key: string;
    label: string;
    input: "text" | "number" | "select" | "textarea";
    options?: { value: string; label: string }[];
    /** Shown only while another field holds one of these values. */
    when?: { key: string; in: string[] };
    placeholder?: string;
};

const seatOptions = [
    { value: "me", label: QUIZ_SEAT === "me" ? "Bot" : "Opponent" },
    { value: "opp", label: QUIZ_SEAT === "me" ? "Opponent" : "Bot" },
];

const ZONE_OPTIONS = ["battlefield", "hand", "graveyard", "exile", "library"];

const MANA_COLOURS = ["W", "U", "B", "R", "G", "C"] as const;

/** The inputs each kind needs. `other` has none: its prefill is the bare copy. */
export const PAIR_CHANGE_FIELDS: Record<
    Exclude<DiscriminantKind, "other">,
    PairFieldRow[]
> = {
    step: [
        {
            key: "phase",
            label: "Move the decision to",
            input: "select",
            options: PHASE_GROUPS.flatMap((group) =>
                group.steps.map((step) => ({
                    value: step.id,
                    label: step.label,
                }))
            ),
        },
        {
            key: "activePlayer",
            label: "Whose turn",
            input: "select",
            options: seatOptions,
        },
    ],
    card: [
        {
            key: "op",
            label: "Change",
            input: "select",
            options: [
                { value: "add", label: "Add a card" },
                { value: "remove", label: "Remove a card" },
            ],
        },
        { key: "name", label: "Card name", input: "text" },
        {
            key: "owner",
            label: "Owner",
            input: "select",
            options: seatOptions,
        },
        {
            key: "zone",
            label: "Zone",
            input: "select",
            options: ZONE_OPTIONS.map((zone) => ({ value: zone, label: zone })),
        },
    ],
    life: [
        { key: "seat", label: "Seat", input: "select", options: seatOptions },
        { key: "life", label: "Life total", input: "number" },
    ],
    mana: [
        { key: "seat", label: "Seat", input: "select", options: seatOptions },
        ...MANA_COLOURS.map(
            (colour): PairFieldRow => ({
                key: `mana${colour}`,
                label: `Floating ${colour}`,
                input: "number",
            })
        ),
    ],
    stack: [
        {
            key: "op",
            label: "Change",
            input: "select",
            options: [
                { value: "add", label: "Add an object" },
                { value: "remove", label: "Remove an object" },
                { value: "replace", label: "Replace an object" },
            ],
        },
        {
            key: "index",
            label: "Stack position (0 = first declared)",
            input: "number",
            when: { key: "op", in: ["remove", "replace"] },
        },
        {
            key: "itemKind",
            label: "Object",
            input: "select",
            options: [
                { value: "spell", label: "Spell" },
                { value: "ability", label: "Ability" },
                { value: "trigger", label: "Trigger" },
            ],
            when: { key: "op", in: ["add", "replace"] },
        },
        {
            key: "itemName",
            label: "Source name",
            input: "text",
            when: { key: "op", in: ["add", "replace"] },
        },
        {
            key: "itemController",
            label: "Controller",
            input: "select",
            options: seatOptions,
            when: { key: "op", in: ["add", "replace"] },
        },
    ],
    sequence: [
        {
            key: "steps",
            label: "The earlier move, as setup steps (JSON array)",
            input: "textarea",
            placeholder: '[{"kind":"cast","card":"Lightning Bolt"}]',
        },
    ],
};

/** The rows of `kind` that show for these values, in order. */
export function visibleFieldRows(
    kind: DiscriminantKind,
    fields: Record<string, string>
): PairFieldRow[] {
    if (kind === "other") return [];
    return PAIR_CHANGE_FIELDS[kind].filter(
        (row) =>
            row.when === undefined ||
            row.when.in.includes(fields[row.when.key] ?? "")
    );
}

/** The values a kind's form opens with: every select on its first option. */
export function initialFields(kind: DiscriminantKind): Record<string, string> {
    if (kind === "other") return {};
    const fields: Record<string, string> = {};
    for (const row of PAIR_CHANGE_FIELDS[kind]) {
        if (row.input === "select" && fields[row.key] === undefined) {
            fields[row.key] = row.options![0].value;
        }
    }
    return fields;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({
    ok: false,
    error,
});

const seatOf = (value: string | undefined): "me" | "opp" =>
    value === "opp" ? "opp" : "me";

function integerOf(
    raw: string | undefined,
    what: string,
    min = 0
): Parsed<number> {
    const text = (raw ?? "").trim();
    const value = Number(text);
    if (text === "" || !Number.isInteger(value) || value < min) {
        return fail(
            `${what} must be a whole number${min === 0 ? " (0 or more)" : ""}`
        );
    }
    return { ok: true, value };
}

/** The steps a `sequence` Discriminant is typed as: a non-empty JSON array of
 *  objects each naming a `kind`. What each step MEANS is the engine's to say —
 *  building the half runs them, and one that finds no purchase is reported. */
function stepsOf(raw: string | undefined): Parsed<DiscriminantChange> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw ?? "");
    } catch {
        return fail("The earlier move must be a JSON array of setup steps");
    }
    if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !parsed.every(
            (step) =>
                typeof step === "object" &&
                step !== null &&
                typeof (step as { kind?: unknown }).kind === "string"
        )
    ) {
        return fail(
            'The earlier move must be a non-empty array of steps, each with a "kind"'
        );
    }
    return {
        ok: true,
        value: {
            kind: "sequence",
            steps: parsed as Extract<
                DiscriminantChange,
                { kind: "sequence" }
            >["steps"],
        },
    };
}

/** The structured edit a kind's form describes, or why it does not yet. */
export function changeFromFields(
    kind: DiscriminantKind,
    fields: Record<string, string>
): Parsed<DiscriminantChange> {
    switch (kind) {
        case "other":
            return { ok: true, value: { kind: "other" } };
        case "step":
            return {
                ok: true,
                value: {
                    kind: "step",
                    phase: (fields.phase ?? "PRECOMBAT_MAIN") as Phase,
                    activePlayer: seatOf(fields.activePlayer),
                },
            };
        case "card": {
            const name = (fields.name ?? "").trim();
            if (name === "") return fail("Name the card");
            const zone = fields.zone as NonNullable<ScenarioCard["zone"]>;
            return {
                ok: true,
                value:
                    fields.op === "remove"
                        ? {
                              kind: "card",
                              op: "remove",
                              name,
                              owner: seatOf(fields.owner),
                              zone,
                          }
                        : {
                              kind: "card",
                              op: "add",
                              card: {
                                  name,
                                  owner: seatOf(fields.owner),
                                  zone,
                              },
                          },
            };
        }
        case "life": {
            const life = integerOf(fields.life, "The life total", -1000);
            if (!life.ok) return life;
            return {
                ok: true,
                value: {
                    kind: "life",
                    seat: seatOf(fields.seat),
                    life: life.value,
                },
            };
        }
        case "mana": {
            const pool: Record<string, number> = {};
            for (const colour of MANA_COLOURS) {
                const raw = fields[`mana${colour}`];
                if (raw === undefined || raw.trim() === "") continue;
                const amount = integerOf(raw, `Floating ${colour}`);
                if (!amount.ok) return amount;
                pool[colour] = amount.value;
            }
            return {
                ok: true,
                value: { kind: "mana", seat: seatOf(fields.seat), pool },
            };
        }
        case "stack": {
            if (fields.op === "remove") {
                const index = integerOf(fields.index, "The stack position");
                if (!index.ok) return index;
                return {
                    ok: true,
                    value: { kind: "stack", op: "remove", index: index.value },
                };
            }
            const name = (fields.itemName ?? "").trim();
            if (name === "") return fail("Name the stack object's source");
            const item = {
                kind: (fields.itemKind ?? "spell") as
                    | "spell"
                    | "ability"
                    | "trigger",
                name,
                controller: seatOf(fields.itemController),
            };
            if (fields.op === "replace") {
                const index = integerOf(fields.index, "The stack position");
                if (!index.ok) return index;
                return {
                    ok: true,
                    value: {
                        kind: "stack",
                        op: "replace",
                        index: index.value,
                        item,
                    },
                };
            }
            return {
                ok: true,
                value: { kind: "stack", op: "add", item },
            };
        }
        case "sequence":
            return stepsOf(fields.steps);
    }
}

/** What the Discriminant's `detail` says when the judge typed nothing: the
 *  concrete factor, read off the edit. `other` and `sequence` have no such
 *  reading — their `detail` is the judge's own words. */
function detailOfChange(change: DiscriminantChange): string {
    switch (change.kind) {
        case "card":
            return change.op === "add"
                ? `${change.card.name} added`
                : `${change.name} removed`;
        case "step":
            return (
                PHASE_GROUPS.flatMap((g) => g.steps).find(
                    (s) => s.id === change.phase
                )?.label ?? change.phase
            );
        case "life":
            return `${change.seat} life ${change.life}`;
        case "mana":
            return `${change.seat} mana ${Object.entries(change.pool)
                .map(([colour, n]) => `${n}${colour}`)
                .join("")}`;
        case "stack":
            return `stack ${change.op}`;
        case "sequence":
        case "other":
            return "";
    }
}

/** The Discriminant the judge named, or what is still missing. */
export function discriminantOf(
    kind: DiscriminantKind,
    typedDetail: string,
    change: DiscriminantChange
): Parsed<Discriminant> {
    const detail = typedDetail.trim() || detailOfChange(change);
    if (detail === "") {
        return fail(
            kind === "other"
                ? "Say in your own words what changes"
                : kind === "sequence"
                  ? "Say what the earlier move is"
                  : "Say what changes"
        );
    }
    return { ok: true, value: { kind, detail } };
}

/** The anchor's position, as a `PairPosition` the derivation copies. */
export function anchorPosition(quiz: VerdictQuiz): PairPosition {
    return { spec: quiz.spec, seat: QUIZ_SEAT };
}

/** The anchor, as the judgement the server will stamp — the same fields in the
 *  same vocabulary, so `verdictIdOf` here names the id `submit` stores. */
export function anchorJudgement(
    quiz: VerdictQuiz,
    wrongIndex: number,
    classification: VerdictClassification
): VerdictJudgement {
    return {
        spec: quiz.spec,
        seat: QUIZ_SEAT,
        candidates: quiz.candidates,
        answer: { kind: "forbidden", forbiddenIndexes: [wrongIndex] },
        classification,
    };
}

export const anchorIdOf = (
    quiz: VerdictQuiz,
    wrongIndex: number,
    classification: VerdictClassification
): string => verdictIdOf(anchorJudgement(quiz, wrongIndex, classification));

/** The prefilled right-hand position, or why the edit cannot be made. */
export function prefillRightHalf(
    quiz: VerdictQuiz,
    discriminant: Discriminant,
    change: DiscriminantChange
): Parsed<PairPosition> {
    try {
        return {
            ok: true,
            value: deriveRightHalfPosition(
                anchorPosition(quiz),
                discriminant,
                change
            ),
        };
    } catch (cause) {
        if (cause instanceof PairDerivationError) return fail(cause.message);
        throw cause;
    }
}

/** A spec with its card list replaced — the touch-up's result. */
export const withSpec = (
    position: PairPosition,
    spec: ScenarioSpec
): PairPosition => ({ ...position, spec });

/** A stored anchor, read back as what the half's build takes. */
export type AnchorToComplete = {
    quiz: VerdictQuiz;
    /** The candidate the anchor ruled out. */
    wrongIndex: number;
    /** The anchor's own Discriminant — the half's link must carry it verbatim,
     *  or the pair is incomplete (`minimalPair.ts`). */
    discriminant: Discriminant;
};

/**
 * Read a stored Conditional Verdict as the anchor of a half to write (ADR
 * 0148, issue #4801). The derivation and its build work on the quiz's position
 * — seat `me`, no setup steps, no decklist knowledge — so an anchor that
 * carries any of those (a bulk import, a cold judgement of an older record) is
 * refused with the reason rather than completed against a board it is not.
 */
export function anchorToComplete(
    judgement: VerdictJudgement
): Parsed<AnchorToComplete> {
    const { classification, answer } = judgement;
    if (classification?.kind !== "conditional") {
        return fail("only a Conditional Verdict is owed a right-hand half");
    }
    if (answer.kind !== "forbidden" || answer.forbiddenIndexes.length !== 1) {
        return fail("the anchor must rule exactly one move out");
    }
    const wrongIndex = answer.forbiddenIndexes[0];
    if (judgement.candidates[wrongIndex] === undefined) {
        return fail("the anchor names a move its position does not list");
    }
    if (
        judgement.seat !== QUIZ_SEAT ||
        (judgement.setup?.length ?? 0) > 0 ||
        (judgement.deckKnowledge?.length ?? 0) > 0
    ) {
        return fail(
            "this anchor carries setup steps or decklist knowledge, which a half cannot be derived from here"
        );
    }
    return {
        ok: true,
        value: {
            quiz: {
                spec: judgement.spec,
                candidates: judgement.candidates,
                botPickIndex: wrongIndex,
                dropped: [],
            },
            wrongIndex,
            discriminant: classification.discriminant,
        },
    };
}

/** What `verdicts.submit` takes to store a right-hand half: the position as
 *  derived, the candidates it offers, the judged move as the right one, and
 *  the link naming the anchor. ONE copy — the quiz and the missing-halves
 *  queue write the same judgement. */
export function rightHalfSubmission(
    position: PairPosition,
    built: { candidates: VerdictCandidate[]; rightIndex: number },
    anchorId: string,
    discriminant: Discriminant
) {
    return {
        spec: position.spec,
        ...(position.setup?.length ? { setup: position.setup } : {}),
        seat: position.seat,
        ...(position.deckKnowledge?.length
            ? { deckKnowledge: position.deckKnowledge }
            : {}),
        candidates: built.candidates,
        answer: {
            kind: "right" as const,
            rightIndexes: [built.rightIndex],
        },
        pairOf: { anchorId, discriminant },
    };
}

/** What `verdicts.submit` takes to DISAGREE with a right-hand half (ADR 0148,
 *  issue #4801, user story 13): the half's own position, the move it calls
 *  right ruled out instead. The answer is the tester's own word and says
 *  nothing about a pair, so it carries neither classification nor link — it is
 *  a different verdict at the half's position key, which is what makes the
 *  position a Contested Position for the existing Verdict Resolution. ONE copy:
 *  the cold judgement and the tester queue send the same thing. */
export function halfDisagreementSubmission(half: VerdictJudgement) {
    return {
        spec: half.spec,
        ...(half.setup?.length ? { setup: half.setup } : {}),
        seat: half.seat,
        ...(half.deckKnowledge?.length
            ? { deckKnowledge: half.deckKnowledge }
            : {}),
        candidates: half.candidates,
        answer: {
            kind: "forbidden" as const,
            forbiddenIndexes:
                half.answer.kind === "right" ? half.answer.rightIndexes : [],
        },
    };
}
