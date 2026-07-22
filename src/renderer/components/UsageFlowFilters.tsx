import { useEffect, useRef, useState } from 'react';
import {
  USAGE_FLOW_PRESETS,
  resolveCustomUsageFlowRange,
  resolveUsageFlowPreset,
  ymdFromMs,
  type UsageFlowDateRange,
  type UsageFlowPreset,
} from '../../shared/usageFlowDates';

interface UsageFlowFiltersProps {
  preset: UsageFlowPreset;
  dateRange: UsageFlowDateRange;
  disabled?: boolean;
  onPresetChange: (preset: UsageFlowPreset, range: UsageFlowDateRange) => void;
  onCustomRangeApply: (range: UsageFlowDateRange) => void;
}

export default function UsageFlowFilters({
  preset,
  dateRange,
  disabled,
  onPresetChange,
  onCustomRangeApply,
}: UsageFlowFiltersProps) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const [customStart, setCustomStart] = useState(() => ymdFromMs(dateRange.startDateMs));
  const [customEnd, setCustomEnd] = useState(() => ymdFromMs(dateRange.endDateMs));
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCustomStart(ymdFromMs(dateRange.startDateMs));
    setCustomEnd(ymdFromMs(dateRange.endDateMs));
  }, [dateRange.startDateMs, dateRange.endDateMs]);

  useEffect(() => {
    if (!rangeOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setRangeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [rangeOpen]);

  const handlePresetClick = (id: UsageFlowPreset) => {
    const range = resolveUsageFlowPreset(id);
    onPresetChange(id, range);
  };

  const handleApplyCustom = () => {
    const range = resolveCustomUsageFlowRange(customStart, customEnd);
    if (!range) return;
    onCustomRangeApply(range);
    setRangeOpen(false);
  };

  return (
    <div className="flow-filters">
      <div className="flow-filters__range" ref={panelRef}>
        <button
          type="button"
          className="flow-filters__range-btn"
          onClick={() => setRangeOpen((open) => !open)}
          disabled={disabled}
          aria-expanded={rangeOpen}
        >
          <span>{dateRange.label}</span>
          <span className="flow-filters__chevron" aria-hidden>
            ▾
          </span>
        </button>
        {rangeOpen && (
          <div className="flow-filters__range-panel">
            <div className="flow-filters__range-inputs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span className="flow-filters__range-sep">—</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
            <button type="button" className="btn-primary btn-primary--compact" onClick={handleApplyCustom}>
              应用
            </button>
          </div>
        )}
      </div>

      <div className="flow-filters__presets" role="group" aria-label="快捷日期">
        {USAGE_FLOW_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`flow-filters__preset${preset === item.id ? ' flow-filters__preset--active' : ''}`}
            onClick={() => handlePresetClick(item.id)}
            disabled={disabled}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
