import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Admin portal crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle size={32} className="text-red-400" />
          <h2 className="text-lg font-semibold text-ink">This screen hit an unexpected error</h2>
          <p className="max-w-md text-sm text-muted">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded-md bg-ops-600 px-4 py-2 text-sm font-medium text-white hover:bg-ops-700"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
