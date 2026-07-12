import { Network, Shuffle, Tag } from 'lucide-react';
import type { DataPoint, DataSource, DriverAdapter } from '../../types';
import { getAdapterHealth, getTagHealth } from './health';
import type { DashboardDrilldown } from './DashboardDetailModal';

interface Props { adapters: DriverAdapter[]; datapoints: DataPoint[]; datasources: DataSource[]; onSelect: (value: DashboardDrilldown) => void; }
const pct = (value: number, total: number) => total ? `${(value / total) * 100}%` : '0%';

export default function OperationalOverview({ adapters, datapoints, datasources, onSelect }: Props) {
  const ac = { good: 0, offline: 0, disabled: 0 };
  adapters.forEach(a => ac[getAdapterHealth(a)]++);
  const protocols = Array.from(new Set(adapters.map(a => a.protocol))).map(protocol => {
    const protocolAdapters = adapters.filter(a => a.protocol === protocol);
    return {
      protocol,
      label: protocol.replace(/_/g, ' '),
      good: protocolAdapters.filter(a => getAdapterHealth(a) === 'good').length,
      offline: protocolAdapters.filter(a => getAdapterHealth(a) === 'offline').length,
      disabled: protocolAdapters.filter(a => getAdapterHealth(a) === 'disabled').length,
      total: protocolAdapters.length
    };
  }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const tc = { live: 0, connecting: 0, error: 0, disabled: 0 };
  datapoints.forEach(t => tc[getTagHealth(t)]++);
  const categories = Array.from(new Set(datasources.map(s => s.type))).map(name => ({ name, enabled: datasources.filter(s => s.type === name && s.isEnabled).length, disabled: datasources.filter(s => s.type === name && !s.isEnabled).length })).sort((a, b) => (b.enabled + b.disabled) - (a.enabled + a.disabled));
  const enabledStreams = datasources.filter(s => s.isEnabled).length;
  const click = (value: DashboardDrilldown) => () => onSelect(value);

  return <div className="ops-overview-grid">
    <section className="ops-health-panel is-adapters">
      <header className="ops-panel-head"><div className="ops-panel-icon"><Network size={17}/></div><div><h3>Adapter health</h3><p>Protocol connection readiness</p></div><button className="ops-total" onClick={click({domain:'adapters',filter:'all',label:'All adapters'})}><strong>{adapters.length}</strong><span>Total</span></button></header>
      <div className="ops-segment-rail" aria-label="Adapter health distribution">
        {(['good','offline','disabled'] as const).map(k => <button key={k} className={`is-${k}`} style={{width:pct(ac[k],adapters.length)}} title={`${ac[k]} ${k} adapters`} onClick={click({domain:'adapters',filter:k,label:`${k[0].toUpperCase()+k.slice(1)} adapters`})}/>) }
      </div>
      <div className="ops-metric-grid is-three">{(['good','offline','disabled'] as const).map(k => <button key={k} onClick={click({domain:'adapters',filter:k,label:`${k[0].toUpperCase()+k.slice(1)} adapters`})} title={`View adapters classified as ${k}`}><span className={`ops-dot is-${k}`}/><b>{ac[k]}</b><small>{k}</small></button>)}</div>
      <div className="ops-breakdown ops-protocol-breakdown"><div className="ops-breakdown-title"><span>By protocol</span><span>Good</span><span>Offline</span><span>Disabled</span><span>Total</span></div>{protocols.map(item => <button key={item.protocol} onClick={click({domain:'adapters',filter:'protocol',protocol:item.protocol,label:`${item.label} adapters`})}><span>{item.label}</span><b>{item.good}</b><b>{item.offline}</b><b>{item.disabled}</b><b>{item.total}</b></button>)}</div>
    </section>

    <section className="ops-health-panel is-tags">
      <header className="ops-panel-head"><div className="ops-panel-icon"><Tag size={17}/></div><div><h3>Tag health</h3><p>Live acquisition quality</p></div><button className="ops-total" onClick={click({domain:'tags',filter:'all',label:'All tags'})}><strong>{datapoints.length}</strong><span>Total</span></button></header>
      <div className="ops-segment-rail">{(['live','connecting','error','disabled'] as const).map(k => <button key={k} className={`is-${k}`} style={{width:pct(tc[k],datapoints.length)}} title={`${tc[k]} ${k} tags`} onClick={click({domain:'tags',filter:k,label:`${k[0].toUpperCase()+k.slice(1)} tags`})}/>)}</div>
      <div className="ops-metric-grid">{(['live','connecting','error','disabled'] as const).map(k => <button key={k} onClick={click({domain:'tags',filter:k,label:`${k[0].toUpperCase()+k.slice(1)} tags`})}><span className={`ops-dot is-${k}`}/><b>{tc[k]}</b><small>{k}</small></button>)}</div>
      <div className="ops-breakdown ops-tag-breakdown"><div className="ops-breakdown-title"><span>By adapter</span><span>Error</span><span>Connecting</span><span>Disabled</span><span>Total</span></div>{adapters.map(a => { const tags=datapoints.filter(t=>t.adapterId===a.id); return {a,tags,error:tags.filter(t=>getTagHealth(t)==='error').length,connecting:tags.filter(t=>getTagHealth(t)==='connecting').length,disabled:tags.filter(t=>getTagHealth(t)==='disabled').length}; }).filter(x=>x.tags.length).sort((a,b)=>b.error-a.error||b.connecting-a.connecting||b.disabled-a.disabled||b.tags.length-a.tags.length).slice(0,3).map(x=><button key={x.a.id} onClick={click({domain:'tags',filter:'adapter',adapterId:x.a.id,label:`Tags on ${x.a.name}`})}><span>{x.a.name}</span><b className={x.error?'is-alert':''}>{x.error}</b><b>{x.connecting}</b><b>{x.disabled}</b><b>{x.tags.length}</b></button>)}</div>
    </section>

    <section className="ops-health-panel is-streams">
      <header className="ops-panel-head"><div className="ops-panel-icon"><Shuffle size={17}/></div><div><h3>Stream configuration</h3><p>Publishing topology</p></div><button className="ops-total" onClick={click({domain:'streams',filter:'all',label:'All streams'})}><strong>{datasources.length}</strong><span>Total</span></button></header>
      <div className="ops-stream-totals"><button onClick={click({domain:'streams',filter:'enabled',label:'Enabled streams'})}><strong>{enabledStreams}</strong><span>Enabled</span></button><button onClick={click({domain:'streams',filter:'disabled',label:'Disabled streams'})}><strong>{datasources.length-enabledStreams}</strong><span>Disabled</span></button></div>
      <div className="ops-category-list">{categories.map(c=><button key={c.name} onClick={click({domain:'streams',filter:'category',category:c.name,label:`${c.name} streams`})}><span className="ops-category-name">{c.name}</span><span className="ops-category-bar"><i style={{width:pct(c.enabled,c.enabled+c.disabled)}}/></span><b>{c.enabled+c.disabled}</b><small>{c.enabled} on · {c.disabled} off</small></button>)}</div>
    </section>
  </div>;
}
