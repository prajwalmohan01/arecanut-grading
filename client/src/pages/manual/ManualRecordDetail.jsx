import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import API, { apiErrorMessage, downloadApiFile } from '../../api/axios';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import ProtectedImage from '../../components/ProtectedImage';
import { TextField, SelectField } from '../../components/ui/Field';
import QualityPanel from '../../components/manual/QualityPanel';
import {
  ManualGradeBadge,
  QualityBadge,
  RecordStatusBadge,
  ReviewBadge,
} from '../../components/manual/ManualBadges';
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  HistoryIcon,
  ImageIcon,
  LayersIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
} from '../../components/Icons';
import {
  MANUAL_GRADE_OPTIONS,
  formatManualDateTimeInput,
  verificationUrl,
} from '../../utils/manual';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatWeightKg,
} from '../../utils/format';

function editFormFrom(record) {
  return {
    batch: record.batch?.id || '',
    sampleCode: record.sampleCode || '',
    grade: record.grade || '',
    status: record.status || 'completed',
    quantity: record.quantity ?? '',
    weightKg: record.weightKg ?? '',
    sizeMm: record.sizeMm ?? '',
    appearance: record.appearance || '',
    gradedAt: formatManualDateTimeInput(record.gradedAt),
    reviewerName: record.reviewerName || '',
    observations: record.observations || '',
    notes: record.notes || '',
    correctionReason: '',
  };
}

function reviewFormFrom(record) {
  return {
    reviewed: Boolean(record.review?.reviewed),
    imageFlagged: Boolean(record.review?.imageFlagged),
    notes: record.review?.notes || '',
    reason: '',
  };
}

function correctionLabel(action) {
  if (action === 'grade-correction') return 'Grade corrected';
  if (action === 'review') return 'Review updated';
  return 'Record updated';
}

function correctionTone(action) {
  if (action === 'grade-correction') return 'b';
  if (action === 'review') return 'a';
  return 'neutral';
}

function valueText(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export default function ManualRecordDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [record, setRecord] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState(null);
  const [savingReview, setSavingReview] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assessmentBusy, setAssessmentBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [assessmentUrl, setAssessmentUrl] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    Promise.all([
      API.get(`/manual/records/${id}`),
      API.get('/manual/batches', { params: { limit: 100, sort: 'newest' } }),
    ])
      .then(([recordResponse, batchResponse]) => {
        if (!alive) return;
        setRecord(recordResponse.data.record);
        setBatches(batchResponse.data.items || []);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err, 'Could not load this manual grading record.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, reloadKey]);

  const verifyUrl = useMemo(() => {
    if (assessmentUrl) return assessmentUrl;
    return record?.assessment?.verifyPath ? verificationUrl(record.assessment.verifyPath) : '';
  }, [assessmentUrl, record]);

  const gradeChangedInEdit =
    editForm && record ? (editForm.grade || '') !== (record.grade || '') : false;

  function openEdit() {
    setEditForm(editFormFrom(record));
    setEditOpen(true);
  }

  function openReview() {
    setReviewForm(reviewFormFrom(record));
    setReviewOpen(true);
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editForm) return;
    if (editForm.status === 'completed' && !editForm.grade) {
      toast.error('Select Grade A or Grade B before completing this record.');
      return;
    }
    if (gradeChangedInEdit && editForm.correctionReason.trim().length < 3) {
      toast.error('Add a correction reason of at least 3 characters for a grade change.');
      return;
    }
    setSavingEdit(true);
    try {
      const response = await API.patch(`/manual/records/${id}`, {
        batch: editForm.batch,
        sampleCode: editForm.sampleCode,
        grade: editForm.grade,
        status: editForm.status,
        quantity: editForm.quantity,
        weightKg: editForm.weightKg,
        sizeMm: editForm.sizeMm,
        appearance: editForm.appearance,
        gradedAt: editForm.gradedAt,
        reviewerName: editForm.reviewerName,
        observations: editForm.observations,
        notes: editForm.notes,
        correctionReason: editForm.correctionReason,
      });
      setRecord(response.data.record);
      setEditOpen(false);
      setAssessmentUrl('');
      toast.success(
        gradeChangedInEdit
          ? 'Grade corrected and the previous review was reset for re-review.'
          : 'Manual grading record updated.'
      );
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update this record.'));
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveReview(event) {
    event.preventDefault();
    if (!reviewForm) return;
    setSavingReview(true);
    try {
      const response = await API.post(`/manual/records/${id}/review`, reviewForm);
      setRecord(response.data.record);
      setReviewOpen(false);
      toast.success('Review details saved.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save this review.'));
    } finally {
      setSavingReview(false);
    }
  }

  async function generateAssessment() {
    setAssessmentBusy(true);
    try {
      const response = await API.post(`/manual/records/${id}/assessment`);
      const assessment = response.data.assessment;
      setAssessmentUrl(assessment.verifyUrl || '');
      setRecord((current) =>
        current
          ? {
              ...current,
              assessment: {
                id: assessment.id,
                issuedAt: assessment.issuedAt,
                verifyPath: assessment.verifyPath,
              },
            }
          : current
      );
      toast.success('Digital assessment generated.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not generate the assessment.'));
    } finally {
      setAssessmentBusy(false);
    }
  }

  async function copyVerifyLink() {
    if (!verifyUrl) return;
    try {
      await navigator.clipboard.writeText(verifyUrl);
      toast.success('Verification link copied.');
    } catch {
      toast.info('Select the verification link and copy it manually.');
    }
  }

  async function downloadReport() {
    setReportBusy(true);
    try {
      await downloadApiFile(
        `/manual/records/${id}/report.pdf`,
        `manual-grading-record-${record.reportId}.pdf`
      );
      toast.success('Record PDF downloaded.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not download the record report.'));
    } finally {
      setReportBusy(false);
    }
  }

  async function downloadAssessment() {
    setAssessmentBusy(true);
    try {
      await downloadApiFile(
        `/manual/records/${id}/assessment.pdf`,
        `manual-grading-assessment-${record.assessment?.id || record.reportId}.pdf`
      );
      toast.success('Assessment PDF with QR verification downloaded.');
      setReloadKey((key) => key + 1);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not download the assessment PDF.'));
    } finally {
      setAssessmentBusy(false);
    }
  }

  async function deleteRecord() {
    setDeleting(true);
    try {
      await API.delete(`/manual/records/${id}`);
      toast.success(`Deleted ${record.reportId}.`);
      navigate('/manual/records');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete this record.'));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="card p-5">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton mt-3 h-8 w-80 max-w-full" />
          <div className="skeleton mt-3 h-3 w-96 max-w-full" />
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="card p-5">
            <div className="skeleton h-[26rem] w-full" />
          </div>
          <div className="card p-5">
            <div className="skeleton h-6 w-40" />
            <div className="skeleton mt-4 h-44 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--danger-soft)] text-danger">
            <AlertIcon width={24} height={24} />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold text-main">
            Record could not be opened
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            {error || 'The record does not exist or is not available for this account.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/manual/records')}>
              Back to records
            </Button>
            <Button onClick={() => setReloadKey((key) => key + 1)}>Retry</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <Card className="p-5 animate-in">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="min-w-0">
              <Link to="/manual/records" className="link inline-flex items-center gap-1.5 text-xs">
                <ArrowLeftIcon width={14} height={14} /> Manual records
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words font-display text-2xl font-semibold text-main">
                  {record.sampleCode || record.reportId}
                </h2>
                <ManualGradeBadge grade={record.grade} />
                <RecordStatusBadge status={record.status} />
                <ReviewBadge review={record.review} />
              </div>
              <p className="mt-1 break-words text-xs text-muted">
                Record {record.reportId} · created {formatDateTime(record.createdAt)} · updated{' '}
                {formatDateTime(record.updatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={openEdit}>
                <EditIcon width={15} height={15} /> Edit record
              </Button>
              <Button variant="secondary" onClick={openReview}>
                <CheckIcon width={15} height={15} /> Review
              </Button>
              <Button
                variant="secondary"
                onClick={downloadReport}
                disabled={reportBusy}
              >
                {reportBusy ? <Spinner size={14} /> : <DownloadIcon width={15} height={15} />}
                Record PDF
              </Button>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <TrashIcon width={15} height={15} /> Delete
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="space-y-5">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-main">
                  <ImageIcon width={16} height={16} /> Stored grading image
                </p>
                <Badge tone="neutral">Authenticated view</Badge>
              </div>
              <div className="surface-soft flex min-h-[18rem] items-center justify-center">
                <ProtectedImage
                  url={record.image?.url}
                  alt={`Stored grading image for ${record.reportId}`}
                  className="max-h-[34rem] w-full object-contain"
                  label="Grading image"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-muted">
                <span>{record.image?.originalName || 'Stored image'}</span>
                <span>
                  {record.image?.width && record.image?.height
                    ? `${formatNumber(record.image.width)} × ${formatNumber(record.image.height)} px`
                    : 'Dimensions not recorded'}
                  {record.image?.size ? ` · ${(record.image.size / (1024 * 1024)).toFixed(2)} MB` : ''}
                </span>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xl font-semibold text-main">Grading details</h3>
                <Badge tone="a">Manually selected</Badge>
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {[
                  ['Manual grade', record.grade ? `Grade ${record.grade}` : 'Not graded'],
                  ['Record status', record.status === 'draft' ? 'Draft' : 'Completed'],
                  ['Grading date', formatDateTime(record.gradedAt)],
                  ['Reviewer', record.reviewerName || 'Not entered'],
                  ['Quantity', record.quantity === null ? 'Not entered' : formatNumber(record.quantity)],
                  ['Weight', formatWeightKg(record.weightKg)],
                  ['Average size', record.sizeMm === null ? 'Not entered' : `${formatNumber(record.sizeMm)} mm`],
                  ['Sample code', record.sampleCode || 'Not entered'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-[color:var(--panel-soft)] px-3 py-2.5">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                      {label}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-main">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="section-label">Visual condition</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-main">
                    {record.appearance || 'Not entered.'}
                  </p>
                </div>
                <div>
                  <p className="section-label">Observations</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-main">
                    {record.observations || 'Not entered.'}
                  </p>
                </div>
                <div>
                  <p className="section-label">Additional notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-main">
                    {record.notes || 'Not entered.'}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
                <p className="text-[11px] leading-relaxed text-muted">
                  This grade was selected by a person. The application did not infer it from the
                  image, and this record is not an officially accredited certificate.
                </p>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-xl font-semibold text-main">Correction history</h3>
                  <p className="mt-1 text-xs text-muted">
                    Chronological record of edits, review changes, and grade corrections.
                  </p>
                </div>
                <Badge tone="neutral">
                  {(record.corrections || []).length} entr{(record.corrections || []).length === 1 ? 'y' : 'ies'}
                </Badge>
              </div>

              {(record.corrections || []).length === 0 ? (
                <div className="py-8 text-center">
                  <HistoryIcon width={24} height={24} className="mx-auto text-muted opacity-50" />
                  <p className="mt-2 text-sm font-semibold text-main">No corrections yet</p>
                  <p className="mt-1 text-xs text-muted">Editing or reviewing this record will appear here.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {(record.corrections || [])
                    .slice()
                    .reverse()
                    .map((correction, index) => (
                      <div
                        key={`${correction.at}-${index}`}
                        className="rounded-2xl border border-[color:var(--border)] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge tone={correctionTone(correction.action)}>
                              {correctionLabel(correction.action)}
                            </Badge>
                            <span className="text-xs text-muted">{correction.byName || 'User'}</span>
                          </div>
                          <span className="text-[11px] text-muted">{formatDateTime(correction.at)}</span>
                        </div>
                        {correction.reason && (
                          <p className="mt-2 text-xs leading-relaxed text-main">
                            Reason: {correction.reason}
                          </p>
                        )}
                        <div className="mt-2 space-y-1.5">
                          {(correction.changes || []).map((change, changeIndex) => (
                            <div
                              key={`${change.field}-${changeIndex}`}
                              className="flex flex-wrap items-center gap-1.5 text-[11px]"
                            >
                              <span className="font-semibold text-main">{change.label || change.field}:</span>
                              <span className="rounded-md bg-[color:var(--danger-soft)] px-1.5 py-0.5 text-danger">
                                {valueText(change.from)}
                              </span>
                              <ArrowRightIcon width={12} height={12} className="text-muted" />
                              <span className="rounded-md bg-[color:var(--accent-soft)] px-1.5 py-0.5 text-accent">
                                {valueText(change.to)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold text-main">Batch</h3>
                {record.batch?.id ? (
                  <Link to={`/manual/batches/${record.batch.id}`} className="link text-xs">
                    Open batch
                  </Link>
                ) : null}
              </div>
              {record.batch ? (
                <div className="mt-3 rounded-2xl bg-[color:var(--panel-soft)] p-3">
                  <p className="text-sm font-semibold text-main">{record.batch.name || 'Batch'}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{record.batch.batchId}</p>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[color:var(--panel-soft)] p-3 text-sm text-muted">
                  <LayersIcon width={16} height={16} /> Not assigned to a batch
                </div>
              )}
              {record.batch?.id && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => navigate(`/manual/new?batch=${record.batch.id}`)}
                >
                  Add another sample to this batch
                </Button>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold text-main">Review status</h3>
                <ReviewBadge review={record.review} />
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Reviewed by</dt>
                  <dd className="text-right text-main">{record.review?.reviewedByName || '—'}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Reviewed at</dt>
                  <dd className="text-right text-main">{formatDateTime(record.review?.reviewedAt)}</dd>
                </div>
              </dl>
              {record.review?.notes && (
                <p className="mt-3 rounded-xl bg-[color:var(--panel-soft)] p-2.5 text-xs leading-relaxed text-main">
                  {record.review.notes}
                </p>
              )}
              <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={openReview}>
                <CheckIcon width={14} height={14} />{' '}
                {record.review?.reviewed ? 'Update review' : 'Mark reviewed'}
              </Button>
            </Card>

            <QualityPanel quality={record.imageQuality} className="shadow-none" compact />

            <Card className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg font-semibold text-main">
                    Digital assessment
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    A shareable application-generated assessment with a public verification link.
                  </p>
                </div>
                <ShieldCheckIcon width={20} height={20} className="text-accent" />
              </div>

              {record.assessment?.id ? (
                <div className="mt-3 space-y-2">
                  <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3">
                    <p className="text-sm font-semibold text-main">{record.assessment.id}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Issued {formatDateTime(record.assessment.issuedAt)}
                    </p>
                  </div>
                  {verifyUrl && (
                    <>
                      <p className="break-all rounded-xl border border-[color:var(--border)] p-2 text-[10px] text-muted">
                        {verifyUrl}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={copyVerifyLink}
                        >
                          <CopyIcon width={13} height={13} /> Copy link
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={() => window.open(verifyUrl, '_blank', 'noopener,noreferrer')}
                        >
                          Open
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="mt-3 rounded-xl bg-[color:var(--panel-soft)] p-2.5 text-xs leading-relaxed text-muted">
                  {record.grade
                    ? 'Generate an assessment when you are ready to share this manually graded record.'
                    : 'Assign a Grade A or Grade B before generating an assessment.'}
                </p>
              )}

              <div className="mt-3 space-y-2">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={generateAssessment}
                  disabled={assessmentBusy || !record.grade}
                >
                  {assessmentBusy ? <Spinner size={13} /> : <ShieldCheckIcon width={14} height={14} />}
                  {record.assessment?.id ? 'Refresh assessment' : 'Generate assessment'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={downloadAssessment}
                  disabled={assessmentBusy || !record.grade}
                >
                  <DownloadIcon width={14} height={14} /> Assessment PDF + QR
                </Button>
              </div>
            </Card>

            <Card className="p-4">
              <p className="section-label">Record identifiers</p>
              <dl className="mt-2 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Grading record</dt>
                  <dd className="text-right font-semibold text-main">{record.reportId}</dd>
                </div>
                {record.assessment?.id && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted">Assessment</dt>
                    <dd className="text-right font-semibold text-main">{record.assessment.id}</dd>
                  </div>
                )}
              </dl>
            </Card>
          </aside>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => !savingEdit && setEditOpen(false)}
        title="Edit manual grading record"
        description="Change only details you can verify. Grade changes require a correction reason and reset the review status."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {editForm && (
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                id="edit-batch"
                label="Batch"
                value={editForm.batch}
                onChange={(event) => setEditForm((current) => ({ ...current, batch: event.target.value }))}
              >
                <option value="">No batch</option>
                {record.batch?.id && !batches.some((batch) => batch.id === record.batch.id) && (
                  <option value={record.batch.id}>{record.batch.name}</option>
                )}
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name} · {batch.batchId}
                  </option>
                ))}
              </SelectField>
              <TextField
                id="edit-sample-code"
                label="Sample code"
                value={editForm.sampleCode}
                onChange={(event) => setEditForm((current) => ({ ...current, sampleCode: event.target.value }))}
                maxLength={80}
              />
              <div>
                <p className="field-label">Manual grade</p>
                <div className="grid grid-cols-2 gap-2">
                  {MANUAL_GRADE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setEditForm((current) => ({ ...current, grade: option.value }))}
                      className={`btn ${editForm.grade === option.value ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      Grade {option.value}
                    </button>
                  ))}
                </div>
              </div>
              <SelectField
                id="edit-status"
                label="Status"
                value={editForm.status}
                onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="completed">Completed</option>
                <option value="draft">Draft</option>
              </SelectField>
              <TextField
                id="edit-quantity"
                label="Quantity"
                type="number"
                min="1"
                step="1"
                value={editForm.quantity}
                onChange={(event) => setEditForm((current) => ({ ...current, quantity: event.target.value }))}
              />
              <TextField
                id="edit-weight"
                label="Weight (kg)"
                type="number"
                min="0.000001"
                step="0.001"
                value={editForm.weightKg}
                onChange={(event) => setEditForm((current) => ({ ...current, weightKg: event.target.value }))}
              />
              <TextField
                id="edit-size"
                label="Average size (mm)"
                type="number"
                min="0.1"
                step="0.1"
                value={editForm.sizeMm}
                onChange={(event) => setEditForm((current) => ({ ...current, sizeMm: event.target.value }))}
              />
              <TextField
                id="edit-graded-at"
                label="Grading date & time"
                type="datetime-local"
                value={editForm.gradedAt}
                onChange={(event) => setEditForm((current) => ({ ...current, gradedAt: event.target.value }))}
              />
              <TextField
                id="edit-reviewer"
                label="Reviewer"
                value={editForm.reviewerName}
                onChange={(event) => setEditForm((current) => ({ ...current, reviewerName: event.target.value }))}
                maxLength={80}
              />
              <TextField
                id="edit-appearance"
                label="Visual condition"
                value={editForm.appearance}
                onChange={(event) => setEditForm((current) => ({ ...current, appearance: event.target.value }))}
                maxLength={200}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="edit-observations">Observations</label>
              <textarea
                id="edit-observations"
                className="input min-h-20 resize-y"
                value={editForm.observations}
                onChange={(event) => setEditForm((current) => ({ ...current, observations: event.target.value }))}
                maxLength={500}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="edit-notes">Additional notes</label>
              <textarea
                id="edit-notes"
                className="input min-h-20 resize-y"
                value={editForm.notes}
                onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                maxLength={1000}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="edit-reason">
                Correction reason {gradeChangedInEdit ? '(required for grade change)' : '(optional)'}
              </label>
              <textarea
                id="edit-reason"
                className={`input min-h-20 resize-y ${gradeChangedInEdit && editForm.correctionReason.trim().length < 3 ? '!border-[color:var(--warn)]' : ''}`}
                value={editForm.correctionReason}
                onChange={(event) => setEditForm((current) => ({ ...current, correctionReason: event.target.value }))}
                maxLength={500}
                placeholder="Explain what was corrected and why."
              />
              {gradeChangedInEdit && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[color:var(--warn)]">
                  <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
                  Changing the grade will reset any existing review and require re-review.
                </p>
              )}
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={reviewOpen}
        onClose={() => !savingReview && setReviewOpen(false)}
        title="Review this record"
        description="Confirm the saved manual grade and image, or flag the image for follow-up."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewOpen(false)} disabled={savingReview}>
              Cancel
            </Button>
            <Button onClick={saveReview} disabled={savingReview}>
              {savingReview ? <Spinner size={14} /> : <CheckIcon width={15} height={15} />}
              {savingReview ? 'Saving…' : 'Save review'}
            </Button>
          </>
        }
      >
        {reviewForm && (
          <form onSubmit={saveReview} className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[color:var(--border)] p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[color:var(--accent)]"
                checked={reviewForm.reviewed}
                onChange={(event) => setReviewForm((current) => ({ ...current, reviewed: event.target.checked }))}
              />
              <span>
                <span className="block text-sm font-semibold text-main">Mark as reviewed</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Confirms that the record and its manual grade were checked by you.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[color:var(--border)] p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[color:var(--warn)]"
                checked={reviewForm.imageFlagged}
                onChange={(event) => setReviewForm((current) => ({ ...current, imageFlagged: event.target.checked }))}
              />
              <span>
                <span className="block text-sm font-semibold text-main">Flag the stored image</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Use this when the photo is unsuitable or needs replacement. It does not change the grade.
                </span>
              </span>
            </label>

            <div>
              <label className="field-label" htmlFor="review-notes">Review notes</label>
              <textarea
                id="review-notes"
                className="input min-h-24 resize-y"
                value={reviewForm.notes}
                onChange={(event) => setReviewForm((current) => ({ ...current, notes: event.target.value }))}
                maxLength={500}
                placeholder="What did you check? Add any follow-up needed."
              />
            </div>
            <div>
              <label className="field-label" htmlFor="review-reason">Reason (optional)</label>
              <input
                id="review-reason"
                className="input"
                value={reviewForm.reason}
                onChange={(event) => setReviewForm((current) => ({ ...current, reason: event.target.value }))}
                maxLength={500}
                placeholder="Reason for the review update."
              />
            </div>

            <div className="rounded-2xl bg-[color:var(--panel-soft)] p-3 text-[11px] leading-relaxed text-muted">
              Review status confirms a human check only. It does not convert this record into an
              official or accredited grading certificate.
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this grading record?"
        description={`${record.reportId} and its stored image will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete record"
        destructive
        loading={deleting}
        onConfirm={deleteRecord}
        onClose={() => !deleting && setDeleteOpen(false)}
      />
    </>
  );
}
