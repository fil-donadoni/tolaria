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
        // Frantic Search (ULG) spans two selection steps in ONE card: an
        // own-hand discard pick (`choose-hand-card`) and a battlefield untap
        // pick (`choose-permanents`). Both must ring the SELECTED cards green
        // (emerald), distinct from the faded-bronze "pickable" ring, so the
        // player can read what they've committed. Untapped Islands pay {2}{U};
        // the three tapped Islands are the untap targets; the Ornithopters are
        // discard fodder for the draw-two-then-discard-two step.
        label: "Frantic Search — selection ring (discard + untap)",
        cards: [
            { name: "Frantic Search", owner: "me", zone: "hand" },
            { name: "Ornithopter", owner: "me", zone: "hand", count: 2 },
            { name: "Island", owner: "me", zone: "battlefield", count: 3 },
            {
                name: "Island",
                owner: "me",
                zone: "battlefield",
                tapped: true,
                count: 3,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 10,
    },
    {
        // Memory Jar (ULG, #682) — activating it exiles every hand FACE DOWN,
        // so the opponent's exile pile fills with face-down cards. Their
        // projected identity is the `face-down:2-2-vanilla` sentinel, which has
        // no Scryfall art: the client must render the card back, not fetch a
        // 404 image URL. This scenario reaches that state in one activation.
        label: "Memory Jar — face-down exile",
        cards: [
            { name: "Memory Jar", owner: "me", zone: "battlefield" },
            { name: "Gray Ogre", owner: "me", zone: "hand", count: 2 },
            { name: "Grizzly Bears", owner: "opp", zone: "hand", count: 2 },
            { name: "Ornithopter", owner: "opp", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
];
