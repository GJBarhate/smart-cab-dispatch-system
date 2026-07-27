import React from 'react';
import { AlertOctagon } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console
    console.error('Guest app crashed:', error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-brand-50 p-6 text-center">
          <AlertOctagon className="h-10 w-10 text-red-500" />
          <p className="font-semibold text-gray-800">Something went wrong</p>
          <p className="text-sm text-gray-500">Please reload the app.</p>
          <button
            className="mt-2 min-h-[44px] rounded-xl bg-brand-600 px-5 font-semibold text-white"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
