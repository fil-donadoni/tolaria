// Shared test shims + fixtures for the LEG per-colour test files (ADR 0043
// split). Stack-push/resolve shims, synthetic trigger events, and scenario
// builders reused across the colour modules' describe blocks. Fixture
// builders (makeInstance/makePlayer/makeState/pushSpell) stay in
// convex/cards/__tests__/setup.ts.

import { greed, recall, sylvanLibrary, theTabernacleAtPendrellVale } from "..";
import {
    applySourceStaticEffects,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import { grizzlyBears } from "../../lea";

// --- helpers (mirrors arn.test.ts) ----------------------------------------

export function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

/** Push an activated ability onto the stack with its cost assumed already
 *  paid (mirrors the post-`activateAbility` state), then resolve it. */
export function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

export function answerChoice(state: GameState, picks: string[]): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending choice to answer");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: picks,
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

// ---------------------------------------------------------------------------
// Sylvan Library — draw-step extra draws + per-card pay-4-or-topdeck.
// ---------------------------------------------------------------------------

export const drawStepEvent: StackItem["triggerEvent"] = {
    type: "PHASE_BEGIN",
    phase: "DRAW",
    activePlayerId: "p1",
};

/** Builds a p1 board with Sylvan Library, a hand, a library, a `drawnThisTurn`
 *  tally, and a life total. Filler cards reuse `greed.id` (art only). */
export function makeSylvanState(opts: {
    handIds: string[];
    libIds: string[];
    drawnThisTurn: string[];
    life?: number;
}): { state: GameState; sylvan: CardInstanceState } {
    const sylvan = makeInstance(sylvanLibrary.id, {
        id: "sylvan",
        controllerId: "p1",
    });
    const hand = opts.handIds.map((id) =>
        makeInstance(greed.id, { id, controllerId: "p1", zone: "hand" })
    );
    const library = opts.libIds.map((id) =>
        makeInstance(greed.id, { id, controllerId: "p1", zone: "library" })
    );
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [sylvan],
                hand,
                library,
                drawnThisTurn: opts.drawnThisTurn,
                life: opts.life ?? 20,
            }),
            makePlayer("p2"),
        ],
    });
    return { state, sylvan };
}

// ===========================================================================
// Blue free tranche (#372)
// ===========================================================================

// commit a single pending may-pay/choice head (shared by the counterspell
// and Recall-style tests below).
export function commitHead(state: GameState, picks: string[]): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    const stackItem = state.stack.find((s) => s.id === head.stackItemId)!;
    stackItem.collectedChoices = {
        ...(stackItem.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: picks,
    };
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Shroud / "can't be the target" static (#382)
//
// CR 702.18 (shroud) / 611 (continuous guard) / 113.3 (spell-vs-ability) /
// 109.5 (source characteristics). Each card declares a `permanent-guard`
// `cantBeTargeted` static effect; the targeting gates (`getLegalTargets`,
// `selectTarget`) read it live. Tests assert the gate excludes the guarded
// permanent under the card's condition, and that the exclusion survives the
// wire-format projection.
// ─────────────────────────────────────────────────────────────────────────────

export const CREATURE_REQ = { type: "Creature", count: 1 } as const;

// ─────────────────────────────────────────────────────────────────────────────
// C7 — Upkeep "pay-or-sacrifice" maintenance cost (#383)
//
// CR 603.6a beginning-of-upkeep trigger + CR 117.3a "do X unless you pay
// [cost]". The five Elder Dragons sacrifice unless their controller pays a
// three-color cost; Cosmic Horror destroys-and-self-pings; Mold Demon's ETB
// sacrifices unless you sacrifice two Swamps; The Tabernacle grants the
// destroy-unless-pay-{1} tax to every creature (CR 113.1 triggered-grant).
// Mirrors Junún Efreet (arn) and Energy Flux (atq).
// ─────────────────────────────────────────────────────────────────────────────

export const UPKEEP_C7 = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

export const ENTERED_C7 = (
    source: CardInstanceState
): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_ENTERED" as const,
        instanceId: source.id,
        controllerId: source.controllerId,
        types: source.types,
    }) as StackItem["triggerEvent"];

/** Gives p1 a full mana pool of `n` of each color (enough to pay any three-
 *  color upkeep cost in this cluster). */
export function fillManaPool(state: GameState, n = 5): void {
    state.players[0].manaPool = { W: n, U: n, B: n, R: n, G: n, C: n };
}

// The Tabernacle at Pendrell Vale — grants the destroy-unless-pay-{1} tax to
// every creature (CR 113.1 triggered-grant + CR 611 filtered set + CR 603.6a).
export function withTabernacle(creatureController: "p1" | "p2" = "p1"): {
    state: GameState;
    tabernacle: CardInstanceState;
    bear: CardInstanceState;
} {
    const tabernacle = makeInstance(theTabernacleAtPendrellVale.id, {
        id: "tab",
        controllerId: "p1",
        zone: "battlefield",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: creatureController,
        zone: "battlefield",
    });
    const state = makeState();
    state.players[0].battlefield.push(tabernacle);
    state.players[creatureController === "p1" ? 0 : 1].battlefield.push(bear);
    applySourceStaticEffects(state, tabernacle);
    return { state, tabernacle, bear };
}

// ═════════════════════════════════════════════════════════════════════════════
// C5 — Named counters + counter-driven triggers (#384, CR 122).
// ═════════════════════════════════════════════════════════════════════════════

export const UPKEEP_C5 = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

export const END_STEP_C5 = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "END_STEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

// ===========================================================================
// C8 — Cast-tax "counter unless pay" World enchantments (#385)
//
// A SPELL_CAST trigger (CR 601.2i) on a World enchantment goes on the stack
// above the freshly-cast spell; on resolution it bills the spell's controller a
// may-pay tax (CR 117.3a) and, on decline (or inability to pay), counters the
// spell (CR 701.6a). Same composition as Force Spike, fired from a trigger.
// ===========================================================================

/** Build the SPELL_CAST trigger payload the spellCastTrigger.resolve reads back
 *  (mirrors what the engine snapshots on cast — CR 601.2i / 603.10). */
export function castEvent(
    casterId: string,
    spell: StackItem,
    types: ReadonlyArray<string>
): StackItem["triggerEvent"] {
    return {
        type: "SPELL_CAST",
        casterId,
        spellInstanceId: spell.id,
        spellCardId: (spell.card as { id: string }).id,
        spellTypes: types,
        spellSubtypes: [],
        spellColors: [],
    } as StackItem["triggerEvent"];
}

// ---------------------------------------------------------------------------
// The Abyss — each-player upkeep "destroy target nonartifact creature that
// player controls of their choice; can't be regenerated" (CR 603.6a / 704.5m
// World supertype). The active player chooses among their OWN nonartifact
// creatures; the AI sheds its worst (sacrifice-permanents heuristic).
// ---------------------------------------------------------------------------

export const HEADLESS = getCardByName("Headless Horseman").id; // vanilla 2/2, nonartifact

export const ORNITHOPTER = getCardByName("Ornithopter").id; // 0/2 Artifact Creature

/** PHASE_BEGIN upkeep event for a given active player. */
export function abyssUpkeep(activePlayerId: string): StackItem["triggerEvent"] {
    return { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId };
}

// --- #481: battlefield-scanned global attack restrictions (CR 508.1c) -------

export const CLAY_STATUE_ID = "64975352-8d35-4d02-94ac-fa0c6ee12409";

// ---------------------------------------------------------------------------
// Recall — "Discard X cards, then return a card from your graveyard to your
// hand for each card discarded this way. Exile Recall."
// CR 107.3 (X chosen on cast) / 701.8 (discard) / 400.7 (graveyard→hand) /
// 608.2 (self-exile). Cost {X}{X}{U} → xFactor 2 on the generic.
// ---------------------------------------------------------------------------

/** Builds a p1 board with the given hand and graveyard ids, then pushes Recall
 *  on the stack with the chosen X already announced (`chosenX`). Filler cards
 *  reuse `greed.id` (art only). Returns the state and the Recall stack item. */
export function makeRecallState(opts: {
    handIds: string[];
    graveyardIds: string[];
    chosenX: number;
}): { state: GameState; recallItem: StackItem } {
    const hand = opts.handIds.map((id) =>
        makeInstance(greed.id, { id, controllerId: "p1", zone: "hand" })
    );
    const graveyard = opts.graveyardIds.map((id) =>
        makeInstance(greed.id, { id, controllerId: "p1", zone: "graveyard" })
    );
    const state = makeState({
        players: [makePlayer("p1", { hand, graveyard }), makePlayer("p2")],
    });
    const recallItem = pushSpell(state, recall.id, "p1");
    recallItem.chosenX = opts.chosenX;
    return { state, recallItem };
}

/** Pushes Recall and starts resolution, raising the first pending choice (or
 *  resolving through entirely when X=0). */
export function startRecall(opts: {
    handIds: string[];
    graveyardIds: string[];
    chosenX: number;
}): GameState {
    const { state } = makeRecallState(opts);
    resolveTopOfStack(state);
    return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic base-P/T set (layer 7b) with a stated duration (#487, CR 613.4b)
// ─────────────────────────────────────────────────────────────────────────────

export function upkeepEvent487(
    activePlayerId: string
): StackItem["triggerEvent"] {
    return { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId };
}

// ---------------------------------------------------------------------------
// Equinox (CR 303.4 enchant-land aura + 611.2 activated-grant + 701.5a counter
// + 701.8 destroy). The enchanted land gains a {T} ability that counters target
// spell ONLY IF it would destroy a land the activating player controls. The
// hard part is targeting legality: `spellWouldDestroyLandControlledBy` must
// accept land-destruction (Stone Rain at your land, Armageddon) and reject
// everything else (Stone Rain at the OPPONENT's land, Counterspell, etc.).
// ---------------------------------------------------------------------------

export const STONE_RAIN_ID = "57ff74cb-a2ed-4123-ac42-f72f9820049e";

export const ARMAGEDDON_ID = "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb";

export const COUNTERSPELL_ID = "0df55e3f-14de-46ef-b6b1-616618724d9e";

export const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed";

export const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
