// backupTrigger — CR 702.165 Backup N.
//
// 702.165a: "Backup N" means "When this creature enters, put N +1/+1
//           counters on target creature. If that's another creature, it
//           also gains the non-backup abilities of this creature printed
//           below this one until end of turn."
// 702.165c: only abilities printed ON THE OBJECT WITH BACKUP are granted by
//           its backup ability.
// 702.165d: the abilities a backup ability grants are determined AS THE
//           ABILITY IS PUT ON THE STACK — they don't change if the source
//           later loses an ability before this resolves. (Not modeled here:
//           the engine snapshots nothing extra because `abilities` is a
//           closed list baked into the trigger at card-definition time, the
//           same "printed" list CR 702.165c already restricts to — a source
//           losing a keyword between trigger and resolution is the same
//           unmodeled edge every other static-ability-driven grant in this
//           engine shares, not a Backup-specific gap.)
//
// Modeled as a keyword→triggered-ability factory (ADR 0002), mirroring
// `rampageTrigger`'s shape: the card carries the parametric keyword
// `"backup N"` in `staticAbilities[]` (board-visible reminder data) and a
// matching `backupTrigger(N, grantedAbilities)` in `triggeredAbilities[]`, so
// no per-card trigger code is written. `grantedAbilities` is the card's OWN
// printed ability list below the Backup line (CR 702.165c) — the exact
// keyword strings the card ALSO carries in its own `staticAbilities[]`
// (Consuming Aetherborn: `["backup 1", "lifelink"]`, backupTrigger(1,
// ["lifelink"])) — so the grant, when it fires, is provably a SUBSET of what
// the source itself has.
//
// A fully DSL-first ability (ADR 0045): the ETB target-and-counter half rides
// the existing targeted-ETB-trigger foundation (`enteredTrigger` +
// `targetRequirement`, CR 603.3d / issue #1193, the Flametongue Kavu
// precedent), the counter placement is the existing `counters` Op (CR 122,
// issue #841), and the conditional grant is the existing `grantAbility` Op
// (CR 611.1b / 613.1f, issue #843) gated by the ONE new predicate this
// ability introduces: `targetIsAnother` (issue #1315) — an object-identity
// comparison ("if that's ANOTHER creature") the existing numeric/boolean
// predicate grammar had no shape for. No new Op.
import type { TriggeredAbility } from "../../types";
import { enteredTrigger } from "./enteredTrigger";

/** Spells out 1/2 the way real Backup reminder text does ("a +1/+1 counter",
 *  "two +1/+1 counters") — every printed Backup N card uses N ∈ {1, 2} today.
 *  Falls back to the digit for any larger N (still grammatically valid, just
 *  not the exact wording a hypothetical "Backup 3" would print). */
function counterPhrase(n: number): string {
    if (n === 1) return "a +1/+1 counter";
    if (n === 2) return "two +1/+1 counters";
    return `${n} +1/+1 counters`;
}

/** Builds the Backup N triggered ability (CR 702.165) for a value of `n` and
 *  the card's own printed ability list below the Backup line. */
export function backupTrigger(
    n: number,
    grantedAbilities: string[]
): TriggeredAbility {
    const abilityWord = grantedAbilities.length === 1 ? "ability" : "abilities";
    const oracleText = `Backup ${n} (When this creature enters, put ${counterPhrase(n)} on target creature. If that's another creature, it gains the following ${abilityWord} until end of turn.)`;

    return enteredTrigger({
        id: `backup-${n}`,
        oracleText,
        scope: "self",
        // CR 702.165a — "target creature" (any creature, either battlefield,
        // no restriction beyond the creature type).
        targetRequirement: { type: "Creature", count: 1 },
        effects: [
            // CR 702.165a — "put N +1/+1 counters on target creature".
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { target: 0 },
                count: n,
            },
            // CR 702.165a/c — "If that's another creature, it gains the
            // [printed] abilities … until end of turn." Gated by the new
            // targetIsAnother predicate (issue #1315): false on a self-target
            // (no grant — the source doesn't gain its own abilities a second
            // time) or a target that left the battlefield before this
            // resolves (CR 608.2b).
            {
                op: "if",
                predicate: { targetIsAnother: { target: 0 } },
                then: grantedAbilities.map((ability) => ({
                    op: "grantAbility" as const,
                    target: { target: 0 },
                    ability,
                    duration: { phase: "end-of-turn" as const },
                })),
            },
        ],
    });
}
