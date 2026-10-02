import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorHint from '../components/ErrorHint';
import SubscriptionPanel from '../components/SubscriptionPanels';
import TestConnectionResultPanel from '../components/TestConnectionResultPanel';
import {
  EMPTY_PROVIDER_ENTRY,
  commandCodeCollapsedLimits,
  formatFetchedAt,
  currentMonthValue,
  limitTone,
  parseMonthValue,
  providerPlanLabel,
  providerSummaryLine,
  type ProviderCacheEntry,
} from '../components/SubscriptionUtils';
import type {
  SubscriptionCacheSnapshot,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';
import type { AppSettings, TestConnectionResult } from '../../shared/types';

type Health = 'green' | 'gray' | 'yellow';

function providerHealth(
  meta: SubscriptionProviderMeta,
  entry: ProviderCacheEntry | undefined,
): Health {
  if (!meta.configured) return 'gray';
  if (entry?.infoError) return 'yellow';
  return 'green';
}

const HEALTH_TEXT: Record<Health, string> = {
  green: '正常',
  gray: '未配置',
  yellow: '异常',
};

const HEALTH_TITLE: Record<Health, string> = {
  green: '已配置 · 数据正常',
  gray: '未配置凭据',
  yellow: '已配置 · 最近查询失败',
};

export default function SubscriptionsPage() {
  const [providers, setProviders] = useState<SubscriptionProviderMeta[]>([]);
  const [cache, setCache] = useState<Partial<Record<SubscriptionProviderId, ProviderCacheEntry>>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [usageMonth, setUsageMonth] = useState(currentMonthValue());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [expanded, setExpanded] = useState<Partial<Record<SubscriptionProviderId, boolean>>>({});
  const [configOpen, setConfigOpen] = useState<Partial<Record<SubscriptionProviderId, boolean>>>({});
  const [cookieInput, setCookieInput] = useState('');
  const [keyInputs, setKeyInputs] = useState<Partial<Record<SubscriptionProviderId, string>>>({});
  const [usageTokenInputs, setUsageTokenInputs] = useState<Partial<Record<SubscriptionProviderId, string>>>({});

  const initRef = useRef(false);
  const refreshingRef = useRef(false);
  const providersRef = useRef<SubscriptionProviderMeta[]>([]);
  const monthRef = useRef(usageMonth);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);
    const unsub = window.electronAPI.onSettingsChanged((s) => setSettings(s));
    return unsub;
  }, []);

  const refreshProviders = useCallback(async (): Promise<SubscriptionProviderMeta[]> => {
    const list = await window.electronAPI.listSubscriptionProviders();
    setProviders(list);
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Partial<Record<SubscriptionProviderId, boolean>> = {};
      for (const p of list) next[p.id] = false;
      return next;
    });
    setConfigOpen((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Partial<Record<SubscriptionProviderId, boolean>> = {};
      for (const p of list) {
        next[p.id] = !p.configured || (Boolean(p.usageSupported) && !p.usageConfigured);
      }
      return next;
    });
    return list;
  }, []);

  const runQueries = useCallback(
    async (meta: SubscriptionProviderMeta, monthValue: string) => {
      const period = parseMonthValue(monthValue);
      try {
        const infoPromise = window.electronAPI.fetchSubscriptionInfo(meta.id);
        const usagePromise =
          meta.usageSupported && meta.usageConfigured && period
            ? window.electronAPI.fetchSubscriptionUsage(meta.id, period)
            : Promise.resolve<SubscriptionUsageResult | null>(null);
        const [info, usage] = await Promise.all([infoPromise, usagePromise]);
        setCache((prev) => {
          const previous = prev[meta.id] ?? EMPTY_PROVIDER_ENTRY;
          return {
            ...prev,
            [meta.id]: {
              info: info.success ? info : previous.info,
              usage: usage ? (usage.success ? usage : previous.usage) : null,
              infoError: info.success ? null : info.message ?? '查询失败',
              usageError: usage && !usage.success ? usage.message ?? '用量查询失败' : null,
            },
          };
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setCache((prev) => ({
          ...prev,
          [meta.id]: { ...(prev[meta.id] ?? EMPTY_PROVIDER_ENTRY), infoError: message },
        }));
      }
    },
    [],
  );

  const refreshAll = useCallback(
    async (list: SubscriptionProviderMeta[], monthValue: string) => {
      const targets = list.filter((meta) => meta.configured);
      if (targets.length === 0) return;
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        await Promise.all(targets.map((meta) => runQueries(meta, monthValue)));
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [runQueries],
  );

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      const cached: SubscriptionCacheSnapshot = await window.electronAPI.getCachedSubscriptions();
      setCache((prev) => {
        const next = { ...prev };
        for (const [id, entry] of Object.entries(cached)) {
          if (!entry) continue;
          next[id as SubscriptionProviderId] = {
            info: entry.info ?? null,
            usage: entry.usage ?? null,
            infoError: null,
            usageError: null,
          };
        }
        return next;
      });
      const list = await refreshProviders();
      await refreshAll(list, currentMonthValue());
    })();
  }, [refreshProviders, refreshAll]);

  const autoRefreshEnabled = settings?.autoRefreshEnabled ?? false;
  const refreshIntervalSec = settings?.refreshIntervalSec ?? 30;
  const autoRefreshMs = refreshIntervalSec * 1000;

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const timer = window.setInterval(() => {
      if (refreshingRef.current) return;
      void refreshAll(providersRef.current, monthRef.current);
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, autoRefreshMs, refreshAll]);

  useEffect(() => {
    providersRef.current = providers;
    monthRef.current = usageMonth;
  });

  const toggleExpanded = (id: SubscriptionProviderId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleConfig = (id: SubscriptionProviderId) => {
    setConfigOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRefreshAll = async () => {
    const unconfigured = providers.filter((p) => !p.configured);
    if (providers.length > 0 && unconfigured.length === providers.length) {
      showToast('请先配置任一平台凭据');
      return;
    }
    await refreshAll(providers, usageMonth);
  };

  const handleRefreshOne = async (meta: SubscriptionProviderMeta) => {
    if (!meta.configured) {
      setConfigOpen((prev) => ({ ...prev, [meta.id]: true }));
      setExpanded((prev) => ({ ...prev, [meta.id]: true }));
      showToast(meta.id === 'cursor' ? '请先配置 Cookie' : '请先配置 API Key');
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await runQueries(meta, usageMonth);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) {
      showToast('Cookie 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveCookie(cookieInput.trim());
      setCookieInput('');
      const list = await refreshProviders();
      showToast('Cookie 已安全保存');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearCookie = async () => {
    try {
      await window.electronAPI.clearCookie();
      const list = await refreshProviders();
      showToast('Cookie 已清除');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveKey = async (id: SubscriptionProviderId) => {
    const value = (keyInputs[id] ?? '').trim();
    if (!value) {
      showToast('API Key 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveSubscriptionKey(id, value);
      setKeyInputs((prev) => ({ ...prev, [id]: '' }));
      const list = await refreshProviders();
      showToast('API Key 已安全保存');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearKey = async (id: SubscriptionProviderId) => {
    try {
      await window.electronAPI.clearSubscriptionKey(id);
      const list = await refreshProviders();
      showToast('API Key 已清除');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveUsageToken = async (id: SubscriptionProviderId) => {
    const value = (usageTokenInputs[id] ?? '').trim();
    if (!value) {
      showToast('用量 Token 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveSubscriptionKey(id, value, 'usageToken');
      setUsageTokenInputs((prev) => ({ ...prev, [id]: '' }));
      const list = await refreshProviders();
      showToast('用量 Token 已安全保存');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearUsageToken = async (id: SubscriptionProviderId) => {
    try {
      await window.electronAPI.clearSubscriptionKey(id, 'usageToken');
      setCache((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? EMPTY_PROVIDER_ENTRY), usage: null, usageError: null },
      }));
      const list = await refreshProviders();
      showToast('用量 Token 已清除');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await window.electronAPI.testConnection();
    setTestResult(result);
    setTesting(false);
  };

  const latestFetchedAt = providers
    .map((p) => cache[p.id]?.info?.fetchedAt ?? cache[p.id]?.usage?.fetchedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();
  const autoRefreshLabel = autoRefreshEnabled
    ? `每 ${Math.round(refreshIntervalSec / 60)} 分钟自动刷新`
    : '自动刷新已暂停';

  return (
    <div className="sub-accounts">
      <div className="sub-accounts__toolbar">
        <div className="sub-accounts__meta">
          <span>{latestFetchedAt ? `查询于 ${formatFetchedAt(latestFetchedAt)}` : '尚未查询'}</span>
          <span aria-hidden>·</span>
          <span>{autoRefreshLabel}</span>
        </div>
        <button
          type="button"
          className="btn-primary btn-primary--compact"
          onClick={handleRefreshAll}
          disabled={refreshing}
        >
          {refreshing ? '正在查询' : '刷新全部'}
        </button>
      </div>

      <div className="account-grid">
        {providers.map((meta) => {
          const entry = cache[meta.id] ?? EMPTY_PROVIDER_ENTRY;
          const health = providerHealth(meta, entry);
          const isOpen = expanded[meta.id] ?? false;
          const isConfigOpen = configOpen[meta.id] ?? false;
          const isCursor = meta.id === 'cursor';
          const collapsedLimits = commandCodeCollapsedLimits(meta.id, entry);
          const planLabel = providerPlanLabel(meta.id, entry);
          return (
            <section
              key={meta.id}
              className={`account-card${isOpen ? ' account-card--open' : ''}${meta.configured ? '' : ' account-card--unconfigured'}`}
            >
              <button
                type="button"
                className="account-card__header"
                aria-expanded={isOpen}
                onClick={() => toggleExpanded(meta.id)}
                title={HEALTH_TITLE[health]}
              >
                <span className={`provider-card__dot provider-card__dot--${health}`} aria-hidden />
                <span className="account-card__title">
                  <span className="account-card__name-row">
                    <span className="account-card__name">{meta.label}</span>
                    {planLabel && (
                      <span className="account-card__plan" title="订阅套餐">
                        {planLabel}
                      </span>
                    )}
                    {collapsedLimits.length > 0 && (
                      <span className="account-card__limits" aria-label="限额摘要">
                        {collapsedLimits.map((limit) => {
                          const tone = limitTone(limit.percent);
                          return (
                            <span
                              key={limit.key}
                              className={`limit-chip limit-chip--${tone}`}
                              title={`${limit.label}已用 ${Math.round(limit.percent)}%`}
                            >
                              <span className="limit-chip__label">{limit.label}</span>
                              <span className="limit-chip__bar" aria-hidden>
                                <span
                                  className={`limit-chip__fill limit-chip__fill--${tone}`}
                                  style={{ width: `${Math.min(100, Math.max(0, limit.percent))}%` }}
                                />
                              </span>
                              <span className="limit-chip__value">{Math.round(limit.percent)}%</span>
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                  <span className="account-card__summary">
                    {providerSummaryLine(meta.id, entry)}
                  </span>
                </span>
                <span className="account-card__header-actions">
                  <span className={`account-card__status account-card__status--${health}`}>
                    {HEALTH_TEXT[health]}
                  </span>
                  <span className="account-card__chevron" aria-hidden>
                    {isOpen ? '▴' : '▾'}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="account-card__body">
                  <div className="account-card__toolbar">
                    <span className="field-hint">
                      {entry.info?.fetchedAt || entry.usage?.fetchedAt
                        ? `查询于 ${formatFetchedAt((entry.info?.fetchedAt ?? entry.usage?.fetchedAt) as string)}`
                        : '尚未查询'}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary btn-secondary--compact"
                      onClick={() => handleRefreshOne(meta)}
                      disabled={refreshing}
                    >
                      刷新
                    </button>
                  </div>

                  {entry.infoError && entry.info?.data && (
                    <ErrorHint
                      tone="warn"
                      message={`最近一次查询失败，当前显示上次结果：${entry.infoError}`}
                    />
                  )}

                  <SubscriptionPanel
                    meta={meta}
                    info={entry.info}
                    usage={entry.usage}
                    infoError={entry.infoError}
                    usageError={entry.usageError}
                    refreshing={refreshing}
                    usageMonth={usageMonth}
                    onUsageMonthChange={setUsageMonth}
                  />

                  <section className="settings-section account-card__config">
                    <button
                      type="button"
                      className="sub-config-toggle"
                      aria-expanded={isConfigOpen}
                      onClick={() => toggleConfig(meta.id)}
                    >
                      <span>{meta.label} 凭据配置</span>
                      <span className="sub-config-toggle__meta">
                        {isCursor
                          ? `Cookie ${meta.configured ? '已配置' : '未配置'}`
                          : `API Key ${meta.configured ? '已配置' : '未配置'}`}
                        {!isCursor && meta.usageSupported &&
                          ` · 用量 Token ${meta.usageConfigured ? '已配置' : '未配置'}`}
                        <span className="sub-config-toggle__chevron">{isConfigOpen ? '▴' : '▾'}</span>
                      </span>
                    </button>

                    {isConfigOpen && (
                      <div className="sub-config-body">
                        {isCursor ? (
                          <div className="sub-config-group">
                            <div
                              className={`settings-section__status ${meta.configured ? 'settings-section__status--ok' : 'settings-section__status--warn'}`}
                            >
                              {meta.configured ? '✓ 已配置 Cookie' : '未配置 Cookie'}
                            </div>
                            <p className="field-hint">
                              打开 cursor.com/dashboard/usage 后，从浏览器开发者工具复制 WorkosCursorSessionToken
                              的值。也可以粘贴包含该字段的完整 Cookie 字符串。
                            </p>
                            <div className="form-group">
                              <label htmlFor="subscription-cookie">WorkosCursorSessionToken</label>
                              <textarea
                                id="subscription-cookie"
                                rows={4}
                                placeholder="粘贴 WorkosCursorSessionToken 值或完整 Cookie..."
                                value={cookieInput}
                                onChange={(e) => setCookieInput(e.target.value)}
                              />
                            </div>
                            <div className="btn-row">
                              <button type="button" className="btn-primary" onClick={handleSaveCookie}>
                                保存 Cookie
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={handleClearCookie}
                                disabled={!meta.configured}
                              >
                                清除 Cookie
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={handleTestConnection}
                                disabled={testing || !meta.configured}
                              >
                                {testing ? '测试中...' : '测试连接'}
                              </button>
                            </div>
                            {testResult && <TestConnectionResultPanel result={testResult} />}
                          </div>
                        ) : (
                          <div className="sub-config-group">
                            <div className="form-group">
                              <label htmlFor={`subscription-key-${meta.id}`}>
                                {meta.label} API Key
                              </label>
                              <input
                                id={`subscription-key-${meta.id}`}
                                type="password"
                                value={keyInputs[meta.id] ?? ''}
                                placeholder={meta.id === 'commandcode' ? 'user_...' : 'sk-...'}
                                onChange={(e) =>
                                  setKeyInputs((prev) => ({ ...prev, [meta.id]: e.target.value }))
                                }
                              />
                              {meta.id === 'commandcode' ? (
                                <p className="field-hint">
                                  留空即自动读取 cmd login 写入的 ~/.commandcode/auth.json；手动保存可覆盖该凭据，
                                  清除后回退自动读取。
                                </p>
                              ) : (
                                <p className="field-hint">用于查询账户余额，出于安全考虑已保存的 Key 不回显</p>
                              )}
                            </div>
                            <div className="btn-row">
                              <button type="button" className="btn-primary" onClick={() => handleSaveKey(meta.id)}>
                                保存 Key
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleClearKey(meta.id)}
                                disabled={!meta.configured}
                              >
                                清除 Key
                              </button>
                            </div>
                          </div>
                        )}

                        {!isCursor && meta.usageSupported && (
                          <div className="sub-config-group">
                            <div className="form-group">
                              <label htmlFor={`subscription-usage-token-${meta.id}`}>
                                用量 Token（与 API Key 不同）
                              </label>
                              <input
                                id={`subscription-usage-token-${meta.id}`}
                                type="password"
                                value={usageTokenInputs[meta.id] ?? ''}
                                placeholder="网页登录后提取的 Token"
                                onChange={(e) =>
                                  setUsageTokenInputs((prev) => ({ ...prev, [meta.id]: e.target.value }))
                                }
                              />
                              <p className="field-hint">
                                获取方式：浏览器登录 platform.deepseek.com 后按 F12 打开控制台，执行
                                JSON.parse(localStorage.userToken).value 并复制结果。Token 会过期，查询提示
                                401 时需重新获取。
                              </p>
                            </div>
                            <div className="btn-row">
                              <button type="button" className="btn-primary" onClick={() => handleSaveUsageToken(meta.id)}>
                                保存 Token
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleClearUsageToken(meta.id)}
                                disabled={!meta.usageConfigured}
                              >
                                清除 Token
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {toast && <p className="settings-toast">{toast}</p>}
    </div>
  );
}
