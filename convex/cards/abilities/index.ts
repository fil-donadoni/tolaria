// Reusable factories for common card-shape patterns. Cards with identical
// ability/structure shapes (rule of two extraction, see
// feedback_extract_after_second.md) should call these instead of re-declaring
// the inline literal.

import type {
    ActivatedAbility,
    CardBackFace,
    CardDefinition,
    Color,
    EffectCardFilter,
    EffectOp,
    ManaCost,
    Rarity,
    SpellContext,
} from "../types";
import { cyclingAbility } from "./cycling";

/** Builds a `{T}: Add <mana>` mana ability (CR 605.1a, 605.3a — useStack false).
 *  Used by Mox Pearl/Sapphire/Jet/Ruby/Emerald, Sol Ring, Llanowar Elves and
 *  any future fixed-output mana producer. */
export function makeTapForMana(args: {
    id: string;
    oracleText: string;
    produces: ManaCost;
}): ActivatedAbility {
    const produces = args.produces;
    return {
        id: args.id,
        oracleText: args.oracleText,
        cost: { tap: true },
        effect: (ctx) => {
            ctx.addMana(produces);
        },
        useStack: false,
        manaProduced: produces,
    };
}

/** Builds a "Talisman of <X><Y>"-cycle artifact (CR 605.1a — two mana
 *  abilities, both `useStack: false`): a painless `{T}: Add {C}.` plus a
 *  `{T}: Add <c1> or <c2>. This artifact deals 1 damage to you.` Modelled as
 *  ONE choice mana ability whose first option is the painless {C} and whose
 *  two coloured options carry the `dealsDamageToControllerOnColoredTap: 1`
 *  rider — the exact painland shape ICE's Adarkar Wastes cycle already
 *  established (`convex/cards/sets/ice/colorless.cards.ts`), reused here for an
 *  artifact instead of a land. Used by the MRD/MH1 Talisman cycle
 *  (issue #675, ADR 0041). */
export function makeTalisman(args: {
    id: string;
    name: string;
    rarity: Rarity;
    colors: [Color, Color];
}): CardDefinition {
    const [c1, c2] = args.colors;
    const slug = args.name.toLowerCase().replaceAll(/\s+/g, "-");
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText: `{T}: Add {C}.\n{T}: Add {${c1}} or {${c2}}. This artifact deals 1 damage to you.`,
        manaCost: { X: 2 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: `${slug}-mana`,
                oracleText: `{T}: Add {C}.\n{T}: Add {${c1}} or {${c2}}. This artifact deals 1 damage to you.`,
                cost: { tap: true },
                useStack: false,
                manaChoices: [{ C: 1 }, { [c1]: 1 }, { [c2]: 1 }],
                dealsDamageToControllerOnColoredTap: 1,
            },
        ],
    };
}

/** Builds a DSK "Verge" cycle land (CR 605.1a — two `{T}` mana abilities on
 *  the printed Oracle text, e.g. "{T}: Add {R}. {T}: Add {U}. Activate only
 *  if you control an Island or a Mountain."). A card cannot carry two
 *  independently-activatable `{T}` mana abilities in this engine (the
 *  tap-mana fast path resolves a permanent's mana ability via
 *  `getActivatedManaAbility`'s single `.find()`), so this is modelled as ONE
 *  choice mana ability whose second option is gated by a board-conditional
 *  `getManaChoices` hook — the same primitive Fellwar Stone uses
 *  (`convex/cards/sets/drk/colorless.cards.ts`), here checking the ACTIVATING
 *  PLAYER's own battlefield for either of two named basic land subtypes
 *  instead of an opponent's producible colours. The static `manaChoices`
 *  (both options) is the representative / fallback list for best-effort
 *  callers without a board snapshot. Used by the DSK/DFT Verge cycle
 *  (issue #675, ADR 0041). */
export function makeVergeLand(args: {
    id: string;
    name: string;
    rarity: Rarity;
    /** The land's own always-available colour. */
    primary: Color;
    /** The gated colour, unlocked once the controller has either
     *  `unlockedBy` subtype in play. */
    secondary: Color;
    unlockedBy: [string, string];
}): CardDefinition {
    const { primary, secondary, unlockedBy } = args;
    const slug = args.name.toLowerCase().replaceAll(/\s+/g, "-");
    const oracleText = `{T}: Add {${primary}}.\n{T}: Add {${secondary}}. Activate only if you control a${
        /^[aeiou]/i.test(unlockedBy[0]) ? "n" : ""
    } ${unlockedBy[0]} or a ${unlockedBy[1]}.`;
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText,
        manaCost: {},
        types: ["Land"],
        activatedAbilities: [
            {
                id: `${slug}-mana`,
                oracleText,
                cost: { tap: true },
                useStack: false,
                effect: (ctx) => ctx.addMana({ [primary]: 1 }),
                manaChoices: [{ [primary]: 1 }, { [secondary]: 1 }],
                getManaChoices: (_source, controllerId, battlefields) => {
                    const own = battlefields.find(
                        (b) => b.playerId === controllerId
                    );
                    const unlocked =
                        own?.permanents.some(
                            ({ permanent }) =>
                                permanent.types.includes("Land") &&
                                (permanent.subtypes.includes(unlockedBy[0]) ||
                                    permanent.subtypes.includes(unlockedBy[1]))
                        ) ?? false;
                    return unlocked
                        ? [{ [primary]: 1 }, { [secondary]: 1 }]
                        : [{ [primary]: 1 }];
                },
            },
        ],
    };
}

/** Color words used by the protection-from-X keyword (CR 702.16). Keep this
 *  in lowercase and aligned with the Oracle text — the engine's protection
 *  parser splits on the literal `protection from <color>` substring. */
type ProtectionColor = "white" | "blue" | "black" | "red" | "green";

/** Builds the static-ability strings for the classic "Knight cycle" creatures
 *  (first strike + protection from the opposing color). Used by White Knight,
 *  Black Knight; future cycles like Order of Leitbur / Order of the Ebon Hand
 *  add an activated pump on top — they reuse this baseline as their starting
 *  `staticAbilities` array. */
export const knightStaticAbilities = (
    protectionFrom: ProtectionColor
): string[] => ["first strike", `protection from ${protectionFrom}`];

/** Names for every grantable "protection from <X>" quality (CR 702.16),
 *  including colorless (`C` — CR 105.2c, issue #684/#928). Shared by every
 *  "choose a color (or colorless)" protection-granting activated ability. */
export const PROTECTION_QUALITY_NAMES: Record<Color, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
};

/** Builds one `optionChoice` mode per grantable color/quality in `codes`,
 *  each granting "protection from <quality>" to the announced target (CR
 *  702.16, 613.1f, CR 700.2 modal choice). Shared by Mother of Runes (5
 *  colors, ulg/white.cards.ts) and Giver of Runes (5 colors + colorless,
 *  mh1/white.cards.ts) — issue #684/#928 dedup. */
export function protectionColorModes(
    codes: ReadonlyArray<Color>
): { id: string; label: string; color: Color; effects: EffectOp[] }[] {
    return codes.map((code) => {
        const quality = PROTECTION_QUALITY_NAMES[code];
        return {
            id: `protection-${quality}`,
            label: `Protection from ${quality}`,
            color: code,
            effects: [
                {
                    op: "grantAbility",
                    ability: `protection from ${quality}`,
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                } satisfies EffectOp,
            ],
        };
    });
}

const COLOR_TO_LAND_SUBTYPE: Record<Color, string> = {
    W: "Plains",
    U: "Island",
    B: "Swamp",
    R: "Mountain",
    G: "Forest",
    C: "Wastes",
};

/** Builds a non-basic dual land (CR 305.6) that taps for one of two colors.
 *  Subtypes are derived from `colors`: the two basic land types ARE the mana
 *  ability (CR 305.6 — one intrinsic "{T}: Add" per type, issue #5623) as well
 *  as the rules-relevant land subtypes (landwalk, Armageddon, etc.), so a
 *  typed dual carries no `activatedAbilities`. Only the typeless fast land
 *  declares one, in the Birds of Paradise choice shape (`manaChoices`).
 *
 *  `fastLand: true` (issue #675, ADR 0041) turns it into the SOM/KLD "fast
 *  land" cycle instead of a plain ABUR-style dual: "This land enters tapped
 *  unless you control two or fewer other lands." — the `entersTappedUnless`
 *  CR 614.1c self-conditional replacement, counting the controller's OTHER
 *  lands on the board snapshot taken at entry (the entering land itself is
 *  not yet on the battlefield when the predicate runs, so a plain count of
 *  `view.players[controller].battlefield` lands already excludes it). No
 *  basic land subtypes on a fast land (unlike the ABUR duals), matching the
 *  printed cycle. */
export function makeDualLand(args: {
    id: string;
    name: string;
    /** Optional printed Oracle text — forwarded onto the resulting
     *  `CardDefinition` for display in the card preview and reference. */
    oracleText?: string;
    /** Printed rarity of the home-set printing (CR 206). The original duals
     *  are rare; pass through so the factory output is a complete definition. */
    rarity: Rarity;
    colors: [Color, Color];
    fastLand?: boolean;
    /** CR 614.12 / ADR 0051 — the RAV/GPT/DIS "shock land" cycle: "as it
     *  enters, you may pay 2 life; if you don't, it enters tapped." Unlike a
     *  fast land (a deterministic board predicate), this suspends land entry on
     *  a `land-entry-tapped` pay-choice. Keeps the basic land subtypes; declares
     *  `entersTappedUnlessPay: { life: 2 }`. Mutually exclusive with
     *  `fastLand`. */
    shockLand?: boolean;
    /** The MKM "surveil land" cycle (CR 701.25 Surveil): "This land enters
     *  tapped. When this land enters, surveil 1." A plain unconditional
     *  `entersTapped: true` (no board predicate, no pay-choice) plus a
     *  self-ETB triggered ability whose effect is the shared `scryReorder`
     *  Op with `count: 1, destination: "graveyard"` (surveil = scry-into-
     *  graveyard, CR 701.25 modelled over CR 701.22, ADR 0045). Keeps the
     *  basic land subtypes (the printed cards are `Land — <basic> <basic>`).
     *  Mutually exclusive with `fastLand` / `shockLand`. */
    surveilLand?: boolean;
}): CardDefinition {
    const [c1, c2] = args.colors;
    const slug = args.name.toLowerCase().replaceAll(/\s+/g, "-");
    const fastLandOracle =
        "This land enters tapped unless you control two or fewer other lands.\n" +
        `{T}: Add {${c1}} or {${c2}}.`;
    const shockLandOracle =
        `({T}: Add {${c1}} or {${c2}}.)\n` +
        "As this land enters, you may pay 2 life. If you don't, it enters tapped.";
    const surveilLandOracle =
        `({T}: Add {${c1}} or {${c2}}.)\n` +
        "This land enters tapped.\n" +
        "When this land enters, surveil 1.";
    const oracleText = args.fastLand
        ? fastLandOracle
        : args.shockLand
          ? shockLandOracle
          : args.surveilLand
            ? surveilLandOracle
            : args.oracleText;
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText,
        types: ["Land"],
        subtypes: args.fastLand
            ? undefined
            : [COLOR_TO_LAND_SUBTYPE[c1], COLOR_TO_LAND_SUBTYPE[c2]],
        entersTapped: args.surveilLand ? true : undefined,
        // CR 701.25 — the ETB surveil 1 trigger, shared shape across the cycle.
        triggeredAbilities: args.surveilLand
            ? [
                  {
                      id: `${slug}-surveil`,
                      oracleText: "When this land enters, surveil 1.",
                      event: "PERMANENT_ENTERED",
                      etbAbility: true, // issue #4758
                      matches: (event, self) =>
                          event.type === "PERMANENT_ENTERED" &&
                          event.instanceId === self.id,
                      effects: [
                          {
                              op: "scryReorder",
                              player: "controller",
                              count: 1,
                              destination: "graveyard",
                          },
                      ],
                  },
              ]
            : undefined,
        entersTappedUnless: args.fastLand
            ? (view, controllerId) => {
                  const own = view.players.find((p) => p.id === controllerId);
                  const otherLands =
                      own?.battlefield.filter((p) => p.types.includes("Land"))
                          .length ?? 0;
                  return otherLands <= 2;
              }
            : undefined,
        entersTappedUnlessPay: args.shockLand ? { life: 2 } : undefined,
        // CR 305.6 — a land with basic land types needs no printed mana
        // ability: each type grants its own intrinsic "{T}: Add [symbol]"
        // (`getBasicLandManaColors`), offered as one tap option apiece, so
        // only the typeless fast land carries one (issue #5623).
        activatedAbilities: args.fastLand
            ? [
                  {
                      id: `${slug}-mana`,
                      oracleText: `{T}: Add {${c1}} or {${c2}}.`,
                      cost: { tap: true },
                      effect: (ctx) => {
                          ctx.addMana({ [c1]: 1 });
                      },
                      useStack: false,
                      manaChoices: [{ [c1]: 1 }, { [c2]: 1 }],
                  },
              ]
            : undefined,
    };
}

/** CR 712.3 / 712.12 — the LAND back face of a modal double-faced card, as the
 *  `CardBackFace` a `kind: "modal"` twin is registered from (ADR 0122 §1).
 *
 *  Every land-backed modal card printed so far shares one shape: a typeless
 *  `Land` face with the "as this land enters, you may pay N life; if you
 *  don't, it enters tapped" clause and a single-colour mana ability. That is
 *  the shock clause CR 614.12 already models (`entersTappedUnlessPay`), so the
 *  factory declares it and nothing else — the pay-choice, the entry, the
 *  tapped bit and the client prompt are the shipped machinery a printed shock
 *  land uses, reached through the registered twin.
 *
 *  The mana ability is an Effect Script (`addMana`, ADR 0045) with
 *  `useStack: false` (CR 605.3a — a mana ability doesn't use the stack). It
 *  carries the LAND's own name in its id rather than the card's, because the
 *  twin is a definition in its own right and an id colliding with the front
 *  face's would make two abilities indistinguishable in a trace. */
export function modalLandBackFace(args: {
    /** The back face's printed name — the land's, not the card's (CR 712.8a
     *  gives the CARD the front face's name). */
    name: string;
    /** The colour the land taps for. */
    color: Color;
    /** CR 614.12 — the life the "unless you pay" clause asks for. Three on
     *  every printed land-backed modal card; a parameter because the clause
     *  is the shock clause and the shock cycle itself prints two. */
    life: number;
}): CardBackFace {
    const slug = args.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
    return {
        kind: "modal",
        name: args.name,
        types: ["Land"],
        oracleText:
            `As this land enters, you may pay ${args.life} life. If you don't, it enters tapped.\n` +
            `{T}: Add {${args.color}}.`,
        entersTappedUnlessPay: { life: args.life },
        activatedAbilities: [
            {
                id: `${slug}-mana`,
                oracleText: `{T}: Add {${args.color}}.`,
                cost: { tap: true },
                effects: [{ op: "addMana", mana: { [args.color]: 1 } }],
                useStack: false,
                // CR 605.1a — the DESCRIPTOR is what every mana authority
                // reads: the board's tap-for-mana affordance,
                // `getManaTapOptionsDetailed`, the auto-tap solver and the
                // Bot's mana count all ask what the ability PRODUCES, and a
                // fixed-output mana ability never runs its body for them to
                // find out. Without it the land taps for nothing everywhere
                // but the resolution itself (`manaDescriptor.catalogue.test
                // .ts` is the catalogue-wide guard).
                manaProduced: { [args.color]: 1 },
            },
        ],
    };
}

/** Builds a "Triome" (the IKO / SNC triple-typed cycling land cycle, CR 305.6):
 *  a non-basic land with three basic land subtypes that always enters tapped,
 *  taps for one of its three colors through those subtypes' intrinsic mana
 *  abilities, and has Cycling {3} (CR 702.29). The three
 *  colors are given in the printed mana-ability order ("Add {c1}, {c2}, or
 *  {c3}") — the subtypes follow the same order, matching the printed type line.
 *  All ten Triomes share this exact shape, so the factory is the single source
 *  (rule-of-two extraction). */
export function makeTriome(args: {
    id: string;
    name: string;
    rarity: Rarity;
    /** The three colors in printed mana-ability order. The land's basic land
     *  subtypes are derived from these via `COLOR_TO_LAND_SUBTYPE`, in the same
     *  order (matching the printed type line). */
    colors: [Color, Color, Color];
    /** The Cycling cost (CR 702.29). All printed Triomes are Cycling {3}. */
    cyclingCost?: ManaCost;
}): CardDefinition {
    const [c1, c2, c3] = args.colors;
    const cyclingCost = args.cyclingCost ?? { generic: 3 };
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText:
            `({T}: Add {${c1}}, {${c2}}, or {${c3}}.)\n` +
            "This land enters tapped.\n" +
            "Cycling {3} ({3}, Discard this card: Draw a card.)",
        types: ["Land"],
        subtypes: [
            COLOR_TO_LAND_SUBTYPE[c1],
            COLOR_TO_LAND_SUBTYPE[c2],
            COLOR_TO_LAND_SUBTYPE[c3],
        ],
        // CR 603.6d — Triomes always enter the battlefield tapped.
        entersTapped: true,
        // CR 305.6 — no printed mana ability: the three basic land types are
        // three intrinsic "{T}: Add" abilities (`getBasicLandManaColors`,
        // issue #5623). CR 702.29 — Cycling {3}, usable only from hand.
        activatedAbilities: [cyclingAbility(cyclingCost)],
    };
}

/** Builds a "Circle of Protection: <X>" enchantment (CR 615 prevention).
 *  `{1}: The next time a <X> source of your choice would deal damage to
 *  you this turn, prevent that damage.` Drives the LEA color cycle (White/
 *  Blue/Black/Green/Red), the Beta-original Circle of Protection: Black,
 *  ATQ's Circle of Protection: Artifacts and Greater Realm of Preservation.
 *
 *  The ability is the Effect Script the Oracle compiler reads the line into
 *  (issue #5601), so gold compares the two: a `pick-source` choice, then a
 *  `"next-from-source"` shield on the picked id.
 *
 *  CR 609.7a — the source is CHOSEN as the ability resolves, never targeted
 *  (CR 115.1): any permanent or any spell on the stack (a Lightning Bolt
 *  aimed at you), shroud, hexproof and protection notwithstanding, and the
 *  ability has no target to lose. The `source` filter is the printed
 *  qualifier on that choice:
 *   - `{ kind: "color"; color; word }` — the LEA cycle: a source of `color`.
 *   - `{ kind: "color-any"; colors; word }` — "a black or red source"
 *     (Greater Realm of Preservation): a source of ANY of `colors`.
 *   - `{ kind: "artifact"; word }` — COP: Artifacts: an artifact source.
 *
 *  CR 615.1a / 609.7b — the shield is keyed on the chosen source's instance
 *  id and carries the same qualifier as its `match`, RECHECKED when that
 *  source would deal damage: a red source turned green deals its damage and
 *  the shield is not used up. If no source qualifies, nothing is chosen and
 *  no shield is made. */
type CopSourceFilter =
    | { kind: "color"; color: Color; word: string }
    | { kind: "color-any"; colors: ReadonlyArray<Color>; word: string }
    | { kind: "artifact"; word: string };

/** Renders a fixed activation cost as mana symbols for oracle text (CR 107):
 *  generic `{N}` first (from numeric `X`/`C`), then colored WUBRG pips. Only
 *  the fixed forms used by Circle-of-Protection-shaped abilities are handled
 *  ({1}, {1}{W}); variable X is not expected here. */
function formatActivationCost(cost: ManaCost): string {
    const parts: string[] = [];
    const generic = (typeof cost.X === "number" ? cost.X : 0) + (cost.C ?? 0);
    if (generic > 0) parts.push(`{${generic}}`);
    for (const sym of ["W", "U", "B", "R", "G"] as const) {
        const n = cost[sym] ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${sym}}`);
    }
    return parts.join("");
}

/** CR 609.7a — "a source of your choice" for a `resolve()` card: the
 *  controller picks ONE permanent or spell on the stack as the effect
 *  resolves, without targeting it (CR 115.1), so shroud/hexproof/protection bar
 *  no candidate and no player is ever offered (a player is not a damage source
 *  object). Returns the chosen id, or `undefined` when the choice is pending
 *  (the caller returns early to let the engine suspend) or nothing qualifies.
 *  The `resolve()` twin of the DSL `choice` Op's `kind: "pick-source"`. */
export function pickDamageSource(
    ctx: SpellContext,
    args: { choiceId: string; prompt: string }
): string | undefined {
    const candidateIds = ctx.getDamageSourceChoiceIds();
    if (candidateIds.length === 0) return undefined;
    const picks = ctx.requestChoice({
        playerId: ctx.controller,
        choiceId: args.choiceId,
        kind: "pick-source",
        zone: "battlefield-or-stack",
        count: 1,
        prompt: args.prompt,
        candidateIds,
    });
    return picks?.[0];
}

export function makeCircleOfProtection(args: {
    id: string;
    name: string;
    oracleText?: string;
    /** Printed rarity of this Circle's printing (CR 206). The LEA cycle is
     *  uncommon; pass through so the factory output is a complete definition. */
    rarity: Rarity;
    /** Back-compat color shorthand — equivalent to
     *  `source: { kind: "color", color, word: colorWord }`. */
    color?: Color;
    colorWord?: string;
    source?: CopSourceFilter;
    /** Enchantment mana cost (CR 202). Defaults to the LEA Circle's {1}{W};
     *  Greater Realm of Preservation overrides it (it is also {1}{W}, but the
     *  factory keeps the field explicit for non-CoP reuse). */
    manaCost?: ManaCost;
    /** Activation cost of the prevention ability. Defaults to {1} (the CoP
     *  colour cycle); Circle of Protection: Artifacts uses {2}, Greater Realm
     *  of Preservation {1}{W}. */
    activationCost?: ManaCost;
}): CardDefinition {
    const source: CopSourceFilter =
        args.source ??
        ({ kind: "color", color: args.color!, word: args.colorWord! } as const);
    // The printed qualifier, as the `pick-source` choice's filter: an
    // artifact source by card type, a coloured one by colour (an array is
    // "any of them" — "a black or red source").
    const filter: EffectCardFilter =
        source.kind === "artifact"
            ? { type: "Artifact" }
            : source.kind === "color-any"
              ? { color: [...source.colors] }
              : { color: source.color };
    // CR 609.7b — the same qualifier as the shield's recheck.
    const match: { colors?: Color[]; cardType?: "Artifact" } =
        source.kind === "artifact"
            ? { cardType: "Artifact" }
            : source.kind === "color-any"
              ? { colors: [...source.colors] }
              : { colors: [source.color] };
    const activationCost: ManaCost = args.activationCost ?? { X: 1 };
    // CR 107 — render the activation cost as mana symbols for the ability's
    // oracle text ({N} generic, then WUBRG). Keeps the LEA cycle's "{1}:" and
    // Greater Realm's "{1}{W}:" in sync with the actual cost field.
    const costPrefix = formatActivationCost(activationCost);
    const word = source.word.toLowerCase();
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText: args.oracleText,
        manaCost: args.manaCost ?? { X: 1, W: 1 },
        types: ["Enchantment"],
        activatedAbilities: [
            {
                id: "cop-prevent",
                oracleText: `${costPrefix}: The next time ${/^[aeiou]/.test(word) ? "an" : "a"} ${word} source of your choice would deal damage to you this turn, prevent that damage.`,
                cost: { mana: activationCost },
                useStack: true,
                effects: [
                    {
                        op: "choice",
                        kind: "pick-source",
                        player: "controller",
                        zone: "battlefield-or-stack",
                        filter,
                        count: 1,
                        prompt: `Choose ${/^[aeiou]/.test(word) ? "an" : "a"} ${word} source.`,
                        bind: "$chosen",
                    },
                    {
                        op: "preventDamage",
                        mode: "next-from-source",
                        source: { ref: "$chosen" },
                        to: { player: "controller" },
                        duration: { phase: "end-of-turn" },
                        match,
                    },
                ],
            },
        ],
    };
}
