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
        // ICE combat-damage redirect / assign-no-damage riders (issue #732):
        // Kjeldoran Royal Guard ({T}) redirects all combat damage unblocked
        // attackers would deal to you onto itself (CR 614.6). Cloak of
        // Confusion (Aura) and Gaze of Pain (Sorcery) let an unblocked
        // attacker you control assign no combat damage — Cloak makes the
        // defender discard at random, Gaze deals the attacker's power to a
        // target creature. The opponent's Balduvian Bears is a ready attacker
        // to test the Guard's redirect; your own Bears + the riders exercise
        // the assign-no-damage seam. 5 lands cover {3}{W}{W}.
        label: "ICE assign-no-damage (Cloak of Confusion) (#732)",
        cards: [
            { name: "Cloak of Confusion", owner: "me", zone: "hand" },
            { name: "Balduvian Bears", owner: "me", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // Ashen Ghoul — graveyard-source activated ability (#737, CR 113.6 /
        // 602.5b / 603.6e). The Ghoul sits at the BOTTOM of your graveyard with
        // three Balduvian Bears stacked above it (three creature cards above =
        // the activation gate). It's your UPKEEP and a Swamp covers the {B}, so
        // "{B}: Return this card from your graveyard to the battlefield" is
        // legal — activate it to reanimate the Ghoul. Remove a Bears (or move
        // to a later phase) to watch the gate lock the ability out.
        label: "Ashen Ghoul — graveyard-activated reanimation (#737)",
        cards: [
            { name: "Ashen Ghoul", owner: "me", zone: "graveyard" },
            {
                name: "Balduvian Bears",
                owner: "me",
                zone: "graveyard",
                count: 3,
            },
            { name: "Swamp", owner: "me", zone: "battlefield" },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
];
