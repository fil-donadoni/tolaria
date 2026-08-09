import type {
    ActivatedAbility,
    AiCombatHint,
    CardBackFace,
    CardDefinition,
    CardImageFace,
    CardSupertype,
    CardType,
    Color,
    ManaCost,
    StaticEffect,
    TokenSpec,
} from "./types";
import { resolveTokenStaticEffects } from "./tokenStaticEffects";
// CR 114 (issue #1221) — side-effect import so the emblem registry
// (`convex/cards/emblems.ts`) is populated whenever the card catalogue loads.
import "./emblems";
import { expandAnnihilator } from "./abilities/annihilator";
import { expandFadingVanishing } from "./abilities/fadingVanishing";
import { expandHideaway } from "./abilities/hideaway";
import { expandKeywordTriggers } from "./abilities/keywordTriggers";
import { expandChapterAbilities } from "./abilities/sagas";
import { setCardManaCostLookup } from "./manaCostLookup";
import { setCardSupertypeLookup } from "./supertypeLookup";

// ADR 0046 — Single registry seam. `getDefinition`/`tryGetDefinition` are the
// ONLY definition-resolution path for the engine, game mutations, projections,
// and the frontend (via `src/lib/card-utils.ts`'s public boundary). No
// consumer imports `convex/cards/sets/*` directly — enforced by the
// `no-restricted-imports` rule in `eslint.config.js` (CI-checked via
// `bun run lint`). Today this wraps the in-code `registry` Map, built once
// from the statically-imported set modules; later it can become a
// cache + DB read (ADR 0046) without any consumer noticing, because the
// return type never changes shape.
//
// Hydration-at-entry: the `registry` Map is populated once, synchronously, at
// module evaluation time — i.e. once per cold Convex isolate, before any
// mutation runs. Every mutation entry point therefore sees an already-hydrated,
// in-memory map and reads it synchronously. On the client the registry starts
// empty and is populated via `preloadDefinitions` before the board renders.

/** Combined lookup: every `CardDefinition.id` plus every `CardPrint.printId`
 *  resolves to the same underlying definition. Populated at module load (server)
 *  or via `preloadDefinitions` (client). */
const registry = new Map<string, CardDefinition>();

/** Preload a batch of CardDefinitions into the runtime registry. Idempotent:
 *  calling twice with the same id is a no-op (later loads win the value). */
export function preloadDefinitions(defs: CardDefinition[]): void {
    for (const def of defs) registry.set(def.id, def);
}

// ADR 0054 — implicit keyword expansion. `fading N` / `vanishing N` cards
// declare only the keyword string; the seam injects the enter-with-counters
// entry and the synthesized upkeep/sacrifice triggers. Memoized by definition
// identity (a base def is expanded at most once) so the ~300 `getDefinition`
// call sites pay the parse cost only on the first read of each card. The memo
// keys on the raw registry/token object, so tokens (`maybeSynthesizeToken`,
// `createTokenCopyOf`) expand through the same seam as printed cards.
const expansionCache = new WeakMap<CardDefinition, CardDefinition>();
const expandDefinition = (base: CardDefinition): CardDefinition => {
    const cached = expansionCache.get(base);
    if (cached) return cached;
    // ADR 0054 — chained keyword expansions. Each is a no-op unless its keyword
    // string is present, so order is irrelevant. Exalted/Prowess (issue #699)
    // inject triggered abilities from a bare `staticAbilities` string.
    // ADR 0078 — `chapterAbilities[]` (CR 714) desugars here too: the same
    // no-op-unless-declared shape, injecting the entry lore counter and the
    // chapter triggers. Hideaway N (CR 702.75, issue #783) injects its ETB
    // "look at the top N, exile one face down" trigger the same way, and
    // Annihilator N (CR 702.86, issue #2295) its declare-attackers
    // "defending player sacrifices N permanents" trigger — one per declared
    // instance of the keyword (CR 702.86b).
    const expanded = expandAnnihilator(
        expandHideaway(
            expandKeywordTriggers(
                expandFadingVanishing(expandChapterAbilities(base))
            )
        )
    );
    expansionCache.set(base, expanded);
    return expanded;
};

export const getDefinition = (cardId: string): CardDefinition => {
    const card = registry.get(cardId) ?? maybeSynthesizeToken(cardId);
    if (!card) {
        throw new Error(`Card not found: ${cardId}`);
    }
    return expandDefinition(card);
};

/** Non-throwing variant. Returns null when the id isn't in the registry — used
 *  by subsystems that operate best-effort (layer system, test fixtures). */
export const tryGetDefinition = (cardId: string): CardDefinition | null => {
    const card = registry.get(cardId) ?? maybeSynthesizeToken(cardId);
    return card ? expandDefinition(card) : null;
};

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

/** Makes `printId` resolve to the same `CardDefinition` object as
 *  `definitionId` already in the registry. Throws on unknown definitionId
 *  or duplicate printId. Used by `catalogue.ts` to wire reprint lookup. */
export function registerPrintAlias(
    printId: string,
    definitionId: string
): void {
    const def = registry.get(definitionId);
    if (!def) throw new Error(`Unknown definitionId: ${definitionId}`);
    if (registry.has(printId)) throw new Error(`Duplicate card id: ${printId}`);
    registry.set(printId, def);
}

/** Content-derived id for a synthesized token CardDefinition (CR 707.1). Two
 *  `createToken` calls with the same spec shape share one definition entry
 *  (and thus one image / one frontend lookup); two specs that differ on any
 *  field get two distinct ids. Stable across replays. The optional 9th
 *  segment is an `imagePrintId` (Scryfall UUID of a printed token) so the
 *  client lazy-synthesizer (`maybeSynthesizeToken`, below — the DECODE
 *  counterpart of this ENCODE) can recover the same image link without a
 *  separate registration call. Co-located with `maybeSynthesizeToken` (not
 *  `gre/state.ts`, where `createTokenPermanents` calls it) because it's the
 *  encode half of one shared codec — the id format both directions must
 *  agree on, including a synthesized BACK-face definition (`gre/transform.ts`
 *  reuses this SAME function, issue #1210) so the client's existing decoder
 *  picks up a transformed permanent's new face for free, no second codec. */
export function tokenDefinitionId(spec: TokenSpec): string {
    const parts = [
        spec.name,
        spec.types.join(","),
        (spec.subtypes ?? []).join(","),
        (spec.supertypes ?? []).join(","),
        spec.power ?? "",
        spec.toughness ?? "",
        (spec.colors ?? []).join(""),
        (spec.staticAbilities ?? []).join(","),
        // 9th segment (index 8): the printed-token Scryfall id, kept in place so
        // existing decoders that read `parts[8]` as the image print id are
        // unaffected.
        spec.imagePrintId ?? "",
        // 10th segment (index 9): CR 611 static-effect KEYS present on the
        // token (`TokenStaticEffectKey` — Tetravite's "can't be enchanted"
        // guard, the Construct's artifact-count CDA). A token carrying a static
        // effect is a distinct definition shape, so its presence must feed the
        // content hash. Keys, not effect KINDS as this segment once held: the
        // predicates are closures and can't be serialized, so the decoder has
        // to rebuild them from a named factory, and a bare kind ("pt-cda") does
        // not name one — it decoded to NOTHING for every shape but the single
        // hand-mapped guard. `resolveTokenStaticEffects` reads this same
        // segment back through the one shared table. Empty when the token has
        // no continuous effects (back-compat: a 9-segment id without this
        // trailing segment decodes as "no effects").
        (spec.staticEffectKeys ?? []).join(","),
        // 11th segment (index 10, issues #1191 + #778): the token's activated
        // abilities (Investigate's Clue: "{2}, Sacrifice this token: Draw a
        // card."; a functional Treasure's sacrifice-for-mana ability),
        // JSON-encoded (they are plain data — an `EffectTokenSpec` ability
        // carries only `id`/`cost`/`oracleText`/`useStack`/`effects`, no
        // closures) and URI-escaped so a `|` inside oracle text or an effect
        // string can never be confused with the segment delimiter. A token
        // WITH an activated ability gets a distinct definition from one
        // without (and from one with different abilities — the full JSON
        // subsumes an id-only key). Empty when the token has none (back-compat:
        // a 10-segment id without this trailing segment decodes as "no
        // abilities").
        spec.activatedAbilities && spec.activatedAbilities.length > 0
            ? encodeURIComponent(JSON.stringify(spec.activatedAbilities))
            : "",
        // 12th segment (index 11, issue #1210, CR 712) — the token's BACK
        // face (a double-faced token, e.g. the Incubator, OR a synthesized
        // back-face "token" itself — `gre/transform.ts` builds a TokenSpec
        // from `CardBackFace` and reuses this same function, so a
        // transformed permanent's id decodes through the SAME client-side
        // path as any other token; a back face is never itself given a
        // further `backFace`, so this segment is always empty for one).
        // JSON-encoded + URI-escaped like `activatedAbilities` above; a token
        // WITH a back face gets a distinct definition from one without (and
        // from one with a DIFFERENT back face). `entersWith.counters` is
        // deliberately NOT folded in here — it stamps counters onto each
        // created INSTANCE, not a characteristic of the shared definition,
        // so two specs differing only in entersWith counts still share one
        // definition (and thus one image / one frontend lookup). Empty when
        // the token has no back face (back-compat: an 11-segment id without
        // this trailing segment decodes as "no back face").
        spec.backFace ? encodeURIComponent(JSON.stringify(spec.backFace)) : "",
        // 13th segment (index 12, issue #1595) — which face `imagePrintId`
        // (the 9th segment above) itself renders. Only ever `"back"`, stamped
        // by `backFaceAsTokenSpec` (`gre/transform.ts`) when reshaping a
        // `CardBackFace` with its own `imagePrintId` — a real double-faced
        // Scryfall print shares ONE id across both faces, each served under
        // its own `front/`/`back/` CDN path (`src/lib/images.ts`). Folding it
        // into THIS content-derived id (not a separate out-of-band flag on
        // the registered `CardDefinition`) is what lets a client that never
        // ran the server-side `registerTokenDefinition` call — the ordinary
        // case, since `transformPermanent` runs server-side only — still
        // decode "back" from the wire `card.card.id` string alone via
        // `maybeSynthesizeToken` below. Empty when the face is front
        // (back-compat: a 12-segment id without this trailing segment
        // decodes as "front").
        spec.imagePrintFace ?? "",
        // 14th segment (index 13, issue #2380, CR 306.5b) — the spec's
        // PLANESWALKER starting loyalty. Reached only through
        // `backFaceAsTokenSpec` (`gre/transform.ts`) today: the ORI flip-walker
        // cycle's back face is a planeswalker, and CR 306.5b's entry placement
        // reads `CardDefinition.loyalty` off the definition the entering
        // permanent points at. That definition is the synthesized back face, so
        // unless loyalty rides this id a decode-only rebuild (cold isolate,
        // client-side engine run) hands back a planeswalker with no starting
        // loyalty. Empty when the spec has none (back-compat: a 13-segment id
        // without this trailing segment decodes as "no loyalty").
        spec.loyalty ?? "",
    ];
    return `token:${parts.join("|")}`;
}

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
        // CR 611 — static-effect KEYS present on the token (see
        // `tokenDefinitionId`). Trailing 10th segment; empty / absent for
        // tokens without continuous effects (back-compat with the pre-Tetravus
        // 9-segment ids, which have no trailing effects segment).
        staticEffectsRaw,
        // CR 707.2 (issue #1191) — the token's activated abilities
        // (Investigate's Clue), URI-escaped JSON (see `tokenDefinitionId`).
        // Trailing 11th segment; empty / absent for tokens without activated
        // abilities (back-compat with pre-#1191 10-segment ids).
        activatedAbilitiesRaw,
        // CR 712 (issue #1210) — the token's BACK face (a double-faced
        // token, e.g. the Incubator), URI-escaped JSON (see
        // `tokenDefinitionId`). Trailing 12th segment; empty / absent for
        // tokens without a back face (back-compat with pre-#1210
        // 11-segment ids).
        backFaceRaw,
        // Issue #1595 — which face `imagePrintId` (9th segment above)
        // renders: `"back"` for a synthesized back-face definition
        // (`gre/transform.ts`'s `backFaceAsTokenSpec`), empty/absent for
        // front (see `tokenDefinitionId`). Trailing 13th segment; empty /
        // absent for tokens predating #1595 (back-compat with pre-#1595
        // 12-segment ids, which decode as "front").
        imagePrintFaceRaw,
        // CR 306.5b (issue #2380) — PLANESWALKER starting loyalty (see
        // `tokenDefinitionId`). Trailing 14th segment; empty / absent for every
        // non-planeswalker spec and for ids predating #2380 (back-compat with
        // 13-segment ids, which decode as "no loyalty").
        loyaltyRaw,
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
    // Rebuild any continuous static effects encoded in the id. Each closure is
    // reconstructed from a named factory (the closure can't ride the serialized
    // id) through the SAME table the server registered from
    // (`cards/tokenStaticEffects.ts`), so registration and post-round-trip
    // rehydration produce an identical def (CR 611). This used to be a
    // hand-written `kinds.includes("permanent-guard")` branch, which silently
    // decoded every OTHER effect shape as "no static effects" — Urza's Saga's
    // Construct arrived as a bare 0/0 and died to the CR 704.5f SBA.
    const staticEffects: StaticEffect[] = resolveTokenStaticEffects(
        (staticEffectsRaw ?? "").split(",").filter(Boolean)
    );
    // Rebuild activated abilities encoded in the id (issue #1191). These are
    // plain data (a token's `EffectTokenSpec.activatedAbilities` are DSL-only
    // — no closures), so unlike `staticEffects` above they round-trip through
    // JSON directly with no named-factory reconstruction step.
    const activatedAbilities: ActivatedAbility[] | undefined =
        activatedAbilitiesRaw && activatedAbilitiesRaw.length > 0
            ? (JSON.parse(
                  decodeURIComponent(activatedAbilitiesRaw)
              ) as ActivatedAbility[])
            : undefined;
    // Rebuild the token's back face encoded in the id (CR 712, issue #1210).
    // Plain data (no closures), so it round-trips through JSON directly like
    // `activatedAbilities` above.
    const backFace: CardBackFace | undefined =
        backFaceRaw && backFaceRaw.length > 0
            ? (JSON.parse(decodeURIComponent(backFaceRaw)) as CardBackFace)
            : undefined;
    // Rebuild which face `imagePrintId` renders (issue #1595). A plain string
    // literal, no JSON/URI-escaping needed — mirrors `imagePrintIdRaw` above.
    const imagePrintFace: CardImageFace | undefined =
        imagePrintFaceRaw === "back" ? "back" : undefined;
    // CR 306.5b (issue #2380) — starting loyalty for a planeswalker spec (a
    // synthesized flip-walker back face). A bare number, no JSON/URI escaping,
    // mirroring `powerRaw`/`toughnessRaw` above.
    const loyalty =
        loyaltyRaw === undefined || loyaltyRaw === ""
            ? undefined
            : Number(loyaltyRaw);
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
        ...(loyalty !== undefined && !Number.isNaN(loyalty) ? { loyalty } : {}),
        ...(staticAbilities.length > 0 ? { staticAbilities } : {}),
        ...(imagePrintId ? { imagePrintId } : {}),
        ...(imagePrintFace ? { imagePrintFace } : {}),
        ...(staticEffects.length > 0 ? { staticEffects } : {}),
        ...(activatedAbilities && activatedAbilities.length > 0
            ? { activatedAbilities }
            : {}),
        ...(backFace ? { backFace } : {}),
    };
    registry.set(cardId, def);
    return def;
}

/** Reads the mana cost off a `CardInstanceState`-shaped object — the SINGLE
 *  authority every mana-value and cost-derived-colour reader shares (the layer
 *  context's `getManaValue`, `CAST_RESTRICTION_CTX`, `ATTACK_RESTRICTION_CTX`,
 *  `getEffectiveColors`).
 *
 *  Resolution order:
 *    1. `manaCostOverride` — an instance-level override (CR 707.2's "except it
 *       has no mana cost", Eternalize/Embalm tokens: `{}` → mana value 0). It
 *       outranks everything: a copy presents the COPIED card's definition, so
 *       nothing below could express the exception.
 *    2. the cost embedded on `instance.card` — production stores only `{id}`
 *       there, but legacy test fixtures inline the cost, so this keeps working.
 *    3. the registry definition for `instance.card.id`. */
export function getInstanceManaCost(instance: {
    card: Record<string, unknown>;
    manaCostOverride?: ManaCost;
}): ManaCost | undefined {
    if (instance.manaCostOverride) return instance.manaCostOverride;
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
