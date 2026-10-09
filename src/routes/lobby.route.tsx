import Lobby from "~/components/lobby/lobby";
import MatchSetupPrototype from "~/components/lobby/prototype-match-setup/match-setup-prototype";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

export default function LobbyRoute() {
    useDocumentTitle("Lobby");
    // PROTOTYPE — throwaway: ?variant= mounts the match-setup prototype.
    if (
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).has("variant")
    )
        return <MatchSetupPrototype />;
    return <Lobby />;
}
