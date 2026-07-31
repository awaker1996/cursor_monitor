import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
  SubscriptionUsageResult,
} from '../../shared/subscriptionTypes';

function formatFetchedAt(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatTokens(value: number): string {
  return value.toLocaleString('zh-CN');
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthValue(value: string): { month: number; year: number } | null {
  const [yearStr, monthStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  return { month, year };
}

export default function SubscriptionsPage() {
  const [providers, setProviders] = useState<SubscriptionProviderMeta[]>([]);
  const [activeId, setActiveId] = useState<SubscriptionProviderId>('deepseek');
  const [toast, setToast] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [usageTokenInput, setUsageTokenInput] = useState('');
  const [usageMonth, setUsageMonth] = useState(currentMonthValue());
  const [refreshing, setRefreshing] = useState(false);
  const [balanceResult, setBalanceResult] = useState<SubscriptionInfoResult | null>(null);
  const [usageResult, setUsageResult] = useState<SubscriptionUsageResult | null>(null);
  const initRef = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshProviders = useCallback(async (): Promise<SubscriptionProviderMeta[]> => {
    const list = await window.electronAPI.listSubscriptionProviders();
    setProviders(list);
    setActiveId((prev) =>
      list.length > 0 && !list.some((p) => p.id === prev) ? list[0].id : prev,
    );
    return list;
  }, []);

  /** 一次刷新同时拉取余额与当月用量，避免两块数据割裂。 */
  const runQueries = useCallback(
    async (meta: SubscriptionProviderMeta, monthValue: string) => {
      const period = parseMonthValue(monthValue);
      setRefreshing(true);
      try {
        const balancePromise = window.electronAPI.fetchSubscriptionInfo(meta.id);
        const usagePromise =
          meta.usageSupported && meta.usageConfigured && period
            ? window.electronAPI.fetchSubscriptionUsage(meta.id, period)
            : Promise.resolve<SubscriptionUsageResult | null>(null);
        const [balance, usage] = await Promise.all([balancePromise, usagePromise]);
        setBalanceResult(balance);
        setUsageResult(usage);
      } catch (e) {
        setBalanceResult({
          success: false,
          providerId: meta.id,
          message: e instanceof Error ? e.message : String(e),
        });
        setUsageResult(null);
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      const list = await refreshProviders();
      const first = list[0];
      if (!first) return;
      // 凭据未配置时默认展开配置区；已配置则直接自动拉取数据
      setConfigOpen(!first.configured || (first.usageSupported && !first.usageConfigured));
      if (first.configured) {
        void runQueries(first, currentMonthValue());
      }
    })();
  }, [refreshProviders, runQueries]);

  const active = providers.find((p) => p.id === activeId) ?? null;

  const handleSelectProvider = (id: SubscriptionProviderId) => {
    if (id === activeId) return;
    setActiveId(id);
    setKeyInput('');
    setUsageTokenInput('');
    setBalanceResult(null);
    setUsageResult(null);
  };

  const handleRefresh = async () => {
    if (!active) return;
    if (!active.configured) {
      setConfigOpen(true);
      showToast('请先配置 API Key');
      return;
    }
    await runQueries(active, usageMonth);
  };

  const handleSaveKey = async () => {
    if (!keyInput.trim()) {
      showToast('API Key 不能为空');
      return;
    }
    try {
      await window.electronAPI.saveSubscriptionKey(activeId, keyInput.trim());
      setKeyInput('');
      const list = await refreshProviders();
      showToast('API Key 已安全保存');
      const meta = list.find((p) => p.id === activeId);
      if (meta?.configured) {
        void runQueries(meta, usageMonth);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearKey = async () => {
    try {
      await window.electronAPI.clearSubscriptionKey(activeId);
      setBalanceResult(null);
      await refreshProviders();
      showToast('API Key 已清除');
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
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
      const meta = list.find((p) => p.id === activeId);
      if (meta?.configured) {
        void runQueries(meta, usageMonth);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearUsageToken = async () => {
    try {
      await window.electronAPI.clearSubscriptionKey(activeId, 'usageToken');
      setUsageResult(null);
      await refreshProviders();
      showToast('用量 Token 已清除');
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const lastFetchedAt = balanceResult?.fetchedAt ?? usageResult?.fetchedAt;
  const balanceData =
    balanceResult?.success && balanceResult.data?.providerId === 'deepseek'
      ? balanceResult.data
      : null;
  const usageData =
    usageResult?.success && usageResult.data?.providerId === 'deepseek'
      ? usageResult.data
      : null;

  return (
    <div className="settings-page subscription-page">
      <h1>其他订阅</h1>
      <p className="settings-subtitle">查询第三方平台的订阅余额与用量信息</p>

      <div className="subscription-provider-tabs">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            className={
              p.id === activeId
                ? 'subscription-provider-tab subscription-provider-tab--active'
                : 'subscription-provider-tab'
            }
            onClick={() => handleSelectProvider(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <section className="settings-section subscription-overview">
        <div className="subscription-overview__toolbar">
          <h2>订阅概览</h2>
          <div className="subscription-usage-controls">
            <input
              type="month"
              value={usageMonth}
              onChange={(e) => setUsageMonth(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>
        {lastFetchedAt && (
          <p className="field-hint">查询时间 {formatFetchedAt(lastFetchedAt)}</p>
        )}

        <div className="subscription-block">
          <h3 className="subscription-block__title">账户余额</h3>
          {!active?.configured ? (
            <p className="field-hint">尚未配置 API Key，请在下方"凭据配置"中完成配置</p>
          ) : balanceResult && !balanceResult.success ? (
            <div className="subscription-inline-error">{balanceResult.message ?? '查询失败'}</div>
          ) : balanceData ? (
            <div className="subscription-balance">
              <span
                className={
                  balanceData.isAvailable
                    ? 'subscription-status subscription-status--ok'
                    : 'subscription-status subscription-status--bad'
                }
              >
                {balanceData.isAvailable ? '可用' : '不可用'}
              </span>
              {balanceData.balances.length === 0 ? (
                <span className="field-hint">接口未返回余额明细</span>
              ) : (
                balanceData.balances.map((b) => (
                  <div className="subscription-balance__item" key={b.currency}>
                    <div>
                      <span className="subscription-balance__amount">{b.totalBalance}</span>
                      <span className="subscription-balance__currency">{b.currency}</span>
                    </div>
                    <span className="subscription-balance__detail">
                      充值 {b.toppedUpBalance} · 赠送 {b.grantedBalance}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <p className="field-hint">{refreshing ? '加载中...' : '暂无数据，点击刷新查询'}</p>
          )}
        </div>

        {active?.usageSupported && (
          <div className="subscription-block">
            <h3 className="subscription-block__title">
              {parseMonthValue(usageMonth)
                ? `${parseMonthValue(usageMonth)!.year} 年 ${parseMonthValue(usageMonth)!.month} 月用量`
                : '月度用量'}
            </h3>
            {!active.usageConfigured ? (
              <p className="field-hint">
                尚未配置用量 Token，请在下方"凭据配置"中完成配置（数据来自平台控制台内部接口）
              </p>
            ) : usageResult && !usageResult.success ? (
              <div className="subscription-inline-error">{usageResult.message ?? '查询失败'}</div>
            ) : usageData ? (
              <>
                <p className="subscription-usage-summary">
                  总 Token {formatTokens(usageData.totalTokens)} · 总请求数{' '}
                  {formatTokens(usageData.totalRequests)}
                </p>
                {usageData.models.length === 0 ? (
                  <p className="field-hint">该月份无用量记录</p>
                ) : (
                  <table className="subscription-balance-table">
                    <thead>
                      <tr>
                        <th>模型</th>
                        <th>总 Token</th>
                        <th>输出 Token</th>
                        <th>缓存命中率</th>
                        <th>请求数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.models.map((m) => (
                        <tr key={m.model}>
                          <td>{m.model}</td>
                          <td>{formatTokens(m.totalTokens)}</td>
                          <td>{formatTokens(m.responseTokens)}</td>
                          <td>
                            {m.cacheHitRatePercent == null ? '-' : `${m.cacheHitRatePercent}%`}
                          </td>
                          <td>{formatTokens(m.requests)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <p className="field-hint">{refreshing ? '加载中...' : '暂无数据，点击刷新查询'}</p>
            )}
          </div>
        )}
      </section>

      <section className="settings-section">
        <button
          type="button"
          className="subscription-config-toggle"
          onClick={() => setConfigOpen((open) => !open)}
        >
          <span>凭据配置</span>
          <span className="subscription-config-toggle__meta">
            API Key {active?.configured ? '已配置' : '未配置'}
            {active?.usageSupported &&
              ` · 用量 Token ${active.usageConfigured ? '已配置' : '未配置'}`}
            <span className="subscription-config-toggle__chevron">{configOpen ? '▴' : '▾'}</span>
          </span>
        </button>

        {configOpen && (
          <div className="subscription-config-body">
            <div className="subscription-config-group">
              <div className="form-group">
                <label htmlFor="subscription-key">
                  {active ? `${active.label} API Key` : 'API Key'}
                </label>
                <input
                  id="subscription-key"
                  type="password"
                  value={keyInput}
                  placeholder="sk-..."
                  onChange={(e) => setKeyInput(e.target.value)}
                />
                <p className="field-hint">用于查询账户余额，出于安全考虑已保存的 Key 不回显</p>
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

            {active?.usageSupported && (
              <div className="subscription-config-group">
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
          </div>
        )}
      </section>

      {toast && <p className="settings-toast">{toast}</p>}
    </div>
  );
}
