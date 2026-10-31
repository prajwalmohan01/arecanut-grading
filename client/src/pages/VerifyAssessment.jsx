import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import API, { apiErrorMessage } from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import { ManualGradeBadge, RecordStatusBadge } from '../components/manual/ManualBadges';
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  LeafIcon,
  ShieldCheckIcon,
} from '../components/Icons';
import { formatDateTime } from '../utils/format';

export default function VerifyAssessment() {
  const { token } = useParams();
  const { isAuthenticated } = useAuth();
  const [assessment, setAssessment] = useState(null);
  const [notice, setNotice] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get(`/verify/${encodeURIComponent(token || '')}`)
      .then((response) => {
        if (!alive) return;
        setAssessment(response.data.assessment);
        setNotice(response.data.notice || '');
        setPrivacy(response.data.privacy || '');
      })
      .catch((err) => {
        if (alive) {
          setError(
            apiErrorMessage(
              err,
              'This assessment could not be verified. The link may be invalid.'
            )
          );
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Verify manual grading assessment';
    return () => {
      document.title = previous;
    };
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[color:var(--border)]">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to={isAuthenticated ? '/manual' : '/home'} className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-emerald-600 text-white shadow-lg shadow-forest-900/20">
              <LeafIcon width={20} height={20} />
            </span>
            <span className="font-display text-sm font-semibold leading-tight text-main sm:text-base">
              ARECANUT QUALITY
              <span className="block text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-muted">
                Grading system
              </span>
            </span>
          </Link>
          <Link
            to={isAuthenticated ? '/manual' : '/home'}
            className="btn-secondary !px-3 !py-2 text-xs"
          >
            <ArrowLeftIcon width={14} height={14} />
            {isAuthenticated ? 'Manual workspace' : 'Home'}
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6">
        {loading ? (
          <Card className="mx-auto w-full max-w-2xl p-8">
            <div className="flex flex-col items-center py-8 text-center">
              <Spinner size={28} />
              <p className="mt-4 text-sm font-semibold text-main">Checking assessment record…</p>
              <p className="mt-1 text-xs text-muted">This usually takes a moment.</p>
            </div>
          </Card>
        ) : error || !assessment ? (
          <Card className="mx-auto w-full max-w-2xl overflow-hidden">
            <div className="bg-[color:var(--danger-soft)] px-6 py-8 text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-[color:var(--panel-strong)] text-danger">
                <AlertIcon width={30} height={30} />
              </span>
              <h1 className="mt-4 font-display text-2xl font-semibold text-main">
                Verification not available
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{error}</p>
            </div>
            <div className="p-6">
              <p className="text-xs leading-relaxed text-muted">
                Check that the full verification link was copied correctly. Verification links are
                created with a generated manual assessment and do not expose account or customer
                information.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/home" className="btn-primary">
                  Return home
                </Link>
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <Card className="overflow-hidden">
              <div className="border-b border-[color:var(--border)] bg-[color:var(--accent-soft)] px-6 py-7 text-center">
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-[color:var(--panel-strong)] text-accent shadow-sm">
                  <ShieldCheckIcon width={32} height={32} />
                </span>
                <Badge tone="a" className="mt-4">Link matched</Badge>
                <h1 className="mt-3 font-display text-2xl font-semibold text-main">
                  Manual assessment verified
                </h1>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
                  This verification link matches a stored application assessment. The grade below
                  was selected by a person, not predicted by an automated model.
                </p>
              </div>

              <div className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                      Assessment ID
                    </p>
                    <p className="mt-1 font-display text-xl font-semibold text-main">
                      {assessment.id}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Issued {formatDateTime(assessment.issuedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                      Manual grade
                    </p>
                    <div className="mt-1.5">
                      <ManualGradeBadge grade={assessment.grade?.replace(/^Grade\s+/i, '')} />
                    </div>
                  </div>
                </div>

                <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Grading record', assessment.recordId],
                    ['Batch reference', assessment.batchCode || 'Not assigned'],
                    ['Graded on', formatDateTime(assessment.gradedAt)],
                    ['Review state', assessment.imageFlagged ? 'Image flagged' : assessment.reviewed ? 'Reviewed' : 'Not reviewed'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-[color:var(--border)] p-3">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                        {label}
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-main">{value || '—'}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <RecordStatusBadge status={assessment.status} />
                  {assessment.reviewed && <Badge tone="a">Human reviewed</Badge>}
                  {assessment.imageFlagged && <Badge tone="b">Image flagged</Badge>}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={copyLink}>
                    {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
                    {copied ? 'Link copied' : 'Copy verification link'}
                  </Button>
                  <Button variant="secondary" onClick={() => window.print()}>
                    <ClipboardIcon width={14} height={14} /> Print this page
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                <AlertIcon width={16} height={16} className="mt-0.5 shrink-0 text-[color:var(--warn)]" />
                <span>
                  {notice ||
                    'This is an application-generated grading assessment with a manually selected grade. It is not an officially accredited certificate.'}
                </span>
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                {privacy ||
                  'Verification intentionally excludes stored images, notes, supplier details, and account information.'}
              </p>
            </Card>

            <p className="text-center text-[11px] leading-relaxed text-muted">
              Verification confirms only that this link matches a stored record in this
              application. It does not independently certify quality, value, or commercial fitness.
            </p>
          </div>
        )}
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-center text-[10px] leading-relaxed text-muted sm:px-6">
        ARECANUT QUALITY GRADING SYSTEM © 2026 Prajwal Mohan. All Rights Reserved.
      </footer>
    </div>
  );
}
