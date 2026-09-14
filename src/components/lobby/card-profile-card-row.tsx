import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import CardImage from "~/components/cards/card-image";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import CardProfileEditPanel from "./card-profile-edit-panel";

interface CardProfileCardRowProps {
    card: ScopeCardProfile;
    /** Whether this row's editing panel is expanded. OWNED BY THE EDITOR
     *  (issue #3597), not by the row: "save this one and open the next" is a
     *  statement about the review QUEUE, and a row that owns its own open flag
     *  cannot make it. */
    open: boolean;
    onToggle: () => void;
    /** Fires `setCardProfile(scope, cardId, …)` — the caller owns
     *  scope/cardId threading so this row only ever handles the profile
     *  body. Rejected promise surfaces as an inline error. */
    onSave: (profile: EditableCardProfile) => Promise<unknown>;
    /** Fires `clearCardProfile(scope, cardId)` — reverts to the checked-in
     *  census seed (or to no profile at all). */
    onClear: () => Promise<unknown>;
    /** Hand the queue to the next row, after a save resolves. */
    onAdvance: () => void;
}

function summarize(list: string[]): string {
    return list.length === 0 ? "—" : list.join(", ");
}

/** One card's row in the Card Profile review pass (PRD #1607, ADR 0072,
 *  issues #1614 and #3597). Collapsed it shows the card's ART, its name, the
 *  EFFECTIVE profile (`dbProfile ?? seedProfile`), where that profile came
 *  from, and — the load-bearing bit — whether it has been reviewed: an
 *  LLM-seeded row is `reviewed: false` and contributes at HALF the contextual
 *  cap until a human confirms it, so "Unreviewed" is the editor's primary
 *  call to action, not a footnote. Expanding MOUNTS `CardProfileEditPanel`,
 *  which owns every editing control and is seeded by that mount.
 *
 *  Art in the COLLAPSED row is not decoration: judging whether a creature is
 *  `reanimatable` or belongs to `aggro` is a judgement about a body and a
 *  cost, and a name-only row made the reviewer recall or re-look-up every card
 *  of a several-hundred-card pass (issue #3597). The rules text stays behind
 *  the expansion, where the judgement is actually made, so the collapsed list
 *  remains scannable.
 *
 *  Collapsed-by-default matters: a scope is hundreds of cards, and rendering
 *  every card's full control set at once would be thousands of live inputs. */
export default function CardProfileCardRow({
    card,
    open,
    onToggle,
    onSave,
    onClear,
    onAdvance,
}: CardProfileCardRowProps) {
    const effective = card.dbProfile ?? card.seedProfile;
    const wasOpen = useRef(false);

    const panelId = `card-profile-panel-${card.cardId}`;
    const toggleId = `card-profile-toggle-${card.cardId}`;

    // Closing a row hands focus back to the toggle that opened it, rather than
    // dropping it on `<body>` — a keyboard reviewer mid-pass must not be
    // returned to the top of the document on the next Tab. Advancing the queue
    // closes this row and opens the NEXT one in the same commit; effects run
    // in tree order and the next row is always below this one, so its own
    // focus-on-mount runs last and wins.
    useEffect(() => {
        if (!open && wasOpen.current) {
            document.getElementById(toggleId)?.focus();
        }
        wasOpen.current = open;
    }, [open, toggleId]);

    const isOverride = card.dbProfile !== null;
    const source =
        effective === null
            ? "Unprofiled"
            : isOverride
              ? "Override"
              : "Census seed";

    return (
        <div className="flex flex-col gap-2 rounded-sm border border-border-subtle/30 px-2 py-1.5">
            <div className="flex items-center gap-3">
                <div
                    className="relative aspect-5/7 w-11 shrink-0"
                    data-card-profile-art={card.cardId}
                >
                    <CardImage
                        card={{ id: card.cardId }}
                        lazy
                        promoteLayer={false}
                        sizes="44px"
                    />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-text">
                        {card.name}
                    </span>
                    <span className="text-[11px] text-text-muted">
                        {source} · archetypes:{" "}
                        {summarize(effective?.archetypes ?? [])} · provides:{" "}
                        {summarize(effective?.provides ?? [])} · requires:{" "}
                        {summarize(effective?.requires ?? [])}
                    </span>
                </div>
                {effective !== null && (
                    <span
                        className={
                            "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium " +
                            (effective.reviewed
                                ? "bg-surface-elevated/50 text-text-muted"
                                : "bg-danger-strong/20 text-danger-strong")
                        }
                    >
                        {effective.reviewed ? "Reviewed" : "Unreviewed"}
                    </span>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    id={toggleId}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={onToggle}
                >
                    {open ? "Close" : "Edit"}
                </Button>
            </div>

            {open && (
                <CardProfileEditPanel
                    card={card}
                    panelId={panelId}
                    onSave={onSave}
                    onClear={onClear}
                    onAdvance={onAdvance}
                />
            )}
        </div>
    );
}
