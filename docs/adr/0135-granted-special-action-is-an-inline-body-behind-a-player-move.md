# ADR 0135 — A Granted Special Action is an inline Effect Script body behind a repeatable, cost-gated player Move

**Status:** Accepted (2026-09-16, issue #2122). Extends ADR 0045 and mirrors
ADR 0048.

## Context

Some effects hand a player an action they may take later, "any time they could
cast an instant". The rules call taking it a special action:

- CR 116.2c: "Some effects allow a player to take an action at a later time
  … Doing so is a special action. A player can take such an action any time
  they have priority, unless that effect specifies another timing restriction,
  for as long as the effect allows it."
- CR 304.5: "any time they could cast an instant" means only that the player
  must have priority.

The first shipped consumer is Guardian Angel (LEA): "Until end of turn, you may
pay {1} any time you could cast an instant. If you do, prevent the next 1
damage that would be dealt to that permanent or player this turn." Its first
sentence ships as a `preventDamage` `next-n` Op; the second carried a
`DIVERGENCE (tracked-by: #2122)` marker, because the Effect Script vocabulary
had no surface for a standing, repeatable, paid option between priorities.

The neighbours do not fit. `mayPay` is one decision offered DURING a
resolution. `preventDamage` installs a shield now, once. The engine's special
actions (`play-land`, `summon-companion`, `turn-face-up` in
`SPECIAL_ACTION_MOVE_KINDS`) are each a bespoke affordance a card cannot
declare. The delayed trigger of ADR 0048 has exactly the right shape — an
inline body plus a payload frozen at resolution — except that what fires it is
an event, not a player's choice.

## Decision

1. **One generic Op, `grantSpecialAction`**, named after the mechanism —
   CR 116.2c — never after the card. Its fields: a mana `cost`, an inline
   `effects: EffectOp[]` body, a `duration` (end of turn is the only one
   shipped), and the same explicit `capture` map ADR 0048 gives
   `delayedTrigger`. At resolution the interpreter freezes the captures into a
   payload and appends one entry to `GameState.grantedSpecialActions`:
   `{ id, controller, cost, effects, payload, sourceCardId, oracleText }`.
   The controller is the resolving object's controller — the Oracle's "you".
   Guardian Angel becomes:

    ```jsonc
    {
        "op": "grantSpecialAction",
        "cost": { "generic": 1 },
        "duration": { "phase": "end-of-turn" },
        "capture": { "$it": { "target": 0 } },
        "effects": [
            {
                "op": "preventDamage",
                "mode": "next-n",
                "to": { "ref": "$it" },
                "amount": 1,
            },
        ],
    }
    ```

    Field spellings are illustrative; the implementation follows the existing
    `ManaCost`, duration and capture vocabularies.

2. **One Move, `take-granted-special-action { grantId }`**, a member of
   `SPECIAL_ACTION_MOVE_KINDS`, so it inherits the set's common consequences:
   no stack, the pass cycle resets, priority stays with the taker (CR 116.1).
   Legal whenever the grant's controller has priority and can pay the cost.
   Repeatable: taking it does not consume the grant. Payment is synchronous
   auto-tap in one mutation, as `summon-companion` and `turn-face-up` already
   pay — a fixed mana cost offers no choice to suspend on. The body runs
   through the interpreter with the payload as its initial bindings.
3. **Expiry is the duration, nothing else.** An end-of-turn grant is removed at
   cleanup. It is NOT withdrawn when a captured object leaves the battlefield:
   the rules give no such lapse, and a generic mechanism cannot tell whether a
   vanished reference makes its body useless. Paying for a shield on a
   creature that has died is legal and is left legal.
4. **The UI anchors the grant to the player, not an object.** The source is
   usually an instant already in a graveyard, and "the referent" is not a
   notion the generic body has. The projection carries a server-derived list
   (id, source name, cost, oracle text, whether it can be taken now); the
   controller's area renders one button per entry, labelled
   `<source name> {cost}`, in the companion button's style.
5. **The Bot enumerates the Move whenever it is legal and affordable**, and
   the search decides, as it does for `turn-face-up`. No body-shaped filter
   ("only when damage is incoming") enters move generation.
6. **Minimal shape.** Only mana costs, only the has-priority timing, only the
   end-of-turn duration. Timing restrictions (CR 116.2c's "unless that effect
   specifies another"), non-mana costs and other durations arrive with the
   consumer that needs them.

## Considered options

- **Generic grant with an inline body (chosen).** Reuses ADR 0048's
  body-plus-payload shape, already serializable and interpreted; costs about
  what a card-shaped option costs (a Move, state, UI, Bot) without binding the
  engine to one effect.
- **A prevention-specific "top up the shield" option.** Tied to prevention
  shields with a dedicated Move and no body. Rejected: named after one effect,
  rebuilt on the second consumer.
- **Auto-withdraw a grant whose captured permanent is gone.** Rejected: no
  CR basis, and it makes the generic mechanism predict what its body does.
- **Button on the captured referent.** Rejected for the same reason: the
  mechanism would have to know which binding is "the referent".
- **Enumerate only when damage is incoming.** Rejected: a prevention-shaped
  filter inside a generic move generator.

## Consequences

- `grantedSpecialActions` is an optional `GameState` field and joins the
  serialization key lists; the drift guard covers it.
- The Mechanics Registry gains the Op; it walks the ordinary new-Op
  registration sites and earns its permanent per-Op test.
- The Bot's `preventDamage` valuer prices a shield by amount and does not ask
  whether its recipient still exists, so a futile take is avoided by the
  search's state evaluation, proven by a discriminating blade pair — not by the
  valuer. Pruning the repeatable Move's branching, if a blade position ever
  shows it matters, is a separate change with the data in hand.
- Guardian Angel's divergence marker retires with the implementation.
