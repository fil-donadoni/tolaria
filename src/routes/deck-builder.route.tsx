import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { FormatId } from "@convex/formats";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import DeckBuilder from "~/components/lobby/deck-builder/deck-builder";
import { Button } from "~/components/ui/button";
import LoadingScreen from "~/components/ui/loading-screen";
import ErrorState from "~/components/ui/error-state";
import AmbientPageGround from "~/components/ui/ambient-page-ground";
import { Panel } from "~/components/ui/panel";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import {
    useUserDecks,
    useUserDeckMutations,
    usePresetMutations,
} from "~/hooks/useUserDecks";
import {
    type LobbyDeck,
    toPresetLobbyDeck,
    toUserLobbyDeck,
} from "~/lib/deckTypes";
import {
    type DeckBuilderKind,
    buildDeckBuilderSinks,
    type DeckBuilderSinks,
} from "~/lib/deckBuilderDispatch";
import { useFullCatalogue } from "~/lib/fullCatalogue";

/** The page name for `<title>`. Edit mode names the deck being edited once
 *  its query lands, and falls back to the generic label while it is loading
 *  or when the slug matches nothing. */
function deckBuilderTitle(
    mode: "create" | "edit",
    kind: DeckBuilderKind,
    editingName: string | undefined
): string {
    const noun = kind === "preset" ? "Preset" : "Deck";
    if (mode === "create") return `New ${noun}`;
    return editingName ? `Edit ${editingName}` : `Edit ${noun}`;
}

interface DeckBuilderRouteProps {
    mode: "create" | "edit";
    // "user" (default) edits a user's own deck; "preset" edits an admin
    // Preset Deck loaded by slug (PRD #466, ADR 0033). Create is user-only in
    // this slice (preset create/delete are #469/#470).
    kind?: DeckBuilderKind;
}

export default function DeckBuilderRoute({
    mode,
    kind = "user",
}: DeckBuilderRouteProps) {
    const navigate = useNavigate();
    const params = useParams({ strict: false }) as { slug?: string };
    const slug = mode === "edit" ? params.slug : undefined;
    // New-deck seed format, carried from the lobby's format filter through the
    // `/decks/create` search param (validated there). Absent for edit routes.
    const { format: defaultFormat } = useSearch({ strict: false }) as {
        format?: FormatId;
    };
    const [deleting, setDeleting] = useState(false);

    const userDecks = useUserDecks();
    const { create, update, remove } = useUserDeckMutations();
    const { create: createPreset, update: updatePreset } = usePresetMutations();

    // A single set of mutation sinks; `dispatchDeckSave` selects the pair by
    // `kind`, so the editor itself never branches. The payload SHAPING (strip
    // the immutable `format` from an update patch, ADR 0036; strip the Column
    // Layout from every preset payload, issue #1626) lives in
    // `buildDeckBuilderSinks` where it is unit-tested — this route only
    // supplies the four mutations.
    const sinks = useMemo<DeckBuilderSinks>(
        () =>
            buildDeckBuilderSinks({
                createUserDeck: (payload) => create(payload) as Promise<string>,
                updateUserDeck: async (id, patch) => {
                    await update({ id: id as Id<"userDecks">, patch });
                },
                createPreset: (input) => createPreset({ input }),
                updatePreset: async (slug, patch) => {
                    await updatePreset({ slug, patch });
                },
            }),
        [create, update, createPreset, updatePreset]
    );

    // ---- Preset edit mode: load the single preset by slug ----
    const editingPreset = useQuery(
        api.decks.getPreset,
        kind === "preset" && slug ? { slug } : "skip"
    );
    // ---- User edit mode: load the user deck by id ----
    const editingUserDeck = useQuery(
        api.userDecks.get,
        kind === "user" && slug && !deleting
            ? { id: slug as Id<"userDecks"> }
            : "skip"
    );

    // Lazy-fetch the full ~27K card catalogue (cached, no-op on repeat calls).
    // Mounting here means entering any deck builder route triggers the fetch,
    // so unfiltered searches are pre-warmed when the user opens the search box.
    // On failure the deck builder degrades gracefully: only the `cardIndex.list`
    // (available cards) is shown, with no catalogue cross-reference.
    const fullCatalogue = useFullCatalogue();

    // Above the early returns — the hook must run on every render.
    useDocumentTitle(
        deckBuilderTitle(
            mode,
            kind,
            (kind === "preset" ? editingPreset?.name : editingUserDeck?.name) ??
                undefined
        )
    );

    if (mode === "edit") {
        if (kind === "preset") {
            if (editingPreset === undefined) {
                return <LoadingScreen />;
            }
            if (editingPreset === null) {
                return (
                    <div className="relative flex min-h-full flex-col items-center justify-center bg-surface-base px-4 text-text">
                        <AmbientPageGround ring />
                        <Panel className="relative z-10 w-full max-w-md">
                            <ErrorState
                                message="Preset not found."
                                action={
                                    <Button
                                        variant="secondary"
                                        onClick={() =>
                                            void navigate({ to: "/" })
                                        }
                                    >
                                        Back to lobby
                                    </Button>
                                }
                            />
                        </Panel>
                    </div>
                );
            }
            const presetDeck: LobbyDeck = toPresetLobbyDeck(editingPreset);
            return (
                <DeckBuilder
                    kind="preset"
                    initialDeck={presetDeck}
                    initialIdentity={editingPreset.presetId}
                    initialDeckList={[]}
                    sinks={sinks}
                    fullCatalogue={fullCatalogue}
                    onClose={() => void navigate({ to: "/" })}
                />
            );
        }

        if (editingUserDeck === undefined || userDecks === undefined) {
            return <LoadingScreen />;
        }
        if (editingUserDeck === null) {
            return (
                <div className="relative flex min-h-full flex-col items-center justify-center bg-surface-base px-4 text-text">
                    <AmbientPageGround ring />
                    <Panel className="relative z-10 w-full max-w-md">
                        <ErrorState
                            message="Deck not found."
                            action={
                                <Button
                                    variant="secondary"
                                    onClick={() => void navigate({ to: "/" })}
                                >
                                    Back to lobby
                                </Button>
                            }
                        />
                    </Panel>
                </div>
            );
        }
        const userDeck = toUserLobbyDeck(editingUserDeck);
        return (
            <DeckBuilder
                kind="user"
                initialDeck={userDeck}
                initialIdentity={userDeck.userDeckId}
                initialDeckList={userDecks}
                sinks={sinks}
                fullCatalogue={fullCatalogue}
                onClose={(savedId) => {
                    if (savedId) {
                        void navigate({
                            to: "/decks/$slug",
                            params: { slug: savedId },
                        });
                    } else {
                        void navigate({ to: "/" });
                    }
                }}
                onDelete={async () => {
                    setDeleting(true);
                    await remove({ id: slug as Id<"userDecks"> });
                    void navigate({ to: "/" });
                }}
            />
        );
    }

    // ---- Preset create mode (admin only; server-gated by assertIsAdmin) ----
    // The new preset's slug is derived from its name server-side on first save.
    // On close we return to the lobby, where the reactive `api.decks.list` query
    // already shows the freshly created preset.
    if (kind === "preset") {
        return (
            <DeckBuilder
                kind="preset"
                mode="create"
                initialDeck={null}
                initialIdentity={null}
                initialDeckList={[]}
                sinks={sinks}
                fullCatalogue={fullCatalogue}
                onClose={() => void navigate({ to: "/" })}
            />
        );
    }

    if (userDecks === undefined) {
        return <LoadingScreen />;
    }

    return (
        <DeckBuilder
            kind="user"
            mode="create"
            defaultFormat={defaultFormat}
            initialDeck={null}
            initialIdentity={null}
            initialDeckList={userDecks}
            sinks={sinks}
            fullCatalogue={fullCatalogue}
            onClose={(savedId) => {
                if (savedId) {
                    void navigate({
                        to: "/decks/$slug",
                        params: { slug: savedId },
                    });
                } else {
                    void navigate({ to: "/" });
                }
            }}
        />
    );
}
