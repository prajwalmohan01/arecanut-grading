'use strict';

const PDFDocument = require('pdfkit');

const COLORS = {
  forest: '#1F5136',
  emerald: '#2F7D5B',
  mint: '#E8F3EC',
  charcoal: '#1F2937',
  muted: '#5B6B63',
  gold: '#A8843C',
  line: '#DCE7E0',
  danger: '#A33A3A',
  white: '#FFFFFF',
};

const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;

function gradeColor(grade) {
  if (grade === 'A') return COLORS.emerald;
  if (grade === 'B') return COLORS.gold;
  return COLORS.muted;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatWeight(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${formatNumber(value, 3)} kg`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function drawHeader(doc, label) {
  doc.rect(0, 0, doc.page.width, 74).fill(COLORS.forest);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(COLORS.white)
    .text('ARECANUT QUALITY GRADING', PAGE_MARGIN, 22, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#D6E7DC')
    .text('MANUAL GRADING WORKSPACE', PAGE_MARGIN, 43, {
      characterSpacing: 1.2,
      lineBreak: false,
    });
  if (label) {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#D6E7DC')
      .text(label, PAGE_MARGIN, 43, {
        width: CONTENT_WIDTH,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.y = 96;
}

function addFooters(doc, note) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - 44;
    doc
      .moveTo(PAGE_MARGIN, y - 8)
      .lineTo(doc.page.width - PAGE_MARGIN, y - 8)
      .strokeColor(COLORS.line)
      .lineWidth(0.7)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(note, PAGE_MARGIN, y, { width: 360, lineBreak: false });
    doc.text(`Page ${index + 1} of ${range.count}`, doc.page.width - PAGE_MARGIN - 100, y, {
      width: 100,
      align: 'right',
      lineBreak: false,
    });
  }
}

function sectionTitle(doc, title) {
  if (doc.y > doc.page.height - 110) doc.addPage();
  doc.moveDown(0.35);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.forest)
    .text(String(title).toUpperCase(), PAGE_MARGIN, doc.y, {
      characterSpacing: 0.8,
      width: CONTENT_WIDTH,
    });
  doc
    .moveTo(PAGE_MARGIN, doc.y + 4)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y + 4)
    .strokeColor(COLORS.line)
    .lineWidth(0.7)
    .stroke();
  doc.y += 12;
}

function paragraph(doc, text, { size = 9, color = COLORS.charcoal, width = CONTENT_WIDTH } = {}) {
  if (!text) return;
  doc
    .font('Helvetica')
    .fontSize(size)
    .fillColor(color)
    .text(String(text), PAGE_MARGIN, doc.y, {
      width,
      lineGap: 2,
    });
  doc.moveDown(0.4);
}

function detailGrid(doc, fields, columns = 2) {
  const colWidth = CONTENT_WIDTH / columns;
  const rowHeight = 38;
  let column = 0;
  let y = doc.y;

  fields.forEach((field, index) => {
    if (column === 0 && index > 0) y += rowHeight;
    const x = PAGE_MARGIN + column * colWidth;
    if (y + rowHeight > doc.page.height - 70) {
      doc.addPage();
      y = doc.y;
      column = 0;
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(String(field.label || '').toUpperCase(), x, y, {
        width: colWidth - 12,
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(COLORS.charcoal)
      .text(field.value === null || field.value === undefined || field.value === '' ? '—' : String(field.value), x, y + 10, {
        width: colWidth - 12,
        height: 24,
        ellipsis: true,
      });
    column += 1;
    if (column >= columns) column = 0;
  });

  doc.y = y + rowHeight;
}

function callout(doc, title, text, tone = 'mint') {
  const background = tone === 'warn' ? '#FBF3E5' : COLORS.mint;
  const color = tone === 'warn' ? '#7A5A24' : COLORS.forest;
  const width = CONTENT_WIDTH;
  const titleHeight = 14;
  const textWidth = width - 24;
  doc.font('Helvetica').fontSize(8).fillColor(color);
  const textHeight = doc.heightOfString(text, { width: textWidth, lineGap: 1.5 });
  const height = titleHeight + textHeight + 18;
  if (doc.y + height > doc.page.height - 70) doc.addPage();
  doc.save();
  doc.roundedRect(PAGE_MARGIN, doc.y, width, height, 7).fill(background);
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(color)
    .text(title, PAGE_MARGIN + 12, doc.y + 8, { width: textWidth });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.charcoal)
    .text(text, PAGE_MARGIN + 12, doc.y + 22, { width: textWidth, lineGap: 1.5 });
  doc.y += height + 12;
}

function gradeBox(doc, grade, status, review) {
  const y = doc.y;
  const height = 66;
  doc.save();
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, height, 8).fill(COLORS.mint);
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text('MANUALLY ASSIGNED GRADE', PAGE_MARGIN + 14, y + 12, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(23)
    .fillColor(gradeColor(grade))
    .text(grade ? `Grade ${grade}` : 'Not graded', PAGE_MARGIN + 14, y + 24, {
      lineBreak: false,
    });
  const rightX = PAGE_MARGIN + CONTENT_WIDTH - 220;
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text('RECORD STATUS', rightX, y + 12, { width: 100, lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.charcoal)
    .text(status === 'completed' ? 'Completed' : 'Draft / pending', rightX, y + 24, {
      width: 100,
      lineBreak: false,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text('REVIEW', rightX + 108, y + 12, { width: 100, lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.charcoal)
    .text(review?.reviewed ? 'Reviewed' : 'Not reviewed', rightX + 108, y + 24, {
      width: 110,
      lineBreak: false,
    });
  doc.y = y + height + 14;
}

function addImage(doc, buffer, caption) {
  if (!buffer) return;
  if (doc.y + 230 > doc.page.height - 70) doc.addPage();
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(String(caption).toUpperCase(), PAGE_MARGIN, doc.y);
  doc.moveDown(0.3);
  const y = doc.y;
  const height = 210;
  doc.save();
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, height, 6).fill('#F4F7F4');
  doc.restore();
  try {
    doc.image(buffer, PAGE_MARGIN + 6, y + 6, {
      fit: [CONTENT_WIDTH - 12, height - 12],
      align: 'center',
      valign: 'center',
    });
  } catch {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(COLORS.danger)
      .text('The stored image could not be embedded in this PDF.', PAGE_MARGIN + 12, y + 12, {
        width: CONTENT_WIDTH - 24,
      });
  }
  doc.y = y + height + 12;
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function baseDocument(title) {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 64, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: title,
      Author: 'ARECANUT QUALITY GRADING SYSTEM',
      Subject: 'Manual arecanut grading document',
      Creator: 'ARECANUT QUALITY GRADING SYSTEM',
    },
  });
}

function recordDetailFields(record) {
  return [
    { label: 'Record ID', value: record.reportId },
    { label: 'Sample code', value: record.sampleCode || '—' },
    {
      label: 'Batch',
      value: record.batchName
        ? `${record.batchName}${record.batchCode ? ` (${record.batchCode})` : ''}`
        : record.batchCode || 'Not assigned',
    },
    { label: 'Grading date', value: formatDateTime(record.gradedAt) },
    { label: 'Reviewer', value: record.reviewerName || 'Not entered' },
    { label: 'Quantity', value: record.quantity === null || record.quantity === undefined ? '—' : formatNumber(record.quantity) },
    { label: 'Weight', value: formatWeight(record.weightKg) },
    { label: 'Size', value: record.sizeMm === null || record.sizeMm === undefined ? '—' : `${formatNumber(record.sizeMm, 2)} mm` },
    { label: 'Visual condition', value: record.appearance || 'Not entered' },
    {
      label: 'Review status',
      value: record.review?.reviewed
        ? `Reviewed${record.review.reviewedByName ? ` by ${record.review.reviewedByName}` : ''}`
        : 'Not reviewed',
    },
    {
      label: 'Image quality check',
      value: record.imageQuality?.checked
        ? `${record.imageQuality.warnings?.length || 0} advisory warning(s)`
        : 'Not recorded',
    },
    { label: 'Image file size', value: formatBytes(record.image?.size) },
  ];
}

async function buildManualRecordPdf({ record, batch, imageBuffer }) {
  const doc = baseDocument(`Manual grading record ${record.reportId}`);
  drawHeader(doc, `RECORD ${record.reportId}`);
  doc
    .font('Helvetica-Bold')
    .fontSize(19)
    .fillColor(COLORS.charcoal)
    .text('Manual grading record', PAGE_MARGIN, doc.y);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(`Generated ${formatDateTime(new Date())}`, PAGE_MARGIN, doc.y + 4);
  doc.moveDown(0.8);

  callout(
    doc,
    'Manual assessment',
    'This grade was selected manually by the user. It is not an automated prediction. This application-generated record is not an officially accredited certificate.',
    'mint'
  );

  gradeBox(doc, record.grade, record.status, record.review);
  sectionTitle(doc, 'Record details');
  detailGrid(doc, recordDetailFields(record));

  if (batch) {
    sectionTitle(doc, 'Batch context');
    detailGrid(doc, [
      { label: 'Batch name', value: batch.name },
      { label: 'Batch ID', value: batch.batchId },
      { label: 'Supplier / collection', value: batch.supplier || 'Not entered' },
      { label: 'Collection date', value: formatDate(batch.collectionDate) },
    ]);
  }

  addImage(doc, imageBuffer, 'Original grading image');

  sectionTitle(doc, 'Observations and remarks');
  paragraph(doc, record.observations || 'No observations were entered.', {
    color: record.observations ? COLORS.charcoal : COLORS.muted,
  });
  paragraph(doc, record.notes || 'No additional notes were entered.', {
    color: record.notes ? COLORS.charcoal : COLORS.muted,
  });

  if (record.review?.notes || record.review?.imageFlagged) {
    sectionTitle(doc, 'Review notes');
    if (record.review?.imageFlagged) {
      callout(doc, 'Image flagged', 'The reviewer flagged the stored image as unsuitable for reference use.', 'warn');
    }
    if (record.review?.notes) paragraph(doc, record.review.notes);
  }

  const corrections = Array.isArray(record.corrections) ? record.corrections : [];
  if (corrections.length) {
    sectionTitle(doc, 'Change history');
    corrections.slice(-12).forEach((correction) => {
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(COLORS.charcoal)
        .text(
          `${correction.action === 'grade-correction' ? 'Grade correction' : correction.action === 'review' ? 'Review' : 'Update'} · ${formatDateTime(correction.at)}`,
          PAGE_MARGIN,
          doc.y
        );
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(
          `${correction.byName || 'User'}${correction.reason ? ` · ${correction.reason}` : ''}`,
          PAGE_MARGIN,
          doc.y + 1
        );
      (correction.changes || []).forEach((change) => {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(COLORS.charcoal)
          .text(
            `${change.label || change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`,
            PAGE_MARGIN + 10,
            doc.y + 1,
            { width: CONTENT_WIDTH - 10 }
          );
      });
      doc.moveDown(0.45);
    });
  }

  addFooters(
    doc,
    `Manual grading record ${record.reportId} · User-entered data · Not an AI prediction`
  );
  return collectPdf(doc);
}

function drawTableHeader(doc, y) {
  doc.save();
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 18).fill(COLORS.mint);
  doc.restore();
  const columns = [
    { x: 0, label: 'Record', width: 105 },
    { x: 105, label: 'Sample', width: 65 },
    { x: 170, label: 'Grade', width: 42 },
    { x: 212, label: 'Qty', width: 42 },
    { x: 254, label: 'Weight', width: 58 },
    { x: 312, label: 'Reviewer', width: 70 },
    { x: 382, label: 'Graded', width: 65 },
    { x: 447, label: 'Review', width: 52 },
  ];
  columns.forEach((column) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(COLORS.muted)
      .text(column.label.toUpperCase(), PAGE_MARGIN + column.x + 3, y + 6, {
        width: column.width - 4,
        lineBreak: false,
      });
  });
  return y + 18;
}

function drawBatchTable(doc, records) {
  let y = drawTableHeader(doc, doc.y);
  records.forEach((record, index) => {
    if (y + 22 > doc.page.height - 70) {
      doc.addPage();
      y = drawTableHeader(doc, doc.y);
    }
    if (index % 2 === 1) {
      doc.save();
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 22).fill('#FAFCFA');
      doc.restore();
    }
    const values = [
      record.reportId,
      record.sampleCode || '—',
      record.grade ? `Grade ${record.grade}` : 'Draft',
      record.quantity === null || record.quantity === undefined ? '—' : formatNumber(record.quantity),
      formatWeight(record.weightKg),
      record.reviewerName || '—',
      formatDate(record.gradedAt),
      record.review?.reviewed ? 'Reviewed' : 'Pending',
    ];
    const columns = [
      { x: 0, width: 105 },
      { x: 105, width: 65 },
      { x: 170, width: 42 },
      { x: 212, width: 42 },
      { x: 254, width: 58 },
      { x: 312, width: 70 },
      { x: 382, width: 65 },
      { x: 447, width: 52 },
    ];
    values.forEach((value, columnIndex) => {
      const column = columns[columnIndex];
      doc
        .font(columnIndex === 2 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(7.2)
        .fillColor(
          columnIndex === 2 && record.grade ? gradeColor(record.grade) : COLORS.charcoal
        )
        .text(String(value), PAGE_MARGIN + column.x + 3, y + 7, {
          width: column.width - 4,
          height: 10,
          ellipsis: true,
          lineBreak: false,
        });
    });
    doc
      .moveTo(PAGE_MARGIN, y + 22)
      .lineTo(doc.page.width - PAGE_MARGIN, y + 22)
      .strokeColor(COLORS.line)
      .lineWidth(0.35)
      .stroke();
    y += 22;
  });
  doc.y = y + 8;
}

async function buildManualBatchPdf({ batch, stats, records, imageNote }) {
  const doc = baseDocument(`Manual batch report ${batch.batchId}`);
  drawHeader(doc, `BATCH ${batch.batchId}`);
  doc
    .font('Helvetica-Bold')
    .fontSize(19)
    .fillColor(COLORS.charcoal)
    .text('Manual batch report', PAGE_MARGIN, doc.y);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(`Generated ${formatDateTime(new Date())}`, PAGE_MARGIN, doc.y + 4);
  doc.moveDown(0.8);

  callout(
    doc,
    'About this report',
    'All grades in this report were selected manually by the user. The application does not predict grades automatically. Totals only include values that were actually entered and saved.',
    'mint'
  );

  sectionTitle(doc, 'Batch summary');
  detailGrid(doc, [
    { label: 'Batch name', value: batch.name },
    { label: 'Batch ID', value: batch.batchId },
    { label: 'Supplier / collection', value: batch.supplier || 'Not entered' },
    { label: 'Collection date', value: formatDate(batch.collectionDate) },
    { label: 'Status', value: batch.status === 'completed' ? 'Completed' : 'Open' },
    { label: 'Target samples', value: batch.targetSamples ?? 'Not set' },
    { label: 'Target weight', value: batch.targetWeightKg ? formatWeight(batch.targetWeightKg) : 'Not set' },
    { label: 'Saved records', value: formatNumber(stats.totalRecords) },
  ]);

  const cards = [
    { label: 'Completed', value: formatNumber(stats.completed) },
    { label: 'Drafts', value: formatNumber(stats.drafts) },
    { label: 'Pending samples', value: stats.pendingSamples === null ? '—' : formatNumber(stats.pendingSamples) },
    { label: 'Weight recorded', value: formatWeight(stats.totalWeightKg) },
  ];
  const cardWidth = (CONTENT_WIDTH - 24) / 4;
  const cardY = doc.y;
  cards.forEach((card, index) => {
    const x = PAGE_MARGIN + index * (cardWidth + 8);
    doc.save();
    doc.roundedRect(x, cardY, cardWidth, 52, 6).fill('#F6F9F6');
    doc.restore();
    doc
      .font('Helvetica-Bold')
      .fontSize(6)
      .fillColor(COLORS.muted)
      .text(card.label.toUpperCase(), x + 8, cardY + 9, { width: cardWidth - 16, lineBreak: false });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLORS.forest)
      .text(card.value, x + 8, cardY + 22, { width: cardWidth - 16, lineBreak: false });
  });
  doc.y = cardY + 64;

  sectionTitle(doc, 'Grade distribution');
  detailGrid(doc, [
    { label: 'Grade A', value: formatNumber(stats.gradeA) },
    { label: 'Grade B', value: formatNumber(stats.gradeB) },
    { label: 'Unassigned drafts', value: formatNumber(stats.drafts) },
    { label: 'Reviewed records', value: formatNumber(stats.reviewed) },
    { label: 'Flagged images', value: formatNumber(stats.flagged) },
    { label: 'Total quantity entered', value: formatNumber(stats.totalQuantity) },
  ]);

  if (batch.notes) {
    sectionTitle(doc, 'Batch notes');
    paragraph(doc, batch.notes);
  }

  sectionTitle(doc, 'Grading records');
  if (!records.length) {
    paragraph(doc, 'No grading records have been saved in this batch yet.', {
      color: COLORS.muted,
    });
  } else {
    drawBatchTable(doc, records);
  }

  if (imageNote) {
    callout(doc, 'Images', imageNote, 'mint');
  }

  addFooters(
    doc,
    `Manual batch report ${batch.batchId} · User-entered data · Not an AI prediction`
  );
  return collectPdf(doc);
}

async function buildManualAssessmentPdf({
  record,
  batch,
  assessment,
  verifyUrl,
  qrBuffer,
  imageBuffer,
}) {
  const doc = baseDocument(`Grading assessment ${assessment.id}`);
  drawHeader(doc, `ASSESSMENT ${assessment.id}`);
  doc
    .font('Helvetica-Bold')
    .fontSize(19)
    .fillColor(COLORS.charcoal)
    .text('Grading assessment', PAGE_MARGIN, doc.y);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(`Issued ${formatDateTime(assessment.issuedAt)}`, PAGE_MARGIN, doc.y + 4);
  doc.moveDown(0.8);

  callout(
    doc,
    'Document scope',
    'This is an application-generated grading assessment based on a manually selected grade. It is not an officially accredited certificate. Verification confirms only the limited details shown by the verification page.',
    'mint'
  );

  sectionTitle(doc, 'Assessment details');
  detailGrid(doc, [
    { label: 'Assessment ID', value: assessment.id },
    { label: 'Issue date', value: formatDate(assessment.issuedAt) },
    { label: 'Grading record', value: record.reportId },
    { label: 'Sample code', value: record.sampleCode || '—' },
    { label: 'Batch', value: record.batchName || record.batchCode || 'Not assigned' },
    { label: 'Batch ID', value: record.batchCode || '—' },
    { label: 'Reviewer', value: record.reviewerName || 'Not entered' },
    { label: 'Grading date', value: formatDateTime(record.gradedAt) },
  ]);

  gradeBox(doc, record.grade, record.status, record.review);

  const qrSize = 108;
  if (qrBuffer) {
    if (doc.y + qrSize + 46 > doc.page.height - 70) doc.addPage();
    const qrY = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text('VERIFY THIS ASSESSMENT', PAGE_MARGIN, qrY);
    doc.image(qrBuffer, PAGE_MARGIN, qrY + 12, { fit: [qrSize, qrSize] });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.charcoal)
      .text('Scan the QR code or open the verification link below.', PAGE_MARGIN + qrSize + 18, qrY + 16, {
        width: CONTENT_WIDTH - qrSize - 24,
      });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(verifyUrl, PAGE_MARGIN + qrSize + 18, doc.y + 4, {
        width: CONTENT_WIDTH - qrSize - 24,
        link: verifyUrl,
        underline: false,
      });
    doc
      .font('Helvetica-Oblique')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        'The public verification page never displays the stored image, notes, supplier, or account details.',
        PAGE_MARGIN + qrSize + 18,
        doc.y + 4,
        { width: CONTENT_WIDTH - qrSize - 24 }
      );
    doc.y = qrY + qrSize + 28;
  }

  if (batch) {
    sectionTitle(doc, 'Batch information');
    detailGrid(doc, [
      { label: 'Batch name', value: batch.name },
      { label: 'Batch ID', value: batch.batchId },
      { label: 'Collection date', value: formatDate(batch.collectionDate) },
      { label: 'Batch status', value: batch.status === 'completed' ? 'Completed' : 'Open' },
    ]);
  }

  addImage(doc, imageBuffer, 'Original grading image');

  sectionTitle(doc, 'Observations and remarks');
  paragraph(doc, record.observations || 'No observations were entered.', {
    color: record.observations ? COLORS.charcoal : COLORS.muted,
  });
  paragraph(doc, record.notes || 'No additional notes were entered.', {
    color: record.notes ? COLORS.charcoal : COLORS.muted,
  });

  if (record.review?.notes || record.review?.imageFlagged) {
    sectionTitle(doc, 'Review note');
    if (record.review?.imageFlagged) {
      callout(doc, 'Flagged image', 'The reviewer flagged the stored image as unsuitable for reference use.', 'warn');
    }
    if (record.review?.notes) paragraph(doc, record.review.notes);
  }

  callout(
    doc,
    'Verification limitation',
    'A successful verification confirms that this assessment ID and record are stored in the application. It does not certify commercial quality, market price, or regulatory compliance.',
    'warn'
  );

  addFooters(
    doc,
    `Application-generated grading assessment ${assessment.id} · Not an accredited certificate`
  );
  return collectPdf(doc);
}

module.exports = {
  buildManualRecordPdf,
  buildManualBatchPdf,
  buildManualAssessmentPdf,
};
