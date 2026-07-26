# Card synergy as computed Capability matching, not enumerated card pairs

## Status

accepted

## Context

The Bot Drafter's Pick Heuristic (`convex/limited/botDrafter.ts`, ADR 0054) scores
a candidate on card quality × rarity, colour commitment and curve fit. It has no
notion of one card being good **because of another card already in the Pool**.
In a set environment that is tolerable; in the Vintage Cube (ADR 0062) it is the
whole game — a cube Pool is built out of enabler/payoff pairs and combos, and a
bot that cannot see them drafts 45 individually-strong cards that do not form a
deck.

The obvious model is an enumerated list of synergistic card pairs. It is also
wrong at this repo's target scale, and the reason is not merely authoring
volume — it is that the same information, expressed with **named endpoints**,
is strictly smaller and strictly more reusable.

The requirement that forces the shape is negative, not positive. Worldspine
Wurm is an excellent Flash and Sneak Attack payoff, and a **non**-payoff for
Animate Dead: it shuffles itself out of the graveyard, so it can never be
reanimated. Emrakul is the mirror case — a fine reanimation and Sneak Attack
target, a poor Flash target, because a sacrificed Emrakul leaves nothing behind.
All four cards sit inside any coarse "cheat a fatty into play" archetype. A
model that only knows archetypes gets all four of these pairings wrong.

## Decision

Model card-to-card fit as **computed Capability matching** over a closed,
code-side vocabulary — never as an enumerated pair list. Three layers, coarse
to fine:

1. **Archetype** — a named strategy (`reanimator`, `artifacts`, `jeskai-tempo`)
   a card belongs to. Steers colours and plan; deliberately too coarse to
   express the Wurm/Animate Dead distinction.
2. **Capability** — a named property a card **provides** or **requires**
   (`value-on-death`, `reanimatable`, `value-on-attack`). Fit is computed by
   matching one card's `requires` against another's `provides`. **Absence of a
   match is itself the veto**: Animate Dead requires `reanimatable`, Worldspine
   Wurm does not provide it, so the pair scores nothing — no negative edge has
   to be authored, and no one has to remember to author it.
3. **Combo Edge** — an explicit, signed, directed pair, capped in number and
   reserved for the closed two-card loop no vocabulary can express (Painter's
   Servant + Grindstone). The escape hatch, not the model. Anything expressible
   as a Capability must be a Capability.

**The Capability vocabulary is a closed registry in code**
(`convex/limited/capabilityRegistry.ts`), each row carrying the precise meaning
of the name, with a catalogue-wide guard test rejecting any unregistered
Capability — the same authority-plus-CI-guard pattern
`convex/cards/mechanicsRegistry.ts` (ADR 0046) already establishes for keyword
and Op names. Without it the vocabulary silently forks into `value-on-death`,
`dies-value` and `death-trigger`, which no longer match each other; the model
then degrades to nothing while every test stays green.

**Card Profiles are stored exactly like Pick Ratings** (ADR 0066): a
`cardProfiles` table keyed `(scope, cardId)` — the same Pack Source scope
string space, including `CUBE_SOURCE_KEY` — indexed `by_scope` and
`by_scope_card`, layered over an optional checked-in seed file, resolved by one
pure seam alongside `resolveEventPickRating`. Admin-editable through the
existing Pick Rating editor surface.

**Profiles are LLM-seeded and human-reviewed, and the review state is load-bearing.**
Each row carries `reviewed: boolean`. An unreviewed row's Capability and
Archetype contribution is applied at **half** the contextual cap. Two rejected
extremes explain the middle: at zero weight the bot is unchanged for as long as
the review backlog lasts, and the LLM's mistakes never manifest, so nobody
finds them; at full weight the bot drafts confidently on data that is wrong in
exactly the subtle cases the feature exists for. An LLM will assert with high
confidence that Worldspine Wurm is a graveyard fatty. Half weight makes that
error visible in the Draft Lab (ADR 0074) without letting it decide picks.

## Considered Options

- **Enumerated pairwise synergy edges (`enablerId → payoffId, weight`)** —
  rejected. It is isomorphic to Capability matching with anonymous endpoints,
  and costs ~17× more rows for the same information: ~40 enablers × ~30 payoffs
  ≈ 1200 rows for the cube versus ~70, one new row per enabler (~40) for every
  card added versus one, and a full re-census for every new Draftable Set
  versus reuse of the vocabulary. Its failure mode is also worse: an omitted
  edge is a silent no-op, and a pairwise model omits 40 edges where a
  Capability model omits one.
- **Archetype tags alone** — rejected: cannot express the Animate Dead /
  Worldspine Wurm veto, which is the case that motivated the design. Every
  card in that example shares an archetype.
- **Derive synergy automatically from `CardDefinition` / Effect Script Ops** —
  rejected as the primary model: the engine can derive types, keywords and
  produced mana (and Decision 0073 uses it for exactly that), but it has no
  representation of "reanimator" or "is worth cheating into play". Kept as the
  authority for everything that IS mechanically derivable, so that half never
  needs authoring.
- **A global, scope-free profile per card** — rejected for the same reason ADR
  0066 rejected a global Pick Rating: a card's archetype role differs per
  environment.

## Consequences

- Authoring a card costs one declaration regardless of how many enablers exist,
  and every existing enabler gains fit with it for free — the "new entry pays
  once, reuse rides free" trade this repo already applies to Effect Script Ops
  (ADR 0045) and activation-affordability shapes.
- The vocabulary must stay small (~15–25 names) to stay meaningful. Growth is
  the signal to check whether a proposed Capability is really a Combo Edge, or
  really an Archetype.
- A scope with no `cardProfiles` rows and no seed file contributes exactly zero
  from these terms — set and block environments (whose power level is flatter
  and whose bots are tuned through Pick Ratings) keep working with no profiles
  authored at all.
- The negative case is expressed by omission, which means a **missing** profile
  and a **deliberately empty** one are indistinguishable to the scorer. This is
  accepted: `reviewed` carries that distinction for humans, and the Draft Lab
  surfaces it.
