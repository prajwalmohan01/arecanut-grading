export function formatDateTime(value) {
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

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString();
}

export const GRADE_LETTERS = ['A', 'B', 'C', 'D'];

export function gradeTone(grade) {
  if (grade === 'Grade A') return 'a';
  if (grade === 'Grade B') return 'b';
  if (grade === 'Grade C') return 'c';
  if (grade === 'Grade D') return 'd';
  return 'invalid';
}

export function gradeDescription(grade) {
  switch (grade) {
    case 'Grade A':
      return 'Excellent — majority of detected nuts classified Grade A';
    case 'Grade B':
      return 'Good — majority of detected nuts classified Grade B';
    case 'Grade C':
      return 'Fair — majority of detected nuts classified Grade C';
    case 'Grade D':
      return 'Poor — majority of detected nuts classified Grade D';
    case 'Invalid':
      return 'No arecanut regions detected above the confidence threshold';
    default:
      return 'Unknown grade';
  }
}

export function gradeColor(grade) {
  if (grade === 'Grade A') return '#2f9d6d';
  if (grade === 'Grade B') return '#b08c42';
  if (grade === 'Grade C') return '#c77a2e';
  if (grade === 'Grade D') return '#b44242';
  return '#b44242';
}

/** Per-grade counts for a scan, using the API's gradeCounts when present. */
export function gradeBreakdown(scan) {
  const counts = scan?.gradeCounts || {};
  return GRADE_LETTERS.map((letter) => ({
    letter,
    grade: `Grade ${letter}`,
    count: Number(counts[letter] ?? scan?.[`grade${letter}`] ?? 0),
  }));
}

/** Grades the checkpoint that produced this scan actually supports. */
export function supportedGradeLetters(scan) {
  if (Array.isArray(scan?.supportedGrades) && scan.supportedGrades.length) {
    return scan.supportedGrades.filter((letter) => GRADE_LETTERS.includes(letter));
  }
  return ['A', 'B'];
}

export function compareArrow(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  if (number === 0) return '0';
  const direction = number > 0 ? '↑' : '↓';
  const sign = number > 0 ? '+' : '';
  return `${direction} ${sign}${number.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
}

export function shortId(id) {
  if (!id) return '—';
  return String(id).slice(-6).toUpperCase();
}

export function downloadName(reportId, suffix = 'report') {
  const safe = String(reportId || 'prediction').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `arecanut-${suffix}-${safe}.pdf`;
}

const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  LKR: 'Rs',
  NPR: 'Rs',
  BDT: '৳',
  PKR: 'Rs',
};

export function currencySymbol(currency = 'INR') {
  return CURRENCY_SYMBOLS[String(currency || 'INR').toUpperCase()] || String(currency || 'INR');
}

export function formatCurrency(value, currency = 'INR', digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const symbol = currencySymbol(currency);
  return `${symbol}${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatWeightKg(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  const digits = Math.abs(number) >= 100 ? 1 : Math.abs(number) >= 1 ? 2 : 3;
  return `${number.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })} kg`;
}

export function csvDownloadName(prefix, value) {
  const safe = String(value || 'export').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `arecanut-${prefix}-${safe}.csv`;
}
