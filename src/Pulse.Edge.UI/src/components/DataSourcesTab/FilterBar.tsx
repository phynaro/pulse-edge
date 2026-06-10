import { Search } from 'lucide-react';
import type { StreamTemplate } from '../../types';

interface FilterBarProps {
  streamSearchQuery: string;
  setStreamSearchQuery: (val: string) => void;
  streamTypeFilter: string;
  setStreamTypeFilter: (val: string) => void;
  templates: StreamTemplate[];
}

export default function FilterBar({
  streamSearchQuery,
  setStreamSearchQuery,
  streamTypeFilter,
  setStreamTypeFilter,
  templates
}: FilterBarProps) {
  return (
    <div className="panel filter-bar">
      <div className="filter-bar-search">
        <div className="search-input-wrap">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search streams by name, ID or description..."
            value={streamSearchQuery}
            onChange={(e) => setStreamSearchQuery(e.target.value)}
            className="form-input"
          />
        </div>
      </div>

      <div className="chip-row">
        {['All', 'General', ...templates.map(t => t.id)].map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setStreamTypeFilter(cat)}
            className={`chip ${streamTypeFilter === cat ? 'is-active' : ''}`}
          >
            {cat === 'All' ? 'All Categories' : cat === 'Production' ? 'Production (OEE)' : cat === 'Energy' ? 'Energy' : cat}
          </button>
        ))}
      </div>
    </div>
  );
}
