import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CustomSelect from '../CustomSelect';
import type { ScenarioCatalogEntry } from './ScenarioPanel';

interface ScenarioSelectProps {
  value: string;
  onChange: (id: string) => void;
}

/** Scenario picker backed by GET /api/simulator/scenarios (wizard + edit modal). */
export default function ScenarioSelect({ value, onChange }: ScenarioSelectProps) {
  const { t } = useTranslation();
  const [scenarios, setScenarios] = useState<ScenarioCatalogEntry[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/simulator/scenarios')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: ScenarioCatalogEntry[]) => {
        if (cancelled) return;
        setScenarios(data);
        if (!value && data.length > 0) onChange(data[0].id);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="form-group form-group-flush">
      <label className="form-label form-label-bold">{t('scenario.scenarioLabel')}</label>
      <CustomSelect
        value={value}
        onChange={onChange}
        placeholder={t('scenario.selectScenario')}
        options={scenarios.map(s => ({ value: s.id, label: s.name }))}
      />
      <span className="text-secondary text-xs" style={{ display: 'block', marginTop: '0.4rem' }}>
        {failed ? t('scenario.loadFailed') : t('scenario.help')}
      </span>
    </div>
  );
}
