import { usePolicy } from '../context/PolicyContext';
import { AlertIcon, SparkIcon } from './Icons';

const DEFECT_LABELS = {
  blackSpots: 'black spots',
  cracks: 'cracks',
  mold: 'suspected mold',
  discoloration: 'discoloration',
};

export default function PolicyNotice({ policy: suppliedPolicy, className = '', showPricing = false }) {
  const { policy: contextPolicy } = usePolicy();
  const policy = suppliedPolicy || contextPolicy;
  if (!policy) return null;

  if (policy.masterEnabled === false) {
    return (
      <div className={`alert alert-warn items-start text-xs leading-relaxed ${className}`}>
        <AlertIcon width={17} height={17} />
        <div>
          <p className="font-semibold">AI grading is disabled by the administrator</p>
          <p className="mt-0.5">
            Grades, counts, percentages, confidence, charts, price estimates, and PDF grade
            sections are suppressed. Historical records remain stored but are filtered
            non-destructively by the active policy.
          </p>
        </div>
      </div>
    );
  }

  const letters = Array.isArray(policy.enabledLetters) ? policy.enabledLetters : [];
  const advisoryGrades = letters.filter((letter) => ['C', 'D'].includes(letter));
  const showAdvisoryNote = advisoryGrades.length > 0 && policy.geminiEnabled;
  const enabledDefects = Array.isArray(policy.enabledDefectCategories)
    ? policy.enabledDefectCategories
    : [];
  const showDefectNote = Boolean(policy.defectDetectionEnabled && enabledDefects.length);

  if (
    !showAdvisoryNote &&
    !showDefectNote &&
    (!showPricing || policy.pricingMode !== 'none')
  ) {
    return null;
  }

  return (
    <div className={`alert items-start text-[11px] leading-relaxed text-muted ${className}`}>
      <SparkIcon width={16} height={16} />
      <span>
        {showAdvisoryNote && (
          <>
            Grade {advisoryGrades.join(' / Grade ')} is enabled for Gemini-assisted visual review
            only. Gemini is not an object detector: it does not create per-nut counts, bounding
            boxes, or confidence values.
            {(showDefectNote || (showPricing && policy.pricingMode === 'none')) ? ' ' : ''}
          </>
        )}
        {showDefectNote && (
          <>
            Defect review covers {enabledDefects.map((key) => DEFECT_LABELS[key] || key).join(', ')}
            {' '}at image level only. &ldquo;Suspected Mold&rdquo; is not a confirmed fungal
            infection. Affected-nut counts and defect locations require a validated detector and
            are not claimed.
            {showPricing && policy.pricingMode === 'none' ? ' ' : ''}
          </>
        )}
        {showPricing && policy.pricingMode === 'none' && (
          <>No pricing mode is active, so no price estimate is shown.</>
        )}
      </span>
    </div>
  );
}
