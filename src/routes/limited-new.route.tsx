// /limited/new (PRD #5383, issue #5387) — the Limited event setup flow, which
// replaced the create dialog. Layout only; the flow itself is
// `LimitedSetupFlow`.
import { useNavigate } from "@tanstack/react-router";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { Button } from "~/components/ui/button";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import LobbyBackground from "~/components/lobby/lobby-background";
import LimitedSetupFlow from "~/components/limited/limited-setup/limited-setup-flow";

export default function LimitedNewRoute() {
    useDocumentTitle("New Limited Event");
    const navigate = useNavigate();
    return (
        <div className="relative min-h-full bg-surface-base text-text">
            <SurfaceReadyMarker />
            <LobbyBackground />
            <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
                <header className="flex items-center justify-between gap-3">
                    <h1 className="heading-panel text-left text-2xl">
                        New Limited Event
                    </h1>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void navigate({ to: "/limited" })}
                    >
                        Back to events
                    </Button>
                </header>
                <LimitedSetupFlow />
            </div>
        </div>
    );
}
