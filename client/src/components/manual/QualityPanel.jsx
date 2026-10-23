import { AlertIcon, CheckIcon, ImageIcon } from '../Icons';
import { qualityMetric } from '../../utils/imageQuality';

export default function QualityPanel({ quality, className = '', compact = false }) {
  if (!quality?.checked) {
    return (
      <div className={`surface-soft rounded-2xl p-4 ${className}`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-main">
          <ImageIcon width={16} height={16} />
          Upload check not completed
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Image dimensions and upload warnings are recorded when a photo is added. This check
          does not assess arecanut quality.
        </p>
      </div>
    );
  }

  const warnings = quality.warnings || [];
  const metrics = [
    { label: 'Dimensions', value: `${qualityMetric(quality.width)} × ${qualityMetric(quality.height)} px` },
    { label: 'Brightness', value: qualityMetric(quality.brightness, ' / 255') },
    { label: 'Blur score', value: qualityMetric(quality.blurScore) },
  ];

  return (
    <div
      className={`rounded-2xl border p-4 ${
        warnings.length
          ? 'border-[color:var(--warn)] bg-[color:var(--warn-soft)]'
          : 'border-[color:var(--border)] bg-[color:var(--panel-soft)]'
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-main">
            {warnings.length ? (
              <AlertIcon width={16} height={16} className="text-[color:var(--warn)]" />
            ) : (
              <CheckIcon width={16} height={16} className="text-accent" />
            )}
            {warnings.length ? 'Upload warnings' : 'Upload check passed'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Advisory browser check for image usability only — not a grade or nut-quality result.
          </p>
        </div>
      </div>

      <div className={`mt-3 grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}`}>
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl bg-[color:var(--panel-strong)] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
              {metric.label}
            </p>
            <p className="mt-1 text-xs font-semibold text-main">{metric.value}</p>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-xs leading-relaxed text-main">
              <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--warn)]" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
