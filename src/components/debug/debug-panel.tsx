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
};

const PRESET_SCENARIOS: PresetScenario[] = [
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
    const user = useCurrentUser();

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
            className="fixed top-1/2 right-4 -translate-y-1/2 z-100 font-mono text-xs"
        >
            <div className="rounded-lg border border-white/10 bg-black/90 shadow-2xl backdrop-blur">
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
