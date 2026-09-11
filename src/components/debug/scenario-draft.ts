import type { ScenarioCard, ScenarioSpec } from "@convex/debugScenarioSpec";

/** One counter row in the card editor — kept as strings while editing. */
export type CounterDraft = { type: string; count: string };

/** Editable form representation of a `ScenarioCard`. Numeric fields live as raw
 *  strings so a field can be transiently empty; `counters` is an ordered list
 *  (a `Record` is awkward to edit key-by-key). `draftToCard` collapses it back
 *  to a clean `ScenarioCard`, omitting empty/default fields so the saved spec
 *  stays minimal. */
export type CardDraft = {
    name: string;
    owner: "me" | "opp";
    /** CR 111 / 707.2 — this row places a TOKEN: `name` is then a token
     *  catalogue key, and the placement is battlefield-only. */
    token: boolean;
    zone: NonNullable<ScenarioCard["zone"]>;
    count: string;
    tapped: boolean;
    summoningSick: boolean;
    counters: CounterDraft[];
    damageMarked: string;
    attachedTo: string;
    copyOf: string;
    position: string;
    faceDown: boolean;
    faceDownExile: boolean;
    castableFromExile: boolean;
    /** CR 305.9 (issue #1689) — only meaningful alongside `castableFromExile`;
     *  true stages the LAND-INCLUSIVE grant shape (Headliner Scarlett /
     *  Expressive Iteration: "you may PLAY that card"), false/omitted stages
     *  the cast-only shape (Ice Cauldron / Robber of the Rich / Ragavan)
     *  under which a land in exile gets no play (or cast) affordance. */
    castableFromExileIncludesLand: boolean;
    attackedLastTurn: boolean;
};

/** A fresh, empty card row (defaults to a battlefield permanent the player
 *  controls — the most common placement). */
export function emptyCardDraft(): CardDraft {
    return {
        name: "",
        owner: "me",
        token: false,
        zone: "battlefield",
        count: "1",
        tapped: false,
        summoningSick: false,
        counters: [],
        damageMarked: "",
        attachedTo: "",
        copyOf: "",
        position: "",
        faceDown: false,
        faceDownExile: false,
        castableFromExile: false,
        castableFromExileIncludesLand: false,
        attackedLastTurn: false,
    };
}

/** Inflate a stored `ScenarioCard` back into an editable draft (inverse of
 *  `draftToCard`) so an existing scenario can be opened in the form. Missing
 *  optionals fall back to the same defaults `emptyCardDraft` uses. */
export function cardToDraft(card: ScenarioCard): CardDraft {
    return {
        name: card.name,
        owner: card.owner,
        token: card.token ?? false,
        zone: card.zone ?? "battlefield",
        count: card.count !== undefined ? String(card.count) : "1",
        tapped: card.tapped ?? false,
        summoningSick: card.summoningSick ?? false,
        counters: Object.entries(card.counters ?? {}).map(([type, count]) => ({
            type,
            count: String(count),
        })),
        damageMarked:
            card.damageMarked !== undefined ? String(card.damageMarked) : "",
        attachedTo: card.attachedTo ?? "",
        copyOf: card.copyOf ?? "",
        position: card.position !== undefined ? String(card.position) : "",
        faceDown: card.faceDown ?? false,
        faceDownExile: card.faceDownExile ?? false,
        castableFromExile: card.castableFromExile ?? false,
        castableFromExileIncludesLand:
            card.castableFromExileIncludesLand ?? false,
        attackedLastTurn: card.attackedLastTurn ?? false,
    };
}

function num(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
}

/** Collapse an editable draft into a clean `ScenarioCard`, dropping empty and
 *  default-valued fields so the persisted spec carries only what was set. */
export function draftToCard(draft: CardDraft): ScenarioCard {
    const card: ScenarioCard = { name: draft.name.trim(), owner: draft.owner };
    // CR 111.7 — a token only exists on the battlefield, so a token row never
    // carries a zone (the builder ignores one anyway).
    if (draft.token) card.token = true;
    else if (draft.zone !== "battlefield") card.zone = draft.zone;

    const count = num(draft.count);
    if (count !== undefined && count !== 1) card.count = count;
    if (draft.tapped) card.tapped = true;
    if (draft.summoningSick) card.summoningSick = true;

    const counters: Record<string, number> = {};
    for (const c of draft.counters) {
        const key = c.type.trim();
        const value = num(c.count);
        if (key !== "" && value !== undefined) counters[key] = value;
    }
    if (Object.keys(counters).length > 0) card.counters = counters;

    const damage = num(draft.damageMarked);
    if (damage !== undefined && damage !== 0) card.damageMarked = damage;
    const position = num(draft.position);
    if (position !== undefined) card.position = position;

    if (draft.attachedTo.trim() !== "")
        card.attachedTo = draft.attachedTo.trim();
    if (draft.copyOf.trim() !== "") card.copyOf = draft.copyOf.trim();

    if (draft.faceDown) card.faceDown = true;
    if (draft.faceDownExile) card.faceDownExile = true;
    if (draft.castableFromExile) card.castableFromExile = true;
    if (draft.castableFromExileIncludesLand)
        card.castableFromExileIncludesLand = true;
    if (draft.attackedLastTurn) card.attackedLastTurn = true;

    return card;
}

// ---- Spec-level draft (issue #3463) ----------------------------------------
//
// The same string-while-editing treatment `CardDraft` gives a card row, applied
// to the SPEC-LEVEL knobs. Every field here is `form-owned` in
// `scenario-spec-ownership.ts`; the pair below is the round trip that
// classification promises — `specToDraft` inflates a loaded row, `draftToSpec`
// collapses the draft back to a minimal spec, and a field that survives one and
// not the other is a field an edit silently rewrites.

/** A per-seat numeric pair kept as strings while editing (`poison`, `life`,
 *  `experience` all share the spec's `{ me?, opp? }` shape). */
export type SeatPairDraft = { me: string; opp: string };

/** Editable form representation of the spec-level fields of `ScenarioSpec`
 *  (everything except `cards`, which the card repeater owns). */
export type SpecDraft = {
    phase: string;
    landCount: string;
    libraryCount: string;
    turn: string;
    markLastDrawn: boolean;
    rngSeed: string;
    poison: SeatPairDraft;
    life: SeatPairDraft;
    experience: SeatPairDraft;
    /** CR 102.1 / 117.1 (issue #3454) — the turn holder and the priority
     *  holder. `""` is the spec's own "absent", which the builder reads as
     *  "leave the base state's turn holder alone"; it is a real, selectable
     *  value here, not a placeholder. */
    activePlayer: "" | "me" | "opp";
    priority: "" | "me" | "opp";
    /** CR 117.4 (issue #3454) — passes already banked. */
    passCount: string;
    companion: { name: string; owner: "me" | "opp"; used: boolean };
};

const EMPTY_SEAT_PAIR: SeatPairDraft = { me: "", opp: "" };

/** A fresh, wholly empty spec draft — every knob unset, which collapses to a
 *  spec carrying nothing but `cards`. */
export function emptySpecDraft(): SpecDraft {
    return {
        phase: "",
        landCount: "",
        libraryCount: "",
        turn: "",
        markLastDrawn: false,
        rngSeed: "",
        poison: { ...EMPTY_SEAT_PAIR },
        life: { ...EMPTY_SEAT_PAIR },
        experience: { ...EMPTY_SEAT_PAIR },
        activePlayer: "",
        priority: "",
        passCount: "",
        companion: { name: "", owner: "me", used: false },
    };
}

function seatPairToDraft(
    pair: { me?: number; opp?: number } | undefined
): SeatPairDraft {
    return {
        me: pair?.me !== undefined ? String(pair.me) : "",
        opp: pair?.opp !== undefined ? String(pair.opp) : "",
    };
}

/** Inflate the spec-level fields of a stored spec into an editable draft
 *  (inverse of `draftToSpec`), so an existing scenario opens in the form with
 *  every knob it carried already filled in. */
export function specToDraft(spec: ScenarioSpec | null): SpecDraft {
    const draft = emptySpecDraft();
    if (!spec) return draft;
    if (spec.phase !== undefined) draft.phase = spec.phase;
    if (spec.landCount !== undefined) draft.landCount = String(spec.landCount);
    if (spec.libraryCount !== undefined)
        draft.libraryCount = String(spec.libraryCount);
    if (spec.turn !== undefined) draft.turn = String(spec.turn);
    draft.markLastDrawn = spec.markLastDrawn ?? false;
    if (spec.rngSeed !== undefined) draft.rngSeed = String(spec.rngSeed);
    draft.poison = seatPairToDraft(spec.poison);
    draft.life = seatPairToDraft(spec.life);
    draft.experience = seatPairToDraft(spec.experience);
    if (spec.activePlayer !== undefined) draft.activePlayer = spec.activePlayer;
    if (spec.priority !== undefined) draft.priority = spec.priority;
    if (spec.passCount !== undefined) draft.passCount = String(spec.passCount);
    if (spec.companion) {
        draft.companion = {
            name: spec.companion.name,
            owner: spec.companion.owner ?? "me",
            used: spec.companion.used ?? false,
        };
    }
    return draft;
}

/** Collapse a per-seat draft, omitting a side left blank and the whole field
 *  when neither side parses — the spec stays minimal, and an untouched knob
 *  never writes `{}` onto the row. */
function seatPairFromDraft(
    pair: SeatPairDraft
): { me?: number; opp?: number } | undefined {
    const out: { me?: number; opp?: number } = {};
    const me = num(pair.me);
    const opp = num(pair.opp);
    if (me !== undefined) out.me = me;
    if (opp !== undefined) out.opp = opp;
    return me === undefined && opp === undefined ? undefined : out;
}

/**
 * Collapse the spec-level draft into the `ScenarioSpec` fields it owns,
 * dropping every knob left blank. The result is spread beside `cards` by the
 * form; `assembleScenarioSpec` (`scenario-spec-ownership.ts`) then folds in any
 * `preserved` field of the loaded row.
 */
export function draftToSpec(draft: SpecDraft): Omit<ScenarioSpec, "cards"> {
    const spec: Omit<ScenarioSpec, "cards"> = {};
    if (draft.phase !== "") spec.phase = draft.phase;
    const land = num(draft.landCount);
    if (land !== undefined) spec.landCount = land;
    const library = num(draft.libraryCount);
    if (library !== undefined) spec.libraryCount = library;
    const turn = num(draft.turn);
    if (turn !== undefined) spec.turn = turn;
    if (draft.markLastDrawn) spec.markLastDrawn = true;
    const seed = num(draft.rngSeed);
    if (seed !== undefined) spec.rngSeed = seed;

    const poison = seatPairFromDraft(draft.poison);
    if (poison) spec.poison = poison;
    const life = seatPairFromDraft(draft.life);
    if (life) spec.life = life;
    const experience = seatPairFromDraft(draft.experience);
    if (experience) spec.experience = experience;

    if (draft.activePlayer !== "") spec.activePlayer = draft.activePlayer;
    if (draft.priority !== "") spec.priority = draft.priority;
    const passCount = num(draft.passCount);
    if (passCount !== undefined) spec.passCount = passCount;

    const companionName = draft.companion.name.trim();
    if (companionName !== "") {
        spec.companion = {
            name: companionName,
            owner: draft.companion.owner,
            ...(draft.companion.used ? { used: true } : {}),
        };
    }
    return spec;
}
