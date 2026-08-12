import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import './CustomSelect.css';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  className = '',
  disabled = false
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // If space below is less than 220px and top space is larger, drop upwards
      if (spaceBelow < 220 && rect.top > 220) {
        setDropUp(true);
      } else {
        setDropUp(false);
      }
    }
    setIsOpen(!isOpen);
  };

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div
      ref={containerRef}
      className={`custom-select${isOpen ? ' is-open' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={[
          'custom-select-trigger',
          isOpen ? 'is-open' : '',
          !selectedOption ? 'is-placeholder' : '',
        ].filter(Boolean).join(' ')}
      >
        <span className="custom-select-label">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {isOpen ? (
          <ChevronUp size={14} className="custom-select-chevron" />
        ) : (
          <ChevronDown size={14} className="custom-select-chevron" />
        )}
      </button>

      {isOpen && (
        <div className={`custom-select-menu${dropUp ? ' is-drop-up' : ''}`}>
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`custom-select-option ${isSelected ? 'is-selected' : ''}`}
              >
                <span className="custom-select-label">{opt.label}</span>
                {isSelected && <span className="custom-select-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
