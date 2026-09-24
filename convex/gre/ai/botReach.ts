/**
 * Bot reachability, computed (ADR 0105 § 7.2, ADR 0137, issue #3830).
 *
 * `.claude/rules/gre-development.md` § Bot reachability asks a human to WALK
 * three seams for every new card — reachable (`enumerateMoves`), answerable
 * (the choice surface), wanted (the valuers). For a card the Oracle compiler
 * emits there is no human in the loop, so the walk is replaced by a PLAY: the
 * Bot is handed the card in a generated position and we watch what it does.
 *
 *   - `played`  — at some seat the REAL search (`searchWithTrace`) chose a
 *                 move that uses the card, and the follow-through reached a
 *                 stable position with every owed input answered.
 *   - `ignored` — a move using the card was legal (it was affordable) and the
 *                 search never chose it, at any seat, at any seed, in either
 *                 main phase of the turn ({@link REACH_WINDOWS}) — or the
 *                 generated position could not pose the card at all
 *                 (`position-unmodelled`, a limit of this harness). The card is
 *                 playable by a human and ships; the Bot's valuation of it is
 *                 a gap (a Bot Gap row), never a reason to withhold it — a
 *                 valuation defect of the Bot must not keep a human-playable
 *                 card out of the catalogue (ADR 0137).
 *   - `frozen`  — at some seat no legal move uses the card at all, or the
 *                 follow-through owes an input the driver cannot answer
 *                 (`enumerateMoves` empty for the owing seat — the exact shape
 *                 in which the live driver stalls the game, ADR 0047). The
 *                 compiler quarantines the card with reason `bot-unreachable`.
 *
 * "Both seats": the card is held by the seat built FIRST and, separately, by
 * the seat built SECOND (`buildStateFromScenario`'s explicit `mySeatId`) — a
 * seat-orientation bug (the class issue #3443 fixed once) must not be able to
 * hide behind the one orientation the sweep happened to try.
 *
 * Deterministic by the blade contract (`blade/runner.ts`): a fixed synthetic
 * base deck, a fixed shuffle seed, an `iterations` budget (never `timeMs`) and
 * explicit search seeds. Same definition + same Bot ⇒ same verdict, which is
 * what lets `oracle:compile` cache the verdict by definition hash + Bot hash.
 *
 * Pure and synchronous. The CALLER registers the definition (the runtime
 * registry is keyed by id, and a compiled definition is not a catalogue card);
 * this module reads it through `getDefinition` like every other engine path.
 */

import { applyMoveForSearch } from "../applyMove";
import { cloneGameState } from "../clone";
import { buildBladeBaseState } from "./blade/baseState";
import { buildStateFromScenario } from "../scenarioBuilder";
import { applyMoveInSearch, decidingPlayer, searchWithTrace } from "../search";
import { enumerateMoves, type Move } from "../moves";
import { getLegalActions } from "../rules";
import { allocInstanceId, type GameState } from "../state";
import { manaValue } from "../constants";
import { basicLandsForColors, getCardColors } from "../../cards/colors";
import type { CardDefinition, EffectForEachSelector } from "../../cards/types";
import { castShape } from "./botReachForm";
import { costPose, targetPose } from "./botReachTarget";
export { castShape } from "./botReachForm";

/** CR 115.1 — a spell that targets a SPELL needs one on the stack. Lives
 *  HERE, not beside `castShape`: it decides what the generated position
 *  CONTAINS, so it is a verdict input and must be inside the Bot hash. */
function needsStackTarget(def: CardDefinition): boolean {
    const reqs = [
        ...(def.targetRequirement ? [def.targetRequirement] : []),
        ...(def.modes ?? []).flatMap((m) =>
            m.targetRequirement ? [m.targetRequirement] : []
        ),
    ];
    return reqs
        .flatMap((r) => (Array.isArray(r.type) ? r.type : [r.type]))
        .some((t) => t === "spell" || t === "spell-or-permanent");
}
import type { ScenarioCard, ScenarioSpec } from "../../debugScenarioSpec";

/** The permanent types the generated position can give the opponent a surplus
 *  of — one per filler the position seeds. */
const SWEEPABLE_TYPES = [
    "Creature",
    "Artifact",
    "Enchantment",
    "Land",
] as const;
type SweepableType = (typeof SWEEPABLE_TYPES)[number];

/** Does anything under `node` destroy? — an `op: "destroy"` at any depth. */
function destroysSomething(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(destroysSomething);
    if (node === null || typeof node !== "object") return false;
    const record = node as Record<string, unknown>;
    return (
        record.op === "destroy" || Object.values(record).some(destroysSomething)
    );
}

/** A `forEach` over the battlefield, as the sweep detectors read it. */
interface BattlefieldForEach {
    readonly select: Extract<EffectForEachSelector, { set: "permanents" }>;
    readonly effects: unknown;
}

/**
 * Every `forEach` over `set: "permanents"` in the card's SPELL script — only
 * `effects` and `modes` are read, so a sweep hosted by a triggered or
 * activated ability is not one. The three detectors below read the same nodes
 * and differ only in which selector and body they claim.
 */
function battlefieldForEaches(def: CardDefinition): BattlefieldForEach[] {
    const found: BattlefieldForEach[] = [];
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (node === null || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        const select = record.select as EffectForEachSelector | undefined;
        if (record.op === "forEach" && select?.set === "permanents")
            found.push({ select, effects: record.effects });
        Object.values(record).forEach(visit);
    };
    visit(def.effects);
    visit(def.modes);
    return found;
}

/** Does the selector name creatures — `type: "Creature"`, alone or in a list? */
function selectsCreatures(select: BattlefieldForEach["select"]): boolean {
    return [select.filter?.type ?? []].flat().includes("Creature");
}

/**
 * The permanent types the card's SPELL script destroys on every player's
 * battlefield — a `forEach` over `set: "permanents"` with no `controller` (an
 * omitted controller selects every player's battlefield) whose body destroys.
 * Wrath of God destroys creatures, Tranquility enchantments, Armageddon lands,
 * and a sweep with no filter at all destroys them all. Empty when the card
 * sweeps nothing.
 *
 * What it does NOT model, each one leaving the symmetric pose:
 *  - a sweep whose body does not destroy (a `+1/+1` to every creature, an
 *    animate). A toughness SHRINK is the other kind of sweep a creature can
 *    die to, and {@link shrinksEveryCreature} poses it;
 *  - a filter on anything but `type` (`excludeType`, `subtype`, …): not read,
 *    so no claim is made rather than a wrong one;
 *  - a sweep hosted by a triggered or activated ability.
 *
 * Lives HERE for the same reason as `needsStackTarget`: it decides what the
 * generated position CONTAINS, so it is a verdict input and must be inside the
 * Bot hash.
 */
function sweptTypes(def: CardDefinition): ReadonlySet<SweepableType> {
    const swept = new Set<SweepableType>();
    for (const { select, effects } of battlefieldForEaches(def)) {
        if (select.controller !== undefined || !destroysSomething(effects))
            continue;
        const named =
            select.filter === undefined
                ? SWEEPABLE_TYPES
                : select.filter.type === undefined
                  ? []
                  : [select.filter.type].flat();
        for (const t of named)
            if ((SWEEPABLE_TYPES as readonly string[]).includes(t))
                swept.add(t as SweepableType);
    }
    return swept;
}

/** Is `value` a pump amount the sweep detectors can sign — a literal, or the
 *  `negate` wrapper (`-X/-X`, Toxic Deluge; a domain count, Planar Despair)? */
function signOf(value: unknown): "up" | "down" | "none" {
    if (typeof value === "number")
        return value > 0 ? "up" : value < 0 ? "down" : "none";
    return value !== null && typeof value === "object" && "negate" in value
        ? "down"
        : "none";
}

/** Does any `pump` under `node` move `axis` in `direction`? */
function pumps(
    node: unknown,
    axis: "power" | "toughness",
    direction: "up" | "down"
): boolean {
    if (Array.isArray(node)) return node.some((n) => pumps(n, axis, direction));
    if (node === null || typeof node !== "object") return false;
    const record = node as Record<string, unknown>;
    return (
        (record.op === "pump" && signOf(record[axis]) === direction) ||
        Object.values(record).some((n) => pumps(n, axis, direction))
    );
}

/**
 * CR 613.4c / 704.5f — does the SPELL script shrink the toughness of EVERY
 * player's creatures (a `forEach` over their battlefields, no `controller`,
 * whose body pumps toughness down)? A creature at toughness 0 or less dies to
 * a state-based action, so this is a sweep the way a destroy is: Infest,
 * Rollick of Abandon and a `-1/-1` to everything all cost the holder the card
 * and kill whatever the shrink reaches.
 *
 * Read only on the shrink's own axis: a `-2/-0` shrinks nothing that dies. The
 * amount is not read — a `negate` is a computed one (Planar Despair's domain
 * count reads 1 in a position whose lands are one basic type), and the pose
 * hands the opponent bodies that die to ANY shrink. Same reason as
 * `sweptTypes` for living HERE: it decides what the position CONTAINS.
 */
function shrinksEveryCreature(def: CardDefinition): boolean {
    return battlefieldForEaches(def).some(
        ({ select, effects }) =>
            select.controller === undefined &&
            selectsCreatures(select) &&
            pumps(effects, "toughness", "down")
    );
}

/**
 * CR 613.4c — does the SPELL script raise the POWER of the holder's own
 * creatures alone (a `forEach` over `controller: "controller"`, body pumps
 * power up — Desperate Charge)? Such a spell is worth what the holder's
 * creatures do with the extra power, so the pose gives the holder more of
 * them than the opponent has blockers for. One that pumps EVERY player's
 * creatures (no `controller`) helps the opponent as much and makes no claim.
 */
function pumpsOwnCreatures(def: CardDefinition): boolean {
    return battlefieldForEaches(def).some(
        ({ select, effects }) =>
            select.controller === "controller" &&
            selectsCreatures(select) &&
            pumps(effects, "power", "up")
    );
}

/**
 * CR 701.21 — the permanent types the card's SPELL script makes EVERY player
 * sacrifice: a `forEach` over `set: "players"` whose body is a
 * `sacrifice-permanents` choice of the battlefield for the iteration player
 * (Tremble, Simplify, Barter in Blood, Crack the Earth). A symmetric edict
 * costs the holder the card and one sacrifice of its own, so it wins only where
 * the holder gives up less than the opponent does — where the holder has
 * nothing of the type worth keeping. Empty when the card makes no such edict.
 *
 * What it does NOT model: an edict hosted by a triggered or activated ability,
 * one aimed at a chosen player (not symmetric), or a filter on anything but
 * `type` (`subtype`, `excludeType`, …) — no claim rather than a wrong one.
 * Lives HERE for the same reason as `sweptTypes`: it decides what the position
 * CONTAINS, so it is a verdict input and must be inside the Bot hash.
 */
function edictedTypes(def: CardDefinition): ReadonlySet<SweepableType> {
    const edicted = new Set<SweepableType>();
    const visitBody = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visitBody);
        if (node === null || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        const filter = record.filter as
            | { type?: string | string[]; [k: string]: unknown }
            | undefined;
        const player = record.player as { ref?: string } | undefined;
        if (
            record.op === "choice" &&
            record.kind === "sacrifice-permanents" &&
            record.zone === "battlefield" &&
            player?.ref === "$each" &&
            filter?.type !== undefined &&
            Object.keys(filter).length === 1
        )
            for (const t of [filter.type].flat())
                if ((SWEEPABLE_TYPES as readonly string[]).includes(t))
                    edicted.add(t as SweepableType);
        Object.values(record).forEach(visitBody);
    };
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (node === null || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        const select = record.select as EffectForEachSelector | undefined;
        if (record.op === "forEach" && select?.set === "players")
            visitBody(record.effects);
        else Object.values(record).forEach(visit);
    };
    visit(def.effects);
    visit(def.modes);
    return edicted;
}

export type BotReachOutcome = "played" | "ignored" | "frozen";

/** Why a card is not `played` — the first half of its Bot Gap form. */
export type BotReachCause =
    /** No legal move uses the card, though the engine offers a HUMAN the
     *  action — the Bot's own enumeration does not reach it. */
    | "no-legal-move"
    /**
     * The generated position cannot make the card castable at all — the
     * engine refuses the human affordance too (no legal target for its
     * requirement, an additional cost the seeded board cannot pay, a cost the
     * seeded lands cannot produce). A limit of THIS sweep's position, never a
     * claim about the Bot, so it never withholds the card; its Bot Gap row
     * ranks the shapes the generated position still cannot pose.
     */
    | "position-unmodelled"
    /** The follow-through owes an input no legal move answers. */
    | "unanswerable-input"
    /**
     * The follow-through did not settle inside {@link
     * MAX_FOLLOW_THROUGH_STEPS}. A bound of THIS harness, not a claim about
     * the Bot — every decision in it was answered — so it ships the card,
     * exactly like `position-unmodelled` (review of PR #4057, finding 3).
     */
    | "no-progress"
    /**
     * The play threw. A generated definition can reach a GRE path that
     * refuses it; that is the sweep failing, never the card, so it ships and
     * the shape is ranked (review of PR #4057, finding 7).
     */
    | "harness-error"
    /** Legal and affordable, never chosen. */
    | "never-chosen";

export interface BotReachVerdict {
    readonly outcome: BotReachOutcome;
    /** Absent exactly when `outcome === "played"`. */
    readonly cause?: BotReachCause;
    /**
     * The FORM the cause is aggregated by into a Bot Gap — the card's cast
     * shape for a missing move, the pending choice's kind for an unanswerable
     * input. Never a card name: two cards failing the same way share a form,
     * and that is what makes a Bot Gap rank by blast radius. Absent exactly
     * when `outcome === "played"`.
     */
    readonly form?: string;
}

export interface BotReachBudget {
    /** ISMCTS iterations per decision — never wall-clock (blade contract). */
    readonly iterations: number;
    /** Search seeds tried per seat; `played` if ANY seed chooses the card. */
    readonly seeds: readonly number[];
}

/**
 * The sweep's budget. Small on purpose: this asks "does the Bot ever want to
 * use the card when it is the obvious thing to do", not "is its play strong",
 * and it runs over every `ready` card. Changing it changes verdicts, so it is
 * part of what the Bot hash covers (it lives in this file).
 */
export const BOT_REACH_BUDGET: BotReachBudget = {
    iterations: 48,
    seeds: [0xb07, 0x5eed],
};

/**
 * The windows of the holder's turn the card is posed in, in order. A card the
 * Bot passes over in the first is posed again in the second, and `played` in
 * either counts: holding a card until after combat is a play, not a refusal.
 * Measured (issue #4069): a creature with haste, into the generated position's
 * untapped blocker, is passed over precombat and cast postcombat on every seed
 * and seat, while the same creature without haste is cast precombat. The
 * sweep reads the FACT of a later cast; why the search prefers it is
 * docs/findings/4069-bot-holds-haste-creature-past-combat.md.
 */
export const REACH_WINDOWS = ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"] as const;
export type ReachWindow = (typeof REACH_WINDOWS)[number];

/** Upper bound on follow-through decisions after the card's move. */
const MAX_FOLLOW_THROUGH_STEPS = 12;

/** Extra lands beyond the card's mana value — room for X and for a cost the
 *  mana value does not count (kicker, an activation after the cast). */
const EXTRA_LANDS = 2;

/** How many MORE of each swept type the opponent holds than the holder. A
 *  sweep costs the holder the card itself and everything of its own it
 *  destroys; the opponent's surplus is what pays for both. Only the SWEPT types
 *  get a surplus: an unswept filler is not inert (Castle gives its controller's
 *  untapped creatures +0/+2, so three spare Castles kept the opponent's
 *  creatures alive through a -4/-4 sweep and read as a bad cast). */
const SWEEP_SURPLUS = 3;

/** The card every generated position seeds as the object a target, a
 *  sacrifice or a discard can use — a real catalogue creature, both sides, in
 *  every zone a target requirement names. */
const FILLER_CREATURE = "Grizzly Bears";
/** An artifact, for artifact targets. NOT a noncreature one: Ornithopter is
 *  an artifact CREATURE, so a surplus of it is a surplus of bodies too. */
const FILLER_ARTIFACT = "Ornithopter";
/** A global enchantment, for enchantment targets. It gives its controller's
 *  untapped creatures +0/+2, so it is not inert to a toughness shrink and the
 *  shrink pose leaves it out ({@link shrinksEveryCreature}). */
const FILLER_ENCHANTMENT = "Castle";
/** A vanilla 1/1 — a body that dies to ANY toughness shrink, the surplus a
 *  shrinking sweep is posed against. */
const FILLER_SMALL_CREATURE = "Mons's Goblin Raiders";

/** What each filler puts on the battlefield, by permanent type — the types an
 *  edict pose reads to decide which of the holder's fillers it must not leave
 *  standing. Ornithopter is an artifact CREATURE, Castle an enchantment. */
const FILLER_TYPES: Readonly<Record<string, readonly SweepableType[]>> = {
    [FILLER_CREATURE]: ["Creature"],
    [FILLER_ARTIFACT]: ["Artifact", "Creature"],
    [FILLER_ENCHANTMENT]: ["Enchantment"],
};

/**
 * The generated position, as a `ScenarioSpec` for the HOLDER seat (`me`): its
 * lands in the colours of the card's own cost, enough of them for the mana
 * value plus {@link EXTRA_LANDS}, filler objects on both sides and in both
 * graveyards, an opaque card in hand (a discard cost), a filler library, main phase,
 * the holder active with priority. When the card targets a spell, the
 * opponent's filler spell is on the stack instead — CR 117.1a keeps the cast
 * legal at instant speed only, which is what such a card is. A card whose
 * value lies in what it does to a whole battlefield is posed where it wins:
 * a destroying sweep against the opponent's surplus of the swept type, a
 * toughness shrink against a surplus of 1/1s (and no Castle to prop them up),
 * a pump of the holder's own creatures with the holder's surplus of attackers.
 *
 * The card itself is NOT in the spec: the spec names cards, and a compiled
 * definition is registered by id only. The caller adds it to the hand.
 */
export function botReachSpec(
    def: CardDefinition,
    window: ReachWindow = REACH_WINDOWS[0]
): ScenarioSpec {
    const isLand = def.types.includes("Land");
    const landCount = isLand ? 1 : manaValue(def.manaCost) + EXTRA_LANDS;
    const cycle = basicLandsForColors(getCardColors(def));
    const cards: ScenarioCard[] = [];
    for (let i = 0; i < landCount; i++) {
        cards.push({
            name: cycle[i % cycle.length]!,
            owner: "me",
            zone: "battlefield",
        });
    }
    const shrinks = shrinksEveryCreature(def);
    const target = targetPose(def);
    const edicted = edictedTypes(def);
    // A symmetric edict is posed where the holder has nothing of the edicted
    // type to give up: every filler of that type stays on the opponent's side
    // only, so the opponent sacrifices one and the holder gives up nothing
    // (a whole-permanent edict takes the holder's spare land instead). A land
    // edict is not posed: no filler is a Land.
    const holderKeeps = (name: string): boolean =>
        !FILLER_TYPES[name]!.some((t) => edicted.has(t));
    for (const owner of ["me", "opp"] as const) {
        const stands = (name: string): boolean =>
            owner === "opp" || holderKeeps(name);
        if (stands(FILLER_CREATURE))
            cards.push({ name: FILLER_CREATURE, owner, zone: "battlefield" });
        if (stands(FILLER_ARTIFACT))
            cards.push({ name: FILLER_ARTIFACT, owner, zone: "battlefield" });
        if (
            !shrinks &&
            !target.omitToughnessBoost &&
            stands(FILLER_ENCHANTMENT)
        )
            cards.push({
                name: FILLER_ENCHANTMENT,
                owner,
                zone: "battlefield",
            });
        cards.push({ name: FILLER_CREATURE, owner, zone: "graveyard" });
    }
    if (shrinks)
        // The shrink's reach is the opponent's surplus of small bodies: what
        // it kills there pays for the card and for whatever of the holder's
        // own it reaches.
        cards.push({
            name: FILLER_SMALL_CREATURE,
            owner: "opp",
            zone: "battlefield",
            count: SWEEP_SURPLUS,
        });
    if (pumpsOwnCreatures(def))
        // Extra power is worth what the holder's creatures do with it: more
        // attackers than the opponent has blockers for.
        cards.push({
            name: FILLER_CREATURE,
            owner: "me",
            zone: "battlefield",
            count: SWEEP_SURPLUS,
        });
    const swept = sweptTypes(def);
    const surplus: Record<Exclude<SweepableType, "Land">, string> = {
        Creature: FILLER_CREATURE,
        Artifact: FILLER_ARTIFACT,
        Enchantment: FILLER_ENCHANTMENT,
    };
    if (swept.size > 0 && !swept.has("Creature")) {
        // What the sweep leaves standing is the holder's: a wipe of lands or
        // enchantments is the obvious play from ahead on the board, and a
        // position where the bodies are level does not pose it. (An artifact
        // sweep is the exception that is not exercised: its surplus is
        // Ornithopter, a body, so it poses the bodies level. No shipped card.)
        cards.push({
            name: FILLER_CREATURE,
            owner: "me",
            zone: "battlefield",
            count: SWEEP_SURPLUS,
        });
    }
    for (const type of SWEEPABLE_TYPES) {
        if (!swept.has(type)) continue;
        if (type === "Land") {
            // A land sweep needs lands on the opponent's side to destroy; the
            // holder's own are its cost, so the opponent's exceed them by the
            // surplus.
            for (let i = 0; i < landCount + SWEEP_SURPLUS; i++)
                cards.push({
                    name: cycle[i % cycle.length]!,
                    owner: "opp",
                    zone: "battlefield",
                });
        } else {
            cards.push({
                name: surplus[type],
                owner: "opp",
                zone: "battlefield",
                count: SWEEP_SURPLUS,
            });
        }
    }
    const cost = costPose(def);
    cards.push(...target.cards, ...cost.cards);
    const stack = needsStackTarget(def);
    return {
        cards,
        phase: window,
        turn: 3,
        libraryCount: 20,
        // CR 400.2 — a card the holder can discard or reveal that is never a
        // castable alternative: an opaque placeholder resolves to no
        // definition, so it cannot compete with the card for the decision.
        // A real filler in hand did: holding a second copy of the card, the
        // search's interchangeable-copy collapse (issue #3593) could pick the
        // filler as the representative and the card read as never chosen.
        hiddenHand: { me: 1 },
        activePlayer: "me",
        priority: "me",
        ...target.position,
        ...(cost.manaPool ? { manaPool: cost.manaPool } : {}),
        ...(stack
            ? {
                  stack: [
                      {
                          kind: "spell" as const,
                          name: FILLER_CREATURE,
                          controller: "opp" as const,
                      },
                  ],
              }
            : {}),
    };
}

/** Does `move` use the card instance `instanceId`? */
function usesCard(move: Move, instanceId: string): boolean {
    return "cardInstanceId" in move && move.cardInstanceId === instanceId;
}

/** Is the card still in flight — on the stack, or a choice still pending? */
function unsettled(state: GameState, instanceId: string): boolean {
    if ((state.pendingChoices?.length ?? 0) > 0) return true;
    return state.stack.some((item) => item.id === instanceId);
}

/**
 * CR 117.1 — would the engine offer a HUMAN this card's action here? The same
 * `legalActions` the client gates its cast affordance on, so it already
 * accounts for timing, an unpayable mana cost, an unpayable additional cost
 * and an empty legal-target set.
 *
 * This is the discriminator between the two `no legal move` worlds: with the
 * affordance present and no Move enumerated, the Bot cannot reach an action a
 * human can take — seam 1 of the reachability walk. With it absent, the
 * position never posed the question (measured on the first full pass: 46 of
 * 59 cards with no Move were this — Vengeance wants a TAPPED creature,
 * Immolating Glare an ATTACKING one, Goblin Grenade a Goblin to sacrifice).
 * Quarantining those would withhold correct cards for a limit of the harness.
 */
function humanCouldAct(
    state: GameState,
    holderId: string,
    instanceId: string
): boolean {
    const player = state.players.find((p) => p.id === holderId)!;
    const card = player.hand.find((c) => c.id === instanceId);
    if (card === undefined) return false;
    const actions = getLegalActions(state, player, card);
    return actions.includes("cast") || actions.includes("play");
}

/** The generated position with the card in the holder's hand. */
export function buildBotReachState(
    def: CardDefinition,
    holderSeat: 0 | 1,
    window: ReachWindow = REACH_WINDOWS[0]
): { state: GameState; holderId: string; instanceId: string } {
    const base = buildBladeBaseState();
    const holderId = base.players[holderSeat]!.id;
    const state = buildStateFromScenario(
        base,
        botReachSpec(def, window),
        holderId
    );
    const holder = state.players.find((p) => p.id === holderId)!;
    const instanceId = allocInstanceId(state);
    holder.hand.push({
        id: instanceId,
        card: { id: def.id },
        types: def.types,
        subtypes: def.subtypes ?? [],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: def.staticAbilities ?? [],
        controllerId: holderId,
        ownerId: holderId,
        zone: "hand",
        isTapped: false,
        isSummoningSick: false,
    });
    return { state, holderId, instanceId };
}

export type SeatVerdict =
    | { outcome: "played" }
    | { outcome: "ignored" | "frozen"; cause: BotReachCause; form: string };

/**
 * Follow the chosen move through: every decision the position owes afterwards
 * — a target, a choice mid-resolution, the opponent's priority — is answered
 * by the search for whoever owes it, until the card is off the stack with no
 * choice pending. `null` means it settled; otherwise the frozen verdict.
 *
 * The OPENING move goes through the greedy 1-ply `applyMoveForSearch` on
 * purpose (it poses the same world the verdicts were measured in); every
 * answer after it goes through the ISMCTS applier `applyMoveInSearch`.
 */
function followThrough(
    start: GameState,
    holderId: string,
    instanceId: string,
    move: Move,
    budget: BotReachBudget,
    seed: number
): SeatVerdict | null {
    let state = applyMoveForSearch(start, holderId, move);
    for (let step = 0; step < MAX_FOLLOW_THROUGH_STEPS; step++) {
        if (state.gameOver || !unsettled(state, instanceId)) return null;
        const decider = decidingPlayer(state);
        if (decider === null) {
            // No decider, and the card is still in flight. Two worlds, and
            // NEITHER is provably a freeze from here.
            //
            // An ANNOUNCEMENT window the executor drives atomically
            // (`pendingCast` / `pendingActivation` / an announced
            // `pendingTarget`, ADR 0047) has no decider BY DESIGN, and the
            // state the opening `applyMoveForSearch` leaves behind can be such
            // a window for a "you may …" enters-the-battlefield trigger (13
            // cards on the first pass, each with two live `may-pay`
            // candidates; later states come from `applyMoveInSearch`, where
            // that `may-pay` is a live decision node). A choice with no CANDIDATE generator is not one
            // either: the live driver answers it from the minimal-legal
            // fallback (ADR 0016, `src/lib/ai/brain.ts` — 14 of the 29 choice
            // kinds have no generator and are played every day). Deciding
            // between them needs the DRIVER, which lives client-side and
            // which this engine-side module may not import — see
            // docs/findings/3830-choice-surface-freeze-needs-the-driver.md.
            return null;
        }
        const moves = enumerateMoves(state, decider);
        if (moves.length === 0) {
            // `decidingPlayer` mirrors `enumerateMoves` (search.ts) — a
            // decider with no move means the two surfaces disagree, which is
            // the live driver waking to nothing it can do.
            return {
                outcome: "frozen",
                cause: "unanswerable-input",
                form: state.pendingChoices?.[0]
                    ? `choice:${state.pendingChoices[0]!.kind}`
                    : "priority",
            };
        }
        const next =
            searchWithTrace(
                state,
                decider,
                { iterations: budget.iterations },
                seed
            ).move ?? moves[0]!;
        // The ISMCTS applier, never the greedy 1-ply sandbox: that one leaves a
        // `resolution-choice` / `pass` answer as a no-op ("no board change
        // worth modelling"), so the choice this loop just answered stayed
        // pending and every step re-answered it until the budget ran out — a
        // verdict about THIS harness read as a Bot Gap (issue #4189). Every
        // answer the search itself makes in-tree goes through this applier.
        const applied = cloneGameState(state);
        applyMoveInSearch(applied, decider, next);
        state = applied;
    }
    return unsettled(state, instanceId)
        ? { outcome: "ignored", cause: "no-progress", form: "follow-through" }
        : null;
}

/** One seat's play, tagged with the seat that held the card. */
export interface SeatPlay {
    readonly holderId: string;
    readonly verdict: SeatVerdict;
}

function playSeat(
    def: CardDefinition,
    holderSeat: 0 | 1,
    budget: BotReachBudget
): SeatPlay {
    const [first, ...later] = REACH_WINDOWS;
    const opening = buildBotReachState(def, holderSeat, first);
    const { holderId } = opening;
    let verdict = playFrom(
        def,
        opening.state,
        holderId,
        opening.instanceId,
        budget
    );
    for (const window of later) {
        // Only a card the search passed over is posed again: `frozen` and
        // `position-unmodelled` describe the position or the driver, which a
        // later window of the same turn does not change. A later `played` or
        // `frozen` outranks the first window's refusal; a later `ignored` does
        // not replace it.
        if (verdict.outcome !== "ignored" || verdict.cause !== "never-chosen")
            break;
        const built = buildBotReachState(def, holderSeat, window);
        const next = playFrom(
            def,
            built.state,
            holderId,
            built.instanceId,
            budget
        );
        if (next.outcome !== "ignored") verdict = next;
    }
    return { holderId, verdict };
}

/**
 * The verdict when NO enumerated Move uses the card — the two worlds
 * {@link humanCouldAct} separates. Exported because no shipped card exhibits
 * the first one today (`legalActions` checks the same targets and costs the
 * enumerator does, so the two agree on every card of the first full pass), and
 * a branch with no fixture is a branch nobody has ever seen decide.
 */
export function classifyNoMove(
    state: GameState,
    holderId: string,
    instanceId: string,
    def: CardDefinition
): SeatVerdict {
    return humanCouldAct(state, holderId, instanceId)
        ? { outcome: "frozen", cause: "no-legal-move", form: castShape(def) }
        : {
              outcome: "ignored",
              cause: "position-unmodelled",
              form: castShape(def),
          };
}

function playFrom(
    def: CardDefinition,
    state: GameState,
    holderId: string,
    instanceId: string,
    budget: BotReachBudget
): SeatVerdict {
    if (decidingPlayer(state) !== holderId) {
        // The generated position is ours, not the card's: a holder that does
        // not hold the decision is a defect of this module, never a verdict.
        throw new Error(
            `botReach: generated position for "${def.name}" does not give the holder the decision`
        );
    }
    const legal = enumerateMoves(state, holderId).filter((m) =>
        usesCard(m, instanceId)
    );
    if (legal.length === 0)
        return classifyNoMove(state, holderId, instanceId, def);
    // EVERY seed, even after one of them chose the card: a follow-through
    // that stalls on the line one seed picked says nothing about the line
    // another picks, and the losing verdict here WITHHOLDS the card (review
    // of PR #4057, finding 1). The first non-played follow-through is
    // remembered and only reported if no seed ever settles.
    let stalled: SeatVerdict | null = null;
    for (const seed of budget.seeds) {
        const move = searchWithTrace(
            state,
            holderId,
            { iterations: budget.iterations },
            seed
        ).move;
        if (move === null || !usesCard(move, instanceId)) continue;
        const followed = followThrough(
            state,
            holderId,
            instanceId,
            move,
            budget,
            seed
        );
        if (followed === null) return { outcome: "played" };
        stalled ??= followed;
    }
    if (stalled !== null) return stalled;
    return {
        outcome: "ignored",
        cause: "never-chosen",
        form: castShape(def),
    };
}

/**
 * Play `def` (already registered under `def.id`) at both seats and return its
 * reachability. A seat that freezes freezes the card — a freeze at one seat
 * still stalls every game that seats the Bot there; otherwise a seat that
 * played makes it `played`; otherwise it is `ignored`.
 */
/** The card played from each seat in turn — first-built, then second-built. */
export function playBotReachSeats(
    def: CardDefinition,
    budget: BotReachBudget = BOT_REACH_BUDGET
): readonly SeatPlay[] {
    return [playSeat(def, 0, budget), playSeat(def, 1, budget)];
}

export function playBotReach(
    def: CardDefinition,
    budget: BotReachBudget = BOT_REACH_BUDGET
): BotReachVerdict {
    const seats = playBotReachSeats(def, budget).map((s) => s.verdict);
    // A `no-legal-move` freeze is SEARCH-FREE (`enumerateMoves` +
    // `getLegalActions`), so one seat refusing the card while the other plays
    // it is a real seat-orientation defect and withholds the card.
    const unreachable = seats.find(
        (s) => s.outcome === "frozen" && s.cause === "no-legal-move"
    );
    if (unreachable) return unreachable;
    // Every other freeze is an outcome of the SEARCH's own chosen line, and
    // the search is measurably noisier from the second-built seat
    // (docs/findings/3830-bot-reach-seat-asymmetric-search-noise.md). A seat
    // that played the card has PROVEN it reachable; a noisier seat stalling
    // on a different line may not overturn that (review of PR #4057,
    // finding 2).
    if (seats.some((s) => s.outcome === "played")) return { outcome: "played" };
    const frozen = seats.find((s) => s.outcome === "frozen");
    if (frozen) return frozen;
    // Neither seat played. `never-chosen` outranks `position-unmodelled`: a
    // seat that could pose the card and did not choose it has measured the
    // Bot, which is the stronger claim of the two.
    const measured = seats.find(
        (s) => s.outcome !== "played" && s.cause === "never-chosen"
    );
    return measured ?? seats[0]!;
}
