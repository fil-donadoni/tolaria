// How deep a single resolution's MOVER-OWNED choices can nest (issue #3194).
//
// Two seams probe a move by RESOLVING it on a clone: the dominance proof
// (`dominance.ts`, which must answer every branch of every mid-resolution
// choice before it may call a move futile) and the search's payoff probes
// (`search.ts`, which must resolve THROUGH a choice or it scores the
// un-resolved state as the outcome). Both recurse per suspended choice, and
// both need the same bound — the deepest chain of resolution-time choices a
// SHIPPED card actually takes. It lives here, once, because the two seams
// disagreeing is exactly the bug issue #3194 reported: the bound was 1, its
// own comment named Vision Charm as "the shape that occurs", and Vision
// Charm's land-type mode takes TWO nested option choices (a land type, then a
// basic land type), so the recursion hit the cap on the second one and
// returned "not provably futile" — failing open on the case it was written
// for.
//
// The bound is MEASURED, not assumed: `catalogueChoiceDepth` walks every
// shipped definition and `choiceDepth.bot.test.ts` fails when one exceeds
// `MAX_CHOICE_DEPTH`. Raising it is not free — a probe opens up to
// `branches ^ depth` clones — so a card that needs more is a decision to
// make deliberately, not a constant to bump silently.

import type { CardDefinition, EffectOp } from "../../cards/types";
import { childOpArrays } from "./effectOpChildren";

/** Bound on nested/chained mover-owned resolution choices one probe may answer.
 *
 *  MEASURED, not assumed: `catalogueChoiceDepth` over the shipped catalogue
 *  reports 5 (Word of Command's protocol closure), then 3 (8 cards: Ponder,
 *  Frantic Search, Sylvan Library, Transmute Artifact, Archon of Cruelty,
 *  Krovikan Sorcerer, Smuggler's Copter, Malcolm) and 2 (77 cards, Vision
 *  Charm's land-type mode among them). `choiceDepth.bot.test.ts` re-derives that number and fails when
 *  a card exceeds this bound. */
export const MAX_CHOICE_DEPTH = 5;

/** Bound on the branch expansions ONE probe may spend, across every depth.
 *
 *  The depth bound alone cannot bound the work: a probe opens up to
 *  `branches ^ depth` clones, so raising the depth from 1 to 5 without this
 *  would turn an 8-clone probe into a 32768-clone one. The two bounds are
 *  therefore separate questions — how deep a shipped card's choices CHAIN
 *  (a catalogue fact) versus how much work proving one move is worth (a cost
 *  decision) — and this is the second. A probe that spends the budget stops
 *  and answers "not provably futile"/"best of what was seen", which is the
 *  fail-open direction both callers already take at the cap. 128 keeps Vision
 *  Charm's 5 x 5 = 30-branch shape well inside the budget while leaving Word of
 *  Command's five-deep chain unproven, exactly as it was at depth 1. */
export const MAX_CHOICE_BRANCH_WORK = 128;

/** Does interpreting this Op suspend resolution on a player CHOICE?
 *
 *  A total `Record` over the Op union rather than a `Set`, so `tsc` reds on a
 *  new Op instead of silently classifying it as "raises nothing" — the same
 *  compiler-forced census `eval-term-labels.ts` uses.
 *
 *  The `true` rows are the Ops whose `OP_EXECUTORS` handler can
 *  `return "suspend"` (`effects/interpreter.ts`). That is the mechanism, and
 *  deriving the set from anything narrower gets it wrong: the first cut here
 *  read the `ctx.request*` call sites and so missed `scryReorder` and
 *  `explore`, which suspend through `ctx.orderTop` — 54 shipped card files use
 *  the first of them. The two structural constructs that also carry a
 *  `return "suspend"` (`if`, `forEach`) are propagating a nested Op's
 *  suspension, not raising one, and are counted through `childOpArrays`
 *  instead. */
export const RAISES_RESOLUTION_CHOICE: Record<EffectOp["op"], boolean> = {
    // --- raises a choice -------------------------------------------------
    castDuringResolution: true,
    choice: true,
    chooseCategorized: true,
    coinFlip: true,
    divideIntoPiles: true,
    draw: true,
    hideaway: true,
    lookDistribute: true,
    mayPay: true,
    nameCard: true,
    optionChoice: true,
    putBack: true,
    rangedTopdeck: true,
    revealAndCategorize: true,
    // Both of these reach the same suspension through `ctx.orderTop` rather
    // than a `ctx.request*` method — the reason the first cut of this census
    // (derived from the `ctx.request*` call sites) had them on the wrong side.
    // The MECHANISM is `return "suspend"`, and that is what the rows below are
    // derived from.
    explore: true,
    scryReorder: true,
    // --- resolves without input -----------------------------------------
    addMana: false,
    addPlayerCounter: false,
    addSubtype: false,
    animate: false,
    armGraveyardRedirect: false,
    attach: false,
    becomeMonarch: false,
    captureBinding: false,
    coinFlipSync: false,
    counter: false,
    counters: false,
    createToken: false,
    createTokenCopy: false,
    dealDamage: false,
    dealDamageDividedAsChosen: false,
    delayedTrigger: false,
    destroy: false,
    digMatchingToHand: false,
    discard: false,
    discardAtRandom: false,
    emblem: false,
    exile: false,
    exileAndReturnTransformed: false,
    exileOnDeath: false,
    exileSelf: false,
    exileWithAttachments: false,
    extraCombat: false,
    extraTurn: false,
    forEach: false,
    gainControl: false,
    gainLife: false,
    grantAbility: false,
    grantCastFromExile: false,
    grantCastFromGraveyard: false,
    grantCastTiming: false,
    grantGraveyardPlay: false,
    grantSpellManaSubstitution: false,
    if: false,
    libraryLook: false,
    lockDamage: false,
    lookHand: false,
    lookRandomHand: false,
    loseAllAbilities: false,
    loseAllAbilitiesWhileSourceRemains: false,
    loseLife: false,
    markAssignsNoCombatDamage: false,
    mill: false,
    moveSpellFromStack: false,
    moveZone: false,
    preventDamage: false,
    preventRegeneration: false,
    pump: false,
    randomExileToHand: false,
    recallCapturedBinding: false,
    reflexiveTrigger: false,
    regenerate: false,
    restrictActivation: false,
    restrictCasting: false,
    restrictCombat: false,
    returnExiledForSource: false,
    reveal: false,
    revealTopAndRoute: false,
    revealUntilMatch: false,
    sacrifice: false,
    setBasePT: false,
    setCardTypes: false,
    setColor: false,
    setIslandSanctuaryProtection: false,
    setProtectionFromEverything: false,
    setSubtype: false,
    shuffleSelfIntoLibrary: false,
    skipDrawStepThisTurn: false,
    skipNextTurn: false,
    skipNextUntap: false,
    suppressDamagePrevention: false,
    tapUntap: false,
    transform: false,
    unattach: false,
    winGame: false,
};

/** Longest chain of resolution choices one execution path through `effects`
 *  raises. Sequential Ops ADD (each suspends in turn, and the probe answers
 *  them one after another); an Op's nested scripts take the DEEPEST branch,
 *  since `if`/`optionChoice`/`coinFlip` arms are alternatives, not a sequence.
 *
 *  A `forEach` body is counted ONCE, not once per member: the member count is a
 *  runtime fact of the position, not of the card, so a static walk cannot know
 *  it. That makes this a lower bound for a repeated-choice loop — the probe
 *  simply stops proving at the cap there, which is its fail-open direction. */
export function scriptChoiceDepth(effects: readonly EffectOp[]): number {
    let chain = 0;
    for (const op of effects) {
        const own = RAISES_RESOLUTION_CHOICE[op.op] ? 1 : 0;
        let nested = 0;
        for (const child of childOpArrays(op)) {
            nested = Math.max(nested, scriptChoiceDepth(child));
        }
        chain += own + nested;
    }
    return chain;
}

/** Every `ctx.request*` call a protocol-like closure makes (ADR 0045's escape
 *  hatch: `resolve` / `resolveSteps` / `effect`). Counted from the closure's own
 *  SOURCE, which is neither a clean upper nor lower bound and should not be
 *  read as one: it OVER-counts a closure whose calls sit on mutually exclusive
 *  branches (Word of Command's 5) and UNDER-counts one that delegates its
 *  request to a helper. It is a static approximation, deliberately on the
 *  loud side — there is no way to see a `resolve()` card's choices without
 *  running it, and running it needs a position. */
const REQUEST_CALL = /ctx\s*\.\s*request[A-Z][A-Za-z]*\s*\(/g;

function closureChoiceDepth(fn: unknown): number {
    if (typeof fn !== "function") return 0;
    return (fn.toString().match(REQUEST_CALL) ?? []).length;
}

/** The deepest chain of resolution choices any one resolution of `def` takes:
 *  its spell script, each of its modes, and each of its abilities' scripts —
 *  every site that resolves independently, so the MAX across them, never the
 *  sum. That is right for a "choose one" (CR 700.2), where exactly one mode
 *  resolves; a "choose two or three" charm resolves its chosen modes in
 *  sequence and their chains would ADD. Nothing shipped is one — every modal
 *  card in the catalogue is choose-one — so the max stands, and this is the
 *  line to revisit on the first choose-two card. */
export function definitionChoiceDepth(def: CardDefinition): number {
    const sites: number[] = [];
    const script = (value: unknown): void => {
        if (Array.isArray(value))
            sites.push(scriptChoiceDepth(value as EffectOp[]));
    };
    const record = def as unknown as Record<string, unknown>;
    script(record.effects);
    sites.push(closureChoiceDepth(record.resolve));
    sites.push(closureChoiceDepth(record.effect));
    for (const step of (record.resolveSteps as unknown[]) ?? []) {
        sites.push(closureChoiceDepth(step));
        if (step && typeof step === "object") {
            script((step as Record<string, unknown>).effects);
        }
    }
    for (const mode of (def.modes ?? []) as unknown as Record<
        string,
        unknown
    >[]) {
        script(mode.effects);
        sites.push(closureChoiceDepth(mode.resolve));
        sites.push(closureChoiceDepth(mode.effect));
    }
    for (const ability of def.activatedAbilities ?? []) {
        const row = ability as unknown as Record<string, unknown>;
        script(row.effects);
        sites.push(closureChoiceDepth(row.resolve));
        sites.push(closureChoiceDepth(row.effect));
    }
    for (const ability of def.triggeredAbilities ?? []) {
        const row = ability as unknown as Record<string, unknown>;
        script(row.effects);
        sites.push(closureChoiceDepth(row.resolve));
        sites.push(closureChoiceDepth(row.effect));
    }
    return Math.max(0, ...sites);
}

/** The deepest such chain in the whole shipped catalogue, with the card that
 *  sets it. The measurement `MAX_CHOICE_DEPTH` is read from — pinned by
 *  `choiceDepth.bot.test.ts`, which fails when a new card exceeds the bound. */
export function catalogueChoiceDepth(defs: readonly CardDefinition[]): {
    depth: number;
    cards: string[];
} {
    let depth = 0;
    let cards: string[] = [];
    for (const def of defs) {
        const d = definitionChoiceDepth(def);
        if (d > depth) {
            depth = d;
            cards = [def.name];
        } else if (d === depth && d > 0) {
            cards.push(def.name);
        }
    }
    return { depth, cards };
}
