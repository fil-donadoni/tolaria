// View model for the Draft Lab's Built deck view (issue #8899): the Maindeck
// grouped by curve, and the Draft Table Audit's castability folded by turn.
// Grouping only — every number shown is read off `DeckAudit`
// (`draftTableAudit.ts`), never re-measured here.
import type { DeckCard } from "@convex/deckPresets";
import { curveBucket, CURVE_MAX_BUCKET } from "@convex/limited/botDrafter";
import type { DraftContext } from "@convex/botFindingsCore";
import { SCORER_VERSION } from "@convex/limited/scorerVersion";
import {
    EARLY_CASTABILITY_THRESHOLD,
    EARLY_MANA_VALUE,
    type DeckAudit,
} from "./draftTableAudit";
import type { DraftLabState } from "./draftLabEngine";
import { draftLabGetAutoBuildCardMeta } from "./draftLabCardMeta";

export interface BuiltDeckCardLine {
    cardName: string;
    count: number;
}

export interface BuiltDeckCurveGroup {
    key: string;
    label: string;
    cards: BuiltDeckCardLine[];
}

export interface CastabilityAtTurn {
    turn: number;
    label: string;
    spells: number;
    mean: number;
}

/** A curve bucket's label: the last one is open-ended (`6+`). */
export function curveBucketLabel(bucket: number): string {
    return bucket === CURVE_MAX_BUCKET ? `${bucket}+` : `${bucket}`;
}

/** A share as a whole percentage, `—` when there is nothing to measure. */
export function formatShare(share: number | null): string {
    return share === null ? "—" : `${Math.round(share * 100)}%`;
}

function toLines(cards: readonly DeckCard[]): BuiltDeckCardLine[] {
    const counts = new Map<string, number>();
    for (const c of cards) {
        counts.set(c.cardName, (counts.get(c.cardName) ?? 0) + 1);
    }
    return [...counts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cardName, count]) => ({ cardName, count }));
}

/** The Maindeck by curve: spells per `curveBucket` (the audit's own bucket),
 *  then lands, then any card no registry entry resolves. Empty groups are
 *  dropped. */
export function groupMaindeckByCurve(
    cards: readonly DeckCard[]
): BuiltDeckCurveGroup[] {
    const spells = new Map<number, DeckCard[]>();
    const lands: DeckCard[] = [];
    const unresolved: DeckCard[] = [];
    for (const card of cards) {
        const meta = draftLabGetAutoBuildCardMeta(card.cardId);
        if (!meta) unresolved.push(card);
        else if (meta.isLand) lands.push(card);
        else {
            const bucket = curveBucket(meta.manaValue);
            spells.set(bucket, [...(spells.get(bucket) ?? []), card]);
        }
    }
    const groups: BuiltDeckCurveGroup[] = [...spells]
        .sort(([a], [b]) => a - b)
        .map(([bucket, group]) => ({
            key: `mv-${bucket}`,
            label: `MV ${curveBucketLabel(bucket)}`,
            cards: toLines(group),
        }));
    if (lands.length > 0) {
        groups.push({ key: "lands", label: "Lands", cards: toLines(lands) });
    }
    if (unresolved.length > 0) {
        groups.push({
            key: "unresolved",
            label: "Unresolved",
            cards: toLines(unresolved),
        });
    }
    return groups;
}

/** The audit's per-spell castability, averaged per turn the model casts it on
 *  (`max(1, MV)`, `castabilityOf`), the last turn open-ended like the curve. */
export function castabilityByTurn(audit: DeckAudit): CastabilityAtTurn[] {
    const byTurn = new Map<number, number[]>();
    for (const spell of audit.castability) {
        const turn = curveBucket(spell.manaValue);
        byTurn.set(turn, [...(byTurn.get(turn) ?? []), spell.p]);
    }
    return [...byTurn]
        .sort(([a], [b]) => a - b)
        .map(([turn, ps]) => ({
            turn,
            label: `T${curveBucketLabel(turn)}`,
            spells: ps.length,
            mean: ps.reduce((a, b) => a + b, 0) / ps.length,
        }));
}

export interface BuiltDeckAuditField {
    label: string;
    value: string;
}

/** The Draft Table Audit's per-deck fields as the view prints them: plan and
 *  plan share, colours, Maindeck size, lands, curve, castability (mean, then
 *  by turn), the colour-coherence fields (early castability, splash, off-colour
 *  duals — issue #9335), Capability pairs, unreviewed share per layer. */
export function builtDeckAuditFields(audit: DeckAudit): BuiltDeckAuditField[] {
    const byTurn = castabilityByTurn(audit)
        .map((t) => `${t.label} ${formatShare(t.mean)}`)
        .join(" ");
    const early = audit.earlyCastability;
    return [
        {
            label: "plan",
            value: `${audit.planArchetype ?? "—"} · ${formatShare(audit.planShare)}`,
        },
        { label: "colours", value: audit.colors.join("") || "—" },
        {
            label: "main",
            value: `${audit.mainSize}${audit.legal ? "" : " (below the format minimum)"}`,
        },
        { label: "lands", value: `${audit.landCount}` },
        {
            label: "curve",
            value: audit.curve
                .slice(1)
                .map((n, i) => `${curveBucketLabel(i + 1)}:${n}`)
                .join(" "),
        },
        {
            label: "castability",
            value: `${formatShare(audit.meanCastability)} · ${byTurn || "—"}`,
        },
        {
            label: "early castability",
            value: `${formatShare(early.mean)} · ${early.below}/${early.spells} below ${formatShare(EARLY_CASTABILITY_THRESHOLD)}`,
        },
        {
            label: "splash",
            value: audit.splash
                ? `${audit.splash.cards} cards · ${audit.splash.strained} double-pip or MV ≤ ${EARLY_MANA_VALUE}`
                : "—",
        },
        { label: "off-colour duals", value: `${audit.offColourDuals}` },
        { label: "capability pairs", value: `${audit.capabilityPairs}` },
        {
            label: "unreviewed",
            value: `archetypes ${formatShare(audit.unreviewedShare.archetypes)} · capabilities ${formatShare(audit.unreviewedShare.capabilities)}`,
        },
    ];
}

/** What reruns this Lab draft for one seat (issue #8900): the seed, the Pack
 *  Source every slot dealt from (`standardPackSlots` repeats ONE key), the
 *  seat, and the scorer the Lab picked with — the context a Bot Finding report
 *  stores. Read off the STATE, never the controls: a Pack Source changed after
 *  Start no longer describes the draft on screen. */
export function draftLabFindingContext(
    state: Pick<DraftLabState, "seed" | "packSlots">,
    seatIndex: number
): DraftContext {
    return {
        seed: state.seed,
        scope: state.packSlots[0] ?? "",
        seatIndex,
        scorerVersion: SCORER_VERSION,
    };
}
