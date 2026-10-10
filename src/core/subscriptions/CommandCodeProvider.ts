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

const AUTH_FILE_DIR = '.commandcode';
const AUTH_FILE_NAME = 'auth.json';

// 浏览器请求 UA：alpha 接口在慢网络下用默认 Electron UA 偶发超时，浏览器 UA 更稳。
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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
  // 社区 CLI 映射补齐：与 auth-file / Studio Key 的 planId 口径对齐
  'individual-go': 10,
  'individual-goat': 70,
  'individual-pro': 30,
  'individual-pro-v1': 80,
  'individual-provider': 15,
  provider: 15,
  'individual-max': 150,
  max: 150,
  'individual-ultra': 300,
  ultra: 300,
  'teams-pro': 40,
};

export const COMMANDCODE_CREDENTIAL_ACCOUNT = 'commandcode-api-key';
export const COMMANDCODE_SESSION_ACCOUNT = 'commandcode-session-token';

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

export class CommandCodeProvider implements SubscriptionProvider {
  readonly id = 'commandcode' as const;
  readonly label = 'Command Code';
  readonly credentialAccount = COMMANDCODE_CREDENTIAL_ACCOUNT;
  /** 浏览器会话 Token（与 API Key 不同），存放在独立 vault 账户，复用用量 Token 的存取链路。 */
  readonly usageCredentialAccount = COMMANDCODE_SESSION_ACCOUNT;

  constructor(private getSettings: () => AppSettings) {}

  /**
   * 四级解析：手动录入（可覆盖）→ 环境变量 → ~/.commandcode/auth.json → 浏览器会话 Token。
   * 后者免装 CLI：登录 commandcode.ai 后从 devtools 拷 Bearer / Cookie 贴进来即可。
   */
  private async resolveCandidates(): Promise<ResolvedApiKey[]> {
    const candidates: ResolvedApiKey[] = [];
    const seen = new Set<string>();

    const push = (key: string | undefined, source: CommandCodeCredentialSource) => {
      const normalized = nonEmptyString(key);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push({ key: normalized, source });
    };

    const stored = await credentialVault.getSecret(this.credentialAccount);
    push(stored ?? undefined, 'manual');

    push(process.env.COMMAND_CODE_API_KEY, 'env');
    push(process.env.COMMANDCODE_API_KEY, 'env');
    push(await this.readAuthFileKey(), 'auth-file');
    push((await credentialVault.getSecret(this.usageCredentialAccount)) ?? undefined, 'session');

    return candidates;
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

  /** 浏览器拷出来的可能是纯 Bearer，也可能是整段 Cookie；两种都试一次。 */
  private headerVariants(key: string): Array<Record<string, string>> {
    const base = {
      accept: 'application/json',
      'User-Agent': BROWSER_USER_AGENT,
    };
    const variants: Array<Record<string, string>> = [{ ...base, Authorization: `Bearer ${key}` }];
    if (/[=;]/.test(key)) {
      variants.push({ ...base, Cookie: key });
      const sessionMatch = key.match(/__Secure-authjs\.session-token=([^;\s]+)/);
      if (sessionMatch?.[1]) {
        variants.push({ ...base, Authorization: `Bearer ${sessionMatch[1]}` });
      }
    }
    return variants;
  }

  private async request(
    path: string,
    apiKey: string,
    timeoutMs: number,
  ): Promise<RequestOutcome> {
    let lastFailure: RequestFailure | null = null;
    for (const headers of this.headerVariants(apiKey)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${API_BASE}${path}`, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          const blocking = response.status === 401 || response.status === 403;
          lastFailure = {
            ok: false,
            status: response.status,
            blocking,
            message: blocking
              ? '凭据无效或已过期：API Key 请去 commandcode.ai/settings/keys 重建，浏览器 Token 请重新登录后重拷'
              : `Command Code 接口返回 ${response.status}: ${response.statusText}（alpha 接口可能已变动）`,
          };
          if (!blocking) return lastFailure;
          continue;
        }

        return { ok: true, body: await response.json().catch(() => null) };
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        return {
          ok: false,
          status: 0,
          blocking: false,
          message: isAbort
            ? '请求超时，请检查网络后重试（可去数据刷新里调大超时）'
            : `查询失败：${err instanceof Error ? err.message : String(err)}`,
        };
      } finally {
        clearTimeout(timeout);
      }
    }
    return (
      lastFailure ?? {
        ok: false,
        status: 0,
        blocking: false,
        message: '查询失败：未知错误',
      }
    );
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolveCandidates()).length > 0;
  }

  private async fetchWithKey(
    resolved: ResolvedApiKey,
    timeoutMs: number,
  ): Promise<SubscriptionInfoResult> {
    log.info('Fetching Command Code quota', { source: resolved.source });

    const whoamiRes = await this.request(WHOAMI_PATH, resolved.key, timeoutMs);
    if (!whoamiRes.ok) {
      // 401/403 说明这个凭据不对，切下一个候选；超时/5xx 则直接报，不再换凭据碰运气。
      return { success: false, providerId: this.id, message: whoamiRes.message, data: null };
    }
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
        this.request(`${CREDITS_PATH}${accountQuery}`, resolved.key, timeoutMs),
        this.request(`${SUBSCRIPTIONS_PATH}${accountQuery}`, resolved.key, timeoutMs),
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
        timeoutMs,
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
  }

  async fetchInfo(): Promise<SubscriptionInfoResult> {
    const candidates = await this.resolveCandidates();
    if (candidates.length === 0) {
      return {
        success: false,
        providerId: this.id,
        message: '未找到 Command Code 凭据：在下方粘贴 Studio API Key 或浏览器会话 Token，无需安装 CLI',
      };
    }

    const settings = this.getSettings();
    // 之前单个超时管全部 4 个请求，弱网下必超时；现在每个请求独立占满配置超时。
    const timeoutMs = Math.max(settings.requestTimeoutSec, 10) * 1000;

    let lastAuthError: SubscriptionInfoResult | null = null;
    try {
      for (const resolved of candidates) {
        const result = await this.fetchWithKey(resolved, timeoutMs);
        if (result.success) return result;
        const message = result.message ?? '';
        const authFailed = /无效|过期|401|403/.test(message);
        if (authFailed) {
          lastAuthError = result;
          continue;
        }
        return result;
      }
      return (
        lastAuthError ?? {
          success: false,
          providerId: this.id,
          message: 'Command Code 查询失败',
        }
      );
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const message = isAbort
        ? '请求超时，请检查网络后重试'
        : `查询失败：${err instanceof Error ? err.message : String(err)}`;
      log.error('Command Code quota fetch failed', message);
      return { success: false, providerId: this.id, message };
    }
  }
}
