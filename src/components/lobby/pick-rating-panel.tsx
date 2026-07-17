import { useState } from "react";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import {
    useScopeCardRatings,
    useCardRatingMutations,
} from "~/hooks/useCardRatings";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import PickRatingScopePicker from "./pick-rating-scope-picker";
import PickRatingEditor from "./pick-rating-editor";

/**
 * The Pick Rating editor's actual content (PRD #1296 Slice C, issue #1300) —
 * mounted only by `PickRatingAdminPanel` once the admin gate has already
 * passed (mirrors `BanlistFormatSyncRow`, mounted only inside
 * `BanlistAdminPanel`'s gate). Owns the data fetching
 * (`useScopeCardRatings`/`useCardRatingMutations`) and hands plain
 * data/callbacks down to the presentational `PickRatingEditor` — mirrors
 * `limited-events-page.tsx` handing `draftableSets` down to
 * `CreateLimitedEventDialog`.
 */
export default function PickRatingPanel() {
    const draftableSets = useDraftableSets();
    // Only a selectable scope makes sense to rate — mirrors the create-event
    // dialog's Draftability gate (a non-Draftable set can't be drafted, so
    // rating it would have no observable effect on a bot pick).
    const scopes = (draftableSets ?? []).filter((s) => s.draftable);
    const [scope, setScope] = useState<string | undefined>(undefined);
    const resolvedScope = scope ?? scopes[0]?.setCode;

    const cards = useScopeCardRatings(resolvedScope);
    const { setRating, clearRating } = useCardRatingMutations();

    return (
        <Panel>
            <PanelHeader
                title="Pick Ratings"
                subtitle="Admin only — tune the Bot Drafter's card evaluation per scope"
            />
            <PanelBody className="flex min-h-0 flex-col gap-3">
                <PickRatingScopePicker
                    scopes={scopes}
                    value={resolvedScope}
                    onChange={setScope}
                />
                {resolvedScope ? (
                    <PickRatingEditor
                        cards={cards}
                        onSave={(cardId, rating) =>
                            setRating({ scope: resolvedScope, cardId, rating })
                        }
                        onClear={(cardId) =>
                            clearRating({ scope: resolvedScope, cardId })
                        }
                    />
                ) : (
                    <p className="text-xs text-text-muted">
                        Select a scope to view/edit its ratings.
                    </p>
                )}
            </PanelBody>
        </Panel>
    );
}
