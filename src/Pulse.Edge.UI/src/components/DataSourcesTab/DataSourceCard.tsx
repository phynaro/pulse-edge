import { useState } from 'react';
import { Trash2, CheckCircle2, AlertCircle, Plus, Pencil, Check, X } from 'lucide-react';
import type { DataSource, DataPoint, DriverAdapter, StreamTemplate } from '../../types';
import { DynamicIcon, formatLiveValue } from './utils';

interface DataSourceCardProps {
  ds: DataSource;
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  templates: StreamTemplate[];
  handleToggleStreamEnabled: (ds: DataSource) => Promise<void>;
  handleDeleteStream: (id: string) => Promise<void>;
  handleRenameStream: (ds: DataSource, newName: string) => Promise<void>;
  setDeletingDp: (dp: DataPoint) => void;
  onBindTag: (dsId: string, metric: string) => void;
}

function MetricStatus({ dp, isEnabled }: { dp: DataPoint | undefined; isEnabled: boolean }) {
  if (!dp) return <span className="status-missing">Missing Binding</span>;
  if (!isEnabled) return <span className="status-paused">Paused</span>;
  if (dp.lastError) return <span className="status-error" title={dp.lastError}>Err</span>;
  if (dp.lastValue !== null && dp.lastValue !== undefined) {
    return <span className="status-live">{formatLiveValue(dp.lastValue, dp.dataType)}</span>;
  }
  return <span className="status-wait">Wait...</span>;
}

export default function DataSourceCard({
  ds,
  datapoints,
  adapters,
  templates,
  handleToggleStreamEnabled,
  handleDeleteStream,
  handleRenameStream,
  setDeletingDp,
  onBindTag
}: DataSourceCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(ds.name);

  const handleSaveRename = async () => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    if (trimmed === ds.name) {
      setIsEditing(false);
      return;
    }
    await handleRenameStream(ds, trimmed);
    setIsEditing(false);
  };

  const dsPoints = datapoints.filter(dp => dp.dataSourceId === ds.id);
  const matchingTemplate = templates.find(t => t.id === ds.type);
  const isTemplate = !!matchingTemplate && ds.type !== 'General';

  let expectedParams: string[] = [];
  if (matchingTemplate) {
    try {
      expectedParams = JSON.parse(matchingTemplate.parametersJson) || [];
    } catch (e) {
      console.error('Failed to parse template parameters:', e);
    }
  }

  const isFullyBound = !isTemplate || expectedParams.every(param =>
    datapoints.some(dp => dp.dataSourceId === ds.id && dp.metric === param)
  );

  const themeClass =
    ds.type === 'Production' ? 'theme-production'
    : ds.type === 'Energy' ? 'theme-energy'
    : matchingTemplate ? 'theme-custom'
    : 'theme-general';

  let statusText = ds.type === 'Production' ? 'Production (OEE)' : ds.type === 'Energy' ? 'Energy' : ds.type;
  if (!ds.isEnabled) {
    statusText = 'Paused';
  } else if (isTemplate && !isFullyBound) {
    statusText = `${ds.type === 'Production' ? 'Production (OEE)' : ds.type} (Pending Setup)`;
  }

  const badgeClass = !ds.isEnabled
    ? 'is-paused'
    : isTemplate && !isFullyBound
      ? 'is-pending'
      : themeClass;

  const renderMetricRow = (paramOrDp: string | DataPoint, key: string) => {
    const isParam = typeof paramOrDp === 'string';
    const param = isParam ? paramOrDp : paramOrDp.metric;
    const dp = isParam
      ? datapoints.find(x => x.dataSourceId === ds.id && x.metric === param)
      : paramOrDp;
    const adp = dp ? adapters.find(a => a.id === dp.adapterId) : null;

    return (
      <div key={key} className={`metric-row ${dp ? 'is-bound' : 'is-unbound'}`}>
        <div className="metric-row-body">
          <div className="metric-row-top">
            <span className={`metric-name${dp ? '' : ' is-missing'}`}>
              {isParam && (
                dp ? <CheckCircle2 size={14} className="icon-success" /> : <AlertCircle size={14} className="icon-warning" />
              )}
              {param}
            </span>
            <MetricStatus dp={dp} isEnabled={ds.isEnabled} />
          </div>
          {dp ? (
            <span className="metric-addr" title={dp.address}>
              Addr: {dp.address}
              {dp.description && <span className="metric-addr-hint">({dp.description})</span>}
            </span>
          ) : (
            <span className="metric-placeholder">No physical tag assigned</span>
          )}
        </div>
        <div className="metric-actions">
          {dp ? (
            <>
              <div className="metric-adapter-info">
                <span className="badge info badge-tiny" title={adp ? `${adp.name} (${adp.protocol})` : 'Unknown'}>
                  {adp ? adp.name : 'Unknown'}
                </span>
                <span className="metric-dtype">
                  {dp.dataType}{!isParam ? ` (${dp.scanIntervalMs}ms)` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingDp(dp);
                }}
                title={isParam ? 'Unbind Parameter' : 'Unbind Metric'}
                className="btn-icon-sm is-action is-danger"
              >
                <Trash2 size={14} />
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onBindTag(ds.id, param as string)} className="btn-bind">
              Bind Tag
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`panel ds-card ${themeClass}${ds.isEnabled ? '' : ' is-disabled'}`}>
      <div>
        <div className="ds-card-header">
          <div className="ds-card-title-row">
            {isEditing ? (
              <div>
                <div className="flex-row gap-sm">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="form-input form-input-inline"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename();
                      else if (e.key === 'Escape') {
                        setIsEditing(false);
                        setEditName(ds.name);
                      }
                    }}
                  />
                  <button type="button" onClick={handleSaveRename} title="Save" className="btn-icon-sm is-save">
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setEditName(ds.name);
                    }}
                    title="Cancel"
                    className="btn-icon-sm"
                  >
                    <X size={16} />
                  </button>
                </div>
                <span className="ds-card-id">STREAM ID: {ds.id}</span>
              </div>
            ) : (
              <>
                <div>
                  <h3 className="ds-card-title">{ds.name}</h3>
                  <span className="ds-card-id">STREAM ID: {ds.id}</span>
                </div>
                <div className="ds-card-actions">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditing(true);
                    }}
                    title="Rename Stream"
                    className="btn-icon-sm is-action"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Are you sure you want to delete stream '${ds.name}' (${ds.id})? All associated physical tags will be unbound.`)) {
                        handleDeleteStream(ds.id);
                      }
                    }}
                    title="Delete Stream"
                    className="btn-icon-sm is-action is-danger"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="ds-card-status-row">
            <span className={`ds-type-badge ${badgeClass}`}>
              {ds.isEnabled && matchingTemplate && <DynamicIcon name={matchingTemplate.icon} size={11} />}
              {statusText}
            </span>
            <label className="ds-toggle" title={ds.isEnabled ? 'Pause Telemetry Stream' : 'Resume Telemetry Stream'}>
              <input
                type="checkbox"
                checked={ds.isEnabled}
                onChange={() => handleToggleStreamEnabled(ds)}
              />
            </label>
          </div>
        </div>

        {ds.description ? (
          <p className="ds-description">{ds.description}</p>
        ) : (
          <div className="ds-spacer" />
        )}

        <div className="mt-lg">
          <h4 className="ds-section-title">
            <span>{isTemplate ? 'Template Parameters' : 'Bound Metric Tags'}</span>
            <span className="ds-section-count">
              {isTemplate
                ? `${datapoints.filter(dp => dp.dataSourceId === ds.id && expectedParams.includes(dp.metric || '')).length}/${expectedParams.length} bound`
                : `${dsPoints.length} active`}
            </span>
          </h4>

          {isTemplate ? (
            <div className="metric-grid">
              {expectedParams.map((param) => renderMetricRow(param, param))}
            </div>
          ) : dsPoints.length === 0 ? (
            <div className="metric-empty-box">No telemetry metric bound to this stream source.</div>
          ) : (
            <div className="metric-grid">
              {dsPoints.map((dp) => renderMetricRow(dp, dp.id))}
            </div>
          )}
        </div>
      </div>

      {!isTemplate && (
        <button type="button" onClick={() => onBindTag(ds.id, '')} className="btn-add-metric">
          <Plus size={14} />
          Add Metric
        </button>
      )}
    </div>
  );
}
