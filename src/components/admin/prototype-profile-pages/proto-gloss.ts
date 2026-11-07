// PROTOTYPE — throwaway. One-line glosses for every catalogue row, hand-
// written here to show the shape. The real implementation adds `gloss`
// (and `cluster`) to the registry rows themselves, beside `description`,
// so the editor, the census prompt and the Draft Lab read one source.
export interface ArchetypeGloss {
    when: string;
    not: string;
}

export const ARCHETYPE_GLOSS: Record<string, ArchetypeGloss> = {
    aggro: {
        when: "Cheap pressure that wants the game over early.",
        not: "A big body that merely attacks well (ramp/reanimator), or removal that buys time (control).",
    },
    artifacts: {
        when: "An artifact whose draft value is the count it fills, or a payoff that scales with artifacts.",
        not: "A colourless card whose rate stands alone — type line is not the plan.",
    },
    combo: {
        when: "One named half of a two-card loop, or the tutor/protection that assembles one.",
        not: "A card that wins a long game on its own (control), or a critical-mass engine (storm).",
    },
    control: {
        when: "Trades for more than it costs over a long game: counters, sweepers, card draw, late wincons.",
        not: "Cheap interaction clearing a blocker (aggro), or graveyard-fed card advantage (graveyard).",
    },
    graveyard: {
        when: "The graveyard is a resource it fills or spends: self-mill, flashback, delve, discard outlets.",
        not: "Returning one fatty to play (reanimator), or a plain death trigger (that is a Capability).",
    },
    ramp: {
        when: "Mana ahead of the curve, or a payoff only castable because you ramped.",
        not: "A cheap artifact valued for the count (artifacts), or cheating a cost entirely (reanimator/combo).",
    },
    reanimator: {
        when: "One end of put-a-fatty-into-play-early: the spell, the enabler chosen for it, or the fatty.",
        not: "Generic graveyard value or small-card recursion (graveyard).",
    },
    storm: {
        when: "Feeds or pays off a critical mass of spells in ONE turn: rituals, free spells, counters of spells.",
        not: "A named two-card loop (combo), or acceleration across turns (ramp).",
    },
};

export interface CapabilityGloss {
    cluster: string;
    provides: string;
    requires: string;
    /** A cube card on each side the reviewer will recognise. */
    example: { provider: string; requirer: string };
}

export const CAPABILITY_GLOSS: Record<string, CapabilityGloss> = {
    reanimatable: {
        cluster: "Reanimator / graveyard",
        provides:
            "A body worth cheating out of the graveyard, that actually STAYS there.",
        requires:
            "A graveyard-to-battlefield effect needs this from its target.",
        example: { provider: "Griselbrand", requirer: "Animate Dead" },
    },
    "reanimatable-mv-2": {
        cluster: "Reanimator / graveyard",
        provides:
            "Never set by hand: a `reanimatable` card with mana value ≤ 2 satisfies it.",
        requires: "A reanimation effect capped at mana value 2.",
        example: { provider: "(derived)", requirer: "Claim // Fame" },
    },
    "reanimatable-mv-3": {
        cluster: "Reanimator / graveyard",
        provides:
            "Never set by hand: a `reanimatable` card with mana value ≤ 3 satisfies it.",
        requires: "A reanimation effect capped at mana value 3.",
        example: { provider: "(derived)", requirer: "Unearth" },
    },
    "self-mills": {
        cluster: "Reanimator / graveyard",
        provides:
            "Puts cards from the top of a library into a graveyard, unchosen.",
        requires:
            "A cost or effect that scales with graveyard size names this directly.",
        example: { provider: "Hermit Druid", requirer: "Abhorrent Oculus" },
    },
    "discard-outlet": {
        cluster: "Reanimator / graveyard",
        provides: "Puts a CHOSEN card from hand into the graveyard on demand.",
        requires:
            "A graveyard-scaling card names this directly as its enabler.",
        example: { provider: "Faithless Looting", requirer: "Griselbrand" },
    },
    "value-on-etb": {
        cluster: "Cheat into play",
        provides:
            "An enters trigger that pays even if the permanent leaves at once.",
        requires: "A one-shot cheat (Sneak Attack) needs this from its target.",
        example: { provider: "Craterhoof Behemoth", requirer: "Sneak Attack" },
    },
    "value-on-attack": {
        cluster: "Cheat into play",
        provides:
            "An attack trigger that pays the instant it attacks (Annihilator).",
        requires: "A one-combat cheat needs this from its target.",
        example: {
            provider: "Emrakul, the Aeons Torn",
            requirer: "Sneak Attack",
        },
    },
    "value-on-death": {
        cluster: "Cheat into play",
        provides: "A death trigger that pays however it died.",
        requires: "An effect that sacrifices or trades permanents profitably.",
        example: { provider: "Worldspine Wurm", requirer: "Flash" },
    },
    "value-on-cast": {
        cluster: "Cheat into play",
        provides:
            "Pays on CAST, countered or not: cast triggers, cascade, cantrips.",
        requires:
            "Storm payoffs and cast-trigger creatures need this from the spells feeding them.",
        example: { provider: "Gitaxian Probe", requirer: "Tendrils of Agony" },
    },
    "cheap-artifact": {
        cluster: "Artifacts",
        provides:
            "A low-cost artifact whose value is filling the artifact count.",
        requires: "An artifact-count / Metalcraft payoff names this directly.",
        example: { provider: "Mox Pearl", requirer: "Tolarian Academy" },
    },
};

export const CLUSTER_ORDER = [
    "Reanimator / graveyard",
    "Cheat into play",
    "Artifacts",
];
