/**
 * Verify agent-trace parser against a simulated Cursor cursorDiskKV.
 * Run: npx tsx scripts/verify-agent-trace.ts
 *
 * 覆盖：
 *   - composer + bubble + ofsContent + diffFates 全链路解析
 *   - thinking / tool_call / tool_result / assistant / user 五类 turn
 *   - 字段缺失 / 无 composer / 空 composer / sub-agent 排除
 */
import Database from 'better-sqlite3';
import { parseLatestTrace, parseLatestBubbleFallback } from '../src/core/agentTrace/parser';
import { CURSOR_KV_TABLE, detectCursorKvTable } from '../src/core/agentTrace/cursorSchema';

function assert(name: string, condition: boolean, detail?: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  }
  console.log(`OK: ${name}`);
}

function setupCursorLikeDb(): Database.Database {
  const db = new Database(':memory:');

  // 模拟 Cursor state.vscdb：一张 cursorDiskKV 表，key/value 两列
  db.exec(`CREATE TABLE ${CURSOR_KV_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  // 模拟 ItemTable（无关数据）
  db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const now = 1700000000000;
  const composerId = 'cmp-test-001';

  // composerData 主记录
  const composer = {
    _v: 3,
    composerId,
    name: '测试 composer',
    richText: '',
    hasLoaded: true,
    text: '',
    fullConversationHeadersOnly: [
      { bubbleId: 'b-1', type: 1, createdAt: '2023-11-14T22:13:20.000Z' },
      { bubbleId: 'b-2', type: 2, createdAt: '2023-11-14T22:13:21.000Z' },
      { bubbleId: 'b-3', type: 2, createdAt: '2023-11-14T22:13:22.000Z' },
      { bubbleId: 'b-4', type: 1, createdAt: '2023-11-14T22:13:23.000Z' },
      { bubbleId: 'b-5', type: 2, createdAt: '2023-11-14T22:13:24.000Z' },
    ],
    conversationMap: {},
    status: 'none',
    context: {},
    capabilities: [],
    lastUpdatedAt: now + 24000,
    createdAt: now,
  };
  db.prepare(`INSERT INTO ${CURSOR_KV_TABLE} (key, value) VALUES (?, ?)`).run(
    `composerData:${composerId}`,
    JSON.stringify(composer),
  );

  const insertKv = (key: string, value: unknown) => {
    db.prepare(`INSERT INTO ${CURSOR_KV_TABLE} (key, value) VALUES (?, ?)`).run(
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  };

  // bubble 1：用户消息
  insertKv(`bubbleId:${composerId}:b-1`, {
    _v: 3,
    type: 1,
    text: '帮我实现冒泡排序',
    createdAt: '2023-11-14T22:13:20.000Z',
  });
  // bubble 2：AI thinking + 工具调用
  insertKv(`bubbleId:${composerId}:b-2`, {
    _v: 3,
    type: 2,
    text: '',
    thinking: { text: '我需要先看看现有代码，然后实现冒泡排序', signature: '' },
    createdAt: '2023-11-14T22:13:21.000Z',
  });
  // bubble 2 关联 read_file
  insertKv(`ofsContent:b-2:file:///tmp/foo.ts`, { content: '// existing file\n' });
  // bubble 3：AI 最终回复
  insertKv(`bubbleId:${composerId}:b-3`, {
    _v: 3,
    type: 2,
    text: '```ts\nfunction bubbleSort(arr: number[]) { /* ... */ }\n```',
    thinking: null,
    createdAt: '2023-11-14T22:13:22.000Z',
  });
  // bubble 4：用户追问
  insertKv(`bubbleId:${composerId}:b-4`, {
    _v: 3,
    type: 1,
    text: '再加个降序选项',
    createdAt: '2023-11-14T22:13:23.000Z',
  });
  // bubble 5：AI 思考 + 编辑文件
  insertKv(`bubbleId:${composerId}:b-5`, {
    _v: 3,
    type: 2,
    text: '已添加 order 参数',
    thinking: { text: '需要给 bubbleSort 加 order 参数', signature: '' },
    createdAt: '2023-11-14T22:13:24.000Z',
  });
  insertKv(`codeBlockPartialInlineDiffFates:b-5:file:///tmp/foo.ts`, {
    fates: [
      {
        removedLines: [],
        addedLines: ['function bubbleSort(arr, order = "asc") {}'],
        fate: 'accepted',
      },
    ],
  });

  // 加一个 sub-agent composer（task-tool_*），应被忽略
  insertKv(`composerData:task-tool_ea3ed52e-7e1e-423a-bbf1-34fc72b33c2`, {
    _v: 3,
    composerId: 'task-tool_ea3ed52e-7e1e-423a-bbf1-34fc72b33c2',
    fullConversationHeadersOnly: [],
    lastUpdatedAt: now + 99999,
  });

  // 一条无关 ItemTable
  db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('windowState-1', '{"x":0}');

  return db;
}

console.log('parser: detectCursorKvTable');
{
  const db = setupCursorLikeDb();
  assert('detectCursorKvTable true', detectCursorKvTable(db) === true);
}

console.log('\nparser: 完整 cursorDiskKV → turn');
{
  const db = setupCursorLikeDb();
  const parsed = parseLatestTrace(db);

  assert('composerId 是 cmp-test-001', parsed.composerId === 'cmp-test-001');
  assert('composerName 正确', parsed.composerName === '测试 composer');
  assert('lastUpdatedAt > 0', parsed.lastUpdatedAt > 0);

  const types = parsed.turns.map((t) => t.type);
  console.log(`  turn 顺序: ${types.join(', ')}`);
  assert('包含 thinking', types.includes('thinking'));
  assert('包含 tool_call', types.includes('tool_call'));
  assert('包含 tool_result', types.includes('tool_result'));
  assert('包含 assistant', types.includes('assistant'));
  assert('包含 user', types.includes('user'));

  const toolCalls = parsed.turns.filter((t) => t.type === 'tool_call');
  assert(
    '有 read_file 调用',
    toolCalls.some((t) => t.text.startsWith('read_file')),
  );
  assert(
    '有 edit_file 调用',
    toolCalls.some((t) => t.text.startsWith('edit_file')),
  );

  const toolResults = parsed.turns.filter((t) => t.type === 'tool_result');
  assert('tool_result 数量 >= 2', toolResults.length >= 2);

  const userTurns = parsed.turns.filter((t) => t.type === 'user');
  assert('user turn 文本保留', userTurns.some((t) => t.text.includes('冒泡排序')));

  const assistants = parsed.turns.filter((t) => t.type === 'assistant');
  assert('assistant turn 文本保留', assistants.some((t) => t.text.includes('bubbleSort')));

  // index 连续
  const indices = parsed.turns.map((t) => t.index);
  const sorted = [...indices].sort((a, b) => a - b);
  assert(
    'index 是连续递增',
    indices.every((v, i) => v === sorted[i]),
  );
}

console.log('\nparser: sub-agent composer 被忽略');
{
  const db = setupCursorLikeDb();
  const parsed = parseLatestTrace(db);
  assert('不选 sub-agent', parsed.composerId === 'cmp-test-001');
}

console.log('\nparser: 空 cursorDiskKV');
{
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE ${CURSOR_KV_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const parsed = parseLatestTrace(db);
  assert('空库 → turns 为空', parsed.turns.length === 0);
  assert('warning 提到无 composerData', parsed.warnings.join(' ').includes('composerData'));
}

console.log('\nparser: composer 有但 bubble 全空');
{
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE ${CURSOR_KV_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(`INSERT INTO ${CURSOR_KV_TABLE} (key, value) VALUES (?, ?)`).run(
    'composerData:c-empty',
    JSON.stringify({
      composerId: 'c-empty',
      fullConversationHeadersOnly: [{ bubbleId: 'b-missing' }],
      lastUpdatedAt: 1700000000000,
    }),
  );
  // bubble b-missing 不存在
  const parsed = parseLatestTrace(db);
  assert('turns 至少有一条', parsed.turns.length >= 1);
  assert('包含 bubble 缺失提示', parsed.turns.some((t) => t.text.includes('数据缺失')));
}

console.log('\nparser: 不包含 cursorDiskKV 表');
{
  const db = new Database(':memory:');
  db.exec('CREATE TABLE foo (a TEXT)');
  const parsed = parseLatestTrace(db);
  assert('turns 为空', parsed.turns.length === 0);
  assert('warning 提示不是 state.vscdb', parsed.warnings.join(' ').includes('cursorDiskKV'));
}

console.log('\nparser: fallback 抓最近一个 thinking bubble');
{
  const db = setupCursorLikeDb();
  const fb = parseLatestBubbleFallback(db);
  assert('fallback 找到 bubble', fb.turns.length > 0);
  const types = fb.turns.map((t) => t.type);
  assert(
    'fallback 至少含 thinking 或 assistant 或 user',
    types.some((t) => t === 'thinking' || t === 'assistant' || t === 'user'),
  );
}

console.log('\nparser: fallback 空库');
{
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE ${CURSOR_KV_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const fb = parseLatestBubbleFallback(db);
  assert('fallback 空库 → empty', fb.turns.length === 0);
}

console.log('\nAll agent-trace parser tests passed.');