import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LeafIcon, MenuIcon, CloseIcon, MoonIcon, SunIcon } from './Icons';

function navClass({ isActive }) {
  return `rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? 'text-accent bg-[color:var(--accent-soft)]' : 'text-muted hover:text-main'
  }`;
}

export default function Navbar() {
  const navigate = useNavigate();
  const { user, logout, theme, toggleTheme, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[color:var(--border)] backdrop-blur-xl" style={{ background: 'color-mix(in srgb, var(--bg) 82%, transparent)' }}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link to={isAuthenticated ? '/home' : '/login'} className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-emerald-600 text-white">
            <LeafIcon width={18} height={18} />
          </span>
          <span className="font-display text-lg font-semibold text-main">ARECANUT QUALITY GRADING SYSTEM</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Public navigation">
          <NavLink to="/home" className={navClass}>
            Home
          </NavLink>
          {isAuthenticated && (
            <>
              <NavLink to="/dashboard" className={navClass}>
                Dashboard
              </NavLink>
              <NavLink to="/history" className={navClass}>
                History
              </NavLink>
              <NavLink to="/lots" className={navClass}>
                Lots
              </NavLink>
              <NavLink to="/performance" className={navClass}>
                Model
              </NavLink>
            </>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="btn-secondary !p-2"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
          </button>
          {isAuthenticated ? (
            <>
              <Link to="/profile" className="hidden items-center gap-2 rounded-xl border border-[color:var(--border)] px-2.5 py-1.5 sm:flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--accent-soft)] text-[11px] font-bold text-accent">
                  {(user?.displayName || user?.username || 'U').slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-24 truncate text-xs font-semibold text-main">
                  {user?.displayName || user?.username}
                </span>
              </Link>
              <button
                type="button"
                className="btn-ghost hidden !px-3 !py-2 text-xs sm:inline-flex"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost hidden text-sm sm:inline-flex">
                Sign in
              </Link>
              <Link to="/signup" className="btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}
          <button
            type="button"
            className="btn-ghost !p-2 md:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label="Toggle menu"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[color:var(--border)] px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            <NavLink to="/home" className={navClass} onClick={() => setOpen(false)}>
              Home
            </NavLink>
            {isAuthenticated ? (
              <>
                <NavLink to="/dashboard" className={navClass} onClick={() => setOpen(false)}>
                  Dashboard
                </NavLink>
                <NavLink to="/upload" className={navClass} onClick={() => setOpen(false)}>
                  New prediction
                </NavLink>
                <NavLink to="/history" className={navClass} onClick={() => setOpen(false)}>
                  History
                </NavLink>
                <NavLink to="/lots" className={navClass} onClick={() => setOpen(false)}>
                  Lots &amp; batches
                </NavLink>
                <NavLink to="/performance" className={navClass} onClick={() => setOpen(false)}>
                  Model performance
                </NavLink>
                <button
                  type="button"
                  className="nav-link text-left"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navClass} onClick={() => setOpen(false)}>
                  Sign in
                </NavLink>
                <NavLink to="/signup" className={navClass} onClick={() => setOpen(false)}>
                  Create account
                </NavLink>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
