import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Sparkles, Send, Info } from 'lucide-react';
import { AiApi } from '../../api/endpoints';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';

const SUGGESTIONS = [
  'Which guests have been waiting longest?',
  'Any drivers idle for over 20 minutes?',
  'How many arrivals are still unassigned?'
];

/**
 * The read-only AI surface (plan.md §19). Two things are deliberate here:
 *
 *  - The shift digest renders whether or not Gemini is configured, because the
 *    server computes the numbers itself and only uses the model to phrase them.
 *    An "AI off" deployment still gets a useful panel.
 *  - Nothing on this panel can change a dispatch decision. It reads; the engine
 *    decides. The caption says so on screen, because that separation is the
 *    point rather than a caveat.
 */
export function OpsCopilot({ aiEnabled }: { aiEnabled: boolean }) {
  const [question, setQuestion] = useState('');
  const digestQ = useQuery({ queryKey: ['ai', 'digest'], queryFn: () => AiApi.digest(4), refetchInterval: 120_000 });
  const askMutation = useMutation({ mutationFn: AiApi.ask });

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || askMutation.isPending) return;
    setQuestion(trimmed);
    askMutation.mutate(trimmed);
  }

  const answer = askMutation.data;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-ops-600" />
            Ops copilot
            {!aiEnabled && <Badge tone="gray">AI off</Badge>}
          </span>
        }
        subtitle="Read-only. Matching stays fully deterministic — no model output ever reaches a dispatch decision."
      />
      <CardBody className="space-y-3">
        {/* Shift digest */}
        <div className="rounded-lg border border-line-soft bg-elevated p-3">
          {digestQ.isError ? (
            <p className="text-xs text-muted">Digest unavailable right now.</p>
          ) : !digestQ.data ? (
            // Keyed on the data, not `isLoading` — see ExplainAssignment: that
            // flag is false in several states where `data` is still undefined.
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                Last {digestQ.data.stats.hours}h
                {digestQ.data.aiPolished && <Sparkles size={10} className="text-ops-500" />}
              </p>
              <p className="text-sm text-ink">{digestQ.data.digest}</p>
            </>
          )}
        </div>

        {aiEnabled ? (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(question);
              }}
              className="flex gap-2"
            >
              <label className="sr-only" htmlFor="copilot-question">Ask about the current operation</label>
              <input
                id="copilot-question"
                className="input"
                placeholder="Ask about waiting guests, idle drivers…"
                value={question}
                maxLength={300}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <Button type="submit" loading={askMutation.isPending} disabled={!question.trim()} aria-label="Ask">
                <Send size={14} />
              </Button>
            </form>

            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-600"
                >
                  {s}
                </button>
              ))}
            </div>

            {askMutation.isError && (
              <p className="text-xs text-red-600">{(askMutation.error as any)?.message ?? 'That query failed.'}</p>
            )}

            {answer && (
              <div className="rounded-lg border border-ops-100 bg-ops-50 p-3">
                <p className="text-sm text-ink">{answer.available ? answer.answer : answer.message}</p>
                {!!answer.rows?.length && (
                  <p className="mt-1 text-[11px] text-muted">
                    Summarised from {answer.rows.length} record{answer.rows.length === 1 ? '' : 's'} returned by a
                    hand-written, parameterised query — the model never touches the database.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Info size={13} className="mt-0.5 shrink-0" />
            Natural-language queries need <code className="rounded bg-elevated px-1">GEMINI_API_KEY</code> set on the server.
            Everything else on this dashboard — including the digest above and the assignment explanations — works without it.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
