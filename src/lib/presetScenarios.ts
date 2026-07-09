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
        // X mana cost (CR 601.2b). Disintegrate ("{X}{R}: deal X damage to any
        // target, and it can't be regenerated") is in hand with seven Mountains,
        // so casting it opens the in-game cost dialog's X stepper — pick a value,
        // Cast, then choose a target. Green Sun's Zenith adds a second X card
        // (fetch a creature of mana value X) to exercise the stepper on a
        // non-burn spell. An opponent creature + face give the "any target"
        // choices.
        label: "X mana cost (CR 601.2b) — cost dialog X stepper",
        cards: [
            { name: "Disintegrate", owner: "me", zone: "hand" },
            { name: "Green Sun's Zenith", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield", count: 5 },
            { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
            { name: "Serra Angel", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 12,
    },
    {
        // Kicker / Multikicker cluster (issue #692, CR 702.33 / 702.33e). Every
        // kicker card is in hand with a full colour base so you can cast each
        // one both WITHOUT and WITH the kicker (the hand-card cast opens the
        // in-game cost dialog with a "pay kicker cost" toggle; Everflowing
        // Chalice's Multikicker shows a "times to pay kicker" stepper). Targets
        // to exercise the kicked-vs-unkicked branch: an
        // artifact (Sol Ring, mana value 1 — Overload/Tear Asunder), a big
        // creature (Serra Angel, mana value 5 — Bloodchief's Thirst can only
        // target it WHEN kicked). A stocked library makes Consult the Star
        // Charts' dig visible.
        label: "Kicker / Multikicker cluster (#692) — kicked vs not-kicked",
        cards: [
            { name: "Burst Lightning", owner: "me", zone: "hand" },
            { name: "Overload", owner: "me", zone: "hand" },
            { name: "Bloodchief's Thirst", owner: "me", zone: "hand" },
            { name: "Tear Asunder", owner: "me", zone: "hand" },
            { name: "Consult the Star Charts", owner: "me", zone: "hand" },
            { name: "Everflowing Chalice", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield", count: 3 },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 3 },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
            { name: "Sol Ring", owner: "opp", zone: "battlefield" },
            { name: "Serra Angel", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 12,
    },
    {
        // Opt (issue #1002): {U} Instant "Scry 1. Draw a card." Cast the Opt in
        // hand (an Island covers {U}) to raise the scry-1 order-top choice on
        // your top card — keep it on top or drag it to the bottom — then draw.
        // A stocked library (libraryCount) makes the top-card look/draw visible.
        label: "Opt — scry 1 + draw (#1002) - Visibilità scry to bottom",
        cards: [
            { name: "Opt", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 1,
        libraryCount: 12,
    },
    {
        // Copy-on-ETB Bot cast prune (issue #938): a copy-on-ETB spell (Copy
        // Artifact, Clone, Vesuvan Doppelganger, Dance of Many) enters as a copy
        // of a permanent already in play. Casting one with NO permanent it could
        // copy is legal but strictly wasteful — the vs-AI Bot must not offer it.
        // Here Copy Artifact + Clone are in hand with a copyable artifact (Ankh
        // of Mishra) and creature (Grizzly Bears) in play, so BOTH casts are
        // enumerated (the working case). Remove the Ankh (or the Bears) via the
        // board and the Bot stops offering the matching copy spell — the prune
        // is keyed off the declarative `copySourceFilter`, not a card-id list.
        // 8 Islands cover Clone's {3}{U} and Copy Artifact's {1}{U}.
        label: "Copy-on-ETB Bot cast prune (Copy Artifact / Clone) (#938)",
        cards: [
            { name: "Copy Artifact", owner: "opp", zone: "hand" },
            { name: "Clone", owner: "opp", zone: "hand" },
            { name: "Island", owner: "opp", zone: "battlefield", count: 7 },
            { name: "Ankh of Mishra", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 8,
    },
    {
        // ICE instance leave-watch delayed trigger (issue #731): Kjeldoran
        // Elite Guard's "{T}: Target creature gets +2/+2 until end of turn. When
        // that creature leaves the battlefield this turn, sacrifice this
        // creature. Activate only during combat." Tap the Guard targeting the
        // Balduvian Bears to pump it +2/+2 (a leaves-battlefield watch is
        // scheduled keyed to the Bears), then kill / bounce the Bears — the
        // delayed trigger fires and the Guard is sacrificed. If the Bears
        // survive the turn the watch expires unfired at cleanup. Phantasmal
        // Mount (blue) is the bidirectional variant. Starts in combat so the
        // Guard's combat-only activation is legal immediately.
        label: "ICE instance leave-watch (Kjeldoran Elite Guard) (#731)",
        cards: [
            {
                name: "Kjeldoran Elite Guard",
                owner: "me",
                zone: "battlefield",
            },
            { name: "Balduvian Bears", owner: "me", zone: "battlefield" },
        ],
        phase: "BEGINNING_OF_COMBAT",
        landCount: 4,
    },
    {
        // ICE computed subtype swap (issue #727, ADR 0050): Illusionary Terrain
        // in hand. As it enters, choose two basic land types — pick Forest then
        // Island. Your basic Forests immediately become Islands and tap for {U}
        // instead of {G} (CR 305.6/305.7). Cast it from hand to make the two
        // choices, then tap a former Forest to watch it produce blue. Cumulative
        // upkeep {2} bites on your next upkeep.
        label: "ICE computed subtype swap (Illusionary Terrain) (#727)",
        cards: [
            { name: "Illusionary Terrain", owner: "me", zone: "hand" },
            { name: "Forest", owner: "me", zone: "battlefield", count: 3 },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
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
        // #674 card-draw / card-advantage FREE tranche golden path: Sheoldred,
        // the Apocalypse is already on the battlefield watching every draw
        // (CR 121.1 draw-triggered life swing via `drawTrigger`). Cast Baleful
        // Strix (Island + Swamp cover {U}{B}) — its ETB `draw` Op fires
        // Sheoldred's "you draw" clause for +2 life. Then activate
        // Griselbrand's "Pay 7 life: Draw seven cards" — the same clause
        // fires again for +14 life, exercising a stacked/repeated trigger on
        // one draw-Op source. Passing to the opponent's draw step shows the
        // "an opponent draws a card" clause (-2 life) on the other side. A
        // stocked library (15) covers Griselbrand's 7-card draw plus normal
        // draw steps for both players.
        label: "Sheoldred + Baleful Strix + Griselbrand — draw triggers (#674)",
        cards: [
            {
                name: "Sheoldred, the Apocalypse",
                owner: "me",
                zone: "battlefield",
            },
            { name: "Griselbrand", owner: "me", zone: "battlefield" },
            { name: "Baleful Strix", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Griselbrand", owner: "opp", zone: "battlefield" },
            { name: "Baleful Strix", owner: "opp", zone: "hand" },
            { name: "Island", owner: "opp", zone: "battlefield" },
            { name: "Swamp", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 15,
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
    {
        // Cube FREE: edict (#682) — Sheoldred's Edict is the 3-mode
        // `optionChoice` — its nontoken-creature mode has Balduvian Bears to
        // sacrifice.
        label: "Edict (#682) — Sheoldred's Edict",
        cards: [
            { name: "Sheoldred's Edict", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "opp", zone: "hand" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Dominate — targeted control change filtered by mana value (issue
        // #994). Dominate ({X}{1}{U}{U} instant, "Gain control of target
        // creature with mana value X or less") sits in hand. The opponent
        // controls a Grizzly Bears (MV 2) and a Serra Angel (MV 5). Cast
        // Dominate with X = 3: only the Bears is a legal target (MV 2 <= 3),
        // the Serra Angel is filtered out (MV 5 > 3) — the mana-value gate in
        // getLegalTargets (CR 202.3). On resolution the Bears moves under your
        // control indefinitely (CR 613.1b layer-2 control change). 6 Islands
        // cover {X=3}{1}{U}{U} = 6 mana.
        label: "Dominate: control change filtered by mana value (#994)",
        cards: [
            { name: "Dominate", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 6 },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            // { name: "Ornithopter", owner: "opp", zone: "battlefield" },
            { name: "Serra Angel", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // digToHand Effect Script Op (#984). Impulse ({1}{U} instant): "Look at
        // the top four cards of your library. Put one of them into your hand and
        // the rest on the bottom of your library in any order." Cast it and the
        // look-top picker shows exactly the top four face-up — keep one (it goes
        // to hand), the other three drop to the bottom of the library. 3 Islands
        // cover the {1}{U}; the library is the shared draw pile.
        label: "Impulse (#984) - Verificare put to bottom",
        cards: [
            { name: "Impulse", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // Flashback CAP (#693, CR 702.34): a card in your graveyard with a
        // flashback cost shows a "Flashback" cast button. Golden path — Firebolt
        // (Flashback {4}{R}) in the graveyard + 5 Mountains: flash it back for 2
        // damage to any target, then it's EXILED (not returned to the yard).
        // Faithless Looting (Flashback {2}{R}) is a second one-click flashback.
        // Edge case — Snapcaster Mage in hand ({1}{U}, cast it with the Islands):
        // its ETB grants an instant/sorcery in your graveyard flashback until end
        // of turn (cost = its mana cost), so a card with NO printed flashback
        // gains one. The affordance rides `legalActions` on the projected
        // graveyard card (GraveyardFlashbackButton).
        label: "Flashback — cast from graveyard (#693)",
        cards: [
            { name: "Firebolt", owner: "me", zone: "graveyard" },
            // { name: "Faithless Looting", owner: "me", zone: "graveyard" },
            { name: "Snapcaster Mage", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield", count: 5 },
            { name: "Island", owner: "me", zone: "battlefield", count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 12,
    },
    {
        // Free pitch — alternative casting cost (CR 118.9, issue #690). Cast a
        // pitch spell by giving up a NON-mana resource instead of paying mana.
        // The cast-option picker (click the spell) offers "Pay mana cost" + the
        // alternative; picking the alternative pays it at commit. Golden paths
        // castable on YOUR turn with no stacked spell:
        //   • Snuff Out — "Pay 4 life" (you control a Swamp): destroy the
        //     opponent's Grizzly Bears (can't be regenerated).
        //   • Mine Collapse — "Sacrifice a Mountain" (it's your turn): 5 damage
        //     to a creature.
        //   • Pyrokinesis — "Exile a red card from your hand": pick Lightning
        //     Bolt in the hand-cost picker, then divide 4 damage among the
        //     opponent's creatures (the exile-from-hand leg — the new infra).
        // Force of Will (pay 1 life + exile a blue card) also appears in hand —
        // its counter needs an opponent spell on the stack, so use it against a
        // spell you bait out. Edge case — Force of Vigor pitch is gated on "if
        // it's not your turn", so the cast-option picker filters its alternative
        // OUT here (it's your turn) and only "Pay mana cost" is offered; pass
        // priority to the opponent's turn and the "exile a green card" pitch
        // appears (a green card — Giant Growth — is in hand to pay it).
        label: "Free pitch alt-cost (#690) — Snuff Out / Mine Collapse / Pyrokinesis",
        cards: [
            { name: "Snuff Out", owner: "me", zone: "hand" },
            { name: "Mine Collapse", owner: "me", zone: "hand" },
            { name: "Pyrokinesis", owner: "me", zone: "hand" },
            { name: "Force of Will", owner: "me", zone: "hand" },
            { name: "Force of Vigor", owner: "me", zone: "hand" },
            // Pitch fodder: a red card (Pyrokinesis) and a blue card (Force of
            // Will) to exile from hand; a green card for Force of Vigor.
            { name: "Lightning Bolt", owner: "me", zone: "hand" },
            { name: "Sol Ring", owner: "opp", zone: "battlefield", count: 2 },
            { name: "Counterspell", owner: "me", zone: "hand" },
            { name: "Foil", owner: "me", zone: "hand" },
            { name: "Giant Growth", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield", count: 3 },
            { name: "Island", owner: "me", zone: "hand" },
            {
                name: "Grizzly Bears",
                owner: "opp",
                zone: "battlefield",
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
        libraryCount: 10,
    },
    {
        // Threshold / Delirium / Revolt CAP (#691): Cabal Ritual in hand with
        // 8+ cards in graveyard (threshold active). Two Swamps cover {1}{B};
        // casting Cabal Ritual produces {B}{B}{B}{B}{B} instead of {B}{B}{B}.
        // Graveyard also contains cards of different types to demonstrate
        // delirium for Unholy Heat (also in hand).
        label: "Threshold / Delirium — Cabal Ritual + Unholy Heat (#691)",
        cards: [
            { name: "Cabal Ritual", owner: "me", zone: "hand" },
            { name: "Unholy Heat", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 3 },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "graveyard",
                count: 3,
            },
            { name: "Swamp", owner: "me", zone: "graveyard", count: 2 },
            {
                name: "Balduvian Bears",
                owner: "me",
                zone: "graveyard",
                count: 2,
            },
            { name: "Cabal Ritual", owner: "me", zone: "graveyard" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
];
