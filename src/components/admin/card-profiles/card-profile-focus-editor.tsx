import { useEffect, useMemo, useRef, useState } from "react";
import {
    CAPABILITY_CLUSTERS,
    CAPABILITY_REGISTRY,
} from "@convex/limited/capabilityRegistry";
import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import CardImage from "~/components/cards/card-image";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import CardProfileArchetypeLine from "./card-profile-archetype-line";
import CardProfileCapabilityLine from "./card-profile-capability-line";
import CardProfilesStatusBadge from "./card-profiles-status-badge";
import {
    effectiveProfile,
    layerRationale,
    layerReviewed,
    profileStatus,
    relatedCards,
    type LayerSave,
    type ProfileTab,
} from "./card-profiles-model";

interface CardProfileFocusEditorProps {
    tab: ProfileTab;
    card: ScopeCardProfile;
    /** The whole scope — where each line's related cards come from. */
    scopeCards: readonly ScopeCardProfile[];
    archetypeCatalogue: readonly ArchetypeCatalogueRow[];
    /** Saves THIS tab's layer only (ADR 0167): the page routes it to the
     *  layer's own mutation. */
    onSave: (save: LayerSave) => Promise<unknown>;
    onClear: () => Promise<unknown>;
    onPrev: (() => void) | null;
    /** Opens the next card of the walk, or closes the dialog after the last. */
    onNext: () => void;
}

const ARCHETYPE_RELATED = 4;
const CAPABILITY_RELATED = 2;

function toggled(list: readonly string[], id: string): string[] {
    return list.includes(id)
        ? list.filter((entry) => entry !== id)
        : [...list, id];
}

/** The focus dialog's body for ONE card (issue #8904, prototype verdict D):
 *  image left; right one block — the census rationale for the tab's layer,
 *  then one compact line per catalogue row of that layer — and the pass's
 *  controls.
 *
 *  MOUNTED PER CARD (the dialog keys it on the card id): mounting is what
 *  seeds the toggles from the card's CURRENT effective profile, so edits
 *  abandoned by stepping away never survive into the next visit, and a
 *  reactive update while the card is open never yanks a toggle out from
 *  under the reviewer (issue #3597's lesson, kept). */
export default function CardProfileFocusEditor({
    tab,
    card,
    scopeCards,
    archetypeCatalogue,
    onSave,
    onClear,
    onPrev,
    onNext,
}: CardProfileFocusEditorProps) {
    const effective = effectiveProfile(card);
    const [archetypes, setArchetypes] = useState<string[]>(
        effective?.archetypes ?? []
    );
    const [provides, setProvides] = useState<string[]>(
        effective?.provides ?? []
    );
    const [requires, setRequires] = useState<string[]>(
        effective?.requires ?? []
    );
    const [reviewed, setReviewed] = useState(layerReviewed(card, tab) ?? false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // Focus lands inside on mount, so the pass is keyboard-reachable: each
    // step mounts the next card's editor, which takes focus, and ⌘/Ctrl+Enter
    // confirms it without a pointer.
    useEffect(() => {
        rootRef.current?.focus();
    }, []);

    const rationale = layerRationale(card, tab);
    const catalogueIds = useMemo(
        () => new Set(archetypeCatalogue.map((row) => row.id)),
        [archetypeCatalogue]
    );
    const unregistered = archetypes.filter((id) => !catalogueIds.has(id));

    /** The one write path. Returns whether it resolved, so only a successful
     *  save advances the walk — a rejected write leaves the reviewer on the
     *  card with the error visible. */
    async function save(markReviewed: boolean): Promise<boolean> {
        if (pending) return false;
        setPending(true);
        setError(null);
        try {
            await onSave({
                archetypes,
                provides,
                requires,
                reviewed: markReviewed,
            });
            setReviewed(markReviewed);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed");
            return false;
        } finally {
            setPending(false);
        }
    }

    async function reviewedAndNext() {
        if (await save(true)) onNext();
    }

    async function clear() {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            await onClear();
            const seed = card.seedProfile;
            setArchetypes(seed?.archetypes ?? []);
            setProvides(seed?.provides ?? []);
            setRequires(seed?.requires ?? []);
            setReviewed(
                (tab === "capabilities"
                    ? seed?.capabilitiesReviewed
                    : seed?.archetypesReviewed) ?? false
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Clear failed");
        } finally {
            setPending(false);
        }
    }

    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            role="group"
            aria-label={`Profile for ${card.name}`}
            className="flex flex-col gap-4 outline-none"
            onKeyDown={(e) => {
                // ⌘/Ctrl+Enter — the pass's keyboard loop. Not a bare Enter:
                // the block is full of checkboxes where Enter means something.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void reviewedAndNext();
                }
            }}
        >
            <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
                <div className="flex flex-col gap-2">
                    <div
                        className="relative aspect-5/7 w-40 md:w-full"
                        data-card-profile-focus-art={card.cardId}
                    >
                        <CardImage card={{ id: card.cardId }} sizes="240px" />
                    </div>
                    <CardProfilesStatusBadge
                        status={profileStatus(card, tab)}
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                    {rationale && (
                        <blockquote
                            data-census-rationale
                            className="border-l-2 border-accent-strong pl-3 text-sm leading-snug text-text"
                        >
                            <span className="text-label block">
                                Census says
                            </span>
                            {rationale}
                        </blockquote>
                    )}
                    {tab === "archetypes" ? (
                        <section
                            aria-label="Archetypes"
                            className="flex flex-col"
                        >
                            {unregistered.map((id) => (
                                <CardProfileArchetypeLine
                                    key={id}
                                    id={id}
                                    row={null}
                                    checked
                                    onToggle={() =>
                                        setArchetypes((prev) =>
                                            toggled(prev, id)
                                        )
                                    }
                                    disabled={pending}
                                    cardName={card.name}
                                    related={[]}
                                />
                            ))}
                            {archetypeCatalogue.map((row) => (
                                <CardProfileArchetypeLine
                                    key={row.id}
                                    id={row.id}
                                    row={row}
                                    checked={archetypes.includes(row.id)}
                                    onToggle={() =>
                                        setArchetypes((prev) =>
                                            toggled(prev, row.id)
                                        )
                                    }
                                    disabled={pending}
                                    cardName={card.name}
                                    related={relatedCards(
                                        scopeCards,
                                        "archetypes",
                                        row.id,
                                        card.cardId,
                                        ARCHETYPE_RELATED
                                    )}
                                />
                            ))}
                        </section>
                    ) : (
                        <section
                            aria-label="Capabilities"
                            className="flex flex-col"
                        >
                            <div className="grid grid-cols-[1.25rem_1.25rem_minmax(0,1fr)] gap-2 px-1 pb-1">
                                <span className="text-label">Prov</span>
                                <span className="text-label">Req</span>
                                <span className="text-label">Capability</span>
                            </div>
                            {CAPABILITY_CLUSTERS.map((cluster) => (
                                <div
                                    key={cluster}
                                    className="flex flex-col"
                                    data-capability-cluster={cluster}
                                >
                                    <span className="text-label px-1 pt-1.5 pb-0.5 text-text-disabled">
                                        {cluster}
                                    </span>
                                    {CAPABILITY_REGISTRY.filter(
                                        (row) => row.cluster === cluster
                                    ).map((row) => (
                                        <CardProfileCapabilityLine
                                            key={row.id}
                                            row={row}
                                            provides={provides.includes(row.id)}
                                            requires={requires.includes(row.id)}
                                            onToggleProvides={() =>
                                                setProvides((prev) =>
                                                    toggled(prev, row.id)
                                                )
                                            }
                                            onToggleRequires={() =>
                                                setRequires((prev) =>
                                                    toggled(prev, row.id)
                                                )
                                            }
                                            disabled={pending}
                                            cardName={card.name}
                                            offers={relatedCards(
                                                scopeCards,
                                                "provides",
                                                row.id,
                                                card.cardId,
                                                CAPABILITY_RELATED
                                            )}
                                            needs={relatedCards(
                                                scopeCards,
                                                "requires",
                                                row.id,
                                                card.cardId,
                                                CAPABILITY_RELATED
                                            )}
                                        />
                                    ))}
                                </div>
                            ))}
                            <p className="px-1 pt-1.5 text-xs text-text-muted">
                                An empty Requires is the norm. ∂ = derived from
                                its base capability and mana value, never set by
                                hand.
                            </p>
                        </section>
                    )}
                    <p className="px-1 text-xs text-text-muted">
                        Related cards: hover to enlarge, right-click for the
                        full preview, click to peek.
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onPrev?.()}
                    disabled={pending || onPrev === null}
                >
                    ← Prev
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    size="xs"
                    onClick={() => void reviewedAndNext()}
                    disabled={pending}
                >
                    {pending ? "Saving…" : "Mark reviewed & next"}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => void save(reviewed)}
                    disabled={pending}
                >
                    Save
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={onNext}
                    disabled={pending}
                >
                    Skip →
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void clear()}
                    disabled={pending || card.dbProfile === null}
                >
                    Clear
                </Button>
                <label className="flex items-center gap-1 text-xs text-text">
                    <Checkbox
                        checked={reviewed}
                        disabled={pending}
                        aria-label={`Reviewed for ${card.name}`}
                        onCheckedChange={setReviewed}
                    />
                    Reviewed (full weight)
                </label>
                <span className="ml-auto text-xs text-text-muted">
                    ⌘/Ctrl+Enter marks reviewed and opens the next card
                </span>
                {error && (
                    <span role="alert" className="text-xs text-danger-strong">
                        {error}
                    </span>
                )}
            </div>
        </div>
    );
}
