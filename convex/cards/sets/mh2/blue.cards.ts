// mh2 — blue cards (ADR 0043 colour split).
import { defineCard, type SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { cardLeftGraveyardTrigger } from "../../abilities/triggers/cardLeftGraveyardTrigger";
import { evokeTrigger } from "../../abilities/evoke";
import { affinityForArtifacts } from "../../abilities/affinity";

// Subtlety — {2}{U}{U} Creature — Elemental Incarnation, 3/3 (MH2, issue #1205).
// "Flash. Flying. When this creature enters, choose up to one target creature
// spell or planeswalker spell. Its owner puts it on their choice of the top or
// bottom of their library. Evoke—Exile a blue card from your hand." The Evoke
// halves ship as engine infra (#900): the alt cast is a pure HAND leg (`evoke`,
// reusing `AlternativeCost.handCost`) and the sacrifice-on-ETB half is
// `evokeTrigger` (Solitude/Grief precedent).
//
// The ETB is the first TARGETED trigger over a SPELL on the stack (CR 603.3d
// + CR 113 spell targeting, issue #1205): the `targetRequirement` (type
// "spell", filtered to creature/planeswalker spells) rides the #1193 trigger-
// targeting foundation — `raiseTriggerTargetSelection` locks the target as the
// trigger is put on the stack, offering only creature/planeswalker spells below
// it. "Up to one" ⇒ min 0, so the controller may decline.
// hand-tail: Evoke—Exile a blue card from your hand. (#8505)
export const subtlety = defineCard(() => ({
    id: "701256d5-1389-48b7-9581-d6037209bd06",
    rarity: "mythic",
    name: "Subtlety",
    oracleText:
        "Flash\nFlying\nWhen this creature enters, choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library.\nEvoke—Exile a blue card from your hand.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flash", "flying"],
    evoke: {
        id: "evoke",
        description: "Evoke—Exile a blue card from your hand",
        hand: {
            action: "exile",
            requirements: [{ filter: { color: "U" }, count: 1 }],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "subtlety-etb",
            oracleText:
                "When this creature enters, choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library.",
            scope: "self",
            // CR 113 — a creature or planeswalker SPELL on the stack. "Up to
            // one" ⇒ min 0 (the controller may choose no target).
            targetRequirement: {
                type: "spell",
                count: { min: 0, max: 1 },
                spellStackKind: "spell",
                spellTypeFilter: ["Creature", "Planeswalker"],
            },
            // protocol card: the destination is the OWNER's own top/bottom
            // choice (a mid-resolution option-pick raised to the spell's owner,
            // not the trigger's controller), then `moveSpellFromStack` moves
            // the stack spell. The `moveSpellFromStack` Op (issue #2605) takes
            // a LITERAL destination, so it cannot express "put target spell on
            // its owner's library, owner chooses the end" — a stack-object move
            // gated on a foreign player's option pick.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                // "Up to one" — no target chosen, or it left the stack.
                if (!target || target.type !== "spell") return;
                // CR 113 — the spell's OWNER chooses the library end. A spell's
                // owner equals its caster (controller) except in the rare
                // cast-from-elsewhere case; `getController` is the only ctx
                // lookup that resolves a STACK item (`getOwnerId` is battlefield-
                // only), and `moveSpellFromStack` sends the card to the true
                // `ownerId`'s library regardless.
                const ownerId = ctx.getController(target);
                // CR 113 — the spell's OWNER chooses the library end.
                const choice = ctx.requestOptionChoice({
                    playerId: ownerId,
                    choiceId: `subtlety-end-${ctx.sourceInstanceId}`,
                    options: [
                        { id: "top", label: "Top of library" },
                        { id: "bottom", label: "Bottom of library" },
                    ],
                    prompt: "Put the spell on the top or bottom of your library?",
                });
                if (choice === undefined) return; // suspended on the choice
                ctx.moveSpellFromStack(
                    target,
                    choice === "top" ? "library-top" : "library-bottom"
                );
            },
        }),
        evokeTrigger("Subtlety"),
    ],
}));

// Thought Monitor — {6}{U} Artifact Creature — Construct, 2/2 (MH2 71).
// "Affinity for artifacts (This spell costs {1} less to cast for each artifact
// you control.) Flying. When this creature enters, draw two cards." Modern
// Scryfall oracle text is authoritative (ADR 0004).
//
// Affinity KEYWORD (CR 702.41, PRD #702 / ADR 0063) via
// `affinityForArtifacts()`. Third consumer alongside Frogmite and Thoughtcast
// (both `mrd/`); this one proves the keyword COMPOSES — it rides alongside a
// second `staticAbilities` keyword (flying) and an ordinary `enteredTrigger`,
// with no interaction between them: affinity functions only while the spell is
// on the stack (702.41a), flying only once the permanent is on the battlefield.
export const thoughtMonitor = defineCard(() => ({
    id: "996c1952-8d10-4296-8960-ff8993833649", // MH2 71
    name: "Thought Monitor",
    rarity: "rare",
    oracleText:
        "Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nFlying\nWhen this creature enters, draw two cards.",
    manaCost: { X: 6, U: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 2,
    toughness: 2,
    ...affinityForArtifacts(["flying"]),
    triggeredAbilities: [
        enteredTrigger({
            id: "thought-monitor-etb-draw",
            oracleText: "When this creature enters, draw two cards.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 2 }],
        }),
    ],
}));

// Murktide Regent — {5}{U}{U} Creature — Dragon, 3/3 (MH2, issue #8626).
// "Delve. Flying. This creature enters with a +1/+1 counter on it for each
// instant and sorcery card exiled with it. Whenever an instant or sorcery card
// leaves your graveyard, put a +1/+1 counter on this creature."
// The entry clause reads the cards the delve cost exiled (`entersWith`,
// `cardsExiledWithIt`); the trigger is the generic
// leaves-a-graveyard watcher (`CARD_LEFT_GRAVEYARD`), one trigger
// per qualifying card (CR 603.2c).
// hand-tail: This creature enters with a +1/+1 counter on it for each instant and sorcery card exiled with it. (#8626)
export const murktideRegent = defineCard(() => ({
    id: "20c4aae1-7665-4df7-bd51-a1d95bf8a17d", // MH2 52
    name: "Murktide Regent",
    rarity: "mythic",
    oracleText:
        "Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\nFlying\nThis creature enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.\nWhenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on this creature.",
    manaCost: { X: 5, U: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 3,
    toughness: 3,
    staticAbilities: ["delve", "flying"],
    entersWith: {
        counters: [
            {
                type: "+1/+1",
                count: { cardsExiledWithIt: { types: ["Instant", "Sorcery"] } },
            },
        ],
    },
    triggeredAbilities: [
        cardLeftGraveyardTrigger({
            id: "murktide-regent-grow",
            oracleText:
                "Whenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on this creature.",
            graveyard: "yours",
            cardTypes: ["Instant", "Sorcery"],
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
}));

// Inevitable Betrayal — Sorcery, no mana cost (MH2). Suspend 3—{1}{U}{U}
// (CR 702.62a, the `suspend` cost plus the "suspend 3" keyword string). No
// `manaCost`: CR 118.6's unpayable cost, so it is cast only for free. Effect: CR 701.23b —
// a stated quality never compels the find, so the pick is "up to one"; CR
// 110.2a — the found card enters under the caster's control, the `moveZone`
// `controller` field, while the opponent stays its owner and shuffles.
// hand-tail: Search target opponent's library for a creature card and put that card onto the battlefield under your control (#10497)
export const inevitableBetrayal = defineCard(() => ({
    id: "71725895-38cd-4017-bbf0-0b7dc9b5db60", // MH2 47
    name: "Inevitable Betrayal",
    rarity: "rare",
    oracleText:
        "Suspend 3—{1}{U}{U} (Rather than cast this card from your hand, pay {1}{U}{U} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\nSearch target opponent's library for a creature card and put that card onto the battlefield under your control. Then that player shuffles.",
    // CR 202.2e — no mana cost; its blue colour indicator makes it blue.
    colorIndicator: ["U"],
    types: ["Sorcery"],
    staticAbilities: ["suspend 3"],
    suspend: { X: 1, U: 2 },
    targetRequirement: {
        type: "player",
        count: 1,
        controller: "opponent",
    },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            zoneOwnerId: { target: 0 },
            filter: { type: "Creature" },
            count: { min: 0, max: 1 },
            prompt: "Search that player's library for a creature card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: { target: 0 },
            from: "library",
            to: "battlefield",
            controller: "controller",
        },
        { op: "libraryLook", action: "shuffle", player: { target: 0 } },
    ],
}));

export {};
