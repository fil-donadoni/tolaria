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
// The vocabulary MUST stay small (~15-25 rows, ADR 0072 Consequences) to
// stay meaningful — growth is the signal to check whether a proposed
// Capability is really a Combo Edge (an explicit, signed, two-card loop —
// Painter's Servant + Grindstone) or really an Archetype (a coarse named
// strategy like `reanimator`/`artifacts`/`jeskai-tempo`) instead. This slice
// ships the registry and its guard ONLY — no `cardProfiles` row references
// any of these names yet (zero behaviour change, issue #1608's acceptance).

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
            "PROVIDES: puts one or more cards from the top of a library into a graveyard (its own or a target player's) without choosing which cards — mill, self-mill, or a fetch land's crack-back — the RANDOM graveyard-fueling enabler for reanimator/graveyard-scaling strategies.",
    },
    {
        id: "discard-outlet",
        description:
            "PROVIDES: lets its controller (or another player) put a SPECIFIC, chosen card from hand into a graveyard on demand (looting, discard-for-effect, cycling) — the reliable enabler that gets a KNOWN reanimation/flashback target into the graveyard on purpose, distinct from self-mills' random top-of-library dump.",
    },
    {
        id: "graveyard-scaling",
        description:
            "REQUIRES: a spell or ability whose cost or effect gets measurably better as more cards sit in its controller's graveyard (delve, threshold, flashback, escape) — requires self-mills or discard-outlet in the pool to reach its full value.",
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
        id: "artifact-payoff",
        description:
            "REQUIRES: an effect that scales with the number of artifacts its controller controls, or that specifically cares about casting/having artifacts (Metalcraft, an artifact-count trigger, an artifact tutor) — requires a critical mass of cheap-artifact permanents in the pool to reach its threshold.",
    },
    {
        id: "cheap-artifact",
        description:
            "PROVIDES: a low mana-value artifact whose primary draft value is filling the artifact-count column for artifact-payoff cards (Moxen, Signets, cantrip artifacts) rather than its standalone rate — the enabler artifact-payoff requires.",
    },

    // ── Mana base cluster ────────────────────────────────────────────────
    {
        id: "fast-mana",
        description:
            "PROVIDES: produces mana at a rate faster than one land per turn would (a 0-2 mana rock/dork/ritual available before turn two, or a land that taps for two or more) — acceleration toward an above-curve play; a ramp/ritual-combo archetype needs a critical mass of this in the pool.",
    },
    {
        id: "mana-fixing",
        description:
            "PROVIDES: produces or fetches mana of more than one colour, or specifically a colour outside its own colour identity (dual/fetch lands, a mana rock/dork that taps for multiple colours, colour-flexible search) — castability support for a multicolour pool.",
    },

    // ── Tempo / control cluster ──────────────────────────────────────────
    {
        id: "evasive-clock",
        description:
            "PROVIDES: a creature that reliably deals combat damage against an opponent with blockers (flying, unblockable, menace, intimidate, a protection-based evasion) at an efficient rate — the aggressive-deck enabler that closes a game on a short clock.",
    },
    {
        id: "cheap-interaction",
        description:
            "PROVIDES: removal, a counterspell, or a combat trick costing two mana or less that answers a wide swath of threats — the tempo-deck enabler that keeps the board clear without falling behind on mana.",
    },
    {
        id: "sweeper",
        description:
            "PROVIDES: a single spell or ability that answers three or more opposing creatures/permanents at once — the control-deck stabilizer against a wide board.",
    },
    {
        id: "draws-cards",
        description:
            "PROVIDES: a permanent or repeatable-ability source of NET card advantage beyond a one-for-one replacement (draws more cards, over more than a single use, than it or its activation costs) — the control/value-deck payoff for surviving to the midgame.",
    },

    // ── Combo / toolbox cluster ──────────────────────────────────────────
    {
        id: "tutor",
        description:
            "PROVIDES: searches the library for one specific, named or criteria-matched card and puts it into hand, onto the battlefield, or another zone — the combo/toolbox enabler that finds a specific payoff (a Combo Edge partner or a reanimation target) on demand.",
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
