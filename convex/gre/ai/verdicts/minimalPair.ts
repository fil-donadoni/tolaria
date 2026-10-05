// Minimal Pair standing — which verdicts a fit may read, judged as pairs
// (issue #4793, PRD #4792, ADR 0148).
//
// A Conditional Verdict says a move is wrong NOW. Alone, "not now" is read by
// the Weight Fit as "never", so it is fitted only beside the right-hand half
// of its Minimal Pair: the same position with one Discriminant changed, where
// the same move is right. The two halves enter together or not at all — a
// right-hand half alone teaches "always" exactly as the anchor alone teaches
// "never". This module decides, over a SET of verdicts, which of them stand in
// a complete pair; the set is the caller's, and it is what "exists" means.
// Promotion hands it the verdicts that are attested and uncontested, so a
// contested or unattested half is simply absent and its anchor is incomplete
// (`promotion.ts`); the fit report hands it the corpus it was given
// (`report.ts`).
//
// THE UPCAST IS A READING, NEVER A REWRITE. A record written before ADR 0148
// carries no classification and reads as UNCLASSIFIED. An unclassified
// `right` keeps today's behaviour. An unclassified `forbidden` READ FROM THE
// VERDICT STORE is treated as an incomplete Conditional Verdict: it names no
// right move, so it is exactly the half-argument the ADR keeps out of the
// fit, and it names no Discriminant, so no half can ever complete it — it
// waits until a judge reclassifies it, which is a new judgement and a new
// verdict id AT THE SAME POSITION KEY. Both stay attested, so quarantine sees
// two answers to one decision and holds both out until an admin resolves the
// position (accepting the classified one): deciding that two records are
// compatible is a resolution, and resolutions are a human's (ADR 0128 §6,
// `quarantine.ts`). The rule is the store's (PRD #4792, user story 37): a blade
// registry verdict is code, and is classified by its own tickets (issue
// #4796, issue #4797), so `stored` is the caller's to say per member.
//
// WHAT IS NOT CHECKED HERE: that the half's right move is the move the anchor
// ruled out. A candidate is its move key, and a move key carries instance ids,
// which a `card` Discriminant legitimately reallocates — comparing the two
// halves' keys would refuse honest pairs. The derivation that writes the half
// (issue #4795) rebuilds both positions and owns that check.

import type { VerdictJudgement } from "./identity";
import type { Discriminant } from "./types";

/** One verdict as the standing sees it. */
export type MinimalPairMember = {
    verdictId: string;
    judgement: VerdictJudgement;
    /** Read from the Verdict Store — where an unclassified `forbidden` is an
     *  incomplete Conditional Verdict (the upcast, header). */
    stored: boolean;
    /** Why the held-out split refuses this right-hand half (`pairSplitRefusals`):
     *  its derived board is already judged on the other side. */
    splitRefusal?: string;
};

export type MinimalPairStanding =
    /** Wrong whatever changes — owes nothing. */
    | { kind: "absolute" }
    /** Written before the classification existed, and not a stored
     *  `forbidden`: read as it always was. */
    | { kind: "unclassified" }
    /** One half of a complete Minimal Pair. `partnerIds`: the anchor, for a
     *  half; every complete half, for an anchor. */
    | { kind: "paired"; role: "anchor" | "half"; partnerIds: string[] }
    /** Out of the fit and the Verdict Lock until its pair is complete. */
    | { kind: "incomplete"; why: string };

const sameDiscriminant = (a: Discriminant, b: Discriminant): boolean =>
    a.kind === b.kind && a.detail === b.detail;

const describe = (d: Discriminant): string => `${d.kind}: ${d.detail}`;

/** Why a right-hand half does not complete `anchor`, or `null` when it does. */
function halfDefect(
    half: MinimalPairMember,
    anchor: MinimalPairMember | undefined
): string | null {
    const link = half.judgement.pairOf!;
    if (anchor === undefined) {
        return `right-hand half of ${link.anchorId}, which is not beside it — attested, uncontested — so the pair is incomplete (ADR 0148)`;
    }
    const classification = anchor.judgement.classification;
    if (classification?.kind !== "conditional") {
        return `right-hand half of ${link.anchorId}, which is not a Conditional Verdict — only "wrong now" owes a pair (ADR 0148)`;
    }
    if (!sameDiscriminant(classification.discriminant, link.discriminant)) {
        return `right-hand half of ${link.anchorId} names the Discriminant (${describe(link.discriminant)}), but its anchor names (${describe(classification.discriminant)}) — one pair, one Discriminant (ADR 0148)`;
    }
    return half.splitRefusal ?? null;
}

/**
 * The Minimal Pair standing of every member, by verdict id. Pure and
 * order-independent: the standing of a verdict depends on which verdicts are
 * in the set, never on where.
 */
export function minimalPairStandings(
    members: readonly MinimalPairMember[]
): Map<string, MinimalPairStanding> {
    const byId = new Map(members.map((m) => [m.verdictId, m]));
    const completeHalves = new Map<string, string[]>();
    const out = new Map<string, MinimalPairStanding>();

    for (const member of members) {
        const link = member.judgement.pairOf;
        if (link === undefined) continue;
        const why = halfDefect(member, byId.get(link.anchorId));
        if (why !== null) {
            out.set(member.verdictId, { kind: "incomplete", why });
            continue;
        }
        completeHalves.set(link.anchorId, [
            ...(completeHalves.get(link.anchorId) ?? []),
            member.verdictId,
        ]);
        out.set(member.verdictId, {
            kind: "paired",
            role: "half",
            partnerIds: [link.anchorId],
        });
    }

    for (const member of members) {
        const { judgement, verdictId } = member;
        if (judgement.pairOf !== undefined) continue;
        const classification = judgement.classification;
        if (classification?.kind === "absolute") {
            out.set(verdictId, { kind: "absolute" });
        } else if (classification?.kind === "conditional") {
            const halves = completeHalves.get(verdictId);
            out.set(
                verdictId,
                halves === undefined
                    ? {
                          kind: "incomplete",
                          why: `Conditional Verdict (${describe(classification.discriminant)}) with no right-hand half beside it — "not now" alone is fitted as "never" (ADR 0148)`,
                      }
                    : {
                          kind: "paired",
                          role: "anchor",
                          partnerIds: [...halves].sort(),
                      }
            );
        } else if (member.stored && judgement.answer.kind === "forbidden") {
            out.set(verdictId, {
                kind: "incomplete",
                why: `unclassified "forbidden" — read as an incomplete Conditional Verdict until a judge reclassifies it (ADR 0148)`,
            });
        } else {
            out.set(verdictId, { kind: "unclassified" });
        }
    }
    return out;
}
