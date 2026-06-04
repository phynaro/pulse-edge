import React, { useState } from 'react';
import { 
  Tag, 
  Plus, 
  Search, 
  Trash2, 
  AlertTriangle,
  Edit,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import type { DataPoint, DriverAdapter } from '../types';
import type { useToast } from '../hooks/useToast';
import CustomSelect from './CustomSelect';

type ToastFn = ReturnType<typeof useToast>['toast'];

const formatToLocalTimeString = (dateStr: string | null | undefined) => {
  if (!dateStr) return '';
  let utcStr = dateStr;
  if (!utcStr.endsWith('Z') && !utcStr.includes('+') && !utcStr.includes('GMT')) {
    utcStr = utcStr.replace(' ', 'T') + 'Z';
  }
  return new Date(utcStr).toLocaleTimeString();
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

interface TagsTabProps {
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  handleDeleteDataPoint: (id: string) => Promise<void>;
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

export default function TagsTab({
  datapoints,
  adapters,
  handleDeleteDataPoint,
  fetchData,
  toast
}: TagsTabProps) {

  // Local filtering states
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagProtocolFilter, setTagProtocolFilter] = useState('All');

  // Grouping & Expansion states
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});
  const [visibleTagCounts, setVisibleTagCounts] = useState<Record<string, number>>({});

  const isSearchActive = tagSearchQuery.trim() !== '' || tagProtocolFilter !== 'All';

  const isGroupExpanded = (groupId: string, hasMatchingTags: boolean) => {
    if (expandedGroups[groupId] !== undefined) {
      return expandedGroups[groupId];
    }
    return isSearchActive ? hasMatchingTags : false;
  };

  const toggleGroup = (groupId: string, hasMatchingTags: boolean) => {
    setExpandedGroups(prev => {
      const current = isGroupExpanded(groupId, hasMatchingTags);
      return { ...prev, [groupId]: !current };
    });
  };

  const handleExpandAll = () => {
    const nextState: Record<string, boolean> = {};
    adapters.forEach(a => {
      nextState[a.id] = true;
    });
    nextState['orphans'] = true;
    setExpandedGroups(nextState);
  };

  const handleCollapseAll = () => {
    const nextState: Record<string, boolean> = {};
    adapters.forEach(a => {
      nextState[a.id] = false;
    });
    nextState['orphans'] = false;
    setExpandedGroups(nextState);
  };

  const toggleTagDetails = (tagId: string) => {
    setExpandedTags(prev => ({ ...prev, [tagId]: !prev[tagId] }));
  };

  const getVisibleCount = (groupId: string) => {
    return visibleTagCounts[groupId] || 50;
  };

  const handleShowMore = (groupId: string, totalCount: number) => {
    setVisibleTagCounts(prev => ({ ...prev, [groupId]: totalCount }));
  };

  const filteredDatapoints = datapoints.filter(dp => {
    const adp = adapters.find(a => a.id === dp.adapterId);
    const matchesSearch = 
      dp.address.toLowerCase().includes(tagSearchQuery.toLowerCase()) || 
      (dp.metric && dp.metric.toLowerCase().includes(tagSearchQuery.toLowerCase())) ||
      (dp.dataSourceId && dp.dataSourceId.toLowerCase().includes(tagSearchQuery.toLowerCase()));
    
    let matchesProto = true;
    if (tagProtocolFilter !== 'All') {
      if (tagProtocolFilter === 'OPC UA') matchesProto = adp?.protocol === 'OPC_UA';
      else if (tagProtocolFilter === 'MQTT') matchesProto = adp?.protocol === 'MQTT';
      else if (tagProtocolFilter === 'Modbus TCP') matchesProto = adp?.protocol === 'MODBUS_TCP';
    }
    return matchesSearch && matchesProto;
  });

  // Modal & form states
  const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [deletingPhysicalTag, setDeletingPhysicalTag] = useState<DataPoint | null>(null);
  const [editingPhysicalTag, setEditingPhysicalTag] = useState<DataPoint | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Record<string, boolean>>({});
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

  const [newDpAdapterId, setNewDpAdapterId] = useState('');
  const [newDpAddress, setNewDpAddress] = useState('');
  const [newDpDataType, setNewDpDataType] = useState('Int16');
  const [newDpScanIntervalMs, setNewDpScanIntervalMs] = useState(1000);
  const [newDpScaleFactor, setNewDpScaleFactor] = useState<string>('1.0');
  const [newDpOffset, setNewDpOffset] = useState<string>('0.0');
  const [newDpByteOrder, setNewDpByteOrder] = useState('AB');
  const [newDpDescription, setNewDpDescription] = useState('');
  const [newDpCount, setNewDpCount] = useState(1);
  const [newDpMqttParseMode, setNewDpMqttParseMode] = useState('Plaintext');
  const [newDpMqttJsonPath, setNewDpMqttJsonPath] = useState('');

  // OPC UA Browser Modal States
  const [isOpcBrowserOpen, setIsOpcBrowserOpen] = useState(false);
  const [opcBrowserLoading, setOpcBrowserLoading] = useState(false);
  const [opcBrowserError, setOpcBrowserError] = useState('');
  const [opcBrowserNodes, setOpcBrowserNodes] = useState<any[]>([]);
  const [opcBrowserPath, setOpcBrowserPath] = useState<{ nodeId: string | null; displayName: string }[]>([
    { nodeId: null, displayName: 'Root' }
  ]);
  const [opcSelectedNodes, setOpcSelectedNodes] = useState<Record<string, any>>({});
  const [opcBrowserStep, setOpcBrowserStep] = useState(1); // 1: Tree selection, 2: Table configuration
  const [opcConfiguringTags, setOpcConfiguringTags] = useState<any[]>([]);

  const fetchOpcNodes = async (adapterId: string, nodeId: string | null = null) => {
    setOpcBrowserLoading(true);
    setOpcBrowserError('');
    try {
      const res = await fetch('/api/adapters/opcua/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId, nodeId })
      });
      const data = await res.json();
      if (data.success) {
        setOpcBrowserNodes(data.nodes || []);
      } else {
        setOpcBrowserError(data.message || 'Failed to fetch nodes.');
      }
    } catch (err: any) {
      setOpcBrowserError(err.message || 'An error occurred.');
    } finally {
      setOpcBrowserLoading(false);
    }
  };

  const handleOpenOpcBrowser = () => {
    if (!newDpAdapterId) {
      toast.warning('Please select an OPC UA adapter first.');
      return;
    }
    const adapter = adapters.find(a => a.id === newDpAdapterId);
    if (!adapter || adapter.protocol !== 'OPC_UA') {
      toast.warning('The selected adapter is not an OPC UA adapter.');
      return;
    }
    setIsOpcBrowserOpen(true);
    setOpcBrowserStep(1);
    setOpcSelectedNodes({});
    setOpcBrowserPath([{ nodeId: null, displayName: 'Root' }]);
    fetchOpcNodes(newDpAdapterId, null);
  };

  const handleToggleOpcNode = (node: any) => {
    setOpcSelectedNodes(prev => {
      const next = { ...prev };
      if (next[node.nodeId]) {
        delete next[node.nodeId];
      } else {
        next[node.nodeId] = node;
      }
      return next;
    });
  };

  const handleEnterOpcFolder = (node: any) => {
    const newPath = [...opcBrowserPath, { nodeId: node.nodeId, displayName: node.displayName }];
    setOpcBrowserPath(newPath);
    fetchOpcNodes(newDpAdapterId, node.nodeId);
  };

  const handleOpcBreadcrumbClick = (index: number) => {
    const newPath = opcBrowserPath.slice(0, index + 1);
    setOpcBrowserPath(newPath);
    const targetNodeId = newPath[index].nodeId;
    fetchOpcNodes(newDpAdapterId, targetNodeId);
  };

  const handleOpcNextStep = () => {
    const selectedList = Object.values(opcSelectedNodes);
    if (selectedList.length === 0) {
      toast.warning('Please select at least one variable node.');
      return;
    }
    const configuring = selectedList.map(node => {
      const tagName = node.displayName.replace(/[^a-zA-Z0-9_]/g, '_');
      return {
        nodeId: node.nodeId,
        displayName: node.displayName,
        tagName: tagName,
        dataType: node.dataType || 'Double',
        scanIntervalMs: 1000,
        description: tagName
      };
    });
    setOpcConfiguringTags(configuring);
    setOpcBrowserStep(2);
  };

  const handleUpdateConfiguringTag = (index: number, key: string, value: any) => {
    setOpcConfiguringTags(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const handleSaveOpcTags = async () => {
    let successes = 0;
    let failures = 0;
    setOpcBrowserLoading(true);

    try {
      for (const tag of opcConfiguringTags) {
        const payload = {
          id: "",
          adapterId: newDpAdapterId,
          dataSourceId: "",
          metric: tag.tagName,
          dataType: tag.dataType,
          scanIntervalMs: Number(tag.scanIntervalMs),
          scaleFactor: 1.0,
          offset: 0.0,
          isEnabled: true,
          byteOrder: "ABCD",
          description: tag.description || "",
          mqttParseMode: "Plaintext",
          mqttJsonPath: null,
          address: tag.nodeId
        };

        const res = await fetch('/api/datapoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          successes++;
        } else {
          failures++;
        }
      }

      if (successes > 0) {
        toast.success(`Successfully created ${successes} OPC UA tags.`);
      }
      if (failures > 0) {
        toast.error(`Failed to create ${failures} tags.`);
      }

      setIsOpcBrowserOpen(false);
      setIsCreateTagOpen(false);
      await fetchData();
    } catch (err: any) {
      toast.error('An error occurred while saving tags: ' + err.message);
    } finally {
      setOpcBrowserLoading(false);
    }
  };

  const [editDpAdapterId, setEditDpAdapterId] = useState('');
  const [editDpAddress, setEditDpAddress] = useState('');
  const [editDpDataType, setEditDpDataType] = useState('Float');
  const [editDpScanIntervalMs, setEditDpScanIntervalMs] = useState(1000);
  const [editDpScaleFactor, setEditDpScaleFactor] = useState<string>('1.0');
  const [editDpOffset, setEditDpOffset] = useState<string>('0.0');
  const [editDpByteOrder, setEditDpByteOrder] = useState('ABCD');
  const [editDpIsEnabled, setEditDpIsEnabled] = useState(true);
  const [editDpDescription, setEditDpDescription] = useState('');
  const [editDpMqttParseMode, setEditDpMqttParseMode] = useState('Plaintext');
  const [editDpMqttJsonPath, setEditDpMqttJsonPath] = useState('');

  const handleStartEdit = (dp: DataPoint) => {
    setEditingPhysicalTag(dp);
    setEditDpAdapterId(dp.adapterId);
    setEditDpAddress(dp.address);
    setEditDpDataType(dp.dataType);
    setEditDpScanIntervalMs(dp.scanIntervalMs);
    setEditDpScaleFactor(String(dp.scaleFactor));
    setEditDpOffset(String(dp.offset));
    setEditDpByteOrder(dp.byteOrder || (dp.dataType === 'Int16' || dp.dataType === 'UInt16' ? 'AB' : 'ABCD'));
    setEditDpIsEnabled(dp.isEnabled);
    setEditDpDescription(dp.description || '');
    setEditDpMqttParseMode(dp.mqttParseMode || 'Plaintext');
    setEditDpMqttJsonPath(dp.mqttJsonPath || '');
  };

  const handleCreateAdapterChange = (adapterId: string) => {
    setNewDpAdapterId(adapterId);
    const selected = adapters.find(a => a.id === adapterId);
    if (selected?.protocol !== 'MODBUS_TCP') {
      setNewDpByteOrder('ABCD');
    } else {
      setNewDpByteOrder(newDpDataType === 'Int16' || newDpDataType === 'UInt16' ? 'AB' : 'ABCD');
    }
  };

  // ─── Modbus bulk-add helpers ────────────────────────────────────────────────
  const getModbusWordCount = (dataType: string): number => {
    switch (dataType) {
      case 'Int16': case 'UInt16': case 'Boolean': return 1;
      case 'Int32': case 'UInt32': case 'Float':   return 2;
      case 'Double': case 'Int64': case 'UInt64':  return 4;
      default: return 1;
    }
  };

  /** Increments the numeric portion of a Modbus address by wordOffset words. */
  const incrementModbusAddress = (base: string, wordOffset: number): string => {
    const trimmed = base.trim();
    // Pure integer (e.g. "0", "40001")
    if (/^\d+$/.test(trimmed)) {
      return String(parseInt(trimmed, 10) + wordOffset);
    }
    // Prefix+number (e.g. HR0, IR100, C5, DI3)
    const m = trimmed.match(/^([A-Za-z]+)(\d+)$/i);
    if (m) return m[1] + String(parseInt(m[2], 10) + wordOffset);
    return base; // unparseable — return as-is
  };

  const handleCreateDataTypeChange = (dataType: string) => {
    setNewDpDataType(dataType);
    if (dataType === 'Int16' || dataType === 'UInt16') {
      setNewDpByteOrder('AB');
    } else {
      setNewDpByteOrder('ABCD');
    }
  };

  const handleEditAdapterChange = (adapterId: string) => {
    setEditDpAdapterId(adapterId);
    const selected = adapters.find(a => a.id === adapterId);
    if (selected?.protocol !== 'MODBUS_TCP') {
      setEditDpByteOrder('ABCD');
    } else {
      setEditDpByteOrder(editDpDataType === 'Int16' || editDpDataType === 'UInt16' ? 'AB' : 'ABCD');
    }
  };

  const handleEditDataTypeChange = (dataType: string) => {
    setEditDpDataType(dataType);
    if (dataType === 'Int16' || dataType === 'UInt16') {
      setEditDpByteOrder('AB');
    } else {
      setEditDpByteOrder('ABCD');
    }
  };

  const handleCreatePhysicalTag = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newDpAdapterId || !newDpAddress) {
      toast.warning('Please fill in all required fields.');
      return;
    }

    const isModbus = adapters.find(a => a.id === newDpAdapterId)?.protocol === 'MODBUS_TCP';
    const count    = isModbus ? Math.max(1, Math.min(125, newDpCount)) : 1;
    const wordStep = getModbusWordCount(newDpDataType);

    const parsedScale  = parseFloat(newDpScaleFactor);
    const parsedOffset = parseFloat(newDpOffset);
    const basePayload = {
      id: "",
      adapterId: newDpAdapterId,
      dataSourceId: "",
      metric: "",
      dataType: newDpDataType,
      scanIntervalMs: Number(newDpScanIntervalMs),
      scaleFactor: isNaN(parsedScale)  ? 1.0 : parsedScale,
      offset:      isNaN(parsedOffset) ? 0.0 : parsedOffset,
      isEnabled:   true,
      byteOrder:   newDpByteOrder,
      description: newDpDescription,
      mqttParseMode: newDpMqttParseMode,
      mqttJsonPath: newDpMqttParseMode === 'JSON' ? newDpMqttJsonPath : null,
    };

    let successes = 0;
    let failures  = 0;

    try {
      for (let i = 0; i < count; i++) {
        const address = i === 0
          ? newDpAddress
          : incrementModbusAddress(newDpAddress, i * wordStep);

        const res = await fetch('/api/datapoints', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...basePayload, address }),
        });
        if (res.ok) successes++; else failures++;
      }

      setNewDpAddress('');
      setNewDpDescription('');
      setNewDpCount(1);
      setNewDpMqttParseMode('Plaintext');
      setNewDpMqttJsonPath('');
      setIsCreateTagOpen(false);
      fetchData();

      if (count === 1) {
        if (successes) toast.success('Physical tag registered successfully.');
        else           toast.error('Failed to register physical tag.');
      } else {
        const msg = `Bulk registration: ${successes} tag(s) created${failures ? `, ${failures} failed` : ''}.`;
        if (failures) toast.warning(msg); else toast.success(msg);
      }
    } catch (err) {
      console.error('Failed to create physical tag:', err);
      toast.error('Failed to create physical tag.');
    }
  };

  const [lastClickedTagId, setLastClickedTagId] = useState<string | null>(null);

  const toggleSelectTag = (id: string, e?: React.MouseEvent) => {
    setSelectedTagIds(prev => {
      const isChecking = !prev[id];
      const updated = { ...prev, [id]: isChecking };

      if (e?.shiftKey && lastClickedTagId) {
        const indexCurrent = filteredDatapoints.findIndex(dp => dp.id === id);
        const indexLast = filteredDatapoints.findIndex(dp => dp.id === lastClickedTagId);

        if (indexCurrent !== -1 && indexLast !== -1) {
          const start = Math.min(indexCurrent, indexLast);
          const end = Math.max(indexCurrent, indexLast);

          for (let i = start; i <= end; i++) {
            const tagId = filteredDatapoints[i].id;
            if (isChecking) {
              updated[tagId] = true;
            } else {
              delete updated[tagId];
            }
          }
        }
      }

      setLastClickedTagId(id);
      return updated;
    });
  };

  const toggleSelectAllGroup = (tags: DataPoint[]) => {
    const groupIds = tags.map(t => t.id);
    const allSelected = groupIds.every(id => selectedTagIds[id]);
    
    setSelectedTagIds(prev => {
      const updated = { ...prev };
      groupIds.forEach(id => {
        if (allSelected) {
          delete updated[id];
        } else {
          updated[id] = true;
        }
      });
      return updated;
    });
  };

  const handleBulkDelete = async () => {
    const selectedIds = Object.keys(selectedTagIds).filter(id => selectedTagIds[id]);
    if (selectedIds.length === 0) return;

    try {
      const promises = selectedIds.map(id =>
        fetch(`/api/datapoints/hard/${id}`, { method: 'DELETE' })
      );
      
      const results = await Promise.all(promises);
      const successes = results.filter(r => r.ok).length;
      
      if (successes === selectedIds.length) {
        toast.success(`Successfully deleted ${successes} physical tags.`);
      } else {
        toast.warning(`Deleted ${successes} of ${selectedIds.length} physical tags. Some failed.`);
      }
      
      setSelectedTagIds({});
      setIsBulkDeleteOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to perform bulk deletion:', err);
      toast.error('Error during bulk deletion.');
    }
  };

  const handleEditPhysicalTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPhysicalTag) return;
    if (!editDpAdapterId || !editDpAddress) {
      toast.warning('Please fill in all required fields.');
      return;
    }

    try {
      const parsedScale = parseFloat(editDpScaleFactor);
      const parsedOffset = parseFloat(editDpOffset);
      const payload = {
        id: editingPhysicalTag.id,
        adapterId: editDpAdapterId,
        dataSourceId: editingPhysicalTag.dataSourceId || "",
        metric: editingPhysicalTag.metric || "",
        address: editDpAddress,
        dataType: editDpDataType,
        scanIntervalMs: Number(editDpScanIntervalMs),
        scaleFactor: isNaN(parsedScale) ? 1.0 : parsedScale,
        offset: isNaN(parsedOffset) ? 0.0 : parsedOffset,
        isEnabled: editDpIsEnabled,
        byteOrder: editDpByteOrder,
        description: editDpDescription,
        mqttParseMode: editDpMqttParseMode,
        mqttJsonPath: editDpMqttParseMode === 'JSON' ? editDpMqttJsonPath : null,
      };

      const res = await fetch('/api/datapoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setEditingPhysicalTag(null);
        toast.success('Physical tag updated successfully.');
        fetchData();
      } else {
        toast.error('Failed to update physical tag.');
      }
    } catch (err) {
      console.error('Failed to update physical tag:', err);
      toast.error('Failed to update physical tag.');
    }
  };

  const handleHardDeleteDataPoint = async (id: string) => {
    try {
      const res = await fetch(`/api/datapoints/hard/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setDeletingPhysicalTag(null);
        toast.success('Physical tag deleted.');
        fetchData();
      } else {
        toast.error('Failed to delete physical tag.');
      }
    } catch (err) {
      console.error('Failed to delete physical tag:', err);
      toast.error('Failed to delete physical tag.');
    }
  };

  const onUnbindTag = async (id: string) => {
    await handleDeleteDataPoint(id);
    fetchData();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Tag size={24} style={{ color: 'var(--primary-color)' }} />
            Physical Data Points & Tag Registry
          </h2>
          <p className="page-header-desc">
            Define and test physical sensor points (PLC registers, MQTT topics) before binding them to data streams. Verify connection health with live values.
          </p>
        </div>

        <div className="page-header-actions">
          <button 
            onClick={() => {
              if (adapters.length > 0) {
                const defaultAdp = adapters[0];
                setNewDpAdapterId(defaultAdp.id);
                setNewDpByteOrder(defaultAdp.protocol === 'MODBUS_TCP' ? 'AB' : 'ABCD');
              } else {
                setNewDpAdapterId('');
                setNewDpByteOrder('AB');
              }
              setNewDpAddress('');
              setNewDpDataType('Int16');
              setNewDpScanIntervalMs(1000);
              setNewDpScaleFactor('1.0');
              setNewDpOffset('0.0');
              setNewDpMqttParseMode('Plaintext');
              setNewDpMqttJsonPath('');
              setWizardStep(1);
              setIsCreateTagOpen(true);
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
            Create Physical Tag
          </button>
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
              placeholder="Search tags by address or metric..."
              value={tagSearchQuery}
              onChange={(e) => setTagSearchQuery(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '36px', height: '40px', backgroundColor: '#ffffff' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
          {['All', 'OPC UA', 'MQTT', 'Modbus TCP'].map((cat) => (
            <button
              key={cat}
              onClick={() => setTagProtocolFilter(cat)}
              style={{
                padding: '8px 16px',
                borderRadius: '20px',
                border: '1px solid',
                borderColor: tagProtocolFilter === cat ? 'transparent' : 'var(--border-color)',
                backgroundColor: tagProtocolFilter === cat ? 'var(--sidebar-bg)' : '#ffffff',
                color: tagProtocolFilter === cat ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {cat === 'All' ? 'All Protocols' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Accordion Controls & Summary */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 4px',
        fontSize: '13px',
        color: 'var(--text-secondary)',
        marginTop: '-8px',
        marginBottom: '4px'
      }}>
        <div>
          Found <strong style={{ color: 'var(--text-primary)' }}>{filteredDatapoints.length}</strong> matching physical tag{filteredDatapoints.length === 1 ? '' : 's'} (total: {datapoints.length})
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button 
            onClick={handleExpandAll}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary-dark)',
              cursor: 'pointer',
              fontWeight: 700,
              padding: 0,
              fontSize: '13px',
              fontFamily: 'var(--font-body)',
              transition: 'color 0.2s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--primary-dark)'}
          >
            Expand All
          </button>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <button 
            onClick={handleCollapseAll}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary-dark)',
              cursor: 'pointer',
              fontWeight: 700,
              padding: 0,
              fontSize: '13px',
              fontFamily: 'var(--font-body)',
              transition: 'color 0.2s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--primary-dark)'}
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* OPC UA Browser Modal (Glassmorphism + Responsive Split Layout) */}
      {isOpcBrowserOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 10, 10, 0.7)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1100
        }}>
          <div style={{
            width: '90%',
            maxWidth: '1100px',
            height: '80%',
            maxHeight: '750px',
            backgroundColor: 'rgba(23, 23, 27, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            color: '#fff'
          }}>
            {/* Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.02)'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f7fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--primary-color)' }}></span>
                  OPC UA Node Browser
                </h3>
                <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)' }}>
                  {adapters.find(a => a.id === newDpAdapterId)?.name} ({(adapters.find(a => a.id === newDpAdapterId)?.host)})
                </span>
              </div>
              <button 
                onClick={() => setIsOpcBrowserOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.4)',
                  cursor: 'pointer',
                  fontSize: '20px',
                  transition: 'color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'}
              >
                ✕
              </button>
            </div>

            {/* Content Area */}
            {opcBrowserStep === 1 ? (
              /* STEP 1: Tree selection */
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Left Pane: Hierarchical Node Tree */}
                <div style={{
                  flex: 1.2,
                  borderRight: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '20px',
                  overflowY: 'auto'
                }}>
                  <div style={{ marginBottom: '16px' }}>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.4)', fontWeight: 600 }}>Browse Path</span>
                    {/* Breadcrumbs */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '6px',
                      marginTop: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.05)'
                    }}>
                      {opcBrowserPath.map((item, idx) => (
                        <React.Fragment key={idx}>
                          {idx > 0 && <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>/</span>}
                          <span 
                            onClick={() => handleOpcBreadcrumbClick(idx)}
                            style={{
                              cursor: 'pointer',
                              color: idx === opcBrowserPath.length - 1 ? 'var(--primary-color)' : 'rgba(255, 255, 255, 0.7)',
                              fontWeight: idx === opcBrowserPath.length - 1 ? 700 : 500,
                              fontSize: '13px',
                              transition: 'color 0.2s'
                            }}
                            onMouseEnter={(e) => { if (idx !== opcBrowserPath.length - 1) e.currentTarget.style.color = '#fff'; }}
                            onMouseLeave={(e) => { if (idx !== opcBrowserPath.length - 1) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'; }}
                          >
                            {item.displayName}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  {opcBrowserLoading && opcBrowserNodes.length === 0 ? (
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '12px' }}>
                      <div className="spinner" style={{ border: '2px solid rgba(255, 255, 255, 0.1)', borderTop: '2px solid var(--primary-color)', width: '32px', height: '32px', borderRadius: '50%' }}></div>
                      <span style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)' }}>Connecting and browsing address space...</span>
                    </div>
                  ) : opcBrowserError ? (
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '12px', padding: '24px', textAlign: 'center' }}>
                      <AlertTriangle color="#f56565" size={32} />
                      <span style={{ fontSize: '14px', color: '#f56565', fontWeight: 600 }}>Browse Failed</span>
                      <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)', maxWidth: '400px' }}>{opcBrowserError}</span>
                      <button 
                        className="btn btn-secondary" 
                        onClick={() => fetchOpcNodes(newDpAdapterId, opcBrowserPath[opcBrowserPath.length - 1].nodeId)}
                        style={{ marginTop: '8px' }}
                      >
                        Try Again
                      </button>
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.4)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Available Nodes</span>
                      {opcBrowserNodes.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)', fontSize: '13px' }}>
                          This folder is empty or contains no browsable Objects or Variables.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {opcBrowserNodes.map((node) => {
                            const isSelected = !!opcSelectedNodes[node.nodeId];
                            const isFolder = node.nodeClass === 'Object';

                            return (
                              <div 
                                key={node.nodeId}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '8px 12px',
                                  borderRadius: '8px',
                                  backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                                  border: isSelected ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid transparent',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                  gap: '12px'
                                }}
                                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'; }}
                                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                onClick={() => {
                                  if (!isFolder) {
                                    handleToggleOpcNode(node);
                                  }
                                }}
                              >
                                {/* Selection Checkbox / Icon */}
                                {isFolder ? (
                                  <div style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    📂
                                  </div>
                                ) : (
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleOpcNode(node)}
                                    style={{
                                      width: '16px',
                                      height: '16px',
                                      accentColor: 'var(--primary-color)',
                                      cursor: 'pointer'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                )}

                                {/* Node Details */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '13px', fontWeight: 600, color: isFolder ? '#fff' : '#cbd5e0', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                    {node.displayName}
                                  </div>
                                  <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'var(--font-mono)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                    {node.nodeId}
                                  </div>
                                </div>

                                {/* Folder Navigation / Type Pill */}
                                {isFolder ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEnterOpcFolder(node);
                                    }}
                                    style={{
                                      padding: '4px 10px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                      border: 'none',
                                      borderRadius: '4px',
                                      color: '#fff',
                                      cursor: 'pointer',
                                      transition: 'background-color 0.2s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
                                  >
                                    Open →
                                  </button>
                                ) : (
                                  node.dataType && (
                                    <span style={{
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                                      color: 'rgba(255, 255, 255, 0.6)',
                                      fontSize: '10px',
                                      fontWeight: 600,
                                      textTransform: 'uppercase'
                                    }}>
                                      {node.dataType}
                                    </span>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Pane: Selected Nodes List */}
                <div style={{
                  flex: 0.8,
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: 'rgba(0, 0, 0, 0.15)',
                  overflowY: 'auto'
                }}>
                  <div style={{ display: 'flex', justifySelf: 'space-between', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.4)', fontWeight: 600 }}>Selected Nodes ({Object.keys(opcSelectedNodes).length})</span>
                    {Object.keys(opcSelectedNodes).length > 0 && (
                      <button 
                        onClick={() => setOpcSelectedNodes({})}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#e53e3e',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {Object.keys(opcSelectedNodes).length === 0 ? (
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', color: 'rgba(255, 255, 255, 0.3)', padding: '24px', textAlign: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '24px' }}>📋</span>
                      <span style={{ fontSize: '12px' }}>Select variable nodes from the tree on the left to add them as tags.</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {Object.values(opcSelectedNodes).map((node) => (
                        <div 
                          key={node.nodeId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255, 255, 255, 0.05)'
                          }}
                        >
                          <div style={{ minWidth: 0, paddingRight: '12px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{node.displayName}</div>
                            <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'var(--font-mono)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{node.nodeId}</div>
                          </div>
                          <button
                            onClick={() => handleToggleOpcNode(node)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'rgba(255, 255, 255, 0.3)',
                              cursor: 'pointer',
                              fontSize: '12px',
                              padding: '4px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.color = '#e53e3e'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.3)'}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* STEP 2: Configure tags */
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', padding: '24px' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.4)', fontWeight: 600, marginBottom: '12px', display: 'block' }}>Step 2: Configure Tag Parameters</span>
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', backgroundColor: 'rgba(0, 0, 0, 0.1)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(255, 255, 255, 0.02)' }}>
                        <th style={{ padding: '12px 16px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600 }}>Node Display Name</th>
                        <th style={{ padding: '12px 16px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600 }}>Tag Name</th>
                        <th style={{ padding: '12px 16px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600 }}>Data Type</th>
                        <th style={{ padding: '12px 16px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600 }}>Scan Rate (ms)</th>
                        <th style={{ padding: '12px 16px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600 }}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opcConfiguringTags.map((tag, idx) => (
                        <tr key={tag.nodeId} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', backgroundColor: idx % 2 === 0 ? 'rgba(255, 255, 255, 0.01)' : 'transparent' }}>
                          <td style={{ padding: '12px 16px', maxWidth: '200px' }}>
                            <div style={{ fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{tag.displayName}</div>
                            <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'var(--font-mono)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{tag.nodeId}</div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <input 
                              type="text"
                              value={tag.tagName}
                              onChange={(e) => handleUpdateConfiguringTag(idx, 'tagName', e.target.value)}
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                color: '#fff',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                width: '100%',
                                outline: 'none'
                              }}
                            />
                          </td>
                          <td style={{ padding: '12px 16px', width: '140px' }}>
                            <CustomSelect 
                              value={tag.dataType}
                              onChange={(val) => handleUpdateConfiguringTag(idx, 'dataType', val)}
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                color: '#fff'
                              }}
                              options={[
                                { value: 'Int16', label: 'Int16' },
                                { value: 'UInt16', label: 'UInt16' },
                                { value: 'Int32', label: 'Int32' },
                                { value: 'UInt32', label: 'UInt32' },
                                { value: 'Float', label: 'Float' },
                                { value: 'Double', label: 'Double' },
                                { value: 'Int64', label: 'Int64' },
                                { value: 'UInt64', label: 'UInt64' },
                                { value: 'Boolean', label: 'Boolean' },
                                { value: 'String', label: 'String' }
                              ]}
                            />
                          </td>
                          <td style={{ padding: '12px 16px', width: '110px' }}>
                            <input 
                              type="number"
                              min={10}
                              value={tag.scanIntervalMs}
                              onChange={(e) => handleUpdateConfiguringTag(idx, 'scanIntervalMs', parseInt(e.target.value, 10) || 1000)}
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                color: '#fff',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                width: '100%',
                                outline: 'none'
                              }}
                            />
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <input 
                              type="text"
                              value={tag.description}
                              onChange={(e) => handleUpdateConfiguringTag(idx, 'description', e.target.value)}
                              placeholder="Optional description"
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                color: '#fff',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                width: '100%',
                                outline: 'none'
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer Buttons */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.02)'
            }}>
              {opcBrowserStep === 1 ? (
                <>
                  <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)' }}>
                    {Object.keys(opcSelectedNodes).length} nodes selected
                  </span>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      onClick={() => setIsOpcBrowserOpen(false)}
                      style={{
                        backgroundColor: 'transparent',
                        color: 'rgba(255, 255, 255, 0.7)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        padding: '10px 18px',
                        borderRadius: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleOpcNextStep}
                      disabled={Object.keys(opcSelectedNodes).length === 0}
                      style={{
                        backgroundColor: Object.keys(opcSelectedNodes).length === 0 ? 'rgba(255, 255, 255, 0.1)' : 'var(--primary-color)',
                        color: Object.keys(opcSelectedNodes).length === 0 ? 'rgba(255, 255, 255, 0.3)' : 'var(--sidebar-bg)',
                        border: 'none',
                        padding: '10px 18px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        cursor: Object.keys(opcSelectedNodes).length === 0 ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Next Step →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setOpcBrowserStep(1)}
                    disabled={opcBrowserLoading}
                    style={{
                      backgroundColor: 'transparent',
                      color: 'rgba(255, 255, 255, 0.7)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      padding: '10px 18px',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: opcBrowserLoading ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => { if (!opcBrowserLoading) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'; }}
                    onMouseLeave={(e) => { if (!opcBrowserLoading) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    ← Back to Tree
                  </button>
                  <button
                    onClick={handleSaveOpcTags}
                    disabled={opcBrowserLoading}
                    style={{
                      backgroundColor: 'var(--primary-color)',
                      color: 'var(--sidebar-bg)',
                      border: 'none',
                      padding: '10px 24px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      cursor: opcBrowserLoading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    {opcBrowserLoading ? (
                      <>
                        Saving Tags...
                      </>
                    ) : (
                      'Save & Add Tags'
                    )}
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {Object.values(selectedTagIds).filter(Boolean).length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'rgba(229, 62, 62, 0.05)',
          border: '1px solid rgba(229, 62, 62, 0.2)',
          padding: '12px 24px',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(229, 62, 62, 0.03)',
          marginBottom: '4px'
        }}>
          <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
            Selected <strong style={{ color: 'var(--danger-color)' }}>{Object.values(selectedTagIds).filter(Boolean).length}</strong> tag(s) for actions
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setIsBulkDeleteOpen(true)}
              style={{
                backgroundColor: 'var(--danger-color)',
                color: '#ffffff',
                border: 'none',
                padding: '8px 18px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <Trash2 size={14} /> Delete Selected
            </button>
            <button
              type="button"
              onClick={() => setSelectedTagIds({})}
              style={{
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                padding: '8px 18px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Physical Tags Collapsible Accordions Grouped by Driver */}
      {filteredDatapoints.length === 0 ? (
        <div className="panel" style={{
          padding: '60px 40px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          backgroundColor: 'rgba(255, 255, 255, 0.5)',
          borderStyle: 'dashed',
          borderWidth: '2px',
          borderRadius: '12px'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏷️</div>
          <h4 style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text-primary)' }}>No Physical Tags Found</h4>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Try clearing filters or click "Create Physical Tag" to add a new sensor tag.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Render group for each adapter */}
          {adapters.map(adapter => {
            const adapterTags = filteredDatapoints.filter(dp => dp.adapterId === adapter.id);
            const hasMatchingTags = adapterTags.length > 0;
            const abnormalCount = adapterTags.filter(dp => !!dp.lastError).length;
            
            // Hide if search is active and this group has no matches
            if (isSearchActive && !hasMatchingTags) return null;
            
            const expanded = isGroupExpanded(adapter.id, hasMatchingTags);
            const visibleLimit = getVisibleCount(adapter.id);
            const visibleTags = adapterTags.slice(0, visibleLimit);
            
            return (
              <div key={adapter.id} className="panel" style={{ 
                padding: 0, 
                overflow: 'hidden', 
                marginBottom: 0,
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)',
                border: '1px solid var(--border-color)',
                backgroundColor: '#ffffff'
              }}>
                {/* Accordion Header */}
                <button 
                  onClick={() => toggleGroup(adapter.id, hasMatchingTags)}
                  style={{
                    width: '100%',
                    padding: '16px 24px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    backgroundColor: expanded ? 'rgba(60, 232, 189, 0.03)' : 'transparent',
                    borderBottom: expanded ? '1px solid var(--border-color)' : 'none',
                    transition: 'background-color 0.2s ease',
                    outline: 'none'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = expanded ? 'rgba(60, 232, 189, 0.05)' : 'rgba(0,0,0,0.01)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = expanded ? 'rgba(60, 232, 189, 0.03)' : 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 700 }}>{adapter.name}</strong>
                        <span className="badge info" style={{ fontSize: '9px', padding: '2px 8px', letterSpacing: '0.5px' }}>
                          {adapter.protocol.replace('_', ' ')}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ 
                            width: '8px', 
                            height: '8px', 
                            borderRadius: '50%', 
                            backgroundColor: adapter.status === 'Connected' ? 'var(--success-color)' : adapter.status === 'Offline' ? 'var(--text-secondary)' : 'var(--danger-color)',
                            display: 'inline-block'
                          }} />
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                            {adapter.status}
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                        {adapter.host}:{adapter.port}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {abnormalCount > 0 && (
                      <span className="badge danger" style={{ 
                        backgroundColor: 'rgba(229, 62, 62, 0.1)', 
                        color: 'var(--danger-color)', 
                        fontSize: '11px', 
                        padding: '4px 10px', 
                        borderRadius: '12px',
                        fontWeight: 600,
                        border: '1px solid rgba(229, 62, 62, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        ⚠️ {abnormalCount} Abnormal
                      </span>
                    )}
                    <span className="badge" style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '11px', padding: '4px 10px', borderRadius: '12px' }}>
                      {adapterTags.length} tag{adapterTags.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>

                {/* Accordion Body */}
                {expanded && (
                  <div style={{ padding: '0 0 8px 0', overflowX: 'auto' }}>
                    {adapterTags.length === 0 ? (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic' }}>
                        No physical tags registered under this driver adapter.
                      </div>
                    ) : (
                      <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', margin: 0 }}>
                        <thead>
                          <tr style={{ backgroundColor: '#fcfdff' }}>
                            <th style={{ width: '40px', padding: '12px 16px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={adapterTags.length > 0 && adapterTags.every(t => selectedTagIds[t.id])}
                                onChange={() => toggleSelectAllGroup(adapterTags)}
                                style={{ cursor: 'pointer' }}
                              />
                            </th>
                            <th style={{ width: '40px', padding: '12px 16px', textAlign: 'center' }}></th>
                            <th style={{ width: '60px', padding: '12px 16px', textAlign: 'center' }}>Status</th>
                            <th style={{ padding: '12px 16px' }}>Tag Address / Register</th>
                            <th style={{ padding: '12px 16px', width: '120px' }}>Data Type</th>
                            <th style={{ padding: '12px 16px', width: '120px' }}>Scan Rate</th>
                            <th style={{ padding: '12px 16px' }}>Live Value</th>
                            <th style={{ padding: '12px 16px' }}>Mapping</th>
                            <th style={{ padding: '12px 16px', width: '130px', textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleTags.map(dp => {
                            const isMapped = dp.dataSourceId && dp.dataSourceId !== "";
                            const detailsExpanded = !!expandedTags[dp.id];
                            
                            return (
                              <React.Fragment key={dp.id}>
                                <tr 
                                  style={{ 
                                    cursor: 'pointer',
                                    transition: 'background-color 0.15s ease',
                                    backgroundColor: selectedTagIds[dp.id]
                                      ? 'rgba(60, 232, 189, 0.05)'
                                      : (detailsExpanded ? 'rgba(60, 232, 189, 0.02)' : 'transparent')
                                  }}
                                  onClick={() => toggleTagDetails(dp.id)}
                                >
                                  <td style={{ textAlign: 'center', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={!!selectedTagIds[dp.id]}
                                      onClick={(e) => toggleSelectTag(dp.id, e)}
                                      onChange={() => {}}
                                      style={{ cursor: 'pointer' }}
                                    />
                                  </td>
                                  <td style={{ textAlign: 'center', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                    <button
                                      onClick={() => toggleTagDetails(dp.id)}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--text-secondary)'
                                      }}
                                    >
                                      {detailsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </button>
                                  </td>
                                  <td style={{ textAlign: 'center', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                    <span style={{ 
                                      width: '10px', 
                                      height: '10px', 
                                      borderRadius: '50%', 
                                      backgroundColor: dp.consecutiveFailures && dp.consecutiveFailures > 0 ? '#d97706' : (dp.lastError ? 'var(--danger-color)' : (dp.lastValue !== null && dp.lastValue !== undefined ? 'var(--success-color)' : 'var(--warning-color)')),
                                      display: 'inline-block',
                                      verticalAlign: 'middle',
                                      animation: dp.consecutiveFailures && dp.consecutiveFailures > 0 ? 'pulse-warn 2s infinite' : 'none'
                                    }} title={dp.lastError ? `Read Error (Consecutive Failures: ${dp.consecutiveFailures || 0}): ${dp.lastError}` : (dp.lastValue !== null && dp.lastValue !== undefined ? `Healthy: ${dp.lastValue}` : 'Connecting...')} />
                                  </td>
                                  <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-primary)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      <span>{dp.address}</span>
                                      {adapter.protocol === 'MQTT' && (
                                        <span className="badge" style={{ 
                                          fontSize: '9px', 
                                          padding: '1px 6px', 
                                          backgroundColor: dp.mqttParseMode === 'JSON' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                                          color: dp.mqttParseMode === 'JSON' ? 'rgb(99, 102, 241)' : 'var(--text-secondary)',
                                          fontWeight: 600,
                                          textTransform: 'none'
                                        }}>
                                          {dp.mqttParseMode === 'JSON' ? `JSON: ${dp.mqttJsonPath}` : 'Plaintext'}
                                        </span>
                                      )}
                                    </div>
                                    {dp.description && (
                                      <div style={{ fontWeight: 400, fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', wordBreak: 'break-word', whiteSpace: 'normal', maxWidth: '300px' }}>
                                        {dp.description}
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    <span className="badge" style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-secondary)', textTransform: 'none', fontSize: '11px', fontWeight: 600 }}>
                                      {dp.dataType}
                                    </span>
                                  </td>
                                  <td>{dp.scanIntervalMs}ms</td>
                                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700 }}>
                                    {dp.lastError ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        <span style={{ color: 'var(--danger-color)', fontSize: '12px' }}>Read Error</span>
                                        {dp.consecutiveFailures && dp.consecutiveFailures > 0 ? (
                                          <span style={{ 
                                            fontSize: '9px', 
                                            color: '#d97706', 
                                            fontWeight: 600, 
                                            backgroundColor: 'rgba(217, 119, 6, 0.08)', 
                                            padding: '2px 5px', 
                                            borderRadius: '4px',
                                            width: 'max-content',
                                            border: '1px solid rgba(217, 119, 6, 0.15)'
                                          }}>
                                            Retry #{Math.min(3, dp.consecutiveFailures)} / Backoff {Math.min(64, Math.pow(2, Math.min(dp.consecutiveFailures, 6)))}x
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : dp.lastValue !== null && dp.lastValue !== undefined ? (
                                      <span style={{ color: '#2f855a' }}>{formatLiveValue(dp.lastValue, dp.dataType)}</span>
                                    ) : (
                                      <span style={{ color: 'var(--text-secondary)', fontSize: '12px', fontStyle: 'italic' }}>Connecting...</span>
                                    )}
                                  </td>
                                  <td>
                                    {isMapped ? (
                                      <span className="badge success" style={{ fontSize: '10px', padding: '3px 8px', textTransform: 'none' }}>
                                        {dp.dataSourceId} ({dp.metric})
                                      </span>
                                    ) : (
                                      <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '12px' }}>
                                        Diagnostics Only
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                      <button 
                                        onClick={() => handleStartEdit(dp)}
                                        title="Edit Tag Configuration"
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
                                          e.currentTarget.style.color = 'var(--primary-color)';
                                          e.currentTarget.style.backgroundColor = 'rgba(60, 232, 189, 0.1)';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.color = 'var(--text-secondary)';
                                          e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                      >
                                        <Edit size={14} />
                                      </button>
                                      <button 
                                        onClick={() => setDeletingPhysicalTag(dp)}
                                        title="Delete Tag Configuration"
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
                                      {isMapped && (
                                        <button 
                                          onClick={() => onUnbindTag(dp.id)}
                                          title="Unbind Tag from Data Stream"
                                          style={{
                                            border: 'none',
                                            backgroundColor: 'transparent',
                                            color: '#e53e3e',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: '11px',
                                            padding: '4px 8px',
                                            borderRadius: '4px'
                                          }}
                                          onMouseEnter={e => {
                                            e.currentTarget.style.backgroundColor = '#fef2f2';
                                          }}
                                          onMouseLeave={e => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                          }}
                                        >
                                          Unbind
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                
                                {detailsExpanded && (
                                  <tr style={{ backgroundColor: '#fafbfd' }}>
                                    <td colSpan={9} style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                                        <div style={{ gridColumn: '1 / -1', borderBottom: '1px dashed var(--border-color)', paddingBottom: '12px', marginBottom: '4px' }}>
                                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.5px' }}>
                                            Description
                                          </div>
                                          <div style={{ fontSize: '13px', color: dp.description ? 'var(--text-primary)' : 'var(--text-secondary)', fontStyle: dp.description ? 'normal' : 'italic', fontWeight: 500 }}>
                                            {dp.description || 'No description provided.'}
                                          </div>
                                        </div>
                                        <div>
                                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                            Scaling & Math
                                          </div>
                                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Scale Factor: <span style={{ fontFamily: 'var(--font-mono)' }}>x{dp.scaleFactor}</span></div>
                                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>Offset: <span style={{ fontFamily: 'var(--font-mono)' }}>+{dp.offset}</span></div>
                                        </div>
                                        {adapter.protocol === 'MODBUS_TCP' && (
                                          <div>
                                            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                              Endianness (Modbus Only)
                                            </div>
                                            <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                                              Byte Order: {dp.byteOrder || (dp.dataType === 'Int16' || dp.dataType === 'UInt16' ? 'AB' : 'ABCD')}
                                            </div>
                                          </div>
                                        )}
                                        <div>
                                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                            Diagnostics Metadata
                                          </div>
                                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>UUID: {dp.id}</div>
                                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            Last Evaluated: {dp.lastUpdated ? formatToLocalTimeString(dp.lastUpdated) : 'Never'}
                                          </div>
                                          {dp.consecutiveFailures !== undefined && dp.consecutiveFailures > 0 && (
                                            <div style={{ fontSize: '11px', color: '#d97706', fontWeight: 600, marginTop: '4px' }}>
                                              Consecutive Failures: {dp.consecutiveFailures} (Scan rate backed off to {Math.min(64, Math.pow(2, Math.min(dp.consecutiveFailures, 6)))}x)
                                            </div>
                                          )}
                                        </div>
                                        {dp.lastError && (
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#e53e3e', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                              Trace Error Log
                                            </div>
                                            <div style={{
                                              color: '#e53e3e',
                                              fontSize: '12px',
                                              fontFamily: 'var(--font-mono)',
                                              padding: '12px 16px',
                                              backgroundColor: '#fff5f5',
                                              borderRadius: '8px',
                                              border: '1px solid #fed7d7',
                                              wordBreak: 'break-all',
                                              whiteSpace: 'pre-wrap',
                                              lineHeight: '1.4'
                                            }}>
                                              {dp.lastError}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                          
                          {/* Show More Pagination Trigger */}
                          {adapterTags.length > visibleLimit && (
                            <tr>
                              <td colSpan={9} style={{ padding: '16px', textAlign: 'center', backgroundColor: '#fcfdff' }}>
                                <button
                                  onClick={() => handleShowMore(adapter.id, adapterTags.length)}
                                  style={{
                                    backgroundColor: 'transparent',
                                    color: 'var(--primary-dark)',
                                    border: '1px solid var(--primary-dark)',
                                    padding: '6px 16px',
                                    borderRadius: '20px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    fontFamily: 'var(--font-body)'
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.backgroundColor = 'var(--primary-glow)';
                                    e.currentTarget.style.color = 'var(--primary-dark)';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                  }}
                                >
                                  Show More (+{adapterTags.length - visibleLimit} tags)
                                </button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Render group for Orphaned / Unassigned Tags */}
          {(() => {
            const orphanedTags = filteredDatapoints.filter(dp => !adapters.some(a => a.id === dp.adapterId));
            if (orphanedTags.length === 0) return null;
            
            const expanded = isGroupExpanded('orphans', true);
            const visibleLimit = getVisibleCount('orphans');
            const visibleTags = orphanedTags.slice(0, visibleLimit);
            
            return (
              <div className="panel" style={{ 
                padding: 0, 
                overflow: 'hidden', 
                marginBottom: 0,
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)',
                border: '1px solid #feb2b2',
                backgroundColor: '#fffaf0'
              }}>
                {/* Accordion Header */}
                <button 
                  onClick={() => toggleGroup('orphans', true)}
                  style={{
                    width: '100%',
                    padding: '16px 24px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    backgroundColor: expanded ? '#fff5f5' : 'transparent',
                    borderBottom: expanded ? '1px solid #feb2b2' : 'none',
                    transition: 'background-color 0.2s ease',
                    outline: 'none'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = expanded ? '#fed7d7' : '#fff5f5';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = expanded ? '#fff5f5' : 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e53e3e' }}>
                      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '15px', color: '#c53030', fontWeight: 700 }}>Unassigned Driver / Orphaned Tags</strong>
                        <span className="badge warning" style={{ fontSize: '9px', padding: '2px 8px', letterSpacing: '0.5px', backgroundColor: '#feebc8', color: '#744210' }}>
                          Missing Adapter
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#9b2c2c', marginTop: '4px' }}>
                        Tags associated with driver connections that have been deleted or are unassigned.
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="badge" style={{ backgroundColor: '#fed7d7', color: '#c53030', fontSize: '11px', padding: '4px 10px', borderRadius: '12px' }}>
                      {orphanedTags.length} tag{orphanedTags.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>

                {/* Accordion Body */}
                {expanded && (
                  <div style={{ padding: '0 0 8px 0', overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', margin: 0 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#fff5f5' }}>
                          <th style={{ width: '40px', padding: '12px 16px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={orphanedTags.length > 0 && orphanedTags.every(t => selectedTagIds[t.id])}
                              onChange={() => toggleSelectAllGroup(orphanedTags)}
                              style={{ cursor: 'pointer' }}
                            />
                          </th>
                          <th style={{ width: '40px', padding: '12px 16px', textAlign: 'center' }}></th>
                          <th style={{ width: '60px', padding: '12px 16px', textAlign: 'center' }}>Status</th>
                          <th style={{ padding: '12px 16px' }}>Tag Address / Register</th>
                          <th style={{ padding: '12px 16px', width: '120px' }}>Data Type</th>
                          <th style={{ padding: '12px 16px', width: '120px' }}>Scan Rate</th>
                          <th style={{ padding: '12px 16px' }}>Live Value</th>
                          <th style={{ padding: '12px 16px' }}>Mapping</th>
                          <th style={{ padding: '12px 16px', width: '130px', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTags.map(dp => {
                          const isMapped = dp.dataSourceId && dp.dataSourceId !== "";
                          const detailsExpanded = !!expandedTags[dp.id];
                          
                          return (
                            <React.Fragment key={dp.id}>
                              <tr 
                                style={{ 
                                  cursor: 'pointer',
                                  transition: 'background-color 0.15s ease',
                                  backgroundColor: selectedTagIds[dp.id] 
                                    ? 'rgba(229, 62, 62, 0.05)' 
                                    : (detailsExpanded ? 'rgba(229, 62, 62, 0.03)' : 'transparent')
                                }}
                                onClick={() => toggleTagDetails(dp.id)}
                              >
                                <td style={{ textAlign: 'center', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={!!selectedTagIds[dp.id]}
                                    onClick={(e) => toggleSelectTag(dp.id, e)}
                                    onChange={() => {}}
                                    style={{ cursor: 'pointer' }}
                                  />
                                </td>
                                <td style={{ textAlign: 'center', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                  <button
                                    onClick={() => toggleTagDetails(dp.id)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: '#e53e3e'
                                    }}
                                  >
                                    {detailsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  </button>
                                </td>
                                <td style={{ textAlign: 'center', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                  <span style={{ 
                                    width: '10px', 
                                    height: '10px', 
                                    borderRadius: '50%', 
                                    backgroundColor: 'var(--danger-color)',
                                    display: 'inline-block',
                                    verticalAlign: 'middle'
                                  }} title="Orphaned: No Active Adapter Connection" />
                                </td>
                                <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#c53030' }}>
                                  <div>{dp.address}</div>
                                  {dp.description && (
                                    <div style={{ fontWeight: 400, fontFamily: 'var(--font-body)', fontSize: '11px', color: '#c53030', marginTop: '2px', wordBreak: 'break-word', whiteSpace: 'normal', maxWidth: '300px' }}>
                                      {dp.description}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <span className="badge" style={{ backgroundColor: '#fed7d7', color: '#9b2c2c', textTransform: 'none', fontSize: '11px', fontWeight: 600 }}>
                                    {dp.dataType}
                                  </span>
                                </td>
                                <td>{dp.scanIntervalMs}ms</td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--danger-color)' }}>
                                  Offline (No Driver)
                                </td>
                                <td>
                                  {isMapped ? (
                                    <span className="badge success" style={{ fontSize: '10px', padding: '3px 8px', textTransform: 'none' }}>
                                      {dp.dataSourceId} ({dp.metric})
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '12px' }}>
                                      Unmapped
                                    </span>
                                  )}
                                </td>
                                <td style={{ textAlign: 'right', padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                    <button 
                                      onClick={() => handleStartEdit(dp)}
                                      title="Edit Tag Configuration"
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
                                        e.currentTarget.style.color = 'var(--primary-color)';
                                        e.currentTarget.style.backgroundColor = 'rgba(60, 232, 189, 0.1)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.color = 'var(--text-secondary)';
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                      }}
                                    >
                                      <Edit size={14} />
                                    </button>
                                    <button 
                                      onClick={() => setDeletingPhysicalTag(dp)}
                                      title="Delete Tag Configuration"
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
                                    {isMapped && (
                                      <button 
                                        onClick={() => onUnbindTag(dp.id)}
                                        title="Unbind Tag"
                                        style={{
                                          border: 'none',
                                          backgroundColor: 'transparent',
                                          color: '#e53e3e',
                                          cursor: 'pointer',
                                          fontWeight: 700,
                                          fontSize: '11px',
                                          padding: '4px 8px',
                                          borderRadius: '4px'
                                        }}
                                        onMouseEnter={e => {
                                          e.currentTarget.style.backgroundColor = '#fef2f2';
                                        }}
                                        onMouseLeave={e => {
                                          e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                      >
                                        Unbind
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              
                              {detailsExpanded && (
                                <tr style={{ backgroundColor: '#fff5f5' }}>
                                  <td colSpan={9} style={{ padding: '16px 24px', borderBottom: '1px solid #feb2b2' }} onClick={e => e.stopPropagation()}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                                      <div style={{ gridColumn: '1 / -1', borderBottom: '1px dashed #feb2b2', paddingBottom: '12px', marginBottom: '4px' }}>
                                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#e53e3e', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.5px' }}>
                                          Description
                                        </div>
                                        <div style={{ fontSize: '13px', color: dp.description ? 'var(--text-primary)' : 'var(--text-secondary)', fontStyle: dp.description ? 'normal' : 'italic', fontWeight: 500 }}>
                                          {dp.description || 'No description provided.'}
                                        </div>
                                      </div>
                                      <div>
                                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#e53e3e', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                          Scaling & Math
                                        </div>
                                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Scale Factor: <span style={{ fontFamily: 'var(--font-mono)' }}>x{dp.scaleFactor}</span></div>
                                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>Offset: <span style={{ fontFamily: 'var(--font-mono)' }}>+{dp.offset}</span></div>
                                      </div>
                                      <div>
                                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#e53e3e', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                          Diagnostics Metadata
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#c53030', fontFamily: 'var(--font-mono)' }}>UUID: {dp.id}</div>
                                        <div style={{ fontSize: '11px', color: '#c53030', marginTop: '4px' }}>
                                          Adapter ID: {dp.adapterId} (Deleted / Not Found)
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                        
                        {/* Show More Pagination Trigger */}
                        {orphanedTags.length > visibleLimit && (
                          <tr>
                            <td colSpan={9} style={{ padding: '16px', textAlign: 'center', backgroundColor: '#fff5f5' }}>
                              <button
                                onClick={() => handleShowMore('orphans', orphanedTags.length)}
                                style={{
                                  backgroundColor: 'transparent',
                                  color: '#e53e3e',
                                  border: '1px solid #e53e3e',
                                  padding: '6px 16px',
                                  borderRadius: '20px',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  fontFamily: 'var(--font-body)'
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.backgroundColor = '#fed7d7';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                              >
                                Show More (+{orphanedTags.length - visibleLimit} tags)
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* CREATE TAG MODAL */}
      {isCreateTagOpen && (
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
            width: '560px',
            maxWidth: '95%',
            padding: '32px 40px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            {(() => {
              const activeAdapter = adapters.find(a => a.id === newDpAdapterId);
              const protocol = activeAdapter?.protocol;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Wizard Header */}
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Register Sensor Tag Wizard
                    </h3>
                    <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {wizardStep === 1 && "Step 1: Identify the connection source and tag address details."}
                      {wizardStep === 2 && "Step 2: Define how the incoming raw binary data should be formatted."}
                      {wizardStep === 3 && "Step 3: Fine-tune polling frequency and scale raw analog readings."}
                    </p>
                  </div>

                  {/* Step Progress Bar */}
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    margin: '0 0 20px 0', 
                    gap: '8px',
                    borderBottom: '1px solid var(--border-color)',
                    paddingBottom: '20px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: wizardStep >= 1 ? 'var(--primary-color)' : 'var(--bg-color)',
                        color: wizardStep >= 1 ? 'var(--sidebar-bg)' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        border: wizardStep >= 1 ? 'none' : '1px solid var(--border-color)'
                      }}>1</span>
                      <span style={{ fontSize: '12px', fontWeight: wizardStep === 1 ? 700 : 500, color: wizardStep === 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Address</span>
                    </div>
                    
                    <div style={{ width: '40px', height: '1px', backgroundColor: 'var(--border-color)' }} />
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: wizardStep >= 2 ? 'var(--primary-color)' : 'var(--bg-color)',
                        color: wizardStep >= 2 ? 'var(--sidebar-bg)' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        border: wizardStep >= 2 ? 'none' : '1px solid var(--border-color)'
                      }}>2</span>
                      <span style={{ fontSize: '12px', fontWeight: wizardStep === 2 ? 700 : 500, color: wizardStep === 2 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Data Type</span>
                    </div>

                    {protocol !== 'MQTT' && (
                      <>
                        <div style={{ width: '40px', height: '1px', backgroundColor: 'var(--border-color)' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            backgroundColor: wizardStep >= 3 ? 'var(--primary-color)' : 'var(--bg-color)',
                            color: wizardStep >= 3 ? 'var(--sidebar-bg)' : 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '11px',
                            fontWeight: 700,
                            border: wizardStep >= 3 ? 'none' : '1px solid var(--border-color)'
                          }}>3</span>
                          <span style={{ fontSize: '12px', fontWeight: wizardStep === 3 ? 700 : 500, color: wizardStep === 3 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Scaling</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* STEP 1: Address and Connection */}
                  {wizardStep === 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 700 }}>Connection Driver Adapter</label>
                        {adapters.length === 0 ? (
                          <div style={{ color: 'var(--danger-color)', fontSize: '12px', padding: '10px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fed7d7' }}>
                            No protocol adapters configured. Please configure an adapter under the "Protocols" tab first.
                          </div>
                        ) : (
                          <CustomSelect 
                            value={newDpAdapterId}
                            onChange={handleCreateAdapterChange}
                            placeholder="-- Choose Driver Connection --"
                            options={adapters.map(a => ({
                              value: a.id,
                              label: `${a.name} (${a.protocol.replace('_', ' ')} @ ${a.host}:${a.port})`
                            }))}
                          />
                        )}
                      </div>

                      {newDpAdapterId && (
                        <>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>
                              {protocol === 'MODBUS_TCP' && "Modbus Register Address"}
                              {protocol === 'OPC_UA' && "OPC UA Node ID"}
                              {protocol === 'MQTT' && "MQTT Topic"}
                            </label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <input 
                                className="form-input" 
                                type="text" 
                                placeholder={
                                  protocol === 'MODBUS_TCP' ? "e.g. 40001 (Holding Register) or 30005 (Input Register)" :
                                  protocol === 'OPC_UA' ? "e.g. ns=2;s=Machine_Temperature" :
                                  "e.g. factory/casepacker/temperature"
                                }
                                value={newDpAddress}
                                onChange={(e) => setNewDpAddress(e.target.value)}
                                required
                                style={{ fontFamily: 'var(--font-mono)', flex: 1 }}
                              />
                              {protocol === 'OPC_UA' && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={handleOpenOpcBrowser}
                                  style={{
                                    whiteSpace: 'nowrap',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-primary)',
                                    fontWeight: 600,
                                    borderRadius: '8px',
                                    padding: '0 16px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Browse Server
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Modbus bulk-add: Count field + word-aligned address preview */}
                          {protocol === 'MODBUS_TCP' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px', alignItems: 'start' }}>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ fontWeight: 700 }}>Count <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>(1–125)</span></label>
                                <input
                                  className="form-input"
                                  type="number"
                                  min={1}
                                  max={125}
                                  value={newDpCount}
                                  onChange={(e) => setNewDpCount(Math.max(1, Math.min(125, parseInt(e.target.value, 10) || 1)))}
                                  style={{ fontFamily: 'var(--font-mono)' }}
                                />
                              </div>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ fontWeight: 700 }}>Address Preview</label>
                                <div style={{
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '8px',
                                  padding: '8px 12px',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '12px',
                                  color: 'var(--text-secondary)',
                                  minHeight: '40px',
                                  lineHeight: '1.6',
                                }}>
                                  {newDpCount <= 1
                                    ? <span style={{ color: 'var(--text-primary)' }}>{newDpAddress || '—'}</span>
                                    : (() => {
                                        const step = getModbusWordCount(newDpDataType);
                                        const preview = Array.from({ length: Math.min(newDpCount, 6) }, (_, i) =>
                                          i === 0 ? newDpAddress || '?' : incrementModbusAddress(newDpAddress || '0', i * step)
                                        );
                                        return (
                                          <span>
                                            {preview.join(', ')}{newDpCount > 6 ? ` … (+${newDpCount - 6} more)` : ''}
                                            <span style={{ marginLeft: '6px', color: 'var(--accent)', fontStyle: 'italic' }}>
                                              step +{step}w
                                            </span>
                                          </span>
                                        );
                                      })()
                                  }
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Tag Description</label>
                            <input 
                              className="form-input" 
                              type="text" 
                              placeholder="e.g. Main packer steam pressure sensor"
                              value={newDpDescription}
                              onChange={(e) => setNewDpDescription(e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* STEP 2: Data Representation */}
                  {wizardStep === 2 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 700 }}>Data Type</label>
                        {protocol === 'MODBUS_TCP' && (
                          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', fontStyle: 'italic' }}>
                            String data type is not supported on Modbus TCP
                          </div>
                        )}
                        <CustomSelect 
                          value={newDpDataType}
                          onChange={handleCreateDataTypeChange}
                          options={[
                            { value: 'Int16', label: 'Int16 (1 word / 16-bit)' },
                            { value: 'UInt16', label: 'UInt16 (1 word / 16-bit unsigned)' },
                            { value: 'Int32', label: 'Int32 (2 words / 32-bit)' },
                            { value: 'UInt32', label: 'UInt32 (2 words / 32-bit unsigned)' },
                            { value: 'Float', label: 'Float (2 words / 32-bit single-precision)' },
                            { value: 'Double', label: 'Double (4 words / 64-bit double-precision)' },
                            { value: 'Int64', label: 'Int64 (4 words / 64-bit)' },
                            { value: 'UInt64', label: 'UInt64 (4 words / 64-bit unsigned)' },
                            { value: 'Boolean', label: 'Boolean (1 word / bit state)' },
                            ...(protocol !== 'MODBUS_TCP' ? [{ value: 'String', label: 'String (UTF-8)' }] : [])
                          ]}
                        />
                      </div>

                      {protocol === 'MQTT' && (
                        <>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Parse Mode</label>
                            <CustomSelect 
                              value={newDpMqttParseMode}
                              onChange={setNewDpMqttParseMode}
                              options={[
                                { value: 'Plaintext', label: 'Plaintext Value' },
                                { value: 'JSON', label: 'JSON Parser' }
                              ]}
                            />
                          </div>
                          {newDpMqttParseMode === 'JSON' && (
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontWeight: 700 }}>JSON Path / Key</label>
                              <input 
                                className="form-input" 
                                type="text" 
                                placeholder="e.g. $.sensors.temperature or temperature"
                                value={newDpMqttJsonPath}
                                onChange={(e) => setNewDpMqttJsonPath(e.target.value)}
                                required
                                style={{ fontFamily: 'var(--font-mono)' }}
                              />
                            </div>
                          )}
                        </>
                      )}

                      {protocol === 'MODBUS_TCP' && (
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 700 }}>Byte Order / Endianness Swap</label>
                          <CustomSelect 
                            value={newDpByteOrder}
                            onChange={setNewDpByteOrder}
                            options={newDpDataType === 'Int16' || newDpDataType === 'UInt16' ? [
                              { value: 'AB', label: 'AB (Normal / Big Endian)' },
                              { value: 'BA', label: 'BA (Swapped Bytes / Little Endian)' }
                            ] : [
                              { value: 'ABCD', label: 'ABCD (Normal / Big Endian)' },
                              { value: 'CDAB', label: 'CDAB (Word Swap / Mid-Little Endian)' },
                              { value: 'BADC', label: 'BADC (Byte Swap)' },
                              { value: 'DCBA', label: 'DCBA (Byte & Word Swap / Little Endian)' }
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* STEP 3: Polling Rate & Scaling */}
                  {wizardStep === 3 && protocol !== 'MQTT' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 700 }}>Scan Rate (ms)</label>
                        <input 
                          className="form-input" 
                          type="number" 
                          value={newDpScanIntervalMs}
                          onChange={(e) => setNewDpScanIntervalMs(parseInt(e.target.value, 10) || 1000)}
                          style={{ fontFamily: 'var(--font-mono)' }}
                          min={100}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 700 }}>Scale Factor</label>
                          <input 
                            className="form-input" 
                            type="number" 
                            step="any"
                            value={newDpScaleFactor}
                            onChange={(e) => setNewDpScaleFactor(e.target.value)}
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                        </div>

                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 700 }}>Offset</label>
                          <input 
                            className="form-input" 
                            type="number" 
                            step="any"
                            value={newDpOffset}
                            onChange={(e) => setNewDpOffset(e.target.value)}
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Wizard Footer Buttons */}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'flex-end' }}>
                    {/* Back Button */}
                    {wizardStep > 1 && (
                      <button
                        type="button"
                        onClick={() => setWizardStep(prev => Math.max(1, prev - 1))}
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
                        Back
                      </button>
                    )}

                    {/* Cancel Button (Step 1 only) */}
                    {wizardStep === 1 && (
                      <button
                        type="button"
                        onClick={() => setIsCreateTagOpen(false)}
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
                        Cancel
                      </button>
                    )}

                    {/* Next / Submit Trigger Button */}
                    {(() => {
                      const isLastStep = protocol === 'MQTT' ? wizardStep === 2 : wizardStep === 3;
                      const isNextDisabled = wizardStep === 1 && (!newDpAdapterId || !newDpAddress.trim());

                      if (isLastStep) {
                        return (
                          <button
                            type="button"
                            onClick={() => handleCreatePhysicalTag()}
                            disabled={isNextDisabled || adapters.length === 0}
                            style={{
                              flex: 2,
                              backgroundColor: 'var(--sidebar-bg)',
                              color: '#ffffff',
                              border: 'none',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: (isNextDisabled || adapters.length === 0) ? 'not-allowed' : 'pointer',
                              transition: 'all 0.2s ease',
                              opacity: (isNextDisabled || adapters.length === 0) ? 0.6 : 1
                            }}
                          >
                            Register Tag
                          </button>
                        );
                      } else {
                        return (
                          <button
                            type="button"
                            onClick={() => setWizardStep(prev => prev + 1)}
                            disabled={isNextDisabled}
                            style={{
                              flex: 2,
                              backgroundColor: 'var(--primary-color)',
                              color: 'var(--sidebar-bg)',
                              border: 'none',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: isNextDisabled ? 'not-allowed' : 'pointer',
                              transition: 'all 0.2s ease',
                              opacity: isNextDisabled ? 0.6 : 1
                            }}
                          >
                            Next Step
                          </button>
                        );
                      }
                    })()}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* EDIT TAG MODAL */}
      {editingPhysicalTag && (
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
            width: '540px',
            maxWidth: '95%',
            padding: '32px 40px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>Edit Physical Sensor Tag</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Modify the configuration for hardware sensor tag.
            </p>

            <form onSubmit={handleEditPhysicalTag} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Connection Driver Adapter</label>
                <CustomSelect 
                  value={editDpAdapterId}
                  onChange={handleEditAdapterChange}
                  options={adapters.map(a => ({
                    value: a.id,
                    label: `${a.name} (${a.protocol} @ ${a.host}:${a.port})`
                  }))}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Tag Address / Register / MQTT Topic</label>
                <input 
                  className="form-input" 
                  type="text" 
                  value={editDpAddress}
                  onChange={(e) => setEditDpAddress(e.target.value)}
                  required
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Tag Description</label>
                <input 
                  className="form-input" 
                  type="text" 
                  placeholder="e.g. Steam pressure sensor for Zone A, Packer 2"
                  value={editDpDescription}
                  onChange={(e) => setEditDpDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Data Type</label>
                  {adapters.find(a => a.id === editDpAdapterId)?.protocol === 'MODBUS_TCP' && (
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', fontStyle: 'italic' }}>
                      String not supported on Modbus TCP
                    </div>
                  )}
                  <CustomSelect 
                    value={editDpDataType}
                    onChange={handleEditDataTypeChange}
                    options={[
                      { value: 'Int16', label: 'Int16 (1 word)' },
                      { value: 'UInt16', label: 'UInt16 (1 word)' },
                      { value: 'Int32', label: 'Int32 (2 words)' },
                      { value: 'UInt32', label: 'UInt32 (2 words)' },
                      { value: 'Float', label: 'Float (2 words)' },
                      { value: 'Double', label: 'Double (4 words)' },
                      { value: 'Int64', label: 'Int64 (4 words)' },
                      { value: 'UInt64', label: 'UInt64 (4 words)' },
                      { value: 'Boolean', label: 'Boolean (1 word)' },
                      ...(adapters.find(a => a.id === editDpAdapterId)?.protocol !== 'MODBUS_TCP' ? [
                        { value: 'String', label: 'String' }
                      ] : [])
                    ]}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Scan Rate (ms)</label>
                  <input 
                    className="form-input" 
                    type="number" 
                    value={editDpScanIntervalMs}
                    onChange={(e) => setEditDpScanIntervalMs(parseInt(e.target.value, 10) || 1000)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              {adapters.find(a => a.id === editDpAdapterId)?.protocol === 'MODBUS_TCP' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Byte Order / Endianness</label>
                  <CustomSelect 
                    value={editDpByteOrder}
                    onChange={setEditDpByteOrder}
                    options={editDpDataType === 'Int16' || editDpDataType === 'UInt16' ? [
                      { value: 'AB', label: 'AB (Default / No Swap)' },
                      { value: 'BA', label: 'BA (Swapped Bytes)' }
                    ] : [
                      { value: 'ABCD', label: 'ABCD (Default / No Swap)' },
                      { value: 'CDAB', label: 'CDAB (Word Swap)' },
                      { value: 'BADC', label: 'BADC (Byte Swap)' },
                      { value: 'DCBA', label: 'DCBA (Byte & Word Swap)' }
                    ]}
                  />
                </div>
              )}

              {adapters.find(a => a.id === editDpAdapterId)?.protocol === 'MQTT' && (
                <>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Parse Mode</label>
                    <CustomSelect
                      value={editDpMqttParseMode}
                      onChange={setEditDpMqttParseMode}
                      options={[
                        { value: 'Plaintext', label: 'Plaintext Value' },
                        { value: 'JSON', label: 'JSON Parser' }
                      ]}
                    />
                  </div>
                  {editDpMqttParseMode === 'JSON' && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontWeight: 700 }}>JSON Path / Key</label>
                      <input
                        className="form-input"
                        type="text"
                        placeholder="e.g. $.sensors.temperature or temperature"
                        value={editDpMqttJsonPath}
                        onChange={(e) => setEditDpMqttJsonPath(e.target.value)}
                        required
                        style={{ fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Scale Factor</label>
                  <input 
                    className="form-input" 
                    type="number" 
                    step="any"
                    value={editDpScaleFactor}
                    onChange={(e) => setEditDpScaleFactor(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>Offset</label>
                  <input 
                    className="form-input" 
                    type="number" 
                    step="any"
                    value={editDpOffset}
                    onChange={(e) => setEditDpOffset(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
                <input 
                  type="checkbox"
                  id="editDpIsEnabled"
                  checked={editDpIsEnabled}
                  onChange={(e) => setEditDpIsEnabled(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="editDpIsEnabled" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                  {adapters.find(a => a.id === editDpAdapterId)?.protocol === 'MQTT' ? 'Enable Subscription' : 'Tag Polling Enabled'}
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button 
                  type="submit"
                  style={{
                    flex: 2,
                    backgroundColor: 'var(--sidebar-bg)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  Save Changes
                </button>
                <button 
                  type="button"
                  onClick={() => setEditingPhysicalTag(null)}
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
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HARD DELETE CONFIRMATION MODAL */}
      {deletingPhysicalTag && (
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
                <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Delete Physical Tag?</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Are you sure you want to permanently delete tag <strong style={{ color: 'var(--text-primary)' }}>{deletingPhysicalTag.address}</strong>?
                </p>
              </div>
            </div>

            {deletingPhysicalTag.dataSourceId && deletingPhysicalTag.dataSourceId !== "" && (
              <div style={{
                color: '#dd6b20',
                backgroundColor: '#fffaf0',
                border: '1px solid #feebc8',
                padding: '12px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                marginBottom: '24px',
                lineHeight: '1.4'
              }}>
                <strong>Warning:</strong> This tag is currently bound to data stream <strong style={{ color: 'var(--text-primary)' }}>{deletingPhysicalTag.dataSourceId}</strong>. Deleting this physical tag will immediately unbind it and stop telemetry.
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => handleHardDeleteDataPoint(deletingPhysicalTag.id)}
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
                Delete Tag
              </button>
              <button 
                onClick={() => setDeletingPhysicalTag(null)}
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

      {/* BULK DELETE CONFIRMATION MODAL */}
      {isBulkDeleteOpen && (
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
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Delete Multiple Physical Tags?</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Are you sure you want to permanently delete <strong style={{ color: 'var(--text-primary)' }}>{Object.values(selectedTagIds).filter(Boolean).length}</strong> selected physical tag(s)?
                </p>
              </div>
            </div>

            {/* List of tags being deleted */}
            <div style={{
              maxHeight: '150px',
              overflowY: 'auto',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '10px 14px',
              backgroundColor: 'var(--bg-color)',
              marginBottom: '20px'
            }}>
              {filteredDatapoints.filter(dp => selectedTagIds[dp.id]).map(dp => {
                const adp = adapters.find(a => a.id === dp.adapterId);
                return (
                  <div key={dp.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 0',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    fontSize: '12px'
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {dp.address}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                      {adp ? `${adp.name} (${adp.protocol.replace('_', ' ')})` : 'Unassigned'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Warning if any selected tags are mapped */}
            {filteredDatapoints.filter(dp => selectedTagIds[dp.id] && dp.dataSourceId && dp.dataSourceId !== "").length > 0 && (
              <div style={{
                color: '#dd6b20',
                backgroundColor: '#fffaf0',
                border: '1px solid #feebc8',
                padding: '12px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                marginBottom: '24px',
                lineHeight: '1.4'
              }}>
                <strong>Warning:</strong> Some selected tags are currently bound to data streams. Deleting them will immediately unbind them and stop telemetry.
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={handleBulkDelete}
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
                Delete Selected Tags
              </button>
              <button 
                onClick={() => setIsBulkDeleteOpen(false)}
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

    </div>
  );
}
