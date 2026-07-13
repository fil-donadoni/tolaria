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
        // Gaea's Blessing mill trigger (issue #1055): tap Millstone targeting
        // yourself to mill your own library. Gaea's Blessing (seeded on top of
        // your library) is milled, its "when this card is put into your
        // graveyard from your library" trigger fires, and your whole graveyard
        // (the two Forests + Gaea) shuffles back into your library.
        // `libraryCount` is intentionally UNSET so the seeded Gaea stays the
        // library's only card and is milled first.
        label: "Gaea's Blessing — mill trigger",
        cards: [
            { name: "Gaea's Blessing", owner: "me", zone: "library" },
            { name: "Forest", owner: "me", zone: "graveyard", count: 2 },
            { name: "Millstone", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Obliterate — "This spell can't be countered." (CR 701.5c, #1065).
        // Cast Obliterate; the opponent has Counterspell ready in hand and
        // enough mana to cast it targeting Obliterate on the stack (a legal
        // target — shroud/hexproof-style targeting restrictions do NOT apply
        // here, per the official ruling: "Counterspells can be cast that
        // target it, but when they resolve they simply don't counter it
        // since it can't be countered."). Resolving the opponent's
        // Counterspell demonstrates the fizzle: Obliterate stays on the
        // stack and then resolves normally, wiping both battlefields.
        label: "Obliterate can't be countered (#1065) — opponent's Counterspell fizzles",
        cards: [
            { name: "Obliterate", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield", count: 8 },
            { name: "Counterspell", owner: "opp", zone: "hand" },
            { name: "Island", owner: "opp", zone: "battlefield", count: 2 },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Domain payoff board (issue #1066): all five basic land types in play
        // for "me" (Domain 5) so every Domain-scaled effect is at its maximum.
        // Kavu Scout is already sitting at 5/2 (+5/+0); Power Armor is ready to
        // activate ({3},{T}: target creature +5/+5 until end of turn); Tribal
        // Flames / Wayfaring Giant / Coalition Victory are in hand to cast —
        // Coalition Victory only needs a creature of each color to complete the
        // marquee win (the land clause is already satisfied). Collective
        // Restraint sits on the OPPONENT's side with two basic land types of
        // their own, so declaring attackers demonstrates the dynamic {X}
        // attack-mana tax (X = 2, the opponent's own Domain) from the
        // defending side.
        label: "Domain payoff board (#1066) — Kavu Scout / Power Armor / Tribal Flames / Coalition Victory",
        cards: [
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "battlefield" },
            { name: "Kavu Scout", owner: "me", zone: "battlefield" },
            { name: "Power Armor", owner: "me", zone: "battlefield" },
            { name: "Wayfaring Giant", owner: "me", zone: "hand" },
            { name: "Tribal Flames", owner: "me", zone: "hand" },
            { name: "Coalition Victory", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Collective Restraint", owner: "opp", zone: "battlefield" },
            { name: "Island", owner: "opp", zone: "battlefield" },
            { name: "Swamp", owner: "opp", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Replenish — bulk graveyard-set move (issue #1056, CR 404 / 400.7).
        // Cast Replenish ({3}{W}) with four Plains untapped; it sweeps your
        // graveyard and returns BOTH enchantment cards (Crusade + Castle) to the
        // battlefield at once, with no per-card choice. The graveyard also holds
        // a creature (Grizzly Bears) the enchantment filter leaves behind.
        label: "Replenish (#1056) — return all enchantments from graveyard at once",
        cards: [
            { name: "Replenish", owner: "me", zone: "hand" },
            { name: "Plains", owner: "me", zone: "battlefield", count: 4 },
            { name: "Crusade", owner: "me", zone: "graveyard" },
            { name: "Castle", owner: "me", zone: "graveyard" },
            { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
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
    {
        // Phyrexian Infiltrator — exchange control (issue #1068, CR 701.12e /
        // 611.2b / 613.1b). Four untapped Islands pay the {2}{U}{U} activation
        // cost; activate targeting the opponent's Grizzly Bears to swap
        // control indefinitely — Grizzly Bears comes to "me", Phyrexian
        // Infiltrator goes to "opp".
        label: "Phyrexian Infiltrator (#1068) — exchange control indefinitely",
        cards: [
            { name: "Phyrexian Infiltrator", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield", count: 4 },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Blastoderm — Fading 3 (issue #676, CR 702.32, ADR 0054). One copy on
        // the battlefield pre-seeded down to its LAST fade counter, and one in
        // hand. Cast the hand copy to watch it enter with three fresh fade
        // counters (implicit keyword expansion); pass to your next upkeep and
        // the on-battlefield copy removes its last fade counter — the upkeep
        // after that it can't, and sacrifices itself.
        label: "Blastoderm (#676) — Fading 3 clock (last counter on board)",
        cards: [
            {
                name: "Blastoderm",
                owner: "me",
                zone: "battlefield",
                counters: { fade: 1 },
            },
            { name: "Blastoderm", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
    {
        // Deep Forest Hermit — Vanishing 3 (issue #676, CR 702.63, ADR 0054) +
        // ETB four 1/1 Squirrels + "Squirrels you control get +1/+1" anthem.
        // Cast the hand copy to watch it enter with three time counters and drop
        // four 2/2 Squirrels (base 1/1 + anthem). Pass to successive upkeeps to
        // strip the time counters; the upkeep the last one is removed the Hermit
        // sacrifices itself — and the Squirrels revert to 1/1 as the anthem
        // leaves with it.
        label: "Deep Forest Hermit (#676) — Vanishing 3 + Squirrel anthem",
        cards: [{ name: "Deep Forest Hermit", owner: "me", zone: "hand" }],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
];
