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
// CR numbering source: the VENDORED official Comprehensive Rules
// (`data/cr/comprehensive-rules.txt`, effective date in `data/cr/VERSION.json`,
// ADR 0098) — print a row's number with `bun run cr <id>` / `bun run cr grep`,
// never copy it from memory or from a stale in-repo comment. Section numbers
// shift between CR editions as new keywords are inserted (banding.ts cites
// "CR 702.21", which is Ward in every edition since 2022; Banding is 702.22 —
// this registry uses the current number and does not "fix" the older comment,
// which is out of scope for this census and tracked by `bun run cr:lint`).
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
        status: "implemented",
        // Surveil N (CR 701.25 — modern CR renumber of 701.44) is the
        // `scryReorder` Op with `destination: "graveyard"`: look at the top N,
        // keep any on top in the chosen order and put the rest into the
        // graveyard. Same single execution path as Scry (the shared
        // `SpellContext.orderTop` drag-picker), differing only in the
        // un-kept-card destination. Shipping on the MKM surveil-land cycle
        // (mkm/colorless.ts) since issue #885; reused by Consider
        // (mid/blue.ts) and Master of Death (mh2/multicolor.ts).
        binding:
            'scryReorder Op, destination "graveyard" (SpellContext.orderTop)',
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
        binding:
            'SpellContext.transform / EffectOp "transform" + SpellContext.exileAndReturnTransformed / EffectOp "exileAndReturnTransformed"',
        note: "Permanent-level transform machinery (CR 712 double-faced permanents, issue #1210, ADR 0067): a `backFace` spec on `CardDefinition`/`TokenSpec`, a `transformed`/`transformedFrom` face-flag pair on `CardInstanceState`, the pure `transformPermanent` mutator (`gre/transform.ts`, mirrors `faceDown.ts`'s definition-swap pattern), and the `transform` Effect Op. TWO OBJECT IDENTITIES, two primitives (issue #2380): (a) IN-PLACE — a permanent ALREADY on the battlefield flips without changing zones (a paid activated-ability cost, e.g. the Incubator's \"{2}: Transform this artifact\"), so CR 400.7 does not apply and the SAME object keeps its counters, attachments and summoning-sickness clock; (b) EXILE-AND-RETURN-TRANSFORMED — \"exile it, then return it to the battlefield transformed under its owner's control\" (the ORI flip-walker cycle: Jace, Vryn's Prodigy; Kytheon; Liliana; Nissa; Chandra; Tamiyo, Inquisitive Student), two REAL zone changes, so what returns is a NEW object (CR 400.7 — counters gone, Auras/Equipment fallen off, ETB triggers fire again, stack targets no longer find it) and a PLANESWALKER back face enters with its own CR 306.5b starting loyalty (`CardBackFace.loyalty`). The two are siblings, never modes of one another. A full two-sided-card CASTING model (choosing a face to cast, per-face mana cost, CR 711) remains out of scope.",
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
    // 701.29 Fateseal (shipped by decomposition, issue #1532)
    {
        id: "fateseal",
        name: "Fateseal",
        kind: "keyword-action",
        cr: "701.29",
        status: "implemented",
        binding:
            'EFFECT_OP_REGISTRY `scryReorder` Op with `player: { target }` + `chooser: "controller"` (the chooser≠zone-owner seam, PendingChoice.zoneOwnerId) — no dedicated Op, primitive reuse. Shipped on Jace, the Mind Sculptor\'s +2 (convex/cards/sets/wwk/blue.ts).',
        note: "Fateseal N (CR 701.29a) is Scry N on an OPPONENT's (any target player's) library, decided by the fatesealing player — same execution path as Scry, differing only in whose library is looked at and who chooses.",
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
        status: "implemented",
        binding: "convex/cards/abilities/amass.ts amassOps",
        note: 'CR 701.47a — "To amass [subtype] N means \'If you don\'t control an Army creature, create a 0/0 black [subtype] Army creature token. Choose an Army creature you control. Put N +1/+1 counters on that creature. If it isn\'t a [subtype], it becomes a [subtype] in addition to its other types.\'" Like Adapt (CR 701.46) it is a keyword ACTION, never a bare `staticAbilities[]` grant string — it appears as the tail of another effect ("Then amass Orcs 1."), so the row is the CR 701 census entry and the name authority for the `amassOps` factory. NO new Op (primitive reuse, ADR 0045 § primitive reuse): all four steps of CR 701.47a decompose into ALREADY-exercised primitives — the `if` construct\'s comparison predicate over a `count` EffectValue (battlefield permanents filtered `{ type: "Creature", subtype: "Army" }` under `controller`) for "if you don\'t control an Army creature"; `createToken` with `makeArmyTokenSpec(subtype)` for the 0/0 black token; the `choice` Op (kind `choose-permanents`) piped into `forEach { set: "bound" }` — the Frantic Search shape (sets/ulg/blue.ts, issue #1284) — for "choose an Army creature you control", raised ONLY in the `else` arm where 2+ Armies exist, since `choose-permanents` has no single-candidate auto-resolve and a zero-branch prompt is a UX regression (the forced 0/1-Army path is the `then` arm, which is also the arm the bot script walker values); and `counters` (action add, "+1/+1") + `addSubtype` (CR 613.1d layer 4, cumulative across amass sources) on the `$each` loop variable. Shipped on Orcish Bowmasters (convex/cards/sets/ltr/black.ts). N accepts any `EffectValue`, so a dynamic "amass X" composes without engine work.',
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
    // 701.50 Connive (issue #780 — shipped by decomposition, issue #1343)
    {
        id: "connive",
        name: "Connive",
        kind: "keyword-action",
        cr: "701.50",
        status: "implemented",
        binding:
            "Effect Script composition, no dedicated Op (ADR 0045 § primitive reuse): `draw` + `choice` (kind choose-hand-card) + `discard` + `if` with the `picksMatchFilter` predicate (gre/effects/interpreter.ts) + `counters` add +1/+1. Shipped on Ledger Shredder (convex/cards/sets/snc/blue.ts).",
        note: 'Connive N (CR 701.50a): draw N, then discard N; for each nonland card discarded this way, put a +1/+1 counter on the conniving creature. The nonland gate is the `picksMatchFilter` `if` predicate (issue #1343), which resolves the picked cards through the discarding player\'s graveyard (CR 701.9) and tests them against an EffectCardFilter — `{ excludeType: "Land" }` here. Connive N > 1 is the same script with count: N on the draw/choice Ops; no engine work outstanding.',
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
        status: "implemented",
        binding:
            "createToken Op + makeIncubatorTokenSpec/incubateOp (cards/abilities/tokens/incubatorToken.ts)",
        note: 'Both engine gaps confirmed in #924 were CLOSED by #1210: (1) permanent-level transform/DFC machinery (CardDefinition.backFace / TokenSpec.backFace, the transformed/transformedFrom face flag, transformPermanent, the `transform` Effect Op — CR 712, ADR 0067); (2) TokenSpec/EffectTokenSpec.entersWith.counters for dynamic counters-at-creation (token-scoped activatedAbilities already shipped, issue #778/#1191). #924 wires the remaining composition: `incubateOp(N)` is `{ op: "createToken", token: makeIncubatorTokenSpec(N), controller }` — a front-face colorless Artifact "Incubator" token with N +1/+1 counters and "{2}: Transform this artifact.", whose backFace is a 0/0 colorless Phyrexian artifact creature token. N accepts any `EffectValue` (a literal or a dynamic `count` construct), unblocking Sunfall\'s "Incubate X, where X is the number of creatures exiled this way" (convex/cards/sets/mom/white.ts).',
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
        note: 'dedicated convex/gre/protection.ts module, covering EVERY CR 702.16 clause — can\'t be Targeted (702.16b), Enchanted (702.16c), Equipped (702.16d), Damaged (702.16e), Blocked (702.16f). FOUR quality families are parsed by the one total, fail-closed `parseProtectionQuality`: the COLOUR/colourless form "protection from <colour>" (CR 702.16a, read through CR 612.6 colour-word text changes — Sleight of Mind); the PLAYER form "protection from each of your opponents" (CR 702.16k, issue #1748 — Figure of Fable), whose quality is re-derived live from the protected permanent\'s OWN controller so a control-change effect moves it with the permanent; and the CHARACTERISTIC form naming card types and/or supertypes, "protection from legendary creatures" (CR 702.16a, issue #1120 — Tsabo Tavoc), matched against the source object\'s LIVE types/supertypes per 702.16a\'s CR 109.2 exception; and the SPELL-RESTRICTED ANY-COLOUR form "protection from spells that are one or more colors" (CR 702.16a, issue #2296 — Emrakul, the Aeons Torn), the only family whose quality is a CONJUNCTION of two dimensions: the source must BE a spell (CR 112.1/113.3 — never a permanent, a blocker, or an ability of a coloured permanent) AND have at least one colour (CR 105.2), which is why `ProtectionSourceView.isSpell` is a REQUIRED boolean every consult site must state. All four flow through the SAME `isProtectedFrom(target, ProtectionSourceView)` predicate, which every consumer reads: `getLegalTargets` (offered set) and the `selectTarget` mutation (accepted set) so they can never diverge, plus the client click gate `src/lib/targeting.ts`; `dealDamage`/`markDamageFromPermanentSource`/`applyAllCombatDamage` (702.16e); `validateBlockerEligibility` (702.16f); the aura attach + `checkAuraAttachmentSBA` fall-off pass (702.16c/704.5m); and `checkAttachmentSBA` (702.16d/704.5n). A protection string the parser cannot name returns null and fails a catalogue-wide CI guard (`gre/__tests__/protectionQuality.test.ts`) rather than shipping inert — subtype qualities ("protection from Goblins") and permanent-scoped "protection from everything" (702.16j) are the two currently unnameable shapes. Distinct from `setProtectionFromEverything`, the separate PLAYER-scoped protection The One Ring grants (CR 115.4).',
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
            "permanent-guard staticEffect OR bare `staticAbilities` keyword string (gre/permanentGuard.ts isGuardedAgainst)",
        note: 'HONOURED (issue #959, gap closed): CR 702.18 — every printed-shroud card (Blastoderm nem/green.ts, Blurred Mongoose inv/green.ts, Spectral Cloak leg/blue.ts) pairs the `staticAbilities: ["shroud"]` reminder string with a `permanent-guard` staticEffect (`cantBeTargeted: true`), evaluated live by `isGuardedAgainst` and consumed by `rules.ts::getLegalTargets` + `game.ts::selectTarget` (server-authoritative) — the same "can\'t be the target of spells or abilities" path hexproof\'s controller-relative guard reuses, but unfiltered (blocks the permanent\'s own controller too, unlike hexproof). `isGuardedAgainst` ALSO bridges the bare `staticAbilities: ["shroud"]` keyword string directly (the `hasShroud` helper, mirroring the existing `hasHexproof` bridge for CR 702.11b), so a card that grants shroud DYNAMICALLY via `SpellContext.grantStaticAbility(target, "shroud", …)` — Homarid Warrior / Svyelunite Priest (fem/blue.ts), Sylvan Safekeeper (jud/green.ts), Blurred Mongoose\'s own activated ability (inv/green.ts), Skyshroud Blessing (pls/green.ts), the usg/green.ts grant — is now honoured live, unfiltered, the moment the string lands on `staticAbilities`, with no per-card `permanent-guard` staticEffect required. Previously (pre-fix) these appended only the bare keyword STRING with no paired guard and stayed inert; that gap is closed at the engine level in `permanentGuard.ts`, not per-card.',
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
        note: 'Issue #1312 — "ward <label>" static string is board-visible reminder data (matched by bindingPattern, e.g. "ward {2}", "ward—pay 2 life"), wardAbility({cost, costLabel}) in triggeredAbilities is the enforcing CR 702.21a triggered ability. Routes entirely through the existing targeted-triggered-ability foundation (CR 603.3d, issue #1193): event "BECAME_TARGET" (CR 603.2b, issue #1265, the same event Leovold reads) narrowed to `event.target.id === self.id` (this exact permanent, not just "you control it"); its own target ("that spell or ability") resolves via the new `spellTargetsSelfSource` dynamic requirement flag (rules.ts raiseTriggerTargetSelection — pins Mistfolk\'s `spellTargetsInstanceIds` filter to `StackItem.triggerSourceId` per-instance instead of a static id) combined with the new `spellStackKind: "any"` value (spells AND abilities both admitted — CR 702.21a says "spell or ability", unlike Stifle\'s ability-only "ability" or Mistfolk\'s spell-only default); the CR 603.3d single-legal-target rule then auto-selects it with no player choice in the overwhelming common case. Effects are the existing "counter unless pay" DSL shape (Miscalculation/Force Spike): mayPay(controllerOf target 0) + if(!paid) counter(target 0) — mayPay/if/counter are already interpreter-suite-exercised Ops, no new Op introduced. Issue #1361 (resolved, was a documented divergence): the rare case of TWO distinct spells/abilities simultaneously targeting the same warded permanent no longer falls back to a player choice — `BecameTargetEvent.sourceInstanceId` (the causing stack item\'s own id, threaded through `emitBecameTargetEvents`) lets `raiseTriggerTargetSelection` narrow each ward trigger\'s legal-target set to the EXACT object that caused it (CR 702.21a), forcing the correct counter target deterministically. No card ships the keyword yet (Kappa Cannoneer, cn nec/blue.ts, is separate — also needs Improvise, issue #917). ADR 0079 (issue #1933): the cost legs come from the shared `CostLegs` type in `convex/cards/types.ts` — one authority for both `AlternativeCost` (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4). Legs are NESTED: `permanent: { action (return|sacrifice), filter, count }` (was the sibling `action`/`count`/`filter` trio on an alt cost, and `sacrifice: { filter, count }` on a may-pay), `hand: { action (exile|discard), requirements }` (was `handCost` / the filterless `discard`), `life` (was `payLife`), plus `mana` and `energy`.',
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
        note: "convex/cards/abilities/cumulativeUpkeep.ts (ADR 0042), used across ice/*.ts. ADR 0079 (issue #1933): the cost legs come from the shared `CostLegs` type in `convex/cards/types.ts` — one authority for both `AlternativeCost` (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4). Legs are NESTED: `permanent: { action (return|sacrifice), filter, count }` (was the sibling `action`/`count`/`filter` trio on an alt cost, and `sacrifice: { filter, count }` on a may-pay), `hand: { action (exile|discard), requirements }` (was `handCost` / the filterless `discard`), `life` (was `payLife`), plus `mana` and `energy`. A non-mana cumulative-upkeep cost therefore declares `permanent` with a sacrifice action; the CR 702.24a \u00d7N repetition scales every leg (Polar Kraken, ice/blue.ts).",
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
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op) — mirrors the Kicker plumbing (issue #692), scaled down since CR 702.27 has no Multikicker-style repeatable variant. `CardDefinition.buyback` (a plain ManaCost — the optional additional cost). `announceCast` accepts a `buyback` boolean, folds `buyback` into the pending mana cost via `foldBuybackCost` (mirrors `foldKickerCost`), threads it through `pendingTarget`/`pendingCast` as `buybackPaid`, and snapshots it on the StackItem. `finalizeSpellResolution` (`convex/gre/state.ts`) reads `item.buybackPaid` and routes the card to its owner's HAND instead of the graveyard as it resolves (CR 702.27a) — checked after a spell's own exile-self/shuffle-self-into-library resolution redirects, which take precedence. Used by Corpse Dance (`convex/cards/sets/tmp/black.ts`), the first — and so far only — SHIPPED buyback card: its reanimation clause (\"the TOP creature card of your graveyard\") was blocked on the deterministic top-of-graveyard selector, closed by issue #1967 (`EffectZonePositionSelector`, `moveZone`'s fifth shape), which unblocked the card and with it this keyword's first real consumer.",
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
        note: 'Cost-system / keyword-cast capability (engine/cost infra, NOT an Effect Script Op): an activated ability usable only from the hand at instant speed (CR 702.29a-b). Modeled as a normal `useStack: true` activated ability declared via the `cyclingAbility(cost)` factory (convex/cards/abilities/cycling.ts): `activateFromHand: true` (new ActivatedAbility flag, twin of activateFromGraveyard) + `cost: { mana, discardThis: true, cyclingCost: true }` + `effects: [{ op: "draw", amount: 1 }]`. activateAbility locates the source in hand, gates on activateFromHand + ownership; the discard-this cost routes through discardToGraveyard (emitting CARD_DISCARDED, CR 701.8) so "whenever you discard" triggers fire (Marauding Mako). CR 702.29c/d (issue #2442): `cost.cyclingCost` — declared once on the shared `cyclingActivationShell`, so typecycling carries it too (702.29f) — rides to the choke point and marks the ONE CARD_DISCARDED event `cause: "cycling"`; a second event would make a "cycles or discards" ability fire twice, which 702.29d forbids. "When you cycle this card" is the `cycledTrigger(...)` template (same file), collected by collectTriggers from whatever zone the cycled card wound up in. Used by the IKO/SNC Triomes, Miscalculation, Unearth, Marauding Mako.',
    },
    // 702.29e/f Typecycling ([Type]cycling) — a VARIANT of Cycling above,
    // not a sibling: CR 702.29f, "typecycling abilities are cycling
    // abilities". It gets its own row because the registry is the NAME
    // authority and "Mountaincycling" is a name a card can print; the
    // implementation deliberately shares Cycling's activation shell.
    {
        id: "typecycling",
        name: "Typecycling",
        kind: "keyword-ability",
        cr: "702.29",
        status: "implemented",
        binding:
            "convex/cards/abilities/cycling.ts typecyclingAbility (shares cyclingActivationShell with cyclingAbility)",
        // Parametrized keyword: the printed name carries the searched-for
        // type as a prefix ("mountaincycling", "islandcycling", …). Does NOT
        // match bare "cycling" — that is the Cycling row's own `binding`.
        bindingPattern: /^[a-z]+cycling$/i,
        note: 'CR 702.29e — "[Type]cycling [cost]" means "[Cost], Discard this card: Search your library for a [type] card, reveal it, and put it into your hand. Then shuffle your library." Issue #1839. Built as the SAME activation shell as plain Cycling (`cyclingActivationShell`: `cost: { mana, discardThis: true, cyclingCost: true }` + `activateFromHand: true` + `useStack: true` + the shared `"cycling"` ability id), with a different Effect Script body: the canonical tutor-to-hand composition `choice`/search-library (`filter: { subtype }`, `count: { min: 0, max: 1 }` — CR 701.19c may-fail-to-find) → `reveal` → `moveZone` library→hand → `libraryLook` shuffle. Sharing the shell is what makes CR 702.29f true structurally: the discard-this cost still routes through `discardToGraveyard` (CARD_DISCARDED, CR 701.8) so "whenever you cycle or discard" triggers fire, and the ability id is literally `"cycling"`, so anything that comes to look for a cycling ability finds a typecycling one. SCOPE: the "usually a subtype" single-word form only (Plains/Island/Swamp/Mountain/Forest cycling — LTR\'s Eagles of the North, Lórien Revealed, Troll of Khazad-dûm, Oliphaunt, Generous Ent). CR 702.29e\'s card-type / supertype / combination forms ("basic landcycling") are NOT built: they need a multi-clause EffectCardFilter and a different reminder-text renderer, and no card in the pool prints one. Cards do not declare a typecycling string in `staticAbilities` (neither does plain Cycling — the ability is the enforcement); the `bindingPattern` keeps the name resolvable if one ever does.',
    },
    // 702.30 Echo
    {
        id: "echo",
        name: "Echo",
        kind: "keyword-ability",
        cr: "702.30",
        status: "implemented",
        binding: "echo",
        note: "convex/cards/abilities/echo.ts (CR 702.30) + `echoPending` instance flag (state.ts); cards declare `staticAbilities: [\"echo\"]` (ETB flag) and `echoTrigger(...)`. Used in usg/red.ts (Goblin Patrol). ADR 0079 (issue #1933): the cost legs come from the shared `CostLegs` type in `convex/cards/types.ts` — one authority for both `AlternativeCost` (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4). Legs are NESTED: `permanent: { action: 'return' | 'sacrifice', filter, count }` (was the sibling `action`/`count`/`filter` trio on an alt cost, and `sacrifice: { filter, count }` on a may-pay), `hand: { action: 'exile' | 'discard', requirements }` (was `handCost` / the filterless `discard`), `life` (was `payLife`), plus `mana` and `energy`.",
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
        note: 'Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op). PLURAL and leg-based since ADR 0079 / issue #1937: CardDefinition.kickers is an ARRAY of KickerCost, each `CostLegs & { id, description, multi? }` — so a Kicker cost is an additional cost of ANY kind (CR 702.33a: mana / sacrifice-or-return a matching permanent / pay life / discard-or-exile from hand), and "Kicker {A} and/or {B}" is two INDEPENDENTLY payable Kickers on one spell. CardDefinition.kickedTargetRequirement still replaces targetRequirement when the spell was kicked at all. announceCast accepts a per-kicker `kickerPayments` record, validates it via resolveKickerPayments and gates the non-mana legs via canPayKickerLegs (convex/gre/kicker.ts), folds each paid Kicker\'s mana leg into the pending cost (foldKickerCosts), its life leg into pendingCast.payLife, and its permanent / hand legs into the cast\'s SINGLE sacrificeSelection / alternativeCostHandChoice pickers — permanent picks marked `explicit` so they are NEVER auto-picked (a forced pick is still information the caster must see). The record threads through pendingTarget/pendingCast and is snapshotted on the StackItem as kickerPayments; the TOTAL is always DERIVED (totalKickerCount), never stored beside it. SpellContext.getKickerCount() reads the derived total (DSL: { kickerCount: true }, `> 0` = was kicked) and getKickerPaidCount(id) reads one entry (DSL: { kickerPaid: "<id>" }, the per-Kicker intervening-if). Paying a Kicker also EMITS a `SPELL_KICKED` GameEvent (CR 702.33d, issue #1097) from the single cast choke point `emitSpellCastEvent` via buildSpellKickedEvents — one event PER KICK (a Multikicker paid N times is N kicks, CR 702.33d), never emitted for a spell COPY (CR 707.10 — a copy carries kickerPayments but is not cast). Backs "whenever a player kicks a spell" (Saproling Infestation). projectPublicState carries the card\'s kickers to the client; the cast-cost dialog renders one control per Kicker with its `description` legible before commit, offering only the ones affordableKickersForCard says are payable. Used by Overload, Bloodchief\'s Thirst, Burst Lightning, Tear Asunder, Consult the Star Charts.',
    },
    // 702.33e Multikicker
    {
        id: "multikicker",
        name: "Multikicker",
        kind: "keyword-ability",
        cr: "702.33e",
        status: "implemented",
        binding:
            "convex/gre/kicker.ts (KickerCost.multi / kickerPayments — shared Kicker cost-system path)",
        note: "The Kicker variant that may be paid any number of times as the spell is cast. Since ADR 0079 it is a property of ONE Kicker (KickerCost.multi), not of the card, so a two-Kicker card can have one repeatable and one single Kicker. Shares the whole Kicker cost-system path; that Kicker's entry in StackItem.kickerPayments records how many times it was paid, and the DERIVED total (totalKickerCount) drives 'a charge counter for each time it was kicked' via entersWith.counters count 'kicker'. Used by Everflowing Chalice.",
    },
    // 702.34 Flashback
    {
        id: "flashback",
        name: "Flashback",
        kind: "keyword-ability",
        cr: "702.34",
        status: "implemented",
        binding: "convex/gre/flashback.ts",
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op): convex/gre/flashback.ts (getFlashbackCost / findFlashbackCastable) + CardDefinition.flashback (printed cost) + CardInstanceState.grantedFlashback (Snapcaster's until-EOT grant, cleared at CLEANUP). announceCast/finalizeTargetSelection/commitPendingCast (convex/game.ts) locate the graveyard card, pay the flashback cost, and flag the stack item exileOnResolve + castFromGraveyard; finalizeSpellResolution exiles it (CR 702.34a). getLegalActions offers the cast; projectPublicState carries the affordance to the client (GraveyardFlashbackButton). Used by Faithless Looting, Firebolt, Lingering Souls, Echo of Eons, Sevinne's Reclamation; granted by Snapcaster Mage. ADR 0079 (issue #1933): the cost legs come from the shared `CostLegs` type in `convex/cards/types.ts` — one authority for both `AlternativeCost` (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4). Legs are NESTED: `permanent: { action (return|sacrifice), filter, count }` (was the sibling `action`/`count`/`filter` trio on an alt cost, and `sacrifice: { filter, count }` on a may-pay), `hand: { action (exile|discard), requirements }` (was `handCost` / the filterless `discard`), `life` (was `payLife`), plus `mana` and `energy`.",
    },
    // 702.35 Madness
    {
        id: "madness",
        name: "Madness",
        kind: "keyword-ability",
        cr: "702.35",
        status: "implemented",
        binding: "convex/gre/madness.ts",
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op): convex/gre/madness.ts (getMadnessCost / markMadnessExiled / openMadnessCastWindow / declineMadness) + CardDefinition.madness (printed madness cost; `Madness {0}` is the empty cost `{}`) + CardInstanceState.madnessExiled / madnessTriggerPending. discardToGraveyard (convex/gre/state.ts) redirects a discarded madness card hand→exile (CR 702.35c); collectTriggers (triggers.ts) builds a reflexive triggered ability StackItem off the CARD_DISCARDED event (CR 702.35a), which resolveTopOfStack resolves by opening the owner's single cast window (openMadnessCastWindow sets castableFromExileBy + raises a BLOCKING `madness-cast` pending choice — Cast/Decline). The choice freezes priority so the cast can never be lost by passing. Accept: the client fires the ordinary announceCast on the exiled card, consumeMadnessCastChoice (game.ts) pops the choice, castRawManaCost charges the madness cost, and the normal cast flow (targets/mana) runs. Decline: submitMadnessDecline → declineMadness bins the card immediately. The vs-AI bot always declines (brain.ts / submit-madness-decline). The CR 514.1 cleanup hand-size discard implements the CR 514.3 exception (finalizeCleanupDiscard grants priority + stays in CLEANUP) so the discard-to-hand-size line resolves in the discarding player's own end step. Used by Basking Rootwalla, Blazing Rootwalla, Anje's Ravager. ADR 0079 (issue #1933): the cost legs come from the shared `CostLegs` type in `convex/cards/types.ts` — one authority for both `AlternativeCost` (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4). Legs are NESTED: `permanent: { action (return|sacrifice), filter, count }` (was the sibling `action`/`count`/`filter` trio on an alt cost, and `sacrifice: { filter, count }` on a may-pay), `hand: { action (exile|discard), requirements }` (was `handCost` / the filterless `discard`), `life` (was `payLife`), plus `mana` and `energy`.",
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
        status: "implemented",
        bindingPattern: /^affinity for /,
        binding:
            "convex/cards/abilities/affinity.ts affinity({quality, filter}) factory + CardDefinition.selfCostReduction",
        note: 'Cost-system capability (engine/cost infra, NOT an Effect Script Op), PRD #702 / ADR 0063 — the KEYWORD form of the count-driven CR 601.2f self-host reduction Emry shipped as authored data in #1337. "Affinity for [text]" = "this spell costs {1} less to cast for each [text] you control" (702.41a), a static ability functioning while the spell is ON THE STACK. Parametrized, so the declared string ("affinity for artifacts", "affinity for Islands") is matched by bindingPattern, the protection/ward/landwalk mechanism. The `affinity({quality, filter})` factory (convex/cards/abilities/affinity.ts) emits BOTH halves from one call — the board-visible staticAbilities reminder string AND the `CardDefinition.selfCostReduction` that enforces it — so a card can never print the keyword and enforce nothing (the deathtouch/hexproof shape Guard A catches). Enforcement is entirely pre-existing: `getCostModifiers` (gre/state.ts) reads `selfCostReduction` off the announced card\'s own definition at the SELF-HOST 601.2f apply site (a spell on the stack is not a permanent, so no battlefield staticEffects scan can find its own reducer) and `resolveCostReductionGeneric` counts `countFilter`-matching permanents on the ANNOUNCING player\'s battlefield only. Three properties fall out for free rather than needing affinity-specific code: GENERIC-ONLY (applyCostModifiers only reduces manaCost.X, so Thoughtcast keeps its {U} at any artifact count); NEVER COUNTS ITSELF (the scan reads player.battlefield while the spell is on the stack, so Frogmite cannot discount itself); CUMULATIVE per 702.41b (getCostModifiers accumulates one `reductionGeneric +=`). No minTotalMana floor — Frogmite at four artifacts costs {0}. Castability (rules.ts coloredCostLeftover path), payment (announceCast parks an ALREADY-reduced pendingCast.manaCost so solveSmartAutoTap taps the right lands) and bot move enumeration (moves.ts, per-X candidate) all route through the same applyCostModifiers call, so there is no client work and no BotAction kind: unlike Delve/Convoke (`payWith`, CR 601.2g) affinity is a passive `reduce` with no player choice and no picker. Used by Frogmite + Thoughtcast (mrd) and Thought Monitor (mh2).',
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
        status: "implemented",
        binding: "gre/payWith.ts spellHasConvoke + buildConvokeCreatureChoice",
        note: 'Cost-system capability (engine/cost infra, NOT an Effect Script Op), issue #1338 / PRD #702 / ADR 0063. The COLOURED sibling of Delve in the `payWith` CR 601.2g cast-cost family: "For each coloured mana in this spell\'s total cost, you may tap an untapped creature you control of that colour rather than pay that mana. For each generic mana ... you may tap an untapped creature rather than pay that mana" (702.51a). Unlike Delve (generic-only) a convoke creature can pay a COLOURED pip — including a guild-hybrid `{B/G}` pip (satisfied by a creature of EITHER colour), which is how Hogaak\'s two `{B/G}` pips are paid. Summoning sickness does NOT prevent convoking (a convoke tap is not a `{T}` mana-ability cost, 602.5a). Modeled as **Model 2** — a PRE-PAYMENT creature PICKER (`PendingCast.convokeCreatureChoice`), never auto-picked (tapping your best blocker is tactical). `convex/gre/payWith.ts` owns the keyword read (`spellHasConvoke`), the eligible-creature scan (`convokeEligibleCreatures`), the per-creature colour read (`creatureConvokeColors`), the shared colour/hybrid greedy (`coverColoredAndHybridPips`, reused by the castability probe) and the Arena-style picker builder (`buildConvokeCreatureChoice`). Payment: `recordConvokeCreaturePick` / the `selectConvokeCreatures` mutation validate the picked creatures (untapped, controlled, creatures), colour-match them to the coloured + hybrid pips, reduce the cost, and — for a convoke+delve card — open the delve picker on the REMAINING generic (CR 601.2g ordering: convoke → delve → mana); the creatures are TAPPED at cast commit (`tryAutoCommitPendingCast`). Castability: `coloredCostLeftover` (gre/rules.ts) feeds each eligible creature to the affordability probe as a coloured PSEUDO-SOURCE so `getLegalActions` emits "cast" for a spell payable only by convoking. Interacts with `cantSpendManaToCast` (CR 601.2f, Hogaak): that flag drops ALL real mana sources from the probe, forcing every pip through convoke/delve. Guild-hybrid pips ride `ManaCost.hybrid` (issue #1338, guild-hybrid only); since #1738/#1739 they are also payable with real mana from the pool and by land auto-tap, so convoke is one payment route among several — only MONOCOLOUR hybrid ({2/W}) is still unmodelled (issue #1743). Bot: `BotAction { kind: "convoke-creatures" }` + the `"convoke-creatures"` `botActionRealisation` branch. UI: `src/components/board/convoke-creature-dialog.tsx`. Used by Hogaak, Arisen Necropolis (mh1/multicolor.ts).',
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
        note: 'convex/cards/abilities/fadingVanishing.ts — "vanishing N" static string expanded at the getDefinition seam (ADR 0054) into entersWith N time counters + an upkeep remove trigger + a separate COUNTER_REMOVED sacrifice trigger (CR 702.63a)',
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
        status: "implemented",
        binding: "gre/payWith.ts spellHasDelve + buildDelveExileChoice",
        note: 'Cost-system capability (engine/cost infra, NOT an Effect Script Op), issue #1336 / PRD #702 / ADR 0063. The first consumer of the `payWith` CR 601.2g cast-cost variant: "For each generic mana in this spell\'s total cost, you may exile a card from your graveyard rather than pay that mana" (702.66a); each exiled card pays for {1} (702.66b), never a coloured pip, and the spell\'s mana value is unchanged (702.66c). Modeled as **Model 2** — a PRE-PAYMENT pending choice, cast order `reduce` (601.2f `applyCostModifiers`) → `payWith` prompt → `solveSmartAutoTap` for the remainder. `convex/gre/payWith.ts` owns the keyword read (`spellHasDelve`), the eligible-fuel scan (`delveEligibleCards`), the generic clamp (`applyGenericOffset`) and the Arena-style prompt policy (`buildDelveExileChoice`: skip when nothing is eligible, prompt with the forced minimum pre-seeded otherwise). Payment reuses the generalized graveyard-exile picker `PendingCast.exileFromGraveyardChoice` in its VARIABLE-OFFSET mode (`offsetGeneric: { min, max }`, alongside the fixed-`count` flashback/escape mode and the Nethergoyf `minCardTypes` mode) — recorded by `recordCastExileCostPick` / the `selectCastExileCost` mutation, with the picked cards moving graveyard → exile at cast commit (`tryAutoCommitPendingCast`). Castability is server-driven: `coloredCostLeftover` (convex/gre/rules.ts) feeds the graveyard cards to the affordability probe as generic-only PSEUDO-SOURCES (mirroring Improvise) so `getLegalActions` still emits "cast" for a spell payable only by delving; the complementary `genericManaShortfall` (same greedy model, pseudo-sources excluded) yields the forced minimum. The solver never auto-picks the fuel — which cards leave the graveyard is a tactical choice and stays the caster\'s. Bot: `BotAction { kind: "cast-exile-cost" }` + the `"cast-exile-cost"` `botActionRealisation` branch. UI: `src/components/board/cast-exile-cost-dialog.tsx`. Used by Treasure Cruise (ktk/blue.ts).',
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
        note: "CR 702.74a represents TWO abilities, both engine infra (issue #900): (1) the alternative-cast static ability — `CardDefinition.evoke` reuses the `AlternativeCost` shape verbatim (CR 118.9 already governs paying it); `convex/gre/alternativeCost.ts`'s `getAlternativeCost`/`affordableAlternativeCosts` resolve this field alongside the generic `alternativeCosts[]` array, and the cast-commit sites in `convex/game.ts` tag the resulting stack item `evoked: true` whenever the chosen alt cost === `def.evoke` (compared by reference) — that flag rides onto the entering permanent for free (a stack item IS its CardInstanceState, the `escaped` precedent). (2) the sacrifice-on-ETB triggered ability — `evokeTrigger` (convex/cards/abilities/evoke.ts), built on `enteredTrigger` with a CR 603.4 check-time `condition` reading `CardInstanceState.evoked` (not an intervening-if — the flag cannot change between the ETB event and this trigger resolving). A card adds BOTH `evoke: {...}` and `evokeTrigger(name)` (alongside its own ETB ability). Used by Solitude, Grief (MH2 Elemental Incarnations, mh2/white.ts / mh2/black.ts) — their evoke cost is a pure HAND leg (\"Exile a <colour> card from your hand\"), so it composes with the EXISTING alt-cost hand-leg picker with zero new plumbing. Vibrance/Deceit/Wistfulness (ECL, ecl/multicolor.ts) SHIPPED with issue #1927 and are the other shape: their evoke cost is a pure MANA leg (the Dash-shaped `AlternativeCost.mana`) made of GUILD-HYBRID pips ({R/G}{R/G} etc.) — declarable via `ManaCost.hybrid` and payable with real mana from the pool or by land auto-tap since issues #1738/#1739. A guild-hybrid evoke cost is therefore NOT an open gap; do not stub a card for it (only MONOCOLOUR hybrid, {2/W}, is still unmodelled — issue #1743). Paying such a cost with two mana of ONE colour also feeds `noteManaSpent`, so an ETB clause gated on \"if {R}{R} was spent to cast it\" (`PermanentView.notedManaSpentOnCast`, issue #900) works off an EVOKED cast exactly as printed — proven in `convex/gre/__tests__/evoke.test.ts`. ADR 0079 (issue #1933): the cost legs come from the shared `CostLegs` type in `convex/cards/types.ts` — one authority for both `AlternativeCost` (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4). Legs are NESTED: `permanent: { action: 'return' | 'sacrifice', filter, count }` (was the sibling `action`/`count`/`filter` trio on an alt cost, and `sacrifice: { filter, count }` on a may-pay), `hand: { action: 'exile' | 'discard', requirements }` (was `handCost` / the filterless `discard`), `life` (was `payLife`), plus `mana` and `energy`. Evoke's pure hand leg is now `hand`, not `handCost`.",
    },
    // 702.75 Hideaway
    {
        id: "hideaway",
        name: "Hideaway",
        kind: "keyword-ability",
        cr: "702.75",
        status: "implemented",
        // Parametrized keyword: the declared string is `hideaway N`
        // ("hideaway 4"), matched by bindingPattern — the protection / ward /
        // rampage / crew mechanism.
        bindingPattern: /^hideaway \d+$/i,
        binding: "convex/cards/abilities/hideaway.ts",
        note: "Issue #783 — \"hideaway N\" is a TRIGGERED ability (CR 702.75a), not a static one, and it is expanded IMPLICITLY from the bare `staticAbilities` string at the `getDefinition` seam (`expandHideaway`, chained in `convex/cards/index.ts` alongside `expandFadingVanishing` / `expandKeywordTriggers` / `expandChapterAbilities`, ADR 0054). A card declares ONLY the string; the seam injects the CR 702.75a ETB trigger, so the keyword can never be printed with nothing enforcing it (the deathtouch/hexproof shape Guard A catches) and its rules text lives in exactly one place. Fully declarative (ADR 0045): the injected trigger's body is the single `hideaway` Op — itself pure composition over pre-existing SpellContext primitives (`peekLibraryTop` + ONE `look-distribute` `requestChoice`, exactly `digToHand`'s picker + `exileFaceDown` + `linkExileToSource` + the shared `bottomLookedAtCards` tail), no new primitive. CR 702.75b: hideaway does NOT tap the permanent — the \"enters tapped\" line the errataed cards also carry is the card's own `entersTapped: true` data flag, never folded into the keyword. VISIBILITY (CR 406.3): the exiled card is face down, hidden from OPPONENTS ONLY — its controller may keep looking at it until it leaves exile. That is not a global opaque flag but the pre-existing PER-VIEWER `knownTo` grant `exileFaceDown` stamps (ADR 0026, the impulse-draw mechanism), which `projectExileCard` (convex/gameProjections.ts) re-derives on the wire: the controller's projection carries the real identity, every other viewer's carries the FACE_DOWN_CARD_ID sentinel while still showing the card pinned to its permanent (the association is public, the identity is not). LINKAGE (CR 607 / 406.6): the exiling ability and the card's own later \"you may play the exiled card\" ability are LINKED — `linkExileToSource(card, ctx.sourceInstanceId)` stamps `exiledBySourceId` (issue #791's Currency Converter mechanism) and the `{ exiledWithSource: true }` selector — accepted by both `grantCastFromExile` and `castDuringResolution` — reads it back through `getCardsExiledWith`, which is the ONLY way a second ability can name what a first ability exiled (a `bind` cannot span two separate resolutions). The play half is NOT part of the keyword (CR 702.75a stops at the exile) — each printed card spells out its own condition and grants the permission itself. Shipped by Shelldock Isle (lrw/colorless.ts); the rest of the printed cycle (Windbrisk Heights, Mosswort Bridge, Spinerock Knoll, Howltooth Hollow) rides the same keyword string with only its own condition to write. TIMING (CR 608.2g, fixed by issue #1961): \"You may play the exiled card\" states NO duration, so the permission exists ONLY during the granting ability's own resolution — the card is offered right there, once, and the window closes with the resolution. Card-type timing restrictions do not apply (CR 117.1a / 302.1 / 307.1 grant their permissions to a player WHO HAS PRIORITY, and this happens outside priority), which is the defining function of the cycle: flashing in a Wrath of God or a Cryptic Command on the OPPONENT's turn. The play half therefore uses `castDuringResolution` with `includesLand: true`, NOT a `grantCastFromExile` this-turn impulse window (which was both too restrictive — normal card-type timing — and too permissive — the permission lingered all turn). The LAND branch stays narrower per CR 305: a hidden land consumes the land drop (305.2a), is not playable on the opponent's turn (305.3) and not with the drop spent (305.2b), silently passing in those cases. DIVERGENCE (out of scope): the look-permission is granted to whoever CONTROLLED the permanent at exile time and does not follow a later control change of that permanent (CR 702.75a's granted ability reads \"the player who controls the permanent\", so a new controller would also gain the look; CR 406.3 keeps the ORIGINAL looker's permission regardless, which this models correctly). No card in the pool changes control of a hideaway land.",
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
        status: "implemented",
        bindingPattern: /^annihilator \d+$/,
        binding: "convex/cards/abilities/annihilator.ts expandAnnihilator",
        note: 'Issue #2295 — "annihilator N" is a TRIGGERED ability (CR 702.86a), expanded IMPLICITLY from the `staticAbilities` string at the `getDefinition` seam (`expandAnnihilator`, chained in `convex/cards/registry.ts` alongside `expandHideaway` / `expandKeywordTriggers` / `expandFadingVanishing` / `expandChapterAbilities`, ADR 0054). A card declares ONLY the string; the seam injects the CR 702.86a attack trigger, so the keyword can never be printed with nothing enforcing it (the deathtouch/hexproof shape Guard A catches) and the trigger can never be declared without the keyword (the string is the expansion\'s only input). Fully declarative (DSL-first, ADR 0045) — no `resolve()`: the injected trigger is an `ATTACKERS_DECLARED` (CR 508.1) ability whose body is the shipped Portal to Phyrexia composition, `choice(kind: "sacrifice-permanents", player: "opponent", zone: "battlefield", count: N)` feeding `sacrifice(permanents: { ref })`. NO `filter` on the choice — CR 702.86a is "N permanents", any type, the defending player\'s choice; a filter-less battlefield choice offers every permanent that player controls (`choiceCandidates` → `getBattlefieldIds(owner, undefined)`), and `pendingChoiceSubmit` still gates every pick on membership in that player\'s battlefield, so widening is not fail-open. TIMING: the trigger goes on the stack during the declare-attackers step and therefore resolves BEFORE blockers are declared (CR 509.1); it is independent of its source thereafter (a blocked or removed attacker does not change it). CR 608.2b: `count` clamps to however many permanents the defending player controls, and zero permanents raises no choice at all — the binding stays uncaptured, `sacrifice` skips, the trigger is a clean no-op with nothing suspended. CR 702.86b (multiple instances each trigger separately) is why the expansion counts EVERY matching `staticAbilities` entry rather than the first: two instances inject two abilities with DISTINCT ids, and `gre/triggers.ts`\'s scan pushes one stack object per ability. That is deliberately the opposite of the one-Oracle-line dedup standard (`triggerDedup.test.ts` only flags same-`oracleText` triggers on DISTINCT scalar events, so duplicate instances are outside its net by construction). DEFENDING PLAYER: 2-player only (CLAUDE.md § Out of Scope), so it is exactly the trigger controller\'s single opponent — the bare `player: "opponent"` ref; no multiplayer defending-player resolver is built. BOT: the forced sacrifice rides the existing `sacrifice-permanents` branch of `chooseResolution` (src/lib/ai/brain.ts — `worstFirst`, exhaustive over `PendingChoiceKind` behind `assertNever`, so it can never freeze) with candidates from `bot-view.ts`\'s battlefield branch, which offers the WHOLE battlefield when the choice carries no filter. NOT covered (no card in the pool demands it): granting annihilator to another creature — that is the `triggeredGrantTemplates: [annihilatorTrigger(N)]` shape Rapid Fire uses for rampage, not a string grant.',
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
        status: "implemented",
        binding: "convex/gre/rebound.ts",
        note: "Cost-system / keyword-cast capability (engine infra, NOT an Effect Script Op), the twin of Flashback/Madness: convex/gre/rebound.ts (hasRebound / markReboundExiled / openReboundCastWindow / declineRebound) + CardInstanceState.reboundExiled. finalizeSpellResolution (state.ts) exiles a resolving spell that has rebound AND was cast from hand (StackItem.reboundFromHand, stamped at cast-commit by reboundCastStackFlags in game.ts) instead of graveyarding it (CR 702.88a), and schedules a caster-scoped next-upkeep DelayedTriggerInstance (reboundCardInstanceId). fireDelayedTriggers (phases.ts) builds a reflexive Cast/Decline StackItem (buildReboundReflexiveTrigger, triggers.ts — mirrors buildMadnessReflexiveTrigger) instead of running an Effect Script; resolveTopOfStack resolves it by opening the caster's single cast window (openReboundCastWindow sets castableFromExileBy + castFromExileWithoutPayingManaCost + raises a BLOCKING `rebound-cast` pending choice — Cast/Decline, sharing the Madness Model A plumbing). Accept: the client fires the ordinary announceCast on the exiled card (castRawManaCost's existing free-cast-waiver branch waives the mana cost); the exile recast has castFromZone === 'exile' so the from-hand gate never re-stamps reboundFromHand, AND finalizeSpellResolution deletes the flag off the card the instant it consumes it (the SAME object is re-pushed onto the stack by the recast, so a stale flag would silently re-trigger the redirect) — no second rebound (CR 702.88a) — and it resolves to the graveyard normally. Decline: submitReboundDecline → declineRebound leaves the card in exile permanently (CR 702.88c). The vs-AI bot always declines (brain.ts / submit-rebound-decline), mirroring Madness's minimal policy. Used by Ephemerate (mh1/white.ts).",
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
    // 702.92 Living Weapon (issue #1340) — a self-ETB triggered ability
    // (CR 702.92a) built from two ALREADY-CENSUSED Ops, no new engine
    // capability: `createToken` (the shared 0/0 black Phyrexian Germ spec,
    // `sharedTokens.ts`) with a `bind`, then the generic `attach` Op
    // (CR 701.3, ADR 0065's unified attachment model) reading that binding
    // back — the same createToken→attach chain Cori-Steel Cutter already
    // exercises. Built by the `livingWeapon()` factory
    // (`abilities/equipment.ts`). First cards: Batterskull (nph/colorless.ts),
    // Kaldra Compleat + Nettlecyst (mh2/colorless.ts).
    {
        id: "living-weapon",
        name: "Living Weapon",
        kind: "keyword-ability",
        cr: "702.92",
        status: "implemented",
        binding:
            "livingWeapon() self-ETB enteredTrigger — createToken (PHYREXIAN_GERM_TOKEN, bind) + attach Op (ADR 0065)",
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
        note: "CR 702.109a represents TWO abilities, both engine infra (issue #1314): (1) the alternative-cast static ability — `CardDefinition.dash` reuses the `AlternativeCost` shape (CR 118.9 already governs paying it), extended with a `mana` leg (`AlternativeCost.mana`) since Dash — unlike Gush/Evoke — is a mana-for-mana swap, not a mana-for-something-else substitution; `convex/gre/alternativeCost.ts`'s `getAlternativeCost`/`affordableAlternativeCosts` resolve this field alongside `evoke`/the generic `alternativeCosts[]` array, and the cast-commit sites in `convex/game.ts` tag the resulting stack item `dashed: true` whenever the chosen alt cost === `def.dash` (compared by reference) — that flag rides onto the entering permanent for free (a stack item IS its CardInstanceState, the `escaped`/`evoked` precedent). The dash mana leg is routed through the SAME tap-lands payment machinery a printed cost uses (`isManaCostCovered`/`payManaCostForSpell`/`pendingCast.manaCost`) — it pays/parks exactly like an ordinary cast, never silently zeroed. `convex/gre/rules.ts`'s \"cast\" legality gate accounts for it too: a dash-cost creature is castable whenever EITHER the printed cost OR the dash cost is affordable. (2) the haste-and-return triggered ability — `dashTrigger` (convex/cards/abilities/dash.ts), built on `enteredTrigger` with a CR 603.4 check-time `condition` reading `CardInstanceState.dashed`, and a DSL effects[] body composing two already-shipped Ops: `grantAbility` (haste, CR 611.2a/613.1f) + `delayedTrigger` (next-end-step return to hand, CR 603.7/ADR 0048) — zero new Ops. A card adds BOTH `dash: {...}` and `dashTrigger(name)` (alongside its own ETB ability, if any). No catalogue card ships against this yet — Death-Greeter's Champion (issue #917) is ALSO blocked on Backup (CR 702.165, separate ticket) and stays a stub; the capability is proven via a synthetic probe card in convex/gre/__tests__/dash.test.ts, mirroring the evoke.test.ts precedent for an engine capability with no consuming card yet. ADR 0079 (issue #1933): the cost legs come from the shared `CostLegs` type in `convex/cards/types.ts` — one authority for both `AlternativeCost` (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4). Legs are NESTED: `permanent: { action (return|sacrifice), filter, count }` (was the sibling `action`/`count`/`filter` trio on an alt cost, and `sacrifice: { filter, count }` on a may-pay), `hand: { action (exile|discard), requirements }` (was `handCost` / the filterless `discard`), `life` (was `payLife`), plus `mana` and `energy`. The mana-for-mana swap of Dash rides the shared `mana` leg.",
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
        status: "implemented",
        bindingPattern: /^crew \d+$/,
        binding:
            "convex/cards/abilities/vehicle.ts makeVehicle/crewAbility factory + gre/tapOtherCost.ts totalPower cost shape",
        note: 'Issue #777 — "crew N" is board-visible reminder data on a Vehicle\'s `staticAbilities[]` (matched by bindingPattern, e.g. "crew 1", "crew 8"); `crewAbility({name, n, power, toughness})` in `activatedAbilities` is the enforcing CR 702.122a activated ability. `makeVehicle` emits BOTH from one call, so a Vehicle can never print the keyword and enforce nothing (the deathtouch/hexproof shape Guard A catches). Routes entirely through pre-existing machinery — no Vehicle-shaped branch anywhere in the GRE. COST: the pre-existing `cost.tapOtherFilter` picker gains a second shape, `totalPower` ("tap ANY NUMBER with total power N or greater") alongside the historical fixed `count` (Hand of Justice); both share one pending picker (`PendingActivation.tapOtherChoice`), one mutation (`selectActivationCost`), one commit gate, and one predicate module (`gre/tapOtherCost.ts`) consulted by the server, the Brain\'s move enumerator and the client affordability hint alike. `tapOtherCandidates` already excludes the source and every tapped permanent = CR 702.122a\'s "other untapped creatures you control"; summoning sickness is deliberately NOT a gate (CR 302.6 governs a creature\'s OWN {T} symbol, not being tapped to pay someone else\'s cost). The picker auto-commits the instant the running total reaches N, since tapping more is never beneficial. EFFECT: the pre-existing `animate` Op (CR 208.2/611.1) with the Vehicle\'s PRINTED P/T (CR 301.7b) and `duration: { phase: "end-of-turn" }` — layer-4 "Creature" add on top of the Artifact type it already has (= "artifact creature", CR 702.122a) plus a layer-7a base P/T set, reverted at CLEANUP by `tickAllDurations` (CR 514.2). Crewing an already-crewed Vehicle is a legal no-op (`animateAsCreature`\'s one-animation-at-a-time guard), also CR-correct. CR 702.122b\'s "crews as though its power were N greater" rider (Shorikai\'s Pilot token) is `CardDefinition.crewPowerBonus`, added to the candidate\'s effective power inside `crewPowerContribution` and nowhere else. NOT covered (no card in the pool demands it): CR 702.122c\'s "can\'t crew Vehicles" restriction, and CR 702.122d\'s "becomes crewed" trigger.',
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
        status: "implemented",
        binding: "convex/cards/abilities/eternalize.ts",
        note: 'Cost-system / graveyard-activation capability (engine infra, NOT an Effect Script Op), issue #2339. CR 702.129a: "Eternalize [cost]" = "[cost], Exile this card from your graveyard: Create a token that\'s a copy of this card, except it\'s a 4/4 black Zombie [subtypes] with no mana cost. Eternalize only as a sorcery." Declared via the `eternalizeAbility(cost, subtypes, imagePrintId)` factory (convex/cards/abilities/eternalize.ts), which builds a plain `useStack: true` activated ability out of four seams: `activateFromGraveyard: true` (the Ashen Ghoul seam, issue #737 — `activateAbility` in convex/game.ts locates the source in its OWNER\'s graveyard and gates on the flag); `cost.exileThis: true` (new, this issue — the source moves graveyard → exile through `exileCardFromGraveyard` (convex/gre/state.ts) at activation COMMIT, so a cancelled mana payment leaves the graveyard untouched; carried across a deferred payment as `PendingActivation.exileThisSource`, classified "non-park" in gre/owedPayment.ts); `sorcerySpeedOnly: true` (CR 307.5 timing, the existing `isSorceryTiming` regime); and the `createTokenCopy` Op\'s new `except` clause (CR 707.2 copiable-value overrides — basePower/baseToughness, colors, additionalSubtypes, noManaCost, imagePrintId — mapped 1:1 onto `CopyEffectOptions` and applied by `applyCopy` in convex/gre/copy.ts). "No mana cost" is an instance-level `CardInstanceState.manaCostOverride` ({}), read through the single mana-cost authority `getInstanceManaCost` (convex/cards/registry.ts) that the layer context, CAST/ATTACK restriction contexts and `getEffectiveColors` all share, so the token\'s mana value is 0 on the server AND across the wire (`slimCard` rewrites `card` to `{ id }`, so an embedded cost would not survive). `createTokenCopyOf` (convex/gre/state.ts) recovers the source from the graveyard or exile — and ONLY when the caller opts in via `lastKnownFromGraveyardOrExile`, so every battlefield-sourced copy caller (Dance of Many, Satya) keeps its CR 608.2b fizzle and no lookup ever reaches a hidden zone (CR 400.2) — because the eternalize cost exiled the card before the ability resolves (CR 608.2b last known information); the interpreter sets that opt exactly where it recovers `{ ref: "$source" }` from exile/graveyard, the same way `moveZone` does for Ashen Ghoul. Client affordance rides the existing graveyard reducers with no keyword-specific code: `getGraveyardStackAbilities` + `isActivationTimingAllowed` (src/lib/card-utils.ts) offer it, `<GraveyardActivateButton>` renders it; token art is pinned per card via `except.imagePrintId` and preferred by `<CardImage>` over the copied definition\'s printing. Bot: the `activate-ability` Move enumerator (convex/gre/moves.ts) now scans the player\'s OWN graveyard as well as the battlefield — before this issue it skipped every `activateFromGraveyard` ability outright, so the bot was blind to Ashen Ghoul too. Used by Fanatic of Rhonas (MH3). Embalm (CR 702.128) is the SAME seam with a different `except` (white, printed body kept) and needs no redesign to ship.',
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
        status: "implemented",
        // Declared as the literal `staticAbilities: ["ascend"]` string. The
        // engine consumes it in two places (issue #1460): the PERMANENT form
        // (CR 702.131b) is a STATIC ability, so `checkAscendCityBlessing`
        // (`gre/cityBlessing.ts`) runs at every battlefield-entry site AND in
        // the SBA sweep as a backstop — never the sweep alone, which by
        // CR 704.3 would be a priority-check too late for a mid-resolution
        // read; the INSTANT/SORCERY form (CR 702.131a) checks once on
        // resolution (`finalizeSpellResolution`). Both grant the monotonic
        // City's Blessing designation (`GameState.cityBlessingIds`,
        // CR 702.131b — never revoked once obtained).
        binding: "ascend",
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
        note: 'Cost-system / keyword-cast capability (engine/cost infra, NOT an Effect Script Op, issue #695): convex/gre/escape.ts (getEscapeCost / findEscapeCastable / hasEscape + countDistinctCardTypes) + CardDefinition.escape (mana + exile N other graveyard cards, CR 702.138a) + CardDefinition.grantsEscapeToOwnGraveyard (Underworld Breach\'s zone-wide grant). locateCastSource/castRawManaCost/graveyardCastStackFlags (convex/game.ts) route the graveyard cast: pay the escape mana, exile the "other" cards via the reused flashback exileFromGraveyardChoice picker (fixed count, or the Nethergoyf variable "any number with N+ card types" via minCardTypes), and stamp the stack item `escaped` (CR 702.138b) — which rides onto the resulting permanent (a stack item IS its CardInstanceState), NO exileOnResolve. getLegalActions offers the cast; projectPublicState carries the affordance to the client. The `escaped` game-state is read in DSL via the `{ escaped: { of } }` EffectValue (SpellContext.isEscaped) for "sacrifice it unless it escaped". Used by Uro, Phlage, Nethergoyf; granted by Underworld Breach.',
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
    // 702.156 Ravenous (issue #674) — a keyword on a creature spell with {X}
    // in its mana cost, standing for TWO abilities with different timing
    // (CR 702.156a). First card: Jacked Rabbit (blc/white.ts).
    {
        id: "ravenous",
        name: "Ravenous",
        kind: "keyword-ability",
        cr: "702.156",
        status: "implemented",
        binding:
            'entersWith: { counters: [{ type: "+1/+1", count: "X" }] } (CR 614.1c replacement, applied at resolution off StackItem.chosenX) + enteredTrigger({ scope: "self", interveningIf: X >= 5, effects: [{ op: "draw" }] }) (CR 603.4)',
        note: 'Ravenous is TWO abilities on one keyword, and they resolve at different times — that split is the whole implementation. (1) "This creature enters with X +1/+1 counters on it" is a CR 614.1c ETB REPLACEMENT: declare `entersWith: { counters: [{ type: "+1/+1", count: "X" }] }`, which `applyEntersWithCounters` resolves off the RESOLVING stack item\'s `chosenX` (`cards/entersWith.ts`) — no Effect Script involved. (2) "If X is 5 or more, draw a card when it enters" is a genuine TRIGGERED ability with a CR 603.4 intervening-if: declare an `enteredTrigger({ scope: "self" })` whose `interveningIf` reads `self.chosenXOnCast` and whose `effects` are a plain DSL `draw`. The next Ravenous card copies exactly that pair. CRITICAL — read X from `CardInstanceState.chosenXOnCast` (the typed, SERIALIZED snapshot `finalizeSpellResolution` writes, twin of `wasKicked`), never from `{ X: true }` / `ctx.getX()` at the trigger site and never from the +1/+1 counter COUNT. `getX()` reads the currently-resolving stack item, and the trigger\'s item only carries a stale `chosenX` by an untyped `{...self}` spread that the card serializer drops — so it reads 0 after the save/load that happens between the trigger going on the stack and resolving. The counter count is the proxy anti-pattern issue #1753 retired: any later pump or -1/-1 annihilation changes it, X never changes. Expressed inline on the first card per the closure-on-1st/extract-on-2nd convention; a SECOND Ravenous card is the point to extract a `ravenous()` factory returning the entersWith declaration + the trigger.',
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
        note: 'Issue #1315 — "backup N" static string is board-visible reminder data (matched by bindingPattern, e.g. "backup 1", "backup 2"), backupTrigger(n, grantedAbilities) in triggeredAbilities is the enforcing CR 702.165a ETB triggered ability, parametrized on BOTH the counter count N and the card\'s own printed ability list below the Backup line (CR 702.165c — grantedAbilities is a literal subset of the card\'s own staticAbilities[], never invented). Routes entirely through existing machinery: the targeted-ETB-trigger foundation (`enteredTrigger` + `targetRequirement`, CR 603.3d/issue #1193, Flametongue Kavu precedent) for "put N +1/+1 counters on target creature", the `counters` Op (CR 122, issue #841) for the counter placement, and the `grantAbility` Op (CR 611.2a/613.1f, issue #843, Dash\'s haste-grant precedent) for the until-end-of-turn ability grant. Issue #1665 widened the grant to NON-keyword abilities: `backupTrigger(n, grantedAbilities, grantedTriggeredIds)` also emits a `grantAbility` Op carrying `grantedTriggeredId`, naming a `triggeredGrantTemplates[]` entry on the card itself, so a printed TRIGGERED ability below the Backup line is granted too (Guardian Scalelord: Flying AND its attack trigger, CR 702.165c). The ONE new piece is the `targetIsAnother` `if`-predicate (issue #1315, `EffectPredicate` union, convex/cards/types.ts) — an object-identity comparison ("if that\'s ANOTHER creature") the existing numeric/boolean predicate grammar had no shape for; gates the grant so a self-targeted Backup does not re-grant the source its own abilities. No new Op. Proven against a real, simple catalogue card needing ONLY Backup: Consuming Aetherborn (mom/black.ts, Backup 1 + Lifelink). Guardian Scalelord (moc/white.ts, vintage-cube pool) SHIPPED in #1378 (the dynamic `mvFilter: { max: "sourcePower" }` cap its attack trigger needed) and is the reference shape for the non-keyword grant (#1665). Death-Greeter\'s Champion (moc/red.ts) stays a stub too — ALSO needs Dash (CR 702.109a, separate ticket).',
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
    // 714.2 Chapter ability (Sagas, ADR 0078). CR 714.2 says literally "A
    // chapter symbol is a keyword ability", which is why this is a
    // `keyword-ability` row outside the CR 702 block rather than a new
    // `MechanicKind`. It is never a `staticAbilities[]` string — a Saga
    // declares `chapterAbilities[]` and the `getDefinition` seam desugars it —
    // so the name-authority guard has nothing to check here; the row documents
    // the binding. Read Ahead (CR 702.155, above) stays `planned`.
    {
        id: "chapter-ability",
        name: "Chapter Ability",
        kind: "keyword-ability",
        cr: "714.2",
        status: "implemented",
        binding:
            "CardDefinition.chapterAbilities → expandChapterAbilities (cards/abilities/sagas.ts) + finalChapter / checkSagaSacrificeSBA (gre/sagas.ts, gre/sba.ts)",
        note: 'CR 714.2b — "{rN} — [Effect]" means "When one or more lore counters are put onto this Saga, if the number of lore counters on it was less than N and became at least N, [effect]". Desugared at the single `getDefinition` choke point (the ADR 0054 pattern) into a `counterAddedTrigger`-built TriggeredAbility tagged with `chapterNumbers`, plus the CR 714.3a `entersWith` lore counter. The chapter condition is a TRIGGER condition evaluated once off the event payload (`total - added < N && total >= N`), never re-checked at resolution. `chapters: [1, 2]` (CR 714.2c "I, II —") is ONE ability, one Oracle line on the stack. Both CR 714 gates — the 714.3c precombat-main turn-based counter and the 714.4 sacrifice SBA — test for one or more EFFECTIVE chapter abilities (2026 rules), so a Saga under Blood Moon / Humility persists inert instead of being sacrificed. First card: History of Benalia (dom/white.ts).',
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
        note: "The number of basic land types among lands a player controls (0–5, CR 305.6 — a dual land contributes several), issue #1066. Reused by four sites: the `{ domain: { of } }` EffectValue grammar member (Tribal Flames, Wandering Stream, Ordered Migration, Worldly Counsel, Power Armor's pump), the shared `countDomain` helper feeding `StaticPTCDA.compute` closures (Kavu Scout, Wayfaring Giant, Exotic Curse, Strength of Unity), the dynamic `StaticAttackManaTax.costPerAttacker` function (Collective Restraint), and Coalition Victory's `winGame`-gating `if` predicate. FIFTH site, issue #1958 — the CR 601.2f cost-reduction amount: `DomainDrivenCostReduction` (`cards/types.ts`, `{ perCount, countMode: \"domain\" }`) is a count MODE on `StaticCostModifier.costReduction` / `CardDefinition.selfCostReduction`, resolved by `resolveCostReductionGeneric` (`gre/state.ts`) through the same `countDomain` scan. It is a separate shape from the permanent-count `CountDrivenCostReduction` because the thing counted differs in kind (three Forests are three PERMANENTS but one basic land TYPE). Used by Draco and Stratadon (`pls/colorless.ts`); the whole 601.2f apply site is shared, so the reduction is visible to castability (`canPotentiallyPayCost`), the payment path, auto-tap and the bot's `enumerateCastMoves` for free.",
    },
    {
        id: "metalcraft",
        name: "Metalcraft",
        kind: "ability-word",
        cr: "702 preamble",
        status: "implemented",
        binding:
            "hasMetalcraft (cards/types.ts) — an activated mana ability's canActivate gate",
        note: 'Issue #1530 — "you control three or more artifacts" board-state condition (SOM/NPH block ability word). Shared helper `hasMetalcraft(state, controllerId)` (cards/types.ts, mirrors `countDomain`\'s shape) counts live battlefield permanents whose `types` include "Artifact" for the given controller. First consumer: Mox Opal\'s tap-mana ability (`som/colorless.ts`) gates via `canActivate: (source, state) => hasMetalcraft(state, source.controllerId)` — the SAME `canActivate` gate Chrome Mox\'s imprint check already proves is enforced by every real consumer of a tap mana ability (`getManaTapOptionsDetailed` / `hasManaAbility` / `getActivatedManaAbility`, issue #947), not merely a card-shaped closure with no engine teeth.',
    },
];

/** Named mechanics reused across a specific SET's cards, censused for the
 *  SAME reason CR 701/702 keywords are (a real, parametrized, machine-checked
 *  name — not a card-specific one-off, which belongs in
 *  `ENGINE_INTERNAL_MARKERS` instead): Universes Beyond set-original keywords
 *  (issue #1317's Earthbend, from Avatar: The Last Airbender / TLA). Kept in
 *  its own array — not appended to `KEYWORD_ACTIONS` / `KEYWORD_ABILITIES`,
 *  whose header comments document a closed, hand-maintained CR-702/701-
 *  numbered census — so those two stay a faithful CR census while
 *  `SET_KEYWORDS` still feeds `MECHANICS_REGISTRY` (and therefore
 *  `isNamedMechanic`) like any other row. (Issue #2446: Earthbend itself DOES
 *  have a numbered CR section as of the vendored CR document — CR 701.66,
 *  `bun run cr 701.66` — so "no CR section of their own" is no longer true
 *  set-wide; a row still stays here rather than migrating array on that
 *  basis alone.) */
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
        // CR 701.66 (issue #2446 correction) — the vendored CR document DOES
        // carry a numbered section for this TLA (Avatar: The Last Airbender)
        // keyword action (`bun run cr 701.66`); the earlier "not a CR 701/702
        // entry" citation predated that formalization and was wrong. Left in
        // `SET_KEYWORDS` rather than moved to `KEYWORD_ACTIONS` — that array's
        // header comments document a closed, hand-maintained CR-701-numbered
        // census, and moving a row is a bigger structural change than this
        // fix warrants; the `cr` field below is what `isNamedMechanic` and
        // every reader actually consult.
        cr: "701.66",
        status: "implemented",
        bindingPattern: /^earthbend \d+$/i,
        binding:
            "animate + counters + delayedTrigger Ops (Badgermole Cub's ETB effects[], tla/green.ts)",
        note: 'CR 701.66a: "\'Earthbend N\' means \'Target land you control becomes a 0/0 land creature with haste in addition to its other types. Put N +1/+1 counters on it. When that land dies or is put into exile, return it to the battlefield tapped under your control.\'" Decomposes into TWO already-general Ops (primitive-reuse mandate) on a `targetRequirement: { type: "Land", count: 1, controller: "you" }` triggered ability: `animate` (base 0/0, NO subtype — the rule grants the card type Creature "in addition to its other types", not a creature subtype; `grantedAbilities: ["haste"]`, no `duration` — CR 611.2b indefinite, since the rule text carries no "until end of turn" clause) then `counters` (`action: "add"`, "+1/+1", count N). The rule\'s THIRD sentence — "When that land dies or is put into exile, return it to the battlefield tapped under your control." — is a delayed triggered ability (CR 603.7a) watching one specific object indefinitely, and SHIPPED with issue #1470: a third `delayedTrigger` Op with the new INDEFINITE instance-leave-watch timing `leaves-battlefield-indefinite` (same `watch` + PERMANENT_LEFT match in `gre/triggers.ts` as `"leaves-battlefield"`, but EXCLUDED from the CLEANUP purge in `gre/phases.ts`, so the watch survives end of turn), whose body is two `moveZone` return-a-departed-object Ops (issue #1469) — `from: "graveyard"` (dies) and `from: "exile"` (exiled, or a `graveyardDestinationFor` redirect), both `tapped: true` and both `controller: "controller"` (issue #2446 — CR 701.66a\'s own "under your control" clause: the earthbending player, fixed at scheduling time, NOT the land\'s owner). Exactly one finds the card; the other, and the whole body when the land has moved on, is a CR 608.2b no-op. CR 400.7 hygiene (plain land back, no counters / haste / animation) is handled at `resetBattlefieldTransientState` — see the `animate` row above. CR 701.66b ("An ability that triggers whenever a player earthbends triggers when the delayed triggered ability described in rule 701.66a is created") is N/A: Badgermole Cub is the only card in the catalogue that reaches this keyword, and no card triggers off "whenever a player earthbends" — nothing to wire up yet.',
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
        id: "minimum-blockers",
        bindingPattern: /^minimum-blockers:\d+$/,
        note: 'CR 509.1b minimum-blocker requirement — "This creature can\'t be blocked except by N or more creatures" as plain rules text with no keyword name of its own (LTR Troll of Khazad-dûm, N = 3; issue #1839). MENACE (CR 702.111a) is the N = 2 case that DOES have a keyword, so it keeps its own registry row and declares "menace"; this marker is the generic form. Both are rows in `MINIMUM_BLOCKER_RULES` (convex/gre/combatRegistry.ts) and `describeMinimumBlockers` takes the MAX over every matching row (CR 509.1b applies every restriction), read by `getMinimumBlockers` → `validateMinimumBlockers` (blocker-confirm, convex/game.ts) and by the bot\'s legal-block enumerator (convex/gre/moves.ts). Not a named CR keyword.',
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
        note: "CR 120 — deal `amount` damage to an announced target, a forEach member, or a relative/bound player. By default the CR-120.1 source is the resolving stack item (SpellContext.dealDamage). Optional `source` (issue #1416) names a bound PERMANENT that is the source instead — routed through SpellContext.dealDamageFromPermanent → dealDamageFromPermanentToPlayer (gre/state.ts), so infect/lifelink/source-colour prevention/protection and 'a source deals damage' triggers key off that permanent's identity, not the spell's. Backlash: the tapped creature (`$c`) deals its power to its controller.",
    },
    {
        op: "dealDamageDividedAsChosen",
        status: "implemented",
        cr: "601.2d",
        binding: "SpellContext.dealDamageDividedAsChosen",
        mechanicId: "dealDamage",
        note: 'CR 601.2d / 120.4 divide-as-you-choose damage over the WHOLE announced target group (ctx.targets), unlike the single-`to` dealDamage Op. A thin declarative skin over the single SpellContext.dealDamageDividedAsChosen primitive (one execution path, ADR 0045). The per-target split is chosen at ANNOUNCEMENT (targetRequirement.divideAsChosen, each target ≥1) and snapshotted onto the stack item\'s targetAmounts, which the primitive reads back at resolution via resolveChosenDivision (gre/state.ts); `total` is the fallback cap and mirrors the card\'s divideAsChosen.total. `total` reuses the exact divideAsChosen.total vocabulary (number | "X" | "X+1"): a fixed amount, the announced {X} (getX() — Fire Covenant\'s pay-X-life), or X+1 (Meteor Shower\'s "X plus 1 damage"). Powers Arc Lightning, Fiery Justice, Meteor Shower, Fury (ETB trigger), Arc Mage (activated), Fire Covenant.',
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
        cr: "119.3",
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
        cr: "119.3",
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
        op: "skipNextTurn",
        status: "implemented",
        cr: "614.10",
        binding: "SpellContext.setSkipNextTurn",
        note: 'Cause `player` to skip their next turn (CR 614.10, issue #1957 — Waterspout Elemental: "you skip your next turn"). A thin declarative skin over the single SpellContext primitive `setSkipNextTurn` (ADR 0045), one execution path: the SAME primitive already backs Time Vault\'s pre-DSL activated-ability `resolve()` closure ("Skip your next turn: Untap Time Vault.", `lea/colorless.ts`) and the `PlayerState.skipNextTurn` count `advanceTurn` (phases.ts) decrements at each turn boundary — this Op adds no new engine capability, only a declarative front end over an already-shipped primitive (primitive-reuse mandate). `player` is an announced target slot, the resolving controller (Waterspout Elemental targets no one — "you skip your next turn" always names the controller), or a relative player. Skipped when the player cannot be resolved (CR 608.2b). COUNT, not boolean (CR 614.10a): the primitive INCREMENTS `skipNextTurn` rather than setting a flag, so two resolutions against the same player accumulate to "skip the next two" instead of collapsing to one.',
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
        op: "skipDrawStepThisTurn",
        status: "implemented",
        cr: "504.1, 500.8",
        binding: "SpellContext.skipDrawStepThisTurn",
        note: 'A one-shot "you skip your draw step this turn" flag on `player` (CR 504.1, issue #1097 — Elfhame Sanctuary: "…put it into your hand, then shuffle. If you do, you skip your draw step this turn."). A thin declarative skin over the single SpellContext primitive `skipDrawStepThisTurn`, one execution path (ADR 0045): `player` names the resolving controller for the one shipped card, an announced slot / relative player not precluded by the grammar. Adds the player id to `state.skipDrawStepThisTurn`, consumed by `advancePhase` (`gre/phases.ts`) the NEXT time the DRAW step is entered for that player this turn — per CR 500.8 a skipped step doesn\'t happen AT ALL, so the whole step (turn-based draw, CR 504.2 delayed triggers, and CR 603.6a beginning-of-step triggers such as Howling Mine) is bypassed, not merely the draw; `drawStep` itself is never invoked for that player — and cleared unconditionally at CLEANUP as a turn-1 safety net (CR 103.8a skips only the DRAW step, not the UPKEEP step Elfhame Sanctuary arms it from). Distinct from `CardDefinition.drawStepReplacement` (Fasting): that is a STATIC per-card flag re-evaluated every turn, handing off to its OWN DRAW-phase trigger for an INTERACTIVE may-skip choice made AT the draw step itself; this Op arms a plain flag from a DIFFERENT step\'s effect (upkeep), with no choice left to make once armed — `advancePhase` checks this flag FIRST, before entering the step at all, so a player who armed it never also sees an unrelated replacement offered.',
    },
    {
        op: "grantCastTiming",
        status: "implemented",
        cr: "601.3e",
        binding: "SpellContext.grantCastTiming",
        note: 'Grant a per-player casting-TIMING permission — "you may cast <spells> as though they had flash" (CR 601.3e, Teferi, Time Raveler +1: "Until your next turn, you may cast sorcery spells as though they had flash"). A thin declarative skin over the single SpellContext primitive `grantCastTiming`, one execution path (ADR 0045): `player` names the grantee, `cardTypes` (optional) narrows the grant to those printed card types (Teferi: `["Sorcery"]`); omitted grants flash for every spell. Adds an entry to `state.castTimingFlashGrants`, honored by the SHARED cast gate `hasCastTimingFlashGrant` (convex/cards/castRestrictions.ts) that both the GRE `getLegalActions` (via the `castTimingBaseLegal` timing helper) and the client legal-actions view read. The INVERSE of `restrictCasting` (a class forbid) and of the `cast-timing-lock` static (a sorcery-speed lock, which OVERRIDES this permission per CR 101.2). Cleared at the START of the grantee\'s next turn (via `advanceTurn`) — the "until your next turn" boundary, mirroring `islandSanctuaryProtection`, NOT the CLEANUP boundary the turn-scoped `restrictCasting`/`grantGraveyardPlay` use. Powers Teferi, Time Raveler (war/multicolor.ts); the sorcery-speed-lock half of the same card is the `cast-timing-lock` StaticEffect (no Op — a battlefield static).',
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
        note: 'Grant cast permission for a graveyard card named by `card`, an EffectObjectSelector: either a bare picks ref (the card a preceding Op bound — typically the just-discarded card from a choice(kind: "choose-hand-card") + discard pair) or an announced target slot `{ target: n }` (CR 601.2c — issue #1650, Emry, Lurker of the Loch: "{T}: Choose target artifact card in your graveyard. You may cast that card this turn."; the slot must still hold a graveyard-card selection or the Op is skipped, CR 608.2b). Optionally ALSO waives its mana cost entirely (CR 601.3e / 117.6-analog, issue #1344 — Malcolm, Alluring Scoundrel: "If there are four or more chorus counters on Malcolm, you may cast the discarded card without paying its mana cost"). A thin declarative Op skin over the SpellContext primitive `grantCastFromGraveyard`, one execution path (ADR 0045) — the graveyard-sourced twin of `grantCastFromExile` (issue #1156), generalizing the SAME per-card grant shape to a second zone rather than adding a card-shaped primitive (ADR 0045 primitive reuse). Always SAME-PLAYER (no `zoneOwnerId` — no cross-player graveyard-cast primitive exists in this engine, `castZoneOwner`\'s doc in `convex/game.ts`). Stamps `castableFromGraveyardBy` (+ `castFromGraveyardWithoutPayingManaCost` when `withoutPayingManaCost` is set) on the picked `CardInstanceState`, consulted by `castRawManaCost` (`convex/game.ts`) and `getLegalActions`\'s graveyard-grant affordability branch (`gre/rules.ts`). `window` mirrors the exile primitive\'s own turn-scoping. DIVERGENCE (issue #1344, out of scope): Malcolm\'s Oracle ruling requires the free cast to happen as part of the triggered ability\'s own resolution, ignoring the card\'s timing restrictions ("you can\'t wait to cast the spell later in the turn"); this Op instead grants an ordinary "this-turn" impulse cast window, the SAME simplification every other impulse-cast card in this engine already uses (Expressive Iteration, Headliner Scarlett). Malcolm itself no longer relies on this Op — it uses `castDuringResolution` (CR 608.2f, issue #1477) for its real "cast as part of resolution" behaviour; this impulse-window Op remains for cards whose Oracle text genuinely grants a later-in-turn window. `exilesOnResolve` (issue #2380) is the second orthogonal rider: the granted cast EXILES the card as it leaves the stack instead of putting it into its owner\'s graveyard (Jace, Telepath Unbound\'s −3: "If that spell would be put into your graveyard, exile it instead."), stamping `CardInstanceState.castFromGraveyardExilesOnResolve`, read at cast-commit by `graveyardCastStackFlags` (`convex/game.ts`) and applied through the SAME `exileOnResolve` stack-item flag Flashback\'s CR 702.34a exile already uses — one exile-as-it-leaves-the-stack path, not a parallel one.',
    },
    {
        op: "castDuringResolution",
        status: "implemented",
        cr: "608.2g / 601 / 116.2a / 305",
        binding:
            "SpellContext.castChosenSpell + SpellContext.playLandForPlayer",
        note: 'PLAY a card as PART OF a resolving ability (a "you may cast/play <card>" with no stated duration, which per CR 608.2g exists ONLY during that ability\'s resolution — Malcolm, Alluring Scoundrel: "you may cast the discarded card without paying its mana cost"; Shelldock Isle / the Hideaway cycle: "You may play the exiled card without paying its mana cost" — played then and there, never saved for later). Offers the controller an optional Cast/Decline (or Play/Decline) `option-pick` and, on accept, casts the card INLINE via the resolve-time mini-cast `SpellContext.castChosenSpell` (ADR 0037, self-cast: actingPlayer == controller), splicing the spell onto the stack just below the resolving ability so it becomes the new top and resolves next. Collects the cast card\'s own targets/modes/X through the existing resolve-time suspend/resume seam (the same `requestChoice`/`requestOptionChoice` Word of Command uses). Crucially distinct from `grantCastFromGraveyard`/`grantCastFromExile` (which stamp a LATER-in-turn impulse window): NO priority is granted between the offer and the inline cast, the card CANNOT be saved for later, and its own timing / card-type restrictions are ignored — CR 117.1a / 302.1 / 307.1 grant their timing permissions to "a player WHO HAS PRIORITY" and this happens outside priority, so the effect itself is the permission and a creature or sorcery is effectively castable at instant speed, including on the OPPONENT\'s turn (Shelldock Isle flashing in a Wrath of God, issue #1961). CARD SELECTOR: `card` is either a bare picks ref (a card an earlier Op in the same script bound — Malcolm), or `{ exiledWithSource: true }` (CR 607 LINKED abilities, issue #1961 — the card the ability\'s OWN source permanent exiled and stamped via `linkExileToSource`, read back through `getCardsExiledWith`; the only way a second ability can name what a first ability exiled, since a `bind` cannot span two separate resolutions — requires `source: "exile"`), or omitted with `fromTopOfLibrary: true` (Chandra, Torch of Defiance\'s +1). `source` is the play-from zone ("graveyard" — Malcolm; or "exile"); `free` (optional) waives the mana cost. LAND BRANCH (`includesLand`, issue #1961): set it ONLY when the Oracle text says "play" rather than "cast" — playing a land is a SPECIAL ACTION, not casting (CR 116.2a), and CR 305.9 means a land+other-type card can only ever be played as a land. Without the flag a land silently passes (the official Malcolm land ruling, preserved for every "cast" grant). With it, the land branch is genuinely NARROWER than the cast branch rather than instant-speed, gated by `SpellContext.getChosenLandPlayable`: the land CONSUMES the land drop (CR 305.2a — "lands played during the resolution of spells and abilities" count), is NOT playable on the opponent\'s turn (CR 305.3 — "ignore any part of an effect" that says otherwise), is NOT playable with the drop already spent (CR 305.2b), and is blocked by a CR 614 land-play lock (Worms of the Earth); on accept it enters through the canonical `applyPlayLand*` transition (`gre/playLand.ts`) so a resolve-time exile play and a normal hand drop cannot drift. Silent pass (CR 608.2b — no prompt, resolution completes cleanly) when the caster can\'t be resolved, the selector resolved to nothing (binding never captured / the CR 607 source linked nothing), the card is no longer in `source`, or the land legality above fails. The Cast/Play prompt deliberately does NOT name the card: a hideaway card is FACE DOWN (CR 406.3, visible only to its controller) while `pendingChoices` crosses the wire unredacted to both viewers (and the non-chooser\'s client renders `prompt` verbatim), so naming it — or pinning it via `subjectCardId` — would leak the hidden identity. For the same reason, an `includesLand` grant sends ONE identical prompt string and option list on BOTH branches ("Play / Decline" — CR 116.1\'s "play" covers casting a spell as well as playing a land): differing wording per branch would itself disclose whether the face-down card is a land.',
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
        note: 'Effect Script Op for the CR 701 keyword action "Exile" — moves the target to its owner\'s exile zone (CR 406). Supports `bind` to snapshot the permanent\'s power/toughness/controller before it leaves (Swords to Plowshares reads the exiled creature\'s power, CR 608.2h). The bind SURVIVES into exile (issue #1401, the "blink" primitive): `resolveObjectRef` learns an exile-zone fallback, so a LATER `moveZone { target: { ref: "$c" }, to: "battlefield" }` in the same script can still resolve the ref and return the just-exiled card in one resolution — see `moveZone`\'s own note.',
    },
    {
        op: "exileSelf",
        status: "implemented",
        cr: "608.2",
        binding: "SpellContext.exileSelf",
        note: 'The resolving spell exiles ITSELF instead of going to its owner\'s graveyard (CR 608.2m default, issue #1097: "Exile Restock" / "Exile Recall"). A thin declarative skin over the pre-existing SpellContext primitive `exileSelf` (previously reachable only from a `resolve()` closure — Recall, `leg/blue.ts`), one execution path (ADR 0045): the primitive flags the CURRENTLY-RESOLVING stack item (`exileOnResolve`), which `finalizeSpellResolution` (convex/gre/state.ts) checks BEFORE the normal graveyard placement. Mirrors `shuffleSelfIntoLibrary` (issue #898) exactly, but redirects to exile instead of a shuffled library — the two are the library/exile siblings of the same self-redirect design. No parameters: it always applies to the currently-resolving spell card; no-op for an ability (no card to move) or a spell copy (CR 707.10 — a copy ceases to exist, it is never exiled).',
    },
    {
        op: "exileWithAttachments",
        status: "implemented",
        cr: "701.18",
        binding: "SpellContext.exileWithAttachments",
        mechanicId: "exile",
        note: "Effect Script Op for the O-Ring / Banishing Light / Oblivion Ring / Tawnos's Coffin exile-and-return family (CR 603.7a / 701.18 / ADR 0028). Exiles the announced target permanent keyed to the resolving `$source`, arming an exile-and-return bundle that a later `returnExiledForSource` Op (on the source's leaves/untaps trigger) restores — the host re-enters under its owner's control carrying its noted counters (CR 122). A thin declarative skin over `SpellContext.exileWithAttachments` (ADR 0045, one execution path); the bundle's `sourceId` is ALWAYS `ctx.sourceInstanceId`, never author-supplied — the return must key to the resolving source, so it is not a field. `includeAttachments` (default FALSE, host-only — the O-Ring default where the host's Auras die to the orphan-aura SBA CR 704.5n and its Equipment detaches) bundles the Auras/Equipment to travel WITH the host into exile and return re-attached (CR 701.18 — Tawnos's Coffin / Safe Haven, `true`); `returnTapped` returns the host tapped (Icy Prison). The PAIRED return half is a SEPARATE Op (`returnExiledForSource`) on the source's own leave/untap trigger — the two are always shipped together.",
    },
    {
        op: "returnExiledForSource",
        status: "implemented",
        cr: "603.7a",
        binding: "SpellContext.returnExiledForSource",
        note: "Effect Script Op for the RETURN half of the exile-and-return family (CR 603.7a / ADR 0028) — the paired counterpart of `exileWithAttachments`. Returns every exile-and-return bundle keyed to the resolving `$source`: the host re-enters under its owner's control (tapped if the bundle noted so, carrying its noted counters, CR 122) and any bundled Auras re-enter attached (CR 303.4). A thin declarative skin over `SpellContext.returnExiledForSource(ctx.sourceInstanceId)` (ADR 0045, one execution path); carries no parameters — the source is always the resolving ability's own source. Lives on the source's \"leaves the battlefield / becomes untapped\" trigger (Banishing Light's leftTrigger, Tawnos's Coffin's untap trigger); a stale fire with nothing held is a harmless no-op (the primitive early-returns), so the `holdsExileBundle` gate is a convenience, not a correctness requirement. No `mechanicId` — the return is a delayed-trigger action (CR 603.7a), not a CR 701 keyword action.",
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
        note: 'Mid-resolution player choice (CR 101.4 / 608.2, issue #805) mapped 1:1 onto the existing Pending Choice zone-pick kinds (EffectChoiceKind ⊂ ZonePickKind) — same enqueue, same generic prompt UI, same submitResolutionChoice mutation. The interpreter SUSPENDS the script at this Op (resolutionStep checkpoints the Op index) and resumes here when the picks are submitted; its required `bind` names the picks for later Ops. Optional `zoneOwnerId` (issue #920, #682) names the zone owner when it differs from the chooser (`player`) — a direct passthrough of the `zoneOwnerId` parameter `SpellContext.requestChoice` already accepted (Leshrac\'s Sigil, Demonic Hordes); unblocks the Thoughtseize/Duress/Inquisition-of-Kozilek "target player reveals their hand, you choose a card from it" template. Optional `id` (issue #1282) overrides `bind` as the wire-visible `PendingChoice.choiceId` — a migration-equivalence affordance letting a migrated card reproduce its `resolve()`-era literal choice id (Bazaar of Baghdad\'s "bazaar-discard"); `bind` still names the picks binding regardless. Optional `candidates` (Barrin\'s Spite) narrows the pick to specific ALREADY-KNOWN objects — an `EffectObjectSelector[]`, in practice the announced targets — instead of a whole zone; `zone: "battlefield"` only (the other zones are hidden or unordered, so nothing in them can be named ahead of the pick). It is what makes "choose one of THEM" a CLICK ON A CARD instead of a list of prose modes that name neither creature; a selector that no longer resolves to a battlefield permanent drops out and the count clamps to the remainder (CR 608.2b), and a `filter` narrows the resolved set further. Optional `bindOther` (requires `candidates`) snapshots the ONE candidate NOT picked — the complement no announced slot can name, since which slot it is depends on the choice (Barrin\'s Spite\'s "return THE OTHER to its owner\'s hand"). A normal object snapshot, so every object-acting Op reads it; left UNCAPTURED (and therefore skipped, CR 608.2b) unless exactly one candidate remains unpicked.',
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
        note: 'Optional "you may pay {cost}" decision (CR 117.3a / 118.4, issue #806) mapped 1:1 onto the existing `may-pay` Pending Choice pipeline — same enqueue, same generic Pay/Skip prompt UI, same submitMayPay mutation. The interpreter SUSPENDS the script at this Op and resumes here when the player answers; its required `bind` names a BOOLEAN binding (true = paid) read by a later `if` predicate. The counter/punisher primitive: "… unless its controller pays {2}". CR 122.1 (issue #1194) — `cost.energy` is a FIXED-count `MayPayCost` leg ("you may pay {E}{E}{E}", Guide of Souls), the declarative counterpart of the already-shipped `getEnergy` Op\'s generation half: `canPayMayPayCost` gates on `player.energyCounters >= cost.energy`, `payMayPayCost` spends via the existing all-or-nothing `SpellContext.payEnergy` primitive (#697). No new Op — `energy` composes into the SAME cost union `mana`/`life`/`sacrifice`/`discard` already ride. Issue #1958 — the DYNAMIC mana shape (`DynamicMayPayManaCost`, issue #1150) is generalized on both axes it already had implicitly: the base may be a LITERAL `mana` cost as well as a referenced object\'s printed one (`manaCostOf`), and `reducedBy` is now a full `EffectValue` rather than a fixed integer. That covers "pay {10}. This cost is reduced by {2} for each basic land type among lands you control" (Draco) as `{ mana: { X: 10 }, reducedBy: { domain: { of: "controller", times: 2 } } }` — reusing the existing `{ domain }` value member rather than a bespoke reader, and floored at {0} by the same `reduceGenericMana` clamp (CR 118.9). Resolved by the interpreter at Op execution time, so the price is read off the board as the trigger resolves.',
    },
    {
        op: "if",
        status: "implemented",
        cr: "608.2c",
        binding: "interpreter branch selection (no primitive)",
        // Predicate forms: boolean-binding, numeric comparison, picksNonEmpty
        // (#1287), targetIsAnother (#1315), picksMatchFilter (#1343) and
        // boundMatchesFilter (Minsc & Boo). The last two are a deliberate
        // PAIR, not duplicates: `picksMatchFilter` resolves the picked cards
        // through a player's GRAVEYARD (right for connive — CR 701.9 puts
        // every discard there and it stays), `boundMatchesFilter` reads a
        // `bind` snapshot's CR 608.2h last-known characteristics with no zone
        // lookup at all (right for a sacrifice — a sacrificed TOKEN ceases to
        // exist, CR 704.5d, so there is nothing in any zone to match).
        note: "The `if` structural construct (ADR 0045, issue #806) — NOT an Op verb but the third frozen construct, registered here so the Op-vocabulary coverage guard (registry ⇄ interpreter ⇄ validator ⇄ scenario-assertor, 1:1) counts it. Branches the script on a PREDEFINED predicate form (a boolean-binding test — e.g. a mayPay outcome — a numeric comparison, a `picksNonEmpty` test (issue #1287) reading whether a preceding `choice` Op's picks binding actually captured anything, e.g. Krovikan Sorcerer / Mesmeric Trance's \"draw only if a card was actually discarded\" gate, a `targetIsAnother` test (issue #1315): an object-identity comparison, true iff an announced target slot resolves to a permanent OTHER than the resolving ability's source, Backup's \"if that's ANOTHER creature, it gains …\" gate (CR 702.165a), or — issue #1343 — a `picksMatchFilter` test: true iff at least one picked card, resolved via a named player's graveyard (CR 701.9 — every discard lands there), matches an `EffectCardFilter`, connive's \"if you discarded a nonland card\" gate (CR 701.50, Ledger Shredder)), never an arbitrary expression, so the validator and the bot can read the condition. then/else are Op lists; a suspending Op inside a branch suspends/resumes exactly as at the top level.",
    },
    {
        op: "sacrifice",
        status: "implemented",
        cr: "701.16",
        binding: "SpellContext.sacrifice",
        mechanicId: "sacrifice",
        note: 'Effect Script Op for the CR 701 keyword action "Sacrifice" — sacrifices either the permanents a `choice` Op picked (a bare picks ref `permanents`, e.g. { ref: "$sac" }, the "each player sacrifices …" forEach pattern, Innocent Blood, issue #807) OR a single announced target / snapshot-bound permanent (`target`, e.g. { ref: "$guard" } — "sacrifice that/this creature", Kjeldoran Elite Guard / Phantasmal Mount, issue #731; resolved through the object-ref path with a CR 608.2b battlefield re-check). The `target` form also serves a `delayedTrigger` body\'s captured object (issue #1151): `runDelayedTriggerBody` re-binds a captured battlefield permanent id as a fresh snapshot at fire time, so `{ op: "sacrifice", target: { ref: "$captured" } }` sacrifices the EXACT captured creature — the shape Sneak Attack ("…Sacrifice the creature at the beginning of the next end step") and Goblin Kites need, closing the `sacrificeObject` backlog reservation (EFFECT_OP_BACKLOG never needed a separate Op name for it). Exactly one form per Op. Indestructible does not prevent sacrifice (CR 701.16a); dies-triggers fire as for imperative cards. `bind` (Minsc & Boo) snapshots the sacrificed permanent BEFORE it leaves the battlefield — the same snapshot family destroy/exile/moveZone bind, so a later Op reads CR 608.2h last-known information off it (`{ ref: "$sac.power" }` for "where X is that creature\'s power"); on the `permanents` picks form it binds the FIRST pick (the "sacrifice A creature" shape), mirroring digToHand\'s first-kept-card bind.',
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
        note: 'General zone movement (CR 400.7, issue #839). A thin declarative skin over three SpellContext primitives, one execution path (ADR 0045): the object\'s CURRENT zone is inferred from its kind (a permanent → returnToHand from the battlefield; a graveyard-card → returnToBattlefield when `to` is the battlefield, else moveCardById from the graveyard). `target` is an announced slot (Unsummon, Raise Dead, Resurrection) or a bare `$source` snapshot (self-bounce — Blinking Spirit); `to` is the destination zone; there is no `from` (it is inferred). Subsumes the returnToHand / moveCardById / returnToBattlefield closures the migration classifier folds here (~35 blocked closures at ship time). SECOND SHAPE (issue #677): `cards` (a bare choice-picks ref) + `player` — the SEARCH half of a tutor/fetch effect. A library card has no announced-target form (CR 601.2b — hidden zone), so a `choice(zone:"library", kind:"search-library")` Op\'s picks are consumed here instead of via `target`: `to: "hand"`/`"graveyard"`/`"exile"` routes through `moveCardById(player, id, "library", to)` (Vampiric Tutor, Entomb), `to: "battlefield"` routes through `putFromLibraryOntoBattlefield` (a fetchland\'s "put it onto the battlefield", Natural Order), `to: "library-top"` (issue #1125, `from: "library"` only) routes through `putLibraryCardsOnTop` — the tutor-to-top template ("search…, then shuffle and put that card on top", Vampiric Tutor / Mystical Tutor / Imperial Seal / Sterling Grove): the picked card is relocated from anywhere in the library (not just a known top-N window) to the front, preserving pick order. Pair with a trailing `libraryLook`(shuffle) Op for `to: "hand"/"graveyard"/"exile"`, or a PRECEDING `libraryLook`(shuffle) for `to: "library-top"` (shuffle-then-place, per the oracle text order), as every tutor/fetch card does. `bind` (issue #1151, closing #1120 gap 3) is now also valid on the `cards` shape when `to: "battlefield"` — it snapshots the just-entered permanent so a follow-up Op can act on it (a haste grant, a `delayedTrigger` capture of the exact creature), unblocking Sneak Attack\'s "You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice it…" template. RETURN-A-DEPARTED-OBJECT (issue #1469): the `target` shape may carry an explicit `from: "graveyard" | "exile"` alongside `to: "battlefield"` when `target` is a snapshot `ref` bound by an EARLIER `destroy`/`exile`/`sacrifice` in the same script — the "return each card put into a graveyard THIS WAY" linkage (Sorin, Lord of Innistrad\'s −6). The zone is NOT inferrable from the snapshot kind there (the object already left the battlefield), so it is re-derived FROM THAT ZONE at execution time via `getGraveyardCardOwner`/`getExileCardOwner`; the linkage is the existing `bind` snapshot plus this post-move zone re-check, NOT a list-valued binding. Every miss is a CR 608.2b no-op: a target that survived the destroy (indestructible/regenerated) is still on the battlefield, a `graveyardDestinationFor` exile redirect never reached the graveyard, and a token ceased to exist (CR 704.5d). `tapped` (CR 110.5a) is likewise valid on the `target` shape with `to: "battlefield"` (issue #1469), same direct-`tap`-after-entry simplification the `cards` shape uses. BLINK — exile-then-return IN ONE RESOLUTION (issue #1401): a two-Op script `[{ op: "exile", target, bind: "$c" }, { op: "moveZone", target: { ref: "$c" }, to: "battlefield" }]` needs NO explicit `from` at all — `resolveObjectRef` itself now falls back to an exile-zone lookup (`getExileCardOwner`) after the battlefield/hand checks miss, resolving the ref to the just-exiled card and returning it as the generic graveyard-card carrier. Because that resolution bypasses the #1469 explicit-`from` recovery branch (which is what normally sets the graveyard-vs-exile source zone), the executor re-derives the actual source zone right before calling `returnToBattlefield`/`moveCardById` by checking `getGraveyardCardOwner`/`getExileCardOwner` directly — so a blink and a real graveyard-card target share the exact same executor path with no separate branch. `returnToBattlefield(owner, id, "exile")` is the SAME primitive the resolve() flicker cards already call (Liberate, Flickerwisp, Krovikan Vampire/Seraph) — the returned permanent is a genuinely NEW object (summoning sickness reset, counters/attachments dropped, ETB triggers fire, CR 603/720). Card migration to this primitive is a separate ticket (#1403); this Op change only unblocks it. FOURTH SHAPE (issue #1104) — a FILTER-DRIVEN bulk sweep across one or more zones, no player choice: `player` + `fromZones` (a non-empty array of plain zones) + `filter` + `to`. Every card in each listed zone matching `filter` moves to `to`, via the SAME `moveCardById` primitive the `cards` shape\'s non-battlefield branch already calls — no new SpellContext primitive. Unblocks "search that player\'s graveyard, hand, and library for all cards with the same name as the chosen card and exile them" (Lobotomy): `filter: { name: { ref: "$chosen" } }` reads the name off an EARLIER `choice` Op\'s picks binding (`resolveNameRef`, resolving the picked INSTANCE ID to its live name via the new `SpellContext.getCardName`, distinct from `EFFECT_OP_BACKLOG`\'s `nameCard`-sourced name-string binding but sharing the same bare-ref grammar position). Restricted to the four PLAIN zones on `to` (no `to: "battlefield"` reanimation branch — that\'s the `forEach { set: "graveyard" }` idiom; no `to: "library-top"` — meaningless with no ordered pick list). POSITIONAL LIBRARY INSERT (issue #1726): the `target` shape accepts `to: "library"` + `position` (1-based from the top — "Put target nonland permanent into its owner\'s library third from the top", Teferi, Hero of Dominaria\'s −3, = 3; 1 = top when omitted — the \'put on top of its owner\'s library\' default; invalid with any other destination, and a graveyard-card target keeps the historical moveCardById shuffle-in path — Worldspine Wurm). Routes through the new SpellContext primitive `putIntoLibraryFromBattlefield` — the SAME LTB funnel as a bounce (`removePermanentTo`), so aura cleanup, counter loss, PERMANENT_LEFT and an `exileOnLeave` redirect all apply; a library shorter than the position puts the card on the BOTTOM (splice clamps — the official Teferi ruling), and the moved card is stamped known-to-all (ADR 0026 — both players watched which card went in and where; a shuffle clears it). LINKED-EXILE SWEEP (issue #1947): the `cards` shape\'s optional `linkToSource: true` flag stamps `linkExileToSource` on every moved card, valid only with `to: "exile"` — "search your library for any number of artifact and/or creature cards, exile them" (Skyship Weatherlight) needs every exiled card linked back to the exiling permanent so a LATER ability can name exactly this pile (`getCardsExiledWith` / the new `randomExileToHand` Op\'s `pickRandomCardExiledWith`), generalizing `hideaway`\'s single-card CR 607 stamp to an arbitrary-count tutor sweep — a parametrization of this EXISTING shape rather than a new Op. FIFTH SHAPE (issue #1967) — a DETERMINISTIC POSITIONAL graveyard pick, no player choice: `target: { zone: "graveyard", position: "top" | "bottom", player?, filter? }` (an `EffectZonePositionSelector`, accepted by this Op and NO other — every other object-acting Op is battlefield-scoped, so widening the shared `isObjectSelector` would let the shape validate and then silently no-op there). "Return the top creature card of your graveyard to the battlefield" (Shallow Grave, `mir/black.ts`; Corpse Dance, `tmp/black.ts`). The graveyard is an ORDERED zone (CR 404.3) and every insertion site in the engine APPENDS (`moveCard` / `removePermanentTo`, `gre/state.ts`, both carry the CR 404.3 note), so `player.graveyard` runs oldest-first and the LAST element is the TOP — `position: "top"` scans the array BACKWARDS, `"bottom"` forwards. `filter` makes it a FILTERED positional scan, which is what the oracle wording asks for: "the top **creature** card" is the topmost card MATCHING the filter, not "the top card, if it is a creature" (a Lightning Bolt above a Griselbrand does not make Shallow Grave fizzle); matched through the same `matchesCardFilter` every other hidden-zone filter site uses. `player` defaults to `"controller"` (both shipped cards say "YOUR graveyard"). Once located, execution funnels into the EXACT same graveyard-card executor the announced-target shape uses — no new SpellContext primitive, and `bind`/`controller`/`tapped` keep their meanings; `from` and the numeric library `position` are validator-rejected on this shape. An empty graveyard or a filter matching nothing is a clean CR 608.2b no-op. SINGLE-TARGET LINK (issue #1947, generalized #1323): the announced-slot `target` shape now also accepts `linkToSource?: boolean`, valid only with `to: "exile"` — the single-card twin of the `cards` shape\'s own `linkToSource`, for "exile up to one target card from a graveyard" (Emperor of Bones, `mh3/black.ts`) where the exiled card must be individually linked back to its exiler rather than swept in bulk. SIXTH SHAPE (issue #1319 foundation, generalized #1323) — the linked-exile selector: `target: { exiledWithSource: true }` (the existing `EffectExiledWithSourceSelector`, issue #783, previously wired only into `castDuringResolution`), with an optional sibling `filter` (reusing the FOURTH shape\'s own field) narrowing by type. "Put a creature card exiled with this creature onto the battlefield under your control" (Emperor of Bones\' counter-placement trigger) — every card in ANY player\'s exile currently linked to the resolving source (`getCardsExiledWith`), the first `filter`-matching entry in that stable order. Mirrors the FIFTH shape\'s own "deliberately not a player choice" precedent: exile carries no CR-defined order the way a graveyard does, so a documented deterministic first-match stands in for the general CR 608.2 "appropriate player chooses" default on a 2+-candidate tie (the common case at resolution time is 0 or 1 linked card). Funnels into the SAME graveyard-card executor as every other `target` shape — no new SpellContext primitive; `from`/`position`/`to: "library-top"` are validator-rejected (the source zone is intrinsic).',
    },
    {
        op: "delayedTrigger",
        status: "implemented",
        cr: "603.7",
        binding: "SpellContext.scheduleDelayedTrigger",
        note: 'Grants a delayed triggered ability (CR 603.7, ADR 0048, issue #838): "At the beginning of the next <boundary>, <do something>". The delayed body is an INLINE nested Effect Script persisted on the DelayedTriggerInstance (self-contained in game state — no card-def lookup at fire time); everything the body needs from scheduling time crosses via the explicit `capture` map, resolved to serializable ids at scheduling and re-bound as the body\'s initial binding environment when the trigger fires. The two grammar gaps ADR 0048 deferred have since closed (ADR 0049): event-field captures ($event.<field> — Battering Ram, Nafs Asp, issue #865) and LIST-valued captures ({ select: EffectListSelector } re-bound as a `string[]` list binding a `forEach { set: "bound" }` iterates — Venomous Breath, issue #866, freeze-at-cast per CR 509.1h). Beyond the phase-boundary timings, an INSTANCE leave-watch timing (`leaves-battlefield` + a `watch` object ref, CR 603.7a / 603.10, issue #731) fires on the watched permanent\'s PERMANENT_LEFT ("when THAT creature leaves the battlefield this turn, …" — Kjeldoran Elite Guard, Kjeldoran Guard, Phantasmal Mount); a pending watch expires unfired at CLEANUP (the "this turn" bound, CR 514.2). Its INDEFINITE twin `leaves-battlefield-indefinite` (issue #1470, earthbend N — "When it dies or is exiled, return it to the battlefield tapped") shares every seam — same required `watch`, same `watchInstanceId` match, same dequeue-on-firing — and differs ONLY in that the CLEANUP purge does not list it, so the watch survives end of turn and still fires on a later turn (the purge encodes the "this turn" CLAUSE, not a general rule about leave-watches). Its body reads the departed object back through `runDelayedTriggerBody`\'s graveyard/exile binding fallback (the battlefield-scoped seed always misses for a watch that fired precisely because its object left) and returns it with `moveZone`\'s `from:`/`tapped:` shape (issue #1469). A REPEATING combat-event timing (`this-turn-creature-blocks`, CR 603.7d / 603.10, issue #884) fires once per BLOCKERS_CONFIRMED event for the rest of the turn ("Whenever a creature blocks this turn, …" — Battle Cry) instead of once total: unlike every other timing it is never dequeued by firing (only purged at CLEANUP, regardless of fire count), and — because the firing event is genuinely live at fire time — its body may read `$event.blockerId` directly with no `capture` map at all (validate.ts scopes `$event` legality to this one timing\'s body). A SECOND repeating combat-event timing (`this-turn-creature-deals-combat-damage-to-player`, CR 720.2, issue #1199) mirrors that shape for Forth Eorlingas!\'s "Whenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch": it fires at most ONCE per event batch (collapsing simultaneous multi-creature/multi-player hits, per the official ruling) rather than once per matching event, and its body (`[{ op: "becomeMonarch" }]`) needs no `capture`/`$event` at all — `ctx.controller` at fire time already IS the scheduling player (the resolving stack item\'s own `controllerId`, set from the scheduling `DelayedTriggerInstance.controller`). A SECOND instance-scoped watch timing (`attacks-unblocked`, CR 603.7a / 509.1h) mirrors the leave-watch shape on a different event: it requires the same `watch` object ref, matches its `watchInstanceId` against the ATTACKER_UNBLOCKED ids in the firing batch (emitted once per unblocked attacker at blocker confirmation), is dequeued by firing ("when", not "whenever") and is purged at CLEANUP when its creature never attacked unblocked this turn — Delif\'s Cone / Delif\'s Cube\'s "This turn, when target creature you control attacks and isn\'t blocked, …". Unlike a leave-watch its watched instance is still on the battlefield at fire time, so the captured creature re-snapshots live and the body reads its EFFECTIVE power as `{ ref: "$c.power" }` (CR 613) with no power-valued EffectValue member needed.',
    },
    {
        op: "reflexiveTrigger",
        status: "implemented",
        cr: "603.3c",
        binding: "SpellContext.pushReflexiveTrigger",
        note: "Creates a REFLEXIVE triggered ability (CR 603.3c) from inside the resolving effect that just performed the action it triggers off: \"Sacrifice a creature. WHEN YOU DO, ~ deals X damage to any target, where X is that creature's power\" (Minsc & Boo, Timeless Heroes). NOT a delayedTrigger — nothing is waited for. The ability is queued as the Op executes and the next trigger drain (`processPendingActionTriggers`) places it on the stack above the object that created it, APNAP-ordered against the other triggers that became waiting during the SAME resolution (CR 603.3b — typically the dies-trigger of the very sacrifice that produced it; `StackItem.reflexiveTrigger` marks it as an orderable PLAIN trigger rather than an engine-internal firing, and keys it per instance so two reflexives are put to a real ordering decision). `targetRequirement` is announced as it goes on the stack (CR 603.3d) via the issue-#1193 machinery, reading from the new `StackItem.inlineTargetRequirement` where a card-def trigger reads `ability.targetRequirement` — which is the POINT of the shape: the target is chosen KNOWING what was sacrificed, and both players get priority before it resolves. Rides the ADR 0048 inline-body machinery whole (`delayedTriggerId: INLINE_DELAYED_TRIGGER_ID` + `delayedEffects` + `delayedPayload`, resolved through `runDelayedTriggerBody`) — no new resolution path. `capture` is the only data crossing into the body; unlike delayedTrigger's capture a BARE binding ref carries the recorded binding VERBATIM instead of flattening it to an instance id, which is what makes CR 608.2h last-known information survive (a `sacrifice`-bound snapshot still reads `$sac.power` from the graveyard, where an id would re-bind to nothing). Does not nest inside another reflexiveTrigger or a delayedTrigger body (validator-enforced, one deferral level per script).",
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
        note: 'Tap or untap a permanent (CR 701.26, issue #842). A thin declarative skin over two SpellContext primitives, one execution path (ADR 0045): `action: "tap"` → tap (Icy Manipulator\'s "tap target artifact, creature, or land"), `action: "untap"` → untap (Twiddle\'s untap mode). `target` is an announced slot, the resolving source (`$source` — a permanent tapping itself), or a forEach `$each` (a mass tap). No amount — a permanent is tapped or it isn\'t; the primitives no-op when the permanent is already in the requested state (CR 701.26a/b) and are skipped when it has left the battlefield (CR 608.2b). Optional `bind` (issue #1416) snapshots the permanent\'s power/toughness/controller as last-known information (CR 608.2h) via the shared `bindSnapshot` path — WITHOUT a zone change — so a live target\'s power survives for a trailing effect (Backlash: `$bound.power` damage to `$bound.controller`). Subsumes the tap / untap closures the migration classifier folds here (~68 blocked closures at ship time). `tapAllLands` (Mana Short, Drain Power — a whole-player tap, not a permanent target) stays resolve() by design; it is not a `tap`-on-a-selected-permanent skin.',
    },
    {
        op: "skipNextUntap",
        status: "implemented",
        cr: "502.1",
        binding: "SpellContext.skipNextUntap",
        note: 'A permanent "doesn\'t untap during its controller\'s next untap step" (CR 302.6 / 502.1, PRD #795). A thin declarative skin over the single SpellContext primitive `skipNextUntap`, one execution path (ADR 0045): it stamps a one-shot instance flag consumed by (and cleared after) exactly one untap step — Barl\'s Cage / Elvish Hunter ("target creature doesn\'t untap …", an announced slot), the Homarid dive cycle / Deep Spawn (`$source`, paired with a `tapUntap` tap + a `grantAbility` shroud), and Goblin Rock Sled (`$source`, a self-lock arming trigger). `target` is an announced slot, the resolving source (`$source`), or a forEach `$each`. No amount / duration — the one-shot next-untap scope is intrinsic; skipped when the permanent has left the battlefield (CR 608.2b). Subsumes the `skipNextUntap` closures the migration classifier folds here. The CONTINUOUS source-linked variant (`lockUntapWhileSourceTapped`, "doesn\'t untap as long as … remains tapped") is a distinct primitive and stays `planned` (its own `lockUntap` row).',
    },
    {
        op: "discardAtRandom",
        status: "implemented",
        cr: "701.8",
        binding: "SpellContext.discardAtRandom",
        note: "A player discards `count` cards chosen AT RANDOM from their hand (CR 701.8a, PRD #795). A thin declarative skin over the single SpellContext primitive `discardAtRandom`, one execution path (ADR 0045): the primitive draws the discarded cards from the game's seeded PRNG so replays stay deterministic. `player` is an announced target slot (Hymn to Tourach's \"target player discards two cards at random\", Mind Twist, Gwendlyn Di Corci's activated ability) or a relative selector; `count` is a literal or an EffectValue (Mind Twist's chosen-cost {X}). DISTINCT from the `discard` Op, which discards a player-CHOSEN set (a `choice`-bound picks ref) or the WHOLE hand — this Op owns the RANDOM selection no `choice` binding can express. No type/subtype filter: the filtered variant (The Fallen's \"discards a creature card at random\", which reveals the hand first) stays resolve() until a real card warrants a filter parameter. Skipped when the player is gone (CR 608.2b); an empty hand is a no-op. Optional `bind` (issue #1123, Aether Rift) snapshots the first discarded card (mirrors `destroy`/`exile`'s `bind` shape) so a later `if`/`boundMatchesFilter` can test what was discarded (\"if you discard a creature card this way\") and a later `moveZone` can reanimate it from the graveyard.",
    },
    {
        op: "randomExileToHand",
        status: "implemented",
        cr: "400.7",
        binding: "SpellContext.pickRandomCardExiledWith / moveCardById",
        note: "Choose a card AT RANDOM from the exile pile linked to the resolving ability's OWN source, and put it into ITS OWNER's hand (issue #1947 — Skyship Weatherlight: \"Choose a card at random that was exiled with Skyship Weatherlight. Put that card into its owner's hand.\"). A thin declarative skin over the single SpellContext primitive `pickRandomCardExiledWith` + the existing `moveCardById`, one execution path (ADR 0045): the primitive scans every owner's exile for the `exiledBySourceId` stamp `linkExileToSource` left behind (the SAME pool `getCardsExiledWith` enumerates for Currency Converter's player-CHOSEN retrieval and `hideaway`'s `{ exiledWithSource: true }` cast-permission selector, issue #791/#783) and draws uniformly from the game's seeded PRNG (mirrors `discardAtRandom`'s determinism precedent) so replays reproduce the same pick. No fields: the pool is always \"the pile linked to $source\" and the destination is always the picked card's own OWNER's hand (CR 400.7 — which may differ from the activating player, the errata-corrected wording modern Oracle text carries). Skipped (CR 608.2b no-op) when the pile is empty — the official 2004-10-04 ruling that the ability is still activatable with nothing exiled, it simply resolves with no effect. Feeds off a companion parametrization of the EXISTING `moveZone` Op (its `cards` shape's new `linkToSource` flag, issue #1947) rather than a second new Op: \"search your library for any number of artifact and/or creature cards, exile them\" stamps every exiled card with this same link via `linkExileToSource`, generalizing `hideaway`'s single-card stamp to an arbitrary-count tutor sweep.",
    },
    {
        op: "grantAbility",
        status: "implemented",
        cr: "613.1f",
        binding: "SpellContext.grantStaticAbility",
        note: 'Grant a keyword static ability to a permanent for a limited duration (layer 6, CR 611.2a / 613.1f, issue #843). A thin declarative skin over one SpellContext primitive, one execution path (ADR 0045): `ability` is the free-form keyword granted ("flying", "trample", "haste", "banding", …; read at combat / rules-check time), `target` is an announced slot, the resolving source (`$source` — a permanent granting itself), or a forEach `$each` (a mass grant), and `duration` is the phase boundary at which the grant expires (CR 611.2 — the phase-boundary purge splices the keyword back out). The primitive appends to `staticAbilities` and is skipped when the permanent has left the battlefield (CR 608.2b). Subsumes the grantStaticAbility closures the migration classifier folds here (~52 blocked closures at ship time). Ability REMOVAL / loss (`removeStaticAbilities`) takes a predicate closure — not JSON-expressible — and stays resolve() by design; the permanent-grant variant (`grantStaticAbilityPermanent`, no duration, Cocoon-style Aura hatch) is not folded here. Two further payloads ride the SAME Op, exactly one set per Op (validator-enforced): `grantedActivatedId` (issue #738, Touch of Vitae) names an activated-ability template on the resolving source\'s `grantTemplates[]`, and `grantedTriggeredId` (issue #1665, Guardian Scalelord\'s Backup 1) names a TRIGGERED-ability template on its `triggeredGrantTemplates[]` — `effectiveTriggeredAbilities` (gre/copy.ts) unions it into the recipient\'s triggers so the collector scans/resolves it as if printed there. All three legs mirror the keyword leg\'s duration split — omitted `duration` = INDEFINITE (CR 611.2b/c): `grantTriggeredAbility` / `grantTriggeredAbilityPermanent` for the triggered leg, and (issue #1880) `grantActivatedAbility` / `grantActivatedAbilityPermanent` for the activated one, whose indefinite primitive Urza\'s Saga chapters I / II need.',
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
        note: 'Turns a permanent into a creature with a given base P/T, optional subtype/additionalTypes/permanently-granted keyword abilities, for `duration` (a temporary Mishra\'s-Factory-style animation, CR 611.2) or INDEFINITELY when `duration` is omitted (CR 611.2b — no revert until the permanent leaves the battlefield). A thin declarative skin over the pre-existing SpellContext primitive `animateAsCreature` (previously reachable only from a `resolve()` closure — Mishra\'s Factory, atq/colorless.ts — never a DSL Op), one execution path (ADR 0045). `target` is an announced slot, the resolving source (`$source`), or a forEach `$each`; `power`/`toughness` are the animation\'s base stats (a later `counters`/`pump` Op still applies on top, CR 613.4). Issue #1317 (Earthbend N, TLA — Badgermole Cub): `animate` (0/0, NO subtype — CR 701.66a grants the card type Creature "in addition to its other types", not a creature subtype; `grantedAbilities: ["haste"]`, no `duration`; corrected in issue #2446 after shipping with an ungranted `subtype: "Elemental"`) composes with the pre-existing `counters` Op (`action: "add"`, "+1/+1", count N) to fully decompose CR 701.66a\'s "Target land you control becomes a 0/0 land creature with haste in addition to its other types. Put N +1/+1 counters on it." — no earthbend-specific Op needed (primitive-reuse mandate). Issue #1470 closed the INDEFINITE animation\'s CR 400.7 end-of-life gap: an animation mutates the instance IN PLACE (`types`/`subtypes`/`power`/`toughness`), and a `duration`-less one has no tick to revert it, so a land that left the battlefield and came back was still a 0/0 creature-land with the granted haste. `resetBattlefieldTransientState` (`gre/state.ts`) — the shared chokepoint for both the hand/library departure and every reanimation-style ENTRY — now calls the exported `revertAnimation` and splices the animation-granted keywords back out of `staticAbilities`, so the returning object is a plain land (also fixing the same class for a bounced manland). See the `earthbend` row below for the keyword\'s own census entry.',
    },
    {
        op: "setBasePT",
        status: "implemented",
        cr: "613.4b",
        binding: "SpellContext.setBasePT",
        note: 'SET a permanent\'s base power and/or toughness to a fixed characteristic value (CR 613.4b layer 7b), locked at resolution (CR 611.2), for `duration` (issue #1318). A thin declarative skin over the pre-existing SpellContext primitive `setBasePT` (previously reachable only from `resolve()` closures — Sorceress Queen, Island of Wak-Wak, Singing Tree, the 5/5 set), one execution path (ADR 0045). Distinct from `pump` (a layer-7c RELATIVE +N/+N modifier) and from `animate` (a layer-7a base-P/T set that ALSO turns the permanent into a creature): this is the standalone "has base power and toughness N/N" / "has base power 0" set on a permanent that is ALREADY a creature. `power`/`toughness` are each OPTIONAL non-negative-int characteristics (0 is legal, CR 107.4b); an omitted stat is left untouched (Island of Wak-Wak sets only power) — at least one is required. `target` is an announced slot, `$source`, or a forEach `$each`. SCOPE: literal fixed values only — the P/T-snapshot form (Wood Elemental / Sentinel: "base P/T equal to the target\'s power") and the additive-count form (leg/black: "1 plus the creatures in your graveyard") stay resolve(), blocked on a value-from-target ref / additive-count construct, NOT on this Op.',
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
        note: 'Mill: move the top `count` cards of a player\'s library into their graveyard (CR 701.17, issue #885). A thin declarative skin over the single `millCards` SpellContext primitive (issue #1055 — the mill twin of `drawCards`), one execution path (ADR 0045): `millCards` re-reads the LIVE top id each pass and moves it library → graveyard, stopping early when the library empties (CR 701.17a). Deterministic — no player choice, so unlike `scryReorder` it does not suspend. `player` names whose library is milled (an announced target slot — "target player mills N"; the resolving controller; or a forEach `$each`); `count` is the number milled. EMITS a CARD_MILLED event per card (issue #1055) so "when this card is put into your graveyard from your library" self-triggers fire (Gaea\'s Blessing) — the mill choke point, mirroring `drawCards`/CARD_DRAWN. Previously composed peekLibraryTop + moveCardById inline (no event); folded into `millCards` when the mill trigger shipped. Optional `bind` (issue #1095, Loafing Giant: "mill a card. If a land card was milled this way, …") snapshots the FIRST card that genuinely reached the graveyard, mirroring `discardAtRandom`\'s bind shape and family (a graveyard-card snapshot read back by `boundMatchesFilter`). `millCards` returns exactly the ids it emitted CARD_MILLED for, so the binding draws the SAME line that event does: a card a CR 614 graveyard-bound replacement (Yawgmoth\'s Will / Dauthi Voidwalker) redirected to exile was exiled, not milled, and never binds. Nothing binds when the library was empty or every card was redirected (CR 608.2b).',
    },
    {
        op: "revealTopAndRoute",
        status: "implemented",
        cr: "701.20a",
        binding:
            "SpellContext.peekLibraryTop / getLibraryCards / markKnownToAll / notifyReveal / putFromLibraryOntoBattlefield / moveCardById",
        note: 'Reveal-and-route the top of a library (CR 701.20a reveal + CR 400.7 zone change) — "Reveal the top card of your library. If it\'s a land card, put it onto the battlefield. Otherwise, put it into your hand." (Nadu, Winged Wisdom). A thin declarative COMPOSITION over primitives that already exist — no new SpellContext primitive (ADR 0045 "generalize, don\'t add"): `peekLibraryTop` names the window, `getLibraryCards` snapshots the revealed cards\' characteristics BEFORE any of them move (routing card 1 onto the battlefield mutates the library, so a later card\'s filter must still read what was revealed), `markKnownToAll` + `notifyReveal` make the window public (the SAME persistent-grant + transient-dialog pair `digToHand`\'s reveal leg fires), and each card leaves the library through `putFromLibraryOntoBattlefield` (battlefield) or `moveCardById(player, id, "library", …)` (hand / graveyard / exile) — the exact two primitives `moveZone`\'s `cards` shape already dispatches between. DETERMINISTIC: the destination is dictated by the revealed card\'s OWN characteristics, so unlike `digToHand` / `scryReorder` / `revealAndCategorize` there is nothing for a player to pick and this Op NEVER suspends — which is precisely the gap it fills, since all three of those end in a pick from a revealed window and none can express "land → battlefield, everything else → hand". `routes` is an ORDERED, non-empty `{ filter, to }` list evaluated FIRST MATCH WINS per revealed card (write the more specific rule first); `fallback` is the Oracle text\'s "Otherwise, …" destination and is REQUIRED, so a non-matching card can never be silently stranded; `filter` is the same `EffectCardFilter` the hidden-zone `choice`/`count` constructs use, matched through the shared `matchesCardFilter`; `count` (optional, default 1) is how many top cards are revealed. `RevealRouteDestination` deliberately omits `"library"` — the card is already there, and "put it back on top / on the bottom" is `scryReorder`\'s job (it owns the ordering choice this Op has no use for). Every miss is a CR 608.2b no-op: an empty library reveals nothing AND fires no reveal dialog, a non-positive `count` is skipped, and a revealed id no longer in the library when it is routed is passed over.',
    },
    {
        op: "hideaway",
        status: "implemented",
        cr: "702.75",
        mechanicId: "hideaway",
        binding:
            "SpellContext.peekLibraryTop / requestChoice / exileFaceDown / linkExileToSource / reorderLibraryTop",
        note: "Effect Script Op for the CR 702.75a HIDEAWAY keyword (issue #783): look at the top `look` cards of `player`'s library, exile ONE of them FACE DOWN, and put the rest on the bottom of that library in a random order. Emitted ONLY by `expandHideaway` (convex/cards/abilities/hideaway.ts) from a card's bare `hideaway N` keyword string — a card never writes this Op by hand. Structurally `digToHand` with the kept card routed to face-down, source-LINKED exile instead of to hand, and it reuses digToHand's machinery verbatim: `peekLibraryTop(look)` names the window, ONE suspending `look-distribute` `requestChoice` (candidateIds = the looked-at ids, count EXACTLY 1, `randomizeRest` so the client mounts the simple grid rather than the bottom-ordering drag) drives the pick, and the shared `bottomLookedAtCards` tail bottoms the remainder with `randomBottom` (CR 401.4's random order is unobservable for face-down library cards, so no ordering pick and no `markKnown`). No new SpellContext primitive, per the \"generalize, don't add\" primitive-reuse rule — the two pieces `digToHand` lacks already existed: `exileFaceDown` (ADR 0026 impulse-draw, PRD #338) grants `knownTo: [controller]` so the exiled card's identity is visible to its controller ALONE and `projectExileCard` re-derives that per-viewer gate on the wire (CR 406.3 — the controller may keep looking until the card leaves exile; every other viewer sees the FACE_DOWN_CARD_ID sentinel, still pinned to the permanent since the association is public but the identity is not), and `linkExileToSource` (issue #791) stamps the CR 607 / 406.6 LINK to the resolving ability's source permanent, which the card's own later \"you may play the exiled card\" ability reads back via `grantCastFromExile`'s `{ exiledWithSource: true }` selector — the only way a SECOND ability can name what a FIRST ability exiled (a `bind` cannot span two separate resolutions). Deliberately UNPARAMETRIZED beyond `look`: exactly one card is exiled (CR 702.75a, so no `take`), any looked-at card is eligible (no `filter`), it is not a \"may\" (no `optional`), the rest always go to the library bottom in a random order (no `destination` / `randomBottom`), the look is private and the exile face down (no `reveal`), and nothing later in the SAME script reads the exiled card (no `bind` — the CR 607 link is the cross-ability channel). SUSPENDS like `choice` / `scryReorder` / `digToHand`. Every miss is a CR 608.2b no-op that never suspends: a gone player, `look` <= 0, or an empty library.",
    },
    {
        op: "digToHand",
        status: "implemented",
        cr: "401.4",
        binding:
            "SpellContext.peekLibraryTop / requestChoice / readOrderedSecond / moveCardById / reorderLibraryTop / markKnown / markKnownToAll / notifyReveal",
        note: 'Dig to hand (CR 401.4 "look at", issue #984, extended #1101): look at the top `look` cards of a library, put `take` of them (default 1) into hand, and send the rest to `destination` (the library BOTTOM by default, in any order, or the GRAVEYARD — issue #1101, Reviving Vapors). A thin declarative skin composed of existing primitives (the Stock Up composition generalized), one execution path (ADR 0045): `peekLibraryTop(look)` reveals the top cards; a single suspending `look-distribute` `requestChoice` over exactly those ids (candidateIds = the looked-at top N, projected face-up as `libraryPeek` — never the whole hidden library, the `search-library` over-exposure) drives the unified HAND/second pick (count = EXACTLY `keep` to hand); the kept cards move library→hand via `moveCardById`; the remaining looked-at cards go to `destination` — bottomed via `reorderLibraryTop` in the player\'s CHOSEN order (read back via `readOrderedSecond`) for the `library-bottom` default, or moved one at a time via `moveCardById` (the SAME graveyard-bound-redirect-eligible move `scryReorder`\'s Surveil leg uses) for `destination: "graveyard"`. SUSPENDS like `choice`/`scryReorder` — the pick is consumed internally by default. The bottom cards are marked known to the controller via `markKnown` (ADR 0026): the player looked at and PLACED them, so their bottom position is certain and Impulse\'s "in any order" (CR 401.4) is a real choice — the projection exposes them as the contiguous known run from the bottom until a shuffle; a graveyard destination skips `markKnown` (already a public zone). A bot/auto path may submit only the hand picks (empty `secondZoneIds`), and then the rest auto-resolve to `destination` in look order. `player` names whose library; `look` is how many to look at; `take` is how many kept (default 1, clamped to the number looked at). DISTINCT from the exile-and-may-play "impulse draw" (#791): the chosen card enters HAND and the rest leave the library entirely — no exile, no play window. Impulse (MMQ) = look 4, take 1. FOUR optional refinements: `filter` restricts the HAND-eligible subset to looked-at cards matching an `EffectCardFilter` (issue #1266, Narset\'s "noncreature, nonland card", `excludeType: ["Creature","Land"]`) — precomputed as the candidateIds allow-list, exactly like the library branch of `choiceCandidates`; the filtered-out looked-at cards always go to `destination`. `optional` makes the hand pick a "you MAY" (count min 0, up to `take`). `randomBottom` (issue #1266) bottoms the rest WITHOUT a player-ordering pick and WITHOUT `markKnown` — CR 401.4\'s "random order" is unobservable for face-down library cards, so the physical permutation carries no game information and no knowledge is granted (the material half — no player choice of order, no knowledge — is what is honored); meaningless for a graveyard destination (a public zone has nothing to hide). `bind` (issue #1101, mirrors destroy/exile\'s SNAPSHOT-family object bind — NOT a `choice` Op\'s picks list) snapshots the FIRST kept card right after the library→hand move, so a later Op reads it back through the ordinary `EffectObjectSelector` bare-ref path (`manaValue: { of: { ref: "$name" } }` sizing Reviving Vapors\' `gainLife`); the bound object resolves as `TargetSelection.type: "hand-card"` (a new target-selection kind, since the card lives in hand, never becomes a permanent) via `resolveObjectRef`\'s hand-lookup fallback and `SpellContext.getManaValue`\'s matching branch. Narset −2 = look 4, take 1, filter noncreature/nonland, optional, randomBottom. Reviving Vapors = look 3, take 1, destination graveyard, bind the kept card, followed by `gainLife` sized off it. `reveal` (CR 701.20a) upgrades the default PRIVATE look to a PUBLIC reveal — `"window"` reveals the WHOLE looked-at window to every player (a reveal dialog + persistent known-to-all on the KEPT cards only, so un-kept cards heading to a hidden random bottom are never leaked): "Reveal the top N …" (Reviving Vapors, Satyr Wayfinder, Torsten); `"kept"` reveals only the cards actually put into hand, AFTER the pick: "Look at the top N (privately) … you may reveal a card and put it into your hand" (Narset). Omit for a purely private look (Impulse, Domain). The reveal fires exactly ONCE (on the resumed pass, or on the no-suspend keep-0 path) so the dialog never double-pops across the suspend/resume re-entry.',
    },
    {
        op: "revealAndCategorize",
        status: "implemented",
        cr: "701.20a",
        binding:
            "SpellContext.peekLibraryTop / requestChoice / readOrderedSecond / moveCardById / reorderLibraryTop / markKnown / markKnownToAll / notifyReveal + gre/categorizedPick",
        note: 'Categorized reveal-and-keep (CR 701.20a reveal + CR 401.4, issue #1364 — Atraxa, Grand Unifier: "reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order."). Reveals a fixed top-N window ONCE and then lets the player keep AT MOST ONE card per category out of that SINGLE shared window, each card claimable by only one category (Gatherer: a card with several card types may be chosen for only one of them). The categorized keep is precisely what `digToHand` cannot express — it carries ONE `filter` and ONE `take`, and calling it repeatedly does NOT share a window (each call re-peeks the CURRENT library top, which has already moved after the first call distributed its window). Everything ELSE is deliberately `digToHand`\'s vocabulary with identical semantics, and the executor reuses its whole tail verbatim (`bottomLookedAtCards`, the same `look-distribute` `requestChoice`, the same one-shot reveal protocol): `optional` ("you MAY"), `destination` (`library-bottom` default / `graveyard`), `randomBottom` (bottom unordered + unknown — CR 401.4\'s random order is unobservable for face-down library cards, so no knowledge is granted), `reveal` ("window" = the whole revealed window is public, Atraxa; "kept" = only the kept cards; omit for a private look), `prompt`. `categories` is an ordered `{ label, filter }` list — Atraxa spells out the eight card types from its own reminder text; Niv-Mizzet Reborn\'s ten exact-colour pairs are the other intended shape (still blocked on an EXACT-colours `EffectCardFilter.color` match). LEGALITY is a bipartite matching, not a greedy per-category scan: a keep-set is legal exactly when an INJECTIVE card → category assignment exists, since seating an artifact creature as "Creature" can otherwise strand a plain creature that had nowhere else to go. That matching lives in the LEAF module `gre/categorizedPick.ts` (plain ids in, booleans out — no GameState, no registry) and is the SINGLE authority used by all three sites: the Op\'s `count.max` (the maximum matching, NOT the category count — ten revealed lands under eight categories can only ever keep ONE, and offering eight would be a pick that cannot be made, CR 608.2b), the submit-path validation (`pendingChoiceSubmit`), and the client\'s per-card click gate (`player-library.tsx`), so the client can never offer a pick the server rejects nor hide one it would accept. SUSPENDS on a single `look-distribute` choice carrying the resolved `categories` (each label plus the revealed ids matching it); auto-resolves with NO prompt when nothing is keepable (no revealed card matched any category), the Arena zero-branch default. No new SpellContext primitive — pure composition over the ones `digToHand` already uses, per the "generalize, don\'t add" primitive-reuse rule.',
    },
    {
        op: "chooseCategorized",
        status: "implemented",
        cr: "601.2b",
        mechanicId: "chooseCategorized",
        binding:
            "SpellContext.getHandCards / getBattlefieldIds / requestChoice / discardCard / returnToHand + gre/categorizedPick",
        note: 'Per-category choice from an ALREADY-VISIBLE set (CR 601.2b / 701.9, issue #1945 — Noxious Vapors: "Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards"; Planar Overlay: "Each player chooses a land they control of each basic land type. Return those lands to their owners\' hands."). Reuses `revealAndCategorize`\'s bipartite-matching core (`gre/categorizedPick.ts`) and `categories` vocabulary verbatim, but is its OWN Op rather than a `revealAndCategorize` generalization: that Op is hard-wired to a library-window LOOK (peek + reveal + a forced kept→hand/rest→bottom polarity), while this one operates on a domain that is ALREADY visible (the chooser\'s own hand — reveal, if the Oracle text calls for one, is a SEPARATE preceding `reveal` Op — or their own battlefield, always public) and the two shipped cards need OPPOSITE actions on the picked vs. unpicked halves: Vapors keeps the picks IN PLACE (`onPicked: "keep"`) and discards a REST that is filtered SEPARATELY and more BROADLY than the categorization domain (`sweep.filter: { excludeType: "Land" }` — a colourless nonland card matches no colour category, so it can never be picked, yet is still swept; a land is never swept even if uncategorized); Overlay instead BOUNCES the picks (`onPicked: "returnToHand"`, via `SpellContext.returnToHand`, CR 701.10) and leaves the rest untouched (no `sweep`). Both Oracle texts are MANDATORY ("chooses", not "may choose"): `optional` defaults false. Legality is `categorizedPick.ts`\'s COVER rule, the module\'s SECOND rule and NOT `revealAndCategorize`\'s injective one: each category NOMINATES a member and ONE member may answer SEVERAL categories at once (Gatherer, Planar Overlay: "If you have a land which counts as multiple land types, you can choose that land as each of those types. For example, a dual land could be chosen as two of your land types"; Noxious Vapors\' multicoloured card is the same shape — it may be the card chosen for both its colours). So the offered `count` runs from the SMALLEST covering set (`minCategorizedCover`) up to the maximum matching (`maxCategorizedPicks`), never merely `categories.length` (CR 608.2b — never offer a pick that cannot be made, and never DEMAND one the rules don\'t: pinning the floor to the matching would force a Plains+Tundra player to return two lands where the ruling lets them nominate the Tundra twice and return one). An `optional: true` offer is instead a per-category "you may" and keeps the injective rule at min 0; the chosen rule rides on the PendingChoice as `categoryRule`, so the client Done gate and the server submit check can never disagree. Two auto-resolve paths, both zero-prompt (project convention — auto-resolve a mandatory choice with no real option): a wholly zero-branch pick (nothing matches any category at all) skips straight to the sweep/no-op; a FORCED-but-nonzero pick (every category has at most one candidate, so each nomination is already determined — a lone dual land answering both its types included) also auto-applies via `categorizedPick.ts`\'s `forcedCategorizedCover` — a genuine ADDITION over `revealAndCategorize`, which does not special-case this and still prompts for a forced Atraxa keep. `player` names whose hand/battlefield; `forEach { set: "players" }` wraps this Op for "each player" (CR 601.2b — symmetric, APNAP-ordered, no player chooses for another; the existing `forEach { set: "players" }` + suspending-Op composition already works, issue #807). SUSPENDS on a `choose-categorized` PendingChoice — its OWN `ZonePickKind` member, sharing `categories`/the bipartite core with `look-distribute` but validated on the `hand`/`battlefield` zone branches instead of `library`, and under the COVER rule rather than the injective one (`pendingChoiceSubmit.ts`). No new SpellContext primitive — `getHandCards`/`getBattlefieldIds` resolve the categories, `discardCard`/`returnToHand` apply the two actions, exactly the primitives `discard`/`moveZone` already use (ADR 0045 "generalize, don\'t add").',
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
            "SpellContext.preventNextNDamageToTarget / preventAllCombatDamage / preventAllCombatDamageToAndBy / preventAllDamageFromSources / preventNextNDamageDividedAsChosen",
        note: 'Establish a damage-prevention shield (CR 615, issue #845). A thin declarative skin over three SpellContext prevention primitives, one execution path per `mode` (ADR 0045): `"next-n"` → preventNextNDamageToTarget (a shield on `to` — a permanent, `$source`, a forEach `$each`, or a relative player via `{ player: … }` — absorbing up to `amount` total damage from any source until `duration`, CR 615.1/615.6: Samite Healer, Amulet of Kroog, Conservator, Warding Shard); `"all-combat"` → preventAllCombatDamage (turn-scoped global Fog, cleared at CLEANUP, no target/duration: Fog, Tangle Wire-style combat wipes); `"combat-to-and-by"` → preventAllCombatDamageToAndBy (a per-instance two-way shield preventing all combat damage dealt TO and BY `target` until `duration`, CR 615: Maze of Ith, Ebony Horse, Foxfire). Subsumes the prevention closures the migration classifier folds here (~34 blocked closures at ship time). Source-matched / half-down player shields (`addPlayerDamagePreventionShield`, Dark Sphere / Scarecrow), damage REDIRECTIONS (`addDamageRedirectionShield`, Reverse Damage / Eye for an Eye — a replacement, not a prevention), and `markAssignsNoCombatDamage` (the CR 510.1c spelling of the SAME source-scoped shield list, Farrel\'s Mantle) are distinct primitives NOT folded here. THREE further modes (issue #1955) cover the SOURCE-scoped shape every earlier mode lacked — preventing damage a matched source would deal to ANY recipient, not damage dealt TO one recipient: `"all-from-source"` → preventAllDamageFromSources with an id-scoped shield (`source` names an announced target slot / `$source` / a forEach `$each`; `combatOnly` narrows it to CR 510 combat damage — Falling Timber, Guard Dogs; omit it for the all-damage form, Rith\'s Charm\'s "prevent all damage a source of your choice would deal this turn"); `"all-from-matching"` → the same primitive with a FILTER-scoped shield and NO target named, `match: { colors?, cardType? }` re-evaluated at the moment damage would be dealt so a source that BECOMES blue afterwards is covered too (CR 615.6, Radiant Kavu: "prevent all combat damage blue creatures and black creatures would deal this turn"); `"next-n-divided"` → preventNextNDamageDividedAsChosen, the divide-as-you-choose sibling of `"next-n"` (one shield per announced target, split chosen at ANNOUNCEMENT via `targetRequirement.divideAsChosen` and read back off the stack item\'s `targetAmounts` — the same machinery `dealDamageDividedAsChosen` uses; `total` MUST mirror `divideAsChosen.total`: Pollen Remedy). All source-scoped shields are consumed at ONE place, `runDamageReplacement` (the universal CR 614 pre-application funnel every damage sink calls), and expire at CLEANUP (CR 514.2).',
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
        op: "preventRegeneration",
        status: "implemented",
        cr: "701.15",
        binding: "SpellContext.setTargetCantBeRegeneratedThisTurn",
        note: "Flag a creature so it CAN'T be regenerated for the rest of the turn (CR 701.15c, issue #1283) — the inverse of the `regenerate` shield Op. A thin declarative skin over the single SpellContext primitive `setTargetCantBeRegeneratedThisTurn`, one execution path (ADR 0045): it sets the `cantBeRegeneratedThisTurn` per-instance flag (suppressing every regeneration shield AND the auto-regenerate replacement until CLEANUP, CR 514.2). `target` is an announced target slot (`{ target: N }` — Incinerate's \"a creature dealt damage this way can't be regenerated this turn\", Orcish Healer's \"{R}{R}, {T}: Target creature can't be regenerated this turn\"), the resolving source (`$source` — Clergy of the Holy Nimbus's \"{1}: This creature can't be regenerated this turn\", routed through the SAME setTarget primitive with the source's id; the `setSourceCantBeRegeneratedThisTurn` variant is the identical flag write on `item.id`), or a forEach `$each`. DISTINCT from `destroy`'s `cantBeRegenerated` FLAG, which suppresses regeneration only for that one destroy event — this is a STANDALONE turn-scoped lock with no destroy attached (Bone Shaman rider, Lim-Dûl's Cohort, and the damage-target trigger variants that read the firing $event stay resolve()). No-op on a non-creature or a permanent that has left the battlefield (CR 608.2b).",
    },
    {
        op: "exileOnDeath",
        status: "implemented",
        cr: "614.1a",
        binding: "SpellContext.setExileOnDeath",
        note: 'Arm a one-shot, turn-scoped death replacement on a permanent: "if it would die this turn, exile it instead" (CR 614.1a, issue #1095). A thin declarative skin over the single SpellContext primitive `setExileOnDeath`, one execution path (ADR 0045) — the DSL skin for the three `resolve()` closures that already call it (Disintegrate `drk/green.ts`, `fin/red.ts`, `lea/red.ts`), plus Scorching Lava\'s kicked rider. `target` is an announced target slot (`{ target: N }`), the resolving source (`$source`), or a forEach `$each`. No duration field — the one-shot, DEATH-only, cleared-at-CLEANUP lifetime (CR 514.2) is intrinsic to the flag, exactly as it is for the sibling `preventRegeneration` lock the same Oracle sentence usually pairs it with. DISTINCT from `SpellContext.setExileOnLeave` (Dreams of the Dead), a PERSISTENT flag covering every battlefield-departure path — bounce, sacrifice, destroy — and surviving across turns; that shape has no Op yet and is not folded here. No-op on a non-permanent target, a non-CREATURE permanent, or one already gone (CR 608.2b) — an "any target" spell aimed at a player or a planeswalker does nothing, which is exactly what "that creature" in the Oracle text means.',
    },
    {
        op: "markAssignsNoCombatDamage",
        status: "implemented",
        cr: "510.1",
        binding: "SpellContext.markAssignsNoCombatDamage",
        note: "Mark a permanent so it assigns NO combat damage for the rest of the turn (CR 510.1c, issue #1283) — a SOURCE-side combat-damage prevention. A thin declarative skin over the single SpellContext primitive `markAssignsNoCombatDamage`, one execution path (ADR 0045): the marked creature still fights, can be dealt combat damage and die, but deals 0 in every combat-damage step this turn. `target` is an announced target slot (`{ target: N }` — Warning / Restrain's \"Prevent all combat damage that would be dealt by target attacking creature this turn\"), the resolving source (`$source` — Farrel's Zealot's \"this creature assigns no combat damage this turn\", routed through the SAME primitive with the source's id), or a forEach `$each`. DISTINCT from the receiver-side prevention Ops `preventNextNDamageToTarget` / `preventAllCombatDamage` (which prevent damage dealt TO a creature) — this suppresses damage dealt BY the marked source. No-op on a permanent that has left the battlefield (CR 608.2b — the Op is skipped when `resolveObjectRef` returns undefined). Multi-step / $event closures that also read the firing combat event (Orcish Squatters' gain-control rider, Heroism's per-attacker may-pay loop) stay resolve().",
    },
    {
        op: "transform",
        status: "implemented",
        cr: "701.27",
        mechanicId: "transform",
        binding: "SpellContext.transform",
        note: 'Transform a permanent (CR 701.27 keyword action / CR 712 double-faced permanents, issue #1210, ADR 0067). A thin declarative skin over the single SpellContext primitive `transform`, one execution path (ADR 0045): `target` names the permanent to flip — almost always the resolving source (`$source` — "{2}: Transform this artifact", the Incubator token shape, CR 701.53 Incubate), but an announced target slot or a forEach `$each` member is accepted for generality. CR 712.8a — the SAME toggle flips EITHER direction: front → back if the permanent is currently showing its front, back → front if it\'s already transformed, so a card never needs two Ops. The primitive (`gre/transform.ts`) mirrors the `faceDown.ts` definition-swap pattern: it registers (or reuses) a synthesized back-face `CardDefinition` from `CardDefinition.backFace` / `TokenSpec.backFace`, swaps the instance\'s `card.card.id` to it, and overwrites the mutable characteristic fields (types/subtypes/power/toughness/staticAbilities) in place — so every existing reader (layers, combat, activated-ability discovery, SBA creature-ness checks) observes the new face automatically, no new "effective card" seam needed. Unlike face-down morph (CR 707.4), transform is always PUBLIC information (CR 712.6) — no per-viewer hiding at the projection boundary. No-ops when the target is gone (CR 608.2b) or its current face declares no `backFace` — nothing to flip to/from. SCOPE: only a permanent ALREADY on the battlefield transforming in place is modelled; a full two-sided-card CASTING model (choosing which face to cast, a distinct mana cost per face, CR 711) is out of scope.',
    },
    {
        op: "exileAndReturnTransformed",
        status: "implemented",
        // CR 712.14a — "If a spell or ability puts a double-faced card onto
        // the battlefield 'transformed' or 'converted,' it enters the
        // battlefield with its back face up." That is precisely this Op's
        // return leg. (Quoted from the CR effective 2026-08-07; an older
        // printing numbered this sentence differently — do not renumber it
        // from memory.)
        cr: "712.14a",
        mechanicId: "transform",
        binding: "SpellContext.exileAndReturnTransformed",
        note: "Exile a permanent and immediately return it to the battlefield showing its BACK face, under its OWNER's control (CR 712.14a / 400.7 / 306.5b, issue #2380) — \"exile Jace, then return him to the battlefield transformed under his owner's control\", the ORI flip-walker template (Jace, Vryn's Prodigy; Kytheon, Hero of Akros; Liliana, Heretical Healer; Nissa, Vastwood Seer; Chandra, Fire of Kaladesh; Tamiyo, Inquisitive Student). A thin declarative skin over the single SpellContext primitive `exileAndReturnTransformed`, one execution path (ADR 0045): `target` names the permanent — almost always the resolving source (`$source`; every card in the template flips ITSELF), with an announced target slot or a forEach `$each` accepted for generality. SIBLING of the `transform` Op, never a mode of it: `transform` flips a permanent IN PLACE (CR 712.8a) with no zone change, so the SAME object keeps its counters, its Auras/Equipment and its summoning-sickness clock; this Op performs TWO REAL zone changes, so what returns is a NEW object (CR 400.7) — counters gone, attachments fallen off, \"enters the battlefield\" triggers firing again, stack targets no longer finding it — and a PLANESWALKER back face enters with its own CR 306.5b starting loyalty (`CardBackFace.loyalty`, folded into the back-face definition id so a client-side decode rebuilds it too). Both legs run through the ORDINARY funnels — `removePermanentTo` (the single battlefield-departure path: leave-the-battlefield triggers, Aura unapplication, CR 400.7 transient-state scrubbing) and `putReanimatedOnBattlefield` (the single non-cast battlefield-ENTRY path: CR 614 entry replacements, entry counters, starting loyalty, keyword grants, the ETB trigger scan) — with only the face stamp (`stampBackFaceForEntry`, `gre/transform.ts`) applied in between, while the card sits in exile, so nothing ever observes the front face on the battlefield after the return. The departure funnel itself reverts a permanent that was ALREADY showing its back face to its front face (`revertTransform`, CR 712.8a — a double-faced card in a zone other than the battlefield or stack has only its front face's characteristics), the transform sibling of the CR 707.2 copy revert that sits beside it; the two legs of this Op bracket that revert, which is why the stamp runs on the exiled card AFTER it and wins. NOT decomposable into `exile` + `moveZone`: the clause is atomic (nothing may be interposed) and no ordering of the existing zone Ops can make the returning object enter already showing its back face. No-ops when the target has already left the battlefield (CR 608.2b); the return leg is skipped if a replacement effect diverted the card somewhere other than exile.",
    },
    {
        op: "createToken",
        status: "implemented",
        cr: "701.7",
        mechanicId: "create",
        binding: "SpellContext.createToken",
        note: "Create token permanents (CR 111 / 701.7 keyword action \"Create\", issue #847). A thin declarative skin over the single SpellContext primitive `createToken`, one execution path (ADR 0045): `token` is the JSON-pure token spec (EffectTokenSpec — name + card types required; subtypes, supertypes, P/T, colors, keyword static abilities and token art optional), `controller` names who gets the tokens (the resolving controller — The Hive's Wasp, Master of the Hunt's Wolves, the Saproling / Thrull / Goblin token engines; an announced target-slot player; or a forEach `$each` for a per-player creation), and `count` is an optional EffectValue (default 1; a literal / ref / count for a count-scaled creation, e.g. Goblin Warrens' three Goblins). A non-positive count creates nothing (CR 707.1). SCOPE (issue #847): only the plain spec-driven `createToken` primitive is folded — the JSON-pure spec that carries no closure. `createTokenCopyOf` (create a token that's a COPY of a target creature — Dance of Many) reads a runtime source creature and drives the copy machinery, so it is NOT a pure declarative skin; it stays a `planned` backlog Op (`createTokenCopy` below). A token needing continuous `staticEffects` (Tetravite's \"can't be enchanted\", a predicate closure) is likewise not JSON-expressible — `EffectTokenSpec` omits `staticEffects`, so such a token stays resolve(). No `createdBy` provenance is stamped — provenance-linked token engines (Tetravus, Tawnos's Wand) are multi-Op choice-scoped cards that stay resolve() this wave. `bind` (issue #1202) snapshots the LAST created token — mirrors `destroy`/`exile`/`moveZone`'s own `bind` field, same snapshot-family binding — so a follow-up Op in the same script can act on the just-created permanent with no announced-target form (Cori-Steel Cutter: \"create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it\"). The COPY sibling `createTokenCopyOf` (create a token that's a copy of a runtime source — Dance of Many) ships as the separate `createTokenCopy` Op below (issue #1459). `entersTapped`/`entersAttacking` (CR 508.4, issue #1195) optionally enter the token already tapped and/or already attacking, joining the CURRENT combat directly (Otharri, Suns' Glory precedent stub #920; shipped consumer is the `createTokenCopy` sibling, Satya, Aetherflux Genius).",
    },
    {
        op: "createTokenCopy",
        status: "implemented",
        cr: "707.2",
        mechanicId: "create",
        binding: "SpellContext.createTokenCopyOf",
        note: "Create one or more tokens that are COPIES of a runtime source permanent (CR 707.2 + 111.1 — Dance of Many, issue #1459). The copy sibling of `createToken`: a thin declarative skin over the single SpellContext primitive `createTokenCopyOf`, one execution path (ADR 0045). Unlike the spec-driven `createToken` Op — a JSON-pure token spec passed verbatim — this Op reads a RUNTIME source permanent and drives the SAME copy machinery Clone uses (`applyCopy`, copying only copiable values, CR 707.2), which is exactly why it is a distinct Op and not a flag on `createToken`. `source` is an object selector accepted in BOTH shapes an Effect Script can produce: an announced target slot (`{ target: N }` — Dance of Many's \"create a token that's a copy of target nontoken creature\") and a `ref` to a permanent bound earlier in the SAME script (`{ ref: \"$token\" }` — \"copy the token you just made\", the createToken→createTokenCopy bind chain, Ocelot Pride #1461). `controller` names who gets the copies (the resolving controller by default; an announced target-slot / relative player). `count` is an optional EffectValue (default 1; literal / ref / count); a non-positive count creates nothing (CR 707.1). Each copy is stamped with the resolving source's `createdBy` provenance (the leave-linkage Dance of Many's exile/sacrifice triggers rely on). Skipped when the controller can't be resolved, the count is non-positive/unresolved, or the source has left the battlefield (CR 608.2b — the copy fizzles). `bind` snapshots the LAST created copy for a follow-up Op (same snapshot-family binding as `createToken`). `entersTapped`/`entersAttacking` (CR 508.4, issue #1195) optionally enter the copy already tapped and/or already attacking, joining the CURRENT combat directly — Satya, Aetherflux Genius's \"create a tapped and attacking token that's a copy of…\" — passed straight through to the SAME `TokenSpec`-level flags the plain `createToken` Op's `EffectTokenSpec` also carries.",
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
        note: 'Crown a player the Monarch (CR 720, issue #1199). Monarch is an ability-word / game-state designation (GameState.monarchId), NOT a CR 702 keyword — no MECHANICS_REGISTRY keyword row, only this Op row. A thin declarative skin over the single SpellContext primitive `becomeMonarch`, one execution path (ADR 0045): `controller` (default "controller") names who is crowned — the resolving controller (Forth Eorlingas!\'s "You become the monarch", Palace Jailer\'s ETB) or an announced target-slot / relative player. The primitive is idempotent (already-the-monarch is a no-op, CR 720.2/720.3\'s "unless already the monarch") and self-reassigning (crowning someone new displaces the prior holder for free — a single scalar, no separate "stop being monarch" Op). The two CR 725.2 SYSTEM triggered abilities are engine-owned (no card declares them): the "combat damage to the monarch steals it" one is an immediate hook in `applyOneCombatDamage`\'s player branch, while "at the beginning of the monarch\'s end step, that player draws a card" is pushed onto the STACK as a source-less inline-body triggered ability (`buildMonarchDrawStackItem`, triggers.ts, fired from `END_STEP` phase entry) so both players may respond before it resolves — CR-correct, and the pinned monarch draws even if the designation changes before resolution. Used by Forth Eorlingas! (LTC) and Palace Jailer (CN2).',
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
        note: 'Modal "choose one" effect (CR 700.2 / 601.2b, issue #849). A thin declarative skin over the single SpellContext primitive `requestOptionChoice`, one execution path (ADR 0045): `modes` is a non-empty ordered list of `{ label, effects }` — each mode a labelled nested `EffectOp[]` (the bullet clauses of a "Choose one —" spell). The chooser picks exactly one mode; the interpreter runs that mode\'s `effects` through the SAME `runOpList` path an `if` branch uses, so a mode body composes bind / ref / if / forEach and even a further suspending Op (a nested `choice` / `mayPay`). `player` (optional) names the chooser — the resolving `"controller"` by default; an announced target-slot / relative player otherwise. NOT for a CR 700.2 SPELL mode (issue #1274): a modal spell picks its mode as it is CAST (CR 601.2b), before it goes on the stack, so its bullet clauses belong on the cast-time `modes[]` framework (`SpellMode`), not here — this Op runs at RESOLUTION and would leave the mode hidden from a responding opponent. Use it for a resolution-time branch that is genuinely NOT a spell mode: an ability site, or a "choose a colour/type/number" sub-choice (CR 608.2). The catalogue guard `convex/cards/__tests__/modalSpells.test.ts` enforces the split. `prompt` is the choice header. Like `if` / `forEach` it is a structural construct that always re-descends on a re-walk (in the interpreter\'s runOpList skip-exception), so a suspension inside the chosen mode resumes correctly (CR 608.3). A SINGLE-mode Op auto-resolves — runs the one mode with no prompt (no real choice, Arena-style). Skipped when the chooser is gone (CR 608.2b). SCOPE (issue #849): the "choose one" form only. "Choose one or more" / "choose two" / "choose one. You may choose the same mode…" (Fork-style repetition, entwine, escalate) are distinct cardinality grammars a later Op adds on demand.',
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
        note: "Flip a coin, then run the win / loss branch (CR 705, issue #851). A thin declarative skin over the single SpellContext primitive `requestCoinFlip` (the suspending reveal flip, ADR 0023), one execution path (ADR 0045): the bit is drawn ONCE from the seeded PRNG, PAUSES resolution to animate the coin landing (WIN/LOSE reveal overlay), and on resume the persisted outcome short-circuits the re-run (no re-roll, CR 608.3). `win` / `loss` are each `{ consequence, effects }` — a labelled nested `EffectOp[]` run through the SAME `runOpList` path an `if` branch / optionChoice mode uses, so a branch composes bind / ref / if / forEach and even a further suspending Op (Goblin Kites' delayed-body sacrifice-on-loss, Orcish Captain's +2/+0-or--0/-2 buff, Bottle of Suleiman's create-token-or-take-5, Goblin Lyre's creature-count damage). `player` (optional) names the flipping player — the resolving `\"controller\"` by default (CR 705.1); an announced target-slot / relative player otherwise. Like `if` / `optionChoice` it is a structural construct that always re-descends on a re-walk (in the interpreter's runOpList skip-exception), so a suspension inside the taken branch resumes correctly. Skipped when the flipper is gone (CR 608.2b). SCOPE (issue #851): the suspending reveal flip only — and the DEFAULT for every coin-flip card, because this is the Op the client animates. Goblin Artisans briefly used the sibling `coinFlipSync` (issue #1281) and lost its animation as a result; it is back on this Op. The TRUE repeat-until-lose / doubling-stake loop cards (Mana Clash, Game of Chaos) are still NOT folded by either coinFlip Op: they need an unbounded loop + arithmetic value the frozen grammar does not carry, so they stay resolve() until demanded. Note Mijae Djinn / Ydwen Efreet use THIS same `requestCoinFlip` primitive (not a separate synchronous flip) yet remain resolve() for an unrelated reason — they are blocked on combat-manipulation Ops (removeFromCombat / unblock), not on the coin flip. A branch's `effects` MAY be empty (issue #1367) — a deliberate no-op for a flip that only does something on ONE outcome (Mana Crypt — 'if you LOSE, deal 3 damage', win branch does nothing); before this relaxation the only workaround was padding the otherwise-empty branch with a placeholder Op (Chaotic Strike's unconditional draw riding in both branches, `inv/red.ts`, left as-is — retiring that workaround is a separate, behaviour-sensitive cleanup).",
    },
    {
        op: "coinFlipSync",
        status: "implemented",
        cr: "705.2",
        binding: "SpellContext.flipCoin",
        note: "Flip a coin INLINE with no reveal-ack suspension (issue #1281) — the synchronous sibling of `coinFlip`. A thin declarative skin over the single SpellContext primitive `flipCoin` (the SAME seeded-PRNG bit `requestCoinFlip` draws internally — no new random source; this Op only skips `requestCoinFlip`'s ADR 0023 reveal-overlay suspend), one execution path (ADR 0045): the bit is drawn and the matching `win` / `loss` branch's `effects` runs in the SAME interpreter pass, through the SAME `runOpList` path a `coinFlip` branch / `if` branch uses, so a branch composes bind / ref / if / forEach and even a further suspending Op. `win` / `loss` are each `{ consequence, effects }`, identical shape to `coinFlip`'s branches (`consequence` is unused UI copy here — no reveal overlay shows it, kept only for shape parity and forward compatibility with a future summary surface). `player` (optional) names the flipping player — the resolving `\"controller\"` by default (CR 705.1); an announced target-slot / relative player otherwise. Like `coinFlip` it is a structural construct that always re-descends on a re-walk (in the interpreter's runOpList skip-exception). Skipped when the flipper is gone (CR 608.2b). SCOPE (issue #1281): for cards whose flip has no interactive reveal UX to preserve — migrating a card off this Op onto `coinFlip` (or the reverse) is a resolution-shape change, not a value-preserving refactor, so pick one deliberately per card. NO SHIPPED CARD CURRENTLY USES THIS OP, and a new coin-flip card should default to `coinFlip`: skipping the reveal skips the coin-flip ANIMATION, so the player never sees the flip happen. Goblin Artisans (`atq/red.ts`) was the first (and only) user and has been moved back to `coinFlip` for exactly that reason — QA reported its animation as lost. Reach for `coinFlipSync` only for a flip that is genuinely not a moment in the game (a bulk/automated flip inside a larger effect), never merely to keep a per-card test synchronous.",
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
        binding:
            "SpellContext.setCantAttackThisTurn / setCantBlockThisTurn / setCantBeBlockedThisTurn",
        note: 'Grant a turn-scoped combat restriction to a permanent: "can\'t attack" (CR 508.1a), "can\'t block" (CR 509.1a — both from ADR 0053 pile division: Fight or Flight\'s unchosen attacking pile, Stand or Fall\'s unchosen blocking pile), or "can\'t be blocked" (CR 509.1b — the evasion side, `setCantBeBlockedThisTurn`: Teleport, Trailblazer, Tawnos\'s Wand, Runed Arch, Creeping Tar-Pit\'s animate-then-unblockable). A thin declarative skin over the three existing SpellContext primitives, one execution path (ADR 0045) — the same restriction-grant reuse `tapUntap` already established for tap/untap. Cleared at CLEANUP (CR 514.2) like every other "this turn" combat flag.',
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
            "SpellContext.peekLibraryTop / markKnownToAll / notifyReveal / getLibraryCards / moveCardById",
        note: 'CR 701.20a reveal / CR 401.4 look (issue #1085 — Desperate Research: "Reveal the top seven cards of your library and put all of them with that name into your hand. Exile the rest."). Deterministic sibling of `digToHand`: reveals the top `look` cards of `player`\'s library to EVERY player (unlike `digToHand`\'s PRIVATE per-chooser look) — a two-part public reveal (ADR 0026): `markKnownToAll` is the PERSISTENT grant (the card keeps a face-up "eye" for its controller and stays visible in the opponent\'s view even after it rides into hand) and `notifyReveal` (kind "reveal", audience = all) pops the TRANSIENT reveal dialog on both clients. It then puts EVERY looked-at card matching `filter` into hand with NO player choice (the filter alone decides — CR 608.2b, zero matches is a no-op for the hand leg), and sends every non-matching looked-at card to `destination` ("exile" — Desperate Research; "graveyard" — a Surveil-shaped future card). A thin declarative composition over existing SpellContext primitives, one execution path (ADR 0045); `filter` is REQUIRED but MAY be the match-all `{}` — a PUBLIC reveal-and-keep-all (Dark Confidant: "reveal the top card and put it into your hand") that `digToHand`\'s PRIVATE keep-all (`take` = `look`) cannot express, so this is NOT redundant with it. `bind` (optional) snapshots the FIRST card put into hand, mirrors `digToHand`\'s own `bind`. No new SpellContext primitive — pure composition, per the "generalize, don\'t add" primitive-reuse rule.',
    },
    {
        op: "lookRandomHand",
        status: "implemented",
        cr: "701.18a",
        binding: "SpellContext.lookRandomHandCard / notifyReveal",
        note: "CR 701.18a look (Urza's Bauble) — \"Look at a card at random in target player's hand\". The PRIVATE-look counterpart the `reveal` Op's note called out as NOT folded (a single-knower look, vs `reveal`'s all-players CR 701.20 grant). Folds two SpellContext primitives, one execution path (ADR 0045): `lookRandomHandCard` (a private sibling of the public `revealRandomHandCard` — same seeded-PRNG pick, but `grantKnowledge` to the looker ALONE so only they see the real card on the wire) and `notifyReveal` (the transient look dialog, audience = the looker). `player` is the hand owner (an announced target slot on Urza's Bauble); `looker` (optional) defaults to the resolving controller (CR 113.7). No-op on an empty hand (CR 608.2b). Distinct from Word of Command's private full-hand look, which stays resolve() for its control-transfer protocol (ADR 0037). A library-top positional reveal (Caustic Bronco-class) is still a separate future Op.",
    },
    {
        op: "setIslandSanctuaryProtection",
        status: "implemented",
        cr: "508.1",
        binding: "SpellContext.setIslandSanctuaryProtection",
        note: 'Island Sanctuary\'s player-scoped "until your next turn, you can\'t be attacked except by creatures with flying and/or islandwalk" protection (CR 508.1c, issue #1283). A thin declarative skin over the single SpellContext primitive `setIslandSanctuaryProtection`, one execution path (ADR 0045): sets `state.islandSanctuaryProtection` to `player`\'s id, read by the attack-declaration legality check (`gre/combat.ts`) and cleared at the START of that player\'s next turn (`gre/phases.ts`) — mirroring `grantCastTiming`\'s "until your next turn" boundary, NOT CLEANUP. Distinct from `restrictCombat`, which is PERMANENT-scoped (a target creature can\'t attack/block/be-blocked) with no "except by" qualifier — this is a PLAYER-scoped protection with the flying/islandwalk carve-out baked into the primitive itself. No other printed card shares this exact shape, so the Op stays a single-purpose skin rather than a generalized "can\'t be attacked except by …" grammar. Skipped when the player cannot be resolved (CR 608.2b).',
    },
    {
        op: "setProtectionFromEverything",
        status: "implemented",
        cr: "702.16i",
        binding: "SpellContext.setPlayerProtectionFromEverything",
        note: 'The One Ring\'s player-scoped "you gain protection from everything until your next turn" (CR 702.16b/e/i applied to a player via CR 115.4, issue #674). A thin declarative skin over the single SpellContext primitive `setPlayerProtectionFromEverything`, one execution path (ADR 0045): appends `player`\'s id to `state.playerProtectionFromEverything` (a LIST, not a slot — both players can hold the protection at once when each casts their own copy on successive turns), and the grantee\'s entry is dropped at the START of their OWN next turn (`gre/phases.ts` advanceTurn) — mirroring `setIslandSanctuaryProtection` / `grantCastTiming`\'s "until your next turn" boundary, NOT CLEANUP, because the protection must survive the whole intervening opponent turn. Exactly two of protection\'s clauses have a player analogue and this Op wires both through ONE predicate, `playerHasProtectionFromEverything` (`gre/protection.ts`): CR 702.16b targeting — read by BOTH `getLegalTargets` (the offered set) and the `selectTarget` mutation (the accepted set), so offered and accepted can\'t diverge; and CR 702.16e damage — read at the top of `applyPlayerDamagePrevention`, the single chokepoint every player-damage sink (spell/ability, redirect, combat) already routes through, checked BEFORE the shield walk so no finite shield is spent on damage that never lands. Damage flagged unpreventable bypasses it exactly as it bypasses every other prevention (those sinks skip the function). The remaining clauses (can\'t be blocked / enchanted / equipped, CR 702.16c/d/f) are permanent-only; being ATTACKED stays legal (protection prevents the damage, it does not bar the attack). UNCONDITIONAL, unlike every other protection surface: the card-scoped keyword (`staticAbilities: ["protection from <colour>"]`) is colour-parametrized and lives on a permanent, `preventDamage` establishes a FINITE / source-matched shield — protection from EVERYTHING is protection from each and every object regardless of characteristics with no controller exception (the protected player\'s OWN spells and sources are barred too), so there is nothing to parametrize and the Op stays a single-purpose skin rather than a generalized "player gains protection from Q" grammar (ADR 0045 "generalize, don\'t add" — The One Ring is the only printed card with this shape). Duration is intrinsic, so no `duration` field. Skipped when the player cannot be resolved (CR 608.2b).',
    },
    {
        op: "rangedTopdeck",
        status: "implemented",
        cr: "118.4",
        binding:
            "SpellContext.getDrawnThisTurnIds / getHandIds / getLife / requestChoice / moveHandCardToLibraryTop / loseLife",
        note: 'Sylvan Library\'s single ranged 0..N "cards drawn this turn" hand pick, with a per-NOT-chosen life cost (CR 118.4 pay-or-put-back, CR 121.1 draw-adjacent, CR 119.4 can\'t-pay-life-you-don\'t-have clamp, issue #1283). A thin declarative COMPOSITION over existing SpellContext primitives — no new primitive (ADR 0045 "generalize, don\'t add"): `pool` names the candidate set (only `"drawn-this-turn"` today — `getDrawnThisTurnIds` filtered to still being in hand); `max` is the "choose N" cap (Sylvan Library\'s printed "choose two", CR 608.2b-clamped to the pool size); `costPerKept` is the life paid PER pool member NOT put on top — the card\'s printed "pay 4 life or put the card on top of your library" per-card choice is collapsed into ONE ranged pick because the two options are reachable-outcome-identical (keep both = pay 8, topdeck both = pay 0, mix = pay 4). The Op computes the CR 119.4 floor(life / costPerKept) clamp itself before raising a `choose-hand-card` `requestChoice` (a fixed `"ranged-topdeck"` choiceId, mirroring `putBack`\'s `"put-back"`), moves each picked card to the library top via `moveHandCardToLibraryTop` (mirrors `putBack`), and charges `loseLife` for the pool members NOT picked. SUSPENDS like `choice` / `putBack`: the pick is consumed internally (no `bind`), and — because `runOpList` checkpoints THIS Op\'s own pre-order position — an earlier Op in the same script (the "draw two" `draw` Op that precedes it) is skipped on resume (CR 608.3), the exact isolation the card\'s OLD `resolveSteps` split used to need by hand.',
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
 *  member (Toxic Deluge's chosen-cost X, CR 118.4 pay-X-life).
 *  `EffectCardFilter.enteredThisTurn` (issue #1458, CR 302.6) is likewise NOT
 *  an Op and NOT a new grammar member — it is a REFINEMENT of the existing
 *  card-filter shape (a plain boolean clause, mirroring `isToken`'s own shape
 *  and battlefield-only scope exactly), read straight off the engine's
 *  `isSummoningSick` control-continuity flag (`markEnteredThisTurn`) with NO
 *  new bookkeeping. It earns no EFFECT_OP_REGISTRY row. Reaches every site a
 *  card filter is read for a battlefield set — the `count` construct and
 *  `forEach { set: "permanents" }` (both route through `toPermanentFilter` →
 *  `ctx.getBattlefieldIds`) — and composes with every other clause,
 *  including `isToken`. Deliberately shipped with no card consumer of its
 *  own; its first consumer is Ocelot Pride (issue #1461).
 *  `EffectCardFilter.controlledSinceTurnStart` (issue #1944, Keldon Twilight)
 *  is its sibling and likewise NOT an Op and NOT a new grammar member — a
 *  plain boolean card-filter clause, battlefield-only, mirroring
 *  `enteredThisTurn`'s shape and scope exactly and earning no
 *  EFFECT_OP_REGISTRY row. It differs from `enteredThisTurn` in what it reads:
 *  the entry stamp AND the new turn-scoped `GameState.controlChangedThisTurn`
 *  ledger (`gre/controlContinuity.ts`), so a creature whose CONTROLLER changed
 *  mid-turn without changing zones is excluded — the one thing zone-based
 *  clauses cannot see. The Effect Script validator admits it only at
 *  battlefield-guaranteed selector sites (`allowControlledSinceTurnStart`,
 *  the `hasAbility`/`isAttacking` opt-IN gate), since a card in a hidden zone
 *  has no controller at all (CR 108.4).
 *  `EffectCountSpec.zone: "hand"` (issue #2006, CR 402) is likewise NOT an Op
 *  and NOT a new grammar member — it is a REFINEMENT of the existing `count`
 *  value, the exact twin of the already-shipped `library` zone member (#783):
 *  a hidden zone (CR 402.2) whose SIZE is public information, therefore a pure
 *  CARDINALITY read with `filter`/`countTypes` rejected by the validator. It
 *  earns no EFFECT_OP_REGISTRY row.
 *  `difference` (issue #2006, `{ difference: { from, minus } }`) IS a new
 *  value-grammar member — the THIRTEENTH — and the only one that performs
 *  arithmetic between two operands. It earns no EFFECT_OP_REGISTRY row (not an
 *  Op) and it does NOT reopen ADR 0045: the frozen set is the four STRUCTURAL
 *  constructs (bind/ref/if/forEach), and this is a value member exactly like
 *  `X` (#852), `counters` (#1015), `domain` (#1066) and `lifeGainedThisTurn`
 *  (#1457) before it. What keeps it from being the thin end of an expression
 *  grammar is its OPERAND type: `EffectDifferenceOperand` is a literal or a
 *  `count` — a TERMINAL, never an `EffectValue` — so nesting is
 *  unrepresentable in the type system and the value grammar stays depth-1.
 *  One operator, two operands, no recursion. It unblocks the "X is A minus B"
 *  class the `count`'s `times` multiplier cannot reach (that scales ONE count
 *  by a constant; here there are two independent counts): Dark Suspicions
 *  (PLS, hand-count minus hand-count) is the shipped consumer, with The Rack
 *  (ATQ) and Storm World (LEG) — both "N minus the number of cards in their
 *  hand" — the literal-minus-count variants the operand union also covers.
 *  A `plus` / `max` / nested difference is deliberately absent and is a NEW
 *  design decision with its own issue, not an implied widening of this row.
 *  `scaled` (issue #2366, `{ scaled: { value, times } }`) IS a new
 *  value-grammar member — the FOURTEENTH — and the value grammar's ONE
 *  multiplication operator, `difference`'s sibling (subtraction). Same
 *  non-Op, non-ADR-0045-reopening status: a value member, not a structural
 *  construct. Its operand type, `EffectScaledOperand`, is
 *  `EffectDifferenceOperand` PLUS the chosen-cost `X` — a SEPARATE type, not a
 *  widening of `EffectDifferenceOperand` in place, because `difference` was
 *  deliberately shipped X-free (its own test rejects an `X` operand) and
 *  `scaled` exists specifically to give X a multiplier
 *  (`EffectXValue`'s own doc comment: "nothing composes it" — until now).
 *  Reason to exist: Pest Infestation (C21, #2369) is "create twice X 1/1 Pest
 *  tokens" — `EffectDomainValue.times` is the nearest shipped multiplier
 *  precedent, but it is baked into ONE member (Domain); generalizing that
 *  `{ of/value, times }` shape to any terminal, rather than a card-shaped
 *  `{ twiceX: true }`, is "generalize, don't add". One operator, one
 *  non-literal operand, that operand a TERMINAL — the value grammar stays
 *  depth-1 exactly as `difference` keeps it. */
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
    // "implemented". Only the JSON-pure spec form was folded.
    // createTokenCopy SHIPPED (issue #1459) — the copy form
    // (`createTokenCopyOf`, a runtime source read driving the Clone copy path)
    // is now COVERED live via EFFECT_OP_REGISTRY with status "implemented";
    // row moved there. Dance of Many migrated to `effects[]` as the consumer.
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
    // NOT folded by coinFlip itself: the TRUE repeat-until-lose / doubling
    // loop cards (Mana Clash, Game of Chaos) stay resolve() — they need an
    // unbounded loop + arithmetic value the frozen grammar does not carry.
    // Goblin Artisans (single win/loss, no loop) briefly shipped a synchronous
    // flip via the sibling `coinFlipSync` Op (issue #1281) and lost its
    // coin-flip animation as a result; it is back on `coinFlip`, which is the
    // default for any card that flips. Mijae Djinn / Ydwen Efreet DO use this same `requestCoinFlip`
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
        note: 'CONTINUOUS source-linked untap-step restriction ("doesn\'t untap as long as … remains tapped", CR 502.3). Folds SpellContext.lockUntapWhileSourceTapped (~3 blocked closures). Long-tail. The ONE-SHOT "doesn\'t untap during its controller\'s next untap step" half (`skipNextUntap`) has SHIPPED as its own `skipNextUntap` Op (status "implemented", PRD #795) — this row no longer folds it.',
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
        // CR 603.6a / 701.3 / issue #1965 — "whenever a 1/1 creature you
        // control enters, ... attach it to THAT CREATURE" (Sword of the
        // Meek). A `zone: "graveyard"` triggered ability's effect can't name
        // the entering permanent any other way — it isn't an announced
        // target (CR 603.3d targeting is for the ability's OWN card, not the
        // event's subject) and there is no `$each`/`forEach` set here.
        // Mirrors `BECAME_TARGET.targetPermanent`'s object-family flattening:
        // `resolveObjectRef`'s generic `$event.<field>` branch (ADR 0049)
        // already resolves any object-family row through the
        // battlefield-presence recheck, so a permanent that left in
        // response (CR 608.2b) is a silent no-op with no interpreter change.
        instanceId: {
            family: "object",
            resolve: (e) =>
                e.type === "PERMANENT_ENTERED" ? e.instanceId : undefined,
        },
    },
    // CR 603.10 / 400.7 / issue #1940 — "whenever a permanent is returned to
    // a player's hand, THAT PLAYER discards a card" (Warped Devotion).
    // `PERMANENT_LEFT` already IS the battlefield-departure event (`toZone:
    // "hand"` narrows a `leftTrigger` to bounces) and already carries
    // `ownerId` (CR 109.5, last-known information) — this row is the ONLY
    // thing that was missing: a censused `$event.ownerId` read so a
    // `leftTrigger({ scope: "any", toZone: "hand" })` DSL `effects[]` body
    // can target the RETURNING permanent's owner (CR 108.3 — always the
    // owner's hand), which is the "that player" the ability acts on — NOT
    // necessarily the ability's own controller, since the trigger fires
    // symmetrically on either player's bounce. Mirrors
    // `PERMANENT_ENTERED.controllerId` above. (Owner-arbitrated rework of
    // issue #1940: an earlier draft shipped a dedicated
    // `PERMANENT_RETURNED_TO_HAND` event; review established `PERMANENT_LEFT`
    // already covers the "returned to hand" case per ADR 0001's one-event-
    // per-zone-of-origin rule, so the new event was retired in favor of this
    // single field row.)
    PERMANENT_LEFT: {
        ownerId: {
            family: "player",
            resolve: (e) =>
                e.type === "PERMANENT_LEFT" ? e.ownerId : undefined,
        },
    },
    // CR 121.1 / 117.3a / issue #1946 — "whenever a player draws a card, THAT
    // PLAYER loses 2 life unless they pay {2}" (Phyrexian Tyranny). The
    // drawing player is CR 117.3a's "triggering player" for the mayPay
    // decision — usually NOT the enchantment's controller. Mirrors
    // `PHASE_BEGIN.activePlayerId` (issue #1066): unblocks a `drawTrigger({
    // scope: "each", effects: [...] })` DSL body to read the drawing player
    // straight off the firing `CardDrawnEvent` via `{ ref: "$event.playerId"
    // }` instead of the plain `"controller"` selector, which under `scope:
    // "each"` resolves to the SOURCE's controller, not the player who drew.
    CARD_DRAWN: {
        playerId: {
            family: "player",
            resolve: (e) => (e.type === "CARD_DRAWN" ? e.playerId : undefined),
        },
    },
    // CR 603.2b / issue #1953 — "whenever another permanent you control becomes
    // the target of a spell or ability an opponent controls, you may return
    // THAT PERMANENT to its owner's hand" (Cloud Cover). Every card that read
    // `BECAME_TARGET` before this row acted on `self` (Ward, Nadu) or on an
    // announced target slot (Leovold draws, Sleeping Potion sacrifices
    // `$source`) — none needed to name the object that just became a target,
    // which is why the event had no censused field at all. `targetPermanent`
    // is the OBJECT-family flattening of the nested `TargetSelection`, exactly
    // mirroring `DAMAGE_DEALT.damagedPermanent`: undefined when a PLAYER became
    // the target (Cloud Cover's `matches` already excludes that case, but the
    // row must be total), so the reading Op skips per CR 608.2b. No interpreter
    // change — `resolveObjectRef`'s generic `$event.<field>` branch (ADR 0049)
    // already resolves any object-family row through the battlefield-presence
    // recheck, which is also what makes a permanent killed in response a silent
    // no-op rather than an error.
    // CR 702.33d / 603.2 / issue #1097 — "whenever a player kicks a spell"
    // (Saproling Infestation). The KICKING player is the kicked spell's
    // controller and is usually NOT the triggered ability's controller: the
    // ability is symmetric ("a player"), so the plain `"controller"` selector
    // resolves to the enchantment's controller, which is right for Saproling
    // Infestation's own "YOU create" but wrong for any later card that must
    // name the kicker ("that player draws a card"). Censused here so such a
    // card is DSL-expressible with no engine change, exactly as
    // `CARD_DRAWN.playerId` (issue #1946) and `PHASE_BEGIN.activePlayerId`
    // (issue #1066) did for their events.
    SPELL_KICKED: {
        casterId: {
            family: "player",
            resolve: (e) =>
                e.type === "SPELL_KICKED" ? e.casterId : undefined,
        },
    },
    BECAME_TARGET: {
        targetPermanent: {
            family: "object",
            resolve: (e) =>
                e.type === "BECAME_TARGET" && e.target.type === "permanent"
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
