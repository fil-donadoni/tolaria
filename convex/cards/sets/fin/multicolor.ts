// FIN — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    CardType,
    GameEvent,
    ManaCost,
    PermanentView,
    SpellContext,
} from "../../types";
import { PERMANENT_TYPES } from "../../types";

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

const SIN_SPIRAS_PUNISHMENT_ID = "659be746-bd31-4a70-8cec-7798da78b0b5";

// CR 110.4a — a "permanent card" is an artifact, battle, creature,
// enchantment, land, or planeswalker card. Instant and sorcery cards are never
// eligible, which is the whole discriminator Sin's random pick needs.
const PERMANENT_CARD_TYPES: ReadonlySet<CardType> = new Set(PERMANENT_TYPES);

// Sin, Spira's Punishment — {4}{B}{G}{U} Legendary Creature — Leviathan Avatar
// 7/7. "Flying / Whenever Sin enters or attacks, exile a permanent card from
// your graveyard at random, then create a tapped token that's a copy of that
// card. If the exiled card is a land card, repeat this process."
//
// protocol card: the trailing clause is a CONDITIONAL REPEAT — "if the exiled
// card is a land card, repeat this process" — whose iteration count is decided
// by the card each pass draws. None of the DSL's four frozen constructs
// expresses it: `forEach` is bounded over a pre-enumerated collection and `if`
// does not loop, so a repeat-until-non-land would need a fifth construct
// (rejected: one card does not earn a new frozen construct) or an unrolled
// copy of the body per graveyard card (a card-shaped hack). The body itself is
// pure primitive composition — see `sinExileRandomPermanentAndCopy` — so the
// closure buys the loop and nothing else.
//
// CR 701.13a — exile the picked card (graveyard -> exile) BEFORE creating the
// copy, exactly in the Oracle's order: the token is a copy of the card as it
// now sits in exile.
//
// CR 707.2 — the copiable values of a card are the values derived from the
// text PRINTED on it. They do not depend on the card ever having been a
// permanent on the battlefield, so a card picked out of a graveyard copies
// exactly like a battlefield source; `createTokenCopyOf`'s
// `lastKnownFromGraveyardOrExile` opt-in is the documented channel for a
// non-battlefield source (CR 400.2 — only the two PUBLIC zones are searched).
//
// CR 701.7a — "create a tapped token that's a copy of that card": the token
// enters tapped, which `createTokenCopyOf` applies to the placeholder BEFORE
// `applyCopy` stamps the copied characteristics on.
//
// Termination (three distinct stop conditions, one test each): an EMPTY
// graveyard and a graveyard holding NO permanent card both leave the eligible
// pool empty, so the very first pick returns undefined and the loop stops
// without creating anything; otherwise the loop repeats only while the card it
// just exiled was a Land. Every iteration removes one card from the graveyard,
// so the pool strictly shrinks — but this runs inside a Convex mutation, where
// a spin is a server hang, so `exiledThisResolution` is an explicit belt: a
// card that somehow failed to leave the graveyard is never picked twice.
function sinExileRandomPermanentAndCopy(ctx: SpellContext): void {
    // CR 614.12a / ADR 0100 D5 (issues #2558, #2570) — REPLAY SAFETY, now the
    // ENGINE's. A copied card that declares "as this enters" choices (Voice of
    // All, Primal Clay, Meddling Mage, Illusionary Terrain) PARKS its token off
    // every zone until its controller answers. This used to suspend the
    // resolution — the trigger stayed on the stack and this body was re-entered
    // from its first line, exiling a SECOND graveyard card at random — so the
    // body carried a `collectedChoices` run-to-completion marker of its own.
    // #2570 moved that judgement to the suspension predicate: a plain
    // imperative `resolve()` is a `"completed"` body, and a stackless Entry
    // Park no longer suspends one, so the trigger pops and the entry tail runs
    // from the as-enters finalize. Nothing re-enters here, and the per-card
    // marker was deleted rather than left as a second, silent authority.
    sinExileCopyLoop(ctx);
}

/** The Oracle loop itself, extracted so its every `return` reads as "the loop
 *  is finished", not "the ability did nothing". */
function sinExileCopyLoop(ctx: SpellContext): void {
    const controller = ctx.controller;
    const exiledThisResolution = new Set<string>();
    for (;;) {
        const eligible = ctx
            .getGraveyardCards(controller)
            .filter(
                (c) =>
                    !exiledThisResolution.has(c.id) &&
                    c.types.some((t) => PERMANENT_CARD_TYPES.has(t))
            );
        const pickedId = ctx.pickAtRandom(eligible.map((c) => c.id));
        if (pickedId === undefined) return;
        const picked = eligible.find((c) => c.id === pickedId);
        if (picked === undefined) return;
        exiledThisResolution.add(pickedId);
        // CR 701.13a — "to exile an object, move it to the exile zone from
        // wherever it is". A card in your graveyard is always your own
        // (CR 400.3 — an object that would go to another player's graveyard
        // goes to its owner's instead), so the controller is also the zone
        // owner here.
        ctx.moveCardById(controller, pickedId, "graveyard", "exile");
        ctx.createTokenCopyOf(pickedId, controller, ctx.sourceInstanceId, {
            entersTapped: true,
            lastKnownFromGraveyardOrExile: true,
        });
        if (!picked.types.includes("Land")) return;
    }
}

export const sinSpirasPunishment: CardDefinition = {
    id: SIN_SPIRAS_PUNISHMENT_ID,
    name: "Sin, Spira's Punishment",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever Sin enters or attacks, exile a permanent card from your graveyard at random, then create a tapped token that's a copy of that card. If the exiled card is a land card, repeat this process.",
    manaCost: { X: 4, B: 1, G: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Leviathan", "Avatar"],
    supertypes: ["Legendary"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "sin-spira-exile-copy-loop",
            oracleText:
                "Whenever Sin enters or attacks, exile a permanent card from your graveyard at random, then create a tapped token that's a copy of that card. If the exiled card is a land card, repeat this process.",
            // CR 603.2 — ONE Oracle line spanning two engine events, so ONE
            // ability with an array `event` (the Loafing Giant shape,
            // `inv/red.ts`); two abilities would render twice on the stack.
            event: ["PERMANENT_ENTERED", "ATTACKERS_DECLARED"],
            matches: (event: GameEvent, self: PermanentView): boolean =>
                (event.type === "PERMANENT_ENTERED" &&
                    event.instanceId === self.id) ||
                (event.type === "ATTACKERS_DECLARED" &&
                    event.attackerIds.includes(self.id)),
            resolve: sinExileRandomPermanentAndCopy,
            // aiEffects (PRD #1423, issue #1519) — a bare `resolve()` body is
            // invisible to the bot's Effect Script value model, which would
            // valuate this trigger as neutral and make Sin read as a vanilla
            // 7/7 flier. The real body creates at least one token copy of an
            // unknowable graveyard card, so a representative 2/2 stands in —
            // the SAME "representative 2/2 for an unknowable body" convention
            // `createTokenCopy`'s own valuer documents in `gre/ai/opValuers.ts`
            // and Urza's Construct uses (`mh1/blue.ts`).
            aiEffects: [
                {
                    op: "createToken",
                    token: {
                        name: "Copy",
                        types: ["Creature"],
                        power: 2,
                        toughness: 2,
                        entersTapped: true,
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};
