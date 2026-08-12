import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check, ChevronDown } from 'lucide-react';
import './LanguageSwitcher.css';

interface LanguageOption {
  code: 'en' | 'th';
  label: string;
  shortLabel: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', shortLabel: 'EN', flag: '🇺🇸' },
  { code: 'th', label: 'ไทย (Thai)', shortLabel: 'TH', flag: '🇹🇭' },
];

interface LanguageSwitcherProps {
  variant?: 'compact' | 'full';
}

export default function LanguageSwitcher({ variant = 'compact' }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLang = (i18n.language as 'en' | 'th') || 'en';
  const activeOption = LANGUAGES.find((l) => l.code === currentLang) || LANGUAGES[0];

  const handleSelectLanguage = (code: 'en' | 'th') => {
    void i18n.changeLanguage(code);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="language-switcher" ref={dropdownRef}>
      <button
        type="button"
        className={`lang-toggle-btn ${variant === 'full' ? 'full-width' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={t('languageSwitcher.title')}
        aria-label="Switch Language"
        aria-expanded={isOpen}
      >
        <Globe size={15} className="lang-icon" />
        <span className="lang-flag">{activeOption.flag}</span>
        <span className="lang-label">
          {variant === 'full' ? activeOption.label : activeOption.shortLabel}
        </span>
        <ChevronDown size={14} className={`lang-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="lang-dropdown">
          <div className="lang-dropdown-header">
            <span>{t('languageSwitcher.title')}</span>
          </div>
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              className={`lang-option ${lang.code === currentLang ? 'selected' : ''}`}
              onClick={() => handleSelectLanguage(lang.code)}
            >
              <span className="lang-option-flag">{lang.flag}</span>
              <span className="lang-option-name">{lang.label}</span>
              {lang.code === currentLang && <Check size={14} className="lang-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
