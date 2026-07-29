import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
const ToastContext = createContext(null);
const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};
const STYLES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-ops-100 bg-ops-50 text-ops-700'
};
export function ToastProvider({
  children
}) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback(t => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, {
      ...t,
      id
    }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== id));
    }, 5000);
  }, []);
  const value = useMemo(() => ({
    push
  }), [push]);
  return <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[1000] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto">
        {toasts.map(t => {
        const Icon = ICONS[t.kind];
        return <div key={t.id} className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-4 py-3 shadow-lg ${STYLES[t.kind]}`} role="status">
              <Icon size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs opacity-90">{t.description}</p>}
              </div>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>;
      })}
      </div>
    </ToastContext.Provider>;
}
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
