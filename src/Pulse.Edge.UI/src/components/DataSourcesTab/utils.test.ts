import { describe, expect, it } from 'vitest';
import { formatLiveValue, templateThemeClass } from './utils';

describe('data source formatting utilities', () => {
  it('formats missing, textual, integer, boolean, and decimal values', () => {
    expect(formatLiveValue(null, 'Double')).toBe('—');
    expect(formatLiveValue('Running', 'String')).toBe('Running');
    expect(formatLiveValue('12.7', 'Int32')).toBe('13');
    expect(formatLiveValue('1', 'Boolean')).toBe('1');
    expect(formatLiveValue('12.3456', 'Double')).toBe('12.35');
  });

  it('maps built-in templates and falls back to custom styling', () => {
    expect(templateThemeClass('General')).toBe('theme-general');
    expect(templateThemeClass('Production')).toBe('theme-production');
    expect(templateThemeClass('Energy')).toBe('theme-energy');
    expect(templateThemeClass('Plant-specific')).toBe('theme-custom');
  });
});
