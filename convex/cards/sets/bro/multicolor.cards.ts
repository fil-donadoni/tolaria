// bro — multicolor cards (ADR 0043 colour split). The registry's
// `import * as bro from "./sets/bro/index.cards"` re-exports this module.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import { defineCard, type GameEvent, type PermanentView } from "../../types";
import { urzaPlaneswalkerFace } from "./urzaPlaneswalkerFace.cards";
import { mishraLostToPhyrexiaFace } from "./mishraLostToPhyrexiaFace.cards";

// CR 506.2: "the number of attacking creatures" counts every attacker on the board.
const ATTACKING_CREATURES = {
    count: {
        zone: "battlefield" as const,
        controller: "controller" as const,
        filter: { type: "Creature" as const, isAttacking: true },
    },
};

// Third Path Iconoclast — {U}{R} Creature — Human Monk 2/1 (Vintage Cube token
// maker, issue #678). "Whenever you cast a noncreature spell, create a 1/1
// colorless Soldier artifact creature token." A SPELL_CAST triggered ability
// (CR 603.2 + 601.2i); the effect is a plain spec-driven `createToken`
// (CR 111 / 707.1). The trigger's `matches` gates on caster scope ("you") and
// a noncreature filter — the effect never inspects the firing event, so it is
// authored DSL-first as `effects` (ADR 0045), not a `resolve()` closure.
const THIRD_PATH_ICONOCLAST_ID = "f1a21287-e244-4960-84fb-c4f6e5c346d9";

export const thirdPathIconoclast = defineCard(() => ({
    id: THIRD_PATH_ICONOCLAST_ID,
    name: "Third Path Iconoclast",
    rarity: "uncommon",
    oracleText:
        "Whenever you cast a noncreature spell, create a 1/1 colorless Soldier artifact creature token.",
    manaCost: { U: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Monk"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "third-path-iconoclast-token",
            oracleText:
                "Whenever you cast a noncreature spell, create a 1/1 colorless Soldier artifact creature token.",
            event: "SPELL_CAST",
            // CR 603.2: fires only when the source's controller is the caster
            // and the cast spell is NOT a creature spell (CR 601.2i).
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "SPELL_CAST" &&
                event.casterId === self.controllerId &&
                !event.spellTypes.includes("Creature"),
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Soldier",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Soldier"],
                        power: 1,
                        toughness: 1,
                    },
                    controller: "controller",
                },
            ],
        },
    ],
}));

// Urza, Lord Protector — the half of the Urza meld pair that carries the meld
// ability (CR 712.4a). Hand-written only because the combined back face's art
// has no compile path (`imagePrintId`, its own Scryfall card); the rest is the
// compiler's output, pinned by `urzaPairClauses.test.ts`. "If you both own and control"
// is read on resolution by the `meld` Op, never at activation.
export const urzaLordProtector = defineCard(() => ({
    id: "8aefe8bd-216a-4ec1-9362-3f9dbf7fd083",
    rarity: "mythic",
    ...{
        name: "Urza, Lord Protector",
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Human", "Artificer"],
        manaCost: {
            X: 1,
            W: 1,
            U: 1,
        },
        power: 2,
        toughness: 4,
        oracleText:
            "Artifact, instant, and sorcery spells you cast cost {1} less to cast.\n{7}: If you both own and control Urza, Lord Protector and an artifact named The Mightstone and Weakstone, exile them, then meld them into Urza, Planeswalker. Activate only as a sorcery.",
    },
    backFace: urzaPlaneswalkerFace,
    compiledStaticEffects: [
        {
            kind: "cost-modifier",
            spells: {
                types: ["Artifact", "Instant", "Sorcery"],
                controller: "you",
            },
            reduction: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "urza-lord-protector-ability",
            oracleText:
                "{7}: If you both own and control {self} and an artifact named The Mightstone and Weakstone, exile them, then meld them into Urza, Planeswalker. Activate only as a sorcery.",
            cost: {
                mana: {
                    X: 7,
                },
            },
            useStack: true,
            effects: [
                {
                    op: "meld",
                    partner: {
                        type: "Artifact",
                        name: "The Mightstone and Weakstone",
                    },
                },
            ],
            sorcerySpeedOnly: true,
        },
    ],
}));

// Mishra, Claimed by Gix — {2}{B}{R} Legendary Creature — Phyrexian Human
// Artificer, 3/5, the half of the Mishra meld pair that carries the meld ability
// (CR 712.4a). "Whenever you attack, each opponent loses X life and you gain X
// life, where X is the number of attacking creatures. If Mishra, Claimed by Gix
// and a creature named Phyrexian Dragon Engine are attacking, and you both own
// and control them, exile them, then meld them into Mishra, Lost to Phyrexia.
// It enters tapped and attacking."
// One Oracle line = one trigger (CR 603.2). "Both attacking" is read on
// resolution (the `if` for Mishra, the partner filter for the Engine); "both own
// and control" by the `meld` Op itself. CR 508.4: the melded permanent enters
// tapped and attacking (issue #8478).
// hand-tail: Whenever you attack, each opponent loses X life and you gain X life, where X is the number of attacking creatures. (#8176)
export const mishraClaimedByGix = defineCard(() => ({
    id: "a469d7ec-42de-45de-9d8f-469bb979de58",
    name: "Mishra, Claimed by Gix",
    rarity: "mythic",
    oracleText:
        "Whenever you attack, each opponent loses X life and you gain X life, where X is the number of attacking creatures. If Mishra, Claimed by Gix and a creature named Phyrexian Dragon Engine are attacking, and you both own and control them, exile them, then meld them into Mishra, Lost to Phyrexia. It enters tapped and attacking.\n(Melds with Phyrexian Dragon Engine.)",
    manaCost: { X: 2, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Phyrexian", "Human", "Artificer"],
    power: 3,
    toughness: 5,
    backFace: mishraLostToPhyrexiaFace,
    triggeredAbilities: [
        {
            id: "mishra-claimed-by-gix-attack",
            oracleText:
                "Whenever you attack, each opponent loses X life and you gain X life, where X is the number of attacking creatures. If Mishra, Claimed by Gix and a creature named Phyrexian Dragon Engine are attacking, and you both own and control them, exile them, then meld them into Mishra, Lost to Phyrexia. It enters tapped and attacking.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackingPlayerId === self.controllerId,
            effects: [
                {
                    op: "loseLife",
                    player: "opponent",
                    amount: ATTACKING_CREATURES,
                },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: ATTACKING_CREATURES,
                },
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: {
                                    name: "Mishra, Claimed by Gix",
                                    isAttacking: true,
                                },
                            },
                        },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "meld",
                            partner: {
                                type: "Creature",
                                name: "Phyrexian Dragon Engine",
                                isAttacking: true,
                            },
                            entersTapped: true,
                            entersAttacking: true,
                        },
                    ],
                },
            ],
        },
    ],
}));
