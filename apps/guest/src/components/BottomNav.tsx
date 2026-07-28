import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, MapPin, PlusCircle, History, User } from 'lucide-react';

const items = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/track', label: 'Track', icon: MapPin },
  { to: '/request', label: 'Request', icon: PlusCircle },
  { to: '/trips', label: 'Trips', icon: History },
  { to: '/profile', label: 'Profile', icon: User }
];

export function BottomNav(): JSX.Element {
  return (
    <nav className="sticky bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-1">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                isActive ? 'text-brand-600' : 'text-faint'
              }`
            }
          >
            <Icon className="h-6 w-6" strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
