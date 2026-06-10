import { Database, Tag, Zap, BarChart3 } from 'lucide-react';
import type { DataSource, DataPoint } from '../../types';

interface SummaryCardsProps {
  datasources: DataSource[];
  datapoints: DataPoint[];
}

export default function SummaryCards({ datasources, datapoints }: SummaryCardsProps) {
  return (
    <div className="summary-grid">
      <div className="card summary-card">
        <div className="icon-badge theme-production">
          <Database size={20} />
        </div>
        <div>
          <div className="summary-card-label">Total Streams</div>
          <div className="summary-card-value">{datasources.length}</div>
        </div>
      </div>

      <div className="card summary-card">
        <div className="icon-badge theme-general">
          <Tag size={20} />
        </div>
        <div>
          <div className="summary-card-label">Bound Metrics</div>
          <div className="summary-card-value">
            {datapoints.filter(x => x.dataSourceId && x.dataSourceId !== '').length}
          </div>
        </div>
      </div>

      <div className="card summary-card">
        <div className="icon-badge theme-energy">
          <Zap size={20} />
        </div>
        <div>
          <div className="summary-card-label">Energy Streams</div>
          <div className="summary-card-value">
            {datasources.filter(x => x.type === 'Energy').length}
          </div>
        </div>
      </div>

      <div className="card summary-card">
        <div className="icon-badge theme-success">
          <BarChart3 size={20} />
        </div>
        <div>
          <div className="summary-card-label">Production Streams</div>
          <div className="summary-card-value">
            {datasources.filter(x => x.type === 'Production').length}
          </div>
        </div>
      </div>
    </div>
  );
}
