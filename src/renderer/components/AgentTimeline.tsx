import { useState } from 'react';
import type { AgentTurn, AgentTurnType } from '../../shared/agentTrace';

interface AgentTimelineProps {
  turns: AgentTurn[];
}

const TYPE_LABEL: Record<AgentTurnType, string> = {
  thinking: '思考',
  tool_call: '工具调用',
  tool_result: '工具结果',
  assistant: '回复',
  user: '用户',
};

function formatTimestamp(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

interface TurnCardProps {
  turn: AgentTurn;
}

function TurnCard({ turn }: TurnCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = Boolean(turn.payload);
  const longText = turn.text.length > 320;
  const showFull = expanded || !longText;

  return (
    <div className={`agent-turn agent-turn--${turn.type}`}>
      <header className="agent-turn__header">
        <span className={`agent-turn__badge agent-turn__badge--${turn.type}`}>
          {TYPE_LABEL[turn.type]}
        </span>
        <span className="agent-turn__time">{formatTimestamp(turn.timestampMs)}</span>
      </header>
      <pre className="agent-turn__text">
        {showFull ? turn.text : `${turn.text.slice(0, 320)}…`}
      </pre>
      {hasPayload && (
        <details
          className="agent-turn__payload"
          open={expanded && hasPayload}
          onToggle={(e) => {
            const el = e.currentTarget;
            if (el.open) setExpanded(true);
          }}
        >
          <summary>{turn.type === 'tool_call' ? '参数' : '结果'}</summary>
          <pre className="agent-turn__payload-body">{turn.payload}</pre>
        </details>
      )}
      {longText && !hasPayload && (
        <button
          type="button"
          className="agent-turn__expand"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  );
}

export default function AgentTimeline({ turns }: AgentTimelineProps) {
  if (turns.length === 0) {
    return (
      <div className="agent-timeline__empty">
        <p>暂无智能体 turn 数据</p>
      </div>
    );
  }
  return (
    <ol className="agent-timeline">
      {turns.map((turn) => (
        <li key={`${turn.index}-${turn.type}`} className="agent-timeline__item">
          <TurnCard turn={turn} />
        </li>
      ))}
    </ol>
  );
}