import React from 'react';
import { AlertOctagon } from 'lucide-react';
import { Button } from './ui/Button';
export class ErrorBoundary extends React.Component {
  state = {
    hasError: false
  };
  static getDerivedStateFromError() {
    return {
      hasError: true
    };
  }
  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('Guest app crashed:', error);
  }
  render() {
    if (this.state.hasError) {
      return <div className="flex h-full flex-col items-center justify-center gap-3 bg-brand-50 p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <AlertOctagon className="h-7 w-7 text-red-500" />
          </div>
          <p className="font-semibold text-ink">Something went wrong</p>
          <p className="text-sm text-muted">Please reload the app.</p>
          <Button className="mt-2" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>;
    }
    return this.props.children;
  }
}
