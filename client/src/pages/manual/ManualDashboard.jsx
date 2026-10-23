import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import API, { apiErrorMessage } from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import StatCard from '../../components/ui/StatCard';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import Pagination from '../../components/ui/Pagination';
import { Badge } from '../../components/ui/Badge';
import {
  AlertIcon,
  ArrowRightIcon,
  CalculatorIcon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  CompareIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
  HistoryIcon,
  LayersIcon,
  PlusIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
  UploadIcon,
} from '../../components/Icons';
import {
  BatchStatusBadge,
  ManualGradeBadge,
  ReviewBadge,
} from '../../components/manual/ManualBadges';
import { activityLabel, activityTone } from '../../utils/manual';
import {
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';
import { baseChartOptions, chartTheme } from '../../utils/charts';

ChartJS.register(ArcElement, Tooltip, Legend);

function activityIcon(type) {
  if (type.includes('batch')) return <LayersIcon width={15} height={15} />;
  if (type.includes('price') || type.includes('assessment')) {
    return type.includes('price') ? <CalculatorIcon width={15} height={15} /> : <ShieldCheckIcon width={15} height={15} />;
  }
  if (type.includes('delete')) return <TrashIcon width={15} height={15} />;
  if (type.includes('export') || type.includes('report')) return <DownloadIcon width={15} height={15} />;
  if (type.includes('correct') || type.includes('update') || type.includes('review')) {
    return <EditIcon width={15} height={15} />;
  }
  if (type.includes('flag')) return <AlertIcon width={15} height={15} />;
  return <CheckIcon width={15} height={15} />;
}

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
          <div className="skeleton mt-4 h-64 w-full" />
        </div>
        <div className="card p-5">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton mt-4 h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function ManualDashboard() {
  const { user, theme: themeMode } = useAuth();
  const navigate = useNavigate();
  const [recordsData, setRecordsData] = useState(null);
  const [batchesData, setBatchesData] = useState(null);
  const [activityData, setActivityData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    Promise.all([
      API.get('/manual/records', { params: { limit: 5, sort: 'newest' } }),
      API.get('/manual/batches', { params: { limit: 5, status: 'open' } }),
      API.get('/manual/activity', { params: { limit: 6 } }),
    ])
      .then(([recordsResponse, batchesResponse, activityResponse]) => {
        if (!alive) return;
        setRecordsData(recordsResponse.data);
        setBatchesData(batchesResponse.data);
        setActivityData(activityResponse.data);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Unable to load the manual grading workspace.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const theme = useMemo(() => chartTheme(), [themeMode, recordsData]);
  const recordSummary = recordsData?.summary || {};
  const batchSummary = batchesData?.summary || {};
  const totalRecords = recordSummary.totalRecords || 0;
  const completed = recordSummary.completed || 0;
  const drafts = recordSummary.drafts || 0;
  const pendingReview = recordSummary.pendingReview || 0;
  const gradeA = recordSummary.gradeA || 0;
  const gradeB = recordSummary.gradeB || 0;

  const gradeData = useMemo(
    () => ({
      labels: ['Grade A', 'Grade B', 'Not graded'],
      datasets: [
        {
          data: [gradeA, gradeB, Math.max(totalRecords - gradeA - gradeB, 0)],
          backgroundColor: [theme.emerald, theme.gold, theme.grid],
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    }),
    [gradeA, gradeB, totalRecords, theme]
  );

  const gradeOptions = useMemo(
    () => ({
      ...baseChartOptions(theme),
      cutout: '68%',
      plugins: {
        ...baseChartOptions(theme).plugins,
        legend: {
          ...baseChartOptions(theme).plugins.legend,
          position: 'bottom',
          labels: {
            ...baseChartOptions(theme).plugins.legend.labels,
            padding: 16,
          },
        },
      },
    }),
    [theme]
  );

  if (loading && !recordsData) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton mt-3 h-8 w-80 max-w-full" />
          <div className="skeleton mt-3 h-3 w-[34rem] max-w-full" />
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  const hasData = totalRecords > 0;
  const firstName = (user?.displayName || user?.username || 'there').split(' ')[0];

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden p-6 animate-in">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-50 blur-3xl"
          style={{ background: 'var(--accent-soft)' }}
        />
        <div className="relative flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Manual grading workspace
              </p>
              <Badge tone="a">User-assigned grades</Badge>
              <Badge tone="neutral">No AI prediction</Badge>
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold text-main sm:text-3xl">
              Good to see you, {firstName}.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              Record Grade A or Grade B assessments, build batches, review saved work, and
              produce transparent reports. Every manual grade is selected by you — it is never
              inferred from an image.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/manual/new')}>
              <PlusIcon width={16} height={16} />
              New manual record
            </Button>
            <Button variant="secondary" onClick={() => navigate('/manual/batches?new=1')}>
              <LayersIcon width={16} height={16} />
              Create batch
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="alert alert-danger">
          <AlertIcon width={18} height={18} />
          <div className="flex-1">
            <p className="font-semibold">Manual workspace unavailable</p>
            <p className="mt-0.5 opacity-90">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      )}

      {loading && recordsData && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner size={13} /> Refreshing…
        </p>
      )}

      {recordsData && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Manual records"
              value={formatNumber(totalRecords)}
              hint={`${formatNumber(completed)} completed · ${formatNumber(drafts)} draft`}
              icon={<ClipboardIcon width={17} height={17} />}
            />
            <StatCard
              label="Manual grades"
              value={`A ${formatNumber(gradeA)} · B ${formatNumber(gradeB)}`}
              hint="Selected by the person grading"
              tone="a"
              icon={<TagIcon width={17} height={17} />}
            />
            <StatCard
              label="Weight recorded"
              value={formatWeightKg(recordSummary.totalWeightKg || 0)}
              hint={`${formatNumber(recordSummary.totalQuantity || 0)} samples counted`}
              tone="b"
              icon={<CheckIcon width={17} height={17} />}
            />
            <StatCard
              label="Open batches"
              value={formatNumber(batchSummary.open || 0)}
              hint={`${formatNumber(batchSummary.totalBatches || 0)} batches in total`}
              tone={pendingReview > 0 ? 'danger' : 'default'}
              icon={<LayersIcon width={17} height={17} />}
            />
          </div>

          {pendingReview > 0 && (
            <div className="alert alert-warn">
              <AlertIcon width={18} height={18} />
              <div className="flex-1">
                <p className="font-semibold">{formatNumber(pendingReview)} record(s) need review</p>
                <p className="mt-0.5">
                  Reviewing is optional, but it is useful before sharing reports or assessments.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/manual/records?review=pending')}
              >
                Review records
              </Button>
            </div>
          )}

          {!hasData ? (
            <Card className="p-1">
              <EmptyState
                icon="◫"
                title="Your manual grading workspace is ready"
                description="Create a batch to organise samples, then add a grading record with your selected Grade A or Grade B assessment."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => navigate('/manual/new')}>
                      <UploadIcon width={16} height={16} /> Add first record
                    </Button>
                    <Button variant="secondary" onClick={() => navigate('/manual/batches?new=1')}>
                      <LayersIcon width={16} height={16} /> Create a batch
                    </Button>
                  </div>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-5 xl:grid-cols-3">
              <Card className="min-w-0 p-5 xl:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-main">Recent manual records</h3>
                    <p className="mt-1 text-xs text-muted">Newest saved assessments, including drafts.</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => navigate('/manual/records')}>
                    View all <ArrowRightIcon width={14} height={14} />
                  </Button>
                </div>

                <div className="mt-4 space-y-2">
                  {(recordsData.items || []).map((record) => (
                    <Link
                      key={record.id}
                      to={`/manual/records/${record.id}`}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--border)] px-3 py-3 transition hover:bg-[color:var(--accent-soft)]"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--panel-soft)] text-accent">
                        <ClipboardIcon width={18} height={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-main">
                            {record.sampleCode || record.reportId}
                          </p>
                          <ManualGradeBadge grade={record.grade} />
                          <ReviewBadge review={record.review} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">
                          {record.batch?.name || 'No batch'} · {formatDateTime(record.gradedAt)}
                          {record.reviewerName ? ` · ${record.reviewerName}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-main">
                          {formatWeightKg(record.weightKg)}
                        </p>
                        <p className="text-[11px] text-muted">
                          {record.quantity === null ? 'No count' : `${formatNumber(record.quantity)} count`}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>

              <Card className="min-w-0 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-main">Grade mix</h3>
                    <p className="mt-1 text-xs text-muted">Only saved manual grades are counted.</p>
                  </div>
                  <Badge tone="neutral">Manual</Badge>
                </div>
                <div className="mt-4 h-56">
                  {gradeA + gradeB === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <p className="text-sm font-semibold text-main">No completed grades yet</p>
                      <p className="mt-1 max-w-[16rem] text-xs text-muted">
                        Drafts are saved records that still need a Grade A or Grade B selection.
                      </p>
                    </div>
                  ) : (
                    <Doughnut data={gradeData} options={gradeOptions} />
                  )}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: 'Grade A', value: gradeA, color: 'var(--accent)' },
                    { label: 'Grade B', value: gradeB, color: 'var(--gold)' },
                    { label: 'Drafts', value: drafts, color: 'var(--muted)' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-[color:var(--panel-soft)] px-2 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                        {item.label}
                      </p>
                      <p className="mt-1 font-display text-lg font-semibold" style={{ color: item.color }}>
                        {formatNumber(item.value)}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="min-w-0 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-xl font-semibold text-main">Batches in progress</h3>
                  <p className="mt-1 text-xs text-muted">Open batches with genuine saved-record progress.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => navigate('/manual/batches')}>
                  All batches <ArrowRightIcon width={14} height={14} />
                </Button>
              </div>
              {(batchesData?.items || []).length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm font-semibold text-main">No open batches</p>
                  <p className="mt-1 text-xs text-muted">
                    Create a batch when you want to group samples from one collection.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {(batchesData.items || []).map((batch) => {
                    const progress =
                      batch.stats?.progressPct ??
                      (batch.stats?.totalRecords
                        ? Math.round((batch.stats.completed / batch.stats.totalRecords) * 100)
                        : 0);
                    return (
                      <Link
                        key={batch.id}
                        to={`/manual/batches/${batch.id}`}
                        className="block rounded-2xl border border-[color:var(--border)] px-3 py-3 transition hover:bg-[color:var(--accent-soft)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-main">{batch.name}</p>
                            <p className="truncate text-[11px] text-muted">{batch.batchId}</p>
                          </div>
                          <BatchStatusBadge status={batch.status} />
                        </div>
                        <div className="mt-2.5 flex items-center gap-3">
                          <div className="progress-track flex-1">
                            <div className="progress-bar" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="w-11 text-right text-[11px] font-semibold text-main">
                            {progress}%
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] text-muted">
                          {formatNumber(batch.stats?.completed || 0)} completed ·{' '}
                          {formatNumber(batch.stats?.pendingSamples || 0)} pending · A{' '}
                          {formatNumber(batch.stats?.gradeA || 0)} / B{' '}
                          {formatNumber(batch.stats?.gradeB || 0)}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="min-w-0 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-xl font-semibold text-main">Recent activity</h3>
                  <p className="mt-1 text-xs text-muted">A read-only audit trail of saved actions.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => navigate('/manual/activity')}>
                  Full activity <ArrowRightIcon width={14} height={14} />
                </Button>
              </div>
              {(activityData?.items || []).length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm font-semibold text-main">No activity yet</p>
                  <p className="mt-1 text-xs text-muted">Creating a record will add the first audit entry.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {(activityData.items || []).map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 rounded-2xl px-2 py-2"
                    >
                      <span className={`badge badge-${activityTone(activity.type)} mt-0.5 h-8 w-8 shrink-0 justify-center rounded-xl p-0`}>
                        {activityIcon(activity.type)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug text-main">{activity.message}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {activityLabel(activity.type)} · {formatDateTime(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <h3 className="font-display text-xl font-semibold text-main">Tools for careful grading</h3>
                <p className="mt-1 text-sm text-muted">
                  Compare records, browse the sample library, calculate a user-entered value, or verify an assessment.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => navigate('/manual/compare')}>
                  <CompareIcon width={15} height={15} /> Compare
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate('/manual/gallery')}>
                  <FolderIcon width={15} height={15} /> Sample library
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate('/manual/calculator')}>
                  <CalculatorIcon width={15} height={15} /> Value calculator
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate('/manual/records?review=pending')}>
                  <HistoryIcon width={15} height={15} /> Review queue
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
