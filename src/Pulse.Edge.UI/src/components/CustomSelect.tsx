import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  const [menuCoords, setMenuCoords] = useState<{ left: number; top: number; bottom: number; width: number }>({
    left: 0,
    top: 0,
    bottom: 0,
    width: 0,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateCoords = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const isUp = spaceBelow < 220 && rect.top > 220;
    setDropUp(isUp);
    setMenuCoords({
      left: rect.left,
      width: rect.width,
      top: rect.bottom + 4,
      bottom: window.innerHeight - rect.top + 4,
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    updateCoords();

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleScrollOrResize() {
      updateCoords();
    }

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) {
      updateCoords();
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

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className={`custom-select-menu${dropUp ? ' is-drop-up' : ''}`}
            style={{
              position: 'fixed',
              left: `${menuCoords.left}px`,
              width: `${menuCoords.width}px`,
              top: dropUp ? 'auto' : `${menuCoords.top}px`,
              bottom: dropUp ? `${menuCoords.bottom}px` : 'auto',
              zIndex: 999999,
            }}
          >
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
          </div>,
          document.body
        )}
    </div>
  );
}
