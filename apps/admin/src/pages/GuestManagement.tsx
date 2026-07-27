import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Upload, Pencil, Users, RefreshCcw } from 'lucide-react';
import { AdminApi } from '../api/endpoints';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SkeletonRows } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { useToast } from '../components/ui/Toast';
import { fmtRelative } from '../lib/format';
import type { Guest, GuestStatus } from '../types/models';

const STATUS_TONE: Record<GuestStatus, 'gray' | 'amber' | 'blue' | 'purple' | 'green' | 'red'> = {
  registered: 'gray', awaiting_pickup: 'amber', queued: 'amber', assigned: 'blue',
  in_transit: 'purple', completed: 'green', no_show: 'red'
};

const emptyForm = { bookingRef: '', name: '', phone: '', email: '', groupSize: 1, luggageCount: 1, isVip: false, specialNeeds: '' };

export default function GuestManagement() {
  const qc = useQueryClient();
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editTarget, setEditTarget] = useState<Guest | null>(null);
  const [arrivalDraft, setArrivalDraft] = useState('');
  const [modeDraft, setModeDraft] = useState<'flight' | 'train' | 'road'>('flight');

  const guestsQ = useQuery({ queryKey: ['guests'], queryFn: () => AdminApi.guests(), refetchInterval: 20_000 });

  const createMutation = useMutation({
    mutationFn: AdminApi.createGuest,
    onSuccess: () => {
      push({ kind: 'success', title: 'Walk-in guest added' });
      setForm(emptyForm);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['guests'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Could not add guest', description: e.message })
  });

  const updateArrivalMutation = useMutation({
    mutationFn: ({ id, scheduledAt, mode }: { id: string; scheduledAt: string; mode: string }) =>
      AdminApi.updateGuest(id, { arrival: { mode, scheduledAt: new Date(scheduledAt).toISOString() } }),
    onSuccess: () => {
      push({ kind: 'success', title: 'Arrival updated', description: 'Any waiting queue entry was re-evaluated.' });
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ['guests'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Update failed', description: e.message })
  });

  const importMutation = useMutation({
    mutationFn: AdminApi.importGuests,
    onSuccess: (res) => {
      push({
        kind: res.errors.length ? 'warning' : 'success',
        title: `Imported ${res.created} guest(s)`,
        description: res.errors.length ? `${res.errors.length} row(s) failed` : undefined
      });
      qc.invalidateQueries({ queryKey: ['guests'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Import failed', description: e.message })
  });

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ ...form, groupSize: Number(form.groupSize), luggageCount: Number(form.luggageCount) });
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = '';
  }

  function openEdit(g: Guest) {
    setEditTarget(g);
    setModeDraft(g.arrival?.mode ?? 'flight');
    setArrivalDraft(g.arrival?.scheduledAt ? g.arrival.scheduledAt.slice(0, 16) : '');
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Guest Management</h1>
          <p className="text-sm text-gray-500">Walk-ins, arrival corrections, and bulk CSV import.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChosen} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={importMutation.isPending}>
            <Upload size={14} /> Import CSV
          </Button>
          <Button onClick={() => setShowAdd(true)}><UserPlus size={14} /> Add walk-in</Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {guestsQ.isLoading ? (
          <div className="p-4"><SkeletonRows rows={6} /></div>
        ) : guestsQ.isError ? (
          <div className="p-4"><ErrorState message={(guestsQ.error as any)?.message} onRetry={() => guestsQ.refetch()} /></div>
        ) : !guestsQ.data?.length ? (
          <div className="p-4"><EmptyState icon={Users} title="No guests yet" description="Add a walk-in or import a CSV to get started." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Booking ref</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Group / bags</th>
                  <th className="px-4 py-2.5">Arrival</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {guestsQ.data.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-2.5 font-mono text-xs">{g.bookingRef}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{g.name} {g.isVip && <Badge tone="purple" className="ml-1">VIP</Badge>}</p>
                      <p className="text-xs text-gray-400">{g.phone}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{g.groupSize} pax · {g.luggageCount} bags</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {g.arrival?.scheduledAt ? fmtRelative(g.arrival.scheduledAt) : '—'}
                    </td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[g.status]}>{g.status.replace('_', ' ')}</Badge></td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(g)}>
                        <Pencil size={12} /> Edit arrival
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add walk-in guest">
        <form onSubmit={submitCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Booking ref"><input required value={form.bookingRef} onChange={(e) => setForm({ ...form, bookingRef: e.target.value })} className="input" /></Field>
            <Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
            <Field label="Phone"><input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" /></Field>
            <Field label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" /></Field>
            <Field label="Group size"><input type="number" min={1} value={form.groupSize} onChange={(e) => setForm({ ...form, groupSize: Number(e.target.value) })} className="input" /></Field>
            <Field label="Luggage"><input type="number" min={0} value={form.luggageCount} onChange={(e) => setForm({ ...form, luggageCount: Number(e.target.value) })} className="input" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.isVip} onChange={(e) => setForm({ ...form, isVip: e.target.checked })} />
            VIP priority tier
          </label>
          <Field label="Special needs"><input value={form.specialNeeds} onChange={(e) => setForm({ ...form, specialNeeds: e.target.value })} className="input" placeholder="e.g. wheelchair" /></Field>
          <Button type="submit" className="w-full" loading={createMutation.isPending}>Add guest</Button>
        </form>
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit arrival — ${editTarget?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              loading={updateArrivalMutation.isPending}
              disabled={!arrivalDraft}
              onClick={() => editTarget && updateArrivalMutation.mutate({ id: editTarget.id, scheduledAt: arrivalDraft, mode: modeDraft })}
            >
              <RefreshCcw size={13} /> Save & re-evaluate queue
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Mode">
            <select value={modeDraft} onChange={(e) => setModeDraft(e.target.value as any)} className="input">
              <option value="flight">Flight</option>
              <option value="train">Train</option>
              <option value="road">Road</option>
            </select>
          </Field>
          <Field label="Scheduled arrival">
            <input type="datetime-local" value={arrivalDraft} onChange={(e) => setArrivalDraft(e.target.value)} className="input" />
          </Field>
          <p className="rounded-md bg-ops-50 px-3 py-2 text-xs text-ops-700">
            Changing the arrival time invalidates any waiting queue entry's timing — it will be re-queued at boosted priority rather than dispatched against stale data.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
