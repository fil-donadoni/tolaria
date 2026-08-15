import LimitedYourEventsPage from "~/components/limited/limited-your-events-page";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

export default function LimitedYourEventsRoute() {
    useDocumentTitle("Your Limited Events");
    return <LimitedYourEventsPage />;
}
