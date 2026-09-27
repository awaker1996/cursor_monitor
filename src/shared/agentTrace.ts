/**
 * 共享类型：本地 Cursor 智能体（Composer / Agent）trace。
 *
 * 由主进程通过 `better-sqlite3` 只读打开 state.vscdb 解析得到，
 * 通过 IPC 推到设置窗口「智能体」Tab 渲染层。
 *
 * 表结构 / 列名经常变动；解析失败时由主进程返回带 `error` 的 meta，
 * 渲染层据此渲染 NOT_INSTALLED / LOCKED / SCHEMA_UNKNOWN / NO_DATA
 * 四种提示模板，不再需要重启应用或修改解析逻辑。
 */

export const AGENT_TRACE_CHANNELS = {
  FETCH: 'agent-get-latest-trace',
  START_WATCH: 'agent-start-watch',
  STOP_WATCH: 'agent-stop-watch',
  UPDATED: 'agent-trace-updated',
} as const;

export type AgentTurnType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'assistant'
  | 'user';

/** 一条智能体 turn（来自原始数据，已规整成可显示结构）。 */
export interface AgentTurn {
  /** 同 trace 内单调递增，渲染层用于折叠展开 / 标识 diff。 */
  index: number;
  /** turn 类别，决定折叠卡配色与图标。 */
  type: AgentTurnType;
  /** 主显示文本；tool_call 是工具名，tool_result 是结果摘要，assistant/user 是正文。 */
  text: string;
  /** 工具调用参数 / 工具结果对象；按字符串形式保存（避免 IPC 序列化复杂类型）。 */
  payload?: string;
  /** turn 起始时间（毫秒）；不可靠或缺失时为 null。 */
  timestampMs: number | null;
}

export interface AgentTraceMeta {
  /** 实际命中的 state.vscdb 绝对路径。 */
  dbPath: string;
  /** 'global' = User/globalStorage/state.vscdb；'workspace' = workspaceStorage/<id>/state.vscdb */
  dbKind: 'global' | 'workspace';
  /** workspace 模式下对应的工作区 URI；global 模式下为 null。 */
  workspaceUri: string | null;
  /** 最近一次 fetch 的本机时间（毫秒）。 */
  fetchedAtMs: number;
  /** 解析器对当前 schema 的告警（字段缺失等），用于 UI 顶部调试折叠。 */
  parseWarning?: string;
  /** 当前命中的数据库里原始表名清单（仅表名，不含数据），用于调试折叠。 */
  schemaTableNames?: string[];
  /** fetch 失败时携带的错误。 */
  error?: AgentTraceError;
}

export interface AgentTrace {
  meta: AgentTraceMeta;
  turns: AgentTurn[];
}

export type AgentTraceErrorCode =
  | 'NOT_INSTALLED'
  | 'LOCKED'
  | 'SCHEMA_UNKNOWN'
  | 'NO_DATA'
  | 'INTERNAL';

export interface AgentTraceError {
  code: AgentTraceErrorCode;
  message: string;
}