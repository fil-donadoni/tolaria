// Auto-Build: Bot Drafter deck construction (PRD #1107 stories 24-25, ADR
// 0054/0055, issue #1115). Once a bot Seat's Pool is FINAL (Sealed: dealt at
// `startLimitedEvent`; Draft: `draftCompletedAt` set), it needs a playable
// Limited deck so a human can test their own draft against the table
// (`docs/adr/0055-limited-event-architecture.md` decision 3). Auto-Build:
//
//   1. picks the seat's strongest colors (`chooseDeckColors`) — pip-weighted
//      Colour Commitment (`botDrafter.ts`'s own `colourAffinityWeights`, ADR
//      0073), with the color COUNT derived: two by default, three when the
//      Pool's own mana base pays for the third (`manaBaseSupportsThirdColor`,
//      the same `max(0, demand − sources)` deficit arithmetic as Fixing
//      Value);
//   2. curve-fills a spell base from the Pool's on-colour (+ colourless)
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
//   3. plays the Pool's own on-color LANDS (a dual that unlocked a third color
//      has to actually be in the deck), then tops the mana base up with
//      unlimited basics of the drafted set, allotted across the chosen colors
//      by the Maindeck's own pip demand.
//
// Every card-quality judgement routes through `botDrafter.ts` —
// `candidateBaseRating`, `CURVE_TARGET`/`curveBucket`, `colourAffinityWeights`,
// `pipDemandByColor`, `sourceCountsByColor`, `capabilityFitTerm` —
// deliberately: ONE card-quality authority for draft time and build time (ADR
// 0073's "Auto-Build consumes the same seams"), never two that drift apart.
//
// Deck SIZE and LAND COUNT: the Maindeck is exactly `FORMAT_RULES.limited.
// minMain` (40), the format's legality floor. The land count follows the
// curve: `LAND_COUNT_BASE + LAND_COUNT_PER_MANA_VALUE × average mana value` of
// the provisional spells, rounded and clamped into `LAND_COUNT_BAND` (15–18 —
// a 2-drop deck plays 15, a 3.5-average deck 18, real Limited practice, not
// CR-mandated), and the spells fill the rest. A Pool too thin in spells
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
    candidateBaseRating,
    candidateQuality,
    capabilityFitTerm,
    colourAffinityWeights,
    curveBucket,
    pipDemandByColor,
    poolProfiles,
    sourceCountsByColor,
    type CardEvalMeta,
    type GetPickRating,
} from "./botDrafter";
import { pipCastability } from "./castability";
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
 *    be counted as evidence that the mana base can carry a third colour;
 *    spending a land slot on it is precisely what takes a slot AWAY from the
 *    top two colours.
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

/** A completed Auto-Build (issue #1115): the playable Maindeck + the rest of
 *  the Pool as Sideboard (ADR 0055's "whole Pool travels with the deck" MTGO
 *  model), plus the chosen colors (for a compact "R/G" label — the only
 *  spoiler the vs-AI hookup UI shows; the full decklist is never rendered
 *  ahead of a Match, PRD #1107 story 26's full pool REVEAL is issue #1116,
 *  out of this issue's scope).
 *
 *  `colors` is a LIST, not a pair (issue #1615): the count is derived from the
 *  Pool's own mana base — two, or three when the Pool pays for a third — so a
 *  Jeskai cube Pool is no longer compressed into the two colours a hardcoded
 *  pair forced it into. Always at least two, at most `MAX_DECK_COLORS`. */
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

/** The nominal land budget a 40-card Limited deck splits its colours over —
 *  the denominator the third-colour test normalises pip demand to, and the
 *  land count the PROVISIONAL spell pass reserves before the curve decides
 *  the real one. Real-practice Limited deckbuilding, not CR-mandated. */
const NOMINAL_LAND_COUNT = 17;

/** Spell count of the provisional pass (`40 - 17`). */
const PROVISIONAL_SPELL_COUNT = TARGET_MAIN_SIZE - NOMINAL_LAND_COUNT;

/** The declared band the curve-sized land count lives in (real-practice
 *  Limited: 15 for a deck of two-drops, 18 for a deck of fatties). Only a
 *  Pool too thin in spells to reach the format floor plays more. */
export const LAND_COUNT_BAND = { min: 15, max: 18 } as const;

/** Land count = `LAND_COUNT_BASE + LAND_COUNT_PER_MANA_VALUE × average mana
 *  value`, rounded, then clamped into `LAND_COUNT_BAND`: an average of 2.0
 *  plays 15, 2.5 plays 16, 3.0 plays 17, 3.5 plays 18. */
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

/** Colours a derived-count Auto-Build will ever commit to (issue #1615). Two
 *  is the floor (a mono-colour Limited deck is not a shape this builder aims
 *  for), three the ceiling: in the Vintage Cube three-colour decks on duals
 *  and fetches are normal, four-colour ones are not, and every colour past the
 *  third costs land slots the deck cannot spare. */
const MIN_DECK_COLORS = 2;
export const MAX_DECK_COLORS = 3;

/** Minimum mana SOURCES the Pool must already hold for a third colour before
 *  Auto-Build will commit to it — the floor under the demand-weighted
 *  requirement below, so a one-pip splash still has to be paid for by at least
 *  one real fixer rather than rounding its way in for free. */
const MIN_THIRD_COLOR_SOURCES = 1;

interface ResolvedEntry {
    entry: LimitedPoolCard;
    meta: AutoBuildCardMeta | null;
}

function resolvePool(
    pool: readonly LimitedPoolCard[],
    getMeta: GetAutoBuildCardMeta
): ResolvedEntry[] {
    return pool.map((entry) => ({ entry, meta: getMeta(entry.scryfallId) }));
}

function resolvedMetas(
    resolved: readonly ResolvedEntry[]
): AutoBuildCardMeta[] {
    return resolved
        .map((r) => r.meta)
        .filter((m): m is AutoBuildCardMeta => m !== null);
}

/** True once the Pool's OWN mana base pays for a third colour (issue #1615,
 *  ADR 0073: "the colour COUNT becomes derived — two, or three when the Pool's
 *  own mana base supports it, by the same source/deficit arithmetic").
 *
 *  The arithmetic IS Fixing Value's, `max(0, demand[c] − sources[c])`, read at
 *  build time and required to come out at ZERO for the third colour:
 *
 *  - `demand` is `pipDemandByColor` over the Pool's SPELLS — the same
 *    pip-counting half Fixing Value uses — normalised to the deck's land
 *    budget, so what a colour needs is its share of 17 nominal slots, not its raw pip
 *    total over a 90-card Pool (which no 40-card deck ever has to satisfy).
 *  - `sources` is `sourceCountsByColor` over the Pool's mana sources EXCLUDING
 *    basic lands. Excluding basics is the load-bearing choice, and the reason
 *    a Pool with no fixing can never reach three colours: the builder invents
 *    basics for free, so counting them would make every Pool support three
 *    colours trivially, when in truth a basic of the third colour is a slot
 *    taken away from the first two. Only real fixing — duals, fetches, Moxen,
 *    Signets, anything already in the Pool that PRODUCES that colour — can
 *    close the deficit.
 *
 *  Non-negative and directional: adding a source of the third colour can only
 *  ever move this from `false` toward `true`, never back. */
function manaBaseSupportsThirdColor(
    metas: readonly AutoBuildCardMeta[],
    colors: readonly [TrueColor, TrueColor, TrueColor]
): boolean {
    const demand = pipDemandByColor(metas.filter((m) => !m.isLand));
    const third = colors[2];
    const thirdDemand = demand[third] ?? 0;
    // Nothing to splash: a colour the Pool holds mana sources for but no
    // SPELLS in is not a third colour, it is fixing.
    if (thirdDemand <= 0) return false;

    const totalDemand = colors.reduce((sum, c) => sum + (demand[c] ?? 0), 0);
    if (totalDemand <= 0) return false;
    const need = Math.max(
        MIN_THIRD_COLOR_SOURCES,
        Math.round((NOMINAL_LAND_COUNT * thirdDemand) / totalDemand)
    );

    const fixers = metas.filter(
        (m) => !m.isBasicLand && m.producedColors.length > 0
    );
    const sources = sourceCountsByColor(fixers)[third] ?? 0;
    return Math.max(0, need - sources) === 0;
}

/** Picks the colours the seat actually drafted toward, and HOW MANY of them
 *  (issue #1615, replacing the summed-quality `chooseTwoColors` ADR 0073 calls
 *  out by name).
 *
 *  Ranking is **pip-weighted Colour Commitment** — `colourAffinityWeights`,
 *  `botDrafter.ts`'s own: a spell's coloured PIPS count at full weight
 *  (`{U}{U}` commits twice as hard as `{4}{U}`), a mana source's produced
 *  colours at a lower weight, so a strong dual land FOLLOWS the Pool's
 *  commitment instead of creating it. That is the same quantity the Pick
 *  Heuristic drafted by, which is the whole point: the builder now finishes
 *  the draft's plan rather than re-deciding it from summed card quality, which
 *  is blind to how hard a card commits and blind to the mana base entirely.
 *
 *  The COUNT is derived, never hardcoded: two colours, plus a third when
 *  `manaBaseSupportsThirdColor` says the Pool pays for it. Ties break by WUBRG
 *  order — deterministic, since `ranked` is built in WUBRG order and
 *  `Array.prototype.sort` is STABLE (ECMA 2019+). A Pool with no coloured
 *  cards at all (a degenerate/test case, never a real draft) falls back to
 *  `["W", "U"]` rather than throwing. */
function chooseDeckColorsFromResolved(
    resolved: readonly ResolvedEntry[]
): TrueColor[] {
    const metas = resolvedMetas(resolved);
    const affinity = colourAffinityWeights(metas);
    const ranked = WUBRG.map((c) => ({ c, score: affinity[c] ?? 0 })).sort(
        (a, b) => b.score - a.score
    );
    const colors: TrueColor[] = ranked
        .slice(0, MIN_DECK_COLORS)
        .map((r) => r.c);
    const third = ranked[MIN_DECK_COLORS];
    if (
        third !== undefined &&
        third.score > 0 &&
        manaBaseSupportsThirdColor(metas, [colors[0], colors[1], third.c])
    ) {
        colors.push(third.c);
    }
    return colors;
}

/** Public entry point for `chooseDeckColorsFromResolved` — resolves `pool`
 *  first via `getMeta` (exported standalone, mirrors `botDrafter.ts`'s
 *  `scoreCandidate`, so colour selection is directly unit-testable without
 *  building a whole deck). Returns 2 or 3 colours (`MAX_DECK_COLORS`). */
export function chooseDeckColors(
    pool: readonly LimitedPoolCard[],
    getMeta: GetAutoBuildCardMeta
): TrueColor[] {
    return chooseDeckColorsFromResolved(resolvePool(pool, getMeta));
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
 *  `score` is injected so the SAME selection runs twice: once on standalone
 *  quality to establish what the deck provisionally is, then once more with
 *  the Castability and Capability terms measured against that provisional
 *  deck. */
function selectSpells(
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

    const first = tiers[0] ?? [];
    for (let bucket = 1; bucket <= CURVE_MAX_BUCKET; bucket++) {
        const target = CURVE_TARGET[bucket] ?? 0;
        const bucketCards = first
            .filter((r) => curveBucket(r.meta!.manaValue) === bucket)
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
 *  on-colour NON-BASIC lands ahead of any basic (a dual land that unlocked a
 *  third colour has to actually BE in the deck), then basics allotted by the
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
        .sort((a, b) => {
            const coverage = (r: ResolvedEntry) =>
                r.meta!.producedColors.filter((c) => colorSet.has(c)).length;
            return (
                coverage(b) - coverage(a) ||
                candidateQuality(b.meta!) - candidateQuality(a.meta!)
            );
        })
        .slice(0, landCount);
    const basics = allotBasics(
        landCount - lands.length,
        colors,
        pipDemandByColor(spells.map((r) => r.meta!))
    );
    return { lands, basics };
}

/** Per-colour mana sources of a deck: its lands, its basics, and every spell
 *  that produces mana (a Mox, a mana creature) — the supply half the
 *  castability model reads. */
function deckSources(
    base: ManaBase,
    spells: readonly ResolvedEntry[]
): Partial<Record<Color, number>> {
    const sources = sourceCountsByColor([
        ...base.lands.map((r) => r.meta!),
        ...spells.map((r) => r.meta!),
    ]);
    for (const [c, n] of base.basics) sources[c] = (sources[c] ?? 0) + n;
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
    return (entry) => {
        const meta = entry.meta!;
        let own = sources;
        if (inDeck.has(entry.entry) && meta.producedColors.length > 0) {
            own = { ...sources };
            for (const c of meta.producedColors) own[c] = (own[c] ?? 1) - 1;
        }
        return pipCastability(meta.pips, meta.manaValue, deckSize, own);
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
    options: AutoBuildOptions = {}
): AutoBuiltDeck {
    const resolved = resolvePool(pool, getMeta);
    const colors = chooseDeckColorsFromResolved(resolved);
    const colorSet = new Set<Color>(colors);

    const spellCandidates = resolved.filter(
        (r) => r.meta !== null && !r.meta.isLand
    );
    const onColor = spellCandidates.filter((r) => isOnColor(r.meta!, colorSet));
    const onColorEntries = new Set(onColor.map((r) => r.entry));
    const offColor = spellCandidates.filter(
        (r) => !onColorEntries.has(r.entry)
    );
    const base = baseSpellScore(options.getPickRating);

    // TWO passes. The first establishes what the deck provisionally IS on
    // standalone value at the nominal split; the curve of that deck sizes
    // the land count, its mana base sizes every candidate's castability, and
    // its cards are what Capability fit is measured against ("an enabler
    // REQUIRED BY CARDS ALREADY IN THE DECK" — Flash's value is a function of
    // the deck, not of Flash). Exactly one refinement pass, deliberately: a
    // loop to a fixpoint can oscillate between two equally-scoring decks, and
    // determinism is a hard requirement of this module.
    const provisional = selectSpells(
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

    const castability = castabilityAgainst(
        provisional,
        buildManaBase(resolved, provisional, colors, landCount),
        TARGET_MAIN_SIZE
    );
    const fit = options.getCardProfile
        ? capabilityFit(
              provisional.map((r) => r.meta!),
              options.getCardProfile
          )
        : () => 0;
    const score: SpellScore = (r) =>
        base(r) + BUILD_CASTABILITY_RATING * castability(r) + fit(r);

    // A strained spell (castability under the floor) competes only after
    // every castable on-colour one; off-colour spells only after both.
    const castable = onColor.filter(
        (r) => castability(r) >= BUILD_CASTABILITY_FLOOR
    );
    const castableEntries = new Set(castable.map((r) => r.entry));
    const strained = onColor.filter((r) => !castableEntries.has(r.entry));
    const chosen = selectSpells(
        [castable, strained, offColor],
        spellCount,
        score
    );
    const chosenEntries = new Set(chosen.map((r) => r.entry));

    // The final mana base, allotted by the BUILT Maindeck's pip demand.
    const { lands, basics } = buildManaBase(
        resolved,
        chosen,
        colors,
        landCount
    );
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
