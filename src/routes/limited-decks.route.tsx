import LimitedDeckArchivePage from "~/components/lobby/limited-deck-archive-page";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

export default function LimitedDecksRoute() {
    useDocumentTitle("Limited Deck Archive");
    return <LimitedDeckArchivePage />;
}
