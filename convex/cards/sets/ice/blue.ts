// Ice Age (ICE) — Blue (mono-U) cards, split by colour per ADR 0043.
// The registry's `import * as ice from "./sets/ice"` resolves through
// ice/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).
import type {
    CardDefinition,
    CardPrint,
    Color,
    DelayedTriggerDef,
    ManaCost,
    PermanentView,
    SpellContext,
    TriggeredAbility,
} from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { cumulativeUpkeepTrigger } from "../../abilities/cumulativeUpkeep";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";

// Color-word options for Balduvian Shaman's text change (CR 612 — the five
// color words). The chosen value is the lowercase color word `addTextChange`
// expects (matching Sleight of Mind's `COLOR_WORD_LIST`).
const COLOR_WORD_OPTIONS = [
    { id: "white", label: "White" },
    { id: "blue", label: "Blue" },
    { id: "black", label: "Black" },
    { id: "red", label: "Red" },
    { id: "green", label: "Green" },
];

// "At the beginning of your upkeep, sacrifice this permanent unless you pay
// <cost>" (CR 603.6a phase trigger + CR 117.3a may-pay with a hard action on
// decline). Local twin of the LEA helper of the same name — kept per-set so
// the set file stays self-contained.
function makeUpkeepPayOrElse(args: {
    id: string;
    oracleText: string;
    cost: ManaCost;
    prompt: string;
    onDecline: (ctx: SpellContext) => void;
}): TriggeredAbility {
    return phaseTrigger({
        id: args.id,
        oracleText: args.oracleText,
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                cost: args.cost,
                prompt: args.prompt,
            });
            if (accept === undefined) return;
            if (!accept) args.onDecline(ctx);
        },
    });
}

// "Draw a card at the beginning of the next turn's upkeep" cantrip rider
// (CR 502.2 / 603.7d) — the signature kicker on ~22 Ice Age commons. The
// scheduling spell/ability calls `scheduleNextUpkeepDraw` from its `resolve`;
// the matching `DelayedTriggerDef` (from `nextUpkeepDrawTrigger`) lives on the
// card's `delayedTriggers[]`. The trigger carries no `targetPlayerId`, so it
// fires at the VERY NEXT upkeep regardless of whose turn it is and dequeues
// exactly once (`fireDelayedTriggers` in gre/phases.ts). The drawing player is
// the spell's controller, captured in `payload.controller` (CR 113.7).
//
// Shared because the rider repeats verbatim across the whole cantrip cycle —
// extracting it keeps each card definition to its unique body (per the
// "extract on the second occurrence" convention).
const NEXT_UPKEEP_DRAW_TRIGGER_ID = "next-upkeep-cantrip";

function scheduleNextUpkeepDraw(ctx: SpellContext, sourceCardId: string): void {
    ctx.scheduleDelayedTrigger(
        sourceCardId,
        NEXT_UPKEEP_DRAW_TRIGGER_ID,
        "next-upkeep",
        {}
    );
}

function nextUpkeepDrawTrigger(): DelayedTriggerDef {
    return {
        id: NEXT_UPKEEP_DRAW_TRIGGER_ID,
        oracleText: "At the beginning of the next turn's upkeep, draw a card.",
        timing: "next-upkeep",
        resolve: (ctx) => {
            // CR 121.1 — the trigger's controller (the scheduling spell's
            // controller, or the activator on the tap-rider path) draws one
            // card. `ctx.controller` is the delayed trigger's controller in
            // both scheduling paths (`fireDelayedTriggers` sets the stack
            // item's controller to the instance's `controller`).
            ctx.drawCards(ctx.controller, 1);
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Blue free tranche (#631)
//
// The free-tranche Blue cards — expressible entirely with already-shipped
// primitives — are activated below (intermixed with the remaining commented
// stubs). Counterspell, Power Sink and Sleight of Mind are LEA reprints, wired
// as CardPrints onto their existing definitions (ADR 0014); every other
// new-to-ICE Blue card is a full CardDefinition.
//
// CUMULATIVE UPKEEP (ADR 0042) — the Blue CU enchantments are now ACTIVE:
//   Arnjlot's Ascent, Breath of Dreams, the four Illusionary creatures,
//   Illusionary Terrain, Illusions of Grandeur, Mesmeric Trance, Polar Kraken,
//   Snowfall, plus the "CU matters" enchantments Musician, Mystic Might, Mystic
//   Remora and Reality Twist (#726).
//
// DEFERRED (remain commented stubs, owned by a later cluster):
//   • Zur's Weirding cluster — Zur's Weirding itself and Dreams of the Dead
//     (grants cumulative upkeep on reanimation).
//   • "Draw a card at the beginning of the next turn's upkeep" delayed cantrips
//     — Clairvoyance, Enervate, Force Void, Infuse, Portent, Ray of Erasure,
//     Updraft: ACTIVE (#660 — the `next-upkeep` delayed-trigger timing shipped;
//     the cantrips schedule it via `scheduleNextUpkeepDraw`).
//   • ACTIVE (#730) — until-end-of-turn control gain + "tap it when you lose
//     control": Ray of Command, Magus of the Unseen. Uses the new
//     `gainControlUntilEndOfTurn` primitive (duration-scoped control change +
//     tap-on-loss rider, reverted at cleanup by `tickAllDurations`); haste is
//     now honoured by combat.
//   • Specialized primitives still missing — Mistfolk (counter a spell that
//     targets this creature — no "spell targeting source" target filter),
//     Phantasmal Mount (linked leaves-the-battlefield sacrifices — no delayed
//     "leaves the battlefield this turn" trigger timing), Essence Vortex (pay
//     LIFE in a may-pay choice), Soldevi Machinist (mana spendable only on
//     artifact ABILITIES — ManaRestriction has only spell variants), Merieke Ri
//     Berit (conditional control + destroy-on-untap), Winter's Chill (combat-
//     only X capped by snow lands), Balduvian Conjurer (animate a snow land),
//     Balduvian Shaman / Sleight-of-Mind-style colour-word text change that
//     also grants cumulative upkeep.
//
// COMPLETED (#654) — buildable-now Blue cards using shipped primitives only:
//   • Krovikan Sorcerer — colour-filtered chosen-discard cost paid in-resolve
//     (Mesmeric Trance pattern, `candidateIds` from hand colours) + draw.
//   • Shyft — upkeep `may` → `requestOptionChoice` colour → indefinite layer-5
//     `setColorOverride` (single-colour reading; multicolour deferred).
// ─────────────────────────────────────────────────────────────────────────────

// Arnjlot's Ascent — {U}{U} Enchantment with cumulative upkeep {U} (CR 702.24)
// and "{1}: Target creature gains flying until end of turn." The CU keyword is
// the ADR 0042 template; the activated grant mirrors Flying Carpet (arn.ts).
export const arnjlotsAscent: CardDefinition = {
    id: "2307fb16-8b77-45b5-8a02-51a13214791d",
    name: "Arnjlot's Ascent",
    rarity: "common",
    oracleText:
        "Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{1}: Target creature gains flying until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "arnjlots-ascent-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
    activatedAbilities: [
        {
            id: "arnjlots-ascent-grant-flying",
            oracleText: "{1}: Target creature gains flying until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #843): grant flying to the
            // announced target creature until end of turn (CR 611.1b).
            effects: [
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Balduvian Conjurer — {T}: animate a target SNOW land into a 2/2 creature
// until end of turn (CR 208.2 / 611.1 — `animateAsCreature`; "it's still a
// land" since animate ADDS the Creature type without removing Land). The target
// is gated to snow lands via the live `supertypeFilter` (CR 205.4a).
export const balduvianConjurer: CardDefinition = {
    id: "5b616963-fac0-451c-8df4-2cacc9466b17",
    name: "Balduvian Conjurer",
    rarity: "uncommon",
    oracleText:
        "{T}: Target snow land becomes a 2/2 creature until end of turn. It's still a land.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "balduvian-conjurer-animate",
            oracleText:
                "{T}: Target snow land becomes a 2/2 creature until end of turn. It's still a land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                supertypeFilter: ["Snow"],
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.animateAsCreature(target, {
                        power: 2,
                        toughness: 2,
                        duration: { phase: "end-of-turn" },
                    });
                }
            },
        },
    ],
};
// Balduvian Shaman — {T}: target a white enchantment you control without
// cumulative upkeep, (a) replace one color word in its text with another
// (CR 612 / 613 layer-3 text change — Sleight of Mind's primitive), and (b)
// grant it "Cumulative upkeep {1}" PERMANENTLY (CR 702.24, CR 113.1 / 611.2c —
// ADR 0042). The grant rides the enchantment indefinitely (independent of the
// Shaman) via `grantTriggeredAbilityPermanent`, reading its template from
// `triggeredGrantTemplates[]`; age counters accrue on the enchantment, paid by
// its controller. The "to" color word is picked by the activator at resolution
// (`requestOptionChoice`); the "from" word is the first present color word that
// differs (matching Sleight of Mind's auto-pick). `useStack: true` — it goes on
// the stack and can be responded to.
const BALDUVIAN_SHAMAN_ID = "74859723-8ddf-4ee6-a0a7-87192c84e8ad";
export const balduvianShaman: CardDefinition = {
    id: BALDUVIAN_SHAMAN_ID,
    name: "Balduvian Shaman",
    rarity: "common",
    oracleText:
        '{T}: Change the text of target white enchantment you control that doesn\'t have cumulative upkeep by replacing all instances of one color word with another. (For example, you may change "black creatures can\'t attack" to "blue creatures can\'t attack.") That enchantment gains "Cumulative upkeep {1}." (At the beginning of its controller\'s upkeep, that player puts an age counter on it, then sacrifices it unless they pay its upkeep cost for each age counter on it.)',
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Shaman"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "balduvian-shaman-grant",
            oracleText:
                '{T}: Change the text of target white enchantment you control that doesn\'t have cumulative upkeep by replacing all instances of one color word with another. That enchantment gains "Cumulative upkeep {1}."',
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                count: 1,
                controller: "you",
                colorFilter: "W",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "permanent") return;
                // CR 612 — replace one color word with the chosen one.
                const present = ctx.getColorWordsPresent(target);
                if (present.length > 0) {
                    const to = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "balduvian-shaman-color-word",
                        options: COLOR_WORD_OPTIONS,
                        prompt: "Replace a color word with:",
                    });
                    if (to === undefined) return; // suspended for the choice
                    const from = present.find((w) => w !== to) ?? present[0];
                    if (from) {
                        ctx.addTextChange(target, {
                            kind: "color-word",
                            from,
                            to,
                        });
                    }
                }
                // CR 113.1 / 702.24 — the enchantment gains "Cumulative upkeep
                // {1}" permanently (independent of the Shaman).
                ctx.grantTriggeredAbilityPermanent(
                    target,
                    BALDUVIAN_SHAMAN_ID,
                    "balduvian-shaman-granted-cu"
                );
            },
        },
    ],
    triggeredGrantTemplates: [
        cumulativeUpkeepTrigger({
            id: "balduvian-shaman-granted-cu",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
};
// Binding Grasp — Aura granting control of the enchanted creature (CR 613.1b,
// layer 2 control-change) plus a static +0/+1 (layer 7c) and an upkeep
// pay-{1}{U}-or-sacrifice tax (CR 603.6a / 117.3a). The Control-Magic shape
// with an upkeep cost rider.
export const bindingGrasp: CardDefinition = {
    id: "6b086186-5fbf-4ba7-af0d-ee3ad61d27bb",
    name: "Binding Grasp",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nAt the beginning of your upkeep, sacrifice this Aura unless you pay {1}{U}.\nYou control enchanted creature.\nEnchanted creature gets +0/+1.",
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "control-change", applies: AURA_AFFECTS_HOST },
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 0, toughness: 1 },
    ],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "binding-grasp-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this Aura unless you pay {1}{U}.",
            cost: { X: 1, U: 1 },
            prompt: "Pay {1}{U} to keep Binding Grasp?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};
// Brainstorm — "Draw three cards, then put two cards from your hand on top of
// your library in any order." (CR 121.1 draw, CR 401 library top.) Composition:
// drawCards(3) then a two-step resolution — the caster picks 2 hand cards (a
// `choose-hand-card` requestChoice), each moved to the top of the library; the
// pick order IS the top-of-library order (the first picked ends up second from
// top, matching "in any order" since the player controls the sequence).
export const brainstorm: CardDefinition = {
    id: "8d42d7aa-7f53-4cfc-842a-086aab2448d1",
    name: "Brainstorm",
    rarity: "common",
    oracleText:
        "Draw three cards, then put two cards from your hand on top of your library in any order.",
    manaCost: { U: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.drawCards(ctx.controller, 3);
        const picks = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "brainstorm-putback",
            kind: "choose-hand-card",
            zone: "hand",
            count: 2,
            prompt: "Choose two cards to put on top of your library (last picked ends up on top).",
        });
        if (picks === undefined) return; // suspended for the choice
        // Move each pick to the top; the second pick lands on top last, so the
        // player's chosen order is preserved (CR 401 "in any order").
        for (const id of picks) {
            ctx.moveHandCardToLibraryTop(ctx.controller, id);
        }
    },
};
// Breath of Dreams — {2}{U}{U} Enchantment with cumulative upkeep {U} on itself,
// plus a GROUP GRANT of "Cumulative upkeep {1}" to every green creature
// (CR 702.24, CR 611 continuous triggered-ability grant — ADR 0042). Modeled
// exactly like Energy Flux (atq.ts): a `triggered-grant` static whose `applies`
// is the green-creature predicate, with the granted template — the
// cumulative-upkeep trigger — living on `triggeredGrantTemplates[]` (kept off
// `triggeredAbilities` so Breath of Dreams itself, an Enchantment, never fires
// the granted CU). The age counter accrues on each green creature (the host),
// paid by that creature's controller (CR 702.24a). New green creatures entering
// while Breath of Dreams is in play receive the grant; it detaches when Breath
// leaves. Both players' green creatures are affected (the text is not
// controller-scoped).
const IS_GREEN_CREATURE = (
    target: PermanentView,
    _source: PermanentView,
    ctx: import("../../types").StaticEffectContext
): boolean => ctx.isCreature(target) && ctx.getColors(target).includes("G");
export const breathOfDreams: CardDefinition = {
    id: "e40c9657-fab4-489d-8eb0-960ba2605add",
    name: "Breath of Dreams",
    rarity: "uncommon",
    oracleText:
        'Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nGreen creatures have "Cumulative upkeep {1}."',
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "breath-of-dreams-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
    staticEffects: [
        // CR 113.1 / 611 — grant "Cumulative upkeep {1}" to every green creature.
        {
            kind: "triggered-grant",
            applies: IS_GREEN_CREATURE,
            abilityId: "breath-of-dreams-granted-cu",
        },
    ],
    // The granted CU template lives here, NOT on `triggeredAbilities`, so Breath
    // of Dreams (an Enchantment, not a green creature) never fires it itself.
    triggeredGrantTemplates: [
        cumulativeUpkeepTrigger({
            id: "breath-of-dreams-granted-cu",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
};
// Clairvoyance — {U} Instant. "Look at target player's hand" (CR 401.4 look,
// via the `revealHand` display-only choice) plus the next-upkeep cantrip rider.
export const clairvoyance: CardDefinition = {
    id: "46740353-e2ba-4d80-a97d-1368bc67bf30",
    name: "Clairvoyance",
    rarity: "common",
    oracleText:
        "Look at target player's hand.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (t?.type === "player") {
                // CR 401.4 — display the target's hand to the controller; the
                // step suspends until the controller dismisses it.
                if (ctx.revealHand(t.id) === undefined) return;
            }
            scheduleNextUpkeepDraw(ctx, clairvoyance.id);
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Counterspell — ICE reprint of the LEA instant ("Counter target spell").
// CardPrint onto the LEA definition (ADR 0014).
export const counterspellIce: CardPrint = {
    printId: "aedbcbaa-40f0-485f-8427-778edc2d2ec0",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    setCode: "ice",
    rarity: "common",
};
// Deflection — "Change the target of target spell with a single target."
// (CR 114.6 — change a spell's target.) Targets a spell on the stack; on
// resolution it enters a `retarget` phase via `requestRetarget`, asking the
// caster to pick a new legal target for that spell.
//
// SIMPLIFICATION (flagged, no engine change): TargetRequirement has no
// "spell with a single target" filter, so Deflection may be cast at any spell
// on the stack. The retarget then re-validates against "any target"; for a
// multi-target spell only one target would be re-chosen, which is a minor
// deviation from the printed "single target" restriction. Acceptable for the
// current pool, where targeted spells are overwhelmingly single-target.
export const deflection: CardDefinition = {
    id: "1005a00a-6a0e-44cb-abea-37e2e53125e2",
    name: "Deflection",
    rarity: "rare",
    oracleText: "Change the target of target spell with a single target.",
    manaCost: { X: 3, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "spell") return;
        // Re-pick a single new target for the spell against "any target" —
        // the engine re-validates the new target against the spell's own
        // requirement at selection time (CR 114.6).
        ctx.requestRetarget(t.id, { type: "any", count: 1 });
    },
};
// Dreams of the Dead — {3}{U} Enchantment with a {1}{U} reanimation ability:
// "Return target white or black creature card from your graveyard to the
// battlefield. That creature gains 'Cumulative upkeep {2}.' If the creature
// would leave the battlefield, exile it instead of putting it anywhere else."
// (CR 400.7 zone change, CR 702.24 granted CU — ADR 0042, CR 614.1c leave →
// exile replacement.) The granted CU rides the reanimated creature permanently
// (independent of Dreams) via `grantTriggeredAbilityPermanent`; the persistent
// `setExileOnLeave` flag routes EVERY later departure (dies / sacrifice / bounce
// / destroy) to exile, so the creature can't be re-reanimated. The {1}{U} cost
// is paid at activation; the reanimation resolves from the stack (useStack: true).
const DREAMS_OF_THE_DEAD_ID = "93372854-57e7-4db7-a1a6-376c9f49a514";
export const dreamsOfTheDead: CardDefinition = {
    id: DREAMS_OF_THE_DEAD_ID,
    name: "Dreams of the Dead",
    rarity: "uncommon",
    oracleText:
        '{1}{U}: Return target white or black creature card from your graveyard to the battlefield. That creature gains "Cumulative upkeep {2}." If the creature would leave the battlefield, exile it instead of putting it anywhere else. (At the beginning of its controller\'s upkeep, that player puts an age counter on it, then sacrifices it unless they pay its upkeep cost for each age counter on it.)',
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "dreams-of-the-dead-reanimate",
            oracleText:
                '{1}{U}: Return target white or black creature card from your graveyard to the battlefield. That creature gains "Cumulative upkeep {2}." If the creature would leave the battlefield, exile it instead of putting it anywhere else.',
            cost: { mana: { X: 1, U: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
                colorFilterAny: ["W", "B"],
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "graveyard-card" || !t.playerId) return;
                // CR 400.7 — return to the battlefield under the controller's
                // control. The instance keeps its id, so we grant CU and the
                // exile-on-leave replacement to the same id afterwards.
                const ok = ctx.returnToBattlefield(
                    ctx.controller,
                    t.id,
                    "graveyard"
                );
                if (!ok) return;
                const host = { type: "permanent" as const, id: t.id };
                // CR 702.24 — the creature gains "Cumulative upkeep {2}".
                ctx.grantTriggeredAbilityPermanent(
                    host,
                    DREAMS_OF_THE_DEAD_ID,
                    "dreams-of-the-dead-granted-cu"
                );
                // CR 614.1c — if it would leave, exile it instead (all paths).
                ctx.setExileOnLeave(host);
            },
        },
    ],
    triggeredGrantTemplates: [
        cumulativeUpkeepTrigger({
            id: "dreams-of-the-dead-granted-cu",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
    ],
};
// Enervate — {1}{U} Instant. "Tap target artifact, creature, or land"
// (CR 701.20 tap) plus the next-upkeep cantrip rider.
export const enervate: CardDefinition = {
    id: "c4fdfc5b-c2ab-4c4d-b120-301e17f3d9c6",
    name: "Enervate",
    rarity: "common",
    oracleText:
        "Tap target artifact, creature, or land.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Creature", "Land"], count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #842): tap the announced
    // artifact/creature/land target (CR 701.26a), then the next-upkeep cantrip
    // as an inline `delayedTrigger` Op (ADR 0048, CR 603.7d).
    effects: [
        { op: "tapUntap", action: "tap", target: { target: 0 } },
        {
            op: "delayedTrigger",
            timing: "next-upkeep",
            oracleText:
                "At the beginning of the next turn's upkeep, draw a card.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};
// DEFERRED (#628) — re-verified against the current engine (2026-07). Errant
// Minion's upkeep trigger lets the enchanted creature's controller "pay any
// amount of mana", then deals 2 damage to them and prevents X of it, X = the
// amount paid. `mayPay` is a boolean gate over a FIXED cost and `addMana` is a
// fixed produced amount — neither expresses a VARIABLE-amount payment whose paid
// total feeds a later prevention value. There is no "pay any amount of mana"
// choice primitive that captures the amount. Papering this with a resolve() that
// caps the pay at {2} (paying more is pointless) would misrepresent "any amount"
// and hard-code the interaction — a card-shaped gap-paper, disallowed. Blocked
// on: a variable-amount mana-payment value primitive.
// export const errantMinion: CardDefinition = {
//     id: "61648ddb-6efb-43d0-b2b1-418cc957854c",
//     name: "Errant Minion",
//     rarity: "common",
//     oracleText: "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player may pay any amount of mana. This Aura deals 2 damage to that player. Prevent X of that damage, where X is the amount of mana that player paid this way.",
//     manaCost: { X: 2, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };
// Essence Flare — Aura: static +2/+0 (layer 7c) plus an upkeep trigger on the
// enchanted creature's controller that puts a -0/-1 counter on the host
// (CR 603.6a phase trigger, CR 122 counters, layer 7d). The host wastes away one
// toughness per upkeep.
export const essenceFlare: CardDefinition = {
    id: "13ebb5dd-d7f1-4b06-8585-7004045be542",
    name: "Essence Flare",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature gets +2/+0.\nAt the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 2, toughness: 0 },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "essence-flare-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.",
            phase: "UPKEEP",
            scope: "host-controller",
            // NOT DSL-migratable (ADR 0045): the counter target is the ENCHANTED
            // creature (`getAttachedTo`), and no `EffectObjectSelector` names an
            // Aura's attached object (only announced slots, `$source`, `$each`).
            // The phaseTrigger `effects[]` site is also restricted to
            // `scope: "your"`; this is `host-controller`. Stays resolve() until
            // an attached-object selector exists.
            resolve: (ctx) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addCounter({ type: "permanent", id: hostId }, "-0/-1", 1);
            },
        }),
    ],
};
// Force Void — {2}{U} Instant. "Counter target spell unless its controller
// pays {1}" (CR 701.5a counter-unless-pay; CR 117.3a may-pay billed to the
// spell's controller — Vodalian Mage pattern) plus the next-upkeep cantrip
// rider. The schedule lands in a SEPARATE resolve step AFTER the may-pay so a
// suspension on the {1} prompt never double-schedules the draw.
export const forceVoid: CardDefinition = {
    id: "226555ba-22af-45f1-a3f4-d265f8685dd5",
    name: "Force Void",
    rarity: "uncommon",
    oracleText:
        "Counter target spell unless its controller pays {1}.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target || target.type !== "spell") return;
            const spellController = ctx.getController(target);
            const accept = ctx.requestMayPay({
                playerId: spellController,
                choiceId: `force-void-${ctx.sourceInstanceId}`,
                cost: { X: 1 },
                prompt: "Pay {1} or your spell is countered (Force Void)?",
            });
            if (accept === undefined) return; // suspended on the may-pay
            if (!accept) ctx.counter(target);
        },
        (ctx: SpellContext) => {
            scheduleNextUpkeepDraw(ctx, forceVoid.id);
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Glacial Wall — 0/7 Wall with Defender (CR 702.3).
export const glacialWall: CardDefinition = {
    id: "07b71bc1-d9a2-4e99-a8fa-cd696925328d",
    name: "Glacial Wall",
    rarity: "uncommon",
    oracleText: "Defender",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 7,
    staticAbilities: ["defender"],
};
// Hydroblast — modal "choose one" (CR 700.2): counter a red spell OR destroy a
// red permanent. Each mode restricts its target to red via `colorFilter: "R"`
// (the "if it's red" clause is enforced as a target restriction in the current
// pool, which is equivalent for these single-target modes). Functionally the
// Blue Elemental Blast shape.
export const hydroblast: CardDefinition = {
    id: "f62716f0-fde2-49ef-b8a4-c1b03f451194",
    name: "Hydroblast",
    rarity: "common",
    oracleText:
        "Choose one —\n• Counter target spell if it's red.\n• Destroy target permanent if it's red.",
    manaCost: { U: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "counter",
            label: "Counter target red spell",
            oracleText: "Counter target spell if it's red.",
            targetRequirement: { type: "spell", count: 1, colorFilter: "R" },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type === "spell") ctx.counter(t);
            },
        },
        {
            id: "destroy",
            label: "Destroy target red permanent",
            oracleText: "Destroy target permanent if it's red.",
            targetRequirement: { type: "any", count: 1, colorFilter: "R" },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.destroy(t);
            },
        },
    ],
};
// Iceberg — counters-as-mana battery (CR 122 counters, CR 605 mana ability).
// Enters with X ice counters; "{3}: Put an ice counter on this" stores mana,
// and "Remove an ice counter: Add {C}" spends it. The removal ability is a mana
// ability (`useStack: false`, CR 605.1a) so it resolves immediately.
export const iceberg: CardDefinition = {
    id: "a2f70e49-17fa-4033-bd45-63374f7f5ec5",
    name: "Iceberg",
    rarity: "uncommon",
    oracleText:
        "This enchantment enters with X ice counters on it.\n{3}: Put an ice counter on this enchantment.\nRemove an ice counter from this enchantment: Add {C}.",
    manaCost: { X: "X", U: 2 },
    types: ["Enchantment"],
    entersWith: { counters: [{ type: "ice", count: "X" }] },
    activatedAbilities: [
        {
            id: "iceberg-store",
            oracleText: "{3}: Put an ice counter on this enchantment.",
            cost: { mana: { X: 3 } },
            useStack: true,
            // CR 122 (issue #841) — put one ice counter on the source.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "ice",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
        {
            id: "iceberg-tap-for-mana",
            oracleText: "Remove an ice counter from this enchantment: Add {C}.",
            cost: { removeCounter: { type: "ice", count: 1 } },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
    ],
};
// Icy Prison — ETB-targeted exile-and-return holding bundle (CR 603.7a /
// ADR 0028) plus an upkeep sacrifice tax. On entry it exiles a target creature
// (keyed to itself); each upkeep it is sacrificed unless {3} is paid; when it
// leaves, the exiled card returns to the battlefield under its owner's control.
//
// SIMPLIFICATION (flagged, no engine change): the printed upkeep cost is "any
// player pays {3}" — political. `makeUpkeepPayOrElse` prompts the controller
// (the player who wants to keep it). In a duel the controller is the only
// player with an incentive to pay, so this matches play in practice.
export const icyPrison: CardDefinition = {
    id: "39a7e496-8d2e-49db-b298-475d9017537a",
    name: "Icy Prison",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, exile target creature.\nAt the beginning of your upkeep, sacrifice this enchantment unless any player pays {3}.\nWhen this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "icy-prison-exile",
            oracleText: "When this enchantment enters, exile target creature.",
            scope: "self",
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.exileWithAttachments(t.id, {
                    sourceId: ctx.sourceInstanceId,
                    returnTapped: false,
                });
            },
        }),
        makeUpkeepPayOrElse({
            id: "icy-prison-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless any player pays {3}.",
            cost: { X: 3 },
            prompt: "Pay {3} to keep Icy Prison?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
        leftTrigger({
            id: "icy-prison-return",
            oracleText:
                "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                ctx.returnExiledForSource(ctx.sourceInstanceId);
            },
        }),
    ],
};
// Illusionary Forces — {3}{U} 4/4 flier with cumulative upkeep {U} (CR 702.24,
// ADR 0042). Flying is a plain keyword static; the CU keyword is the template.
export const illusionaryForces: CardDefinition = {
    id: "ab02268e-01cf-4729-95ca-5773afd40b56",
    name: "Illusionary Forces",
    rarity: "common",
    oracleText:
        "Flying\nCumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "illusionary-forces-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
};
// Illusionary Presence — cumulative upkeep {U} (CR 702.24, ADR 0042) plus an
// "at the beginning of your upkeep, choose a land type" trigger that grants
// THIS creature the matching landwalk until end of turn (CR 603.6a /
// 702.13 / 611.1b). The land-type choice is a `requestOptionChoice` over the
// five basic types (same single-pick primitive Barbarian Guides uses for its
// snow-landwalk grant); the matching `<type>walk` keyword is granted until end
// of turn via `grantStaticAbility`, so a fresh choice is made each upkeep. The
// grant is self-scoped (`$source`), and the prior turn's keyword has already
// expired at the CLEANUP boundary by the time this re-fires.
export const illusionaryPresence: CardDefinition = {
    id: "aa31efed-4a11-4f59-a623-bac45d20091d",
    name: "Illusionary Presence",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAt the beginning of your upkeep, choose a land type. This creature gains landwalk of the chosen type until end of turn. (It can't be blocked as long as defending player controls a land of that type.)",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "illusionary-presence-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
        phaseTrigger({
            id: "illusionary-presence-landwalk",
            oracleText:
                "At the beginning of your upkeep, choose a land type. This creature gains landwalk of the chosen type until end of turn.",
            phase: "UPKEEP",
            scope: "your",
            // Migrated resolve()→effects[] (ADR 0045, issue #849): the "choose a
            // land type" pick is the `optionChoice` Op — five modes over the
            // basic types (CR 702.13), each granting the matching landwalk
            // keyword to this creature (`$source`) until end of turn via
            // grantAbility (CR 611.1b). The land-type option ids are preserved.
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a land type for landwalk.",
                    modes: [
                        {
                            id: "Plains",
                            label: "Plains",
                            effects: [
                                {
                                    op: "grantAbility",
                                    ability: "plainswalk",
                                    target: { ref: "$source" },
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                        {
                            id: "Island",
                            label: "Island",
                            effects: [
                                {
                                    op: "grantAbility",
                                    ability: "islandwalk",
                                    target: { ref: "$source" },
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                        {
                            id: "Swamp",
                            label: "Swamp",
                            effects: [
                                {
                                    op: "grantAbility",
                                    ability: "swampwalk",
                                    target: { ref: "$source" },
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                        {
                            id: "Mountain",
                            label: "Mountain",
                            effects: [
                                {
                                    op: "grantAbility",
                                    ability: "mountainwalk",
                                    target: { ref: "$source" },
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                        {
                            id: "Forest",
                            label: "Forest",
                            effects: [
                                {
                                    op: "grantAbility",
                                    ability: "forestwalk",
                                    target: { ref: "$source" },
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
};
// DEFERRED (issue #727) — needs a genuinely-absent engine seam, so it stays a
// tracked stub rather than being papered over.
//   "As this enchantment enters, choose two basic land types. Basic lands of
//    the first chosen type are the second chosen type."
// This is a continuous layer-4 subtype-changing static (like Blood Moon) whose
// OUTPUT subtype is DYNAMIC — the second chosen type, picked on entry — and
// whose applicability is gated by the FIRST chosen type. The shipped
// `subtype-set` static (`StaticSubtypeSet`) carries a FIXED `subtypes: string[]`
// (Blood Moon → always Mountain); there is no way to drive the set value from a
// pair of on-entry choices. Two missing pieces:
//   1. On-entry storage of an ORDERED PAIR of basic land types on the instance
//      (the `chosenModeId` field holds a single string; there is no chosen-
//      subtype-pair slot readable by a static).
//   2. A subtype-set variant whose `subtypes` is computed from the source's
//      stored choice (a `subtypesFor(source, ctx)` form, or the ability for
//      `applies` to project the target's subtype through the stored map).
// The cumulative upkeep {2} half is fully expressible (ADR 0042 template); the
// swap is not. Flagged for a "chosen-subtype-pair driven layer-4 swap" seam.
// export const illusionaryTerrain: CardDefinition = {
//     id: "691f4a1b-4706-41aa-82da-ae920739f036",
//     name: "Illusionary Terrain",
//     rarity: "uncommon",
//     oracleText: "Cumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAs this enchantment enters, choose two basic land types.\nBasic lands of the first chosen type are the second chosen type.",
//     manaCost: { U: 2 },
//     types: ["Enchantment"],
// };
// Illusionary Wall — {4}{U} 7/4 with defender, flying, first strike and
// cumulative upkeep {U} (CR 702.24, ADR 0042). All keywords are plain statics.
export const illusionaryWall: CardDefinition = {
    id: "6430e8e2-fee3-4744-820e-d6e16cb992bd",
    name: "Illusionary Wall",
    rarity: "common",
    oracleText:
        "Defender, flying, first strike\nCumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion", "Wall"],
    power: 7,
    toughness: 4,
    staticAbilities: ["defender", "flying", "first strike"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "illusionary-wall-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
    ],
};
// Illusions of Grandeur — {3}{U} Enchantment with cumulative upkeep {2}
// (CR 702.24), an ETB "gain 20 life" and an LTB "lose 20 life" (the classic
// Donate combo half). CU is the ADR 0042 template; the life swings are self-
// scoped enter/left triggers (CR 603.6).
export const illusionsOfGrandeur: CardDefinition = {
    id: "17eeeef2-2ced-42b8-a5e0-1095c9e13b02",
    name: "Illusions of Grandeur",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {2} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhen this enchantment enters, you gain 20 life.\nWhen this enchantment leaves the battlefield, you lose 20 life.",
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "illusions-of-grandeur-cumulative-upkeep",
            cost: { X: 2 },
            costLabel: "{2}",
        }),
        enteredTrigger({
            id: "illusions-of-grandeur-etb",
            oracleText: "When this enchantment enters, you gain 20 life.",
            scope: "self",
            resolve: (ctx: SpellContext) => ctx.gainLife(ctx.controller, 20),
        }),
        leftTrigger({
            id: "illusions-of-grandeur-ltb",
            oracleText:
                "When this enchantment leaves the battlefield, you lose 20 life.",
            scope: "self",
            resolve: (ctx: SpellContext, _event, leaving) =>
                ctx.loseLife(leaving.controllerId, 20),
        }),
    ],
};
// Infuse — {2}{U} Instant. "Untap target artifact, creature, or land"
// (CR 701.20 untap) plus the next-upkeep cantrip rider.
export const infuse: CardDefinition = {
    id: "223287b6-224c-4e00-946c-e7ac5539bd45",
    name: "Infuse",
    rarity: "common",
    oracleText:
        "Untap target artifact, creature, or land.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Creature", "Land"], count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #842): untap the announced
    // artifact/creature/land target (CR 701.26b), then the next-upkeep cantrip
    // as an inline `delayedTrigger` Op (ADR 0048, CR 603.7d).
    effects: [
        { op: "tapUntap", action: "untap", target: { target: 0 } },
        {
            op: "delayedTrigger",
            timing: "next-upkeep",
            oracleText:
                "At the beginning of the next turn's upkeep, draw a card.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};
// Krovikan Sorcerer — two looters whose discard cost is colour-filtered
// (CR 601.2h convention — the chosen-discard is paid in-resolve, Mesmeric
// Trance pattern). `PermanentFilter` has no `excludeColors`, so "nonblack" is
// expressed as a precomputed `candidateIds` allow-list from the hand's colours
// (CR 105.2 — black = colour B). Each ability taps (CR 602.1) and goes on the
// stack (`useStack: true`). The black branch is a draw-2-then-discard-1
// (CR 121.1 draw, CR 701.8 discard) sequenced across `resolveSteps`.
export const krovikanSorcerer: CardDefinition = {
    id: "9c5fc053-7b0b-4e76-bf87-ccdb1e8752ed",
    name: "Krovikan Sorcerer",
    rarity: "common",
    oracleText:
        "{T}, Discard a nonblack card: Draw a card.\n{T}, Discard a black card: Draw two cards, then discard one of them.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard", "Sorcerer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "krovikan-sorcerer-nonblack",
            oracleText: "{T}, Discard a nonblack card: Draw a card.",
            cost: { tap: true },
            useStack: true,
            resolveSteps: [
                // Step 0 — pay the discard portion of the cost: a chosen
                // nonblack card from hand (CR 601.2h convention).
                (ctx: SpellContext) => {
                    const candidateIds = ctx
                        .getHandCards(ctx.controller)
                        .filter((c) => !c.colors.includes("B"))
                        .map((c) => c.id);
                    if (candidateIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "krovikan-sorcerer-nonblack-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        candidateIds,
                        prompt: "Discard a nonblack card (Krovikan Sorcerer).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
                // Step 1 — draw a card (CR 121.1). Only if a discard was paid.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "krovikan-sorcerer-nonblack-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    ctx.drawCards(ctx.controller, 1);
                },
            ],
        },
        {
            id: "krovikan-sorcerer-black",
            oracleText:
                "{T}, Discard a black card: Draw two cards, then discard one of them.",
            cost: { tap: true },
            useStack: true,
            resolveSteps: [
                // Step 0 — pay the discard portion of the cost: a chosen black
                // card from hand (CR 601.2h convention).
                (ctx: SpellContext) => {
                    const candidateIds = ctx
                        .getHandCards(ctx.controller)
                        .filter((c) => c.colors.includes("B"))
                        .map((c) => c.id);
                    if (candidateIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "krovikan-sorcerer-black-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        candidateIds,
                        prompt: "Discard a black card (Krovikan Sorcerer).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
                // Step 1 — draw two cards (CR 121.1). Only if the discard cost
                // was paid.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "krovikan-sorcerer-black-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    ctx.drawCards(ctx.controller, 2);
                },
                // Step 2 — then discard one of them (CR 701.8). A free choice
                // among the cards now in hand.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "krovikan-sorcerer-black-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    const handIds = ctx.getHandIds(ctx.controller);
                    if (handIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "krovikan-sorcerer-black-then-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard one of the drawn cards (Krovikan Sorcerer).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
            ],
        },
    ],
};
// Shared "gain control until end of turn" body for Ray of Command (steals a
// creature) and Magus of the Unseen (steals an artifact), issue #730. The three
// clauses — untap (CR 701.20a), gain control until end of turn (CR 611.2b /
// 613.1b layer 2, reverted at cleanup CR 514.2 by `tickAllDurations`), and
// grant haste until end of turn (CR 702.10b / 611.1b, so a stolen creature can
// attack the turn control is gained) — are all resolve()-time primitives.
//
// protocol: EOT control change + tap-on-loss rider — no ControlChangeCondition
// variant (gainControl Op note, #848). The `tapUntap` / `grantAbility` clauses
// ARE expressible Ops, but `effects[]` and `resolve()` are mutually exclusive
// per effect site (ADR 0045 validate.ts), so the whole effect stays resolve().
// The "when you lose control of it, tap it" rider (CR 701.20a) is carried by the
// `tapOnLoss` flag on the duration-scoped control change.
function gainControlUntilEndOfTurnBody(ctx: SpellContext): void {
    const target = ctx.targets[0];
    if (target?.type !== "permanent") return;
    ctx.untap(target);
    ctx.gainControlUntilEndOfTurn(target, ctx.controller, { tapOnLoss: true });
    ctx.grantStaticAbility(target, "haste", { phase: "end-of-turn" });
}
export const magusOfTheUnseen: CardDefinition = {
    id: "86da04e9-b94d-42af-add3-02baf772bd33",
    name: "Magus of the Unseen",
    rarity: "rare",
    oracleText:
        "{1}{U}, {T}: Untap target artifact an opponent controls and gain control of it until end of turn. It gains haste until end of turn. When you lose control of the artifact, tap it.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "magus-of-the-unseen-steal",
            oracleText:
                "{1}{U}, {T}: Untap target artifact an opponent controls and gain control of it until end of turn. It gains haste until end of turn. When you lose control of the artifact, tap it.",
            cost: { mana: { X: 1, U: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                controller: "opponent",
            },
            // protocol: see gainControlUntilEndOfTurnBody — EOT control change +
            // tap-on-loss rider has no ControlChangeCondition variant (#848).
            resolve: gainControlUntilEndOfTurnBody,
        },
    ],
};
// Mesmeric Trance — {1}{U}{U} Enchantment with cumulative upkeep {1}
// (CR 702.24) and "{U}, Discard a card: Draw a card." The chosen-discard cost
// is paid in-resolve (CR 601.2h convention, Dwarven Armorer pattern): step 0
// discards a chosen card, step 1 draws only if the discard was paid.
export const mesmericTrance: CardDefinition = {
    id: "ae3df593-e9d5-479d-9a9a-1c7262dd9c6c",
    name: "Mesmeric Trance",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{U}, Discard a card: Draw a card.",
    manaCost: { X: 1, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "mesmeric-trance-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    activatedAbilities: [
        {
            id: "mesmeric-trance-loot",
            oracleText: "{U}, Discard a card: Draw a card.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolveSteps: [
                // Step 0 — pay the discard portion of the cost (a chosen card).
                (ctx: SpellContext) => {
                    const handIds = ctx.getHandIds(ctx.controller);
                    if (handIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "mesmeric-trance-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card (Mesmeric Trance).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
                // Step 1 — draw a card (CR 121.1). Only if a discard was paid.
                (ctx: SpellContext) => {
                    const discarded = ctx.recallChoice(
                        "mesmeric-trance-discard"
                    );
                    if (!discarded || discarded.length === 0) return;
                    ctx.drawCards(ctx.controller, 1);
                },
            ],
        },
    ],
};
// Mistfolk — {U}{U} 1/2 Illusion with "{U}: Counter target spell that targets
// this creature." (CR 701.5a counter, CR 114.1 spell targeting.) The filtered
// counter reuses the shipped `counter` Op; the "targets this creature" clause
// is a stack-SPELL filter (`spellTargetsInstanceIds`) injected at activation
// time via a dynamic `getTargetRequirement` carrying the source's own instance
// id — the Sorceress Queen `excludeInstanceIds` injection pattern.
export const mistfolk: CardDefinition = {
    id: "4f3f4d4e-ca4a-4fba-b9fd-cd1d9457cfa1",
    name: "Mistfolk",
    rarity: "common",
    oracleText: "{U}: Counter target spell that targets this creature.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "mistfolk-counter",
            oracleText: "{U}: Counter target spell that targets this creature.",
            cost: { mana: { U: 1 } },
            useStack: true,
            // Static fallback (no legal target without the source id); the
            // dynamic form injects the source's own id so only spells that
            // target Mistfolk qualify (CR 114.1).
            targetRequirement: { type: "spell", count: 1 },
            getTargetRequirement: (source) => ({
                type: "spell",
                count: 1,
                spellTargetsInstanceIds: [source.id],
            }),
            effects: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};
// Musician — {2}{U} 1/3 with cumulative upkeep {1} (CR 702.24, ADR 0042) and an
// activated ability that loads a target creature with a "music" counter and, if
// it lacks the music-upkeep ability, GRANTS it: "At the beginning of your
// upkeep, destroy this creature unless you pay {1} for each music counter on
// it." (CR 122 counters, CR 113.1 / 611.2c indefinite triggered-ability grant
// via `grantTriggeredAbilityPermanent`, CR 701.7 destroy.) The granted ability
// lives on `triggeredGrantTemplates[]` (Balduvian Shaman shape) so Musician
// never carries it natively; it is unioned onto the target by
// `effectiveTriggeredAbilities` and reads the host's live `music` counter count
// to scale the upkeep tax. The grant is idempotent by (sourceCardId, abilityId),
// so a second music counter (from this or another Musician) only raises the cost
// rather than stacking a duplicate ability — matching the "if it doesn't have it"
// clause for free.
const MUSICIAN_ID = "9f8d2247-a10e-413a-b497-2add3918f991";
export const musician: CardDefinition = {
    id: MUSICIAN_ID,
    name: "Musician",
    rarity: "rare",
    oracleText:
        'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{T}: Put a music counter on target creature. If it doesn\'t have "At the beginning of your upkeep, destroy this creature unless you pay {1} for each music counter on it," it gains that ability.',
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 3,
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "musician-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
    ],
    activatedAbilities: [
        {
            id: "musician-music-counter",
            oracleText:
                '{T}: Put a music counter on target creature. If it doesn\'t have "At the beginning of your upkeep, destroy this creature unless you pay {1} for each music counter on it," it gains that ability.',
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "permanent") return;
                // CR 122 — add a music counter to the target creature.
                ctx.addCounter(t, "music", 1);
                // CR 113.1 / 611.2c — grant the music-upkeep ability if absent.
                // Idempotent on (sourceCardId, abilityId): re-granting is a no-op,
                // so the "if it doesn't have it" clause is satisfied structurally.
                ctx.grantTriggeredAbilityPermanent(
                    t,
                    MUSICIAN_ID,
                    "musician-music-upkeep"
                );
            },
        },
    ],
    // Granted-only rider (CR 113.1): kept off `triggeredAbilities` so Musician
    // doesn't carry it natively — it functions only on creatures it has granted.
    triggeredGrantTemplates: [
        phaseTrigger({
            id: "musician-music-upkeep",
            oracleText:
                "At the beginning of your upkeep, destroy this creature unless you pay {1} for each music counter on it.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // CR 122 — pay {1} once per music counter on the host creature.
                const music = ctx.getCounterCount(self, "music");
                if (music <= 0) return;
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `musician-music-upkeep-${ctx.sourceInstanceId}`,
                    cost: { X: music },
                    prompt: `Pay {${music}} (one per music counter) to keep this creature?`,
                });
                if (accept === undefined) return; // suspended for the choice
                // CR 701.7 — declined or unable to pay: destroy the creature.
                if (!accept) ctx.destroy(self);
            },
        }),
    ],
};
// Mystic Might — {U} Aura "Enchant land you control" with cumulative upkeep
// {1}{U} (CR 702.24, ADR 0042) granting the enchanted land "{T}: Target creature
// gets +2/+2 until end of turn." (CR 611 activated-grant — the Earthlore shape:
// the granted ability lives on `grantTemplates[]` and an `activated-grant`
// static pushes it onto the host land. The cost is the LAND's own tap
// (`cost.tap`), so the land must be untapped to activate — a tapped permanent
// can't pay a tap cost (CR 602.2 / 118.12).)
export const mysticMight: CardDefinition = {
    id: "e35d7f08-0687-41bd-8c53-31a49adabb11",
    name: "Mystic Might",
    rarity: "rare",
    oracleText:
        'Enchant land you control\nCumulative upkeep {1}{U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nEnchanted land has "{T}: Target creature gets +2/+2 until end of turn."',
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1, controller: "you" },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "mystic-might-pump",
        },
    ],
    grantTemplates: [
        {
            id: "mystic-might-pump",
            oracleText: "{T}: Target creature gets +2/+2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +2/+2 EOT
            // on the announced target (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "mystic-might-cumulative-upkeep",
            cost: { X: 1, U: 1 },
            costLabel: "{1}{U}",
        }),
    ],
};
// Mystic Remora — {U} Enchantment with cumulative upkeep {1} (CR 702.24, ADR
// 0042) plus a "draw tax" cast trigger: "Whenever an opponent casts a noncreature
// spell, you may draw a card unless that player pays {4}." (CR 603.2 spell-cast
// trigger scoped to opponents + noncreature filter; CR 117.3a may-pay.) The
// inverse of Freyalise's Charm — here the CASTER (the opponent) may pay {4} to
// stop the controller's draw, so the may-pay's payer is `spell.casterId`, not the
// source's controller. Declining or being unable to pay lets the controller draw.
export const mysticRemora: CardDefinition = {
    id: "58e93dff-b774-4765-b7bd-d3957e42ff4a",
    name: "Mystic Remora",
    rarity: "common",
    oracleText:
        "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "mystic-remora-cumulative-upkeep",
            cost: { X: 1 },
            costLabel: "{1}",
        }),
        spellCastTrigger({
            id: "mystic-remora-draw-tax",
            oracleText:
                "Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.",
            scope: "opponents",
            filter: { excludeTypes: "Creature" },
            resolve: (ctx: SpellContext, _event, spell) => {
                // CR 117.3a — the casting opponent may pay {4} to prevent the
                // draw. The payer is the caster, not the source's controller.
                const paid = ctx.requestMayPay({
                    playerId: spell.casterId,
                    choiceId: `mystic-remora-pay-${ctx.sourceInstanceId}`,
                    cost: { X: 4 },
                    prompt: "Pay {4} or your opponent draws a card (Mystic Remora)?",
                });
                if (paid === undefined) return; // suspended for the choice
                // Unpaid: the source's controller draws a card (CR 121.1).
                if (!paid) ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
};
// Phantasmal Mount — BIDIRECTIONAL instance leave-watch (CR 603.7a / 603.10,
// issue #731). "{T}: Target creature you control with toughness 2 or less gets
// +1/+1 and gains flying until end of turn. When this creature leaves the
// battlefield this turn, sacrifice that creature. When that creature leaves the
// battlefield this turn, sacrifice this creature." The buff is `pump` +1/+1 EOT
// + `grantAbility` flying EOT (CR 611.1b). The mutual "leave → sacrifice the
// other" is two `delayedTrigger`s with `timing: "leaves-battlefield"` and
// crossed captures: one watches the Mount (`$source`) and sacrifices the buffed
// creature (`$mounted` = target 0); the other watches the buffed creature
// (target 0) and sacrifices the Mount (`$mount` = `$source`). Both expire at
// CLEANUP if unfired (the "this turn" bound). If both leave in the same event
// batch, each fires and its sacrifice is a no-op on the already-gone other
// (CR 608.2b).
export const phantasmalMount: CardDefinition = {
    id: "75afdbe6-a3f9-49cf-b4ef-f370e518e960",
    name: "Phantasmal Mount",
    rarity: "uncommon",
    oracleText:
        "Flying\n{T}: Target creature you control with toughness 2 or less gets +1/+1 and gains flying until end of turn. When this creature leaves the battlefield this turn, sacrifice that creature. When that creature leaves the battlefield this turn, sacrifice this creature.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion", "Horse"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "phantasmal-mount-pump",
            oracleText:
                "{T}: Target creature you control with toughness 2 or less gets +1/+1 and gains flying until end of turn. When this creature leaves the battlefield this turn, sacrifice that creature. When that creature leaves the battlefield this turn, sacrifice this creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                toughnessFilter: { max: 2 },
            },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
                // "When this creature [Mount] leaves the battlefield this turn,
                // sacrifice that creature [the buffed one]."
                {
                    op: "delayedTrigger",
                    timing: "leaves-battlefield",
                    oracleText:
                        "When Phantasmal Mount leaves the battlefield this turn, sacrifice that creature.",
                    watch: { ref: "$source" },
                    capture: { $mounted: { target: 0 } },
                    effects: [{ op: "sacrifice", target: { ref: "$mounted" } }],
                },
                // "When that creature [the buffed one] leaves the battlefield
                // this turn, sacrifice this creature [Mount]."
                {
                    op: "delayedTrigger",
                    timing: "leaves-battlefield",
                    oracleText:
                        "When that creature leaves the battlefield this turn, sacrifice Phantasmal Mount.",
                    watch: { target: 0 },
                    capture: { $mount: { ref: "$source" } },
                    effects: [{ op: "sacrifice", target: { ref: "$mount" } }],
                },
            ],
        },
    ],
};
// Polar Kraken — {8}{U}{U}{U} 11/11 with trample, enters tapped, and the only
// SACRIFICE-cost cumulative upkeep in the set: "Cumulative upkeep—Sacrifice a
// land." (CR 702.24, ADR 0042). At N age counters the controller sacrifices N
// lands or sacrifices the Kraken.
export const polarKraken: CardDefinition = {
    id: "aee01e9c-0445-4228-a73a-3e5744844ed3",
    name: "Polar Kraken",
    rarity: "rare",
    oracleText:
        "Trample\nThis creature enters tapped.\nCumulative upkeep—Sacrifice a land. (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)",
    manaCost: { X: 8, U: 3 },
    types: ["Creature"],
    subtypes: ["Kraken"],
    power: 11,
    toughness: 11,
    entersTapped: true,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "polar-kraken-cumulative-upkeep",
            cost: { sacrifice: { filter: { types: "Land" }, count: 1 } },
            costLabel: "Sacrifice a land",
        }),
    ],
};
// Portent — {U} Sorcery. "Look at the top three cards of target player's
// library, then put them back in any order. You may have that player shuffle."
// (CR 401.4 look, CR 401 reorder, CR 701.20 shuffle.) Composed from existing
// primitives: `peekLibraryTop(3)` + a `reorder-library` choice over those ids
// (Drafna's Restoration pattern), then an optional may-shuffle, then the
// next-upkeep cantrip rider. Each interactive step is its own `resolveSteps`
// entry so a suspension never re-applies an earlier step.
export const portent: CardDefinition = {
    id: "e040be83-3fb5-4da5-ba7a-4923b8854b74",
    name: "Portent",
    rarity: "common",
    oracleText:
        "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (t?.type !== "player") return;
            const topIds = ctx.peekLibraryTop(t.id, 3);
            if (topIds.length === 0) return;
            // The controller looks at and reorders the top cards (CR 401.4).
            const ordered = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: `portent-reorder-${ctx.sourceInstanceId}`,
                kind: "reorder-library",
                zone: "library",
                count: topIds.length,
                zoneOwnerId: t.id,
                candidateIds: topIds,
                prompt: "Put these cards back on top in any order (first = top).",
            });
            if (ordered === undefined) return; // suspended on the reorder
            const allIds = ctx.peekLibraryTop(t.id, Number.MAX_SAFE_INTEGER);
            const orderedSet = new Set(ordered);
            const rest = allIds.filter((id) => !orderedSet.has(id));
            ctx.reorderLibraryTop(t.id, [...ordered, ...rest]);
        },
        (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (t?.type === "player") {
                // "You may have that player shuffle" — a no-cost may decision
                // made by the controller (CR 117.3a may, cost undefined).
                const shuffle = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `portent-shuffle-${ctx.sourceInstanceId}`,
                    prompt: "Have that player shuffle their library (Portent)?",
                });
                if (shuffle === undefined) return; // suspended on the may
                if (shuffle) ctx.shuffleLibrary(t.id);
            }
            scheduleNextUpkeepDraw(ctx, portent.id);
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Power Sink — ICE reprint of the LEA instant. CardPrint onto the LEA
// definition (ADR 0014).
export const powerSinkIce: CardPrint = {
    printId: "85cbec45-81b4-40cc-b356-d6713a6a9b2b",
    definitionId: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9",
    setCode: "ice",
    rarity: "common",
};
export const rayOfCommand: CardDefinition = {
    id: "638abe5f-2a8a-42ca-bcdf-a52a3df66946",
    name: "Ray of Command",
    rarity: "common",
    oracleText:
        "Untap target creature an opponent controls and gain control of it until end of turn. That creature gains haste until end of turn. When you lose control of the creature, tap it.",
    manaCost: { X: 3, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, controller: "opponent" },
    // protocol: see gainControlUntilEndOfTurnBody — EOT control change +
    // tap-on-loss rider has no ControlChangeCondition variant (#848).
    resolve: gainControlUntilEndOfTurnBody,
};
// Ray of Erasure — {U} Instant. "Target player mills a card" (CR 701.13a mill —
// move the top library card to its owner's graveyard, via `moveCardById` on the
// live top id; Millstone pattern) plus the next-upkeep cantrip rider.
export const rayOfErasure: CardDefinition = {
    id: "5a09fc0b-7b9c-4283-8336-f2607f5ffaf5",
    name: "Ray of Erasure",
    rarity: "common",
    oracleText:
        "Target player mills a card.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "player") {
            const [topId] = ctx.peekLibraryTop(t.id, 1);
            if (topId) ctx.moveCardById(t.id, topId, "library", "graveyard");
        }
        scheduleNextUpkeepDraw(ctx, rayOfErasure.id);
    },
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
// Reality Twist — {U}{U}{U} Enchantment with cumulative upkeep {1}{U}{U}
// (CR 702.24, ADR 0042) plus a continuous per-basic-subtype land-mana
// permutation (CR 614): "If tapped for mana, Plains produce {R}, Swamps produce
// {G}, Mountains produce {W}, and Forests produce {B} instead of any other
// type." Modelled as a `byBasicSubtype` `landManaSubstitution` (the Naked
// Singularity shape), read live from the battlefield by the
// `applyLandManaReplacement` mana funnel. Islands are absent from the map, so an
// Island is unaffected (matching the oracle text, which omits Islands).
export const realityTwist: CardDefinition = {
    id: "1b7e955c-3de2-430c-93b9-0b39ccea5420",
    name: "Reality Twist",
    rarity: "rare",
    oracleText:
        "Cumulative upkeep {1}{U}{U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nIf tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.",
    manaCost: { U: 3 },
    types: ["Enchantment"],
    landManaSubstitution: {
        byBasicSubtype: {
            Plains: "R",
            Swamp: "G",
            Mountain: "W",
            Forest: "B",
        },
    },
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "reality-twist-cumulative-upkeep",
            cost: { X: 1, U: 2 },
            costLabel: "{1}{U}{U}",
        }),
    ],
};
// Sea Spirit — {U}: firebreathing self-pump (CR 611.1b temporary +1/+0).
export const seaSpirit: CardDefinition = {
    id: "f2d93d05-98bc-4504-9045-dedb925895ae",
    name: "Sea Spirit",
    rarity: "uncommon",
    oracleText: "{U}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "sea-spirit-pump",
            oracleText: "{U}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+0 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Shyft — at the controller's upkeep (CR 603.6a, `phaseTrigger` scope "your"),
// the controller MAY (CR 117.3a, `requestMayPay` cost-less) set Shyft's colour
// via a layer-5 colour override (CR 305.7 / 613.1d — `setColorOverride`). The
// override rides the instance with no duration, so it lasts INDEFINITELY until
// a zone change (CR 612.7) — exactly "this effect lasts indefinitely."
//
// SIMPLIFICATION (flagged, no engine change): the oracle "the color or colors
// of your choice" permits any subset of the five colours (CR 105.2). The
// `requestOptionChoice` primitive is a single pick, so this models the five
// MONO-colour choices (each a one-element override, the common faithful
// reading — the same single-colour pick Jihad/Metamorphosis use). Picking a
// multicolour combination would need a multi-select colour primitive; the
// mono-colour pick covers the tactical use (becoming a colour to dodge a
// "protection from" / colour-hate effect). Full power-set picking lands when a
// multi-colour choice primitive exists.
const SHYFT_COLOR_OPTIONS: { id: Color; label: string }[] = [
    { id: "W", label: "White" },
    { id: "U", label: "Blue" },
    { id: "B", label: "Black" },
    { id: "R", label: "Red" },
    { id: "G", label: "Green" },
];
export const shyft: CardDefinition = {
    id: "99a60c33-b641-42c4-870d-95d07bc975dc",
    name: "Shyft",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, you may have this creature become the color or colors of your choice. (This effect lasts indefinitely.)",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 4,
    toughness: 2,
    triggeredAbilities: [
        phaseTrigger({
            id: "shyft-upkeep-color",
            oracleText:
                "At the beginning of your upkeep, you may have this creature become the color or colors of your choice. (This effect lasts indefinitely.)",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 117.3a — the "you may" gate.
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: "shyft-may",
                    prompt: "Have Shyft become a color of your choice?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) return;
                // CR 305.7 — the chosen colour (layer 5 override).
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "shyft-color",
                    options: SHYFT_COLOR_OPTIONS,
                    prompt: "Choose Shyft's new color.",
                });
                if (chosen === undefined) return; // suspended
                ctx.setColorOverride(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    [chosen as Color]
                );
            },
        }),
    ],
};
// Sibilant Spirit — 5/6 flier whose attack hands the defending player an
// optional card draw (CR 508.1 attack trigger, CR 117.3a may-draw). The
// defending player is the single opponent in a duel.
export const sibilantSpirit: CardDefinition = {
    id: "47364ad2-5ce9-4b19-a9d2-f6a33188b882",
    name: "Sibilant Spirit",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever this creature attacks, defending player may draw a card.",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "sibilant-spirit-attack",
            oracleText:
                "Whenever this creature attacks, defending player may draw a card.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                const defender = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!defender) return;
                const accept = ctx.requestMayPay({
                    playerId: defender,
                    choiceId: "sibilant-spirit-draw",
                    prompt: "Draw a card (Sibilant Spirit)?",
                });
                if (accept === undefined) return; // suspended
                if (accept) ctx.drawCards(defender, 1);
            },
        },
    ],
};
// Silver Erne — 2/2 flying + trample keyword creature (CR 702.9, 702.19).
export const silverErne: CardDefinition = {
    id: "685076cc-098c-4f98-918c-0ad825eda10f",
    name: "Silver Erne",
    rarity: "uncommon",
    oracleText: "Flying, trample",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "trample"],
};
// Sleight of Mind — ICE reprint of the LEA instant (colour-word text change,
// CR 612). CardPrint onto the LEA definition (ADR 0014).
export const sleightOfMindIce: CardPrint = {
    printId: "93dc9f02-11ad-4c4a-8199-9d20c23d31a7",
    definitionId: "d427790c-e322-446e-8d7d-a6b48ad41a42",
    setCode: "ice",
    rarity: "common",
};
// Snow Devil — Aura granting flying to the host (CR 611 keyword-grant). Same
// shape as LEA's Flight.
//
// SIMPLIFICATION (flagged, no engine change): the conditional "first strike as
// long as it's blocking and you control a snow land" clause is a no-op in the
// current pool — snow lands belong to a later snow cluster, so the snow-land
// condition is never met. Only the unconditional flying grant is modelled; the
// first-strike clause ships dead until snow lands exist (same treatment as
// Hallowed Ground's nonsnow restriction).
export const snowDevil: CardDefinition = {
    id: "2be3a9a5-2ac5-4ea4-915d-8cff35c0e72f",
    name: "Snow Devil",
    rarity: "common",
    oracleText:
        "Enchant creature\nEnchanted creature has flying.\nEnchanted creature has first strike as long as it's blocking and you control a snow land.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
};
// Snowfall — {2}{U} Enchantment with cumulative upkeep {U} (CR 702.24, ADR 0042)
// plus a CU-mana engine: "Whenever an Island is tapped for mana, its controller
// may add an additional {U}. … Spend this mana only to pay cumulative upkeep
// costs." (CR 605 mana-tap trigger via `tappedTrigger({ forMana: true })`, CR
// 106.6 restricted mana — ADR 0022.) The bonus {U} lands in the Island
// controller's CU-restricted pool, feeding Snowfall's own upkeep (and any other
// CU permanent). The added mana is auto-applied — it's strictly beneficial
// restricted mana, so the "may" carries no real downside (ADR 0003 auto-resolve).
//
// CR 205.4a — "If that Island is snow, add {U}{U} instead": now that the snow-
// covered basics ship (#661), a tapped snow Island doubles the bonus. The
// tapped view carries no supertype, so the resolve resolves the tapped land's
// live snow status by id via the snow-aware battlefield filter.
export const snowfall: CardDefinition = {
    id: "788ed793-3993-4a63-b9f9-9ac3947c3108",
    name: "Snowfall",
    rarity: "common",
    oracleText:
        "Cumulative upkeep {U} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an Island is tapped for mana, its controller may add an additional {U}. If that Island is snow, its controller may add an additional {U}{U} instead. Spend this mana only to pay cumulative upkeep costs.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        cumulativeUpkeepTrigger({
            id: "snowfall-cumulative-upkeep",
            cost: { U: 1 },
            costLabel: "{U}",
        }),
        tappedTrigger({
            id: "snowfall-island-mana",
            oracleText:
                "Whenever an Island is tapped for mana, its controller may add an additional {U}. Spend this mana only to pay cumulative upkeep costs.",
            scope: "any",
            filter: { subtypes: "Island" },
            forMana: true,
            resolve: (ctx, _event, tapped) => {
                // CR 106.6 — the Island controller gets the bonus {U} in their
                // CU-restricted pool (ADR 0022). CR 205.4a — if the tapped
                // Island is SNOW, the bonus is {U}{U} instead (now that snow
                // Islands ship, #661). The tapped view carries no supertype, so
                // resolve the live snow status by id via the snow-aware
                // battlefield filter.
                const isSnowIsland = ctx
                    .getBattlefieldIds(tapped.controllerId, {
                        types: "Land",
                        supertypes: ["Snow"],
                        instanceIds: [tapped.id],
                    })
                    .includes(tapped.id);
                ctx.addRestrictedMana(
                    tapped.controllerId,
                    { U: isSnowIsland ? 2 : 1 },
                    "cumulative-upkeep"
                );
            },
        }),
    ],
};
// DEFERRED (#628) — re-verified against the current engine (2026-07). Soldevi
// Machinist's "{T}: Add {C}{C}. Spend this mana only to activate abilities of
// artifacts" needs a mana RESTRICTION that the shipped `ManaRestriction` union
// does not model: the three members (`creature-spell`, `artifact-spell`,
// `cumulative-upkeep`) are all evaluated only at the SPELL-CAST site
// (`restrictionAllowsSpell` / `restrictedUnitAllowsSpell` take `spellTypes`);
// there is no restriction eligibility hook at the ABILITY-ACTIVATION payment
// path, and no "artifact-ability" member. Building "spendable only on artifacts'
// activated abilities" is a new seam (a union member PLUS activation-payment
// eligibility keyed on the ability source's card type). Stop-and-issue, not an
// invented restriction. Blocked on: an ability-activation mana restriction.
// export const soldeviMachinist: CardDefinition = {
//     id: "1f0999df-2f94-499e-b9af-fe377d515400",
//     name: "Soldevi Machinist",
//     rarity: "uncommon",
//     oracleText: "{T}: Add {C}{C}. Spend this mana only to activate abilities of artifacts.",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Wizard", "Artificer"],
//     power: 1,
//     toughness: 1,
// };
// Soul Barrier — punisher enchantment: whenever an opponent casts a creature
// spell, it deals 2 to that player unless they pay {2} (CR 603.2 cast trigger,
// CR 117.3a may-pay, CR 120.1 damage).
export const soulBarrier: CardDefinition = {
    id: "9ad7fac7-db4d-45b2-aba6-16f4fd1a586f",
    name: "Soul Barrier",
    rarity: "uncommon",
    oracleText:
        "Whenever an opponent casts a creature spell, this enchantment deals 2 damage to that player unless they pay {2}.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "soul-barrier-tax",
            oracleText:
                "Whenever an opponent casts a creature spell, this enchantment deals 2 damage to that player unless they pay {2}.",
            scope: "opponents",
            filter: { types: "Creature" },
            resolve: (ctx, _event, spell) => {
                const caster = spell.casterId;
                const accept = ctx.requestMayPay({
                    playerId: caster,
                    choiceId: caster,
                    cost: { X: 2 },
                    prompt: "Pay {2} or take 2 damage from Soul Barrier?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.dealDamage({ type: "player", id: caster }, 2);
                }
            },
        }),
    ],
};
// Thunder Wall — 0/2 flying Wall with Defender and a {U} self-pump
// (CR 702.3, 702.9, 611.1b).
export const thunderWall: CardDefinition = {
    id: "4fc5d510-c4f7-4a09-bf86-83c3fa3f8928",
    name: "Thunder Wall",
    rarity: "uncommon",
    oracleText:
        "Defender\nFlying\n{U}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 2,
    staticAbilities: ["defender", "flying"],
    activatedAbilities: [
        {
            id: "thunder-wall-pump",
            oracleText: "{U}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+1 EOT
            // on this creature (CR 611.1b) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
// Updraft — {1}{U} Instant. "Target creature gains flying until end of turn"
// (CR 702.9 keyword grant via layer 6) plus the next-upkeep cantrip rider.
export const updraft: CardDefinition = {
    id: "d1bd4e16-27fe-4c7b-ae25-78ed77d8e8e7",
    name: "Updraft",
    rarity: "uncommon",
    oracleText:
        "Target creature gains flying until end of turn.\nDraw a card at the beginning of the next turn's upkeep.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #843): grant flying to the
    // announced target creature until end of turn (CR 611.1b), then the
    // next-upkeep cantrip as an inline `delayedTrigger` Op (ADR 0048,
    // CR 603.7d).
    effects: [
        {
            op: "grantAbility",
            ability: "flying",
            target: { target: 0 },
            duration: { phase: "end-of-turn" },
        },
        {
            op: "delayedTrigger",
            timing: "next-upkeep",
            oracleText:
                "At the beginning of the next turn's upkeep, draw a card.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};
// Wind Spirit — 3/2 flying + menace keyword creature (CR 702.9, 702.111).
export const windSpirit: CardDefinition = {
    id: "4d882447-9594-4aab-b1a7-8bb275f250cf",
    name: "Wind Spirit",
    rarity: "uncommon",
    oracleText: "Flying\nMenace",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 3,
    toughness: 2,
    staticAbilities: ["flying", "menace"],
};
// DEFERRED (#738). The novel payloads all ship: X attacking targets
// (`count:"X"` + `combatRoleFilter:"attacking"`), delayed "destroy at end of
// combat" (`delayedTrigger` timing "next-end-of-combat"), and per-creature
// "prevent all combat damage to AND by it" (`preventDamage` mode
// "combat-to-and-by" / `preventAllCombatDamageToAndBy`). Two seams remain
// genuinely absent (do NOT paper with resolve(), per ADR 0045):
//   (1) a chosen-X UPPER-BOUND cap keyed to a board count (CR 107.3) — "X can't
//       be greater than the number of snow lands you control." `countSnowLands`
//       reads the count, but there is no `maxX`/cast-announcement cap hook on a
//       CardDefinition (moves.ts bounds X only by mana + legal-target count).
//   (2) a per-target THREE-WAY may-pay ({1} / {2} / decline) with a distinct
//       delayed effect per branch — `requestMayPay` is strictly BINARY (one
//       `MayPayCost`, pay/skip). A true simultaneous "{1} or {2}" prompt needs
//       a multi-option pay primitive (or a documented sequential-mayPay
//       approximation, deferred here for fidelity).
// Stop-and-issue: stub kept, tracked by #738.
// export const wintersChill: CardDefinition = {
//     id: "a779aca7-ff2c-48d8-9484-6ad04b2c6bcb",
//     name: "Winter's Chill",
//     rarity: "rare",
//     oracleText: "Cast this spell only during combat before blockers are declared.\nX can't be greater than the number of snow lands you control.\nChoose X target attacking creatures. For each of those creatures, its controller may pay {1} or {2}. If that player doesn't, destroy that creature at end of combat. If that player pays only {1}, prevent all combat damage that would be dealt to and dealt by that creature this combat.",
//     manaCost: { X: "X", U: 1 },
//     types: ["Instant"],
// };
// Word of Undoing — "Return target creature and all white Auras you own
// attached to it to their owners' hands." (CR 701.14 return to hand.) Before
// bouncing the creature (which would otherwise drop its Auras to the
// graveyard), the caster's white Auras attached to that creature are returned
// to hand: scan the caster's white Auras and match each host id to the target.
export const wordOfUndoing: CardDefinition = {
    id: "22b04476-5a5d-4843-a948-82db209c4218",
    name: "Word of Undoing",
    rarity: "common",
    oracleText:
        "Return target creature and all white Auras you own attached to it to their owners' hands.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type !== "permanent") return;
        // Return the caster's white Auras attached to the target first.
        const whiteAuras = ctx.getBattlefieldIds(ctx.controller, {
            types: "Enchantment",
            subtypes: "Aura",
            colors: ["W"],
        });
        for (const auraId of whiteAuras) {
            if (ctx.getAttachedTo(auraId) === t.id) {
                ctx.returnToHand({ type: "permanent", id: auraId });
            }
        }
        ctx.returnToHand(t);
    },
};
// Wrath of Marit Lage — ETB taps every red creature (CR 603.6b enters trigger,
// CR 701.20a tap) and a static untap-lock on red creatures (CR 611 — the
// Meekstone pattern with a colour filter).
export const wrathOfMaritLage: CardDefinition = {
    id: "1d512f5c-0327-4d49-8a26-672574a49102",
    name: "Wrath of Marit Lage",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, tap all red creatures.\nRed creatures don't untap during their controllers' untap steps.",
    manaCost: { X: 3, U: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "wrath-marit-lage-red-lock",
            oracleText:
                "Red creatures don't untap during their controllers' untap steps (Wrath of Marit Lage).",
            filter: { types: "Creature", colors: "R" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "wrath-marit-lage-tap-red",
            oracleText: "When this enchantment enters, tap all red creatures.",
            scope: "self",
            // NOT DSL-migratable (ADR 0045): a mass tap of all RED creatures.
            // The forEach `permanents` selector filters only by type/subtype
            // (`EffectCardFilter`), not colour, so "red creatures" cannot be
            // selected.
            // Blocked on: a colour member on EffectCardFilter.
            resolve: (ctx) => {
                for (const pid of ctx.allPlayerIds) {
                    const reds = ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        colors: ["R"],
                    });
                    for (const id of reds) {
                        ctx.tap({ type: "permanent", id });
                    }
                }
            },
        }),
    ],
};
// TODO(#628): implement.
// export const zursWeirding: CardDefinition = {
//     id: "e1f8531f-19ca-48a2-baf2-c5dc6f18d79c",
//     name: "Zur's Weirding",
//     rarity: "rare",
//     oracleText: "Players play with their hands revealed.\nIf a player would draw a card, they reveal it instead. Then any other player may pay 2 life. If a player does, put that card into its owner's graveyard. Otherwise, that player draws a card.",
//     manaCost: { X: 3, U: 1 },
//     types: ["Enchantment"],
// };
// Zuran Enchanter — "{2}{B}, {T}: Target player discards a card. Activate only
// during your turn." (CR 605 activated ability, CR 701.8 discard chosen by the
// targeted player, CR 602.5b "only during your turn" via `controllerTurnOnly`.)
// The discarding player picks via a `discard-hand` requestChoice scoped to their
// own hand (Abyssal Specter pattern). Cast cost is {1}{U} (a blue creature whose
// black-flavored discard ability costs {2}{B}); verified against Scryfall.
export const zuranEnchanter: CardDefinition = {
    id: "721edcef-f40a-4d43-9d80-26161dc425cb",
    name: "Zuran Enchanter",
    rarity: "common",
    oracleText:
        "{2}{B}, {T}: Target player discards a card. Activate only during your turn.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "zuran-enchanter-discard",
            oracleText:
                "{2}{B}, {T}: Target player discards a card. Activate only during your turn.",
            cost: { mana: { X: 2, B: 1 }, tap: true },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: { type: "player", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045): the targeted player
            // chooses and discards one card (CR 701.8) — the Mind Rot choice +
            // discard pair. The choice Op clamps to hand availability
            // (CR 608.2b), subsuming the empty-hand guard. Untouched per-card
            // test is the equivalence harness.
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 1,
                    prompt: "Zuran Enchanter: discard a card.",
                    bind: "$discards",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$discards" },
                },
            ],
        },
    ],
};
// Zuran Spellcaster — {T}: deal 1 damage to any target (CR 605 activated
// ability, CR 120.1 damage). The Prodigal Sorcerer "Tim" shape.
export const zuranSpellcaster: CardDefinition = {
    id: "152a72b1-a7b7-4e5c-8558-fab97465f549",
    name: "Zuran Spellcaster",
    rarity: "common",
    oracleText: "{T}: This creature deals 1 damage to any target.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "zuran-spellcaster-zap",
            oracleText: "{T}: This creature deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045): 1 damage to the
            // announced target (CR 120.1). Untouched per-card test is the
            // equivalence harness.
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};
