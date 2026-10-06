import { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, Plus, Pencil, Trash2, Activity, AlertTriangle, FileCode, CheckCircle2, XCircle, Search, X, Sliders, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ModalShell from './ModalShell';
import OeeTagBrowserModal from './OeeTab/OeeTagBrowserModal';
import type { DataPoint, DriverAdapter, OeeChannel, OeeStatusResponse } from '../types';

const STATE_BADGE: Record<string, string> = {
  running: 'success',
  stopped: 'warning',
  fault: 'danger',
};

interface OeeTabProps {
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
}

interface ChannelForm {
  externalId: string;
  name: string;
  enabled: boolean;
  runDataPointId: string;
  faultDataPointId: string;
  codeDataPointId: string;
  goodDataPointId: string;
  rejectDataPointId: string;
  debounceSeconds: number;
}

const emptyForm: ChannelForm = {
  externalId: '', name: '', enabled: true, runDataPointId: '',
  faultDataPointId: '', codeDataPointId: '', goodDataPointId: '',
  rejectDataPointId: '', debounceSeconds: 2,
};

type TagRole = 'run' | 'fault' | 'code' | 'good' | 'reject';

interface RoleMetadata {
  label: string;
  hint: string;
  field: 'runDataPointId' | 'faultDataPointId' | 'codeDataPointId' | 'goodDataPointId' | 'rejectDataPointId';
  required: boolean;
  icon: typeof Activity;
  roleClass: string;
}

const ROLE_META: Record<TagRole, RoleMetadata> = {
  run: {
    label: 'Run Signal',
    hint: 'nonzero = running',
    field: 'runDataPointId',
    required: true,
    icon: Activity,
    roleClass: 'is-run',
  },
  fault: {
    label: 'Fault Signal',
    hint: 'nonzero = fault; leave unwired if PLC has none',
    field: 'faultDataPointId',
    required: false,
    icon: AlertTriangle,
    roleClass: 'is-fault',
  },
  code: {
    label: 'Fault / Reason Code Tag',
    hint: 'passed through verbatim',
    field: 'codeDataPointId',
    required: false,
    icon: FileCode,
    roleClass: 'is-code',
  },
  good: {
    label: 'Good Counter',
    hint: 'cumulative totalizer',
    field: 'goodDataPointId',
    required: false,
    icon: CheckCircle2,
    roleClass: 'is-good',
  },
  reject: {
    label: 'Reject Counter',
    hint: 'cumulative totalizer',
    field: 'rejectDataPointId',
    required: false,
    icon: XCircle,
    roleClass: 'is-reject',
  },
};

export default function OeeTab({ datapoints, adapters }: OeeTabProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OeeStatusResponse>({ channels: [], outboxDepth: 0 });
  const [channels, setChannels] = useState<OeeChannel[]>([]);
  const [editing, setEditing] = useState<OeeChannel | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ChannelForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [activeBrowseRole, setActiveBrowseRole] = useState<TagRole | null>(null);

  // Mounted flag guards against setting state from a fetch that resolves after
  // the component (or an earlier poll tick) has gone away.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, channelsRes] = await Promise.all([
        fetch('/api/oee/status'),
        fetch('/api/oee/channels'),
      ]);
      if (!mountedRef.current) return;
      if (statusRes.ok) setStatus(await statusRes.json());
      if (channelsRes.ok) setChannels(await channelsRes.json());
    } catch {
      // polling; next tick recovers
    }
  }, []);

  // Kept in a ref (rather than called directly) so the polling effect below
  // doesn't statically resolve to a function that calls setState — see
  // useBufferStatus.ts / useDatapointsList.ts for the same pattern.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    const poll = () => {
      void refreshRef.current();
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setShowModal(true);
  };

  const openEdit = (channel: OeeChannel) => {
    setEditing(channel);
    setForm({
      externalId: channel.externalId,
      name: channel.name,
      enabled: channel.enabled,
      runDataPointId: channel.runDataPointId,
      faultDataPointId: channel.faultDataPointId ?? '',
      codeDataPointId: channel.codeDataPointId ?? '',
      goodDataPointId: channel.goodDataPointId ?? '',
      rejectDataPointId: channel.rejectDataPointId ?? '',
      debounceSeconds: channel.debounceSeconds,
    });
    setError(null);
    setShowModal(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = {
      ...form,
      faultDataPointId: form.faultDataPointId || null,
      codeDataPointId: form.codeDataPointId || null,
      goodDataPointId: form.goodDataPointId || null,
      rejectDataPointId: form.rejectDataPointId || null,
    };
    const res = editing
      ? await fetch(`/api/oee/channels/${editing.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      : await fetch('/api/oee/channels', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
      setError(data.error ?? `Request failed (${res.status})`);
      return;
    }
    setShowModal(false);
    void refresh();
  };

  const remove = async (channel: OeeChannel) => {
    if (!window.confirm(`Delete channel "${channel.name}"? Its queued messages are discarded and cloud history for "${channel.externalId}" is orphaned.`)) return;
    await fetch(`/api/oee/channels/${channel.id}`, { method: 'DELETE' });
    void refresh();
  };

  const renderTagBindingRow = (role: TagRole) => {
    const meta = ROLE_META[role];
    const Icon = meta.icon;
    const value = form[meta.field];
    const dp = value ? datapoints.find(d => d.id === value) : undefined;

    return (
      <div className="signal-binding-card" key={role}>
        <div className="signal-binding-header">
          <div className="signal-binding-title">
            <Icon size={16} className={`signal-icon ${meta.roleClass}`} />
            <span className="signal-label-text">{meta.label}</span>
            {meta.required ? (
              <span className="badge danger badge-xs">Required</span>
            ) : (
              <span className="badge secondary badge-xs">Optional</span>
            )}
          </div>
          <span className="signal-hint-text">{meta.hint}</span>
        </div>

        <div className="signal-binding-value-row">
          <div className={`signal-tag-pill ${dp ? 'is-wired' : value ? 'is-unknown' : 'is-empty'}`}>
            {dp ? (
              <>
                <span className="signal-tag-code">{dp.description?.trim() || dp.address}</span>
                <span className="signal-tag-meta">({dp.address} · {dp.dataType})</span>
              </>
            ) : value ? (
              <span className="signal-tag-unknown">Unknown Tag ID ({value})</span>
            ) : (
              <span className="signal-tag-empty">⚪ not wired</span>
            )}
          </div>

          <div className="signal-binding-actions">
            <button
              type="button"
              className={dp ? "btn-secondary btn-compact" : "btn-primary btn-compact"}
              onClick={() => setActiveBrowseRole(role)}
            >
              <Search size={14} />
              {dp ? 'Change Tag...' : 'Browse...'}
            </button>
            {dp && !meta.required && (
              <button
                type="button"
                className="btn-icon-sm is-action is-danger"
                title="Unbind tag"
                onClick={() => setForm(f => ({ ...f, [meta.field]: '' }))}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tab-stack">
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title"><Gauge size={24} className="page-header-icon" />{t('oee.title')}</h2>
          <p className="page-header-desc">
            {t('oee.subtitle')}
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={18} /> {t('common.add')} Channel
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="table-scroll-md">
          {status.channels.length === 0 ? (
            <div className="table-empty">No performance channels configured — add one to start reporting machine state.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>External ID</th>
                  <th>Live State</th>
                  <th className="col-time">Since</th>
                  <th>Pending</th>
                  <th>Next Seq</th>
                  <th className="col-status">Actions</th>
                </tr>
              </thead>
              <tbody>
                {status.channels.map(c => {
                  const channel = channels.find(x => x.id === c.id);
                  return (
                    <tr key={c.id}>
                      <td>{c.name}{!c.enabled && <span className="badge warning">disabled</span>}</td>
                      <td><span className="stream-badge">{c.externalId}</span></td>
                      <td>
                        {c.lastState ? (
                          <span className={`badge ${STATE_BADGE[c.lastState] ?? 'info'}`}>
                            {c.lastState}{c.lastCode ? ` (${c.lastCode})` : ''}
                          </span>
                        ) : (
                          <span className="text-secondary">no data</span>
                        )}
                      </td>
                      <td className="cell-mono-nowrap">
                        {c.lastStateChangedAt ? new Date(c.lastStateChangedAt.endsWith('Z') ? c.lastStateChangedAt : c.lastStateChangedAt + 'Z').toLocaleString() : '—'}
                      </td>
                      <td className="cell-center">{c.pendingCount > 0 ? <span className="badge warning">{c.pendingCount}</span> : '—'}</td>
                      <td className="cell-mono-secondary">#{c.nextSeq}</td>
                      <td>
                        {channel && (
                          <>
                            <button type="button" className="btn-icon-sm is-action" onClick={() => openEdit(channel)} aria-label={`Edit ${c.name}`}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" className="btn-icon-sm is-action is-danger" onClick={() => remove(channel)} aria-label={`Delete ${c.name}`}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <>
          <ModalShell
            title={editing ? `Edit Channel — ${editing.name}` : 'Add Performance Channel'}
            subtitle="Bind PLC state & counter tags to machine roles for edge-to-cloud transmission."
            onClose={() => setShowModal(false)}
            size="lg"
          >
            <form onSubmit={save} className="modal-form">
              {error && <div className="alert-box-danger">{error}</div>}

              <div className="channel-form-container">
                {/* Section 1: Machine Identity & Settings */}
                <div className="channel-section">
                  <div className="channel-section-head">
                    <Sliders size={16} />
                    <span>Machine Identity &amp; Settings</span>
                  </div>

                  <div className="form-grid-half">
                    <div className="form-group form-group-flush">
                      <label className="form-label form-label-bold">Channel / Machine Name *</label>
                      <input
                        className="form-input"
                        value={form.name}
                        placeholder="e.g. Line 1 — Filler"
                        required
                        onChange={e => setForm({ ...form, name: e.target.value })}
                      />
                    </div>

                    <div className="form-group form-group-flush">
                      <label className="form-label form-label-bold">External ID *</label>
                      <input
                        className="form-input text-mono"
                        value={form.externalId}
                        disabled={!!editing}
                        placeholder="e.g. line1.filler"
                        required
                        onChange={e => setForm({ ...form, externalId: e.target.value })}
                      />
                      {editing && <span className="form-note">External ID is permanent and cannot be changed after creation.</span>}
                    </div>
                  </div>

                  <div className="form-grid-half" style={{ alignItems: 'center' }}>
                    <div className="form-group form-group-flush">
                      <label className="form-label form-label-bold">Debounce Delay (seconds)</label>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        max={60}
                        value={form.debounceSeconds}
                        onChange={e => setForm({ ...form, debounceSeconds: Number(e.target.value) })}
                      />
                      <span className="form-note">Filter signal chatter (0–60 seconds).</span>
                    </div>

                    <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        id="oeeChannelEnabled"
                        checked={form.enabled}
                        onChange={e => setForm({ ...form, enabled: e.target.checked })}
                        style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
                      />
                      <label htmlFor="oeeChannelEnabled" style={{ cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, margin: 0 }}>
                        Channel Active (Enabled)
                      </label>
                    </div>
                  </div>
                </div>

                {/* Section 2: Machine State Signals */}
                <div className="channel-section">
                  <div className="channel-section-head">
                    <Activity size={16} />
                    <span>Machine State Signals</span>
                  </div>
                  {(['run', 'fault', 'code'] as TagRole[]).map(role => renderTagBindingRow(role))}
                </div>

                {/* Section 3: Production Counter Totalizers */}
                <div className="channel-section">
                  <div className="channel-section-head">
                    <ShieldCheck size={16} />
                    <span>Production Counter Totalizers</span>
                  </div>
                  {(['good', 'reject'] as TagRole[]).map(role => renderTagBindingRow(role))}
                </div>
              </div>

              <div className="modal-footer" style={{ marginTop: '1rem' }}>
                <button type="submit" className="btn-primary btn-compact btn-flex-2">
                  {editing ? 'Save Changes' : 'Create Channel'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary btn-compact btn-flex-1">
                  Cancel
                </button>
              </div>
            </form>
          </ModalShell>
          {activeBrowseRole && (
            <OeeTagBrowserModal
              roleLabel={ROLE_META[activeBrowseRole].label}
              roleHint={ROLE_META[activeBrowseRole].hint}
              currentTagId={form[ROLE_META[activeBrowseRole].field] || null}
              allowClear={!ROLE_META[activeBrowseRole].required}
              datapoints={datapoints}
              adapters={adapters}
              onSelect={tagId => {
                const field = ROLE_META[activeBrowseRole].field;
                setForm(f => ({ ...f, [field]: tagId ?? '' }));
              }}
              onClose={() => setActiveBrowseRole(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
