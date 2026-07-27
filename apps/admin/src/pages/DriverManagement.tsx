import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Copy, Check, ShieldOff, UserRound } from 'lucide-react';
import { AdminApi } from '../api/endpoints';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SkeletonRows } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { useToast } from '../components/ui/Toast';
import { DRIVER_STATUS_LABEL } from '../components/map/driverIcons';
import type { DriverStatus, VehicleType } from '../types/models';

const STATUS_TONE: Record<DriverStatus, 'green' | 'blue' | 'amber' | 'purple' | 'gray' | 'red'> = {
  idle: 'green', assigned: 'blue', en_route_pickup: 'blue', at_pickup: 'amber',
  on_trip: 'purple', on_break: 'gray', offline: 'gray', suspended: 'red'
};

const emptyForm = {
  name: '', phone: '', licenseNo: '', vehicleNumber: '', vehicleModel: '', vehicleColour: '',
  vehicleType: 'sedan' as VehicleType, seats: 4, luggage: 3
};

export default function DriverManagement() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [generated, setGenerated] = useState<{ name: string; phone: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<string | null>(null);

  const driversQ = useQuery({ queryKey: ['drivers'], queryFn: () => AdminApi.drivers(), refetchInterval: 20_000 });

  const createMutation = useMutation({
    mutationFn: AdminApi.createDriver,
    onSuccess: (res) => {
      setGenerated({ name: res.driver.name, phone: res.driver.phone, password: res.generatedPassword });
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ['drivers'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Could not add driver', description: e.message })
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => AdminApi.updateDriver(id, { status: 'suspended' }),
    onSuccess: () => {
      push({ kind: 'info', title: 'Driver suspended', description: 'Any active trip was auto-requeued.' });
      setSuspendTarget(null);
      qc.invalidateQueries({ queryKey: ['drivers'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Suspend failed', description: e.message })
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => AdminApi.updateDriver(id, { status: 'offline' }),
    onSuccess: () => {
      push({ kind: 'success', title: 'Driver reactivated' });
      qc.invalidateQueries({ queryKey: ['drivers'] });
    }
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ ...form, seats: Number(form.seats), luggage: Number(form.luggage) });
  }

  function closeAddModal() {
    setShowAdd(false);
    setGenerated(null);
    setCopied(false);
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Driver Management</h1>
          <p className="text-sm text-gray-500">Onboarding, suspension, and fleet status.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><UserPlus size={15} /> Add driver</Button>
      </div>

      <Card className="overflow-hidden">
        {driversQ.isLoading ? (
          <div className="p-4"><SkeletonRows rows={6} /></div>
        ) : driversQ.isError ? (
          <div className="p-4"><ErrorState message={(driversQ.error as any)?.message} onRetry={() => driversQ.refetch()} /></div>
        ) : !driversQ.data?.length ? (
          <div className="p-4"><EmptyState icon={UserRound} title="No drivers yet" description="Add your fleet's drivers to get started." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Vehicle</th>
                  <th className="px-4 py-2.5">Capacity</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Trips done</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {driversQ.data.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{d.name}</p>
                      <p className="text-xs text-gray-400">{d.phone}</p>
                    </td>
                    <td className="px-4 py-2.5">{d.vehicle.number} <span className="text-xs text-gray-400 capitalize">({d.vehicle.type})</span></td>
                    <td className="px-4 py-2.5 text-xs">{d.capacity.seats} seats · {d.capacity.luggage} bags</td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[d.status]}>{DRIVER_STATUS_LABEL[d.status]}</Badge></td>
                    <td className="px-4 py-2.5 tabular-nums">{d.stats.tripsCompleted}</td>
                    <td className="px-4 py-2.5 text-right">
                      {d.status === 'suspended' ? (
                        <Button size="sm" variant="secondary" onClick={() => reactivateMutation.mutate(d.id)}>Reactivate</Button>
                      ) : (
                        <Button size="sm" variant="danger" onClick={() => setSuspendTarget(d.id)}>
                          <ShieldOff size={12} /> Suspend
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showAdd} onClose={closeAddModal} title={generated ? 'Driver created' : 'Add driver'} size="md">
        {generated ? (
          <div className="space-y-3">
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              This password is shown once. Copy it now — it cannot be retrieved later.
            </p>
            <div className="rounded-lg border border-gray-200 p-3 text-sm">
              <p><span className="text-gray-500">Name:</span> {generated.name}</p>
              <p><span className="text-gray-500">Phone (login):</span> {generated.phone}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded bg-gray-100 px-2 py-1.5 text-sm">{generated.password}</code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(generated.password);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={closeAddModal}>Done</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
              <Field label="Phone"><input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" /></Field>
              <Field label="Vehicle number"><input required value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} className="input" /></Field>
              <Field label="Vehicle model"><input value={form.vehicleModel} onChange={(e) => setForm({ ...form, vehicleModel: e.target.value })} className="input" /></Field>
              <Field label="Colour"><input value={form.vehicleColour} onChange={(e) => setForm({ ...form, vehicleColour: e.target.value })} className="input" /></Field>
              <Field label="Type">
                <select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value as VehicleType })} className="input">
                  <option value="sedan">Sedan</option>
                  <option value="suv">SUV</option>
                  <option value="tempo">Tempo</option>
                  <option value="bus">Bus</option>
                </select>
              </Field>
              <Field label="Seats"><input type="number" min={1} required value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} className="input" /></Field>
              <Field label="Luggage"><input type="number" min={0} required value={form.luggage} onChange={(e) => setForm({ ...form, luggage: Number(e.target.value) })} className="input" /></Field>
              <Field label="License no."><input value={form.licenseNo} onChange={(e) => setForm({ ...form, licenseNo: e.target.value })} className="input" /></Field>
            </div>
            <Button type="submit" className="w-full" loading={createMutation.isPending}>Create driver</Button>
          </form>
        )}
      </Modal>

      <Modal
        open={!!suspendTarget}
        onClose={() => setSuspendTarget(null)}
        title="Suspend driver"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSuspendTarget(null)}>Cancel</Button>
            <Button variant="danger" loading={suspendMutation.isPending} onClick={() => suspendTarget && suspendMutation.mutate(suspendTarget)}>Confirm suspend</Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">If this driver has an active trip, its guests will be automatically re-queued.</p>
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
