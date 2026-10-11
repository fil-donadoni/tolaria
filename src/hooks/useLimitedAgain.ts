import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    useLimitedEventMutations,
    type PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import {
    createPayload,
    loadSetup,
    reconcileSetup,
    type LimitedSetup,
} from "~/lib/limited/limitedSetup";
import { extractMutationErrorMessage } from "~/lib/mutation-error";

/** The hub's one-click "Again: your last event" (PRD #5383): starts the
 *  remembered `/limited/new` setup — Draft · Vintage Cube on a first visit —
 *  through the same `createLimitedEvent` payload the setup flow builds, then
 *  opens the new event. `again` is `null` until the catalogue has loaded or
 *  when nothing in it can be created; `summary` says what a click would start.
 *  A single in-flight guard, like the setup flow's Create. */
export function useLimitedAgain(
    sources: readonly PackSourceInfo[] | undefined
) {
    const navigate = useNavigate();
    const { create } = useLimitedEventMutations();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const again = useMemo((): LimitedSetup | null => {
        if (!sources || sources.length === 0) return null;
        const { setup } = reconcileSetup(loadSetup(), sources);
        return createPayload(setup, sources) ? setup : null;
    }, [sources]);

    const summary = useMemo(() => {
        if (!again || !sources) return "";
        const name =
            sources.find((s) => s.key === again.packSource)?.name ??
            again.packSource;
        const type = again.type === "draft" ? "Draft" : "Sealed";
        return `${type} · ${name} · ${again.seats} seats`;
    }, [again, sources]);

    const start = async () => {
        if (busy || !again || !sources) return;
        const payload = createPayload(again, sources);
        if (!payload) return;
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

    return { again, summary, busy, error, start };
}
