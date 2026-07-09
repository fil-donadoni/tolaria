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
        // Sulfuric Vortex (issue #988): {1}{R}{R} Enchantment — "At the
        // beginning of each player's upkeep, this enchantment deals 2 damage to
        // that player. If a player would gain life, that player gains no life
        // instead." Vortex is already on your battlefield. Advance to the next
        // upkeep to watch it ping the upkeep player for 2 (fires on EVERY
        // player's upkeep — both you and the opponent take 2 in turn). Then try
        // to gain life: cast Healing Salve (a Plains covers {W}) and choose the
        // "gain 3 life" mode — the life-gain lock consumes it, so your life
        // total stays put.
        label: "Sulfuric Vortex — upkeep ping + lifegain lock (#988)",
        cards: [
            { name: "Sulfuric Vortex", owner: "me", zone: "battlefield" },
            { name: "Healing Salve", owner: "me", zone: "hand" },
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Mountain", owner: "me", zone: "battlefield", count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Hibernation (issue #995): {2}{U} Instant "Return all green permanents
        // to their owners' hands." A colour-filtered mass bounce. Cast the
        // Hibernation in hand (two Islands cover {2}{U}) — every GREEN permanent
        // on BOTH battlefields (your Grizzly Bears + Forest-less green here, and
        // the opponent's green creature) returns to its owner's hand, while the
        // colourless Ornithopter and the Islands stay put. Confirms the filter:
        // green goes, non-green stays.
        label: "Hibernation — mass bounce by colour (#995)",
        cards: [
            { name: "Hibernation", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Ornithopter", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Opt (issue #1002): {U} Instant "Scry 1. Draw a card." Cast the Opt in
        // hand (an Island covers {U}) to raise the scry-1 order-top choice on
        // your top card — keep it on top or drag it to the bottom — then draw.
        // A stocked library (libraryCount) makes the top-card look/draw visible.
        label: "Opt — scry 1 + draw (#1002)",
        cards: [
            { name: "Opt", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 1,
        libraryCount: 12,
    },
    {
        // Goblin Cadets (issue #1001): {R} 2/1 Goblin — "Whenever this creature
        // blocks or becomes blocked, target opponent gains control of it. (This
        // removes this creature from combat.)" Goblin Cadets is on your
        // battlefield with an opponent creature across the table. Move to combat
        // and attack with Goblin Cadets; when the opponent blocks it, it
        // "becomes blocked" — the trigger donates it to the opponent (CR 613.1b)
        // and removes it from combat (CR 506.4c), so no combat damage is dealt.
        // (Symmetrically, blocking an opponent's attacker donates it too.)
        label: "Goblin Cadets — control-donation drawback (#1001)",
        cards: [
            { name: "Goblin Cadets", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
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
        // ICE repeating combat-event delayed trigger (issue #884): Battle Cry
        // ("Untap all white creatures you control. Whenever a creature blocks
        // this turn, it gets +0/+1 until end of turn."). Shield Bearer starts
        // TAPPED to show the untap clause; Balduvian Bears is a ready attacker.
        // Cast Battle Cry in PRECOMBAT_MAIN (untaps Shield Bearer immediately
        // and schedules the repeating "this-turn-creature-blocks" watch),
        // attack with the Bears, then block with the opponent's Bears — the
        // blocker gets +0/+1 until end of turn, and the watch stays queued for
        // any further block this turn (unlike a one-shot delayed trigger).
        label: "ICE repeating combat-event delayed trigger (Battle Cry) (#884)",
        cards: [
            { name: "Battle Cry", owner: "me", zone: "hand" },
            {
                name: "Shield Bearer",
                owner: "me",
                zone: "battlefield",
                tapped: true,
            },
            { name: "Balduvian Bears", owner: "me", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // Cumulative-upkeep global-lock permanents (issue #727): Glacial Chasm
        // and Halls of Mist enter the battlefield, Energy Storm sits in hand.
        // Glacial Chasm's ETB asks you to sacrifice a land; on the battlefield
        // it locks your creatures out of combat and prevents all damage to you.
        // Halls of Mist forbids a creature that attacked last turn from
        // attacking. Cast Energy Storm to prevent instant/sorcery damage and
        // keep flyers tapped. Extra lands so the ETB sacrifice has a target.
        label: "ICE global-lock permanents (Glacial Chasm / Halls of Mist / Energy Storm) (#727)",
        cards: [
            { name: "Glacial Chasm", owner: "me", zone: "battlefield" },
            { name: "Halls of Mist", owner: "me", zone: "battlefield" },
            { name: "Energy Storm", owner: "me", zone: "hand" },
            { name: "Balduvian Bears", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
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
        label: "ICE combat-damage redirect / assign-no-damage (Royal Guard / Cloak / Gaze) (#732)",
        cards: [
            {
                name: "Kjeldoran Royal Guard",
                owner: "me",
                zone: "battlefield",
            },
            { name: "Cloak of Confusion", owner: "me", zone: "hand" },
            { name: "Gaze of Pain", owner: "me", zone: "hand" },
            { name: "Balduvian Bears", owner: "me", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // Filtered counter abilities (issue #736): Mistfolk ("{U}: Counter
        // target spell that targets this creature"), Brown Ouphe ("{1}{G},{T}:
        // Counter target activated ability from an artifact source"), and
        // Arenson's Aura ("{W}, Sac an enchantment: Destroy target enchantment"
        // / "{3}{U}{U}: Counter target enchantment spell"). The opponent's Icy
        // Manipulator gives Brown Ouphe an artifact activated ability to target
        // ({1},{T}: tap); the opponent's Energy Storm is an enchantment for
        // Arenson's Aura to destroy. 5 lands cover the coloured costs.
        label: "ICE filtered counters (Mistfolk / Brown Ouphe / Arenson's Aura) (#736)",
        cards: [
            { name: "Mistfolk", owner: "me", zone: "battlefield" },
            { name: "Brown Ouphe", owner: "me", zone: "battlefield" },
            { name: "Arenson's Aura", owner: "me", zone: "battlefield" },
            { name: "Icy Manipulator", owner: "opp", zone: "battlefield" },
            { name: "Energy Storm", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // ICE buildable-now utilities (#728): Elkin Bottle exiles the top card
        // of your library and lets you play it from exile ({3},{T}); Burnt
        // Offering sacrifices a creature and adds mana in any {B}/{R}
        // combination equal to its mana value. Elkin Bottle is on the
        // battlefield (untapped) with a stocked library; Burnt Offering sits in
        // hand with a Grizzly Bears to sacrifice. 4 lands cover the {3} activation
        // and the {B} cast.
        label: "Elkin Bottle + Burnt Offering — ICE utilities (#728)",
        cards: [
            { name: "Elkin Bottle", owner: "me", zone: "battlefield" },
            { name: "Burnt Offering", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
        libraryCount: 6,
    },
    {
        // Colour / amount damage-prevention shields (ICE, #734). Prismatic Ward
        // (choose a colour on entry, prevent ALL damage to the enchanted
        // creature from that colour) and Sacred Boon (prevent the next 3 damage
        // to a creature, then a +0/+1 counter per point actually prevented at
        // the next end step). Enchant your Grizzly Bears with Prismatic Ward and
        // pick red, then let the opponent's Prodigal Pyromancer ping it —
        // prevented. Or cast Sacred Boon on the Bears, take some damage, and
        // watch the +0/+1 counters land at end of turn. Three Plains cover the
        // {1}{W} each.
        label: "Prismatic Ward + Sacred Boon — damage-prevention shields (#734)",
        cards: [
            { name: "Prismatic Ward", owner: "me", zone: "hand" },
            { name: "Sacred Boon", owner: "me", zone: "hand" },
            { name: "Plains", owner: "me", zone: "battlefield", count: 3 },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            {
                name: "Prodigal Pyromancer",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
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
        // Fumarole — dual-target destroy + fixed pay-life (#737, CR 601.2b /
        // 601.2c / 701.7). "As an additional cost to cast this spell, pay 3
        // life. Destroy target creature and target land." Cast it from hand:
        // the engine walks TWO independent target groups — first pick the
        // opponent's Balduvian Bears (creature), then a Plains (land, from
        // landCount) — pays 3 life on commit, and destroys both. Swamp +
        // Mountain + three Plains cover the {3}{B}{R}.
        label: "Fumarole — dual-target destroy + pay 3 life (#737)",
        cards: [
            { name: "Fumarole", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // Vintage Cube mana ramp / rocks / dorks / fixing tranche (issue
        // #675, ADR 0041). Gaea's Cradle scales with the 2 Elvish Mystics on
        // the battlefield (manaAmount — {G} for each creature you control);
        // Urborg, Tomb of Yawgmoth turns every land into a Swamp too (layer-4
        // subtype-add), so Copperline Gorge — a fast land with no printed
        // basic land types of its own — gains a free {T}: Add {B} via the
        // basic-land-type mana inference on top of its printed R/G choice.
        // Talisman of Progress is in hand-adjacent reach (already in play)
        // to exercise the painland-shaped choice mana ability. No `landCount`
        // padding: every land here is a named ramp/fixing piece.
        label: "Vintage Cube ramp & fixing — Cradle/Urborg/fast land (#675)",
        cards: [
            { name: "Gaea's Cradle", owner: "me", zone: "battlefield" },
            {
                name: "Urborg, Tomb of Yawgmoth",
                owner: "me",
                zone: "battlefield",
            },
            { name: "Copperline Gorge", owner: "me", zone: "battlefield" },
            { name: "Talisman of Progress", owner: "me", zone: "battlefield" },
            {
                name: "Elvish Mystic",
                owner: "me",
                zone: "battlefield",
                count: 2,
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Vintage Cube FREE targeted removal (#676): Infernal Grasp ("Destroy
        // target creature. You lose 2 life.") and Vindicate ("Destroy target
        // permanent.") exercise the single-target destroy golden path — cast
        // Infernal Grasp at the opponent's Balduvian Bears, or Vindicate at
        // either the Bears or their nonbasic Badlands (any permanent type).
        // Wasteland is already in play — sacrifice it to destroy the Badlands
        // (CR 205.4a nonbasic-only filter) without spending a card from hand.
        // Swamp + Plains cover the {B} / {W}{B} pips; landCount covers the
        // generic {1} on both spells.
        label: "Infernal Grasp / Vindicate / Wasteland — targeted removal (#676)",
        cards: [
            { name: "Infernal Grasp", owner: "me", zone: "hand" },
            { name: "Vindicate", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Wasteland", owner: "me", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
            { name: "Badlands", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Cube FREE: tutors / library search (#677) — the moveZone
        // `cards`/`player` shape (the search half of a tutor/fetch effect).
        // Wishclaw Talisman starts with its three wish counters pre-seeded
        // (the ETB grant already ran); activate it to search your library
        // (unrestricted — guaranteed candidates whenever the library is
        // non-empty, unlike a fetchland's subtype-restricted search), put the
        // found card into hand, then watch control of the Talisman itself
        // pass to the opponent (CR 613.1b). A stocked library covers the
        // search.
        label: "Wishclaw Talisman — moveZone tutor/fetch search (#677)",
        cards: [
            {
                name: "Wishclaw Talisman",
                owner: "me",
                zone: "battlefield",
                counters: { wish: 3 },
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 1,
        libraryCount: 10,
    },
    {
        // Cube FREE token makers (issue #678). Two spec-driven `createToken`
        // engines side by side: Retrofitter Foundry ({2},{T}: make a Servo →
        // {1},{T},Sac a Servo: make a flying Thopter → {T},Sac a Thopter: make
        // a 4/4 Construct — climb the ladder with the pre-placed lands), and
        // Third Path Iconoclast (Whenever you cast a noncreature spell, make a
        // 1/1 Soldier artifact token — cast the Lightning Bolt in hand to fire
        // it). Exercises createToken at both an activated- and a triggered-
        // ability site (CR 111 / 707.1).
        label: "Cube token makers (Retrofitter Foundry / Third Path Iconoclast) (#678)",
        cards: [
            { name: "Retrofitter Foundry", owner: "me", zone: "battlefield" },
            {
                name: "Third Path Iconoclast",
                owner: "me",
                zone: "battlefield",
            },
            { name: "Lightning Bolt", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // Cube FREE: graveyard recursion (#680) — the `moveZone` graveyard
        // reanimation branches. Cast Reanimate targeting Griselbrand (mana
        // value 8) in your own graveyard: it enters under your control and you
        // lose 8 life (the `ref.manaValue` snapshot, CR 608.2h). Cast Exhume:
        // both players put a creature card from their OWN graveyard onto the
        // battlefield (the `forEach(players)` + per-player `choice` pattern —
        // "me" picks Balduvian Bears, "opp" also has one to pick up, exercising
        // the two-player APNAP branch). Cast Eternal Witness: its ETB lets you
        // return any card from your graveyard to hand (no type filter — the
        // Bears card, or Reanimate/Exhume themselves once they're in the
        // graveyard).
        label: "Graveyard recursion (#680) — Reanimate / Exhume / Eternal Witness",
        cards: [
            { name: "Reanimate", owner: "me", zone: "hand" },
            { name: "Exhume", owner: "me", zone: "hand" },
            { name: "Eternal Witness", owner: "me", zone: "hand" },
            { name: "Griselbrand", owner: "me", zone: "graveyard" },
            { name: "Balduvian Bears", owner: "me", zone: "graveyard" },
            { name: "Balduvian Bears", owner: "opp", zone: "graveyard" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Cube FREE: mass removal / sweepers (#685) — Damnation
        // (`resolve()`/`destroyAll`, CR 701.8/701.15c) and Upheaval (Effect
        // Script `forEach` + `moveZone`, CR 400.7) side by side. Cast
        // Damnation first: every creature on BOTH sides dies (including a
        // regenerating Lion — the "can't be regenerated" rider suppresses
        // its shield) while Sol Ring survives untouched. Then cast Upheaval:
        // Sol Ring and every remaining permanent (lands included) bounce to
        // their owners' hands — nothing is left on either battlefield.
        label: "Cube FREE sweepers (#685) — Damnation / Upheaval",
        cards: [
            { name: "Damnation", owner: "me", zone: "hand" },
            { name: "Upheaval", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 4 },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            { name: "Sol Ring", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "War Mammoth", owner: "opp", zone: "battlefield" },
            {
                name: "Savannah Lions",
                owner: "opp",
                zone: "battlefield",
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Cube FREE: edict / discard / hand disruption (#682) — the
        // `reveal` + `choice(zoneOwnerId)` template. Cast Thoughtseize /
        // Inquisition of Kozilek / Duress targeting "opp": each reveals
        // opp's hand (Swamp + Balduvian Bears + Lightning Bolt) and lets
        // "me" choose a nonland (Thoughtseize/Inquisition) or noncreature-
        // nonland (Duress, picks Lightning Bolt over the Bears) card to
        // discard — the Swamp is never a legal pick. Inquisition's mana-
        // value-3-or-less filter also excludes nothing here (both remaining
        // nonland cards are cheap). Sheoldred's Edict is the 3-mode
        // `optionChoice` — its nontoken-creature mode has Balduvian Bears to
        // sacrifice. Memory Jar exercises the whole-hand exile/draw-7/
        // delayed-return sequence independently of the discard spells.
        label: "Edict / discard / hand disruption (#682) — Thoughtseize / Inquisition / Duress / Sheoldred's Edict / Memory Jar",
        cards: [
            { name: "Thoughtseize", owner: "me", zone: "hand" },
            { name: "Inquisition of Kozilek", owner: "me", zone: "hand" },
            { name: "Duress", owner: "me", zone: "hand" },
            { name: "Sheoldred's Edict", owner: "me", zone: "hand" },
            { name: "Memory Jar", owner: "me", zone: "battlefield" },
            { name: "Swamp", owner: "opp", zone: "hand" },
            { name: "Balduvian Bears", owner: "opp", zone: "hand" },
            { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Counterspells + new spell-target filters (issue #683): Stern
        // Scolding ("Counter target creature spell with power or toughness 2
        // or less" — the new `spellCreaturePtFilter`) and Spell Pierce
        // ("Counter target noncreature spell unless its controller pays {2}"
        // — the new `spellExcludeTypeFilter`). Let the opponent cast Grizzly
        // Bears (2/2 — qualifies for Stern Scolding's P/T gate) or Lightning
        // Bolt (an instant — qualifies for Spell Pierce's noncreature gate;
        // NOT a legal Stern Scolding target). Respond with the matching
        // counterspell to verify only the right stack items are clickable.
        label: "Counterspells — new spell-target filters (#683)",
        cards: [
            { name: "Stern Scolding", owner: "me", zone: "hand" },
            { name: "Spell Pierce", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            { name: "Forest", owner: "opp", zone: "battlefield" },
            { name: "Mountain", owner: "opp", zone: "battlefield", count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Alternative casting cost — return / sacrifice lands (CR 118.9, #983).
        // WHICH lands pay is the player's CHOICE (CR 701.21a): Gush ("return two
        // Islands rather than pay {4}{U}, draw two"), Thwart ("return three
        // Islands rather than pay {2}{U}{U}, counter target spell") and Fireblast
        // ("sacrifice two Mountains rather than pay {4}{R}{R}, deal 4 to any
        // target") sit in "me"'s hand with NO other mana — castable ONLY via
        // their land alt cost. The lands are a mix of tapped/untapped so the
        // choice is REAL: casting parks and prompts you to click WHICH lands to
        // return / sacrifice (a picker, not a silent auto-pick of the first N).
        // With four untapped Islands you can return any two/three; the two tapped
        // Mountains vs two untapped let you keep the ones you want for Fireblast.
        // The opponent's Grizzly Bears is a target for Fireblast; cast an opponent
        // spell first (from their hand) to exercise Thwart's counter.
        label: "Alt cost: choose lands to return/sacrifice (Gush / Thwart / Fireblast) (#983)",
        cards: [
            { name: "Gush", owner: "me", zone: "hand" },
            { name: "Thwart", owner: "me", zone: "hand" },
            { name: "Fireblast", owner: "me", zone: "hand" },
            // Four untapped + one tapped Island → returning 2 (Gush) or 3
            // (Thwart) is a real, prompted choice.
            { name: "Island", owner: "me", zone: "battlefield", count: 4 },
            { name: "Island", owner: "me", zone: "battlefield", tapped: true },
            // Two untapped + two tapped Mountains → sacrificing 2 (Fireblast) is
            // a real, prompted choice.
            { name: "Mountain", owner: "me", zone: "battlefield", count: 2 },
            {
                name: "Mountain",
                owner: "me",
                zone: "battlefield",
                count: 2,
                tapped: true,
            },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
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
            { name: "Serra Angel", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Sacrifice-for-effect activated ability (issue #986): Seal of Fire
        // ({R} enchantment) and Mogg Fanatic ({R} 1/1 Goblin) both carry
        // "Sacrifice this: deal N damage to any target" — a self-sacrifice
        // activation cost (CR 602.1 / 701.21) with no mana and no tap,
        // activatable any time you have priority. The Seal starts on the
        // battlefield ready to pop; the Mogg is also in play (summoning
        // sickness never gates a sacrifice ability — it is not a tap ability).
        // A spare Mogg Fanatic sits in hand to recast. Opponent creatures
        // (Grizzly Bears 2/2, Balduvian Bears 2/2) plus the opponent's face
        // are legal any-target sinks — sacrifice the Seal for 2 or the Mogg
        // for 1 (CR 120.1 damage).
        label: "Sacrifice-for-effect (Seal of Fire / Mogg Fanatic) (#986)",
        cards: [
            { name: "Seal of Fire", owner: "me", zone: "battlefield" },
            { name: "Mogg Fanatic", owner: "me", zone: "battlefield" },
            { name: "Mogg Fanatic", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
    {
        // digToHand Effect Script Op (#984). Impulse ({1}{U} instant): "Look at
        // the top four cards of your library. Put one of them into your hand and
        // the rest on the bottom of your library in any order." Cast it and the
        // look-top picker shows exactly the top four face-up — keep one (it goes
        // to hand), the other three drop to the bottom of the library. 3 Islands
        // cover the {1}{U}; the library is the shared draw pile.
        label: "digToHand Effect Script Op (Impulse) (#984)",
        cards: [
            { name: "Impulse", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // Powder Keg — fuse counters + MV-matched sweep (#997). Powder Keg
        // enters with 2 fuse counters pre-seeded. Activate "{T}, Sacrifice
        // Powder Keg" and it destroys every artifact and creature with mana
        // value EQUAL to its fuse count (2): Grizzly Bears (MV 2 creature) and
        // Ankh of Mishra (MV 2 artifact) die; Sol Ring (MV 1) and Llanowar
        // Elves (MV 1) survive. The counter count is read as last-known
        // information — Powder Keg is already gone (sacrificed as a cost) when
        // the ability resolves (CR 608.2g). Pass a turn to reach your upkeep to
        // exercise the optional "you may put a fuse counter" accrual half.
        label: "Powder Keg — fuse counters + MV-matched sweep (#997)",
        cards: [
            {
                name: "Powder Keg",
                owner: "me",
                zone: "battlefield",
                counters: { fuse: 2 },
            },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Sol Ring", owner: "me", zone: "battlefield" },
            { name: "Ankh of Mishra", owner: "opp", zone: "battlefield" },
            { name: "Llanowar Elves", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Price of Progress (issue #999): {1}{R} Instant "deals damage to each
        // player equal to twice the number of nonbasic lands that player
        // controls." Cast the Price of Progress in hand (a Mountain covers {R},
        // {1}). You control 2 Wasteland (nonbasic) + 1 Mountain (basic) → 2
        // nonbasic → take 4; the opponent controls 1 Wasteland + 2 Mountain → 1
        // nonbasic → takes 2. Basics contribute 0 — the symmetric asymmetric
        // burn that punishes a nonbasic-heavy manabase.
        label: "Price of Progress — damage per nonbasic land (#999)",
        cards: [
            { name: "Price of Progress", owner: "me", zone: "hand" },
            { name: "Wasteland", owner: "me", zone: "battlefield", count: 2 },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Wasteland", owner: "opp", zone: "battlefield" },
            { name: "Mountain", owner: "opp", zone: "battlefield", count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 1,
    },
];
