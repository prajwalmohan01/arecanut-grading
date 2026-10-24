import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../api/axios';
import Button from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { LeafIcon, SparkIcon } from '../components/Icons';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError('');
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(form.username.trim(), form.password);
      toast.success('Signed in successfully');
      const target = location.state?.from || '/home';
      navigate(target, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Login failed'));
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
              'radial-gradient(circle at 25% 25%, rgba(98,197,150,0.35), transparent 38%), radial-gradient(circle at 75% 70%, rgba(216,180,106,0.25), transparent 35%)',
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
          <span className="badge border-white/20 bg-white/10 text-forest-100">
            <SparkIcon width={13} height={13} />
            Preserved YOLOv8 weights
          </span>
          <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.05]">
            Grade with clarity,
            <span className="block text-emerald-300">not guesswork.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-forest-100/80">
            Detection overlays, per-grade counts, confidence, heuristic quality scoring, and
            downloadable before-and-after reports — with limitations stated plainly.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              ['2', 'classes'],
              ['CPU', 'ready'],
              ['PDF', 'reports'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl border border-white/15 bg-white/5 p-3 text-center backdrop-blur">
                <p className="font-display text-xl font-semibold">{value}</p>
                <p className="text-[10px] uppercase tracking-wider text-forest-200">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-forest-200/70">
          Automated estimates only. Not a certified commercial grade or laboratory test.
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

          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Welcome back</p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-main">Sign in</h1>
          <p className="mt-2 text-sm text-muted">Continue to your grading workspace.</p>

          {error && (
            <div className="alert alert-danger mt-6" role="alert">
              <span className="font-bold">!</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <TextField
              id="username"
              name="username"
              label="Username"
              value={form.username}
              onChange={onChange}
              placeholder="your username"
              autoComplete="username"
              autoFocus
              required
              minLength={3}
              maxLength={30}
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
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
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
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            New to Arecanut Quality Grading System ?{' '}
            <Link to="/signup" className="link">
              Create an account
            </Link>
          </p>
          <p className="mt-8 text-center text-[11px] text-muted">
            Accounts and prediction history are stored in the configured database. Images are served
            only to their owner.
          </p>
        </div>
      </div>
    </div>
  );
}
