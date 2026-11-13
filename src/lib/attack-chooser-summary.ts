import { getDefinition } from "@convex/cards";
import { displayCardId } from "~/lib/card-utils";
import type { CardInstance } from "~/types/game";

/** Who is choosing an attack target right now (CR 508.1b), as the
 *  declare-attackers banner names it (issue #9500). `position` / `total` /
 *  `nextNames` exist only during the "Attack with all" walk; clicked
 *  creatures awaiting a target choose together and carry only their names. */
export type AttackChooserSummary = {
    /** The creature whose thumbnail the banner shows (the walk's current
     *  attacker, or the first awaiting one). */
    card: CardInstance;
    /** Names of every creature choosing NOW: one during the walk, all the
     *  awaiting ones otherwise. */
    names: string[];
    /** 1-based place in the walk, with its length. */
    position?: number;
    total?: number;
    /** Names still to choose after the current one, in walk order. */
    nextNames: string[];
};

type SequenceView = {
    active: boolean;
    order: readonly string[];
    index: number;
    awaiting: readonly string[];
};

function nameOf(card: CardInstance): string {
    return getDefinition(displayCardId(card)).name;
}

/** Resolve the attack sequence against the attacker's battlefield. `null`
 *  when nobody is choosing, or when the chooser is no longer on the
 *  battlefield (the banner then falls back to its generic copy). */
export function summarizeAttackChooser(
    sequence: SequenceView,
    battlefield: readonly CardInstance[]
): AttackChooserSummary | null {
    const byId = new Map(battlefield.map((c) => [c.id, c]));
    if (sequence.active) {
        const card = byId.get(sequence.order[sequence.index] ?? "");
        if (!card) return null;
        const nextNames = sequence.order
            .slice(sequence.index + 1)
            .map((id) => byId.get(id))
            .filter((c): c is CardInstance => c !== undefined)
            .map(nameOf);
        return {
            card,
            names: [nameOf(card)],
            position: sequence.index + 1,
            total: sequence.order.length,
            nextNames,
        };
    }
    const awaiting = sequence.awaiting
        .map((id) => byId.get(id))
        .filter((c): c is CardInstance => c !== undefined);
    if (awaiting.length === 0) return null;
    return { card: awaiting[0], names: awaiting.map(nameOf), nextNames: [] };
}
