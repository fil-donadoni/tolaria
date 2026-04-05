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
        <div className="absolute left-1/2 bottom-48 -translate-x-1/2 z-50 bg-red-900/90 text-white px-4 py-2 rounded-lg text-sm font-medium backdrop-blur-sm">
            Tap {message}
        </div>
    );
}
