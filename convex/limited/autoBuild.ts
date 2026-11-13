// Auto-Build: Bot Drafter deck construction (PRD #1107 stories 24-25, ADR
// 0054/0055, issue #1115). Once a bot Seat's Pool is FINAL (Sealed: dealt at
// `startLimitedEvent`; Draft: `draftCompletedAt` set), it needs a playable
// Limited deck so a human can test their own draft against the table
// (`docs/adr/0055-limited-event-architecture.md` decision 3). Auto-Build:
//
//   0. finds the PLAN (`choosePlan`, PRD #8772): the Archetype the Pool is
//      deepest in, by the pick scorer's own accumulator
//      (`archetypeCommitment`: copies count, an unreviewed Archetype layer
//      at half weight), so the builder finishes the plan the draft was
//      heading for. No profiles, or no Archetype deep enough to be settled,
//      means no plan, and every step below runs exactly as without one;
//   1. picks the seat's colors by **castable value** (`chooseBuild`, issue
//      #9336): every candidate colour set of one to five colours is built
//      (steps 2 and 3) and scored as the sum, over its Maindeck spells, of
//      each spell's value times its castability against that deck's mana
//      base; the best set is kept. No count rule and no splash rule: a Pool
//      with little fixing pays so much castability per extra colour that two
//      colours (plus a splash) win, a cube Pool with duals, fetches and
//      Moxen pays little, so four or five win when the cards are worth it.
//      The plan is one input to a spell's value (`PLAN_CARD_RATING`), never
//      a veto on colours;
//   2. takes the plan's castable core first — its own cards, their
//      Capability partners and the deck's mana-producing spells — then
//      curve-fills a spell base from the Pool's on-colour (+ colourless)
//      cards — a gold card is on-colour only when EVERY coloured pip is a
//      colour of the deck — reusing `botDrafter.ts`'s `CURVE_TARGET` /
//      `curveBucket` shape so draft-time and build-time curve-awareness never
//      drift apart. A spell is scored on the SAME layered Pick Rating the
//      pick read (`candidateBaseRating`: DB → seed → the quality heuristic on
//      the rating scale), plus a **Castability** term (its pips against the
//      provisional deck's mana sources, `castability.ts`'s model — the one
//      the Draft Table Audit measures), plus a **Capability** bonus
//      (`capabilityFitTerm`, ADR 0072) against the cards already in the
//      Maindeck — so an enabler the Pool was drafted around is not cut for
//      weak standalone quality, and a heavy spell the mana cannot pay loses
//      its slot to a castable one;
//   3. plays the Pool's own on-color LANDS (a dual that pays for a colour
//      has to actually be in the deck), then tops the mana base up with
//      unlimited basics of the drafted set, allotted across the chosen colors
//      by the Maindeck's own pip demand.
//
// Every card-quality judgement routes through `botDrafter.ts` —
// `archetypeCommitment`, `candidateBaseRating`, `CURVE_TARGET`/`curveBucket`,
// `pipDemandByColor`, `sourceWeight`, `capabilityFitTerm` —
// deliberately: ONE card-quality authority for draft time and build time (ADR
// 0073's "Auto-Build consumes the same seams"), never two that drift apart.
//
// Deck SIZE and LAND COUNT: the Maindeck is exactly `FORMAT_RULES.limited.
// minMain` (40), the format's legality floor. The land count follows the
// curve: `LAND_COUNT_BASE + LAND_COUNT_PER_MANA_VALUE × average mana value` of
// the provisional spells, rounded and clamped into `LAND_COUNT_BAND` (16–18 —
// a deck averaging 2.5 or less plays 16, 3.5 or more plays 18; real Limited
// practice, not CR-mandated), and the spells fill the rest. A Pool too thin in spells
// still reaches 40 by GROWING the land count past the band, never by shipping
// a short deck.
//
// PURE and DETERMINISTIC — no `Math.random`, no `ctx`. Every decision is a
// function of `(pool, getMeta, resolveBasicLand, options)` alone, mirroring
// `botDrafter.ts`'s discipline (project convention: no convex-test harness,
// unit-tested directly against plain fixtures).
import type { DeckCard } from "../deckPresets";
import { FORMAT_RULES } from "../formats";
import type { Color } from "../cards/types";
import {
    CURVE_MAX_BUCKET,
    CURVE_TARGET,
    archetypeCommitment,
    candidateBaseRating,
    candidateQuality,
    capabilityFitTerm,
    curveBucket,
    pipDemandByColor,
    poolProfiles,
    sourceWeight,
    type CardEvalMeta,
    type GetPickRating,
} from "./botDrafter";
import { choosePlanArchetype, type ArchetypeScopeShare } from "./planArchetype";
import {
    addProducer,
    addSources,
    manaSourceKinds,
    pipCastability,
} from "./castability";
import { resolveFetchSources } from "./manaSourceColors";
import type { GetCardProfile } from "./cardProfilesCore";
import { isAutoDrivenSeat } from "./droppedSeat";
import type { LimitedPoolCard } from "./eventTypes";
import { arePoolsDealt, type LimitedEventStatus } from "./eventStatus";

/** The printed characteristics Auto-Build needs: `botDrafter.ts`'s own
 *  `CardEvalMeta` (so the pip / produced-colour arithmetic behind Colour
 *  Commitment, Castability and Fixing Value is literally the same code, ADR
 *  0073) EXTENDED with the two facts a deck BUILDER needs and a pack-picking
 *  heuristic never did:
 *
 *  - `isLand` (CR 305) — the spell / mana-source split that decides whether a
 *    Pool card competes for a spell slot or a land slot;
 *  - `isBasicLand` (CR 205.4a `Basic` supertype) — a basic is NOT fixing. The
 *    builder invents basics for free, so a basic already in the Pool must not
 *    be counted as evidence that the mana base can carry another colour;
 *    spending a land slot on it is precisely what takes a slot AWAY from the
 *    deck's other colours.
 *
 *  Extending (rather than re-declaring a parallel shape) is the point: adding
 *  a colour signal to `CardEvalMeta` reaches Auto-Build automatically, and the
 *  two modules cannot disagree about what a card's pips are. */
export interface AutoBuildCardMeta extends CardEvalMeta {
    isLand: boolean;
    isBasicLand: boolean;
}

/** The five TRUE colors (CR 105.1) — `Color` minus colorless `"C"`. A chosen
 *  Auto-Build color pair, a basic land's color, and the WUBRG scoring order
 *  are all always one of these five, never `"C"`: naming the narrower type
 *  once keeps `AutoBuiltDeck.colors` assignable to the Convex wire validator
 *  (`convex/limitedEvents.ts`'s `colorValidator`), which — correctly — has no
 *  `"C"` literal to assign into. */
export type TrueColor = Exclude<Color, "C">;

/** Resolves a drawn Pool card's Scryfall id to its `AutoBuildCardMeta`, or
 *  `null` when unresolvable — injected exactly like `GetCardEvalMeta`
 *  (`botDrafter.ts`) so this module never touches the card registry
 *  directly. An unresolvable entry is never selected as a Maindeck spell
 *  (see `autoBuildDeck`) but — like every Pool card — still lands in the
 *  Sideboard, so "no foreign cards" (nothing invented) and "every Pool card
 *  placed somewhere" both hold regardless. */
export type GetAutoBuildCardMeta = (
    scryfallId: string
) => AutoBuildCardMeta | null;

/** Resolves ONE basic land of `color` to the `DeckCard` Auto-Build should add
 *  — the printing from the drafted set when one exists, else the card's
 *  canonical printing (`resolveDeckCardMeta`'s definition id) as a fallback.
 *  Injected so this module never touches the card registry directly (mirrors
 *  `GetAutoBuildCardMeta`); the real resolver (`convex/limitedEvents.ts`)
 *  binds it to the event's own drafted set via `cardPrints`
 *  (`makeResolveBasicLand`, `convex/limited/resolveBasicLand.ts`). */
export type ResolveBasicLand = (color: TrueColor) => DeckCard;

/** A completed Auto-Build: the playable Maindeck + the rest of the Pool as
 *  Sideboard (ADR 0055's "whole Pool travels with the deck" MTGO model),
 *  plus the chosen colors (for a compact "R/G" label — the only spoiler the
 *  vs-AI hookup UI shows; the full decklist is never rendered ahead of a
 *  Match).
 *
 *  `colors` is a LIST, not a pair: one to five colours, the count a
 *  consequence of the Pool's fixing (issue #9336), heaviest pip demand
 *  first. */
export interface AutoBuiltDeck {
    cards: DeckCard[];
    sideboard: DeckCard[];
    colors: TrueColor[];
}

/** Canonical WUBRG order (CR 105.1) — both the color-scoring iteration order
 *  AND the deterministic tie-break when two colors score equal (a real risk
 *  on a small/synthetic Pool; JS's stable `Array.prototype.sort` combined
 *  with building `ranked` in this order already resolves ties this way, this
 *  constant just names the order once instead of re-deriving it). */
const WUBRG: readonly TrueColor[] = ["W", "U", "B", "R", "G"];

/** The format's own legality floor (`convex/formats.ts`, ADR 0036) — reused
 *  rather than re-declared so a future format tweak can't silently desync
 *  Auto-Build from what actually validates. */
const TARGET_MAIN_SIZE = FORMAT_RULES.limited.minMain;

/** The nominal land budget of a 40-card Limited deck — the land count the
 *  PROVISIONAL spell pass reserves before the curve decides the real one. Real-practice Limited deckbuilding, not CR-mandated. */
const NOMINAL_LAND_COUNT = 17;

/** Spell count of the provisional pass (`40 - 17`). */
const PROVISIONAL_SPELL_COUNT = TARGET_MAIN_SIZE - NOMINAL_LAND_COUNT;

/** The declared band the curve-sized land count lives in (real-practice
 *  Limited: 16 for a low curve, 18 for a deck of fatties). The floor is 16,
 *  not 15: under the Draft Table Audit's castability model every land below
 *  17 costs about 0.04 of mean castability on a low-curve set (LEA), and
 *  that model cannot see what the extra spell buys. Only a Pool too thin in
 *  spells to reach the format floor plays more than the band's top. */
export const LAND_COUNT_BAND = { min: 16, max: 18 } as const;

/** Land count = `LAND_COUNT_BASE + LAND_COUNT_PER_MANA_VALUE × average mana
 *  value`, rounded, then clamped into `LAND_COUNT_BAND`: an average of 2.5
 *  plays 16, 3.0 plays 17, 3.5 plays 18. */
const LAND_COUNT_BASE = 11;
const LAND_COUNT_PER_MANA_VALUE = 2;

/** Rating points a spell earns at full castability (`pipCastability` = 1) —
 *  the build-time Castability term is `BUILD_CASTABILITY_RATING × p`, so a
 *  spell its deck pays half the time gives up half a point to one it always
 *  pays. Large on the 0–5 scale on purpose: an uncastable card is a dead
 *  card, whatever it would do when cast. */
const BUILD_CASTABILITY_RATING = 1;

/** A spell whose castability against the provisional mana base is below this
 *  is maindecked only once every castable on-colour candidate is in: it
 *  competes after them, never against them. The audit counts the share of
 *  Maindeck spells below one half as the visible "uncastable" defect. */
export const BUILD_CASTABILITY_FLOOR = 0.5;

interface ResolvedEntry {
    entry: LimitedPoolCard;
    meta: AutoBuildCardMeta | null;
}

/** Resolves every Pool entry's meta, a fetch land's colours widened by the
 *  Pool lands it can find (issue #9348): the build counts a Polluted Delta
 *  beside a Tropical Island as a green source too. */
function resolvePool(
    pool: readonly LimitedPoolCard[],
    getMeta: GetAutoBuildCardMeta
): ResolvedEntry[] {
    const raw = pool.map((entry) => getMeta(entry.scryfallId));
    const known = raw.filter((m): m is AutoBuildCardMeta => m !== null);
    const resolved = resolveFetchSources(known);
    const byRaw = new Map(known.map((m, i) => [m, resolved[i]]));
    return pool.map((entry, i) => {
        const meta = raw[i];
        return { entry, meta: meta === null ? null : byRaw.get(meta)! };
    });
}

function resolvedMetas(
    resolved: readonly ResolvedEntry[]
): AutoBuildCardMeta[] {
    return resolved
        .map((r) => r.meta)
        .filter((m): m is AutoBuildCardMeta => m !== null);
}

/** The plan Auto-Build finishes: the Archetype the Pool is deepest in and
 *  which cards carry it. */
interface BuildPlan {
    archetype: string;
    isPlanCard: (meta: CardEvalMeta) => boolean;
}

/** Rating points a plan card adds to its value when a colour set is scored
 *  (issue #9336): the plan is one input to a spell's value, never a veto on
 *  colours. A set that plays the plan's cards outscores one that cuts them,
 *  by this much per castable plan card — so a plan whose cards are spread
 *  over many colours, or whose only coloured cards are one or two, moves
 *  the set by those cards alone and never more. Two points, not one: the
 *  Build Invariant (a deeper plan survives a rival plan rated two points
 *  higher, `autoBuild.bot.test.ts`) holds at two and fails at one, and on
 *  the Vintage Cube audit two raises the plan share at a small castability
 *  cost (`docs/research/draft-table-audit-castable-value.md`). */
const PLAN_CARD_RATING = 2;

/** The Pool's plan, or `null` when nothing is profiled or no Archetype is
 *  deep enough to be one. Depth is `archetypeCommitment`, the pick scorer's
 *  own accumulator (copies count, an unreviewed Archetype layer at half
 *  weight), read against the scope (`planArchetype.ts`, issue #9298): the
 *  plan is the settled Archetype the Pool holds furthest above what its
 *  scope would hand it, so a tag covering a quarter of the cube no longer wins by
 *  size. Card COUNT decides, never card quality. A plan must reach
 *  `ARCHETYPE_SETTLE_UNITS`, the depth at which the pick scorer counts a
 *  Pool as settled: below it, a scope with a handful of profiled cards
 *  builds as an unprofiled one. Ties break by Archetype id. */
function choosePlan(
    resolved: readonly ResolvedEntry[],
    getCardProfile: GetCardProfile | undefined,
    scopeShare: ArchetypeScopeShare | undefined
): BuildPlan | null {
    if (!getCardProfile) return null;
    const metas = resolvedMetas(resolved);
    const commitment = archetypeCommitment(poolProfiles(metas, getCardProfile));
    const archetype = choosePlanArchetype(commitment, metas.length, scopeShare);
    if (archetype === null) return null;
    return {
        archetype,
        isPlanCard: (meta: CardEvalMeta) =>
            getCardProfile(meta.cardId)?.archetypes.includes(archetype) ??
            false,
    };
}

/** The colour sets Auto-Build scores (issue #9336): every non-empty subset of
 *  the colours the Pool holds a SPELL pip in, one to five colours. A colour
 *  with only mana sources is fixing, never a colour of its own. Ordered by
 *  size, then by the subset's bitmask over WUBRG — the order ties resolve
 *  in, so an equal score keeps the smaller set. A Pool with no coloured spell (a degenerate/test case, never
 *  a real draft) yields the single set `["W", "U"]`. */
export function candidateColourSets(
    metas: readonly AutoBuildCardMeta[]
): TrueColor[][] {
    const demand = pipDemandByColor(metas.filter((m) => !m.isLand));
    const colours = WUBRG.filter((c) => (demand[c] ?? 0) > 0);
    if (colours.length === 0) return [["W", "U"]];
    const sets: TrueColor[][] = [];
    for (let mask = 1; mask < 1 << colours.length; mask++) {
        sets.push(colours.filter((_, i) => mask & (1 << i)));
    }
    return sets.sort((a, b) => a.length - b.length);
}

/** Orders a built deck's colours by its Maindeck's pip demand, heaviest
 *  first, ties by WUBRG: the deck's main colours lead and its lightest
 *  colours — what a reader calls the splash — come last. */
function byDeckDemand(
    colors: readonly TrueColor[],
    spells: readonly ResolvedEntry[]
): TrueColor[] {
    const demand = pipDemandByColor(spells.map((r) => r.meta!));
    return [...colors].sort(
        (a, b) =>
            (demand[b] ?? 0) - (demand[a] ?? 0) ||
            WUBRG.indexOf(a) - WUBRG.indexOf(b)
    );
}

/** A gold card is on-colour only when EVERY coloured pip is a colour of the
 *  deck — one payable pip of a `{W}{U}{B}` card does not cast it. A card with
 *  no coloured pip is on-colour when it is colourless or shares a deck colour
 *  (a colour identity with no pip: a pip-less coloured spell costs nothing
 *  the deck cannot pay). */
export function isOnColor(
    meta: CardEvalMeta,
    colors: ReadonlySet<Color>
): boolean {
    const pipColours = (Object.entries(meta.pips) as [Color, number][])
        .filter(([, n]) => n > 0)
        .map(([c]) => c);
    if (pipColours.length > 0) return pipColours.every((c) => colors.has(c));
    return meta.colors.length === 0 || meta.colors.some((c) => colors.has(c));
}

/** Scores one Maindeck CANDIDATE on the Pick Rating scale (ADR 0073's "one
 *  scale: rating points"). */
type SpellScore = (entry: ResolvedEntry) => number;

/** The candidate's base value: the layered Pick Rating the pick read, else
 *  the quality heuristic on the same scale (`candidateBaseRating`) — so a
 *  build-time bonus in rating points means here exactly what it meant at
 *  pick time, and an Admin's rating edit moves the build the way it moves
 *  the pick. */
function baseSpellScore(getPickRating?: GetPickRating): SpellScore {
    return (entry) => candidateBaseRating(entry.meta!, getPickRating);
}

/** Build-time **Capability** fit (issue #1615, ADR 0072): `capabilityFitTerm`
 *  measured against the cards ALREADY in the provisional Maindeck. The
 *  defect it fixes: a Pool drafted around Flash + Sneak Attack + Worldspine
 *  Wurm built with **Flash cut**, because `cardValueById` has no idea what
 *  Flash does. Once the Wurm is in the deck, that relation is worth rating
 *  points and Flash stops losing its slot to a marginally better standalone
 *  card. Absence of a match contributes exactly 0 (ADR 0072's veto is "no
 *  bonus", never a subtraction). */
function capabilityFit(
    deckMetas: readonly AutoBuildCardMeta[],
    getCardProfile: GetCardProfile
): SpellScore {
    const profiled = poolProfiles(deckMetas, getCardProfile);
    return (entry) => {
        const meta = entry.meta!;
        return capabilityFitTerm(meta, getCardProfile(meta.cardId), profiled)
            .rawValue;
    };
}

/** The land count the Maindeck's curve asks for: the provisional spells'
 *  average mana value through `LAND_COUNT_BASE + LAND_COUNT_PER_MANA_VALUE ×
 *  avg`, rounded and clamped into `LAND_COUNT_BAND`. No spell at all reads as
 *  the band's top (nothing to size, play the safe side). */
export function landCountForCurve(spells: readonly CardEvalMeta[]): number {
    if (spells.length === 0) return LAND_COUNT_BAND.max;
    const avg = spells.reduce((sum, m) => sum + m.manaValue, 0) / spells.length;
    const raw = Math.round(LAND_COUNT_BASE + LAND_COUNT_PER_MANA_VALUE * avg);
    return Math.min(LAND_COUNT_BAND.max, Math.max(LAND_COUNT_BAND.min, raw));
}

/** Curve-aware spell selection (PRD #1107 story 24: "curve-aware"): fills
 *  each `CURVE_TARGET` bucket from the best cards of the FIRST tier (the SAME
 *  curve shape `botDrafter.ts` uses at pick time), then tops up any shortfall
 *  tier by tier, best score first regardless of bucket, until `spellCount`
 *  is reached — so the Maindeck never falls short of the format floor because
 *  a Pool is colour-pure, and a later tier (a strained or off-colour spell)
 *  only plays when every earlier one is in.
 *
 *  `planFirst` cards (the plan's core, see `autoBuildDeck`) are taken before
 *  any of that, best score first; they occupy their curve buckets, so the curve
 *  fill tops up only what the plan left empty. Empty, the selection is the
 *  plan-less one.
 *
 *  `score` is injected so the SAME selection runs twice: once on standalone
 *  quality to establish what the deck provisionally is, then once more with
 *  the Castability and Capability terms measured against that provisional
 *  deck. */
function selectSpells(
    planFirst: readonly ResolvedEntry[],
    tiers: readonly (readonly ResolvedEntry[])[],
    spellCount: number,
    score: SpellScore
): ResolvedEntry[] {
    const chosen: ResolvedEntry[] = [];
    const taken = new Set<LimitedPoolCard>();
    const scores = new Map<ResolvedEntry, number>();
    const scoreOf = (r: ResolvedEntry): number => {
        let v = scores.get(r);
        if (v === undefined) {
            v = score(r);
            scores.set(r, v);
        }
        return v;
    };
    const byScoreDesc = (a: ResolvedEntry, b: ResolvedEntry): number =>
        scoreOf(b) - scoreOf(a);

    for (const r of [...planFirst].sort(byScoreDesc).slice(0, spellCount)) {
        chosen.push(r);
        taken.add(r.entry);
    }

    const first = tiers[0] ?? [];
    for (let bucket = 1; bucket <= CURVE_MAX_BUCKET; bucket++) {
        const inBucket = (r: ResolvedEntry) =>
            curveBucket(r.meta!.manaValue) === bucket;
        const target = Math.max(
            0,
            (CURVE_TARGET[bucket] ?? 0) - chosen.filter(inBucket).length
        );
        const bucketCards = first
            .filter((r) => !taken.has(r.entry) && inBucket(r))
            .sort(byScoreDesc);
        for (const r of bucketCards.slice(0, target)) {
            if (chosen.length >= spellCount) break;
            chosen.push(r);
            taken.add(r.entry);
        }
    }

    for (const tier of tiers) {
        const need = spellCount - chosen.length;
        if (need <= 0) break;
        const more = tier
            .filter((r) => !taken.has(r.entry))
            .sort(byScoreDesc)
            .slice(0, need);
        for (const r of more) {
            chosen.push(r);
            taken.add(r.entry);
        }
    }

    return chosen;
}

/** The Maindeck's land base for a given spell selection: the Pool's OWN
 *  on-colour NON-BASIC lands ahead of any basic (a dual land that pays for a
 *  colour has to actually BE in the deck), then basics allotted by the
 *  spells' per-colour pip DEMAND. Basics in the Pool are deliberately NOT
 *  taken: they are indistinguishable from the ones the builder invents for
 *  free, so maindecking them would only move cards between zones (and make
 *  the Sideboard lie about what the Pool held). Best fixing first: a land
 *  producing more of the chosen colours frees more slots, quality breaking
 *  the tie. */
interface ManaBase {
    lands: ResolvedEntry[];
    basics: Map<TrueColor, number>;
}

function buildManaBase(
    resolved: readonly ResolvedEntry[],
    spells: readonly ResolvedEntry[],
    colors: readonly TrueColor[],
    landCount: number
): ManaBase {
    const colorSet = new Set<Color>(colors);
    const lands = resolved
        .filter(
            (r) =>
                r.meta !== null &&
                r.meta.isLand &&
                !r.meta.isBasicLand &&
                r.meta.producedColors.some((c) => colorSet.has(c))
        )
        .map((r) => ({
            r,
            coverage: r.meta!.producedColors.filter((c) => colorSet.has(c))
                .length,
            quality: candidateQuality(r.meta!),
        }))
        .sort((a, b) => b.coverage - a.coverage || b.quality - a.quality)
        .slice(0, landCount)
        .map((x) => x.r);
    const basics = allotBasics(
        landCount - lands.length,
        colors,
        pipDemandByColor(spells.map((r) => r.meta!))
    );
    return { lands, basics };
}

/** A deck's mana sources by kind (`ManaSourceKinds`): its lands, its basics,
 *  and every spell that produces mana (a Mox, a mana creature) — the supply
 *  half the castability model reads. */
function deckSources(
    base: ManaBase,
    spells: readonly ResolvedEntry[]
): Map<string, number> {
    const sources = manaSourceKinds(
        [...base.lands.map((r) => r.meta!), ...spells.map((r) => r.meta!)],
        sourceWeight
    );
    for (const [c, n] of base.basics) addSources(sources, [c], n);
    return sources;
}

/** Castability of each candidate against the PROVISIONAL deck's sources
 *  (`pipCastability`, the audit's own model). A candidate that is itself one
 *  of those sources does not count itself, as in the audit. */
function castabilityAgainst(
    provisional: readonly ResolvedEntry[],
    base: ManaBase,
    deckSize: number
): (entry: ResolvedEntry) => number {
    const sources = deckSources(base, provisional);
    const inDeck = new Set(provisional.map((r) => r.entry));
    // A spell's castability is a function of its pips, its mana value and
    // the source it removes when it is one itself: computed once per shape.
    const byShape = new Map<string, number>();
    return (entry) => {
        const meta = entry.meta!;
        const removes =
            inDeck.has(entry.entry) && meta.producedColors.length > 0;
        const shape = [
            JSON.stringify(meta.pips),
            meta.manaValue,
            removes ? JSON.stringify(meta.producedColors) : "",
            removes ? JSON.stringify(meta.oneShotColors ?? []) : "",
        ].join("|");
        let p = byShape.get(shape);
        if (p === undefined) {
            let own: ReadonlyMap<string, number> = sources;
            if (removes) {
                const less = new Map(sources);
                addProducer(less, meta, sourceWeight, -1);
                own = less;
            }
            p = pipCastability(meta.pips, meta.manaValue, deckSize, own);
            byShape.set(shape, p);
        }
        return p;
    };
}

/** Allots `budget` basic lands across `colors`, weighted by the Maindeck's own
 *  per-colour pip DEMAND (issue #1615 generalises the old two-colour split to
 *  N colours). Largest-remainder apportionment keeps the total exactly
 *  `budget`; the WUBRG-ordered iteration keeps every tie-break deterministic.
 *  Each chosen colour gets at least one basic whenever the budget can afford
 *  one per colour — a colour you cannot produce at all is not a colour. */
function allotBasics(
    budget: number,
    colors: readonly TrueColor[],
    weights: Partial<Record<Color, number>>
): Map<TrueColor, number> {
    const counts = new Map<TrueColor, number>(colors.map((c) => [c, 0]));
    if (budget <= 0) return counts;

    const total = colors.reduce((sum, c) => sum + (weights[c] ?? 0), 0);
    const shares = colors.map((c) => ({
        c,
        exact:
            total > 0
                ? (budget * (weights[c] ?? 0)) / total
                : budget / colors.length,
    }));
    let assigned = 0;
    for (const s of shares) {
        const floor = Math.floor(s.exact);
        counts.set(s.c, floor);
        assigned += floor;
    }
    // Largest remainder, ties by the colours' own (WUBRG-ranked) order.
    const remainders = shares
        .map((s, i) => ({ c: s.c, rem: s.exact - Math.floor(s.exact), i }))
        .sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (let i = 0; assigned < budget; i++, assigned++) {
        const pick = remainders[i % remainders.length].c;
        counts.set(pick, (counts.get(pick) ?? 0) + 1);
    }

    // Floor of one basic per colour, funded from whichever colour has most.
    if (budget >= colors.length) {
        for (const c of colors) {
            if ((counts.get(c) ?? 0) > 0) continue;
            const donor = [...counts.entries()].sort(
                (a, b) => b[1] - a[1]
            )[0][0];
            counts.set(donor, counts.get(donor)! - 1);
            counts.set(c, 1);
        }
    }
    return counts;
}

/** Optional seams `autoBuildDeck` reads. */
export interface AutoBuildOptions {
    /** Layered Card Profile lookup (`cardProfiles.ts`'s
     *  `resolveEventCardProfile`, ADR 0072) — the SAME seam the Pick Heuristic
     *  reads. Omit for "nothing is profiled": the Capability term then
     *  contributes exactly 0 to every candidate, which is the normal case for
     *  a set/block environment. */
    getCardProfile?: GetCardProfile;
    /** Layered Pick Rating lookup (`cardRatingsCore.ts`'s
     *  `resolveEventPickRating`) — the SAME seam the pick reads. Omit for
     *  "nothing is rated": every spell's base value then comes from the
     *  quality heuristic on the rating scale, exactly as an unrated pick. */
    getPickRating?: GetPickRating;
    /** The pack sources' Archetype frequency
     *  (`archetypeScopeShareForPackSlots`, issue #9298): the plan is the
     *  Archetype the Pool holds most above it. Omit to read raw depth. */
    archetypeScopeShare?: ArchetypeScopeShare;
}

/** How many colour sets, best by their provisional deck's castable value,
 *  are finished and scored again (`chooseBuild`). The cost of a build grows
 *  with the Pool, and a 90-card cube Sealed Pool has 31 candidate sets: the
 *  bound keeps the build within a Convex mutation's budget for every Bot
 *  seat at once. Six finalists build the deck finishing all 31 builds on
 *  122 of 128 Vintage Cube decks and 127 of 128 LEA decks (seeds 1..16), the
 *  audit's aggregates within 0.001
 *  (`docs/research/draft-table-audit-castable-value.md`). */
const COLOUR_SET_FINALISTS = 6;

/** `score`, computed once per Pool entry. */
function memoScore(score: SpellScore): SpellScore {
    const cache = new Map<LimitedPoolCard, number>();
    return (r) => {
        let v = cache.get(r.entry);
        if (v === undefined) {
            v = score(r);
            cache.set(r.entry, v);
        }
        return v;
    };
}

/** `options` with its Card Profile lookup computed once per card. */
function memoOptions(options: AutoBuildOptions): AutoBuildOptions {
    const lookup = options.getCardProfile;
    if (!lookup) return options;
    const cache = new Map<string, ReturnType<GetCardProfile>>();
    return {
        ...options,
        getCardProfile: (cardId) => {
            if (!cache.has(cardId)) cache.set(cardId, lookup(cardId));
            return cache.get(cardId)!;
        },
    };
}

/** One colour set, built: the spells, the Pool lands and the basics. */
interface ColourBuild {
    colors: TrueColor[];
    chosen: ResolvedEntry[];
    lands: ResolvedEntry[];
    basics: Map<TrueColor, number>;
}

/** The FIRST of a colour set's two passes: what the deck provisionally IS
 *  on standalone value at the nominal split. Its curve sizes the land count,
 *  its mana base sizes every candidate's castability, and its cards are what
 *  Capability fit is measured against ("an enabler REQUIRED BY CARDS ALREADY
 *  IN THE DECK" — Flash's value is a function of the deck, not of Flash). */
interface ProvisionalBuild {
    colors: TrueColor[];
    onColor: ResolvedEntry[];
    offColor: ResolvedEntry[];
    planCore: (
        rs: readonly ResolvedEntry[],
        isPartner: (r: ResolvedEntry) => boolean
    ) => ResolvedEntry[];
    provisional: ResolvedEntry[];
    manaBase: ManaBase;
    spellCount: number;
    landCount: number;
}

function provisionalBuild(
    resolved: readonly ResolvedEntry[],
    plan: BuildPlan | null,
    colors: TrueColor[],
    base: SpellScore
): ProvisionalBuild {
    const colorSet = new Set<Color>(colors);

    const spellCandidates = resolved.filter(
        (r) => r.meta !== null && !r.meta.isLand
    );
    const onColor = spellCandidates.filter((r) => isOnColor(r.meta!, colorSet));
    const onColorEntries = new Set(onColor.map((r) => r.entry));
    const offColor = spellCandidates.filter(
        (r) => !onColorEntries.has(r.entry)
    );
    // The plan's core: its own cards, the cards `isPartner` names, and every
    // spell producing a deck colour. A mana source serves whatever plan the
    // deck plays; cutting one for a plan card costs every other spell its
    // castability.
    const planCore = (
        rs: readonly ResolvedEntry[],
        isPartner: (r: ResolvedEntry) => boolean
    ): ResolvedEntry[] =>
        plan
            ? rs.filter(
                  (r) =>
                      plan.isPlanCard(r.meta!) ||
                      isPartner(r) ||
                      r.meta!.producedColors.some((c) => colorSet.has(c))
              )
            : [];

    const provisional = selectSpells(
        planCore(onColor, () => false),
        [onColor, offColor],
        Math.min(PROVISIONAL_SPELL_COUNT, spellCandidates.length),
        base
    );
    const curveLands = landCountForCurve(provisional.map((r) => r.meta!));
    const spellCount = Math.min(
        TARGET_MAIN_SIZE - curveLands,
        spellCandidates.length
    );
    const landCount = TARGET_MAIN_SIZE - spellCount;
    return {
        colors,
        onColor,
        offColor,
        planCore,
        provisional,
        manaBase: buildManaBase(resolved, provisional, colors, landCount),
        spellCount,
        landCount,
    };
}

/** The SECOND pass, which builds the Maindeck for one colour set — steps 2
 *  and 3 of the module comment. Exactly one refinement pass, deliberately: a
 *  loop to a fixpoint can oscillate between two equally-scoring decks, and
 *  determinism is a hard requirement of this module. */
function finishBuild(
    resolved: readonly ResolvedEntry[],
    plan: BuildPlan | null,
    first: ProvisionalBuild,
    options: AutoBuildOptions,
    base: SpellScore
): ColourBuild {
    const {
        colors,
        onColor,
        offColor,
        planCore,
        provisional,
        spellCount,
        landCount,
    } = first;
    const castability = castabilityAgainst(
        provisional,
        first.manaBase,
        TARGET_MAIN_SIZE
    );
    const fit = options.getCardProfile
        ? capabilityFit(
              provisional.map((r) => r.meta!),
              options.getCardProfile
          )
        : () => 0;
    // A Capability partner of the plan: a match with one of the plan's cards
    // in the provisional Maindeck (the enabler a plan card requires).
    const planFit =
        plan && options.getCardProfile
            ? capabilityFit(
                  provisional
                      .map((r) => r.meta!)
                      .filter((m) => plan.isPlanCard(m)),
                  options.getCardProfile
              )
            : () => 0;
    const score: SpellScore = (r) =>
        base(r) + BUILD_CASTABILITY_RATING * castability(r) + fit(r);

    // The plan's castable core goes first. A strained spell (castability
    // under the floor) competes only after every castable on-colour one,
    // plan or not; off-colour spells only after both.
    const castable = onColor.filter(
        (r) => castability(r) >= BUILD_CASTABILITY_FLOOR
    );
    const castableEntries = new Set(castable.map((r) => r.entry));
    const strained = onColor.filter((r) => !castableEntries.has(r.entry));
    const chosen = selectSpells(
        planCore(castable, (r) => planFit(r) > 0),
        [castable, strained, offColor],
        spellCount,
        score
    );

    // The final mana base, allotted by the BUILT Maindeck's pip demand.
    const { lands, basics } = buildManaBase(
        resolved,
        chosen,
        colors,
        landCount
    );
    return { colors, chosen, lands, basics };
}

/** A built colour set's **castable value** (issue #9336): the sum, over its
 *  Maindeck spells, of each spell's value times its castability against the
 *  deck's own mana base (`castability.ts`, the audit's model). A spell's
 *  value is its base rating (`candidateBaseRating`), plus its Capability fit
 *  against the built Maindeck, plus `PLAN_CARD_RATING` when it carries the
 *  plan. A colourless spell pays nothing for colours and reads its full
 *  value in every set; a colour the mana base cannot pay discounts every
 *  spell of it; a spell outside the set (a filler the set's own spells could
 *  not cover) reads zero, so a set never borrows the value of a colour it
 *  does not name through a dual that happens to produce it. */
function castableValue(
    build: ColourBuild,
    plan: BuildPlan | null,
    options: AutoBuildOptions,
    base: SpellScore
): number {
    const castability = castabilityAgainst(
        build.chosen,
        { lands: build.lands, basics: build.basics },
        TARGET_MAIN_SIZE
    );
    const fit = options.getCardProfile
        ? capabilityFit(
              build.chosen.map((r) => r.meta!),
              options.getCardProfile
          )
        : () => 0;
    const colorSet = new Set<Color>(build.colors);
    let total = 0;
    for (const r of build.chosen) {
        // An off-colour spell is a dead slot whatever a dual of another
        // colour pays for it: a set is worth only the spells it plays.
        if (!isOnColor(r.meta!, colorSet)) continue;
        const value =
            base(r) +
            fit(r) +
            (plan?.isPlanCard(r.meta!) ? PLAN_CARD_RATING : 0);
        total += Math.max(0, value) * castability(r);
    }
    return total;
}

/** Chooses the colour set by castable value (issue #9336): every candidate
 *  set (`candidateColourSets`) is built and scored (`castableValue`), the
 *  best kept, ties to the earlier candidate (the smaller set). No colour
 *  count and no splash rule is written down: the count is a consequence of
 *  the fixing. A Pool with little fixing pays so much castability per extra
 *  colour that two colours (plus a splash) win; a cube Pool with fetches,
 *  duals and Moxen pays little, so four or five colours win when the cards
 *  are worth it. */
function chooseBuild(
    resolved: readonly ResolvedEntry[],
    plan: BuildPlan | null,
    options: AutoBuildOptions
): ColourBuild {
    // Every candidate set reads the same base ratings: each is computed once
    // per Pool, not once per set.
    const base = memoScore(baseSpellScore(options.getPickRating));
    // Every set is first scored on its provisional deck — its first pass,
    // valued exactly as a finished build is — and only the best
    // `COLOUR_SET_FINALISTS` are finished and scored again. The candidates
    // keep their canonical order, so a tie still keeps the smaller set.
    const firsts = candidateColourSets(resolvedMetas(resolved)).map(
        (colors, index) => {
            const first = provisionalBuild(resolved, plan, colors, base);
            const estimate = castableValue(
                {
                    colors,
                    chosen: first.provisional,
                    lands: first.manaBase.lands,
                    basics: first.manaBase.basics,
                },
                plan,
                options,
                base
            );
            return { first, estimate, index };
        }
    );
    const finalists = [...firsts]
        .sort((a, b) => b.estimate - a.estimate || a.index - b.index)
        .slice(0, COLOUR_SET_FINALISTS)
        .sort((a, b) => a.index - b.index);
    let best: ColourBuild | null = null;
    let bestValue = -Infinity;
    for (const { first } of finalists) {
        const build = finishBuild(resolved, plan, first, options, base);
        const value = castableValue(build, plan, options, base);
        if (value > bestValue) {
            best = build;
            bestValue = value;
        }
    }
    return { ...best!, colors: byDeckDemand(best!.colors, best!.chosen) };
}

/** The colours Auto-Build plays for `pool` (issue #9336: the colour set of
 *  the best castable value, its size derived from the fixing), heaviest
 *  first. Exported standalone so colour selection is directly unit-testable;
 *  `options` are `autoBuildDeck`'s. */
export function chooseDeckColors(
    pool: readonly LimitedPoolCard[],
    getMeta: GetAutoBuildCardMeta,
    rawOptions: AutoBuildOptions = {}
): TrueColor[] {
    const options = memoOptions(rawOptions);
    const resolved = resolvePool(pool, getMeta);
    const plan = choosePlan(
        resolved,
        options.getCardProfile,
        options.archetypeScopeShare
    );
    return chooseBuild(resolved, plan, options).colors;
}

/** Builds a bot Seat's Auto-Built deck from its FINAL Pool (issue #1115).
 *  Deterministic and total: never throws, always returns a Maindeck of AT
 *  LEAST `FORMAT_RULES.limited.minMain` cards drawn entirely from `pool`
 *  (plus free basics) — the tiered spillover and the grow-past-the-band land
 *  count are why a thin/skewed Pool still reaches the floor. Every `pool`
 *  entry ends up in EXACTLY ONE of `cards`/`sideboard` (never both, never
 *  dropped) — the invariant `checkPoolMembership` (`convex/formats.ts`)
 *  requires for `limited` legality. */
export function autoBuildDeck(
    pool: readonly LimitedPoolCard[],
    getMeta: GetAutoBuildCardMeta,
    resolveBasicLand: ResolveBasicLand,
    rawOptions: AutoBuildOptions = {}
): AutoBuiltDeck {
    // Every candidate colour set reads the same profiles: each is composed
    // once per Pool, not once per set.
    const options = memoOptions(rawOptions);
    const resolved = resolvePool(pool, getMeta);
    const plan = choosePlan(
        resolved,
        options.getCardProfile,
        options.archetypeScopeShare
    );
    const { colors, chosen, lands, basics } = chooseBuild(
        resolved,
        plan,
        options
    );
    const chosenEntries = new Set(chosen.map((r) => r.entry));
    for (const r of lands) chosenEntries.add(r.entry);

    const cards: DeckCard[] = [...chosen, ...lands].map((r) => ({
        cardId: r.entry.cardId,
        cardName: r.entry.cardName,
    }));
    for (const color of colors) {
        for (let i = 0; i < (basics.get(color) ?? 0); i++) {
            cards.push(resolveBasicLand(color));
        }
    }

    const sideboard: DeckCard[] = pool
        .filter((entry) => !chosenEntries.has(entry))
        .map((entry) => ({ cardId: entry.cardId, cardName: entry.cardName }));

    return { cards, sideboard, colors };
}

// --- Event-completion gating (issue #1115) ---------------------------------

/** The subset of a `limitedEvents` row Auto-Build's completion gate needs —
 *  structural, like `poolResolution.ts`'s `SeatLookup`, so this module never
 *  depends on `Doc<"limitedEvents">`. */
export interface AutoBuildEventContext {
    type: "sealed" | "draft";
    status: LimitedEventStatus;
    draftCompletedAt?: number;
}

/** True once a Seat's Pool is FINAL and safe to Auto-Build against (PRD
 *  #1107 stories 24/25, ADR 0054/0055 decision 3): a Sealed event's Pool is
 *  dealt IN FULL the instant `startLimitedEvent` runs (Pools dealt already
 *  means the whole Pool — no further growth), while a Draft's Pool only
 *  stabilizes once every pack is picked through (`draftCompletedAt`) —
 *  Auto-Building mid-draft would build against a Pool that is about to keep
 *  growing, silently stale a moment later.
 *
 *  The gate is `arePoolsDealt`, NOT `status === "started"` (ADR 0076, issue
 *  #1640): a Pool is never un-dealt, so it stays final through the play phase
 *  and past the event's end. A literal comparison here would have made every
 *  bot seat's Auto-Built deck — the deck its round pairings are played and
 *  evaluated against — disappear the instant the rounds started. */
export function isEventPoolFinal(event: AutoBuildEventContext): boolean {
    if (!arePoolsDealt(event.status)) return false;
    return event.type === "sealed" || event.draftCompletedAt !== undefined;
}

/** The subset of a `limitedEvents` seat Auto-Build's completion gate needs. */
export interface AutoBuildSeatContext {
    isBot?: boolean;
    /** A Dropped Seat is Auto-Built like a Bot Drafter's (`droppedSeat.ts`);
     *  the caller withholds it when the seat has a submitted deck. */
    droppedAt?: number;
    pool?: readonly LimitedPoolCard[];
}

/** Auto-Build entry point for ONE Seat (issue #1115) — `null` for a human
 *  seat (a human builds their own deck via the pool-scoped deckbuilder,
 *  issue #1111), an event whose Pool isn't final yet (`isEventPoolFinal`),
 *  or a bot seat with no Pool at all (shouldn't happen once the Pool is
 *  final; defensive, never thrown). Deterministic given
 *  `(seat.pool, getMeta, resolveBasicLand, options)` — no RNG — but those
 *  inputs include Admin-editable Card Profiles, so the SAME Pool can build a
 *  different deck after an edit. Hence the deck is built ONCE, at Pool-final,
 *  and stored (`convex/limitedAutoBuiltDeckStore.ts`: a review never changes
 *  a choice already made); readers call this only as the
 *  fallback for an event older than the store. */
export function computeBotAutoBuiltDeck(
    seat: AutoBuildSeatContext,
    event: AutoBuildEventContext,
    getMeta: GetAutoBuildCardMeta,
    resolveBasicLand: ResolveBasicLand,
    options: AutoBuildOptions = {}
): AutoBuiltDeck | null {
    if (!isAutoDrivenSeat(seat)) return null;
    if (!isEventPoolFinal(event)) return null;
    if (!seat.pool || seat.pool.length === 0) return null;
    return autoBuildDeck(seat.pool, getMeta, resolveBasicLand, options);
}
