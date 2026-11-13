// Capability Registry — the closed, code-side vocabulary of named card
// properties the Bot Drafter's synergy model matches on (ADR 0072 "Card
// synergy as computed Capability matching, not enumerated card pairs", PRD
// #1607 slice 1, issue #1608).
//
// A Capability is a named property a card PROVIDES or REQUIRES. Fit between
// two cards is computed by matching one card's `requires` against another's
// `provides` — never authored as an enumerated pair. Absence of a match is
// itself the veto (ADR 0072's Worldspine Wurm / Animate Dead example): a
// reanimation spell REQUIRES `reanimatable`, Worldspine Wurm does not
// PROVIDE it (oracle text: "When Worldspine Wurm is put into a graveyard
// from anywhere, shuffle it into its owner's library" — it is never sitting
// in the graveyard to reanimate), so the pair scores nothing even though
// both cards sit in a "cheat a fatty into play" archetype.
//
// This is the SINGLE authority on Capability names, the same authority-plus-
// CI-guard shape `convex/cards/mechanicsRegistry.ts` (ADR 0046) already
// establishes for keyword/Op names: a catalogue-wide guard test
// (`__tests__/capabilityRegistry.bot.test.ts`) rejects any `provides`/
// `requires` string in the checked-in Card Capabilities seed file
// (`data/card-profiles/capabilities.json`) that isn't a row here. Without this
// guard the vocabulary silently forks into `value-on-death`, `dies-value`
// and `death-trigger`, which no longer match each other; the model then
// degrades to nothing while every test stays green.
//
// EVERY row must be reachable from BOTH sides of the provides/requires
// match (ADR 0072: "fit is computed by matching one card's `requires`
// against another's `provides`") — someone can PROVIDE it, someone can
// REQUIRE it, and each row's `description` says which side is which. A row
// documenting only one direction (a `REQUIRES:`-only clause describing the
// requiring card itself, or a `PROVIDES:`-only standalone card-quality tag
// with no relational requirer) can never match anything and is dead weight
// — cut it, don't keep it "for coverage" (issue #1608 review, findings 2+3).
// A standalone card-quality attribute (is this removal cheap, is this
// creature evasive) belongs to ADR 0073's derivable quality scale, not this
// relational vocabulary — this registry models RELATIONSHIPS between an
// enabler card and a payoff card, not one card's own goodness.
//
// The vocabulary stays small (ADR 0072 Consequences: growth beyond
// ~15-25 rows is the signal to check whether a proposed Capability is
// really a Combo Edge — an explicit, signed, two-card loop, Painter's
// Servant + Grindstone — or really an Archetype, a coarse named strategy
// like `reanimator`/`artifacts`/`jeskai-tempo` — instead). There is no
// LOWER bound: a smaller, fully-participating vocabulary is the correct
// outcome, never padded to hit a row-count target. This slice ships the
// registry and its guard ONLY — no Card Profile row references any of
// these names yet (zero behaviour change, issue #1608's acceptance).

/** The clusters a row is filed under, in the order a reader walks them (the
 *  Admin editor, the Profile Census prompt, the Draft Lab). A cluster is
 *  presentation: it groups rows by the enabler family they serve and never
 *  enters matching. */
export const CAPABILITY_CLUSTERS = [
    "Reanimator / graveyard",
    "Cheat into play",
    "Artifacts",
    "Spells",
    "Bodies",
    "Lands",
] as const;

export type CapabilityCluster = (typeof CAPABILITY_CLUSTERS)[number];

/** A row's two one-line halves — the compact form of `description`, one per
 *  side of the match, for the surfaces with room for a line, not a
 *  paragraph. */
export interface CapabilityGloss {
    provides: string;
    requires: string;
}

/** One real card on each side of the row, by printed name. `provider` is
 *  `null` exactly on a derived row (`CapabilityRow.bound`): no card provides
 *  one by hand, its base capability within the ceiling does. */
export interface CapabilityExample {
    provider: string | null;
    requirer: string;
}

/** One row of the closed Capability vocabulary. `id` is the exact string a
 *  `cardCapabilities` row's `provides`/`requires` array carries (kebab-case,
 *  matching this repo's other closed-vocabulary ids —
 *  `MechanicRow.id`/`EffectOpRow.op` discipline). `description` is the
 *  PRECISE meaning of providing vs. requiring it — this is what makes a
 *  later census repeatable (ADR 0072), so every row spells out both
 *  directions in full; `gloss` is the one-line form beside it, never a
 *  substitute for it. */
export interface CapabilityRow {
    id: string;
    description: string;
    gloss: CapabilityGloss;
    cluster: CapabilityCluster;
    example: CapabilityExample;
    /** Present on a MANA-VALUE-BOUNDED requirement (issue #1677): the row is
     *  a REQUIRES-side refinement of the `capability` row, satisfied by a
     *  card that provides `capability` AND has mana value <= `maxManaValue`
     *  (a reanimation spell with a mana-value ceiling can only return cheap
     *  targets, so it must not pair with an 8-drop it can never touch). The
     *  names stay a closed set; the numeric constraint lives here, beside
     *  the row, and `capabilitySatisfiedBy` is the one place that reads it. */
    bound?: { capability: string; maxManaValue: number };
}

/** The closed Capability vocabulary (ADR 0072). Each row names its
 *  `cluster`; `CAPABILITY_REGISTRY` stays a flat array so a lookup never
 *  needs to know which cluster a name lives in. */
export const CAPABILITY_REGISTRY: CapabilityRow[] = [
    // ── Reanimator / graveyard cluster ──────────────────────────────────
    {
        id: "reanimatable",
        cluster: "Reanimator / graveyard",
        gloss: {
            provides:
                "A body worth cheating out of the graveyard, that actually STAYS there.",
            requires:
                "A graveyard-to-battlefield effect needs this from its target.",
        },
        example: { provider: "Griselbrand", requirer: "Animate Dead" },
        description:
            "PROVIDES: a creature/permanent that is disproportionately powerful put onto the battlefield directly from a graveyard (the graveyard subset of `cheat-target`), and that will actually still BE in the graveyard when a reanimation effect looks for it — no ability that removes it from the graveyard on its own (e.g. shuffling itself into its library on death, the reason Worldspine Wurm does not provide this). REQUIRES: a graveyard-to-battlefield effect (Animate Dead, Reanimate) requires this from its target; a target lacking it scores nothing from the effect regardless of shared archetype.",
    },
    {
        id: "reanimatable-mv-2",
        cluster: "Reanimator / graveyard",
        gloss: {
            provides:
                "Never set by hand: a `reanimatable` card with mana value ≤ 2 satisfies it.",
            requires: "A reanimation effect capped at mana value 2.",
        },
        example: { provider: null, requirer: "Lorehold Charm" },
        bound: { capability: "reanimatable", maxManaValue: 2 },
        description:
            "PROVIDES: nothing directly — a card providing `reanimatable` satisfies this row exactly when its mana value is 2 or less (see `reanimatable` for the provider side). REQUIRES: a graveyard-to-battlefield effect with a mana-value ceiling of 2 (a charm returning a permanent with mana value 2 or less) requires this from its target instead of `reanimatable`: a big reanimation target above the ceiling can never be returned, so that pair scores nothing.",
    },
    {
        id: "reanimatable-mv-3",
        cluster: "Reanimator / graveyard",
        gloss: {
            provides:
                "Never set by hand: a `reanimatable` card with mana value ≤ 3 satisfies it.",
            requires: "A reanimation effect capped at mana value 3.",
        },
        example: { provider: null, requirer: "Unearth" },
        bound: { capability: "reanimatable", maxManaValue: 3 },
        description:
            "PROVIDES: nothing directly — a card providing `reanimatable` satisfies this row exactly when its mana value is 3 or less (see `reanimatable` for the provider side). REQUIRES: a graveyard-to-battlefield effect with a mana-value ceiling of 3 (returns a permanent with mana value 3 or less) requires this from its target instead of `reanimatable`: a big reanimation target above the ceiling can never be returned, so that pair scores nothing.",
    },
    {
        id: "self-mills",
        cluster: "Reanimator / graveyard",
        gloss: {
            provides:
                "Puts cards from the top of a library into a graveyard, unchosen.",
            requires:
                "A cost or effect that scales with graveyard size names this directly.",
        },
        example: { provider: "Hermit Druid", requirer: "Abhorrent Oculus" },
        description:
            "PROVIDES: puts one or more cards from the top of a library into a graveyard (its own or a target player's) without choosing which cards — mill, self-mill, or a fetch land's crack-back — the RANDOM graveyard-fueling enabler for reanimator strategies. REQUIRES: a card whose own cost or effect scales with graveyard size (delve, threshold, flashback, escape) declares this directly in ITS OWN `requires` array — there is no separate 'graveyard-scaling' capability name; the requiring card names its enabler(s) directly (this row, and/or `discard-outlet` below).",
    },
    {
        id: "discard-outlet",
        cluster: "Reanimator / graveyard",
        gloss: {
            provides:
                "Puts a CHOSEN card from hand or library into the graveyard on demand.",
            requires:
                "A graveyard-scaling card names this directly as its enabler.",
        },
        example: { provider: "Faithless Looting", requirer: "Treasure Cruise" },
        description:
            "PROVIDES: lets its controller (or another player) put a SPECIFIC, chosen card into a graveyard on demand, from hand (looting, discard-for-effect, cycling) or from library (a search whose destination is the graveyard, e.g. Entomb) — the reliable enabler that gets a KNOWN reanimation/flashback target into the graveyard on purpose, distinct from self-mills' random top-of-library dump. REQUIRES: same discipline as `self-mills` — a graveyard-scaling card requires this directly, by name, in its own `requires` array.",
    },

    // ── Cheat-into-play cluster (ADR 0072's motivating example) ─────────
    {
        id: "cheat-target",
        cluster: "Cheat into play",
        gloss: {
            provides:
                "A permanent worth having for good without paying its cost.",
            requires:
                "A permanent cheat from hand or library (Show and Tell) needs this from its target.",
        },
        example: { provider: "Griselbrand", requirer: "Show and Tell" },
        description:
            "PROVIDES: a permanent (creature, artifact or enchantment) far more powerful than its mana value lets the deck cast on curve — in practice mana value 7 or more, or 6 when it is reanimatable on its size — and worth having PERMANENTLY on the battlefield without paying its cost (Griselbrand, an eight-drop that draws seven). Every card providing `reanimatable` on its size also provides this; the converse does not hold — Emrakul, the Aeons Torn, Worldspine Wurm and Blightsteel Colossus never stay in a graveyard, so they provide this and not `reanimatable`. REQUIRES: an effect that puts a permanent onto the battlefield from HAND or LIBRARY for good, with no sacrifice or return clause (Show and Tell, Natural Order, Oath of Druids) requires this from its target. The one-shot cheats (Sneak Attack, Through the Breach, Flash) do NOT require it: their target is sacrificed, so they keep requiring `value-on-etb` / `value-on-attack` / `value-on-death`. Accepted imprecision: the row carries no colour or type axis, so a requirer restricted to a subset (Natural Order finds only a GREEN creature) also matches a provider it can never fetch (Griselbrand).",
    },
    {
        id: "value-on-etb",
        cluster: "Cheat into play",
        gloss: {
            provides:
                "An enters trigger that pays even if the permanent leaves at once.",
            requires:
                "A one-shot cheat (Sneak Attack) or a flicker/blink (Flickerwisp) needs this.",
        },
        example: { provider: "Craterhoof Behemoth", requirer: "Sneak Attack" },
        description:
            "PROVIDES: an enters-the-battlefield trigger or immediate static effect that pays off even if the permanent leaves play again right away (draws cards, deals damage, creates tokens) — independent of the permanent sticking around. REQUIRES: a cheat-into-play effect that only guarantees the permanent briefly touches the battlefield (Sneak Attack — '{R}: You may put a creature card from your hand onto the battlefield... Sacrifice the creature at the beginning of the next end step', usg/red.cards.ts — one attack and it is gone) requires this from its target; Show and Tell, by contrast, puts its target into play PERMANENTLY (no sacrifice/return clause) and does not require this. A flicker or blink effect requires it too (issue #9324): an effect that exiles and returns, or bounces and replays, its controller's own permanent (Flickerwisp, Parallax Wave, Displacer Kitten, Recurring Nightmare) gains nothing from the move itself — it re-buys the enters trigger, so it pays off exactly on a target that provides this. That is the same property seen from a second requirer, never a separate 'repeatable-etb' row.",
    },
    {
        id: "value-on-attack",
        cluster: "Cheat into play",
        gloss: {
            provides:
                "An attack trigger that pays the instant it attacks (Annihilator).",
            requires: "A one-combat cheat needs this from its target.",
        },
        example: {
            provider: "Emrakul, the Aeons Torn",
            requirer: "Sneak Attack",
        },
        description:
            "PROVIDES: an attack trigger or attack-scaling effect that pays off the instant the permanent attacks, independent of whether it survives past that combat (token creation, direct damage, a forced-sacrifice trigger) — Emrakul, the Aeons Torn's Annihilator 6 (CR 702.86, 'Whenever this creature attacks, defending player sacrifices six permanents'; shipped in roe/colorless.ts) is the canonical case, ADR 0072's own worked example ('a fine reanimation and Sneak Attack target') — even a one-combat cheat gets full value from it. REQUIRES: a one-combat cheat effect (Sneak Attack — sacrifices its target at the beginning of the next end step, AFTER one attack) requires this from its target; Griselbrand does NOT provide it — its only ability is 'Pay 7 life: Draw seven cards' (avr/black.ts), an activated ability usable any time, not gated on attacking — so the pair scores nothing despite Griselbrand being a fine reanimation target on its own stats. (Worldspine Wurm's payoff fires on DEATH, not attack — see `value-on-death`.)",
    },
    {
        id: "value-on-death",
        cluster: "Cheat into play",
        gloss: {
            provides: "A death trigger that pays however it died.",
            requires:
                "An effect that sacrifices or trades permanents profitably.",
        },
        example: { provider: "Worldspine Wurm", requirer: "Flash" },
        description:
            "PROVIDES: a death trigger, or an effect elsewhere keyed off this permanent dying / being put into a graveyard from the battlefield, that pays off regardless of the cause of death (draws cards, creates tokens, deals damage) — the Worldspine Wurm shape (ADR 0072's Flash pairing): 'When this creature dies, create three 5/5 green Wurm creature tokens with trample' (rtr/green.cards.ts) fires no matter how it died, making it an excellent Flash target — even though it ALSO shuffles itself out of the graveyard afterward, so it does NOT provide `reanimatable` (see that row). REQUIRES: an effect that wants to sacrifice or trade away permanents profitably requires this from its fodder.",
    },
    {
        id: "value-on-cast",
        cluster: "Cheat into play",
        gloss: {
            provides:
                "Pays on CAST, countered or not: cast triggers, cascade, cantrips.",
            requires:
                "Storm payoffs and cast-trigger creatures need this from the spells feeding them.",
        },
        example: { provider: "Gitaxian Probe", requirer: "Tendrils of Agony" },
        description:
            "PROVIDES: a spell whose payoff is realized the moment it is CAST, independent of whether it resolves, is countered, or sticks around (a cast trigger, cascade, a storm-count contribution, a cantrip that replaces itself on resolution). REQUIRES: an effect that cares about spells being cast rather than resolved permanents (storm payoffs, cascade, a cast-trigger creature) requires this from the spells feeding it.",
    },

    // ── Artifacts cluster ────────────────────────────────────────────────
    {
        id: "cheap-artifact",
        cluster: "Artifacts",
        gloss: {
            provides:
                "A low-cost artifact whose value is filling the artifact count.",
            requires:
                "An artifact-count / Metalcraft payoff names this directly.",
        },
        example: { provider: "Mox Pearl", requirer: "Tolarian Academy" },
        description:
            "PROVIDES: a low mana-value artifact whose primary draft value is filling the artifact-count column for an artifact-count payoff (Moxen, Signets, cantrip artifacts) rather than its standalone rate. REQUIRES: an artifact-count/Metalcraft payoff card (its cost or effect scales with artifacts controlled) declares this directly, by name, in ITS OWN `requires` array — there is no separate 'artifact-payoff' capability name, matching the `self-mills`/`discard-outlet` discipline above.",
    },

    // ── Spells cluster ───────────────────────────────────────────────────
    {
        id: "cheap-spell",
        cluster: "Spells",
        gloss: {
            provides:
                "A cheap instant or sorcery (mana value ≤ 2) cast often in a game.",
            requires:
                "Prowess, a noncreature-cast trigger or a spell rebuy needs these beside it.",
        },
        example: { provider: "Lightning Bolt", requirer: "Snapcaster Mage" },
        description:
            "PROVIDES: an instant or sorcery with mana value 2 or less — cheap enough that a deck casts it, often more than one a turn, across a normal game, and worth its card on resolution (Lightning Bolt deals its 3 damage and feeds a prowess trigger on the way). Distinct from `value-on-cast`, which pays the moment it is cast whether or not it resolves (the storm/cascade feeder): Lightning Bolt does not provide that row, yet it is exactly what this row's requirers want. REQUIRES: a card that pays off CASTING instants and sorceries or noncreature spells (prowess, magecraft, a 'whenever you cast a noncreature spell' trigger) or that replays or copies them (Snapcaster Mage granting one flashback, Lutri copying one on the stack) requires this from the spells beside it — it is worth its cost only with cheap instants and sorceries in the deck, whatever plan the deck carries.",
    },

    // ── Bodies cluster ───────────────────────────────────────────────────
    {
        id: "go-wide",
        cluster: "Bodies",
        gloss: {
            provides:
                "Puts two or more creature bodies onto the battlefield, at once or over turns.",
            requires:
                "A payoff that scales with the number of creatures its controller has.",
        },
        example: { provider: "Lingering Souls", requirer: "Gaea's Cradle" },
        description:
            "PROVIDES: a card that puts two or more creature bodies onto the battlefield under its controller's control — at once (a spell or enters trigger creating two or more creature tokens, Lingering Souls) or over turns (a repeating trigger or activated ability creating one each time, Third Path Iconoclast; a creature that leaves bodies behind when it dies, Worldspine Wurm). One creature, however large, does not provide it. REQUIRES: a payoff whose amount reads the NUMBER of creatures its controller has — mana per creature (Gaea's Cradle), power or damage per creature, an anthem or team pump that is worth more the more bodies it touches, convoke — requires this from the cards around it. The bodies must STAY: a sacrifice outlet that wants expendable bodies to throw away is not a requirer of this row, even though the same token makers feed it.",
    },
    {
        id: "sacrifice-fodder",
        cluster: "Bodies",
        gloss: {
            provides:
                "Cheap or token permanents whose loss costs their controller little.",
            requires:
                "A sacrifice outlet or sacrifice cost that turns its controller's own permanents into value.",
        },
        example: {
            provider: "Lingering Souls",
            requirer: "Goblin Bombardment",
        },
        description:
            "PROVIDES: a card that gives its controller permanents cheap enough to throw away — creature or artifact tokens (Lingering Souls' four Spirits for two cards' worth of mana, a Servo or Eldrazi Spawn), or a body that has already left its value behind (an enters trigger that drew or made tokens). The point is expendability: losing the permanent costs its controller almost nothing. REQUIRES: a sacrifice outlet or a sacrifice cost that turns its controller's OWN permanents into value — a free repeatable outlet (Goblin Bombardment, one damage per creature), a spell or ability with a sacrifice-a-permanent additional cost (Bone Shards, Natural Order, Recurring Nightmare), or a payoff that cashes in a body's death (Skullclamp) — requires this from the cards around it. Distinct from `value-on-death` (a death trigger ON the fodder, Worldspine Wurm: that card is the payoff of dying, not a body worth little) and from `go-wide`, whose payoff counts creatures and wants bodies that STAY on the battlefield where this row's requirer wants bodies to throw away.",
    },

    // ── Lands cluster ────────────────────────────────────────────────────
    {
        id: "land-enters",
        cluster: "Lands",
        gloss: {
            provides:
                "Makes more than one land enter per turn: fetch lands, extra land plays, lands put onto the battlefield.",
            requires:
                "A landfall payoff, triggered whenever a land enters under your control.",
        },
        example: { provider: "Polluted Delta", requirer: "Tireless Tracker" },
        description:
            "PROVIDES: makes MORE land entries than the one land drop a turn gives — a fetch land (two land entries from one land drop: the fetch itself, then the land it searches for), an extra land play (Escape to the Wilds, a 'you may play an additional land' static), or a land put onto the battlefield from library, hand or graveyard by an effect (Knight of the Reliquary, Uro's enters/attacks trigger, a play-lands-from-graveyard permission). REQUIRES: a landfall payoff — a trigger on 'whenever a land you control enters' (Tireless Tracker's Clue, Omnath's escalating landfall) — requires this from its deck-mates: every extra land entry is one more trigger. Distinct from `self-mills` (a fetch land provides both): this row's requirer wants a land ENTERING, never land cards sitting in the graveyard.",
    },
];

/** Fast id -> row lookup, built once at module load — mirrors
 *  `mechanicsRegistry.ts`'s registry-array-plus-lookup-set shape. */
const CAPABILITY_IDS: ReadonlySet<string> = new Set(
    CAPABILITY_REGISTRY.map((row) => row.id)
);

/** True iff `name` is a row in the closed Capability vocabulary — the single
 *  authority Card Capabilities authoring (and its catalogue-wide guard test)
 *  consults before writing a `provides`/`requires` string. Case-SENSITIVE:
 *  Capability ids are internal engine vocabulary, not user-facing text, so
 *  there is no reason to tolerate a casing typo silently matching (unlike
 *  `scope`, which IS user-facing/data-driven and normalizes to lowercase). */
export function isRegisteredCapability(name: string): boolean {
    return CAPABILITY_IDS.has(name);
}

/** True iff `name` is a derived row — a mana-value-bounded refinement no
 *  card provides by hand (`CapabilityRow.bound`), so the editor can show it
 *  read-only on the providing side. */
export function isDerivedCapability(name: string): boolean {
    return (
        CAPABILITY_REGISTRY.find((row) => row.id === name)?.bound !== undefined
    );
}

/** True iff a card with `providerCapabilities` and mana value
 *  `providerManaValue` satisfies a `requiredCapability` (issue #1677). A plain
 *  row is satisfied by a provider listing it; a mana-value-bounded row
 *  (`CapabilityRow.bound`) by a provider of its base capability whose mana
 *  value is within the ceiling. */
export function capabilitySatisfiedBy(
    requiredCapability: string,
    providerCapabilities: readonly string[],
    providerManaValue: number
): boolean {
    const bound = CAPABILITY_REGISTRY.find(
        (row) => row.id === requiredCapability
    )?.bound;
    // A bounded row is never satisfied by listing it: only the base
    // capability within the ceiling counts, so a profile cannot dodge it.
    if (bound === undefined) {
        return providerCapabilities.includes(requiredCapability);
    }
    return (
        providerCapabilities.includes(bound.capability) &&
        providerManaValue <= bound.maxManaValue
    );
}
