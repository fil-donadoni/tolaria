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
import {
    applyMoveInSearch,
    decidingPlayer,
    enumerateRootMoves,
    searchWithTrace,
} from "../search";
import { enumerateMoves, type Move } from "../moves";
import {
    getLegalActions,
    getLegalTargets,
    targetingSourceFromCard,
} from "../rules";
import { allocInstanceId, type GameState } from "../state";
import { hasInstantSpeed, manaValue } from "../constants";
import {
    basicLandsForColors,
    getCardColors,
    getColorsFromCost,
} from "../../cards/colors";
import type { CardDefinition, EffectForEachSelector } from "../../cards/types";
import { tryGetCardByName, tryGetDefinition } from "../../cards";
import { matchesPermanentFilter } from "../../cards/filters";
import { sweepPermanentFilter, UNREADABLE_SWEEP_FILTER } from "./latentBoard";
import { castShape } from "./botReachForm";
import {
    projectBotReachTrace,
    usesCard,
    type BotReachTrace,
} from "./botReachTrace";
import {
    attackEdictPosition,
    combatTrickPosition,
    flashAmbushPosition,
    costPose,
    etbAbilityScripts,
    sorceryLifeGainRace,
    sorceryPumpRace,
    targetPose,
} from "./botReachTarget";
import { stackPose, type StackPose } from "./botReachStack";
import { manaSinkPose } from "./botReachMana";
import { handPutPose } from "./botReachHandPut";
import { subtypeSweepPose } from "./botReachSubtypeSweep";
import { landTapPose } from "./botReachLandTap";
import { nonbasicBurnPose } from "./botReachNonbasicBurn";
import { graveyardExilePose } from "./botReachGraveyardExile";
import { graveyardReturnPose } from "./botReachGraveyardReturn";
import { creatureSweepPose } from "./botReachCreatureSweep";
export { castShape } from "./botReachForm";

/** CR 115.1 — a spell that targets a SPELL needs one on the stack. Lives
 *  HERE, not beside `castShape`: it decides what the generated position
 *  CONTAINS, so it is a verdict input and must be inside the Bot hash.
 *
 *  The target may be the card's own (a counterspell) or its ENTERS trigger's
 *  (a flash creature that counters on entering, CR 603.6a): the trigger's
 *  target needs the spell on the stack when the trigger is put there, so the
 *  creature has to be cast in response to it. That is only possible at instant
 *  speed (CR 117.1a, CR 702.8a), so a trigger's spell target poses the stack
 *  only for a card that has it — a sorcery-speed permanent cannot be cast onto
 *  a non-empty stack, and posing one would make it unplayable, not pose it. */
function needsStackTarget(def: CardDefinition): boolean {
    const cardReqs = [
        ...(def.targetRequirement ? [def.targetRequirement] : []),
        ...(def.modes ?? []).flatMap((m) =>
            m.targetRequirement ? [m.targetRequirement] : []
        ),
    ];
    const triggerReqs = hasInstantSpeed({
        types: def.types,
        staticAbilities: def.staticAbilities ?? [],
    })
        ? [
              ...(def.triggeredAbilities ?? []),
              // The compiler's descriptors: the caller hands this module the
              // definition BEFORE `expandDefinition` rebuilds them into
              // `triggeredAbilities`.
              ...(def.compiledTriggeredAbilities ?? []),
          ].flatMap((a) => (a.targetRequirement ? [a.targetRequirement] : []))
        : [];
    return [...cardReqs, ...triggerReqs]
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

/** Does anything under `node` take a permanent off the battlefield? — a
 *  `destroy` / `exile`, or a `moveZone` to any zone but the battlefield (a
 *  bounce or a tuck), at any depth. Issue #4781: the latent hand term reads
 *  every one of these sweeps off the board, so the position poses them all. */
function removesSomething(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(removesSomething);
    if (node === null || typeof node !== "object") return false;
    const record = node as Record<string, unknown>;
    return (
        record.op === "destroy" ||
        record.op === "exile" ||
        (record.op === "moveZone" &&
            typeof record.to === "string" &&
            record.to !== "battlefield") ||
        Object.values(record).some(removesSomething)
    );
}

/** The fillers and basics a sweep whose filter names no card type can be
 *  posed against — the candidates {@link filteredSweepSurplus} matches. */
const FILTERED_SWEEP_CANDIDATES = [
    "Grizzly Bears",
    "Ornithopter",
    "Castle",
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
] as const;

/**
 * Issue #4781 — the opponent's surplus for a removing sweep whose filter names
 * NO card type (Flashfires' "all Plains", Hibernation's "all green
 * permanents", an unfiltered bounce): {@link sweptTypes} reads `type` only, so
 * such a sweep was posed on a level board and nothing in it was the
 * opponent's surplus. Every candidate the filter matches — through
 * `sweepPermanentFilter`, the SAME literal mapping the latent hand term reads
 * the board with — is a name the opponent gets a surplus of. A filter that
 * mapping cannot read poses nothing, as before.
 *
 * Lives HERE for the same reason as `sweptTypes`: it decides what the
 * position CONTAINS.
 */
function filteredSweepSurplus(def: CardDefinition): string[] {
    const names = new Set<string>();
    for (const { select, effects } of battlefieldForEaches(def)) {
        if (select.controller !== undefined || !removesSomething(effects))
            continue;
        // `sweptTypes` already poses a type filter and a missing filter.
        if (select.filter === undefined || select.filter.type !== undefined)
            continue;
        const filter = sweepPermanentFilter(select.filter);
        if (filter === UNREADABLE_SWEEP_FILTER) continue;
        for (const name of FILTERED_SWEEP_CANDIDATES) {
            const candidate = tryGetCardByName(name);
            if (!candidate) continue;
            const matches =
                filter === undefined ||
                matchesPermanentFilter(
                    {
                        id: candidate.id,
                        types: candidate.types,
                        subtypes: candidate.subtypes ?? [],
                        supertypes: candidate.supertypes ?? [],
                        colors: getCardColors(candidate),
                        staticAbilities: candidate.staticAbilities ?? [],
                    },
                    filter
                );
            if (matches) names.add(name);
        }
    }
    return [...names];
}

/** A `forEach` over the battlefield, as the sweep detectors read it. */
interface BattlefieldForEach {
    readonly select: Extract<EffectForEachSelector, { set: "permanents" }>;
    readonly effects: unknown;
}

/**
 * Every `forEach` over `set: "permanents"` in the card's SPELL script — only
 * `effects` and `modes` are read, plus any `extraRoots` a caller names (the
 * scripts of self-sacrifice abilities, see `spentSweepEffects`); a sweep
 * hosted by a triggered or any other activated ability is not one. The three detectors below read the same nodes
 * and differ only in which selector and body they claim.
 */
function battlefieldForEaches(
    def: CardDefinition,
    withSpell = true,
    extraRoots: unknown[] = []
): BattlefieldForEach[] {
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
    if (withSpell) {
        visit(def.effects);
        visit(def.modes);
    }
    extraRoots.forEach(visit);
    return found;
}

/** Does the selector name creatures — `type: "Creature"`, alone or in a list? */
function selectsCreatures(select: BattlefieldForEach["select"]): boolean {
    return [select.filter?.type ?? []].flat().includes("Creature");
}

/**
 * The permanent types the card's SPELL script takes off every player's
 * battlefield — a `forEach` over `set: "permanents"` with no `controller` (an
 * omitted controller selects every player's battlefield) whose body removes
 * ({@link removesSomething}: destroy, exile, or a bounce — issue #4781).
 * Wrath of God destroys creatures, Tranquility enchantments, Armageddon lands,
 * and a sweep with no filter at all removes them all. Empty when the card
 * sweeps nothing.
 *
 * What it does NOT model, each one leaving the symmetric pose:
 *  - a sweep whose body does not remove (a `+1/+1` to every creature, an
 *    animate). A toughness SHRINK is the other kind of sweep a creature can
 *    die to, and {@link shrinksEveryCreature} poses it;
 *  - a filter that names no `type` (`excludeType`, `subtype`, a colour):
 *    {@link filteredSweepSurplus} poses that one;
 *  - a sweep hosted by a triggered or activated ability.
 *
 * Lives HERE for the same reason as `needsStackTarget`: it decides what the
 * generated position CONTAINS, so it is a verdict input and must be inside the
 * Bot hash.
 */
function sweptTypes(def: CardDefinition): ReadonlySet<SweepableType> {
    const swept = new Set<SweepableType>();
    for (const { select, effects } of battlefieldForEaches(def)) {
        if (select.controller !== undefined || !removesSomething(effects))
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
 * CR 120.3e / 704.5g — does the SPELL script (or a self-sacrifice ability) deal damage to EVERY player's
 * creatures (a `forEach` over their battlefields, no `controller`, whose body
 * has a `dealDamage` aimed at the iteration object)? Damage marked on a
 * creature at least its toughness destroys it, so this is a sweep the way a
 * toughness shrink is: Tremor, Rain of Embers, Dry Spell and Fire Tempest cost
 * the holder the card and kill whatever the damage reaches. The amount is not
 * read — the pose hands the opponent bodies that die to ANY damage, so it
 * reads the same for a 1 as for a 6. The player half of a "each creature and
 * each player" spell is symmetric and needs no claim. Lives HERE for the same
 * reason as `sweptTypes`: it decides what the position CONTAINS.
 */
function damagesEveryCreature(def: CardDefinition): boolean {
    return damagesEveryCreatureIn(def, spentSweepEffects(def));
}

/**
 * CR 602.2 — the scripts of the abilities a permanent pays for with ITSELF: a
 * sacrifice cost and no tap. A permanent with one is put out to be spent, so
 * its sweep is one the holder buys with the card and is posed like the spell's.
 * Any other activated ability is a repeatable effect that keeps the body, and
 * is not read.
 */
function spentSweepEffects(def: CardDefinition): unknown[] {
    return (def.activatedAbilities ?? [])
        .filter((a) => a.cost.sacrifice === true && a.cost.tap !== true)
        .map((a) => a.effects);
}

/** Is the damage sweep of `def` one it spends ITSELF on (its spell script is
 *  not read)? The holder's own bodies then stay out of the pose: the sweep is
 *  bought for what it kills of the opponent's, the card the only price. */
function spendsItselfOnDamageSweep(def: CardDefinition): boolean {
    const spent = spentSweepEffects(def);
    return spent.length > 0 && damagesEveryCreatureIn(def, spent, false);
}

function damagesEveryCreatureIn(
    def: CardDefinition,
    roots: unknown[],
    withSpell = true
): boolean {
    const damagesEach = (node: unknown): boolean => {
        if (Array.isArray(node)) return node.some(damagesEach);
        if (node === null || typeof node !== "object") return false;
        const record = node as Record<string, unknown>;
        const to = record.to as { ref?: unknown } | undefined;
        return (
            (record.op === "dealDamage" && to?.ref === "$each") ||
            Object.values(record).some(damagesEach)
        );
    };
    // No claim where the card's cost or filter changes what the surplus is
    // worth: an additional cost (Sickening Dreams discards X) is paid out of
    // the position and prices the cast itself, and a `hasAbility` filter
    // (damage to fliers only) never reaches the 1/1s the pose adds.
    if (def.additionalCosts !== undefined) return false;
    return battlefieldForEaches(def, withSpell, roots).some(
        ({ select, effects }) =>
            select.controller === undefined &&
            selectsCreatures(select) &&
            select.filter?.hasAbility === undefined &&
            damagesEach(effects)
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
 * CR 121.1 — does the SPELL script make the holder draw (a `draw` whose
 * player is the controller)? A draw is worth the cards it finds, and the
 * generated library is basic lands the evaluator prices at nothing once the
 * lands are down — a draw finds nothing, so the Bot rightly passes over it.
 * The pose puts spells on top of the library. Only the holder's own draw makes
 * the claim: "target player draws" may be aimed at the opponent, and a draw
 * the holder does not get is not one the pose should sweeten.
 */
function drawsForController(def: CardDefinition): boolean {
    const visit = (node: unknown): boolean => {
        if (Array.isArray(node)) return node.some(visit);
        if (node === null || typeof node !== "object") return false;
        const record = node as Record<string, unknown>;
        return (
            (record.op === "draw" && record.player === "controller") ||
            Object.values(record).some(visit)
        );
    };
    return visit(def.effects) || visit(def.modes);
}

/**
 * CR 701.9a — does the SPELL script make a chosen player discard (a `discard`,
 * `discardAtRandom` or `discard-hand` choice whose player is an announced
 * target)? A discard is worth the cards it takes, and the generated opponent
 * holds lands: two discards of lands do not pay for the card, so the Bot
 * rightly passes over it. The pose gives the opponent a hand of spells to
 * take. Only a target-aimed discard makes the claim: the holder's own discard
 * (a cost, a wheel) is not one the pose should sweeten.
 */
function discardsFromTarget(def: CardDefinition): boolean {
    const aimedAtTarget = (player: unknown): boolean =>
        player !== null &&
        typeof player === "object" &&
        typeof (player as { target?: unknown }).target === "number";
    const visit = (node: unknown): boolean => {
        if (Array.isArray(node)) return node.some(visit);
        if (node === null || typeof node !== "object") return false;
        const record = node as Record<string, unknown>;
        const discards =
            record.op === "discard" ||
            record.op === "discardAtRandom" ||
            (record.op === "choice" && record.kind === "discard-hand");
        return (
            (discards && aimedAtTarget(record.player)) ||
            Object.values(record).some(visit)
        );
    };
    // CR 603.6a — a creature's ETB Ability that aims the discard is the same
    // claim (issue #4904).
    return (
        visit(def.effects) ||
        visit(def.modes) ||
        etbAbilityScripts(def).some(
            (script) => visit(script.effects) || visit(script.modes)
        )
    );
}

/**
 * CR 118.8 / 701.21a — does the SPELL's additional cost sacrifice a creature?
 * The generated position's bodies are a Grizzly Bears and an Ornithopter,
 * worth more to the evaluator than the cards a sacrifice-for-cards spell
 * returns, so the Bot rightly keeps them. The pose adds the cheapest body
 * ({@link FILLER_SMALL_CREATURE}) the cost can spend, the way a player
 * holding a spare 1/1 casts it.
 */
function sacrificesCreature(def: CardDefinition): boolean {
    const filter = def.additionalCosts?.sacrificeFilter;
    return (
        filter !== undefined && (filter.types?.includes("Creature") ?? false)
    );
}

/**
 * CR 118.8 / 121.1 — does the card pay a creature for the cards its own draw
 * finds ("As an additional cost to cast this spell, sacrifice a creature. Draw
 * two cards.")? The draw must then be worth more than the body, and the search
 * prices it on what the library HOLDS, never on its top cards (CR 401.2 — the
 * order of a library is hidden, so every iteration re-shuffles the holder's
 * own). Over the filler pile two draws found {@link DRAWN_SPELL} 8 times in
 * 28, less than the sacrificed 1/1 and the card together, and the Bot rightly
 * passed on 19 of 20 seat-seeds (issue #5029). The pose makes the holder's
 * whole library the drawn spell, the way a player casts it into a deck of
 * cards worth more than the spare body.
 *
 * Only this shape, by measurement: a draw that costs the card alone is already
 * paid for by the filler pile's share, and a library of nothing but spells
 * makes every LATER natural draw worth one too — which the last window of an
 * instant can read as a reason to wait. Stocked for every draw pose it turned
 * one cantrip from `played` to `ignored`, while every shipped card of THIS
 * shape, instants included, stays `played`
 * (docs/findings/5029-last-window-pass-scored-a-round-later.md).
 */
function paysBodyForDraw(def: CardDefinition): boolean {
    return drawsForController(def) && sacrificesCreature(def);
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
    /**
     * The search's own reasons for a `never-chosen` refusal (issue #4179): a
     * bounded projection of the `DecisionTrace` of the decision that passed
     * the card over — see {@link BotReachTrace}. Carried only when
     * `cause === "never-chosen"`: every other cause is decided before, or
     * without, a search that passed the card over.
     */
    readonly trace?: BotReachTrace;
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
/** The position a combat trick is posed in once both main phases passed it
 *  over (issue #4264) — see `combatTrickPosition`. */
export const TRICK_WINDOW = "TRICK_COMBAT";
/** The position a flash creature is posed in once both main phases passed it
 *  over — see `flashAmbushPosition`. */
export const AMBUSH_WINDOW = "FLASH_AMBUSH";
/**
 * CR 702.8a — the window a Flash permanent is posed in when both of the
 * holder's main phases passed it over: the OPPONENT's end step, the holder
 * holding priority with its mana open. The Bot holds an instant-speed card
 * it could cast earlier for an outcome-equal result (`last-window-deferral`,
 * issue #4757, which took over the Flash-permanent hold of issue #2248) and
 * casts it at the opponent's end step instead, so a sweep that posed only the
 * holder's own main phases read that hold as a refusal (issue #4260).
 */
export const OPPONENT_END_STEP_WINDOW = "OPPONENT_END_STEP";
type PoseWindow =
    | ReachWindow
    | typeof TRICK_WINDOW
    | typeof AMBUSH_WINDOW
    | typeof OPPONENT_END_STEP_WINDOW;

/** CR 117.1a / 702.8a — an instant, or a permanent spell with Flash:
 *  castable in a window the holder does not own, so the opponent's end step
 *  is a place the Bot may cast it. Widened from Flash permanents by issue
 *  #4757: the `last-window-deferral` rule holds EVERY deferrable action — a
 *  draw instant, an own-side grant — out of the holder's earlier windows for
 *  an outcome-equal result and takes it at the opponent's end step. */
function isInstantSpeedCard(def: CardDefinition): boolean {
    if (def.types.includes("Instant")) return true;
    return (
        !def.types.includes("Sorcery") &&
        (def.staticAbilities ?? []).includes("flash")
    );
}

/** Upper bound on follow-through decisions after the card's move. */
const MAX_FOLLOW_THROUGH_STEPS = 12;

/** Extra lands beyond the card's mana value — room for X and for a cost the
 *  mana value does not count (kicker, an activation after the cast). */
const EXTRA_LANDS = 2;

/**
 * CR 702.33a (Kicker) — the extra lands a kicker leg's coloured mana needs.
 * A kicker's mana is an additional cost the card's colour never counts
 * (`getCardColors` reads the printed cost only), so a mono-red card kicked
 * with {W}{W} was posed on Mountains alone, the kicked cast was never
 * payable, and the Bot was measured on the unkicked half of the card only.
 * One land per coloured pip of each leg, ADDED to the printed-cost lands so
 * the unkicked cast stays exactly as payable as before. Lives HERE for the
 * same reason as `sweptTypes`: it decides what the position CONTAINS, so it
 * is a verdict input and must be inside the Bot hash.
 */
function kickerLands(def: CardDefinition): string[] {
    const lands: string[] = [];
    for (const { mana } of def.kickers ?? [])
        for (const color of getColorsFromCost(mana))
            for (let i = 0; i < (mana?.[color] ?? 0); i++)
                lands.push(basicLandsForColors([color])[0]!);
    return lands;
}

/** How many MORE of each swept type the opponent holds than the holder. A
 *  sweep costs the holder the card itself and everything of its own it
 *  destroys; the opponent's surplus is what pays for both. Only the SWEPT types
 *  get a surplus: an unswept filler is not inert (Castle gives its controller's
 *  untapped creatures +0/+2, so three spare Castles kept the opponent's
 *  creatures alive through a -4/-4 sweep and read as a bad cast). */
const SWEEP_SURPLUS = 3;

/** What a card that draws finds: a 4/4 flier, a card worth more than the card
 *  it costs and than the creature a "sacrifice a creature" cost gives up. */
const DRAWN_SPELL = "Serra Angel";
/** How many of them sit on top of the holder's library — more than the biggest
 *  shipped draw takes. The search does not see that order (CR 401.2: it
 *  re-shuffles the holder's own library at every iteration), so what it
 *  prices is their SHARE of the pile: {@link DRAWN_SPELLS} over
 *  {@link LIBRARY_FILLER} more basics. That share pays for a draw whose only
 *  cost is the card; {@link paysBodyForDraw} is the pose where it does not. */
const DRAWN_SPELLS = 8;
/** The basic lands every generated library is filled with, both seats. */
const LIBRARY_FILLER = 20;

/** How many cards sit in the opponent's hand for a spell that makes a player
 *  discard: as many as the biggest shipped discard asks for (Three Tragedies,
 *  3), so every discard the spell makes lands on a card. */
const TARGET_HAND = 3;
/** What the search re-deals that hand from: {@link DRAWN_SPELL}s on top of the
 *  opponent's library. The search re-determinizes a hidden hand from the
 *  unseen pool at every iteration, so a spell in the hand itself is priced as
 *  whatever the pool holds — basic lands, a card the evaluator prices well
 *  under the creature a "sacrifice a creature" cost gives up. */
const TARGET_LIBRARY = 12;

/** The card every generated position seeds as the object a target, a
 *  sacrifice or a discard can use — a real catalogue creature, both sides, in
 *  every zone a target requirement names. */
const FILLER_CREATURE = "Grizzly Bears";

/** The stack of a card whose spell target is an ENTERS trigger's, not its
 *  own: the opponent's plain filler spell. */
const DEFAULT_STACK_POSE: StackPose = {
    cards: [],
    stack: [{ kind: "spell", name: FILLER_CREATURE, controller: "opp" }],
};
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

/** The opponent's declared attack a card is posed against in {@link AMBUSH_WINDOW}:
 *  a flash creature's, or an attacker edict's. */
function ambushPosition(def: CardDefinition) {
    return flashAmbushPosition(def) ?? attackEdictPosition(def);
}

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
 * toughness shrink or a damage sweep against a surplus of 1/1s (and no Castle
 * to prop them up),
 * a pump of the holder's own creatures with the holder's surplus of attackers.
 *
 * The card itself is NOT in the spec: the spec names cards, and a compiled
 * definition is registered by id only. The caller adds it to the hand.
 */
export function botReachSpec(
    def: CardDefinition,
    window: PoseWindow = REACH_WINDOWS[0]
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
    for (const name of kickerLands(def))
        cards.push({ name, owner: "me", zone: "battlefield" });
    const shrinks = shrinksEveryCreature(def) || damagesEveryCreature(def);
    const spendsSelf = spendsItselfOnDamageSweep(def);
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
        if (stands(FILLER_CREATURE) && !(owner === "me" && spendsSelf))
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
    for (const name of filteredSweepSurplus(def)) {
        // A land candidate is posed like a land sweep: the holder's own lands
        // may match too, so the opponent's exceed them by the surplus.
        const land = tryGetCardByName(name)?.types.includes("Land") ?? false;
        cards.push({
            name,
            owner: "opp",
            zone: "battlefield",
            count: land ? landCount + SWEEP_SURPLUS : SWEEP_SURPLUS,
        });
    }
    const wholeLibrary = paysBodyForDraw(def);
    if (drawsForController(def))
        cards.push({
            name: DRAWN_SPELL,
            owner: "me",
            zone: "library",
            position: 1,
            count: wholeLibrary ? DRAWN_SPELLS + LIBRARY_FILLER : DRAWN_SPELLS,
        });
    if (wholeLibrary)
        // `libraryCount` fills BOTH libraries, so the pose that keeps the
        // filler out of the holder's seeds the opponent's pile by hand.
        cards.push({
            name: cycle[0]!,
            owner: "opp",
            zone: "library",
            count: LIBRARY_FILLER,
        });
    if (discardsFromTarget(def))
        cards.push({
            name: DRAWN_SPELL,
            owner: "opp",
            zone: "library",
            position: 1,
            count: TARGET_LIBRARY,
        });
    if (sacrificesCreature(def))
        cards.push({
            name: FILLER_SMALL_CREATURE,
            owner: "me",
            zone: "battlefield",
        });
    const cost = costPose(def);
    const race = sorceryPumpRace(def) ?? sorceryLifeGainRace(def);
    cards.push(
        ...target.cards,
        ...cost.cards,
        ...(race?.cards ?? []),
        ...manaSinkPose(def, landCount),
        ...handPutPose(def, landCount),
        ...subtypeSweepPose(def),
        ...landTapPose(def),
        ...nonbasicBurnPose(def),
        ...graveyardExilePose(def),
        ...graveyardReturnPose(def),
        ...creatureSweepPose(def)
    );
    const stack = needsStackTarget(def)
        ? (stackPose(def, cycle[0]!) ?? DEFAULT_STACK_POSE)
        : undefined;
    if (stack) cards.push(...stack.cards);
    return {
        cards,
        phase:
            window === TRICK_WINDOW || window === AMBUSH_WINDOW
                ? "PRECOMBAT_MAIN"
                : window === OPPONENT_END_STEP_WINDOW
                  ? "END_STEP"
                  : window,
        turn: 3,
        libraryCount: wholeLibrary ? 0 : LIBRARY_FILLER,
        // CR 400.2 — a card the holder can discard or reveal that is never a
        // castable alternative: an opaque placeholder resolves to no
        // definition, so it cannot compete with the card for the decision.
        // A real filler in hand did: holding a second copy of the card, the
        // search's interchangeable-copy collapse (issue #3593) could pick the
        // filler as the representative and the card read as never chosen.
        hiddenHand: {
            me: 1,
            ...(discardsFromTarget(def) ? { opp: TARGET_HAND } : {}),
        },
        activePlayer: window === OPPONENT_END_STEP_WINDOW ? "opp" : "me",
        priority: "me",
        ...target.position,
        ...(race ? { life: race.life } : {}),
        ...(window === TRICK_WINDOW ? combatTrickPosition(def) : null),
        ...(window === AMBUSH_WINDOW ? ambushPosition(def) : null),
        ...(cost.manaPool ? { manaPool: cost.manaPool } : {}),
        ...(stack ? { stack: [...stack.stack] } : {}),
    };
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
    window: PoseWindow = REACH_WINDOWS[0]
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
    | {
          outcome: "ignored" | "frozen";
          cause: BotReachCause;
          form: string;
          trace?: BotReachTrace;
      };

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
    const trick: PoseWindow[] =
        combatTrickPosition(def) === null ? [] : [TRICK_WINDOW];
    const ambush: PoseWindow[] =
        ambushPosition(def) === null ? [] : [AMBUSH_WINDOW];
    const endStep: PoseWindow[] = isInstantSpeedCard(def)
        ? [OPPONENT_END_STEP_WINDOW]
        : [];
    for (const window of [...later, ...trick, ...ambush, ...endStep]) {
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

/**
 * What root enumeration did to the card's moves before the search could weigh
 * them — read through {@link enumerateRootMoves}, the search's own root list,
 * on the same state. Pure, so asking costs the search nothing. Evidence for
 * the finding's trace only (issue #4179); never an input to the verdict.
 *
 * `undefined` whenever ANY of the card's moves survived: a card can lose one
 * target to a collapse or one mode to dominance and still be weighed through
 * the others, and then what the search did is the answer. Only a card with no
 * surviving move was dropped before the search — `pruned` when dominance
 * dropped at least one of them (the stronger claim: proved a no-op), else
 * `collapsed`.
 */
function rootMoveFate(
    state: GameState,
    holderId: string,
    instanceId: string
): "pruned" | "collapsed" | undefined {
    let pruned = false;
    let collapsed = false;
    const kept = enumerateRootMoves(state, holderId, {
        onPruned: (m) => {
            if (usesCard(m, instanceId)) pruned = true;
        },
        onCollapsed: (m) => {
            if (usesCard(m, instanceId)) collapsed = true;
        },
    });
    if (kept.some((m) => usesCard(m, instanceId))) return undefined;
    return pruned ? "pruned" : collapsed ? "collapsed" : undefined;
}

/**
 * Issue #4758 — does every target requirement of the card's ETB Abilities
 * (CR 603.6a, `TriggeredAbility.etbAbility`) find NO legal target in the
 * position, asked of the card as the source that will be on the battlefield
 * (CR 603.3d: the trigger announces its targets as it goes on the stack)? False
 * for a card with no targeted ETB Ability. Reads the REGISTERED definition —
 * the sweep registers `def` before playing it, and only the registered copy
 * has its compiled trigger descriptors expanded and classified.
 */
export function etbFindsNoTarget(
    def: CardDefinition,
    state: GameState,
    holderId: string,
    instanceId: string
): boolean {
    const live = tryGetDefinition(def.id) ?? def;
    const requirements = (live.triggeredAbilities ?? [])
        .filter((t) => t.etbAbility === true)
        .flatMap((t) => [
            t.targetRequirement,
            ...(t.modes ?? []).map((m) => m.targetRequirement),
        ])
        .filter((r) => r !== undefined);
    if (requirements.length === 0) return false;
    const card = state.players
        .find((p) => p.id === holderId)
        ?.hand.find((c) => c.id === instanceId);
    if (!card) return false;
    const source = targetingSourceFromCard(card, false);
    return requirements.every(
        (r) => getLegalTargets(state, r, source, holderId).length === 0
    );
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
    // The FIRST seed's refusal, kept as the finding's evidence (issue #4179).
    // `searchWithTrace` builds the trace after choosing, so reading it costs
    // no draw from the search RNG and changes no verdict.
    let refusal: BotReachTrace | undefined;
    for (const seed of budget.seeds) {
        const { move, trace } = searchWithTrace(
            state,
            holderId,
            { iterations: budget.iterations },
            seed
        );
        if (move === null || !usesCard(move, instanceId)) {
            refusal ??= projectBotReachTrace(
                trace,
                move,
                instanceId,
                rootMoveFate(state, holderId, instanceId)
            );
            continue;
        }
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
    // Issue #4758 — an ETB Ability is spent on entering, so with nothing for it
    // to hit the Bot rightly HOLDS the card: the refusal is the position's
    // (it seeds no target the ETB can name), the same harness limit a spell
    // with no legal target is (issue #4259), never a claim about the Bot.
    if (etbFindsNoTarget(def, state, holderId, instanceId)) {
        return {
            outcome: "ignored",
            cause: "position-unmodelled",
            form: castShape(def),
        };
    }
    return {
        outcome: "ignored",
        cause: "never-chosen",
        form: castShape(def),
        ...(refusal === undefined ? {} : { trace: refusal }),
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
