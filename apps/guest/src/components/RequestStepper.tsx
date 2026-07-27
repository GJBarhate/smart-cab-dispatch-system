import React from 'react';
import { format } from 'date-fns';
import { Hourglass, XCircle } from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import type { RideRequestView, TripView } from '../types/domain';

const STEP_LABELS = ['Requested', 'Approval', 'Driver assigned', 'On the way'];

const TRIP_ON_THE_WAY_STATUSES = new Set(['en_route_pickup', 'at_pickup', 'boarded']);

// "Requested" (index 0) is complete the instant a request exists, so the active
// step is always at least 1 — it marks what's currently in progress, not what's done.
function stepIndexFor(request: RideRequestView): number {
  if (request.status === 'pending_approval') return 1; // requested done, approval in progress
  if (request.status === 'approved') return 2; // approval done, finding a driver
  if (request.status === 'matched') return 3; // driver assigned; may or may not be moving yet
  return 1;
}

function isOnTheWay(trip?: TripView | null): boolean {
  return !!trip && TRIP_ON_THE_WAY_STATUSES.has(trip.status);
}

export function RequestStepper({
  request,
  trip,
  onCancel,
  cancelling
}: {
  request: RideRequestView;
  trip?: TripView | null;
  onCancel: () => void;
  cancelling: boolean;
}): JSX.Element {
  if (request.status === 'declined') {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
          <XCircle className="h-7 w-7 text-red-500" />
        </div>
        <p className="font-semibold text-gray-800">Request declined</p>
        {request.declineReason && <p className="mt-1 text-sm text-gray-500">{request.declineReason}</p>}
      </Card>
    );
  }

  if (request.status === 'expired') {
    return (
      <Card className="text-center">
        <p className="font-semibold text-gray-800">This request is no longer active</p>
        <p className="mt-1 text-sm text-gray-500">It was cancelled or expired.</p>
      </Card>
    );
  }

  const activeStep = stepIndexFor(request);
  const onTheWay = isOnTheWay(trip);

  return (
    <Card>
      <div className="flex flex-col items-center py-2 text-center">
        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
          <Hourglass className="h-8 w-8 animate-pulse text-brand-500" />
        </div>
        <p className="text-lg font-bold text-gray-800">
          {onTheWay ? 'Your driver is on the way' : activeStep === 3 ? 'Driver assigned!' : activeStep === 2 ? 'Finding your driver…' : 'Request sent'}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {activeStep === 1 && 'Waiting for the operations team to approve'}
          {activeStep === 2 && 'Your driver is assigned automatically for the fastest pickup.'}
          {activeStep === 3 && (onTheWay ? 'Track live progress on the Track tab.' : 'Your driver will start heading to you shortly.')}
        </p>
      </div>

      <ol className="mt-4 space-y-3">
        {STEP_LABELS.map((label, i) => {
          const done = i === 0 || i < activeStep || (i === 3 && onTheWay);
          const active = i === activeStep && !(i === 3 && onTheWay);
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${
                  done ? 'bg-brand-600' : active ? 'bg-brand-400 ring-4 ring-brand-100' : 'bg-gray-200'
                }`}
              />
              <span className={`text-sm ${done || active ? 'font-medium text-gray-800' : 'text-gray-400'}`}>{label}</span>
              {i === 0 && <span className="ml-auto text-xs text-gray-400">{format(new Date(request.requestedAt), 'HH:mm')}</span>}
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-center text-xs text-gray-400">Your driver is assigned automatically for the fastest pickup.</p>

      {request.status === 'pending_approval' && (
        <Button variant="danger" fullWidth className="mt-4" onClick={onCancel} loading={cancelling}>
          Cancel request
        </Button>
      )}
    </Card>
  );
}
