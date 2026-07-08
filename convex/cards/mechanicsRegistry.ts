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
// CLAUDE.md "flag explicitly rather than assuming deferred"): `haste`
// (issue #730), `hexproof` (issue #958), and `shroud` were once pushed onto a
// permanent's `staticAbilities` by cards (granted dynamically, e.g. Instill
// Energy / Homarid Warrior) with no engine-side check consuming the string.
// `haste` and `hexproof` have since graduated to `implemented` (combat
// eligibility / CR 702.11b targeting legality respectively). `shroud` as a
// KEYWORD STRING is still unenforced (shroud ships as a `permanent-guard`
// staticEffect on the cards that need it, not via the keyword), so its row
// stays `status: "planned"` with a `note`, to keep the registry an honest
// source of truth.

import type { GameEvent } from "./types";

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
        status: "implemented",
        binding: "deathtouch",
        note: "markDeathtouchDamage at every damage sink + checkDeathtouchDestroySBA (sba.ts)",
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
        status: "implemented",
        binding: "haste",
        note: 'HONOURED (issue #730): `validateAttackerEligibility` (combat.ts) bypasses the `isSummoningSick` attack restriction when `staticAbilities` includes "haste" — both natively-declared haste and haste granted for a duration (`grantAbility` appends to `staticAbilities`; Ray of Command / Magus of the Unseen grant it to a freshly-stolen permanent). `haste` is also an AI-eval heuristic weight (evaluate.ts). Not yet wired for the "can activate {T} abilities the turn it enters" clause of CR 702.10c — attack-eligibility only.',
    },
    // 702.11 Hexproof
    {
        id: "hexproof",
        name: "Hexproof",
        kind: "keyword-ability",
        cr: "702.11",
        status: "implemented",
        binding: "hexproof",
        note: "HONOURED (issue #958): CR 702.11b — permanentGuard.ts bridges the `hexproof` staticAbilities string to the shroud `cantBeTargeted` targeting-legality path, narrowed to opponent-controlled sources (the source's controllerId ≠ the permanent's controllerId). Gated in rules.ts getLegalTargets and game.ts selectTarget (server-authoritative) and mirrored client-side in src/lib/targeting.ts so an opponent's targeted spell greys the permanent while the controller's own can still target it. Reads the instance's effective (materialized) staticAbilities, so a dynamically-granted hexproof is honoured like a printed one.",
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
        status: "implemented",
        binding: "lifelink",
        note: "CR 702.15b — damage dealt by a lifelink source gains its controller that much life, simultaneously with the damage (CR 119.3). Wired at every damage sink via applyLifelinkLifeGain (state.ts): combat (phases.ts applyOneCombatDamage — player + permanent), permanent-source non-combat (dealDamageFromPermanentToPlayer, markDamageFromPermanentSource), and stack-item damage (SpellContext.dealDamage). Reads the source's effective (layer-6-materialized) staticAbilities. Life gain flows through gainLifeEmitting, emitting LIFE_GAINED.",
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
export type EffectOpStatus = "implemented" | "planned";

export interface EffectOpRow {
    /** Op name exactly as written in `effects[]` (camelCase verb). */
    op: string;
    /** "implemented" — the Op is live in the interpreter/validator/scenario
     *  vocabulary and usable by cards (all `EFFECT_OP_REGISTRY` rows).
     *  "planned" — a demand-driven backlog reservation with no interpreter
     *  binding yet; it lives in `EFFECT_OP_BACKLOG`, NOT in the usable
     *  vocabulary. `isRegisteredEffectOp` (and therefore `validateEffectScript`)
     *  never accepts a `planned` Op, so a card cannot reference one — it is a
     *  machine-visible IOU, the demand-driven analogue of the CR-total
     *  keyword census (PRD #826, ADR 0046). */
    status: EffectOpStatus;
    /** CR section for the verb (2025-09-19 numbering). Game actions that are
     *  not CR 701 keyword actions (damage, draw, life change) cite their own
     *  rules section. */
    cr: string;
    /** The SpellContext primitive the interpreter calls — Ops are a thin
     *  declarative skin over the existing primitives, never a parallel
     *  engine (ADR 0045 "one execution path"). Required for `implemented`
     *  rows (enforced by the registry↔interpreter coverage guard); omitted on
     *  `planned` backlog rows, which have no interpreter binding yet. */
    binding?: string;
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
        status: "implemented",
        cr: "120.1",
        binding: "SpellContext.dealDamage",
    },
    {
        op: "draw",
        status: "implemented",
        cr: "121.1",
        binding: "SpellContext.drawCards",
    },
    {
        op: "gainLife",
        status: "implemented",
        cr: "119.3a",
        binding: "SpellContext.gainLife",
    },
    {
        op: "loseLife",
        status: "implemented",
        cr: "119.3b",
        binding: "SpellContext.loseLife",
    },
    {
        op: "destroy",
        status: "implemented",
        cr: "701.8",
        binding: "SpellContext.destroy",
        mechanicId: "destroy",
        note: 'Effect Script Op for the CR 701 keyword action "Destroy" — routes through the regen/indestructible replacement layer like the "destroy-target" shorthand.',
    },
    {
        op: "exile",
        status: "implemented",
        cr: "701.13",
        binding: "SpellContext.exile",
        mechanicId: "exile",
        note: "Effect Script Op for the CR 701 keyword action \"Exile\" — moves the target to its owner's exile zone (CR 406). Supports `bind` to snapshot the permanent's power/toughness/controller before it leaves (Swords to Plowshares reads the exiled creature's power, CR 608.2h).",
    },
    {
        op: "choice",
        status: "implemented",
        cr: "608.2",
        binding: "SpellContext.requestChoice",
        note: 'Mid-resolution player choice (CR 101.4 / 608.2, issue #805) mapped 1:1 onto the existing Pending Choice zone-pick kinds (EffectChoiceKind ⊂ ZonePickKind) — same enqueue, same generic prompt UI, same submitResolutionChoice mutation. The interpreter SUSPENDS the script at this Op (resolutionStep checkpoints the Op index) and resumes here when the picks are submitted; its required `bind` names the picks for later Ops. Optional `zoneOwnerId` (issue #920, #682) names the zone owner when it differs from the chooser (`player`) — a direct passthrough of the `zoneOwnerId` parameter `SpellContext.requestChoice` already accepted (Leshrac\'s Sigil, Demonic Hordes); unblocks the Thoughtseize/Duress/Inquisition-of-Kozilek "target player reveals their hand, you choose a card from it" template.',
    },
    {
        op: "discard",
        status: "implemented",
        cr: "701.9",
        binding: "SpellContext.discardCard",
        mechanicId: "discard",
        note: 'Effect Script Op for the CR 701 keyword action "Discard" — discards the cards a `choice` Op picked (a bare picks ref, e.g. { ref: "$picked" }). Routes through discardCard so the Library of Leng replacement and CARD_DISCARDED triggers apply (issue #805).',
    },
    {
        op: "counter",
        status: "implemented",
        cr: "701.5a",
        binding: "SpellContext.counter",
        mechanicId: "counter",
        note: 'Effect Script Op for the CR 701 keyword action "Counter" — removes the target spell from the stack into its owner\'s graveyard by default. The consequence half of the counter/punisher pattern ("Counter target spell unless its controller pays {N}", issue #806). An optional `destination` (issue #683) redirects a COUNTERED SPELL to exile / the top of its owner\'s library / its owner\'s hand instead — "if that spell is countered this way, exile it / put it on top of its owner\'s library / put it into its owner\'s hand instead" (No More Lies, Memory Lapse, Remand).',
    },
    {
        op: "mayPay",
        status: "implemented",
        cr: "117.3a",
        binding: "SpellContext.requestMayPay",
        note: 'Optional "you may pay {cost}" decision (CR 117.3a / 118.4, issue #806) mapped 1:1 onto the existing `may-pay` Pending Choice pipeline — same enqueue, same generic Pay/Skip prompt UI, same submitMayPay mutation. The interpreter SUSPENDS the script at this Op and resumes here when the player answers; its required `bind` names a BOOLEAN binding (true = paid) read by a later `if` predicate. The counter/punisher primitive: "… unless its controller pays {2}".',
    },
    {
        op: "if",
        status: "implemented",
        cr: "608.2c",
        binding: "interpreter branch selection (no primitive)",
        note: "The `if` structural construct (ADR 0045, issue #806) — NOT an Op verb but the third frozen construct, registered here so the Op-vocabulary coverage guard (registry ⇄ interpreter ⇄ validator ⇄ scenario-assertor, 1:1) counts it. Branches the script on a PREDEFINED predicate form (a boolean-binding test — e.g. a mayPay outcome — or a numeric comparison), never an arbitrary expression, so the validator and the bot can read the condition. then/else are Op lists; a suspending Op inside a branch suspends/resumes exactly as at the top level.",
    },
    {
        op: "sacrifice",
        status: "implemented",
        cr: "701.16",
        binding: "SpellContext.sacrifice",
        mechanicId: "sacrifice",
        note: 'Effect Script Op for the CR 701 keyword action "Sacrifice" — sacrifices either the permanents a `choice` Op picked (a bare picks ref `permanents`, e.g. { ref: "$sac" }, the "each player sacrifices …" forEach pattern, Innocent Blood, issue #807) OR a single announced target / snapshot-bound permanent (`target`, e.g. { ref: "$guard" } — "sacrifice that/this creature", Kjeldoran Elite Guard / Phantasmal Mount, issue #731; resolved through the object-ref path with a CR 608.2b battlefield re-check). Exactly one form per Op. Indestructible does not prevent sacrifice (CR 701.16a); dies-triggers fire as for imperative cards.',
    },
    {
        op: "forEach",
        status: "implemented",
        cr: "608.2i",
        binding: "interpreter set iteration (no primitive)",
        note: "The `forEach` structural construct (ADR 0045, issue #807) — the FOURTH and final frozen construct, closing the grammar. NOT an Op verb; registered here so the Op-vocabulary coverage guard (registry ⇄ interpreter ⇄ validator ⇄ scenario-assertor, 1:1) counts it. Iterates the body over a declaratively-selected set (players in APNAP order CR 101.4, or battlefield permanents by controller/filter), determined ONCE at construct entry (CR 608.2i) and frozen. `$each` is bound per iteration; a `choice` Op inside the body suspends/resumes per iteration through the same Pending Choice pipeline as a top-level choice.",
    },
    {
        op: "moveZone",
        status: "implemented",
        cr: "400.7",
        binding:
            "SpellContext.moveCardById / returnToHand / returnToBattlefield / putFromLibraryOntoBattlefield / putFromHandOntoBattlefield / tap",
        note: 'General zone movement (CR 400.7, issue #839). A thin declarative skin over three SpellContext primitives, one execution path (ADR 0045): the object\'s CURRENT zone is inferred from its kind (a permanent → returnToHand from the battlefield; a graveyard-card → returnToBattlefield when `to` is the battlefield, else moveCardById from the graveyard). `target` is an announced slot (Unsummon, Raise Dead, Resurrection) or a bare `$source` snapshot (self-bounce — Blinking Spirit); `to` is the destination zone; there is no `from` (it is inferred). Subsumes the returnToHand / moveCardById / returnToBattlefield closures the migration classifier folds here (~35 blocked closures at ship time). SECOND SHAPE (issue #677): `cards` (a bare choice-picks ref) + `player` — the SEARCH half of a tutor/fetch effect. A library card has no announced-target form (CR 601.2b — hidden zone), so a `choice(zone:"library", kind:"search-library")` Op\'s picks are consumed here instead of via `target`: `to: "hand"`/`"graveyard"`/`"exile"` routes through `moveCardById(player, id, "library", to)` (Vampiric Tutor, Entomb), `to: "battlefield"` routes through `putFromLibraryOntoBattlefield` (a fetchland\'s "put it onto the battlefield", Natural Order). Pair with a trailing `libraryLook`(shuffle) Op, as every tutor/fetch oracle text does.',
    },
    {
        op: "delayedTrigger",
        status: "implemented",
        cr: "603.7",
        binding: "SpellContext.scheduleDelayedTrigger",
        note: 'Grants a delayed triggered ability (CR 603.7, ADR 0048, issue #838): "At the beginning of the next <boundary>, <do something>". The delayed body is an INLINE nested Effect Script persisted on the DelayedTriggerInstance (self-contained in game state — no card-def lookup at fire time); everything the body needs from scheduling time crosses via the explicit `capture` map, resolved to serializable ids at scheduling and re-bound as the body\'s initial binding environment when the trigger fires. The two grammar gaps ADR 0048 deferred have since closed (ADR 0049): event-field captures ($event.<field> — Battering Ram, Nafs Asp, issue #865) and LIST-valued captures ({ select: EffectListSelector } re-bound as a `string[]` list binding a `forEach { set: "bound" }` iterates — Venomous Breath, issue #866, freeze-at-cast per CR 509.1h). Beyond the phase-boundary timings, an INSTANCE leave-watch timing (`leaves-battlefield` + a `watch` object ref, CR 603.7a / 603.10, issue #731) fires on the watched permanent\'s PERMANENT_LEFT ("when THAT creature leaves the battlefield this turn, …" — Kjeldoran Elite Guard, Kjeldoran Guard, Phantasmal Mount); a pending watch expires unfired at CLEANUP (the "this turn" bound, CR 514.2). A REPEATING combat-event timing (`this-turn-creature-blocks`, CR 603.7d / 603.10, issue #884) fires once per BLOCKERS_CONFIRMED event for the rest of the turn ("Whenever a creature blocks this turn, …" — Battle Cry) instead of once total: unlike every other timing it is never dequeued by firing (only purged at CLEANUP, regardless of fire count), and — because the firing event is genuinely live at fire time — its body may read `$event.blockerId` directly with no `capture` map at all (validate.ts scopes `$event` legality to this one timing\'s body).',
    },
    {
        op: "pump",
        status: "implemented",
        cr: "613.4c",
        binding: "SpellContext.addTemporaryPTBuff",
        note: 'Temporary P/T boost until a phase boundary (layer 7c, CR 613.4c, issue #840). A thin declarative skin over SpellContext.addTemporaryPTBuff, one execution path (ADR 0045). `target` is an announced slot (Giant Growth), the resolving source (`$source` — a self-pump activated ability, "~ gets +1/+0 until end of turn"), or a forEach `$each` (a mass pump); `power`/`toughness` are SIGNED values (a negative is a shrink — Weakness; a zero is a one-sided pump); `duration` is the expiry phase boundary (CR 514.2 / 511.3). The source-tapped variant (addSourceTappedPTBuff — Ashnod\'s Battle Gear, "for as long as this remains tapped") uses a state-tied duration outside the DurationSpec grammar and stays resolve() by design. Subsumes the addTemporaryPTBuff closures the migration classifier folds here (~99 blocked closures at ship time).',
    },
    {
        op: "counters",
        status: "implemented",
        cr: "122.1",
        binding: "SpellContext.addCounter / removeCounter",
        note: 'Add or remove counters on a permanent (CR 122, issue #841). A thin declarative skin over two SpellContext primitives, one execution path (ADR 0045): `action: "add"` → addCounter (Sengir Vampire\'s +1/+1 on kill, a charge-counter accrual), `action: "remove"` → removeCounter (a counter-shedding effect, clamped to the counters present). `counter` is the free-form counter type ("+1/+1", "+1/+0", "-1/-1", "charge", "corpse", …; P/T-modifying types read at stat-lookup time by layer 7d). `target` is an announced slot, the resolving source (`$source` — a permanent counter-ing itself), or a forEach `$each` (a mass counter placement); `count` is the number of counters (literal / ref / count). Subsumes the addCounter / removeCounter closures the migration classifier folds here (~80 blocked closures at ship time).',
    },
    {
        op: "tapUntap",
        status: "implemented",
        cr: "701.26",
        mechanicId: "tap-and-untap",
        binding: "SpellContext.tap / untap",
        note: 'Tap or untap a permanent (CR 701.26, issue #842). A thin declarative skin over two SpellContext primitives, one execution path (ADR 0045): `action: "tap"` → tap (Icy Manipulator\'s "tap target artifact, creature, or land"), `action: "untap"` → untap (Twiddle\'s untap mode). `target` is an announced slot, the resolving source (`$source` — a permanent tapping itself), or a forEach `$each` (a mass tap). No amount — a permanent is tapped or it isn\'t; the primitives no-op when the permanent is already in the requested state (CR 701.26a/b) and are skipped when it has left the battlefield (CR 608.2b). Subsumes the tap / untap closures the migration classifier folds here (~68 blocked closures at ship time). `tapAllLands` (Mana Short, Drain Power — a whole-player tap, not a permanent target) stays resolve() by design; it is not a `tap`-on-a-selected-permanent skin.',
    },
    {
        op: "grantAbility",
        status: "implemented",
        cr: "613.1f",
        binding: "SpellContext.grantStaticAbility",
        note: 'Grant a keyword static ability to a permanent for a limited duration (layer 6, CR 611.1b / 613.1f, issue #843). A thin declarative skin over one SpellContext primitive, one execution path (ADR 0045): `ability` is the free-form keyword granted ("flying", "trample", "haste", "banding", …; read at combat / rules-check time), `target` is an announced slot, the resolving source (`$source` — a permanent granting itself), or a forEach `$each` (a mass grant), and `duration` is the phase boundary at which the grant expires (CR 611.2 — the phase-boundary purge splices the keyword back out). The primitive appends to `staticAbilities` and is skipped when the permanent has left the battlefield (CR 608.2b). Subsumes the grantStaticAbility closures the migration classifier folds here (~52 blocked closures at ship time). Ability REMOVAL / loss (`removeStaticAbilities`) takes a predicate closure — not JSON-expressible — and stays resolve() by design; the permanent-grant variant (`grantStaticAbilityPermanent`, no duration, Cocoon-style Aura hatch) is not folded here.',
    },
    {
        op: "libraryLook",
        status: "implemented",
        cr: "701.20",
        binding: "SpellContext.shuffleLibrary",
        note: 'Shuffle a player\'s library (CR 701.20, issue #844). A thin declarative skin over the SpellContext primitive `shuffleLibrary`, one execution path (ADR 0045): `action: "shuffle"` → shuffleLibrary (the seeded PRNG reorder that also clears every card\'s persistent knowledge, ADR 0026 — the "then shuffle" tail of a tutor, Winds of Change / Timetwister-style whole-deck randomization). `player` names whose library: the resolving controller (`"controller"`), an announced target-slot player (`{ target: N }`), or a forEach `$each` (a per-player shuffle). SCOPE (issue #844): only the `shuffle` primitive is folded — it is the one CR 401 / 701.20 library primitive expressible as a pure declarative Op (no runtime value read back into the effect). The classifier proposed folding `peekLibraryTop` / `reorderLibraryTop` too, but every closure that calls them either reads an opaque `choice` result back into `reorderLibraryTop` (Ponder, Preordain, Portent, Drafna\'s Restoration — a reorder-FROM-choice the DSL can\'t yet express) or drives a mill loop off the live top id (Millstone, Thought Scour, Ray of Erasure, Deep Spawn — needs a `mill` Op). Those two primitives stay a `planned` backlog Op (`scryReorder`) until a choice-driven reorder / mill construct exists. See `scripts/migration-classifier.mjs` OP_SEQUENCE.',
    },
    {
        op: "preventDamage",
        status: "implemented",
        cr: "615.1",
        binding:
            "SpellContext.preventNextNDamageToTarget / preventAllCombatDamage / preventAllCombatDamageToAndBy",
        note: 'Establish a damage-prevention shield (CR 615, issue #845). A thin declarative skin over three SpellContext prevention primitives, one execution path per `mode` (ADR 0045): `"next-n"` → preventNextNDamageToTarget (a shield on `to` — a permanent, `$source`, a forEach `$each`, or a relative player via `{ player: … }` — absorbing up to `amount` total damage from any source until `duration`, CR 615.1/615.6: Samite Healer, Amulet of Kroog, Conservator, Warding Shard); `"all-combat"` → preventAllCombatDamage (turn-scoped global Fog, cleared at CLEANUP, no target/duration: Fog, Tangle Wire-style combat wipes); `"combat-to-and-by"` → preventAllCombatDamageToAndBy (a per-instance two-way shield preventing all combat damage dealt TO and BY `target` until `duration`, CR 615: Maze of Ith, Ebony Horse, Foxfire). Subsumes the prevention closures the migration classifier folds here (~34 blocked closures at ship time). Source-matched / half-down player shields (`addPlayerDamagePreventionShield`, Dark Sphere / Scarecrow), damage REDIRECTIONS (`addDamageRedirectionShield`, Reverse Damage / Eye for an Eye — a replacement, not a prevention), and `markAssignsNoCombatDamage` (source-only, Farrel\'s Mantle) are distinct primitives NOT folded here.',
    },
    {
        op: "regenerate",
        status: "implemented",
        cr: "701.19",
        mechanicId: "regenerate",
        binding: "SpellContext.applyRegenerationShield",
        note: 'Stack a regeneration shield on a permanent (CR 701.15 / 701.19, issue #846). A thin declarative skin over the single SpellContext primitive `applyRegenerationShield`, one execution path (ADR 0045): `target` names the permanent to shield — an announced target slot (`{ target: N }` — Death Ward / Niall Silvain / Horror of Horrors "Regenerate target creature"), the resolving source (`$source` — a self-regenerate activated ability: Drudge Skeletons, Sedge Troll, Clay Statue, Zombie Master-granted regen), or a forEach `$each` (a regenerate-each rider). One shield per Op; it is consumed by the next destroy event on that permanent this turn (the shield replaces the destroy with "remove all marked damage, tap, remove from combat", CR 614.5 / 701.15a) and expires unused at CLEANUP (CR 514.2). No amount / duration — a permanent has a shield or it doesn\'t; multiple shields stack via repeated resolutions. The primitive no-ops on a non-permanent selection and off the battlefield (CR 608.2b — the Op is skipped when `resolveObjectRef` returns undefined). Subsumes the applyRegenerationShield closures the migration classifier folds here (~30 blocked closures at ship time). The continuous "if this would be destroyed, regenerate it" REPLACEMENT (`auto-regenerate`, state.ts regenerateOrDestroy — a static shield-granting effect, not a one-shot) is a distinct mechanic NOT folded here.',
    },
    {
        op: "createToken",
        status: "implemented",
        cr: "701.7",
        mechanicId: "create",
        binding: "SpellContext.createToken",
        note: "Create token permanents (CR 111 / 701.7 keyword action \"Create\", issue #847). A thin declarative skin over the single SpellContext primitive `createToken`, one execution path (ADR 0045): `token` is the JSON-pure token spec (EffectTokenSpec — name + card types required; subtypes, supertypes, P/T, colors, keyword static abilities and token art optional), `controller` names who gets the tokens (the resolving controller — The Hive's Wasp, Master of the Hunt's Wolves, the Saproling / Thrull / Goblin token engines; an announced target-slot player; or a forEach `$each` for a per-player creation), and `count` is an optional EffectValue (default 1; a literal / ref / count for a count-scaled creation, e.g. Goblin Warrens' three Goblins). A non-positive count creates nothing (CR 707.1). SCOPE (issue #847): only the plain spec-driven `createToken` primitive is folded — the JSON-pure spec that carries no closure. `createTokenCopyOf` (create a token that's a COPY of a target creature — Dance of Many) reads a runtime source creature and drives the copy machinery, so it is NOT a pure declarative skin; it stays a `planned` backlog Op (`createTokenCopy` below). A token needing continuous `staticEffects` (Tetravite's \"can't be enchanted\", a predicate closure) is likewise not JSON-expressible — `EffectTokenSpec` omits `staticEffects`, so such a token stays resolve(). No `createdBy` provenance is stamped — provenance-linked token engines (Tetravus, Tawnos's Wand) are multi-Op choice-scoped cards that stay resolve() this wave.",
    },
    {
        op: "gainControl",
        status: "implemented",
        cr: "613.1b",
        mechanicId: "control-change",
        binding: "SpellContext.gainControl",
        note: 'Change control of a permanent (CR 613.1b layer-2 control change, issue #848). A thin declarative skin over the single SpellContext primitive `gainControl`, one execution path (ADR 0045): `target` names the permanent whose control changes — an announced target slot (`{ target: N }` — Aladdin / Old Man of the Sea / Thrull Champion / Infernal Denizen\'s activated "gain control of target …"), the resolving source (`$source`), or a forEach `$each`. `controller` names who gains control (the resolving controller / an announced target-slot player / a relative player). `duration` is the JSON-pure GainControlDuration discriminator, mapped 1:1 onto ControlChangeCondition (CR 611.2b): omitted = an INDEFINITE reassignment (no condition, the Ghazbán Ogre shape — never reverts on its own); `while-you-control-source` → controller-controls-source (Aladdin, Thrull Champion); `while-source-tapped` → source-tapped (Preacher, Seasinger); `while-source-tapped-and-power-ge` → source-tapped-and-power-ge (Old Man of the Sea). The conditional durations install the conditional-control SBA that reverts the change when the condition lapses. Skipped when the target is gone / not a permanent or the controller cannot be resolved (CR 608.2b). SCOPE (issue #848): only the durations ControlChangeCondition supports are expressible. An "until end of turn" control change (Ray of Command / Magus of the Unseen) has NO ControlChangeCondition variant AND additionally wants an EOT tap rider, so it stays resolve() (a distinct capability, issue #730). The "and destroy on untap/leave" rider (Merieke Ri Berit) and runtime-computed recipients / parity guards (Ghazbán Ogre, Chaos Lord) also stay resolve() — see per-card NOT-migratable notes.',
    },
    {
        op: "optionChoice",
        status: "implemented",
        cr: "700.2",
        binding: "SpellContext.requestOptionChoice",
        note: 'Modal "choose one" effect (CR 700.2 / 601.2b, issue #849). A thin declarative skin over the single SpellContext primitive `requestOptionChoice`, one execution path (ADR 0045): `modes` is a non-empty ordered list of `{ label, effects }` — each mode a labelled nested `EffectOp[]` (the bullet clauses of a "Choose one —" spell). The chooser picks exactly one mode; the interpreter runs that mode\'s `effects` through the SAME `runOpList` path an `if` branch uses, so a mode body composes bind / ref / if / forEach and even a further suspending Op (a nested `choice` / `mayPay`). `player` (optional) names the chooser — the resolving `"controller"` by default (the caster of a modal spell chooses its mode, CR 601.2b); an announced target-slot / relative player otherwise. `prompt` is the choice header. Like `if` / `forEach` it is a structural construct that always re-descends on a re-walk (in the interpreter\'s runOpList skip-exception), so a suspension inside the chosen mode resumes correctly (CR 608.3). A SINGLE-mode Op auto-resolves — runs the one mode with no prompt (no real choice, Arena-style). Skipped when the chooser is gone (CR 608.2b). SCOPE (issue #849): the "choose one" form only. "Choose one or more" / "choose two" / "choose one. You may choose the same mode…" (Fork-style repetition, entwine, escalate) are distinct cardinality grammars a later Op adds on demand.',
    },
    {
        op: "addMana",
        status: "implemented",
        cr: "106.1",
        binding: "SpellContext.addManaTo / addMana",
        note: 'Add mana to a player\'s mana pool (CR 106.1, issue #850). A thin declarative skin over the SpellContext mana-add primitives `addManaTo` / `addMana` (the self-caster form `addMana(cost)` is `addManaTo(controllerId, cost)`), one execution path (ADR 0045): `mana` is the JSON-pure per-colour amount map (EffectManaPool — fixed WUBRGC pips, positive integers), passed straight through as a CardManaCost (the primitive ignores the X/generic slots and non-positive amounts, CR 106.1). `player` names whose pool receives it — the resolving `"controller"` by default (a ritual adds to its caster\'s pool, CR 106.4: Dark Ritual "Add {B}{B}{B}"); an announced target-slot / relative player otherwise. Skipped when the player cannot be resolved (CR 608.2b). SCOPE (issue #850): fixed produced mana only. "Add one mana of any colour" (a runtime colour choice) and restriction-riders ("spend only on …", addRestrictedMana) are NOT folded — the former is not a static amount, the latter has no free card demanding it this wave; both stay resolve() until a card needs them. Most `addMana` call sites are activated MANA abilities (`effect:`, useStack:false — Black Lotus, Llanowar Elves), which the migration classifier does not count; the folded closures are the one-shot mana rituals.',
    },
    {
        op: "coinFlip",
        status: "implemented",
        cr: "705.2",
        binding: "SpellContext.requestCoinFlip",
        note: "Flip a coin, then run the win / loss branch (CR 705, issue #851). A thin declarative skin over the single SpellContext primitive `requestCoinFlip` (the suspending reveal flip, ADR 0023), one execution path (ADR 0045): the bit is drawn ONCE from the seeded PRNG, PAUSES resolution to animate the coin landing (WIN/LOSE reveal overlay), and on resume the persisted outcome short-circuits the re-run (no re-roll, CR 608.3). `win` / `loss` are each `{ consequence, effects }` — a labelled nested `EffectOp[]` run through the SAME `runOpList` path an `if` branch / optionChoice mode uses, so a branch composes bind / ref / if / forEach and even a further suspending Op (Goblin Kites' delayed-body sacrifice-on-loss, Orcish Captain's +2/+0-or--0/-2 buff, Bottle of Suleiman's create-token-or-take-5, Goblin Lyre's creature-count damage). `player` (optional) names the flipping player — the resolving `\"controller\"` by default (CR 705.1); an announced target-slot / relative player otherwise. Like `if` / `optionChoice` it is a structural construct that always re-descends on a re-walk (in the interpreter's runOpList skip-exception), so a suspension inside the taken branch resumes correctly. Skipped when the flipper is gone (CR 608.2b). SCOPE (issue #851): the suspending reveal flip only. The synchronous non-suspending `flipCoin` loop cards — repeat-until-lose / doubling-stake stakes (Goblin Artisans, Mana Clash, Game of Chaos) — are NOT folded: they need an unbounded loop + arithmetic value the frozen grammar does not carry, so they stay resolve() until demanded. Note Mijae Djinn / Ydwen Efreet use THIS same `requestCoinFlip` primitive (not a separate synchronous flip) yet remain resolve() for an unrelated reason — they are blocked on combat-manipulation Ops (removeFromCombat / unblock), not on the coin flip.",
    },
    {
        op: "reveal",
        status: "implemented",
        cr: "701.20",
        mechanicId: "reveal",
        binding: "SpellContext.markKnownToAll",
        note: 'Reveal to every player (CR 701.20a, issue #920 / #682 — promoted from the `planned` backlog; issue #945 — extended to a searched-and-found card). A thin declarative skin over the single SpellContext primitive `markKnownToAll` (ADR 0026), one execution path (ADR 0045): the named card(s) are stamped with every player in `knownTo`, so the wire projection (`convex/gameProjections.ts`) shows the real card instead of nulling the slot. TWO mutually-exclusive shapes: (a) `zone: "hand"` — reveal `player`\'s WHOLE hand (Thoughtseize / Duress / Inquisition of Kozilek / Grief\'s "target player reveals their hand"), no-op on an empty hand (CR 608.2b); (b) `cards: <bare picks ref>` (issue #945) — reveal the SPECIFIC card(s) a preceding search-library `choice` bound, the tutor "search …, reveal it, put it into your hand, then shuffle" clause (Spellseeker, Stoneforge Mystic, Brightglass Gearhulk, Expedition Map). `markKnownToAll` already accepts arbitrary instance ids and scans library+hand, so the reveal is placed BEFORE the moveZone/shuffle: the picked card is stamped while still in the library, keeps its all-players knowledge through the move into hand, and survives the trailing shuffle (which only clears knowledge of cards still in the library, CR 701.20). No-op when the choice found nothing (CR 608.2b). SCOPE: only the ALL-PLAYERS reveal is folded. A private "look" (ONE knower, e.g. Word of Command\'s "look at target opponent\'s hand") is a DIFFERENT, narrower primitive (`SpellContext.markKnown`) and stays resolve() — Word of Command\'s control-transfer protocol has other reasons to stay resolve() regardless (ADR 0037). A library-top reveal (Caustic Bronco-class, positional order matters) is also NOT folded — left for a future Op.',
    },
];

/** Demand-driven Op backlog (PRD #826, playbook #809). Every row is a
 *  `planned` reservation: an Op the resolve()→effects[] migration classifier
 *  (`scripts/migration-classifier.mjs`) has demonstrated is blocking real
 *  cards, but which has no interpreter binding yet. This is the machine-visible
 *  IOU list — the demand-driven analogue of the CR-total keyword census in
 *  `MECHANICS_REGISTRY` (Ops are engine primitives with no enumerable CR list,
 *  so the backlog is populated from measured demand, never speculatively).
 *
 *  These rows are deliberately kept OUT of `EFFECT_OP_REGISTRY` so:
 *    - `isRegisteredEffectOp` never accepts a planned Op — a card cannot
 *      reference one, and `validateEffectScript` rejects it (a planned Op is a
 *      reservation, not usable vocabulary);
 *    - the registry↔interpreter↔validator↔scenario coverage guards, which
 *      require a live executor/schema/assertor for every `EFFECT_OP_REGISTRY`
 *      row, are not tripped by an unbuilt stub.
 *
 *  When an Op ships, its row moves here → `EFFECT_OP_REGISTRY` with
 *  `status: "implemented"` and a real `binding` (see the migration playbook's
 *  architecture-then-frequency Op sequence). The `note` records the
 *  SpellContext primitive(s) the classifier folds into the Op, so the demand
 *  link stays legible.
 *
 *  Wave-1 Op sequence (architecture-setting first, then by blocked-closure
 *  frequency; counts are the classifier's measured demand at #826 authoring
 *  time and drift as Ops ship). `X` is intentionally absent — it is a fifth
 *  `EffectValue` grammar member (the chosen-cost value, `{ X: true }`, a thin
 *  skin over SpellContext.getX()), not an Op. It SHIPPED in issue #852 as a
 *  value-grammar member (EffectValue = literal | ref | count | X); adding it did
 *  NOT reopen ADR 0045 (only a fifth STRUCTURAL construct would) and it earns no
 *  EFFECT_OP_REGISTRY row (PRD #826). */
export const EFFECT_OP_BACKLOG: EffectOpRow[] = [
    // --- Architecture-setting foundations (implemented before the skins) ---
    // delayedTrigger SHIPPED (issue #838, ADR 0048) and moveZone SHIPPED
    // (issue #839) — both moved to EFFECT_OP_REGISTRY above.
    // --- High-frequency skins (by blocked-closure count) ---
    // pump SHIPPED (issue #840) — addTemporaryPTBuff is now COVERED live via
    // EFFECT_OP_REGISTRY; row moved there with status "implemented".
    // counters SHIPPED (issue #841) — addCounter / removeCounter are now
    // COVERED live via EFFECT_OP_REGISTRY; row moved there with status
    // "implemented".
    // tapUntap SHIPPED (issue #842) — tap / untap are now COVERED live via
    // EFFECT_OP_REGISTRY; row moved there with status "implemented".
    // grantAbility SHIPPED (issue #843) — grantStaticAbility is now COVERED
    // live via EFFECT_OP_REGISTRY; row moved there with status "implemented".
    // Ability removal / loss (`removeStaticAbilities`, a predicate closure)
    // stays residual — not JSON-expressible as an Op.
    // libraryLook SHIPPED (issue #844) — shuffleLibrary is now COVERED live
    // via EFFECT_OP_REGISTRY; row moved there with status "implemented". Only
    // the shuffle primitive was folded (the one pure declarative library
    // primitive); peekLibraryTop / reorderLibraryTop stay backlogged as
    // scryReorder below.
    {
        op: "scryReorder",
        status: "planned",
        cr: "701.22",
        note: "Look at / reorder the top of a library (CR 401.4 look, CR 701.22 Scry, mill). Folds SpellContext.peekLibraryTop / reorderLibraryTop (~20 blocked closures). Deferred out of libraryLook (issue #844): every current caller reads an opaque `choice` result back into `reorderLibraryTop` (a reorder-FROM-choice — Ponder, Preordain, Portent, Drafna's Restoration) or drives a mill loop off the live top id (Millstone, Thought Scour, Ray of Erasure, Deep Spawn). Needs a choice-driven reorder construct and/or a `mill` Op before it is a pure declarative skin.",
    },
    // preventDamage SHIPPED (issue #845) — preventNextNDamageToTarget /
    // preventAllCombatDamage / preventAllCombatDamageToAndBy are now COVERED
    // live via EFFECT_OP_REGISTRY; row moved there with status "implemented".
    // regenerate SHIPPED (issue #846) — applyRegenerationShield is now COVERED
    // live via EFFECT_OP_REGISTRY; row moved there with status "implemented".
    // createToken SHIPPED (issue #847) — the plain spec-driven `createToken`
    // primitive is now COVERED live via EFFECT_OP_REGISTRY with status
    // "implemented". Only the JSON-pure spec form was folded; the copy form
    // (`createTokenCopyOf`) is a distinct capability split out below.
    {
        op: "createTokenCopy",
        status: "planned",
        cr: "707.2",
        mechanicId: "create",
        note: "Create a token that is a COPY of a target creature (CR 707.2 + 111.1, Dance of Many). Folds SpellContext.createTokenCopyOf (~1 blocked closure). Split out of `createToken` (issue #847): unlike the spec-driven `createToken` Op — a JSON-pure token spec passed verbatim — the copy form reads a RUNTIME source creature (an announced target) and drives the copy machinery (`applyCopy`, the same path Clone uses), copying the source's printed characteristics onto a fresh token. That runtime object read is not expressible as a pure declarative token spec, so it is a distinct Op, not part of createToken.",
    },
    // gainControl SHIPPED (issue #848) — SpellContext.gainControl is now COVERED
    // live via EFFECT_OP_REGISTRY with status "implemented". The full duration
    // grammar the primitive's ControlChangeCondition supports (indefinite + the
    // three "for as long as" conditions) is folded; an "until end of turn"
    // control change with a tap rider (Ray of Command / Magus of the Unseen)
    // has no ControlChangeCondition variant and stays resolve() (issue #730).
    // optionChoice SHIPPED (issue #849) — SpellContext.requestOptionChoice is
    // now COVERED live via EFFECT_OP_REGISTRY with status "implemented". The
    // "choose one" modal form is folded (each mode a nested EffectOp[] run
    // through the same runOpList path an `if` branch uses). "Choose one or
    // more" / "choose two" / entwine / escalate / Fork-style repetition are
    // distinct cardinality grammars a later Op adds on demand.
    // addMana SHIPPED (issue #850) — SpellContext.addManaTo / addMana are now
    // COVERED live via EFFECT_OP_REGISTRY with status "implemented". Only the
    // fixed-produced-mana forms were folded (a ritual's static per-colour
    // amount). "Add one mana of any colour" (a runtime colour choice) and the
    // spend-restriction rider (addRestrictedMana, "spend only on …") are NOT
    // folded — the former is not a static amount, the latter has no free card
    // demanding it this wave; both stay resolve() until a card needs them.
    // coinFlip SHIPPED (issue #851) — SpellContext.requestCoinFlip is now
    // COVERED live via EFFECT_OP_REGISTRY with status "implemented". Only the
    // suspending reveal flip (`requestCoinFlip`) is folded (win / loss each a
    // nested EffectOp[] run through the same runOpList path an `if` branch uses).
    // NOT folded: the synchronous `flipCoin` loop cards (Goblin Artisans,
    // Mana Clash, Game of Chaos) stay resolve() — they need an unbounded
    // repeat-until / doubling loop + arithmetic value the frozen grammar does
    // not carry. Mijae Djinn / Ydwen Efreet DO use this same `requestCoinFlip`
    // primitive but stay resolve() for a different reason: they are blocked on
    // combat-manipulation Ops (removeFromCombat / unblock), not on the flip.
    // --- Low-frequency long-tail (surfaced by the classifier, PRD #826 §Out
    //     of Scope — recorded as reservations, filed as issues only on demand
    //     past wave-1). ---
    // `reveal` SHIPPED (issue #920 / #682, extended #945) —
    // SpellContext.markKnownToAll is now COVERED live via EFFECT_OP_REGISTRY
    // with status "implemented". The ALL-PLAYERS reveal is folded in two
    // shapes: the whole-hand reveal (`zone: "hand"` — Thoughtseize / Duress /
    // Inquisition of Kozilek / Grief) and the searched-and-found card reveal
    // (`cards: <picks ref>` — the tutor "reveal it" clause, issue #945:
    // Spellseeker, Stoneforge Mystic, Brightglass Gearhulk, Expedition Map).
    // A private single-knower "look" (Word of Command) and a library-top
    // reveal (Caustic Bronco-class) are NOT folded — see the registry note.
    {
        op: "setColor",
        status: "planned",
        cr: "613.1e",
        note: "Colour-changing effect (layer 5, CR 613.1e). Folds SpellContext.setColorOverride (~7 blocked closures). Long-tail.",
    },
    {
        op: "lockUntap",
        status: "planned",
        cr: "502.3",
        note: 'Untap-step restriction ("doesn\'t untap while …", CR 502.3). Folds SpellContext.lockUntapWhileSourceTapped / skipNextUntap (~9 blocked closures). Long-tail.',
    },
    {
        op: "nameCard",
        status: "planned",
        cr: "201.3",
        note: "Name a card as part of resolution (CR 201.3). Folds SpellContext.requestNameCard (~3 blocked closures). Long-tail.",
    },
    {
        op: "sacrificeObject",
        status: "planned",
        cr: "701.16",
        mechanicId: "sacrifice",
        note: "Sacrifice a SINGLE bound / announced permanent (CR 701.16). Split out during the coinFlip migration (issue #851): the shipped `sacrifice` Op consumes a `choice` Op's picks binding (an array of player-chosen ids read via recallChoice), so it cannot sacrifice a single captured object (a delayedTrigger capture / `$source` / `{ target }` snapshot). Goblin Kites' delayed body (\"sacrifice that creature\") is blocked on it. Likely a parametrization of the existing `sacrifice` Op with an object-selector form (`target: EffectObjectSelector`), resolved through resolveObjectRef like `destroy` — a design call for its own issue; recorded here so the next agent does not re-derive the gap.",
    },
];

/** True if `name` is a registered, USABLE Effect Script Op (ADR 0045). The
 *  single vocabulary authority consulted by `validateEffectScript`. Only
 *  `implemented` Ops count — a `planned` backlog reservation
 *  (`EFFECT_OP_BACKLOG`) is NOT usable vocabulary, so a card that references
 *  one fails validation. (Backlog rows live in a separate array, so the
 *  `status` guard here is belt-and-suspenders against a future refactor that
 *  merges the two lists.) */
export function isRegisteredEffectOp(name: string): boolean {
    return EFFECT_OP_REGISTRY.some(
        (row) => row.op === name && row.status === "implemented"
    );
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

// --- Event field registry (ADR 0049, issue #865) -----------------------------
// The name authority for `$event.<field>` refs read at a TRIGGER site: maps a
// (GameEventType, flat friendly field) pair to its value FAMILY (object /
// player — which decides the ref POSITION it is legal in) and a `resolve(event)`
// that FLATTENS the possibly-nested event shape to a single id string, so the
// ref stays single-level and the frozen ref grammar (ADR 0045) is untouched.
// Censused, not free-form: an unlisted field is a static validation failure,
// never a runtime skip (ADR 0049 — free-form `$event.<any field>` gives no
// static family and turns a wrong field into a silent no-op instead of a CI
// error, breaking validate.ts's dangling-ref guarantee). The table grows one
// row per migrated card. `TriggeredAbility.event` is statically known, so
// validation is exact per trigger.

export type EventFieldFamily = "object" | "player";

export interface EventFieldRow {
    /** Value family — an object (permanent instance id) ref or a player id ref.
     *  The validator checks this against the ref's POSITION (a destroy target vs
     *  a player selector); a mismatch is a definition bug. */
    family: EventFieldFamily;
    /** Flattens the firing event to the single id the friendly field names, or
     *  undefined when the event carries no such id (e.g. DAMAGE_DEALT dealt to a
     *  permanent has no `damagedPlayer`). CR 608.2b — the reading Op then
     *  skips. */
    resolve: (event: GameEvent) => string | undefined;
}

/** `(GameEventType, field) → { family, resolve }` (ADR 0049). Keyed by the
 *  literal event-type string so a lookup needs no event instance. */
export const EVENT_FIELD_REGISTRY: Record<
    string,
    Record<string, EventFieldRow>
> = {
    // CR 509.1h — the attacker/blocker pairing, emitted per attacker-blocker
    // PAIR (phases.ts), so a per-pair capture reads exactly one attacker and one
    // blocker even under multi-block / banding. Both ids are OBJECT refs
    // (permanents expected on the battlefield when the trigger fires).
    BLOCKERS_CONFIRMED: {
        attackerId: {
            family: "object",
            resolve: (e) =>
                e.type === "BLOCKERS_CONFIRMED" ? e.attackerId : undefined,
        },
        blockerId: {
            family: "object",
            resolve: (e) =>
                e.type === "BLOCKERS_CONFIRMED" ? e.blockerId : undefined,
        },
    },
    // CR 119.3 — damage to a target. `damagedPlayer` FLATTENS the nested
    // `TargetSelection` down to the player id (a single-level ref), or undefined
    // when the damage went to a permanent (no player was damaged).
    DAMAGE_DEALT: {
        damagedPlayer: {
            family: "player",
            resolve: (e) =>
                e.type === "DAMAGE_DEALT" && e.target.type === "player"
                    ? e.target.id
                    : undefined,
        },
    },
};

/** The registry row for a `(GameEventType, field)` pair, or undefined when the
 *  event type has no such censused field (ADR 0049). The single decision point
 *  consulted by both the validator (family + census) and the interpreter
 *  (`resolve`). */
export function getEventFieldRow(
    eventType: string,
    field: string
): EventFieldRow | undefined {
    return EVENT_FIELD_REGISTRY[eventType]?.[field];
}

/** True when `field` is a censused `$event.<field>` for `eventType` (ADR 0049). */
export function isRegisteredEventField(
    eventType: string,
    field: string
): boolean {
    return getEventFieldRow(eventType, field) !== undefined;
}
