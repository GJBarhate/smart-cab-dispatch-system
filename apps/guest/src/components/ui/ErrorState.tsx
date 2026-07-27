import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { ApiError } from '../../api/client';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element {
  const message = error instanceof ApiError ? error.message : 'Something went wrong.';
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-7 w-7 text-red-500" />
      </div>
      <p className="font-semibold text-gray-800">Couldn't load this</p>
      <p className="text-sm text-gray-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      )}
    </div>
  );
}
