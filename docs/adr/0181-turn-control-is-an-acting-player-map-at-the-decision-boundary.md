# Turn Control is an Acting Player map at the decision boundary

## Status

accepted (2026-11-13, issue #8446). Amends ADR 0037: the "general one player
controls another subsystem" it rejected for lack of a second card is now built,
and the Acting Player it introduced for one cast is widened to a turn.

## Context

Emrakul, the Promised End — a four-of in a `modern-metagame` archetype — reads
"you gain control of target opponent during that player's next turn. After that
turn, that player takes an extra turn." CR 723 (printed with `bun run cr 723`)
is the rule:

- **723.1** the effect applies to the next turn the affected player _actually
  takes_ (723.1b: a skipped turn does not consume it) and lasts the entire
  turn, until the beginning of the next one. **723.1a** effects on the same
  player overwrite each other; the last one created works.
- **723.3** only control of the _player_ changes: objects keep their
  controllers, the controlled player is still the active player.
- **723.4** game information visible to the controlled player is visible to
  both players (the hand, face-down permanents); information about cards
  outside the game stays the controlled player's alone.
- **723.5** the controller makes every choice and decision the controlled
  player is allowed or told to make; **723.5a** paying only with the
  controlled player's resources; **723.5b** never a decision the rules or an
  object did not call for.
- **723.6** the controller cannot make the controlled player concede; that
  player may still concede. **723.8** the controller keeps making their own
  decisions. **723.9** a player may be given control of themselves.

Three facts about the engine decide the shape.

1. **The rules engine already answers every question in seat terms.** A cast,
   a priority pass, a block and a Pending Choice all take the seat the rules
   name (`players[].id`), read that seat's zones and mana, and are gated by
   the Expected Input (ADR 0047), which names that seat. CR 723.3 and 723.5a
   say that is exactly what must NOT change.
2. **Who is allowed to submit for a seat lives outside the engine.** Every
   gameplay mutation takes a client-supplied `playerId` and opens with a
   seat-ownership check (`assertCallerOwnsSeat`); the client acts as its
   viewer seat, which in Solo Mode already follows whoever owes input
   (`computeSoloViewerId`); the vs-AI driver and the server Bot deadline wake
   on `gameTicks.owedPlayerIds`.
3. **ADR 0037's Acting Player is per-cast and rewrites the prompt.** Word of
   Command's routed choices carry the acting player in `playerId` and the
   controlled one in `actingPlayerId`. That works because everything Word of
   Command controls is a Pending Choice. A turn is not: priority, attackers
   and blockers have no prompt record to rewrite.

## Decision

**Turn Control is state the engine keeps and a map the boundary applies. The
rules keep reading the seat; every surface that asks "who answers?" asks one
function.**

### State

`GameState.turnControls?: TurnControl[]`, persisted
(`PERSISTED_OPTIONAL_KEYS`), at most one PENDING and one ACTIVE entry per
controlled seat:

```ts
type TurnControl = {
    controlledId: string; // the affected player (CR 723.1)
    controllerId: string; // who decides for them (CR 723.5)
    active?: true; // absent = waiting for that player's next turn
};
```

`advanceTurn` (`phases.ts`, the one turn boundary) owns the lifecycle:

- on entry — the beginning of the next turn — every ACTIVE entry ends
  (CR 723.1);
- once a player actually takes the turn (after the CR 614.10 skip recursion,
  so a skipped turn consumes nothing, CR 723.1b), that player's pending entry
  becomes active.

Creation overwrites a pending entry for the same seat (CR 723.1a). It never
touches an ACTIVE one: an effect created during a controlled turn names that
player's _next_ turn, which is a different turn.

### The map

`convex/gre/turnControl.ts`, pure:

- `actingPlayerFor(state, seatId)` — the controller while an entry for the
  seat is active, else the seat itself (CR 723.9 falls out: self-control is
  the identity).
- `seatsActedBy(state, playerId)` — the inverse: the player's own seat unless
  another player controls it, plus every seat they actively control
  (CR 723.8).
- `actedSeatFor(state, playerId)` — the owed seat that player must answer for
  right now, or null.

Nothing in the rules calls them. They are read at five boundaries:

| Boundary                                                             | Reads                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owed players** (`computeOwedPlayerIds`)                            | maps each owed seat to its Acting Player. `gameTicks.owedPlayerIds`, the vs-AI driver, the Bot server deadline and the Match Clock all follow: they wake, time and charge the player who is actually deciding.                                          |
| **Authority** (`assertCallerActsForSeat`, `convex/seatAuthority.ts`) | a caller may submit as seat S iff they own S's Acting Player. One rule: it lets the controller name the controlled seat, refuses the controlled user their own, and leaves Solo Mode untouched (the user owns both). Read off `gameTicks.turnControls`. |
| **Viewer** (`computeViewerSeat`, `convex/soloViewer.ts`)             | a player's view follows the owed seat when they act for it; server projection and client board share the selector, as they already do in Solo Mode.                                                                                                     |
| **Projection** (`projectPublicState`)                                | hidden information of a seat is shown to its Acting Player too (CR 723.4): hand, face-down identity, known library cards. Outside-the-game cards are not.                                                                                               |
| **Phase Stops** (`gre/autoPass.ts`)                                  | a controlled seat's windows are skipped by the Acting Player's preferences, never by the controlled user's: an auto-pass is a decision (CR 723.5).                                                                                                      |

The Expected Input keeps naming the seat, and so does the gate. Concede and
forfeit keep the plain ownership check (CR 723.6): the controller cannot name
the controlled seat there, and the controlled user still can. Phase Stop
preferences stay each user's own (CR 723.5b).

### Creating it

A new Op, `controlNextTurn { player }`, over a `SpellContext` primitive of the
same name: the spell's or ability's controller gains control of the referenced
player's next turn.

The second clause is not part of control — an overwritten control still leaves
"that turn" to be taken — so it is its own state:
`extraTurn { player, after: "their-next-turn" }` schedules an entry in
`GameState.scheduledExtraTurns`, armed when that player actually takes a turn
and pushed onto the `extraTurns` queue when that turn ends (CR 500.7: "directly
after the specified turn").

### The Bot

- **Controlled** (a human controls the Bot's turn): `owedPlayerIds` stops
  naming the Bot, so the driver and the server deadline stay silent; the human
  board follows the Bot's seat.
- **Controlling**: `owedPlayerIds` names the Bot for the human seat's windows.
  The driver builds its view for `actedSeatFor`, and the move comes from
  `controlledSeatPick` (`convex/gre/search.ts`): the controlled
  seat's legal moves, each scored one ply ahead from the BOT's side, the best
  for the Bot taken. The liveness ladder and the server's forced advance act
  on the same seat; the terminal concede stays the Bot's own (CR 723.6).

The ISMCTS tree is not taught the map. The rollout policy is
(`selectRolloutMove`: a mover's interest is its Acting Player's — which is the
whole of `controlledSeatPick`), but a controlled seat's node INSIDE a tree
still stores its statistics as an opponent's. So the search undervalues a
control effect the Bot is about to create: it plays a controlled turn well and
does not yet go looking for one. Nothing changes on a board with no Turn
Control, where the map is the identity.

## Considered options

- **Rewrite the prompted player in the engine, as ADR 0037 does.** Rejected:
  it works only where a prompt record exists. Priority, attack and block
  declaration would each need a second "really decided by" field, and every
  rules read of `priorityPlayerId` would have to pick the right one — the
  missed-site risk ADR 0037 accepted for one cast, multiplied by every window
  of a turn.
- **Make the Expected Input name the Acting Player.** Rejected: the gate
  compares it with the seat a mutation executes as, and that seat must stay
  the controlled one (CR 723.5a). Two ids on every variant, for a fact that is
  a function of the state.
- **Read Turn Control from the fat state in the authority check.** Rejected on
  cost: the check runs before the state load on every gameplay action; the
  tick row is ~200 bytes and already rewritten on every save.
- **Teach the search tree the map.** Deferred, not rejected: `search.ts`
  compares the mover with the Bot at 26 sites that mean two different things
  (whose interest, whose resources). Separating them is a Bot change with its
  own Verdicts, not a rider on a rules mechanic.

## Consequences

- A second player-control card is data: the Op, and for a limited duration
  (CR 723.2, Opposition Agent) a second way to end an entry.
- A new surface asking "who answers for this seat?" must read the map; one
  asking "whose object, whose mana, whose turn?" must not. The two questions
  were one before this record.
- Word of Command keeps ADR 0037's per-cast routing. The two compose: a
  routed choice's `playerId` is a seat like any other and is mapped in turn.
- `gameTicks` gains `turnControls` (active entries only): one more optional
  field on the row every gameplay mutation now reads before its state.
- In a 2-player game the controlled user watches their own seat with every
  affordance locked; conceding stays available.
- A vs-AI game has one user behind both seats, so the server cannot tell the
  human from the Bot: there the controlled side is held off by its own client
  — the board's lock for the human, `actedSeatFor` for the Bot driver — and
  by nothing else. Authority protects a player from ANOTHER user.
- A controller answers the controlled player's outside-the-game pick (a Wish)
  without seeing the candidates (CR 723.4): the projection gates those on the
  player asking, never on the seat they view.
