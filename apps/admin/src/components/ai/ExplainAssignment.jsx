import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { AiApi } from '../../api/endpoints';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';

/**
 * "Why this driver?" for a single trip.
 *
 * The endpoint behind this is deterministic first: it builds the explanation
 * from the cost breakdown recorded at assignment time, and only asks Gemini to
 * rephrase it when a key is configured. So this dialog is useful on a
 * no-AI deployment, and the numbers are identical either way — which is the
 * whole reason the template was built before the model call.
 */
export function ExplainAssignment({
  tripId,
  tripCode,
  onClose
}) {
  const q = useQuery({
    queryKey: ['ai', 'explain', tripId],
    queryFn: () => AiApi.explain(tripId),
    enabled: !!tripId,
    staleTime: 60_000
  });

  // Bail out before touching the query at all when nothing is selected.
  //
  // `Modal` returns null for a falsy `open`, but that is not enough: children
  // are an ordinary prop, so React evaluates this whole expression *before*
  // Modal ever runs. With `enabled: false` the query sits in `pending` while
  // `isFetching` is false — which makes `isLoading` false, `isError` false and
  // `data` undefined all at once, so the success branch ran and dereferenced
  // undefined. The Trip Board renders this component permanently with a null
  // tripId, so it crashed the page on load rather than on click.
  if (!tripId) return null;
  return <Modal open={!!tripId} onClose={onClose} title={`Why this driver${tripCode ? ` — ${tripCode}` : ''}?`} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.isError ? <p className="text-sm text-red-600">{q.error?.message ?? 'Could not load the explanation.'}</p> : !q.data ?
    // Keyed on the data itself rather than `isLoading`: that flag is false
    // in more states than it looks (disabled, paused, idle-pending), and
    // every one of them would fall through to the branch below with
    // nothing to render.
    <Skeleton className="h-20 w-full" /> : <>
          <p className="text-sm leading-relaxed text-ink">{q.data.explanation}</p>
          <p className="mt-3 flex items-center gap-1 text-[11px] text-faint">
            {q.data.aiPolished ? <>
                <Sparkles size={11} /> Phrased by Gemini from the recorded cost breakdown — the figures are the engine's own.
              </> : <>Generated from the recorded cost breakdown. Deterministic — no AI involved.</>}
          </p>
        </>}
    </Modal>;
}
