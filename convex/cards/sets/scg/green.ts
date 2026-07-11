// SCG (Scourge) — green cards, split by colour per ADR 0043. The registry's
// `import * as scg from "./sets/scg"` resolves here via scg/index.ts.
import type { CardDefinition } from "../../types";

// Xantid Swarm — "Flying. Whenever this creature attacks, defending player
// can't cast spells this turn." ({G}, 0/1 Insect.)
//
// The attack trigger uses the raw `ATTACKERS_DECLARED` + `matches` shape (proven
// by Mijae Djinn / Cave People) and a DSL `effects[]` body (ADR 0045): a single
// `restrictCasting` Op (issue #1057) that locks the defending player out of
// casting for the rest of the turn (CR 601.3a). `player: "opponent"` resolves to
// the defending player — in a 2-player game the one player who isn't the
// trigger's controller (the attacker), CR 102.2. The lock is a turn-scoped
// per-player flag (`state.cannotCastSpellsThisTurn`) enforced by the shared cast
// gate `castProhibitionReason` and cleared at CLEANUP (CR 514.2). Playing a land
// is unaffected — a land is not a spell and is not cast (CR 601 / 305).
export const xantidSwarm: CardDefinition = {
    id: "6a87911a-3931-46aa-9348-2728c4b73b96",
    name: "Xantid Swarm",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever this creature attacks, defending player can't cast spells this turn.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "xantid-swarm-attack-cast-lock",
            oracleText:
                "Whenever this creature attacks, defending player can't cast spells this turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            // CR 601.3a (issue #1057) — lock the defending player out of casting
            // spells for the rest of the turn. `player: "opponent"` = the
            // defending player (the non-controller in a 2-player game, CR 102.2).
            effects: [{ op: "restrictCasting", player: "opponent" }],
        },
    ],
};
