// Render guards for the guest app's shared primitives.
//
// These are the components every screen is built from, so a regression here is
// a regression everywhere. `renderToString` catches the failure mode that
// actually bit this project twice: a component that throws while building its
// element tree, which typecheck and build both pass straight over.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Button } from './Button';
import { Badge } from './Badge';
import { Card } from './Card';
import { Skeleton, CardSkeleton, ListSkeleton } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
describe('Button', () => {
  it('renders every variant without throwing', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'ghost']) {
      expect(() => renderToString(<Button variant={variant}>Go</Button>)).not.toThrow();
    }
  });
  it('meets the 48px touch target the layout assumes', () => {
    // Anything smaller fails the tap-target guidance this app is built around.
    expect(renderToString(<Button>Go</Button>)).toContain('min-h-[48px]');
  });
  it('disables itself while loading so a request cannot be double-sent', () => {
    const html = renderToString(<Button loading>Go</Button>);
    expect(html).toContain('disabled');
  });
  it('still renders its label while loading', () => {
    // A spinner that replaces the label leaves the user guessing what is
    // in flight.
    expect(renderToString(<Button loading>Book a ride</Button>)).toContain('Book a ride');
  });
});
describe('Badge', () => {
  it('renders every tone without throwing', () => {
    for (const tone of ['neutral', 'brand', 'success', 'warning', 'danger']) {
      expect(() => renderToString(<Badge tone={tone}>x</Badge>)).not.toThrow();
    }
  });
});
describe('Card / Skeleton', () => {
  it('Card renders its children', () => {
    expect(renderToString(<Card>inner</Card>)).toContain('inner');
  });
  it('skeletons render without throwing', () => {
    expect(() => renderToString(<Skeleton className="h-4" />)).not.toThrow();
    expect(() => renderToString(<CardSkeleton />)).not.toThrow();
    expect(() => renderToString(<ListSkeleton rows={3} />)).not.toThrow();
  });
  it('ListSkeleton renders the number of rows asked for', () => {
    const html = renderToString(<ListSkeleton rows={4} />);
    expect(html.split('er-shimmer').length - 1).toBeGreaterThanOrEqual(4);
  });
});
describe('ConfirmDialog', () => {
  const props = {
    title: 'Cancel this ride?',
    message: 'Your driver will be released.',
    onConfirm: () => {},
    onCancel: () => {}
  };
  it('renders nothing when closed', () => {
    expect(renderToString(<ConfirmDialog open={false} {...props} />)).toBe('');
  });
  it('renders as a labelled modal dialog when open', () => {
    const html = renderToString(<ConfirmDialog open {...props} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // Both the title and the body must be wired to the dialog, or a screen
    // reader announces an unnamed box.
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('aria-describedby');
    expect(html).toContain('Cancel this ride?');
    expect(html).toContain('Your driver will be released.');
  });
  it('is focusable so focus can be moved into it on open', () => {
    expect(renderToString(<ConfirmDialog open {...props} />)).toContain('tabindex="-1"');
  });
});
