import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  CalculatorIcon,
  ClipboardIcon,
  CompareIcon,
  DashboardIcon,
  HistoryIcon,
  ImageIcon,
  LayersIcon,
  LeafIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  PerformanceIcon,
  ProfileIcon,
  SunIcon,
  UploadIcon,
  CloseIcon,
  ClockIcon,
} from '../components/Icons';

const NAV_GROUPS = [
  {
    label: 'AI grading',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
      { to: '/upload', label: 'New prediction', icon: UploadIcon },
      { to: '/history', label: 'Prediction history', icon: HistoryIcon },
    ],
  },
  {
    label: 'AI analysis',
    items: [
      { to: '/compare', label: 'Compare predictions', icon: CompareIcon },
      { to: '/performance', label: 'Model performance', icon: PerformanceIcon },
    ],
  },
  {
    label: 'Manual grading',
    items: [
      { to: '/manual', label: 'Manual overview', icon: ClipboardIcon, end: true },
      { to: '/manual/new', label: 'New manual record', icon: UploadIcon },
      { to: '/manual/records', label: 'Manual records', icon: HistoryIcon },
      { to: '/manual/batches', label: 'Batches', icon: LayersIcon },
      { to: '/manual/gallery', label: 'Sample gallery', icon: ImageIcon },
      { to: '/manual/calculator', label: 'Value calculator', icon: CalculatorIcon },
      { to: '/manual/activity', label: 'Activity log', icon: ClockIcon },
    ],
  },
  {
    label: 'Account',
    items: [{ to: '/profile', label: 'Profile & settings', icon: ProfileIcon }],
  },
];

const TITLES = {
  '/home': { eyebrow: 'Overview', title: 'Welcome back' },
  '/dashboard': { eyebrow: 'Overview', title: 'Quality dashboard' },
  '/result': { eyebrow: 'Prediction', title: 'Grading result' },
  '/upload': { eyebrow: 'New prediction', title: 'Grade a tray image' },
  '/history': { eyebrow: 'Records', title: 'Prediction history' },
  '/lots': { eyebrow: 'Records', title: 'Upload lots' },
  '/compare': { eyebrow: 'Analysis', title: 'Compare predictions' },
  '/performance': { eyebrow: 'Model', title: 'Performance & verification' },
  '/profile': { eyebrow: 'Account', title: 'Profile & settings' },
  '/manual': { eyebrow: 'Manual grading', title: 'Manual workspace' },
  '/manual/new': { eyebrow: 'Manual grading', title: 'Add a manual record' },
  '/manual/records': { eyebrow: 'Manual grading', title: 'Grading history' },
  '/manual/batches': { eyebrow: 'Manual grading', title: 'Batch workspace' },
  '/manual/compare': { eyebrow: 'Manual grading', title: 'Compare records' },
  '/manual/gallery': { eyebrow: 'Manual grading', title: 'Sample gallery' },
  '/manual/calculator': { eyebrow: 'Manual grading', title: 'Value calculator' },
  '/manual/activity': { eyebrow: 'Manual grading', title: 'Activity log' },
};

function pageMeta(pathname) {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/manual/records/')) {
    return { eyebrow: 'Manual grading · record', title: 'Grading record detail' };
  }
  if (pathname.startsWith('/manual/batches/')) {
    return { eyebrow: 'Manual grading · batch', title: 'Batch detail' };
  }
  if (pathname.startsWith('/lots/')) {
    return { eyebrow: 'Records', title: 'Upload lot detail' };
  }
  if (pathname.startsWith('/result/')) {
    return { eyebrow: 'Prediction', title: 'Grading result' };
  }
  return { eyebrow: 'ARECANUT QUALITY GRADING SYSTEM', title: 'Workspace' };
}


function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-emerald-600 text-white shadow-lg shadow-forest-900/20">
        <LeafIcon width={20} height={20} />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="truncate font-display text-base font-semibold text-main">ARECANUT QUALITY</p>
        <p className="truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">
          Grading system
        </p>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initial = (user?.displayName || user?.username || 'U').slice(0, 1).toUpperCase();

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-6">
        <Brand />
      </div>

      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 pb-3" aria-label="Main navigation">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex === 0 ? '' : 'pt-4'}>
            <p className="px-3 pb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-muted">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Icon width={17} height={17} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="m-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--accent-soft)] text-sm font-bold text-accent">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-main">
              {user?.displayName || user?.username || 'Account'}
            </p>
            <p className="truncate text-[11px] text-muted">
              {user?.email || `@${user?.username || 'user'}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="btn-ghost mt-2 w-full !justify-start !px-2 !py-2 text-xs"
        >
          <LogoutIcon width={15} height={15} />
          Sign out
        </button>
      </div>

      <p className="px-5 pb-5 text-[10px] leading-relaxed text-muted">
        AI estimates and manual grades are decision-support only — not certified commercial grades
        or laboratory tests.
      </p>
    </div>
  );
}

export default function AppLayout({ children }) {
  const { user, theme, toggleTheme, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const meta = pageMeta(location.pathname);
  const initial = (user?.displayName || user?.username || 'U').slice(0, 1).toUpperCase();

  useEffect(() => {
    setDrawer(false);
    setMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    function handler(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenu(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="min-h-screen">
      <aside className="surface fixed inset-y-0 left-0 z-40 hidden w-64 rounded-none border-y-0 border-l-0 lg:block xl:w-72">
        <SidebarContent />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
            role="presentation"
          />
          <aside className="surface-strong absolute inset-y-0 left-0 w-[min(86vw,19rem)] rounded-none border-y-0 border-l-0">
            <button
              type="button"
              className="btn-ghost absolute right-3 top-4 !p-2"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
            >
              <CloseIcon />
            </button>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64 xl:pl-72">
        <header
          className="sticky top-0 z-30 border-b border-[color:var(--border)] backdrop-blur-xl"
          style={{ background: 'color-mix(in srgb, var(--bg) 78%, transparent)' }}
        >
          <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              className="btn-ghost !p-2 lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
            >
              <MenuIcon />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                {meta.eyebrow}
              </p>
              <h1 className="truncate font-display text-lg font-semibold text-main sm:text-xl">
                {meta.title}
              </h1>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="btn-secondary !p-2.5"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenu((open) => !open)}
                className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-1.5 pr-2 transition hover:bg-[color:var(--accent-soft)]"
                aria-haspopup="menu"
                aria-expanded={menu}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--accent-soft)] text-xs font-bold text-accent">
                  {initial}
                </span>
                <span className="hidden max-w-28 truncate text-xs font-semibold text-main sm:block">
                  {user?.displayName || user?.username}
                </span>
              </button>
              {menu && (
                <div
                  className="surface-strong absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl p-1.5 animate-in"
                  role="menu"
                >
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold text-main">
                      {user?.displayName || user?.username}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {user?.email || `@${user?.username}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-link w-full !py-2 text-left"
                    onClick={() => navigate('/profile')}
                  >
                    <ProfileIcon width={16} height={16} /> Profile & settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-link w-full !py-2 text-left"
                    onClick={async () => {
                      await logout();
                      navigate('/login');
                    }}
                  >
                    <LogoutIcon width={16} height={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>

        <footer className="mx-auto max-w-[1500px] px-4 pb-8 sm:px-6 lg:px-8">
          <p className="text-[11px] leading-relaxed text-muted">
            ARECANUT QUALITY GRADING SYSTEM © 2026 Prajwal Mohan. All Rights Reserved.

          </p>
        </footer>
      </div>
    </div>
  );
}
