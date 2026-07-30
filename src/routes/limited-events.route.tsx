import LimitedEventsPage from "~/components/limited/limited-events-page";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

export default function LimitedEventsRoute() {
    useDocumentTitle("Limited Events");
    return <LimitedEventsPage />;
}
