/**
 * What the Bot-play sweep's opponent puts on the stack for a card that targets
 * a SPELL (CR 115.1, issue #4821).
 *
 * The position used to seed one plain creature spell for every such card, so a
 * counterspell whose requirement narrows the spell — "artifact or enchantment"
 * (`spellTypeFilter`), "noncreature" (`spellExcludeTypeFilter`), "activated or
 * triggered ability" (`spellStackKind`), "that targets a land you control"
 * (`spellTargetsPermanentFilter`) — found no legal target, the engine refused
 * a HUMAN the cast too, and the verdict read `position-unmodelled`: a limit of
 * the harness, never a fact about the Bot. The stack learns the shape instead,
 * the way `targetPose` does for a permanent target.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { tryGetCardByName } from "../../cards/catalogue";
import type {
    CardDefinition,
    CardType,
    TargetRequirement,
} from "../../cards/types";
import type { ScenarioCard, ScenarioStackItem } from "../../debugScenarioSpec";

/** The spell every position stacks by default, and the first choice for a
 *  requirement it already satisfies. */
const BASE_SPELL = "Grizzly Bears";
/** Stacked spells tried in order for a requirement on the spell's card types:
 *  a creature, a noncreature enchantment, an artifact creature. */
const SPELL_CANDIDATES = [BASE_SPELL, "Castle", "Ornithopter"] as const;
/** An activated ability that names a player, for a requirement on an ability
 *  (CR 113.7a: an ability on the stack is not a spell). */
const ABILITY_SOURCE = "Prodigal Sorcerer";
/** A spell that targets a land, for a requirement on what the stacked object
 *  targets (CR 601.2c). */
const LAND_TARGETING_SPELL = "Stone Rain";

/** What a card adds to the generated position so its spell target exists. */
export interface StackPose {
    readonly cards: readonly ScenarioCard[];
    readonly stack: readonly ScenarioStackItem[];
}

const asArray = <T>(v: T | readonly T[] | undefined): readonly T[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v as T];

/** The card's own spell-target requirement, if it has one. */
function spellRequirement(def: CardDefinition): TargetRequirement | undefined {
    return [
        ...(def.targetRequirement ? [def.targetRequirement] : []),
        ...(def.modes ?? []).flatMap((m) =>
            m.targetRequirement ? [m.targetRequirement] : []
        ),
    ].find((r) =>
        asArray(r.type).some((t) => t === "spell" || t === "spell-or-permanent")
    );
}

/** Does the named spell's card type line satisfy the requirement's filters? */
function spellFits(name: string, req: TargetRequirement): boolean {
    const types = tryGetCardByName(name)?.types ?? [];
    const wanted = asArray<CardType>(req.spellTypeFilter);
    const excluded = asArray<CardType>(req.spellExcludeTypeFilter);
    return (
        (wanted.length === 0 || wanted.some((t) => types.includes(t))) &&
        !excluded.some((t) => types.includes(t))
    );
}

/**
 * The opponent's stack for `def`, or `undefined` when the card needs none.
 * `holderLand` is a land the holder controls, for a requirement on what the
 * stacked object targets.
 */
export function stackPose(
    def: CardDefinition,
    holderLand: string
): StackPose | undefined {
    const req = spellRequirement(def);
    if (!req) return undefined;
    if (req.spellStackKind === "ability") {
        const ability =
            tryGetCardByName(ABILITY_SOURCE)?.activatedAbilities?.[0];
        if (!ability) return undefined;
        return {
            cards: [
                { name: ABILITY_SOURCE, owner: "opp", zone: "battlefield" },
            ],
            stack: [
                {
                    kind: "ability",
                    name: ABILITY_SOURCE,
                    controller: "opp",
                    abilityId: ability.id,
                    targets: [{ kind: "player", seat: "me" }],
                },
            ],
        };
    }
    if (req.spellTargetsPermanentFilter) {
        return {
            cards: [],
            stack: [
                {
                    kind: "spell",
                    name: LAND_TARGETING_SPELL,
                    controller: "opp",
                    targets: [
                        { kind: "permanent", name: holderLand, seat: "me" },
                    ],
                },
            ],
        };
    }
    const name = SPELL_CANDIDATES.find((n) => spellFits(n, req)) ?? BASE_SPELL;
    return {
        cards: [],
        stack: [{ kind: "spell", name, controller: "opp" }],
    };
}
