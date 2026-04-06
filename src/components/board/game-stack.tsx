import type { StackItem } from "~/types/game";
import CardImage from "../cards/card-image";

type GameStackProps = {
    stack: StackItem[];
};

export default function GameStack({ stack }: GameStackProps) {
    // Display in LIFO order: last cast on top (leftmost)
    const reversed = [...stack].reverse();

    return (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
            <div className="flex items-center bg-black/60 rounded-lg p-3 backdrop-blur-sm">
                {reversed.map((item, i) => (
                    <div
                        key={item.id}
                        className="w-32 shrink-0"
                        style={{
                            marginLeft: i > 0 ? "-4rem" : undefined,
                            zIndex: reversed.length - i,
                        }}
                    >
                        <CardImage card={item.card} />
                    </div>
                ))}
            </div>
        </div>
    );
}
