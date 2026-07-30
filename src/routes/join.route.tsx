import { useParams } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import JoinGame from "~/components/join/join-game";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

export default function JoinRoute() {
    const { gameId } = useParams({ from: "/join/$gameId" });
    useDocumentTitle("Join Game");
    return <JoinGame gameId={gameId as Id<"games">} />;
}
