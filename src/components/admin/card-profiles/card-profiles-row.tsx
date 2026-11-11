import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { TableCell, TableRow } from "~/components/ui/table";
import CardImage from "~/components/cards/card-image";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import CardProfilesStatusBadge from "./card-profiles-status-badge";
import {
    effectiveProfile,
    profileStatus,
    type ProfileSortKey,
    type ProfileTab,
} from "./card-profiles-model";

interface CardProfilesRowProps {
    card: ScopeCardProfile;
    tab: ProfileTab;
    columns: readonly ProfileSortKey[];
    /** Whether this row's card is the one open in the focus dialog. */
    open: boolean;
    onOpen: () => void;
}

function listText(list: readonly string[] | undefined): string {
    return list === undefined || list.length === 0 ? "—" : list.join(", ");
}

/** One card of the Card Profiles table. The whole row is the click target
 *  and opens the card in the focus dialog (issue #8904); the Open button is
 *  the keyboard path and where focus returns when the dialog closes on it. */
export default function CardProfilesRow({
    card,
    tab,
    columns,
    open,
    onOpen,
}: CardProfilesRowProps) {
    const effective = effectiveProfile(card);
    const wasOpen = useRef(false);
    const openId = `card-profile-open-${card.cardId}`;

    // The dialog closing on this card hands focus back to its Open button,
    // not `<body>`.
    useEffect(() => {
        if (!open && wasOpen.current) {
            document.getElementById(openId)?.focus();
        }
        wasOpen.current = open;
    }, [open, openId]);

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
                        <CardProfilesStatusBadge
                            status={profileStatus(card, tab)}
                        />
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
        <TableRow
            className={open ? "cursor-pointer bg-accent/15" : "cursor-pointer"}
            onClick={onOpen}
        >
            {columns.map(cell)}
            <TableCell className="text-right">
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    id={openId}
                    aria-haspopup="dialog"
                >
                    Open
                </Button>
            </TableCell>
        </TableRow>
    );
}
