import GameDialog from "~/components/ui/game-dialog";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import CardProfileFocusEditor from "./card-profile-focus-editor";
import type { LayerSave, ProfileTab } from "./card-profiles-model";

interface CardProfileFocusDialogProps {
    tab: ProfileTab;
    /** The open card, read LIVE from the scope query; `null` = closed. */
    card: ScopeCardProfile | null;
    /** Its place in the walk (`index` 0-based). */
    index: number;
    total: number;
    scopeCards: readonly ScopeCardProfile[];
    archetypeCatalogue: readonly ArchetypeCatalogueRow[];
    onSave: (card: ScopeCardProfile, save: LayerSave) => Promise<unknown>;
    onClear: (card: ScopeCardProfile) => Promise<unknown>;
    /** Steps the walk; `null` at its first card. */
    onPrev: (() => void) | null;
    onNext: () => void;
    onClose: () => void;
}

const TAB_NOUN: Record<ProfileTab, string> = {
    capabilities: "Capabilities",
    archetypes: "Archetypes",
};

/** The Card Profiles focus dialog (PRD #8772, issue #8904; prototype
 *  verdict D): a table row opens its card here, and the dialog walks the
 *  table's filtered, sorted list in order. The body is keyed on the card so
 *  each step mounts a fresh editor seeded from the card's current profile. */
export default function CardProfileFocusDialog({
    tab,
    card,
    index,
    total,
    scopeCards,
    archetypeCatalogue,
    onSave,
    onClear,
    onPrev,
    onNext,
    onClose,
}: CardProfileFocusDialogProps) {
    return (
        <GameDialog
            open={card !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title={card?.name ?? ""}
            subtitle={
                card
                    ? `${TAB_NOUN[tab]} · ${index + 1} of ${total} in the current list`
                    : undefined
            }
            align="start"
            size="wide"
            className="max-w-6xl"
            showCloseButton
        >
            {card && (
                <CardProfileFocusEditor
                    key={`${tab}:${card.cardId}`}
                    tab={tab}
                    card={card}
                    scopeCards={scopeCards}
                    archetypeCatalogue={archetypeCatalogue}
                    onSave={(save) => onSave(card, save)}
                    onClear={() => onClear(card)}
                    onPrev={onPrev}
                    onNext={onNext}
                />
            )}
        </GameDialog>
    );
}
