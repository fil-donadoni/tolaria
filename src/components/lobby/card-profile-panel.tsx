import { useState } from "react";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import {
    useScopeCardProfiles,
    useCardProfileMutations,
} from "~/hooks/useCardProfiles";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import LimitedScopePicker from "./limited-scope-picker";
import CardProfileEditor from "./card-profile-editor";

/**
 * The Card Profile editor's actual content (PRD #1607, ADR 0072, issue
 * #1614) — mounted only by `CardProfileAdminPanel` once the admin gate has
 * already passed (mirrors `PickRatingPanel` inside `PickRatingAdminPanel`'s
 * gate). Owns the data fetching (`useScopeCardProfiles` /
 * `useCardProfileMutations`) and hands plain data/callbacks down to the
 * presentational `CardProfileEditor`.
 */
export default function CardProfilePanel() {
    const draftableSets = useDraftableSets();
    // Only a selectable scope makes sense to profile — same Draftability
    // gate the Pick Rating editor applies: a non-Draftable set can't be
    // drafted, so profiling it would have no observable effect on a bot pick.
    const scopes = (draftableSets ?? []).filter((s) => s.draftable);
    const [scope, setScope] = useState<string | undefined>(undefined);
    const resolvedScope = scope ?? scopes[0]?.setCode;

    const cards = useScopeCardProfiles(resolvedScope);
    const { setProfile, clearProfile } = useCardProfileMutations();

    return (
        <Panel>
            <PanelHeader
                title="Card Profiles"
                subtitle="Admin only — review the LLM-seeded Archetype/Capability census the Bot Drafter's synergy terms read"
            />
            <PanelBody className="flex min-h-0 flex-col gap-3">
                <LimitedScopePicker
                    scopes={scopes}
                    value={resolvedScope}
                    onChange={setScope}
                    ariaLabel="Profile Scope"
                />
                {resolvedScope ? (
                    <CardProfileEditor
                        cards={cards}
                        onSave={(cardId, profile) =>
                            setProfile({
                                scope: resolvedScope,
                                cardId,
                                ...profile,
                            })
                        }
                        onClear={(cardId) =>
                            clearProfile({ scope: resolvedScope, cardId })
                        }
                    />
                ) : (
                    <p className="text-xs text-text-muted">
                        Select a scope to view/edit its Card Profiles.
                    </p>
                )}
            </PanelBody>
        </Panel>
    );
}
