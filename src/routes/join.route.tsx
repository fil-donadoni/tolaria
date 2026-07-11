import { useParams } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import JoinGame from "~/components/join/join-game";

export default function JoinRoute() {
    const { gameId } = useParams({ from: "/join/$gameId" });
    return <JoinGame gameId={gameId as Id<"games">} />;
}
