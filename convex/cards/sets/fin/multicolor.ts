// FIN — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    GameEvent,
    ManaCost,
    PermanentView,
} from "../../types";

// Vivi Ornitier — {1}{U}{R} Legendary Creature — Wizard. "{0}: Add X mana in
// any combination of {U} and/or {R}, where X is Vivi Ornitier's power.
// Activate only during your turn and only once each turn. / Whenever you
// cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it
// deals 1 damage to each opponent." The second ability is free DSL (CR
// 603.2 SPELL_CAST trigger with a noncreature-spell `matches` filter — the
// exact shape already shipped by Third Path Iconoclast, `bro/multicolor.ts`
// — `counters` on self + `dealDamage` to `{player: "opponent"}`, both
// already-exercised Ops).
//
// #927 SHIPPED (`gre/constants.ts` `getDynamicManaChoices` / `manaAmount`):
// the effective-power READ that originally blocked this card is resolved —
// `manaAmount` / `getManaChoices` now receive the source's CURRENT CR 613.4
// layered power/toughness (counters, anthems, CDAs), not the raw base
// `CardInstanceState.power`. See `mrd/green.ts` (Viridian Joiner) for the
// shipped, fully-activatable regression case.
//
// #1179 SHIPPED (`convex/game.ts` `activateManaAbility`) — Vivi's mana
// ability has NO tap cost ("{0}: ..."), so the runtime {U}/{R} colour-split
// CHOICE needed the non-tap choice-based mana-activation pathway (the choice
// analog of the TAP path's `manaChoiceIndex`, now generalized to
// `activateManaAbility`). The mana ability declares ONLY `getManaChoices`
// (no static `manaChoices` fallback): a static fallback would make
// `getActivatedManaAbility` (the click-to-TAP recognizer used by
// `hasManaAbility`/`canInteract`) mistake this free non-tap ability for a
// tappable mana source, wrongly routing a plain left-click into `tapUntap`
// — this ability is reached ONLY through the activated-ability menu.
const VIVI_ORNITIER_ID = "ecc1027a-8c07-44a0-bdde-fa2844cff694";

export const viviOrnitier: CardDefinition = {
    id: VIVI_ORNITIER_ID,
    name: "Vivi Ornitier",
    rarity: "mythic",
    oracleText:
        "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power. Activate only during your turn and only once each turn.\nWhenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.",
    manaCost: { X: 1, U: 1, R: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Wizard"],
    power: 0,
    toughness: 3,
    activatedAbilities: [
        {
            id: "vivi-ornitier-mana",
            oracleText:
                "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power. Activate only during your turn and only once each turn.",
            cost: {},
            // CR 605.1a — no {T} component: a repeatable-shape mana ability
            // that resolves without the stack (CR 605.3c), capped to once per
            // turn by `oncePerTurn` below.
            useStack: false,
            controllerTurnOnly: true,
            oncePerTurn: true,
            // CR 106.1 / 613.4 (issue #927) — `source` carries Vivi's CURRENT
            // EFFECTIVE power (layers-aware: +1/+1 counters from her own
            // trigger, anthems, CDAs), not her raw base stat. Enumerate every
            // {U}/{R} split summing to X (CR 605.1a "any combination of");
            // the CHOSEN option is added directly to the pool by
            // `activateManaAbility` (issue #1179), bypassing any closure.
            getManaChoices: (source: PermanentView): ManaCost[] => {
                const x = Math.max(0, source.power ?? 0);
                const options: ManaCost[] = [];
                for (let u = 0; u <= x; u++) {
                    const r = x - u;
                    const option: ManaCost = {};
                    if (u > 0) option.U = u;
                    if (r > 0) option.R = r;
                    options.push(option);
                }
                return options;
            },
        },
    ],
    triggeredAbilities: [
        {
            id: "vivi-ornitier-noncreature-trigger",
            oracleText:
                "Whenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.",
            event: "SPELL_CAST",
            // CR 603.2 — fires only when the source's controller is the
            // caster and the cast spell is NOT a creature spell (CR 601.2i).
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "SPELL_CAST" &&
                event.casterId === self.controllerId &&
                !event.spellTypes.includes("Creature"),
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
                // CR 120.1 — 2-player / solo-2-seat scope: "each opponent" is
                // the single opponent (ADR — 3+ player multiplayer is out of
                // scope).
                { op: "dealDamage", amount: 1, to: { player: "opponent" } },
            ],
        },
    ],
};
