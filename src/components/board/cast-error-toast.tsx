import { useEffect, useRef } from "react";

type CastErrorToastProps = {
    message: string | null;
    onDismiss: () => void;
};

export default function CastErrorToast({
    message,
    onDismiss,
}: CastErrorToastProps) {
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        if (message) {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(onDismiss, 2500);
            return () => clearTimeout(timerRef.current);
        }
    }, [message, onDismiss]);

    if (!message) return null;

    return (
        <div className="absolute left-1/2 bottom-48 -translate-x-1/2 z-100 pointer-events-none">
            <div className="relative bg-[#0c0d12]/90 border border-[#a04040]/45 backdrop-blur-md rounded-sm px-4 py-2 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-[#a04040]/45" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-[#a04040]/45" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-[#a04040]/45" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-[#a04040]/45" />
                <p className="font-beleren text-[#d48080] text-sm tracking-wide px-2">
                    Tap {message}
                </p>
            </div>
        </div>
    );
}
