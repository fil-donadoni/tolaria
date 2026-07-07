import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JSONTree } from "react-json-tree";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { usePageVisible } from "~/hooks/usePageVisible";
import { storeSession } from "~/lib/session";
import { copyMinified } from "~/lib/clipboard";
import DebugButton from "./debug-button";

const theme = {
    scheme: "tolaria",
    base00: "transparent",
    base01: "#383830",
    base02: "#49483e",
    base03: "#75715e",
    base04: "#a59f85",
    base05: "#f8f8f2",
    base06: "#f5f4f1",
    base07: "#f9f8f5",
    base08: "#f92672",
    base09: "#fd971f",
    base0A: "#f4bf75",
    base0B: "#a6e22e",
    base0C: "#a1efe4",
    base0D: "#66d9ef",
    base0E: "#ae81ff",
    base0F: "#cc6633",
};

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

const PRESET_SCENARIOS: PresetScenario[] = [
    {
        // Unpayable additional-cost sacrifice (CR 117.9 / 601.2f, issue
        // #944): Natural Order's additional cost is "sacrifice a green
        // creature." With NO green creature under my control, the Cast
        // action must be illegal — the card greyed out, not clickable —
        // instead of announcing the spell and crashing when the
        // additional-cost picker finds no candidate. Four Forests cover the
        // {2}{G}{G} mana cost so mana affordability isn't what's gating the
        // cast; only the unpayable sacrifice should. Put a green creature
        // (e.g. Grizzly Bears) into play via the board to flip the scenario
        // to the payable path and confirm Cast becomes legal + the
        // sacrifice picker opens end to end.
        label: "Unpayable additional-cost sacrifice: Natural Order, no green creature (#944)",
        cards: [
            { name: "Natural Order", owner: "me", zone: "hand" },
            { name: "Forest", owner: "me", zone: "battlefield", count: 4 },
            { name: "Grizzly Bears", owner: "me", zone: "library" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Look-at-top-N library dialog (CR 401.4 / 701.42, issue #942): both
        // "look at the top N of your library and pick among ONLY those N" cards
        // in hand. Cast Stock Up ({2}{U}) — the dialog reveals EXACTLY the top
        // five (not the whole library); keep two, the rest go to the bottom.
        // Cast Preordain ({U}) — the scry dialog reveals EXACTLY the top two
        // (previously it rendered nothing); put any number on the bottom, then
        // draw. Three Islands cover both costs; the seeded library cards give
        // the peek recognizable contents.
        label: "Look-at-top-N library dialog: Stock Up (5) + Preordain (scry 2) (#942)",
        cards: [
            { name: "Stock Up", owner: "me", zone: "hand" },
            { name: "Preordain", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 3 },
            { name: "Black Lotus", owner: "me", zone: "library" },
            { name: "Grizzly Bears", owner: "me", zone: "library" },
            { name: "Ancestral Recall", owner: "me", zone: "library" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // May-pay sacrifice VICTIM CHOICE (CR 701.16b, issue #940): Witherbloom
        // Charm's first mode is "You may sacrifice a permanent. If you do, draw
        // two cards." With MULTIPLE sacrificeable permanents (two Grizzly Bears)
        // the payer must CHOOSE which one dies — previously the engine auto-
        // picked one arbitrarily. Cast the Charm ({B}{G} — a Swamp + Forest are
        // in play), choose mode 1, then click the Bears you want to sacrifice
        // before pressing Pay; only that one leaves and you draw two. A third
        // permanent (Black Lotus) widens the choice set.
        label: "May-pay sacrifice: choose which permanent (Witherbloom Charm) (#940)",
        cards: [
            { name: "Witherbloom Charm", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Black Lotus", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Urborg unified mana-tap options (CR 605.1a / 305.6): Urborg makes
        // every land a Swamp IN ADDITION to its own types, so each land's
        // {T}: Add {B} STACKS with its other abilities as a separate choice.
        // Tap the Mountain → pick {R} or {B}. Tap City of Traitors → pick
        // {C}{C} or {B} (its own ability is kept, not shadowed). Tap Tropical
        // Island → pick {G}, {U}, or {B}. Without Urborg the same lands offer
        // only their printed options — this exercises the multi-option picker.
        label: "Urborg: every land taps for its colour OR {B} (City of Traitors keeps {C}{C})",
        cards: [
            {
                name: "Urborg, Tomb of Yawgmoth",
                owner: "me",
                zone: "battlefield",
            },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "City of Traitors", owner: "me", zone: "battlefield" },
            { name: "Tropical Island", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Lifelink (CR 702.15b / CR 119.3, issue #936): Griselbrand (7/7 flying,
        // lifelink) is in play on my side, ready to attack. Move to combat,
        // declare it as an attacker, and let combat damage resolve — the
        // opponent takes 7 AND my life total rises by 7 in the same combat
        // damage step. A Grizzly Bears sits opposite so the alternative
        // "block it" line (lifelink still gains 7 for damage dealt to the
        // blocker) can be exercised too.
        label: "Lifelink life gain on combat damage (Griselbrand attacking) (#936)",
        cards: [
            { name: "Griselbrand", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "BEGINNING_OF_COMBAT",
        landCount: 8,
    },
    {
        // Deathtouch (CR 702.2b / CR 704.5h, issue #957): Baleful Strix (1/1
        // flying, deathtouch) faces a fat Serra Angel (4/4 flying). Move to
        // combat and let them trade blows — the 1 point of deathtouch damage
        // destroys the Serra Angel regardless of its 4 toughness, while the
        // Strix dies to the Angel's 4 normal damage. Swap the blocker for an
        // indestructible/regenerating creature to see deathtouch respect those.
        label: "Deathtouch: Baleful Strix kills a bigger creature (#957)",
        cards: [
            { name: "Baleful Strix", owner: "me", zone: "battlefield" },
            { name: "Serra Angel", owner: "opp", zone: "battlefield" },
        ],
        phase: "BEGINNING_OF_COMBAT",
        landCount: 6,
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
            { name: "Copy Artifact", owner: "me", zone: "hand" },
            { name: "Clone", owner: "me", zone: "hand" },
            { name: "Ankh of Mishra", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 8,
    },
    {
        // Shock-land land-entry pay-choice (CR 614.12, ADR 0051): the RAV/GPT/
        // DIS "shock land" cycle. Play Steam Vents from hand — a "Pay 2 life"
        // prompt appears (a stackless land-entry choice). Pay to enter untapped
        // (−2 life) or Skip to enter tapped. Blood Crypt is a second copy to try
        // both branches. At 20 life both options are open; the golden path is
        // paying for immediate untapped mana.
        label: "Shock land pay-2-life-or-tapped (Steam Vents / Blood Crypt) (ADR 0051)",
        cards: [
            { name: "Steam Vents", owner: "me", zone: "hand" },
            { name: "Blood Crypt", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Shock land entering via an EFFECT, not played from hand (CR 614.12 —
        // "as it enters" applies at EVERY entry, ADR 0051 amendment). Steam Vents
        // sits in the library; Polluted Delta is in play. Activate the Delta
        // ({T}, pay 1 life, sacrifice; search Island/Swamp), fetch Steam Vents,
        // and it is put onto the battlefield — the SAME "Pay 2 life or enter
        // tapped" prompt now appears on the fetched land (previously it entered
        // untapped for FREE, skipping the choice). Pay to enter untapped (−2
        // more life) or Skip to enter tapped. `libraryCount` is intentionally
        // unset so the seeded Steam Vents survives in the library.
        label: "Shock land FETCHED onto battlefield — pay-choice on effect entry (Polluted Delta → Steam Vents) (ADR 0051)",
        cards: [
            { name: "Polluted Delta", owner: "me", zone: "battlefield" },
            { name: "Steam Vents", owner: "me", zone: "library" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Irreversible tap-for-mana untap-toggle block (issue #793, CR 603.3):
        // City of Brass has a "Whenever ~ becomes tapped, it deals 1 damage to
        // you" triggered ability. Tap it for mana while holding priority — the
        // trigger goes on the stack and (after it resolves) you lose 1 life.
        // Now try the untap-toggle on it: it is REJECTED ("tap trigger already
        // on the stack") because a resolved triggered ability can't be undone;
        // the source stays tapped and the mana stays floated. Contrast the
        // plain Forest next to it: tapping it for mana can still be undone
        // (mana refunded, land untapped) — no becomes-tapped trigger, no block.
        label: "Untap-toggle blocked after tap trigger (City of Brass) (#793)",
        cards: [
            { name: "City of Brass", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // ICE per-attacker sacrifice-a-land attack tax (issue #733): Flooded
        // Woodlands taxes GREEN creatures — declaring your Grizzly Bears (green)
        // as an attacker forces you to sacrifice one land per attacking green
        // creature as attackers are declared (CR 508.1c/1g). Two green Bears +
        // extra lands so the tax has targets and scales with attacker count;
        // move to combat and declare attackers to watch the lands go. (Swap in
        // Reclamation for the black-creature twin.)
        label: "ICE attack-sacrifice tax (Flooded Woodlands / green creatures) (#733)",
        cards: [
            { name: "Flooded Woodlands", owner: "me", zone: "battlefield" },
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
    {
        // ICE forced-attack requirement (issue #738): Arcum's Whistle ({3},{T})
        // targets a non-Wall creature the active player controls. Its
        // controller may pay {X} (X = the creature's mana value); if they
        // decline, the creature must attack this turn if able and is destroyed
        // at the next end step if it didn't. Activate before attackers are
        // declared. Grizzly Bears is a ready target you control; 4 lands cover
        // the {3} activation cost. Move to combat and activate the Whistle.
        label: "ICE forced-attack (Arcum's Whistle) (#738)",
        cards: [
            { name: "Arcum's Whistle", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
    {
        // ICE attacker-side blocker reassignment (issue #739): General Jarkeld
        // ({T}, declare-blockers only) chooses two blocked attacking creatures
        // and, if each could be blocked by all the other's blockers, moves each
        // blocker blocking exactly one of them onto the other attacker (CR
        // 509.1). Solo flow: with the opponent, attack with both opposing
        // Balduvian Bears; with you (defender), block one Bear with each of your
        // Balduvian Bears; then in the declare-blockers step activate Jarkeld
        // targeting the two attackers to swap the blockers. Jarkeld is untapped
        // and not summoning-sick so its {T} is available.
        label: "ICE reassign blockers (General Jarkeld) (#739)",
        cards: [
            { name: "General Jarkeld", owner: "me", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "me", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "me", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
            { name: "Balduvian Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
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
        // ICE static per-pip non-mana additional cost (issue #907): Drought
        // imposes "Sacrifice a Swamp" per BLACK mana symbol on every spell and
        // activated ability (CR 601.2f / 118.5). Cast Hypnotic Specter
        // ({1}{B}{B}, two black pips) from hand — you must sacrifice two of your
        // Swamps to pay, and the cast is illegal if you control too few. Four
        // Swamps let the tax bite twice with one to spare; extra basics cover
        // the {1}. (Drought's own upkeep "sacrifice unless you pay {W}{W}" tax
        // fires on your next upkeep.)
        label: "ICE static per-pip additional cost (Drought) (#907)",
        cards: [
            { name: "Drought", owner: "me", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 4 },
            { name: "Hypnotic Specter", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
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
            { name: "Island", owner: "me", zone: "battlefield", count: 1 },
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
        // Gain-control-until-EOT rider (issue #730): Ray of Command steals an
        // opponent's creature until end of turn (it untaps, gains haste so it
        // can attack this turn, and taps when control reverts at cleanup).
        // Magus of the Unseen does the same for an opponent's artifact via a
        // repeatable {1}{U},{T} ability. Islands cover the {U}/{3}{U} costs.
        label: "ICE steal-until-EOT (Ray of Command / Magus of the Unseen) (#730)",
        cards: [
            { name: "Ray of Command", owner: "me", zone: "hand" },
            { name: "Magus of the Unseen", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            { name: "Icy Manipulator", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
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
        // Effect Script tracer bullet (ADR 0045, issue #800): Lava Spike is
        // the first DSL-only card — cast it at a player to exercise the
        // effects[] interpreter end-to-end. Two copies in hand + one for the
        // opponent so both seats can fire the script; 2 lands cover the {R}.
        label: "Lava Spike — Effect Script DSL (#800)",
        cards: [
            { name: "Lava Spike", owner: "me", zone: "hand", count: 2 },
            { name: "Lava Spike", owner: "opp", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Effect Script bind + ref (ADR 0045, issue #802): Swords to Plowshares
        // is the first DSL card using bind-on-Op + ref-on-bound-object — `exile`
        // snapshots the creature's power/controller, then `gainLife` reads that
        // snapshot after the creature has changed zone (CR 608.2h). Cast it at
        // the opponent's Serra Angel: the Angel is exiled and its controller
        // gains 4 life. One {W} land covers the cost.
        label: "Swords to Plowshares — bind + ref DSL (#802)",
        cards: [
            { name: "Swords to Plowshares", owner: "me", zone: "hand" },
            { name: "Serra Angel", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 1,
    },
    {
        // Effect Script at an ACTIVATED-ability site (ADR 0045, issue #803):
        // Prodigal Pyromancer's "{T}: deal 1 damage to any target" is a
        // DSL-only ability resolved by the same interpreter as spell scripts.
        // It enters already un-sick so you can tap it this turn — activate,
        // target the opponent, and watch the scripted `dealDamage` fire from
        // the stack.
        label: "Prodigal Pyromancer — Effect Script activated ability (#803)",
        cards: [
            {
                name: "Prodigal Pyromancer",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Effect Script at a TRIGGERED-ability site (ADR 0045, issue #803):
        // Honden of Seeing Winds' upkeep trigger "draw a card for each Shrine
        // you control" is a DSL-only script (a battlefield `count` feeding the
        // `draw` Op). Two Hondens on the battlefield + a stocked library — pass
        // priority through to your NEXT upkeep and the trigger fires, drawing 2
        // via the interpreter. Start in the main phase (the scenario seeder sets
        // the phase directly and does not re-scan phase-begin triggers, so the
        // trigger fires on the next natural upkeep transition, not on load).
        label: "Honden of Seeing Winds — Effect Script triggered ability (#803)",
        cards: [
            {
                name: "Honden of Seeing Winds",
                owner: "me",
                zone: "battlefield",
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 10,
        turn: 2,
    },
    {
        // Effect Script choice Op — interpreter suspension/resume (ADR 0045,
        // issue #805): Mind Rot ("Target player discards two cards") is the
        // first DSL card with a MID-RESOLUTION choice. Cast it at the
        // opponent: the script suspends on a `discard-hand` Pending Choice
        // rendered by the existing generic prompt, the opponent picks two of
        // their three cards, and the script resumes to discard them. Three
        // lands cover the {2}{B}.
        label: "Mind Rot — Effect Script choice Op (#805)",
        cards: [
            { name: "Mind Rot", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 3 },
            { name: "Grizzly Bears", owner: "opp", zone: "hand", count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Effect Script `if` construct — the unless-pays pattern (ADR 0045,
        // issue #806): Force Spike ("Counter target spell unless its controller
        // pays {1}") is DSL-only — a `mayPay` Op offers the spell's controller
        // the {1} and binds the outcome, and the `if` construct fires the
        // `counter` consequence only when the payment went unpaid. To exercise
        // it end-to-end: let the opponent cast their Lightning Bolt (it goes on
        // the stack), respond with Force Spike targeting it, then the opponent
        // sees the generic Pay/Skip prompt — decline and the Bolt is countered,
        // pay {1} and it resolves. One Island covers Force Spike's {U}; the
        // opponent's Mountains cover the Bolt and the {1}.
        label: "Force Spike — Effect Script if / unless-pays (#806)",
        cards: [
            { name: "Force Spike", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            { name: "Mountain", owner: "opp", zone: "battlefield", count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Effect Script forEach construct — permanents sweep (ADR 0045,
        // issue #807): Day of Judgment ("Destroy all creatures") is the
        // first DSL card iterating a frozen permanent set (CR 608.2i) and
        // destroying each member via the `$each` object ref. Cast it and
        // creatures on BOTH sides die — including your own Grizzly Bears —
        // while lands survive the filter. Four Plains cover the {2}{W}{W}.
        label: "Day of Judgment — Effect Script forEach sweep (#807)",
        cards: [
            { name: "Day of Judgment", owner: "me", zone: "hand" },
            { name: "Plains", owner: "me", zone: "battlefield", count: 4 },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "War Mammoth", owner: "opp", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Effect Script forEach + choice composition — APNAP player
        // iteration (ADR 0045, issue #807): Innocent Blood ("Each player
        // sacrifices a creature of their choice") is the first DSL card
        // suspending PER ITERATION: the active player picks a creature to
        // sacrifice first (CR 101.4), the script resumes, then the opponent
        // picks. Both seats have two creatures so each pick is a real
        // decision; one Swamp covers the {B}.
        label: "Innocent Blood — forEach + APNAP choice (#807)",
        cards: [
            { name: "Innocent Blood", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                count: 2,
            },
            {
                name: "Grizzly Bears",
                owner: "opp",
                zone: "battlefield",
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
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
        // Cube FREE: evasion / protection statics (issue #684). Moonshadow
        // (menace, CR 702.111b) is seeded with its six -1/-1 counters —
        // effective 1/1, needing TWO blockers to be legally blocked at all;
        // the lone opposing Grizzly Bears can't block it alone. Mother of
        // Runes sits untapped, ready to activate "{T}: Target creature you
        // control gains protection from the color of your choice until end
        // of turn" (CR 702.16 protection, CR 700.2 modal color choice) on
        // either creature before you commit to combat. Move to the beginning
        // of combat, activate Mother of Runes choosing a color, then declare
        // Moonshadow as an attacker to see it go unblocked.
        label: "Evasion/protection statics: Moonshadow menace + Mother of Runes (#684)",
        cards: [
            {
                name: "Moonshadow",
                owner: "me",
                zone: "battlefield",
                counters: { "-1/-1": 6 },
            },
            { name: "Mother of Runes", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "BEGINNING_OF_COMBAT",
        landCount: 3,
    },
    {
        // Haste bypasses summoning sickness as an attacker (CR 702.10b,
        // issue #937): Headliner Scarlett (3/3 Haste) just entered this turn
        // but must still be clickable/selectable as an attacker. Grizzly
        // Bears entered this turn WITHOUT haste and must stay grayed out for
        // contrast. Move to DECLARE_ATTACKERS and confirm only Scarlett is
        // selectable.
        label: "Haste bypasses summoning sickness as attacker: Headliner Scarlett (#937)",
        cards: [
            {
                name: "Headliner Scarlett",
                owner: "me",
                zone: "battlefield",
                summoningSick: true,
            },
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                summoningSick: true,
            },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "BEGINNING_OF_COMBAT",
        landCount: 4,
    },
    {
        // Filtered library-search allow-list UI (issue #933): Polluted Delta's
        // "Search your library for an Island or Swamp card" carries a
        // `candidateIds` allow-list. Before the fix, EVERY revealed library
        // card drew the amber selectable ring; only the Island is actually
        // pickable here. Activate the Delta ({T}, pay 1 life, sacrifice) — the
        // picker should ring/enable only the Island and render the Mountain
        // and Forest dimmed and inert. `libraryCount` is intentionally unset
        // so the three named library cards (pushed to the top) survive.
        label: "Filtered library search — ring gated to eligible cards (Polluted Delta) (#933)",
        cards: [
            { name: "Polluted Delta", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "library" },
            { name: "Mountain", owner: "me", zone: "library" },
            { name: "Island", owner: "me", zone: "library" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Mishra's Bauble persistent look + delayed-trigger stack render
        // (issue #935, CR 701.18a / 603.7d). Activate Mishra's Bauble
        // targeting "opp": {T}, sacrifice it to look at the top card of
        // opp's library (a Forest) — it stays revealed in your view of
        // opp's library pile until it changes zones or the library is
        // shuffled — and schedule "draw a card at the beginning of the
        // next turn's upkeep". Pass through to the opponent's next upkeep
        // to see the delayed trigger go on the stack as an ability tile
        // showing its oracle text, not the Bauble's card art.
        label: "Mishra's Bauble persistent look + delayed-trigger tile (#935)",
        cards: [
            { name: "Mishra's Bauble", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "opp", zone: "library" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
        turn: 2,
    },
    {
        // Sacrifice-only activation cost must NOT surface the mana auto-tap
        // dialog (#939). Goblin Bombardment's only activation cost is
        // "Sacrifice a creature" — no mana component at all. Activate it,
        // pick any target (e.g. the opponent), then confirm: the banner shows
        // NO "Auto-tap" button (its subtitle instead reads "sacrifice a
        // creature"), and Grizzly Bears is highlighted/clickable on the
        // battlefield to pay the cost directly. Clicking it pays the cost and
        // the 1-damage ability resolves.
        label: "Sacrifice-only activation cost — no mana auto-tap dialog (Goblin Bombardment) (#939)",
        cards: [
            { name: "Goblin Bombardment", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
];

type DebugPanelProps = {
    gameId: Id<"games">;
    showAllCards: boolean;
    onToggleShowAllCards: () => void;
    debugAllActions: boolean;
    onToggleDebugAllActions: () => void;
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
};

export default function DebugPanel({
    gameId,
    showAllCards,
    onToggleShowAllCards,
    debugAllActions,
    onToggleDebugAllActions,
    onSwitchGame,
}: DebugPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [showScenarios, setShowScenarios] = useState(false);
    const [scenarioFilter, setScenarioFilter] = useState("");
    const [verbose, setVerbose] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const pageVisible = usePageVisible();

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (
                panelRef.current &&
                !panelRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () =>
            document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen]);
    const state = useQuery(
        api.game.getFullState,
        isOpen && pageVisible ? { gameId } : "skip"
    );

    const prevStateRef = useRef<typeof state>(undefined);
    useEffect(() => {
        if (!verbose || !state) return;
        const prev = prevStateRef.current;
        prevStateRef.current = state;
        if (!prev) {
            console.log("[GRE:verbose] initial state", state);
            return;
        }
        const delta: Record<string, unknown> = {};
        if (prev.phase !== state.phase)
            delta.phase = `${prev.phase} → ${state.phase}`;
        if (prev.turn !== state.turn)
            delta.turn = `${prev.turn} → ${state.turn}`;
        if (prev.activePlayerId !== state.activePlayerId)
            delta.activePlayer = state.activePlayerId;
        if (prev.priorityPlayerId !== state.priorityPlayerId)
            delta.priority = state.priorityPlayerId;
        if (
            JSON.stringify(prev.pendingChoices) !==
            JSON.stringify(state.pendingChoices)
        )
            delta.pendingChoices = state.pendingChoices;
        if (
            JSON.stringify(prev.pendingUntapStep) !==
            JSON.stringify(state.pendingUntapStep)
        )
            delta.pendingUntapStep = state.pendingUntapStep;
        if (JSON.stringify(prev.stack) !== JSON.stringify(state.stack))
            delta.stack = state.stack;
        if (Object.keys(delta).length > 0)
            console.log("[GRE:verbose] state changed", delta);
    }, [verbose, state]);
    const game = useQuery(
        api.game.getGame,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const resetGame = useMutation(api.game.debugResetGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const bo3Sideboard = useMutation(api.game.debugBo3Sideboard);
    const [bo3Pending, setBo3Pending] = useState(false);
    const user = useCurrentUser();

    // One-click Bo3 between-Games flow (PRD #387 user story 35 / #397). Promotes
    // the current solo Match to Bo3, records a Game-1 result, and routes to the
    // Sideboarding step so the whole between-Games flow is exercisable at once.
    const handleBo3Sideboard = async () => {
        if (bo3Pending) return;
        setBo3Pending(true);
        try {
            await bo3Sideboard({ gameId });
        } finally {
            setBo3Pending(false);
        }
    };

    const handleNewSolo = async () => {
        // Reuse the deck of the first player in the current game so the user
        // doesn't have to round-trip through the lobby just to restart.
        const sourceDeck = game?.players[0]?.deck;
        if (!sourceDeck) return;
        if (!user) return;
        const p1Id = `${user._id}-p1`;
        const newId = await createSoloGame({
            name: `${user.nickname}'s solo game`,
            deck: sourceDeck,
        });
        storeSession(newId, p1Id);
        onSwitchGame(newId, p1Id);
    };

    const handleNewVsAi = async () => {
        // One-click vs-AI game reusing the current first player's deck (ADR 0001,
        // issue #109). The human plays the `-p1` seat; the bot drives `-p2`.
        const sourceDeck = game?.players[0]?.deck;
        if (!sourceDeck) return;
        if (!user) return;
        const p1Id = `${user._id}-p1`;
        const newId = await createSoloGame({
            name: `${user.nickname} vs AI`,
            deck: sourceDeck,
            vsAi: true,
        });
        storeSession(newId, p1Id);
        onSwitchGame(newId, p1Id);
    };

    return (
        <div
            ref={panelRef}
            className="fixed bottom-4 left-3 z-100 font-mono text-xs"
        >
            <div className="flex max-h-[calc(100vh-2rem)] flex-col overflow-y-auto rounded-lg border border-white/10 bg-black/90 shadow-2xl backdrop-blur">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex w-full items-center justify-between px-3 py-2 text-white/70 hover:text-white"
                >
                    <span className="font-semibold">Debug</span>
                    <span>{isOpen ? "\u25B2" : "\u25BC"}</span>
                </button>

                {isOpen && (
                    <div className="border-t border-white/10">
                        <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-white/10">
                            <DebugButton onClick={onToggleShowAllCards}>
                                {showAllCards ? "Hide cards" : "Show all cards"}
                            </DebugButton>
                            <DebugButton onClick={onToggleDebugAllActions}>
                                {debugAllActions ? "Rules on" : "All actions"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => setShowScenarios(!showScenarios)}
                            >
                                Scenarios
                            </DebugButton>
                            <DebugButton
                                onClick={() => resetGame({ gameId })}
                                variant="danger"
                            >
                                Reset Game
                            </DebugButton>
                            <DebugButton onClick={handleNewSolo}>
                                {game?.solo && !game?.vsAi
                                    ? "Restart Solo"
                                    : "New Solo Game"}
                            </DebugButton>
                            <DebugButton onClick={handleNewVsAi}>
                                {game?.vsAi
                                    ? "Restart vs AI"
                                    : "New vs-AI Game"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => void handleBo3Sideboard()}
                                disabled={bo3Pending}
                            >
                                {bo3Pending ? "Bo3…" : "Bo3 Sideboarding"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => {
                                    if (state) {
                                        copyMinified(state);
                                        setCopyFeedback(true);
                                        setTimeout(
                                            () => setCopyFeedback(false),
                                            1500
                                        );
                                    }
                                }}
                            >
                                {copyFeedback ? "Copied!" : "Copy State"}
                            </DebugButton>
                            <DebugButton onClick={() => setVerbose((v) => !v)}>
                                {verbose ? "Verbose ON" : "Verbose"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => {
                                    localStorage.clear();
                                    sessionStorage.clear();
                                    window.location.reload();
                                }}
                                variant="danger"
                            >
                                Clear Storage
                            </DebugButton>
                        </div>

                        {showScenarios && (
                            <div className="px-3 py-2 border-b border-white/10 flex flex-col gap-1">
                                <span className="text-white/40 text-[10px] uppercase tracking-wide">
                                    Load scenario
                                </span>
                                <input
                                    type="text"
                                    value={scenarioFilter}
                                    onChange={(e) =>
                                        setScenarioFilter(e.target.value)
                                    }
                                    placeholder="Search scenarios…"
                                    className="w-full px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40"
                                    autoFocus
                                />
                                <div className="max-h-62.5 overflow-y-auto flex flex-col gap-1">
                                    {PRESET_SCENARIOS.filter((s) =>
                                        s.label
                                            .toLowerCase()
                                            .includes(
                                                scenarioFilter.toLowerCase()
                                            )
                                    ).map((scenario) => (
                                        <DebugButton
                                            key={scenario.label}
                                            onClick={() =>
                                                setupScenario({
                                                    gameId,
                                                    cards: scenario.cards,
                                                    phase: scenario.phase,
                                                    landCount:
                                                        scenario.landCount,
                                                    libraryCount:
                                                        scenario.libraryCount,
                                                    markLastDrawn:
                                                        scenario.markLastDrawn,
                                                    turn: scenario.turn,
                                                    rngSeed: scenario.rngSeed,
                                                    poison: scenario.poison,
                                                })
                                            }
                                        >
                                            {scenario.label}
                                        </DebugButton>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="max-h-[70vh] w-100 overflow-auto px-2 py-1">
                            {state ? (
                                <JSONTree
                                    data={state}
                                    theme={theme}
                                    invertTheme={false}
                                    shouldExpandNodeInitially={(
                                        _keyPath,
                                        _data,
                                        level
                                    ) => level < 2}
                                />
                            ) : (
                                <span className="text-white/40">
                                    Loading...
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
