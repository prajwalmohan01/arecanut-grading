import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import API, { apiErrorMessage } from '../api/axios';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { TextField } from '../components/ui/Field';
import { AlertIcon, CheckIcon, MoonIcon, ProfileIcon, SparkIcon, SunIcon } from '../components/Icons';

function Section({ title, description, children }) {
  return (
    <Card className="p-5 sm:p-6 animate-in">
      <div className="mb-4">
        <h3 className="font-display text-lg font-semibold text-main">{title}</h3>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {children}
    </Card>
  );
}





function ProfileCreatorToast() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '16px',
        left: 'calc(50vw - 140px)',
        right: 'auto',
        transform: 'none',
        zIndex: 2147483647,
        width: '280px',
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        background: '#09090b',
        color: '#fff',
        border: '1px solid #27272a',
        borderRadius: '10px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
        animation: 'profileCreatorToastIn 300ms ease-out both',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '20px', lineHeight: 1 }}>✦</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600 }}>Credit with care</div>
        <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '3px' }}>
          By <span style={{ color: '#fff' }}>Prajwal Mohan</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Close notification"
        style={{
          border: 0,
          background: 'transparent',
          color: '#a1a1aa',
          cursor: 'pointer',
          fontSize: '20px',
          lineHeight: 1,
          padding: '2px 3px',
        }}
      >
        ×
      </button>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: '2px',
          width: '100%',
          background: '#3b82f6',
          transformOrigin: 'left',
          animation: 'profileCreatorToastProgress 5s linear forwards',
        }}
      />
      <style>{`
        @keyframes profileCreatorToastIn {
          from { opacity: 0; margin-top: -8px; }
          to { opacity: 1; margin-top: 0; }
        }
        @keyframes profileCreatorToastProgress {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}




export default function Profile() {
  const { user, updateUser, theme, setTheme } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState({
    displayName: user?.displayName || '',
    email: user?.email || '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [password, setPassword] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  async function saveProfile(event) {
    event.preventDefault();
    setProfileError('');
    if (!profile.displayName.trim()) {
      setProfileError('Display name is required.');
      return;
    }
    setProfileSaving(true);
    try {
      const response = await API.put('/auth/profile', {
        displayName: profile.displayName.trim(),
        email: profile.email.trim() === '' ? null : profile.email.trim(),
      });
      updateUser(response.data.user);
      toast.success('Profile updated.');
    } catch (err) {
      const message = apiErrorMessage(err, 'Could not update your profile.');
      setProfileError(message);
      toast.error(message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (!password.currentPassword || !password.newPassword || !password.confirmPassword) {
      setPasswordError('All password fields are required.');
      return;
    }
    if (password.newPassword !== password.confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (password.newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    setPasswordSaving(true);
    try {
      await API.put('/auth/password', {
        currentPassword: password.currentPassword,
        newPassword: password.newPassword,
      });
      setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordSuccess('Password updated. Use your new password on your next sign in.');
      toast.success('Password updated.');
    } catch (err) {
      const message = apiErrorMessage(err, 'Could not change your password.');
      setPasswordError(message);
      toast.error(message);
    } finally {
      setPasswordSaving(false);
    }
  }

  async function toggleAppTheme(next) {
    try {
      await setTheme(next);
      toast.success(`Theme switched to ${next}.`);
    } catch {
      toast.error('Could not update the theme preference.');
    }
  }

  const initial = (user?.displayName || user?.username || 'U').slice(0, 1).toUpperCase();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-3xl text-xl font-bold"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          {initial}
        </span>
        <div className="min-w-0">
          <h2 className="break-words font-display text-2xl font-semibold text-main">
            {user?.displayName || user?.username}
          </h2>
          <p className="mt-1 break-words text-sm text-muted">
            @{user?.username} · {user?.email || 'No email added'} · Role: {user?.role || 'user'}
          </p>
        </div>
      </div>



      <ProfileCreatorToast />



      
      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Profile details"
          description="Update how your name and contact details appear across the app."
        >
          <form onSubmit={saveProfile} className="space-y-3">
            <TextField
              id="displayName"
              label="Display name"
              value={profile.displayName}
              onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
              maxLength={60}
              required
            />
            <TextField
              id="email"
              label="Email address"
              type="email"
              value={profile.email}
              onChange={(event) => setProfile({ ...profile, email: event.target.value })}
              placeholder="you@example.com"
            />
            <TextField
              id="username"
              label="Username"
              value={user?.username || ''}
              readOnly
              disabled
              hint="Username cannot be changed."
            />
            {profileError && (
              <div className="alert alert-danger items-start text-xs">
                <AlertIcon width={16} height={16} />
                <span>{profileError}</span>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save profile'}
              </Button>
            </div>
          </form>
        </Section>

        <Section
          title="Appearance"
          description="Choose a theme preference. It syncs to your account when signed in."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => toggleAppTheme('light')}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                theme === 'light'
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]'
                  : 'border-[color:var(--border)] hover:bg-[color:var(--panel-soft)]'
              }`}
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-2xl"
                style={{ background: 'var(--panel-strong)' }}
              >
                <SunIcon width={18} height={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-main">Light</p>
                <p className="break-words text-xs text-muted">Clean glass look for bright spaces</p>
              </div>
              {theme === 'light' && <CheckIcon width={16} height={16} style={{ color: 'var(--accent)' }} />}
            </button>
            <button
              type="button"
              onClick={() => toggleAppTheme('dark')}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                theme === 'dark'
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]'
                  : 'border-[color:var(--border)] hover:bg-[color:var(--panel-soft)]'
              }`}
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-2xl"
                style={{ background: 'var(--panel-strong)' }}
              >
                <MoonIcon width={18} height={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-main">Dark</p>
                <p className="break-words text-xs text-muted">Lower glare for low-light sessions</p>
              </div>
              {theme === 'dark' && <CheckIcon width={16} height={16} style={{ color: 'var(--accent)' }} />}
            </button>
          </div>
        </Section>
      </div>

      <Section
        title="Change password"
        description="Use a strong password of at least 8 characters with letters and numbers."
      >
        <form onSubmit={changePassword} className="grid gap-3 md:grid-cols-3">
          <TextField
            id="currentPassword"
            label="Current password"
            type="password"
            value={password.currentPassword}
            onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })}
            autoComplete="current-password"
          />
          <TextField
            id="newPassword"
            label="New password"
            type="password"
            value={password.newPassword}
            onChange={(event) => setPassword({ ...password, newPassword: event.target.value })}
            autoComplete="new-password"
          />
          <TextField
            id="confirmPassword"
            label="Confirm new password"
            type="password"
            value={password.confirmPassword}
            onChange={(event) => setPassword({ ...password, confirmPassword: event.target.value })}
            autoComplete="new-password"
          />
          {(passwordError || passwordSuccess) && (
            <div className="md:col-span-3">
              {passwordError && (
                <div className="alert alert-danger items-start text-xs">
                  <AlertIcon width={16} height={16} />
                  <span>{passwordError}</span>
                </div>
              )}
              {passwordSuccess && (
                <div className="alert alert-success items-start text-xs">
                  <CheckIcon width={16} height={16} />
                  <span>{passwordSuccess}</span>
                </div>
              )}
            </div>
          )}
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" disabled={passwordSaving}>
              {passwordSaving ? 'Updating…' : 'Change password'}
            </Button>
          </div>
        </form>
      </Section>

      <Card className="flex items-start gap-3 p-4 text-xs leading-relaxed text-muted animate-in">
        <ProfileIcon width={17} height={17} className="mt-0.5 shrink-0" />
        <p className="min-w-0 break-words">
          © 2026 Prajwal Mohan | Arecanut Quality Grading System | Automated Detection & Grading | Contact: +91 76767 59149
        </p>
      </Card>

      <p className="pb-1 text-[11px] text-muted">
        <SparkIcon width={13} height={13} className="mr-1 inline" />
        ARECANUT QUALITY GRADING SYSTEM predicts only the grades exposed by the active model. The bundled
        checkpoint supports Grade A / Grade B; Grade C / D become available after a validated four-class
        checkpoint is installed. No grading capabilities are fabricated.
      </p>
    </div>
  );
}
