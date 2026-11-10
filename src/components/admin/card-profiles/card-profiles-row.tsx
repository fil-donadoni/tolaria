import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { TableCell, TableRow } from "~/components/ui/table";
import CardImage from "~/components/cards/card-image";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import CardProfileEditPanel from "./card-profile-edit-panel";
import CardProfilesStatusBadge from "./card-profiles-status-badge";
import {
    effectiveProfile,
    profileStatus,
    type ProfileSortKey,
} from "./card-profiles-model";

interface CardProfilesRowProps {
    card: ScopeCardProfile;
    columns: readonly ProfileSortKey[];
    /** Whether this row's editing panel is open. OWNED BY THE TABLE (issue
     *  #3597): "save this one and open the next" is a statement about the
     *  review QUEUE, which a row that owns its own flag cannot make. */
    open: boolean;
    onToggle: () => void;
    onSave: (profile: EditableCardProfile) => Promise<unknown>;
    onClear: () => Promise<unknown>;
    onAdvance: () => void;
    archetypeCatalogue: readonly ArchetypeCatalogueRow[];
}

function listText(list: readonly string[] | undefined): string {
    return list === undefined || list.length === 0 ? "—" : list.join(", ");
}

/** One card of the Card Profiles table, plus its editor row when open. The
 *  whole row is the click target (until the card focus dialog, issue #8772's
 *  later slice, a row opens the existing editor panel); the Edit button is
 *  the keyboard path and the focus-return target. */
export default function CardProfilesRow({
    card,
    columns,
    open,
    onToggle,
    onSave,
    onClear,
    onAdvance,
    archetypeCatalogue,
}: CardProfilesRowProps) {
    const effective = effectiveProfile(card);
    const wasOpen = useRef(false);
    const panelId = `card-profile-panel-${card.cardId}`;
    const toggleId = `card-profile-toggle-${card.cardId}`;

    // Closing a row hands focus back to the toggle that opened it, not
    // `<body>`. Advancing the queue closes this row and opens the NEXT one in
    // the same commit; the next row is below, so its focus-on-mount wins.
    useEffect(() => {
        if (!open && wasOpen.current) {
            document.getElementById(toggleId)?.focus();
        }
        wasOpen.current = open;
    }, [open, toggleId]);

    const cell = (key: ProfileSortKey) => {
        switch (key) {
            case "card":
                return (
                    <TableCell key={key}>
                        <div className="flex items-center gap-3">
                            <div
                                className="relative aspect-5/7 w-11 shrink-0"
                                data-card-profile-art={card.cardId}
                            >
                                <CardImage
                                    card={{ id: card.cardId }}
                                    lazy
                                    sizes="44px"
                                />
                            </div>
                            <span className="text-sm text-text">
                                {card.name}
                            </span>
                        </div>
                    </TableCell>
                );
            case "status":
                return (
                    <TableCell key={key}>
                        <CardProfilesStatusBadge status={profileStatus(card)} />
                    </TableCell>
                );
            case "archetypes":
                return (
                    <TableCell key={key} className="text-xs text-text-muted">
                        {listText(effective?.archetypes)}
                    </TableCell>
                );
            case "provides":
                return (
                    <TableCell key={key} className="text-xs text-text-muted">
                        {listText(effective?.provides)}
                    </TableCell>
                );
            case "requires":
                return (
                    <TableCell key={key} className="text-xs text-text-muted">
                        {listText(effective?.requires)}
                    </TableCell>
                );
        }
    };

    return (
        <>
            <TableRow className="cursor-pointer" onClick={onToggle}>
                {columns.map(cell)}
                <TableCell className="text-right">
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        id={toggleId}
                        aria-expanded={open}
                        aria-controls={panelId}
                    >
                        {open ? "Close" : "Edit"}
                    </Button>
                </TableCell>
            </TableRow>
            {open && (
                <TableRow>
                    <TableCell colSpan={columns.length + 1}>
                        <CardProfileEditPanel
                            card={card}
                            panelId={panelId}
                            onSave={onSave}
                            onClear={onClear}
                            onAdvance={onAdvance}
                            archetypeCatalogue={archetypeCatalogue}
                        />
                    </TableCell>
                </TableRow>
            )}
        </>
    );
}
