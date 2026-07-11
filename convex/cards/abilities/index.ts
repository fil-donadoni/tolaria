// Reusable factories for common card-shape patterns. Cards with identical
// ability/structure shapes (rule of two extraction, see
// feedback_extract_after_second.md) should call these instead of re-declaring
// the inline literal.

import type {
    ActivatedAbility,
    CardDefinition,
    Color,
    EffectOp,
    ManaCost,
    Rarity,
    SpellContext,
    TargetRequirement,
} from "../types";

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
 *  established (`convex/cards/sets/ice/colorless.ts`), reused here for an
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
 *  (`convex/cards/sets/drk/colorless.ts`), here checking the ACTIVATING
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
 *  colors, ulg/white.ts) and Giver of Runes (5 colors + colorless,
 *  mh1/white.ts) — issue #684/#928 dedup. */
export function protectionColorModes(
    codes: ReadonlyArray<Color>
): { id: string; label: string; effects: EffectOp[] }[] {
    return codes.map((code) => {
        const quality = PROTECTION_QUALITY_NAMES[code];
        return {
            id: `protection-${quality}`,
            label: `Protection from ${quality}`,
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
 *  Subtypes are derived from `colors` so the same factory drives both the
 *  mana-ability shape and the rules-relevant land subtypes (landwalk,
 *  Armageddon, etc.). The mana ability follows the dual pattern from
 *  Birds of Paradise: `effect` produces the first color by default, and the
 *  `manaChoices` array exposes both options to the picker.
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
    /** The MKM "surveil land" cycle (CR 701.44 Surveil): "This land enters
     *  tapped. When this land enters, surveil 1." A plain unconditional
     *  `entersTapped: true` (no board predicate, no pay-choice) plus a
     *  self-ETB triggered ability whose effect is the shared `scryReorder`
     *  Op with `count: 1, destination: "graveyard"` (surveil = scry-into-
     *  graveyard, CR 701.44 modelled over CR 701.22, ADR 0045). Keeps the
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
        `As ${args.name} enters the battlefield, you may pay 2 life. If you ` +
        "don't, it enters the battlefield tapped.\n" +
        `{T}: Add {${c1}} or {${c2}}.`;
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
        // CR 701.44 — the ETB surveil 1 trigger, shared shape across the cycle.
        triggeredAbilities: args.surveilLand
            ? [
                  {
                      id: `${slug}-surveil`,
                      oracleText: "When this land enters, surveil 1.",
                      event: "PERMANENT_ENTERED",
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
        activatedAbilities: [
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
        ],
    };
}

/** Builds a "Circle of Protection: <X>" enchantment (CR 615 prevention).
 *  `{1}: The next time a <X> source of your choice would deal damage to
 *  you this turn, prevent that damage.` Drives the LEA color cycle (White/
 *  Blue/Black/Green/Red), the Beta-original Circle of Protection: Black, and
 *  ATQ's Circle of Protection: Artifacts.
 *
 *  The `source` filter selects what kind of damage source can be chosen:
 *   - `{ kind: "color"; color; word }` — the LEA cycle. `colorFilter`
 *     restricts targets to sources of `color`; players can't be chosen
 *     (a player isn't a colored source).
 *   - `{ kind: "color-any"; colors; word }` — a multi-color "source of your
 *     choice" (Greater Realm of Preservation: "a black or red source").
 *     `colorFilterAny` restricts targets to sources that are AT LEAST ONE of
 *     `colors` (CR 202.2 — OR semantics); players can't be chosen.
 *   - `{ kind: "artifact"; word }` — COP: Artifacts. The target filter
 *     restricts to permanents/spells of the Artifact card type.
 *
 *  The resolve schedules a one-shot end-of-turn damage prevention against the
 *  chosen source via `preventNextDamageFromSource` (CR 615.1, 615.6). The
 *  shield is keyed on the chosen source's instance id, so the color predicate
 *  only gates the choice — once a legal source is picked, that exact source is
 *  shielded regardless of any later color change (CR 615.6). */
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
     *  cycle); Greater Realm of Preservation uses {1}{W}. */
    activationCost?: ManaCost;
}): CardDefinition {
    const source: CopSourceFilter =
        args.source ??
        ({ kind: "color", color: args.color!, word: args.colorWord! } as const);
    // Artifact sources are matched by the Artifact card type (permanent or
    // spell); single-color sources by `colorFilter`; multi-color "X or Y
    // source" by `colorFilterAny` (CR 202.2 — OR semantics).
    const targetRequirement: TargetRequirement =
        source.kind === "artifact"
            ? {
                  type: ["Artifact", "spell"],
                  count: 1,
                  spellTypeFilter: "Artifact",
              }
            : source.kind === "color-any"
              ? {
                    type: ["any", "spell"],
                    count: 1,
                    colorFilterAny: source.colors,
                }
              : {
                    type: ["any", "spell"],
                    count: 1,
                    colorFilter: source.color,
                };
    const activationCost: ManaCost = args.activationCost ?? { X: 1 };
    // CR 107 — render the activation cost as mana symbols for the ability's
    // oracle text ({N} generic, then WUBRG). Keeps the LEA cycle's "{1}:" and
    // Greater Realm's "{1}{W}:" in sync with the actual cost field.
    const costPrefix = formatActivationCost(activationCost);
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
                oracleText: `${costPrefix}: The next time a ${source.word.toLowerCase()} source of your choice would deal damage to you this turn, prevent that damage.`,
                cost: { mana: activationCost },
                useStack: true,
                targetRequirement,
                resolve: (ctx: SpellContext) => {
                    const [target] = ctx.targets;
                    if (!target) return;
                    if (target.type === "player") return; // not a valid source
                    ctx.preventNextDamageFromSource(target.id, ctx.controller, {
                        phase: "end-of-turn",
                    });
                },
            },
        ],
    };
}
