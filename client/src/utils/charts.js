export function chartTheme() {
  if (typeof window === 'undefined') {
    return { text: '#5d6d62', grid: 'rgba(31,81,54,0.12)', emerald: '#2f9d6d', gold: '#b08c42', danger: '#b44242' };
  }
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    text: read('--muted', '#5d6d62'),
    grid: read('--border', 'rgba(31,81,54,0.12)'),
    emerald: read('--accent', '#2f9d6d'),
    gold: read('--gold', '#b08c42'),
    danger: read('--danger', '#b44242'),
  };
}

export function baseChartOptions(theme) {
  const text = theme?.text || '#5d6d62';
  const grid = theme?.grid || 'rgba(31,81,54,0.12)';
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: text,
          font: { size: 11, family: 'DM Sans' },
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: 'rgba(12, 32, 21, 0.94)',
        titleFont: { family: 'DM Sans', size: 12 },
        bodyFont: { family: 'DM Sans', size: 12 },
        padding: 10,
        cornerRadius: 10,
      },
    },
    scales: {
      x: {
        ticks: { color: text, font: { size: 10, family: 'DM Sans' } },
        grid: { display: false },
        border: { color: grid },
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: text,
          precision: 0,
          font: { size: 10, family: 'DM Sans' },
        },
        grid: { color: grid },
        border: { display: false },
      },
    },
  };
}
