// CR 702.132 — Assist. "If the total cost to cast a spell with assist includes a
// generic mana component, before you activate mana abilities while casting it,
// you may choose another player. That player has a chance to activate mana
// abilities. Once that player chooses not to activate any more mana abilities,
// you have a chance to activate mana abilities. Before you begin to pay the total
// cost of the spell, the player you chose may pay for any amount of the generic
// mana in the spell's total cost."
//
// The only cost step answered by someone other than the payer, so it is two
// mechanisms taking turns on `PendingCast.assistChoice`:
//
//  - the CASTER's steps (`choose-player`, `caster-mana`) are a payment park
//    (`owedPayment.ts`): the caster holds priority throughout, as for any other
//    cost pick, and `tapForPayment` is how they activate mana abilities;
//  - the ASSISTANT's steps (`assistant-mana`, `assistant-pay`) are `number-pick`
//    choices with `paysMana`, which is what gives a player who does not hold
//    priority the mana window of CR 605.3a (`isManaPaymentChoiceWindow`) and
//    routes the prompt to their seat through the Expected Input.
//
// One declared deviation, on the commit gate's park order (`nextOwedPayment`):
// the assistant is offered the generic that convoke, delve or improvise picks
// left, not the whole total cost. Nothing printed carries both keywords.
//
// Nothing is spent until the cast commits: the assistant's amount comes off
// `PendingCast.manaCost` and is drawn from their pool by `commitCast`, alongside
// the caster's payment (CR 601.2h). Cancelling therefore has only taps to undo.

import { tryGetDefinition } from "../cards/index";
import {
    getPlayer,
    spellRestrictionSubject,
    spendableManaForAssist,
} from "./state";
import type {
    AssistChoice,
    AssistPaymentWindow,
    CardInstanceState,
    GameState,
    PendingCast,
    PendingChoice,
} from "./state/declarations";

/** CR 702.132 — true iff the spell being cast declares Assist. */
export function spellHasAssist(card: CardInstanceState): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return false;
    return (
        tryGetDefinition(cardId)?.staticAbilities?.includes("assist") ?? false
    );
}

/** CR 702.132a — the Assist park for a cast about to be announced, or undefined
 *  when the keyword offers nothing: no generic component in the total cost, or
 *  no other player to name. `manaCost` is the locked-in total cost (CR 601.2f). */
export function buildAssistChoice(
    state: GameState,
    casterId: string,
    card: CardInstanceState,
    manaCost: Record<string, number>
): AssistChoice | undefined {
    if (!spellHasAssist(card) || (manaCost.X ?? 0) <= 0) return undefined;
    const candidateIds = state.players
        .map((p) => p.id)
        .filter((id) => id !== casterId);
    if (candidateIds.length === 0) return undefined;
    const def = tryGetDefinition((card.card as { id: string }).id);
    return {
        stage: "choose-player",
        candidateIds,
        spell: {
            spellCardId: card.id,
            spellName: def?.name ?? "this spell",
            spellTypes: [...(def?.types ?? [])],
            spellSupertypes: [...(def?.supertypes ?? [])],
            ...(def
                ? {
                      spellColors: [...spellRestrictionSubject(def).colors],
                      spellSubtypes: [...(def.subtypes ?? [])],
                  }
                : {}),
        },
    };
}

function assistOnCast(state: GameState): {
    pc: PendingCast;
    assist: AssistChoice;
} {
    const pc = state.pendingCast;
    if (!pc) throw new Error("No spell being cast");
    if (!pc.assistChoice) throw new Error("This spell has no assist");
    return { pc, assist: pc.assistChoice };
}

/** Puts the assistant's next step at the head of the queue. `numberMax` caps the
 *  nomination: 0 for the mana step, whose only answer is "no more mana abilities",
 *  and the spell's remaining generic for the payment step. */
function raiseAssistantWindow(
    state: GameState,
    assist: AssistChoice,
    assistantId: string,
    stage: AssistPaymentWindow["stage"],
    numberMax: number,
    prompt: string
): void {
    const {
        spellCardId,
        spellTypes,
        spellSupertypes,
        spellColors,
        spellSubtypes,
    } = assist.spell;
    const entry: PendingChoice = {
        stackItemId: "",
        step: 0,
        choiceId: `assist:${stage}`,
        playerId: assistantId,
        kind: "number-pick",
        count: 1,
        prompt,
        numberMax,
        paysMana: true,
        assistPayment: {
            stage,
            spellCardId,
            spellTypes,
            spellSupertypes,
            spellColors,
            spellSubtypes,
        },
    };
    state.pendingChoices = [...(state.pendingChoices ?? []), entry];
}

/** CR 702.132a — "you may choose another player". Pure: the caller attempts the
 *  commit afterwards, since declining can leave the cost already covered. */
export function recordAssistPlayerChoice(
    state: GameState,
    playerId: string,
    assistantId: string | undefined
): void {
    const { pc, assist } = assistOnCast(state);
    if (pc.playerId !== playerId) throw new Error("Not your pending cast");
    if (assist.stage !== "choose-player") {
        throw new Error("Assist player already chosen");
    }
    if (assistantId === undefined) {
        assist.stage = "settled";
        return;
    }
    if (!assist.candidateIds.includes(assistantId)) {
        throw new Error("Choose another player in the game");
    }
    assist.assistantId = assistantId;
    assist.stage = "assistant-mana";
    raiseAssistantWindow(
        state,
        assist,
        assistantId,
        "mana",
        0,
        `Assist ${assist.spell.spellName}: activate any mana abilities you want to pay with, then continue.`
    );
}

/** CR 702.132a — the choice comes "before you activate mana abilities", so a
 *  caster who activates one, or starts paying, without having named anyone has
 *  named no one. Called by every mutation that spends or makes mana for the cast. */
export function closeAssistChoiceOnCasterMana(
    state: GameState,
    playerId: string
): void {
    const pc = state.pendingCast;
    if (
        pc?.playerId === playerId &&
        pc.assistChoice?.stage === "choose-player"
    ) {
        pc.assistChoice.stage = "settled";
    }
}

/** CR 702.132a — the caster has chosen not to activate any more mana abilities,
 *  so the assistant may now pay. A cost with no generic left owes them no prompt. */
export function finishAssistCasterManaStep(
    state: GameState,
    playerId: string
): void {
    const { pc, assist } = assistOnCast(state);
    if (pc.playerId !== playerId) throw new Error("Not your pending cast");
    if (assist.stage !== "caster-mana" || !assist.assistantId) {
        throw new Error("Assist is not waiting for your mana");
    }
    const generic = pc.manaCost.X ?? 0;
    if (generic <= 0) {
        assist.stage = "settled";
        return;
    }
    assist.stage = "assistant-pay";
    raiseAssistantWindow(
        state,
        assist,
        assist.assistantId,
        "pay",
        generic,
        `Assist ${assist.spell.spellName}: pay any amount of its generic cost, up to ${generic}.`
    );
}

/** CR 702.132a — applies the assistant's answer to one of their two steps. Called
 *  by `applyNumberChoiceSubmit` once the range has been validated.
 *
 *  An assistant whose mana step ends with nothing to spend can only pay 0, so the
 *  exchange settles there rather than asking the caster to wait on an answer that
 *  is already determined. */
export function recordAssistAnswer(
    state: GameState,
    stage: AssistPaymentWindow["stage"],
    amount: number
): void {
    const { pc, assist } = assistOnCast(state);
    if (stage === "mana") {
        const assistant = getPlayer(state, assist.assistantId!);
        assist.stage =
            spendableManaForAssist(assistant, assist.spell) > 0
                ? "caster-mana"
                : "settled";
        return;
    }
    if (amount > 0) {
        assist.paid = amount;
        const left = (pc.manaCost.X ?? 0) - amount;
        if (left > 0) pc.manaCost.X = left;
        else delete pc.manaCost.X;
    }
    assist.stage = "settled";
}

/** CR 605.3a — a source the assistant taps or untaps during their mana window,
 *  tracked so cancelling the cast can reverse the tap (`rollbackPendingCast`). */
export function noteAssistantManaTap(
    state: GameState,
    cardId: string,
    isTapped: boolean
): void {
    const assist = state.pendingCast?.assistChoice;
    if (!assist) return;
    const others = (assist.assistantTappedIds ?? []).filter(
        (id) => id !== cardId
    );
    assist.assistantTappedIds = isTapped ? [...others, cardId] : others;
}
