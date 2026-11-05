# Vintage Cube — the Bot's level-2 cards

The owner-reviewed list behind PRD issue #4602: the cube-defining cards the Bot
must play right, not merely reach. Issue #8271 turns each row into `must` Test
Positions under the blade.

**Each row is a pair.** The risk with these cards is the Bot using them
backwards, so a row owes the position where the card is right AND the position
where the same card is wrong: a discriminating pair (`/bot-change`). A position
may test one right play with a combo card, never a multi-turn plan: that is
level 3, out of this bar.

Fix the class, never the card (ADR 0102). A blunder is a Verdict, not a root
rule (ADR 0124).

`Has` names an existing `must` entry that already pins the row's right play.
Such a row still owes its missing half. Everything else is new.

## Fast mana and Power

| Card               | Right                                                      | Wrong: must not                                      | Has |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------- | --- |
| Black Lotus        | three mana enable the threat in hand: sacrifice it now     | sacrifice it with nothing to cast                    |     |
| Mana Crypt         | in the opening hand: cast it first                         | hold it while a slower play goes first               |     |
| Sol Ring           | two 1-mana plays available: Sol Ring first                 | play the other one first                             |     |
| Mana Vault         | a big play it pays for this turn: cast and tap it          | tap it with nothing to spend on, and take the damage |     |
| Lion's Eye Diamond | hand empty or the discard pays off: crack it for the spell | crack it with a full hand of live cards              |     |
| Mox Diamond        | a spare land in hand: discard it for the Mox               | discard the only land                                |     |
| Fastbond           | extra lands in hand and life to spare: play them all       | play extra lands at lethal life, for no use          |     |
| Time Walk          | attackers that close in two swings: take the extra turn    | cast it with no board and no use for the turn        |     |
| Tinker             | a poor artifact in play: sacrifice it for the strongest    | sacrifice the strongest artifact for a weaker one    | yes |

## Reanimator

| Card                | Right                                                         | Wrong: must not                                           | Has |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------- | --- |
| Animate Dead        | a fatty in any graveyard: the best target, the opponent's too | a weak target with a better one available                 |     |
| Reanimate           | low life: the target that does not kill it                    | pay its own life to lethal                                |     |
| Entomb              | a reanimation plan in hand: bin the best target               | bin a card with no way to use it                          |     |
| Recurring Nightmare | a poor creature in play, a fatty in the yard: swap them       | swap a strong creature for a weaker one                   |     |
| Show and Tell       | Griselbrand in hand: cast it and put the fatty in             | cast it with nothing to put in, helping only the opponent |     |
| Sneak Attack        | a fatty in hand: activate at combat, attack                   | activate outside combat, losing the creature for nothing  |     |

## Control and interaction

| Card                 | Right                                                          | Wrong: must not                                           | Has |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | --- |
| Balance              | behind on the board: cast it                                   | cast it while ahead                                       | yes |
| Swords to Plowshares | two opposing creatures: exile the greater threat               | exile its own creature, or the lesser threat              |     |
| Toxic Deluge         | pay the least X that sweeps without dying                      | pay more than the sweep needs, or to lethal               |     |
| Force of Will        | a lethal spell on the stack, no mana: pay the alternative cost | pitch a card to counter an irrelevant spell               |     |
| Mana Drain           | counter a big spell, spend the mana next main phase            | counter a cheap spell with no use for the mana            |     |
| Mind Twist           | opponent's hand is full: X as high as it can                   | cast it for less with more mana open, or at an empty hand |     |
| Thoughtseize         | known hand: take the card that beats the Bot                   | take a land-light card over the real threat               |     |
| Upheaval             | ahead on mana after a replay, or losing the board: cast it     | cast it while winning on board with nothing to float      |     |

## Refilling the hand

| Card             | Right                                  | Wrong: must not                   | Has |
| ---------------- | -------------------------------------- | --------------------------------- | --- |
| Wheel of Fortune | empty hand against a full one: cast it | cast it holding its best cards    | yes |
| Timetwister      | same, with a full graveyard: cast it   | cast it holding a full, good hand |     |

## Planeswalkers

| Card                    | Right                                                  | Wrong: must not                                | Has |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------- | --- |
| Jace, the Mind Sculptor | a dangerous attacker: -1 to bounce it; else brainstorm | ignore the attacker that kills him             |     |
| Oko, Thief of Crowns    | an opposing threat: +1 makes it a 3/3                  | turn its own best creature into an Elk         |     |
| Liliana of the Veil     | the opponent's only creature: -2                       | -2 into an army, or +1 discarding its own plan | yes |
| Wrenn and Six           | a Strip Mine or fetch land in the yard: +1 returns it  | -1 with no target worth it                     |     |
| Teferi, Time Raveler    | the most dangerous permanent: -3 on it                 | -3 on its own permanent                        |     |
| The One Ring            | under pressure: cast it for protection                 | cast it with mana better spent, at no risk     |     |

## Aggro and equipment

| Card                     | Right                                                   | Wrong: must not                        | Has |
| ------------------------ | ------------------------------------------------------- | -------------------------------------- | --- |
| Ragavan, Nimble Pilferer | an empty opposing board: attack                         | attack into a blocker that eats it     |     |
| Umezawa's Jitte          | equip, spend counters to win the combat                 | keep counters and lose the creature    |     |
| Skullclamp               | a 1-toughness creature: equip and draw                  | equip a creature it merely weakens     |     |
| Smuggler's Copter        | a spare creature: crew and attack, loot                 | crew with the only attacker worth more |     |
| Goblin Bombardment       | a creature about to die anyway: sacrifice it for damage | sacrifice attackers with no gain       |     |

## Storm and combo

| Card               | Right                                                 | Wrong: must not                                           | Has |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------- | --- |
| Tendrils of Agony  | storm count is lethal: cast it                        | fire it early for a little life                           |     |
| Yawgmoth's Will    | a full graveyard: cast it, then replay                | cast it with an empty graveyard                           |     |
| Underworld Breach  | a graveyard that pays escape: cast it and escape      | cast it with nothing to escape, then die to the sacrifice |     |
| Bolas's Citadel    | life to spare, a live top card: play from the top     | pay life down to lethal                                   |     |
| Dark Ritual        | it enables a spell this turn: cast it                 | cast it with nothing to spend on                          | yes |
| Thassa's Oracle    | the alternate win is on: cast it                      | cast it when the devotion check fails                     | yes |
| Flash              | a fatty in hand: cast it for the enter effect         | cast it for a body it cannot pay or use                   | yes |
| Oath of Druids     | the opponent has more creatures: cast it              | cast it when it feeds only the opponent                   |     |
| Natural Order      | a poor green creature: sacrifice it for the strongest | sacrifice a stronger creature for a weaker one            |     |
| Green Sun's Zenith | the X that finds the creature it needs                | spend more X than the find needs                          |     |
| Walking Ballista   | shoot to close the game                               | shoot off counters with no gain                           | yes |

## Lands

| Card                  | Right                                      | Wrong: must not                    | Has |
| --------------------- | ------------------------------------------ | ---------------------------------- | --- |
| Library of Alexandria | exactly seven cards: draw rather than mana | tap for mana with a card to draw   |     |
| Strip Mine            | the opponent has Library: destroy it       | strip a basic with Library in play | yes |
