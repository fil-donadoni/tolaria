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
 *    filter) and floating {C} (no basic land produces colourless, CR 106.1b).
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

/** The plain creature every generated position seeds (both sides), and the
 *  first choice for a requirement it already satisfies. */
const BASE_CREATURE = "Grizzly Bears";
/** CR 305.6 — a land card is a legal thing to discard for any cost that does
 *  not name a type, and, unlike a creature, never competes with the spell for
 *  the mana the position gives the holder. */
const DISCARD_LAND = "Plains";

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
 *  Wall is one); `null` — anything with a behaviour of its own. */
function plainRank(def: CardDefinition): 0 | 1 | null {
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
            value.every((ability) => ability === "defender")
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

const creatureCache = new Map<string, string | null>();

/** The name of a plain creature satisfying `req`: the base creature when it
 *  already does, else the best plain one in the catalogue — by rank, then by
 *  name, because the registry's load order must not move a verdict. `null`
 *  when there is none. */
function creatureFor(req: TargetRequirement): string | null {
    const key = JSON.stringify(req);
    const cached = creatureCache.get(key);
    if (cached !== undefined) return cached;
    let found: { name: string; rank: number } | null = null;
    for (const def of registeredDefinitions()) {
        const rank = def.name === BASE_CREATURE ? -1 : plainRank(def);
        if (rank === null || !satisfiesCharacteristics(def, req)) continue;
        if (
            found === null ||
            rank < found.rank ||
            (rank === found.rank && def.name < found.name)
        )
            found = { name: def.name, rank };
    }
    const name = found?.name ?? null;
    creatureCache.set(key, name);
    return name;
}

/** The requirement a single-target creature spell states, if it is one. */
function creatureRequirement(def: CardDefinition): TargetRequirement | null {
    const req = def.targetRequirement;
    if (!req || Array.isArray(req)) return null;
    const types = Array.isArray(req.type) ? req.type : [req.type];
    return types.includes("Creature") ? req : null;
}

/** Is the spell's effect on its target a boon — a non-negative pump — so the
 *  holder casts it on ITS OWN creature rather than the opponent's? A
 *  requirement that says "you control" says the same thing outright. */
function favoursItsTarget(
    def: CardDefinition,
    req: TargetRequirement
): boolean {
    if (req.controller === "you") return true;
    const onTarget = (def.effects ?? []).filter(
        (op) =>
            "target" in op &&
            typeof op.target === "object" &&
            op.target !== null &&
            "target" in op.target &&
            op.target.target === 0
    );
    return (
        onTarget.length > 0 &&
        onTarget.every(
            (op) => op.op === "pump" && op.power >= 0 && op.toughness >= 0
        )
    );
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
        req.combatRoleFilter !== undefined
    );
}

/**
 * The creature and, when the requirement names a combat role, the declared
 * combat that make `def` castable. `holderSeat` seats are the position's own
 * (`"me"` is the holder).
 */
export function targetPose(def: CardDefinition): TargetPose {
    const req = creatureRequirement(def);
    if (!req || !narrows(req)) return NO_POSE;
    const name = creatureFor(req);
    if (name === null) return NO_POSE;
    const owner = favoursItsTarget(def, req) ? "me" : "opp";
    const other = owner === "me" ? "opp" : "me";
    const cards: ScenarioCard[] = [
        {
            name,
            owner,
            zone: "battlefield",
            ...(req.tappedFilter === "tapped" ? { tapped: true } : {}),
        },
    ];
    const omitToughnessBoost = req.toughnessFilter?.max !== undefined;
    const roles = asList(req.combatRoleFilter);
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
    if (discard) {
        const types = asList(discard.filter?.type);
        const name =
            types.length === 0 || types.includes("Land")
                ? DISCARD_LAND
                : BASE_CREATURE;
        cards.push({
            name,
            owner: "me",
            zone: "hand",
            count: typeof discard.count === "number" ? discard.count : 1,
        });
    }
    const colourless = def.manaCost?.C ?? 0;
    return {
        cards,
        ...(colourless > 0 ? { manaPool: { me: { C: colourless } } } : {}),
    };
}
