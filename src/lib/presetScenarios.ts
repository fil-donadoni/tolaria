type PresetScenario = {
    label: string;
    cards: {
        name: string;
        owner: "me" | "opp";
        zone?: "hand" | "battlefield" | "library" | "graveyard" | "exile";
        tapped?: boolean;
        /** Number of copies to place in the zone. Default 1. */
        count?: number;
        /** Marked damage (CR 120.3) on a battlefield creature. */
        damageMarked?: number;
        /** Place face down (CR 708.2): a 2/2 colourless vanilla creature whose
         *  real identity is hidden from the opponent. Battlefield only. */
        faceDown?: boolean;
        /** Exile face down (impulse-draw, CR 406.3, ADR 0026 slice 6): a card
         *  in the exile pile known only to its controller. Exile zone only. */
        faceDownExile?: boolean;
        /** Grant "me" a this-turn play-from-exile permission on an exiled card
         *  (CR 601.3e / 608.2g, #946): a Play (land) / Cast (spell) affordance
         *  appears, revoked at the next cleanup. Exile zone only. */
        castableFromExile?: boolean;
        /** Pre-seed counters (CR 122) on a battlefield permanent — e.g.
         *  `{ "+1/+1": 3 }` (Triskelion) or `{ doom: 2 }` (Armageddon Clock). */
        counters?: Record<string, number>;
        /** Mark this battlefield creature as having attacked during its
         *  controller's previous turn (CR 508.1) — sets `attackedDuringLastTurn`
         *  so self attack-restrictions (Giant Turtle #490) fire on declare. */
        attackedLastTurn?: boolean;
        /** Mark this battlefield permanent as having entered this turn (CR
         *  302.6) — sets `isSummoningSick`. For a manland (Mishra's Factory)
         *  this makes animation the same turn read summoning-sick: the animated
         *  creature can't attack and can't pay {T}. Battlefield default is
         *  `false` (controlled since a prior turn). #545. */
        summoningSick?: boolean;
        /** Make this battlefield permanent a copy of another card by name (CR
         *  707.2 — Clone / Copy Artifact / Vesuvan Doppelganger). `name` is the
         *  copy's printed identity (kept as `copiedFrom`); `copyOf` is the
         *  copied object it presents. Exercises the two-face copy preview.
         *  Battlefield only. */
        copyOf?: string;
    }[];
    phase: string;
    landCount: number;
    libraryCount?: number;
    /** Override the turn number. Default: unchanged (a fresh solo game is
     *  turn 1, where the draw step is skipped — set ≥2 to exercise draw-step
     *  effects like Aladdin's Lamp). */
    turn?: number;
    /** Mark "me"'s last hand card as the card drawn this turn — enables
     *  "discard the last card you drew this turn" costs (Jandor's Ring). */
    markLastDrawn?: boolean;
    /** Pin the seeded PRNG (CR 705 / ADR 0023) so the next random draw is
     *  deterministic — e.g. force a coin flip to WIN (seed 1) or LOSE (seed 7).
     *  Default: unchanged. */
    rngSeed?: number;
    /** Seed poison counters (CR 122) on a player. A player reaching ten or
     *  more loses the game (CR 704.5c). Absent / zero leaves the player at no
     *  poison. */
    poison?: { me?: number; opp?: number };
};

export const PRESET_SCENARIOS: PresetScenario[] = [
    {
        // Enchantress shell: cast an enchantment from hand → Enchantress's
        // Presence draws (spell-cast trigger); Serra's Sanctum taps for W per
        // enchantment; Seal of Cleansing / Ray of Revelation destroy the
        // opponent's enchantment; Krosan Reclamation exercises flashback from
        // the graveyard; Mirri's Guile reorders the top three on upkeep.
        label: "Enchantress: cast-draw + sac-destroy + Serra's mana",
        cards: [
            {
                name: "Enchantress's Presence",
                owner: "me",
                zone: "battlefield",
            },
            { name: "Serra's Sanctum", owner: "me", zone: "battlefield" },
            { name: "Seal of Cleansing", owner: "me", zone: "battlefield" },
            { name: "Mirri's Guile", owner: "me", zone: "battlefield" },
            { name: "Exploration", owner: "me", zone: "hand" },
            { name: "Aura of Silence", owner: "me", zone: "hand" },
            { name: "Ray of Revelation", owner: "me", zone: "hand" },
            { name: "Krosan Reclamation", owner: "me", zone: "graveyard" },
            { name: "Aura of Silence", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
    {
        // Cycling (CR 702.29, #689) — the "Cycle" button appears on every hand
        // card with a Cycling ability. Golden path + edge case in one board:
        //   • Cycle Raugrin Triome ({3}, discard → draw a card): the discard
        //     also triggers Marauding Mako on the battlefield, putting a +1/+1
        //     counter on it (a 1/1 → 2/2).
        //   • Cycle Unearth ({2}) to dig, OR cast it ({B}) to reanimate the
        //     Grizzly Bears in the graveyard (mana value 2 ≤ 3).
        //   • Miscalculation ({1}{U}) can be cycled ({2}) or held as a counter.
        // Five lands (one of each basic) pay every cycling cost.
        label: "Cycling — Triome / Unearth / Mako (CR 702.29)",
        cards: [
            { name: "Marauding Mako", owner: "me", zone: "battlefield" },
            { name: "Raugrin Triome", owner: "me", zone: "hand" },
            { name: "Unearth", owner: "me", zone: "hand" },
            { name: "Miscalculation", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
        libraryCount: 10,
    },
];
