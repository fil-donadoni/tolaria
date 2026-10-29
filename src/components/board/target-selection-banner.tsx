import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player, StackItem } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { divideKindLabels, useDivideBuffer } from "~/hooks/useDivideBuffer";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { displayCardId } from "~/lib/card-utils";
import { resolvePendingTargetSource } from "~/lib/pending-target-source";
import {
    describeTargetProgress,
    formatTargetLabel,
} from "~/lib/target-progress";
import { V4_CHIP } from "~/lib/board-chrome-v4";
import DivideTargetList from "./divide-target-list";
import {
    formatModeTargetProvenance,
    modeTargetProvenance,
} from "~/lib/mode-target-provenance";
import { announcedTargetRoleRows } from "~/lib/announced-target-roles";

/** How the target COUNT reads on the prompt's chip.
 *
 *  The v4 prototype showed a "2 legal" chip — the number of legal targets still
 *  on the board. That number is **not on the wire**: `PendingTarget` carries the
 *  target FILTERS (colour / subtype / power / …), never a resolved candidate
 *  list.
 *
 *  It is NOT barred by ADR 0074 (a round-2 review corrected this note's first
 *  version, which claimed it was). The client already re-derives target
 *  legality every render — `matchesTargetRequirement` +
 *  `matchesPermanentTargetFilters` (`card-utils.ts`) are what make a card
 *  clickable, and they run through the SAME shared filter registry the server
 *  uses (ADR 0068), so they are not a drifting copy. ADR 0074 bars client
 *  AUTHORITY, not a client-side display count.
 *
 *  The real reason the chip counts PROGRESS instead is coverage: a legal-target
 *  count has to span players, the stack and graveyards, and the client's sweep
 *  is permanent-only — `hasBattlefieldTargetCandidate` (`card-utils.ts`)
 *  explicitly FAILS OPEN on `player` / `spell` / `spell-or-permanent` / `card`
 *  and on any non-battlefield `zone`. A chip reading "2 legal" while silently
 *  counting only one of four target spaces is worse than no chip. What the
 *  prompt DOES know exactly, for every requirement shape, is the player's
 *  progress against it (CR 601.2c), so that is what the chip says. Recorded
 *  deviation, issue #2727. */
function targetCountLabel(
    count: PendingTarget["count"],
    selected: number
): string {
    if (typeof count === "number") return `${selected} / ${count}`;
    if (count.max !== undefined) return `${selected} / up to ${count.max}`;
    return `${selected} / ${count.min}+`;
}

export default function TargetSelectionBanner({
    pendingTarget,
    me,
    stack,
    gameId,
    playerId,
}: {
    pendingTarget: PendingTarget;
    me: Player | undefined;
    stack: StackItem[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const cancelTarget = useMutation(api.game.cancelTarget);
    const confirmTargets = useMutation(api.game.confirmTargets);
    const [isBusy, setIsBusy] = useState(false);
    // Issue #1813 — always pinned: the whole point of this banner is to
    // route taps to targets on the mid-board (CR 601.2c), so a vertically
    // centered panel would sit directly on top of what the player must tap.
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition({ pinned: true });
    const divide = useDivideBuffer();

    // CR 707.10b — a copy-retarget selection points at a spell copy on the
    // stack (not a card in hand); declining keeps the copy's inherited
    // targets, so the source line reads "Copy" and Cancel reads "Keep
    // targets" to convey the optionality.
    const isCopyRetarget = pendingTarget.kind === "copy-retarget";
    // Issue #6984 — the ONE source lookup, shared with the graveyard target
    // dialog's title.
    const {
        name: cardName,
        castSource,
        sourcePermanent,
    } = resolvePendingTargetSource(pendingTarget, me, stack);
    // ADR 0094 (issue #2264) — with several mode instances announced, name
    // the instance this target group belongs to, so a repeated mode's groups
    // are not picked blind.
    const provenance = modeTargetProvenance(
        pendingTarget,
        sourcePermanent
            ? getDefinition(
                  displayCardId(sourcePermanent)
              ).activatedAbilities?.find(
                  (a) => a.id === pendingTarget.abilityId
              )?.modes
            : castSource
              ? getDefinition(castSource.card.id).modes
              : undefined
    );
    const targetLabel = formatTargetLabel(
        pendingTarget.targetType,
        pendingTarget.zone,
        pendingTarget.controller,
        pendingTarget.spellStackKind
    );
    const { hint, minReached, maxReached } = describeTargetProgress(
        pendingTarget.count,
        pendingTarget.selected.length,
        targetLabel
    );
    const showDone = typeof pendingTarget.count !== "number" && !maxReached;
    // CR 601.2c (issue #4193) — when the announced targets of this group
    // receive DIFFERENT halves of the effect (kicked Jilt: one is bounced, the
    // other burned), the prompt must say which click buys which. Empty for
    // every symmetric announcement, so their prompt is unchanged.
    const roleRows = announcedTargetRoleRows(
        pendingTarget.announcedTargetRoles,
        pendingTarget.selected.length
    );

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel
                    density="compact"
                    className="flex flex-col gap-3 px-5 py-3"
                >
                    <div className="flex items-center gap-3">
                        {/* v4 (ADR 0103 §4): the SOURCE in the display face,
                            the instruction as a quiet muted line under it —
                            the player reads "what am I aiming" first and "how
                            many of what" second. */}
                        <div className="flex min-w-0 flex-col gap-1">
                            <span className="truncate text-display text-base text-text">
                                {cardName}
                                {provenance && (
                                    <span
                                        data-mode-provenance={provenance.modeId}
                                    >
                                        {" — "}
                                        {formatModeTargetProvenance(provenance)}
                                    </span>
                                )}
                            </span>
                            <span className="text-xs text-text-muted">
                                {divide.active
                                    ? `Divide ${divideKindLabels(divide.kind).budget} — ${divide.remaining} left`
                                    : hint}
                            </span>
                            {/* CR 601.2c (issue #4193) — directly under the
                                instruction and ABOVE the actions: what the
                                next click buys is read before Done/Cancel,
                                and on a phone it is not the first thing
                                pushed out of view. `aria-live` so the marker
                                moving between picks is announced. */}
                            {roleRows.length > 0 && (
                                <ol
                                    data-announced-target-roles
                                    aria-live="polite"
                                    className="flex flex-col gap-0.5 text-xs"
                                >
                                    {roleRows.map((row) => (
                                        <li
                                            key={row.slot}
                                            data-target-role-slot={row.slot}
                                            data-target-role-status={row.status}
                                            className={
                                                row.status === "current"
                                                    ? "text-signal-target-strong"
                                                    : row.status === "picked"
                                                      ? "text-text-muted line-through"
                                                      : "text-text-muted"
                                            }
                                        >
                                            <span className="tabular-nums">
                                                {row.slot}.
                                            </span>{" "}
                                            {row.role}
                                            {row.status === "current" &&
                                                " — pick now"}
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                        {!divide.active && (
                            <span
                                data-target-count-chip
                                className={`${V4_CHIP} border-signal-target/60 tabular-nums text-signal-target-strong`}
                            >
                                {targetCountLabel(
                                    pendingTarget.count,
                                    pendingTarget.selected.length
                                )}
                            </span>
                        )}
                        {divide.active ? (
                            // CR 601.2d — divide-as-you-choose: each target below
                            // carries its own [−] N [+] stepper (dialed independently);
                            // this finalizes once the whole budget is assigned. Label
                            // follows `divide.kind` — Pollen Remedy's budget is
                            // PREVENTED damage (CR 615.1), not dealt (QA — this used
                            // to hard-code "Deal damage" for every divide spell).
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                disabled={
                                    isBusy ||
                                    divide.isPending ||
                                    !divide.canSubmit
                                }
                                onClick={() => void divide.submit()}
                            >
                                {divideKindLabels(divide.kind).submit}
                            </Button>
                        ) : (
                            showDone && (
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    disabled={isBusy || !minReached}
                                    onClick={async () => {
                                        if (isBusy) return;
                                        setIsBusy(true);
                                        try {
                                            await confirmTargets({
                                                gameId,
                                                playerId,
                                            });
                                        } finally {
                                            setIsBusy(false);
                                        }
                                    }}
                                >
                                    Done
                                </Button>
                            )
                        )}
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={isBusy}
                            onClick={async () => {
                                if (isBusy) return;
                                setIsBusy(true);
                                try {
                                    await cancelTarget({ gameId, playerId });
                                } finally {
                                    setIsBusy(false);
                                }
                            }}
                        >
                            {isCopyRetarget ? "Keep targets" : "Cancel"}
                        </Button>
                    </div>
                    {divide.active && <DivideTargetList />}
                </Panel>
            </div>
        </div>
    );
}
