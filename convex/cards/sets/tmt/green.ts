// TMT — green cards, split by colour per ADR 0043. The registry's
// `import * as tmt from "./sets/tmt"` resolves through tmt/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { MUTAGEN_TOKEN } from "../../sharedTokens";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Michelangelo, Weirdness to 11 — {1}{G} 1/1 Legendary Creature — Mutant Ninja
// Turtle (TMT, issue #3230).
// "When Michelangelo enters, create a Mutagen token.
//  If one or more +1/+1 counters would be put on a creature you control, that
//  many plus one +1/+1 counters are put on it instead."
//
// THE RIDER IS A REPLACEMENT EFFECT (CR 614.1a — "instead"), on the
// `"counter-placed"` `ReplacementEventKind` issue #3230 added. It is "that many
// PLUS ONE", not "twice that many", which is why the seam rewrites an arbitrary
// `count` rather than carrying a multiplier flag: the Hardened Scales family and
// the Corpsejack Menace family are the same event with different arithmetic.
//
// THE SCOPE IS THREE CONDITIONS, all read off the event: the counter is a
// `+1/+1` (CR 122.1a — not a -1/-1, not a lore/loyalty/charge counter), the
// object is a CREATURE (CR 300 — not a planeswalker taking loyalty, not an
// artifact taking charge counters), and its controller is Michelangelo's
// (CR 110.2). Michelangelo is himself a creature his controller controls, so
// counters put on HIM get the bonus too.
//
// EVERY SOURCE OF COUNTERS, not just an effect: the seam sits in
// `addCounterToCard` (the shared mutator behind the DSL `counters` Op,
// `SpellContext.addCounter`, the infect/wither damage form and every keyword
// action) AND in `applyEntersWithCounters` (CR 614.1c "enters with N +1/+1
// counters"), so a creature ENTERING with counters gets the bonus — two
// replacement effects on one event, CR 616.1.
//
// The Mutagen token is SHARED (`cards/sharedTokens.ts`): Mutagen Man, Living
// Ooze creates X of the same token, so its characteristics live in one place
// and both producers make the identical object.

// compiler-gap: "When Michelangelo enters, create a Mutagen token." (#2693)
// compiler-gap: "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead." (#2693)
export const michelangeloWeirdnessTo11: CardDefinition = {
    id: "18477047-218d-4b2a-a086-37431b6a3025",
    name: "Michelangelo, Weirdness to 11",
    rarity: "rare",
    oracleText:
        'When Michelangelo enters, create a Mutagen token. (It\'s an artifact with "{1}, {T}, Sacrifice this token: Put a +1/+1 counter on target creature. Activate only as a sorcery.")\nIf one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Mutant", "Ninja", "Turtle"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "michelangelo-weirdness-to-11-etb-mutagen",
            oracleText: "When Michelangelo enters, create a Mutagen token.",
            scope: "self",
            effects: [
                {
                    op: "createToken",
                    token: MUTAGEN_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
        }),
    ],
    replacementEffects: [
        {
            id: "michelangelo-weirdness-to-11-counter-plus-one",
            oracleText:
                "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.",
            eventKind: "counter-placed",
            appliesTo: (event, self) =>
                event.kind === "counter-placed" &&
                event.counterType === "+1/+1" &&
                event.controllerId === self.controllerId &&
                event.types.includes("Creature"),
            replace: (event) => {
                if (event.kind !== "counter-placed") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, count: event.count + 1 },
                };
            },
        },
    ],
};
