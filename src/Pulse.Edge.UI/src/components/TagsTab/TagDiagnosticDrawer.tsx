import { useState, useEffect, useRef, useMemo } from 'react';
import { Activity, AlertCircle, Clock, CheckCircle, Play, Pause } from 'lucide-react';
import type { DataPoint, DriverAdapter } from '../../types';

const formatToLocalTimeString = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  let utcStr = dateStr;
  if (!utcStr.endsWith('Z') && !utcStr.includes('+') && !utcStr.includes('GMT')) {
    utcStr = utcStr.replace(' ', 'T') + 'Z';
  }
  const d = new Date(utcStr);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
};

interface TagDiagnosticDrawerProps {
  dp: DataPoint;
  adapter: DriverAdapter | null;
  isOrphan: boolean;
}

const isNumericType = (dataType: string): boolean => {
  const lower = (dataType || '').toLowerCase();
  return (
    lower.includes('int') ||
    lower.includes('float') ||
    lower.includes('double') ||
    lower.includes('uint') ||
    lower.includes('word') ||
    lower.includes('real') ||
    lower.includes('num') ||
    lower.includes('single')
  );
};

export default function TagDiagnosticDrawer({ dp, adapter, isOrphan }: TagDiagnosticDrawerProps) {
  const [history, setHistory] = useState<{ time: string; value: number; timestamp: number }[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [timeWindow, setTimeWindow] = useState<'1m' | '5m' | '15m' | 'all'>('all');
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; value: number; time: string; index: number } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 500, height: 150 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width || 500,
          height: entry.contentRect.height || 150
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Sync incoming polling value to history
  useEffect(() => {
    if (isPaused) return;
    if (dp.lastValue === null || dp.lastValue === undefined || dp.lastValue === '') return;
    const numVal = parseFloat(dp.lastValue);
    if (isNaN(numVal)) return;

    setHistory(prev => {
      let timeStr = formatToLocalTimeString(dp.lastUpdated);
      if (!timeStr) {
        timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } else {
        try {
          const clean = dp.lastUpdated!.replace(' ', 'T') + 'Z';
          const d = new Date(clean);
          timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
          // fallback
        }
      }
      
      const last = prev[prev.length - 1];
      if (last && last.value === numVal && last.time === timeStr) {
        return prev;
      }
      // Store up to 500 data points to support longer historical zoom ranges
      return [...prev, { time: timeStr, value: numVal, timestamp: Date.now() }].slice(-500);
    });
  }, [dp.lastValue, dp.lastUpdated, isPaused]);

  // Filter history based on the selected time window (1m, 5m, 15m, All)
  const filteredHistory = useMemo(() => {
    if (timeWindow === 'all') return history;
    const now = Date.now();
    let cutoff = now;
    if (timeWindow === '1m') cutoff = now - 60 * 1000;
    else if (timeWindow === '5m') cutoff = now - 5 * 60 * 1000;
    else if (timeWindow === '15m') cutoff = now - 15 * 60 * 1000;
    return history.filter(h => h.timestamp >= cutoff);
  }, [history, timeWindow]);

  const numeric = isNumericType(dp.dataType);
  const values = filteredHistory.map(h => h.value);
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const maxVal = values.length > 0 ? Math.max(...values) : 0;
  
  // Calculate SVG dimensions and path dynamically to match exact container dimensions
  const svgWidth = Math.max(dimensions.width, 100);
  const svgHeight = Math.max(dimensions.height, 50);
  const paddingX = 12;
  const paddingY = 16;
  const chartHeight = Math.max(svgHeight - paddingY * 2, 20);
  const chartWidth = Math.max(svgWidth - paddingX * 2, 50);

  let polylinePoints = '';
  let fillPoints = '';

  if (values.length > 1) {
    const range = maxVal - minVal;
    const valMin = range === 0 ? minVal - 1 : minVal;
    const valMax = range === 0 ? maxVal + 1 : maxVal;
    const valRange = valMax - valMin;

    const coords = filteredHistory.map((entry, idx) => {
      const x = paddingX + (idx / (filteredHistory.length - 1)) * chartWidth;
      const y = svgHeight - paddingY - ((entry.value - valMin) / valRange) * chartHeight;
      return { x, y };
    });

    polylinePoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    
    // Create closed shape for the filled gradient area
    const first = coords[0];
    const last = coords[coords.length - 1];
    fillPoints = `${first.x.toFixed(1)},${(svgHeight - paddingY).toFixed(1)} ${polylinePoints} ${last.x.toFixed(1)},${(svgHeight - paddingY).toFixed(1)}`;
  }

  const qualityHealthy = !dp.lastError;
  const currentLatency = dp.lastLatencyMs;
  const isTooltipBelow = hoveredPoint ? hoveredPoint.y < 45 : false;

  return (
    <div className="tag-diag-drawer">
      <div className={`tag-detail-grid ${numeric ? 'has-trend' : 'no-trend'}`}>
        
        {/* Left pane: Config details */}
        <div className="tag-detail-section tag-diag-meta">
          <div className="detail-row-group">
            <div className={`tag-detail-divider ${isOrphan ? 'is-orphan' : 'is-normal'}`}>
              <div className={`detail-label ${isOrphan ? 'is-orphan' : ''}`}>Description</div>
              <div className={`tag-detail-desc-value ${dp.description ? '' : 'is-empty'}`}>
                {dp.description || 'No description provided.'}
              </div>
            </div>
            
            {numeric && (
              <div className="diag-field-box">
                <div className="detail-label">Scaling & Math</div>
                <div className="detail-value">Scale Factor: <span className="tag-detail-mono">x{dp.scaleFactor}</span></div>
                <div className="detail-value detail-value-mt">Offset: <span className="tag-detail-mono">+{dp.offset}</span></div>
              </div>
            )}
            
            {!isOrphan && adapter?.protocol === 'MODBUS_TCP' && (
              <div className="diag-field-box">
                <div className="detail-label">Endianness</div>
                <div className="detail-value tag-detail-mono">
                  Byte Order: {dp.byteOrder || (dp.dataType === 'Int16' || dp.dataType === 'UInt16' ? 'AB' : 'ABCD')}
                </div>
              </div>
            )}
            
            <div className="diag-field-box">
              <div className="detail-label">Diagnostics Metadata</div>
              <div className="detail-meta-mono text-xs">UUID: {dp.id}</div>
              <div className="detail-meta text-xs">
                {isOrphan 
                  ? `Adapter: Unassigned (Orphaned)` 
                  : `Last Update: ${dp.lastUpdated ? formatToLocalTimeString(dp.lastUpdated) : 'Never'}`}
              </div>
            </div>
          </div>
        </div>

        {/* Center pane: Real-time SVG Trend Chart */}
        {numeric && (
          <div className="tag-detail-section tag-diag-chart-section">
            <div className="detail-label flex items-center justify-between">
              <span className="flex items-center gap-sm">
                <Activity size={12} className={`text-primary ${isPaused ? '' : 'animate-pulse'}`} />
                Live Telemetry Trend
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPaused(!isPaused);
                  }}
                  className={`btn-trend-pause ${isPaused ? 'is-paused' : ''}`}
                  title={isPaused ? 'Resume live updates' : 'Pause live updates'}
                >
                  {isPaused ? <Play size={10} /> : <Pause size={10} />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>

                <span className="time-select-group">
                  {(['1m', '5m', '15m', 'all'] as const).map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTimeWindow(w);
                      }}
                      className={`btn-time-window ${timeWindow === w ? 'is-active' : ''}`}
                      title={`Show last ${w === 'all' ? 'available data' : w}`}
                    >
                      {w === 'all' ? 'All' : w}
                    </button>
                  ))}
                </span>
              </span>
              {values.length > 0 && (
                <span className="text-secondary text-mono-xs">
                  Min: {minVal.toFixed(2)} | Max: {maxVal.toFixed(2)} | Current: {values[values.length - 1].toFixed(2)}
                </span>
              )}
            </div>
            
            <div ref={containerRef} className="diag-chart-container">
              {filteredHistory.length < 2 ? (
                <div className="diag-chart-fallback flex justify-center items-center">
                  <span className="text-secondary text-sm animate-pulse">
                    {history.length < 2 
                      ? "Gathering live values... (requires at least 2 ticks)" 
                      : `No data captured in the last ${timeWindow === '1m' ? '1 minute' : timeWindow === '5m' ? '5 minutes' : '15 minutes'}`}
                  </span>
                </div>
              ) : (
                <div className="svg-wrapper" style={{ padding: 0 }}>
                  <svg width="100%" height="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
                    <defs>
                      <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary-color, #3ce8bd)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="var(--primary-color, #3ce8bd)" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal grid lines */}
                    <line x1={paddingX} y1={paddingY} x2={svgWidth - paddingX} y2={paddingY} stroke="var(--border-color, #e2e8f0)" strokeDasharray="3,3" strokeWidth="0.5" />
                    <line x1={paddingX} y1={svgHeight / 2} x2={svgWidth - paddingX} y2={svgHeight / 2} stroke="var(--border-color, #e2e8f0)" strokeDasharray="3,3" strokeWidth="0.5" />
                    <line x1={paddingX} y1={svgHeight - paddingY} x2={svgWidth - paddingX} y2={svgHeight - paddingY} stroke="var(--border-color, #e2e8f0)" strokeDasharray="3,3" strokeWidth="0.5" />

                    {/* Vertical Hover Crosshair Cursor */}
                    {hoveredPoint && (
                      <line
                        x1={hoveredPoint.x}
                        y1={paddingY}
                        x2={hoveredPoint.x}
                        y2={svgHeight - paddingY}
                        stroke="rgba(60, 232, 189, 0.4)"
                        strokeWidth="1"
                        strokeDasharray="2,2"
                        style={{ pointerEvents: 'none' }}
                      />
                    )}

                    {/* Area fill */}
                    <polygon points={fillPoints} fill="url(#chartGrad)" />

                    {/* Polyline path */}
                    <polyline fill="none" stroke="var(--primary-color, #3ce8bd)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={polylinePoints} />

                    {/* Glowing dots for points & hover layers */}
                    {filteredHistory.map((entry, idx) => {
                      const range = maxVal - minVal;
                      const valMin = range === 0 ? minVal - 1 : minVal;
                      const valMax = range === 0 ? maxVal + 1 : maxVal;
                      const valRange = valMax - valMin;

                      const x = paddingX + (idx / (filteredHistory.length - 1)) * chartWidth;
                      const y = svgHeight - paddingY - ((entry.value - valMin) / valRange) * chartHeight;

                      const isLast = idx === filteredHistory.length - 1;
                      const isMin = entry.value === minVal && idx === values.indexOf(minVal);
                      const isMax = entry.value === maxVal && idx === values.indexOf(maxVal);

                      const showVisualCircle = isLast || isMin || isMax || (hoveredPoint?.index === idx);

                      return (
                        <g key={idx}>
                          {/* Invisible larger hover zone for easy cursor interaction */}
                          <circle
                            cx={x}
                            cy={y}
                            r={12}
                            fill="transparent"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => setHoveredPoint({ x, y, value: entry.value, time: entry.time, index: idx })}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />

                          {/* Visual point circle */}
                          {showVisualCircle && (
                            <circle
                              cx={x}
                              cy={y}
                              r={isLast || hoveredPoint?.index === idx ? 4.5 : 3}
                              fill={isLast ? "var(--primary-color, #3ce8bd)" : "var(--primary-dark, #2b6cb0)"}
                              stroke="#ffffff"
                              strokeWidth="1.5"
                              style={{ transition: 'r 0.1s ease', pointerEvents: 'none' }}
                            />
                          )}

                          {/* Pulsing ripple for last point */}
                          {isLast && (
                            <circle
                              cx={x}
                              cy={y}
                              r={8}
                              fill="none"
                              stroke="var(--primary-color, #3ce8bd)"
                              strokeWidth="1"
                              className="animate-ping"
                              style={{ transformOrigin: `${x}px ${y}px`, pointerEvents: 'none' }}
                            />
                          )}
                        </g>
                      );
                    })}
                  </svg>

                  {/* Floating Interactive Tooltip */}
                  {hoveredPoint && (
                    <div
                      className={`trend-tooltip ${isTooltipBelow ? 'is-below' : 'is-above'}`}
                      style={{
                        left: `${Math.max(45, Math.min(hoveredPoint.x, svgWidth - 45))}px`,
                        top: isTooltipBelow ? `${hoveredPoint.y + 12}px` : `${hoveredPoint.y - 12}px`,
                      }}
                    >
                      <div className="tooltip-value">{hoveredPoint.value.toFixed(3)}</div>
                      <div className="tooltip-time">{hoveredPoint.time}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right pane: Inline diagnostics */}
        <div className="tag-detail-section tag-diag-controls">
          <div className="detail-label">Status & Diagnostics</div>
          <div className="diag-controls-stack">
            
            {/* Status indicators */}
            <div className="diag-badges-grid">
              <div className={`diag-badge-card ${qualityHealthy ? 'is-good' : 'is-bad'}`}>
                <div className="badge-card-icon">
                  {qualityHealthy ? <CheckCircle size={14} className="text-green" /> : <AlertCircle size={14} className="text-red" />}
                </div>
                <div className="badge-card-info">
                  <span className="badge-card-title">Quality</span>
                  <span className="badge-card-val">{qualityHealthy ? 'Good' : 'Bad'}</span>
                </div>
              </div>

              <div className="diag-badge-card is-metric">
                <div className="badge-card-icon">
                  <Clock size={14} className="text-purple" />
                </div>
                <div className="badge-card-info">
                  <span className="badge-card-title">Latency</span>
                  <span className="badge-card-val">{currentLatency !== null && currentLatency !== undefined ? `${currentLatency.toFixed(0)} ms` : '—'}</span>
                </div>
              </div>
            </div>

            {(dp.consecutiveFailures ?? 0) > 0 && (
              <div className="diag-failures-alert">
                <span>⚠️ {dp.consecutiveFailures} scan failures. Backed off scan interval.</span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom pane: Full trace log if errors exist */}
        {dp.lastError && (
          <div className="tag-detail-full diag-error-trace">
            <div className="detail-label text-red">Diagnostic Trace Error Log</div>
            <pre className="tag-error-box text-xs">
              {dp.lastError}
            </pre>
          </div>
        )}

      </div>
    </div>
  );
}
