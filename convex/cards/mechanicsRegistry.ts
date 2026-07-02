// Mechanics Registry — machine-readable census of every CR 701 keyword
// action and CR 702 keyword ability (ADR 0045 "Effect Script", ADR 0046
// "card registry"). Single authority on mechanic names: the registry-wide
// guard test (__tests__/mechanicsRegistry.test.ts) fails CI if any
// CardDefinition declares a `staticAbilities` string that isn't covered by
// a row here (directly or via `bindingPattern`, for parametrized keywords
// like "protection from red" or "rampage 2").
//
// Census is total; implementation is demand-driven (ADR 0045) — a `planned`
// row costs nothing and commits to nothing. An `implemented` row MUST carry
// a real binding (enforced by the guard test): either the literal
// `staticAbilities` string the engine branches on, or a short pointer to the
// primitive/module that implements the keyword action's verb (CR 701 rows
// rarely appear as literal `staticAbilities` strings — they're SpellContext
// primitives invoked from `resolve()`, not board-visible keywords). Once the
// Effect Script interpreter ships (ADR 0045) an implemented row's binding
// may instead be an Op name.
//
// CR numbering source: Comprehensive Rules effective 2025-09-19
// (media.wizards.com/2025/downloads/MagicCompRules%2020250919.txt). Section
// numbers shift between CR editions as new keywords are inserted — always
// re-derive a row's number from a current rules text, never copy a stale
// in-repo comment (e.g. banding.ts cites "CR 702.21", correct for an older
// edition; the current CR lists Banding at 702.22 — this registry uses the
// current number and does not "fix" the older comment, which is out of
// scope for this census).
//
// Known engine gaps surfaced while building this census (flagged per
// CLAUDE.md "flag explicitly rather than assuming deferred" — not fixed
// here, out of scope for a census-only issue): `haste`, `hexproof`, and
// `shroud` are pushed onto a permanent's `staticAbilities` by at least one
// card (granted dynamically, e.g. Instill Energy / Homarid Warrior) but no
// engine-side check anywhere consumes the string — combat eligibility and
// targeting legality behave as if the creature never had the keyword. Rows
// below are marked `status: "planned"` with a `note` documenting this rather
// than `implemented`, to keep the registry an honest source of truth.

export type MechanicKind = "keyword-ability" | "keyword-action";
export type MechanicStatus = "implemented" | "planned" | "out-of-scope";

export interface MechanicRow {
    /** Canonical lowercase kebab-case id, derived from the CR keyword name
     *  (e.g. "First Strike" -> "first-strike"). Unique across the registry
     *  — enforced by the guard test. */
    id: string;
    /** The CR keyword's official title-case name (e.g. "First Strike",
     *  "Cumulative Upkeep"). The name-authority guard accepts a card's
     *  declared `staticAbilities` string when it case-insensitively equals
     *  this name — the common case, since most cards declare the plain
     *  lowercase keyword. Parametrized or differently-cased declared
     *  strings (e.g. "cumulative-upkeep", "protection from red") instead
     *  match via `binding` / `bindingPattern`. */
    name: string;
    kind: MechanicKind;
    /** CR section, e.g. "702.7" (2025-09-19 numbering). */
    cr: string;
    status: MechanicStatus;
    /** Engine binding when `status` is "implemented": either the literal
     *  `staticAbilities` string the engine checks (keyword abilities), or a
     *  short pointer to the primitive/module implementing the verb (keyword
     *  actions, which rarely appear as a literal static-ability string).
     *  Required by the guard test whenever `status === "implemented"`. */
    binding?: string;
    /** For a parametrized keyword whose literal `staticAbilities` string
     *  carries a runtime-chosen suffix (protection from a color, rampage N,
     *  a landwalk variant, "bands with other [quality]") — matched against
     *  the FULL declared string. A row may have `binding`, `bindingPattern`,
     *  or both. */
    bindingPattern?: RegExp;
    /** Freeform note: why out-of-scope, what's simplified, a known gap. */
    note?: string;
}

/** CR 701 — Keyword Actions (63 rows, 701.2 through 701.64; 701.1 is the
 *  section's intro paragraph and carries no keyword). */
const KEYWORD_ACTIONS: MechanicRow[] = [
    // 701.2 Activate
    {
        id: "activate",
        name: "Activate",
        kind: "keyword-action",
        cr: "701.2",
        status: "implemented",
        binding:
            "game.ts activateAbility mutation + CardDefinition.activatedAbilities",
    },
    // 701.3 Attach
    {
        id: "attach",
        name: "Attach",
        kind: "keyword-action",
        cr: "701.3",
        status: "implemented",
        binding:
            "Aura/Equipment attach on ETB (finalizeSpellResolution) + equip cost (SpellContext.reattachAura)",
    },
    // 701.4 Behold
    {
        id: "behold",
        name: "Behold",
        kind: "keyword-action",
        cr: "701.4",
        status: "planned",
    },
    // 701.5 Cast
    {
        id: "cast",
        name: "Cast",
        kind: "keyword-action",
        cr: "701.5",
        status: "implemented",
        binding: "game.ts castSpell mutation",
    },
    // 701.6 Counter
    {
        id: "counter",
        name: "Counter",
        kind: "keyword-action",
        cr: "701.6",
        status: "implemented",
        binding: "SpellContext.counter",
    },
    // 701.7 Create
    {
        id: "create",
        name: "Create",
        kind: "keyword-action",
        cr: "701.7",
        status: "implemented",
        binding: "SpellContext.createToken / createTokenCopyOf",
    },
    // 701.8 Destroy
    {
        id: "destroy",
        name: "Destroy",
        kind: "keyword-action",
        cr: "701.8",
        status: "implemented",
        binding: "SpellContext.destroy / destroyAll",
    },
    // 701.9 Discard
    {
        id: "discard",
        name: "Discard",
        kind: "keyword-action",
        cr: "701.9",
        status: "implemented",
        binding: "SpellContext.discardCard / discardAtRandom",
    },
    // 701.10 Double
    {
        id: "double",
        name: "Double",
        kind: "keyword-action",
        cr: "701.10",
        status: "planned",
    },
    // 701.11 Triple
    {
        id: "triple",
        name: "Triple",
        kind: "keyword-action",
        cr: "701.11",
        status: "planned",
    },
    // 701.12 Exchange
    {
        id: "exchange",
        name: "Exchange",
        kind: "keyword-action",
        cr: "701.12",
        status: "planned",
    },
    // 701.13 Exile
    {
        id: "exile",
        name: "Exile",
        kind: "keyword-action",
        cr: "701.13",
        status: "implemented",
        binding:
            "SpellContext.exile / exileFaceDown / exileSelf / exileWithAttachments",
    },
    // 701.14 Fight
    {
        id: "fight",
        name: "Fight",
        kind: "keyword-action",
        cr: "701.14",
        status: "implemented",
        binding: "SpellContext.fight",
    },
    // 701.15 Goad
    {
        id: "goad",
        name: "Goad",
        kind: "keyword-action",
        cr: "701.15",
        status: "planned",
    },
    // 701.16 Investigate
    {
        id: "investigate",
        name: "Investigate",
        kind: "keyword-action",
        cr: "701.16",
        status: "planned",
    },
    // 701.17 Mill
    {
        id: "mill",
        name: "Mill",
        kind: "keyword-action",
        cr: "701.17",
        status: "planned",
    },
    // 701.18 Play
    {
        id: "play",
        name: "Play",
        kind: "keyword-action",
        cr: "701.18",
        status: "implemented",
        binding: "SpellContext.playLandForPlayer + core cast system",
    },
    // 701.19 Regenerate
    {
        id: "regenerate",
        name: "Regenerate",
        kind: "keyword-action",
        cr: "701.19",
        status: "implemented",
        binding:
            "state.ts regenerateOrDestroy / SpellContext.applyRegenerationShield",
    },
    // 701.20 Reveal
    {
        id: "reveal",
        name: "Reveal",
        kind: "keyword-action",
        cr: "701.20",
        status: "implemented",
        binding: "SpellContext.revealHand / markKnown / markKnownToAll",
    },
    // 701.21 Sacrifice
    {
        id: "sacrifice",
        name: "Sacrifice",
        kind: "keyword-action",
        cr: "701.21",
        status: "implemented",
        binding: "SpellContext.sacrifice",
    },
    // 701.22 Scry
    {
        id: "scry",
        name: "Scry",
        kind: "keyword-action",
        cr: "701.22",
        status: "implemented",
        binding:
            "SpellContext.peekLibraryTop / reorderLibraryTop (e.g. dft/blue.ts, fem/blue.ts, atq/blue.ts)",
    },
    // 701.23 Search
    {
        id: "search",
        name: "Search",
        kind: "keyword-action",
        cr: "701.23",
        status: "implemented",
        binding:
            'requestChoice({ zone: "library" }) + moveZone tutor composition (ADR 0027)',
    },
    // 701.24 Shuffle
    {
        id: "shuffle",
        name: "Shuffle",
        kind: "keyword-action",
        cr: "701.24",
        status: "implemented",
        binding: "SpellContext.shuffleLibrary",
    },
    // 701.25 Surveil
    {
        id: "surveil",
        name: "Surveil",
        kind: "keyword-action",
        cr: "701.25",
        status: "planned",
    },
    // 701.26 Tap and Untap
    {
        id: "tap-and-untap",
        name: "Tap and Untap",
        kind: "keyword-action",
        cr: "701.26",
        status: "implemented",
        binding: "SpellContext.tap / untap / tapAllLands",
    },
    // 701.27 Transform
    {
        id: "transform",
        name: "Transform",
        kind: "keyword-action",
        cr: "701.27",
        status: "planned",
    },
    // 701.28 Convert
    {
        id: "convert",
        name: "Convert",
        kind: "keyword-action",
        cr: "701.28",
        status: "out-of-scope",
        note: "mana-value conversion for melded/transformed permanents — no melded/DFC pool modelled",
    },
    // 701.29 Fateseal
    {
        id: "fateseal",
        name: "Fateseal",
        kind: "keyword-action",
        cr: "701.29",
        status: "planned",
    },
    // 701.30 Clash
    {
        id: "clash",
        name: "Clash",
        kind: "keyword-action",
        cr: "701.30",
        status: "planned",
    },
    // 701.31 Planeswalk
    {
        id: "planeswalk",
        name: "Planeswalk",
        kind: "keyword-action",
        cr: "701.31",
        status: "out-of-scope",
        note: "Planechase-only action, no plane/phenomenon subsystem",
    },
    // 701.32 Set in Motion
    {
        id: "set-in-motion",
        name: "Set in Motion",
        kind: "keyword-action",
        cr: "701.32",
        status: "out-of-scope",
        note: "Archenemy-only action, no scheme-card subsystem",
    },
    // 701.33 Abandon
    {
        id: "abandon",
        name: "Abandon",
        kind: "keyword-action",
        cr: "701.33",
        status: "out-of-scope",
        note: "Archenemy-only action, no scheme-card subsystem",
    },
    // 701.34 Proliferate
    {
        id: "proliferate",
        name: "Proliferate",
        kind: "keyword-action",
        cr: "701.34",
        status: "planned",
    },
    // 701.35 Detain
    {
        id: "detain",
        name: "Detain",
        kind: "keyword-action",
        cr: "701.35",
        status: "planned",
    },
    // 701.36 Populate
    {
        id: "populate",
        name: "Populate",
        kind: "keyword-action",
        cr: "701.36",
        status: "planned",
    },
    // 701.37 Monstrosity
    {
        id: "monstrosity",
        name: "Monstrosity",
        kind: "keyword-action",
        cr: "701.37",
        status: "planned",
    },
    // 701.38 Vote
    {
        id: "vote",
        name: "Vote",
        kind: "keyword-action",
        cr: "701.38",
        status: "planned",
    },
    // 701.39 Bolster
    {
        id: "bolster",
        name: "Bolster",
        kind: "keyword-action",
        cr: "701.39",
        status: "planned",
    },
    // 701.40 Manifest
    {
        id: "manifest",
        name: "Manifest",
        kind: "keyword-action",
        cr: "701.40",
        status: "planned",
    },
    // 701.41 Support
    {
        id: "support",
        name: "Support",
        kind: "keyword-action",
        cr: "701.41",
        status: "planned",
    },
    // 701.42 Meld
    {
        id: "meld",
        name: "Meld",
        kind: "keyword-action",
        cr: "701.42",
        status: "planned",
    },
    // 701.43 Exert
    {
        id: "exert",
        name: "Exert",
        kind: "keyword-action",
        cr: "701.43",
        status: "planned",
    },
    // 701.44 Explore
    {
        id: "explore",
        name: "Explore",
        kind: "keyword-action",
        cr: "701.44",
        status: "planned",
    },
    // 701.45 Assemble
    {
        id: "assemble",
        name: "Assemble",
        kind: "keyword-action",
        cr: "701.45",
        status: "out-of-scope",
        note: "Unstable Contraption-only action, silver-border, structurally excluded",
    },
    // 701.46 Adapt
    {
        id: "adapt",
        name: "Adapt",
        kind: "keyword-action",
        cr: "701.46",
        status: "planned",
    },
    // 701.47 Amass
    {
        id: "amass",
        name: "Amass",
        kind: "keyword-action",
        cr: "701.47",
        status: "planned",
    },
    // 701.48 Learn
    {
        id: "learn",
        name: "Learn",
        kind: "keyword-action",
        cr: "701.48",
        status: "planned",
    },
    // 701.49 Venture into the Dungeon
    {
        id: "venture-into-the-dungeon",
        name: "Venture into the Dungeon",
        kind: "keyword-action",
        cr: "701.49",
        status: "out-of-scope",
        note: "needs a dungeon-card subsystem not modelled",
    },
    // 701.50 Connive
    {
        id: "connive",
        name: "Connive",
        kind: "keyword-action",
        cr: "701.50",
        status: "planned",
    },
    // 701.51 Open an Attraction
    {
        id: "open-an-attraction",
        name: "Open an Attraction",
        kind: "keyword-action",
        cr: "701.51",
        status: "out-of-scope",
        note: "Un-set Attraction-deck subsystem not modelled",
    },
    // 701.52 Roll to Visit Your Attractions
    {
        id: "roll-to-visit-your-attractions",
        name: "Roll to Visit Your Attractions",
        kind: "keyword-action",
        cr: "701.52",
        status: "out-of-scope",
        note: "Un-set Attraction-deck subsystem not modelled",
    },
    // 701.53 Incubate
    {
        id: "incubate",
        name: "Incubate",
        kind: "keyword-action",
        cr: "701.53",
        status: "planned",
    },
    // 701.54 The Ring Tempts You
    {
        id: "the-ring-tempts-you",
        name: "The Ring Tempts You",
        kind: "keyword-action",
        cr: "701.54",
        status: "planned",
    },
    // 701.55 Face a Villainous Choice
    {
        id: "face-a-villainous-choice",
        name: "Face a Villainous Choice",
        kind: "keyword-action",
        cr: "701.55",
        status: "out-of-scope",
        note: "needs a Villain-type card subsystem not modelled",
    },
    // 701.56 Time Travel
    {
        id: "time-travel",
        name: "Time Travel",
        kind: "keyword-action",
        cr: "701.56",
        status: "planned",
    },
    // 701.57 Discover
    {
        id: "discover",
        name: "Discover",
        kind: "keyword-action",
        cr: "701.57",
        status: "planned",
    },
    // 701.58 Cloak
    {
        id: "cloak",
        name: "Cloak",
        kind: "keyword-action",
        cr: "701.58",
        status: "planned",
    },
    // 701.59 Collect Evidence
    {
        id: "collect-evidence",
        name: "Collect Evidence",
        kind: "keyword-action",
        cr: "701.59",
        status: "planned",
    },
    // 701.60 Suspect
    {
        id: "suspect",
        name: "Suspect",
        kind: "keyword-action",
        cr: "701.60",
        status: "planned",
    },
    // 701.61 Forage
    {
        id: "forage",
        name: "Forage",
        kind: "keyword-action",
        cr: "701.61",
        status: "planned",
    },
    // 701.62 Manifest Dread
    {
        id: "manifest-dread",
        name: "Manifest Dread",
        kind: "keyword-action",
        cr: "701.62",
        status: "planned",
    },
    // 701.63 Endure
    {
        id: "endure",
        name: "Endure",
        kind: "keyword-action",
        cr: "701.63",
        status: "planned",
    },
    // 701.64 Harness
    {
        id: "harness",
        name: "Harness",
        kind: "keyword-action",
        cr: "701.64",
        status: "planned",
    },
];

/** CR 702 — Keyword Abilities (187 rows, 702.2 through 702.188; 702.1 is the
 *  section's intro paragraph and carries no keyword) plus one obsolete
 *  keyword (`unblockable`) removed from the current CR but still live in
 *  this engine's card texts (see note on that row). */
const KEYWORD_ABILITIES: MechanicRow[] = [
    // 702.2 Deathtouch
    {
        id: "deathtouch",
        name: "Deathtouch",
        kind: "keyword-ability",
        cr: "702.2",
        status: "planned",
    },
    // 702.3 Defender
    {
        id: "defender",
        name: "Defender",
        kind: "keyword-ability",
        cr: "702.3",
        status: "implemented",
        binding: "defender",
        note: "combatRegistry.ts AttackRestrictionRule",
    },
    // 702.4 Double Strike
    {
        id: "double-strike",
        name: "Double Strike",
        kind: "keyword-ability",
        cr: "702.4",
        status: "implemented",
        binding: "double strike",
        note: "phases.ts combat-damage-step ordering",
    },
    // 702.5 Enchant
    {
        id: "enchant",
        name: "Enchant",
        kind: "keyword-ability",
        cr: "702.5",
        status: "implemented",
        binding:
            "TargetRequirement + attach/finalizeSpellResolution legality checks",
    },
    // 702.6 Equip
    {
        id: "equip",
        name: "Equip",
        kind: "keyword-ability",
        cr: "702.6",
        status: "implemented",
        binding: "Equipment activatedAbilities cost pattern + attach system",
    },
    // 702.7 First Strike
    {
        id: "first-strike",
        name: "First Strike",
        kind: "keyword-ability",
        cr: "702.7",
        status: "implemented",
        binding: "first strike",
        note: "phases.ts combat-damage-step ordering",
    },
    // 702.8 Flash
    {
        id: "flash",
        name: "Flash",
        kind: "keyword-ability",
        cr: "702.8",
        status: "implemented",
        binding: "flash",
        note: "constants.ts canCastAtInstantSpeed",
    },
    // 702.9 Flying
    {
        id: "flying",
        name: "Flying",
        kind: "keyword-ability",
        cr: "702.9",
        status: "implemented",
        binding: "flying",
        note: "combatRegistry.ts EvasionRule",
    },
    // 702.10 Haste
    {
        id: "haste",
        name: "Haste",
        kind: "keyword-ability",
        cr: "702.10",
        status: "planned",
        note: 'GAP: cards declare `staticAbilities: ["haste"]` (e.g. Instill Energy aura) but combat.ts:181 checks `card.isSummoningSick` unconditionally with no haste bypass anywhere in the engine — the keyword string is decorative only today. `haste` is also an AI-eval heuristic weight (evaluate.ts) unrelated to rules enforcement.',
    },
    // 702.11 Hexproof
    {
        id: "hexproof",
        name: "Hexproof",
        kind: "keyword-ability",
        cr: "702.11",
        status: "planned",
        note: "GAP: granted via SpellContext.grantStaticAbility on at least one card but no target-legality check anywhere reads the string — decorative only, same class as haste.",
    },
    // 702.12 Indestructible
    {
        id: "indestructible",
        name: "Indestructible",
        kind: "keyword-ability",
        cr: "702.12",
        status: "implemented",
        binding: "indestructible",
        note: "state.ts regenerateOrDestroy + SBA 704.5g skip; always granted dynamically via a keyword-grant staticEffect, never declared literally",
    },
    // 702.13 Intimidate
    {
        id: "intimidate",
        name: "Intimidate",
        kind: "keyword-ability",
        cr: "702.13",
        status: "planned",
        note: "Fear (its structurally-identical historical sibling) is implemented (combatRegistry.ts); Intimidate itself has zero engine hits.",
    },
    // 702.14 Landwalk
    {
        id: "landwalk",
        name: "Landwalk",
        kind: "keyword-ability",
        cr: "702.14",
        status: "implemented",
        bindingPattern:
            /^(snow )?(plains|island|swamp|mountain|forest|desert)walk$|^legendary landwalk$/,
        note: "constants.ts LANDWALK_KEYWORDS / LANDWALK_SUPERTYPE_KEYWORDS / LANDWALK_SNOW_SUBTYPE_KEYWORDS + combatRegistry.ts EvasionRule per variant, negation via landwalkNegation.ts",
    },
    // 702.15 Lifelink
    {
        id: "lifelink",
        name: "Lifelink",
        kind: "keyword-ability",
        cr: "702.15",
        status: "planned",
        note: "no life-gain-on-damage-dealt check found anywhere in the engine",
    },
    // 702.16 Protection
    {
        id: "protection",
        name: "Protection",
        kind: "keyword-ability",
        cr: "702.16",
        status: "implemented",
        bindingPattern: /^protection from /,
        note: "dedicated convex/gre/protection.ts module (targeting, damage, blocking per CR 702.16b/e/f)",
    },
    // 702.17 Reach
    {
        id: "reach",
        name: "Reach",
        kind: "keyword-ability",
        cr: "702.17",
        status: "implemented",
        binding: "reach",
        note: "combatRegistry.ts EvasionRule — can block flying",
    },
    // 702.18 Shroud
    {
        id: "shroud",
        name: "Shroud",
        kind: "keyword-ability",
        cr: "702.18",
        status: "planned",
        note: "GAP: granted via SpellContext.grantStaticAbility on multiple fem/blue.ts cards but no target-legality check anywhere reads the string — decorative only, same class as haste.",
    },
    // 702.19 Trample
    {
        id: "trample",
        name: "Trample",
        kind: "keyword-ability",
        cr: "702.19",
        status: "implemented",
        binding: "trample",
        note: "phases.ts/state.ts excess-combat-damage carryover",
    },
    // 702.20 Vigilance
    {
        id: "vigilance",
        name: "Vigilance",
        kind: "keyword-ability",
        cr: "702.20",
        status: "implemented",
        binding: "vigilance",
        note: "phases.ts/moves.ts untap-step no-op-on-attack override",
    },
    // 702.21 Ward
    {
        id: "ward",
        name: "Ward",
        kind: "keyword-ability",
        cr: "702.21",
        status: "planned",
        note: "no dedicated module, no card declares it, no engine check found",
    },
    // 702.22 Banding
    {
        id: "banding",
        name: "Banding",
        kind: "keyword-ability",
        cr: "702.22",
        status: "implemented",
        binding: "banding",
        bindingPattern: /^bands with other:/,
        note: 'convex/gre/banding.ts — plain banding (702.22e) and the parametrized "bands with other [quality]" variant (702.22j, BANDS_WITH_OTHER_PREFIX)',
    },
    // 702.23 Rampage
    {
        id: "rampage",
        name: "Rampage",
        kind: "keyword-ability",
        cr: "702.23",
        status: "implemented",
        bindingPattern: /^rampage \d+$/,
        note: 'convex/cards/abilities/triggers/rampageTrigger.ts factory — "rampage N" static string is board-visible reminder data, rampageTrigger(N) is the enforcing triggered ability',
    },
    // 702.24 Cumulative Upkeep
    {
        id: "cumulative-upkeep",
        name: "Cumulative Upkeep",
        kind: "keyword-ability",
        cr: "702.24",
        status: "implemented",
        binding: "cumulative-upkeep",
        note: "convex/cards/abilities/cumulativeUpkeep.ts (ADR 0042), used across ice/*.ts",
    },
    // 702.25 Flanking
    {
        id: "flanking",
        name: "Flanking",
        kind: "keyword-ability",
        cr: "702.25",
        status: "planned",
        note: "zero engine hits despite Ice Age (ice) being a supported home set for this keyword",
    },
    // 702.26 Phasing
    {
        id: "phasing",
        name: "Phasing",
        kind: "keyword-ability",
        cr: "702.26",
        status: "planned",
        note: 'the phase-out/phase-in STATE machinery (phaseOutPermanent/phaseInBundle in state.ts, SpellContext.phaseIn/phaseOut) correctly implements CR 702.26h "treated as though it doesn\'t exist" semantics and is used today for effect-driven phasing (Oubliette\'s "phases out until this leaves", arn/black.ts) — but no automatic per-untap-step toggle exists, so a card that merely declared the native keyword (CR 702.26a-c) would not behave correctly yet. Binding machinery ready; keyword-declaration path unbuilt.',
    },
    // 702.27 Buyback
    {
        id: "buyback",
        name: "Buyback",
        kind: "keyword-ability",
        cr: "702.27",
        status: "planned",
    },
    // 702.28 Shadow
    {
        id: "shadow",
        name: "Shadow",
        kind: "keyword-ability",
        cr: "702.28",
        status: "planned",
    },
    // 702.29 Cycling
    {
        id: "cycling",
        name: "Cycling",
        kind: "keyword-ability",
        cr: "702.29",
        status: "planned",
    },
    // 702.30 Echo
    {
        id: "echo",
        name: "Echo",
        kind: "keyword-ability",
        cr: "702.30",
        status: "planned",
    },
    // 702.31 Horsemanship
    {
        id: "horsemanship",
        name: "Horsemanship",
        kind: "keyword-ability",
        cr: "702.31",
        status: "planned",
    },
    // 702.32 Fading
    {
        id: "fading",
        name: "Fading",
        kind: "keyword-ability",
        cr: "702.32",
        status: "planned",
    },
    // 702.33 Kicker
    {
        id: "kicker",
        name: "Kicker",
        kind: "keyword-ability",
        cr: "702.33",
        status: "planned",
    },
    // 702.34 Flashback
    {
        id: "flashback",
        name: "Flashback",
        kind: "keyword-ability",
        cr: "702.34",
        status: "planned",
    },
    // 702.35 Madness
    {
        id: "madness",
        name: "Madness",
        kind: "keyword-ability",
        cr: "702.35",
        status: "planned",
    },
    // 702.36 Fear
    {
        id: "fear",
        name: "Fear",
        kind: "keyword-ability",
        cr: "702.36",
        status: "implemented",
        binding: "fear",
        note: "combatRegistry.ts EvasionRule — blocked only by artifact/black creatures",
    },
    // 702.37 Morph
    {
        id: "morph",
        name: "Morph",
        kind: "keyword-ability",
        cr: "702.37",
        status: "planned",
    },
    // 702.38 Amplify
    {
        id: "amplify",
        name: "Amplify",
        kind: "keyword-ability",
        cr: "702.38",
        status: "planned",
    },
    // 702.39 Provoke
    {
        id: "provoke",
        name: "Provoke",
        kind: "keyword-ability",
        cr: "702.39",
        status: "planned",
    },
    // 702.40 Storm
    {
        id: "storm",
        name: "Storm",
        kind: "keyword-ability",
        cr: "702.40",
        status: "planned",
    },
    // 702.41 Affinity
    {
        id: "affinity",
        name: "Affinity",
        kind: "keyword-ability",
        cr: "702.41",
        status: "planned",
    },
    // 702.42 Entwine
    {
        id: "entwine",
        name: "Entwine",
        kind: "keyword-ability",
        cr: "702.42",
        status: "planned",
    },
    // 702.43 Modular
    {
        id: "modular",
        name: "Modular",
        kind: "keyword-ability",
        cr: "702.43",
        status: "planned",
    },
    // 702.44 Sunburst
    {
        id: "sunburst",
        name: "Sunburst",
        kind: "keyword-ability",
        cr: "702.44",
        status: "planned",
    },
    // 702.45 Bushido
    {
        id: "bushido",
        name: "Bushido",
        kind: "keyword-ability",
        cr: "702.45",
        status: "planned",
    },
    // 702.46 Soulshift
    {
        id: "soulshift",
        name: "Soulshift",
        kind: "keyword-ability",
        cr: "702.46",
        status: "planned",
    },
    // 702.47 Splice
    {
        id: "splice",
        name: "Splice",
        kind: "keyword-ability",
        cr: "702.47",
        status: "planned",
    },
    // 702.48 Offering
    {
        id: "offering",
        name: "Offering",
        kind: "keyword-ability",
        cr: "702.48",
        status: "planned",
    },
    // 702.49 Ninjutsu
    {
        id: "ninjutsu",
        name: "Ninjutsu",
        kind: "keyword-ability",
        cr: "702.49",
        status: "planned",
    },
    // 702.50 Epic
    {
        id: "epic",
        name: "Epic",
        kind: "keyword-ability",
        cr: "702.50",
        status: "planned",
    },
    // 702.51 Convoke
    {
        id: "convoke",
        name: "Convoke",
        kind: "keyword-ability",
        cr: "702.51",
        status: "planned",
    },
    // 702.52 Dredge
    {
        id: "dredge",
        name: "Dredge",
        kind: "keyword-ability",
        cr: "702.52",
        status: "planned",
    },
    // 702.53 Transmute
    {
        id: "transmute",
        name: "Transmute",
        kind: "keyword-ability",
        cr: "702.53",
        status: "planned",
    },
    // 702.54 Bloodthirst
    {
        id: "bloodthirst",
        name: "Bloodthirst",
        kind: "keyword-ability",
        cr: "702.54",
        status: "planned",
    },
    // 702.55 Haunt
    {
        id: "haunt",
        name: "Haunt",
        kind: "keyword-ability",
        cr: "702.55",
        status: "planned",
    },
    // 702.56 Replicate
    {
        id: "replicate",
        name: "Replicate",
        kind: "keyword-ability",
        cr: "702.56",
        status: "planned",
    },
    // 702.57 Forecast
    {
        id: "forecast",
        name: "Forecast",
        kind: "keyword-ability",
        cr: "702.57",
        status: "planned",
    },
    // 702.58 Graft
    {
        id: "graft",
        name: "Graft",
        kind: "keyword-ability",
        cr: "702.58",
        status: "planned",
    },
    // 702.59 Recover
    {
        id: "recover",
        name: "Recover",
        kind: "keyword-ability",
        cr: "702.59",
        status: "planned",
    },
    // 702.60 Ripple
    {
        id: "ripple",
        name: "Ripple",
        kind: "keyword-ability",
        cr: "702.60",
        status: "planned",
    },
    // 702.61 Split Second
    {
        id: "split-second",
        name: "Split Second",
        kind: "keyword-ability",
        cr: "702.61",
        status: "planned",
    },
    // 702.62 Suspend
    {
        id: "suspend",
        name: "Suspend",
        kind: "keyword-ability",
        cr: "702.62",
        status: "planned",
    },
    // 702.63 Vanishing
    {
        id: "vanishing",
        name: "Vanishing",
        kind: "keyword-ability",
        cr: "702.63",
        status: "planned",
    },
    // 702.64 Absorb
    {
        id: "absorb",
        name: "Absorb",
        kind: "keyword-ability",
        cr: "702.64",
        status: "planned",
    },
    // 702.65 Aura Swap
    {
        id: "aura-swap",
        name: "Aura Swap",
        kind: "keyword-ability",
        cr: "702.65",
        status: "planned",
    },
    // 702.66 Delve
    {
        id: "delve",
        name: "Delve",
        kind: "keyword-ability",
        cr: "702.66",
        status: "planned",
    },
    // 702.67 Fortify
    {
        id: "fortify",
        name: "Fortify",
        kind: "keyword-ability",
        cr: "702.67",
        status: "planned",
    },
    // 702.68 Frenzy
    {
        id: "frenzy",
        name: "Frenzy",
        kind: "keyword-ability",
        cr: "702.68",
        status: "planned",
    },
    // 702.69 Gravestorm
    {
        id: "gravestorm",
        name: "Gravestorm",
        kind: "keyword-ability",
        cr: "702.69",
        status: "planned",
    },
    // 702.70 Poisonous
    {
        id: "poisonous",
        name: "Poisonous",
        kind: "keyword-ability",
        cr: "702.70",
        status: "planned",
    },
    // 702.71 Transfigure
    {
        id: "transfigure",
        name: "Transfigure",
        kind: "keyword-ability",
        cr: "702.71",
        status: "planned",
    },
    // 702.72 Champion
    {
        id: "champion",
        name: "Champion",
        kind: "keyword-ability",
        cr: "702.72",
        status: "planned",
    },
    // 702.73 Changeling
    {
        id: "changeling",
        name: "Changeling",
        kind: "keyword-ability",
        cr: "702.73",
        status: "planned",
    },
    // 702.74 Evoke
    {
        id: "evoke",
        name: "Evoke",
        kind: "keyword-ability",
        cr: "702.74",
        status: "planned",
    },
    // 702.75 Hideaway
    {
        id: "hideaway",
        name: "Hideaway",
        kind: "keyword-ability",
        cr: "702.75",
        status: "planned",
    },
    // 702.76 Prowl
    {
        id: "prowl",
        name: "Prowl",
        kind: "keyword-ability",
        cr: "702.76",
        status: "planned",
    },
    // 702.77 Reinforce
    {
        id: "reinforce",
        name: "Reinforce",
        kind: "keyword-ability",
        cr: "702.77",
        status: "planned",
    },
    // 702.78 Conspire
    {
        id: "conspire",
        name: "Conspire",
        kind: "keyword-ability",
        cr: "702.78",
        status: "planned",
    },
    // 702.79 Persist
    {
        id: "persist",
        name: "Persist",
        kind: "keyword-ability",
        cr: "702.79",
        status: "planned",
    },
    // 702.80 Wither
    {
        id: "wither",
        name: "Wither",
        kind: "keyword-ability",
        cr: "702.80",
        status: "planned",
    },
    // 702.81 Retrace
    {
        id: "retrace",
        name: "Retrace",
        kind: "keyword-ability",
        cr: "702.81",
        status: "planned",
    },
    // 702.82 Devour
    {
        id: "devour",
        name: "Devour",
        kind: "keyword-ability",
        cr: "702.82",
        status: "planned",
    },
    // 702.83 Exalted
    {
        id: "exalted",
        name: "Exalted",
        kind: "keyword-ability",
        cr: "702.83",
        status: "planned",
    },
    // 702.84 Unearth
    {
        id: "unearth",
        name: "Unearth",
        kind: "keyword-ability",
        cr: "702.84",
        status: "planned",
    },
    // 702.85 Cascade
    {
        id: "cascade",
        name: "Cascade",
        kind: "keyword-ability",
        cr: "702.85",
        status: "planned",
    },
    // 702.86 Annihilator
    {
        id: "annihilator",
        name: "Annihilator",
        kind: "keyword-ability",
        cr: "702.86",
        status: "planned",
    },
    // 702.87 Level Up
    {
        id: "level-up",
        name: "Level Up",
        kind: "keyword-ability",
        cr: "702.87",
        status: "planned",
    },
    // 702.88 Rebound
    {
        id: "rebound",
        name: "Rebound",
        kind: "keyword-ability",
        cr: "702.88",
        status: "planned",
    },
    // 702.89 Umbra Armor
    {
        id: "umbra-armor",
        name: "Umbra Armor",
        kind: "keyword-ability",
        cr: "702.89",
        status: "planned",
    },
    // 702.90 Infect
    {
        id: "infect",
        name: "Infect",
        kind: "keyword-ability",
        cr: "702.90",
        status: "planned",
    },
    // 702.91 Battle Cry
    {
        id: "battle-cry",
        name: "Battle Cry",
        kind: "keyword-ability",
        cr: "702.91",
        status: "planned",
    },
    // 702.92 Living Weapon
    {
        id: "living-weapon",
        name: "Living Weapon",
        kind: "keyword-ability",
        cr: "702.92",
        status: "planned",
    },
    // 702.93 Undying
    {
        id: "undying",
        name: "Undying",
        kind: "keyword-ability",
        cr: "702.93",
        status: "planned",
    },
    // 702.94 Miracle
    {
        id: "miracle",
        name: "Miracle",
        kind: "keyword-ability",
        cr: "702.94",
        status: "planned",
    },
    // 702.95 Soulbond
    {
        id: "soulbond",
        name: "Soulbond",
        kind: "keyword-ability",
        cr: "702.95",
        status: "planned",
    },
    // 702.96 Overload
    {
        id: "overload",
        name: "Overload",
        kind: "keyword-ability",
        cr: "702.96",
        status: "planned",
    },
    // 702.97 Scavenge
    {
        id: "scavenge",
        name: "Scavenge",
        kind: "keyword-ability",
        cr: "702.97",
        status: "planned",
    },
    // 702.98 Unleash
    {
        id: "unleash",
        name: "Unleash",
        kind: "keyword-ability",
        cr: "702.98",
        status: "planned",
    },
    // 702.99 Cipher
    {
        id: "cipher",
        name: "Cipher",
        kind: "keyword-ability",
        cr: "702.99",
        status: "planned",
    },
    // 702.100 Evolve
    {
        id: "evolve",
        name: "Evolve",
        kind: "keyword-ability",
        cr: "702.100",
        status: "planned",
    },
    // 702.101 Extort
    {
        id: "extort",
        name: "Extort",
        kind: "keyword-ability",
        cr: "702.101",
        status: "planned",
    },
    // 702.102 Fuse
    {
        id: "fuse",
        name: "Fuse",
        kind: "keyword-ability",
        cr: "702.102",
        status: "planned",
    },
    // 702.103 Bestow
    {
        id: "bestow",
        name: "Bestow",
        kind: "keyword-ability",
        cr: "702.103",
        status: "planned",
    },
    // 702.104 Tribute
    {
        id: "tribute",
        name: "Tribute",
        kind: "keyword-ability",
        cr: "702.104",
        status: "planned",
    },
    // 702.105 Dethrone
    {
        id: "dethrone",
        name: "Dethrone",
        kind: "keyword-ability",
        cr: "702.105",
        status: "planned",
    },
    // 702.106 Hidden Agenda
    {
        id: "hidden-agenda",
        name: "Hidden Agenda",
        kind: "keyword-ability",
        cr: "702.106",
        status: "out-of-scope",
        note: "Conspiracy draft-matters mechanic, needs a face-down conspiracy-deck subsystem",
    },
    // 702.107 Outlast
    {
        id: "outlast",
        name: "Outlast",
        kind: "keyword-ability",
        cr: "702.107",
        status: "planned",
    },
    // 702.108 Prowess
    {
        id: "prowess",
        name: "Prowess",
        kind: "keyword-ability",
        cr: "702.108",
        status: "planned",
    },
    // 702.109 Dash
    {
        id: "dash",
        name: "Dash",
        kind: "keyword-ability",
        cr: "702.109",
        status: "planned",
    },
    // 702.110 Exploit
    {
        id: "exploit",
        name: "Exploit",
        kind: "keyword-ability",
        cr: "702.110",
        status: "planned",
    },
    // 702.111 Menace
    {
        id: "menace",
        name: "Menace",
        kind: "keyword-ability",
        cr: "702.111",
        status: "implemented",
        binding: "menace",
        note: "combat.ts — needs 2+ blockers",
    },
    // 702.112 Renown
    {
        id: "renown",
        name: "Renown",
        kind: "keyword-ability",
        cr: "702.112",
        status: "planned",
    },
    // 702.113 Awaken
    {
        id: "awaken",
        name: "Awaken",
        kind: "keyword-ability",
        cr: "702.113",
        status: "planned",
    },
    // 702.114 Devoid
    {
        id: "devoid",
        name: "Devoid",
        kind: "keyword-ability",
        cr: "702.114",
        status: "planned",
    },
    // 702.115 Ingest
    {
        id: "ingest",
        name: "Ingest",
        kind: "keyword-ability",
        cr: "702.115",
        status: "planned",
    },
    // 702.116 Myriad
    {
        id: "myriad",
        name: "Myriad",
        kind: "keyword-ability",
        cr: "702.116",
        status: "planned",
    },
    // 702.117 Surge
    {
        id: "surge",
        name: "Surge",
        kind: "keyword-ability",
        cr: "702.117",
        status: "planned",
    },
    // 702.118 Skulk
    {
        id: "skulk",
        name: "Skulk",
        kind: "keyword-ability",
        cr: "702.118",
        status: "planned",
    },
    // 702.119 Emerge
    {
        id: "emerge",
        name: "Emerge",
        kind: "keyword-ability",
        cr: "702.119",
        status: "planned",
    },
    // 702.120 Escalate
    {
        id: "escalate",
        name: "Escalate",
        kind: "keyword-ability",
        cr: "702.120",
        status: "planned",
    },
    // 702.121 Melee
    {
        id: "melee",
        name: "Melee",
        kind: "keyword-ability",
        cr: "702.121",
        status: "planned",
    },
    // 702.122 Crew
    {
        id: "crew",
        name: "Crew",
        kind: "keyword-ability",
        cr: "702.122",
        status: "planned",
    },
    // 702.123 Fabricate
    {
        id: "fabricate",
        name: "Fabricate",
        kind: "keyword-ability",
        cr: "702.123",
        status: "planned",
    },
    // 702.124 Partner
    {
        id: "partner",
        name: "Partner",
        kind: "keyword-ability",
        cr: "702.124",
        status: "planned",
    },
    // 702.125 Undaunted
    {
        id: "undaunted",
        name: "Undaunted",
        kind: "keyword-ability",
        cr: "702.125",
        status: "planned",
    },
    // 702.126 Improvise
    {
        id: "improvise",
        name: "Improvise",
        kind: "keyword-ability",
        cr: "702.126",
        status: "planned",
    },
    // 702.127 Aftermath
    {
        id: "aftermath",
        name: "Aftermath",
        kind: "keyword-ability",
        cr: "702.127",
        status: "planned",
    },
    // 702.128 Embalm
    {
        id: "embalm",
        name: "Embalm",
        kind: "keyword-ability",
        cr: "702.128",
        status: "planned",
    },
    // 702.129 Eternalize
    {
        id: "eternalize",
        name: "Eternalize",
        kind: "keyword-ability",
        cr: "702.129",
        status: "planned",
    },
    // 702.130 Afflict
    {
        id: "afflict",
        name: "Afflict",
        kind: "keyword-ability",
        cr: "702.130",
        status: "planned",
    },
    // 702.131 Ascend
    {
        id: "ascend",
        name: "Ascend",
        kind: "keyword-ability",
        cr: "702.131",
        status: "planned",
    },
    // 702.132 Assist
    {
        id: "assist",
        name: "Assist",
        kind: "keyword-ability",
        cr: "702.132",
        status: "planned",
    },
    // 702.133 Jump-Start
    {
        id: "jump-start",
        name: "Jump-Start",
        kind: "keyword-ability",
        cr: "702.133",
        status: "planned",
    },
    // 702.134 Mentor
    {
        id: "mentor",
        name: "Mentor",
        kind: "keyword-ability",
        cr: "702.134",
        status: "planned",
    },
    // 702.135 Afterlife
    {
        id: "afterlife",
        name: "Afterlife",
        kind: "keyword-ability",
        cr: "702.135",
        status: "planned",
    },
    // 702.136 Riot
    {
        id: "riot",
        name: "Riot",
        kind: "keyword-ability",
        cr: "702.136",
        status: "planned",
    },
    // 702.137 Spectacle
    {
        id: "spectacle",
        name: "Spectacle",
        kind: "keyword-ability",
        cr: "702.137",
        status: "planned",
    },
    // 702.138 Escape
    {
        id: "escape",
        name: "Escape",
        kind: "keyword-ability",
        cr: "702.138",
        status: "planned",
    },
    // 702.139 Companion
    {
        id: "companion",
        name: "Companion",
        kind: "keyword-ability",
        cr: "702.139",
        status: "planned",
    },
    // 702.140 Mutate
    {
        id: "mutate",
        name: "Mutate",
        kind: "keyword-ability",
        cr: "702.140",
        status: "planned",
    },
    // 702.141 Encore
    {
        id: "encore",
        name: "Encore",
        kind: "keyword-ability",
        cr: "702.141",
        status: "planned",
    },
    // 702.142 Boast
    {
        id: "boast",
        name: "Boast",
        kind: "keyword-ability",
        cr: "702.142",
        status: "planned",
    },
    // 702.143 Foretell
    {
        id: "foretell",
        name: "Foretell",
        kind: "keyword-ability",
        cr: "702.143",
        status: "planned",
    },
    // 702.144 Demonstrate
    {
        id: "demonstrate",
        name: "Demonstrate",
        kind: "keyword-ability",
        cr: "702.144",
        status: "planned",
    },
    // 702.145 Daybound and Nightbound
    {
        id: "daybound-and-nightbound",
        name: "Daybound and Nightbound",
        kind: "keyword-ability",
        cr: "702.145",
        status: "planned",
    },
    // 702.146 Disturb
    {
        id: "disturb",
        name: "Disturb",
        kind: "keyword-ability",
        cr: "702.146",
        status: "planned",
    },
    // 702.147 Decayed
    {
        id: "decayed",
        name: "Decayed",
        kind: "keyword-ability",
        cr: "702.147",
        status: "planned",
    },
    // 702.148 Cleave
    {
        id: "cleave",
        name: "Cleave",
        kind: "keyword-ability",
        cr: "702.148",
        status: "planned",
    },
    // 702.149 Training
    {
        id: "training",
        name: "Training",
        kind: "keyword-ability",
        cr: "702.149",
        status: "planned",
    },
    // 702.150 Compleated
    {
        id: "compleated",
        name: "Compleated",
        kind: "keyword-ability",
        cr: "702.150",
        status: "planned",
    },
    // 702.151 Reconfigure
    {
        id: "reconfigure",
        name: "Reconfigure",
        kind: "keyword-ability",
        cr: "702.151",
        status: "planned",
    },
    // 702.152 Blitz
    {
        id: "blitz",
        name: "Blitz",
        kind: "keyword-ability",
        cr: "702.152",
        status: "planned",
    },
    // 702.153 Casualty
    {
        id: "casualty",
        name: "Casualty",
        kind: "keyword-ability",
        cr: "702.153",
        status: "planned",
    },
    // 702.154 Enlist
    {
        id: "enlist",
        name: "Enlist",
        kind: "keyword-ability",
        cr: "702.154",
        status: "planned",
    },
    // 702.155 Read Ahead
    {
        id: "read-ahead",
        name: "Read Ahead",
        kind: "keyword-ability",
        cr: "702.155",
        status: "planned",
    },
    // 702.156 Ravenous
    {
        id: "ravenous",
        name: "Ravenous",
        kind: "keyword-ability",
        cr: "702.156",
        status: "planned",
    },
    // 702.157 Squad
    {
        id: "squad",
        name: "Squad",
        kind: "keyword-ability",
        cr: "702.157",
        status: "planned",
    },
    // 702.158 Space Sculptor
    {
        id: "space-sculptor",
        name: "Space Sculptor",
        kind: "keyword-ability",
        cr: "702.158",
        status: "planned",
    },
    // 702.159 Visit
    {
        id: "visit",
        name: "Visit",
        kind: "keyword-ability",
        cr: "702.159",
        status: "planned",
    },
    // 702.160 Prototype
    {
        id: "prototype",
        name: "Prototype",
        kind: "keyword-ability",
        cr: "702.160",
        status: "planned",
    },
    // 702.161 Living Metal
    {
        id: "living-metal",
        name: "Living Metal",
        kind: "keyword-ability",
        cr: "702.161",
        status: "planned",
    },
    // 702.162 More Than Meets the Eye
    {
        id: "more-than-meets-the-eye",
        name: "More Than Meets the Eye",
        kind: "keyword-ability",
        cr: "702.162",
        status: "planned",
    },
    // 702.163 For Mirrodin!
    {
        id: "for-mirrodin",
        name: "For Mirrodin!",
        kind: "keyword-ability",
        cr: "702.163",
        status: "planned",
    },
    // 702.164 Toxic
    {
        id: "toxic",
        name: "Toxic",
        kind: "keyword-ability",
        cr: "702.164",
        status: "planned",
    },
    // 702.165 Backup
    {
        id: "backup",
        name: "Backup",
        kind: "keyword-ability",
        cr: "702.165",
        status: "planned",
    },
    // 702.166 Bargain
    {
        id: "bargain",
        name: "Bargain",
        kind: "keyword-ability",
        cr: "702.166",
        status: "planned",
    },
    // 702.167 Craft
    {
        id: "craft",
        name: "Craft",
        kind: "keyword-ability",
        cr: "702.167",
        status: "planned",
    },
    // 702.168 Disguise
    {
        id: "disguise",
        name: "Disguise",
        kind: "keyword-ability",
        cr: "702.168",
        status: "planned",
    },
    // 702.169 Solved
    {
        id: "solved",
        name: "Solved",
        kind: "keyword-ability",
        cr: "702.169",
        status: "planned",
    },
    // 702.170 Plot
    {
        id: "plot",
        name: "Plot",
        kind: "keyword-ability",
        cr: "702.170",
        status: "planned",
    },
    // 702.171 Saddle
    {
        id: "saddle",
        name: "Saddle",
        kind: "keyword-ability",
        cr: "702.171",
        status: "planned",
    },
    // 702.172 Spree
    {
        id: "spree",
        name: "Spree",
        kind: "keyword-ability",
        cr: "702.172",
        status: "planned",
    },
    // 702.173 Freerunning
    {
        id: "freerunning",
        name: "Freerunning",
        kind: "keyword-ability",
        cr: "702.173",
        status: "planned",
    },
    // 702.174 Gift
    {
        id: "gift",
        name: "Gift",
        kind: "keyword-ability",
        cr: "702.174",
        status: "planned",
    },
    // 702.175 Offspring
    {
        id: "offspring",
        name: "Offspring",
        kind: "keyword-ability",
        cr: "702.175",
        status: "planned",
    },
    // 702.176 Impending
    {
        id: "impending",
        name: "Impending",
        kind: "keyword-ability",
        cr: "702.176",
        status: "planned",
    },
    // 702.177 Exhaust
    {
        id: "exhaust",
        name: "Exhaust",
        kind: "keyword-ability",
        cr: "702.177",
        status: "planned",
    },
    // 702.178 Max Speed
    {
        id: "max-speed",
        name: "Max Speed",
        kind: "keyword-ability",
        cr: "702.178",
        status: "out-of-scope",
        note: "Aetherdrift Speed/Vehicle subsystem not modelled",
    },
    // 702.179 Start Your Engines!
    {
        id: "start-your-engines",
        name: "Start Your Engines!",
        kind: "keyword-ability",
        cr: "702.179",
        status: "out-of-scope",
        note: "Aetherdrift Speed subsystem not modelled",
    },
    // 702.180 Harmonize
    {
        id: "harmonize",
        name: "Harmonize",
        kind: "keyword-ability",
        cr: "702.180",
        status: "planned",
    },
    // 702.181 Mobilize
    {
        id: "mobilize",
        name: "Mobilize",
        kind: "keyword-ability",
        cr: "702.181",
        status: "planned",
    },
    // 702.182 Job Select
    {
        id: "job-select",
        name: "Job Select",
        kind: "keyword-ability",
        cr: "702.182",
        status: "planned",
    },
    // 702.183 Tiered
    {
        id: "tiered",
        name: "Tiered",
        kind: "keyword-ability",
        cr: "702.183",
        status: "planned",
    },
    // 702.184 Station
    {
        id: "station",
        name: "Station",
        kind: "keyword-ability",
        cr: "702.184",
        status: "planned",
    },
    // 702.185 Warp
    {
        id: "warp",
        name: "Warp",
        kind: "keyword-ability",
        cr: "702.185",
        status: "planned",
    },
    // 702.186 ∞ (Infinity)
    {
        id: "infinity",
        name: "∞ (Infinity)",
        kind: "keyword-ability",
        cr: "702.186",
        status: "planned",
    },
    // 702.187 Mayhem
    {
        id: "mayhem",
        name: "Mayhem",
        kind: "keyword-ability",
        cr: "702.187",
        status: "planned",
    },
    // 702.188 Web-slinging
    {
        id: "web-slinging",
        name: "Web-slinging",
        kind: "keyword-ability",
        cr: "702.188",
        status: "planned",
    },
    // — (obsolete; see CR glossary "Unblockable (Obsolete)") Unblockable
    {
        id: "unblockable",
        name: "Unblockable",
        kind: "keyword-ability",
        cr: '— (obsolete; see CR glossary "Unblockable (Obsolete)")',
        status: "implemented",
        binding: "unblockable",
        note: 'combatRegistry.ts EvasionRule (global — no blocker qualifies). CR removed "Unblockable" as a keyword ability in 2018 (errata\'d to plain "can\'t be blocked" text); kept here because legacy card text and this engine\'s own cards still use the literal string.',
    },
];

export const MECHANICS_REGISTRY: MechanicRow[] = [
    ...KEYWORD_ACTIONS,
    ...KEYWORD_ABILITIES,
];

/** Engine-internal `staticAbilities` markers that are NOT CR 701/702
 *  keywords — card-specific rules text modelled as a static string rather
 *  than reminder text for a named keyword (untap restrictions, the
 *  continuous-regeneration replacement). Kept separate from
 *  `MECHANICS_REGISTRY` so the CR census stays a faithful census, but still
 *  consulted by the name-authority guard (`isNamedMechanic`) since these are
 *  legitimate, intentional strings — not typos or invented names. */
export interface EngineInternalMarker {
    id: string;
    /** Literal `staticAbilities` string, or a pattern for a parametrized one. */
    binding?: string;
    bindingPattern?: RegExp;
    note: string;
}

export const ENGINE_INTERNAL_MARKERS: EngineInternalMarker[] = [
    {
        id: "auto-regenerate",
        binding: "auto-regenerate",
        note: 'Continuous "if this would be destroyed, regenerate it" replacement (CR 614.5, ties to CR 701.19 Regenerate) — state.ts regenerateOrDestroy. Not itself a named CR keyword.',
    },
    {
        id: "does-not-untap",
        binding: "does-not-untap",
        note: 'Per-permanent "doesn\'t untap during your untap step" rules text (Basalt Monolith, Mana Vault) — phases.ts untap step. Not a named CR keyword.',
    },
    {
        id: "may-choose-not-to-untap",
        binding: "may-choose-not-to-untap",
        note: 'Per-permanent "you may choose not to untap this" rules text — phases.ts untap step. Not a named CR keyword.',
    },
    {
        id: "does-not-untap-with-depletion-counter",
        binding: "does-not-untap-with-depletion-counter",
        note: 'Ice Age depletion-counter lands ("doesn\'t untap unless you remove a depletion counter") — phases.ts untap step, types.ts. Not a named CR keyword.',
    },
];

// --- Effect Script Op census (ADR 0045) ---

/** One row of the Effect Script Op vocabulary (ADR 0045). The Mechanics
 *  Registry is the single authority on Op names: `validateEffectScript`
 *  (`convex/gre/effects/validate.ts`) rejects any script whose `op` is not
 *  listed here, and the interpreter-coverage guard test fails CI when this
 *  table and the interpreter's executor table drift apart — a row without an
 *  executor (or vice versa) is a registry bug. */
export interface EffectOpRow {
    /** Op name exactly as written in `effects[]` (camelCase verb). */
    op: string;
    /** CR section for the verb (2025-09-19 numbering). Game actions that are
     *  not CR 701 keyword actions (damage, draw, life change) cite their own
     *  rules section. */
    cr: string;
    /** The SpellContext primitive the interpreter calls — Ops are a thin
     *  declarative skin over the existing primitives, never a parallel
     *  engine (ADR 0045 "one execution path"). */
    binding: string;
    /** When the Op implements a CR 701 keyword action, the census row id in
     *  `MECHANICS_REGISTRY` it binds (e.g. "destroy"). Undefined for plain
     *  game actions with no keyword. */
    mechanicId?: string;
    note?: string;
}

/** Starter Op vocabulary (issue #800 — flat-sequence core). Grows freely,
 *  one orthogonal verb at a time; the structural grammar around it is frozen
 *  (ADR 0045). Keep each Op a general zone/mana/life/damage operation — a
 *  card-shaped verb fails the orthogonality test and belongs in `resolve()`. */
export const EFFECT_OP_REGISTRY: EffectOpRow[] = [
    {
        op: "dealDamage",
        cr: "120.1",
        binding: "SpellContext.dealDamage",
    },
    {
        op: "draw",
        cr: "121.1",
        binding: "SpellContext.drawCards",
    },
    {
        op: "gainLife",
        cr: "119.3a",
        binding: "SpellContext.gainLife",
    },
    {
        op: "loseLife",
        cr: "119.3b",
        binding: "SpellContext.loseLife",
    },
    {
        op: "destroy",
        cr: "701.8",
        binding: "SpellContext.destroy",
        mechanicId: "destroy",
        note: 'Effect Script Op for the CR 701 keyword action "Destroy" — routes through the regen/indestructible replacement layer like the "destroy-target" shorthand.',
    },
    {
        op: "exile",
        cr: "701.13",
        binding: "SpellContext.exile",
        mechanicId: "exile",
        note: "Effect Script Op for the CR 701 keyword action \"Exile\" — moves the target to its owner's exile zone (CR 406). Supports `bind` to snapshot the permanent's power/toughness/controller before it leaves (Swords to Plowshares reads the exiled creature's power, CR 608.2h).",
    },
    {
        op: "choice",
        cr: "608.2",
        binding: "SpellContext.requestChoice",
        note: "Mid-resolution player choice (CR 101.4 / 608.2, issue #805) mapped 1:1 onto the existing Pending Choice zone-pick kinds (EffectChoiceKind ⊂ ZonePickKind) — same enqueue, same generic prompt UI, same submitResolutionChoice mutation. The interpreter SUSPENDS the script at this Op (resolutionStep checkpoints the Op index) and resumes here when the picks are submitted; its required `bind` names the picks for later Ops.",
    },
    {
        op: "discard",
        cr: "701.9",
        binding: "SpellContext.discardCard",
        mechanicId: "discard",
        note: 'Effect Script Op for the CR 701 keyword action "Discard" — discards the cards a `choice` Op picked (a bare picks ref, e.g. { ref: "$picked" }). Routes through discardCard so the Library of Leng replacement and CARD_DISCARDED triggers apply (issue #805).',
    },
    {
        op: "counter",
        cr: "701.5a",
        binding: "SpellContext.counter",
        mechanicId: "counter",
        note: 'Effect Script Op for the CR 701 keyword action "Counter" — removes the target spell from the stack into its owner\'s graveyard. The consequence half of the counter/punisher pattern ("Counter target spell unless its controller pays {N}", issue #806).',
    },
    {
        op: "mayPay",
        cr: "117.3a",
        binding: "SpellContext.requestMayPay",
        note: 'Optional "you may pay {cost}" decision (CR 117.3a / 118.4, issue #806) mapped 1:1 onto the existing `may-pay` Pending Choice pipeline — same enqueue, same generic Pay/Skip prompt UI, same submitMayPay mutation. The interpreter SUSPENDS the script at this Op and resumes here when the player answers; its required `bind` names a BOOLEAN binding (true = paid) read by a later `if` predicate. The counter/punisher primitive: "… unless its controller pays {2}".',
    },
    {
        op: "if",
        cr: "608.2c",
        binding: "interpreter branch selection (no primitive)",
        note: "The `if` structural construct (ADR 0045, issue #806) — NOT an Op verb but the third frozen construct, registered here so the Op-vocabulary coverage guard (registry ⇄ interpreter ⇄ validator ⇄ scenario-assertor, 1:1) counts it. Branches the script on a PREDEFINED predicate form (a boolean-binding test — e.g. a mayPay outcome — or a numeric comparison), never an arbitrary expression, so the validator and the bot can read the condition. then/else are Op lists; a suspending Op inside a branch suspends/resumes exactly as at the top level.",
    },
    {
        op: "sacrifice",
        cr: "701.16",
        binding: "SpellContext.sacrifice",
        mechanicId: "sacrifice",
        note: 'Effect Script Op for the CR 701 keyword action "Sacrifice" — sacrifices the permanents a `choice` Op picked (a bare picks ref, e.g. { ref: "$sac" }). Indestructible does not prevent sacrifice (CR 701.16a); dies-triggers fire as for imperative cards. Ships with the forEach construct (issue #807) for the "each player sacrifices …" pattern (Innocent Blood).',
    },
    {
        op: "forEach",
        cr: "608.2i",
        binding: "interpreter set iteration (no primitive)",
        note: "The `forEach` structural construct (ADR 0045, issue #807) — the FOURTH and final frozen construct, closing the grammar. NOT an Op verb; registered here so the Op-vocabulary coverage guard (registry ⇄ interpreter ⇄ validator ⇄ scenario-assertor, 1:1) counts it. Iterates the body over a declaratively-selected set (players in APNAP order CR 101.4, or battlefield permanents by controller/filter), determined ONCE at construct entry (CR 608.2i) and frozen. `$each` is bound per iteration; a `choice` Op inside the body suspends/resumes per iteration through the same Pending Choice pipeline as a top-level choice.",
    },
];

/** True if `name` is a registered Effect Script Op (ADR 0045). The single
 *  vocabulary authority consulted by `validateEffectScript`. */
export function isRegisteredEffectOp(name: string): boolean {
    return EFFECT_OP_REGISTRY.some((row) => row.op === name);
}

/** True if `value` (a literal `staticAbilities` string as declared on a
 *  CardDefinition or TokenSpec) resolves to a known mechanic — a CR 701/702
 *  census row (by plain lowercase name, exact `binding`, or
 *  `bindingPattern`) or an engine-internal marker. This is a NAME check, not
 *  an implementation check: a card may legally declare a `planned` keyword
 *  (e.g. "haste") — the registry's job is to reject invented names, not to
 *  gate on implementation status. The single authority the registry-wide
 *  guard test consults; see `__tests__/mechanicsRegistry.test.ts`. */
export function isNamedMechanic(value: string): boolean {
    const lower = value.toLowerCase();
    return (
        MECHANICS_REGISTRY.some(
            (row) =>
                lower === row.name.toLowerCase() ||
                row.binding === value ||
                row.bindingPattern?.test(value)
        ) ||
        ENGINE_INTERNAL_MARKERS.some(
            (m) => m.binding === value || m.bindingPattern?.test(value)
        )
    );
}
