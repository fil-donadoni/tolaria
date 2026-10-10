// /play/constructed (PRD #5334, issue #5340) — the Constructed setup flow.
// Layout only; the flow itself is `MatchSetupFlow`. Reached from a temporary
// lobby entry until the lobby home replaces the dashboard.
import { useNavigate } from "@tanstack/react-router";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { Button } from "~/components/ui/button";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import LobbyBackground from "~/components/lobby/lobby-background";
import MatchSetupFlow from "~/components/lobby/match-setup/match-setup-flow";

export default function MatchSetupRoute() {
    useDocumentTitle("Constructed");
    const navigate = useNavigate();
    return (
        <div className="relative min-h-full bg-surface-base text-text">
            <SurfaceReadyMarker />
            <LobbyBackground />
            <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
                <header className="flex items-center justify-between gap-3">
                    <h1 className="heading-panel text-left text-2xl">
                        Constructed
                    </h1>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void navigate({ to: "/" })}
                    >
                        Back to lobby
                    </Button>
                </header>
                <MatchSetupFlow />
            </div>
        </div>
    );
}
