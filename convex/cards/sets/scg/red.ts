// SCG (Scourge) — red cards, split by colour per ADR 0043. The registry's
// `import * as scg from "./sets/scg"` resolves here via scg/index.ts.
import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Sulfuric Vortex — "At the beginning of each player's upkeep, this enchantment
// deals 2 damage to that player. If a player would gain life, that player gains
// no life instead."
//
// Two independent continuous pieces:
//
//   1. Each-player upkeep ping (CR 603.6a). A `phaseTrigger` on UPKEEP with
//      `scope: "each"` fires on EVERY player's upkeep and hands the resolve
//      body `scopedPlayerId` = that upkeep's active player (the "that player"
//      of the oracle). The trigger stays imperative because `effects[]` (the
//      DSL form) is only valid for `scope: "your"` triggers, where the scoped
//      player equals the controller (phaseTrigger.ts contract, ADR 0045); an
//      `each`-scoped trigger's scoped player differs from the controller, so
//      it must use `resolve`. Precedent: several DRK `each`-upkeep triggers
//      deal to the scoped player via `dealDamage({ type: "player", id:
//      scopedPlayerId }, N)`.
//
//   2. Life-gain lock (CR 614 — replacement effect / CR 118.6). Modern oracle
//      "If a player would gain life, that player gains no life instead" is a
//      lifegain replacement that consumes the event for ALL players while the
//      enchantment is on the battlefield. `gainLifeEmitting` (state.ts) routes
//      every life-gain path (the `gainLife` primitive AND lifelink, CR 119.3)
//      through `applyLifeChangeReplacements`, so a single `eventKind:
//      "lifegain"` replacement that returns `{ kind: "consumed" }` blocks all
//      of them and is automatically lifted when the source leaves play.
//      Precedent: LEA Lich (per-controller lifegain replacement).
export const sulfuricVortex: CardDefinition = {
    id: "79955e27-eef7-43bd-9895-e9209ed1537f",
    name: "Sulfuric Vortex",
    rarity: "rare",
    oracleText:
        "At the beginning of each player's upkeep, this enchantment deals 2 damage to that player.\nIf a player would gain life, that player gains no life instead.",
    manaCost: { X: 1, R: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "sulfuric-vortex-upkeep-ping",
            oracleText:
                "At the beginning of each player's upkeep, this enchantment deals 2 damage to that player.",
            phase: "UPKEEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045): an `each`-scoped phaseTrigger
            // (scoped player ≠ controller, so `effects` is disallowed). Deals
            // to the upkeep's active player via the standard permanent-source
            // player-damage path.
            resolve: (ctx, _event, scopedPlayerId) => {
                ctx.dealDamage({ type: "player", id: scopedPlayerId }, 2);
            },
        }),
    ],
    replacementEffects: [
        {
            id: "sulfuric-vortex-no-lifegain",
            oracleText:
                "If a player would gain life, that player gains no life instead.",
            eventKind: "lifegain",
            // Applies to ANY player's life gain (CR 118.6 — the enchantment
            // affects every player, not just its controller).
            appliesTo: (event) => event.kind === "lifegain",
            replace: () => ({ kind: "consumed" }),
        },
    ],
};
