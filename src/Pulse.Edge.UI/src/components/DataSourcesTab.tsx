import React, { useState } from 'react';
import { 
  Database, 
  Plus, 
  Tag, 
  Zap, 
  BarChart3, 
  Search, 
  Trash2, 
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Activity,
  Thermometer,
  Cpu,
  Gauge,
  Wind,
  Settings,
  Edit2,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import type { DataSource, DataPoint, DriverAdapter, StreamTemplate } from '../types';
import type { useToast } from '../hooks/useToast';
import CustomSelect from './CustomSelect';

type ToastFn = ReturnType<typeof useToast>['toast'];

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Database,
  Zap,
  BarChart3,
  Activity,
  Thermometer,
  Cpu,
  Gauge,
  Wind
};

const DynamicIcon = ({ name, size, style }: { name: string; size?: number; style?: React.CSSProperties }) => {
  const IconComp = ICON_MAP[name] || Database;
  return <IconComp size={size} style={style} />;
};

const formatLiveValue = (value: string | null | undefined, dataType: string): string => {
  if (value === null || value === undefined || value === '') return '—';
  
  const num = parseFloat(value);
  if (isNaN(num)) return value;

  const lowerDataType = dataType.toLowerCase();
  
  if (
    lowerDataType.includes('int') || 
    lowerDataType.includes('word') || 
    lowerDataType.includes('bool')
  ) {
    return Math.round(num).toString();
  }

  if (
    lowerDataType.includes('float') || 
    lowerDataType.includes('double') || 
    lowerDataType.includes('single') || 
    lowerDataType.includes('real') ||
    lowerDataType.includes('num')
  ) {
    return parseFloat(num.toFixed(2)).toString();
  }

  return parseFloat(num.toFixed(2)).toString();
};

interface DataSourcesTabProps {
  datasources: DataSource[];
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  handleToggleStreamEnabled: (ds: DataSource) => Promise<void>;
  handleDeleteDataPoint: (id: string) => Promise<void>;
  handleDeleteStream: (id: string) => Promise<void>;
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

export default function DataSourcesTab({
  datasources,
  datapoints,
  adapters,
  handleToggleStreamEnabled,
  handleDeleteDataPoint,
  handleDeleteStream,
  fetchData,
  toast
}: DataSourcesTabProps) {

  // Filtering states
  const [streamSearchQuery, setStreamSearchQuery] = useState('');
  const [streamTypeFilter, setStreamTypeFilter] = useState('All');

  // Dynamic Stream Templates state
  const [templates, setTemplates] = useState<StreamTemplate[]>([]);
  const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false);

  // Template Form State
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [isTemplateFormOpen, setIsTemplateFormOpen] = useState(false);
  const [templateFormId, setTemplateFormId] = useState('');
  const [templateFormDescription, setTemplateFormDescription] = useState('');
  const [templateFormParameters, setTemplateFormParameters] = useState<string[]>([]);
  const [newParamInput, setNewParamInput] = useState('');
  const [templateFormIcon, setTemplateFormIcon] = useState('Database');

  // Modals Visibility
  const [isCreateSourceOpen, setIsCreateSourceOpen] = useState(false);
  const [isAddPointOpen, setIsAddPointOpen] = useState(false);
  const [deletingDp, setDeletingDp] = useState<DataPoint | null>(null);

  // New Data Source Form State
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceId, setNewSourceId] = useState('');
  const [newSourceType, setNewSourceType] = useState('General'); // "Production" | "Energy" | "General"
  const [newSourceDescription, setNewSourceDescription] = useState('');

  // New Data Point Form State
  const [newDpDataSourceId, setNewDpDataSourceId] = useState('');
  const [newDpMetric, setNewDpMetric] = useState('');
  const [selectedTagId, setSelectedTagId] = useState('');

  // Tag selector filters
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagAdapterFilter, setTagAdapterFilter] = useState('All');
  const [tagMappingFilter, setTagMappingFilter] = useState('Free'); // 'All', 'Free', 'Mapped'

  const activeDs = datasources.find(x => x.id === newDpDataSourceId);

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/stream-templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Failed to fetch stream templates:', err);
    }
  };

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates();
  }, []);

  const filteredDatapoints = React.useMemo(() => {
    return datapoints.filter(dp => {
      // 1. Adapter Filter
      if (tagAdapterFilter !== 'All' && dp.adapterId !== tagAdapterFilter) {
        return false;
      }

      // 2. Mapping Filter
      const isMapped = dp.dataSourceId && dp.dataSourceId !== '';
      if (tagMappingFilter === 'Free' && isMapped) {
        return false;
      }
      if (tagMappingFilter === 'Mapped' && !isMapped) {
        return false;
      }

      // 3. Search Query Filter
      if (tagSearchQuery.trim() !== '') {
        const query = tagSearchQuery.toLowerCase();
        const addressMatch = dp.address?.toLowerCase().includes(query);
        const descMatch = dp.description ? dp.description.toLowerCase().includes(query) : false;
        
        // Find adapter name
        const adp = adapters.find(a => a.id === dp.adapterId);
        const adapterMatch = adp ? adp.name.toLowerCase().includes(query) : false;
        
        const metricMatch = dp.metric ? dp.metric.toLowerCase().includes(query) : false;
        const streamMatch = dp.dataSourceId ? dp.dataSourceId.toLowerCase().includes(query) : false;

        if (!addressMatch && !descMatch && !adapterMatch && !metricMatch && !streamMatch) {
          return false;
        }
      }

      return true;
    });
  }, [datapoints, tagAdapterFilter, tagMappingFilter, tagSearchQuery, adapters]);

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

  const handleAddDataSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName || !newSourceId) return;

    try {
      const payload = {
        id: newSourceId,
        name: newSourceName,
        type: newSourceType,
        description: newSourceDescription
      };

      const res = await fetch('/api/datasources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewSourceName('');
        setNewSourceId('');
        setNewSourceDescription('');
        setNewSourceType('General');
        setIsCreateSourceOpen(false);
        toast.success(`Data Source '${newSourceName}' registered successfully.`);
        fetchData();
      }
    } catch (err) {
      console.error('Failed to create data source:', err);
      toast.error('Failed to create data source.');
    }
  };

  const handleAddDataPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTagId || !newDpDataSourceId || !newDpMetric) {
      toast.warning('Please select a physical tag and specify a metric key.');
      return;
    }

    const tagToBind = datapoints.find(dp => dp.id === selectedTagId);
    if (!tagToBind) {
      toast.error('Selected physical tag not found.');
      return;
    }

    try {
      // Enforce 1-to-1 Cardinality: Check if this metric is already bound to another tag for this stream
      const existingBoundDp = datapoints.find(
        dp => dp.dataSourceId === newDpDataSourceId && dp.metric === newDpMetric
      );

      if (existingBoundDp && existingBoundDp.id !== selectedTagId) {
        const unbindRes = await fetch(`/api/datapoints/${existingBoundDp.id}`, { method: 'DELETE' });
        if (!unbindRes.ok) {
          toast.warning(`Note: Failed to unbind old tag for ${newDpMetric}. Binding new tag anyway.`);
        }
      }

      const payload = {
        ...tagToBind,
        dataSourceId: newDpDataSourceId,
        metric: newDpMetric
      };

      const res = await fetch('/api/datapoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewDpMetric('');
        setSelectedTagId('');
        setIsAddPointOpen(false);
        toast.success('Physical tag bound to metric successfully.');
        fetchData();
      } else {
        toast.error('Failed to bind physical tag.');
      }
    } catch (err) {
      console.error('Failed to bind data point:', err);
      toast.error('Failed to bind data point.');
    }
  };

  const onUnbindMetric = async (id: string) => {
    await handleDeleteDataPoint(id);
    setDeletingDp(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Database size={24} style={{ color: 'var(--primary-color)' }} />
            Telemetry Data Streams
          </h2>
          <p className="page-header-desc">
            Decouple edge raw telemetry signals from cloud business context. Configure connection metrics under logical stream channels.
          </p>
        </div>

        <div className="page-header-actions">
          <button 
            onClick={() => setIsManageTemplatesOpen(true)}
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              padding: '10px 20px',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.backgroundColor = 'var(--bg-color)';
              e.currentTarget.style.borderColor = 'var(--primary-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
          >
            <Settings size={18} />
            Manage Templates
          </button>

          <button 
            onClick={() => {
              setNewSourceId('DS' + String(datasources.length + 1).padStart(3, '0'));
              setIsCreateSourceOpen(true);
            }}
            style={{
              backgroundColor: 'var(--primary-color)',
              color: 'var(--sidebar-bg)',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px var(--primary-glow)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(60, 232, 189, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 4px 14px var(--primary-glow)';
            }}
          >
            <Plus size={18} />
            Create Data Source
          </button>
        </div>
      </div>

      {/* Summary Cards Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px'
      }}>
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ backgroundColor: 'rgba(60,232,189,0.1)', padding: '10px', borderRadius: '10px', color: 'var(--primary-dark)' }}>
            <Database size={20} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Streams</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datasources.length}</div>
          </div>
        </div>
        
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ backgroundColor: 'rgba(66,153,225,0.1)', padding: '10px', borderRadius: '10px', color: '#3182ce' }}>
            <Tag size={20} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Bound Metrics</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datapoints.filter(x => x.dataSourceId && x.dataSourceId !== "").length}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ backgroundColor: 'rgba(237,137,54,0.1)', padding: '10px', borderRadius: '10px', color: '#dd6b20' }}>
            <Zap size={20} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Energy Streams</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datasources.filter(x => x.type === 'Energy').length}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ backgroundColor: 'rgba(72,187,120,0.1)', padding: '10px', borderRadius: '10px', color: '#38a169' }}>
            <BarChart3 size={20} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Production Streams</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datasources.filter(x => x.type === 'Production').length}</div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="panel" style={{
        padding: '16px 20px',
        margin: 0,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        borderRadius: '12px',
        backgroundColor: 'rgba(255, 255, 255, 0.7)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 300px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search streams by name, ID or description..."
              value={streamSearchQuery}
              onChange={(e) => setStreamSearchQuery(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '36px', height: '40px', backgroundColor: '#ffffff' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
          {['All', 'General', ...templates.map(t => t.id)].map((cat) => (
            <button
              key={cat}
              onClick={() => setStreamTypeFilter(cat)}
              style={{
                padding: '8px 16px',
                borderRadius: '20px',
                border: '1px solid',
                borderColor: streamTypeFilter === cat ? 'transparent' : 'var(--border-color)',
                backgroundColor: streamTypeFilter === cat ? 'var(--sidebar-bg)' : '#ffffff',
                color: streamTypeFilter === cat ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap'
              }}
            >
              {cat === 'All' ? 'All Categories' : cat === 'Production' ? 'Production (OEE)' : cat === 'Energy' ? 'Energy' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Logical Data Sources Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '16px'
      }}>
        {datasources.filter(ds => {
          const matchesSearch = ds.name.toLowerCase().includes(streamSearchQuery.toLowerCase()) || 
                                ds.id.toLowerCase().includes(streamSearchQuery.toLowerCase()) ||
                                (ds.description && ds.description.toLowerCase().includes(streamSearchQuery.toLowerCase()));
          const matchesType = streamTypeFilter === 'All' || ds.type === streamTypeFilter;
          return matchesSearch && matchesType;
        }).length === 0 ? (
          <div className="panel" style={{
            gridColumn: '1 / -1',
            padding: '60px 40px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            backgroundColor: 'rgba(255, 255, 255, 0.5)',
            borderStyle: 'dashed',
            borderWidth: '2px',
            borderRadius: '12px'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
            <h4 style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text-primary)' }}>No Matching Data Sources Found</h4>
            <p style={{ margin: 0, fontSize: '13px' }}>
              Try clearing filters or click "Create Data Source" to establish a new telemetry path.
            </p>
          </div>
        ) : (
          datasources
            .filter(ds => {
              const matchesSearch = ds.name.toLowerCase().includes(streamSearchQuery.toLowerCase()) || 
                                    ds.id.toLowerCase().includes(streamSearchQuery.toLowerCase()) ||
                                    (ds.description && ds.description.toLowerCase().includes(streamSearchQuery.toLowerCase()));
              const matchesType = streamTypeFilter === 'All' || ds.type === streamTypeFilter;
              return matchesSearch && matchesType;
            })
            .map((ds) => {
              const dsPoints = datapoints.filter(dp => dp.dataSourceId === ds.id);
              
              // Find matching template to resolve icon and color
              const matchingTemplate = templates.find(t => t.id === ds.type);
              const isTemplate = !!matchingTemplate && ds.type !== 'General';
              
              let expectedParams: string[] = [];
              if (matchingTemplate) {
                try { expectedParams = JSON.parse(matchingTemplate.parametersJson) || []; } catch {}
              }

              const isFullyBound = !isTemplate || expectedParams.every(param => 
                datapoints.some(dp => dp.dataSourceId === ds.id && dp.metric === param)
              );

              // Custom color coding based on type
              let themeColor = '#3182ce'; // default
              let themeBg = 'rgba(66, 153, 225, 0.08)';
              let badgeClass = 'badge info';

              if (ds.type === 'Production') {
                themeColor = 'var(--primary-dark)';
                themeBg = 'rgba(60, 232, 189, 0.08)';
                badgeClass = 'badge success';
              } else if (ds.type === 'Energy') {
                themeColor = '#dd6b20';
                themeBg = 'rgba(237, 137, 54, 0.08)';
                badgeClass = 'badge warning';
              } else if (matchingTemplate) {
                themeColor = '#805ad5'; // purple for custom templates
                themeBg = 'rgba(128, 90, 213, 0.08)';
                badgeClass = 'badge warning';
              }

              // badge text and class mapping
              let statusText = ds.type === 'Production' ? 'Production (OEE)' : ds.type === 'Energy' ? 'Energy' : ds.type;
              let statusBadgeClass = badgeClass;
              let badgeStyle: React.CSSProperties = {};

              if (!ds.isEnabled) {
                statusText = 'Paused';
                statusBadgeClass = 'badge';
              } else if (isTemplate && !isFullyBound) {
                statusText = `${ds.type === 'Production' ? 'Production (OEE)' : ds.type} (Pending Setup)`;
                statusBadgeClass = 'badge warning';
                badgeStyle = { backgroundColor: '#feebc8', color: '#c05621' }; // warm orange
              }

              return (
                <div className="panel" key={ds.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  height: 'auto',
                  margin: 0,
                  position: 'relative',
                  padding: '20px',
                  borderTop: ds.isEnabled ? `4px solid ${themeColor}` : `4px solid #cbd5e0`,
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                  backgroundColor: ds.isEnabled ? '#ffffff' : '#fafbfc',
                  opacity: ds.isEnabled ? 1 : 0.85
                }}
                onMouseEnter={(e) => {
                  if (ds.isEnabled) {
                    e.currentTarget.style.transform = 'translateY(-3px)';
                    e.currentTarget.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.06)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.03)';
                }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: ds.isEnabled ? 'var(--text-primary)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {ds.name}
                          </h3>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginTop: '3px' }}>
                            STREAM ID: {ds.id}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Are you sure you want to delete stream '${ds.name}' (${ds.id})? All associated physical tags will be unbound.`)) {
                              handleDeleteStream(ds.id);
                            }
                          }}
                          title="Delete Stream"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-secondary)',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#ef4444';
                            e.currentTarget.style.backgroundColor = '#fef2f2';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = 'var(--text-secondary)';
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span 
                          className={ds.isEnabled ? statusBadgeClass : 'badge'} 
                          style={{ 
                            fontSize: '10px', 
                            padding: '4px 10px', 
                            borderRadius: '12px', 
                            backgroundColor: !ds.isEnabled ? '#e2e8f0' : badgeStyle.backgroundColor || themeBg, 
                            color: !ds.isEnabled ? '#718096' : badgeStyle.color || themeColor,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {ds.isEnabled && matchingTemplate && (
                            <DynamicIcon name={matchingTemplate.icon} size={11} />
                          )}
                          {statusText}
                        </span>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} title={ds.isEnabled ? "Pause Telemetry Stream" : "Resume Telemetry Stream"}>
                          <input 
                            type="checkbox" 
                            checked={ds.isEnabled} 
                            onChange={() => handleToggleStreamEnabled(ds)}
                            style={{ width: '15px', height: '15px', accentColor: themeColor, cursor: 'pointer' }}
                          />
                        </label>
                      </div>
                    </div>

                    {ds.description ? (
                      <p style={{
                        margin: '0 0 12px 0',
                        fontSize: '12.5px',
                        color: 'var(--text-secondary)',
                        lineHeight: '1.4',
                        padding: '6px 10px',
                        backgroundColor: 'var(--bg-color)',
                        borderRadius: '6px',
                        borderLeft: `2px solid ${themeColor}`
                      }}>
                        {ds.description}
                      </p>
                    ) : (
                      <div style={{ height: '8px' }} />
                    )}

                    <div style={{ marginTop: '16px' }}>
                      <h4 style={{
                        margin: '0 0 12px 0',
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.75px',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <span>{isTemplate ? 'Template Parameters' : 'Bound Metric Tags'}</span>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          backgroundColor: 'var(--bg-color)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px'
                        }}>
                          {isTemplate 
                            ? `${datapoints.filter(dp => dp.dataSourceId === ds.id && expectedParams.includes(dp.metric || '')).length}/${expectedParams.length} bound`
                            : `${dsPoints.length} active`
                          }
                        </span>
                      </h4>
                      
                      {isTemplate ? (
                        <div 
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                            gap: '8px'
                          }}
                        >
                          {expectedParams.map((param) => {
                            const dp = datapoints.find(x => x.dataSourceId === ds.id && x.metric === param);
                            const adp = dp ? adapters.find(a => a.id === dp.adapterId) : null;
                            
                            return (
                              <div key={param} style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                backgroundColor: dp ? '#ffffff' : '#fcfdfd',
                                border: dp ? '1px solid var(--border-color)' : '1px dashed #e2e8f0',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.01)'
                              }}
                              onMouseEnter={(e) => {
                                if (dp) {
                                  e.currentTarget.style.borderColor = themeColor;
                                } else {
                                  e.currentTarget.style.borderColor = '#cbd5e0';
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = dp ? 'var(--border-color)' : '#e2e8f0';
                              }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5px', flex: '1 1 auto', minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, color: dp ? 'var(--text-primary)' : '#718096', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                      {dp ? (
                                        <CheckCircle2 size={14} style={{ color: '#38a169', flexShrink: 0 }} />
                                      ) : (
                                        <AlertCircle size={14} style={{ color: '#dd6b20', flexShrink: 0 }} />
                                      )}
                                      {param}
                                    </span>
                                    
                                    {dp && ds.isEnabled ? (
                                      dp.lastError ? (
                                        <span style={{ fontSize: '10px', color: '#e53e3e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }} title={dp.lastError}>
                                          <span style={{ color: '#e53e3e', fontSize: '12px' }}>●</span> Err
                                        </span>
                                      ) : dp.lastValue !== null && dp.lastValue !== undefined ? (
                                        <span style={{ fontSize: '10px', color: '#38a169', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                          <span style={{ color: '#48bb78', fontSize: '12px' }}>●</span> {formatLiveValue(dp.lastValue, dp.dataType)}
                                        </span>
                                      ) : (
                                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                          <span style={{ color: '#cbd5e0', fontSize: '12px' }}>●</span> Wait...
                                        </span>
                                      )
                                    ) : dp ? (
                                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                        <span style={{ color: '#cbd5e0', fontSize: '12px' }}>●</span> Paused
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '10px', color: '#dd6b20', fontWeight: 600 }}>
                                        Missing Binding
                                      </span>
                                    )}
                                  </div>
                                  
                                  {dp ? (
                                    <span 
                                      style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                      title={dp.address}
                                    >
                                      Addr: {dp.address} {dp.description && <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', color: 'var(--text-secondary)', marginLeft: '4px', fontStyle: 'italic' }}>({dp.description})</span>}
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '10px', color: '#a0aec0', fontStyle: 'italic' }}>
                                      No physical tag assigned
                                    </span>
                                  )}
                                </div>
                                
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                                  {dp ? (
                                    <>
                                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
                                        <span className="badge info" style={{ fontSize: '8px', padding: '1px 4px', fontWeight: 600, backgroundColor: 'rgba(18, 19, 26, 0.04)', color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={adp ? `${adp.name} (${adp.protocol})` : 'Unknown'}>
                                          {adp ? adp.name : 'Unknown'}
                                        </span>
                                        <span style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                                          {dp.dataType}
                                        </span>
                                      </div>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeletingDp(dp);
                                        }}
                                        title="Unbind Parameter"
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          cursor: 'pointer',
                                          color: 'var(--text-secondary)',
                                          padding: '6px',
                                          borderRadius: '6px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          transition: 'all 0.2s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.color = '#ef4444';
                                          e.currentTarget.style.backgroundColor = '#fef2f2';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.color = 'var(--text-secondary)';
                                          e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setNewDpDataSourceId(ds.id);
                                        setNewDpMetric(param);
                                        setTagSearchQuery('');
                                        setTagAdapterFilter('All');
                                        setTagMappingFilter('Free');
                                        setSelectedTagId('');
                                        setIsAddPointOpen(true);
                                      }}
                                      style={{
                                        backgroundColor: 'transparent',
                                        color: themeColor,
                                        border: '1px solid',
                                        borderColor: `${themeColor}44`,
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = themeColor;
                                        e.currentTarget.style.color = '#ffffff';
                                        e.currentTarget.style.borderColor = themeColor;
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                        e.currentTarget.style.color = themeColor;
                                        e.currentTarget.style.borderColor = `${themeColor}44`;
                                      }}
                                    >
                                      Bind Tag
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        dsPoints.length === 0 ? (
                          <div style={{
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                            padding: '20px 14px',
                            backgroundColor: 'var(--bg-color)',
                            borderRadius: '8px',
                            textAlign: 'center',
                            border: '1px dashed var(--border-color)'
                          }}>
                            No telemetry metric bound to this stream source.
                          </div>
                        ) : (
                          <div 
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                              gap: '8px'
                            }}
                          >
                            {dsPoints.map((dp) => {
                              const adp = adapters.find(a => a.id === dp.adapterId);
                              return (
                                <div key={dp.id} style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  backgroundColor: '#ffffff',
                                  border: '1px solid var(--border-color)',
                                  padding: '6px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  transition: 'border-color 0.2s ease',
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.01)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = themeColor}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                                >
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5px', flex: '1 1 auto', minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {dp.metric}
                                      </span>
                                      {ds.isEnabled ? (
                                        dp.lastError ? (
                                          <span style={{ fontSize: '10px', color: '#e53e3e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }} title={dp.lastError}>
                                            <span style={{ color: '#e53e3e', fontSize: '12px' }}>●</span> Err
                                          </span>
                                        ) : dp.lastValue !== null && dp.lastValue !== undefined ? (
                                          <span style={{ fontSize: '10px', color: '#38a169', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                            <span style={{ color: '#48bb78', fontSize: '12px' }}>●</span> {formatLiveValue(dp.lastValue, dp.dataType)}
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                            <span style={{ color: '#cbd5e0', fontSize: '12px' }}>●</span> Wait...
                                          </span>
                                        )
                                      ) : (
                                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                          <span style={{ color: '#cbd5e0', fontSize: '12px' }}>●</span> Paused
                                        </span>
                                      )}
                                    </div>
                                    <span 
                                      style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                      title={dp.description || undefined}
                                    >
                                      Addr: {dp.address} {dp.description && <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', color: 'var(--text-secondary)', marginLeft: '4px', fontStyle: 'italic' }}>({dp.description})</span>}
                                    </span>
                                  </div>
                                  
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
                                      <span className="badge info" style={{ fontSize: '8px', padding: '1px 4px', fontWeight: 600, backgroundColor: 'rgba(18, 19, 26, 0.04)', color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={adp ? `${adp.name} (${adp.protocol})` : 'Unknown'}>
                                        {adp ? adp.name : 'Unknown'}
                                      </span>
                                      <span style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                                        {dp.dataType} ({dp.scanIntervalMs}ms)
                                      </span>
                                    </div>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeletingDp(dp);
                                      }}
                                      title="Unbind Metric"
                                      style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: 'var(--text-secondary)',
                                        padding: '6px',
                                        borderRadius: '6px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s ease',
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.color = '#ef4444';
                                        e.currentTarget.style.backgroundColor = '#fef2f2';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.color = 'var(--text-secondary)';
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                      }}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  {!isTemplate && (
                    <button 
                      onClick={() => { 
                        setNewDpDataSourceId(ds.id); 
                        setNewDpMetric('');
                        setTagSearchQuery('');
                        setTagAdapterFilter('All');
                        setTagMappingFilter('Free');
                        setSelectedTagId('');
                        setIsAddPointOpen(true); 
                      }}
                      style={{
                        marginTop: '20px',
                        width: '100%',
                        backgroundColor: themeBg,
                        color: themeColor,
                        border: `1px solid rgba(60, 232, 189, 0.0)`,
                        borderColor: ds.type === 'Production' ? 'rgba(60, 232, 189, 0.2)' :
                                     ds.type === 'Energy' ? 'rgba(237, 137, 54, 0.2)' : 'rgba(66, 153, 225, 0.2)',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = themeColor;
                        e.currentTarget.style.color = '#ffffff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = themeBg;
                        e.currentTarget.style.color = themeColor;
                      }}
                    >
                      <Plus size={14} />
                      Add Metric
                    </button>
                  )}
                </div>
              );
            })
        )}
      </div>

      {/* CREATE DATA SOURCE MODAL */}
      {isCreateSourceOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 11, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="panel" style={{
            width: '520px',
            maxWidth: '90%',
            padding: '28px 36px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Create Immutable Data Source</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Identify a new logical stream mapping on the Edge.</span>
              </div>
              <button 
                onClick={() => setIsCreateSourceOpen(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAddDataSource} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '16px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Data Source ID</label>
                  <input 
                    className="form-input" 
                    type="text" 
                    placeholder="e.g. DS003"
                    value={newSourceId}
                    onChange={(e) => setNewSourceId(e.target.value)}
                    required
                    style={{ fontWeight: 'bold', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Data Source Name</label>
                  <input 
                    className="form-input" 
                    type="text" 
                    placeholder="e.g. Conveyor Telemetry"
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Stream Category (Type)</label>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', marginTop: '6px' }}>
                  {(() => {
                    const isSelected = newSourceType === 'General';
                    return (
                      <button
                        type="button"
                        onClick={() => setNewSourceType('General')}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '12px 8px',
                          borderRadius: '10px',
                          border: '2px solid',
                          borderColor: isSelected ? '#3182ce' : 'var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(66,153,225,0.08)' : '#ffffff',
                          color: isSelected ? '#3182ce' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          textAlign: 'center'
                        }}
                      >
                        <div style={{ marginBottom: '6px', color: isSelected ? '#3182ce' : 'var(--text-secondary)' }}>
                          <Database size={16} />
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '12px' }}>General</div>
                        <div style={{ fontSize: '9px', opacity: 0.8, marginTop: '2px' }}>Other Telemetry</div>
                      </button>
                    );
                  })()}

                  {templates.map(t => {
                    const isSelected = newSourceType === t.id;
                    const themeColor = t.id === 'Production' ? 'var(--primary-dark)' :
                                       t.id === 'Energy' ? '#dd6b20' : '#805ad5';
                    const themeBg = t.id === 'Production' ? 'rgba(60,232,189,0.08)' :
                                     t.id === 'Energy' ? 'rgba(237,137,54,0.08)' : 'rgba(128,90,213,0.08)';
                    
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setNewSourceType(t.id)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '12px 8px',
                          borderRadius: '10px',
                          border: '2px solid',
                          borderColor: isSelected ? themeColor : 'var(--border-color)',
                          backgroundColor: isSelected ? themeBg : '#ffffff',
                          color: isSelected ? themeColor : 'var(--text-secondary)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          textAlign: 'center'
                        }}
                      >
                        <div style={{ marginBottom: '6px', color: isSelected ? themeColor : 'var(--text-secondary)' }}>
                          <DynamicIcon name={t.icon} size={16} />
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{t.id}</div>
                        <div style={{ fontSize: '9px', opacity: 0.8, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{t.description || 'Custom Template'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Description</label>
                <textarea 
                  className="form-input" 
                  style={{ minHeight: '80px', resize: 'vertical' }}
                  placeholder="Describe the location/system this stream reads from..."
                  value={newSourceDescription}
                  onChange={(e) => setNewSourceDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button 
                  type="submit"
                  style={{
                    flex: 2,
                    backgroundColor: 'var(--primary-color)',
                    color: 'var(--sidebar-bg)',
                    border: 'none',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 10px var(--primary-glow)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 6px 14px rgba(60, 232, 189, 0.4)'}
                  onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 4px 10px var(--primary-glow)'}
                >
                  Create Stream
                </button>
                <button 
                  type="button"
                  onClick={() => setIsCreateSourceOpen(false)}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BIND METRIC POINT MODAL */}
      {isAddPointOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 11, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <style>{`
            @keyframes pulse {
              0% { transform: scale(0.9); opacity: 0.6; }
              50% { transform: scale(1.25); opacity: 1; }
              100% { transform: scale(0.9); opacity: 0.6; }
            }
            .pulse-dot {
              animation: pulse 2s infinite ease-in-out;
            }
            .tag-scroll-container::-webkit-scrollbar {
              width: 6px;
            }
            .tag-scroll-container::-webkit-scrollbar-track {
              background: transparent;
            }
            .tag-scroll-container::-webkit-scrollbar-thumb {
              background-color: var(--border-color);
              border-radius: 3px;
            }
            .tag-scroll-container::-webkit-scrollbar-thumb:hover {
              background-color: var(--text-secondary);
            }
          `}</style>
          <div className="panel" style={{
            width: '640px',
            maxWidth: '95%',
            padding: '24px 28px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Bind Metric Tag</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Establish a telemetry source driver tag mapping.</span>
              </div>
              <button 
                onClick={() => setIsAddPointOpen(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                &times;
              </button>
            </div>

            {(() => {
              const themeColor = activeDs?.type === 'Production' ? 'var(--primary-dark)' :
                                 activeDs?.type === 'Energy' ? '#dd6b20' : '#3182ce';
              const themeBg = activeDs?.type === 'Production' ? 'rgba(60, 232, 189, 0.08)' :
                               activeDs?.type === 'Energy' ? 'rgba(237, 137, 54, 0.08)' : 'rgba(66, 153, 225, 0.08)';
              return (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: themeBg,
                  borderLeft: `4px solid ${themeColor}`,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '16px'
                }}>
                  <div>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Target Stream</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{activeDs?.name || newDpDataSourceId}</span>
                  </div>
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: themeColor, backgroundColor: '#ffffff', padding: '3px 8px', borderRadius: '4px', border: `1px solid ${themeColor}33` }}>
                    ID: {newDpDataSourceId}
                  </span>
                </div>
              );
            })()}

            <form onSubmit={handleAddDataPoint} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label className="form-label" style={{ fontWeight: 700, marginBottom: '2px' }}>Select Connection Tag</label>
                {datapoints.length === 0 ? (
                  <div style={{ color: 'var(--danger-color)', fontSize: '12px', padding: '10px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fed7d7' }}>
                    No physical tags configured. Please configure tags under the "Physical Tags" tab first.
                  </div>
                ) : (
                  <>
                    {/* Search Controls */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-secondary)' }} />
                        <input 
                          type="text" 
                          placeholder="Search tags by address, description, adapter..." 
                          value={tagSearchQuery}
                          onChange={(e) => setTagSearchQuery(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px 12px 10px 36px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            fontSize: '13px',
                            fontWeight: 500,
                            backgroundColor: '#ffffff',
                            outline: 'none',
                            transition: 'all 0.2s ease',
                          }}
                          onFocus={(e) => e.target.style.borderColor = 'var(--primary-dark)'}
                          onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                        />
                      </div>
                      
                      {/* Filter Controls Row */}
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Connection / Adapter</label>
                          <CustomSelect 
                            value={tagAdapterFilter}
                            onChange={setTagAdapterFilter}
                            options={[
                              { value: 'All', label: 'All Adapters' },
                              ...adapters.map(a => ({ value: a.id, label: `${a.name} (${a.protocol})` }))
                            ]}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Mapping Status</label>
                          <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                            {(['Free', 'All', 'Mapped'] as const).map((status) => {
                              const isActive = tagMappingFilter === status;
                              return (
                                <button
                                  key={status}
                                  type="button"
                                  onClick={() => setTagMappingFilter(status)}
                                  style={{
                                    flex: 1,
                                    padding: '8px 4px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    backgroundColor: isActive ? 'var(--bg-color)' : '#ffffff',
                                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    border: 'none',
                                    borderRight: status !== 'Mapped' ? '1px solid var(--border-color)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  {status === 'Free' ? 'Free' : status === 'Mapped' ? 'Mapped' : 'All'}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Tag list viewport */}
                    <div 
                      className="tag-scroll-container"
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        backgroundColor: 'var(--bg-color)',
                        maxHeight: '220px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '3px'
                      }}
                    >
                      {filteredDatapoints.length === 0 ? (
                        <div style={{
                          padding: '32px 16px',
                          textAlign: 'center',
                          color: 'var(--text-secondary)',
                          fontSize: '13px',
                          backgroundColor: '#ffffff',
                          borderRadius: '6px'
                        }}>
                          <AlertCircle size={24} style={{ color: 'var(--text-secondary)', marginBottom: '8px', display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />
                          No tags match the filter criteria.
                        </div>
                      ) : (
                        filteredDatapoints.map(dp => {
                          const adp = adapters.find(a => a.id === dp.adapterId);
                          const isSelected = selectedTagId === dp.id;
                          const isMapped = dp.dataSourceId && dp.dataSourceId !== '';
                          const formattedValue = formatLiveValue(dp.lastValue, dp.dataType);

                          // Determine theme color for selection highlight
                          const selectedBorderColor = activeDs?.type === 'Production' ? 'var(--primary-dark)' :
                                                       activeDs?.type === 'Energy' ? '#dd6b20' : '#3182ce';
                          const selectedBgColor = activeDs?.type === 'Production' ? 'rgba(60, 232, 189, 0.06)' :
                                                   activeDs?.type === 'Energy' ? 'rgba(237, 137, 54, 0.06)' : 'rgba(66, 153, 225, 0.06)';

                          return (
                            <div 
                              key={dp.id}
                              onClick={() => {
                                setSelectedTagId(dp.id);
                                // Auto-populate metric key if empty & it is a general datasource
                                if ((!newDpMetric || newDpMetric === '') && activeDs?.type === 'General') {
                                  // Create a helper snake_case name from the address
                                  const rawAddress = dp.address || '';
                                  const cleanMetric = rawAddress
                                    .split(';')
                                    .pop() // Get last part of semicolon separated address
                                    ?.split('=')
                                    .pop() // Get last part of equal sign separated address
                                    ?.replace(/[^a-zA-Z0-9_/]/g, '_') // Replace special chars with underscores
                                    ?.replace(/\/+/g, '_') // Replace slashes with underscores
                                    ?.replace(/_+/g, '_') // Deduplicate underscores
                                    ?.replace(/^_+|_+$/g, '') // Trim underscores
                                    ?.toLowerCase();
                                  if (cleanMetric) {
                                    setNewDpMetric(cleanMetric);
                                  }
                                }
                              }}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                padding: '10px 12px',
                                backgroundColor: isSelected ? selectedBgColor : '#ffffff',
                                border: isSelected ? `2px solid ${selectedBorderColor}` : '1px solid transparent',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                position: 'relative',
                                userSelect: 'none'
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                                  e.currentTarget.style.borderColor = 'var(--border-color)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.backgroundColor = '#ffffff';
                                  e.currentTarget.style.borderColor = 'transparent';
                                }
                              }}
                            >
                              {/* Top row of card */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {/* Custom selection circle / checkbox */}
                                  <div style={{
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '50%',
                                    border: `2px solid ${isSelected ? selectedBorderColor : 'var(--border-color)'}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: isSelected ? selectedBorderColor : 'transparent',
                                    flexShrink: 0,
                                    transition: 'all 0.15s ease'
                                  }}>
                                    {isSelected && (
                                      <span style={{ color: '#ffffff', fontSize: '9px', fontWeight: 900, lineHeight: 1 }}>✓</span>
                                    )}
                                  </div>
                                  <span style={{ 
                                    fontFamily: 'var(--font-mono)', 
                                    fontSize: '12.5px', 
                                    fontWeight: 700, 
                                    color: isSelected ? selectedBorderColor : 'var(--text-primary)',
                                    wordBreak: 'break-all'
                                  }}>
                                    {dp.address}
                                  </span>
                                </div>
                                
                                {/* Status / Mapping badge */}
                                <div style={{ flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  {isMapped ? (
                                    <span style={{ 
                                      fontSize: '9.5px', 
                                      fontWeight: 700, 
                                      backgroundColor: 'rgba(237, 137, 54, 0.1)', 
                                      color: '#dd6b20', 
                                      padding: '2px 6px', 
                                      borderRadius: '4px',
                                      border: '1px solid rgba(237, 137, 54, 0.2)'
                                    }}>
                                      Mapped: {dp.dataSourceId} → {dp.metric}
                                    </span>
                                  ) : (
                                    <span style={{ 
                                      fontSize: '9.5px', 
                                      fontWeight: 700, 
                                      backgroundColor: 'rgba(72, 187, 120, 0.1)', 
                                      color: 'var(--success-color)', 
                                      padding: '2px 6px', 
                                      borderRadius: '4px',
                                      border: '1px solid rgba(72, 187, 120, 0.2)'
                                    }}>
                                      Free
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Details row */}
                              <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                marginTop: '6px',
                                paddingLeft: '24px',
                                fontSize: '11px',
                                color: 'var(--text-secondary)'
                              }}>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{ 
                                    backgroundColor: 'rgba(0, 0, 0, 0.05)', 
                                    padding: '1px 5px', 
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    color: 'var(--text-primary)',
                                    fontSize: '10px'
                                  }}>
                                    {adp ? adp.name : 'Unknown Adapter'}
                                  </span>
                                  <span>{dp.dataType}</span>
                                  <span>•</span>
                                  <span>{dp.scanIntervalMs}ms</span>
                                </div>

                                {/* Live Value if present */}
                                {dp.lastValue !== undefined && dp.lastValue !== null && dp.lastValue !== '' && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    <span 
                                      className="pulse-dot"
                                      style={{
                                        width: '6px',
                                        height: '6px',
                                        backgroundColor: 'var(--success-color)',
                                        borderRadius: '50%',
                                        display: 'inline-block'
                                      }} 
                                    />
                                    <span>Val: {formattedValue}</span>
                                  </div>
                                )}
                              </div>

                              {/* Description row (if present) */}
                              {dp.description && (
                                <div style={{ 
                                  marginTop: '4px', 
                                  paddingLeft: '24px', 
                                  fontSize: '11px', 
                                  color: 'var(--text-secondary)',
                                  fontStyle: 'italic'
                                }}>
                                  {dp.description}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Metric Key (Identifier)</label>
                <input 
                  className="form-input" 
                  type="text" 
                  placeholder="e.g. good_count, temperature, voltage"
                  value={newDpMetric}
                  onChange={(e) => setNewDpMetric(e.target.value)}
                  required
                  disabled={activeDs ? activeDs.type !== 'General' : false}
                  style={{ 
                    fontFamily: 'var(--font-mono)', 
                    fontWeight: 600,
                    backgroundColor: (activeDs && activeDs.type !== 'General') ? '#f7fafc' : undefined,
                    cursor: (activeDs && activeDs.type !== 'General') ? 'not-allowed' : undefined
                  }}
                />
                {activeDs && activeDs.type !== 'General' && (
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                    ℹ️ Fixed parameter defined by the <strong>{activeDs.type}</strong> template.
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                <button 
                  type="submit"
                  disabled={datapoints.length === 0 || !selectedTagId || !newDpMetric}
                  style={{
                    flex: 2,
                    backgroundColor: 'var(--sidebar-bg)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: (datapoints.length === 0 || !selectedTagId || !newDpMetric) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: (datapoints.length === 0 || !selectedTagId || !newDpMetric) ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (datapoints.length > 0 && selectedTagId && newDpMetric) e.currentTarget.style.backgroundColor = '#1a1c23';
                  }}
                  onMouseLeave={(e) => {
                    if (datapoints.length > 0 && selectedTagId && newDpMetric) e.currentTarget.style.backgroundColor = 'var(--sidebar-bg)';
                  }}
                >
                  Bind Metric
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    setIsAddPointOpen(false);
                    setSelectedTagId('');
                    setNewDpMetric('');
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingDp && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 11, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="panel" style={{
            width: '480px',
            maxWidth: '90%',
            padding: '28px 36px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={{
                backgroundColor: '#fff5f5',
                color: '#e53e3e',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Unbind Telemetry Metric?</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Are you sure you want to unbind the metric <strong style={{ color: 'var(--text-primary)' }}>{deletingDp.metric}</strong>?
                </p>
              </div>
            </div>

            <div style={{
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-color)',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '24px',
              fontSize: '12px'
            }}>
              <div style={{ display: 'flex', justifySelf: 'space-between', width: '100%', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Source Address:</span>
                <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{deletingDp.address}</span>
              </div>
              <div style={{ display: 'flex', justifySelf: 'space-between', width: '100%' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Data Type:</span>
                <span style={{ fontWeight: 600 }}>{deletingDp.dataType} ({deletingDp.scanIntervalMs}ms)</span>
              </div>
            </div>

            <div style={{
              color: '#e53e3e',
              backgroundColor: '#fff5f5',
              border: '1px solid #fed7d7',
              padding: '12px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              marginBottom: '24px',
              lineHeight: '1.4'
            }}>
              <strong>Warning:</strong> Telemetry ingestion and buffering for this physical address will stop immediately. This action cannot be undone.
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => onUnbindMetric(deletingDp.id)}
                style={{
                  flex: 1,
                  backgroundColor: '#e53e3e',
                  color: '#ffffff',
                  border: 'none',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#c53030'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e53e3e'}
              >
                Unbind Metric
              </button>
              <button 
                onClick={() => setDeletingDp(null)}
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE TEMPLATES MODAL */}
      {isManageTemplatesOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 11, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 999
        }}>
          <div className="panel" style={{
            width: '680px',
            maxWidth: '95%',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            padding: '28px 36px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0,
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px', flexShrink: 0 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Manage Stream Templates</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Configure dynamic structures and parameter sets for stream categories.</span>
              </div>
              <button 
                onClick={() => {
                  setIsManageTemplatesOpen(false);
                  setIsTemplateFormOpen(false);
                  setEditingTemplateId(null);
                }}
                style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifySelf: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                &times;
              </button>
            </div>

            {isTemplateFormOpen ? (
              // CREATE / EDIT TEMPLATE FORM
              <form onSubmit={handleSaveTemplate} style={{ display: 'flex', flexDirection: 'column', gap: '18px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Template Name / ID</label>
                    <input 
                      className="form-input" 
                      type="text" 
                      placeholder="e.g. Vibration, Flow"
                      value={templateFormId}
                      onChange={(e) => setTemplateFormId(e.target.value)}
                      required
                      disabled={editingTemplateId !== null}
                      style={{ fontWeight: 'bold', textTransform: 'uppercase' }}
                    />
                    {editingTemplateId && (
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>ID is immutable once template is created.</span>
                    )}
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Description</label>
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

                {/* SELECT ICON GRID */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Select Visual Icon</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '8px', marginTop: '6px' }}>
                    {Object.keys(ICON_MAP).map(iconName => {
                      const isSelected = templateFormIcon === iconName;
                      return (
                        <button
                          key={iconName}
                          type="button"
                          onClick={() => setTemplateFormIcon(iconName)}
                          title={iconName}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '10px',
                            borderRadius: '8px',
                            border: '2px solid',
                            borderColor: isSelected ? 'var(--primary-dark)' : 'var(--border-color)',
                            backgroundColor: isSelected ? 'rgba(60,232,189,0.08)' : '#ffffff',
                            color: isSelected ? 'var(--primary-dark)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <DynamicIcon name={iconName} size={18} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* PARAMETERS MANAGEMENT */}
                <div className="form-group" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Parameter Keys</label>
                  
                  {templateFormParameters.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '14px', border: '1px dashed var(--border-color)', borderRadius: '8px', textAlign: 'center' }}>
                      No parameters defined. Please add at least one parameter key below.
                    </div>
                  ) : (
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: '6px', 
                      maxHeight: '180px', 
                      overflowY: 'auto', 
                      padding: '4px 2px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(0,0,0,0.02)'
                    }}>
                      {templateFormParameters.map((param, index) => (
                        <div 
                          key={param} 
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: '#ffffff',
                            border: '1px solid var(--border-color)',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '10px', minWidth: '16px' }}>
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span>{param}</span>
                          </div>
                          
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                background: 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                color: index === 0 ? 'var(--border-color)' : 'var(--text-secondary)',
                                cursor: index === 0 ? 'not-allowed' : 'pointer',
                                transition: 'background-color 0.2s',
                              }}
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
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                background: 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                color: index === templateFormParameters.length - 1 ? 'var(--border-color)' : 'var(--text-secondary)',
                                cursor: index === templateFormParameters.length - 1 ? 'not-allowed' : 'pointer',
                                transition: 'background-color 0.2s',
                              }}
                              title="Move Down"
                            >
                              <ChevronDown size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setTemplateFormParameters(templateFormParameters.filter((_, idx) => idx !== index))}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                background: 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#ef4444',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s',
                              }}
                              title="Remove"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Parameter Sub-form */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <input 
                      className="form-input"
                      type="text"
                      placeholder="e.g. Temperature, FlowRate"
                      value={newParamInput}
                      onChange={(e) => setNewParamInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} 
                      style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
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
                      style={{
                        backgroundColor: 'var(--sidebar-bg)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '0 16px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Add Parameter
                    </button>
                  </div>
                </div>

                {/* FORM ACTIONS */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '10px', flexShrink: 0 }}>
                  <button 
                    type="submit"
                    disabled={templateFormParameters.length === 0}
                    style={{
                      flex: 2,
                      backgroundColor: 'var(--primary-color)',
                      color: 'var(--sidebar-bg)',
                      border: 'none',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      cursor: templateFormParameters.length === 0 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease',
                      opacity: templateFormParameters.length === 0 ? 0.6 : 1
                    }}
                  >
                    Save Template
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setIsTemplateFormOpen(false);
                      setEditingTemplateId(null);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-color)',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Back to List
                  </button>
                </div>
              </form>
            ) : (
              // TEMPLATES LIST VIEW
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexShrink: 0 }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {templates.length} Custom Templates Registered
                  </span>
                  <button
                    onClick={() => {
                      setEditingTemplateId(null);
                      setTemplateFormId('');
                      setTemplateFormDescription('');
                      setTemplateFormParameters([]);
                      setTemplateFormIcon('Database');
                      setIsTemplateFormOpen(true);
                    }}
                    style={{
                      backgroundColor: 'var(--primary-color)',
                      color: 'var(--sidebar-bg)',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Plus size={14} />
                    New Template
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                  {templates.map(t => {
                    let isSystemDefault = t.id === 'Production' || t.id === 'Energy';
                    let isUsedByAnyStream = datasources.some(x => x.type === t.id);

                    // Decode params list
                    let pList: string[] = [];
                    try { pList = JSON.parse(t.parametersJson) || []; } catch {}

                    return (
                      <div 
                        key={t.id}
                        style={{
                          border: '1px solid var(--border-color)',
                          padding: '16px',
                          borderRadius: '10px',
                          backgroundColor: '#ffffff',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '16px'
                        }}
                      >
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                          <div style={{
                            backgroundColor: 'var(--bg-color)',
                            color: 'var(--sidebar-bg)',
                            padding: '12px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <DynamicIcon name={t.icon} size={20} />
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
                                {t.id}
                              </h4>
                              {isSystemDefault && (
                                <span className="badge success" style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px' }}>Default</span>
                              )}
                              {isUsedByAnyStream && (
                                <span className="badge info" style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px' }}>In Use</span>
                              )}
                            </div>
                            <p style={{ margin: '4px 0 6px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>{t.description}</p>
                            
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {pList.map(p => (
                                <span 
                                  key={p} 
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '9.5px',
                                    fontWeight: 700,
                                    backgroundColor: 'var(--bg-color)',
                                    color: 'var(--text-secondary)',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)'
                                  }}
                                >
                                  {p}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border-color)',
                              cursor: 'pointer',
                              color: 'var(--text-secondary)',
                              padding: '8px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = 'var(--primary-dark)';
                              e.currentTarget.style.backgroundColor = 'var(--bg-color)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'var(--text-secondary)';
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            <Edit2 size={14} />
                          </button>
                          
                          <button
                            onClick={() => handleDeleteTemplate(t.id)}
                            disabled={isUsedByAnyStream}
                            title={isUsedByAnyStream ? "Cannot delete template in use by streams" : "Delete Template"}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border-color)',
                              cursor: isUsedByAnyStream ? 'not-allowed' : 'pointer',
                              color: isUsedByAnyStream ? '#cbd5e0' : 'var(--text-secondary)',
                              padding: '8px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s ease',
                              opacity: isUsedByAnyStream ? 0.4 : 1
                            }}
                            onMouseEnter={(e) => {
                              if (!isUsedByAnyStream) {
                                e.currentTarget.style.color = '#ef4444';
                                e.currentTarget.style.backgroundColor = '#fef2f2';
                                e.currentTarget.style.borderColor = '#fee2e2';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isUsedByAnyStream) {
                                e.currentTarget.style.color = 'var(--text-secondary)';
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.borderColor = 'var(--border-color)';
                              }
                            }}
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
          </div>
        </div>
      )}

    </div>
  );
}
