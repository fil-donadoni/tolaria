import Lobby from "~/components/lobby/lobby";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

export default function LobbyRoute() {
    useDocumentTitle("Lobby");
    return <Lobby />;
}
