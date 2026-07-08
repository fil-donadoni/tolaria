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

const PRESET_SCENARIOS: PresetScenario[] = [
    {
        // Vision Charm phasing + modal charm (issue #982): Vision Charm ({U}
        // instant) sits in hand with fixtures for all three modern-oracle modes.
        // Mode 1 — mill four: the opponent has a stocked library. Mode 2 — land
        // type change: you control an Island (and a Forest) to retype until end
        // of turn. Mode 3 — phase out: a Black Lotus is in play as a target
        // artifact; after it phases out (CR 702.26) it phases back in before your
        // NEXT untap step (the untap-cycle wiring this issue added). Cast it and
        // pick a mode to exercise the staged-resume resolution.
        label: "Vision Charm — modal + untap-cycle phasing (#982)",
        cards: [
            { name: "Vision Charm", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "battlefield" },
            { name: "Black Lotus", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "opp", zone: "library", count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
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
    {
        // Twiddle modal tap/untap (CR 701.26, #961). Cast Twiddle on the tapped
        // Grizzly Bears (or the Island): resolution now prompts a Tap/Untap
        // CHOICE instead of a forced state-toggle. Pick "Untap" to free the
        // tapped Bears, or "Tap" to lock down the untapped Island.
        label: "Twiddle: caster chooses Tap or Untap (modal, not a toggle) (#961)",
        cards: [
            { name: "Twiddle", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            {
                name: "Grizzly Bears",
                owner: "opp",
                zone: "battlefield",
                tapped: true,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        // Thrull Wizard punisher — "{B} or {3}" alternative (CR 701.5a / 117.3a,
        // #961). Activate Thrull Wizard targeting the opponent's Dark Ritual on
        // the stack: the controller is offered {B} first, then {3} if they
        // decline {B}; paying either saves the spell, declining both counters it.
        label: "Thrull Wizard: counter unless controller pays {B} OR {3} (#961)",
        cards: [
            { name: "Thrull Wizard", owner: "me", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield", count: 2 },
            { name: "Dark Ritual", owner: "opp", zone: "hand" },
            { name: "Swamp", owner: "opp", zone: "battlefield", count: 3 },
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
        // Cursed Scroll random-reveal conditional damage (issue #991): "{3},
        // {T}: Choose a card name, then reveal a card at random from your hand.
        // If that card has the chosen name, this artifact deals 2 damage to
        // any target." Cursed Scroll is in play with exactly ONE card in hand
        // (Grizzly Bears), so the random reveal is forced — activate it, name
        // "Grizzly Bears", and the reveal is guaranteed to match, dealing 2 to
        // any target (the opponent, or their Grizzly Bears). Discard a card
        // first to make the reveal probabilistic. 3 lands cover the {3} cost.
        label: "Cursed Scroll: random-reveal conditional damage (#991)",
        cards: [
            { name: "Cursed Scroll", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
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
