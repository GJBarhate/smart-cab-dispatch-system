// Render guards for the "Why this driver?" dialog.
//
// The regression this exists for: TripBoard mounts <ExplainAssignment> at all
// times and passes `tripId={explainTarget?.id ?? null}`, so the component is
// permanently rendered with a null tripId until someone clicks the button.
//
// The dialog used to read `q.data!.explanation` in its success branch. With
// `enabled: !!tripId` false, React Query leaves the query `pending` while
// `isFetching` is false — so `isLoading` is false, `isError` is false and
// `data` is undefined simultaneously, and that branch ran. `<Modal open={false}>`
// did not save it: children are an ordinary prop, evaluated before Modal is
// ever called. The result was a TypeError that took out the whole Trip Board
// through the error boundary.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExplainAssignment } from './ExplainAssignment';
function render(ui) {
  const client = new QueryClient({
    // No retries and no network in a render test; the point is the render path,
    // not the fetch.
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });
  return renderToString(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
describe('ExplainAssignment', () => {
  it('renders without throwing when no trip is selected', () => {
    // This is the exact call TripBoard makes on every render.
    expect(() => render(<ExplainAssignment tripId={null} onClose={() => {}} />)).not.toThrow();
  });
  it('renders nothing at all when no trip is selected', () => {
    const html = render(<ExplainAssignment tripId={null} onClose={() => {}} />);
    expect(html).toBe('');
  });
  it('renders without throwing while the explanation is still loading', () => {
    // A selected trip with data not yet resolved — the other state in which the
    // success branch must not run.
    expect(() => render(<ExplainAssignment tripId="6a68a811dd8acd574238789e" tripCode="T-0043" onClose={() => {}} />)).not.toThrow();
  });
  it('shows the dialog with its title once a trip is selected', () => {
    const html = render(<ExplainAssignment tripId="6a68a811dd8acd574238789e" tripCode="T-0043" onClose={() => {}} />);
    expect(html).toContain('Why this driver');
    expect(html).toContain('T-0043');
  });
});
