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
// eligibility / CR 702.11b targeting legality respectively).
//
// `shroud` graduated too (issue #959 audit): every PRINTED-shroud card
// (Blastoderm, Blurred Mongoose, Spectral Cloak, …) pairs the decorative
// `staticAbilities: ["shroud"]` string with a `permanent-guard` staticEffect
// (`cantBeTargeted: true`) that `gre/permanentGuard.ts::isGuardedAgainst`
// evaluates live, consumed by `rules.ts::getLegalTargets` and
// `game.ts::selectTarget` — the SAME code path hexproof's controller-relative
// guard reuses. That is a real, CR-702.18-compliant enforcement, so the row
// is `status: "implemented"`. The narrower residual gap (documented on its
// `note`): a card that grants shroud DYNAMICALLY via
// `SpellContext.grantStaticAbility(self, "shroud", …)` (Homarid Warrior,
// Svyelunite Priest, Sylvan Safekeeper, Blurred Mongoose's activated variant)
// appends only the bare STRING with no paired `permanent-guard` staticEffect
// — no live guard reads that raw string — so those specific temporary grants
// stay inert, same class as an unenforced keyword. A future card/primitive
// that makes a granted shroud spawn its own guard closes that residual gap.
//
// `ward` (CR 702.21) was re-audited for the same issue #959 pass: zero
// engine hits for the actual keyword (no trigger firing on "becomes the
// target", no counter-unless-pay primitive, no card declares it — grep
// confirms the "Ward"-named 2ED/LEA/ICE reprints are the unrelated Color
// Ward cycle, a protection Aura, not the modern templated keyword). Its row
// stays `status: "planned"`, unchanged.

import type { GameEvent } from "./types";

export type MechanicKind =
    | "keyword-ability"
    | "keyword-action"
    /** CR 207.2c — an ITALIC ability word: purely organizational text with NO
     *  independent rules meaning of its own (unlike a CR 702 keyword ability,
     *  an ability word never appears in a card's `staticAbilities[]` and the
     *  name-authority guard never checks one against it). Most ability words
     *  (Threshold, Delirium — see `tor/black.ts` / `mh2/red.ts`) are simple
     *  `if`-predicate labels with no registry row at all, per this file's own
     *  header precedent. Domain earns a row because it graduated to a real
     *  engine primitive (`SpellContext.getDomain`) and a NINTH `EffectValue`
     *  grammar member (`{ domain: { of } }`, issue #1066) — the row documents
     *  that binding, it does not gate anything a card declares. */
    | "ability-word";
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
            "Aura attach on ETB (finalizeSpellResolution) + reattach (SpellContext.reattachAura); Reconfigure/Equipment attach-unattach (SpellContext.attachTo/detachFrom, ADR 0065, the 'attach'/'unattach' Effect Script Ops)",
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
        status: "implemented",
        binding:
            "EffectOp gainControl ×2 — Phyrexian Infiltrator (inv/black.ts, issue #1068)",
        note: 'A two-permanent control exchange ("Exchange control of X and target creature", CR 701.12e) decomposes into two calls of the already-shipped `gainControl` Op (issue #848) rather than a new Op/primitive (primitive-reuse mandate, issue #1068): first `$source` moves to the target\'s CURRENT controller — read live, before either mutation, via `{ controller: { controllerOf: { target: 0 } } }` — then the target moves to the ability\'s resolving controller (the literal `"controller"` player ref, fixed once at CR 608.2b resolution and unaffected by the first Op already having moved `$source`). Both omit `duration` (an indefinite reassignment, CR 611.2b/613.1b layer 2 — never auto-reverts, matching "This effect lasts indefinitely."). Each `gainControl` call independently no-ops when the permanent is already under the destination controller (`SpellContext.gainControl`\'s existing guard) — this is what makes "there is no effect if the same player controls both creatures" (the printed ruling) fall out for free, with no special-cased card logic. SCOPE (issue #1068): only the two-permanent control-exchange shape (CR 701.12e) is built; the broader CR 701.12 keyword (exchanging life totals 701.12b/c, hands 701.12d, or other zones) has no in-scope card and is not covered by this row — a future card needing those extends this note rather than opening a second row.',
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
    // 701.16 Investigate (issue #1191)
    {
        id: "investigate",
        name: "Investigate",
        kind: "keyword-action",
        cr: "701.16",
        status: "implemented",
        binding:
            "SpellContext.createToken with the shared CLUE_TOKEN_SPEC (convex/cards/abilities/tokens/clueToken.ts) — no dedicated Op needed, primitive reuse (ADR 0045 § primitive reuse). 'Investigate N' is N createToken calls (count: N).",
        note: "To investigate, create a Clue artifact token with '{2}, Sacrifice this token: Draw a card.' (CR 701.16a). Unblocked by issue #1191: EffectTokenSpec/TokenSpec gained a token-scoped activatedAbilities[] field (a restricted, JSON-pure ActivatedAbility subset — id/cost{tap,mana,sacrifice}/oracleText/useStack/effects, validated by isEffectTokenSpec and content-hashed into tokenDefinitionId so the client-side maybeSynthesizeToken rehydrates the ability from the token's id). The same capability unblocks the other tokens previously stubbed on this exact gap (Magda's Treasures #778, Voldaren Epicure's Blood token, Sunfall's Incubate #1210) once each card is revisited.",
    },
    // 701.17 Mill
    {
        id: "mill",
        name: "Mill",
        kind: "keyword-action",
        cr: "701.17",
        status: "implemented",
        binding:
            "EFFECT_OP_REGISTRY `mill` Op → SpellContext.peekLibraryTop + moveCardById (library → graveyard loop, issue #885)",
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
        status: "implemented",
        binding: 'SpellContext.transform / EffectOp "transform"',
        note: "Permanent-level transform machinery (CR 712 double-faced permanents, issue #1210, ADR 0067): a `backFace` spec on `CardDefinition`/`TokenSpec`, a `transformed`/`transformedFrom` face-flag pair on `CardInstanceState`, the pure `transformPermanent` mutator (`gre/transform.ts`, mirrors `faceDown.ts`'s definition-swap pattern), and the `transform` Effect Op. Scoped to a permanent ALREADY on the battlefield transforming in place (a paid activated-ability cost, e.g. the Incubator's \"{2}: Transform this artifact\"); a full two-sided-card CASTING model (choosing a face to cast, per-face mana cost, CR 711) is out of scope.",
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
        status: "implemented",
        binding: "convex/cards/abilities/adapt.ts adaptAbility",
        note: 'CR 701.46a — "Adapt N" means "If this creature has no +1/+1 counters on it, put N +1/+1 counters on it." Typically the effect of a printed activated ability ("{cost}: Adapt N."), so it never appears as a bare `staticAbilities[]` grant string (unlike a CR 702 keyword ability) — the row exists purely as the CR 701 census entry and the name authority for the `adaptAbility` factory. No new Op (primitive reuse, ADR 0045 § primitive reuse): decomposes into the ALREADY-exercised `if` structural construct\'s comparison predicate (`{ counters: { of: $source, type: "+1/+1" } } lt 1` — a literal `0` is not a legal EffectValue per CR 107.1\'s positive-int literal rule, so "fewer than one" stands in for "zero"; issue #1015\'s counters value grammar) gating the ALREADY-exercised `counters` Op (`action: "add"`, issue #841) — one execution path, zero card-shaped logic. Per-Op test regime applies (`.claude/rules/gre-development.md`): a card whose activated ability is built with `adaptAbility` needs no hand-written interpreter/wire test.',
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
        note: "Both engine gaps confirmed in #924 are now CLOSED by #1210: (1) permanent-level transform/DFC machinery (CardDefinition.backFace / TokenSpec.backFace, the transformed/transformedFrom face flag, transformPermanent, the `transform` Effect Op — CR 712, ADR 0067); (2) TokenSpec/EffectTokenSpec.entersWith.counters for dynamic counters-at-creation (token-scoped activatedAbilities already shipped, issue #778/#1191). Still `planned`: Incubate N itself as a keyword action (create-token-with-backFace-and-counters composition) and the Incubator token definition are not yet wired to a card — left for #924. Blocks Sunfall (convex/cards/sets/mom/white.ts, stub id 32e29c7d-ed4b-4eff-b3c2-d99e5b63ef8d).",
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
        binding:
            "convex/gre/combatRegistry.ts (EvasionRule per landwalk variant)",
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
        binding: "convex/gre/protection.ts",
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
        status: "implemented",
        binding:
            "permanent-guard staticEffect (gre/permanentGuard.ts isGuardedAgainst)",
        note: 'HONOURED (issue #959): CR 702.18 — every printed-shroud card (Blastoderm nem/green.ts, Blurred Mongoose inv/green.ts, Spectral Cloak leg/blue.ts) pairs the `staticAbilities: ["shroud"]` reminder string with a `permanent-guard` staticEffect (`cantBeTargeted: true`), evaluated live by `isGuardedAgainst` and consumed by `rules.ts::getLegalTargets` + `game.ts::selectTarget` (server-authoritative) — the same "can\'t be the target of spells or abilities" path hexproof\'s controller-relative guard reuses, but unfiltered (blocks the permanent\'s own controller too, unlike hexproof). GAP (narrower than before): a card that grants shroud DYNAMICALLY via `SpellContext.grantStaticAbility(self, "shroud", …)` — Homarid Warrior / Svyelunite Priest (fem/blue.ts), Sylvan Safekeeper (jud/green.ts), Blurred Mongoose\'s own activated ability (inv/green.ts), the usg/green.ts grant — appends only the bare keyword STRING with no paired `permanent-guard` staticEffect, so no live guard reads it and those specific TEMPORARY grants stay inert (each site\'s own code comment documents this). The keyword as a whole is "implemented" because its dominant, CR-compliant enforcement path (the printed/staticEffect-paired form) is real and server-authoritative; the residual dynamic-grant gap is called out here, not glossed over.',
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
        status: "implemented",
        bindingPattern: /^ward /,
        binding:
            "convex/cards/abilities/ward.ts wardAbility(cost, costLabel) factory",
        note: 'Issue #1312 — "ward <label>" static string is board-visible reminder data (matched by bindingPattern, e.g. "ward {2}", "ward—pay 2 life"), wardAbility({cost, costLabel}) in triggeredAbilities is the enforcing CR 702.21a triggered ability. Routes entirely through the existing targeted-triggered-ability foundation (CR 603.3d, issue #1193): event "BECAME_TARGET" (CR 603.2b, issue #1265, the same event Leovold reads) narrowed to `event.target.id === self.id` (this exact permanent, not just "you control it"); its own target ("that spell or ability") resolves via the new `spellTargetsSelfSource` dynamic requirement flag (rules.ts raiseTriggerTargetSelection — pins Mistfolk\'s `spellTargetsInstanceIds` filter to `StackItem.triggerSourceId` per-instance instead of a static id) combined with the new `spellStackKind: "any"` value (spells AND abilities both admitted — CR 702.21a says "spell or ability", unlike Stifle\'s ability-only "ability" or Mistfolk\'s spell-only default); the CR 603.3d single-legal-target rule then auto-selects it with no player choice in the overwhelming common case. Effects are the existing "counter unless pay" DSL shape (Miscalculation/Force Spike): mayPay(controllerOf target 0) + if(!paid) counter(target 0) — mayPay/if/counter are already interpreter-suite-exercised Ops, no new Op introduced. Issue #1361 (resolved, was a documented divergence): the rare case of TWO distinct spells/abilities simultaneously targeting the same warded permanent no longer falls back to a player choice — `BecameTargetEvent.sourceInstanceId` (the causing stack item\'s own id, threaded through `emitBecameTargetEvents`) lets `raiseTriggerTargetSelection` narrow each ward trigger\'s legal-target set to the EXACT object that caused it (CR 702.21e), forcing the correct counter target deterministically. No card ships the keyword yet (Kappa Cannoneer, cn nec/blue.ts, is separate — also needs Improvise, issue #917).',
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
        status: "implemented",
        binding:
            "convex/game.ts (announceCast / finalizeTargetSelection — resolveBuybackChoice, foldBuybackCost) + convex/gre/state.ts (finalizeSpellResolution)",
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op) — mirrors the Kicker plumbing (issue #692), scaled down since CR 702.27 has no Multikicker-style repeatable variant. `CardDefinition.buyback` (a plain ManaCost — the optional additional cost). `announceCast` accepts a `buyback` boolean, folds `buyback` into the pending mana cost via `foldBuybackCost` (mirrors `foldKickerCost`), threads it through `pendingTarget`/`pendingCast` as `buybackPaid`, and snapshots it on the StackItem. `finalizeSpellResolution` (`convex/gre/state.ts`) reads `item.buybackPaid` and routes the card to its owner's HAND instead of the graveyard as it resolves (CR 702.27a) — checked after a spell's own exile-self/shuffle-self-into-library resolution redirects, which take precedence. Used by Corpse Dance (`convex/cards/sets/tmp/black.ts`) — currently a documented stub: its reanimation clause (\"the TOP creature card of your graveyard\") is blocked on the pre-existing deterministic top-of-graveyard selector gap (issue #920), unrelated to Buyback.",
    },
    // 702.28 Shadow
    {
        id: "shadow",
        name: "Shadow",
        kind: "keyword-ability",
        cr: "702.28",
        status: "implemented",
        binding: "shadow",
        note: "combatRegistry.ts EvasionRule (attacker-has-shadow half, attacker-keyed like Fear/Flying) + combat.ts validateBlockerEligibility Pass 0d (the reverse half — a shadow BLOCKER can't block a non-shadow attacker — not expressible by the attacker-keyed EvasionRule shape). Issue #1156, Dauthi Voidwalker — first shadow creature shipped.",
    },
    // 702.29 Cycling
    {
        id: "cycling",
        name: "Cycling",
        kind: "keyword-ability",
        cr: "702.29",
        status: "implemented",
        binding: "cycling",
        note: 'Cost-system / keyword-cast capability (engine/cost infra, NOT an Effect Script Op): an activated ability usable only from the hand at instant speed (CR 702.29a-b). Modeled as a normal `useStack: true` activated ability declared via the `cyclingAbility(cost)` factory (convex/cards/abilities/cycling.ts): `activateFromHand: true` (new ActivatedAbility flag, twin of activateFromGraveyard) + `cost: { mana, discardThis: true }` + `effects: [{ op: "draw", amount: 1 }]`. activateAbility locates the source in hand, gates on activateFromHand + ownership; the discard-this cost routes through discardToGraveyard (emitting CARD_DISCARDED, CR 701.8) so "whenever you discard" triggers fire (Marauding Mako). Used by the IKO/SNC Triomes, Miscalculation, Unearth, Marauding Mako.',
    },
    // 702.30 Echo
    {
        id: "echo",
        name: "Echo",
        kind: "keyword-ability",
        cr: "702.30",
        status: "implemented",
        binding: "echo",
        note: 'convex/cards/abilities/echo.ts (CR 702.30) + `echoPending` instance flag (state.ts); cards declare `staticAbilities: ["echo"]` (ETB flag) and `echoTrigger(...)`. Used in usg/red.ts (Goblin Patrol).',
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
        status: "implemented",
        bindingPattern: /^fading \d+$/,
        note: 'convex/cards/abilities/fadingVanishing.ts — "fading N" static string expanded at the getDefinition seam (ADR 0054) into entersWith N fade counters + an upkeep remove-or-sacrifice trigger',
    },
    // 702.33 Kicker
    {
        id: "kicker",
        name: "Kicker",
        kind: "keyword-ability",
        cr: "702.33",
        status: "implemented",
        binding: "kicker",
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op): CardDefinition.kicker (KickerCost — the optional additional mana cost) + CardDefinition.kickedTargetRequirement (target set that replaces targetRequirement when kicked). announceCast accepts a kickerCount, folds kicker.cost into the pending mana cost, threads it through pendingTarget/pendingCast, and snapshots it on the StackItem as kickerCount; SpellContext.getKickerCount() reads it at resolution, exposed to DSL via the { kickerCount: true } value (`> 0` = was kicked). projectPublicState carries the card's kicker field to the client (HandCardKickerButton) so the caster can choose to pay it. Used by Overload, Bloodchief's Thirst, Burst Lightning, Tear Asunder, Consult the Star Charts.",
    },
    // 702.33e Multikicker
    {
        id: "multikicker",
        name: "Multikicker",
        kind: "keyword-ability",
        cr: "702.33e",
        status: "implemented",
        binding:
            "convex/gre/state.ts (kicker.multi / kickerCount — shared Kicker cost-system path, no dedicated module)",
        note: "The Kicker variant that may be paid any number of times as the spell is cast (CardDefinition.kicker.multi). Shares the whole Kicker cost-system path; kickerCount records how many times it was paid and drives 'a charge counter for each time it was kicked' via entersWith.counters count 'kicker'. Used by Everflowing Chalice.",
    },
    // 702.34 Flashback
    {
        id: "flashback",
        name: "Flashback",
        kind: "keyword-ability",
        cr: "702.34",
        status: "implemented",
        binding: "convex/gre/flashback.ts",
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op): convex/gre/flashback.ts (getFlashbackCost / findFlashbackCastable) + CardDefinition.flashback (printed cost) + CardInstanceState.grantedFlashback (Snapcaster's until-EOT grant, cleared at CLEANUP). announceCast/finalizeTargetSelection/commitPendingCast (convex/game.ts) locate the graveyard card, pay the flashback cost, and flag the stack item exileOnResolve + castFromGraveyard; finalizeSpellResolution exiles it (CR 702.34a). getLegalActions offers the cast; projectPublicState carries the affordance to the client (GraveyardFlashbackButton). Used by Faithless Looting, Firebolt, Lingering Souls, Echo of Eons, Sevinne's Reclamation; granted by Snapcaster Mage.",
    },
    // 702.35 Madness
    {
        id: "madness",
        name: "Madness",
        kind: "keyword-ability",
        cr: "702.35",
        status: "implemented",
        binding: "convex/gre/madness.ts",
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op): convex/gre/madness.ts (getMadnessCost / markMadnessExiled / openMadnessCastWindow / declineMadness) + CardDefinition.madness (printed madness cost; `Madness {0}` is the empty cost `{}`) + CardInstanceState.madnessExiled / madnessTriggerPending. discardToGraveyard (convex/gre/state.ts) redirects a discarded madness card hand→exile (CR 702.35c); collectTriggers (triggers.ts) builds a reflexive triggered ability StackItem off the CARD_DISCARDED event (CR 702.35d), which resolveTopOfStack resolves by opening the owner's single cast window (openMadnessCastWindow sets castableFromExileBy + raises a BLOCKING `madness-cast` pending choice — Cast/Decline). The choice freezes priority so the cast can never be lost by passing. Accept: the client fires the ordinary announceCast on the exiled card, consumeMadnessCastChoice (game.ts) pops the choice, castRawManaCost charges the madness cost, and the normal cast flow (targets/mana) runs. Decline: submitMadnessDecline → declineMadness bins the card immediately. The vs-AI bot always declines (brain.ts / submit-madness-decline). The CR 514.1 cleanup hand-size discard implements the CR 514.3 exception (finalizeCleanupDiscard grants priority + stays in CLEANUP) so the discard-to-hand-size line resolves in the discarding player's own end step. Used by Basking Rootwalla, Blazing Rootwalla, Anje's Ravager.",
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
        status: "implemented",
        binding:
            "GameState.spellsCastThisTurn (gre/state.ts) + collectCastTriggers/resolveStormTrigger (ADR 0052) — engine-synthesized cast trigger, not a per-card resolve()",
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
        status: "implemented",
        bindingPattern: /^vanishing \d+$/,
        note: 'convex/cards/abilities/fadingVanishing.ts — "vanishing N" static string expanded at the getDefinition seam (ADR 0054) into entersWith N time counters + an upkeep remove trigger + a separate COUNTER_REMOVED sacrifice trigger (CR 702.63d)',
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
        status: "implemented",
        // Evoke never appears as a literal `staticAbilities[]` string (like
        // Flashback/Madness/Escape, it is cost-system infra with its own
        // dedicated CardDefinition field, not a board-visible keyword string).
        binding: "convex/cards/abilities/evoke.ts",
        note: 'CR 702.74a represents TWO abilities, both engine infra (issue #900): (1) the alternative-cast static ability — `CardDefinition.evoke` reuses the `AlternativeCost` shape verbatim (CR 118.9 already governs paying it); `convex/gre/alternativeCost.ts`\'s `getAlternativeCost`/`affordableAlternativeCosts` resolve this field alongside the generic `alternativeCosts[]` array, and the cast-commit sites in `convex/game.ts` tag the resulting stack item `evoked: true` whenever the chosen alt cost === `def.evoke` (compared by reference) — that flag rides onto the entering permanent for free (a stack item IS its CardInstanceState, the `escaped` precedent). (2) the sacrifice-on-ETB triggered ability — `evokeTrigger` (convex/cards/abilities/evoke.ts), built on `enteredTrigger` with a CR 603.4 check-time `condition` reading `CardInstanceState.evoked` (not an intervening-if — the flag cannot change between the ETB event and this trigger resolving). A card adds BOTH `evoke: {...}` and `evokeTrigger(name)` (alongside its own ETB ability). Used by Solitude, Grief (MH2 Elemental Incarnations, mh2/white.ts / mh2/black.ts) — their evoke cost is a pure HAND leg ("Exile a <colour> card from your hand"), so it composes with the EXISTING alt-cost hand-leg picker with zero new plumbing. Vibrance/Deceit/Wistfulness (ECL) remain stubbed: their evoke cost is a HYBRID mana pip ({R/G}{R/G} etc.), blocked on the separate hybrid-ManaCost-representation gap (issue #782), not on Evoke itself.',
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
        status: "implemented",
        binding: "wither",
        note: "markInfectWitherDamage (gre/state.ts) at every damage sink — combat (applyOneCombatDamage, phases.ts) and non-combat (SpellContext.dealDamage) — diverts damage to a CREATURE into -1/-1 counters (addCounterToCard) instead of marked damage. Creature-only half of CR 702.90/infect's shared permanent-branch change; a 0-toughness death from the counters is the existing getEffectiveToughness<=0 SBA (sba.ts), not a new lethal-damage path.",
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
        status: "implemented",
        // Expanded from the bare `staticAbilities: ["exalted"]` string at the
        // `getDefinition` seam (convex/cards/abilities/keywordTriggers.ts,
        // issue #699): injects a CR 702.83a triggered ability — whenever a
        // creature its controller controls attacks alone (ATTACKERS_DECLARED
        // with a single attacker), that lone attacker gets +1/+1 until end of
        // turn (pump Op, `{ ref: "$event.soleAttacker" }`, CR 613.4c).
        binding: "exalted",
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
        status: "implemented",
        binding: "infect",
        note: "markInfectWitherDamage (creature half, shared with wither) + markInfectPoisonDamage (player half — PlayerState.poisonCounters) in gre/state.ts, wired at every damage sink — combat (applyOneCombatDamage, phases.ts) and non-combat (SpellContext.dealDamage). CR 702.90c: still 'damage' for every other purpose (deathtouch, lifelink, damage-dealt tallies), so those callers are unaffected — only the life-loss/damage-marking step is diverted. 10-poison loss is the existing SBA (sba.ts).",
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
        status: "implemented",
        // Expanded from the bare `staticAbilities: ["prowess"]` string at the
        // `getDefinition` seam (convex/cards/abilities/keywordTriggers.ts,
        // issue #699): injects a CR 702.108a triggered ability — whenever its
        // controller casts a noncreature spell (SPELL_CAST, scope "you",
        // filter excludeTypes "Creature"), this creature gets +1/+1 until end
        // of turn (pump Op on `$source`, CR 613.4c).
        binding: "prowess",
    },
    // 702.109 Dash
    {
        id: "dash",
        name: "Dash",
        kind: "keyword-ability",
        cr: "702.109",
        status: "implemented",
        binding: "dash",
        note: "CR 702.109a represents TWO abilities, both engine infra (issue #1314): (1) the alternative-cast static ability — `CardDefinition.dash` reuses the `AlternativeCost` shape (CR 118.9 already governs paying it), extended with a `mana` leg (`AlternativeCost.mana`) since Dash — unlike Gush/Evoke — is a mana-for-mana swap, not a mana-for-something-else substitution; `convex/gre/alternativeCost.ts`'s `getAlternativeCost`/`affordableAlternativeCosts` resolve this field alongside `evoke`/the generic `alternativeCosts[]` array, and the cast-commit sites in `convex/game.ts` tag the resulting stack item `dashed: true` whenever the chosen alt cost === `def.dash` (compared by reference) — that flag rides onto the entering permanent for free (a stack item IS its CardInstanceState, the `escaped`/`evoked` precedent). The dash mana leg is routed through the SAME tap-lands payment machinery a printed cost uses (`isManaCostCovered`/`payManaCostForSpell`/`pendingCast.manaCost`) — it pays/parks exactly like an ordinary cast, never silently zeroed. `convex/gre/rules.ts`'s \"cast\" legality gate accounts for it too: a dash-cost creature is castable whenever EITHER the printed cost OR the dash cost is affordable. (2) the haste-and-return triggered ability — `dashTrigger` (convex/cards/abilities/dash.ts), built on `enteredTrigger` with a CR 603.4 check-time `condition` reading `CardInstanceState.dashed`, and a DSL effects[] body composing two already-shipped Ops: `grantAbility` (haste, CR 611.1b/613.1f) + `delayedTrigger` (next-end-step return to hand, CR 603.7/ADR 0048) — zero new Ops. A card adds BOTH `dash: {...}` and `dashTrigger(name)` (alongside its own ETB ability, if any). No catalogue card ships against this yet — Death-Greeter's Champion (issue #917) is ALSO blocked on Backup (CR 702.165, separate ticket) and stays a stub; the capability is proven via a synthetic probe card in convex/gre/__tests__/dash.test.ts, mirroring the evoke.test.ts precedent for an engine capability with no consuming card yet.",
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
        status: "implemented",
        binding:
            "Issue #1313 — \"improvise\" static staticAbilities string, generalizing the land-tap payment shape (`PendingCast.tappedLandIds` / `tapForPayment` / `untapForPayment`, game.ts) to artifacts instead of duplicating a parallel Convoke-style mechanism (Convoke itself, CR 702.51, is still `status: \"planned\"` — no existing tap-during-payment machinery to reuse beyond the land-mana one this generalizes). `PendingCast.improviseTappedArtifactIds` (gre/state.ts) tracks taps for rollback; `tapArtifactForImprovise`/`untapArtifactForImprovise` (game.ts) tap/untap an untapped controlled Artifact and directly adjust `pendingCast.manaCost.X` (the normalized generic requirement) by ±1 — the SAME field `applyCostModifiers`'s `reductionGeneric` clamp reduces, so `isManaCostCovered`/`tryAutoCommitPendingCast` need no Improvise-specific branch. `rollbackPendingCast` untaps on cancel/abandon. Client: `useBattlefieldVisualState`/`useBattlefieldInteraction` (src/hooks) offer the tap affordance on the caster's own untapped artifacts during an Improvise cast's payment step, routed through `hasImprovise`/`pendingCastRemainingGeneric` (src/lib/card-utils.ts) — the same view-reducer path the land-tap affordance already uses. Scope note: an artifact that ALSO has a mana ability keeps the existing tap-for-mana left-click as the default (unchanged precedent); Improvise is offered only on artifacts with no mana ability of their own, since the two payment modes on the same click target would need a picker UI the ticket didn't require.",
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
        status: "implemented",
        binding: "convex/gre/escape.ts",
        note: 'Cost-system / keyword-cast capability (engine/cost infra, NOT an Effect Script Op, issue #695): convex/gre/escape.ts (getEscapeCost / findEscapeCastable / hasEscape + countDistinctCardTypes) + CardDefinition.escape (mana + exile N other graveyard cards, CR 702.138a) + CardDefinition.grantsEscapeToOwnGraveyard (Underworld Breach\'s zone-wide grant). locateCastSource/castRawManaCost/graveyardCastStackFlags (convex/game.ts) route the graveyard cast: pay the escape mana, exile the "other" cards via the reused flashback exileFromGraveyardChoice picker (fixed count, or the Nethergoyf variable "any number with N+ card types" via minCardTypes), and stamp the stack item `escaped` (CR 702.138e) — which rides onto the resulting permanent (a stack item IS its CardInstanceState), NO exileOnResolve. getLegalActions offers the cast; projectPublicState carries the affordance to the client. The `escaped` game-state is read in DSL via the `{ escaped: { of } }` EffectValue (SpellContext.isEscaped) for "sacrifice it unless it escaped". Used by Uro, Phlage, Nethergoyf; granted by Underworld Breach.',
    },
    // 702.139 Companion
    {
        id: "companion",
        name: "Companion",
        kind: "keyword-ability",
        cr: "702.139",
        status: "implemented",
        binding: "convex/gre/companion.ts",
        note: "Deckbuild-condition / special-action capability (engine infra, NOT an Effect Script Op — ADR 0064): `convex/gre/companion.ts` (`selectCompanion` scans the Sideboard for a Companion-keyword card whose per-card condition closure the Maindeck satisfies; `canSummonCompanion` gates the CR 116.2 special action) + `PlayerState.companion` (the per-player slot: `{ instance, used }`, NOT a general \"outside the game\" zone) + `GameState.pendingCompanionPay` (the {3} payment, mirrors `pendingCast` but dedicated — no target/mode/stack item). Auto-declared at game init (`buildPlayerState`/`buildCompanionInstance`, game.ts) from the Match deck's sideboard snapshot (threaded through `NextGameSeat.deck.sideboard`, matches.ts, so a Bo3 Game re-scans post-sideboard). The `summonCompanion` mutation (game.ts) solves the {3} via the shared auto-tap solver (`solveSmartAutoTap`) and moves the companion straight to hand — no stack item. Projected to BOTH players (CR 702.139c) via `SlimCompanionSlot` (gameProjections.ts), with `canSummon` carried only to the slot's own controller. UI: a companion-slot chip + \"Companion {3}\" summon button in the pile cluster, gated through the wire projection. Bot: `summon-companion` is a `Move` (moves.ts/legalActions.ts), realised via `executor.ts`'s `summonCompanion` mutation call — rides the existing ISMCTS search rather than a bespoke heuristic (evaluate.ts already scores hand-card value, so summoning into hand is naturally incentivized once legal). Used by Lutri, the Spellchaser (singleton condition) and Lurrus of the Dream-Den (permanent-MV≤2 condition, `permanentManaValueAtMost2`/`everyPermanent`, issue #1392) — Lurrus additionally declares `CardDefinition.castsPermanentsFromGraveyard`, a NEW static/battlefield-derived once-per-turn variant of the graveyard-cast permission seam (`canCastPermanentFromGraveyardByPermission`, `gre/rules.ts`, distinct from the turn-scoped Op-granted `grantGraveyardPlay`/Yawgmoth's Will permission).",
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
    // 702.151 Reconfigure (issue #1311) — two activated abilities (attach /
    // unattach, CR 702.151a) routed through the "attach"/"unattach" Effect
    // Script Ops (ADR 0065's unified attachment model), plus a `type-remove`
    // static effect for CR 702.151b ("isn't a creature while attached").
    // First card: Lion Sash (neo/white.ts).
    {
        id: "reconfigure",
        name: "Reconfigure",
        kind: "keyword-ability",
        cr: "702.151",
        status: "implemented",
        binding:
            "ActivatedAbility pair (attach/unattach Effect Script Ops) + StaticTypeRemove (CR 702.151b) + checkAttachmentSBA (CR 704.5n)",
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
        status: "implemented",
        bindingPattern: /^backup \d+$/,
        binding:
            "convex/cards/abilities/triggers/backupTrigger.ts backupTrigger(n, grantedAbilities) factory",
        note: 'Issue #1315 — "backup N" static string is board-visible reminder data (matched by bindingPattern, e.g. "backup 1", "backup 2"), backupTrigger(n, grantedAbilities) in triggeredAbilities is the enforcing CR 702.165a ETB triggered ability, parametrized on BOTH the counter count N and the card\'s own printed ability list below the Backup line (CR 702.165c — grantedAbilities is a literal subset of the card\'s own staticAbilities[], never invented). Routes entirely through existing machinery: the targeted-ETB-trigger foundation (`enteredTrigger` + `targetRequirement`, CR 603.3d/issue #1193, Flametongue Kavu precedent) for "put N +1/+1 counters on target creature", the `counters` Op (CR 122, issue #841) for the counter placement, and the `grantAbility` Op (CR 611.1b/613.1f, issue #843, Dash\'s haste-grant precedent) for the until-end-of-turn ability grant. The ONE new piece is the `targetIsAnother` `if`-predicate (issue #1315, `EffectPredicate` union, convex/cards/types.ts) — an object-identity comparison ("if that\'s ANOTHER creature") the existing numeric/boolean predicate grammar had no shape for; gates the grant so a self-targeted Backup does not re-grant the source its own abilities. No new Op. Proven against a real, simple catalogue card needing ONLY Backup: Consuming Aetherborn (mom/black.ts, Backup 1 + Lifelink). Guardian Scalelord (moc/white.ts, vintage-cube pool) stays a stub — Backup itself no longer blocks it, but its OWN second ability ("whenever this attacks, return target nonland permanent card with mana value X or less from your graveyard, where X is this creature\'s power") needs a dynamic power-based `manaValueAtMost` cap that does not exist yet (today\'s `manaValueAtMost` is a literal or the spell\'s own `{X:true}`, never a source-power reference) — a separate, narrower gap than Backup; tracked-by #1378. Death-Greeter\'s Champion (moc/red.ts) stays a stub too — ALSO needs Dash (CR 702.109a, separate ticket).',
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

/** CR 207.2c ability words with a real engine binding (as opposed to a plain
 *  `if`-predicate label with no registry row — Threshold, Delirium; see this
 *  file's header). Deliberately small: most ability words never earn a row. */
const ABILITY_WORDS: MechanicRow[] = [
    {
        id: "domain",
        name: "Domain",
        kind: "ability-word",
        cr: "702 preamble",
        status: "implemented",
        binding: "SpellContext.getDomain / EffectValue { domain: { of } }",
        note: "The number of basic land types among lands a player controls (0–5, CR 305.6 — a dual land contributes several), issue #1066. Reused by four sites: the `{ domain: { of } }` EffectValue grammar member (Tribal Flames, Wandering Stream, Ordered Migration, Worldly Counsel, Power Armor's pump), the shared `countDomain` helper feeding `StaticPTCDA.compute` closures (Kavu Scout, Wayfaring Giant, Exotic Curse, Strength of Unity), the dynamic `StaticAttackManaTax.costPerAttacker` function (Collective Restraint), and Coalition Victory's `winGame`-gating `if` predicate.",
    },
];

/** Named mechanics reused across a specific SET's cards, censused for the
 *  SAME reason CR 701/702 keywords are (a real, parametrized, machine-checked
 *  name — not a card-specific one-off, which belongs in
 *  `ENGINE_INTERNAL_MARKERS` instead) but with no CR 701/702 section of their
 *  own: Universes Beyond set-original keywords (issue #1317's Earthbend, from
 *  Avatar: The Last Airbender / TLA). Kept in its own array — not appended to
 *  `KEYWORD_ACTIONS` / `KEYWORD_ABILITIES`, whose header comments document a
 *  closed, exact CR-702/701-numbered census — so those two stay a faithful CR
 *  census while `SET_KEYWORDS` still feeds `MECHANICS_REGISTRY` (and therefore
 *  `isNamedMechanic`) like any other row. */
const SET_KEYWORDS: MechanicRow[] = [
    // Earthbend N — TLA (Avatar: The Last Airbender) set keyword, issue #1317.
    // Invoked as a VERB inside a triggered/activated ability's effect text
    // ("When this creature enters, earthbend 1"), the same shape as a CR 701
    // keyword ACTION (Investigate, Mill) rather than a permanent's own static
    // keyword — it never appears in a card's `staticAbilities[]`, so
    // `bindingPattern` is not exercised by the name-authority guard
    // (`isNamedMechanic`) today; it documents the parametrized name for a
    // future card that DOES declare it literally (e.g. a reminder-text-only
    // printed keyword line).
    {
        id: "earthbend",
        name: "Earthbend",
        kind: "keyword-action",
        cr: "not a CR 701/702 entry — TLA (Avatar: The Last Airbender) set keyword",
        status: "implemented",
        bindingPattern: /^earthbend \d+$/i,
        binding:
            "animate + counters Ops (Badgermole Cub's ETB effects[], tla/green.ts)",
        note: 'Oracle reminder text (Badgermole Cub, Scryfall, confirmed uniform across 28 TLA earthbend cards): "Target land you control becomes a 0/0 creature with haste that\'s still a land. Put N +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped." Decomposes into TWO already-general Ops (primitive-reuse mandate) on a `targetRequirement: { type: "Land", count: 1, controller: "you" }` triggered ability: `animate` (base 0/0, `subtype: "Elemental"`, `grantedAbilities: ["haste"]`, no `duration` — CR 611.2b indefinite, since the reminder text carries no "until end of turn" clause) then `counters` (`action: "add"`, "+1/+1", count N). SCOPE (Guard B, tracked-by #1362): the reminder text\'s THIRD sentence — "When it dies or is exiled, return it to the battlefield tapped." — is a delayed triggered ability (CR 603.7a) watching one specific object indefinitely; the engine\'s only instance-leave-watch timing (`"leaves-battlefield"`, `gre/triggers.ts`) is explicitly THIS-TURN-scoped (purged at CLEANUP, `gre/phases.ts`) with no indefinite variant — the exact gap `sets/lci/black.ts` (Deep-Cavern Bat) already stopped-and-issued as #1362. Badgermole Cub ships without that clause rather than duplicate/fork #1362\'s tracked gap.',
    },
];

export const MECHANICS_REGISTRY: MechanicRow[] = [
    ...KEYWORD_ACTIONS,
    ...KEYWORD_ABILITIES,
    ...ABILITY_WORDS,
    ...SET_KEYWORDS,
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

// --- Loyalty abilities (CR 606) census note (ADR 0058) ---
//
// A LOYALTY ABILITY is a planeswalker's activated ability with a signed loyalty
// cost (`ActivatedAbility.cost.loyalty`, `+N`/`-N`/`0`). It is deliberately
// given NO row in any of the tables above, and this is the honest census, not
// an omission:
//   - It is NOT a CR 701 keyword action or a CR 702 keyword ability — CR 606 is
//     its own section, and a loyalty ability never contributes a
//     `staticAbilities[]` string, so the name-authority guard (`isNamedMechanic`)
//     has nothing to check. It is therefore not an `ENGINE_INTERNAL_MARKER`
//     either (those bind a literal `staticAbilities` string).
//   - It is NOT an Effect Script Op. `cost.loyalty` is a COST-SYSTEM +
//     activation-timing capability (paid by adjusting `counters["loyalty"]`,
//     gated sorcery-speed / one-per-turn / not-below-0 in `game.ts`
//     `assertLoyaltyActivationLegal`), exactly like the alternative-cost
//     mechanics that also carry no registry row (Cycling, Flashback, Escape,
//     the "pay {E}" energy spend — see the `energy` Op note below). The ability's
//     one-shot EFFECT is a normal Effect Script and its Ops ARE censused in
//     `EFFECT_OP_REGISTRY` like any other ability.
// Starting loyalty (`CardDefinition.loyalty`, CR 306.5b) and the 0-loyalty SBA
// (CR 704.5i) are likewise pure engine rules, not named mechanics.

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
        op: "getEnergy",
        status: "implemented",
        cr: "122.1",
        note: 'CR 122.1 — "you get {E}": add energy counters to a player. The GENERATION half of the Energy resource (issue #697, Cube CAP). A thin declarative skin over SpellContext.addEnergy (the dedicated PlayerState.energyCounters scalar, mirroring poisonCounters, ADR 0032). Energy is engine/cost infra with NO MECHANICS_REGISTRY keyword row (it is a resource, not a CR 701/702 keyword), but the "get {E}" effect IS a one-shot Effect Script Op, so it lives here. The SPENDING half ("pay {E}") is a cost-system capability (SpellContext.payEnergy), not an Op — no registry row, same as the alt-cost mechanics (Cycling, Flashback, Escape).',
        binding: "SpellContext.addEnergy",
    },
    {
        op: "loseLife",
        status: "implemented",
        cr: "119.3b",
        binding: "SpellContext.loseLife",
    },
    {
        op: "extraTurn",
        status: "implemented",
        cr: "500.7",
        binding: "SpellContext.takeExtraTurn",
        note: 'Schedule an extra turn for `player` after the current one (CR 500.7, issue #686 — Time Warp). A thin declarative skin over the single SpellContext primitive `takeExtraTurn` (ADR 0045), one execution path: the SAME primitive already backs Time Walk\'s pre-DSL `resolve()` closure (`lea/blue.ts`) and the LIFO `state.extraTurns` queue `advanceTurn` (phases.ts) pops at each turn boundary — this Op adds no new engine capability, only a declarative front end over an already-shipped, already-exercised primitive (primitive-reuse mandate). `player` is an announced target slot (Time Warp: "target player"), the resolving controller, or a relative player. Skipped when the player cannot be resolved (CR 608.2b). SCOPE: only scheduling a plain extra turn is folded; an activated-ability source (Time Vault) or a turn with restrictions ("skip your next turn" riders) is out of reach of this Op and stays resolve() if it ever needs a variant shape.',
    },
    {
        op: "restrictCasting",
        status: "implemented",
        cr: "601.3a",
        binding: "SpellContext.restrictSpellCasting",
        note: 'Impose a turn-scoped per-player "can\'t cast spells this turn" restriction (CR 601.3a, issue #1057 — Xantid Swarm: "defending player can\'t cast spells this turn"). A thin declarative skin over the single SpellContext primitive `restrictSpellCasting`, one execution path (ADR 0045): `player` names whom to lock — Xantid Swarm\'s ATTACKERS_DECLARED trigger uses `player: "opponent"` (the defending player in a 2-player game, CR 102.2). Adds the player id to `state.cannotCastSpellsThisTurn`, enforced by the SHARED cast gate `castProhibitionReason` (convex/cards/castRestrictions.ts) that both the GRE `getLegalActions` and the client read, and cleared unconditionally at CLEANUP (CR 514.2). Distinct from the permanent-sourced `cast-restriction` statics (Brand of Ill Omen), which are battlefield-scanned, class-filtered and auto-revert when their source leaves play; this is a per-player turn flag that does not revert on a source leaving. Lands are unaffected (playing a land is not casting a spell, CR 601 / 305). Optional `cardTypes` (issue #1124, Abeyance: "can\'t cast instant or sorcery spells") narrows the lock to the listed card types instead of every spell — `state.cannotCastSpellsThisTurn` entries carry `{ playerId, cardTypes? }`, checked against the would-be-cast card\'s printed types via the same `castProhibitionReason` gate.',
    },
    {
        op: "restrictActivation",
        status: "implemented",
        cr: "602.1",
        binding: "SpellContext.restrictAbilityActivation",
        note: "Impose a turn-scoped per-player \"can't activate abilities that aren't mana abilities\" restriction (CR 602.1 / 605.1a, issue #1124 — Abeyance: \"target player can't cast instant or sorcery spells, and that player can't activate abilities that aren't mana abilities\"). A thin declarative skin over the single SpellContext primitive `restrictAbilityActivation`, one execution path (ADR 0045): `player` names whom to lock. Adds the player id to `state.cannotActivateAbilitiesThisTurn`, enforced directly by the `activateAbility` mutation (`convex/game.ts`) — the ONLY mutation that handles non-mana (`useStack: true`) abilities (mana abilities go through the separate `tapUntap` mutation and are structurally exempt, so the restriction needs no explicit mana-ability carve-out) — and cleared unconditionally at CLEANUP (CR 514.2). Mirrored as a UI hint in `getStackAbilities` (`src/lib/card-utils.ts`) via the wire-projected `TriggerStateView.cannotActivateAbilitiesThisTurn`.",
    },
    {
        op: "grantGraveyardPlay",
        status: "implemented",
        cr: "305.1 / 601",
        binding: "SpellContext.grantGraveyardPlay",
        note: "Grant a turn-scoped, player-wide permission to play lands and/or cast spells from OWN graveyard (CR 305.1-analog / 601, issue #1149 — Yawgmoth's Will: \"Until end of turn, you may play lands and cast spells from your graveyard\"). A thin declarative skin over the single SpellContext primitive `grantGraveyardPlay`, one execution path (ADR 0045): `zones` lists which card kinds the grant covers (\"land\" and/or \"spell\"; omitted = both, the Yawgmoth's Will shape), `maxManaValue` optionally caps the spell half (unused by Yawgmoth's Will — reserved for a future SCOPED grant reusing this same parametrized shape, mirroring how `grantedFlashback` generalizes Snapcaster's single-card case, per the issue's design notes). Adds/extends an entry on `state.graveyardPlayPermissionThisTurn`, read live by `canPlayLandsFromGraveyard` (the land half, unioned with the battlefield-derived `playsLandsFromGraveyard` permission, issue #1190) and by `getLegalActions` / `locateCastSource` / `castRawManaCost` / `graveyardCastStackFlags` (the spell half — a permission-cast pays the card's normal printed mana cost, no exile-on-resolve, distinct from Flashback/Escape which it defers to when either is also available). Cleared unconditionally at CLEANUP (CR 514.2), same boundary as `restrictCasting`/`restrictActivation`.",
    },
    {
        op: "armGraveyardRedirect",
        status: "implemented",
        cr: "614.1a",
        binding: "SpellContext.armGraveyardRedirectThisTurn",
        note: 'Arm a turn-scoped "if a card would be put into the player\'s graveyard from anywhere this turn, exile that card instead" redirect (CR 614, issue #1145 / #1149 — Yawgmoth\'s Will\'s second clause). A thin declarative Op skin over the SpellContext primitive `armGraveyardRedirectThisTurn`, shipped as engine/replacement infra by issue #1145 (the `"graveyard-bound"` `ReplacementEventKind` + `applyGraveyardBoundReplacements` apply-loop hook, `gre/replacements.ts`) with no Op skin until #1149 needed one to keep Yawgmoth\'s Will DSL-first (ADR 0045) — no new engine logic, one execution path. Adds an entry to `state.graveyardBoundRedirectThisTurn`, consulted alongside the permanent-bound `replacementEffects[]` `"graveyard-bound"` shape (Dauthi Voidwalker) but surviving the casting spell leaving the stack (a one-shot sorcery has no battlefield presence to carry a continuous effect). Cleared unconditionally at CLEANUP (CR 514.2).',
    },
    {
        op: "grantCastFromExile",
        status: "implemented",
        cr: "601.3e / 117.6",
        binding: "SpellContext.grantCastFromExile",
        note: "Grant cast/play permission for the exile card a preceding `choice(zone: \"exile\")` Op picked, optionally ALSO waiving its mana cost entirely (CR 601.3e / 117.6, issue #1156 — Dauthi Voidwalker: \"Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.\"). A thin declarative Op skin over the SpellContext primitive `grantCastFromExile`, one execution path (ADR 0045) — the wrap issue #1145's addendum comment flagged as a follow-up once the redirect-replacement (Dauthi's first ability, the `\"graveyard-bound\"` `ReplacementEventKind`) shipped. The picked card's CURRENT owner (`getExileCardOwner`, since it may sit in an OPPONENT's exile per CR 400.7) becomes the primitive's `zoneOwnerId` — this is what makes the grant CROSS-PLAYER (also the shape Robber of the Rich, eld/red.ts, already relies on) without a bespoke Op. Stamps `castableFromExileBy` (+ `castFromExileWithoutPayingManaCost` when `withoutPayingManaCost` is set) on the picked `CardInstanceState`, consulted by `castRawManaCost` (the ONE place a cast's mana cost is computed, `convex/game.ts`) and `getLegalActions`'s exile-cast affordability branch (`gre/rules.ts`). `window` mirrors the primitive's own turn-scoping.",
    },
    {
        op: "grantCastFromGraveyard",
        status: "implemented",
        cr: "601.3e / 117.6",
        binding: "SpellContext.grantCastFromGraveyard",
        note: 'Grant cast/play permission for the graveyard card a preceding Op bound (typically the just-discarded card from a choice(kind: "choose-hand-card") + discard pair), optionally ALSO waiving its mana cost entirely (CR 601.3e / 117.6-analog, issue #1344 — Malcolm, Alluring Scoundrel: "If there are four or more chorus counters on Malcolm, you may cast the discarded card without paying its mana cost"). A thin declarative Op skin over the SpellContext primitive `grantCastFromGraveyard`, one execution path (ADR 0045) — the graveyard-sourced twin of `grantCastFromExile` (issue #1156), generalizing the SAME per-card grant shape to a second zone rather than adding a card-shaped primitive (ADR 0045 primitive reuse). Always SAME-PLAYER (no `zoneOwnerId` — no cross-player graveyard-cast primitive exists in this engine, `castZoneOwner`\'s doc in `convex/game.ts`). Stamps `castableFromGraveyardBy` (+ `castFromGraveyardWithoutPayingManaCost` when `withoutPayingManaCost` is set) on the picked `CardInstanceState`, consulted by `castRawManaCost` (`convex/game.ts`) and `getLegalActions`\'s graveyard-grant affordability branch (`gre/rules.ts`). `window` mirrors the exile primitive\'s own turn-scoping. DIVERGENCE (issue #1344, out of scope): Malcolm\'s Oracle ruling requires the free cast to happen as part of the triggered ability\'s own resolution, ignoring the card\'s timing restrictions ("you can\'t wait to cast the spell later in the turn"); this Op instead grants an ordinary "this-turn" impulse cast window, the SAME simplification every other impulse-cast card in this engine already uses (Expressive Iteration, Headliner Scarlett).',
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
        op: "attach",
        status: "implemented",
        cr: "701.3a",
        binding: "SpellContext.attachTo",
        mechanicId: "attach",
        note: "Effect Script Op for the CR 701.3 keyword action \"Attach\" (the attach half) — moves $source onto the announced target permanent without leaving the battlefield (ADR 0065's unified attachment model, issue #1311). Reconfigure's first activated ability (CR 702.151a). Generalizes the Aura-only `reattachAura` primitive so a plain-Equip ability reuses the SAME Op (Lion Sash's Equip {2}), including a TARGET that is a `createToken` `bind` snapshot rather than an announced slot — Cori-Steel Cutter's (issue #1202) \"create a token... you may attach this Equipment to it\", the object-selector position accepting either transparently.",
    },
    {
        op: "unattach",
        status: "implemented",
        cr: "701.3d",
        binding: "SpellContext.detachFrom",
        mechanicId: "attach",
        note: "Effect Script Op for the CR 701.3d keyword action \"Attach\" (the unattach half) — moves $source off whatever it's attached to, remaining on the battlefield (ADR 0065, issue #1311). Reconfigure's second activated ability (CR 702.151a). No target (the CR text names nothing to unattach TO).",
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
        note: 'Optional "you may pay {cost}" decision (CR 117.3a / 118.4, issue #806) mapped 1:1 onto the existing `may-pay` Pending Choice pipeline — same enqueue, same generic Pay/Skip prompt UI, same submitMayPay mutation. The interpreter SUSPENDS the script at this Op and resumes here when the player answers; its required `bind` names a BOOLEAN binding (true = paid) read by a later `if` predicate. The counter/punisher primitive: "… unless its controller pays {2}". CR 122.1 (issue #1194) — `cost.energy` is a FIXED-count `MayPayCost` leg ("you may pay {E}{E}{E}", Guide of Souls), the declarative counterpart of the already-shipped `getEnergy` Op\'s generation half: `canPayMayPayCost` gates on `player.energyCounters >= cost.energy`, `payMayPayCost` spends via the existing all-or-nothing `SpellContext.payEnergy` primitive (#697). No new Op — `energy` composes into the SAME cost union `mana`/`life`/`sacrifice`/`discard` already ride.',
    },
    {
        op: "if",
        status: "implemented",
        cr: "608.2c",
        binding: "interpreter branch selection (no primitive)",
        note: "The `if` structural construct (ADR 0045, issue #806) — NOT an Op verb but the third frozen construct, registered here so the Op-vocabulary coverage guard (registry ⇄ interpreter ⇄ validator ⇄ scenario-assertor, 1:1) counts it. Branches the script on a PREDEFINED predicate form (a boolean-binding test — e.g. a mayPay outcome — a numeric comparison, a `picksNonEmpty` test (issue #1287) reading whether a preceding `choice` Op's picks binding actually captured anything, e.g. Krovikan Sorcerer / Mesmeric Trance's \"draw only if a card was actually discarded\" gate, a `targetIsAnother` test (issue #1315): an object-identity comparison, true iff an announced target slot resolves to a permanent OTHER than the resolving ability's source, Backup's \"if that's ANOTHER creature, it gains …\" gate (CR 702.165a), or — issue #1343 — a `picksMatchFilter` test: true iff at least one picked card, resolved via a named player's graveyard (CR 701.9 — every discard lands there), matches an `EffectCardFilter`, connive's \"if you discarded a nonland card\" gate (CR 701.50, Ledger Shredder)), never an arbitrary expression, so the validator and the bot can read the condition. then/else are Op lists; a suspending Op inside a branch suspends/resumes exactly as at the top level.",
    },
    {
        op: "sacrifice",
        status: "implemented",
        cr: "701.16",
        binding: "SpellContext.sacrifice",
        mechanicId: "sacrifice",
        note: 'Effect Script Op for the CR 701 keyword action "Sacrifice" — sacrifices either the permanents a `choice` Op picked (a bare picks ref `permanents`, e.g. { ref: "$sac" }, the "each player sacrifices …" forEach pattern, Innocent Blood, issue #807) OR a single announced target / snapshot-bound permanent (`target`, e.g. { ref: "$guard" } — "sacrifice that/this creature", Kjeldoran Elite Guard / Phantasmal Mount, issue #731; resolved through the object-ref path with a CR 608.2b battlefield re-check). The `target` form also serves a `delayedTrigger` body\'s captured object (issue #1151): `runDelayedTriggerBody` re-binds a captured battlefield permanent id as a fresh snapshot at fire time, so `{ op: "sacrifice", target: { ref: "$captured" } }` sacrifices the EXACT captured creature — the shape Sneak Attack ("…Sacrifice the creature at the beginning of the next end step") and Goblin Kites need, closing the `sacrificeObject` backlog reservation (EFFECT_OP_BACKLOG never needed a separate Op name for it). Exactly one form per Op. Indestructible does not prevent sacrifice (CR 701.16a); dies-triggers fire as for imperative cards.',
    },
    {
        op: "forEach",
        status: "implemented",
        cr: "608.2i",
        binding: "interpreter set iteration (no primitive)",
        note: 'The `forEach` structural construct (ADR 0045, issue #807) — the FOURTH and final frozen construct, closing the grammar. NOT an Op verb; registered here so the Op-vocabulary coverage guard (registry ⇄ interpreter ⇄ validator ⇄ scenario-assertor, 1:1) counts it. Iterates the body over a declaratively-selected set (players in APNAP order CR 101.4, or battlefield permanents by controller/filter), determined ONCE at construct entry (CR 608.2i) and frozen. `$each` is bound per iteration; a `choice` Op inside the body suspends/resumes per iteration through the same Pending Choice pipeline as a top-level choice. `simultaneous: true` (CR 400.7 / 614-batch, issue #1094) — valid ONLY over a `{ set: "graveyard" }` selector with the single-Op body `[{ op: "moveZone", target: { ref: "$each" }, to: "battlefield" }]` — bypasses the per-member walk entirely: the interpreter hands the WHOLE frozen set to `SpellContext.returnGraveyardSetToBattlefield` in one call, so every reanimated permanent stages onto the battlefield (and a reanimated Aura resolves its CR 303.4c host, possibly a NON-AURA SIBLING entering in the same event) before ANY of them runs its grant-application / ETB pass (Replenish). Omitted/false keeps the original sequential per-member `moveZone` walk.',
    },
    {
        op: "moveZone",
        status: "implemented",
        cr: "400.7",
        binding:
            "SpellContext.moveCardById / returnToHand / returnToBattlefield / putFromLibraryOntoBattlefield / putFromHandOntoBattlefield / putLibraryCardsOnTop / tap",
        note: 'General zone movement (CR 400.7, issue #839). A thin declarative skin over three SpellContext primitives, one execution path (ADR 0045): the object\'s CURRENT zone is inferred from its kind (a permanent → returnToHand from the battlefield; a graveyard-card → returnToBattlefield when `to` is the battlefield, else moveCardById from the graveyard). `target` is an announced slot (Unsummon, Raise Dead, Resurrection) or a bare `$source` snapshot (self-bounce — Blinking Spirit); `to` is the destination zone; there is no `from` (it is inferred). Subsumes the returnToHand / moveCardById / returnToBattlefield closures the migration classifier folds here (~35 blocked closures at ship time). SECOND SHAPE (issue #677): `cards` (a bare choice-picks ref) + `player` — the SEARCH half of a tutor/fetch effect. A library card has no announced-target form (CR 601.2b — hidden zone), so a `choice(zone:"library", kind:"search-library")` Op\'s picks are consumed here instead of via `target`: `to: "hand"`/`"graveyard"`/`"exile"` routes through `moveCardById(player, id, "library", to)` (Vampiric Tutor, Entomb), `to: "battlefield"` routes through `putFromLibraryOntoBattlefield` (a fetchland\'s "put it onto the battlefield", Natural Order), `to: "library-top"` (issue #1125, `from: "library"` only) routes through `putLibraryCardsOnTop` — the tutor-to-top template ("search…, then shuffle and put that card on top", Vampiric Tutor / Mystical Tutor / Imperial Seal / Sterling Grove): the picked card is relocated from anywhere in the library (not just a known top-N window) to the front, preserving pick order. Pair with a trailing `libraryLook`(shuffle) Op for `to: "hand"/"graveyard"/"exile"`, or a PRECEDING `libraryLook`(shuffle) for `to: "library-top"` (shuffle-then-place, per the oracle text order), as every tutor/fetch card does. `bind` (issue #1151, closing #1120 gap 3) is now also valid on the `cards` shape when `to: "battlefield"` — it snapshots the just-entered permanent so a follow-up Op can act on it (a haste grant, a `delayedTrigger` capture of the exact creature), unblocking Sneak Attack\'s "You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice it…" template.',
    },
    {
        op: "delayedTrigger",
        status: "implemented",
        cr: "603.7",
        binding: "SpellContext.scheduleDelayedTrigger",
        note: 'Grants a delayed triggered ability (CR 603.7, ADR 0048, issue #838): "At the beginning of the next <boundary>, <do something>". The delayed body is an INLINE nested Effect Script persisted on the DelayedTriggerInstance (self-contained in game state — no card-def lookup at fire time); everything the body needs from scheduling time crosses via the explicit `capture` map, resolved to serializable ids at scheduling and re-bound as the body\'s initial binding environment when the trigger fires. The two grammar gaps ADR 0048 deferred have since closed (ADR 0049): event-field captures ($event.<field> — Battering Ram, Nafs Asp, issue #865) and LIST-valued captures ({ select: EffectListSelector } re-bound as a `string[]` list binding a `forEach { set: "bound" }` iterates — Venomous Breath, issue #866, freeze-at-cast per CR 509.1h). Beyond the phase-boundary timings, an INSTANCE leave-watch timing (`leaves-battlefield` + a `watch` object ref, CR 603.7a / 603.10, issue #731) fires on the watched permanent\'s PERMANENT_LEFT ("when THAT creature leaves the battlefield this turn, …" — Kjeldoran Elite Guard, Kjeldoran Guard, Phantasmal Mount); a pending watch expires unfired at CLEANUP (the "this turn" bound, CR 514.2). A REPEATING combat-event timing (`this-turn-creature-blocks`, CR 603.7d / 603.10, issue #884) fires once per BLOCKERS_CONFIRMED event for the rest of the turn ("Whenever a creature blocks this turn, …" — Battle Cry) instead of once total: unlike every other timing it is never dequeued by firing (only purged at CLEANUP, regardless of fire count), and — because the firing event is genuinely live at fire time — its body may read `$event.blockerId` directly with no `capture` map at all (validate.ts scopes `$event` legality to this one timing\'s body). A SECOND repeating combat-event timing (`this-turn-creature-deals-combat-damage-to-player`, CR 720.2, issue #1199) mirrors that shape for Forth Eorlingas!\'s "Whenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch": it fires at most ONCE per event batch (collapsing simultaneous multi-creature/multi-player hits, per the official ruling) rather than once per matching event, and its body (`[{ op: "becomeMonarch" }]`) needs no `capture`/`$event` at all — `ctx.controller` at fire time already IS the scheduling player (the resolving stack item\'s own `controllerId`, set from the scheduling `DelayedTriggerInstance.controller`).',
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
        op: "addSubtype",
        status: "implemented",
        cr: "613.1d",
        binding: "SpellContext.addSubtype",
        note: 'Adds a creature/land/etc. subtype to a target permanent INDEFINITELY, in addition to its other types (layer 4, CR 613.1d, issue #1194 — Guide of Souls: "It becomes an Angel in addition to its other types"). A thin declarative skin over one SpellContext primitive, one execution path (ADR 0045). Distinct from the aura-style `subtype-add` STATIC EFFECT (`StaticEffect.kind === "subtype-add"`, tied to a live source via `applies`/`auraId`, unapplied when the source leaves play): this Op\'s effect is generated by a RESOLVING ability (CR 611.2c), so it does NOT depend on its source (Guide of Souls) remaining on the battlefield — the target stays an Angel even after Guide of Souls dies. Writes the SAME `grantedSubtypesAdd` instance markers the static effect uses, keyed to the `"indefinite"` sentinel source id, mirroring `SpellContext.setSupertype`\'s indefinite CR 205.4a pattern exactly (Arcum\'s Weathervane) — no new storage shape. `target` is an announced slot, the resolving source (`$source`), or a forEach `$each`; `subtype` is the single subtype string added. No-op for a non-permanent target or one that has left the battlefield (CR 608.2b).',
    },
    {
        op: "setColor",
        status: "implemented",
        cr: "613.1e",
        binding: "SpellContext.setColorOverride",
        note: 'Sets a target\'s color(s), replacing all other color derivation (layer 5, CR 613.1e, issue #1083). A thin declarative skin over the SpellContext primitive `setColorOverride`, one execution path (ADR 0045). `target` is an announced slot (a permanent or a spell — "target spell or permanent becomes the color of your choice", Blind Seer), the resolving source (`$source` — a self-color-change activated ability, Rainbow Crow / Tidal Visionary / Metathran Transport), or a forEach `$each` (Sway of Illusion\'s "any number of target creatures", paired with the new `forEach { set: "targets" }` selector below). `duration` (issue #1065) is meaningful for a permanent target only — an "until end of turn" reversion; omitted is indefinite (Dream Coat / Shyft-style, ignored for a spell target). A "choose one of five colors, then set it" modal effect composes with the pre-existing `optionChoice` Op (one mode per color, each a single-Op `setColor` body) — no new choice-kind construct needed (ADR 0045 "generalize, don\'t add"). Was `EFFECT_OP_BACKLOG`\'s `setColor` reservation (CR 613.1e, ~7 blocked closures) — promoted here.',
    },
    {
        op: "setSubtype",
        status: "implemented",
        cr: "305.7",
        binding: "SpellContext.setSubtypesUntil",
        note: 'Replaces a target land\'s subtypes for a limited duration (layer 4, CR 305.7, issue #1083). A thin declarative skin over the SpellContext primitive `setSubtypesUntil`, one execution path (ADR 0045). Distinct from `addSubtype` above (which ADDS a subtype INDEFINITELY, keeping the printed ones): this Op REPLACES the target\'s subtypes outright and always reverts at `duration` (REQUIRED — no indefinite form) — the "target land becomes a Swamp / the basic land type of your choice until end of turn" template (Orcish Farmer / Slimy Kavu precedent `resolve()` closures now composable as a DSL Op; Dream Thrush\'s "{T}: Target land becomes the basic land type of your choice until end of turn" pairs it with `optionChoice`, one mode per basic land type). Was never reserved under its own name in `EFFECT_OP_BACKLOG` — the gap was discovered and closed directly (issue #1083).',
    },
    {
        op: "animate",
        status: "implemented",
        cr: "208.2 / 611.1",
        binding: "SpellContext.animateAsCreature",
        note: 'Turns a permanent into a creature with a given base P/T, optional subtype/additionalTypes/permanently-granted keyword abilities, for `duration` (a temporary Mishra\'s-Factory-style animation, CR 611.2) or INDEFINITELY when `duration` is omitted (CR 611.2b — no revert until the permanent leaves the battlefield). A thin declarative skin over the pre-existing SpellContext primitive `animateAsCreature` (previously reachable only from a `resolve()` closure — Mishra\'s Factory, atq/colorless.ts — never a DSL Op), one execution path (ADR 0045). `target` is an announced slot, the resolving source (`$source`), or a forEach `$each`; `power`/`toughness` are the animation\'s base stats (a later `counters`/`pump` Op still applies on top, CR 613.4). Issue #1317 (Earthbend N, TLA — Badgermole Cub): `animate` (0/0, subtype "Elemental", `grantedAbilities: ["haste"]`, no `duration`) composes with the pre-existing `counters` Op (`action: "add"`, "+1/+1", count N) to fully decompose "Target land you control becomes a 0/0 creature with haste that\'s still a land. Put N +1/+1 counters on it." — no earthbend-specific Op needed (primitive-reuse mandate). See the `earthbend` row below for the keyword\'s own census entry and the scope this Op does NOT cover.',
    },
    {
        op: "libraryLook",
        status: "implemented",
        cr: "701.20",
        binding: "SpellContext.shuffleLibrary",
        note: 'Shuffle a player\'s library (CR 701.20, issue #844). A thin declarative skin over the SpellContext primitive `shuffleLibrary`, one execution path (ADR 0045): `action: "shuffle"` → shuffleLibrary (the seeded PRNG reorder that also clears every card\'s persistent knowledge, ADR 0026 — the "then shuffle" tail of a tutor, Winds of Change / Timetwister-style whole-deck randomization). `player` names whose library: the resolving controller (`"controller"`), an announced target-slot player (`{ target: N }`), or a forEach `$each` (a per-player shuffle). SCOPE (issue #844): only the `shuffle` primitive is folded — it is the one CR 401 / 701.20 library primitive expressible as a pure declarative Op (no runtime value read back into the effect). The classifier proposed folding `peekLibraryTop` / `reorderLibraryTop` too, but every closure that calls them either reads an opaque `choice` result back into `reorderLibraryTop` (Ponder, Preordain, Portent, Drafna\'s Restoration — a reorder-FROM-choice the DSL can\'t yet express) or drives a mill loop off the live top id (Millstone, Thought Scour, Ray of Erasure, Deep Spawn — needs a `mill` Op). Those two primitives stay a `planned` backlog Op (`scryReorder`) until a choice-driven reorder / mill construct exists. See `scripts/migration-classifier.mjs` OP_SEQUENCE.',
    },
    {
        op: "shuffleSelfIntoLibrary",
        status: "implemented",
        cr: "608.2",
        binding: "SpellContext.shuffleSelfIntoLibrary",
        note: "The resolving spell shuffles ITSELF into its owner's library instead of its graveyard (CR 608.2m default / CR 701.24 shuffle, issue #898: \"Shuffle Green Sun's Zenith into its owner's library\"). A thin declarative skin over the single SpellContext primitive `shuffleSelfIntoLibrary`, one execution path (ADR 0045): the primitive flags the CURRENTLY-RESOLVING stack item (`shuffleIntoLibraryOnResolve`), which `finalizeSpellResolution` (convex/gre/state.ts) checks BEFORE the normal graveyard placement — mirroring the existing `exileSelf` self-redirect design (Recall, CR 608.2 \"Exile <this spell>\") exactly, but targeting the library (reusing the same seeded-PRNG shuffle + knowledge-clear as `shuffleLibrary`/`libraryLook`) instead of exile. Unlike `exileSelf` (which has no DSL Op — every card using it is `resolve()`), this IS exposed as an Op because Green Sun's Zenith is a DSL-first card (ADR 0045) with no other reason to fall back to `resolve()`. No parameters: it always applies to the currently-resolving spell card; no-op for an ability (no card to move) or a spell copy (CR 707.10 — a copy ceases to exist, it is never shuffled anywhere).",
    },
    {
        op: "scryReorder",
        status: "implemented",
        cr: "701.22",
        mechanicId: "scry",
        binding: "SpellContext.orderTop",
        note: "Look at / reorder the top of a library (CR 401.4 look, CR 701.22 Scry, CR 701.44 Surveil, order-only; issue #885). A thin declarative skin over the single SpellContext primitive `orderTop` — the reusable drag-picker the imperative scry/surveil/put-back cards already share — one execution path (ADR 0045). SUSPENDS like `choice`/`mayPay`: the first execution raises the `order-top` PendingChoice on the top `count` cards (projected face-up as `libraryPeek`); on resume the KEPT cards return to the top in the chooser's order and the un-kept cards go to `destination` (`library-bottom` = Scry, Preordain; `graveyard` = Surveil; `none` = order-only, Ponder). The reorder-FROM-choice half deferred out of libraryLook (issue #844): its pick is consumed internally by `orderTop`, so there is no `bind` read by a later Op. The mill loop the same backlog note bundled ships as the separate `mill` Op below (a deterministic move, no choice).",
    },
    {
        op: "mill",
        status: "implemented",
        cr: "701.17",
        mechanicId: "mill",
        binding: "SpellContext.millCards",
        note: 'Mill: move the top `count` cards of a player\'s library into their graveyard (CR 701.17, issue #885). A thin declarative skin over the single `millCards` SpellContext primitive (issue #1055 — the mill twin of `drawCards`), one execution path (ADR 0045): `millCards` re-reads the LIVE top id each pass and moves it library → graveyard, stopping early when the library empties (CR 701.17a). Deterministic — no player choice, so unlike `scryReorder` it does not suspend. `player` names whose library is milled (an announced target slot — "target player mills N"; the resolving controller; or a forEach `$each`); `count` is the number milled. EMITS a CARD_MILLED event per card (issue #1055) so "when this card is put into your graveyard from your library" self-triggers fire (Gaea\'s Blessing) — the mill choke point, mirroring `drawCards`/CARD_DRAWN. Previously composed peekLibraryTop + moveCardById inline (no event); folded into `millCards` when the mill trigger shipped.',
    },
    {
        op: "digToHand",
        status: "implemented",
        cr: "401.4",
        binding:
            "SpellContext.peekLibraryTop / requestChoice / readOrderedSecond / moveCardById / reorderLibraryTop / markKnown",
        note: 'Dig to hand (CR 401.4 "look at", issue #984, extended #1101): look at the top `look` cards of a library, put `take` of them (default 1) into hand, and send the rest to `destination` (the library BOTTOM by default, in any order, or the GRAVEYARD — issue #1101, Reviving Vapors). A thin declarative skin composed of existing primitives (the Stock Up composition generalized), one execution path (ADR 0045): `peekLibraryTop(look)` reveals the top cards; a single suspending `look-distribute` `requestChoice` over exactly those ids (candidateIds = the looked-at top N, projected face-up as `libraryPeek` — never the whole hidden library, the `search-library` over-exposure) drives the unified HAND/second pick (count = EXACTLY `keep` to hand); the kept cards move library→hand via `moveCardById`; the remaining looked-at cards go to `destination` — bottomed via `reorderLibraryTop` in the player\'s CHOSEN order (read back via `readOrderedSecond`) for the `library-bottom` default, or moved one at a time via `moveCardById` (the SAME graveyard-bound-redirect-eligible move `scryReorder`\'s Surveil leg uses) for `destination: "graveyard"`. SUSPENDS like `choice`/`scryReorder` — the pick is consumed internally by default. The bottom cards are marked known to the controller via `markKnown` (ADR 0026): the player looked at and PLACED them, so their bottom position is certain and Impulse\'s "in any order" (CR 401.4) is a real choice — the projection exposes them as the contiguous known run from the bottom until a shuffle; a graveyard destination skips `markKnown` (already a public zone). A bot/auto path may submit only the hand picks (empty `secondZoneIds`), and then the rest auto-resolve to `destination` in look order. `player` names whose library; `look` is how many to look at; `take` is how many kept (default 1, clamped to the number looked at). DISTINCT from the exile-and-may-play "impulse draw" (#791): the chosen card enters HAND and the rest leave the library entirely — no exile, no play window. Impulse (MMQ) = look 4, take 1. FOUR optional refinements: `filter` restricts the HAND-eligible subset to looked-at cards matching an `EffectCardFilter` (issue #1266, Narset\'s "noncreature, nonland card", `excludeType: ["Creature","Land"]`) — precomputed as the candidateIds allow-list, exactly like the library branch of `choiceCandidates`; the filtered-out looked-at cards always go to `destination`. `optional` makes the hand pick a "you MAY" (count min 0, up to `take`). `randomBottom` (issue #1266) bottoms the rest WITHOUT a player-ordering pick and WITHOUT `markKnown` — CR 401.4\'s "random order" is unobservable for face-down library cards, so the physical permutation carries no game information and no knowledge is granted (the material half — no player choice of order, no knowledge — is what is honored); meaningless for a graveyard destination (a public zone has nothing to hide). `bind` (issue #1101, mirrors destroy/exile\'s SNAPSHOT-family object bind — NOT a `choice` Op\'s picks list) snapshots the FIRST kept card right after the library→hand move, so a later Op reads it back through the ordinary `EffectObjectSelector` bare-ref path (`manaValue: { of: { ref: "$name" } }` sizing Reviving Vapors\' `gainLife`); the bound object resolves as `TargetSelection.type: "hand-card"` (a new target-selection kind, since the card lives in hand, never becomes a permanent) via `resolveObjectRef`\'s hand-lookup fallback and `SpellContext.getManaValue`\'s matching branch. Narset −2 = look 4, take 1, filter noncreature/nonland, optional, randomBottom. Reviving Vapors = look 3, take 1, destination graveyard, bind the kept card, followed by `gainLife` sized off it.',
    },
    {
        op: "putBack",
        status: "implemented",
        cr: "401.4",
        binding: "SpellContext.moveHandCardToLibraryTop / requestChoice",
        note: "Put N cards from a hand on top of a library, in the player's chosen order (\"put N cards from your hand on top of your library in any order\", CR 401.4, issue #1046 — unblocks Brainstorm's DSL migration). A thin declarative skin over the single SpellContext primitive `moveHandCardToLibraryTop`, one execution path (ADR 0045): raises a suspending `choose-hand-card` `requestChoice` over the resolved player's hand (`count` cards, clamped to hand size — CR 608.2b); on resume each picked card is moved to the top via `moveHandCardToLibraryTop`, which unshifts, so the LAST picked card lands literally on top — the player's pick order IS the resulting top-to-bottom order. SUSPENDS like `choice` / `scryReorder` / `digToHand`: the pick is consumed internally, no `bind` read by a later Op — and the checkpoint an EARLIER Op in the same script set (e.g. `draw`) is never re-run on resume (CR 608.3), the exact bug the old Brainstorm `resolveSteps` split fixed by hand. Distinct from `moveZone`'s `to: \"library-top\"` shape (issue #1125), which only moves FROM the library (a tutor-to-top, `putLibraryCardsOnTop`) — this Op moves a chosen HAND subset instead, the gap `moveZone` / `scryReorder` / `libraryLook` / `mill` all left uncovered (checked against the registry at issue time). The moved cards are marked known to the controller (ADR 0026 — the player chose them and their order, so their top position is certain until a shuffle). `player` names whose hand/library (the resolving controller, an announced target slot, or a forEach `$each`); `count` is how many cards to put back.",
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
        op: "transform",
        status: "implemented",
        cr: "701.27",
        mechanicId: "transform",
        binding: "SpellContext.transform",
        note: 'Transform a permanent (CR 701.27 keyword action / CR 712 double-faced permanents, issue #1210, ADR 0067). A thin declarative skin over the single SpellContext primitive `transform`, one execution path (ADR 0045): `target` names the permanent to flip — almost always the resolving source (`$source` — "{2}: Transform this artifact", the Incubator token shape, CR 701.53 Incubate), but an announced target slot or a forEach `$each` member is accepted for generality. CR 712.8a — the SAME toggle flips EITHER direction: front → back if the permanent is currently showing its front, back → front if it\'s already transformed, so a card never needs two Ops. The primitive (`gre/transform.ts`) mirrors the `faceDown.ts` definition-swap pattern: it registers (or reuses) a synthesized back-face `CardDefinition` from `CardDefinition.backFace` / `TokenSpec.backFace`, swaps the instance\'s `card.card.id` to it, and overwrites the mutable characteristic fields (types/subtypes/power/toughness/staticAbilities) in place — so every existing reader (layers, combat, activated-ability discovery, SBA creature-ness checks) observes the new face automatically, no new "effective card" seam needed. Unlike face-down morph (CR 707.4), transform is always PUBLIC information (CR 712.1a) — no per-viewer hiding at the projection boundary. No-ops when the target is gone (CR 608.2b) or its current face declares no `backFace` — nothing to flip to/from. SCOPE: only a permanent ALREADY on the battlefield transforming in place is modelled; a full two-sided-card CASTING model (choosing which face to cast, a distinct mana cost per face, CR 711) is out of scope.',
    },
    {
        op: "createToken",
        status: "implemented",
        cr: "701.7",
        mechanicId: "create",
        binding: "SpellContext.createToken",
        note: "Create token permanents (CR 111 / 701.7 keyword action \"Create\", issue #847). A thin declarative skin over the single SpellContext primitive `createToken`, one execution path (ADR 0045): `token` is the JSON-pure token spec (EffectTokenSpec — name + card types required; subtypes, supertypes, P/T, colors, keyword static abilities and token art optional), `controller` names who gets the tokens (the resolving controller — The Hive's Wasp, Master of the Hunt's Wolves, the Saproling / Thrull / Goblin token engines; an announced target-slot player; or a forEach `$each` for a per-player creation), and `count` is an optional EffectValue (default 1; a literal / ref / count for a count-scaled creation, e.g. Goblin Warrens' three Goblins). A non-positive count creates nothing (CR 707.1). SCOPE (issue #847): only the plain spec-driven `createToken` primitive is folded — the JSON-pure spec that carries no closure. `createTokenCopyOf` (create a token that's a COPY of a target creature — Dance of Many) reads a runtime source creature and drives the copy machinery, so it is NOT a pure declarative skin; it stays a `planned` backlog Op (`createTokenCopy` below). A token needing continuous `staticEffects` (Tetravite's \"can't be enchanted\", a predicate closure) is likewise not JSON-expressible — `EffectTokenSpec` omits `staticEffects`, so such a token stays resolve(). No `createdBy` provenance is stamped — provenance-linked token engines (Tetravus, Tawnos's Wand) are multi-Op choice-scoped cards that stay resolve() this wave. `bind` (issue #1202) snapshots the LAST created token — mirrors `destroy`/`exile`/`moveZone`'s own `bind` field, same snapshot-family binding — so a follow-up Op in the same script can act on the just-created permanent with no announced-target form (Cori-Steel Cutter: \"create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it\").",
    },
    {
        op: "emblem",
        status: "implemented",
        cr: "114.2",
        binding: "SpellContext.createEmblem",
        note: "Create a command-zone emblem (CR 114, issue #1221). A thin declarative skin over the single SpellContext primitive `createEmblem`, one execution path (ADR 0045). `emblem` is a KEY into the emblem registry (`convex/cards/emblems.ts`) — the granted continuous/triggered abilities carry closures (`applies`/`matches`/`resolve`), so they can't be inlined in a JSON-pure Op body (ADR 0046); the emblem is referenced by id exactly as a token references its synthesized card def, and game state stores only the pure-data `EmblemInstance` (key + owner + display fields). `controller` (default \"controller\") is the emblem's owner (CR 114.3). The emblem's OWN body reuses existing machinery: a continuous ability is a `pt-buff`/other `StaticEffect` collected owner-scoped by the layer system with no permanent source (Sorin, Lord of Innistrad's \"Creatures you control get +1/+0\" anthem, the shipped tracer); a triggered ability is collected owner-scoped by the trigger scanner and resolves through the same interpreter seam as any trigger — so the emblem's effect can itself be an Effect Script of existing sub-Ops. Emblems can't be targeted/removed and persist the rest of the game (CR 114.4), so there is no permanent source to leave play. Not a CR-701 keyword action, so no `mechanicId` (like `dealDamage`).",
    },
    {
        op: "becomeMonarch",
        status: "implemented",
        cr: "720.2",
        binding: "SpellContext.becomeMonarch",
        note: 'Crown a player the Monarch (CR 720, issue #1199). Monarch is an ability-word / game-state designation (GameState.monarchId), NOT a CR 702 keyword — no MECHANICS_REGISTRY keyword row, only this Op row. A thin declarative skin over the single SpellContext primitive `becomeMonarch`, one execution path (ADR 0045): `controller` (default "controller") names who is crowned — the resolving controller (Forth Eorlingas!\'s "You become the monarch", Palace Jailer\'s ETB) or an announced target-slot / relative player. The primitive is idempotent (already-the-monarch is a no-op, CR 720.2/720.3\'s "unless already the monarch") and self-reassigning (crowning someone new displaces the prior holder for free — a single scalar, no separate "stop being monarch" Op). The two CR 720 SYSTEM triggers (720.3 "combat damage to the monarch steals it" and 720.4 "the monarch draws at their end step") are engine-owned hooks in phases.ts (`applyOneCombatDamage`\'s player branch; `END_STEP` phase entry), not Effect Script bodies — no card declares them. Used by Forth Eorlingas! (LTC) and Palace Jailer (CN2).',
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
    {
        op: "winGame",
        status: "implemented",
        cr: "104.2a",
        binding: "SpellContext.winGame",
        note: 'Designate the winning player (CR 104.2a, issue #1066 — Coalition Victory). A thin declarative skin over the single SpellContext primitive `winGame`, one execution path (ADR 0045): sets `state.gameOver` through the SAME seam State-Based Actions use (`checkGameOverSBA`, `gre/sba.ts`) — winnerId = the resolved `player`, loserId = the opponent, reason "alternate-win" (the only `gameOver.reason` with no CR 704.5 "why the loser lost" story, since there is none — the winner is DESIGNATED, not the loser defeated). No-op if the game already ended (mirrors `drawGame`\'s guard). The Op itself carries no predicate — Coalition Victory gates it behind nested `if`s (a `{ domain: { of } } >= 5` land-of-each-basic-type check, five `count` checks for a creature of each color) built entirely from EXISTING constructs, so the win condition needed no new predicate grammar. SCOPE (issue #1066): the 2-player `state.gameOver` seam only — no "can\'t win the game" replacement hook (Platinum Angel) exists yet; noted as a future extension point, not built (no INV card needs it).',
    },
    {
        op: "divideIntoPiles",
        status: "implemented",
        cr: "608.2",
        binding: "SpellContext.requestChoice + SpellContext.requestPickPile",
        note: "CR-generic \"separate a set of objects into two piles, another player chooses one\" divide-then-choose cycle (ADR 0053, pile division, issue #1067 — Fact or Fiction, Do or Die, Death or Glory, Bend or Break, Fight or Flight, Stand or Fall). Drives a new two-step `DividePilesKind` pending-choice family riding the existing persisted `pendingChoices` array (no new top-level GameState key): step 1 (`divide-piles`) reuses the ordinary zone-pick `requestChoice` shape for the divider's total 2-way partition of `objects`; step 2 (`pick-pile`) is the new `requestPickPile` primitive for the chooser over the completed piles. `chosenEffect` / `otherEffect` (ordinary EffectOp[] reusing `destroy` / `moveZone` / `forEach` / `restrictCombat`) then run against `chosenBind` / `otherBind` — LIST bindings (ADR 0049's family) naming the two pile id lists. One Op, six cards, DSL-first (ADR 0045) — no card needed a `resolve()` closure.",
    },
    {
        op: "restrictCombat",
        status: "implemented",
        cr: "508.1a",
        binding: "SpellContext.setCantAttackThisTurn / setCantBlockThisTurn",
        note: 'Grant a turn-scoped "can\'t attack" (CR 508.1a) or "can\'t block" (CR 509.1b) restriction to a permanent (ADR 0053, pile division — Fight or Flight\'s unchosen attacking pile, Stand or Fall\'s unchosen blocking pile). A thin declarative skin over the two existing SpellContext primitives, one execution path (ADR 0045) — the same restriction-grant reuse `tapUntap` already established for tap/untap. Cleared at CLEANUP (CR 514.2) like every other "this turn" combat flag.',
    },
    {
        op: "nameCard",
        status: "implemented",
        cr: "201.3",
        binding: "SpellContext.requestNameCard",
        note: 'Names a card as part of resolution (CR 201.3 / 202.3, issue #1085 — Desperate Research: "Choose a card name other than a basic land card name"). A thin declarative skin over the single SpellContext primitive `requestNameCard`, one execution path (ADR 0045): SUSPENDS like `choice` / `mayPay` — the binding name doubles as the choiceId, so the stored chosen name IS the picks-family binding (a single-element string array, the identical runtime shape a `choice` Op\'s picks use) a later `EffectCardFilter.name` bare ref reads back. `player` names the chooser; `bind` is REQUIRED (a name choice nothing reads back is meaningless); `excludeBasicLand` (CR 201.3\'s "other than a basic land card name") is checked at SUBMIT time (`applyNameCardSubmit`) — the chooser is asked again on an illegal name, exactly like every other rejection in that pipeline. Was `EFFECT_OP_BACKLOG`\'s `nameCard` reservation (CR 201.3, ~3 blocked closures) — promoted here.',
    },
    {
        op: "digMatchingToHand",
        status: "implemented",
        cr: "701.20a",
        binding:
            "SpellContext.peekLibraryTop / markKnownToAll / getLibraryCards / moveCardById",
        note: 'CR 701.20a reveal / CR 401.4 look (issue #1085 — Desperate Research: "Reveal the top seven cards of your library and put all of them with that name into your hand. Exile the rest."). Deterministic sibling of `digToHand`: reveals the top `look` cards of `player`\'s library to EVERY player (unlike `digToHand`\'s private per-chooser look), puts EVERY looked-at card matching `filter` into hand with NO player choice (the filter alone decides — CR 608.2b, zero matches is a no-op for the hand leg), and sends every non-matching looked-at card to `destination` ("exile" — Desperate Research; "graveyard" — a Surveil-shaped future card). A thin declarative composition over four existing SpellContext primitives, one execution path (ADR 0045); `filter` is REQUIRED (a filter-less "look N, keep all" dig is already `digToHand`\'s job with `take` = `look`). `bind` (optional) snapshots the FIRST card put into hand, mirrors `digToHand`\'s own `bind`. No new SpellContext primitive — pure composition, per the "generalize, don\'t add" primitive-reuse rule.',
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
 *  EFFECT_OP_REGISTRY row (PRD #826). `counters` (issue #1015, CR 122.6) is
 *  likewise a value-grammar member and NOT an Op — the number of counters of a
 *  type on a selected object (`{ counters: { of, type } }`), a thin skin over
 *  SpellContext.getCounterCount. It extends the value grammar to
 *  `literal | ref | count | X | counters`; like `X` it does NOT reopen ADR 0045
 *  (not a structural construct) and earns no EFFECT_OP_REGISTRY row. It unblocks
 *  the "value equal to the number of <type> counters on it" class (Powder Keg's
 *  MV-matched sweep, issue #997). The `count` value's `times` multiplier and
 *  the `EffectCardFilter.excludeSupertype` field (issue #999, CR 122 / 205.4a)
 *  are likewise NOT Ops and NOT new grammar members — they are REFINEMENTS of
 *  the existing `count` value (a fixed literal scaling factor and a
 *  supertype-exclusion filter, the "nonbasic land" selector), mirroring the
 *  already-shipped `excludeType` / `acrossAllPlayers` refinements. Neither
 *  reopens ADR 0045 (no structural construct, no arithmetic composition — a
 *  constant baked into one count) and neither earns an EFFECT_OP_REGISTRY row.
 *  They unblock the "damage/value equal to TWICE the number of nonbasic lands"
 *  class (Price of Progress, issue #999). `negate` (issue #926, `{ negate:
 *  <value> }`) is likewise NOT an Op and NOT a new grammar member — it is a
 *  unary sign flip scoped to the SIGNED value grammar (`EffectSignedValue`,
 *  today only `pump`'s power/toughness), not a tenth `EffectValue` member, so
 *  it earns neither an EFFECT_OP_REGISTRY row nor a MECHANICS_REGISTRY row
 *  (unlike Domain, it names no CR keyword or ability word). It unblocks
 *  "-X/-X" style pump amounts driven off a non-negative-by-nature value
 *  member (Toxic Deluge's chosen-cost X, CR 118.4 pay-X-life). */
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
    // primitive); peekLibraryTop / reorderLibraryTop stayed backlogged as
    // scryReorder — which SHIPPED (issue #885) as TWO orthogonal Ops now live
    // in EFFECT_OP_REGISTRY: `scryReorder` (the choice-driven look/reorder skin
    // over SpellContext.orderTop — Ponder, Preordain, Surveil) and `mill` (the
    // deterministic library→graveyard loop — Millstone, Thought Scour).
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
    // `setColor` SHIPPED (issue #1083) — SpellContext.setColorOverride is now
    // COVERED live via EFFECT_OP_REGISTRY with status "implemented". Unblocks
    // Blind Seer / Rainbow Crow / Tidal Visionary / Metathran Transport / Sway
    // of Illusion (INV) via a "choose one of five colors" `optionChoice` +
    // one-mode-per-color `setColor` composition (no new choice-kind Op
    // needed). `setSubtype` (land-type-change twin, `setSubtypesUntil`) SHIPPED
    // alongside it in the same slice — see the EFFECT_OP_REGISTRY row; it was
    // never reserved in this backlog under its own name (Dream Thrush).
    // `nameCard` SHIPPED (issue #1085) — SpellContext.requestNameCard is now
    // COVERED live via EFFECT_OP_REGISTRY with status "implemented". Unblocks
    // Desperate Research (INV) paired with the new `digMatchingToHand` Op
    // (also shipped in the same slice, never reserved here under its own
    // name — a filter-driven reveal-and-split composition, not a new
    // SpellContext primitive).
    {
        op: "lockUntap",
        status: "planned",
        cr: "502.3",
        note: 'Untap-step restriction ("doesn\'t untap while …", CR 502.3). Folds SpellContext.lockUntapWhileSourceTapped / skipNextUntap (~9 blocked closures). Long-tail.',
    },
    // `sacrificeObject` (issue #1151) CLOSED — removed from this backlog, not
    // promoted to EFFECT_OP_REGISTRY as a separate Op. Its design sketch
    // ("likely a parametrization of the existing `sacrifice` Op with an
    // object-selector form, resolved through resolveObjectRef like `destroy`")
    // is exactly what shipped: the `sacrifice` row above already documents the
    // single-object `target` form (CR 701.16, issue #731, Kjeldoran Elite
    // Guard / Phantasmal Mount) that this reservation was holding a name for.
    // A distinct `sacrificeObject` Op name was never needed. See the
    // `sacrifice` row's note for the shipped shape.
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

/** CR 122.1c / 613.4d (issue #1194) — "Some counters are named for keyword
 *  abilities... An object with such a counter has the keyword ability with
 *  the same name as the counter, in addition to any abilities it has that
 *  are printed on it or that it gains from other effects." A counter
 *  GRANTS its matching keyword only when the counter's TYPE case-
 *  insensitively equals a `kind: "keyword-ability"` row's plain `name`
 *  (Flying, Vigilance, …) AND that row is `status: "implemented"` — a
 *  `flying` counter is inert unless the engine actually enforces flying, and
 *  a counter naming a `planned`/`out-of-scope` keyword grants nothing (same
 *  gate as Guard A, `KEYWORD_ALLOWLIST`, for a card's OWN `staticAbilities`).
 *  Deliberately excludes `bindingPattern` rows (protection, rampage N,
 *  landwalk, "bands with other …") — a bare counter TYPE STRING has no
 *  parameter slot to carry "from red" / "2", so only the plain, unparametrized
 *  keyword-ability rows are eligible. Returns the canonical LOWERCASE keyword
 *  string (`target.staticAbilities`'s casing convention, e.g. "flying") to
 *  push, or `undefined` when `counterType` doesn't name a grantable keyword
 *  (the vast majority of counter types — +1/+1, charge, poison, ...). Consumed
 *  by `SpellContext.addCounter` / `removeCounter` (`gre/state.ts`) to keep
 *  `staticAbilities` in sync with keyword-named counters, mirroring the
 *  mutation-sync discipline every other keyword-grant channel
 *  (`grantStaticAbility`, aura `keyword-grant` static effects) already uses. */
export function getKeywordCounterGrant(
    counterType: string
): string | undefined {
    const lower = counterType.toLowerCase();
    const row = MECHANICS_REGISTRY.find(
        (r) =>
            r.kind === "keyword-ability" &&
            r.status === "implemented" &&
            !r.bindingPattern &&
            lower === r.name.toLowerCase()
    );
    return row ? row.name.toLowerCase() : undefined;
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
    // CR 508.1 — attacker declaration. `ATTACKERS_DECLARED` carries the full
    // `attackerIds` list; `soleAttacker` FLATTENS it to a single id ONLY when
    // exactly one creature was declared (CR 702.83 Exalted's "attacks alone"),
    // and is undefined otherwise (CR 608.2b — the reading Op then skips). This
    // is the object-family field Exalted's expanded trigger pumps: the lone
    // attacker, which need not be the exalted source itself. Issue #699.
    ATTACKERS_DECLARED: {
        soleAttacker: {
            family: "object",
            resolve: (e) =>
                e.type === "ATTACKERS_DECLARED" && e.attackerIds.length === 1
                    ? e.attackerIds[0]
                    : undefined,
        },
    },
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
    // when the damage went to a permanent (no player was damaged). `damagedPermanent`
    // (issue #1078, Voracious Cobra: "whenever this creature deals combat damage
    // to a creature, destroy that creature") is the OBJECT-family twin: the
    // damaged permanent's instance id, or undefined when the damage went to a
    // player instead. `resolveObjectRef`'s generic `$event.<field>` branch
    // (ADR 0049) already resolves any object-family row through the same
    // battlefield-presence recheck `damagedPlayer` gets for players — no
    // interpreter change needed, just this census row.
    DAMAGE_DEALT: {
        damagedPlayer: {
            family: "player",
            resolve: (e) =>
                e.type === "DAMAGE_DEALT" && e.target.type === "player"
                    ? e.target.id
                    : undefined,
        },
        damagedPermanent: {
            family: "object",
            resolve: (e) =>
                e.type === "DAMAGE_DEALT" && e.target.type === "permanent"
                    ? e.target.id
                    : undefined,
        },
    },
    // CR 603.6a — "at the beginning of [step]". `activePlayerId` is the player
    // on whose step the event fired (issue #1066 — Collapsing Borders' "at the
    // beginning of EACH PLAYER'S upkeep, THAT PLAYER gains life…"). Unblocks a
    // `phaseTrigger({ scope: "each" })` DSL `effects[]` body: the factory's own
    // doc note ("effects only valid with scope: 'your'") holds for every OTHER
    // phase trigger because `ctx.controller` is the ability's controller, not
    // the scoped player — this ref reads the scoped player directly off the
    // firing event instead of `ctx.controller`, so an `each`-scope trigger can
    // target the right player without going imperative.
    PHASE_BEGIN: {
        activePlayerId: {
            family: "player",
            resolve: (e) =>
                e.type === "PHASE_BEGIN" ? e.activePlayerId : undefined,
        },
    },
    // CR 603.6a — "whenever a [permanent] enters, ... its controller ..."
    // (issue #1072 — Tectonic Instability: "tap all lands ITS CONTROLLER
    // controls" for ANY land entering, not just this permanent's own
    // controller). Unblocks a plain (non-`enteredTrigger`-scoped) `effects[]`
    // body from reading the entering permanent's controller directly off the
    // firing event, mirroring the `PHASE_BEGIN.activePlayerId` row above.
    PERMANENT_ENTERED: {
        controllerId: {
            family: "player",
            resolve: (e) =>
                e.type === "PERMANENT_ENTERED" ? e.controllerId : undefined,
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
