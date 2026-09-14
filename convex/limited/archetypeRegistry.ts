// Archetype Registry — the closed, code-side vocabulary of COARSE named
// strategies a Card Profile may steer toward (ADR 0072 "Card synergy as
// computed Capability matching, not enumerated card pairs", PRD #1607,
// issue #3597).
//
// An Archetype is the other half of ADR 0072's model from a Capability: a
// Capability is RELATIONAL and fine-grained (one card's `requires` matched
// against another's `provides`), an Archetype is a coarse plan the Pool
// accumulates commitment to — `botDrafter.ts`'s `archetypeFitTerm` groups
// picks by EXACT STRING EQUALITY on these names and rewards a candidate for
// sharing the archetype the Pool is already deepest in.
//
// That exact-string grouping is why this file exists. Until issue #3597 the
// vocabulary was free text, on the reasoning that a coarse ergonomic label
// does not need the guard a matching vocabulary does. It does — for exactly
// the reason `capabilityRegistry.ts`'s own header gives: a free-text
// vocabulary "silently forks into `value-on-death`, `dies-value` and
// `death-trigger`, which no longer match each other; the model then degrades
// to nothing while every test stays green". `normalizeArchetypes` case-folds,
// which stops `Reanimator`/`reanimator` forking, and stops nothing else:
// `reanimator`, `reanimate` and `graveyard-reanimator` are three plans to the
// scorer and one plan to a human, and a 285-row human review pass is exactly
// the occasion that would mint all three.
//
// This is the SINGLE authority on Archetype names — the same authority-plus-
// CI-guard shape `capabilityRegistry.ts` and `convex/cards/mechanicsRegistry.ts`
// (ADR 0046) establish. The guard test
// (`__tests__/archetypeRegistry.bot.test.ts`) rejects any `archetypes` string
// in a checked-in `cardProfiles` seed file that isn't a row here, and
// `cardProfileWriteErrors` holds the DATABASE layer to the same bound, so an
// Admin cannot type an Archetype into existence through the editor any more
// than a seed file can. The editor renders its picker from this array
// (`src/components/lobby/card-profile-archetype-picker.tsx`), so a row added
// or removed in code shows up there with no UI change.
//
// The vocabulary stays SMALL and COARSE (ADR 0072 Consequences: a proposed
// name that is really a two-card loop is a Combo Edge, and one that is really
// a relational property is a Capability — neither belongs here). The initial
// eight rows are exactly the strings the LLM-seeded Vintage Cube census
// (`data/card-profiles/vintage-cube.json`, issue #1614) already uses, so
// closing the vocabulary invalidates no existing row.

/** One row of the closed Archetype vocabulary. `id` is the exact string a
 *  `cardProfiles` row's `archetypes` array carries — kebab-case and
 *  LOWERCASE, matching `normalizeArchetypes`' output, so a normalized write
 *  can be looked up here directly.
 *
 *  `description` is what makes a 285-card review pass repeatable, and it is
 *  structured for the one failure that pass invites: two neighbouring
 *  archetypes (`graveyard` vs `reanimator`, `combo` vs `storm`) drifting into
 *  each other card by card. So every row states BOTH sides of its own
 *  boundary — a `TAG WHEN:` clause and a `NOT:` clause naming the sibling row
 *  the card belongs to instead. Enforced structurally by the guard test. */
export interface ArchetypeRow {
    id: string;
    description: string;
}

/** The closed Archetype vocabulary (ADR 0072, issue #3597). Alphabetical by
 *  `id`: the editor's picker renders this array verbatim, and a reviewer
 *  scanning eight checkboxes hundreds of times wants a stable, guessable
 *  order rather than a thematic grouping only the author remembers. */
export const ARCHETYPE_REGISTRY: ArchetypeRow[] = [
    {
        id: "aggro",
        description:
            "TAG WHEN: the card's value is pressure applied EARLY — a cheap creature whose rate beats its cost, a one-mana burn spell, a haste threat, an aggressive equipment — so a deck accumulating it wants to end the game before the opponent's expensive cards matter. NOT: a big creature that happens to attack well (that is `ramp` or `reanimator` depending on how it gets into play), and NOT efficient interaction that merely buys time — removal held up for the opponent's threats is `control`.",
    },
    {
        id: "artifacts",
        description:
            "TAG WHEN: the card IS an artifact whose draft value is partly the artifact-count column it fills, or it is a payoff whose cost/effect scales with artifacts (Metalcraft, affinity, an artifact tutor, artifact recursion). NOT: an artifact whose text has nothing to do with artifacts and whose rate stands alone — a colourless removal wand belongs to whatever plan its EFFECT serves; the type line alone is not the archetype.",
    },
    {
        id: "combo",
        description:
            "TAG WHEN: the card's ceiling is being one named half of an intentional two-card loop, or the tutor/protection that assembles and defends one (Painter's Servant, Grindstone, a tutor whose best target is a combo piece). NOT: a card that merely wins a long game on its own (`control`), and NOT a critical-mass engine where no single partner is named — that is `storm`. A SPECIFIC, signed two-card pairing is a Combo Edge on the profile, not an archetype tag; this tag says the card LIVES in that kind of deck.",
    },
    {
        id: "control",
        description:
            "TAG WHEN: the card trades for more than it costs over a long game — counterspells, one-for-more removal, sweepers, card draw, a win condition that needs the game to go long. NOT: cheap interaction whose job is to clear a blocker for an early attack (`aggro`), and NOT a card whose card advantage comes from the graveyard rather than the library (`graveyard`).",
    },
    {
        id: "graveyard",
        description:
            "TAG WHEN: the graveyard is a RESOURCE the card fills or spends — self-mill, flashback/escape/delve, a discard outlet, a card that scales with graveyard size, graveyard hate. NOT: a card whose only graveyard interaction is returning a single fat creature to the battlefield (`reanimator`, the narrower plan), and NOT a death trigger on a creature that simply dies in combat — that is a Capability (`value-on-death`), not a plan.",
    },
    {
        id: "ramp",
        description:
            "TAG WHEN: the card either produces mana ahead of the curve (mana rock, mana dork, land fetch, a cost reducer) or is a payoff expensive enough that a deck only casts it because it ramped. NOT: a cheap artifact whose value is the artifact COUNT rather than the mana (`artifacts`), and NOT a card that skips paying the cost entirely by putting a creature into play from hand or graveyard — cheating is `reanimator`/`combo`, not acceleration.",
    },
    {
        id: "reanimator",
        description:
            "TAG WHEN: the card is one end of the put-a-fatty-into-play-early plan — a graveyard-to-battlefield effect, a discard/self-mill enabler chosen FOR that plan, or a creature whose whole draft case is being cheated in. NOT: generic graveyard value, recursion of small cards, or flashback (`graveyard`, the wider plan). The card-to-card half of this — whether a specific fatty is actually retrievable — is the `reanimatable` Capability, not this tag.",
    },
    {
        id: "storm",
        description:
            "TAG WHEN: the card contributes to, or pays off, a CRITICAL MASS of spells cast in one turn — rituals, free/near-free spells, cost reducers aimed at a single turn, and the payoffs that count them. NOT: a named two-card loop (`combo`), and NOT mana acceleration meant to cast one expensive spell a turn early (`ramp`) — the axis here is spell COUNT within a turn, not mana available across turns.",
    },
];

/** Fast id -> row lookup, built once at module load — mirrors
 *  `capabilityRegistry.ts`'s registry-array-plus-lookup-set shape. */
const ARCHETYPE_IDS: ReadonlySet<string> = new Set(
    ARCHETYPE_REGISTRY.map((row) => row.id)
);

/** True iff `name` is a row in the closed Archetype vocabulary — the single
 *  authority both the seed-file guard (`validateCardProfileFile`) and the
 *  Admin write boundary (`cardProfileWriteErrors`) consult.
 *
 *  Takes the name EXACTLY as stored, i.e. already through
 *  `normalizeArchetypes` (trimmed + lowercased). Both callers normalize
 *  first, so this function does not normalize AGAIN: doing so here would let
 *  a seed file check in ` Control ` and pass the guard while
 *  `archetypeFitTerm`'s exact-string grouping saw a name no other row
 *  matches — the precise fork this registry exists to prevent. */
export function isRegisteredArchetype(name: string): boolean {
    return ARCHETYPE_IDS.has(name);
}
