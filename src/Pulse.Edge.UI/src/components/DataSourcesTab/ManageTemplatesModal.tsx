import React, { useState } from 'react';
import { Plus, Edit2, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { DataSource, StreamTemplate } from '../../types';
import type { useToast } from '../../hooks/useToast';
import { DynamicIcon, ICON_MAP } from './utils';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface ManageTemplatesModalProps {
  onClose: () => void;
  datasources: DataSource[];
  templates: StreamTemplate[];
  fetchTemplates: () => Promise<void>;
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

export default function ManageTemplatesModal({
  onClose,
  datasources,
  templates,
  fetchTemplates,
  fetchData,
  toast
}: ManageTemplatesModalProps) {
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [isTemplateFormOpen, setIsTemplateFormOpen] = useState(false);
  const [templateFormId, setTemplateFormId] = useState('');
  const [templateFormDescription, setTemplateFormDescription] = useState('');
  const [templateFormParameters, setTemplateFormParameters] = useState<string[]>([]);
  const [newParamInput, setNewParamInput] = useState('');
  const [templateFormIcon, setTemplateFormIcon] = useState('Database');

  const handleClose = () => {
    onClose();
    setIsTemplateFormOpen(false);
    setEditingTemplateId(null);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateFormId) {
      toast.warning('Template name/ID is required.');
      return;
    }

    try {
      const payload = {
        id: templateFormId,
        description: templateFormDescription,
        parametersJson: JSON.stringify(templateFormParameters),
        icon: templateFormIcon
      };

      const res = await fetch('/api/stream-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        toast.success(`Template '${templateFormId}' saved successfully.`);
        setIsTemplateFormOpen(false);
        setEditingTemplateId(null);
        fetchTemplates();
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to save template.');
      }
    } catch (err) {
      console.error('Failed to save template:', err);
      toast.error('Failed to save template.');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/stream-templates/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Template '${id}' deleted successfully.`);
        fetchTemplates();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to delete template.');
      }
    } catch (err) {
      console.error('Failed to delete template:', err);
      toast.error('Failed to delete template.');
    }
  };

  return (
    <ModalShell
      title="Manage Stream Templates"
      subtitle="Configure dynamic structures and parameter sets for stream categories."
      size="lg"
      bodyClassName="modal-body-scroll"
      onClose={handleClose}
    >
      {isTemplateFormOpen ? (
        <form onSubmit={handleSaveTemplate} className="form-scroll">
          <div className="form-grid-half">
            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Template Name / ID</label>
              <input
                className="form-input form-input-mono"
                type="text"
                placeholder="e.g. Vibration, Flow"
                value={templateFormId}
                onChange={(e) => setTemplateFormId(e.target.value)}
                required
                disabled={editingTemplateId !== null}
              />
              {editingTemplateId && (
                <span className="form-note">ID is immutable once template is created.</span>
              )}
            </div>

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Description</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Pump vibration metrics"
                value={templateFormDescription}
                onChange={(e) => setTemplateFormDescription(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Select Visual Icon</label>
            <div className="icon-picker-grid">
              {Object.keys(ICON_MAP).map(iconName => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setTemplateFormIcon(iconName)}
                  title={iconName}
                  className={`icon-picker-btn${templateFormIcon === iconName ? ' is-selected' : ''}`}
                >
                  <DynamicIcon name={iconName} size={18} />
                </button>
              ))}
            </div>
          </div>

          <div className="form-group form-group-flush form-group-stack">
            <label className="form-label form-label-bold">Parameter Keys</label>

            {templateFormParameters.length === 0 ? (
              <div className="param-list-empty">
                No parameters defined. Please add at least one parameter key below.
              </div>
            ) : (
              <div className="param-list-scroll">
                {templateFormParameters.map((param, index) => (
                  <div key={param} className="param-item">
                    <div className="param-item-left">
                      <span className="param-item-index">{String(index + 1).padStart(2, '0')}</span>
                      <span>{param}</span>
                    </div>
                    <div className="param-item-actions">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => {
                          const newParams = [...templateFormParameters];
                          const temp = newParams[index];
                          newParams[index] = newParams[index - 1];
                          newParams[index - 1] = temp;
                          setTemplateFormParameters(newParams);
                        }}
                        className="param-order-btn"
                        title="Move Up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={index === templateFormParameters.length - 1}
                        onClick={() => {
                          const newParams = [...templateFormParameters];
                          const temp = newParams[index];
                          newParams[index] = newParams[index + 1];
                          newParams[index + 1] = temp;
                          setTemplateFormParameters(newParams);
                        }}
                        className="param-order-btn"
                        title="Move Down"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemplateFormParameters(templateFormParameters.filter((_, idx) => idx !== index))}
                        className="param-remove-btn"
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="param-add-row">
              <input
                className="form-input param-add-input"
                type="text"
                placeholder="e.g. Temperature, FlowRate"
                value={newParamInput}
                onChange={(e) => setNewParamInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newParamInput.trim() && !templateFormParameters.includes(newParamInput.trim())) {
                      setTemplateFormParameters([...templateFormParameters, newParamInput.trim()]);
                      setNewParamInput('');
                    }
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (newParamInput.trim() && !templateFormParameters.includes(newParamInput.trim())) {
                    setTemplateFormParameters([...templateFormParameters, newParamInput.trim()]);
                    setNewParamInput('');
                  }
                }}
                className="btn-dark"
              >
                Add Parameter
              </button>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="submit"
              disabled={templateFormParameters.length === 0}
              className="btn-primary btn-flex-2"
            >
              Save Template
            </button>
            <button
              type="button"
              onClick={() => {
                setIsTemplateFormOpen(false);
                setEditingTemplateId(null);
              }}
              className="btn-secondary btn-flex-1"
            >
              Back to List
            </button>
          </div>
        </form>
      ) : (
        <div className="tmpl-view">
          <div className="tmpl-list-header">
            <span className="tmpl-count">{templates.length} Custom Templates Registered</span>
            <button
              onClick={() => {
                setEditingTemplateId(null);
                setTemplateFormId('');
                setTemplateFormDescription('');
                setTemplateFormParameters([]);
                setTemplateFormIcon('Database');
                setIsTemplateFormOpen(true);
              }}
              className="btn-primary btn-sm"
            >
              <Plus size={14} />
              New Template
            </button>
          </div>

          <div className="tmpl-list-scroll">
            {templates.map(t => {
              const isSystemDefault = t.id === 'Production' || t.id === 'Energy';
              const isUsedByAnyStream = datasources.some(x => x.type === t.id);
              let pList: string[] = [];
              try {
                pList = JSON.parse(t.parametersJson) || [];
              } catch (e) {
                console.error('Failed to parse template parameters:', e);
              }

              return (
                <div key={t.id} className="tmpl-card">
                  <div className="tmpl-card-left">
                    <div className="tmpl-card-icon-box">
                      <DynamicIcon name={t.icon} size={20} />
                    </div>
                    <div className="tmpl-card-info">
                      <div className="tmpl-card-title-row">
                        <h4 className="tmpl-card-title">{t.id}</h4>
                        {isSystemDefault && <span className="badge success badge-xs">Default</span>}
                        {isUsedByAnyStream && <span className="badge info badge-xs">In Use</span>}
                      </div>
                      <p className="tmpl-card-desc">{t.description}</p>
                      <div className="tmpl-params-row">
                        {pList.map(p => (
                          <span key={p} className="param-chip-xs">{p}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="tmpl-card-actions">
                    <button
                      onClick={() => {
                        setEditingTemplateId(t.id);
                        setTemplateFormId(t.id);
                        setTemplateFormDescription(t.description);
                        setTemplateFormParameters(pList);
                        setTemplateFormIcon(t.icon);
                        setIsTemplateFormOpen(true);
                      }}
                      title="Edit Template"
                      className="btn-card-icon is-edit"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(t.id)}
                      disabled={isUsedByAnyStream}
                      title={isUsedByAnyStream ? 'Cannot delete template in use by streams' : 'Delete Template'}
                      className="btn-card-icon is-delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
