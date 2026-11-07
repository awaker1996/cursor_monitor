import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { spawnSync } from 'node:child_process';
import { createLogger } from '../utils/logger';

const log = createLogger('HttpClient');

/** 本地 HTTP 代理配置（Clash / V2Ray 之类）。 */
export interface ProxyConfig {
  host: string;
  port: number;
  /** 已编码的 Proxy-Authorization 头，绝大多数本地代理不需要。 */
  authorization?: string;
}

/**
 * 统一响应视图。
 *
 * Electron 主进程里的 `fetch` 是 Node/undici 实现，**不读系统代理**，
 * 直连 cursor.com 时会间歇性被 TLS 重置（ECONNRESET），表现为「明细接口
 * 取不到 → 界面回填缓存」。这里用一个最小接口把「直连 fetch」和
 * 「经代理 CONNECT 隧道」两条链路抹平，调用方只依赖 status/headers/text。
 */
export interface HttpResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

const WINDOWS_PROXY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function parseProxyValue(value: string): ProxyConfig | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;

  // 允许 "127.0.0.1:7890"、"http://127.0.0.1:7890"、"user:pass@host:port"
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const port = url.port ? Number(url.port) : defaultPort;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    const authorization =
      url.username || url.password
        ? `Basic ${Buffer.from(
            `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
          ).toString('base64')}`
        : undefined;
    return { host: url.hostname, port, ...(authorization ? { authorization } : {}) };
  } catch {
    return null;
  }
}

/** 解析 `ProxyServer` 的 `http=host:port;https=host:port` 形式。 */
function parseWindowsProxyServer(server: string): ProxyConfig | null {
  const entries = server
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const byScheme = new Map<string, string>();
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index === -1) {
      byScheme.set('default', entry);
      continue;
    }
    byScheme.set(entry.slice(0, index).trim().toLowerCase(), entry.slice(index + 1).trim());
  }

  const candidate = byScheme.get('https') ?? byScheme.get('http') ?? byScheme.get('default');
  return candidate ? parseProxyValue(candidate) : null;
}

function detectEnvProxy(): ProxyConfig | null {
  const { env } = process;
  const candidates = [
    env.HTTPS_PROXY,
    env.https_proxy,
    env.ALL_PROXY,
    env.all_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
  ];
  for (const candidate of candidates) {
    const parsed = candidate ? parseProxyValue(candidate) : null;
    if (parsed) return parsed;
  }
  return null;
}

function detectWindowsProxy(): ProxyConfig | null {
  if (process.platform !== 'win32') return null;
  try {
    const result = spawnSync('reg', ['query', WINDOWS_PROXY_KEY], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    if (result.status !== 0 || !result.stdout) return null;

    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(result.stdout);
    if (!enabled) return null;
    const serverMatch = result.stdout.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
    if (!serverMatch) return null;
    return parseWindowsProxyServer(serverMatch[1]);
  } catch {
    return null;
  }
}

/** 解析 Chromium `resolveProxy` 的结果，如 `PROXY 127.0.0.1:7890; DIRECT`。 */
export function parseResolvedProxy(result: string): ProxyConfig | null {
  for (const entry of result.split(';')) {
    const value = entry.trim();
    if (!value || /^DIRECT$/i.test(value)) continue;
    const match = value.match(/^(PROXY|HTTPS|HTTP)\s+(\S+)$/i);
    if (match) {
      const parsed = parseProxyValue(match[2]);
      if (parsed) return parsed;
    }
    // SOCKS 隧道不在本客户端支持范围内，跳过（宁可直连也不发错协议）。
  }
  return null;
}

/**
 * 读取 Electron / 系统代理。
 *
 * 优先级：环境变量 → Chromium `resolveProxy`（跟随系统设置、支持 PAC）→
 * Windows 注册表。全程只探测一次并缓存；任何一步失败都退回直连。
 */
async function detectElectronProxy(): Promise<ProxyConfig | null> {
  try {
    const electron = await import('electron');
    const session = (electron as { session?: { defaultSession?: { resolveProxy?: (url: string) => Promise<string> } } })
      .session;
    const resolved = await session?.defaultSession?.resolveProxy?.('https://cursor.com');
    return resolved ? parseResolvedProxy(resolved) : null;
  } catch {
    return null;
  }
}

let cachedProxyPromise: Promise<ProxyConfig | null> | null = null;

/** 探测一次系统代理（结果缓存）。 */
export function detectSystemProxy(): Promise<ProxyConfig | null> {
  if (!cachedProxyPromise) {
    cachedProxyPromise = (async () => {
      const fromEnv = detectEnvProxy();
      const detected = fromEnv ?? (await detectElectronProxy()) ?? detectWindowsProxy();
      if (detected) {
        log.info('检测到系统代理，cursor.com 请求将走代理', {
          host: detected.host,
          port: detected.port,
          fromEnv: Boolean(fromEnv),
        });
      } else {
        log.info('未检测到可用系统代理，cursor.com 请求直连');
      }
      return detected;
    })();
  }
  return cachedProxyPromise;
}

/** 设置变更或网络切换后强制重新探测。 */
export function resetProxyCache(): void {
  cachedProxyPromise = null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

async function directRequest(url: string, init: HttpRequestInit): Promise<HttpResponseLike> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
    // 与隧道链路保持一致：不自动跟随重定向，避免把登录页 HTML 当成 200 正常响应。
    redirect: 'manual',
    signal: init.signal,
  });
  const body = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    headers: { get: (name) => response.headers.get(name) },
    text: async () => body,
  };
}

/**
 * 隧道 Agent：先向代理发起 `CONNECT host:443`，握手成功后在隧道上做 TLS。
 * 组件本身不是标准 Agent 子类（Node 允许 `createConnection` 返回异步回调），
 * 这里直接覆盖实例方法以避免与 d.ts 签名冲突。
 */
function createTunnelAgent(proxy: ProxyConfig, target: URL): https.Agent {
  const agent = new https.Agent({ keepAlive: false });
  const timeoutMs = 15000;

  (agent as unknown as {
    createConnection: (
      options: { servername?: string },
      oncreate?: (error: Error | null, socket?: tls.TLSSocket) => void,
    ) => undefined;
  }).createConnection = (options, oncreate) => {
    const finish = oncreate ?? (() => undefined);
    const fail = (error: Error) => finish(error);

    const connectRequest = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
      headers: {
        Host: `${target.hostname}:${target.port || 443}`,
        ...(proxy.authorization ? { 'Proxy-Authorization': proxy.authorization } : {}),
      },
      timeout: timeoutMs,
    });

    connectRequest.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`proxy CONNECT rejected with HTTP ${response.statusCode}`));
        return;
      }
      const secure = tls.connect(
        {
          socket,
          servername: options.servername || target.hostname,
          // Cursor 支持 h2，这里只声明 http/1.1，避免协议协商跑偏。
          ALPNProtocols: ['http/1.1'],
        },
        () => finish(null, secure),
      );
      secure.once('error', fail);
    });
    connectRequest.once('timeout', () => {
      connectRequest.destroy(new Error('proxy CONNECT timeout'));
    });
    connectRequest.once('error', fail);
    connectRequest.end();
    return undefined;
  };

  return agent;
}

function proxyRequest(
  target: URL,
  init: HttpRequestInit,
  proxy: ProxyConfig,
): Promise<HttpResponseLike> {
  // fetch 会自动补 Content-Length；这里手写请求，缺了它会退化成 chunked 上传，
  // 部分接口对 chunked 的 JSON body 处理不一致。
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) {
    headers['Content-Length'] = String(Buffer.byteLength(init.body));
  }

  return new Promise<HttpResponseLike>((resolve, reject) => {
    const request = https.request(
      {
        host: target.hostname,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? 'GET',
        headers,
        agent: createTunnelAgent(proxy, target),
        signal: init.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const headers = response.headers;
          const status = response.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: {
              get: (name: string) => {
                const value = headers[name.toLowerCase()];
                return Array.isArray(value) ? value.join(', ') : (value ?? null);
              },
            },
            text: async () => body,
          });
        });
      },
    );

    request.once('error', reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}

/** 代理本身不可用时（关掉了代理软件）才有必要退回直连，其他错误交给上层重试。 */
function isProxyUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') return true;
  return /proxy CONNECT (rejected|timeout)/i.test(error.message);
}

/**
 * 发请求：有系统代理且目标是公网 https 时走 CONNECT 隧道，
 * 否则沿用原生 fetch（脚本、无代理环境行为不变）。
 * 代理进程本身不可用时自动退回直连，避免「代理关了应用就全挂」。
 */
export async function httpRequest(
  url: string,
  init: HttpRequestInit = {},
): Promise<HttpResponseLike> {
  const proxy = await detectSystemProxy();
  if (!proxy) return directRequest(url, init);

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return directRequest(url, init);
  }
  if (target.protocol !== 'https:' || isLoopbackHost(target.hostname)) {
    return directRequest(url, init);
  }

  try {
    return await proxyRequest(target, init, proxy);
  } catch (error) {
    if (!isProxyUnavailable(error)) throw error;
    log.warn('代理不可用，本次请求退回直连', {
      host: proxy.host,
      port: proxy.port,
      error: error instanceof Error ? error.message : String(error),
    });
    return directRequest(url, init);
  }
}
