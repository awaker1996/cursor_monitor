import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorHint from '../components/ErrorHint';
import ProviderSwitcher from '../components/ProviderSwitcher';
import SubscriptionPanel from '../components/SubscriptionPanels';
import TestConnectionResultPanel from '../components/TestConnectionResultPanel';
import {
  EMPTY_PROVIDER_ENTRY,
  formatFetchedAt,
  currentMonthValue,
  parseMonthValue,
  type ProviderCacheEntry,
} from '../components/SubscriptionUtils';
import type {
  SubscriptionCacheSnapshot,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';
import type { AppSettings, TestConnectionResult } from '../../shared/types';

export default function SubscriptionsPage() {
  const [providers, setProviders] = useState<SubscriptionProviderMeta[]>([]);
  const [activeId, setActiveId] = useState<SubscriptionProviderId>('cursor');
  const [toast, setToast] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [cookieInput, setCookieInput] = useState('');
  const [usageTokenInput, setUsageTokenInput] = useState('');
  const [sessionInput, setSessionInput] = useState('');
  const [usageMonth, setUsageMonth] = useState(currentMonthValue());
  const [refreshing, setRefreshing] = useState(false);
  const [cache, setCache] = useState<Partial<Record<SubscriptionProviderId, ProviderCacheEntry>>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const initRef = useRef(false);
  const refreshingRef = useRef(false);
  const providersRef = useRef<SubscriptionProviderMeta[]>([]);
  const monthRef = useRef(usageMonth);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 读取设置页的刷新配置
  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);
    const unsub = window.electronAPI.onSettingsChanged((s) => setSettings(s));
    return unsub;
  }, []);

  const refreshProviders = useCallback(async (): Promise<SubscriptionProviderMeta[]> => {
    const list = await window.electronAPI.listSubscriptionProviders();
    setProviders(list);
    setActiveId((prev) => (list.length > 0 && !list.some((p) => p.id === prev) ? list[0].id : prev));
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

  const active = providers.find((p) => p.id === activeId) ?? null;

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
      const first = list.find((p) => p.configured) ?? list[0];
      setConfigOpen(
        !first?.configured ||
          (Boolean(first?.usageSupported) && !first?.usageConfigured) ||
          (Boolean(first?.sessionSupported) && !first?.sessionConfigured),
      );
      await refreshAll(list, currentMonthValue());
    })();
  }, [refreshProviders, refreshAll]);

  // 自动刷新：取设置页的 autoRefreshEnabled 和 refreshIntervalSec
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

  const handleSelectProvider = (id: SubscriptionProviderId) => {
    if (id === activeId) return;
    setActiveId(id);
    setKeyInput('');
    setCookieInput('');
    setUsageTokenInput('');
    setSessionInput('');
    setTestResult(null);
    const meta = providers.find((p) => p.id === id);
    setConfigOpen(
      !meta?.configured ||
        (Boolean(meta?.usageSupported) && !meta?.usageConfigured) ||
        (Boolean(meta?.sessionSupported) && !meta?.sessionConfigured),
    );
  };

  const handleRefresh = async () => {
    if (!active) return;
    if (!active.configured) {
      setConfigOpen(true);
      showToast(activeId === 'cursor' ? '请先配置 Cookie' : '请先配置 API Key');
      return;
    }
    await refreshAll(providers, usageMonth);
  };

  const handleSaveKey = async () => {
    if (activeId === 'cursor') {
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
      return;
    }
    if (!keyInput.trim()) {
      showToast('API Key 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveSubscriptionKey(activeId, keyInput.trim());
      setKeyInput('');
      const list = await refreshProviders();
      showToast('API Key 已安全保存');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearKey = async () => {
    if (activeId === 'cursor') {
      try {
        await window.electronAPI.clearCookie();
        const list = await refreshProviders();
        showToast('Cookie 已清除');
        await refreshAll(list, usageMonth);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    try {
      await window.electronAPI.clearSubscriptionKey(activeId);
      const list = await refreshProviders();
      showToast('API Key 已清除');
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

  const handleSaveUsageToken = async () => {
    if (!usageTokenInput.trim()) {
      showToast('用量 Token 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveSubscriptionKey(activeId, usageTokenInput.trim(), 'usageToken');
      setUsageTokenInput('');
      const list = await refreshProviders();
      showToast('用量 Token 已安全保存');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearUsageToken = async () => {
    try {
      await window.electronAPI.clearSubscriptionKey(activeId, 'usageToken');
      setCache((prev) => ({
        ...prev,
        [activeId]: { ...(prev[activeId] ?? EMPTY_PROVIDER_ENTRY), usage: null, usageError: null },
      }));
      const list = await refreshProviders();
      showToast('用量 Token 已清除');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveSession = async () => {
    if (!sessionInput.trim()) {
      showToast('流水会话凭据不能为空');
      return;
    }
    try {
      await window.electronAPI.saveSubscriptionKey(activeId, sessionInput.trim(), 'sessionToken');
      setSessionInput('');
      const list = await refreshProviders();
      showToast('流水会话凭据已安全保存');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearSession = async () => {
    try {
      await window.electronAPI.clearSubscriptionKey(activeId, 'sessionToken');
      const list = await refreshProviders();
      showToast('流水会话凭据已清除');
      await refreshAll(list, usageMonth);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const activeEntry = cache[activeId] ?? EMPTY_PROVIDER_ENTRY;
  const lastFetchedAt = activeEntry.info?.fetchedAt ?? activeEntry.usage?.fetchedAt;
  const isCursor = activeId === 'cursor';
  const autoRefreshLabel = autoRefreshEnabled
    ? `每 ${Math.round(refreshIntervalSec / 60)} 分钟自动刷新`
    : '自动刷新已暂停';

  return (
    <div className="page-shell page-shell--subscriptions">
      <header className="page-shell__header">
        <div className="page-shell__title-wrap">
          <h1>订阅</h1>
          <p className="page-shell__subtitle">查询各平台订阅用量与余额信息</p>
        </div>
        <div className="page-shell__actions">
          <button
            type="button"
            className="btn-primary btn-primary--compact"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? '正在查询' : '刷新'}
          </button>
        </div>
      </header>

      <div className="page-shell__meta">
        <span className="page-shell__meta-left">
          {lastFetchedAt ? `查询于 ${formatFetchedAt(lastFetchedAt)}` : '尚未查询'}
        </span>
        <span className="page-shell__meta-right">{autoRefreshLabel}</span>
      </div>

      <ProviderSwitcher
        providers={providers}
        activeId={activeId}
        cache={cache}
        onSelect={handleSelectProvider}
      />

      {activeEntry.infoError && activeEntry.info?.data && (
        <ErrorHint
          tone="warn"
          message={`最近一次查询失败，当前显示上次结果：${activeEntry.infoError}`}
        />
      )}

      {active && (
        <SubscriptionPanel
          meta={active}
          info={activeEntry.info}
          usage={activeEntry.usage}
          infoError={activeEntry.infoError}
          usageError={activeEntry.usageError}
          refreshing={refreshing}
          usageMonth={usageMonth}
          onUsageMonthChange={setUsageMonth}
        />
      )}

      <section className="settings-section">
        <button
          type="button"
          className="sub-config-toggle"
          aria-expanded={configOpen}
          onClick={() => setConfigOpen((open) => !open)}
        >
          <span>{active ? `${active.label} 凭据配置` : '凭据配置'}</span>
          <span className="sub-config-toggle__meta">
            {isCursor
              ? `Cookie ${active?.configured ? '已配置' : '未配置'}`
              : `API Key ${active?.configured ? '已配置' : '未配置'}`}
            {!isCursor && active?.usageSupported &&
              ` · 用量 Token ${active.usageConfigured ? '已配置' : '未配置'}`}
            {!isCursor && active?.sessionSupported &&
              ` · 流水凭据 ${active.sessionConfigured ? '已配置' : '未配置'}`}
            <span className="sub-config-toggle__chevron">{configOpen ? '▴' : '▾'}</span>
          </span>
        </button>

        {configOpen && (
          <div className="sub-config-body">
            {isCursor ? (
              <div className="sub-config-group">
                <div
                  className={`settings-section__status ${active?.configured ? 'settings-section__status--ok' : 'settings-section__status--warn'}`}
                >
                  {active?.configured ? '✓ 已配置 Cookie' : '未配置 Cookie'}
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
                  <button type="button" className="btn-primary" onClick={handleSaveKey}>
                    保存 Cookie
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleClearKey}
                    disabled={!active?.configured}
                  >
                    清除 Cookie
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleTestConnection}
                    disabled={testing || !active?.configured}
                  >
                    {testing ? '测试中...' : '测试连接'}
                  </button>
                </div>
                {testResult && <TestConnectionResultPanel result={testResult} />}
              </div>
            ) : (
              <div className="sub-config-group">
                <div className="form-group">
                  <label htmlFor="subscription-key">
                    {active ? `${active.label} API Key` : 'API Key'}
                  </label>
                  <input
                    id="subscription-key"
                    type="password"
                    value={keyInput}
                    placeholder={activeId === 'commandcode' ? 'user_...' : 'sk-...'}
                    onChange={(e) => setKeyInput(e.target.value)}
                  />
                  {activeId === 'commandcode' ? (
                    <p className="field-hint">
                      留空即自动读取 cmd login 写入的 ~/.commandcode/auth.json；手动保存可覆盖该凭据，
                      清除后回退自动读取。
                    </p>
                  ) : (
                    <p className="field-hint">用于查询账户余额，出于安全考虑已保存的 Key 不回显</p>
                  )}
                </div>
                <div className="btn-row">
                  <button type="button" className="btn-primary" onClick={handleSaveKey}>
                    保存 Key
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleClearKey}
                    disabled={!active?.configured}
                  >
                    清除 Key
                  </button>
                </div>
              </div>
            )}

            {!isCursor && active?.usageSupported && (
              <div className="sub-config-group">
                <div className="form-group">
                  <label htmlFor="subscription-usage-token">用量 Token（与 API Key 不同）</label>
                  <input
                    id="subscription-usage-token"
                    type="password"
                    value={usageTokenInput}
                    placeholder="网页登录后提取的 Token"
                    onChange={(e) => setUsageTokenInput(e.target.value)}
                  />
                  <p className="field-hint">
                    获取方式：浏览器登录 platform.deepseek.com 后按 F12 打开控制台，执行
                    JSON.parse(localStorage.userToken).value 并复制结果。Token 会过期，查询提示
                    401 时需重新获取。
                  </p>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn-primary" onClick={handleSaveUsageToken}>
                    保存 Token
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleClearUsageToken}
                    disabled={!active.usageConfigured}
                  >
                    清除 Token
                  </button>
                </div>
              </div>
            )}

            {!isCursor && active?.sessionSupported && (
              <div className="sub-config-group">
                <div className="form-group">
                  <label htmlFor="subscription-session">流水凭据（网页会话）</label>
                  <input
                    id="subscription-session"
                    type="password"
                    value={sessionInput}
                    placeholder="登录 commandcode.ai 后的 Cookie 或会话 Token"
                    onChange={(e) => setSessionInput(e.target.value)}
                  />
                  <p className="field-hint">
                    逐条流水仅浏览器会话可访问（API Key 会返回 401）。登录 commandcode.ai 后，
                    从开发者工具 Network 复制请求的 Cookie，或粘贴浏览器存储中的会话 Token。
                  </p>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn-primary" onClick={handleSaveSession}>
                    保存凭据
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleClearSession}
                    disabled={!active.sessionConfigured}
                  >
                    清除凭据
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {toast && <p className="settings-toast">{toast}</p>}
    </div>
  );
}
