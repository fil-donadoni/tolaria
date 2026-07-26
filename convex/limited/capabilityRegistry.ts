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
// PROVIDE it (CR: "When Worldspine Wurm dies, shuffle it into its owner's
// library" — it is never sitting in the graveyard to reanimate), so the
// pair scores nothing even though both cards sit in a "cheat a fatty into
// play" archetype.
//
// This is the SINGLE authority on Capability names, the same authority-plus-
// CI-guard shape `convex/cards/mechanicsRegistry.ts` (ADR 0046) already
// establishes for keyword/Op names: a catalogue-wide guard test
// (`__tests__/capabilityRegistry.bot.test.ts`) rejects any `provides`/
// `requires` string in a checked-in `cardProfiles` seed file
// (`convex/limited/cardProfiles.ts`) that isn't a row here. Without this
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
// registry and its guard ONLY — no `cardProfiles` row references any of
// these names yet (zero behaviour change, issue #1608's acceptance).

/** One row of the closed Capability vocabulary. `id` is the exact string a
 *  `cardProfiles` row's `provides`/`requires` array carries (kebab-case,
 *  matching this repo's other closed-vocabulary ids —
 *  `MechanicRow.id`/`EffectOpRow.op` discipline). `description` is the
 *  PRECISE meaning of providing vs. requiring it — this is what makes a
 *  later census repeatable (ADR 0072), so every row spells out both
 *  directions rather than a one-line gloss. */
export interface CapabilityRow {
    id: string;
    description: string;
}

/** The closed Capability vocabulary (ADR 0072). Grouped by the enabler
 *  family each row serves — the grouping is documentation only, not part of
 *  the data shape; `CAPABILITY_REGISTRY` stays a flat array so a lookup
 *  never needs to know which group a name lives in. */
export const CAPABILITY_REGISTRY: CapabilityRow[] = [
    // ── Reanimator / graveyard cluster ──────────────────────────────────
    {
        id: "reanimatable",
        description:
            "PROVIDES: a creature/permanent that is disproportionately powerful put onto the battlefield directly from a graveyard, and that will actually still BE in the graveyard when a reanimation effect looks for it — no ability that removes it from the graveyard on its own (e.g. shuffling itself into its library on death, the reason Worldspine Wurm does not provide this). REQUIRES: a graveyard-to-battlefield effect (Animate Dead, Reanimate) requires this from its target; a target lacking it scores nothing from the effect regardless of shared archetype.",
    },
    {
        id: "self-mills",
        description:
            "PROVIDES: puts one or more cards from the top of a library into a graveyard (its own or a target player's) without choosing which cards — mill, self-mill, or a fetch land's crack-back — the RANDOM graveyard-fueling enabler for reanimator strategies. REQUIRES: a card whose own cost or effect scales with graveyard size (delve, threshold, flashback, escape) declares this directly in ITS OWN `requires` array — there is no separate 'graveyard-scaling' capability name; the requiring card names its enabler(s) directly (this row, and/or `discard-outlet` below).",
    },
    {
        id: "discard-outlet",
        description:
            "PROVIDES: lets its controller (or another player) put a SPECIFIC, chosen card from hand into a graveyard on demand (looting, discard-for-effect, cycling) — the reliable enabler that gets a KNOWN reanimation/flashback target into the graveyard on purpose, distinct from self-mills' random top-of-library dump. REQUIRES: same discipline as `self-mills` — a graveyard-scaling card requires this directly, by name, in its own `requires` array.",
    },

    // ── Cheat-into-play cluster (ADR 0072's motivating example) ─────────
    {
        id: "value-on-etb",
        description:
            "PROVIDES: an enters-the-battlefield trigger or immediate static effect that pays off even if the permanent leaves play again right away (draws cards, deals damage, creates tokens) — independent of the permanent sticking around. REQUIRES: a cheat-into-play effect that only guarantees the permanent briefly touches the battlefield (Show and Tell) requires this from its target.",
    },
    {
        id: "value-on-attack",
        description:
            "PROVIDES: an attack trigger or attack-scaling effect that pays off the instant the permanent attacks, independent of whether it survives past that combat (token creation, direct damage, a forced-sacrifice trigger) — the Worldspine Wurm shape (ADR 0072): it creates its wurm tokens on attack, so it is still a great target for an effect that sacrifices it at the next cleanup step. REQUIRES: a one-combat cheat effect (Sneak Attack — sacrifices its target at the beginning of the next end step, AFTER one attack) requires this from its target; Emrakul, the Aeons Torn does not provide it, so the pair scores nothing.",
    },
    {
        id: "value-on-death",
        description:
            "PROVIDES: a death trigger, or an effect elsewhere keyed off this permanent dying / being put into a graveyard from the battlefield, that pays off regardless of the cause of death (draws cards, creates tokens, deals damage) — good sacrifice/removal-trade fodder. REQUIRES: an effect that wants to sacrifice or trade away permanents profitably requires this from its fodder.",
    },
    {
        id: "value-on-cast",
        description:
            "PROVIDES: a spell whose payoff is realized the moment it is CAST, independent of whether it resolves, is countered, or sticks around (a cast trigger, cascade, a storm-count contribution, a cantrip that replaces itself on resolution). REQUIRES: an effect that cares about spells being cast rather than resolved permanents (storm payoffs, cascade, a cast-trigger creature) requires this from the spells feeding it.",
    },

    // ── Artifacts cluster ────────────────────────────────────────────────
    {
        id: "cheap-artifact",
        description:
            "PROVIDES: a low mana-value artifact whose primary draft value is filling the artifact-count column for an artifact-count payoff (Moxen, Signets, cantrip artifacts) rather than its standalone rate. REQUIRES: an artifact-count/Metalcraft payoff card (its cost or effect scales with artifacts controlled) declares this directly, by name, in ITS OWN `requires` array — there is no separate 'artifact-payoff' capability name, matching the `self-mills`/`discard-outlet` discipline above.",
    },
];

/** Fast id -> row lookup, built once at module load — mirrors
 *  `mechanicsRegistry.ts`'s registry-array-plus-lookup-set shape. */
const CAPABILITY_IDS: ReadonlySet<string> = new Set(
    CAPABILITY_REGISTRY.map((row) => row.id)
);

/** True iff `name` is a row in the closed Capability vocabulary — the single
 *  authority `cardProfiles` authoring (and its catalogue-wide guard test)
 *  consults before writing a `provides`/`requires` string. Case-SENSITIVE:
 *  Capability ids are internal engine vocabulary, not user-facing text, so
 *  there is no reason to tolerate a casing typo silently matching (unlike
 *  `scope`, which IS user-facing/data-driven and normalizes to lowercase). */
export function isRegisteredCapability(name: string): boolean {
    return CAPABILITY_IDS.has(name);
}
