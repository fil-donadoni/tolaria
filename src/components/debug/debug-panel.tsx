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
        zone?: "hand" | "battlefield" | "graveyard" | "exile";
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
        // ICE painland cycle (#662, PRD #628). Exercises the coloured-tap
        // self-damage rider on all five painlands end to end:
        //   - Each painland has TWO mana options when tapped: {C} (painless) and
        //     its two colours. Tap one for {C} → life unchanged. Tap for a
        //     colour → you take 1 damage (watch your life total drop by 1).
        //   - Repeat across Adarkar Wastes (WU), Brushland (GW), Karplusan
        //     Forest (RG), Sulfurous Springs (BR), Underground River (UB).
        // Start at 20 life so the pings are easy to read; turn 2 so all the
        // lands are untapped and free of summoning concerns.
        label: "ICE: Painland cycle — coloured tap pings you for 1, {C} is painless (#662)",
        cards: [
            {
                name: "Adarkar Wastes",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Brushland",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Karplusan Forest",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Sulfurous Springs",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Underground River",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
        turn: 2,
    },
    {
        // ICE snow supertype + snow-matters cluster (#661, PRD #628). Exercises
        // the Snow supertype on the five snow-covered basics and the
        // snow-matters reads end to end:
        //   - Snow-Covered Forest / Mountain / Swamp on your battlefield are
        //     snow lands (CR 205.4a).
        //   - Drift of the Dead (battlefield): its P/T equals the number of snow
        //     lands you control — watch it grow/shrink as snow lands enter/leave.
        //   - Cast Melting (hand) → "All lands are no longer snow": Drift drops to
        //     0/0 (dies), snow landwalk stops evading, snow gates turn off.
        //   - Activate Arcum's Weathervane (battlefield): un-snow a snow land or
        //     make a basic land snow — Drift's P/T tracks the change.
        //   - Cast Avalanche (hand) targeting your snow lands (only snow lands
        //     are legal targets).
        //   - Gangrenous Zombies (battlefield): {T}, Sacrifice → 1 damage to all
        //     (2 if you control a snow Swamp).
        //   - Legions of Lim-Dûl (battlefield): snow swampwalk — unblockable while
        //     the opponent controls a snow Swamp.
        label: "ICE: Snow supertype + snow-matters — Drift / Melting / Weathervane / Avalanche / Gangrenous (#661)",
        cards: [
            {
                name: "Snow-Covered Forest",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Snow-Covered Mountain",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Snow-Covered Swamp",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Drift of the Dead",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Gangrenous Zombies",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Legions of Lim-Dûl",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Arcum's Weathervane",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Melting", owner: "me" as const, zone: "hand" as const },
            { name: "Avalanche", owner: "me" as const, zone: "hand" as const },
            {
                name: "Snow-Covered Swamp",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
        turn: 2,
    },
    {
        // ICE next-upkeep delayed-trigger cantrips (#660, PRD #628). Exercises
        // the "draw a card at the beginning of the next turn's upkeep" rider on
        // the new `next-upkeep` delayed-trigger timing:
        //   - Cast Blessed Wine (gain 1 life), Flare (1 damage to any target),
        //     or Touch of Death from hand. Each schedules a delayed draw.
        //   - Pass to the next upkeep — the delayed trigger fires and you draw.
        //     It fires at the VERY NEXT upkeep regardless of whose turn, and
        //     exactly once.
        //   - Pyknite (battlefield is fine too): its self-ETB arms the same
        //     cantrip; recast from hand to watch the ETB schedule the draw.
        // Turn 2 so the draw step isn't skipped and a real library exists.
        label: "ICE: next-upkeep cantrips — Blessed Wine / Flare / Touch of Death / Pyknite (#660)",
        cards: [
            {
                name: "Blessed Wine",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Flare", owner: "me" as const, zone: "hand" as const },
            {
                name: "Touch of Death",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Pyknite", owner: "me" as const, zone: "hand" as const },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
        turn: 2,
        libraryCount: 12,
    },
    {
        // ICE Gold / miscellaneous completion (#659, PRD #628). Exercises the
        // buildable-now gold/misc cards end to end:
        //   - Merieke Ri Berit ({W}{U}{B}, untapped): {T} to gain control of the
        //     opponent's Bears; she "doesn't untap", so killing her (or force-
        //     untapping) destroys the stolen Bears (no regen).
        //   - Mountain Titan: {1}{R}{R} arms the until-EOT black-cast watcher,
        //     then cast Dark Ritual to drop a +1/+1 counter on it.
        //   - Monsoon: pass into the opponent's end step — their untapped Islands
        //     tap and Monsoon deals that much damage to them.
        //   - Earthlink: kill any creature to watch its controller sacrifice a
        //     land of their choice (and an upkeep "pay {2} or sacrifice").
        //   - Hymn of Rebirth (hand): reanimate the Bears in the opponent's
        //     graveyard UNDER YOUR control.
        //   - Kjeldoran Frostbeast: block/attack with it, then at end of combat
        //     it destroys whatever it fought.
        label: "ICE: Gold/misc — Merieke / Mountain Titan / Monsoon / Earthlink / Hymn / Frostbeast (#659)",
        cards: [
            {
                name: "Merieke Ri Berit",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Mountain Titan",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Monsoon",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Earthlink",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Kjeldoran Frostbeast",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Hymn of Rebirth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Island",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 3,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE White free tranche (#630, PRD #628). Exercises the White ICE
        // staples end to end:
        //   - Swords to Plowshares ({W}) exiles a creature, its controller
        //     gains life equal to its power.
        //   - Disenchant ({1}{W}) destroys a target artifact/enchantment.
        //   - Blinking Spirit ({0}: bounce) dodges removal.
        //   - Lost Order of Jarkeld's CDA P/T tracks the opponent's creature
        //     count (it enters choosing the opponent automatically in a duel).
        //   - Kjeldoran Skyknight (flying/first strike/banding) attacks.
        label: "ICE: White free tranche — STP / Disenchant / Blinking Spirit / Lost Order (#630)",
        cards: [
            {
                name: "Swords to Plowshares",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Blinking Spirit",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Lost Order of Jarkeld",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Kjeldoran Skyknight",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // ICE Cumulative upkeep cluster (#638, ADR 0042, CR 702.24). Exercises
        // the headline keyword end to end across all four cost types:
        //   - Illusionary Forces (CU {U}) and Polar Kraken (CU—Sacrifice a land)
        //     are pre-seeded with two age counters, so the NEXT upkeep prompts a
        //     ×3 cost (CU {U} → {U}{U}{U}; sacrifice → three lands). Pay or watch
        //     them get sacrificed.
        //   - Illusions of Grandeur shows the ETB +20 life swing and its CU {2}.
        //   - Fyndhorn Pollen's "all creatures get -1/-0" anthem shrinks the
        //     opponent's Bears while it racks up age counters.
        // Pass priority into the next upkeep to watch the age counters accrue
        // and the scaling may-pay (decline to see the sacrifice).
        label: "ICE: Cumulative upkeep — age counters / scaling pay-or-sacrifice (#638)",
        cards: [
            {
                name: "Illusionary Forces",
                owner: "me" as const,
                zone: "battlefield" as const,
                counters: { age: 2 },
            },
            {
                name: "Polar Kraken",
                owner: "me" as const,
                zone: "battlefield" as const,
                tapped: true,
                counters: { age: 2 },
            },
            {
                name: "Illusions of Grandeur",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Fyndhorn Pollen",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Cumulative-upkeep GRANT statics + restricted-CU mana (#639, ADR
        // 0042, CR 611/702.24/106.6). Exercises the grant cluster end to end:
        //   - Breath of Dreams grants "Cumulative upkeep {1}" to every green
        //     creature (its Balduvian Bears + the opponent's) — pass into each
        //     upkeep to watch age counters accrue on the BEARS (the hosts) and a
        //     scaling pay-or-sacrifice land on each controller.
        //   - Dreams of the Dead reanimates the Kjeldoran Warrior in the
        //     graveyard with a granted CU {2} + exile-on-leave (kill it → exile).
        //   - Adarkar Unicorn / Snowfall float CU-restricted mana: tap the
        //     Unicorn (or tap an Island under Snowfall) and spend it ONLY on a
        //     cumulative-upkeep prompt — it can't pay anything else.
        label: "ICE: Cumulative upkeep — grants + restricted-CU mana (#639)",
        cards: [
            {
                name: "Breath of Dreams",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Dreams of the Dead",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Adarkar Unicorn",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Snowfall",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Shaman",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Hallowed Ground",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Kjeldoran Warrior",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Artifacts free tranche (#636, PRD #628). Exercises the colourless
        // artifact staples end to end:
        //   - Icy Manipulator ({1},{T}: tap an artifact/creature/land) taps the
        //     opponent's board.
        //   - Jester's Cap ({2},{T},Sac: exile 3 from a library) strips the
        //     opponent's library.
        //   - Whalebone Glider / War Chariot grant flying / trample.
        //   - Zuran Orb (Sac a land: gain 2 life) and Skull Catapult
        //     (Sac a creature: 2 damage) sacrifice for value.
        //   - Vibrating Sphere's turn-conditional anthem swings the board's P/T.
        label: "ICE: Artifacts free tranche — Icy Manipulator / Jester's Cap / Zuran Orb / Vibrating Sphere (#636)",
        cards: [
            {
                name: "Icy Manipulator",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Jester's Cap",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Whalebone Glider",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "War Chariot",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Skull Catapult",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Zuran Orb",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Vibrating Sphere",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 2,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // ICE Artifacts completion (#658, PRD #628). Exercises the buildable-now
        // Artifact cards the free tranche deferred:
        //   - Talisman cycle (e.g. Hematite Talisman) — cast a matching-colour
        //     spell, optionally pay {3} to untap target permanent.
        //   - Crown of the Ages ({4},{T}: move an Aura) — a creature you control
        //     wears an Aura; another creature is on the board to receive it.
        //   - Pentagram of the Ages ({4},{T}: prevent next damage from a source).
        //   - Time Bomb / Infinite Hourglass — time-counter accrual; the seeded
        //     counters let you detonate / read the anthem immediately.
        //   - Vexing Arcanix ({3},{T}: name + reveal) and Goblin Lyre (sac +
        //     coin flip damage) round out the value engines.
        //   - Walking Wall (Defender + {3} mobilize) and Runed Arch
        //     ({X},{T},Sac: X unblockable) exercise combat overrides.
        //   - Soldevi Golem (does-not-untap + upkeep untap) and Jester's Mask
        //     ({1},{T},Sac: hand shuffle) complete the set.
        label: "ICE: Artifacts completion — Talismans / Crown / Pentagram / Time Bomb / Vexing Arcanix (#658)",
        cards: [
            {
                name: "Hematite Talisman",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Crown of the Ages",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Pentagram of the Ages",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Time Bomb",
                owner: "me" as const,
                zone: "battlefield" as const,
                counters: { time: 3 },
            },
            {
                name: "Infinite Hourglass",
                owner: "me" as const,
                zone: "battlefield" as const,
                counters: { time: 2 },
            },
            {
                name: "Vexing Arcanix",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Goblin Lyre",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Walking Wall",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Soldevi Golem",
                owner: "me" as const,
                zone: "battlefield" as const,
                tapped: true,
            },
            {
                name: "Holy Strength",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 2,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                tapped: true,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Lands free tranche (#637, PRD #628). Exercises the activated land
        // staples end to end:
        //   - Ice Floe ({T}: tap-lock a non-flying attacker) — an opponent's
        //     ground Bear is on the board; advance to combat and attack with it,
        //     then tap Ice Floe to tap-lock it (it stays tapped while Ice Floe
        //     is tapped, CR 611.2).
        //   - The basic-land reprints (Plains/Island/Mountain) come in as the
        //     player's lands so the colour pips are visible.
        // (Painlands, depletion duals, snow basics, and the cumulative-upkeep
        // lands stay deferred to their capability clusters.)
        label: "ICE: Lands free tranche — Ice Floe tap-lock + basic reprints (#637)",
        cards: [
            {
                name: "Ice Floe",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Plains",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Island",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Mountain",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // ICE Blue free tranche (#631, PRD #628). Exercises the Blue ICE
        // staples end to end:
        //   - Zuran Spellcaster ({T}: 1 damage any target) and Storm Spirit
        //     ({T}: 2 damage to a creature) ping the opponent's board.
        //   - Skeleton Ship ({T}: -1/-1 counter) shrinks a creature.
        //   - Iceberg banks colourless mana as ice counters.
        //   - Wings of Aesthir (Aura: +1/+0, flying, first strike) suits up a
        //     creature; Spectral Shield (+0/+2, can't be targeted by spells)
        //     protects one.
        //   - Hydroblast ({U}) and Brainstorm ({U}) round out the spell suite.
        label: "ICE: Blue free tranche — Zuran Spellcaster / Skeleton Ship / Iceberg / Wings of Aesthir (#631)",
        cards: [
            {
                name: "Brainstorm",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Hydroblast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Zuran Spellcaster",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Storm Spirit",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Skeleton Ship",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Iceberg",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Wings of Aesthir",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Spectral Shield",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Silver Erne",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Blue buildable-now completion (#654, PRD #628). Exercises the two
        // Blue cards completed from shipped primitives:
        //   - Krovikan Sorcerer ({T}, discard a nonblack card: draw 1 / {T},
        //     discard a black card: draw 2 then discard 1). The hand seeds a
        //     black card (Dark Ritual) and a nonblack card (Giant Growth) so
        //     both colour-filtered branches are exercisable.
        //   - Shyft (at your upkeep, may become a colour of your choice — an
        //     indefinite layer-5 colour override). Pass to your next upkeep to
        //     hit the trigger, accept, and pick a colour.
        label: "ICE: Blue completion — Krovikan Sorcerer loots / Shyft colour override (#654)",
        cards: [
            {
                name: "Krovikan Sorcerer",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Shyft",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Giant Growth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Brainstorm",
                owner: "me" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
    },
    {
        // ICE Black buildable-now completion (#655, PRD #628). Exercises the
        // Black cards completed from shipped primitives only. The Auras (Mind
        // Whip, Soul Kiss, Dance of the Dead) start in HAND so they attach to a
        // target when cast — a battlefield-seeded Aura would be unattached.
        //   - Lim-Dûl's Hex (your upkeep: each player pays {B} or {3} or takes
        //     1). Pass to your next upkeep to fire it.
        //   - Mind Whip from hand → enchant the opponent's Grizzly Bears
        //     (their upkeep: pay {3} or 2 damage + tap).
        //   - Soul Kiss from hand → enchant your Hill Giant; {B}, Pay 1 life for
        //     +2/+2, hard-capped at three activations per turn.
        //   - Minion of Leshrac (upkeep sac-a-creature-or-5-damage-and-tap;
        //     {T}: destroy a creature/land) and Infernal Denizen ({T}: steal a
        //     creature for as long as it stays out).
        //   - Norritt ({T}: untap a blue creature / force a creature to attack).
        //   - Dance of the Dead from hand reanimates the creature card seeded in
        //     the opponent's graveyard.
        //   - Leshrac's Sigil punishes the opponent casting a green spell.
        label: "ICE: Black completion — Lim-Dûl's Hex / Mind Whip / Soul Kiss / reanimate / steal (#655)",
        cards: [
            {
                name: "Lim-Dûl's Hex",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Minion of Leshrac",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Infernal Denizen",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Norritt",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Leshrac's Sigil",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Hill Giant",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Soul Kiss",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Mind Whip",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Dance of the Dead",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Red completion (#656, PRD #628). Exercises the buildable-now Red
        // ICE cards activated from stale stubs:
        //   - Márton Stromgald (pump other attackers by the attacker count) and
        //     two Aurochs (pump per other attacking Aurochs) — attack to fire
        //     the per-attacker buffs.
        //   - Goblin Mutant (trample; can't attack vs an untapped power-3+
        //     defender; can't block power 3+) and Chaos Lord (7/7 first strike;
        //     even-permanent-count upkeep control-give).
        //   - Mudslide (non-flying untap-lock + pay-{2}-to-untap) and Dwarven
        //     Armory ({2}, sac a land: +2/+2 counter, upkeep-only) enchantments.
        //   - Balduvian Hydra (enters with X +1/+0; remove-counter prevent;
        //     upkeep grow) on the battlefield.
        //   - Battle Frenzy (team pump) and Game of Chaos (coin-flip life swing)
        //     in hand. rngSeed 1 pins the first Game of Chaos flip to a WIN.
        label: "ICE: Red completion — Márton / Aurochs / Chaos Lord / Mudslide / Game of Chaos (#656)",
        cards: [
            {
                name: "Márton Stromgald",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Aurochs",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 2,
            },
            {
                name: "Goblin Mutant",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Chaos Lord",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Hydra",
                owner: "me" as const,
                zone: "battlefield" as const,
                counters: { "+1/+0": 3 },
            },
            {
                name: "Mudslide",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Dwarven Armory",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Battle Frenzy",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Game of Chaos",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
        rngSeed: 1,
    },
    {
        // ICE Black free tranche (#632, PRD #628). Exercises the Black ICE
        // staples end to end:
        //   - Abyssal Specter (flying; deals damage to a player → that player
        //     discards) and Knight of Stromgald (pro-white + {B}/{B}{B} pumps)
        //     attack.
        //   - Hoar Shade ({B}: +1/+1) is a mana sink.
        //   - Dark Banishing ({1}{B}: destroy nonblack creature, no regen) and
        //     Demonic Consultation (name + dig) round out the spells.
        //   - Pestilence Rats' power scales with the other Rats on the board.
        //   - Stromgald Cabal ({T}, pay 1 life: counter white spell) holds up.
        label: "ICE: Black free tranche — Abyssal Specter / Knight of Stromgald / Demonic Consultation / Pestilence Rats (#632)",
        cards: [
            {
                name: "Dark Banishing",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Demonic Consultation",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Abyssal Specter",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Knight of Stromgald",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Hoar Shade",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Pestilence Rats",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 3,
            },
            {
                name: "Stromgald Cabal",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Red free tranche (#633, PRD #628). Exercises the Red ICE burn /
        // creatures end to end:
        //   - Incinerate (3 damage, no-regen) and Pyroclasm (2 to each
        //     creature) are in hand as removal.
        //   - Pyroblast counters / destroys a blue permanent — the opponent's
        //     Sea Spirit is the target.
        //   - Flame Spirit / Wall of Lava are firebreathing mana sinks.
        //   - Karplusan Yeti fights an opposing creature; Orcish Cannoneers
        //     pings for 2 (and 3 to you).
        label: "ICE: Red free tranche — Incinerate / Pyroclasm / Pyroblast / Karplusan Yeti (#633)",
        cards: [
            {
                name: "Incinerate",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Pyroclasm",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Pyroblast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Flame Spirit",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Wall of Lava",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Karplusan Yeti",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Orcish Cannoneers",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Sea Spirit",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Green free tranche (#634, PRD #628). Exercises the Green ICE
        // ramp / combat tricks end to end:
        //   - Lhurgoyf is a */*+1 whose P/T grows with creature cards in all
        //     graveyards (cast removal at the opposing Bears to feed it).
        //   - Giant Growth (+3/+3) and Stampede (attackers +1/+0 + trample) are
        //     combat tricks in hand.
        //   - Fyndhorn Elves / Elder ramp; Tinder Wall walls + sacs for {R}{R}.
        //   - Hurricane in hand sweeps fliers + players for X.
        //   - Woolly Spider (reach) blocks the opponent's flier and grows +0/+2.
        label: "ICE: Green free tranche — Lhurgoyf / Giant Growth / Stampede / Hurricane (#634)",
        cards: [
            {
                name: "Giant Growth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Stampede",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Hurricane",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lhurgoyf",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Fyndhorn Elves",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Fyndhorn Elder",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Tinder Wall",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Woolly Spider",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Scaled Wurm",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Green completion (#657, PRD #628). Exercises the buildable-now
        // Green ICE cards the free tranche under-delivered, end to end:
        //   - Wiitigo (enters with six +1/+1; upkeep growth/shrink) and Dire
        //     Wolves (banding) on the battlefield.
        //   - Gorilla Pack on the battlefield (can't attack unless the defender
        //     controls a Forest; sacs itself with no Forests).
        //   - Folk of the Pines (firebreathing) + Earthlore/Forbidden Lore on a
        //     land for combat pumps; Elder Druid taps/untaps.
        //   - Fanatical Fever / Essence Filter / Thermokarst / Freyalise's Charm
        //     in hand; Blizzard + Thoughtleech enchantments in play.
        //   - Chub Toad blocks for +2/+2; Venomous Breath waits in hand.
        label: "ICE: Green completion — Wiitigo / Gorilla Pack / Venomous Breath / Essence Filter (#657)",
        cards: [
            {
                name: "Fanatical Fever",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Essence Filter",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Thermokarst",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Venomous Breath",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Wiitigo",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Dire Wolves",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Gorilla Pack",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Folk of the Pines",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Chub Toad",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Elder Druid",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Blizzard",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Thoughtleech",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // ICE Multicolour free tranche (#635, PRD #628). Exercises the gold ICE
        // cards expressible with shipped primitives end to end:
        //   - Centaur Archer ({T}: 1 damage to a flyer) on the battlefield;
        //     the opponent's Sibilant Spirit (flying) is its only legal target.
        //   - Giant Trap Door Spider ({1}{R}{G},{T}: exile self + a non-flying
        //     attacker) on the battlefield; declare the opponent's Balduvian
        //     Bears as an attacker to feed it.
        //   - Essence Vortex ({1}{U}{B}: destroy unless controller pays life =
        //     toughness) in hand — aim at the opponent's Bears.
        //   - Altar of Bone ({G}{W}: sac a creature, tutor a creature to hand)
        //     in hand — sacrifice the spare Balduvian Bears, search the library.
        // Five basics (W/U/B/R/G) cover every multi-pip gold cost.
        label: "ICE: Multicolour free tranche — Centaur Archer / Giant Trap Door Spider / Essence Vortex / Altar of Bone (#635)",
        cards: [
            {
                name: "Essence Vortex",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Altar of Bone",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Centaur Archer",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Giant Trap Door Spider",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Forest", owner: "me" as const, count: 2 },
            {
                name: "Sibilant Spirit",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Balduvian Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Word of Command — controlled cast, TARGETED spell branch (#578, PRD
        // #575, ADR 0037, CR 601.2c). The classic line: choose the opponent's
        // Lightning Bolt and aim it back at them.
        //
        // Board: you hold Word of Command ({B}{B}) with two Swamps for the
        // cost. Your opponent holds a castable Lightning Bolt ({R}, "any
        // target") and controls a Mountain so it can be paid for from THEIR
        // land. Golden path:
        //   1. Cast Word of Command targeting your opponent.
        //   2. On resolution you look at their hand and pick Lightning Bolt.
        //   3. You (the Acting Player) choose its target — pick the opponent
        //      themselves. It is cast as THEIR spell (controllerId = opponent),
        //      paid by auto-tapping the opponent's Mountain, and resolves for 3
        //      damage to the opponent.
        // Edges:
        //   - Aim the Bolt at yourself instead → 3 damage to you.
        //   - Remove the opponent's Mountain → the Bolt can't be paid for from
        //     their lands and is not played ("if able").
        label: "2ED: Word of Command — controller aims opponent's Lightning Bolt (#578)",
        cards: [
            {
                name: "Word of Command",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Word of Command — X / modal / additional-cost casts (#579, PRD #575,
        // ADR 0037, CR 107.3 / 700.2c / 117.9). Every cast decision is made by
        // you (the Acting Player) from the OPPONENT's resources.
        //
        // Board: you hold Word of Command ({B}{B}) with two Swamps. Your
        // opponent's hand holds an X spell (Fireball, {X}{R}), a modal spell
        // (Red Elemental Blast — counter/destroy a blue object), and an
        // additional-cost spell (Sacrifice — "sacrifice a creature; add {B}
        // equal to its mana value"). They control two Mountains and a Swamp for
        // mana plus a Grizzly Bears to feed Sacrifice; you control a blue
        // Merfolk for Red Elemental Blast's destroy mode to aim at. Golden path:
        //   1. Cast Word of Command targeting your opponent.
        //   2. Look at their hand and pick a card:
        //      • Fireball → you choose X (only values payable from their two
        //        Mountains are offered) and aim it; X mana is auto-tapped from
        //        THEIR lands.
        //      • Red Elemental Blast → you choose the mode (counter/destroy);
        //        the destroy mode lets you blow up your own Merfolk (a blue
        //        permanent).
        //      • Sacrifice → you choose which of THEIR creatures (Grizzly Bears)
        //        is sacrificed as the additional cost; it resolves adding {B}{B}
        //        to their pool.
        // Edges:
        //   - Remove the opponent's Mountains → Fireball is unpayable even at
        //     X = 0 and is not played ("if able").
        //   - Remove the opponent's Grizzly Bears → Sacrifice's additional cost
        //     is unmeetable and the spell is not played.
        label: "2ED: Word of Command — X / modal / additional-cost cast (#579)",
        cards: [
            {
                name: "Word of Command",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            // A blue permanent for Red Elemental Blast's destroy mode to aim at.
            { name: "Merfolk of the Pearl Trident", owner: "me" as const },
            {
                name: "Fireball",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Red Elemental Blast",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Sacrifice",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 2 },
            { name: "Swamp", owner: "opp" as const },
            // Fodder for Sacrifice's additional cost (a creature to sacrifice).
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Word of Command — control PERSISTS onto the chosen spell's RESOLUTION
        // (#580, PRD #575, ADR 0037, CR 608 — "you control the player while
        // that spell is resolving"). The chosen spell's OWN resolution-time
        // choice is also made by you (the Acting Player), then control reverts
        // when that spell leaves the stack.
        //
        // Board: you hold Word of Command ({B}{B}) with two Swamps. Your
        // opponent holds Demonic Tutor ({1}{B} — "Search your library for a
        // card, put it into your hand") and controls two Swamps to pay for it;
        // their library is stocked so there is something to fetch. Golden path:
        //   1. Cast Word of Command targeting your opponent.
        //   2. Look at their hand and pick Demonic Tutor. It is cast as THEIR
        //      spell (controllerId = opponent), paid from THEIR Swamps.
        //   3. As the Tutor RESOLVES it asks for a search choice — #580 routes
        //      that prompt to YOU (the Acting Player). You browse the OPPONENT's
        //      library and pick the card to put into THEIR hand.
        //   4. Once the Tutor leaves the stack, control reverts: the opponent
        //      makes their own subsequent decisions again.
        // Edge:
        //   - Remove the opponent's Swamps → the Tutor can't be paid for from
        //     their lands and is not played ("if able").
        label: "2ED: Word of Command — control persists onto the chosen spell's resolution (#580)",
        cards: [
            {
                name: "Word of Command",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Demonic Tutor",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        // Stock the opponent's library so the controller has cards to search.
        libraryCount: 10,
    },
    {
        // Word of Command — controlled cast, SPELL branch (#577, PRD #575, ADR
        // 0037, CR 601 / 305.2). You cast Word of Command targeting your
        // opponent, look at their hand, and choose a card for them to play
        // "if able".
        //
        // Board: you hold Word of Command ({B}{B}) with two Swamps for the
        // cost. Your opponent holds a castable Dark Ritual (a no-target spell,
        // {B}) and a Swamp (a land they can play), and controls a Swamp so the
        // Ritual can be paid for from THEIR land. Golden path:
        //   1. Cast Word of Command targeting your opponent.
        //   2. On resolution you look at their hand and pick Dark Ritual.
        //   3. It is cast as THEIR spell (controllerId = opponent), paid by
        //      auto-tapping the opponent's Swamp only; it resolves and fills
        //      the opponent's mana pool with {B}{B}{B}.
        // Edges:
        //   - Pick the opponent's Swamp instead → it is played under the
        //     opponent's control (their land drop). If they already played a
        //     land this turn, it is not played.
        //   - Remove the opponent's battlefield Swamp → Dark Ritual can't be
        //     paid for from their lands and is not played.
        label: "2ED: Word of Command — controlled cast from the opponent's hand (#577)",
        cards: [
            {
                name: "Word of Command",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Dark Ritual",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Swamp",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Word of Command — Acting Player foundation + land branch (#576, ADR
        // 0037, CR 305.2 one land per turn, CR 608.2 resolution).
        //
        // Board: you hold Word of Command ({B}{B} instant) with two Swamps for
        // mana. Your opponent's hand holds a Forest (a land) plus a Grizzly
        // Bears (a non-land). Golden path:
        //   1. Cast Word of Command targeting your opponent (only they are a
        //      legal target — "target opponent").
        //   2. On resolution you look at the opponent's hand and choose a card.
        //   3. Choose the Forest: it is PLAYED under the opponent's control,
        //      consuming their one-land-per-turn drop (CR 305.2).
        // Edge: choose the Grizzly Bears instead — it is cast as the opponent's
        //   spell (#577 spell branch). Or, on a later turn where the opponent
        //   has already played a land, choosing the Forest leaves it in hand
        //   ("if able").
        label: "LEA: Word of Command — controller plays opponent's land (#576)",
        cards: [
            {
                name: "Word of Command",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Forest",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // FEM walking skeleton — Vodalian Soldiers tracer (#567, CR 302 vanilla
        // creature, CR 608.3 resolution). Proves the Fallen Empires set file,
        // registry wiring and multi-art CardPrint plumbing end-to-end: a FEM
        // card is buildable, castable and resolves onto the battlefield.
        //
        // Board: you hold Vodalian Soldiers ({1}{U} 1/2 Merfolk Soldier) in hand
        // with two Islands for the blue mana (`landCount` seeds Plains, so the
        // Islands are placed explicitly). Golden path: cast it, it resolves onto
        // the battlefield as a 1/2. (The other three FEM artworks resolve to the
        // same shared definition — see fem.test.ts multi-art coverage.)
        label: "FEM: Vodalian Soldiers — walking-skeleton tracer (#567)",
        cards: [
            {
                name: "Vodalian Soldiers",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // FEM C1 — Green spore engine + Night Soil exile-from-graveyard cost
        // (#569; CR 122.1/122.6 spore counters, 707.1 tokens, 602.1/118.5/406
        // exile-as-cost).
        //
        // Board: you control a Thallid with two spore counters (one upkeep away
        // from its third) and a Night Soil enchantment. Both graveyards are
        // stocked with creature cards (Grizzly Bears) so Night Soil's "{1},
        // Exile two creature cards from a single graveyard" cost is payable from
        // either pile. Two Forests pay the green/generic costs.
        // Golden path:
        //   1. Pass to your next upkeep — the Thallid accrues its third spore
        //      counter; activate "Remove three spore counters: Create a 1/1
        //      green Saproling" to make a Saproling.
        //   2. Activate Night Soil: pay {1}, then pick a graveyard and exile two
        //      creature cards from it — a second Saproling is created.
        // Edge: empty one graveyard down to a single creature card — Night Soil's
        //   ability is then unpayable from that pile (the whole cost must come
        //   from ONE graveyard, CR 118.5).
        label: "FEM: Thallid spore engine + Night Soil exile-from-graveyard cost (#569)",
        cards: [
            {
                name: "Thallid",
                owner: "me" as const,
                counters: { spore: 2 },
            },
            { name: "Night Soil", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
                count: 3,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "graveyard" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // FEM C3 White — Hand of Justice's `tapOtherFilter` cost (#568, CR
        // 602.1 / 118.8). The {5}{W} 2/6 Avatar's ability is "{T}, Tap three
        // untapped white creatures you control: Destroy target creature."
        //
        // Board: you control Hand of Justice plus three Order of Leitbur
        // ({W}{W} 2/1 white Knights) to feed the tap-three cost, and the
        // opponent controls a Grizzly Bears to destroy. Golden path:
        //   1. Activate Hand of Justice targeting the opponent's Grizzly Bears.
        //   2. Pay the cost: tap Hand of Justice ({T}) and tap the three Orders.
        //   3. The ability resolves and destroys the Grizzly Bears.
        // Edge: tap one Order first (so only two untapped white creatures
        //   remain) — the ability is now unpayable and can't be activated.
        label: "FEM: Hand of Justice — tap three white creatures to destroy (#568)",
        cards: [
            { name: "Hand of Justice", owner: "me" as const },
            { name: "Order of Leitbur", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // FEM C4 Red — Goblin War Drums grants menace; the min-blocker threshold
        // (#570, ADR 0038, CR 509.1b / 702.111a). Menace: a creature with it
        // can't be blocked except by two or more creatures.
        //
        // Board: you control Goblin War Drums (so your creatures have menace)
        // and a Brassclaw Orcs (3/2) ready to attack. The opponent controls a
        // single Grizzly Bears — one would-be blocker. Golden path:
        //   1. Move to combat and attack with Brassclaw Orcs.
        //   2. The opponent tries to block with their lone Grizzly Bears and
        //      confirms — the confirm is REJECTED: a menace attacker can't be
        //      blocked by one creature.
        //   3. The attacker connects for 3.
        // Edge: give the opponent a second creature (drop another Grizzly Bears
        //   onto their board) — now two blockers are legal and the block stands.
        label: "FEM: Goblin War Drums menace — single blocker rejected (#570)",
        cards: [
            { name: "Goblin War Drums", owner: "me" as const },
            { name: "Brassclaw Orcs", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // FEM C2 Blue — the Homarid tide swing (#571, CR 611.2c counter-gated
        // P/T, 603.6a upkeep counter, 603.8 four-or-more shed).
        //
        // Board: you control a Homarid with THREE tide counters — it reads as a
        // 3/3 right now (+1/+1 at exactly three). You hold High Tide and a
        // Seasinger; three Islands feed the blue mana. Golden path / tide cycle:
        //   1. Note the Homarid is 3/3 at three tide counters.
        //   2. Pass to your next upkeep: a fourth tide counter is put on it; the
        //      state-trigger then sheds ALL tide counters (back to 0/0 base, so
        //      it dies to the 0-toughness SBA — the tide low point).
        //   3. (Alternative) Cast High Tide, then tap an Island for mana — you
        //      get {U}{U} (the extra {U} rider) to fuel a blue play.
        // Edge: a Homarid with exactly ONE tide counter is 1/1 (-1/-1); with two
        //   it is a vanilla 2/2 — step the counter map to see each band.
        label: "FEM: Homarid mid-tide swing + High Tide ramp (#571)",
        cards: [
            {
                name: "Homarid",
                owner: "me" as const,
                counters: { tide: 3 },
            },
            { name: "High Tide", owner: "me" as const, zone: "hand" as const },
            { name: "Seasinger", owner: "me" as const, zone: "hand" as const },
            { name: "Island", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // FEM C5 Black — Thrulls & Order of the Ebon Hand (#572). Exercises the
        // sac-self mana ability (Basal Thrull, ADR 0039) and the exile-as-cost
        // extension (Soul Exchange, CR 117.9 / 601.2f / 406).
        //
        // Board: you control a Basal Thrull ({B}{B} 1/2 — "{T}, Sacrifice this:
        // Add {B}{B}") and a fodder Thrull (Armor Thrull) to feed Soul
        // Exchange's exile cost. Your graveyard holds a Grizzly Bears to
        // reanimate. You hold Soul Exchange and Hymn to Tourach; two Swamps pay
        // the black mana. Golden path:
        //   1. Activate Basal Thrull's mana ability — it is SACRIFICED (not
        //      tapped) and adds {B}{B} (no stack — a mana ability).
        //   2. Cast Soul Exchange targeting the Grizzly Bears in your graveyard;
        //      pay the additional cost by EXILING a Thrull you control. The Bears
        //      returns to the battlefield with a +2/+2 counter (the exiled
        //      creature was a Thrull).
        //   3. (Alternative) Cast Hymn to Tourach at the opponent — they discard
        //      two cards at random.
        // Edge: exile a NON-Thrull instead (the reanimated creature gets no
        //   +2/+2 counter).
        label: "FEM: Basal Thrull sac-mana + Soul Exchange reanimation (#572)",
        cards: [
            { name: "Basal Thrull", owner: "me" as const },
            { name: "Armor Thrull", owner: "me" as const },
            {
                name: "Soul Exchange",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Hymn to Tourach",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Equinox — Aura grants the enchanted land a conditional counter (#498,
        // CR 303.4 attachment, 611.2 activated-grant, 701.5a counter, 701.7
        // destroy).
        //
        // Board: you control a Forest (the land to protect) and a couple of
        // Plains to pay {W}. In hand you hold Equinox. Your opponent holds Stone
        // Rain (Destroy target land). `landCount: 2` adds basics for mana.
        // Golden path:
        //   1. Cast Equinox targeting your Forest. The Forest gains
        //      "{T}: Counter target spell if it would destroy a land you
        //      control."
        //   2. Opponent casts Stone Rain targeting your Forest.
        //   3. Tap the Equinox-enchanted Forest, target the Stone Rain on the
        //      stack — it IS clickable (it would destroy your land) and is
        //      countered. Your Forest survives.
        // Edge: have the opponent instead cast Stone Rain at one of your basic
        //   Plains, or hold a Counterspell — the Equinox land's ability still
        //   targets only spells that would destroy a land you control (a Stone
        //   Rain at YOUR land qualifies; a Counterspell does not).
        label: "LEG: Equinox — enchanted land counters a spell that would destroy your land (#498)",
        cards: [
            { name: "Forest", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            {
                name: "Equinox",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Stone Rain",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Remove Enchantments — mass conditional return + destroy (#497, CR
        // 108.3 owner vs 110.2 control, 303.4b attachment, 701.7/701.10).
        //
        // Board: you control a non-Aura enchantment you own (Presence of the
        // Master) and a Grizzly Bears to wear an Aura. Your opponent controls
        // their own enchantment (Spirit Link on their Grizzly Bears, set up by
        // casting it) which is OUT of scope. In hand you hold Spirit Link (an
        // Aura you own) plus Remove Enchantments, with Plains to pay.
        // Golden path:
        //   1. Cast your Spirit Link onto your Grizzly Bears (Aura you own on a
        //      permanent you control).
        //   2. Cast Remove Enchantments. Your Presence of the Master AND your
        //      Spirit Link return to your hand; the opponent's own enchantments
        //      (not in scope) are untouched.
        // Edge: instead attach your Spirit Link to the OPPONENT's Grizzly Bears
        //   (non-attacking) — Remove Enchantments now leaves it alone (an Aura
        //   you own on an opponent's non-attacking creature matches no clause).
        label: "LEG: Remove Enchantments — return owned enchantments/Auras, spare the rest (#497)",
        cards: [
            { name: "Presence of the Master", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            {
                name: "Spirit Link",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Remove Enchantments",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Presence of the Master", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Osai Vultures — end-step carrion-counter death engine (#496, CR 700.4
        // die tally + CR 603.4d intervening-if + CR 122.6 counter-removal pump).
        //
        // Board: your Osai Vultures already carries TWO carrion counters (so the
        // remove-two pump is one-click testable), plus a Grizzly Bears you can
        // kill, and an opponent Lightning Bolt to do the killing. Two Plains pay
        // any white costs. Started in PRECOMBAT_MAIN.
        // Golden path (accrual):
        //   1. Have a creature die this turn (opponent bolts your Grizzly Bears,
        //      or trade in combat). `deathsThisTurn` ticks to 1.
        //   2. Pass to the END_STEP: Osai's intervening-if sees a death and puts
        //      ONE carrion counter on it (now 3) — exactly one regardless of how
        //      many died (printed ruling).
        // Golden path (pump):
        //   3. Activate "Remove two carrion counters: +1/+1 until end of turn".
        //      Osai becomes a 2/2 until cleanup; two carrion counters are spent.
        // Edge: skip the death and pass to END_STEP — no counter is added
        //   (the intervening-if fizzles).
        label: "LEG: Osai Vultures — end-step carrion accrual + remove-two pump (#496)",
        cards: [
            {
                name: "Osai Vultures",
                owner: "me" as const,
                counters: { carrion: 2 },
            },
            { name: "Grizzly Bears", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Auto-Tap self-source deprioritization (issue #544, CR 602.1).
        // Mishra's Factory has both "{T}: Add {C}" and "{1}: becomes a 2/2".
        // Board: one Mishra's Factory + two Mountains, all untapped.
        // Golden path:
        //   1. Activate the Factory's "{1}: animate" ability.
        //   2. Click Auto-Tap on the payment banner.
        //   3. A Mountain pays the {1}; the Factory stays UNTAPPED, so the
        //      freshly-animated 2/2 Assembly-Worker can attack/block.
        // Edge: remove the Mountains (only the Factory left) and Auto-Tap may
        //   tap the Factory itself (strictly necessary), animating it tapped.
        label: "ATQ: Mishra's Factory animate — Auto-Tap spares the manland (#544)",
        cards: [
            { name: "Mishra's Factory", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Summoning sickness on an animated manland (issue #545, CR 302.6).
        // A permanent that becomes a creature is summoning-sick unless it has
        // been controlled continuously since the start of the controller's
        // most recent turn.
        //
        // Board: TWO Mishra's Factories — one that ENTERED this turn
        // (`summoningSick`) and one controlled since a prior turn — plus two
        // Mountains to pay the {1} animate cost. Started in PRECOMBAT_MAIN.
        // Golden path:
        //   1. Animate BOTH Factories ({1} each, paid by the Mountains).
        //   2. Move to combat and declare attackers: only the OLD Factory is a
        //      legal attacker; the freshly-entered one is summoning-sick and
        //      cannot be declared (nor pay its {T} pump).
        // Edge: pass to your next turn — after the untap step both Factories
        //   may attack (the control-continuity flag clears at untap).
        label: "ATQ: Mishra's Factory — animated land is summoning-sick the turn it entered (#545)",
        cards: [
            {
                name: "Mishra's Factory",
                owner: "me" as const,
                summoningSick: true,
            },
            { name: "Mishra's Factory", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Animated manland is an Artifact (issue #547, CR 208.2). Mishra's
        // Factory's "{1}: becomes a 2/2 Assembly-Worker artifact creature ...
        // It's still a land" must grant the Artifact type so "destroy target
        // artifact" effects (Shatter) can hit it.
        //
        // Board: your Mishra's Factory + a Mountain to pay {1}; the opponent
        // holds Shatter and has two Mountains to cast it.
        // Golden path:
        //   1. Animate the Factory ({1}, paid by your Mountain).
        //   2. Pass to the opponent; they cast Shatter targeting the Factory —
        //      the now-Artifact land is a legal target and is destroyed.
        // Edge: don't cast Shatter — the added Artifact/Creature types revert
        //   at end of turn and the permanent is a plain Land again.
        label: "ATQ: animated Mishra's Factory is an Artifact — Shatter can destroy it (#547)",
        cards: [
            { name: "Mishra's Factory", owner: "me" as const },
            { name: "Mountain", owner: "me" as const },
            {
                name: "Shatter",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Recall — {X}{X}{U} sorcery (CR 107.3/701.8/400.7/608.2). "Discard X
        // cards, then return a card from your graveyard to your hand for each
        // card discarded this way. Exile Recall."
        //
        // Board: you hold Recall plus three discardable cards (Lightning Bolt,
        // Grizzly Bears, Hill Giant) and already have a Headless Horseman in
        // your graveyard. Five Islands pay {X}{X}{U} up to X = 2.
        // Golden path:
        //   1. Cast Recall, announce X = 2 (pays four blue + {U}).
        //   2. Discard two chosen cards — they drop into your graveyard.
        //   3. The graveyard picker opens: return up to two cards, including a
        //      just-discarded one (the classic Recall loop). Recall then exiles
        //      itself rather than going to the graveyard (CR 608.2).
        // Edge: announce X = 0 to discard/return nothing while Recall still
        // self-exiles.
        label: "LEG: Recall (discard-X then return-X from graveyard, self-exile)",
        cards: [
            { name: "Recall", owner: "me" as const, zone: "hand" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Hill Giant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Headless Horseman",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            { name: "Island", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Chain Lightning — {R} sorcery (CR 119.3 / 608.2 / 707.12). "Chain
        // Lightning deals 3 damage to any target. Then that player or that
        // permanent's controller may pay {R}{R}. If the player does, they may
        // copy this spell and may choose a new target for that copy."
        //
        // Board: you hold Chain Lightning and six Mountains (one to cast, two
        // for each {R}{R} chain link). The opponent fields a Hill Giant (3/3)
        // and a Headless Horseman (2/3) to bounce the chain between.
        // Golden path:
        //   1. Cast Chain Lightning at the opponent's Hill Giant — it takes 3
        //      and dies (or pick a creature that survives to keep chaining).
        //   2. The opponent (controller of the damaged permanent) is offered
        //      "Pay {R}{R} to copy?". If they have red mana they may pay; the
        //      copy then prompts them to choose a NEW target.
        //   3. Retarget the copy at the Headless Horseman (or a player) — it
        //      deals another 3, and its damaged controller may chain again.
        // Edge: decline the may-pay → nothing further happens, Chain Lightning
        // goes to the graveyard.
        label: "LEG: Chain Lightning — 3 damage, may-pay {R}{R} to copy & retarget",
        cards: [
            {
                name: "Chain Lightning",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 6 },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Headless Horseman", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Rapid Fire — {3}{W} instant (#494, CR 117.1b / 702.7 / 702.23).
        // "Cast this spell only before blockers are declared. Target creature
        // gains first strike until end of turn. If it doesn't have rampage,
        // that creature gains rampage 2 until end of turn."
        //
        // Board: you hold Rapid Fire and four Plains. You control a Grizzly
        // Bears (2/2, no rampage) to pump and a Frost Giant (printed rampage 2,
        // the no-stacking edge). The opponent fields two Grizzly Bears to gang-
        // block. Started in BEGINNING_OF_COMBAT — a pre-blockers window where
        // Rapid Fire is castable.
        // Golden path:
        //   1. (Still before declare-blockers) cast Rapid Fire on your Grizzly
        //      Bears → it gains first strike + rampage 2 until end of turn.
        //   2. Move to declare-attackers, attack with the bear; let the
        //      opponent gang-block with both bears. Rampage fires once:
        //      +2/+2 × (2 − 1) → the bear is 4/4 and strikes first.
        //   3. Confirm Rapid Fire is no longer castable once the declare-
        //      blockers step has begun (the Cast action disappears).
        // Edge: cast Rapid Fire on the Frost Giant instead → it gains first
        //   strike but NO extra rampage (it already has rampage 2).
        label: "LEG: Rapid Fire — first strike + conditional rampage 2 (before blockers)",
        cards: [
            { name: "Rapid Fire", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Frost Giant", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
        ],
        phase: "BEGINNING_OF_COMBAT",
        landCount: 0,
    },
    {
        // Wall of Caltrops — {1}{W} 2/1 Wall, Defender (#495, CR 509.1h /
        // 603.4d / 702.22). "Whenever this creature blocks a creature, if at
        // least one other Wall creature is blocking that creature and no
        // non-Wall creatures are blocking that creature, this creature gains
        // banding until end of turn."
        //
        // Board: you control Wall of Caltrops, a Wall of Light (the second Wall)
        // and a Grizzly Bears (the non-Wall co-blocker for the edge case). The
        // opponent fields a Hill Giant (3/3) to attack into your wall of walls.
        // Golden path:
        //   1. Pass to the opponent's turn and attack with the Hill Giant.
        //   2. Double-block the Giant with Wall of Caltrops AND Wall of Light
        //      (both Walls, no non-Wall). At block declaration Caltrops' trigger
        //      fires and grants it banding until end of turn — so YOU (the
        //      blocking player) now divide the Giant's 3 combat damage among the
        //      two Walls instead of the attacker's controller.
        //   3. Confirm Caltrops shows banding on the battlefield until cleanup.
        // Edge: triple-block by adding the Grizzly Bears (a non-Wall) → the
        //   intervening-if fails and Caltrops does NOT gain banding.
        label: "LEG: Wall of Caltrops — conditional banding on multi-Wall block",
        cards: [
            { name: "Wall of Caltrops", owner: "me" as const },
            { name: "Wall of Light", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // The Abyss — {3}{B} World enchantment (CR 205.4a / 704.5m). "At the
        // beginning of each player's upkeep, destroy target nonartifact
        // creature that player controls of their choice. It can't be
        // regenerated." The ACTIVE player chooses which of their own nonartifact
        // creatures dies; an artifact creature is never eligible.
        //
        // Board: you control The Abyss, two nonartifact creatures (Headless
        // Horseman, Hill Giant) and an Ornithopter (Artifact Creature, exempt).
        // The opponent has a Headless Horseman. Started in your UPKEEP.
        // Golden path:
        //   1. The upkeep trigger is on the stack — let it resolve. You (active)
        //      are prompted to choose one of YOUR nonartifact creatures; the
        //      Ornithopter is NOT offered. The chosen creature is destroyed and
        //      can't be regenerated.
        //   2. Pass the turn to reach the OPPONENT's upkeep → The Abyss fires
        //      again, now scoping the choice to the opponent's creatures.
        // Edge: leave only the Ornithopter on your side → the trigger resolves
        // doing nothing (no legal nonartifact creature).
        label: "LEG: The Abyss — each-upkeep destroy (World)",
        cards: [
            { name: "The Abyss", owner: "me" as const },
            { name: "Headless Horseman", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Ornithopter", owner: "me" as const },
            { name: "Headless Horseman", owner: "opp" as const },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // #487 Dynamic base-P/T set (layer 7b) with a stated duration
        // (CR 613.4b / 611.2 / 500.2). Two upkeep triggers that SET base P/T to
        // a value computed and LOCKED at resolution:
        //   • Wall of Tombstones ({1}{B} 0/1 Defender) — "change this creature's
        //     base toughness to 1 plus the number of creature cards in your
        //     graveyard" (indefinite). With three creature cards in your
        //     graveyard the set is 1 + 3 = 4 toughness.
        //   • Halfdane ({1}{W}{U}{B} 3/3 Legendary) — "change Halfdane's base
        //     power and toughness to the power and toughness of target creature
        //     other than Halfdane until your next upkeep."
        //
        // Board: you control the Wall + Halfdane, with three creature cards
        // (Headless Horseman, Hill Giant, Grizzly Bears) already in your
        // graveyard. The opponent has a Hill Giant (3/3) to copy. Started in
        // your UPKEEP so both triggers are waiting on the stack.
        // Golden path:
        //   1. Resolve Wall of Tombstones' trigger → its base toughness becomes
        //      4 (1 + 3). The set is indefinite (survives later upkeeps).
        //   2. Resolve Halfdane's trigger → choose the opponent's Hill Giant →
        //      Halfdane becomes 3/3 (already 3/3, pick the smaller bear instead
        //      to see it shrink to 2/2). Pass to your NEXT upkeep → it reverts.
        // Edge: drop a +1/+1 counter on either after the set — it stacks on top
        // (layer 7c over 7b).
        label: "LEG: Wall of Tombstones + Halfdane — dynamic base P/T (#487)",
        cards: [
            { name: "Wall of Tombstones", owner: "me" as const },
            { name: "Halfdane", owner: "me" as const },
            {
                name: "Headless Horseman",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Hill Giant",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // D'Avenant Archer — "{T}: deals 1 damage to target attacking or
        // blocking creature." (CR 508.1 / 509.1 combat-role target.) You control
        // the Archer (untapped, no summoning sickness). Golden path:
        //   1. Pass to the opponent's turn and attack with their Goblin Hero
        //      (2/2), OR advance your own combat and have a creature block.
        //   2. While a creature is attacking/blocking, activate the Archer's
        //      {T} ability and target it → it takes 1 damage.
        // The point is the target filter: idle creatures are NOT selectable;
        // only attackers and blockers light up.
        label: "LEG: D'Avenant Archer — ping attacker/blocker",
        cards: [
            { name: "D'Avenant Archer", owner: "me" as const },
            { name: "Goblin Hero", owner: "opp" as const },
            { name: "Goblin Hero", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // #489 Petra Sphinx — {2}{W}{W}{W} 3/4 Sphinx (CR 202.3 name-a-card +
        //   CR 701.13 reveal). "{T}: Target player chooses a card name, then
        //   reveals the top card of their library. If that card has the chosen
        //   name, that player puts it into their hand. If it doesn't, the player
        //   puts it into their graveyard."
        // You control an untapped Petra Sphinx; `libraryCount` fills both
        // libraries with Plains, so the top card is a known Plains. Golden path:
        //   1. Activate the Sphinx's {T} ability targeting yourself.
        //   2. The name-a-card input opens — type "Plains" (autocomplete over
        //      the implemented registry) and submit.
        //   3. The top card (Plains) is revealed; it matches → it goes to your
        //      HAND. Watch your hand count tick up.
        // Edge: name any other card (e.g. "Tundra Wolves") → the revealed Plains
        // doesn't match and goes to your GRAVEYARD instead.
        label: "LEG: Petra Sphinx — name a card, reveal top (#489)",
        cards: [{ name: "Petra Sphinx", owner: "me" as const }],
        phase: "PRECOMBAT_MAIN",
        landCount: 5,
        libraryCount: 10,
    },
    {
        // #491 Clergy of the Holy Nimbus — {W} 1/1. "If this creature would be
        // destroyed, regenerate it. {1}: This creature can't be regenerated
        // this turn. Only your opponents may activate this ability."
        //   - Continuous auto-regeneration replacement (CR 614.5): a perpetual
        //     shield, not a one-shot — it regenerates every time Clergy would be
        //     destroyed.
        //   - Opponent-only activation (CR 602.1): only the controller's
        //     OPPONENT may pay {1}; the controller may not.
        //
        // Board: you (P1) control the Clergy. The opponent (P2) holds two
        // Terrors (destroy target nonartifact, nonblack creature — Clergy is
        // white, so legal) plus four Plains to cast both and pay the {1}.
        // Golden path (solo mode, auto-switch to P2 on priority):
        //   1. As P2, cast Terror on the Clergy → it would be destroyed but
        //      auto-regenerates (CR 614.5): survives, tapped, damage healed.
        //   2. As P2, activate Clergy's {1} ability ("can't be regenerated this
        //      turn") — the opponent-only ability is offered on P2's view of
        //      P1's Clergy; P1 can NOT activate it (CR 602.1).
        //   3. As P2, cast the second Terror → auto-regen is suppressed, the
        //      Clergy is destroyed and goes to the graveyard (CR 701.15c).
        // Edge: skip step 2 → the second Terror still bounces off auto-regen,
        //   and the flag wears off at CLEANUP so a fresh turn restores it.
        label: "LEG: Clergy of the Holy Nimbus — auto-regen + opponent-only {1} (#491)",
        cards: [
            { name: "Clergy of the Holy Nimbus", owner: "me" as const },
            { name: "Terror", owner: "opp" as const, zone: "hand" as const },
            { name: "Terror", owner: "opp" as const, zone: "hand" as const },
            { name: "Plains", owner: "opp" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // #492 Greater Realm of Preservation — {1}{W} enchantment.
        //   "{1}{W}: The next time a black or red source of your choice would
        //    deal damage to you this turn, prevent that damage." (CR 615.1,
        //    615.6 one-shot prevention shield; CR 202.2 color-of-source choice.)
        // You (P1) control the Realm and two Plains to pay {1}{W}. The opponent
        // (P2) has a Goblin Hero (2/2 RED creature) on the battlefield to attack
        // with. Golden path (solo mode, auto-switch to whoever has priority):
        //   1. As P2, attack with the Goblin Hero (a red source).
        //   2. As P1, before combat damage, activate the Realm's {1}{W} ability
        //      and CHOOSE the attacking Goblin Hero — only black/red sources are
        //      offered (CR 202.2). A one-shot end-of-turn shield is scheduled.
        //   3. Combat damage: the Goblin Hero's 2 damage to you is PREVENTED —
        //      your life stays at 20 and the shield is consumed (CR 615.6).
        // Edge: a green attacker could never be chosen, so its damage lands; a
        // second hit from the same red source after the shield is spent also
        // lands (one-shot).
        label: "LEG: Greater Realm of Preservation — prevent next damage from a chosen black/red source (#492)",
        cards: [
            { name: "Greater Realm of Preservation", owner: "me" as const },
            { name: "Goblin Hero", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // #493 Glyph of Life — {W} instant (CR 603.7 delayed trigger / 119
        //   lifegain). "Choose target Wall creature. Whenever that creature is
        //   dealt damage by an attacking creature this turn, you gain that much
        //   life." A turn-scoped lifegain armed at resolution and scanned in the
        //   combat damage step — only an ATTACKER's combat damage to the watched
        //   Wall gains life (a blocker's or non-combat source's does not).
        // Board: you (P1) control a Wall of Earth (0/6 Defender) and hold Glyph
        // of Life plus a Plains to cast it. The opponent (P2) fields a Goblin
        // Hero (2/2) to attack with. Golden path (solo mode auto-switch):
        //   1. As P1, cast Glyph of Life targeting your Wall of Earth (it arms
        //      the lifegain for the rest of the turn).
        //   2. Pass to P2 and attack with the Goblin Hero.
        //   3. As P1, block the Goblin Hero with the Wall of Earth.
        //   4. Combat damage: the Goblin Hero (an attacker) deals 2 to the Wall
        //      → you gain 2 life (your total ticks 20 → 22). The Wall survives.
        // Edge: a Glyph cast on a Wall that is itself attacking and gets hit by
        //   a blocker gains NO life — the damage source isn't an attacker.
        label: "LEG: Glyph of Life — gain life when a Wall is hit by an attacker (#493)",
        cards: [
            {
                name: "Glyph of Life",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Wall of Earth", owner: "me" as const },
            { name: "Goblin Hero", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // #486 Infinite Authority — {W}{W}{W} Aura (Enchant creature).
        //   "Whenever enchanted creature blocks or becomes blocked by a creature
        //    with toughness 3 or less, destroy the other creature at end of
        //    combat. At the beginning of the next end step, if that creature was
        //    destroyed this way, put a +1/+1 counter on the first creature."
        // You hold Infinite Authority plus three Plains and control a Hill Giant
        // (3/3) to enchant; the opponent has a Grizzly Bears (2/2, toughness ≤3)
        // to block with. Golden path:
        //   1. Cast Infinite Authority targeting your Hill Giant.
        //   2. Attack with the enchanted Hill Giant; the opponent blocks with
        //      Grizzly Bears (becomes-blocked-by, CR 509.1h).
        //   3. At end of combat the Grizzly Bears is destroyed (CR 603.7a
        //      deferred destroy) — it survived combat damage (3/3 vs 2/2 it
        //      trades, but the trigger kills the blocker regardless).
        //   4. At the next end step the Hill Giant gets a +1/+1 counter
        //      (4/4) because a creature was destroyed this way.
        // Edge: block instead with a toughness-4 creature → no destroy, no
        // counter.
        label: "LEG: Infinite Authority — small blocker dies, host gains a counter (#486)",
        cards: [
            {
                name: "Infinite Authority",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // #482 Red Mana Battery — {4} Artifact.
        //   "{2}, {T}: Put a charge counter on this artifact."
        //   "{T}, Remove any number of charge counters: Add {R}, then an
        //    additional {R} for each counter removed this way."
        // You control a Red Mana Battery pre-seeded with 3 charge counters
        // (untapped) plus 2 lands to pay the {2} charge cost. Golden path:
        //   1. Tap the battery for mana → the colour picker offers 1..4 {R}
        //      (remove 0..3 charge counters). Pick "4 {R}" → 4 red mana floats
        //      and all 3 counters are removed. The mana ability resolves
        //      immediately (no stack).
        //   2. Or use "{2},{T}: Put a charge counter" first (tap 2 lands) to
        //      grow the battery before discharging it.
        // Edge: pick "1 {R}" (remove 0) → 1 mana, counters untouched.
        label: "LEG: Mana Battery — scaled mana from charge counters (#482)",
        cards: [
            {
                name: "Red Mana Battery",
                owner: "me" as const,
                zone: "battlefield" as const,
                counters: { charge: 3 },
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // #483 Kismet — {3}{W} Enchantment. "Artifacts, creatures, and lands
        // your opponents control enter tapped." (CR 614.1c replacement + CR
        // 110.5b — a battlefield-scanned, opponent-filtered `enters-tapped-
        // restriction` static.) You control Kismet; the opponent holds a
        // Grizzly Bears and some lands. Golden path:
        //   1. Pass to the opponent's turn.
        //   2. The opponent plays a land → it enters TAPPED.
        //   3. The opponent casts Grizzly Bears → it enters TAPPED (can't
        //      attack the turn it resolves, and is tapped on the board).
        // Edge: your own permanents enter untapped as usual.
        label: "LEG: Kismet — opponents' permanents enter tapped (#483)",
        cards: [
            { name: "Kismet", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const, zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // #485 Enchanted Being — {1}{W}{W} 2/2. "Prevent all combat damage that
        // would be dealt to this creature by enchanted creatures." (CR 615
        // prevention / CR 611 continuous — a source-filtered
        // `combat-damage-prevention` static re-evaluated each combat.) You
        // control Enchanted Being; the opponent has a Grizzly Bears (2/2)
        // attacker. You hold Spirit Link (an Aura) to make that attacker
        // "enchanted". Golden path:
        //   1. Cast Spirit Link onto the opponent's Grizzly Bears (you have a
        //      Plains to pay {W}). The Bears is now an enchanted creature.
        //   2. Pass to the opponent's turn; they attack with the Bears.
        //   3. Block the Bears with Enchanted Being. At the combat-damage step
        //      Enchanted Being takes NO damage (prevented) and survives, while
        //      its own 2 power kills the Bears.
        // Edge: without the Aura the Bears trades normally (each 2/2 dies).
        label: "LEG: Enchanted Being — no combat damage from enchanted creatures (#485)",
        cards: [
            {
                name: "Enchanted Being",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Spirit Link",
                owner: "me" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // #485 Wall of Vapor — {3}{U} 0/1 Wall, Defender. "Prevent all damage
        // that would be dealt to this creature by creatures it's blocking."
        // (CR 615 / 611 — source-filtered `combat-damage-prevention` keyed to
        // the live block graph.) You control the Wall; the opponent has a
        // Grizzly Bears (2/2) attacker. Golden path:
        //   1. Pass to the opponent's turn; they attack with the Bears.
        //   2. Block the Bears with Wall of Vapor (0/1). At the damage step the
        //      Wall takes NO damage from the creature it's blocking and
        //      survives — an indestructible-feeling wall against its blockees.
        // Edge: a creature the Wall is NOT blocking damages it normally.
        label: "LEG: Wall of Vapor — no damage from creatures it blocks (#485)",
        cards: [
            {
                name: "Wall of Vapor",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // #481 Moat — {2}{W}{W} Enchantment. "Creatures without flying can't
        // attack." (CR 508.1c — a battlefield-scanned `global-attack-restriction`
        // static that locks attacks by creatures OTHER than its source.) You
        // control Moat, a non-flying Goblin Hero (2/2) and a flying Azure Drake
        // (2/4). Golden path:
        //   1. Advance to combat (Next until DECLARE_ATTACKERS).
        //   2. The Goblin Hero is grayed out — it can't be declared as an
        //      attacker. The Azure Drake (flying) lights up and can attack.
        // The lock is symmetric: an opponent's non-flier is locked too.
        label: "LEG: Moat — only fliers can attack (#481)",
        cards: [
            { name: "Moat", owner: "me" as const },
            { name: "Goblin Hero", owner: "me" as const },
            { name: "Azure Drake", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // #481 Akron Legionnaire — {6}{W}{W} 8/4 Giant Soldier. "Except for
        // creatures named Akron Legionnaire and artifact creatures, creatures
        // you control can't attack." (CR 508.1c — a controller-scoped
        // `global-attack-restriction`.) You control Akron, a vanilla Goblin Hero
        // (locked) and a Clay Statue (Artifact Creature, exempt). Golden path:
        //   1. Advance to DECLARE_ATTACKERS.
        //   2. The Goblin Hero is grayed out; Akron itself AND the Clay Statue
        //      light up and can attack.
        // Edge: the opponent's creatures are NOT locked (controller-scoped).
        label: "LEG: Akron Legionnaire — allies can't attack (#481)",
        cards: [
            { name: "Akron Legionnaire", owner: "me" as const },
            { name: "Goblin Hero", owner: "me" as const },
            { name: "Clay Statue", owner: "me" as const },
            { name: "Goblin Hero", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // #484 Great Wall — {2}{W} Enchantment. "Creatures with plainswalk can
        // be blocked as though they didn't have plainswalk." (CR 509.1b /
        // 702.13 — a battlefield-scanned `landwalk-negation` static that
        // suppresses the matching landwalk's evasion.) The opponent attacks
        // with Righteous Avengers (plainswalk 3/1); you control a Plains, a
        // Tundra Wolves (1/1 blocker) and Great Wall. Golden path:
        //   1. Switch to the opponent's seat and attack with Righteous Avengers.
        //   2. Advance to DECLARE_BLOCKERS on your seat.
        //   3. Without Great Wall, plainswalk + your Plains would make the
        //      attacker unblockable. WITH Great Wall, the Tundra Wolves lights
        //      up and can be assigned to block. (Undertow is the islandwalk
        //      twin — same parametric static, `subtypes: ["Island"]`.)
        label: "LEG: Great Wall — plainswalk blockable despite a Plains (#484)",
        cards: [
            { name: "Righteous Avengers", owner: "opp" as const },
            { name: "Great Wall", owner: "me" as const },
            { name: "Tundra Wolves", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 1 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // #488 Livonya Silone — {2}{R}{R}{G}{G} 4/4 Legendary, "First strike;
        // legendary landwalk." Landwalk keyed on the LAND supertype Legendary
        // (CR 205.4 / 702.13) instead of a basic-land subtype: Livonya can't be
        // blocked while the defending player controls a land with the Legendary
        // supertype. Golden path:
        //   1. Attack with Livonya Silone.
        //   2. Advance to DECLARE_BLOCKERS on the opponent's seat.
        //   3. The opponent controls Pendelhaven (a Legendary Land), so NO
        //      blocker lights up — Grizzly Bears stays dim. Swap Pendelhaven for
        //      a basic Forest and the Bears become a legal block (no legendary
        //      land → no evasion). First strike still applies in the damage step.
        label: "LEG: Livonya Silone — legendary landwalk (unblockable vs a legendary land) (#488)",
        cards: [
            { name: "Livonya Silone", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Forest", owner: "me" as const, count: 2 },
            // Opponent's legendary land makes the evasion live.
            { name: "Pendelhaven", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Mana Drain — {U}{U} Instant. "Counter target spell. At the beginning
        // of your next main phase, add an amount of {C} equal to that spell's
        // mana value." (CR 701.5a counter + CR 603.7/505 next-main-phase
        // delayed trigger + CR 107.4c colorless {C}.) You hold Mana Drain and
        // two untapped Islands; the opponent holds an Azure Drake (MV 4).
        // Golden path:
        //   1. Pass to the opponent's turn and have them cast Azure Drake.
        //   2. With priority, cast Mana Drain targeting the Drake → it's
        //      countered (to the graveyard) and NO mana appears yet.
        //   3. Pass back to your turn. When your PRECOMBAT_MAIN begins, the
        //      delayed trigger resolves and adds {C}{C}{C}{C} to your pool —
        //      visible as 4 colorless in your mana display.
        label: "LEG: Mana Drain — counter + {C} next main phase",
        cards: [
            { name: "Mana Drain", owner: "me" as const, zone: "hand" as const },
            {
                name: "Island",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 2,
            },
            {
                name: "Azure Drake",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Island",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 4,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // C1.1 Poison foundation (#452) — poison as a player resource (CR 122)
        // and its loss SBA (CR 704.5c). The opponent is seeded to NINE poison
        // counters (near-lethal): the danger-token badge renders under their
        // name and survives the wire projection. Golden path: add one more
        // poison counter (e.g. via a poison source, or bump `poison.opp` to 10
        // in this preset) → the opponent hits ten and loses on the next SBA
        // sweep, with `gameOver.reason === "poison"`. You are seeded to two
        // poison so a non-zero badge shows on both seats.
        label: "C1.1: Poison — near-lethal board (#452)",
        cards: [],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        poison: { me: 2, opp: 9 },
    },
    {
        // C1.2 Marsh Viper — poison on damage to a player (#453). "Whenever this
        // creature deals damage to a player, that player gets two poison
        // counters." (modern Oracle, ADR 0004; trigger fires on ANY damage to a
        // player — CR 120.3 — not combat-only.) You control Marsh Viper (1/2,
        // not summoning-sick) and the opponent is seeded to EIGHT poison — one
        // combat connection from lethal. Golden path:
        //   1. Advance to combat and attack with Marsh Viper.
        //   2. Opponent has no blockers → 1 combat damage to them → the
        //      DAMAGE_DEALT trigger adds 2 poison → 8 + 2 = 10.
        //   3. The >=10 poison loss SBA (CR 704.5c) fires on the next sweep:
        //      opponent loses with `gameOver.reason === "poison"`.
        label: "C1.2: Marsh Viper — poison kill (#453)",
        cards: [{ name: "Marsh Viper", owner: "me" as const }],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        poison: { opp: 8 },
    },
    {
        // C5 Fight primitive — Tracker (#422). "{G}{G}, {T}: This creature deals
        // damage equal to its power to target creature. That creature deals
        // damage equal to its power to this creature." (CR 701.12-style mutual
        // damage, routed through the normal damage path.) You control Tracker
        // (2/2) and two Forests to pay {G}{G}; activate, then pick a foe:
        //   • Ghost Ship (2/4) — GOLDEN PATH: Tracker takes 2 (lethal, dies);
        //     Ghost Ship takes 2 and survives (it can even regenerate).
        //   • Goblin Hero (2/2) — EDGE (both die): simultaneous lethal sends
        //     BOTH to the graveyard — the dying Tracker still deals its damage.
        //   • Uncle Istvan (1/3) — EDGE (prevention): its "prevent all damage
        //     dealt to it by creatures" replacement absorbs Tracker's hit, so
        //     only Tracker takes damage (1) — proving fight obeys CR 615.
        label: "C5: Tracker Fight — mutual damage (#422)",
        cards: [
            { name: "Tracker", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Ghost Ship", owner: "opp" as const },
            { name: "Goblin Hero", owner: "opp" as const },
            { name: "Uncle Istvan", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // C9 swap blockers — Sorrow's Path (#426). "{T}: Choose two target
        // blocking creatures controlled by the same opponent. If each could
        // block all creatures the other is blocking, remove both from combat;
        // each then blocks what the other was blocking." Plus the drawback:
        // "Whenever this land becomes tapped, it deals 2 damage to you and each
        // creature you control."
        //
        // Board: you control Sorrow's Path, two 2/2 attackers (Goblin Hero), and
        // a 1/3 bystander (Squire) that the on-tap drawback will mark for 2. The
        // opponent has two 1/3 blockers (Squire). Golden path:
        //   1. Advance to combat, attack with BOTH Goblin Heroes.
        //   2. Opponent blocks one Goblin Hero with each Squire.
        //   3. Activate Sorrow's Path → the two blockers swap which attacker
        //      they block (legal: both are vanilla, so each can block either).
        //      Tapping it ALSO fires the drawback → you take 2 and each of your
        //      creatures (the bystander Squire + both Goblin Heroes) takes 2.
        // Edge: give one attacker flying via another effect to make the swap
        // illegal (a no-op) — the non-flyer can't reassign onto the flyer.
        label: "C9: Sorrow's Path — swap blockers (#426)",
        cards: [
            { name: "Sorrow's Path", owner: "me" as const },
            { name: "Goblin Hero", owner: "me" as const, count: 2 },
            { name: "Squire", owner: "me" as const },
            { name: "Squire", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // C7 skip-draw enchantment — Fasting (#424). You control Fasting with 4
        // hunger counters already on it, in your UPKEEP on turn 2 so the draw
        // step actually runs. Walk it forward to hit two paths:
        //   • UPKEEP: the hunger trigger adds the FIFTH counter → Fasting is
        //     destroyed (CR 603 "destroy if it has five or more"). To instead
        //     see the SKIP path, lower the counter seed.
        //   • DRAW (if it survived): "Skip your draw step to gain 2 life?" —
        //     accept → +2 life, no card drawn, Fasting stays; decline → you
        //     draw your card, which triggers "when you draw, destroy this".
        // libraryCount ensures there's a card to draw when you decline.
        label: "C7: Fasting — skip draw / hunger counters (#424)",
        cards: [
            {
                name: "Fasting",
                owner: "me" as const,
                counters: { hunger: 4 },
            },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "UPKEEP",
        landCount: 0,
        libraryCount: 5,
        turn: 2,
    },
    {
        // C3 mana-production lookup / replacement (#420). Three rocks/enchantments
        // that read or rewrite mana production:
        //   • Fellwar Stone — {T}: tap it and the colour picker offers exactly
        //     the colours the OPPONENT's lands could produce (here a Plains +
        //     Island → {W} or {U}). Add a Forest to the opponent's side to see
        //     {G} appear.
        //   • Deep Water — {U}: until end of turn, tapping any of YOUR lands for
        //     mana yields {U} instead (tap a Forest after activating → {U}).
        //   • Gaea's Touch — {0} once per turn at sorcery speed: put the basic
        //     Forest from hand onto the battlefield; or sacrifice it for {G}{G}.
        label: "C3: Fellwar Stone / Deep Water / Gaea's Touch (#420)",
        cards: [
            { name: "Fellwar Stone", owner: "me" as const },
            { name: "Deep Water", owner: "me" as const },
            { name: "Gaea's Touch", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Forest", owner: "me" as const, zone: "hand" as const },
            // Opponent's mana base — drives Fellwar Stone's colour picker.
            { name: "Plains", owner: "opp" as const, count: 2 },
            { name: "Island", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // C8 cast-tax World enchantment — Nether Void (#385). The lock sits on
        // the battlefield; every spell cast by EITHER player triggers
        // "counter it unless that player pays {3}":
        //   • Cast Lightning Bolt (or Disenchant) — Nether Void's trigger goes
        //     on the stack above it; on resolution you're prompted to pay {3}.
        //   • Pay {3} → the spell resolves; decline → it's countered.
        // Lands are present so you can choose to pay or not.
        label: "C8: Nether Void taxes every spell {3} (#385)",
        cards: [
            { name: "Nether Void", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Plains", owner: "me" as const, count: 4 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // C8 cast-tax World enchantment — In the Eye of Chaos (#385). The lock
        // taxes ONLY instants, at the cast spell's mana value:
        //   • Cast Lightning Bolt (mana value 1) → prompted to pay {1}.
        //   • Cast Reset (mana value 2) → prompted to pay {2}.
        //   • Cast a sorcery (Disenchant is an instant; use a sorcery to see it
        //     pass untaxed) — no trigger; it resolves freely.
        // Pay → the instant resolves; decline → it's countered (CR 701.5a).
        label: "C8: In the Eye of Chaos taxes instants at mana value (#385)",
        cards: [
            { name: "In the Eye of Chaos", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Reset", owner: "me" as const, zone: "hand" as const },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Mountain", owner: "me" as const, count: 4 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // C9 global combat cap — Caverns of Despair (#386). The World
        // enchantment caps DECLARED attackers (and blockers) at two each
        // combat:
        //   • You control Caverns of Despair and three Grizzly Bears, already
        //     in DECLARE_ATTACKERS on your turn.
        //   • Declare two Bears as attackers — fine. Try to add the third and
        //     the server rejects it ("No more than 2 creatures can attack each
        //     combat").
        //   • The opponent's three Bears can likewise block only two attackers.
        label: "C9: Caverns of Despair caps attackers/blockers at 2 (#386)",
        cards: [
            { name: "Caverns of Despair", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 3 },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 0,
    },
    {
        // C9 defender-history attack restriction — Arboria (#386). "Creatures
        // can't attack a player unless that player cast a spell or put a
        // nontoken permanent onto the battlefield during their last turn."
        //   • You control Arboria and two Grizzly Bears, in DECLARE_ATTACKERS.
        //   • The opponent took no qualifying action on their last turn, so
        //     your Bears CAN'T be declared as attackers against them — the
        //     attack is illegal until the opponent acts on their own turn.
        //   • Pass the turn, let the bot cast a spell / drop a permanent, and on
        //     your next turn the restriction lifts and the Bears can attack.
        label: "C9: Arboria blocks attacks vs an idle player (#386)",
        cards: [
            { name: "Arboria", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 0,
    },
    {
        // Giant Turtle (#490) — "This creature can't attack if it attacked
        // during your last turn" (CR 508.1). Golden path:
        //   • You control a Giant Turtle flagged as having attacked last turn,
        //     plus a Grizzly Bears (the control), in DECLARE_ATTACKERS.
        //   • The Turtle CAN'T be declared as an attacker (the engine grays it
        //     out and the server rejects it); the Bears attack normally.
        //   • Declare the Bears, pass the turn, and on your next turn — having
        //     sat the Turtle out — the restriction lifts and it can attack.
        label: "LEG: Giant Turtle can't attack the turn after it attacked (#490)",
        cards: [
            {
                name: "Giant Turtle",
                owner: "me" as const,
                attackedLastTurn: true,
            },
            { name: "Grizzly Bears", owner: "me" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 0,
    },
    {
        // The Dark (DRK) walking skeleton (#410). Registers the `drk` set with
        // three vanilla creatures and proves the full pipeline end-to-end:
        //   • Squire (1/2, {1}{W}), Goblin Hero (2/2, {2}{R}) and Scarwood
        //     Goblins (2/2, {R}{G}) start in hand with lands to cast them.
        //   • Cast each one and confirm it resolves onto the battlefield with
        //     the canonical P/T and subtypes from DRK.json.
        label: "DRK skeleton: cast Squire / Goblin Hero / Scarwood Goblins (#410)",
        cards: [
            { name: "Squire", owner: "me" as const, zone: "hand" as const },
            {
                name: "Goblin Hero",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Scarwood Goblins",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Forest", owner: "me" as const, count: 1 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK White free tranche (#411) — Angry Mob CDA (CR 604.3). Angry Mob is
        // a 0/0 body whose P/T reads "2 + opponents' Swamps during your turn,
        // 2 otherwise":
        //   • On your turn, with the opponent's three Swamps in play, Angry Mob
        //     shows 5/5. End the turn (pass to the bot) and it drops to 2/2.
        label: "DRK White: Angry Mob — 2 + opponents' Swamps on your turn (#411)",
        cards: [
            { name: "Angry Mob", owner: "me" as const },
            { name: "Swamp", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK White free tranche (#411) — activated-ability creatures. Exercise:
        //   • Exorcist: {1}{W},{T} destroys the opponent's Black Knight.
        //   • Witch Hunter: {T} pings a player; {1}{W}{W},{T} bounces a creature.
        // (Miracle Worker needs an Aura already attached to your creature, which
        // the scenario seeder can't wire — its behavior is covered by tests.)
        label: "DRK White: Exorcist / Witch Hunter activated (#411)",
        cards: [
            { name: "Exorcist", owner: "me" as const },
            { name: "Witch Hunter", owner: "me" as const },
            { name: "Black Knight", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK White free tranche (#411) — Preacher control gain (CR 611.2b).
        // Preacher starts tapped (its {T} cost paid). Activate "gain control of
        // target creature of an opponent's choice they control": target the bot,
        // it picks its creature, control moves to you for as long as Preacher
        // stays tapped (the "may choose not to untap" clause keeps it locked).
        label: "DRK White: Preacher — steal a creature while tapped (#411)",
        cards: [
            {
                name: "Preacher",
                owner: "me" as const,
                tapped: true as const,
            },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK White free tranche (#411) — spells. Cast in your main / combat:
        //   • Tivadar's Crusade: destroy all Goblins (the bot's Scarwood Goblins).
        //   • Holy Light: nonwhite creatures get -1/-1 (kills the bot's bears).
        //   • Dust to Dust: exile two of the bot's artifacts.
        //   • Martyr's Cry: exile all white creatures, draw per exiled.
        label: "DRK White: Tivadar's Crusade / Holy Light / Dust to Dust / Martyr's Cry (#411)",
        cards: [
            {
                name: "Tivadar's Crusade",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Holy Light",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Dust to Dust",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Martyr's Cry",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "White Knight", owner: "me" as const },
            { name: "Scarwood Goblins", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
            { name: "Ornithopter", owner: "opp" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK White free tranche (#411) — Fire and Brimstone (CR 506.2). The
        // instant may only target a player who attacked this turn. Set up combat
        // (the bot's bears attack), then cast Fire and Brimstone targeting the
        // attacking player: 4 damage to them and 4 to you. Only attacking
        // players are clickable.
        label: "DRK White: Fire and Brimstone — 4 to an attacker + 4 to you (#411)",
        cards: [
            {
                name: "Fire and Brimstone",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Blue free tranche (#412) — Sunken City: blue anthem + upkeep
        // maintenance. The Air Elemental (4/4) shows 5/5 under "Blue creatures
        // get +1/+1". Pass to your upkeep: a "Pay {U}{U} or sacrifice Sunken
        // City?" prompt appears — decline to sacrifice it (anthem drops), or
        // pay with the two Islands to keep it.
        label: "DRK Blue: Sunken City — blue anthem + upkeep {U}{U}-or-sac (#412)",
        cards: [
            { name: "Sunken City", owner: "me" as const },
            { name: "Air Elemental", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Blue free tranche (#412) — Mana Vortex: each player's upkeep land
        // sacrifice. With Mana Vortex in play, pass to an upkeep: the active
        // player must "sacrifice a land of their choice". Keep sacrificing
        // across upkeeps until no lands remain → Mana Vortex sacrifices itself.
        label: "DRK Blue: Mana Vortex — each-upkeep land sacrifice (#412)",
        cards: [
            { name: "Mana Vortex", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Island", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Blue free tranche (#412) — Psychic Allergy: ETB choose-a-color,
        // opponent-upkeep damage, own-upkeep destroy-unless-sac-two-Islands.
        // Cast Psychic Allergy from hand and choose blue; the opponent controls
        // two blue Air Elementals, so at their upkeep they take 2 damage. At
        // your upkeep, decline to sacrifice two Islands → it's destroyed.
        label: "DRK Blue: Psychic Allergy — choose a color, ping at opp upkeep (#412)",
        cards: [
            {
                name: "Psychic Allergy",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Air Elemental", owner: "opp" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Blue free tranche (#412) — Giant Shark + Merfolk Assassin + Flood.
        //   • Giant Shark (4/4) can't attack unless the defender controls an
        //     Island; sacrifices itself with no Islands of your own.
        //   • Merfolk Assassin: {T} destroys the opponent's islandwalker
        //     (Segovian Leviathan) — only islandwalkers are clickable.
        //   • Flood: {U}{U} taps the opponent's non-flyer (the flyer is not a
        //     legal target).
        label: "DRK Blue: Merfolk Assassin / Flood / Giant Shark (#412)",
        cards: [
            { name: "Merfolk Assassin", owner: "me" as const },
            { name: "Flood", owner: "me" as const },
            { name: "Giant Shark", owner: "me" as const },
            { name: "Segovian Leviathan", owner: "opp" as const },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Blue C4 (#421) — Dance of Many (copy-as-token enchantment).
        //   • Cast Dance of Many from hand and choose a nontoken creature to
        //     copy (the opponent's Serra Angel 4/4 flying or your Grizzly Bears
        //     2/2). A token copy enters under your control.
        //   • Leave-linkage: destroy/bounce Dance → its token is exiled; kill
        //     the token → Dance is sacrificed.
        //   • At your upkeep, pay {U}{U} (5 Islands provided) or sacrifice it.
        label: "DRK Blue: Dance of Many — copy a creature as a token (#421)",
        cards: [
            {
                name: "Dance of Many",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Black free tranche (#413) — Curse Artifact + Inquisition + Word of
        // Binding + Ashes to Ashes.
        //   • Curse Artifact enchants the opponent's Ornithopter; at their
        //     upkeep they sacrifice it or take 2.
        //   • Inquisition: target the opponent → they reveal their hand and take
        //     damage equal to the white cards in it (Savannah Lions = 1).
        //   • Word of Binding: tap X target creatures (choose X).
        //   • Ashes to Ashes: exile two nonartifact creatures, 5 to you.
        label: "DRK Black: Curse Artifact / Inquisition / Word of Binding / Ashes (#413)",
        cards: [
            {
                name: "Curse Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Inquisition",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Word of Binding",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Ashes to Ashes",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Ornithopter", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
            {
                name: "Savannah Lions",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Black free tranche (#413) — Season of the Witch + Uncle Istvan +
        // Bog Rats + Murk Dwellers.
        //   • Season of the Witch: at your upkeep pay 2 life or sacrifice it; at
        //     each end step it destroys untapped creatures that didn't attack
        //     (except defenders / summoning-sick). Attack with some creatures and
        //     advance to the end step to watch the idlers die.
        //   • Uncle Istvan (1/3) prevents all damage from creatures — block with
        //     it and it survives any creature.
        //   • Bog Rats can't be blocked by the Wall of Wood.
        //   • Murk Dwellers gets +2/+0 when it attacks unblocked.
        label: "DRK Black: Season of the Witch / Uncle Istvan / Bog Rats / Murk Dwellers (#413)",
        cards: [
            { name: "Season of the Witch", owner: "me" as const },
            { name: "Uncle Istvan", owner: "me" as const },
            { name: "Bog Rats", owner: "me" as const },
            { name: "Murk Dwellers", owner: "me" as const },
            { name: "Wall of Wood", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Swamp", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Black free tranche (#413) — graveyard + life-driven cards:
        // Nameless Race + The Fallen + Eater of the Dead + Grave Robbers + Banshee.
        //   • Nameless Race: as it enters, pay any amount of life (capped by the
        //     opponent's white permanents + white cards in their graveyard); its
        //     P/T equals the life paid.
        //   • Eater of the Dead: {0} while tapped exiles a creature card from a
        //     graveyard and untaps itself.
        //   • Grave Robbers: {B},{T} exiles an artifact card from a graveyard,
        //     gain 2 life.
        //   • Banshee: {X},{T} deals half X to any target and half X to you.
        //   • The Fallen: once it damages the opponent, each upkeep it pings them
        //     for 1.
        label: "DRK Black: Nameless Race / Eater of the Dead / Grave Robbers / Banshee (#413)",
        cards: [
            {
                name: "Nameless Race",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Eater of the Dead", owner: "me" as const },
            { name: "Grave Robbers", owner: "me" as const },
            { name: "Banshee", owner: "me" as const },
            { name: "The Fallen", owner: "me" as const },
            { name: "Savannah Lions", owner: "opp" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Auto-tap partial coverage (issue #321). Pure-mana sources alone can't
        // cover the cost, but a manual sacrifice source (Black Lotus) is also
        // present:
        //   • Cast Fireball, choose X=7 → cost {7}{R} = 8 mana.
        //   • Press auto-tap. The 5 Mountains all tap (5 mana) and Black Lotus
        //     stays untapped — no server error, the Pay banner stays up.
        //   • Manually sacrifice Black Lotus (floats 3) → cost covered, Fireball
        //     can be paid and resolved.
        label: "Auto-tap: partial coverage leaves Black Lotus manual (Fireball X=7)",
        cards: [
            { name: "Fireball", owner: "me" as const, zone: "hand" as const },
            { name: "Mountain", owner: "me" as const, count: 5 },
            { name: "Black Lotus", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Bot self-harm removal (issue #365). The bot (opp) holds Disenchant with
        // two legal targets: its OWN Castle (a +0/+2 buff Enchantment) and your
        // Jayemdae Tome (a card-advantage Artifact). The bot must NEVER Disenchant
        // its own Castle — with an enemy target present it takes the Tome; with
        // only its own beneficial target it holds the Spell (passes). Pass
        // priority to the bot and watch its move (Debug → AI trace shows the
        // candidates: destroy-own-Castle must rank below the Tome cast / pass).
        label: "Bot: never Disenchant its own Castle — takes enemy Tome instead (#365)",
        cards: [
            {
                name: "Disenchant",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Castle", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
            { name: "Pearled Unicorn", owner: "opp" as const },
            { name: "Jayemdae Tome", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // Persistent hand knowledge (ADR 0026 / PRD #338 slice 3, #341). A look
        // at an opponent's hand stays known to the looker after it resolves:
        //   • Right-click Glasses of Urza → "{T}: Look at target player's hand",
        //     target the opponent. Acknowledge the reveal.
        //   • The two cards now in the opponent's hand stay FACE-UP among the
        //     opponent's card backs on your side of the board (you keep knowing
        //     them), while a freshly drawn card stays hidden.
        //   • Flip the viewer (solo mode follows priority — Pass once): on the
        //     opponent's own view, those same two cards carry the eye icon —
        //     per-card, only on the known cards, never the whole hand.
        //   • A random discard (e.g. via a future Hymn) would clear the whole
        //     hand back to hidden (clear trigger #2).
        label: "Knowledge: look at opponent hand stays known (Glasses of Urza) + eye icon",
        cards: [
            { name: "Glasses of Urza", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Face-down exile / impulse-draw (ADR 0026 / PRD #338 slice 6, #342,
        // CR 406.3). A card exiled FACE DOWN "you may look at" is known to its
        // controller only — reusing the same knownTo mechanism, NOT faceDownOf.
        //   • On "me"'s view, Lightning Bolt sits FACE-UP in "me"'s exile pile
        //     (the controller may look at the card they exiled).
        //   • Flip the viewer (solo mode follows priority — Pass once): on the
        //     opponent's view, that same exile slot shows a FACE-DOWN card
        //     (a 2/2 sentinel) — its identity is hidden from them.
        //   • Contrast: the Grizzly Bears below is exiled face-up (normal
        //     exile) and reads as itself to BOTH players.
        label: "Knowledge: face-down exile is controller-only (impulse-draw)",
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "exile" as const,
                faceDownExile: true,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "exile" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Knowledge clear on unwitnessed discard (ADR 0026 / PRD #338 slice 4,
        // #343). A look at the opponent's hand is cleared the moment that hand
        // changes in a way the knower did not select:
        //   • Right-click Glasses of Urza → "{T}: Look at target player's hand",
        //     target the opponent, acknowledge the reveal. The opponent's two
        //     cards now sit FACE-UP among their card backs on your side.
        //   • Cast Mind Twist (the random-discard vehicle, Hymn-style) with
        //     X = 1 targeting the opponent. The opponent discards one card at
        //     random — a discard YOU did not pick.
        //   • The whole opponent hand reverts to hidden card backs: a random /
        //     unwitnessed change voids your identity→card map for the entire
        //     hand (clear trigger #2), not just the discarded card.
        //   • Flip the viewer (Pass once): the eye icon is gone from the
        //     opponent's own view too. The owner always knows their own hand.
        label: "Knowledge clear: random discard (Mind Twist) voids look at opponent hand (slice 4)",
        cards: [
            { name: "Glasses of Urza", owner: "me" as const },
            {
                name: "Mind Twist",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Graveyard card picker dialog (#314, CR 109.2 / 400.7). A graveyard-
        // zone target opens a selection dialog instead of forcing the player to
        // hunt the board piles:
        //   • Cast Animate Dead (controller: "any"). Both graveyards hold a
        //     creature card, so the dialog FIRST asks "My graveyard" /
        //     "Opponent's graveyard"; after the pick the card picker lists only
        //     that graveyard's creatures. Choose one → it returns under your
        //     control with the aura attached.
        //   • Cast Resurrection (controller: "you"). Only your own graveyard is
        //     eligible, so the choice step is skipped and the card picker opens
        //     directly on your creatures.
        //   • Cancel/ESC out of either dialog → target selection is cancelled,
        //     no side effects.
        label: "#314 Graveyard picker: Animate Dead (any) + Resurrection (you)",
        cards: [
            {
                name: "Animate Dead",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Resurrection",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Gray Ogre",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Hill Giant",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Counter display (CR 122) — verify counters render on the board and in
        // the card preview:
        //   • Grizzly Bears carries two +1/+1 counters (folds to 4/4 — the
        //     P/T stack shows the buffed value, a green "+1/+1 ×2" badge sits
        //     top-left).
        //   • Triskelion shows its three +1/+1 counters.
        //   • Hover/long-press any of them: the preview lists a "Counters"
        //     section. Named (non-P/T) counters render with a neutral tone.
        label: "Counters: +1/+1 and named counter display",
        cards: [
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                counters: { "+1/+1": 2 },
            },
            {
                name: "Triskelion",
                owner: "me" as const,
                counters: { "+1/+1": 3 },
            },
            { name: "Forest", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster A — sacrifice-as-activation-cost (#282, CR 602.1 /
        // 118.5). The activated-ability cost can require sacrificing a CHOSEN
        // permanent matching a filter:
        //   • Right-click Atog → "Sacrifice an artifact: +2/+2". The sacrifice
        //     picker opens (your artifacts ring up); click one to sacrifice it
        //     and resolve the pump (the spent artifact goes to the graveyard).
        //   • Right-click Priest of Yawgmoth (during a main phase) → "{T}, Sac
        //     an artifact: Add {B} = sacrificed mv". Sacrifice the {3} Yotian
        //     Soldier and three black mana enter your pool.
        //   • Right-click Orcish Mechanics → "{T}, Sac an artifact: 2 damage any
        //     target"; pick the sacrifice, then a target. Ashnod's Altar adds
        //     {C}{C} by sacrificing a creature.
        //   • Advance to your UPKEEP and right-click Gate to Phyrexia (once per
        //     turn) or Dwarven Weaponsmith for the upkeep-restricted abilities.
        // Trying to activate with no matching permanent is rejected.
        label: "Antiquities A: sacrifice-as-cost engines (Atog / Altar / Priest)",
        cards: [
            { name: "Atog", owner: "me" as const },
            { name: "Ashnod's Altar", owner: "me" as const },
            { name: "Orcish Mechanics", owner: "me" as const },
            { name: "Sage of Lat-Nam", owner: "me" as const },
            { name: "Priest of Yawgmoth", owner: "me" as const },
            { name: "Dwarven Weaponsmith", owner: "me" as const },
            { name: "Gate to Phyrexia", owner: "me" as const },
            { name: "Ornithopter", owner: "me" as const, count: 2 },
            { name: "Yotian Soldier", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Triskelion", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster B — "ability activated" trigger event (#285,
        // CR 602.1 / 603.2). Three punishers react to BOTH halves of "an
        // artifact is used": the artifact becoming tapped (PERMANENT_TAPPED)
        // AND a non-{T} ability being activated (ABILITY_ACTIVATED):
        //   • You control Haunting Wind ("1 dmg to that artifact's controller")
        //     and Powerleech ("gain 1 when an OPPONENT'S artifact is used").
        //   • The opponent controls Triskelion (3 +1/+1 counters). Pass to give
        //     the opponent priority and right-click Triskelion → "Remove a +1/+1
        //     counter: deal 1 damage". This is a NON-{T} ability, so it fires
        //     ABILITY_ACTIVATED: Haunting Wind deals 1 to the opponent and
        //     Powerleech gains you 1.
        //   • Right-click the opponent's Millstone → "{T}, {2}: mill 2". That is
        //     a {T} ability, so the TAP half (PERMANENT_TAPPED) fires the same
        //     two triggers — no double count.
        //   • Cast Artifact Possession (in your hand) onto the opponent's
        //     Triskelion; now activating Triskelion ALSO deals 2 (the Aura).
        label: "Antiquities B: ability-activated punishers (Haunting Wind / Powerleech / Artifact Possession)",
        cards: [
            { name: "Haunting Wind", owner: "me" as const },
            { name: "Powerleech", owner: "me" as const },
            {
                name: "Artifact Possession",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 3 },
            {
                name: "Triskelion",
                owner: "opp" as const,
                counters: { "+1/+1": 3 },
            },
            { name: "Millstone", owner: "opp" as const },
            { name: "Island", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster C+D — continuous artifact-source prevention /
        // redirection + artifact-damage tracking (#287, CR 615 / 614 / 611 /
        // 120.3). Source-type-filtered protection from artifacts:
        //   • You control Argothian Pixies, Argothian Treefolk, Martyrs of
        //     Korlis, and Grizzly Bears wearing Artifact Ward; Reverse Polarity
        //     sits in your hand.
        //   • The opponent controls Triskelion (3 +1/+1 counters), an artifact
        //     creature, and Grapeshot Catapult, a noncreature artifact source.
        //   • Pass priority and ping with Triskelion / Grapeshot Catapult:
        //     damage to the Pixies (artifact-creature filter), the Treefolk or
        //     the warded Bears (artifact-source filter) is fully prevented;
        //     direct damage to YOU is redirected onto the untapped Martyrs of
        //     Korlis instead. Targeting the warded Bears with Triskelion's
        //     ability is illegal (can't be targeted by abilities from artifact
        //     sources).
        //   • The redirected/landed artifact damage accrues to the per-turn
        //     artifact tally; cast Reverse Polarity to gain twice that amount.
        //   • Tap Martyrs (e.g. attack with it) to see redirection stop while
        //     it's tapped.
        label: "Antiquities C+D: artifact-source prevention / redirection + Reverse Polarity",
        cards: [
            { name: "Argothian Pixies", owner: "me" as const },
            { name: "Argothian Treefolk", owner: "me" as const },
            { name: "Martyrs of Korlis", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            // Artifact Ward sits in hand: cast it onto the Grizzly Bears to
            // attach the Aura and enable its host protections.
            {
                name: "Artifact Ward",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Reverse Polarity",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
            {
                name: "Triskelion",
                owner: "opp" as const,
                counters: { "+1/+1": 3 },
            },
            { name: "Grapeshot Catapult", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster F — animate noncreature artifact (#288, CR 613.1f
        // ability-loss + CR 205 type-add + CR 604.3 mana-value P/T + CR 500.2
        // "until your next upkeep").
        //   • Titania's Song is in play: every NONCREATURE artifact you control
        //     (Sol Ring, Ivory Tower) is now an artifact creature with P/T equal
        //     to its mana value AND has lost all abilities — the Sol Ring no
        //     longer taps for mana and Ivory Tower's upkeep trigger is gone. The
        //     opponent's Sol Ring is animated/silenced too. Ornithopter (a
        //     PRINTED artifact creature) is untouched — it keeps flying / 0/2.
        //   • Xenic Poltergeist (a 1/1 Spirit) is untapped: right-click it →
        //     "{T}: animate target noncreature artifact until your next upkeep".
        //     Target the opponent's Sol Ring — it becomes a 1/1 creature but
        //     KEEPS its mana ability (Xenic does not strip abilities). The
        //     animation ends as your next upkeep begins.
        label: "Antiquities F: animate noncreature artifact (Titania's Song / Xenic Poltergeist)",
        cards: [
            { name: "Titania's Song", owner: "me" as const },
            { name: "Xenic Poltergeist", owner: "me" as const },
            { name: "Sol Ring", owner: "me" as const },
            { name: "Ivory Tower", owner: "me" as const },
            { name: "Ornithopter", owner: "me" as const },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Triskelion", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster N — grant a triggered ability to a filtered set
        // (#291, CR 113.1 granted ability + CR 611 continuous filtered set +
        // CR 603.6a your-upkeep trigger + CR 118 mana payment). Energy Flux:
        // "All artifacts have 'At the beginning of your upkeep, sacrifice this
        // artifact unless you pay {2}.'"
        //   • Energy Flux is in play. EVERY artifact (yours and the opponent's:
        //     Sol Ring, Ivory Tower, the opponent's Sol Ring) now shows the
        //     granted upkeep trigger in its zoom panel. Ornithopter is also an
        //     artifact, so it is taxed too; Grizzly Bears (not an artifact) is
        //     untouched.
        //   • Pass to YOUR upkeep: a separate "Pay {2} or sacrifice this
        //     artifact?" trigger goes on the stack PER artifact you control.
        //     Two Islands cover one {2} payment — pay to keep that artifact and
        //     decline on the next to watch it hit the graveyard.
        //   • The grant is recomputed continuously: cast a fresh artifact and
        //     it gains the trigger; if Energy Flux leaves play the trigger
        //     detaches from every artifact.
        label: "Antiquities N: grant trigger to filtered set (Energy Flux)",
        cards: [
            { name: "Energy Flux", owner: "me" as const },
            { name: "Sol Ring", owner: "me" as const },
            { name: "Ivory Tower", owner: "me" as const },
            { name: "Ornithopter", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster G — choose-body-on-entry creatures (#289, CR
        // 614.12). Both creatures pick their body "as they enter" via an
        // option-pick prompt; the chosen base P/T (and Primal Clay's keyword /
        // subtype) persists.
        //   • Cast Primal Clay from hand (5 Mountains cover {4}). As it
        //     resolves, the option prompt offers "3/3", "2/2 flying", and
        //     "1/6 Wall (defender)". Pick one and watch the body settle on the
        //     battlefield with the right P/T / keyword.
        //   • Cast Shapeshifter ({6}) — the prompt offers numbers 0–7
        //     (label "N/(7−N)"). Pick e.g. 3 → it enters as a 3/4. Picking 7
        //     (7/0) makes it die to the 0-toughness SBA.
        //   • After Shapeshifter is on the board, pass to your next upkeep: the
        //     "may re-choose a number" prompt appears (Yes → pick a new number
        //     to re-set its P/T; No keeps the current body).
        label: "Antiquities G: choose body on entry (Primal Clay / Shapeshifter)",
        cards: [
            {
                name: "Primal Clay",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Shapeshifter",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 7 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster J — activated-ability cost reduction (#290, CR
        // 601.2f / 118.7). Power Artifact (Aura) reduces the enchanted
        // artifact's activated-ability mana costs by {2}, floored at one mana.
        //   • Cast Power Artifact from hand ({U}{U}, covered by the two
        //     Islands) targeting Dragon Engine.
        //   • Activate Dragon Engine's "{2}: +1/+0 until end of turn": with the
        //     aura attached the payment site now asks for only {1} (the
        //     two-generic reduction clamps to the one-mana floor), so a single
        //     land covers it instead of two.
        //   • Compare: detach (e.g. destroy the aura) or use the second,
        //     unenchanted Dragon Engine — its ability still costs the full {2}.
        label: "Antiquities J: activated-ability cost reduction (Power Artifact)",
        cards: [
            {
                name: "Power Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Dragon Engine", owner: "me" as const },
            { name: "Dragon Engine", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Triskelion", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next battlefield tap/pay (#272). The spatial board's
        // battlefield is now interactive (?board=next) — load this and switch
        // the URL to ?board=next to exercise the foundational tap/pay slice:
        //   • Click an untapped Mountain → it taps for mana; click it again →
        //     it untaps (plain tapUntap, no payment in progress).
        //   • Click Black Lotus → the mana-choice picker opens; pick a color →
        //     three of that color enter the pool (multi-color source, floating
        //     mana mode).
        //   • Click Fireball in hand to cast it, then click a Mountain to pay
        //     part of the cost (tapForPayment); click the tapped Mountain to
        //     refund it (untapForPayment).
        //   • An illegal tap (e.g. without priority) surfaces the validation
        //     toast mounted in the spatial board root.
        // Same dispatches as the classic board — both consume
        // useBattlefieldInteraction.
        label: "Board next: battlefield tap / pay (lands + Black Lotus)",
        cards: [
            { name: "Fireball", owner: "me" as const, zone: "hand" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Black Lotus", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 5 },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next combat declaration (#281). The spatial board now surfaces
        // attacker / blocker declaration and the combat panels — load this and
        // switch the URL to ?board=next, then advance to combat:
        //   • DECLARE_ATTACKERS (your turn): click an untapped creature → it
        //     toggles as an attacker (toggleAttacker). A creature that "must
        //     attack if able" (Juggernaut) can't be deselected — the validation
        //     toast explains why.
        //   • A multi-color source that is also a creature (Birds of Paradise)
        //     is DECLARED as an attacker on click, NOT opening its mana picker.
        //   • DECLARE_BLOCKERS (opponent attacking): click your creature to
        //     declare it as a blocker (selectBlocker), then click the attacker
        //     it should block (assignBlockerTarget).
        //   • The band-formation panel appears during attacker declaration; the
        //     damage-assignment panel appears at the combat-damage step. Same
        //     dispatches + panels as the classic board.
        label: "Board next: combat declaration (attackers / blockers / damage)",
        cards: [
            { name: "Juggernaut", owner: "me" as const },
            { name: "Birds of Paradise", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Gray Ogre", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next combat ARROWS (combat-read). Load with ?board=next, then in
        // your turn declare attackers and pass to blockers to exercise the
        // blocker → attacker arrows + hover highlight:
        //   • Band: the two Benalish Hero (banding) + Gray Ogre can attack as a
        //     single band (CR 702.21) — declare all three, form the band.
        //   • Solo: Hill Giant attacks alone (no banding).
        //   • Opponent then multi-blocks: assign 2-3 blockers onto one attacker
        //     to get crossing arrows, and one blocker each onto others.
        // Hover any arrow OR any creature: the whole combat cluster lights
        // (banding-aware) and everything else dims. The numeric combat-group
        // badge is gone — the arrows convey the grouping.
        label: "Board next: arrows — combat (banding + multi-block)",
        cards: [
            { name: "Benalish Hero", owner: "me" as const, count: 2 },
            { name: "Gray Ogre", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 3 },
            { name: "Gray Ogre", owner: "opp" as const },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Bands with other [quality] (CR 702.22j, #381). Load with ?board=next:
        //   • Adventurers' Guildhouse grants "bands with other legendary
        //     creatures" to your GREEN legendary creatures (Jasmine Boreal,
        //     Marhault Elsdragon, Jerrard) — they all light up with the ⟡ banding
        //     marker in the band-formation panel.
        //   • Advance to DECLARE_ATTACKERS, declare two of them as attackers, and
        //     form a band: because both are legendary and one carries the granted
        //     keyword, the band is LEGAL (CR 702.22j). The non-green / non-
        //     legendary creature (Hill Giant) cannot join — the band stays illegal
        //     if you add it.
        //   • Activate Master of the Hunt ({2}{G}{G}) to mint Wolves-of-the-Hunt
        //     tokens; two of them band together via the name quality.
        //   • Shelkin Brownie ({T}) strips a target's "bands with other" abilities
        //     until end of turn — tap it targeting a granted legend and watch the
        //     marker disappear.
        label: "Bands with other [quality] — legendary band + Wolves (CR 702.22j)",
        cards: [
            { name: "Adventurers' Guildhouse", owner: "me" as const },
            { name: "Jasmine Boreal", owner: "me" as const },
            { name: "Marhault Elsdragon", owner: "me" as const },
            { name: "Jerrard of the Closed Fist", owner: "me" as const },
            { name: "Master of the Hunt", owner: "me" as const },
            { name: "Shelkin Brownie", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 3 },
            { name: "Forest", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next STACK arrows (target + counter). Load with ?board=next:
        //   • You: cast Lightning Bolt (3 Mountains untapped) at the opponent's
        //     Grizzly Bears or at the opponent → a stack → target arrow.
        //   • Opponent: holds Counterspell (3 Islands untapped); counter the
        //     Bolt → a stack → stack arrow (counter → spell).
        // Hover the arrow (or, for targets, the targeted card) to highlight the
        // direct 1-hop relationship.
        label: "Board next: arrows — stack (bolt vs counterspell)",
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            {
                name: "Counterspell",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Counterspell",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "opp" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next activated abilities (#278). The spatial board's battlefield
        // card now carries the same ability affordance as the classic board —
        // load this and switch the URL to ?board=next:
        //   • Right-click (or long-press) Prodigal Sorcerer → the ability menu /
        //     action-sheet lists "{T}: deal 1 damage"; pick it → the target
        //     selection starts. Hold Ctrl/Cmd while picking to keep priority.
        //   • Right-click Basalt Monolith → both its mana entry ("{T}: Add
        //     {C}{C}{C}") and its "{3}: Untap" stack ability appear. Tap for
        //     mana, then the mana entry flips to "Untap and refund mana".
        //   • Right-click the opponent's Ifh-Bíff Efreet while you hold priority
        //     → only its "any player may activate" {G} ability is offered
        //     (CR 113.3c); pass priority and the menu goes empty.
        // Every entry dispatches the SAME activateAbility / tapUntap args as the
        // classic board — both consume useBattlefieldInteraction.
        label: "Board next: activate abilities (Tim / Basalt / any-player)",
        cards: [
            { name: "Prodigal Sorcerer", owner: "me" as const },
            { name: "Basalt Monolith", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Ifh-Bíff Efreet", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next targeting + mid-resolution choice + additional cost (#279).
        // The spatial board's selection click-paths now mirror the classic
        // board — load this and switch the URL to ?board=next:
        //   • Cast Lightning Bolt → "Choose target" starts; the legal creatures
        //     ring up and clicking one dispatches selectTarget (illegal targets
        //     stay inert). [target selection]
        //   • Cast Metamorphosis ({G}, "As an additional cost, sacrifice a
        //     creature") → pick one of your creatures on the battlefield to
        //     dispatch selectAdditionalCost (CR 117.9). [additional cost]
        //   • Cast Balance → mid-resolution it asks each player to keep some
        //     of their permanents and then some hand cards (CR 608.2): click
        //     your battlefield permanents to toggle the keep set, then click
        //     your HAND cards to toggle the keep set — both highlight with the
        //     choice ring and submit via Done. The hand pick proves spatial
        //     hand cards become choice-selectable (not a cast). [battlefield +
        //     hand choice]
        // Every click dispatches the SAME mutation / toggles the SAME buffer as
        // the classic board — both consume useBattlefieldInteraction /
        // usePendingChoiceBuffer.
        label: "Board next: target / additional cost / mid-resolution choice",
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Metamorphosis",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Balance", owner: "me" as const, zone: "hand" as const },
            { name: "Gray Ogre", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Gray Ogre", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 5 },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next player target + life totals + priority ring (#280). The
        // spatial board now mounts the player nameplate (life + name) at each
        // seat's edge — load this and switch the URL to ?board=next:
        //   • Both players' life totals + names are visible, anchored top
        //     (opponent) and bottom (you); the priority holder shows the
        //     seat-coloured ring (emerald = you, amber = opponent).
        //   • Cast Lightning Bolt ("3 damage to any target") → during targeting
        //     the players ring up; click a player's nameplate to dispatch
        //     selectTarget with targetType "player" (burn to the face).
        //   • Tap Cuombajj Witches ("1 damage to any target — opponent's
        //     choice") → mid-resolution the opponent picks the target; an
        //     eligible player's nameplate toggles the pending-choice buffer
        //     (CR 115.4 / 608.2) rather than selectTarget.
        // Same dispatch / toggle as the classic player-life chrome — both
        // consume usePlayerInteraction.
        label: "Board next: player target + life totals + priority ring",
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Cuombajj Witches", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board-next hand UX (#271). A full, varied hand on the spatial board
        // (?board=next) to exercise the four hand fixes end-to-end:
        //   • Hover a hand card → the zoom preview appears (parity w/ the
        //     battlefield card).
        //   • Drag a card sideways → the hand reorders, snapping the card to the
        //     slot under the drop position (view-only; no zone change).
        //   • Flick a spell/land up a modest amount → it commits (lowered
        //     threshold); a tiny nudge does not.
        //   • While dragging up, the card stays visible — it never escapes into
        //     the band above the hand.
        // Six Mountains are in play so the burn spells and the land drop are all
        // legal, making click and drag both live for several cards at once.
        label: "Board next: hand UX (hover / reorder / drag-commit)",
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Fireball", owner: "me" as const, zone: "hand" as const },
            {
                name: "Disintegrate",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Gray Ogre", owner: "me" as const, zone: "hand" as const },
            { name: "Mountain", owner: "me" as const, zone: "hand" as const },
            { name: "Mountain", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 4 (#191) — coin flip (CR 705). Flips route through the
        // seeded PRNG so they are deterministic on replay.
        //   • Bottle of Suleiman ({4} artifact): activate "{1}, Sacrifice this
        //     artifact" — win the flip → a 5/5 flying Djinn token; lose → 5
        //     damage to you.
        //   • Mijae Djinn ({R}{R}{R}, 6/3): attack with it — lose the flip and
        //     it is removed from combat and tapped.
        //   • Ydwen Efreet ({R}{R}{R}, 3/6, opponent-controlled): attack into
        //     it with your Grizzly Bears and let Ydwen block — lose the flip
        //     and Ydwen leaves combat, can't block this turn, and the Bears
        //     (solely blocked by it) become unblocked and hit the opponent.
        label: "ARN: coin flip (Bottle / Mijae / Ydwen)",
        cards: [
            { name: "Bottle of Suleiman", owner: "me" as const },
            { name: "Mijae Djinn", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Ydwen Efreet", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Random Reveal tracer (#301, CR 705 / ADR 0023) — Bottle of Suleiman
        // pinned to WIN. Activate "{1}, Sacrifice this artifact": the coin
        // overlay animates, lands on WIN, then a 5/5 flying Djinn token enters.
        // rngSeed 1 → first flipCoin() = heads (win). One Island funds the {1}.
        label: "Random Reveal: Bottle of Suleiman (WIN)",
        cards: [
            { name: "Bottle of Suleiman", owner: "me" as const },
            { name: "Island", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        rngSeed: 1,
    },
    {
        // Random Reveal tracer (#301) — Bottle of Suleiman pinned to LOSE.
        // Activate the ability: the overlay lands on LOSE, then the artifact
        // deals 5 damage to you (20 → 15). rngSeed 7 → first flipCoin() = tails.
        label: "Random Reveal: Bottle of Suleiman (LOSE)",
        cards: [
            { name: "Bottle of Suleiman", owner: "me" as const },
            { name: "Island", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        rngSeed: 7,
    },
    {
        // Random Reveal: Mijae Djinn attack trigger (#302, CR 705 / ADR 0023)
        // pinned to WIN. Mijae Djinn (6/3) is untapped on your battlefield in
        // precombat main. Advance to combat and declare Mijae as an attacker:
        // its ATTACKERS_DECLARED trigger goes on the stack, the coin overlay
        // animates and lands on WIN, and Mijae stays attacking (untapped).
        // rngSeed 1 → first flipCoin() = heads (win). This exercises the
        // combat-trigger timing path (trigger on the stack at declare-attackers),
        // distinct from Bottle's activated-ability path.
        label: "Random Reveal: Mijae Djinn attack (WIN — stays attacking)",
        cards: [{ name: "Mijae Djinn", owner: "me" as const }],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        rngSeed: 1,
    },
    {
        // Random Reveal: Mijae Djinn attack trigger (#302) pinned to LOSE.
        // Advance to combat and declare Mijae as an attacker: the coin overlay
        // lands on LOSE, then Mijae is removed from combat and tapped — only
        // after the reveal. rngSeed 7 → first flipCoin() = tails (lose).
        label: "Random Reveal: Mijae Djinn attack (LOSE — removed + tapped)",
        cards: [{ name: "Mijae Djinn", owner: "me" as const }],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        rngSeed: 7,
    },
    {
        // Random Reveal: Ydwen Efreet block trigger (#303, CR 705 / 509.1h /
        // ADR 0023) pinned to WIN. You control a Grizzly Bears; the opponent
        // controls Ydwen Efreet. Attack with the Bears, then (in solo mode)
        // switch to the opponent and block with Ydwen. The "Whenever Ydwen
        // blocks" trigger flips a coin: the overlay animates and lands on WIN,
        // so Ydwen STAYS blocking (the Bears deal no damage to the defender).
        // rngSeed 1 → first flipCoin() = heads (win). This exercises the
        // block-trigger timing path (trigger on the stack at declare-blockers),
        // distinct from Mijae's attack-trigger and Bottle's activated paths.
        label: "Random Reveal: Ydwen Efreet block (WIN — stays blocking)",
        cards: [
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Ydwen Efreet", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        rngSeed: 1,
    },
    {
        // Random Reveal: Ydwen Efreet block trigger (#303) pinned to LOSE.
        // Same setup as the WIN tracer, but the coin lands on LOSE: Ydwen is
        // removed from combat and can't block this turn, and the Bears it was
        // solely blocking become unblocked (CR 509.1h) and hit the defender for
        // 2. rngSeed 7 → first flipCoin() = tails (lose).
        label: "Random Reveal: Ydwen Efreet block (LOSE — unblocks attacker)",
        cards: [
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Ydwen Efreet", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        rngSeed: 7,
    },
    {
        // ARN Batch 9 (#188) — Jihad ({W}{W}{W} Enchantment): "As it enters,
        // choose a color and an opponent. White creatures get +2/+1 as long as
        // the chosen player controls a nontoken permanent of the chosen color.
        // When the chosen player controls no nontoken permanents of the chosen
        // color, sacrifice it." Cast Jihad, choosing RED (the opponent's Mijae
        // Djinn is red) — your white Repentant Blacksmith jumps from 1/2 to
        // 3/3. Then destroy the opponent's Mijae Djinn (e.g. Psionic Blast):
        // with no red permanent left, Jihad sacrifices itself at the next
        // state check.
        label: "ARN: Jihad (conditional white anthem + self-sac)",
        cards: [
            { name: "Jihad", owner: "me" as const, zone: "hand" as const },
            { name: "Repentant Blacksmith", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 3 },
            {
                name: "Psionic Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mijae Djinn", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 9 (#189) — Aladdin's Lamp ({10} Artifact): "{X}, {T}: The
        // next time you would draw a card this turn, instead look at the top X
        // cards of your library, put all but one of them on the bottom in a
        // random order, then draw a card. X can't be 0." Starts in your UPKEEP
        // with the Lamp untapped and four lands. Activate it for X=3 (tap 3
        // lands), then pass priority to your draw step: the natural draw is
        // replaced — look at the top 3, keep one, the other two are bottomed at
        // random, and you draw the kept card.
        label: "ARN: Aladdin's Lamp (next-draw look 3 keep 1)",
        cards: [
            { name: "Aladdin's Lamp", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "UPKEEP",
        landCount: 0,
        libraryCount: 12,
        turn: 2,
    },
    {
        // ARN Batch 9 (#187) — Erg Raiders ({1}{B}, 2/3): "At the beginning of
        // your end step, if it didn't attack this turn, it deals 2 damage to
        // you. This ability doesn't trigger if it came under your control this
        // turn." Two Raiders are already in play (not summoning sick, since
        // the scenario starts mid-turn). Pass to your end step WITHOUT
        // attacking: each Raiders deals 2 to you (you drop 4 total). To see
        // the exemption, declare one as an attacker first — that one deals no
        // damage at end step while the idle one still pings you for 2.
        label: "ARN: end-step penalty (Erg Raiders)",
        cards: [
            { name: "Plains", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, zone: "hand" as const },
            {
                name: "Mahamoti Djinn",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Air Elemental",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Air Elemental",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Air Elemental",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Air Elemental",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Counterspell",
                owner: "opp" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN (#186) — Jandor's Ring ({2},{T}, discard the last card you drew
        // this turn: Draw a card). The Ring is on your battlefield with two
        // Islands for the {2}. A Grizzly Bears sits in hand and is marked as
        // "the last card you drew this turn" (markLastDrawn), so the discard
        // cost is payable immediately — activate the Ring to discard it and
        // draw a fresh card. Once the marked card leaves your hand the ability
        // becomes unactivatable until you draw again (e.g. next draw step).
        label: "ARN: Jandor's Ring (discard last drawn → draw)",
        cards: [
            { name: "Jandor's Ring", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 5,
        markLastDrawn: true,
    },
    {
        // ARN Batch 9 (#181) — Magnetic Mountain ({1}{R}{R} enchantment): blue
        // creatures don't untap during their controllers' untap steps (CR 502.1
        // hard skip). At each player's upkeep that player may choose any number
        // of their tapped blue creatures and pay {4} each to untap them. Your
        // two Flying Men start tapped; advance to your upkeep, choose them, and
        // pay {8} from the Mountains/Islands to untap. Pass through your untap
        // step to confirm they stay tapped without paying.
        label: "ARN: untap lock (Magnetic Mountain)",
        cards: [
            { name: "Magnetic Mountain", owner: "me" as const },
            {
                name: "Flying Men",
                owner: "me" as const,
                tapped: true,
                count: 2,
            },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Flying Men", owner: "opp" as const, tapped: true },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // ARN Batch 9 (#185) — Abu Ja'far ({W}, 0/1 Human): "When this creature
        // dies, destroy all creatures blocking or blocked by it. They can't be
        // regenerated." (CR 603.2 death trigger / 603.10 last known info). You
        // control Abu Ja'far; the opponent has Grizzly Bears (2/2). Attack with
        // Abu Ja'far and let the Bears block: Abu (0 power) deals no damage but
        // takes 2 and dies, and its death trigger destroys the blocking Bears —
        // even though Abu is already in the graveyard when it resolves. Give the
        // opponent's Bears a Regeneration shield in play (none here) and they
        // still die: the destroy is "can't be regenerated". The opponent's
        // second creature (Hill Giant) is left alone — only the combat partner
        // is destroyed.
        label: "ARN: dies-destroys-blocker (Abu Ja'far)",
        cards: [
            { name: "Abu Ja'far", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 9 (#184) — Guardian Beast ({3}{B}, 2/4). While the Beast is
        // UNTAPPED, your noncreature artifacts can't be enchanted, can't be the
        // targets of spells or abilities, have indestructible, and their control
        // can't be changed (CR 611 continuous `permanent-guard`). You control the
        // Beast and a Black Lotus; the opponent holds Shatter (destroy), Steal
        // Artifact (control-change aura) and Disenchant in hand. With the Beast
        // untapped, none can touch the Lotus — Shatter/Disenchant fizzle on
        // resolution and the Lotus isn't even a legal click; Steal Artifact can't
        // attach. Tap the Beast (right-click → Tap, or attack with it) and every
        // gate opens: the Lotus becomes destroyable, targetable, and stealable.
        label: "ARN: artifact shield (Guardian Beast)",
        cards: [
            { name: "Guardian Beast", owner: "me" as const },
            { name: "Black Lotus", owner: "me" as const },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Shatter", owner: "opp" as const, zone: "hand" as const },
            {
                name: "Steal Artifact",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 2 },
            { name: "Island", owner: "opp" as const, count: 3 },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 9 (#183) — Ifh-Bíff Efreet ({2}{G}{G}, 3/3 flyer):
        // "{G}: This creature deals 1 damage to each creature with flying and
        // each player. Any player may activate this ability." (CR 113.3c /
        // 120.3). The Efreet belongs to the OPPONENT, but YOU can still fire it
        // — right-click it to find the {G} ability in its menu (surfaced on the
        // opponent's permanent because it is any-player-activatable). Pay {G}
        // from a Forest. The ping hits both players and every flyer (the Efreet
        // itself, both Flying Men) but spares the Grizzly Bears. The 1/1 Flying
        // Men die; the Efreet and ground creatures survive.
        label: "ARN: any-player ability (Ifh-Bíff Efreet)",
        cards: [
            { name: "Ifh-Bíff Efreet", owner: "opp" as const },
            { name: "Flying Men", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Flying Men", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 9 (#182) — Cuombajj Witches ({B}{B}, 1/3): "{T}: This
        // creature deals 1 damage to any target and 1 damage to any target of
        // an opponent's choice." (CR 115.4 / 608.2). Tap the Witches and pick
        // your "any target" (ping 1). The opponent then gets a
        // choose-damage-target prompt to pick the second target — a damageable
        // permanent on any battlefield OR a player. Both pings land once the
        // opponent confirms. Swamps are only flavour; the ability costs no mana.
        label: "ARN: opponent-chosen ping (Cuombajj Witches)",
        cards: [
            { name: "Cuombajj Witches", owner: "me" as const },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Serendib Efreet", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Llanowar Elves", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 9 (#180) — Metamorphosis ({G} sorcery): as an additional
        // cost sacrifice a creature, then add X mana of one chosen color where
        // X = 1 + the sacrificed creature's mana value, spendable only on
        // creature spells (CR 106.6). Tap the Forest, cast Metamorphosis,
        // sacrifice the Grizzly Bears (MV 2 -> X = 3), pick a color, then cast
        // the second Grizzly Bears from hand paying with the restricted mana.
        label: "ARN: restricted mana (Metamorphosis)",
        cards: [
            {
                name: "Metamorphosis",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Forest", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster M (#283) — Mishra's Workshop ({T}: Add {C}{C}{C},
        // spend only to cast artifact spells; CR 106.6). Tap the Workshop to
        // float three restricted colorless mana, then cast an artifact spell
        // (Su-Chi {4} or Urza's Chalice) paying with it — the restricted mana
        // is consumed first. Try casting the noncreature/non-artifact spell
        // (Grizzly Bears is a creature, not an artifact): the restricted mana
        // is NOT offered for it. The restricted mana empties at end of step.
        label: "Antiquities M: restricted mana (Mishra's Workshop)",
        cards: [
            { name: "Mishra's Workshop", owner: "me" as const },
            { name: "Su-Chi", owner: "me" as const, zone: "hand" as const },
            {
                name: "Urza's Chalice",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Su-Chi", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster I (#284) — board-conditional mana (Urza land
        // trio; CR 106.1). Each land taps for {C}, but adds more when the
        // controller also controls the other two:
        //   • Tap a single Urza land → {C} (the set isn't assembled).
        //   • With Mine + Power Plant + Tower all in play, tap each:
        //     Mine → {C}{C}, Power Plant → {C}{C}, Tower → {C}{C}{C}
        //     (the assembled set yields seven colorless total).
        //   • The condition is per-controller and recomputes live: the
        //     opponent's lone Mine + Power Plant taps for only {C} each.
        //     Sacrifice/destroy a member and the others drop back to {C}.
        label: "Antiquities I: board-conditional mana (Urza land trio)",
        cards: [
            { name: "Urza's Mine", owner: "me" as const },
            { name: "Urza's Power Plant", owner: "me" as const },
            { name: "Urza's Tower", owner: "me" as const },
            { name: "Urza's Mine", owner: "opp" as const },
            { name: "Urza's Power Plant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster E — "for as long as this remains tapped" duration
        // + tap-lock (#286, CR 611.2 state-tied duration / CR 502.1 optional
        // untap). The buff/lock persists exactly while its source stays tapped:
        //   • Right-click Ashnod's Battle Gear → "{2},{T}: target creature you
        //     control +2/-2 while tapped"; target your Grizzly Bears (becomes
        //     4/0 → dies to the toughness SBA, so target the Yotian Soldier or a
        //     bigger body to watch it sit at +2/-2 while the Gear stays tapped).
        //   • Right-click Tawnos's Weaponry → "{2},{T}: target creature +1/+1
        //     while tapped"; target any creature.
        //   • Right-click Phyrexian Gremlins → "{T}: tap target artifact; it
        //     doesn't untap while the Gremlin stays tapped"; tap the opponent's
        //     Millstone to lock it down.
        //   • Pass to your UNTAP step: each tapped source PROMPTS "you may
        //     choose not to untap this" — decline to keep the buff/lock alive,
        //     accept to untap and end it. The locked Millstone stays tapped
        //     through its controller's untap step until the Gremlin untaps.
        label: "Antiquities E: while-tapped buff + tap-lock (Battle Gear / Weaponry / Gremlins)",
        cards: [
            { name: "Ashnod's Battle Gear", owner: "me" as const },
            { name: "Tawnos's Weaponry", owner: "me" as const },
            { name: "Phyrexian Gremlins", owner: "me" as const },
            { name: "Yotian Soldier", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Swamp", owner: "me" as const, count: 4 },
            { name: "Millstone", owner: "opp" as const },
            { name: "Triskelion", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 8 (#179) — phasing (CR 702.26, ADR 0021). Cast Oubliette
        // ({1}{B}{B}) and choose the opponent's Serendib Efreet: it phases out
        // (treated as though it doesn't exist — gone from the board, fires no
        // leaves trigger). Destroy or bounce your Oubliette and the creature
        // phases back in tapped. Swamps pay the cost.
        label: "ARN: phasing (Oubliette)",
        cards: [
            { name: "Oubliette", owner: "me" as const, zone: "hand" as const },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Serendib Efreet", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 7 (#178) — scheduled pay-or-suffer. Cyclone ({2}{G}{G}):
        // each of your upkeeps add a wind counter, then pay {G} per counter or
        // sacrifice it; if you pay it deals that many damage to each creature
        // and player. Drop of Honey ({G}): each upkeep destroy the least-power
        // creature (you choose among ties); it sacrifices when no creatures
        // remain. Nafs Asp ({G}, 1/1): when it damages a player they lose 1
        // life at their next draw step unless they pay {1}. Forests pay upkeep
        // costs.
        label: "ARN: pay-or-suffer (Cyclone / Drop of Honey / Nafs Asp)",
        cards: [
            { name: "Cyclone", owner: "me" as const },
            { name: "Drop of Honey", owner: "me" as const },
            { name: "Nafs Asp", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Flying Men", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 6 (#177) — Deserts. You control two Deserts ({T}: add {C};
        // {T} at end of combat: deal 1 to an attacking creature), Desert Nomads
        // (desertwalk + immune to Desert damage) and a Camel (banding; while
        // attacking, it and its band ignore Desert damage). Attack with the
        // Nomads (unblockable — the opponent has no Desert) and, in your end of
        // combat step, ping an attacker with a Desert; aim it at a band with
        // Camel to watch the prevention apply.
        label: "ARN: deserts (Desert / Desert Nomads / Camel)",
        cards: [
            { name: "Desert", owner: "me" as const, count: 2 },
            { name: "Desert Nomads", owner: "me" as const },
            { name: "Camel", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 2 (#174) — layer 7b set-base-P/T (CR 613.4b, ADR 0017).
        // Sorceress Queen ({T}: target other creature has base P/T 0/2) and
        // Island of Wak-Wak ({T}: target flyer has base power 0). Tap Sorceress
        // Queen on the opponent's Serendib Efreet to shrink it to 0/2, or tap
        // Island of Wak-Wak on the flyer to zero its power. A +1/+1 counter on
        // a 0/2 reads 1/3 — the set applies before the counter.
        label: "ARN: set base P/T (Sorceress Queen + Island of Wak-Wak)",
        cards: [
            { name: "Sorceress Queen", owner: "me" as const },
            { name: "Island of Wak-Wak", owner: "me" as const },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Serendib Efreet", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 5 (#176) — control-gain (CR 613.1b, layer 2). Aladdin
        // ({1}{R}{R},{T}) steals the opponent's Brass Man for as long as you
        // control Aladdin; Old Man of the Sea ({T}, tap it) steals a creature
        // with power <= 2 while it stays tapped (it reverts when Old Man
        // untaps). Ghazbán Ogre flips to whoever has strictly the most life at
        // their upkeep — you start behind on life so it leaves you.
        label: "ARN: control-gain (Aladdin / Old Man of the Sea / Ghazbán Ogre)",
        cards: [
            { name: "Aladdin", owner: "me" as const },
            { name: "Old Man of the Sea", owner: "me" as const },
            { name: "Ghazbán Ogre", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Brass Man", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 1 (#173) — combat tricks. You control two Grizzly Bears
        // and hold Army of Allah ({1}{W}{W}, attackers +2/+0), Piety ({2}{W},
        // blockers +0/+3) and Sandstorm ({G}, 1 damage to each attacking
        // creature). Declare an attack and pump with Army of Allah; on defense
        // cast Piety; or wipe a 1-toughness alpha strike with Sandstorm. Lands
        // are provided to pay for all three.
        label: "ARN: pump-combat tricks (Army of Allah / Piety / Sandstorm)",
        cards: [
            { name: "Grizzly Bears", owner: "me" as const, count: 2 },
            {
                name: "Army of Allah",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Piety", owner: "me" as const, zone: "hand" as const },
            { name: "Sandstorm", owner: "me" as const, zone: "hand" as const },
            { name: "Plains", owner: "me" as const, count: 3 },
            { name: "Forest", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 0,
    },
    {
        // ARN Batch 1 (#173) — "islands-matter". Dandân (4/1, can't attack
        // unless the defender controls an Island) and Island Fish Jasconius
        // (6/8, doesn't untap — pay {U}{U}{U} on upkeep to untap) both
        // self-sacrifice when you control no Islands. The opponent has an
        // Island so the attack restriction is satisfied; remove your own
        // Islands to watch the state-trigger sacrifice fire.
        label: "ARN: islands-matter (Dandân + Island Fish Jasconius)",
        cards: [
            { name: "Dandân", owner: "me" as const },
            { name: "Island Fish Jasconius", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Island", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 1 (#173) — signature creatures & utility. Juzám Djinn and
        // Serendib Efreet ping you each upkeep; King Suleiman ({T}: destroy
        // target Djinn or Efreet) answers the opponent's Mijae-sized threats;
        // Wyluli Wolf pumps; Rukh Egg leaves a 4/4 flier when it dies.
        label: "ARN: Djinns/Efreets + King Suleiman + Rukh Egg",
        cards: [
            { name: "King Suleiman", owner: "me" as const },
            { name: "Wyluli Wolf", owner: "me" as const },
            { name: "Rukh Egg", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Juzám Djinn", owner: "opp" as const },
            { name: "Serendib Efreet", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ARN Batch 3 (#175) — damage prevention / replacement / destroy-
        // replacement / reflect. You control Oasis ({T}: prevent next 1 to a
        // creature), Ali from Cairo (your life can't drop below 1), Ebony Horse
        // ({2},{T}: untap an attacker and prevent its combat damage both ways),
        // and Pyramids ({2}: destroy an Aura on a land OR save a land from the
        // next destruction this turn). Hold Eye for an Eye ({W}{W}: the chosen
        // source's next damage to you is also dealt to its controller). The
        // opponent has a Prodigal Sorcerer to ping with and a Stone Rain to
        // blow up your land — point Pyramids' save mode at the targeted land.
        label: "ARN: prevention/replacement (Oasis / Ali from Cairo / Ebony Horse / Eye for an Eye / Pyramids)",
        cards: [
            { name: "Oasis", owner: "me" as const },
            { name: "Ali from Cairo", owner: "me" as const },
            { name: "Ebony Horse", owner: "me" as const },
            { name: "Pyramids", owner: "me" as const },
            {
                name: "Eye for an Eye",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Prodigal Sorcerer", owner: "opp" as const },
            {
                name: "Stone Rain",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Blocked is combat state, not blocker count (#172, CR 509.1h/510.1c).
        // You control a War Mammoth (3/3 trample) and Grizzly Bears (2/2, no
        // trample); the opponent has two Grizzly Bears to block with. Attack
        // with both, let each be blocked, then Lightning Bolt both blockers
        // BEFORE the damage step. The attackers stay blocked even though their
        // blockers are gone: the War Mammoth tramples its full 3 through to the
        // opponent, but the vanilla Grizzly Bears deals NO damage to the player
        // (a blocked creature with no blocker left and no trample). Two Bolts
        // and two Mountains are provided.
        label: "Blocked stays blocked: trample tramples, vanilla deals 0 (#172)",
        cards: [
            { name: "War Mammoth", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 0,
    },
    {
        // Beta-original cards (ADR 0014): cards first printed in LEB with no
        // Alpha counterpart. Volcanic Island is the tenth ABUR dual ({T}: add
        // {U} or {R}); Circle of Protection: Black is the missing CoP. Tap a
        // Volcanic Island for {U}/{R}, then activate CoP: Black ({1}) targeting
        // the opponent's black Hypnotic Specter to prevent its damage to you.
        label: "Beta-original: Volcanic Island + Circle of Protection: Black",
        cards: [
            { name: "Volcanic Island", owner: "me" as const, count: 2 },
            { name: "Circle of Protection: Black", owner: "me" as const },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Auto-tap mana (#154). Shivan Dragon ({4}{R}{R}) sits in hand with a
        // mixed mana base: 3 Mountains, a Volcanic Island (U/R dual), a Mox Ruby
        // and a Sol Ring ({C}{C}). Cast the Dragon, then hit "Auto-tap" on the
        // payment banner — it picks a minimal valid combination (Sol Ring covers
        // 2 generic in one tap; the dual is steered to {R}; sources are never
        // over-tapped) and commits the spell in one action. Manual tapping still
        // works. Sacrifice/side-effect mana abilities (Black Lotus) are excluded.
        label: "Auto-tap: pay a mixed cost in one click (#154)",
        cards: [
            {
                name: "Shivan Dragon",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Volcanic Island", owner: "me" as const },
            { name: "Mox Ruby", owner: "me" as const },
            { name: "Sol Ring", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Face-down permanents (CR 708.2, ADR 0013). Each side has a creature
        // placed face down: it reads as a 2/2 colourless nameless vanilla
        // creature. You see your own face-down card's true identity; the
        // opponent's face-down creature shows only the generic 2/2 placeholder.
        // (No cast path or turn-up yet — those are separate slices.)
        label: "Face-down permanents: hidden-identity 2/2 (CR 708.2)",
        cards: [
            { name: "Shivan Dragon", owner: "me" as const, faceDown: true },
            { name: "Serra Angel", owner: "opp" as const, faceDown: true },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Illusionary Mask masked-cast (CR 708.2, ADR 0013, #123). Activate
        // the Mask, spend {X} colourless, and choose an eligible creature from
        // hand (mana value ≤ X) to cast it face down as a 2/2. Only eligible
        // creatures are clickable: with 2 Mountains, X=2 makes Grizzly Bears
        // (mv 2) eligible but not Shivan Dragon (mv 6). The chosen creature
        // resolves into a face-down permanent the opponent sees as a 2/2.
        label: "Illusionary Mask: cast a creature face down ({X} → 2/2)",
        cards: [
            { name: "Illusionary Mask", owner: "me" as const },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Face-down turn-up (CR 708.9, ADR 0013, #124). Your face-down creature
        // is really a Hill Giant (3/3) but reads as a 2/2. The moment it would
        // deal/be dealt damage or become tapped it turns face up and acts as
        // the real 3/3. Move to combat and attack: it taps to attack → turns
        // up → deals 3 (not 2). Or tap it with Icy Manipulator to reveal it.
        label: "Face-down turn-up: attack/tap reveals the real creature (#124)",
        cards: [
            { name: "Hill Giant", owner: "me" as const, faceDown: true },
            { name: "Icy Manipulator", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Pile combat (CR 509.2 variant, ADR 0012). Raging River is on your
        // battlefield with two attackers. Move to combat and attack with both:
        // the trigger asks the opponent to divide their non-flying creatures
        // into a "left" and "right" pile (select the left pile), then asks you
        // to label your attackers (select the "left" attackers). A labelled
        // attacker can then be blocked only by flying creatures or creatures in
        // the matching pile.
        label: "Raging River: left/right pile combat (divide → label → block restriction)",
        cards: [
            { name: "Raging River", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Mesa Pegasus", owner: "opp" as const }, // flying — blocks any pile
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Text-changing effect (CR 612, layer 3). Cast Magical Hack ({U}) and
        // pick a basic land type: on your Forest, change it to Island and it
        // taps for {U} instead of {G}; on Shanodin Dryads (forestwalk), change
        // Forest → Island and its evasion now keys off the opponent's Island
        // (move to combat and attack — the Dryads become unblockable). The
        // change lasts indefinitely and ends if the object changes zones.
        label: "Magical Hack: text-change a land type (Forest → Island mana + landwalk)",
        cards: [
            {
                name: "Magical Hack",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Shanodin Dryads", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Island", owner: "opp" as const, count: 1 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Color-word text change (CR 612, layer 3). Cast Sleight of Mind ({U})
        // and pick a color: on Black Knight (protection from white), change
        // white → blue and Savannah Lions can no longer be blocked/targeted as
        // before — protection now keys off blue. On Circle of Protection: White,
        // change white → red and its "{1}: prevent a white source" ability now
        // targets red sources instead. The change lasts indefinitely and ends
        // if the object changes zones. It never changes the object's own color.
        label: "Sleight of Mind: text-change a color word (protection-from + Circle of Protection)",
        cards: [
            {
                name: "Sleight of Mind",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Black Knight", owner: "opp" as const },
            { name: "Circle of Protection: White", owner: "me" as const },
            { name: "Savannah Lions", owner: "me" as const },
            { name: "Mons's Goblin Raiders", owner: "opp" as const },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // AI debug: the bot ("opp" = p2) holds Braingeyser (target player draws
        // X) and Giant Growth (target ANY creature +3/+3) with the mana to cast
        // them, plus a creature on each side. Pass your turn → on the bot's turn
        // it decides; watch the floating "AI trace" box (left) to see which
        // targets it weighs and the per-term eval. The diagnostic: if "→ your
        // creature" and "→ its creature" show the same power terms, or
        // Braingeyser → you vs → itself show the same hand terms, the effect was
        // not simulated.
        label: "AI debug: bot holds Braingeyser + Giant Growth (watch AI trace box on bot's turn)",
        cards: [
            {
                name: "Braingeyser",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Giant Growth",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "opp" as const, count: 4 },
            { name: "Forest", owner: "opp" as const, count: 1 },
            // Two DIFFERENT creatures so the Giant Growth target labels are
            // distinguishable in the trace ("→ Grizzly Bears" = bot's own,
            // "→ Hill Giant" = yours, the tempting wrong target).
            { name: "Grizzly Bears", owner: "opp" as const }, // bot's own creature
            { name: "Hill Giant", owner: "me" as const }, // your creature (tempting wrong target)
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // AI debug: interaction-aware combat prediction (ADR 0021, issue #229).
        // The bot ("opp" = p2) is the ATTACKER with a ready 2/2 (Grizzly Bears)
        // and Giant Growth + an untapped Forest in hand; you (p1) have a 3/3
        // (Hill Giant) able to block. Pass to the bot's turn and watch the AI
        // trace: with the held +3/+3 modelled, the bot no longer pre-judges the
        // 2/2 as walking into the block, and the hold-the-trick tie-break keeps
        // the trick at the root instead of dumping it at sorcery speed (the
        // attacker-ambush behaviour). Block the bear with your Hill Giant to see
        // the bot pump in response and trade up.
        label: "AI debug: attacker ambush — bot holds Giant Growth on a 2/2 vs your 3/3 (#229)",
        cards: [
            {
                name: "Giant Growth",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "opp" as const, count: 1 },
            { name: "Grizzly Bears", owner: "opp" as const }, // the bait 2/2
            { name: "Hill Giant", owner: "me" as const }, // your 3/3 blocker
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W29: Copy permanent — Clone / Copy Artifact / Vesuvan + Gaea's Liege (CR 707)",
        cards: [
            // Cast Clone ({3}{U}) and choose to enter as a copy of the Serra
            // Angel — the copy gains flying + vigilance and is 4/4. Copy
            // Artifact ({1}{U}) copies the Helm of Chatzuk and stays an
            // enchantment too. Vesuvan Doppelganger ({3}{U}{U}) copies a
            // creature but stays blue and re-copies each upkeep. Gaea's Liege
            // is on the battlefield: its P/T equals the Forests you control
            // (3 here), and its {T} turns the Mountain into a Forest, bumping
            // it to 4/4. Five Islands cover the blue spells.
            { name: "Clone", owner: "me" as const, zone: "hand" as const },
            {
                name: "Copy Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Vesuvan Doppelganger",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Gaea's Liege", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "me" as const, count: 1 },
            { name: "Island", owner: "me" as const, count: 5 },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Helm of Chatzuk", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W28: Banding — Benalish Hero + bear band, redistribute damage (CR 702.21)",
        cards: [
            // Move to combat and attack. Use the band panel to group Benalish
            // Hero (banding) with the Grizzly Bears: the band is blocked as a
            // group, and because a banding creature is involved YOU divide the
            // blocker's combat damage among the band members (CR 702.21k) —
            // pile it on the 1/1 Hero to save the bear. Helm of Chatzuk can
            // grant banding to another attacker ({1}, {T}). The opposing
            // 3/3 is the blocker.
            { name: "Benalish Hero", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Mesa Pegasus", owner: "me" as const },
            { name: "Helm of Chatzuk", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 1 },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W27: Copy spell — Fork (copy instant/sorcery, copy is red, CR 707.10)",
        cards: [
            // Cast Lightning Bolt at the opponent, then in response cast Fork
            // ({R}{R}) targeting it. The copy is red and you may choose new
            // targets (e.g. redirect to a creature). Three Mountains cover
            // Bolt ({R}) + Fork ({R}{R}). A Grizzly Bears gives the copy an
            // alternative target to redirect onto.
            { name: "Fork", owner: "me" as const, zone: "hand" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W26: Mana substitution — Sunglasses of Urza (W pays R, CR 609.4b)",
        cards: [
            // Sunglasses lets white mana pay red costs. Tap the Plains for {W},
            // then cast Lightning Bolt ({R}) — the white mana covers the red
            // pip. Remove Sunglasses and the substitution is gone.
            { name: "Sunglasses of Urza", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W26: Graveyard self-reanimate — Nether Shadow (3+ creatures above, CR 603.6e)",
        cards: [
            // Nether Shadow sits at the bottom of the graveyard with three
            // creature cards stacked above it. Pass to your next upkeep: the
            // graveyard trigger offers to return it (it has haste).
            {
                name: "Nether Shadow",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
                count: 3,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W26: Aura retarget — Kudzu (tap host → destroy + reattach, CR 701.20a)",
        cards: [
            // Cast Kudzu on one Forest, then tap that Forest: Kudzu destroys it
            // and you choose the other Forest to move the Aura onto. With only
            // one land left, declining (or no target) sends Kudzu to the yard.
            { name: "Kudzu", owner: "me" as const, zone: "hand" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Regeneration ({G}: regenerate enchanted creature, CR 701.15a)",
        cards: [
            // Regeneration in hand, attach to my Grizzly Bears, then have
            // the opponent throw a Lightning Bolt at it. Activating {G}
            // before the Bolt resolves stacks a regen shield: the Bolt's
            // lethal damage is replaced by heal+tap, the bear stays in play.
            {
                name: "Regeneration",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Tap-for-mana triggers — Mana Flare + Manabarbs + Wild Growth",
        cards: [
            // Mana Flare doubles each land's first color. Manabarbs pings the
            // tapper. Wild Growth attached to a Forest gives +{G} on that
            // host's mana tap. Tap any Forest to see all three fire.
            { name: "Mana Flare", owner: "me" as const },
            { name: "Manabarbs", owner: "me" as const },
            {
                name: "Wild Growth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W25b: Counter-unless-pay + draw-skip — Power Sink + Island Sanctuary",
        cards: [
            {
                name: "Power Sink",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Island Sanctuary",
                owner: "me" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Plains", owner: "me" as const },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W25a: Mass forced-attack — Siren's Call + False Orders",
        cards: [
            {
                name: "Siren's Call",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "False Orders",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Savannah Lions", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Wall of Swords", owner: "me" as const },
            { name: "Island", owner: "opp" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "W24: Cost modifier + keyword removal — Gloom, Forcefield, Animate Wall, Earthbind",
        cards: [
            { name: "Gloom", owner: "me" as const },
            { name: "Forcefield", owner: "me" as const },
            {
                name: "Animate Wall",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Earthbind",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Wall of Swords", owner: "me" as const },
            { name: "Serra Angel", owner: "opp" as const },
            {
                name: "Savannah Lions",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Warp Artifact — Aura on opponent's artifact (CR 303.4 cross-board attach)",
        cards: [
            // Warp Artifact in hand (cost {B}{B}) targeting an opponent-owned
            // Sol Ring. Cast attaches the aura under my control while the
            // host stays on the opponent's battlefield (CR 303.4). On the
            // opponent's next upkeep the trigger deals 1 damage to them
            // (CR 603.6a). Verifies cross-board aura targeting AND visual
            // attachment when host and aura sit on opposite sides.
            {
                name: "Warp Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Sol Ring", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "SPELL_CAST trigger — Verduran + Sphere cycle + Soul Net",
        cards: [
            // Verduran on the battlefield. Cast Castle (enchantment) → may-pay
            // prompts to draw a card. Crystal Rod fires on any blue spell
            // → may pay {1} for 1 life. Soul Net fires on creature death.
            { name: "Verduran Enchantress", owner: "me" as const },
            { name: "Ivory Cup", owner: "me" as const },
            { name: "Soul Net", owner: "me" as const },
            { name: "Castle", owner: "me" as const, zone: "hand" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        label: "Aura pumps — Firebreathing + Holy Armor",
        cards: [
            // Firebreathing on a Mountain caster's bear: spend {R} to pump
            // +1/+0 EOT. Holy Armor adds passive +0/+2 and a {1}{W} pump for
            // +0/+3 EOT — both modifications stack with the static buff.
            {
                name: "Firebreathing",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Holy Armor",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Reach blocks flier — Giant Spider + Web",
        cards: [
            // Opponent attacks with Shivan Dragon (flying). Giant Spider
            // (innate reach) blocks legally; Web attached to a vanilla
            // Grizzly Bears also lets it block by granting reach + 0/+2.
            { name: "Giant Spider", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Web", owner: "me" as const, zone: "hand" as const },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Shivan Dragon", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Psychic Venom — 2 dmg on host land tap (PERMANENT_TAPPED)",
        cards: [
            // Psychic Venom in hand → attach to opponent's Mountain. Every
            // time they tap that land (mana or otherwise) the trigger pings
            // them for 2.
            {
                name: "Psychic Venom",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Upkeep tax — Power Leak + Power Surge + Pestilence",
        cards: [
            // Three upkeep-driven enchantments: Power Leak attached to one of
            // my own enchantments forces a {U}-or-1-life choice each turn;
            // Power Surge pings the active player for each of their untapped
            // lands; Pestilence demands {B} or sacrifice + can be activated
            // for symmetric 1-damage sweeps.
            {
                name: "Power Leak",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Castle", owner: "me" as const },
            { name: "Power Surge", owner: "me" as const },
            { name: "Pestilence", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sacrifice-counter — Lifeforce / Deathgrip",
        cards: [
            // Lifeforce ({G}, sac: counter Black). Deathgrip ({B}, sac:
            // counter Green). Opponent has Dark Ritual + Llanowar Elves to
            // try one of each color.
            { name: "Lifeforce", owner: "me" as const },
            { name: "Deathgrip", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Dark Ritual",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Llanowar Elves",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "opp" as const, count: 2 },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Northern Paladin — {W}{W}, {T}: destroy target black creature",
        cards: [
            // Tap the Paladin to wipe an opposing Black creature.
            // Hypnotic Specter is the canonical LEA Black target.
            { name: "Northern Paladin", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Arrows showcase — target arrows for stack items",
        cards: [
            // Sandbox per visualizzare le frecce di targeting:
            // - Lightning Bolt (R, any target) → cast su creatura, player o spell
            // - Counterspell (UU) → cast su un'altra spell sulla pila
            // - Disenchant (1W) → cast su artefatto/incantesimo opp
            // - Northern Paladin (T) → triggered ability che bersaglia creatura nera
            // Mana abbondante per concatenare casts e osservare piu frecce.
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Counterspell",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Northern Paladin", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Block restrictions — Invisibility / Fear / Ironclaw / Dwarven Warriors",
        cards: [
            // Wave 2 block-restriction sweep.
            // - Invisibility on my Grizzly Bears: only Walls can block.
            // - Fear on my Hypnotic Specter: only black/artifact can block.
            // - Ironclaw Orcs: can't block creatures with power ≥ 2.
            // - Dwarven Warriors: tap → target ≤2 power creature is
            //   unblockable EOT.
            {
                name: "Invisibility",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Fear", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hypnotic Specter", owner: "me" as const },
            { name: "Dwarven Warriors", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 1 },
            { name: "Ironclaw Orcs", owner: "opp" as const },
            { name: "Wall of Water", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Damage prevention shields — Samite Healer / Conservator",
        cards: [
            // Wave 3 prevent-N-to-target.
            // - Samite Healer: tap to drop a 1-damage shield on any target
            //   (creature or player). Opponent's Lightning Bolt is reduced
            //   by 1 (3 → 2 damage).
            // - Conservator: {3}, tap to drop a 2-damage shield on
            //   yourself. Reduces a Bolt to 1.
            // Stack the shields and watch them combine on the same target.
            { name: "Samite Healer", owner: "me" as const },
            { name: "Conservator", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "The Hive — {5}, {T}: create a 1/1 flying Wasp token",
        cards: [
            // Wave 4 token creation.
            // - The Hive: tap + 5 mana → create a Wasp (1/1 flying Insect
            //   artifact creature token).
            // - 7 lands so the activation is one-tap (5 generic + tap cost).
            // - Wall of Wood gives the opponent a non-flying ground blocker
            //   that can't reach a Wasp; Giant Spider (reach) can.
            // Repeated activations stack Wasps; killing a Wasp shows the
            // CR 704.5d cease-to-exist SBA — the token leaves play and
            // doesn't appear in the graveyard.
            { name: "The Hive", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Mountain", owner: "me" as const, count: 3 },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Wall of Wood", owner: "opp" as const },
            { name: "Giant Spider", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Winter Orb — land-only cap, untap-pick prompt (CR 502.1, ADR 0005)",
        cards: [
            // Winter Orb in play caps land untaps at one per untap step
            // (modern Oracle, ADR 0004). The active player has three
            // tapped lands + a tapped Grizzly Bears: at the next untap
            // step the engine enqueues an `untap-pick` PendingChoice
            // ({ min: 0, max: 1 }, filter: { types: "Land" }) routed to
            // the active player. The Bears (non-land) untap normally,
            // demonstrating the Oracle fix. Click any tapped land to
            // commit the pick + auto-untap; click "Skip untap" to
            // exercise the ADR 0003 tactical zero-branch (CR 701.39 —
            // the cap is permissive). End your turn to drive into the
            // opponent's turn and back into your UNTAP step to see the
            // prompt fire end-to-end.
            { name: "Winter Orb", owner: "me" as const },
            { name: "Plains", owner: "me" as const, tapped: true, count: 3 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Smoke — creature-only cap, untap-pick prompt (CR 502.1, ADR 0005)",
        cards: [
            // Smoke in play caps creature untaps at one per untap step
            // (modern Oracle). The active player has three tapped Grizzly
            // Bears + three tapped Plains: at the next untap step the
            // engine enqueues an `untap-pick` PendingChoice
            // ({ min: 0, max: 1 }, filter: { types: "Creature" }) routed
            // to the active player. The Plains (non-creature) untap
            // normally, demonstrating that Smoke binds Creatures only.
            // Click any tapped bear to commit the pick + auto-untap;
            // click "Skip untap" to exercise the ADR 0003 tactical
            // zero-branch (CR 701.39 — the cap is permissive). End your
            // turn to drive into the opponent's turn and back into your
            // UNTAP step to see the prompt fire end-to-end.
            { name: "Smoke", owner: "me" as const },
            { name: "Plains", owner: "me" as const, tapped: true, count: 3 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
                count: 3,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Meekstone — power-keyed hard skip (CR 502.1 + 613 layer 7c, ADR 0005)",
        cards: [
            // Meekstone in play: a `untapRestriction` with filter
            // { types: "Creature", powerAtLeast: 3 } and maxUntap: 0. The
            // active player has a tapped Sengir Vampire (4/4, effective
            // power ≥3 — stays tapped), a tapped Shivan Dragon (5/5 —
            // stays tapped), and two tapped Grizzly Bears (2/2 — both
            // untap normally). No untap-pick prompt is enqueued: cap=0
            // hard-skips the matching set and the dispatcher auto-resolves
            // straight to UPKEEP. Unholy Strength is in hand so the user
            // can cast it on a Grizzly Bears (+2/+1 → effective 4/3) to
            // verify the layer 7c interaction: pre-buff the bear untaps;
            // post-buff it stays tapped under Meekstone. End your turn to
            // drive into the opponent's turn and back into your UNTAP
            // step to see the gating fire end-to-end.
            { name: "Meekstone", owner: "me" as const },
            { name: "Sengir Vampire", owner: "me" as const, tapped: true },
            { name: "Shivan Dragon", owner: "me" as const, tapped: true },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
                count: 2,
            },
            {
                name: "Unholy Strength",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Winter Orb + Smoke — multi-restriction FIFO (CR 502.1, ADR 0005)",
        cards: [
            // Both restrictions in play: Winter Orb caps Land untaps at
            // one, Smoke caps Creature untaps at one. The dispatcher
            // fires two independent prompts in FIFO order — active
            // player's battlefield first, then opponent's — so with both
            // sources on the active side the first prompt is Winter Orb
            // (Land), the second is Smoke (Creature). Picks are
            // independent: untapping one Land does NOT consume the
            // Creature cap. Use this to verify ADR 0005 multi-restriction
            // sequencing: pick a land → commit → second prompt appears →
            // pick a bear → commit → UPKEEP.
            { name: "Winter Orb", owner: "me" as const },
            { name: "Smoke", owner: "me" as const },
            { name: "Plains", owner: "me" as const, tapped: true, count: 3 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
                count: 3,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Meekstone + Smoke — hard-skip ∩ cap filter overlap (CR 502.1)",
        cards: [
            // Meekstone (maxUntap:0, Creature power≥3) + Smoke (maxUntap:1,
            // Creature). The intersection step vetoes high-power creatures
            // from Smoke's eligible set. Expected golden path: Smoke prompt
            // offers only the power-2 Grizzly Bears; the power-4 Sengir
            // Vampire stays tapped regardless of the pick. Skip leaves
            // everything tapped. End turn to see the interaction fire again.
            { name: "Meekstone", owner: "me" as const },
            { name: "Smoke", owner: "me" as const },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
            },
            {
                name: "Sengir Vampire",
                owner: "me" as const,
                tapped: true,
            },
            { name: "Plains", owner: "me" as const, tapped: true, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Skip / restrict untap step — Basalt Monolith / Mana Vault / Meekstone / Smoke / Stasis / Paralyze (CR 502.1)",
        cards: [
            // Gap J showcase. Basalt Monolith and Mana Vault enter tapped and
            // demonstrate the per-permanent `does-not-untap` keyword: pass to
            // upkeep on the owner's next turn — neither artifact untaps from
            // the step. Mana Vault adds a may-pay {4} upkeep to untap and a
            // draw-step 1-damage ping if it's still tapped.
            //
            // Meekstone is also in play: the opponent's Sengir Vampire (4/4,
            // power ≥3) stays tapped after combat; Grizzly Bears (2/2) untap
            // normally. Smoke (Players can't untap more than one creature)
            // means the opponent only untaps one creature even if multiple
            // are tapped.
            //
            // Stasis is in hand for the user to cast and see "Players skip
            // their untap steps" + sacrifice-unless-{U} upkeep tax. Paralyze
            // (in hand) targets the opposing Vampire to tap it + grant
            // does-not-untap; their upkeep prompts pay {4} to untap.
            {
                name: "Basalt Monolith",
                owner: "me" as const,
                tapped: true,
            },
            { name: "Mana Vault", owner: "me" as const, tapped: true },
            { name: "Meekstone", owner: "me" as const },
            { name: "Smoke", owner: "me" as const },
            { name: "Stasis", owner: "me" as const, zone: "hand" as const },
            { name: "Paralyze", owner: "me" as const, zone: "hand" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                tapped: true,
            },
            {
                name: "Sengir Vampire",
                owner: "opp" as const,
                tapped: true,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Replacement effects (CR 614) — Lich / Personal Incarnation / Veteran Bodyguard / Library of Leng",
        cards: [
            // Lich on the battlefield: caster's life is 0, "don't lose game"
            // active, lifegain → draw, damage triggers sacrifice clause.
            // Personal Incarnation on the battlefield: redirects all damage
            // to its owner onto itself. Veteran Bodyguard: redirects from
            // unblocked attackers as long as untapped. Library of Leng:
            // discard → top of library.
            //
            // Mind Twist in hand to exercise discard replacement, Stream of
            // Life in hand to exercise lifegain → draw, Reverse Damage /
            // Jade Monolith / Simulacrum in hand to test the transient
            // redirection layer + the per-turn damage tally.
            { name: "Lich", owner: "me" as const },
            { name: "Personal Incarnation", owner: "me" as const },
            { name: "Veteran Bodyguard", owner: "me" as const },
            { name: "Library of Leng", owner: "me" as const },
            { name: "Jade Monolith", owner: "me" as const },
            {
                name: "Mind Twist",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Stream of Life",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Reverse Damage",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Simulacrum",
                owner: "me" as const,
                zone: "hand" as const,
            },
            // Some sacrificial fodder for Lich's damage trigger.
            { name: "Grizzly Bears", owner: "me" as const, count: 3 },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Swamp", owner: "me" as const, count: 4 },
            { name: "Forest", owner: "me" as const, count: 4 },
            // Opp side: a couple of attackers to test redirection in combat.
            { name: "Shivan Dragon", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Reanimation — Resurrection / Animate Dead (CR 400.7, CR 303.4i)",
        cards: [
            // Resurrection in hand ({2}{W}) — target your own dead Sengir
            // Vampire to bring it back to your battlefield at full P/T.
            //
            // Animate Dead in hand ({1}{B}) — target opp's dead Shivan Dragon
            // to reanimate it UNDER YOUR CONTROL with -1/-0 (CR 303.4i). The
            // aura attaches to the reanimated dragon; destroying the aura
            // later fires the LTB-trigger and sacrifices the dragon (CR
            // 603.10 last-known-info via attachedToBeforeLeave).
            //
            // Use the Debug panel to destroy the aura after reanimation to
            // see the LTB-trigger sacrifice in action.
            {
                name: "Resurrection",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Animate Dead",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Sengir Vampire",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
            { name: "Plains", owner: "me" as const, count: 3 },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Upkeep pay-or-else — Phantasmal Forces / Force of Nature / Wanderlust (CR 603.6a, 117.3a)",
        cards: [
            // Phantasmal Forces on battlefield ({3}{U}, 4/1 flying) — at start
            // of each your upkeep, may-pay {U} else sacrifice itself.
            //
            // Force of Nature on battlefield ({2}{G}{G}{G}{G}, 8/8 trample) —
            // at start of each your upkeep, may-pay {G}{G}{G}{G} else takes
            // 8 damage from itself (you lose 8 life).
            //
            // Wanderlust in hand ({1}{G}{G} aura) — attach to either creature.
            // At controller's upkeep, the aura deals 1 damage to the host's
            // controller (you).
            //
            // Pass to upkeep to trigger all three may-pay prompts in
            // sequence. Decline to see the consequences chain.
            {
                name: "Phantasmal Forces",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Force of Nature",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Wanderlust",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 6 },
            { name: "Island", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Additional cost — Sacrifice ({B} instant, sac creature for B mana = MV)",
        cards: [
            // Sacrifice in hand ({B} instant). Cast it: the engine prompts
            // you to pick a creature to sacrifice (additional cost). After
            // sac, you gain B mana equal to that creature's MV. Use the
            // floating mana for another spell same turn.
            {
                name: "Sacrifice",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Layer 4 type-add — Animate Artifact + Mana Vault",
        cards: [
            // Animate Artifact in hand ({3}{U} aura). Cast on Mana Vault
            // (mv 1) — Mana Vault becomes a 1/1 artifact creature. Then
            // try to block / attack with it to see the type-add land in
            // the combat layer.
            {
                name: "Animate Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Mana Vault",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "MV-target — Spell Blast (counter spell with mv = X)",
        cards: [
            // Spell Blast in hand ({X}{U}) — chooses X at announcement,
            // then target a stack spell whose mana value equals X.
            //
            // Have Lightning Bolt and Braingeyser in hand to cast as targets.
            // Announce Bolt (mv 1) → respond with Spell Blast X=1: legal.
            // Try Spell Blast X=2 against Bolt: rejected by mvFilter.
            // Cast Braingeyser with X=4 (mv 6) → Spell Blast X=6 counters.
            {
                name: "Spell Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Braingeyser",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 8 },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Animate-land — Living Lands + Kormus Bell (lands become creatures)",
        cards: [
            {
                name: "Living Lands",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Kormus Bell",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Swamp", owner: "opp" as const, count: 3 },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Subtype-set — Evil Presence + Conversion (land type change)",
        cards: [
            // Evil Presence in hand ({B} aura on land). Cast on opponent's
            // Mountain — it becomes a Swamp and produces {B} instead of {R}.
            // Conversion on battlefield — all Mountains become Plains.
            // After Conversion enters, tap a Mountain: {W}, not {R}.
            {
                name: "Evil Presence",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Conversion",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Activation timing (CR 602.5) — Instill Energy + Blessing",
        cards: [
            // Goblin King's grizzly partner here, attached by both auras.
            // Cast Instill Energy on the bear: it gains haste + {0} untap
            // once-per-turn restricted to controller's turn. Cast Blessing
            // on the same bear: {W} pumps +1/+1 EOT (unrestricted).
            //
            // Try activating Instill Energy's {0} twice — second activation
            // rejected. Pass priority to opp; their priority window doesn't
            // allow activating {0}. Pass turn — counter resets, can
            // re-activate next turn.
            {
                name: "Instill Energy",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Blessing",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Modal spells (CR 700.2) — Healing Salve / Blue & Red Elemental Blast",
        cards: [
            // Healing Salve in hand ({W}) — modal: gain 3 life OR prevent
            // next 3 damage to any target this turn.
            //
            // Blue Elemental Blast in hand ({U}) — modal: counter target red
            // spell OR destroy target red permanent.
            //
            // Red Elemental Blast in hand ({R}) — modal: counter target blue
            // spell OR destroy target blue permanent.
            //
            // Opp has Merfolk (blue) and Shivan Dragon (red) on the board for
            // the destroy modes; cast Lightning Bolt to test counter modes.
            {
                name: "Healing Salve",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Blue Elemental Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Red Elemental Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Shivan Dragon",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Merfolk of the Pearl Trident",
                owner: "opp" as const,
                zone: "battlefield" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Cross-player choice — Demonic Hordes (opp picks your land to sacrifice)",
        cards: [
            // Demonic Hordes on battlefield ({3}{B}{B}, 5/5 Demon). Activated
            // {T}: destroy target land — target any land in play. Upkeep
            // trigger may-pay {B}{B}{B}; on decline: Hordes taps and your
            // OPPONENT (the viewer auto-switches in solo) picks one of YOUR
            // lands to sacrifice.
            //
            // Pass to upkeep, decline the {B}{B}{B}, and watch the choice
            // prompt route to the opp viewer with click-routing on YOUR
            // battlefield (controller's zone). Lands are filtered.
            {
                name: "Demonic Hordes",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 5 },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Demonic Tutor — search your library, pick a card (CR 701.19)",
        cards: [
            // Cast Demonic Tutor ({1}{B}). It requests a `search-library`
            // choice (count=1): your library is exposed face-up in a grid so
            // each card is individually selectable. Click one (emerald ring),
            // press Done, and it goes to hand before the library shuffles.
            //
            // Issue #315 — this modal carries the minimize control (the "−" in
            // the dialog's top-right). After selecting a card, minimize to
            // inspect the board: the dialog collapses to a pulsing accent badge
            // and play stays blocked. Click the badge to restore the dialog
            // with your pick still selected, then press Done.
            {
                name: "Demonic Tutor",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        // ~30-card library so the search grid shows many cards at once — the
        // exact case the old fan layout collapsed into one unselectable strip.
        libraryCount: 30,
    },
    {
        label: "Lord of the Pit — upkeep sacrifice-or-7dmg (CR 603.6a)",
        cards: [
            {
                name: "Lord of the Pit",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Ankh of Mishra + Dingus Egg — land ETB/LTB damage",
        cards: [
            {
                name: "Ankh of Mishra",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Dingus Egg",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Forest", owner: "opp" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, zone: "hand" as const },
            { name: "Stone Rain", owner: "me" as const, zone: "hand" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        label: "Fog — prevent all combat damage (CR 615)",
        cards: [
            { name: "Fog", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 0,
    },
    {
        label: "Terror — destroy nonartifact, nonblack creature (CR 701.7)",
        cards: [
            { name: "Terror", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Juggernaut", owner: "opp" as const },
            { name: "Black Knight", owner: "opp" as const },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Cleanup discard — CR 514.1 (with optional Library of Leng for the unlimited path)",
        cards: [
            // 9 cards in hand on END_STEP: passing priority cycles into
            // CLEANUP and prompts the active player to discard 2. Drop a
            // Library of Leng in (also in hand) to verify the "no maximum
            // hand size" clause suppresses the prompt entirely; cast it
            // first, then pass through end of turn.
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 3,
            },
            {
                name: "Giant Growth",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Healing Salve",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
                count: 1,
            },
            {
                name: "Library of Leng",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "END_STEP",
        landCount: 0,
    },
    {
        label: "Disrupting Scepter — {3},{T}: target player discards (CR 701.8)",
        cards: [
            { name: "Disrupting Scepter", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Pending choice deselect — Library of Leng cleanup discard 2 (ADR 0007)",
        cards: [
            // 9-card hand at END_STEP: passing priority enters CLEANUP and
            // enqueues a discard-hand pending choice with count 2. Exercises
            // the client-buffered Skip/Done flow (ADR 0007) — click two
            // cards, deselect one, pick a different one, click Done.
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 3,
            },
            {
                name: "Giant Growth",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Healing Salve",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "END_STEP",
        landCount: 0,
    },
    {
        label: "Rock Hydra + Gauntlet — counters, replacement, mana bonus (W23)",
        cards: [
            { name: "Rock Hydra", owner: "me" as const },
            { name: "Gauntlet of Might", owner: "me" as const },
            {
                name: "Mons's Goblin Raiders",
                owner: "me" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 6 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Living Artifact — vitality counters + upkeep life (W23)",
        cards: [
            { name: "Sol Ring", owner: "me" as const },
            { name: "Living Artifact", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Orcish Oriflamme — attacking creatures you control get +1/+0 (CR 508.1)",
        cards: [
            { name: "Orcish Oriflamme", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Savannah Lions", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Time Vault — skip-turn ↔ extra-turn cycle (CR 614.10 + 500.7)",
        cards: [
            { name: "Time Vault", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 2 },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Fastbond — multiple land drops + self-damage (W16)",
        cards: [
            { name: "Fastbond", owner: "me" as const },
            {
                name: "Forest",
                owner: "me" as const,
                zone: "hand" as const,
                count: 4,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Mana Short — tap lands + drain mana pool (CR 106.4)",
        cards: [
            {
                name: "Mana Short",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Forest", owner: "opp" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Drain Power — tap lands + steal mana (CR 106.4)",
        cards: [
            {
                name: "Drain Power",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Disintegrate — exile-on-death + regen blocked (W16)",
        cards: [
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Drudge Skeletons", owner: "opp" as const },
            {
                name: "Disintegrate",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Dragon Whelp — 4-activation sacrifice risk (W15)",
        cards: [
            { name: "Dragon Whelp", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 5 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Lure — force all blockers (CR 509.1c block-requirement)",
        cards: [
            {
                name: "Lure",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Natural Selection + Glasses of Urza (peek/reorder + persistent knownTo, ADR 0026)",
        cards: [
            {
                name: "Natural Selection",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const },
            {
                name: "Glasses of Urza",
                owner: "me" as const,
            },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Counterspell",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 5,
    },
    {
        label: "Cockatrice + Thicket Basilisk (combat kill, CR 509.1h)",
        cards: [
            { name: "Cockatrice", owner: "me" as const },
            { name: "Thicket Basilisk", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 5 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
            { name: "Wall of Bone", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Mobile Touch Test — activated abilities + multi-action hand",
        cards: [
            { name: "Prodigal Sorcerer", owner: "me" as const },
            { name: "Royal Assassin", owner: "me" as const },
            { name: "Icy Manipulator", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const },
            { name: "Plains", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                tapped: true,
            },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Lace cycle (color-change layer 5, CR 305.7)",
        cards: [
            { name: "Purelace", owner: "me" as const, zone: "hand" },
            { name: "Deathlace", owner: "me" as const, zone: "hand" },
            {
                name: "Llanowar Elves",
                owner: "opp" as const,
            },
            { name: "Lightning Bolt", owner: "opp" as const, zone: "hand" },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "White Knight", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // Runtime-granted keyword in the live oracle text (#156, CR 702.13c).
        // Lord of Atlantis grants islandwalk to OTHER Merfolk via a layer-7c
        // static effect, so Merfolk of the Pearl Trident — a vanilla creature
        // with no native keywords — gains islandwalk on its instance. Hover /
        // long-press the Merfolk: its abilities panel shows "[+] Islandwalk"
        // in green. Remove the Lord (e.g. via a bounce) and it disappears.
        label: "Granted landwalk in oracle text (Lord of Atlantis → Merfolk)",
        cards: [
            { name: "Lord of Atlantis", owner: "me" as const },
            { name: "Merfolk of the Pearl Trident", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Board next: piles + stack (#255, PRD #249). Load with `?board=next`
        // to exercise the spatial board's card piles and the stack. The
        // graveyard is pre-filled so its collapsed stack shows a count; click it
        // to open the expanded reveal and drag the strip to feel the inertial
        // scroll. The library shows a face-down pile (right-click it with debug
        // actions on to draw/mill/exile, which feeds the graveyard/exile piles).
        // Cast Lightning Bolt from hand to put a clear ordered item on the
        // stack; hold priority and cast a second to read LIFO order.
        label: "Board next: piles + stack (graveyard reveal, inertial scroll)",
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Mountain",
                owner: "me" as const,
                zone: "graveyard" as const,
                count: 3,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 30,
    },
    {
        // ATQ walking skeleton (#270) — the first two Antiquities cards prove
        // the registry → GRE → wire → UI pipeline end-to-end. Both are vanilla
        // keyword artifact creatures on your battlefield:
        //   • Ornithopter ({0}, 0/2 flying) — a free evasive blocker.
        //   • Yotian Soldier ({3}, 1/4 vigilance) — attacks without tapping.
        // Move to combat and attack to exercise flying evasion and vigilance.
        label: "ATQ: walking skeleton (Ornithopter + Yotian Soldier)",
        cards: [
            { name: "Ornithopter", owner: "me" as const },
            { name: "Yotian Soldier", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ATQ free tranche (#273) — keyword artifact creatures & simple
        // permanents, all expressed with existing primitives. Starts in your
        // UPKEEP with a tapped Colossus so every activated ability is live:
        //   • Colossus of Sardia ({9}, 9/9 trample, does-not-untap): tapped —
        //     activate "{9}: Untap this creature" (only legal in your upkeep)
        //     to stand it back up.
        //   • Dragon Engine ({3}, 1/3): "{2}: +1/+0 until end of turn" — pump it.
        //   • Clay Statue ({4}, 3/1): "{2}: Regenerate this creature."
        //   • Grapeshot Catapult ({4}, 2/3): "{T}: 1 damage to target creature
        //     with flying" — aim at the opponent's Ornithopter.
        //   • Wall of Spears ({3}, 2/3 defender + first strike) — block to see
        //     first strike kill an attacker before it swings back.
        //   • Strip Mine (land): "{T}: Add {C}" and "{T}, Sacrifice: Destroy
        //     target land" — blow up the opponent's Mountain.
        //   • Obelisk of Undoing: "{6}, {T}: Return target permanent you both
        //     own and control to your hand" — bounce one of your own permanents.
        // A pile of Mountains pays the activated costs.
        label: "ATQ: free tranche (Colossus / Dragon Engine / Strip Mine / Obelisk)",
        cards: [
            {
                name: "Colossus of Sardia",
                owner: "me" as const,
                tapped: true,
            },
            { name: "Dragon Engine", owner: "me" as const },
            { name: "Clay Statue", owner: "me" as const },
            { name: "Grapeshot Catapult", owner: "me" as const },
            { name: "Wall of Spears", owner: "me" as const },
            { name: "Strip Mine", owner: "me" as const },
            { name: "Obelisk of Undoing", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 9 },
            { name: "Ornithopter", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // ATQ free tranche (#274) — artifact removal & bounce, all expressed
        // with existing primitives (destroy/destroyAll no-regen, returnToHand,
        // counter, gainLife/dealDamage = mv/X). Your hand holds the five
        // spells; the opponent fields several artifacts to point them at.
        //   • Crumble ({G} instant): destroy the opponent's Clay Statue (mv 4)
        //     — it can't be regenerated and ITS controller (the opponent)
        //     gains 4 life.
        //   • Detonate ({X}{R} sorcery): choose X = 3 to destroy Dragon Engine
        //     (mv 3) and deal 3 damage to its controller. Only mv-3 artifacts
        //     are legal at X = 3.
        //   • Shatterstorm ({2}{R}{R} sorcery): wipe every artifact on both
        //     sides at once (your Ornithopter dies too).
        //   • Artifact Blast ({R} instant): hold priority and counter an
        //     artifact spell the opponent casts (only artifact spells are
        //     legal targets).
        //   • Hurkyl's Recall ({1}{U} instant): target the opponent and bounce
        //     every artifact they own back to their hand at once.
        // Forest + Island + a pile of Mountains pay every cost.
        label: "ATQ: removal & bounce (Crumble / Detonate / Shatterstorm / Hurkyl's Recall)",
        cards: [
            { name: "Crumble", owner: "me" as const, zone: "hand" as const },
            { name: "Detonate", owner: "me" as const, zone: "hand" as const },
            {
                name: "Shatterstorm",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Artifact Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Hurkyl's Recall",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Island", owner: "me" as const, count: 1 },
            { name: "Mountain", owner: "me" as const, count: 4 },
            { name: "Ornithopter", owner: "me" as const },
            { name: "Clay Statue", owner: "opp" as const },
            { name: "Dragon Engine", owner: "opp" as const },
            { name: "Grapeshot Catapult", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ATQ free tranche #275 — graveyard / library recursion & card-flow.
        //   • Reconstruction (hand): return a target artifact card from your
        //     graveyard to hand — target Clay Statue / Ornithopter in the bin.
        //   • Argivian Archaeologist (battlefield): {W}{W},{T} repeats that
        //     recursion every turn.
        //   • Feldon's Cane (battlefield): {T}, exile self → shuffle your
        //     graveyard into your library.
        //   • Drafna's Restoration (hand): put any number of target artifact
        //     cards from a graveyard on top of its owner's library in any order
        //     (the reorder choice fires mid-resolution).
        //   • Millstone (battlefield): {2},{T} mills the opponent two cards
        //     (set a libraryCount so there's something to mill).
        //   • Jalum Tome (battlefield): {2},{T} draw then discard (loot).
        //   • Candelabra of Tawnos (battlefield): {X},{T} untap X target lands —
        //     a tapped Island is pre-placed to untap.
        label: "ATQ: recursion & card-flow (Reconstruction / Drafna's / Millstone / Jalum / Candelabra)",
        cards: [
            {
                name: "Reconstruction",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Drafna's Restoration",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Argivian Archaeologist", owner: "me" as const },
            { name: "Feldon's Cane", owner: "me" as const },
            { name: "Millstone", owner: "me" as const },
            { name: "Jalum Tome", owner: "me" as const },
            { name: "Candelabra of Tawnos", owner: "me" as const },
            // Artifact cards in the graveyard to recur with Reconstruction /
            // Argivian Archaeologist / Drafna's Restoration.
            {
                name: "Clay Statue",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Ornithopter",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            // A tapped land for Candelabra to untap.
            {
                name: "Island",
                owner: "me" as const,
                tapped: true,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 8,
    },
    {
        // ATQ free tranche (#276) — value triggers & counter creatures. Loads
        // at UPKEEP so the upkeep triggers fire immediately on the first
        // trigger scan, and seeds counters / hand size for the golden paths:
        //   • Ivory Tower (battlefield): at your upkeep, gain (hand − 4) life —
        //     the 6-card hand makes this +2 on entry.
        //   • Armageddon Clock (battlefield, 2 doom counters): your upkeep adds
        //     a third doom counter; your draw step pings each player for the
        //     doom count. {4}: any player may remove a doom counter during any
        //     upkeep.
        //   • Triskelion (battlefield, 3 +1/+1 counters → 4/4): "Remove a +1/+1
        //     counter: deal 1 damage to any target" — click the ability, pick
        //     any target.
        //   • Clockwork Avian (battlefield, 4 +1/+0 counters → 4/4 flyer):
        //     {X},{T} recharge during your upkeep (capped at four); decays a
        //     counter at end of combat if it attacked or blocked.
        //   • Citanul Druid (battlefield, 1/1): grows a +1/+1 counter whenever
        //     the OPPONENT casts an artifact spell — cast the opp Onulet to
        //     watch it tick to 2/2.
        //   • Urza's Chalice (battlefield): may pay {1} → gain 1 life whenever
        //     ANY player casts an artifact spell.
        //   • Onulet / Su-Chi (battlefield): die → gain 2 life / add {C}{C}{C}{C}.
        //   • Tablet of Epityr (battlefield): may pay {1} → gain 1 when one of
        //     your artifacts goes to the graveyard (sacrifice Onulet to test).
        label: "ATQ: value triggers & counter creatures (Triskelion / Armageddon Clock / Ivory Tower)",
        cards: [
            { name: "Ivory Tower", owner: "me" as const },
            {
                name: "Armageddon Clock",
                owner: "me" as const,
                counters: { doom: 2 },
            },
            {
                name: "Triskelion",
                owner: "me" as const,
                counters: { "+1/+1": 3 },
            },
            {
                name: "Clockwork Avian",
                owner: "me" as const,
                counters: { "+1/+0": 4 },
            },
            { name: "Citanul Druid", owner: "me" as const },
            { name: "Urza's Chalice", owner: "me" as const },
            { name: "Onulet", owner: "me" as const },
            { name: "Su-Chi", owner: "me" as const },
            { name: "Tablet of Epityr", owner: "me" as const },
            // An opponent artifact creature to cast (triggers Citanul Druid +
            // Urza's Chalice on an opponent's artifact cast).
            { name: "Onulet", owner: "opp" as const, zone: "hand" as const },
            // Fill the hand to 6 so Ivory Tower nets +2 on upkeep.
            {
                name: "Ornithopter",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Su-Chi", owner: "me" as const, zone: "hand" as const },
            {
                name: "Yotian Soldier",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Dragon Engine",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Onulet", owner: "me" as const, zone: "hand" as const },
            {
                name: "Clay Statue",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "opp" as const, count: 3 },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // ATQ #277 — P/T statics, combat & prevention shields. Exercise:
        //   • Mightstone + Weakstone anthems: declare attackers and watch the
        //     ±1/+0 / -1/-0 shift attacking-creature P/T globally.
        //   • Gaea's Avenger: a 1+*/1+* whose P/T tracks the opponent's
        //     artifacts (Amulet of Kroog + Mishra's Factory on the opp side).
        //   • Mishra's Factory: {1} animate into a 2/2 Assembly-Worker, then
        //     {T} pump it +1/+1.
        //   • Staff of Zegon: {3},{T} shrink a creature -2/-0.
        //   • Amulet of Kroog: {2},{T} fog the next 1 damage to any target.
        //   • Battering Ram (1/1): gains banding at combat, destroys a blocking
        //     Wall at end of combat (Wall of Spears on the opp side).
        label: "ATQ #277: P/T statics, combat & prevention shields",
        cards: [
            { name: "Mightstone", owner: "me" as const },
            { name: "Weakstone", owner: "me" as const },
            { name: "Gaea's Avenger", owner: "me" as const },
            { name: "Mishra's Factory", owner: "me" as const },
            {
                name: "Staff of Zegon",
                owner: "me" as const,
            },
            {
                name: "Amulet of Kroog",
                owner: "me" as const,
            },
            {
                name: "Battering Ram",
                owner: "me" as const,
            },
            {
                name: "Argivian Blacksmith",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Circle of Protection: Artifacts",
                owner: "me" as const,
            },
            { name: "Mishra's Factory", owner: "opp" as const },
            { name: "Amulet of Kroog", owner: "opp" as const },
            { name: "Wall of Spears", owner: "opp" as const },
            { name: "Mountain", owner: "me" as const, count: 5 },
            { name: "Plains", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster O — minor isolated extensions (#292). Each card
        // exercises one small engine extension:
        //   • Cursed Rack / The Rack chose YOU (the controller's opponent) as
        //     they entered — the opponent controls them, so YOUR max hand size
        //     is four (discard at YOUR cleanup) and The Rack pings you at YOUR
        //     upkeep for 3 − (cards in your hand). Pass to your upkeep / cleanup
        //     to see both fire.
        //   • Urza's Miter: when one of your artifacts is DESTROYED (not
        //     sacrificed) you may pay {3} to draw. Right-click your Grapeshot
        //     Catapult to ping, or destroy an artifact, vs. sacrificing one to
        //     Atog (no draw on sacrifice).
        //   • Coral Helm: right-click → "{3}, Discard a card at random:
        //     target +2/+2". A card leaves your hand at random as the cost.
        //   • Golgothian Sylex: right-click → "{1},{T}" wipes every nontoken
        //     permanent originally printed in Antiquities (itself, the Racks,
        //     the Miter, Onulet…), sparing the Grizzly Bears (LEA).
        //   • Rocket Launcher: right-click → "{2}: 1 damage any target" only on
        //     a turn after the one it entered; it's destroyed at the end step.
        //   • Tawnos's Wand: right-click → "{2},{T}: target power ≤ 2 can't be
        //     blocked this turn"; attack with the chosen creature to confirm.
        label: "Antiquities O: minor extensions (Racks / Miter / Coral Helm / Sylex / Rocket Launcher / Wand)",
        cards: [
            { name: "Coral Helm", owner: "me" as const },
            { name: "Golgothian Sylex", owner: "me" as const },
            { name: "Rocket Launcher", owner: "me" as const },
            { name: "Tawnos's Wand", owner: "me" as const },
            { name: "Urza's Miter", owner: "me" as const },
            { name: "Grapeshot Catapult", owner: "me" as const },
            { name: "Onulet", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
            // The opponent controls the Racks, so THEY chose the table's other
            // player (you) as their target on entry.
            { name: "Cursed Rack", owner: "opp" as const },
            { name: "The Rack", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Antiquities cluster L — token provenance link (#293, CR 111 / 707.1 /
        // 122 / 303.4). Tetravus converts +1/+1 counters into linked Tetravite
        // tokens and back:
        //   • You control Tetravus with three +1/+1 counters (effective 4/4
        //     flier). It loads in your UPKEEP so both optional triggers are on
        //     the stack.
        //   • Resolve "remove any number of +1/+1 counters": pick a number 0..3
        //     to mint that many 1/1 flying Tetravite tokens. Each token records
        //     Tetravus as its creator (the provenance link).
        //   • Resolve "exile any number of tokens created with this creature":
        //     ONLY the Tetravites Tetravus made are offered — exile them to put
        //     that many +1/+1 counters back on Tetravus.
        //   • Try casting Holy Strength (in your hand) on a Tetravite: the
        //     attachment is illegal — Tetravite tokens "can't be enchanted".
        //     Holy Strength on Tetravus itself works.
        label: "Antiquities L: token provenance link (Tetravus)",
        cards: [
            {
                name: "Tetravus",
                owner: "me" as const,
                counters: { "+1/+1": 3 },
            },
            {
                name: "Holy Strength",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // Portrait responsive board (#336). Best exercised in a NARROW PORTRAIT
        // viewport (phone, or DevTools device mode < 768px portrait), where the
        // right control column collapses to tappable chips and the hand scrolls:
        //   • Pile/stack CHIPS: graveyard / library / exile + (when present) the
        //     stack render as label+count chips instead of the side column. Tap
        //     a chip → the SAME reveal / stack view opens. Both seats have a
        //     populated graveyard so the GY chip opens a multi-card reveal.
        //   • Hand SCROLL: "me" holds 8 cards (> 6), so the flat-overlap hand
        //     scrolls horizontally instead of cramming — drag any card up to
        //     cast / play it. Discard down to 6 and the scroll disappears.
        //   • Long-press any card → the ADR-0009 centered preview overlay.
        // On a wide/landscape viewport this is just a normal board with a full
        // hand — the chips/scroll only appear in portrait.
        label: "Responsive: portrait chips + hand scroll (8-card hand)",
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Fireball", owner: "me" as const, zone: "hand" as const },
            { name: "Disenchant", owner: "me" as const, zone: "hand" as const },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Hill Giant", owner: "me" as const, zone: "hand" as const },
            { name: "Gray Ogre", owner: "me" as const, zone: "hand" as const },
            {
                name: "Mountain",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "graveyard" as const,
                count: 2,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 20,
    },
    {
        // ATQ cluster H (#294) — library tutor → battlefield (ADR 0027).
        // Transmute Artifact: "Sacrifice an artifact. If you do, search your
        // library for an artifact card. If its mana value ≤ the sacrificed
        // artifact's, put it onto the battlefield; if greater, you may pay the
        // difference; otherwise it goes to the graveyard. Then shuffle."
        //   • Cast Transmute Artifact ({U}{U}) with two Islands.
        //   • Sacrifice Sol Ring (mana value 1) at the sacrifice prompt.
        //   • The library search opens face-up but ONLY artifact cards are
        //     clickable (the candidateIds allow-list) — creatures/lands stay
        //     inert.
        //   • Pick an artifact: mana value ≤ 1 lands straight onto the
        //     battlefield; a greater one prompts "pay {difference}" (use the
        //     two spare Islands), and declining drops it into the graveyard.
        // Library artifacts come from the selected deck; pick an artifact-rich
        // deck (e.g. the Antiquities / artifact deck) to exercise both
        // branches.
        label: "ATQ H #294: library tutor → battlefield (Transmute Artifact)",
        cards: [
            {
                name: "Transmute Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Sol Ring", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 20,
    },
    {
        // ATQ cluster K (#295) — exile-with-attachments + return (ADR 0028).
        // Tawnos's Coffin: "{3},{T}: Exile target creature and all Auras
        // attached to it, noting its counters. When this leaves the battlefield
        // or becomes untapped, return it tapped with the noted counters (Auras
        // reattached)."
        //   • Right-click Tawnos's Coffin → activate its {3},{T} ability (three
        //     lands cover {3}), targeting the opponent's Grizzly Bears (it
        //     carries two +1/+1 counters).
        //   • The Bears + its counters leave for exile; the Coffin is now
        //     tapped.
        //   • Pass to your next turn. At your untap step you are prompted "you
        //     may choose not to untap this" — choose to UNTAP the Coffin: the
        //     Bears returns under its owner's control TAPPED with both +1/+1
        //     counters restored.
        //   • Alternatively, destroy the Coffin (e.g. with a Shatter effect)
        //     while it holds the creature — the same return fires on "leaves
        //     the battlefield".
        // (Aura reattach is exercised by the vitest suite — the scenario seeder
        // can't pre-attach an Aura.)
        label: "ATQ K #295: exile + return on untap/leave (Tawnos's Coffin)",
        cards: [
            { name: "Tawnos's Coffin", owner: "me" as const },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                counters: { "+1/+1": 2 },
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        // Combat damage assignment uses EFFECTIVE power (issue #366,
        // CR 510.1c / 613.4). A multi-blocked attacker buffed by a combat
        // trick must assign its EFFECTIVE power, not its base power.
        //   • Attack with Elvish Archers (2/1, first strike). Opponent blocks
        //     with BOTH Savannah Lions (2/1) and Pearled Unicorn (2/2).
        //   • Before the first-strike damage step, cast Giant Growth on Elvish
        //     Archers (Forest covers {G}) → it becomes 5/4.
        //   • In the damage-assignment prompt the budget reads "Elvish Archers
        //     (5 dmg)" / "0/5" — the effective power, NOT the base 2.
        //   • The +/- buttons let you split up to 5 across the two blockers
        //     (e.g. 1 to Lions, 4 to Unicorn), and the server accepts it.
        //     Before the fix the prompt clamped at 2 and threw "Damage total
        //     exceeds source power".
        label: "#366 Combat damage uses effective power (Giant Growth on multi-blocked attacker)",
        cards: [
            { name: "Elvish Archers", owner: "me" as const },
            {
                name: "Giant Growth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const },
            { name: "Savannah Lions", owner: "opp" as const },
            { name: "Pearled Unicorn", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Legends (LEG) walking skeleton (#370 / PRD #369). Proves the `leg`
        // set is registered and its vanilla legendary creatures are playable
        // from the pool end-to-end:
        //   • Jasmine Boreal (4/5 Legendary Human) and Lady Orca (7/4 Legendary
        //     Demon) start on your battlefield — confirm they render with the
        //     Legendary frame and correct P/T.
        //   • A copy of each sits in hand so you can hard-cast it (lands cover
        //     the cost) and watch it resolve onto the battlefield. The legend
        //     rule (CR 704.5j) is not enforced yet — it lands as an SBA in
        //     cluster C1 — so two copies of the same legend may coexist for now.
        label: "LEG skeleton: vanilla legendary creatures (Jasmine Boreal, Lady Orca) (#370)",
        cards: [
            { name: "Jasmine Boreal", owner: "me" as const },
            { name: "Lady Orca", owner: "me" as const },
            {
                name: "Jasmine Boreal",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lady Orca",
                owner: "me" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 7,
    },
    {
        // World rule SBA (CR 704.5m, #379 / PRD #369 cluster C2). The world rule
        // is global and fully automatic — no player choice:
        //   • Concordant Crossroads (a World enchantment) already sits on your
        //     battlefield; a SECOND World enchantment (Gravity Sphere) waits in
        //     your hand.
        //   • Cast Gravity Sphere (the Forest covers {G}; the Mountains cover
        //     {2}{R}) and let it resolve. The moment it enters, the world rule
        //     fires: the OLDER World permanent (Concordant Crossroads) is put
        //     into its owner's graveyard automatically, leaving only the newest
        //     World permanent (Gravity Sphere) on the battlefield.
        //   • No prompt appears — unlike the legend rule, the world rule never
        //     asks the player to choose (newest survives, ties kill all).
        label: "LEG world rule (CR 704.5m): second World enters → older one dies (#379)",
        cards: [
            { name: "Concordant Crossroads", owner: "me" as const },
            {
                name: "Gravity Sphere",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Forest", owner: "me" as const },
            // A flyer to make Gravity Sphere's "all creatures lose flying"
            // visible once it sticks.
            { name: "Azure Drake", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG white #371 — anthems / auras / removal. Divine Transformation on
        // a Wall of Light, Angelic Voices live (only a white creature on board),
        // Cleanse vs an opposing black creature, and Spirit Link gaining life.
        label: "LEG white #371: anthems, auras, Cleanse, Spirit Link",
        cards: [
            { name: "Angelic Voices", owner: "me" as const },
            { name: "Keepers of the Faith", owner: "me" as const },
            { name: "Wall of Light", owner: "me" as const },
            {
                name: "Divine Transformation",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Cleanse",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Spirit Link",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Scathe Zombies", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG white #371 — evasion / prevention / triggers. Amrou Kithkin and a
        // Seeker-enchanted attacker test the can't-be-blocked-except-by clauses;
        // Ivory Guardians grows while the opponent holds a red creature; Holy
        // Day fogs combat; Lifeblood + an opponent Mountain.
        label: "LEG white #371: evasion, Holy Day fog, Ivory Guardians, Lifeblood",
        cards: [
            { name: "Amrou Kithkin", owner: "me" as const },
            { name: "Ivory Guardians", owner: "me" as const },
            { name: "Lifeblood", owner: "me" as const },
            { name: "Seeker", owner: "me" as const, zone: "hand" as const },
            { name: "Holy Day", owner: "me" as const, zone: "hand" as const },
            {
                name: "Shield Wall",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG blue #372 — counters / bounce / tempo. Cast a creature with the
        // opponent, then Force Spike / Flash Counter / Remove Soul it; Boomerang
        // any permanent; Acid Rain wipes opposing Forests. Energy Tap ramps off
        // Azure Drake.
        label: "LEG blue #372: counters, Boomerang, Acid Rain, Energy Tap",
        cards: [
            { name: "Azure Drake", owner: "me" as const },
            {
                name: "Force Spike",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Flash Counter",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Remove Soul",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Boomerang", owner: "me" as const, zone: "hand" as const },
            { name: "Acid Rain", owner: "me" as const, zone: "hand" as const },
            { name: "Energy Tap", owner: "me" as const, zone: "hand" as const },
            {
                name: "Hill Giant",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "opp" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG blue #372 — evasion / colour / combat tricks. Sea Kings' Blessing
        // turns a creature blue, Part Water grants islandwalk, Teleport makes an
        // attacker unblockable (cast in the declare-attackers step), Wall of
        // Wonder animates with +4/-4, Backfire reflects an attacker's damage,
        // and Psionic Entity pings for 2.
        label: "LEG blue #372: Sea Kings' Blessing, Part Water, Wall of Wonder, Psionic Entity",
        cards: [
            { name: "Psionic Entity", owner: "me" as const },
            { name: "Wall of Wonder", owner: "me" as const },
            { name: "Devouring Deep", owner: "me" as const },
            {
                name: "Sea Kings' Blessing",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Part Water", owner: "me" as const, zone: "hand" as const },
            { name: "Teleport", owner: "me" as const, zone: "hand" as const },
            { name: "Backfire", owner: "me" as const, zone: "hand" as const },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Island", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG black #373 — sacrifice / pump / reanimation. Fallen Angel eats a
        // creature for +2/+1, Carrion Ants pumps repeatedly, Walking Dead and
        // Horror of Horrors hand out regeneration shields, and Hell's Caretaker
        // (set the phase to your upkeep) reanimates a creature from the
        // graveyard by sacrificing one.
        label: "LEG black #373: Fallen Angel, Carrion Ants, regen, Hell's Caretaker",
        cards: [
            { name: "Fallen Angel", owner: "me" as const },
            { name: "Carrion Ants", owner: "me" as const },
            { name: "Walking Dead", owner: "me" as const },
            { name: "Headless Horseman", owner: "me" as const },
            { name: "Hell's Caretaker", owner: "me" as const },
            { name: "Horror of Horrors", owner: "me" as const },
            {
                name: "Cyclopean Mummy",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 6 },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // LEG black #373 — removal / drain / tricks. Hellfire wipes nonblack
        // creatures (and burns you), Hell Swarm shrinks the board, Syphon Soul
        // drains the opponent, Jovial Evil scales off their white creatures,
        // Touch of Darkness recolours a creature, Greed draws off life, and
        // Blight destroys an enchanted land the moment it taps.
        label: "LEG black #373: Hellfire, Hell Swarm, Syphon Soul, Greed, Blight",
        cards: [
            { name: "Hellfire", owner: "me" as const, zone: "hand" as const },
            { name: "Hell Swarm", owner: "me" as const, zone: "hand" as const },
            {
                name: "Syphon Soul",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Jovial Evil",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Touch of Darkness",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Darkness", owner: "me" as const, zone: "hand" as const },
            { name: "Greed", owner: "me" as const },
            { name: "Blight", owner: "me" as const, zone: "hand" as const },
            { name: "Keepers of the Faith", owner: "opp" as const },
            { name: "Hill Giant", owner: "opp" as const },
            { name: "Lost Soul", owner: "opp" as const },
            { name: "Swamp", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG red #374 — Kobold tribe / lords / anthems / auras. The three
        // Kobold lords stack on the 0-cost Kobolds (Kobold Taskmaster +1/+0,
        // Kobold Drill Sergeant +0/+1 & trample, Kobold Overlord first strike);
        // Beasts of Bogardan grows while the opponent's white creature is out;
        // Giant Strength / Immolation / Eternal Warrior auras are in hand to
        // attach; The Brute pumps and can regenerate its host.
        label: "LEG red #374: Kobold lords, Beasts of Bogardan, auras (Giant Strength, Immolation)",
        cards: [
            { name: "Kobold Taskmaster", owner: "me" as const },
            { name: "Kobold Drill Sergeant", owner: "me" as const },
            { name: "Kobold Overlord", owner: "me" as const },
            { name: "Crimson Kobolds", owner: "me" as const },
            { name: "Crookshank Kobolds", owner: "me" as const },
            { name: "Kobolds of Kher Keep", owner: "me" as const },
            { name: "Beasts of Bogardan", owner: "me" as const },
            {
                name: "Giant Strength",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Immolation",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Eternal Warrior",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "The Brute", owner: "me" as const, zone: "hand" as const },
            { name: "Keepers of the Faith", owner: "opp" as const },
            { name: "Mountain", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG red #374 — removal / tricks / walls. Spinal Villain pings down a
        // blue creature; Hyperion Blacksmith taps/untaps the opponent's
        // artifact; Active Volcano destroys a blue permanent or bounces an
        // Island; Blood Lust and Dwarven Song are combat tricks; Glyph of
        // Destruction supercharges a blocking Wall (set the phase to combat to
        // make it legal); Winds of Change refills both hands.
        label: "LEG red #374: Spinal Villain, Hyperion Blacksmith, Active Volcano, Blood Lust, Glyph of Destruction",
        cards: [
            { name: "Spinal Villain", owner: "me" as const },
            { name: "Hyperion Blacksmith", owner: "me" as const },
            { name: "Wall of Opposition", owner: "me" as const },
            { name: "Wall of Earth", owner: "me" as const },
            {
                name: "Active Volcano",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Blood Lust",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Dwarven Song",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Glyph of Destruction",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Winds of Change",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Azure Drake", owner: "opp" as const },
            { name: "Ornithopter", owner: "opp" as const },
            { name: "Island", owner: "opp" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG green #375 — fliers / pumps / activated abilities. Killer Bees
        // and Emerald Dragonfly pump/grant first strike; Fire Sprites taps for
        // {R}; Pixie Queen grants flying to a grounded creature; Pradesh Gypsies
        // shrinks an attacker; Rabid Wombat grows +2/+2 per attached Aura (cast
        // Spirit Link from hand onto it to watch it swell).
        label: "LEG green #375: Killer Bees, Pixie Queen, Fire Sprites, Pradesh Gypsies, Rabid Wombat",
        cards: [
            { name: "Killer Bees", owner: "me" as const },
            { name: "Emerald Dragonfly", owner: "me" as const },
            { name: "Fire Sprites", owner: "me" as const },
            { name: "Pixie Queen", owner: "me" as const },
            { name: "Pradesh Gypsies", owner: "me" as const },
            { name: "Rabid Wombat", owner: "me" as const },
            {
                name: "Spirit Link",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Barbary Apes", owner: "opp" as const },
            { name: "Forest", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG green #375 — combat / burn / evasion. Elven Riders can be blocked
        // only by Walls or flyers (set phase to combat and attack to verify);
        // Winter Blast taps the opponent's creatures and burns the flyers;
        // Storm Seeker and Typhoon scale on hand size / Islands; Sylvan Paradise
        // turns creatures green. Hornet Cobra / Cat Warriors round out the board.
        label: "LEG green #375: Elven Riders, Winter Blast, Storm Seeker, Typhoon, Sylvan Paradise",
        cards: [
            { name: "Elven Riders", owner: "me" as const },
            { name: "Hornet Cobra", owner: "me" as const },
            { name: "Cat Warriors", owner: "me" as const },
            {
                name: "Winter Blast",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Storm Seeker",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Typhoon",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Sylvan Paradise",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Azure Drake", owner: "opp" as const },
            { name: "Wall of Light", owner: "opp" as const },
            { name: "Island", owner: "opp" as const, count: 3 },
            { name: "Forest", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG multicolor #376 — Dakkon Blackblade is a living land-counter
        // (P/T = lands you control: with 6 lands he's a 6/6); Jacques le Vert
        // pumps your green creatures +0/+2 (Barbary Apes becomes 2/4);
        // Sol'kanar gains you 1 life whenever any black spell is cast (cast the
        // Dark Ritual in hand to watch the trigger). Boris Devilboon makes
        // Minor Demon tokens; tap him to spawn one.
        label: "LEG multicolor #376: Dakkon (P/T=lands), Jacques anthem, Sol'kanar, Boris tokens",
        cards: [
            { name: "Dakkon Blackblade", owner: "me" as const },
            { name: "Jacques le Vert", owner: "me" as const },
            { name: "Sol'kanar the Swamp King", owner: "me" as const },
            { name: "Boris Devilboon", owner: "me" as const },
            { name: "Barbary Apes", owner: "me" as const },
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG multicolor #376 — utility legends with targeted activated
        // abilities: Adun Oakenshield returns a creature card from your
        // graveyard to hand; Kei Takahashi / Ragnar prevent damage / regenerate
        // a target; Tuknir Deathlock (flying) pumps a target +2/+2; Xira Arien
        // (flying) draws a card for a target player; Gwendlyn Di Corci makes a
        // player discard at random (your turn only). Princess Lucrezia, Riven
        // Turnbull, and Sunastian Falconer are mana legends (tap for U / B / CC).
        label: "LEG multicolor #376: Adun, Kei, Ragnar, Tuknir, Xira, Gwendlyn, mana legends",
        cards: [
            { name: "Adun Oakenshield", owner: "me" as const },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            { name: "Kei Takahashi", owner: "me" as const },
            { name: "Ragnar", owner: "me" as const },
            { name: "Tuknir Deathlock", owner: "me" as const },
            { name: "Xira Arien", owner: "me" as const },
            { name: "Gwendlyn Di Corci", owner: "me" as const },
            { name: "Princess Lucrezia", owner: "me" as const },
            { name: "Sunastian Falconer", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Forest", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG artifacts #377 — cost-reduction + utility artifacts. Mana Matrix
        // makes your instant/enchantment spells cost {2} less; Planar Gate makes
        // your creature spells cost {2} less (cast the hand cards and watch the
        // cost drop). Relic Barrier taps a target artifact. Alchor's Tomb makes
        // a permanent you control the color of your choice. Plenty of lands so
        // the reductions are visible against a real payment.
        label: "LEG artifacts #377: cost reduction (Mana Matrix / Planar Gate), Relic Barrier, Alchor's Tomb",
        cards: [
            { name: "Mana Matrix", owner: "me" as const },
            { name: "Planar Gate", owner: "me" as const },
            { name: "Relic Barrier", owner: "me" as const },
            { name: "Alchor's Tomb", owner: "me" as const },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Bottle of Suleiman", owner: "opp" as const },
            { name: "Island", owner: "me" as const, count: 8 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG artifacts/lands #377 — Mirror Universe and Pendelhaven. During
        // your upkeep, sacrifice Mirror Universe to swap life totals with the
        // opponent (you start at 3, they start at 18). Pendelhaven (Legendary
        // land) pumps a 1/1 (Tundra Wolves) to 2/3 until end of turn.
        label: "LEG #377: Mirror Universe (swap life), Pendelhaven (pump a 1/1)",
        cards: [
            { name: "Mirror Universe", owner: "me" as const },
            { name: "Pendelhaven", owner: "me" as const },
            { name: "Tundra Wolves", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // LEG C1 — Legend rule SBA (CR 704.5j, #378). You control TWO copies of
        // the Legendary creature Jasmine Boreal, which is illegal: a controller
        // may keep only one legendary permanent of a given name.
        //   • On load the legend-rule state-based action fires immediately and a
        //     "Legend rule — choose which Jasmine Boreal to keep" prompt appears.
        //   • Click one of the two Jasmine Boreals, then Done. The other is put
        //     into its owner's graveyard; one survives on the battlefield.
        //   • The opponent's lone Jasmine Boreal is untouched — the rule is
        //     per-controller, so a same-name legend on the other side coexists.
        label: "LEG C1 #378: Legend rule — two Jasmine Boreals, keep one (CR 704.5j)",
        cards: [
            { name: "Jasmine Boreal", owner: "me" as const, count: 2 },
            { name: "Jasmine Boreal", owner: "opp" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG C3 — Rampage N (CR 702.23, #380). You control Frost Giant (4/4,
        // Rampage 2); the opponent fields three Grizzly Bears (2/2) ready to
        // gang-block it.
        //   • Advance to combat and attack with Frost Giant.
        //   • Have the opponent block it with all THREE bears.
        //   • On block confirmation Frost Giant's Rampage triggers ONCE and gets
        //     +2/+2 for each blocker beyond the first: 2 × (3 − 1) = +4/+4, so it
        //     becomes an 8/8 until end of turn — enough to survive 6 damage and
        //     kill every bear it is assigned to.
        //   • Edge case: kill one bear (e.g. a burn spell) AFTER blocks but
        //     BEFORE the Rampage ability resolves and the bonus drops to +2/+2
        //     (only two blockers remain) — the count is taken at resolution.
        label: "LEG C3 #380: Rampage 2 — Frost Giant gang-blocked by 3 grows to 8/8 (CR 702.23)",
        cards: [
            { name: "Frost Giant", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const, count: 3 },
            { name: "Mountain", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // LEG C6 (#382) — shroud / "can't be the target" static (CR 702.18 /
        // 611 / 113.3 / 109.5). Three demonstrations on one board:
        //   • Bartel Runeaxe (Legendary 6/5, you control) can't be the target
        //     of AURA SPELLS: try to cast Spectral Cloak on it → it is NOT a
        //     legal target (greyed / un-clickable). A non-Aura spell like
        //     Lightning Bolt CAN target it.
        //   • Cast Spectral Cloak onto your UNTAPPED Pearled Unicorn → it gains
        //     shroud: Lightning Bolt can no longer target it. Tap the Unicorn
        //     (e.g. attack) and the shroud blinks off — it becomes targetable
        //     again (live CR 611 read of the host's tap state).
        //   • Cast Anti-Magic Aura onto the opponent's Grizzly Bears → it can't
        //     be the target of SPELLS (Lightning Bolt is blocked) but activated
        //     abilities still hit it, and no further Aura can be attached.
        label: "LEG C6 #382: shroud / can't-be-targeted — Spectral Cloak + Anti-Magic Aura + Bartel Runeaxe (CR 702.18)",
        cards: [
            { name: "Bartel Runeaxe", owner: "me" as const },
            { name: "Pearled Unicorn", owner: "me" as const },
            {
                name: "Spectral Cloak",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Anti-Magic Aura",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "opp" as const },
            // U for the two Auras (Spectral Cloak {U}{U}, Anti-Magic Aura
            // {X}{U}) and R for Lightning Bolt.
            { name: "Island", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // C7 #383: upkeep "pay-or-sacrifice" maintenance cost. Loads at the
        // start of "me"'s UPKEEP with an Elder Dragon (Chromium) on the
        // battlefield + a Tabernacle taxing every creature:
        //   • Chromium's "sacrifice unless you pay {W}{U}{B}" and the
        //     Tabernacle's granted "destroy unless you pay {1}" each go on the
        //     stack at upkeep (one trigger per taxed creature, CR 603.3b).
        //   • The 6 lands cover {W}{U}{B} + {1} + {1}; pay all to keep the
        //     board, or decline a may-pay to watch the creature die.
        //   • Grizzly Bears (yours) and the opponent's Pearled Unicorn are
        //     also taxed by the Tabernacle — the opponent pays at THEIR upkeep.
        label: "LEG C7 #383: upkeep pay-or-sacrifice — Chromium (pay {W}{U}{B}) + Tabernacle taxes every creature (CR 603.6a)",
        cards: [
            { name: "Chromium", owner: "me" as const },
            {
                name: "The Tabernacle at Pendrell Vale",
                owner: "me" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Pearled Unicorn", owner: "opp" as const },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // ARN Erhnam Djinn (CR 603.6a upkeep trigger + CR 702.13 forestwalk).
        // Loads at "me"'s UPKEEP with Erhnam Djinn out, the opponent holding a
        // plain creature and a Wall, plus an opponent Forest:
        //   • Erhnam's trigger goes on the stack; resolving it prompts a target
        //     — only the non-Wall creature (Grizzly Bears) is selectable; the
        //     Wall of Swords is excluded.
        //   • The chosen creature gains forestwalk "until your next upkeep". It
        //     is the OPPONENT's creature, so this is the classic drawback: their
        //     creature can't be blocked while you control a Forest (here the
        //     Forest is theirs, so it gives YOUR future blocks the slip — load
        //     mirrors the printed downside).
        label: "ARN Erhnam Djinn: upkeep grants an opponent's non-Wall creature forestwalk (Wall excluded)",
        cards: [
            { name: "Erhnam Djinn", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Wall of Swords", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // LEG Sylvan Library (CR 603.6a draw-step trigger + CR 118.4 life pay,
        // CR 119.4 can't-pay constraint). Single 0–N topdeck pick (#438).
        // Loads at "me"'s UPKEEP on turn 2 (turn 1 skips the draw step) with
        // Sylvan Library out and a stocked library:
        //   • Pass priority to reach the draw step. After the turn-based draw,
        //     Sylvan's trigger asks "draw two additional cards?".
        //   • Draw two → ONE selection over the cards drawn this turn: pick
        //     0..N to put on top of the library; pay 4 life for each of the N
        //     you keep. Done is enabled at the minimum (Skip = keep all, pay
        //     4 × N; topdeck all = pay 0).
        label: "LEG Sylvan Library: draw step — draw two, then a single 0–2 topdeck pick (pay 4 life per kept card)",
        cards: [{ name: "Sylvan Library", owner: "me" as const }],
        phase: "UPKEEP",
        landCount: 3,
        libraryCount: 12,
        turn: 2,
    },
    {
        // C5 (#384) — Divine Intervention counter-driven game draw (CR 104.4a).
        // Loaded at "me"'s UPKEEP with one intervention counter left:
        //   • Pass to let the upkeep trigger remove the last counter.
        //   • The game ends in a DRAW (Game Over dialog reads "Draw" / "The game
        //     is a draw") — no winner, no loser.
        label: "LEG Divine Intervention: last counter removed at upkeep → the game is a draw (CR 104.4a)",
        cards: [
            {
                name: "Divine Intervention",
                owner: "me" as const,
                counters: { intervention: 1 },
            },
        ],
        phase: "UPKEEP",
        landCount: 2,
    },
    {
        // C5 (#384) — Rasputin Dreamweaver dream counters (CR 122 / 122.6).
        // Loaded UNTAPPED at "me"'s UPKEEP with 4 of its 7 dream counters left:
        //   • Right-click Rasputin → "Remove a dream counter: Add {C}" or the
        //     prevent-1-damage mode; each drops the dream count by one.
        //   • Pass through to the next upkeep: because Rasputin started the turn
        //     untapped, it regains one dream counter (capped at seven).
        label: "LEG Rasputin Dreamweaver: spend dream counters ({C} / prevent), regrow one each upkeep (cap 7)",
        cards: [
            {
                name: "Rasputin Dreamweaver",
                owner: "me" as const,
                counters: { dream: 4 },
            },
        ],
        phase: "UPKEEP",
        landCount: 2,
    },
    {
        // C5 (#384) — Primordial Ooze upkeep grow-or-pay (CR 122 / 117.3a).
        // Loaded at "me"'s UPKEEP carrying two +1/+1 counters:
        //   • Pass to fire the upkeep trigger: it grows a third +1/+1 counter,
        //     then asks to pay {3} (X = its +1/+1 count). Decline → it taps and
        //     deals 3 damage to you; pay → it stays untapped.
        label: "LEG Primordial Ooze: upkeep +1/+1 then pay {X} or tap + X damage to you",
        cards: [
            {
                name: "Primordial Ooze",
                owner: "me" as const,
                counters: { "+1/+1": 2 },
            },
        ],
        phase: "UPKEEP",
        landCount: 4,
    },
    {
        // C5 (#384) — Whirling Dervish end-step growth (CR 120.3 / 122.1).
        // Dervish is mid-combat ready: attack the opponent so it deals damage,
        // then at the end step it puts a +1/+1 counter on itself (it grows only
        // on turns it dealt damage to an opponent). Protection from black means
        // black removal can't target it.
        label: "LEG Whirling Dervish: attack, then end-step +1/+1 if it hit an opponent (protection from black)",
        cards: [
            { name: "Whirling Dervish", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 2,
    },
    {
        // C5 (#384) — Spirit Shackle / Venarian Gold / Cocoon counter Auras
        // (CR 122 / 502.1). Cast each from hand onto a creature:
        //   • Spirit Shackle on a creature: every time that creature becomes
        //     tapped it gains a -0/-2 counter (toughness erodes; check via the
        //     card's counter badges).
        //   • Venarian Gold (pay {X}) taps the host and stuns it with X sleep
        //     counters — it won't untap until they tick off one per upkeep.
        //   • Cocoon on your own creature: three pupa counters; remove one each
        //     upkeep and, when none remain, it hatches into a +1/+1 counter and
        //     flying on the host.
        label: "LEG counter Auras: Spirit Shackle (-0/-2 on tap), Venarian Gold (sleep), Cocoon (pupa → hatch)",
        cards: [
            {
                name: "Spirit Shackle",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Venarian Gold",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Cocoon", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // DRK Artifacts/Lands free tranche (#417) — activated-ability artifacts.
        //   • Barl's Cage: {3}: lock an opponent's creature off its next untap.
        //   • Bone Flute: {2},{T}: all creatures -1/-0 EOT.
        //   • Living Armor: {T},Sac: X +0/+1 counters (X = target MV).
        //   • Book of Rass / Fountain of Youth: card advantage / lifegain.
        // Lands are present to pay the activation costs.
        label: "DRK Artifacts: Barl's Cage / Bone Flute / Living Armor / Book of Rass (#417)",
        cards: [
            { name: "Barl's Cage", owner: "me" as const },
            { name: "Bone Flute", owner: "me" as const },
            { name: "Living Armor", owner: "me" as const },
            { name: "Book of Rass", owner: "me" as const },
            { name: "Fountain of Youth", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const, tapped: true },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // DRK colorless free tranche (#417) — graveyard hate & recursion.
        //   • Tormod's Crypt: {T},Sac: exile the opponent's whole graveyard.
        //   • Skull of Orm: {5},{T}: return an enchantment from your graveyard.
        //   • Necropolis (Wall, defender): exile a graveyard creature to grow it.
        // The opponent's graveyard is pre-seeded; yours holds an enchantment.
        label: "DRK colorless: Tormod's Crypt / Skull of Orm / Necropolis (#417)",
        cards: [
            { name: "Tormod's Crypt", owner: "me" as const },
            { name: "Skull of Orm", owner: "me" as const },
            { name: "Necropolis", owner: "me" as const },
            {
                name: "Curse Artifact",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Hill Giant",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Serra Angel",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        // DRK prevention artifacts (#417) — damage-prevention shields.
        //   • Dark Sphere: {T},Sac, choose a source: prevent HALF its next hit.
        //   • Scarecrow ({T} costs {6}): prevent ALL flying-source damage this
        //     turn. The opponent has a Serra Angel (flier) attacking.
        // In DECLARE_ATTACKERS so you can pre-empt the incoming combat damage.
        label: "DRK prevention: Dark Sphere (half) / Scarecrow (anti-flying) (#417)",
        cards: [
            { name: "Dark Sphere", owner: "me" as const },
            { name: "Scarecrow", owner: "me" as const },
            { name: "Serra Angel", owner: "opp" as const, tapped: true },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 8,
    },
    {
        // DRK lands (#417) — utility lands.
        //   • Maze of Ith: {T}: untap an attacker + prevent its combat damage —
        //     the classic fog-on-a-land. Opponent's Hill Giant is attacking.
        //   • City of Shadows: {T},exile a creature you control: store a counter;
        //     {T}: add {C} per storage counter (a mana battery).
        //   • Safe Haven: {2},{T}: blink-bank your own creatures; sac on upkeep
        //     to return them.
        //   • Tower of Coireall: {T}: a creature can't be blocked by Walls.
        label: "DRK lands: Maze of Ith / City of Shadows / Safe Haven / Tower of Coireall (#417)",
        cards: [
            { name: "Maze of Ith", owner: "me" as const },
            { name: "City of Shadows", owner: "me" as const },
            { name: "Safe Haven", owner: "me" as const },
            { name: "Tower of Coireall", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hill Giant", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 6,
    },
    {
        // DRK Stone Calendar (#417) — "Spells you cast cost {1} less to cast."
        // Cast Hill Giant ({3}{R}) and watch the generic drop by one. The lock
        // applies only to YOUR spells, not the opponent's.
        label: "DRK Stone Calendar: your spells cost {1} less (#417)",
        cards: [
            { name: "Stone Calendar", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const, zone: "hand" as const },
            { name: "Mountain", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Blood Moon — nonbasic-land lockdown static (#419). "Nonbasic
        // lands are Mountains." Every nonbasic land becomes a Mountain: it
        // loses its other land types and ALL printed abilities, and taps for
        // {R} via the intrinsic Mountain mana ability.
        //   • You control Blood Moon, a Tropical Island (dual) and a Strip Mine
        //     (utility land), plus a basic Mountain that is left untouched.
        //   • Tap the Tropical Island / Strip Mine — they now produce {R}, not
        //     {G}/{U} or {C}, and Strip Mine's "Destroy target land" ability is
        //     gone.
        //   • Cast Lightning Bolt off the lockdown'd lands to confirm they pay
        //     red. Destroy Blood Moon and the lands revert to their printed
        //     types/abilities live.
        label: "DRK Blood Moon: nonbasic lands become Mountains (tap for {R}, lose abilities) (#419)",
        cards: [
            { name: "Blood Moon", owner: "me" as const },
            { name: "Tropical Island", owner: "me" as const },
            { name: "Strip Mine", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 1 },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Tropical Island", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Worms of the Earth — land-play/ETB prohibition (#423).
        // "Players can't play lands. Lands can't enter the battlefield. At the
        // beginning of each upkeep, any player may sacrifice two lands or take 5
        // damage; if they do either, destroy this."
        //   • You control Worms of the Earth plus two Mountains (the sacrifice
        //     fodder), and hold a Mountain in hand.
        //   • The Mountain in hand has NO "Play" action — the land-play lock is
        //     active (CR 305.1). It stays unplayable until Worms leaves play.
        //   • The board starts at your UPKEEP so Worms' trigger fires: choose
        //     "Sacrifice two lands" or "Take 5 damage" to destroy Worms (or
        //     decline to keep it). After Worms is gone the Mountain can be
        //     played again.
        label: "DRK Worms of the Earth: can't play/ETB lands + upkeep sac-2-or-take-5 (#423)",
        cards: [
            { name: "Worms of the Earth", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            {
                name: "Mountain",
                owner: "me" as const,
                zone: "hand" as const,
            },
        ],
        phase: "UPKEEP",
        landCount: 0,
    },
    {
        // DRK C8 retarget existing spell — Reflecting Mirror (#425). "{X}, {T}:
        // Change the target of target spell with a single target if that target
        // is you. The new target must be a player. X is twice the mana value of
        // that spell." This mutates the ORIGINAL spell on the stack (distinct
        // from Fork's copy-retarget).
        //   • You control Reflecting Mirror and Mountains; the opponent holds a
        //     Lightning Bolt and Mountains.
        //   • (Solo) cast the opponent's Lightning Bolt targeting YOU — it sits
        //     on the stack with a single target that is you.
        //   • Switch to your seat and activate Reflecting Mirror, targeting the
        //     bolt. X is forced to twice the bolt's mana value ({2}); pay it and
        //     {T} the Mirror.
        //   • On resolution, choose the OPPONENT as the new player target — the
        //     original bolt now deals its 3 damage to the opponent instead of you.
        label: "DRK Reflecting Mirror: bounce a single-target spell back at its caster (#425)",
        cards: [
            { name: "Reflecting Mirror", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 4 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Red free tranche (#414) — Ball Lightning end-step sacrifice +
        // Goblin Shrine conditional anthem and LTB damage. Ball Lightning (6/1
        // trample, haste) can attack the turn it lands; pass to the end step and
        // its "at the beginning of the end step, sacrifice this creature" trigger
        // fires. Goblin Shrine enchants a basic Mountain, so the Goblin Hero
        // shows 3/2 ("Goblin creatures get +1/+0"); destroy the Shrine and its
        // LTB trigger deals 1 to each Goblin.
        label: "DRK Red: Ball Lightning end-step sac / Goblin Shrine anthem + LTB ping (#414)",
        cards: [
            { name: "Ball Lightning", owner: "me" as const },
            { name: "Goblin Hero", owner: "me" as const },
            {
                name: "Goblin Shrine",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Free tranche — Multicolor (#416). One board exercising the
        // off-color activation cards plus the sacrifice-a-Forest enchantment:
        //   • Drowned (1/1) — pay {B} (tap a Swamp) to stack a regeneration
        //     shield; survives the next lethal damage / destroy.
        //   • Electric Eel (1/1) — already on the battlefield (its ETB ping
        //     fired on entry in real play); activate {R}{R} → +2/+0 until EOT
        //     AND 1 self-damage. Tap the two Mountains to pay.
        //   • Elves of Deep Shadow (1/1) — {T}: Add {B}; tapping for mana
        //     fires the painland trigger dealing 1 damage to you.
        //   • Wormwood Treefolk (4/4) — {G}{G}: forestwalk until EOT + 2
        //     self-damage; {B}{B}: swampwalk until EOT + 2 self-damage. The
        //     opponent's Forest/Swamp make the evasion live.
        //   • Marsh Goblins (1/1) — vanilla swampwalk; unblockable vs the
        //     opponent's Swamp.
        //   • Dark Heart of the Wood — Sacrifice a Forest: gain 3 life. You
        //     control extra Forests to feed the cost.
        label: "DRK Multicolor: Drowned / Electric Eel / Elves / Wormwood Treefolk / Marsh Goblins / Dark Heart (#416)",
        cards: [
            { name: "Drowned", owner: "me" as const },
            { name: "Electric Eel", owner: "me" as const },
            { name: "Elves of Deep Shadow", owner: "me" as const },
            { name: "Wormwood Treefolk", owner: "me" as const },
            { name: "Marsh Goblins", owner: "me" as const },
            { name: "Dark Heart of the Wood", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 3 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            // Opponent lands make the landwalk evasion live.
            { name: "Forest", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Green free tranche — combat-flavoured cards (#415).
        //   • Venom on your Grizzly Bears: attack with it. When a non-Wall
        //     creature blocks (or it blocks one), the OTHER creature is destroyed
        //     at end of combat (CR 511.3).
        //   • Spitting Slug (2/4): when it blocks or is blocked, choose to pay
        //     {1}{G} (Slug gets first strike) or not (the paired creature does).
        //   • Lurker (2/3): try to target it with a spell before combat — it
        //     can't be targeted until it has attacked or blocked this turn.
        label: "DRK Green: Venom / Spitting Slug / Lurker — combat (#415)",
        cards: [
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Venom", owner: "me" as const, zone: "hand" as const },
            { name: "Spitting Slug", owner: "me" as const },
            { name: "Lurker", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // DRK Green free tranche — utility & static cards (#415).
        //   • Hidden Path: your green creatures gain forestwalk (unblockable
        //     while the opponent controls a Forest — they do here).
        //   • People of the Woods: a 1/* whose toughness equals the Forests you
        //     control (4 here → 1/4).
        //   • Savaen Elves: {G}{G},{T} destroys the Aura on the opponent's land.
        //   • Niall Silvain: {G}{G}{G}{G},{T} regenerates a target creature.
        //   • Scarwood Bandits: {2}{G},{T} steals the opponent's Ornithopter
        //     unless they pay {2}.
        //   • Whippoorwill (flying): {G}{G},{T} dooms a creature so it can't
        //     regenerate and is exiled when it dies this turn.
        label: "DRK Green: Hidden Path / CDA / steal / regen / doom (#415)",
        cards: [
            { name: "Hidden Path", owner: "me" as const },
            { name: "People of the Woods", owner: "me" as const },
            { name: "Savaen Elves", owner: "me" as const },
            { name: "Niall Silvain", owner: "me" as const },
            { name: "Scarwood Bandits", owner: "me" as const },
            { name: "Whippoorwill", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 6 },
            { name: "Ornithopter", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
            { name: "Fishliver Oil", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Camouflage — {G} Instant, pile combat (#563, CR 509 variant, the
        // RANDOM twin of Raging River, ADR 0012). "Cast only during your
        // declare attackers step. This turn, instead of declaring blockers,
        // each defending player divides any number of their creatures into N
        // piles (N = number of attackers). Assign each pile to a different
        // attacker at random. Each creature in a pile that can block its
        // assigned attacker does so."
        //
        // Board: you hold Camouflage ({G}) with a Forest for the cost and field
        // two Grizzly Bears as attackers. The opponent has two ground Grizzly
        // Bears (legal blockers) and a Serra Angel (flying — it can block any
        // pile's attacker). Golden path:
        //   1. Move to combat and attack with both Grizzly Bears.
        //   2. In your declare-attackers step, cast Camouflage and let it
        //      resolve. The declare-blockers step is replaced: you (the
        //      defender) divide your creatures into two piles, one pick per
        //      pile.
        //   3. The engine assigns each pile to a different attacker at random
        //      and forces every creature that can legally block its assigned
        //      attacker to do so — no manual blocker declaration follows.
        // Edge: put a ground Bear in a pile assigned to an attacker it can
        //   still legally block → it blocks; the Serra Angel can be put in any
        //   pile and always blocks (flying blocks ground attackers).
        label: "2ED: Camouflage — random pile blocking replaces declare-blockers (#563)",
        cards: [
            { name: "Camouflage", owner: "me" as const, zone: "hand" as const },
            { name: "Forest", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "opp" as const, count: 2 },
            { name: "Serra Angel", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // FEM C6 — Artifacts & Lands (#573, PRD #566). Exercises the two new
        // capabilities of the cluster in one board:
        //   • CAPABILITY B — control-change-on-tap (Rainbow Vale, ADR 0040 /
        //     CR 613.1b): tap it for any colour, then at the next end step it
        //     hands itself to the opponent. Tap it again next turn to get it
        //     back — it ping-pongs.
        //   • CAPABILITY H — variable counter-removal → variable mana
        //     (Bottomless Vault storage land, CR 106.1 / 122.6): seeded with
        //     three storage counters. Tap removing N counters to add N {B}.
        //     It enters tapped and may choose not to untap to keep banking.
        // Also on board: Spirit Shield (REUSE I tapped-duration buff) with a
        // Grizzly Bears to buff +0/+2 for as long as the Shield stays tapped.
        //
        // Golden path:
        //   1. Tap Bottomless Vault choosing to remove 2 of its 3 storage
        //      counters → +{B}{B}; one counter remains.
        //   2. Tap Rainbow Vale for any colour. Pass to the end step — Rainbow
        //      Vale moves to the opponent's control.
        //   3. {2},{T} Spirit Shield targeting Grizzly Bears → it is 2/4 while
        //      the Shield is tapped; choose not to untap to hold the buff.
        label: "FEM C6: Rainbow Vale control-change + charged storage land + tap-lock Spirit Shield (#573)",
        cards: [
            {
                name: "Rainbow Vale",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Bottomless Vault",
                owner: "me" as const,
                zone: "battlefield" as const,
                tapped: true,
                counters: { storage: 3 },
            },
            {
                name: "Spirit Shield",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            // Lands to pay Spirit Shield's {2} activation cost.
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Permanent stacking — fanned identical permanents on the battlefield
        // (PRD #621, issue #623). Exercises the whole feature one-click:
        //   • A fan of identical lands (Forest ×6, some tapped) collapses into
        //     ONE footprint — untapped members first, tapped (rotated 90°) at the
        //     tail, with a ×6 count badge. Tapping/untapping members re-sorts the
        //     fan without fragmenting the mana base.
        //   • A fan of identical vanilla creatures (Grizzly Bears ×4) collapses
        //     the creature row the same way; every member stays individually
        //     clickable / targetable.
        //   • A Grizzly Bears carrying a +1/+1 counter is "altered" and EJECTS to
        //     its own singleton, rendering in full beside the stack — proof that
        //     instance-specific state always stands alone.
        // Hover any member to lift it forward (z + pop-up) without moving a
        // single neighbour — the footprint is fixed.
        label: "UI: Permanent stacking — fanned identical lands + creatures, altered ejects (#623)",
        cards: [
            {
                name: "Forest",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 4,
            },
            {
                name: "Forest",
                owner: "me" as const,
                zone: "battlefield" as const,
                tapped: true,
                count: 2,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 4,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
                counters: { "+1/+1": 1 },
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Permanent stacking — LARGE stacks collapse to a depth-pile that
        // expands on hover (PRD #621, issue #624). Exercises the >8 path:
        //   • A run of 12 identical Forests (more than 8) collapses into a tight
        //     diagonal DEPTH-PILE at ~one card's footprint with a ×12 badge —
        //     huge mana bases no longer eat the board width.
        //   • Hover the pile: it EXPANDS into the full fan in a high-z overlay
        //     that floats ABOVE neighbours — no permanent reflows (the central
        //     hard rule). Per-member hover-lift then makes any instance
        //     selectable.
        //   • A run of 10 identical Grizzly Bears (also >8) shows the same
        //     depth-pile-to-fan expand on the creature row.
        //   • A second, small Forest stack (×4) stays a direct fan, proving the
        //     ≤8 path (#623) is untouched and sits beside the pile without being
        //     pushed when the pile expands.
        label: "UI: Permanent stacking — large depth-pile expands to fan on hover (#624)",
        cards: [
            {
                name: "Forest",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 9,
            },
            {
                name: "Forest",
                owner: "me" as const,
                zone: "battlefield" as const,
                tapped: true,
                count: 3,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 10,
            },
            {
                name: "Plains",
                owner: "me" as const,
                zone: "battlefield" as const,
                count: 4,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ICE walking skeleton (#629, PRD #628). Balduvian Bears — {1}{G} 2/2
        // vanilla Bear — is the Ice Age tracer proving the set file, registry
        // entry, pool availability and projection end to end. Board: you hold
        // Balduvian Bears with two Forests to cast it. Golden path: cast it and
        // watch the 2/2 Bear resolve onto the battlefield.
        label: "ICE: Balduvian Bears — vanilla tracer (#629)",
        cards: [
            {
                name: "Balduvian Bears",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // ICE White buildable-now completion (#653, PRD #628). Exercises the
        // White cards finished from already-shipped primitives:
        //   - Black Scarab enchants your Balduvian Bears: while the opponent
        //     controls a black permanent (Knight of Stromgald) it is 4/4 AND
        //     can't be blocked by black creatures.
        //   - Call to Arms (cast it, choose black + the opponent): your white
        //     creatures get +1/+1 while black is the opponent's strict plurality.
        //   - Caribou Range on a Plains: "{W}{W},{T}: make a 0/1 Caribou", then
        //     "Sacrifice a Caribou: gain 1 life".
        //   - Fylgja on a creature: spend healing counters to prevent damage.
        //   - Seraph (4/4 flyer) reanimates creatures it kills at the end step.
        //   - Justice: upkeep pay-{W}{W}-or-sac, reflects red damage back.
        label: "ICE: White buildable-now — Scarab / Call to Arms / Caribou Range / Fylgja / Seraph / Justice (#653)",
        cards: [
            {
                name: "Balduvian Bears",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Black Scarab",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Kjeldoran Warrior",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Call to Arms",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Caribou Range",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Fylgja",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Seraph",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Justice",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
            {
                name: "Knight of Stromgald",
                owner: "opp" as const,
                zone: "battlefield" as const,
                count: 2,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 7,
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
