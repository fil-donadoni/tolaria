import type {
    AiCombatHint,
    CardDefinition,
    CardPrint,
    CardSupertype,
    CardType,
    Color,
    ManaCost,
    Rarity,
    StaticEffect,
} from "./types";
import { cantBeEnchantedSelfGuard } from "./types";
import { setCardManaCostLookup } from "./manaCostLookup";
import { setCardSupertypeLookup } from "./supertypeLookup";
import * as lea from "./sets/lea";
import * as leb from "./sets/leb";
import * as arn from "./sets/arn";
import * as atq from "./sets/atq";
import * as leg from "./sets/leg";
import * as drk from "./sets/drk";
import * as fem from "./sets/fem";
import * as ice from "./sets/ice";
import * as jou from "./sets/jou";
import * as unlimited from "./sets/2ed";
import * as revised from "./sets/3ed";
// Vintage Cube card-draw / card-advantage tranche (issue #674) — cross-set
// home sets routed to earliest paper printing (ADR 0041).
import * as lrw from "./sets/lrw";
import * as m11 from "./sets/m11";
import * as dft from "./sets/dft";
import * as dka from "./sets/dka";
import * as ulg from "./sets/ulg";
import * as voc from "./sets/voc";
import * as fifthDawn from "./sets/5dn";
import * as wth from "./sets/wth";
import * as tsp from "./sets/tsp";
import * as csp from "./sets/csp";
import * as ltc from "./sets/ltc";
import * as thb from "./sets/thb";
import * as fut from "./sets/fut";
import * as mh1 from "./sets/mh1";
import * as bro from "./sets/bro";
import * as sos from "./sets/sos";
// Issue #674 remaining tranche — additional cross-set home sets.
import * as avr from "./sets/avr";
import * as pc2 from "./sets/pc2";
import * as dmu from "./sets/dmu";
import * as mkm from "./sets/mkm";
import * as ltr from "./sets/ltr";
import * as mh2 from "./sets/mh2";
import * as blc from "./sets/blc";
import * as tdm from "./sets/tdm";
import * as stx from "./sets/stx";
import * as mh3 from "./sets/mh3";
// Effect Script tracer bullet (ADR 0045, issue #800) — first DSL-only card
// (Lava Spike), home set routed to earliest paper printing (ADR 0041).
import * as chk from "./sets/chk";
// Effect Script forEach construct (ADR 0045, issue #807) — Innocent Blood,
// the first choice-inside-forEach DSL card.
import * as ody from "./sets/ody";

function isCardPrint(value: unknown): value is CardPrint {
    return (
        typeof value === "object" &&
        value !== null &&
        "printId" in value &&
        "definitionId" in value &&
        "setCode" in value
    );
}

function isCardDefinition(value: unknown): value is CardDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "name" in value &&
        "types" in value
    );
}

// Set modules paired with their lowercase set code. The code is the home set
// of every `CardDefinition` declared in that module (e.g. Beta-original cards
// live in `leb` with home set "leb"); `CardPrint` entries carry their own
// `setCode` and may point at a definition from another module.
const setModules: { code: string; exports: Record<string, unknown> }[] = [
    { code: "lea", exports: lea },
    { code: "leb", exports: leb },
    { code: "arn", exports: arn },
    { code: "atq", exports: atq },
    { code: "leg", exports: leg },
    { code: "drk", exports: drk },
    { code: "fem", exports: fem },
    { code: "ice", exports: ice },
    { code: "jou", exports: jou },
    { code: "2ed", exports: unlimited },
    { code: "3ed", exports: revised },
    // Vintage Cube card-draw tranche (issue #674).
    { code: "lrw", exports: lrw },
    { code: "m11", exports: m11 },
    { code: "dft", exports: dft },
    { code: "dka", exports: dka },
    { code: "ulg", exports: ulg },
    { code: "voc", exports: voc },
    { code: "5dn", exports: fifthDawn },
    { code: "wth", exports: wth },
    { code: "tsp", exports: tsp },
    { code: "csp", exports: csp },
    { code: "ltc", exports: ltc },
    { code: "thb", exports: thb },
    { code: "fut", exports: fut },
    { code: "mh1", exports: mh1 },
    { code: "bro", exports: bro },
    { code: "sos", exports: sos },
    // Issue #674 remaining tranche.
    { code: "avr", exports: avr },
    { code: "pc2", exports: pc2 },
    { code: "dmu", exports: dmu },
    { code: "mkm", exports: mkm },
    { code: "ltr", exports: ltr },
    { code: "mh2", exports: mh2 },
    { code: "blc", exports: blc },
    { code: "tdm", exports: tdm },
    { code: "stx", exports: stx },
    { code: "mh3", exports: mh3 },
    // Effect Script tracer bullet (ADR 0045, issue #800).
    { code: "chk", exports: chk },
    // Effect Script forEach construct (ADR 0045, issue #807).
    { code: "ody", exports: ody },
];

const allCards: CardDefinition[] = setModules.flatMap((m) =>
    Object.values(m.exports).filter(isCardDefinition)
);

const allPrints: CardPrint[] = setModules.flatMap((m) =>
    Object.values(m.exports).filter(isCardPrint)
);

// definitionId → home set code (the module the CardDefinition is declared in).
const definitionSetCode = new Map<string, string>();
for (const m of setModules) {
    for (const value of Object.values(m.exports)) {
        if (isCardDefinition(value)) definitionSetCode.set(value.id, m.code);
    }
}

const definitionRegistry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.id, card])
);

/** Combined lookup: every `CardDefinition.id` plus every `CardPrint.printId`
 *  resolves to the same underlying definition. Built once at module load. */
const registry = new Map<string, CardDefinition>(definitionRegistry);

for (const print of allPrints) {
    const def = definitionRegistry.get(print.definitionId);
    if (!def) {
        throw new Error(
            `CardPrint ${print.printId} references unknown definitionId ${print.definitionId}`
        );
    }
    if (registry.has(print.printId)) {
        throw new Error(`Duplicate card id: ${print.printId}`);
    }
    registry.set(print.printId, def);
}

// ADR 0046 — Single registry seam. `getDefinition`/`tryGetDefinition` are the
// ONLY definition-resolution path for the engine, game mutations, projections,
// and the frontend (via `src/lib/card-utils.ts`'s public boundary). No
// consumer imports `convex/cards/sets/*` directly — enforced by the
// `no-restricted-imports` rule in `eslint.config.js` (CI-checked via
// `bun run lint`). Today this wraps the in-code `registry` Map below, built
// once from the statically-imported set modules; later it can become a
// cache + DB read (ADR 0046) without any consumer noticing, because the
// return type never changes shape.
//
// Hydration-at-entry: the `registry` Map is populated once, synchronously, at
// module evaluation time — i.e. once per cold Convex isolate, before any
// mutation runs. Every mutation entry point therefore sees an already-hydrated,
// in-memory map and reads it synchronously. This is why the GRE never goes
// async because of the registry: `getDefinition`/`tryGetDefinition` return a
// `CardDefinition` directly, never a `Promise`, and every one of their ~300
// call sites across `convex/gre/**` relies on that synchronous contract. If a
// future DB-backed registry needs an async fetch, it must still resolve into
// this same in-memory map BEFORE the GRE runs (at the mutation entry point,
// per ADR 0046) — the seam's signature must stay synchronous.
export const getDefinition = (cardId: string): CardDefinition => {
    const card = registry.get(cardId) ?? maybeSynthesizeToken(cardId);
    if (!card) {
        throw new Error(`Card not found: ${cardId}`);
    }
    return card;
};

/** Non-throwing variant. Returns null when the id isn't in the registry — used
 *  by subsystems that operate best-effort (layer system, test fixtures). */
export const tryGetDefinition = (cardId: string): CardDefinition | null =>
    registry.get(cardId) ?? maybeSynthesizeToken(cardId) ?? null;

// Break the set-module ↔ registry import cycle: inject a manaCost lookup into
// the (cycle-free) colors module so set runtime code can derive an opponent
// permanent's colours from its slim `{ id }` reference (Jihad — CR 202.2).
setCardManaCostLookup((cardId) => tryGetDefinition(cardId)?.manaCost);
// CR 205.4a — inject the printed-supertype lookup so snow-matters predicates
// resolve live snow status off a slim `{ id }` reference (cycle-free).
setCardSupertypeLookup((cardId) => tryGetDefinition(cardId)?.supertypes);

/** Registers a synthetic `CardDefinition` for a token (CR 111, 707.1).
 *  Tokens have no Scryfall print — their definition is derived from the
 *  effect that creates them. Idempotent: calling twice with the same id
 *  is a no-op so multiple `createToken` invocations share one entry. */
export const registerTokenDefinition = (def: CardDefinition): void => {
    if (registry.has(def.id)) return;
    registry.set(def.id, def);
};

/** Sentinel definition id for a face-down permanent (CR 708.2): a 2/2
 *  colourless nameless vanilla creature with no abilities. A face-down
 *  instance's `card.id` is swapped to this id (the real id is retained in
 *  `CardInstanceState.faceDownOf` for the turn-up), so every def-derived
 *  characteristic reader — colours, abilities, static effects — sees the
 *  vanilla 2/2 automatically. Registered in the lookup map only, NOT a set
 *  export, so it never enters the card pool or the catalogue guard tests. */
export const FACE_DOWN_CARD_ID = "face-down:2-2-vanilla";
registry.set(FACE_DOWN_CARD_ID, {
    id: FACE_DOWN_CARD_ID,
    name: "Face-down creature",
    // Rarity is a property of a printing (CR 206); a face-down permanent is
    // not a printed object, so its sentinel def carries a nominal "common".
    rarity: "common",
    manaCost: {},
    types: ["Creature"],
    power: 2,
    toughness: 2,
    // CR 708.9 / ADR 0013 — turn-up replacements. These ride the sentinel def
    // so EVERY face-down permanent inherits them automatically (the engine
    // collects replacement effects from a permanent's presented card def, which
    // for a face-down permanent is this sentinel). The moment a face-down
    // creature would deal damage, be dealt damage, or become tapped, it is
    // turned face up first and the original event proceeds against its real
    // self. Turn-up clears the face-down marker, so each effect fires at most
    // once (on the next event the permanent presents its real def, not this
    // one). Implemented in #124.
    replacementEffects: [
        {
            // Would DEAL damage → turn up, then deal damage with real power.
            id: "face-down-turnup-deal-damage",
            oracleText:
                "If this creature would deal damage, turn it face up, then it deals that damage.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" && event.sourceInstanceId === self.id,
            replace: (event, ctx) => {
                const { power } = ctx.turnSelfFaceUp();
                if (event.kind !== "damage") return { kind: "modified", event };
                return {
                    kind: "modified",
                    event: { ...event, amount: power },
                };
            },
        },
        {
            // Would BE DEALT damage → turn up, then damage applies vs real
            // toughness (lethal is checked against effective toughness later).
            id: "face-down-turnup-be-dealt-damage",
            oracleText:
                "If this creature would be dealt damage, turn it face up, then the damage is dealt.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "permanent" &&
                event.target.id === self.id,
            replace: (event, ctx) => {
                ctx.turnSelfFaceUp();
                return { kind: "modified", event };
            },
        },
        {
            // Would become TAPPED → turn up, then it becomes tapped.
            id: "face-down-turnup-tap",
            oracleText:
                "If this creature would become tapped, turn it face up, then it becomes tapped.",
            eventKind: "tap",
            appliesTo: (event, self) =>
                event.kind === "tap" && event.cardInstanceId === self.id,
            replace: (event, ctx) => {
                ctx.turnSelfFaceUp();
                return { kind: "modified", event };
            },
        },
    ],
});

/** Lazy synthesis of a token CardDefinition from a content-derived id
 *  (e.g. `token:Wasp|Artifact,Creature|Insect||1|1||flying`). Server-side
 *  registrations from `createToken` cover the canonical case, but the
 *  client bundle has a separate registry — when a projected token instance
 *  references an id we don't know, parse the parts back into a definition
 *  on demand and memoize it. Returns null for non-token ids. */
function maybeSynthesizeToken(cardId: string): CardDefinition | null {
    if (!cardId.startsWith("token:")) return null;
    const body = cardId.slice("token:".length);
    const parts = body.split("|");
    if (parts.length < 8) return null;
    const [
        name,
        typesRaw,
        subtypesRaw,
        supertypesRaw,
        powerRaw,
        toughnessRaw,
        colorsRaw,
        staticAbilitiesRaw,
        imagePrintIdRaw,
        // CR 611 — static-effect kinds present on the token (see
        // `tokenDefinitionId`). Trailing 10th segment; empty / absent for
        // tokens without continuous effects (back-compat with the pre-Tetravus
        // 9-segment ids, which have no trailing effects segment).
        staticEffectsRaw,
    ] = parts;
    const types = typesRaw.split(",").filter(Boolean) as CardType[];
    const subtypes = subtypesRaw.split(",").filter(Boolean);
    const supertypes = supertypesRaw.split(",").filter(Boolean) as
        | CardSupertype[]
        | [];
    const power = powerRaw === "" ? undefined : Number(powerRaw);
    const toughness = toughnessRaw === "" ? undefined : Number(toughnessRaw);
    const colors = colorsRaw.split("").filter(Boolean) as Color[];
    const staticAbilities = staticAbilitiesRaw.split(",").filter(Boolean);
    const imagePrintId =
        imagePrintIdRaw && imagePrintIdRaw.length > 0
            ? imagePrintIdRaw
            : undefined;
    // Rebuild any continuous static effects encoded in the id. Each closure
    // predicate is reconstructed from a named factory (the closure can't ride
    // the serialized id) — currently only Tetravite's "can't be enchanted"
    // self-guard. Deterministic so server registration and post-round-trip
    // rehydration produce an identical def (CR 611).
    const staticEffectKinds = (staticEffectsRaw ?? "")
        .split(",")
        .filter(Boolean);
    const staticEffects: StaticEffect[] = staticEffectKinds.includes(
        "permanent-guard"
    )
        ? [cantBeEnchantedSelfGuard()]
        : [];
    const manaCost: ManaCost = {};
    for (const c of colors) manaCost[c] = (manaCost[c] ?? 0) + 1;
    const def: CardDefinition = {
        id: cardId,
        name,
        // Tokens are not printed objects, so they have no real rarity (CR 206);
        // a nominal "common" satisfies the required field.
        rarity: "common",
        manaCost,
        types,
        ...(subtypes.length > 0 ? { subtypes } : {}),
        ...(supertypes.length > 0 ? { supertypes } : {}),
        power,
        toughness,
        ...(staticAbilities.length > 0 ? { staticAbilities } : {}),
        ...(imagePrintId ? { imagePrintId } : {}),
        ...(staticEffects.length > 0 ? { staticEffects } : {}),
    };
    registry.set(cardId, def);
    return def;
}

const nameRegistry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.name.toLowerCase(), card])
);

export const getCardByName = (name: string): CardDefinition => {
    const card = nameRegistry.get(name.toLowerCase());
    if (!card) {
        throw new Error(`Card not found by name: ${name}`);
    }
    return card;
};

/** Non-throwing variant of `getCardByName`. Returns null when no card with that
 *  name (case-insensitive) is registered — used by the decklist importer to
 *  collect unresolved names instead of aborting on the first miss. */
export const tryGetCardByName = (name: string): CardDefinition | null =>
    nameRegistry.get(name.toLowerCase()) ?? null;

export const getAllCardNames = (): string[] =>
    allCards.map((card) => card.name);

/** Reads the mana cost off a `CardInstanceState`-shaped object. Production
 *  stores only `{id}` in `instance.card` and relies on the registry; legacy
 *  test fixtures inline the cost on the same field. Tries embedded first so
 *  fixtures keep working, then falls back to the registry lookup. */
export function getInstanceManaCost(instance: {
    card: Record<string, unknown>;
}): ManaCost | undefined {
    const embedded = (instance.card as { manaCost?: ManaCost }).manaCost;
    if (embedded) return embedded;
    const id = (instance.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.manaCost ?? undefined) : undefined;
}

/** Reads the AI valuation override off a `CardInstanceState`-shaped object
 *  (ADR 0018). Production stores only `{id}` in `instance.card` and relies on
 *  the registry's `aiValue`; legacy test fixtures may inline it on the same
 *  field. Tries embedded first so fixtures keep working, then falls back to the
 *  registry. Returns undefined when the card has no override. */
export function getInstanceAiValue(instance: {
    card: Record<string, unknown>;
}): number | undefined {
    const embedded = (instance.card as { aiValue?: number }).aiValue;
    if (embedded !== undefined) return embedded;
    const id = (instance.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.aiValue ?? undefined) : undefined;
}

/** Reads the AI combat hint off a `CardInstanceState`-shaped object (ADR 0021,
 *  issue #229). Production stores only `{id}` in `instance.card` and relies on
 *  the registry; test fixtures may inline it on the same field. Tries embedded
 *  first so fixtures keep working, then falls back to the registry. Returns
 *  undefined when the card declares no combat hint. */
export function getInstanceAiCombatHint(instance: {
    card: Record<string, unknown>;
}): AiCombatHint | undefined {
    const embedded = (instance.card as { aiCombatHint?: AiCombatHint })
        .aiCombatHint;
    if (embedded !== undefined) return embedded;
    const id = (instance.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.aiCombatHint ?? undefined) : undefined;
}

/** All registered `CardDefinition`s in load order. Reprints are not included
 *  — each `CardPrint` resolves to the same definition, so callers iterating
 *  cards-as-data (deck builder index, card catalog) should consume this and
 *  use `getPrintsForCard` to enumerate printings. */
export const getAllCards = (): CardDefinition[] => allCards;

/** A single printing of a card: its image-key print id and the set it was
 *  printed in. */
export interface CardPrinting {
    printId: string;
    setCode: string;
}

/** All known printings of a card (the original definition plus every reprint),
 *  ordered with the original print first. Used by the deck builder UI to let the
 *  player pick which edition to include — `[0]` is the default (the original
 *  `CardDefinition`). */
export const getPrintingsForCard = (definitionId: string): CardPrinting[] => {
    const printings: CardPrinting[] = [
        {
            printId: definitionId,
            setCode: definitionSetCode.get(definitionId) ?? "",
        },
    ];
    for (const print of allPrints) {
        if (print.definitionId === definitionId) {
            printings.push({ printId: print.printId, setCode: print.setCode });
        }
    }
    return printings;
};

/** All known print ids of a card, original first. Thin wrapper over
 *  `getPrintingsForCard` for callers that only need the ids. */
export const getPrintsForCard = (definitionId: string): string[] =>
    getPrintingsForCard(definitionId).map((p) => p.printId);

/** True if the card with this definition id was originally printed in
 *  `setCode` — i.e. its home set (the module it is declared in) matches.
 *  Reprints in other sets do not change the home set, so this answers
 *  "originally printed in [set]" (Golgothian Sylex — "each nontoken permanent
 *  originally printed in Antiquities is sacrificed"). Accepts either a
 *  definition id or a reprint print id (resolved to its definition first).
 *  Unknown ids return false. */
export const isPrintedInSet = (cardId: string, setCode: string): boolean => {
    const def = tryGetDefinition(cardId);
    if (!def) return false;
    return definitionSetCode.get(def.id) === setCode;
};

/** Every set code in the catalogue (home sets + reprint sets), sorted. Drives
 *  the deck builder's set filter. */
export const getAllSetCodes = (): string[] => {
    const codes = new Set<string>();
    for (const code of definitionSetCode.values()) codes.add(code);
    for (const print of allPrints) codes.add(print.setCode);
    return [...codes].sort();
};

// printId → its own `CardPrint` (a reprint pins its set/rarity to THAT
// printing, which may differ from the home-set definition). Built once.
const printById = new Map<string, CardPrint>(
    allPrints.map((print) => [print.printId, print])
);

/** The deck-construction metadata a Format validator (`convex/formats.ts`,
 *  ADR 0036) keys on for a single deck-card id: the SET it was printed in, its
 *  printed RARITY, and whether it is a Basic land. A deck card id is either a
 *  reprint `printId` (its set/rarity come from that `CardPrint`) or the original
 *  `definitionId` (its set is the home set, its rarity the definition's). Both
 *  resolve to the same definition for the Basic check. `null` for an id absent
 *  from the registry (e.g. a removed card) so the validator can flag it. */
export interface DeckCardMeta {
    /** The CANONICAL definition id (`CardDefinition.id`) this deck-card id maps
     *  to. Every reprint `printId` of a card resolves to the SAME `cardId`, so a
     *  Format validator can count copies / apply restricted/banned budgets "by
     *  Card ID across printings" (ADR 0036) by grouping on this value, not the
     *  raw deck-card id. */
    cardId: string;
    setCode: string;
    rarity: Rarity;
    isBasic: boolean;
}

export const resolveDeckCardMeta = (cardId: string): DeckCardMeta | null => {
    const def = tryGetDefinition(cardId);
    if (!def) return null;
    const isBasic = def.supertypes?.includes("Basic") ?? false;
    // A reprint id pins to its own printing; otherwise it is the original
    // definition, whose set is the home set and whose rarity is the definition's.
    // `def.id` is the canonical key shared by every printing of the card, so the
    // Format validators can count "by Card ID across printings" (ADR 0036).
    const print = printById.get(cardId);
    if (print) {
        return {
            cardId: def.id,
            setCode: print.setCode,
            rarity: print.rarity,
            isBasic,
        };
    }
    return {
        cardId: def.id,
        setCode: definitionSetCode.get(def.id) ?? "",
        rarity: def.rarity,
        isBasic,
    };
};
