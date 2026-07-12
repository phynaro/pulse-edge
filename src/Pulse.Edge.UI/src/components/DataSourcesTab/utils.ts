export function templateThemeClass(id: string): string {
  if (id === 'General') return 'theme-general';
  if (id === 'Production') return 'theme-production';
  if (id === 'Energy') return 'theme-energy';
  return 'theme-custom';
}

export function formatLiveValue(value: string | null | undefined, dataType: string): string {
  if (value === null || value === undefined || value === '') return '—';

  const num = parseFloat(value);
  if (isNaN(num)) return value;

  const lowerDataType = dataType.toLowerCase();
  if (lowerDataType.includes('int') || lowerDataType.includes('word') || lowerDataType.includes('bool')) {
    return Math.round(num).toString();
  }

  return parseFloat(num.toFixed(2)).toString();
}
