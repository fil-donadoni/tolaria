# Trigger-head gaps: how many cards does head vocabulary reach? (ADR 0182)

Measured at 38f3b0dd2 (2026-11-15).

## The question

ADR 0182 widens the trigger-head vocabulary to what the trigger factories
already accept, and asks the grammar to follow with one subject sub-grammar
shared by every head verb. The grill asked what that buys on the corpus: on
how many cards does a trigger line stop failing on its head, and how many
become `ready`?

## Method

Three throwaway scripts under `docs/research/scripts/trigger-head-gaps/`, run
from the repository root. None is a gate; none is imported by code.

| script          | what it does                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `dump-gaps.mjs` | compiles the whole corpus and writes every gap of every `unparsed` card with its attribution            |
| `body-test.mjs` | for each gap attributed to a trigger head, compiles the line alone, the head alone, and the body alone  |
| `families.py`   | groups the head gaps into phrase families, tiers them, and counts lines and cards per tier and per rank |

A **family** is the event phrase left after the subject is peeled off ("a land
you control" + "enters"), normalised by regex. A family's **tier** is a hand
list in `families.py`.

The three counts per intervention:

- **head read** — cards with at least one head gap in the supported families;
- **line closed** — cards where such a line's body also compiles;
- **ready** — cards whose EVERY gap is such a line.

The body is tested behind a stand-in head the grammar reads (any of a dozen
may carry it), so "line closed" and "ready" are upper bounds.

## Result 1 — the universe

Corpus: 35,353 cards; `ready` 8,686, `quarantine` 185, `unparsed` 26,482, with
34,247 gap lines.

| gap attributed to                | lines | cards |
| -------------------------------- | ----- | ----- |
| static clause                    | 7,662 | 6,789 |
| spell effect clause              | 5,875 | 5,422 |
| **trigger head**                 | 5,592 | 5,316 |
| triggered effect clause          | 5,356 | 5,144 |
| activated effect clause          | 3,702 | 3,339 |
| no attribution                   | 1,823 | 1,769 |
| keyword line                     | 1,426 | 1,418 |
| activation cost (activated slot) | 927   | 885   |
| trigger condition                | 894   | 855   |

5,316 cards is the ceiling of any work on trigger heads. The attribution
holds: 5,589 of the 5,592 lines reproduce on a one-line synthetic card, and the
head alone compiles for 3 of them.

## Result 2 — what each intervention reaches

| intervention                                               | lines | head read | line closed | ready | ready, Modern-legal |
| ---------------------------------------------------------- | ----- | --------- | ----------- | ----- | ------------------- |
| scope / filter on a head kind that exists                  | 2,141 | 2,083     | 909         | 543   | 448                 |
| the above + events with a factory and no kind, phase forms | 2,538 | 2,464     | 1,005       | 599   | 487                 |
| the 25 largest families, any tier                          | 2,578 | 2,518     | 1,081       | 679   | 539                 |
| the 50 largest                                             | 3,082 | 3,008     | 1,294       | 805   | 637                 |
| the 100 largest                                            | 3,629 | 3,525     | 1,500       | 929   | 735                 |
| all 1,359 families                                         | 5,592 | 5,316     | 2,243       | 1,318 | 990                 |

Of the 543 cards of the first row, 464 have a body with no back-reference to
the trigger's subject ("that creature", "it"), where the stand-in cannot
flatter the result.

The tail is long: the ten largest families hold 36% of the lines, and past the
hundredth each family is worth under eight lines.

The body is the brake: it compiles for 2,286 of the 5,592 lines (41%).

## Result 3 — the largest families

| event phrase                                 | lines | body compiles | tier                |
| -------------------------------------------- | ----- | ------------- | ------------------- |
| enters                                       | 738   | 363           | kind exists         |
| attacks                                      | 271   | 61            | kind exists         |
| casts a _filter_ spell                       | 211   | 133           | kind exists         |
| dies                                         | 203   | 89            | kind exists         |
| deals combat damage to a player              | 201   | 73            | kind exists         |
| enters the battlefield                       | 93    | 12            | kind exists         |
| gains life                                   | 86    | 43            | new                 |
| becomes blocked                              | 82    | 37            | new                 |
| draws your second card each turn             | 64    | 44            | new                 |
| attacks or blocks                            | 62    | 10            | kind exists         |
| draws a card                                 | 60    | 37            | factory, no grammar |
| attacks alone                                | 48    | 20            | new                 |
| is put into a graveyard from the battlefield | 47    | 26            | kind exists         |
| casts a spell that targets this creature     | 46    | 37            | new                 |
| blocks                                       | 39    | 20            | new                 |

The largest single phrase is "Whenever a land you control enters" (191 lines):
the grammar reads "another creature you control enters" and not this.

Subjects of the first tier's 2,141 lines: one object with a filter 830, a
player 391, the source itself 353, the host 223, "this or another" 215, "one or
more" 129.

## Limits

- "Ready" is an upper bound: stand-in body test, no quarantine check, no Bot
  reachability check.
- Families and tiers are regexes and a hand list. "Whenever you attack" (106
  lines) sits in the first tier and may need batch support the `attacks` kind
  does not have; "one or more … deal combat damage" likewise.
- A first pass in the grill reported 845 lines and 116 cards for the first
  row. It dropped every line behind an ability word ("Landfall — Whenever…")
  and fed the body a literal `{self}` the compiler does not read. Those figures
  are superseded by this note.
- Figures move with the grammar; re-run before quoting.
