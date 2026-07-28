import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

const DISMISS_KEY = 'eventride_install_dismissed';

export function InstallPrompt(): JSX.Element | null {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [showIosHint, setShowIosHint] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    if (isIos()) setShowIosHint(true);

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (dismissed || isStandalone() || (!deferred && !showIosHint)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <Card className="relative mb-4 border border-brand-100 bg-brand-50">
      <button aria-label="Dismiss" onClick={dismiss} className="absolute right-3 top-3 text-faint active:text-muted">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
          <Download className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-ink">Install EventRide</p>
          {deferred ? (
            <>
              <p className="text-sm text-muted">Add it to your home screen for one-tap access to your ride.</p>
              <Button
                className="mt-2 min-h-[36px] px-4 py-1 text-sm"
                loading={installing}
                onClick={async () => {
                  setInstalling(true);
                  try {
                    await deferred.prompt();
                    await deferred.userChoice;
                    setDeferred(null);
                  } finally {
                    setInstalling(false);
                  }
                }}
              >
                Install
              </Button>
            </>
          ) : (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted">
              Tap <Share className="inline h-4 w-4" /> Share, then "Add to Home Screen".
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
