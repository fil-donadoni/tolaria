// The Limited setup flow (PRD #5383, issue #5387): loads the Pack Source
// catalogue, holds the remembered setup and turns Create into the one
// `createLimitedEvent` call. Every rule lives in `~/lib/limited/limitedSetup`;
// this component only wires it to Convex and storage.
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    useLimitedEventMutations,
    usePackSources,
} from "~/hooks/useLimitedEvent";
import {
    applyChange,
    createPayload,
    loadSetup,
    reconcileSetup,
    saveSetup,
    type LimitedSetup,
} from "~/lib/limited/limitedSetup";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import LoadingScreen from "~/components/ui/loading-screen";
import LimitedSetupPanes from "./limited-setup-panes";

export default function LimitedSetupFlow() {
    const navigate = useNavigate();
    const packSources = usePackSources();
    const { create } = useLimitedEventMutations();
    const [stored, setStored] = useState<LimitedSetup>(loadSetup);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sources = useMemo(() => packSources ?? [], [packSources]);
    // A remembered source that is no longer draftable is replaced before it is
    // ever shown, with a note saying so.
    const { setup, note } = useMemo(
        () => reconcileSetup(stored, sources),
        [stored, sources]
    );

    if (packSources === undefined) return <LoadingScreen />;

    const payload = createPayload(setup, sources);

    const update = (patch: Partial<LimitedSetup>) => {
        // From the stored setup, not the reconciled view: the view clamps seats
        // to the source in force, and saving that would shrink the table for good.
        const next = applyChange(stored, patch, sources);
        setStored(next);
        saveSetup(next);
    };

    const submit = async () => {
        if (busy || !payload) return;
        setBusy(true);
        setError(null);
        try {
            const eventId = await create(payload);
            void navigate({ to: "/limited/$eventId", params: { eventId } });
        } catch (err) {
            setError(extractMutationErrorMessage(err));
            setBusy(false);
        }
    };

    return (
        <LimitedSetupPanes
            setup={setup}
            sources={sources}
            note={note}
            onChange={update}
            canCreate={payload !== null}
            busy={busy}
            error={error}
            onCreate={() => void submit()}
        />
    );
}
