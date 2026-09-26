/**
 * What the Bot-play sweep's generated position must CONTAIN for a targeted
 * spell to be castable at all (issue #4259).
 *
 * The position (`botReachSpec`) seeds one plain creature per side, so a spell
 * whose target requirement narrows the creature — "power 4 or greater", "a
 * Human", "an attacking creature", "a tapped creature", "a white creature" —
 * finds no legal target, the engine refuses a HUMAN the cast too, and the
 * verdict reads `position-unmodelled`. That is a limit of the harness, never
 * a fact about the Bot, so the position learns the shape instead:
 *
 *  - {@link targetPose} adds a creature that satisfies the requirement, on the
 *    side where the spell is worth casting (the holder's own creature for a
 *    pump, the opponent's for everything else), and seeds the combat a
 *    `combatRoleFilter` names (CR 508.1 attacking, CR 509.1 blocking);
 *  - {@link costPose} adds what an additional cost or a colourless mana symbol
 *    needs (CR 601.2h: unpayable costs can't be paid): a real card to discard
 *    (an opaque placeholder has no definition, so it matches no discard
 *    filter) and floating {C} (a basic land type's intrinsic ability adds a coloured mana, CR 305.6).
 *
 * Lives beside `botReach.ts` for the same reason as its sibling helpers: it
 * decides what the position CONTAINS, so it is a verdict input and sits inside
 * the Bot hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { getCardColors } from "../../cards/colors";
import { registeredDefinitions } from "../../cards/registry";
import type {
    CardDefinition,
    CardSupertype,
    TargetRequirement,
} from "../../cards/types";
import type { ScenarioCard, ScenarioSpec } from "../../debugScenarioSpec";
import { LAND_SUBTYPE_MANA, manaValue } from "../constants";
import { targetSlotBeneficence } from "./beneficence";

/** The plain creature every generated position seeds (both sides), and the
 *  first choice for a requirement it already satisfies. */
const BASE_CREATURE = "Grizzly Bears";
/** A land card is a legal thing to discard for any cost that does not name a
 *  type, and, unlike a creature, never competes with the spell for the mana
 *  the position gives the holder. */
const DISCARD_LAND = "Plains";
/** The opponent's land a land-targeting spell is posed against. */
const TARGET_LAND = "Forest";

/** Keys a definition may carry and still be a body with nothing else to it: no
 *  ability, no effect, no replacement — a creature the position can place
 *  without changing what any other card in it does. */
const PLAIN_KEYS: ReadonlySet<string> = new Set([
    "id",
    "name",
    "rarity",
    "manaCost",
    "types",
    "subtypes",
    "supertypes",
    "power",
    "toughness",
    "oracleText",
    "setCode",
    "artist",
    "flavorText",
    "imagePrintId",
]);

/** 0 — a body with nothing else to it; 1 — the same body with `defender`
 *  (CR 702.3), which changes nothing about a target a spell answers (every
 *  Wall is one), or with the one keyword `required` names (CR 115.1 — "target
 *  creature with horsemanship" needs a body that carries it); `null` —
 *  anything with a behaviour of its own. */
function plainRank(def: CardDefinition, required?: string): 0 | 1 | null {
    if (def.types.length !== 1 || def.types[0] !== "Creature") return null;
    if (typeof def.power !== "number" || typeof def.toughness !== "number")
        return null;
    let rank: 0 | 1 = 0;
    for (const [key, value] of Object.entries(def)) {
        if (PLAIN_KEYS.has(key) || value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (
            key === "staticAbilities" &&
            Array.isArray(value) &&
            value.every(
                (ability) => ability === "defender" || ability === required
            )
        ) {
            rank = 1;
            continue;
        }
        return null;
    }
    return rank;
}

function asList<T>(value: T | readonly T[] | undefined): readonly T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

function withinRange(
    value: number,
    range: { min?: number; max?: number } | undefined
): boolean {
    if (!range) return true;
    return (
        (range.min === undefined || value >= range.min) &&
        (range.max === undefined || value <= range.max)
    );
}

/** Does a mana value meet an `mvFilter`? An `"X"` / `"sourcePower"` bound is
 *  read off an announcement or a source the position has not got, so no body
 *  is posed for it (the spell stays unposed, as before). */
function withinManaValue(
    mv: number,
    filter: NonNullable<TargetRequirement["mvFilter"]>
): boolean {
    const bounds = [filter.min, filter.max, filter.equals];
    if (bounds.some((b) => b !== undefined && typeof b !== "number"))
        return false;
    return (
        withinRange(mv, {
            min: filter.min as number | undefined,
            max: filter.max as number | undefined,
        }) &&
        (filter.equals === undefined || mv === filter.equals)
    );
}

/** Does `def` satisfy the CHARACTERISTIC clauses of `req` — the ones a body
 *  carries by itself. (Tapped and combat role are position, not printed.) */
function satisfiesCharacteristics(
    def: CardDefinition,
    req: TargetRequirement
): boolean {
    if (typeof def.power !== "number" || typeof def.toughness !== "number")
        return false;
    if (!withinRange(def.power, req.powerFilter)) return false;
    if (!withinRange(def.toughness, req.toughnessFilter)) return false;
    if (req.mvFilter && !withinManaValue(manaValue(def.manaCost), req.mvFilter))
        return false;
    if (
        req.requireAbility &&
        !(def.staticAbilities ?? []).includes(req.requireAbility)
    )
        return false;
    if (req.colorFilter && !getCardColors(def).includes(req.colorFilter))
        return false;
    if (
        req.colorFilterAny &&
        !req.colorFilterAny.some((c) => getCardColors(def).includes(c))
    )
        return false;
    const subtypes = asList(req.subtypeFilter);
    if (
        subtypes.length > 0 &&
        !subtypes.some((s) => (def.subtypes ?? []).includes(s))
    )
        return false;
    const supertypes: readonly CardSupertype[] = asList(req.supertypeFilter);
    return supertypes.every((s) => (def.supertypes ?? []).includes(s));
}

/** `scripts/oracle-compile.ts` registers each card it plays under this prefix;
 *  what the sweep has registered so far must not decide who is posed. */
const SWEEP_ID_PREFIX = "oracle-bot-reach:";

const creatureCache = new Map<string, CardDefinition | null>();

/** A plain creature satisfying `req`: the base creature when it
 *  already does, else the best plain one in the catalogue — by rank, then by
 *  name, because the registry's load order must not move a verdict. `null`
 *  when there is none. */
function creatureFor(req: TargetRequirement): CardDefinition | null {
    const key = JSON.stringify(req);
    const cached = creatureCache.get(key);
    if (cached !== undefined) return cached;
    let found: { def: CardDefinition; rank: number } | null = null;
    for (const def of registeredDefinitions()) {
        if (def.id.startsWith(SWEEP_ID_PREFIX)) continue;
        const rank =
            def.name === BASE_CREATURE
                ? -1
                : plainRank(def, req.requireAbility);
        if (rank === null || !satisfiesCharacteristics(def, req)) continue;
        if (
            found === null ||
            rank < found.rank ||
            (rank === found.rank && def.name < found.def.name)
        )
            found = { def, rank };
    }
    const body = found?.def ?? null;
    creatureCache.set(key, body);
    return body;
}

/** The body a "creature with <keyword>" requirement is posed with when no
 *  catalogue creature carries the keyword (nothing prints horsemanship, CR
 *  702.31): a plain body that satisfies the rest of the requirement, with the
 *  keyword GRANTED to it (CR 613.1f, layer 6), which is what a granted
 *  keyword is for. `null` when the requirement names no keyword or no body. */
function grantedBody(
    req: TargetRequirement
): { body: CardDefinition; keyword: string } | null {
    const keyword = req.requireAbility;
    if (keyword === undefined) return null;
    const body = creatureFor({ ...req, requireAbility: undefined });
    return body === null ? null : { body, keyword };
}

/** The requirement a single-target creature spell states, if it is one. */
function creatureRequirement(
    req: CardDefinition["targetRequirement"]
): TargetRequirement | null {
    if (!req || Array.isArray(req)) return null;
    const types = Array.isArray(req.type) ? req.type : [req.type];
    return types.includes("Creature") ? req : null;
}

/** The requirement a single-target LAND spell states, if it is one — a type
 *  list of exactly Land. Its subtype / supertype / nonbasic clauses are not
 *  read, except a basic land type (CR 305.6), which names the land posed. */
function landRequirement(
    req: CardDefinition["targetRequirement"]
): TargetRequirement | null {
    if (!req || Array.isArray(req)) return null;
    const types = Array.isArray(req.type) ? req.type : [req.type];
    return types.length === 1 && types[0] === "Land" ? req : null;
}

/** The land a land-targeting spell is cast at. The position's only lands are
 *  the holder's own (its cost), so with no land on the other side the one
 *  legal target is the holder's own mana: the Bot declines it, correctly, and
 *  the verdict read `never-chosen` about a position that never posed the
 *  question (issue #4262). A land destroyer is posed on the side where it is
 *  worth casting — the opponent's, or the holder's own for a boon. The land is
 *  a basic Forest, legal for any plain `Land` target, unless the requirement
 *  names a basic land type: then that basic. */
function landPose(
    def: CardDefinition,
    req: TargetRequirement,
    modeId: string | undefined
): TargetPose {
    const owner = favoursItsTarget(def, req, modeId) ? "me" : "opp";
    const named = asList(req.subtypeFilter).find((s) => s in LAND_SUBTYPE_MANA);
    return {
        cards:
            owner === "opp"
                ? [{ name: named ?? TARGET_LAND, owner, zone: "battlefield" }]
                : [],
        omitToughnessBoost: false,
        position: {},
    };
}

/** Is the spell's effect on its target a boon, so the holder casts it on ITS
 *  OWN creature rather than the opponent's? The Bot's own sign
 *  (`targetSlotBeneficence`), so the pose and the valuation cannot disagree;
 *  a requirement that says "you control" says the same thing outright. */
function favoursItsTarget(
    def: CardDefinition,
    req: TargetRequirement,
    modeId?: string
): boolean {
    return (
        req.controller === "you" ||
        targetSlotBeneficence(def, modeId, 0) === "beneficial"
    );
}

/** Does the spell's script raise a creature's power or toughness with a
 *  literal amount — the shape of a combat trick? (A `negate`d or computed
 *  amount is not read: it is not a trick the pose can size.) */
function raisesStats(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(raisesStats);
    if (node === null || typeof node !== "object") return false;
    const record = node as Record<string, unknown>;
    const up = (v: unknown): boolean => typeof v === "number" && v > 0;
    return (
        (record.op === "pump" && (up(record.power) || up(record.toughness))) ||
        Object.values(record).some(raisesStats)
    );
}

/** Is the spell an instant that raises its one target creature's stats — a
 *  combat trick? Its value lies in a declared combat, so a main phase with no
 *  combat in it never poses the question and the Bot rightly passes: the
 *  verdict read `never-chosen` about a timing the position did not offer
 *  (issue #4264). */
function isCombatTrick(def: CardDefinition, req: TargetRequirement): boolean {
    return (
        def.types.includes("Instant") &&
        favoursItsTarget(def, req) &&
        raisesStats(def.effects)
    );
}

/** The holder's plain creature attacks and the opponent's blocks it: the
 *  declare-blockers step, where the holder holds priority with the trick that
 *  decides the combat. Both are the position's own bodies. */
const TRICK_COMBAT: TargetPose["position"] = {
    phase: "DECLARE_BLOCKERS",
    activePlayer: "me",
    priority: "me",
    combat: {
        attackers: [BASE_CREATURE],
        confirmed: true,
        blockers: [{ blocker: BASE_CREATURE, blocking: [0] }],
        blockersConfirmed: true,
    },
};

/**
 * The declared combat a combat trick is posed in, or `null` when `def` is not
 * one. It is a THIRD window, tried only after both main phases passed the card
 * over (`playSeat`): a trick some position already plays there must not lose
 * that position, and one a main phase never poses (a pump has nothing to pump
 * before blockers) gets the combat it is worth casting in.
 */
export function combatTrickPosition(
    def: CardDefinition
): TargetPose["position"] | null {
    const req = creatureRequirement(def.targetRequirement);
    return req && !narrows(req) && isCombatTrick(def, req)
        ? TRICK_COMBAT
        : null;
}

/** The opponent's plain creature attacks the holder, who holds priority in the
 *  declare-attackers step (CR 508.1, CR 117.1a): the moment an instant-speed
 *  creature is cast to block. */
const FLASH_AMBUSH: TargetPose["position"] = {
    phase: "DECLARE_ATTACKERS",
    activePlayer: "opp",
    priority: "me",
    combat: { attackers: [BASE_CREATURE], confirmed: true },
};

/**
 * The declared attack a flash creature is posed against, or `null` when `def`
 * is not one. A FOURTH window, tried only after both main phases passed the
 * card over (`playSeat`), like {@link combatTrickPosition}: in a main phase
 * holding a flash creature and casting it are the same play a turn later, so
 * the search sees a tie there; against an attacker it is not one, since the
 * creature cast now can block and win the combat (a flash creature is cast
 * any time its controller could cast an instant, CR 702.8a).
 */
export function flashAmbushPosition(
    def: CardDefinition
): TargetPose["position"] | null {
    return def.types.includes("Creature") &&
        (def.staticAbilities ?? []).includes("flash") &&
        def.targetRequirement === undefined
        ? FLASH_AMBUSH
        : null;
}

/** The literal power a sorcery's script adds to its one target creature, when
 *  the script is that pump and nothing else; `null` for any other spell. */
function soleSorceryPumpPower(def: CardDefinition): number | null {
    const [only, ...rest] = def.effects ?? [];
    if (!def.types.includes("Sorcery") || !only || rest.length > 0) return null;
    const power = (only as { power?: unknown }).power;
    return only.op === "pump" && typeof power === "number" && power > 0
        ? power
        : null;
}

/**
 * The race a sorcery pump is posed in (issue #4270). A pump has nothing to
 * pay for until its creature attacks, and the same main phase goes on to make
 * that attack; the generated position (level bodies, a full life total) never
 * shows the search a swing the pump decides, so the Bot rightly keeps the
 * card. Here the opponent is at as much life as the pump adds power — out of
 * reach of the base creature (Grizzly Bears, power 2) alone, within reach of
 * the pumped one — and the holder has a spare body to attack beside it.
 * `null` when `def` is not a pump of the holder's own creature.
 */
export function sorceryPumpRace(
    def: CardDefinition
): { cards: ScenarioCard[]; life: { opp: number } } | null {
    const req = creatureRequirement(def.targetRequirement);
    const power = soleSorceryPumpPower(def);
    if (!req || narrows(req) || power === null || !favoursItsTarget(def, req))
        return null;
    return {
        cards: [{ name: BASE_CREATURE, owner: "me", zone: "battlefield" }],
        life: { opp: power },
    };
}

/** Is `def` a sorcery whose whole script is the controller gaining life? */
function isSorceryLifeGain(def: CardDefinition): boolean {
    const [only, ...rest] = def.effects ?? [];
    return (
        def.types.includes("Sorcery") &&
        only !== undefined &&
        rest.length === 0 &&
        only.op === "gainLife" &&
        (only as { player?: unknown }).player === "controller"
    );
}

/**
 * The race a life-gain sorcery is posed in. Life pays only when it is
 * scarce: at a full life total the Bot rightly keeps the card, so the holder
 * is one point from dead against a board that outnumbers its one blocker (the
 * position's own opposing bodies plus two more plain creatures). `null` when `def` is not a sorcery that only gains its controller life.
 */
export function sorceryLifeGainRace(
    def: CardDefinition
): { cards: ScenarioCard[]; life: { me: number } } | null {
    if (!isSorceryLifeGain(def)) return null;
    return {
        cards: [
            {
                name: BASE_CREATURE,
                owner: "opp",
                zone: "battlefield",
                count: 2,
            },
        ],
        life: { me: 1 },
    };
}

export type TargetPose = {
    readonly cards: readonly ScenarioCard[];
    /** The position's global enchantment gives its controller's untapped
     *  creatures +0/+2, which puts every body over a "toughness N or less"
     *  ceiling: a requirement that has one is posed without it. */
    readonly omitToughnessBoost: boolean;
    readonly position: Pick<
        ScenarioSpec,
        "phase" | "activePlayer" | "priority" | "combat"
    >;
};

const NO_POSE: TargetPose = {
    cards: [],
    omitToughnessBoost: false,
    position: {},
};

/** Does the requirement narrow the target beyond "a creature" — i.e. is the
 *  position's plain creature possibly not enough? */
function narrows(req: TargetRequirement): boolean {
    return (
        req.powerFilter !== undefined ||
        req.toughnessFilter !== undefined ||
        req.colorFilter !== undefined ||
        req.colorFilterAny !== undefined ||
        req.subtypeFilter !== undefined ||
        req.supertypeFilter !== undefined ||
        req.tappedFilter !== undefined ||
        req.mvFilter !== undefined ||
        req.requireAbility !== undefined ||
        req.combatRoleFilter !== undefined
    );
}

/**
 * The creature and, when the requirement names a combat role, the declared
 * combat that make `def` castable; seats are the position's own (`"me"` is
 * the holder).
 */
export function targetPose(def: CardDefinition): TargetPose {
    const modes = def.targetRequirement ? [] : (def.modes ?? []);
    if (modes.length === 0)
        return requirementPose(def, def.targetRequirement, undefined);
    // A modal spell states its targets per mode (CR 700.2a): the position holds
    // what EACH mode needs, so whichever the Bot picks has a legal target
    // (issue #4268). A combat a mode's role names is the first such mode's.
    const poses = modes.map((m) =>
        requirementPose(def, m.targetRequirement, m.id)
    );
    return {
        cards: poses.flatMap((p) => p.cards),
        omitToughnessBoost: poses.some((p) => p.omitToughnessBoost),
        position: poses.find((p) => p.position.phase)?.position ?? {},
    };
}

/**
 * A spell that untaps an announced target needs something TAPPED to untap
 * (CR 701.26b — an untapped permanent does not untap). The position seeds only
 * untapped permanents, so the effect changes nothing in it and passing is the
 * right play; the pose gives the holder a tapped body of its own, the thing an
 * untap is worth casting on (issue #4288). `null` when `def` untaps no
 * announced target.
 */
function untapPose(def: CardDefinition): TargetPose | null {
    const untaps = (def.effects ?? []).some(
        (e) =>
            e.op === "tapUntap" &&
            e.action === "untap" &&
            typeof (e.target as { target?: unknown }).target === "number"
    );
    if (!untaps) return null;
    return {
        cards: [
            {
                name: BASE_CREATURE,
                owner: "me",
                zone: "battlefield",
                tapped: true,
            },
        ],
        omitToughnessBoost: false,
        position: {},
    };
}

/** The pose for ONE target requirement — the spell's own, or a mode's. */
function requirementPose(
    def: CardDefinition,
    target: CardDefinition["targetRequirement"],
    modeId: string | undefined
): TargetPose {
    const landReq = landRequirement(target);
    if (landReq) return landPose(def, landReq, modeId);
    const untap = modeId === undefined ? untapPose(def) : null;
    if (untap) return untap;
    const req = creatureRequirement(target);
    if (!req || !narrows(req)) return NO_POSE;
    const printed = creatureFor(req);
    const granted = printed === null ? grantedBody(req) : null;
    const body = printed ?? granted?.body ?? null;
    if (body === null) return NO_POSE;
    const name = body.name;
    const owner = favoursItsTarget(def, req, modeId) ? "me" : "opp";
    const other = owner === "me" ? "opp" : "me";
    // The position already seeds the base creature on both sides.
    const tapped = req.tappedFilter === "tapped";
    const cards: ScenarioCard[] =
        name === BASE_CREATURE && !tapped && !granted
            ? []
            : [
                  {
                      name,
                      owner,
                      zone: "battlefield",
                      ...(tapped ? { tapped: true } : {}),
                      ...(granted
                          ? {
                                animated: {
                                    power: body.power as number,
                                    toughness: body.toughness as number,
                                    grantedAbilities: [granted.keyword],
                                },
                            }
                          : {}),
                  },
              ];
    const omitToughnessBoost = req.toughnessFilter?.max !== undefined;
    const roles = asList(req.combatRoleFilter);
    // A granted keyword rides a second copy of the body, and the combat seed
    // resolves the FIRST card of that name: the role would land on the filler.
    if (granted && roles.length > 0) return NO_POSE;
    if (roles.includes("attacking")) {
        // CR 508.1 — the target attacks, its controller is the active player
        // and the holder answers at instant speed (CR 117.1a).
        return {
            cards,
            omitToughnessBoost,
            position: {
                phase: "DECLARE_ATTACKERS",
                activePlayer: owner,
                priority: "me",
                combat: { attackers: [name], confirmed: true },
            },
        };
    }
    if (roles.includes("blocking")) {
        // CR 509.1 — the target blocks the other side's plain creature; the
        // attacker's controller is the active player.
        return {
            cards,
            omitToughnessBoost,
            position: {
                phase: "DECLARE_BLOCKERS",
                activePlayer: other,
                priority: "me",
                combat: {
                    attackers: [BASE_CREATURE],
                    confirmed: true,
                    blockers: [{ blocker: name, blocking: [0] }],
                    blockersConfirmed: true,
                },
            },
        };
    }
    return { cards, omitToughnessBoost, position: {} };
}

export type CostPose = {
    readonly cards: readonly ScenarioCard[];
    readonly manaPool?: NonNullable<ScenarioSpec["manaPool"]>;
};

/** What paying `def` needs that the position's lands and opaque hand do not
 *  provide. */
export function costPose(def: CardDefinition): CostPose {
    const cards: ScenarioCard[] = [];
    const discard = def.additionalCosts?.discard;
    if (discard && typeof discard.count === "number") {
        const types = asList(discard.filter?.type);
        const name =
            types.length === 0 || types.includes("Land")
                ? DISCARD_LAND
                : BASE_CREATURE;
        cards.push({
            name,
            owner: "me",
            zone: "hand",
            count: discard.count,
        });
    }
    const colourless = def.manaCost?.C ?? 0;
    return {
        cards,
        ...(colourless > 0 ? { manaPool: { me: { C: colourless } } } : {}),
    };
}
