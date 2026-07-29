import { AlertOctagon } from 'lucide-react';
import { Button } from './Button';
export function ErrorState({
  message,
  onRetry
}) {
  return <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertOctagon size={28} className="text-red-400" />
      <p className="text-sm font-medium text-red-700">Something went wrong</p>
      {message && <p className="max-w-xs text-xs text-red-600">{message}</p>}
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Retry
        </Button>}
    </div>;
}
