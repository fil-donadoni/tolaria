type PresetScenario = {
    label: string;
    cards: {
        name: string;
        owner: "me" | "opp";
        zone?: "hand" | "battlefield" | "library" | "graveyard" | "exile";
        tapped?: boolean;
        /** Number of copies to place in the zone. Default 1. */
        count?: number;
        /** Position within the library, counted from the TOP (index 0, where
         *  `drawCard` reads). `1` = top card, `2` = second from top; negatives
         *  count from the bottom, so `-1` = bottom card, `-2` = second from
         *  bottom. Only meaningful for `zone: "library"`. Default: bottom
         *  (appended). With `count > 1` the copies are placed consecutively
         *  starting at this position. */
        position?: number;
        /** Attach this Aura/Equipment to another battlefield permanent by card
         *  name (CR 303.4 / 701.3 — sets `attachedTo`). The host is looked up on
         *  the owner's battlefield first, then the opponent's; the first match
         *  wins, so keep host names unambiguous within the scenario.
         *  Battlefield only. */
        attachedTo?: string;
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
        // Escape via Underworld Breach's zone-wide grant (CR 702.138). Breach on
        // the battlefield gives every nonland graveyard card escape for its own
        // mana cost plus exile three others. Cast Lightning Bolt from the
        // graveyard: pay {R}, exile three other cards. (Edge case: the land in
        // the graveyard never gains escape — "Each nonland card".)
        label: "Escape — Underworld Breach grant",
        cards: [
            { name: "Underworld Breach", owner: "me", zone: "battlefield" },
            { name: "Lightning Bolt", owner: "me", zone: "graveyard" },
            { name: "Grizzly Bears", owner: "me", zone: "graveyard", count: 9 },
            { name: "Lion's Eye Diamond", owner: "me", zone: "battlefield" },
            { name: "Vision Charm", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield", count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
];
