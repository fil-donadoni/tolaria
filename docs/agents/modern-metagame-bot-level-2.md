# Modern metagame — the Bot's level-2 cards

The list behind PRD issue #8445: the metagame-defining cards the Bot must play
right, not merely reach. **Draft: awaiting the owner's review on issue #8451.**
Issue #8452 turns each reviewed row into `must` Test Positions under the blade.

**Each row is a pair.** The risk with these cards is the Bot using them
backwards, so a row owes the position where the card is right AND the position
where the same card is wrong: a discriminating pair (`/bot-change`). Each row is
a ONE-TURN decision in a position where the line is already available. A
multi-turn plan is level 3, out of this bar (issue #1892).

Fix the class, never the card (ADR 0102). A blunder is a Verdict, not a root
rule (ADR 0124).

`Has` names an existing `must` entry by its label. An entry marked `wrong:` pins
only the row's wrong half. A row still owes whichever half has no entry.
Everything else is new.

A card in several lists sits under the deck it defines most. Every card here is
playable today (`bun run oracle:report --targets modern-metagame`, 123/210), or
is listed in [Not playable yet](#not-playable-yet) with the issue making it so.

## Eldrazi Ramp

| Card                      | Right                                                                    | Wrong: must not                                                   | Has |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- | --- |
| Urza's Saga               | chapter II on and {2} spare: make the Construct this turn                | leave the mana idle and let chapter III sacrifice it for no token |     |
| Sowing Mycospawn          | kicker affordable: kick it, fetch a land, exile the opponent's best land | point the kicked exile at its own land                            |     |
| Malevolent Rumble         | short of threats: keep the threat among the four cards                   | keep a land over the threat with lands to spare                   |     |
| Emrakul, the Promised End | the graveyard's card types make it castable this turn: cast it           | spend that mana on a lesser play                                  |     |
| Dismember                 | a creature it kills that beats the Bot, no {B}: pay the life and cast it | pay the life to lethal, or aim at toughness above 5               |     |

## Izzet Prowess

| Card                 | Right                                                           | Wrong: must not                                           | Has |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | --- |
| Cori-Steel Cutter    | two spells castable: cast both before combat, Monk attached     | attack first and cast the second spell after combat       |     |
| Monastery Swiftspear | blocked, an instant in hand: cast it so prowess wins the combat | fire the instant before attackers with no target worth it |     |
| Lava Dart            | 1 damage closes the game or kills an X/1: flash it back         | sacrifice a Mountain with no such target                  |     |
| Slickshot Show-Off   | {1}{R} spare and no attack worth making: plot it                | plot it when the hasty cast this turn swings for lethal   |     |

## Izzet Affinity

| Card                     | Right                                                           | Wrong: must not                                         | Has                                                                          |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Mox Opal                 | it makes the third artifact, metalcraft on: cast it and tap it  | cast a second Opal ahead of the play the mana is for    | wrong: `free mana: a second Mox Opal does not go ahead of the Grizzly Bears` |
| Kappa Cannoneer          | artifacts pay the rest through improvise: cast it               | crack an artifact first and fall one short of the cast  |                                                                              |
| Engineered Explosives    | counters match the opponent's mana value: sacrifice it to sweep | sweep when its own board loses more than the opponent's |                                                                              |
| Emry, Lurker of the Loch | a payable artifact in the graveyard: tap her and cast it        | tap her for an artifact it cannot pay this turn         |                                                                              |

## Domain Zoo

| Card                     | Right                                             | Wrong: must not                          | Has                                                                                                         |
| ------------------------ | ------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Leyline Binding          | two opposing threats: exile the greater one       | exile the lesser threat                  |                                                                                                             |
| Ragavan, Nimble Pilferer | an empty opposing board: attack                   | attack into a blocker that eats it       | `attack: Ragavan attacks an empty board`; wrong: `attack: Ragavan stays home from the blocker that eats it` |
| Tribal Flames            | domain covers the opponent's life: go to the face | aim at a creature with toughness above X |                                                                                                             |
| Territorial Kavu         | attacking with a surplus land: discard it, draw   | discard its best spell to the same mode  |                                                                                                             |

## Boros Energy

| Card               | Right                                                    | Wrong: must not                                          | Has                                                                                                                                                      |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guide of Souls     | {E}{E}{E} on attack: pay it on the attacker that stays   | pay it on a token sacrificed at end step                 |                                                                                                                                                          |
| Ocelot Pride       | no blocker that eats it: attack, gain life, make the Cat | attack into a blocker that kills it through first strike |                                                                                                                                                          |
| Galvanic Discharge | pay exactly the energy that kills the target             | pay all the energy into a target that needs less         |                                                                                                                                                          |
| Goblin Bombardment | a creature about to die anyway: sacrifice it for damage  | sacrifice a creature with no combat around it            | `sacrifice outlet: Goblin Bombardment takes the blocked creature before it dies`; wrong: `sacrifice outlet: keeps the creature with no combat around it` |

## Esper Blink

| Card                       | Right                                                               | Wrong: must not                                    | Has                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Ephemerate                 | Solitude evoked, the sacrifice trigger on the stack: blink it       | blink a creature with no enter effect, for no gain |                                                                                                                                                |
| Solitude                   | a lethal attacker: exile it, evoking if there is no mana            | evoke it with no threat, spending two cards        | `casts Solitude to exile a lethal attacker`                                                                                                    |
| Thoughtseize               | known hand: take the card that beats the Bot                        | take a lesser card over the real threat            | `strip: Thoughtseize takes the Shivan Dragon, not the Savannah Lions`; wrong: `strip: Thoughtseize never takes the Elves over the Serra Angel` |
| Phelia, Exuberant Shepherd | attacking: exile its own enter-effect creature, or the best blocker | exile its own token, which never returns           |                                                                                                                                                |
| Fatal Push                 | a threat of mana value 2, or 4 with revolt on: destroy it           | cast it at mana value 3 or 4 with revolt off       |                                                                                                                                                |

## Rakdos Aggro

| Card                | Right                                                        | Wrong: must not                                     | Has |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------- | --- |
| Fear of Missing Out | a surplus land in hand: discard it to the enter trigger      | discard its best spell and keep the surplus land    |     |
| Unholy Heat         | delirium on: 6 damage at the biggest threat                  | aim at toughness 3 or more with delirium off        |     |
| Blood Moon          | the opponent's mana is nonbasic, its own hand castable: cast | cast it when its own nonbasics then strand its hand |     |
| Nethergoyf          | four card types and spare cards in the graveyard: escape it  | exile more of the graveyard than the cost needs     |     |

## Mono-Green Amulet Titan

| Card                 | Right                                                               | Wrong: must not                                       | Has                                                                                                                  |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Amulet of Vigor      | the bounce land untaps: tap it for mana before its trigger resolves | return the land without tapping it first              |                                                                                                                      |
| Simic Growth Chamber | another land in play: tap that land, then return it                 | play it as the only land, returning itself            |                                                                                                                      |
| Primeval Titan       | enters or attacks: search, utility lands over basics                | decline the search, or take basics over utility lands |                                                                                                                      |
| Summoner's Pact      | four mana next upkeep: cast it for the creature the board needs     | cast it with the upkeep unpayable, losing the game    |                                                                                                                      |
| Green Sun's Zenith   | the X that finds the creature it needs                              | spend more X than the find needs                      | `X spell: Green Sun's Zenith finds the Bears at X = 2`; wrong: `X spell: Green Sun's Zenith never overpays the find` |

## W-U-B-G Goryo's

| Card              | Right                                                               | Wrong: must not                                    | Has |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------- | --- |
| Goryo's Vengeance | a legend in the graveyard: the strongest one, before combat         | take the weaker legend, or cast it at the end step |     |
| Griselbrand       | in play, life above 7: pay 7, draw seven                            | pay down to lethal                                 |     |
| Ephemerate        | a legend Goryo's Vengeance returned: blink it before the end step   | let it be exiled with Ephemerate castable          |     |
| Psychic Frog      | blocked: discard a spare card so the counter wins the combat        | discard a live hand with no combat to win          |     |
| Force of Negation | the opponent's lethal noncreature spell: exile a blue card, counter | pitch a card to counter an irrelevant spell        |     |

## Mono-Red Combo

| Card           | Right                                                               | Wrong: must not                        | Has                                                                                                                                                |
| -------------- | ------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Past in Flames | a graveyard of spells, and the mana to replay them this turn: cast  | cast it with an empty graveyard        |                                                                                                                                                    |
| Grapeshot      | storm count is lethal: cast it                                      | fire it early, one prior cast short    | `storm: Grapeshot is lethal because the search counts the spell cast before it`; wrong: `storm: does NOT reach for Grapeshot one prior cast short` |
| Pyretic Ritual | it enables a spell this turn: cast it                               | cast it with nothing to spend on       |                                                                                                                                                    |
| Ruby Medallion | it and a red spell both castable: Medallion first                   | cast the red spell first at full cost  |                                                                                                                                                    |
| Manamorphose   | mana to replace: cast it, and name the colours the next spell needs | name colours its next spell cannot use |                                                                                                                                                    |

## Not playable yet

Read off `oracle:report --targets modern-metagame` on 2026-11-07. Issue #8559
enforced the Target and ran `gaps:sync`, so each card below has its own filed
issue; a card held only by a cluster claim holder (issue #8497) got a
`Grammar Gap:` issue of its own. Issue #8452 writes a row's positions once its
card lands.

| Card                      | Issue making it playable                                       |
| ------------------------- | -------------------------------------------------------------- |
| Emrakul, the Promised End | #8446                                                          |
| Amulet of Vigor           | #8606                                                          |
| Summoner's Pact           | #8583                                                          |
| Goryo's Vengeance         | #8651 (Splice onto Arcane; cluster #8497 only holds the claim) |
| Past in Flames            | #8629                                                          |

Manamorphose is playable but the Bot ignores it today: issue #8450, with
issue #8177, makes it reachable before its pair can be written.
Issue #8394 tracks noise in the Thoughtseize entries that `Has` names.
