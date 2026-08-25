// ONC — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as onc from "./sets/onc"` resolves through onc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, EffectTokenSpec } from "../../types";

// The 2/2 red Rebel token Otharri creates (CR 111.1 / 707.2). Deliberately a
// LOCAL spec, not a `sharedTokens.ts` entry: Otharri is the only Rebel producer
// in the catalogue, and the shared file is for a token several cards create
// ("extract after the second"). No `imagePrintId` is hand-wired — art is
// auto-resolved at creation time by (producing card id, token name) out of
// `cards/generated/token-prints.json`, which already links Otharri's own ONC
// printing of the Rebel token (`tone` set); `tokenPrintLookup.test.ts` is the
// catalogue-wide guard that this resolves.
const REBEL_TOKEN: EffectTokenSpec = {
    name: "Rebel",
    types: ["Creature"],
    subtypes: ["Rebel"],
    colors: ["R"],
    power: 2,
    toughness: 2,
    // CR 508.4 — a token created "tapped and attacking" enters attacking
    // without ever having been DECLARED as an attacker, so it triggers no
    // attack triggers (including Otharri's own — no recursion).
    entersTapped: true,
    entersAttacking: true,
};

// Otharri, Suns' Glory — {3}{R}{W} Legendary Creature — Phoenix, 3/3.
// "Flying, lifelink, haste
//  Whenever Otharri, Suns' Glory attacks, you get an experience counter. Then
//  create a 2/2 red Rebel creature token that's tapped and attacking for each
//  experience counter you have.
//  {2}{R}{W}, Tap an untapped Rebel you control: Return this card from your
//  graveyard to the battlefield tapped."
//
// CR 122.1 — "A counter is a marker placed on an object or player". Experience
// counters sit on the PLAYER: `PlayerState.experienceCounters` (issue #1969), a
// dedicated scalar like poison/energy (ADR 0032). They have no rule of their
// own in the CR (`bun run cr grep "experience counter"` matches nothing) and no
// rule removes them; CR 122.2's "counters on an object are not retained if that
// object moves from one zone to another" is OBJECT-scoped, so Otharri dying,
// being exiled or being reanimated never resets the total. That persistence is
// the whole engine of the card, and the reanimation ability is what makes it
// recur.
//
// The two clauses of the attack trigger are SEQUENTIAL within one resolution
// ("… you get an experience counter. THEN create …"), so the Op order below is
// load-bearing: the increment runs first and the count reads the post-increment
// total. First attack ⇒ 1 token, second ⇒ 2, and so on.
export const otharriSunsGlory: CardDefinition = {
    id: "80c72839-0fa6-4b5f-83b7-6553ebf09bef",
    name: "Otharri, Suns' Glory",
    rarity: "mythic",
    oracleText:
        "Flying, lifelink, haste\nWhenever Otharri, Suns' Glory attacks, you get an experience counter. Then create a 2/2 red Rebel creature token that's tapped and attacking for each experience counter you have.\n{2}{R}{W}, Tap an untapped Rebel you control: Return this card from your graveyard to the battlefield tapped.",
    manaCost: { X: 3, R: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Phoenix"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying", "lifelink", "haste"],
    triggeredAbilities: [
        {
            id: "otharri-suns-glory-attack",
            oracleText:
                "Whenever Otharri, Suns' Glory attacks, you get an experience counter. Then create a 2/2 red Rebel creature token that's tapped and attacking for each experience counter you have.",
            event: "ATTACKERS_DECLARED",
            // CR 508.1 — "whenever THIS creature attacks" (the Satya /
            // Mijae Djinn shape: `event.attackerIds.includes(self.id)`),
            // distinct from "whenever YOU attack" (Guide of Souls), which
            // fires once per combat regardless of which creatures attacked.
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                // CR 122.1 — "you get an experience counter". Runs BEFORE the
                // read below: "Then" makes the two clauses sequential.
                {
                    op: "addPlayerCounter",
                    player: "controller",
                    counter: "experience",
                    amount: 1,
                },
                // CR 707.2 / 508.4 — "for each experience counter you have"
                // reads the player-scoped total back through the
                // `playerCounters` value member, post-increment.
                {
                    op: "createToken",
                    token: REBEL_TOKEN,
                    controller: "controller",
                    count: {
                        playerCounters: {
                            of: "controller",
                            type: "experience",
                        },
                    },
                },
            ],
        },
    ],
    activatedAbilities: [
        {
            id: "otharri-suns-glory-reanimate",
            oracleText:
                "{2}{R}{W}, Tap an untapped Rebel you control: Return this card from your graveyard to the battlefield tapped.",
            // CR 602.1 / 118.8 — the `tapOtherFilter` cost taps an untapped
            // Rebel the ACTIVATOR controls (the source is excluded from the
            // candidate pool by construction, which is also correct here:
            // Otharri is in the graveyard, not on the battlefield).
            // `activateFromGraveyard` (issue #737, the Ashen Ghoul seam) is
            // what lets `activateAbility` find the source in its owner's
            // graveyard at all.
            cost: {
                mana: { X: 2, R: 1, W: 1 },
                tapOtherFilter: {
                    filter: { subtypes: "Rebel", controllerRelation: "you" },
                    count: 1,
                },
            },
            useStack: true,
            activateFromGraveyard: true,
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$source" },
                    to: "battlefield",
                    tapped: true,
                },
            ],
        },
    ],
};
