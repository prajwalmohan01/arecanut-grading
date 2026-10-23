import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../../api/axios';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import StatCard from '../../components/ui/StatCard';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import { TextField, SelectField } from '../../components/ui/Field';
import {
  BatchStatusBadge,
  ManualGradeBadge,
  RecordStatusBadge,
  ReviewBadge,
} from '../../components/manual/ManualBadges';
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
  LayersIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
} from '../../components/Icons';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

const PAGE_SIZE = 20;

function editFormFrom(batch) {
  return {
    name: batch.name || '',
    supplier: batch.supplier || '',
    collectionDate: batch.collectionDate
      ? new Date(batch.collectionDate).toISOString().slice(0, 10)
      : '',
    targetSamples: batch.targetSamples ?? '',
    targetWeightKg: batch.targetWeightKg ?? '',
    notes: batch.notes || '',
    status: batch.status || 'open',
  };
}

export default function ManualBatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [batch, setBatch] = useState(null);
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    API.get(`/manual/batches/${id}`, { params: { page, limit: PAGE_SIZE } })
      .then((response) => {
        if (!alive) return;
        setBatch(response.data.batch);
        setRecords(response.data.records || []);
        setPagination(response.data.pagination || null);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Could not load this manual batch.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, page, reloadKey]);

  function openEdit() {
    setEditForm(editFormFrom(batch));
    setEditOpen(true);
  }

  async function saveBatch(event) {
    event.preventDefault();
    if (!editForm) return;
    if (!editForm.name.trim()) {
      toast.error('Enter a batch name.');
      return;
    }
    setSaving(true);
    try {
      const response = await API.patch(`/manual/batches/${id}`, {
        ...editForm,
        targetSamples: editForm.targetSamples || null,
        targetWeightKg: editForm.targetWeightKg || null,
      });
      setBatch(response.data.batch);
      setEditOpen(false);
      toast.success('Batch details updated.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update the batch.'));
    } finally {
      setSaving(false);
    }
  }

  async function downloadBatchFile(kind) {
    setDownloading(kind);
    try {
      const extension = kind === 'csv' ? 'csv' : 'pdf';
      await downloadApiFile(
        kind === 'csv'
          ? `/manual/batches/${id}/export.csv`
          : `/manual/batches/${id}/report.pdf`,
        `manual-batch-${batch.batchId}.${extension}`
      );
      toast.success(`Batch ${extension.toUpperCase()} downloaded.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not download this batch file.'));
    } finally {
      setDownloading('');
    }
  }

  async function deleteBatch() {
    setDeleting(true);
    try {
      const response = await API.delete(`/manual/batches/${id}`);
      toast.success(response.data.message || 'Batch deleted.');
      navigate('/manual/batches');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete the batch.'));
      setDeleting(false);
    }
  }

  if (loading && !batch) {
    return (
      <div className="space-y-5">
        <div className="card p-5">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton mt-3 h-8 w-72 max-w-full" />
          <div className="skeleton mt-3 h-3 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card p-5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton mt-3 h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--danger-soft)] text-danger">
            <AlertIcon width={24} height={24} />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold text-main">
            Batch could not be opened
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            {error || 'The batch does not exist or is not available for this account.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/manual/batches')}>
              Back to batches
            </Button>
            <Button onClick={() => setReloadKey((key) => key + 1)}>Retry</Button>
          </div>
        </div>
      </Card>
    );
  }

  const stats = batch.stats || {};
  const sampleProgress =
    stats.progressPct !== null && stats.progressPct !== undefined
      ? stats.progressPct
      : stats.totalRecords
      ? Math.round(((stats.completed || 0) / stats.totalRecords) * 100)
      : 0;

  return (
    <>
      <div className="space-y-5">
        <Card className="p-5 animate-in">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="min-w-0">
              <Link to="/manual/batches" className="link inline-flex items-center gap-1.5 text-xs">
                <ArrowLeftIcon width={14} height={14} /> Manual batches
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words font-display text-2xl font-semibold text-main">
                  {batch.name}
                </h2>
                <BatchStatusBadge status={batch.status} />
              </div>
              <p className="mt-1 break-words text-xs text-muted">
                {batch.batchId} · created {formatDateTime(batch.createdAt)} · updated{' '}
                {formatDateTime(batch.updatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => navigate(`/manual/new?batch=${batch.id}`)}
              >
                <UploadIcon width={15} height={15} /> Add sample
              </Button>
              <Button variant="secondary" onClick={openEdit}>
                <EditIcon width={15} height={15} /> Edit batch
              </Button>
              <Button
                variant="secondary"
                onClick={() => downloadBatchFile('csv')}
                disabled={Boolean(downloading)}
              >
                {downloading === 'csv' ? <Spinner size={14} /> : <DownloadIcon width={15} height={15} />}
                CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => downloadBatchFile('pdf')}
                disabled={Boolean(downloading)}
              >
                {downloading === 'pdf' ? <Spinner size={14} /> : <DownloadIcon width={15} height={15} />}
                PDF
              </Button>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <TrashIcon width={15} height={15} /> Delete
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Saved records"
            value={formatNumber(stats.totalRecords || 0)}
            hint={`${formatNumber(stats.completed || 0)} completed · ${formatNumber(stats.drafts || 0)} draft`}
            icon={<FolderIcon width={17} height={17} />}
          />
          <StatCard
            label="Manual grade mix"
            value={`A ${formatNumber(stats.gradeA || 0)} · B ${formatNumber(stats.gradeB || 0)}`}
            hint="Selected by the grader"
            tone="a"
            icon={<TagIcon width={17} height={17} />}
          />
          <StatCard
            label="Weight recorded"
            value={formatWeightKg(stats.totalWeightKg || 0)}
            hint={`${formatNumber(stats.totalQuantity || 0)} samples counted`}
            tone="b"
            icon={<CheckIcon width={17} height={17} />}
          />
          <StatCard
            label="Review progress"
            value={`${formatNumber(stats.reviewed || 0)}/${formatNumber(stats.totalRecords || 0)}`}
            hint={`${formatNumber(stats.pendingReview || 0)} awaiting review`}
            icon={<ClipboardIcon width={17} height={17} />}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] p-4">
              <div>
                <h3 className="font-display text-xl font-semibold text-main">Batch records</h3>
                <p className="mt-1 text-xs text-muted">
                  Only records assigned to this batch are counted in its progress.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/manual/records?batch=${batch.id}`)}
              >
                Open filtered history <ArrowRightIcon width={13} height={13} />
              </Button>
            </div>

            {loading ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2, 3].map((key) => (
                  <div key={key} className="flex items-center gap-4">
                    <div className="skeleton h-10 w-10 rounded-xl" />
                    <div className="flex-1">
                      <div className="skeleton h-3 w-52 max-w-full" />
                      <div className="skeleton mt-2 h-3 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            ) : records.length === 0 ? (
              <EmptyState
                icon="◫"
                title="No samples in this batch yet"
                description="Add a manual grading record to this batch. Its progress and grade mix will update from the records you save."
                action={
                  <Button onClick={() => navigate(`/manual/new?batch=${batch.id}`)}>
                    <PlusIcon width={15} height={15} /> Add first sample
                  </Button>
                }
              />
            ) : (
              <>
                <div className="table-shell hidden xl:block">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Manual grade</th>
                        <th>Quantity</th>
                        <th>Weight</th>
                        <th>Review</th>
                        <th>Graded</th>
                        <th className="text-right">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.id}>
                          <td>
                            <Link to={`/manual/records/${record.id}`} className="font-semibold text-main hover:text-accent">
                              {record.sampleCode || record.reportId}
                            </Link>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-[11px] text-muted">{record.reportId}</span>
                              <RecordStatusBadge status={record.status} />
                            </div>
                          </td>
                          <td><ManualGradeBadge grade={record.grade} /></td>
                          <td className="text-sm text-main">
                            {record.quantity === null ? '—' : formatNumber(record.quantity)}
                          </td>
                          <td className="text-sm text-main">{formatWeightKg(record.weightKg)}</td>
                          <td><ReviewBadge review={record.review} /></td>
                          <td>
                            <p className="text-xs text-main">{formatDateTime(record.gradedAt)}</p>
                            <p className="mt-0.5 text-[11px] text-muted">{record.reviewerName || 'No reviewer'}</p>
                          </td>
                          <td>
                            <div className="flex justify-end">
                              <Button variant="ghost" size="sm" onClick={() => navigate(`/manual/records/${record.id}`)}>
                                <ArrowRightIcon width={14} height={14} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-[color:var(--border)] xl:hidden">
                  {records.map((record) => (
                    <div key={record.id} className="p-4">
                      <Link to={`/manual/records/${record.id}`} className="text-sm font-semibold text-main">
                        {record.sampleCode || record.reportId}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <ManualGradeBadge grade={record.grade} />
                        <RecordStatusBadge status={record.status} />
                        <ReviewBadge review={record.review} />
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {record.quantity === null ? 'No count' : `${formatNumber(record.quantity)} count`} ·{' '}
                        {formatWeightKg(record.weightKg)} · {formatDateTime(record.gradedAt)}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-2"
                        onClick={() => navigate(`/manual/records/${record.id}`)}
                      >
                        Open record
                      </Button>
                    </div>
                  ))}
                </div>

                <Pagination
                  page={pagination?.page || 1}
                  pages={pagination?.pages || 1}
                  total={pagination?.total || 0}
                  onPage={(nextPage) => {
                    setPage(nextPage);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  label="records"
                />
              </>
            )}
          </Card>

          <aside className="space-y-4">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold text-main">Batch progress</h3>
                <Badge tone="neutral">{sampleProgress}%</Badge>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Completed records</span>
                  <span className="font-semibold text-main">
                    {formatNumber(stats.completed || 0)}
                    {batch.targetSamples ? ` / ${formatNumber(batch.targetSamples)}` : ''}
                  </span>
                </div>
                <div className="progress-track mt-1.5">
                  <div className="progress-bar" style={{ width: `${sampleProgress}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-muted">
                  {batch.targetSamples
                    ? `${formatNumber(stats.pendingSamples || 0)} sample(s) remain to the optional target.`
                    : 'No sample target was set. This shows completion within saved records.'}
                </p>
              </div>

              <div className="mt-4 border-t border-[color:var(--border)] pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Weight progress</span>
                  <span className="font-semibold text-main">
                    {formatWeightKg(stats.totalWeightKg || 0)}
                    {batch.targetWeightKg ? ` / ${formatWeightKg(batch.targetWeightKg)}` : ''}
                  </span>
                </div>
                {batch.targetWeightKg ? (
                  <>
                    <div className="progress-track mt-1.5">
                      <div
                        className="progress-bar"
                        style={{ width: `${stats.weightProgressPct || 0}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted">
                      {formatWeightKg(stats.remainingWeightKg || 0)} remain to the optional weight target.
                    </p>
                  </>
                ) : (
                  <p className="mt-1.5 text-[11px] text-muted">No weight target was set.</p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-display text-lg font-semibold text-main">Collection details</h3>
              <dl className="mt-3 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted">
                    <UsersIcon width={13} height={13} /> Supplier
                  </dt>
                  <dd className="min-w-0 max-w-[13rem] break-words text-right text-main">
                    {batch.supplier || '—'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted">
                    <CalendarIcon width={13} height={13} /> Collection date
                  </dt>
                  <dd className="text-right text-main">
                    {batch.collectionDate ? formatDate(batch.collectionDate) : '—'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Sample target</dt>
                  <dd className="text-right text-main">
                    {batch.targetSamples ? formatNumber(batch.targetSamples) : 'None'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Weight target</dt>
                  <dd className="text-right text-main">
                    {batch.targetWeightKg ? formatWeightKg(batch.targetWeightKg) : 'None'}
                  </dd>
                </div>
              </dl>
              {batch.notes && (
                <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[color:var(--panel-soft)] p-2.5 text-xs leading-relaxed text-main">
                  {batch.notes}
                </p>
              )}
            </Card>

            <Card className="p-4">
              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
                <LayersIcon width={15} height={15} className="mt-0.5 shrink-0 text-accent" />
                Deleting a batch keeps its grading records and removes only the batch assignment.
                No sample images or manual grades are deleted.
              </p>
            </Card>
          </aside>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title="Edit batch"
        description="Update collection details, optional targets, or mark this batch complete."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveBatch} disabled={saving}>
              {saving ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
              {saving ? 'Saving…' : 'Save batch'}
            </Button>
          </>
        }
      >
        {editForm && (
          <form onSubmit={saveBatch} className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="edit-batch-name"
              label="Batch name"
              value={editForm.name}
              onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
              maxLength={80}
              className="sm:col-span-2"
              required
            />
            <TextField
              id="edit-batch-supplier"
              label="Supplier / collection"
              value={editForm.supplier}
              onChange={(event) => setEditForm((current) => ({ ...current, supplier: event.target.value }))}
              maxLength={120}
            />
            <TextField
              id="edit-batch-date"
              label="Collection date"
              type="date"
              value={editForm.collectionDate}
              onChange={(event) => setEditForm((current) => ({ ...current, collectionDate: event.target.value }))}
            />
            <TextField
              id="edit-batch-target-samples"
              label="Target samples"
              type="number"
              min="1"
              step="1"
              value={editForm.targetSamples}
              onChange={(event) => setEditForm((current) => ({ ...current, targetSamples: event.target.value }))}
            />
            <TextField
              id="edit-batch-target-weight"
              label="Target weight kg"
              type="number"
              min="0.000001"
              step="0.001"
              value={editForm.targetWeightKg}
              onChange={(event) => setEditForm((current) => ({ ...current, targetWeightKg: event.target.value }))}
            />
            <SelectField
              id="edit-batch-status"
              label="Batch status"
              value={editForm.status}
              onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="open">Open</option>
              <option value="completed">Completed</option>
            </SelectField>
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="edit-batch-notes">Notes</label>
              <textarea
                id="edit-batch-notes"
                className="input min-h-20 resize-y"
                value={editForm.notes}
                onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                maxLength={1000}
              />
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this batch?"
        description={`${batch.name} (${batch.batchId}) will be deleted. Its ${formatNumber(stats.totalRecords || 0)} grading record(s) will be kept and become unassigned.`}
        confirmLabel="Delete batch"
        destructive
        loading={deleting}
        onConfirm={deleteBatch}
        onClose={() => !deleting && setDeleteOpen(false)}
      />
    </>
  );
}
