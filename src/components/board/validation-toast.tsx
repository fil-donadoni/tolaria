import { useEffect, useRef } from "react";

type ValidationToastProps = {
    message: string | null;
    onDismiss: () => void;
};

export default function ValidationToast({
    message,
    onDismiss,
}: ValidationToastProps) {
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        if (!message) return;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(onDismiss, 2500);
        return () => clearTimeout(timerRef.current);
    }, [message, onDismiss]);

    if (!message) return null;

    return (
        <div className="fixed left-1/2 bottom-24 -translate-x-1/2 z-50 bg-red-900/90 text-white px-4 py-2 rounded-lg text-sm font-medium backdrop-blur-sm shadow-lg pointer-events-none">
            {message}
        </div>
    );
}
