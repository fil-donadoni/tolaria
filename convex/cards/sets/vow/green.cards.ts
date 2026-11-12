// vow — green cards (ADR 0043 colour split).
import { defineCard, EFFECT_AFFECTS_SELF } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Cultivator Colossus — {4}{G}{G}{G} Creature — Plant Beast */*. "Trample.
// Cultivator Colossus's power and toughness are each equal to the number of
// lands you control. When this creature enters, you may put a land card from
// your hand onto the battlefield tapped. If you do, draw a card and repeat
// this process." (CR 604.3 characteristic-defining P/T, CR 702.19 trample,
// CR 400.7 hand → battlefield, CR 121.1 draw.)
//
// protocol card: the ETB is an UNBOUNDED conditional repeat — each pass is a
// may-choose, a zone move and a draw, and it stops at the first declined
// choice or when no land is left in hand. The Effect Script DSL freezes four
// constructs (bind / ref / if / forEach, ADR 0045) and none is a loop, so the
// loop is the imperative part; the steps are existing primitives. Resolution
// re-runs from the top on every resume, so a finished pass is marked with
// `noteChoice` and skipped on replay (the Lim-Dûl's Vault shape).
// hand-tail: Cultivator Colossus's power and toughness are each equal to the number of lands you control. (#8611)
export const cultivatorColossus = defineCard(() => ({
    id: "62dffe04-c431-440d-a8da-33c74b4bb683",
    rarity: "mythic",
    name: "Cultivator Colossus",
    oracleText:
        "Trample\nCultivator Colossus's power and toughness are each equal to the number of lands you control.\nWhen this creature enters, you may put a land card from your hand onto the battlefield tapped. If you do, draw a card and repeat this process.",
    manaCost: { X: 4, G: 3 },
    types: ["Creature"],
    subtypes: ["Plant", "Beast"],
    power: 0,
    toughness: 0,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let lands = 0;
                for (const player of state.players) {
                    for (const card of player.battlefield) {
                        if (
                            card.controllerId === source.controllerId &&
                            card.types.includes("Land")
                        ) {
                            lands++;
                        }
                    }
                }
                return { power: lands, toughness: lands };
            },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "cultivator-colossus-land-loop",
            oracleText:
                "When this creature enters, you may put a land card from your hand onto the battlefield tapped. If you do, draw a card and repeat this process.",
            scope: "self",
            resolve: (ctx) => {
                const me = ctx.controller;
                for (let i = 0; ; i++) {
                    // Pass already carried out before an earlier suspension.
                    if (ctx.recallChoice(`cultivator-colossus-done-${i}`))
                        continue;
                    const candidateIds = ctx
                        .getHandCards(me)
                        .filter((c) => c.types.includes("Land"))
                        .map((c) => c.id);
                    if (candidateIds.length === 0) return;
                    const picks = ctx.requestChoice({
                        playerId: me,
                        choiceId: `cultivator-colossus-land-${i}`,
                        kind: "choose-hand-card",
                        zone: "hand",
                        candidateIds,
                        // "You may" (CR 608.2d) — an optional 0-or-1 pick.
                        count: { min: 0, max: 1 },
                        prompt: "You may put a land card from your hand onto the battlefield tapped.",
                    });
                    if (picks === undefined) return; // suspended
                    const id = picks[0];
                    if (!id) return; // declined: the process ends
                    if (!ctx.putFromHandOntoBattlefield(me, id)) return;
                    ctx.tap({ type: "permanent", id });
                    ctx.drawCards(me, 1);
                    ctx.noteChoice(`cultivator-colossus-done-${i}`, ["yes"]);
                }
            },
        }),
    ],
}));
