import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../api/axios';
import Button from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { LeafIcon, CheckIcon } from '../components/Icons';

export default function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError('');
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(form.username.trim())) {
      return setError('Username must be 3-30 characters and use letters, numbers, dots, underscores, or hyphens.');
    }
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirm) return setError('Passwords do not match.');

    setLoading(true);
    try {
      await signup({
        displayName: form.displayName.trim() || form.username.trim(),
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
      });
      toast.success('Account created');
      navigate('/home', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Signup failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-gradient-to-br from-forest-900 via-forest-800 to-emerald-900" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 70% 20%, rgba(98,197,150,0.35), transparent 38%), radial-gradient(circle at 20% 80%, rgba(216,180,106,0.25), transparent 35%)',
          }}
        />
        <div className="relative flex min-w-0 items-center gap-3 text-white">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
            <LeafIcon width={21} height={21} />
          </span>
          <p className="min-w-0 break-words font-display text-xl font-semibold leading-tight">
            ARECANUT QUALITY GRADING SYSTEM
          </p>
        </div>

        <div className="relative max-w-lg text-white">
          <h1 className="font-display text-5xl font-semibold leading-[1.05]">
            A private record
            <span className="block text-emerald-300">for every tray.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-forest-100/80">
            Create an account to keep prediction history, compare results, and export
            before-and-after reports. Your images and records are scoped to you.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              'Backend-verified ownership on every image and report',
              'Password hashing with bcrypt; JWT sessions',
              'Prediction history with filters and pagination',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-forest-100/90">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                  <CheckIcon width={12} height={12} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-forest-200/70">
          Never store production credentials in the frontend. Configure the API URL with VITE_API_URL.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md animate-in">
          <div className="mb-8 flex min-w-0 items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-emerald-600 text-white">
              <LeafIcon width={19} height={19} />
            </span>
            <span className="min-w-0 break-words font-display text-base font-semibold leading-tight text-main sm:text-xl">
              ARECANUT QUALITY GRADING SYSTEM
            </span>
          </div>

          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Create account</p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-main">Start grading</h1>
          <p className="mt-2 text-sm text-muted">Set up your private workspace in a minute.</p>

          {error && (
            <div className="alert alert-danger mt-6" role="alert">
              <span className="font-bold">!</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <TextField
              id="displayName"
              name="displayName"
              label="Display name"
              value={form.displayName}
              onChange={onChange}
              placeholder="Spandana"
              maxLength={60}
              autoComplete="name"
            />
            <TextField
              id="username"
              name="username"
              label="Username"
              value={form.username}
              onChange={onChange}
              placeholder="min 3 characters"
              autoComplete="username"
              required
              minLength={3}
              maxLength={30}
            />
            <TextField
              id="email"
              name="email"
              type="email"
              label="Email (optional)"
              value={form.email}
              onChange={onChange}
              placeholder="you@example.com"
              autoComplete="email"
              hint="Used only for your profile; no email delivery is configured."
            />
            <div>
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={onChange}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="input pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent"
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <TextField
              id="confirm"
              name="confirm"
              type="password"
              label="Confirm password"
              value={form.confirm}
              onChange={onChange}
              placeholder="Repeat password"
              autoComplete="new-password"
              required
            />
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{' '}
            <Link to="/login" className="link">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
