import type { AppSettings } from '../../shared/types';
import type {
  CommandCodeAccount,
  CommandCodeCredits,
  CommandCodeCredentialSource,
  CommandCodeLimit,
  CommandCodePlan,
  CommandCodeQuotaSection,
  CommandCodeSummary,
  RawCommandCodeCredits,
  RawCommandCodeSubscription,
  RawCommandCodeUsageSummary,
  RawCommandCodeWhoami,
  SubscriptionInfoResult,
} from '../../shared/subscriptionTypes';
import type { SubscriptionProvider } from './types';
import { credentialVault } from '../../security/CredentialVault';
import { createLogger } from '../../utils/logger';

const log = createLogger('CommandCodeProvider');

// Command Code alpha 内部接口（与 cmd CLI 的 /usage 同源，未公开），随时可能变动
const API_BASE = 'https://api.commandcode.ai';
const WHOAMI_PATH = '/alpha/whoami';
const CREDITS_PATH = '/alpha/billing/credits';
const SUBSCRIPTIONS_PATH = '/alpha/billing/subscriptions';
const USAGE_SUMMARY_PATH = '/alpha/usage/summary';
/** 逐条流水列表（浏览器会话专用，API Key 无法访问）。 */
const USAGE_LIST_PATH = '/internal/usage';
/** 服务端 limit 上限：超过 100 返回 400。 */
const USAGE_LIST_PAGE_SIZE = 100;
/** 单次查询最多拉取的分页数（每页 100 条，按时间回溯）。 */
const USAGE_LIST_MAX_PAGES = 20;

const AUTH_FILE_DIR = '.commandcode';
const AUTH_FILE_NAME = 'auth.json';

/**
 * 各套餐的月度积分上限。额度接口只返回剩余量与滚动窗口，
 * 月度上限不返回，只能按套餐映射（数值取自官方 Pricing & Limits）。
 */
const PLAN_MONTHLY_CREDITS: Record<string, number> = {
  go: 10,
  goat: 70,
  pro: 80,
  'max-10x': 150,
  'max-20x': 300,
  'team-pro': 40,
};

export const COMMANDCODE_CREDENTIAL_ACCOUNT = 'commandcode-api-key';
export const COMMANDCODE_SESSION_CREDENTIAL_ACCOUNT = 'commandcode-session';

/** 单条 Command Code 调用流水（字段已防御式归一化，缺失为 null）。 */
export interface CommandCodeUsageFlowItem {
  /** ISO 时间字符串，无法解析时为 null。 */
  timestamp: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensTotal: number | null;
  costUsd: number | null;
  status: string | null;
}

export interface CommandCodeUsageFlowResult {
  success: boolean;
  configured: boolean;
  message?: string;
  items?: CommandCodeUsageFlowItem[];
  /** 达到分页上限仍有更多记录时为 true。 */
  truncated?: boolean;
}

interface ResolvedApiKey {
  key: string;
  source: CommandCodeCredentialSource;
}

interface RequestFailure {
  ok: false;
  status: number;
  blocking: boolean;
  message: string;
}

type RequestOutcome = { ok: true; body: unknown } | RequestFailure;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** 非负有限数，否则返回 undefined，避免 NaN 或负值污染展示。 */
function nonNegativeNumber(value: unknown): number | undefined {
  const num =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(num) && num >= 0 ? num : undefined;
}

/** 归一化为 unix 秒；接口可能给秒或毫秒，无法解析时为 null。 */
function normalizeResetAt(value: unknown): number | null {
  let timestamp: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    timestamp = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    const trimmed = value.trim();
    timestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0) return null;
  return Math.round(timestamp >= 1e12 ? timestamp / 1000 : timestamp);
}

/** 时间戳字段统一保留原始字符串形态，展示层再解析。 */
function timestampString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return nonEmptyString(value) ?? null;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** 套餐 id 会带作用域前缀（individual-go / team-pro），映射前先剥离。 */
function planMonthlyCredits(planId: string | null): number | undefined {
  if (!planId) return undefined;
  const key = planId.trim().toLowerCase();
  const scoped = key.replace(/^(individual|personal|team|org)-/, '');
  return PLAN_MONTHLY_CREDITS[key] ?? PLAN_MONTHLY_CREDITS[scoped];
}

/**
 * 组装三个限额窗口：5 小时 / 每周取接口原值，月度用「周期内消耗的月度积分 / 套餐上限」。
 * 套餐无法识别时不给月度进度，避免展示口径可疑的百分比。
 */
function buildLimits(
  raw: RawCommandCodeCredits,
  plan: CommandCodePlan | null,
  summary: CommandCodeSummary | null,
): CommandCodeLimit[] {
  const limits: CommandCodeLimit[] = [];

  for (const key of ['fiveHour', 'weekly'] as const) {
    const entry = raw.windowLimits?.[key];
    const used = nonNegativeNumber(entry?.used);
    const cap = nonNegativeNumber(entry?.cap);
    // 两个字段都为 0 时视为该窗口不适用，避免展示无意义的 0/0
    if (used === undefined || cap === undefined || (used === 0 && cap === 0)) continue;
    limits.push({ key, used, cap, resetAt: normalizeResetAt(entry?.resetAt) });
  }

  const monthlyCap = planMonthlyCredits(plan?.planId ?? null);
  const monthlyUsed = summary?.monthlyCreditsUsed;
  if (monthlyCap !== undefined && monthlyUsed !== undefined) {
    limits.push({
      key: 'monthly',
      used: monthlyUsed,
      cap: monthlyCap,
      resetAt: normalizeResetAt(plan?.currentPeriodEnd ?? null),
    });
  }

  return limits;
}

function parseCredits(raw: RawCommandCodeCredits): CommandCodeCredits | null {
  const credits = raw.credits;
  if (!credits) return null;
  const monthly = nonNegativeNumber(credits.monthlyCredits);
  const purchased = nonNegativeNumber(credits.purchasedCredits);
  const free = nonNegativeNumber(credits.freeCredits);
  if (monthly === undefined && purchased === undefined && free === undefined) return null;

  const monthlyCredits = monthly ?? 0;
  const purchasedCredits = purchased ?? 0;
  const freeCredits = free ?? 0;
  return {
    monthlyCredits,
    purchasedCredits,
    freeCredits,
    remainingCredits: monthlyCredits + purchasedCredits + freeCredits,
  };
}

function parsePlan(raw: RawCommandCodeSubscription): CommandCodePlan | null {
  const data = raw.data;
  if (!data) return null;
  const plan = {
    planId: nonEmptyString(data.planId) ?? null,
    status: nonEmptyString(data.status) ?? null,
    currentPeriodStart: timestampString(data.currentPeriodStart),
    currentPeriodEnd: timestampString(data.currentPeriodEnd),
  };
  if (!plan.planId && !plan.status && !plan.currentPeriodStart && !plan.currentPeriodEnd) return null;
  return plan;
}

function parseSummary(raw: RawCommandCodeUsageSummary): CommandCodeSummary | null {
  const totalCost = nonNegativeNumber(raw.totalCost);
  const totalCount = nonNegativeNumber(raw.totalCount);
  if (totalCost === undefined || totalCount === undefined) return null;
  const totalTokens = nonNegativeNumber(raw.totalTokens) ?? nonNegativeNumber(raw.tokens);
  const monthlyCreditsUsed = nonNegativeNumber(raw.totalMonthlyCredits);
  const totalTokensIn = nonNegativeNumber(raw.totalTokensIn);
  const totalTokensOut = nonNegativeNumber(raw.totalTokensOut);
  const completedCount = nonNegativeNumber(raw.completedCount);
  const failedCount = nonNegativeNumber(raw.failedCount);
  const successRate = nonNegativeNumber(raw.successRate);
  const averageCost = nonNegativeNumber(raw.averageCost);
  const periodBasis = nonEmptyString(raw.periodBasis);
  return {
    totalCost,
    totalCount,
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(monthlyCreditsUsed === undefined ? {} : { monthlyCreditsUsed }),
    ...(totalTokensIn === undefined ? {} : { totalTokensIn }),
    ...(totalTokensOut === undefined ? {} : { totalTokensOut }),
    ...(completedCount === undefined ? {} : { completedCount }),
    ...(failedCount === undefined ? {} : { failedCount }),
    ...(successRate === undefined ? {} : { successRate }),
    ...(averageCost === undefined ? {} : { averageCost }),
    ...(periodBasis === undefined ? {} : { periodBasis }),
  };
}

function parseAccount(raw: RawCommandCodeWhoami): CommandCodeAccount | null {
  const login =
    nonEmptyString(raw.org?.login) ??
    nonEmptyString(raw.user?.userName) ??
    nonEmptyString(raw.user?.name);
  if (!login) return null;
  const keyName = nonEmptyString(raw.user?.keyName) ?? nonEmptyString(raw.user?.displayName);
  return { login, orgId: nonEmptyString(raw.org?.id) ?? null, ...(keyName ? { keyName } : {}) };
}

/** 凭据字段可能是裸字符串，也可能是 { type: 'oauth' | 'api', access | key } 形态。 */
function keyFromCredential(value: unknown): string | undefined {
  const direct = nonEmptyString(value);
  if (direct) return direct;
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === 'oauth') return nonEmptyString(record.access);
  if (record.type === 'api') return nonEmptyString(record.key);
  return nonEmptyString(record.access) ?? nonEmptyString(record.key);
}

function keyFromAuthPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  return (
    nonEmptyString(record.apiKey) ??
    keyFromCredential(record.commandcode) ??
    keyFromCredential(record['command-code'])
  );
}

/** 会话凭据形态不定：含 `=` 视为 Cookie 头，否则视为 Bearer Token。 */
function buildSessionHeaders(credential: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    Origin: 'https://commandcode.ai',
    Referer: 'https://commandcode.ai/',
    'User-Agent': 'CursorTokenMonitor/1.0',
  };
  if (credential.includes('=')) {
    headers.Cookie = credential;
  } else {
    headers.Authorization = `Bearer ${credential}`;
  }
  return headers;
}

/** 接口时间戳可能是 ISO、秒或毫秒；统一归一化为 ISO 字符串。 */
function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0 && !/^\d+$/.test(value.trim())) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  let ms: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    ms = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    ms = Number(value.trim());
  }
  if (ms === null || !Number.isFinite(ms)) return null;
  const date = new Date(ms >= 1e12 ? ms : ms * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickRaw(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

/** 原始行的创建时间（毫秒），供按时间回溯分页定位下一批的上界。 */
function rowTimestampMs(record: Record<string, unknown>): number | null {
  const iso = toIsoTimestamp(
    pickRaw(record, ['createdAt', 'created_at', 'timestamp', 'time', 'eventTimestamp', 'date']),
  );
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** 从响应中取出流水数组（接口字段为 `usages`），并容错其它包裹层级。 */
function extractUsageItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  for (const key of [
    'usages',
    'data',
    'items',
    'usage',
    'rows',
    'events',
    'results',
    'records',
    'list',
    'logs',
  ]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      for (const nestedKey of [
        'usages',
        'items',
        'rows',
        'usage',
        'data',
        'events',
        'results',
        'records',
        'list',
      ]) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
      }
    }
  }
  return [];
}

function toUsageFlowItem(raw: unknown): CommandCodeUsageFlowItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const meta =
    record.meta && typeof record.meta === 'object'
      ? (record.meta as Record<string, unknown>)
      : undefined;

  const timestamp = toIsoTimestamp(
    pickRaw(record, ['createdAt', 'created_at', 'timestamp', 'time', 'eventTimestamp', 'date']),
  );
  const model =
    nonEmptyString(
      pickRaw(record, ['model', 'modelId', 'model_id', 'modelIntent', 'modelName']),
    ) ??
    (meta
      ? nonEmptyString(pickRaw(meta, ['model', 'modelId', 'model_id', 'modelIntent']))
      : undefined) ??
    null;
  const tokensIn = nonNegativeNumber(
    pickRaw(record, ['tokensIn', 'inputTokens', 'tokens_in', 'input_tokens']),
  );
  const tokensOut = nonNegativeNumber(
    pickRaw(record, ['tokensOut', 'outputTokens', 'tokens_out', 'output_tokens']),
  );
  const explicitTotal = nonNegativeNumber(
    pickRaw(record, ['tokensTotal', 'totalTokens', 'tokens_total', 'total_tokens']),
  );
  const tokensTotal =
    explicitTotal ??
    (tokensIn !== undefined || tokensOut !== undefined ? (tokensIn ?? 0) + (tokensOut ?? 0) : undefined);
  const costUsd =
    nonNegativeNumber(
      pickRaw(record, ['totalCost', 'cost', 'costUsd', 'amount', 'total_cost', 'cost_usd']),
    ) ?? (meta ? nonNegativeNumber(pickRaw(meta, ['totalCost', 'cost'])) : undefined);
  const status = nonEmptyString(pickRaw(record, ['status', 'state'])) ?? null;

  if (!timestamp && !model && tokensTotal === undefined && costUsd === undefined) return null;

  return {
    timestamp,
    model,
    tokensIn: tokensIn ?? null,
    tokensOut: tokensOut ?? null,
    tokensTotal: tokensTotal ?? null,
    costUsd: costUsd ?? null,
    status,
  };
}

export class CommandCodeProvider implements SubscriptionProvider {
  readonly id = 'commandcode' as const;
  readonly label = 'Command Code';
  readonly credentialAccount = COMMANDCODE_CREDENTIAL_ACCOUNT;
  readonly sessionCredentialAccount = COMMANDCODE_SESSION_CREDENTIAL_ACCOUNT;
  /** /alpha/whoami 解析出的 userId 缓存（仅缓存成功结果）。 */
  private cachedUserId: string | null = null;

  constructor(private getSettings: () => AppSettings) {}

  /**
   * 三级解析：手动录入（可覆盖）→ 环境变量 → cmd login 写入的 ~/.commandcode/auth.json。
   */
  private async resolveApiKey(): Promise<ResolvedApiKey | null> {
    const stored = await credentialVault.getSecret(this.credentialAccount);
    const manual = nonEmptyString(stored);
    if (manual) return { key: manual, source: 'manual' };

    const fromEnv =
      nonEmptyString(process.env.COMMAND_CODE_API_KEY) ??
      nonEmptyString(process.env.COMMANDCODE_API_KEY);
    if (fromEnv) return { key: fromEnv, source: 'env' };

    const fromFile = await this.readAuthFileKey();
    if (fromFile) return { key: fromFile, source: 'auth-file' };

    return null;
  }

  /** 读取失败或结构不识别时静默返回 undefined，不记录凭据内容。 */
  private async readAuthFileKey(): Promise<string | undefined> {
    try {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const file = path.join(os.homedir(), AUTH_FILE_DIR, AUTH_FILE_NAME);
      if (!fs.existsSync(file)) return undefined;
      return keyFromAuthPayload(JSON.parse(fs.readFileSync(file, 'utf-8')));
    } catch {
      return undefined;
    }
  }

  private async request(
    path: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<RequestOutcome> {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });

    if (!response.ok) {
      const blocking = response.status === 401 || response.status === 403;
      return {
        ok: false,
        status: response.status,
        blocking,
        message: blocking
          ? 'API Key 无效或已过期，请重新配置或运行 cmd login'
          : `Command Code 接口返回 ${response.status}: ${response.statusText}（alpha 接口可能已变动）`,
      };
    }

    return { ok: true, body: await response.json().catch(() => null) };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolveApiKey()) !== null;
  }

  async fetchInfo(): Promise<SubscriptionInfoResult> {
    const resolved = await this.resolveApiKey();
    if (!resolved) {
      return {
        success: false,
        providerId: this.id,
        message: '未找到 Command Code 凭据：请先运行 cmd login，或在下方手动配置 API Key',
      };
    }

    const settings = this.getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutSec * 1000);

    try {
      log.info('Fetching Command Code quota');

      const whoamiRes = await this.request(WHOAMI_PATH, resolved.key, controller.signal);
      if (!whoamiRes.ok) return { success: false, providerId: this.id, message: whoamiRes.message };
      const account = parseAccount(whoamiRes.body as RawCommandCodeWhoami);
      if (!account) {
        return {
          success: false,
          providerId: this.id,
          message: 'Command Code 返回了无法识别的账号信息（alpha 接口可能已变动）',
        };
      }

      const accountQuery = buildQuery({ orgId: account.orgId ?? undefined });
      const [creditsRes, planRes] = await Promise.all([
        this.request(`${CREDITS_PATH}${accountQuery}`, resolved.key, controller.signal),
        this.request(`${SUBSCRIPTIONS_PATH}${accountQuery}`, resolved.key, controller.signal),
      ]);
      for (const res of [creditsRes, planRes]) {
        if (!res.ok && res.blocking) return { success: false, providerId: this.id, message: res.message };
      }

      const rawCredits = creditsRes.ok ? (creditsRes.body as RawCommandCodeCredits) : null;
      const credits = rawCredits ? parseCredits(rawCredits) : null;
      const plan = planRes.ok ? parsePlan(planRes.body as RawCommandCodeSubscription) : null;

      const summaryQuery = buildQuery({
        orgId: account.orgId ?? undefined,
        since: plan?.currentPeriodStart ?? undefined,
      });
      const summaryRes = await this.request(
        `${USAGE_SUMMARY_PATH}${summaryQuery}`,
        resolved.key,
        controller.signal,
      );
      if (!summaryRes.ok && summaryRes.blocking) {
        return { success: false, providerId: this.id, message: summaryRes.message };
      }
      const summary = summaryRes.ok
        ? parseSummary(summaryRes.body as RawCommandCodeUsageSummary)
        : null;

      const unavailable: CommandCodeQuotaSection[] = [];
      if (!credits) unavailable.push('credits');
      if (!plan) unavailable.push('subscription');
      if (!summary) unavailable.push('usage');

      if (!credits && !plan && !summary) {
        return {
          success: false,
          providerId: this.id,
          message: 'Command Code 未返回可识别的用量数据（alpha 接口可能已变动）',
        };
      }

      return {
        success: true,
        providerId: this.id,
        fetchedAt: new Date().toISOString(),
        data: {
          providerId: this.id,
          account,
          credits,
          plan,
          summary,
          limits: rawCredits ? buildLimits(rawCredits, plan, summary) : [],
          unavailable,
          credentialSource: resolved.source,
        },
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const message = isAbort
        ? '请求超时，请检查网络后重试'
        : `查询失败：${err instanceof Error ? err.message : String(err)}`;
      log.error('Command Code quota fetch failed', message);
      return { success: false, providerId: this.id, message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 逐条调用流水。仅网页会话凭据可访问 /internal/usage（API Key 会返回 401），
   * 因此单独使用 sessionToken 凭据，与 /alpha 的 API Key 分离。
   * 查询参数：userId（取自 /alpha/whoami）+ from/to（ISO）；服务端 limit 上限 100，按 offset 分页。
   */
  async fetchUsageFlow(
    startDateMs: number,
    endDateMs: number,
  ): Promise<CommandCodeUsageFlowResult> {
    const stored = await credentialVault.getSecret(this.sessionCredentialAccount);
    const credential = nonEmptyString(stored);
    if (!credential) {
      return {
        success: false,
        configured: false,
        message: '需配置 Command Code 流水会话凭据后查看流水',
      };
    }

    const settings = this.getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(settings.requestTimeoutSec, 30) * 1000,
    );

    try {
      const userId = await this.resolveUserId(credential, controller.signal);
      const collected: CommandCodeUsageFlowItem[] = [];
      const seen = new Set<string>();
      let truncated = false;
      let firstError: { status: number; body: string } | null = null;

      // 服务端把单次结果截断到 limit（≤100），且 offset 不生效；
      // 改为按时间回溯：每轮取 [from, upper] 内最新的 100 条，再用这批最旧的时间继续往前推。
      let upperMs = endDateMs;

      for (let page = 0; page < USAGE_LIST_MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          from: new Date(startDateMs).toISOString(),
          to: new Date(upperMs).toISOString(),
          limit: String(USAGE_LIST_PAGE_SIZE),
        });
        if (userId) params.set('userId', userId);

        const response = await fetch(`${API_BASE}${USAGE_LIST_PATH}?${params.toString()}`, {
          method: 'GET',
          headers: buildSessionHeaders(credential),
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            configured: true,
            message: 'Command Code 会话已失效，请重新登录 commandcode.ai 并更新流水凭据',
          };
        }

        const text = await response.text().catch(() => '');
        if (!response.ok) {
          if (page === 0) {
            firstError = {
              status: response.status,
              body: text.replace(/\s+/g, ' ').slice(0, 300),
            };
          }
          break;
        }

        let body: unknown = null;
        try {
          body = text ? (JSON.parse(text) as unknown) : null;
        } catch {
          body = null;
        }
        const rows = extractUsageItems(body);
        if (rows.length === 0) break;

        let added = 0;
        let oldestMs: number | null = null;
        for (const row of rows) {
          const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
          const rowMs = record ? rowTimestampMs(record) : null;
          if (rowMs !== null && (oldestMs === null || rowMs < oldestMs)) oldestMs = rowMs;

          const rawId = record?.id;
          const key =
            typeof rawId === 'string' && rawId ? rawId : JSON.stringify(row).slice(0, 120);
          if (seen.has(key)) continue;
          seen.add(key);
          const item = toUsageFlowItem(row);
          if (item) {
            collected.push(item);
            added += 1;
          }
        }

        // 不足一页代表已到范围起点；无新增代表 to 未生效（避免死循环）。
        if (rows.length < USAGE_LIST_PAGE_SIZE || added === 0) break;
        if (oldestMs === null) break;

        const nextUpper = oldestMs - 1;
        if (nextUpper <= startDateMs || nextUpper >= upperMs) break;
        upperMs = nextUpper;
        if (page === USAGE_LIST_MAX_PAGES - 1) truncated = true;
      }

      if (collected.length === 0 && firstError) {
        log.warn('Command Code usage flow rejected', firstError);
        return {
          success: false,
          configured: true,
          message: `Command Code 流水接口返回 ${firstError.status}：${firstError.body || '（内部接口可能已变动）'}`,
        };
      }

      log.info('Command Code usage flow fetched', { count: collected.length, truncated });
      return { success: true, configured: true, items: collected, truncated };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const message = isAbort
        ? '请求超时，请检查网络后重试'
        : `查询失败：${err instanceof Error ? err.message : String(err)}`;
      log.warn('Command Code usage flow fetch failed', { error: message });
      return { success: false, configured: true, message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** userId 取自 /alpha/whoami（API Key 优先，回退会话凭据）；只缓存成功结果。 */
  private async resolveUserId(
    credential: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    if (this.cachedUserId) return this.cachedUserId;

    const authForms: Array<Record<string, string>> = [];
    const resolved = await this.resolveApiKey();
    if (resolved) {
      authForms.push({ accept: 'application/json', Authorization: `Bearer ${resolved.key}` });
    }
    authForms.push(buildSessionHeaders(credential));

    for (const headers of authForms) {
      try {
        const response = await fetch(`${API_BASE}${WHOAMI_PATH}`, {
          method: 'GET',
          headers,
          signal,
        });
        if (!response.ok) continue;
        const body = (await response.json().catch(() => null)) as
          | { user?: { id?: unknown } }
          | null;
        const id = body?.user?.id;
        if (typeof id === 'string' && id.trim()) {
          this.cachedUserId = id.trim();
          return this.cachedUserId;
        }
      } catch {
        // 换下一种鉴权形态
      }
    }

    return null;
  }
}
