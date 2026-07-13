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
        // Fact or Fiction — pile division (ADR 0053, issue #1067). Cast Fact
        // or Fiction with a stocked library so the top 5 reveal + divide (by
        // the opponent, "opp") + choose (by the caster, "me") + hand/graveyard
        // split all play out. `libraryCount` is intentionally UNSET (mirrors the
        // Gaea's Blessing scenario above) — it resets the library AFTER seeding,
        // which would wipe these 5 explicit cards. Exactly 5 distinct library
        // entries are seeded instead so the whole revealed top-5 set is observable.
        label: "Fact or Fiction (#1067) — pile division divide-then-choose",
        cards: [
            { name: "Fact or Fiction", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 4 },
            { name: "Grizzly Bears", owner: "me", zone: "library" },
            { name: "Lightning Bolt", owner: "me", zone: "library" },
            { name: "Opt", owner: "me", zone: "library" },
            { name: "Grizzly Bears", owner: "me", zone: "library" },
            { name: "Lightning Bolt", owner: "me", zone: "library" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
];
