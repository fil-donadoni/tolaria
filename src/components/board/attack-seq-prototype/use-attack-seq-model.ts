// PROTOTYPE (issue #9500) — the sequence as rows: every attacker still in the
// walk (or awaiting a target), its status and the target it got.
import { getDefinition } from "@convex/cards";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import { useGameContext } from "~/hooks/useGameContext";
import { displayCardId, isPlaneswalker } from "~/lib/card-utils";
import type { CardInstance } from "~/types/game";

export type SeqRow = {
    card: CardInstance;
    name: string;
    /** 1-based position in the walk. */
    n: number;
    status: "done" | "current" | "pending";
    /** "Opponent", the planeswalker's name, or null while unchosen. */
    targetLabel: string | null;
};

export type SeqModel = {
    rows: SeqRow[];
    current: SeqRow | null;
    total: number;
    doneCount: number;
    opponentName: string;
    planeswalkers: { id: string; name: string }[];
};

export function useAttackSeqModel(): SeqModel | null {
    const { allPlayers, activePlayerId, playerId, combat } = useGameContext();
    const seq = useAttackSequence();
    if (!seq.choosingTarget || playerId !== activePlayerId) return null;
    const me = allPlayers.find((p) => p.id === activePlayerId);
    const opp = allPlayers.find((p) => p.id !== activePlayerId);
    if (!me || !opp) return null;
    const byId = new Map(me.battlefield.map((c) => [c.id, c]));
    const pws = opp.battlefield.filter(isPlaneswalker).map((c) => ({
        id: c.id,
        name: getDefinition(displayCardId(c)).name,
    }));
    const pwName = new Map(pws.map((p) => [p.id, p.name]));
    const ids = seq.active ? seq.order : seq.awaiting;
    const rows: SeqRow[] = [];
    ids.forEach((id, i) => {
        const card = byId.get(id);
        if (!card) return;
        const status: SeqRow["status"] = seq.active
            ? i < seq.index
                ? "done"
                : i === seq.index
                  ? "current"
                  : "pending"
            : "current";
        const t = combat?.attackTargets?.[id];
        rows.push({
            card,
            name: getDefinition(displayCardId(card)).name,
            n: i + 1,
            status,
            targetLabel:
                status === "done"
                    ? t
                        ? (pwName.get(t) ?? "planeswalker")
                        : opp.name
                    : null,
        });
    });
    const current = rows.find((r) => r.status === "current") ?? null;
    return {
        rows,
        current,
        total: rows.length,
        doneCount: rows.filter((r) => r.status === "done").length,
        opponentName: opp.name,
        planeswalkers: pws,
    };
}

/** The live viewport rect of a battlefield permanent (the arrow anchor). */
export function permanentRect(id: string): DOMRect | null {
    const el = document.querySelector(
        `[data-arrow-anchor-permanent="${CSS.escape(id)}"]`
    );
    return el ? el.getBoundingClientRect() : null;
}
