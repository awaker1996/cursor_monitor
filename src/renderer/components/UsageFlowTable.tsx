import type { UsageFlowDisplay } from '../../shared/types';

interface UsageFlowTableProps {
  display: UsageFlowDisplay;
}

export default function UsageFlowTable({ display }: UsageFlowTableProps) {
  return (
    <div className="usage-flow-table-wrap">
      <table className="usage-flow-table">
        <thead>
          <tr>
            <th>Date (UTC+8)</th>
            <th>Type</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {display.entries.map((entry, index) => (
            <tr key={`${entry.timestamp}-${entry.model}-${index}`}>
              <td className="usage-flow-table__date">{entry.date}</td>
              <td>{entry.type}</td>
              <td className="usage-flow-table__model">
                <span className="usage-flow-table__model-name">{entry.model}</span>
                {entry.modelMax && (
                  <span className="usage-flow-table__max-badge" title="Max Mode">
                    MAX
                  </span>
                )}
              </td>
              <td className="usage-flow-table__tokens">{entry.tokens}</td>
              <td>{entry.cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
