// v4.4 AI provider: Claude first, Gemini as automatic fallback, inside aiExtract (used by every AI feature).
// Runs backend/Code.gs with fake UrlFetchApp / CacheService (no network, no real data, no real keys).
// Run: node tests/ai-provider.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let fail = 0, pass = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.error('FAIL', msg, extra ?? ''); } };

const FIELD_KEYS = ['nameTh', 'plate', 'policyExpiry'];
const answer = fields => ({ docType: 'policy', docName: 'กรมธรรม์', slot: '1', fields });

function load({ claude, gemini, replies }) {
  const props = {};
  if (claude) props.CLAUDE_API_KEY = claude;
  if (gemini) props.GEMINI_API_KEY = gemini;
  const calls = [];
  const store = {};
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
  const LockService = { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) };
  const CacheService = { getScriptCache: () => ({ get: k => store[k] ?? null, put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } }) };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => [...createHash('sha256').update(s).digest()],
    base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
    sleep() { },
  };
  const UrlFetchApp = {
    fetch(url, opt) {
      const prov = url.includes('anthropic') ? 'claude' : 'gemini';
      calls.push({ prov, url, opt, body: JSON.parse(opt.payload) });
      const r = (replies[prov] || []).shift();
      if (!r) throw new Error('no reply left for ' + prov);
      if (r.throw) throw new Error(r.throw);
      return { getResponseCode: () => r.code, getContentText: () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body) };
    },
  };
  const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
  const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
  const B = new Function('PropertiesService', 'LockService', 'CacheService', 'Utilities', 'UrlFetchApp', 'console', 'Session',
    `${gs}\nreturn { aiExtract, aiSchemaClaude, ACTIONS, CLAUDE_MODEL };`)(PropertiesService, LockService, CacheService, Utilities, UrlFetchApp, { log() { } }, Session);
  return { B, calls, props, store };
}
const claudeOk = fields => ({ code: 200, body: { stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer(fields)) }] } });
const geminiOk = fields => ({ code: 200, body: { usageMetadata: { totalTokenCount: 50 }, candidates: [{ content: { parts: [{ text: JSON.stringify(answer(fields)) }] } }] } });
const PDF = { mime: 'application/pdf', data: 'JVBERi0xLjQK' };
const JPG = { mime: 'image/jpeg', data: '/9j/4AAQSkZJRg==' };
const log = props => JSON.parse(props.AI_LOG || '[]');
const tryErr = fn => { try { fn(); return null; } catch (e) { return e; } };

// 1) Claude answers: document + image blocks, headers, model constant, "" -> null, provider logged
{
  const t = load({ claude: 'sk-test-claude', gemini: 'g-test', replies: { claude: [claudeOk({ nameTh: { value: 'สมชาย', confidence: 0.9 }, plate: { value: '', confidence: 0 }, policyExpiry: { value: '2569-05-01', confidence: 0.8 } })] } });
  const r = t.B.aiExtract({ files: [PDF, JPG] });
  ok(r.prov === 'claude' && r.model === 'claude-haiku-5-5', '1 answered by Claude haiku', r);
  ok(r.fields.plate.value === null, '1 empty string becomes null');
  ok(r.fields.nameTh.value === 'สมชาย' && r.slot === '1' && r.docType === 'policy', '1 fields kept');
  const c = t.calls[0];
  ok(t.calls.length === 1 && c.url === 'https://api.anthropic.com/v1/messages', '1 one call to the Messages API');
  ok(c.opt.headers['x-api-key'] === 'sk-test-claude' && c.opt.headers['anthropic-version'] === '2023-06-01', '1 headers');
  ok(c.body.model === t.B.CLAUDE_MODEL && !/sonnet/i.test(c.body.model), '1 model from the constant');
  const blocks = c.body.messages[0].content;
  ok(blocks[0].type === 'document' && blocks[0].source.media_type === 'application/pdf' && blocks[0].source.type === 'base64' && blocks[0].source.data === PDF.data, '1 PDF as document block');
  ok(blocks[1].type === 'image' && blocks[1].source.media_type === 'image/jpeg' && blocks[1].source.data === JPG.data, '1 photo as image block');
  ok(blocks[2].type === 'text' && /STRICT RULES/.test(blocks[2].text), '1 prompt last');
  ok(c.body.output_config.format.type === 'json_schema', '1 structured output');
  const L = log(t.props);
  ok(L.length === 1 && L[0].prov === 'claude' && L[0].model === 'claude-haiku-5-5' && L[0].status === 'ok', '1 AI_LOG has provider + model', L);
  ok(!t.props.AI_LOG.includes('sk-test') && !t.props.AI_LOG.includes('สมชาย'), '1 no key or customer data in AI_LOG');
  // same files again within 10 min: cache, no new call
  const r2 = t.B.aiExtract({ files: [PDF, JPG] });
  ok(r2.cached && r2.prov === 'claude' && t.calls.length === 1, '2 cache hit, no new call');
  ok(log(t.props)[1].status === 'cache' && log(t.props)[1].prov === 'claude', '2 cache logged with provider');
}

// 3) Claude schema: no minimum/maximum, no type arrays, additionalProperties false everywhere
{
  const t = load({ claude: 'k', replies: {} });
  const s = JSON.stringify(t.B.aiSchemaClaude());
  ok(!/"minimum"|"maximum"/.test(s), '3 no numeric constraints');
  ok(!/"type":\[/.test(s), '3 no type arrays');
  let objs = 0, bad = 0;
  (function walk(o) { if (!o || typeof o !== 'object') return; if (o.type === 'object') { objs++; if (o.additionalProperties !== false) bad++; } Object.values(o).forEach(walk); })(JSON.parse(s));
  ok(objs > 20 && bad === 0, '3 additionalProperties false on every object', { objs, bad });
}

// 4) Claude busy (529) on every try -> Gemini answers; retries kept
{
  const busy = { code: 529, body: '{"type":"error","error":{"type":"overloaded_error"}}' };
  const t = load({ claude: 'k', gemini: 'g', replies: { claude: [busy, busy, busy], gemini: [geminiOk({ nameTh: { value: 'A', confidence: 1 } })] } });
  const r = t.B.aiExtract({ files: [JPG] });
  ok(r.prov === 'gemini' && r.model === 'gemini-3.1-flash-lite', '4 fallback to first Gemini model', r);
  ok(t.calls.filter(c => c.prov === 'claude').length === 3, '4 Claude tried 3 times (same retry logic)');
  const L = log(t.props);
  ok(L.map(x => x.prov + ':' + x.status).join(',') === 'claude:http529,claude:http529,claude:http529,gemini:ok', '4 log', L);
  ok(t.calls[3].body.contents[0].parts[0].inline_data.mime_type === 'image/jpeg', '4 Gemini payload unchanged');
}

// 5) bad Claude key (401) -> no retry, Gemini at once
{
  const t = load({ claude: 'bad', gemini: 'g', replies: { claude: [{ code: 401, body: '{}' }], gemini: [geminiOk({})] } });
  const r = t.B.aiExtract({ files: [PDF] });
  ok(r.prov === 'gemini' && t.calls.filter(c => c.prov === 'claude').length === 1, '5 401 -> Gemini, no Claude retry');
}

// 6) Claude 400 (e.g. no credit), refusal, timeout -> Gemini
for (const [name, rep] of [['400', { code: 400, body: '{"error":{"message":"credit balance is too low"}}' }], ['refusal', { code: 200, body: { stop_reason: 'refusal', content: [] } }], ['max_tokens', { code: 200, body: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"doc' }] } }]]) {
  const t = load({ claude: 'k', gemini: 'g', replies: { claude: [rep], gemini: [geminiOk({})] } });
  const r = t.B.aiExtract({ files: [PDF] });
  ok(r.prov === 'gemini' && t.calls.length === 2, '6 ' + name + ' -> Gemini');
}
{
  const t = load({ claude: 'k', gemini: 'g', replies: { claude: [{ throw: 'Timeout: request' }, { throw: 'Timeout' }, { throw: 'Timeout' }], gemini: [geminiOk({})] } });
  ok(t.B.aiExtract({ files: [PDF] }).prov === 'gemini', '6 timeouts -> Gemini');
}

// 7) no CLAUDE_API_KEY -> Gemini only, exactly as before
{
  const t = load({ gemini: 'g', replies: { gemini: [geminiOk({})] } });
  const r = t.B.aiExtract({ files: [PDF] });
  ok(r.prov === 'gemini' && t.calls.every(c => c.prov === 'gemini'), '7 no Claude key -> Gemini only');
  ok(t.B.ACTIONS.me.run({}, { email: 'a@b' }, 'editor').ai === true, '7 me.ai true with Gemini only');
}

// 8) HEIC photo cannot go to Claude -> Gemini
{
  const t = load({ claude: 'k', gemini: 'g', replies: { gemini: [geminiOk({})] } });
  ok(t.B.aiExtract({ files: [{ mime: 'image/heic', data: 'AAAA' }] }).prov === 'gemini' && t.calls.length === 1, '8 HEIC -> Gemini');
}

// 9) errors when nothing works
{
  const none = load({ replies: {} });
  ok(tryErr(() => none.B.aiExtract({ files: [PDF] }))?.code === 'ai_nokey', '9 no keys -> ai_nokey');
  ok(none.B.ACTIONS.me.run({}, { email: 'a@b' }, 'editor').ai === false, '9 me.ai false without keys');
  const onlyBad = load({ claude: 'bad', replies: { claude: [{ code: 401, body: '{}' }] } });
  ok(tryErr(() => onlyBad.B.aiExtract({ files: [PDF] }))?.code === 'ai_nokey', '9 only a bad Claude key -> ai_nokey');
  const busy = { code: 503, body: '{}' };
  const allBusy = load({ claude: 'k', gemini: 'g', replies: { claude: [busy, busy, busy], gemini: Array(9).fill(busy) } });
  ok(tryErr(() => allBusy.B.aiExtract({ files: [PDF] }))?.code === 'ai_busy', '9 all busy -> ai_busy');
  const onlyClaude = load({ claude: 'k', replies: { claude: [claudeOk({})] } });
  ok(onlyClaude.B.ACTIONS.me.run({}, { email: 'a@b' }, 'editor').ai === true, '9 me.ai true with Claude only');
  ok(onlyClaude.B.aiExtract({ files: [PDF] }).prov === 'claude', '9 Claude only works');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
