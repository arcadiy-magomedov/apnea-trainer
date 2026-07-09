import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', icon: '🏠', label: 'Home' },
  { to: '/stats', icon: '📊', label: 'Stats' },
  { to: '/program', icon: '🗓️', label: 'Program' },
  { to: '/settings', icon: '⚙️', label: 'Settings' },
];

export function TabBar() {
  return (
    <nav className="flex justify-around border-t border-[color:var(--border)] bg-surface py-2">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 text-[11px] ${isActive ? 'text-[color:var(--cyan)]' : 'text-[color:var(--text-mute)]'}`
          }
        >
          <span className="text-lg">{t.icon}</span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
