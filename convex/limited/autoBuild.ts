// Auto-Build: Bot Drafter deck construction (PRD #1107 stories 24-25, ADR
// 0054/0055, issue #1115). Once a bot Seat's Pool is FINAL (Sealed: dealt at
// `startLimitedEvent`; Draft: `draftCompletedAt` set), it needs a playable
// Limited deck so a human can test their own draft against the table
// (`docs/adr/0055-limited-event-architecture.md` decision 3). Auto-Build:
//
//   1. picks the seat's TWO strongest colors (`chooseTwoColors`) — summed
//      card quality (the shared `cardValueById`, ADR 0018) per color, the
//      SAME quality primitive `botDrafter.ts`'s Pick Heuristic already uses;
//   2. curve-fills a spell base from the Pool's on-color (+ colorless) cards,
//      reusing `botDrafter.ts`'s `CURVE_TARGET`/`curveBucket` shape so
//      draft-time and build-time curve-awareness never drift apart;
//   3. adds unlimited basics of the drafted set for the chosen colors,
//      weighted by how much of the built spell base is in each color.
//
// Deck SIZE: this module targets `FORMAT_RULES.limited.minMain` (40) exactly
// — the format's legality floor — via a classic Limited split (17 basics +
// 23 spells). The issue's own phrasing ("~17 spells + 17 lands") undercounts
// against that floor by 6 cards; a 34-card Maindeck would always fail
// `checkPoolMembership`'s `size-min` check, so this deliberately targets the
// real-Limited-practice split (17 land / 23 spell = 40) instead of the
// issue's literal numbers, which the "each is limited-legal" acceptance
// criterion (the one hard requirement) makes non-negotiable. "~17" land
// count is why `LAND_COUNT` stays a plain default rather than a hard cap: a
// pool too thin in on-color spells still reaches 40 by GROWING the land
// count past 17 (see `spellCount`/`landCount` below), never by shipping a
// short deck.
//
// PURE and DETERMINISTIC — no `Math.random`, no `ctx`. Every decision is a
// function of `(pool, getMeta, resolveBasicLand)` alone, mirroring
// `botDrafter.ts`'s discipline (project convention: no convex-test harness,
// unit-tested directly against plain fixtures).
import type { DeckCard } from "../deckPresets";
import { FORMAT_RULES } from "../formats";
import type { Color, Rarity } from "../cards/types";
import { cardValueById } from "../gre/cardValue";
import {
    CURVE_MAX_BUCKET,
    CURVE_TARGET,
    RARITY_WEIGHT,
    curveBucket,
} from "./botDrafter";
import type { LimitedPoolCard } from "./eventTypes";

/** The printed characteristics Auto-Build needs beyond `botDrafter.ts`'s own
 *  `CardEvalMeta` — adds `isLand` (CR 305), the split between "spell" and
 *  "mana source" a deck BUILDER cares about but a pack-picking heuristic
 *  never needed. Kept as its own type (rather than widening the shared
 *  `CardEvalMeta`) so neither module's resolver has to carry a field the
 *  other doesn't use. */
export interface AutoBuildCardMeta {
    cardId: string;
    colors: Color[];
    manaValue: number;
    rarity: Rarity;
    isLand: boolean;
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
 *  binds it to the event's own drafted set via `getPrintingsForCard`. */
export type ResolveBasicLand = (color: TrueColor) => DeckCard;

/** A completed Auto-Build (issue #1115): the playable Maindeck + the rest of
 *  the Pool as Sideboard (ADR 0055's "whole Pool travels with the deck" MTGO
 *  model), plus the two chosen colors (for a compact "R/G" label — the only
 *  spoiler the vs-AI hookup UI shows; the full decklist is never rendered
 *  ahead of a Match, PRD #1107 story 26's full pool REVEAL is issue #1116,
 *  out of this issue's scope). */
export interface AutoBuiltDeck {
    cards: DeckCard[];
    sideboard: DeckCard[];
    colors: [TrueColor, TrueColor];
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

/** Classic Limited land count default (real-practice Limited deckbuilding,
 *  not CR-mandated) — see the module-level comment for why this, not the
 *  issue's literal "17 spells + 17 lands", drives `autoBuildDeck`. */
const LAND_COUNT_DEFAULT = 17;

/** Spell count for a healthy 40-card Limited deck at the default land count
 *  (`40 - 17`). */
const DEFAULT_SPELL_COUNT = TARGET_MAIN_SIZE - LAND_COUNT_DEFAULT;

function cardQuality(
    meta: Pick<AutoBuildCardMeta, "cardId" | "rarity">
): number {
    return cardValueById(meta.cardId) * RARITY_WEIGHT[meta.rarity];
}

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

/** Picks the seat's two strongest colors (PRD #1107 story 24: "pick the two
 *  strongest colors") from ALREADY-RESOLVED Pool entries: for every nonland
 *  card, its quality (`cardValueById` × rarity weight — the same terms
 *  `botDrafter.ts`'s Pick Heuristic scores with) is added to EVERY color it
 *  touches (a multicolor card reinforces both), then the top two colors by
 *  total win. Ties break by WUBRG order — deterministic, since `ranked` is
 *  built in WUBRG order and `Array.prototype.sort` is a STABLE sort (ECMA
 *  2019+), so equal scores keep their WUBRG relative order without an
 *  explicit comparator tie-break. A Pool with no colored cards at all (an
 *  intentionally-supported degenerate/test case, never a real draft — the
 *  Draftable-Set gate guarantees a real Pool has colored spells) falls back
 *  to `["W", "U"]`, the first two WUBRG colors, rather than throwing. */
function chooseTwoColorsFromResolved(
    resolved: readonly ResolvedEntry[]
): [TrueColor, TrueColor] {
    const totals = new Map<TrueColor, number>();
    for (const { meta } of resolved) {
        if (!meta || meta.isLand) continue;
        const q = cardQuality(meta);
        for (const c of meta.colors) {
            if (c === "C") continue; // colorless never contributes to a color total
            totals.set(c, (totals.get(c) ?? 0) + q);
        }
    }
    const ranked = WUBRG.map((c) => ({ c, score: totals.get(c) ?? 0 })).sort(
        (a, b) => b.score - a.score
    );
    return [ranked[0].c, ranked[1].c];
}

/** Public entry point for `chooseTwoColorsFromResolved` — resolves `pool`
 *  first via `getMeta` (exported standalone, mirrors `botDrafter.ts`'s
 *  `scoreCandidate`, so "2-color selection" is directly unit-testable
 *  without building a whole deck). */
export function chooseTwoColors(
    pool: readonly LimitedPoolCard[],
    getMeta: GetAutoBuildCardMeta
): [TrueColor, TrueColor] {
    return chooseTwoColorsFromResolved(resolvePool(pool, getMeta));
}

const byQualityDesc = (a: ResolvedEntry, b: ResolvedEntry): number =>
    cardQuality(b.meta!) - cardQuality(a.meta!);

/** Curve-aware spell selection (PRD #1107 story 24: "curve-aware"): fills
 *  each `CURVE_TARGET` bucket from the best `onColor` candidates first (the
 *  SAME curve shape `botDrafter.ts` uses at pick time), tops up any shortfall
 *  from the remaining best `onColor` cards regardless of bucket, and — only
 *  if `onColor` alone can't reach `spellCount` — spills into `offColor` so
 *  the Maindeck always reaches its target count (never short of the format's
 *  legality floor because of a color-pure pool, see the module comment). */
function selectSpells(
    onColor: readonly ResolvedEntry[],
    offColor: readonly ResolvedEntry[],
    spellCount: number
): ResolvedEntry[] {
    const chosen: ResolvedEntry[] = [];
    const taken = new Set<LimitedPoolCard>();

    for (let bucket = 1; bucket <= CURVE_MAX_BUCKET; bucket++) {
        const target = CURVE_TARGET[bucket] ?? 0;
        const bucketCards = onColor
            .filter((r) => curveBucket(r.meta!.manaValue) === bucket)
            .sort(byQualityDesc);
        for (const r of bucketCards.slice(0, target)) {
            chosen.push(r);
            taken.add(r.entry);
        }
    }

    const topUp = (pool: readonly ResolvedEntry[], need: number) => {
        if (need <= 0) return;
        const more = pool
            .filter((r) => !taken.has(r.entry))
            .sort(byQualityDesc)
            .slice(0, need);
        for (const r of more) {
            chosen.push(r);
            taken.add(r.entry);
        }
    };

    topUp(onColor, spellCount - chosen.length);
    topUp(offColor, spellCount - chosen.length);

    return chosen;
}

/** Builds a bot Seat's Auto-Built deck from its FINAL Pool (issue #1115).
 *  Deterministic and total: never throws, always returns a Maindeck of AT
 *  LEAST `FORMAT_RULES.limited.minMain` cards drawn entirely from `pool`
 *  (plus free basics) — see `selectSpells`'s off-color spillover and the
 *  `landCount` grow-past-17 fallback below for why a thin/skewed Pool still
 *  reaches the floor. Every `pool` entry ends up in EXACTLY ONE of
 *  `cards`/`sideboard` (never both, never dropped) — the invariant
 *  `checkPoolMembership` (`convex/formats.ts`) requires for `limited`
 *  legality. */
export function autoBuildDeck(
    pool: readonly LimitedPoolCard[],
    getMeta: GetAutoBuildCardMeta,
    resolveBasicLand: ResolveBasicLand
): AutoBuiltDeck {
    const resolved = resolvePool(pool, getMeta);
    const colors = chooseTwoColorsFromResolved(resolved);
    const colorSet = new Set<Color>(colors);

    const spellCandidates = resolved.filter(
        (r) => r.meta !== null && !r.meta.isLand
    );
    const onColor = spellCandidates.filter(
        (r) =>
            r.meta!.colors.length === 0 ||
            r.meta!.colors.some((c) => colorSet.has(c))
    );
    const onColorEntries = new Set(onColor.map((r) => r.entry));
    const offColor = spellCandidates.filter(
        (r) => !onColorEntries.has(r.entry)
    );

    const spellCount = Math.min(DEFAULT_SPELL_COUNT, spellCandidates.length);
    const landCount = Math.max(
        LAND_COUNT_DEFAULT,
        TARGET_MAIN_SIZE - spellCount
    );

    const chosen = selectSpells(onColor, offColor, spellCount);
    const chosenEntries = new Set(chosen.map((r) => r.entry));

    // Basic land count is weighted by how much of the BUILT spell base
    // leans each chosen color — a deck that skews heavily toward its first
    // color gets proportionally more of that color's basics, never a flat
    // 50/50 split regardless of the actual mana requirements. At least one
    // basic of each color always ships (a two-color deck needs both).
    const weight = new Map<Color, number>();
    for (const r of chosen) {
        for (const c of r.meta!.colors) {
            if (colorSet.has(c)) weight.set(c, (weight.get(c) ?? 0) + 1);
        }
    }
    const wA = weight.get(colors[0]) ?? 1;
    const wB = weight.get(colors[1]) ?? 1;
    const totalW = wA + wB;
    const landsA = Math.min(
        landCount - 1,
        Math.max(1, Math.round((landCount * wA) / totalW))
    );
    const landsB = landCount - landsA;

    const cards: DeckCard[] = chosen.map((r) => ({
        cardId: r.entry.cardId,
        cardName: r.entry.cardName,
    }));
    for (let i = 0; i < landsA; i++) cards.push(resolveBasicLand(colors[0]));
    for (let i = 0; i < landsB; i++) cards.push(resolveBasicLand(colors[1]));

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
    status: "open" | "started";
    draftCompletedAt?: number;
}

/** True once a Seat's Pool is FINAL and safe to Auto-Build against (PRD
 *  #1107 stories 24/25, ADR 0054/0055 decision 3): a Sealed event's Pool is
 *  dealt IN FULL the instant `startLimitedEvent` runs (`status: "started"`
 *  is already the whole Pool — no further growth), while a Draft's Pool only
 *  stabilizes once every pack is picked through (`draftCompletedAt`) —
 *  Auto-Building mid-draft would build against a Pool that is about to keep
 *  growing, silently stale a moment later. */
export function isEventPoolFinal(event: AutoBuildEventContext): boolean {
    if (event.status !== "started") return false;
    return event.type === "sealed" || event.draftCompletedAt !== undefined;
}

/** The subset of a `limitedEvents` seat Auto-Build's completion gate needs. */
export interface AutoBuildSeatContext {
    isBot?: boolean;
    pool?: readonly LimitedPoolCard[];
}

/** Auto-Build entry point for ONE Seat (issue #1115) — `null` for a human
 *  seat (a human builds their own deck via the pool-scoped deckbuilder,
 *  issue #1111), an event whose Pool isn't final yet (`isEventPoolFinal`),
 *  or a bot seat with no Pool at all (shouldn't happen once the Pool is
 *  final; defensive, never thrown). Deterministic given
 *  `(seat.pool, getMeta, resolveBasicLand)` — no RNG — so "every bot Seat
 *  HAS a deck" (PRD #1107 story 24) holds by always being COMPUTABLE on
 *  demand rather than needing a persisted row: the same Seat always
 *  Auto-Builds the identical deck, so a lazily-computed read is exactly as
 *  reliable as a stored one, with no migration/staleness surface. */
export function computeBotAutoBuiltDeck(
    seat: AutoBuildSeatContext,
    event: AutoBuildEventContext,
    getMeta: GetAutoBuildCardMeta,
    resolveBasicLand: ResolveBasicLand
): AutoBuiltDeck | null {
    if (!seat.isBot) return null;
    if (!isEventPoolFinal(event)) return null;
    if (!seat.pool || seat.pool.length === 0) return null;
    return autoBuildDeck(seat.pool, getMeta, resolveBasicLand);
}
