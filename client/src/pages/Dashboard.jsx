import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import API, { apiErrorMessage } from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePolicy } from '../context/PolicyContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import PolicyNotice from '../components/PolicyNotice';
import { GradeBadge } from '../components/ui/Badge';
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  HistoryIcon,
  SparkIcon,
  UploadIcon,
} from '../components/Icons';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  gradeAvailability,
  gradeColor,
  supportedGradeLetters,
} from '../utils/format';
import { baseChartOptions, chartTheme } from '../utils/charts';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="card p-5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton mt-4 h-8 w-20" />
            <div className="skeleton mt-3 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="skeleton h-4 w-36" />
          <div className="skeleton mt-4 h-56 w-full" />
        </div>
        <div className="card p-5">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton mt-4 h-56 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, theme: themeMode } = useAuth();
  const toast = useToast();
  const { policy } = usePolicy();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get('/scans/stats', { params: { days: 14 } })
      .then((response) => {
        if (alive) setData(response.data);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Unable to load your dashboard.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const theme = useMemo(() => chartTheme(), [data, themeMode]);

  const totals = data?.totals || {};
  const empty = !loading && !error && (totals.predictions || 0) === 0;
  const gradingOn = policy?.masterEnabled !== false;
  const enabledLetters = gradingOn
    ? Array.isArray(policy?.enabledLetters)
      ? policy.enabledLetters
      : ['A', 'B']
    : [];
  const evaluatedLetters = useMemo(() => {
    if (!enabledLetters.length) return [];
    const first = (data?.recent || [])[0];
    const supported = supportedGradeLetters(first || {});
    return enabledLetters.filter((letter) => supported.includes(letter));
  }, [data, enabledLetters]);
  const countAvailable = evaluatedLetters.length > 0;

  const activityData = useMemo(
    () => ({
      labels: (data?.activity || []).map((point) =>
        new Date(`${point.date}T00:00:00Z`).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          timeZone: 'UTC',
        })
      ),
      datasets: [
        {
          label: 'Predictions',
          data: (data?.activity || []).map((point) => point.count),
          backgroundColor: theme.emerald,
          borderRadius: 6,
          maxBarThickness: 26,
        },
      ],
    }),
    [data, theme.emerald]
  );

  const distributionData = useMemo(() => {
    const labels = enabledLetters.map((letter) => `Grade ${letter}`);
    const values = enabledLetters.map((letter) => totals[`grade${letter}`] || 0);
    const colors = enabledLetters.map((letter) => gradeColor(`Grade ${letter}`));
    if (gradingOn) {
      labels.push('Invalid');
      values.push(totals.invalid || 0);
      colors.push(theme.danger);
    }
    return {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    };
  }, [enabledLetters, gradingOn, totals, theme.danger]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="card flex flex-col justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <div className="skeleton h-3 w-28" />
            <div className="skeleton mt-3 h-8 w-64" />
            <div className="skeleton mt-3 h-3 w-80 max-w-full" />
          </div>
          <div className="skeleton h-11 w-40" />
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PolicyNotice policy={policy} showPricing />
      <Card className="relative overflow-hidden p-6 animate-in">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-50 blur-3xl"
          style={{ background: 'var(--accent-soft)' }}
        />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
              {greeting}, {(user?.displayName || user?.username || 'there').split(' ')[0]}
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-main sm:text-3xl">
              Your arecanut quality overview
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Track grading activity, review recent predictions, and confirm the preserved
              model is intact before relying on a result.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/upload')} disabled={!gradingOn}>
              <UploadIcon width={16} height={16} />
              {gradingOn ? 'New prediction' : 'Grading disabled'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/history')}>
              <HistoryIcon width={16} height={16} />
              History
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <div className="flex-1">
            <p className="font-semibold">Dashboard unavailable</p>
            <p className="mt-0.5 opacity-90">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      )}

      {loading && data && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner size={13} /> Refreshing…
        </p>
      )}

      {data && (
        <>
          {gradingOn ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Predictions"
                  value={formatNumber(totals.predictions)}
                  hint="Images analysed by you"
                  icon={<SparkIcon width={17} height={17} />}
                />
                <StatCard
                  label="Detected nuts"
                  value={countAvailable ? formatNumber(totals.detections) : '—'}
                  hint={
                    countAvailable
                      ? evaluatedLetters
                          .map(
                            (letter) =>
                              `${letter} ${formatNumber(totals[`grade${letter}`] || 0)}`
                          )
                          .join(' · ')
                      : 'C/D advisory grades do not create nut counts'
                  }
                  tone="a"
                  icon={<CheckIcon width={17} height={17} />}
                />
                <StatCard
                  label="Average quality score"
                  value={totals.avgQualityScore === null ? '—' : Number(totals.avgQualityScore).toFixed(1)}
                  hint="Heuristic composition score"
                  tone="b"
                />
                <StatCard
                  label="Average confidence"
                  value={formatPercent(totals.avgConfidence)}
                  hint="Mean winning-class confidence"
                  tone={totals.avgConfidence === null ? 'default' : 'a'}
                />
              </div>

              {data.model && !data.model.ready && (
                <div className="alert alert-warn">
                  <AlertIcon width={18} height={18} />
                  <div>
                    <p className="font-semibold">Model verification needs attention</p>
                    <p className="mt-0.5">
                      {data.model.error ||
                        'The trained model is missing or its checksum does not match the recorded metadata.'}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-3">
                <Card className="p-5 lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg font-semibold text-main">Activity</h3>
                      <p className="text-xs text-muted">Predictions over the last 14 days</p>
                    </div>
                    <span className="pill">
                      {formatNumber(
                        (data.activity || []).reduce((sum, point) => sum + point.count, 0)
                      )}{' '}
                      in range
                    </span>
                  </div>
                  <div className="mt-4 h-60">
                    <Bar
                      data={activityData}
                      options={{
                        ...baseChartOptions(theme),
                        plugins: { ...baseChartOptions(theme).plugins, legend: { display: false } },
                      }}
                    />
                  </div>
                </Card>

                <Card className="p-5">
                  <div>
                    <h3 className="font-display text-lg font-semibold text-main">Grade mix</h3>
                    <p className="text-xs text-muted">All-time image-level outcomes</p>
                  </div>
                  {totals.predictions && countAvailable ? (
                    <div className="mt-4 h-44">
                      <Doughnut
                        data={distributionData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          cutout: '68%',
                          plugins: {
                            legend: {
                              position: 'bottom',
                              labels: {
                                color: theme.text,
                                usePointStyle: true,
                                pointStyle: 'circle',
                                font: { size: 11, family: 'DM Sans' },
                              },
                            },
                          },
                        }}
                      />
                    </div>
                  ) : (
                    <p className="mt-10 text-center text-sm text-muted">
                      {totals.predictions
                        ? 'No enabled grade has a validated per-nut detector.'
                        : 'No predictions yet.'}
                    </p>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                    {[
                      ...enabledLetters.map((letter) => [
                        letter,
                        totals[`grade${letter}`] || 0,
                        letter.toLowerCase(),
                        countAvailable && evaluatedLetters.includes(letter),
                      ]),
                      ['Invalid', totals.invalid || 0, 'invalid', true],
                    ].map(([label, value, tone, supported]) => (
                      <div key={label} className={`rounded-xl badge-${tone} px-2 py-2`}>
                        <p className="text-base font-bold">
                          {supported ? formatNumber(value) : '—'}
                        </p>
                        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                          {label === 'Invalid' ? 'Invalid' : `Grade ${label}`}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">
                    Grade C/D stay uncounted unless a validated C/D detector is installed. Gemini
                    advisories remain image-level and never create counts or boxes.
                  </p>
                </Card>
              </div>
            </>
          ) : (
            <div className="alert alert-warn items-start text-xs">
              <AlertIcon width={17} height={17} />
              <span>
                Grade statistics, charts, counts, confidence, and pricing cards are hidden while
                master prediction is off.
              </span>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] px-5 py-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-main">Recent predictions</h3>
                <p className="text-xs text-muted">Your five most recent scans</p>
              </div>
              <Link to="/history" className="link inline-flex items-center gap-1 text-sm">
                View all <ArrowRightIcon width={14} height={14} />
              </Link>
            </div>

            {empty ? (
              <EmptyState
                icon="🌱"
                title="No predictions yet"
                description="Upload a tray photo to produce your first automated grade. Only the grades exposed by the active model are predicted."
                action={
                  <Button onClick={() => navigate('/upload')}>
                    <UploadIcon width={16} height={16} /> Grade an image
                  </Button>
                }
              />
            ) : (data.recent || []).length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                No recent scans in this period.
              </p>
            ) : (
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Report</th>
                      {gradingOn && <th>Grade</th>}
                      {gradingOn && <th>{enabledLetters.join(' / ')}</th>}
                      {gradingOn && <th>Quality</th>}
                      {gradingOn && <th>Confidence</th>}
                      <th>Date</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((scan) => {
                      return (
                        <tr key={scan.id}>
                        <td>
                          <Link to={`/result/${scan.id}`} className="font-semibold text-main hover:text-accent">
                            {scan.reportId || scan.filename}
                          </Link>
                          <p className="max-w-[16rem] truncate text-xs text-muted">{scan.filename}</p>
                        </td>
                        {gradingOn && (
                          <td>
                            <GradeBadge grade={scan.finalGrade} />
                          </td>
                        )}
                        {gradingOn && (
                          <td className="whitespace-nowrap text-xs text-muted">
                            {enabledLetters.map((letter, index) => {
                              const availability = gradeAvailability(scan, letter);
                              return (
                                <span key={letter}>
                                  {index > 0 && ' / '}
                                  <span
                                    className="font-semibold"
                                    style={{
                                      color: availability.supported
                                        ? gradeColor(`Grade ${letter}`)
                                        : 'var(--text-muted)',
                                    }}
                                    title={
                                      availability.supported
                                        ? undefined
                                        : availability.reason || 'No validated detector'
                                    }
                                  >
                                    {availability.supported
                                      ? formatNumber(availability.count ?? scan[`grade${letter}`] ?? 0)
                                      : '—'}
                                  </span>
                                </span>
                              );
                            })}
                          </td>
                        )}
                        {gradingOn && (
                          <td className="text-sm text-main">
                            {scan.qualityScore === null ? '—' : `${Number(scan.qualityScore).toFixed(1)}/100`}
                          </td>
                        )}
                        {gradingOn && (
                          <td className="text-sm text-main">{formatPercent(scan.confidence)}</td>
                        )}
                        <td className="whitespace-nowrap text-xs text-muted">
                          {formatDateTime(scan.createdAt)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => navigate(`/result/${scan.id}`)}
                            aria-label={`Open ${scan.reportId || 'prediction'}`}
                          >
                            <ArrowRightIcon width={14} height={14} />
                          </button>
                        </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ['Lighting', 'Use even, bright light and avoid harsh shadows across the tray.'],
              ['Framing', 'Keep every nut inside the frame with minimal overlap and clutter.'],
              ['Scope', 'Only grades enabled by the administrator and exposed by the active model are predicted. C/D require a validated four-class detector; Gemini advisories never create counts or boxes. No defect or size claims are fabricated.'],
            ].map(([title, body]) => (
              <div key={title} className="card p-4 animate-in">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">{title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-main">{body}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="alert alert-warn">
          <AlertIcon width={18} height={18} />
          <span>No dashboard data was returned. Try again.</span>
        </div>
      )}

      {data && (
        <p className="pb-1 text-[11px] leading-relaxed text-muted">
          Confidence refers to the mean model confidence of the winning class, not a calibrated
          probability. Quality score is a documented composition heuristic. Results are
          automated estimates, not certified commercial grading.
        </p>
      )}
    </div>
  );
}
