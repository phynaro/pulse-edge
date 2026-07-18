import { useEffect, useState } from 'react';
import { Gauge, Plus, Pencil, Trash2 } from 'lucide-react';
import ModalShell from './ModalShell';
import CustomSelect from './CustomSelect';
import type { DataPoint, OeeChannel, OeeStatusResponse } from '../types';

const STATE_BADGE: Record<string, string> = {
  running: 'success',
  stopped: 'warning',
  fault: 'danger',
};

interface OeeTabProps {
  datapoints: DataPoint[];
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

export default function OeeTab({ datapoints }: OeeTabProps) {
  const [status, setStatus] = useState<OeeStatusResponse>({ channels: [], outboxDepth: 0 });
  const [channels, setChannels] = useState<OeeChannel[]>([]);
  const [editing, setEditing] = useState<OeeChannel | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ChannelForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [statusRes, channelsRes] = await Promise.all([
        fetch('/api/oee/status'),
        fetch('/api/oee/channels'),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (channelsRes.ok) setChannels(await channelsRes.json());
    } catch {
      // polling; next tick recovers
    }
  };

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const [statusRes, channelsRes] = await Promise.all([
          fetch('/api/oee/status'),
          fetch('/api/oee/channels'),
        ]);
        if (!active) return;
        if (statusRes.ok) setStatus(await statusRes.json());
        if (channelsRes.ok) setChannels(await channelsRes.json());
      } catch {
        // polling; next tick recovers
      }
    };

    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
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
    if (!window.confirm(`Delete OEE channel "${channel.name}"? Its queued messages are discarded and cloud history for "${channel.externalId}" is orphaned.`)) return;
    await fetch(`/api/oee/channels/${channel.id}`, { method: 'DELETE' });
    void refresh();
  };

  const tagSelect = (label: string, value: string, onChange: (v: string) => void, required = false) => (
    <div className="form-group form-group-flush">
      <label className="form-label form-label-bold">{label}</label>
      <CustomSelect
        value={value}
        onChange={onChange}
        placeholder={required ? 'Select a tag…' : '— not wired —'}
        options={datapoints.map(dp => ({
          value: dp.id,
          label: `${dp.address}${dp.description ? ` — ${dp.description}` : ''}`,
        }))}
      />
    </div>
  );

  return (
    <div className="tab-stack">
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Gauge size={24} className="page-header-icon" />
            OEE Channels
          </h2>
          <p className="page-header-desc">
            Monitored machines reporting state transitions and production counters to PULSE Cloud.
            Outbox depth: {status.outboxDepth}
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={18} /> Add Channel
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="table-scroll-md">
          {status.channels.length === 0 ? (
            <div className="table-empty">No OEE channels configured — add one to start reporting machine state.</div>
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
        <ModalShell
          title={editing ? `Edit Channel — ${editing.name}` : 'Add OEE Channel'}
          subtitle="Bind PLC tags to machine-state roles. The edge reports what these signals say — classification happens in the cloud."
          onClose={() => setShowModal(false)}
          size="md"
        >
          <form onSubmit={save} className="modal-form">
            {error && <div className="alert-box-danger">{error}</div>}

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">External ID</label>
              <input
                className="form-input text-mono"
                value={form.externalId}
                disabled={!!editing}
                placeholder="line1.filler"
                onChange={e => setForm({ ...form, externalId: e.target.value })}
              />
              {editing && <span className="form-note">The external ID is the channel's permanent cloud identity and cannot be changed.</span>}
            </div>

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Name</label>
              <input
                className="form-input"
                value={form.name}
                placeholder="Line 1 — Filler"
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>

            {tagSelect('Run signal (nonzero = running)', form.runDataPointId, v => setForm({ ...form, runDataPointId: v }), true)}
            {tagSelect('Fault signal (nonzero = fault; leave unwired if the PLC has none)', form.faultDataPointId, v => setForm({ ...form, faultDataPointId: v }))}
            {tagSelect('Fault/reason code tag (passed through verbatim)', form.codeDataPointId, v => setForm({ ...form, codeDataPointId: v }))}
            {tagSelect('Good counter (cumulative totalizer)', form.goodDataPointId, v => setForm({ ...form, goodDataPointId: v }))}
            {tagSelect('Reject counter (cumulative totalizer)', form.rejectDataPointId, v => setForm({ ...form, rejectDataPointId: v }))}

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Debounce (seconds)</label>
              <input
                className="form-input"
                type="number"
                min={0}
                max={60}
                value={form.debounceSeconds}
                onChange={e => setForm({ ...form, debounceSeconds: Number(e.target.value) })}
              />
            </div>

            <div className="checkbox-inline">
              <input
                type="checkbox"
                id="oeeChannelEnabled"
                checked={form.enabled}
                onChange={e => setForm({ ...form, enabled: e.target.checked })}
              />
              <label htmlFor="oeeChannelEnabled">Enabled</label>
            </div>

            <div className="modal-footer">
              <button type="submit" className="btn-primary btn-compact btn-flex-2">{editing ? 'Save Changes' : 'Create Channel'}</button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary btn-compact btn-flex-1">Cancel</button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
