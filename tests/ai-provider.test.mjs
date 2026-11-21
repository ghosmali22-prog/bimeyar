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
  const lines = [];   // console.log of Code.gs
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
    `${gs}\nreturn { aiExtract, claudeParse, claudeNormalize, ACTIONS, CLAUDE_MODEL, AI_FIELDS, aiModelsCheck };`)(PropertiesService, LockService, CacheService, Utilities, UrlFetchApp, { log: s => lines.push(String(s)) }, Session);
  return { B, calls, props, store, lines };
}
const claudeText = text => ({ code: 200, body: { stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] } });
const claudeOk = fields => claudeText(JSON.stringify(answer(fields)));
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
  ok(c.body.output_config.effort === 'low' && !('format' in c.body.output_config), '1 effort low, no json_schema format', c.body.output_config);
  ok(/ONLY one JSON object, no markdown/.test(blocks[2].text), '1 prompt asks for one JSON object');
  ok(Object.keys(t.B.AI_FIELDS).every(k => blocks[2].text.includes('  ' + k + ': ' + t.B.AI_FIELDS[k])), '1 prompt lists every AI_FIELDS key + description');
  ok(/policy, registration, id_card, receipt, other/.test(blocks[2].text) && /1, 2, 3, 4, 5\.1, 5\.2, 5\.3, 5\.4, 5\.5, unknown/.test(blocks[2].text), '1 prompt lists docType + slot values');
  ok(Object.keys(r.fields).length === Object.keys(t.B.AI_FIELDS).length && r.fields.vin.value === null && r.fields.vin.confidence === 0, '1 missing fields filled as null / 0');
  const L = log(t.props);
  ok(L.length === 1 && L[0].prov === 'claude' && L[0].model === 'claude-haiku-5-5' && L[0].status === 'ok', '1 AI_LOG has provider + model', L);
  ok(!t.props.AI_LOG.includes('sk-test') && !t.props.AI_LOG.includes('สมชาย'), '1 no key or customer data in AI_LOG');
  // same files again within 10 min: cache, no new call
  const r2 = t.B.aiExtract({ files: [PDF, JPG] });
  ok(r2.cached && r2.prov === 'claude' && t.calls.length === 1, '2 cache hit, no new call');
  ok(log(t.props)[1].status === 'cache' && log(t.props)[1].prov === 'claude', '2 cache logged with provider');
}

// 3) parsing the reply robustly + normalizing
{
  const t = load({ claude: 'k', replies: {} });
  const P = t.B.claudeParse;
  ok(P('{"a":1}').a === 1, '3 plain JSON');
  ok(P('```json\n{"a":2}\n```').a === 2, '3 ```json fences');
  ok(P('Here it is:\n```\n{"a":3}\n```\nDone.').a === 3, '3 text + bare fences around it');
  ok(P('x {"a":"}{ \\" }","b":{"c":4}} y {"a":9}').b.c === 4, '3 first balanced block, braces + quotes inside strings');
  ok(P('no json') === null && P('{"a": ') === null && P('{bad json}') === null && P('') === null && P(null) === null, '3 unparseable -> null');
  ok(P('[1,2]') === null, '3 array is not an answer');
  const N = t.B.claudeNormalize({ docType: 'passport', slot: '5', docName: 7, fields: { nameTh: { value: '  ก  ', confidence: 1.7 }, plate: { value: '1กก', confidence: -2 }, vin: { value: 'X', confidence: 'abc' }, idNo: '1234', phone: { value: '' , confidence: 0.9 }, address: { value: { a: 1 } }, extra: { value: 'no' } } });
  ok(N.docType === 'other' && N.slot === 'unknown' && N.docName === '', '3 invalid docType/slot/docName -> other/unknown/""', N);
  ok(N.fields.nameTh.value === 'ก' && N.fields.nameTh.confidence === 1, '3 trimmed, confidence clamped to 1');
  ok(N.fields.plate.confidence === 0 && N.fields.vin.confidence === 0, '3 confidence clamped to 0 / not a number -> 0');
  ok(N.fields.idNo.value === '1234' && N.fields.idNo.confidence === 0, '3 bare value accepted with confidence 0');
  ok(N.fields.phone.value === null && N.fields.phone.confidence === 0 && N.fields.address.value === null, '3 empty / object value -> null, 0');
  ok(!('extra' in N.fields) && Object.keys(N.fields).length === Object.keys(t.B.AI_FIELDS).length, '3 exactly the AI_FIELDS keys');
  ok(t.B.claudeNormalize({ docType: 'receipt', slot: '5.4', fields: null }).slot === '5.4', '3 valid slot kept');
}

// 3b) a fenced reply with text around it works end to end; an unparseable reply -> Gemini
{
  const t = load({ claude: 'k', gemini: 'g', replies: { claude: [claudeText('Sure:\n```json\n' + JSON.stringify(answer({ plate: { value: '70-5416', confidence: 0.95 } })) + '\n```')] } });
  const r = t.B.aiExtract({ files: [PDF] });
  ok(r.prov === 'claude' && r.fields.plate.value === '70-5416' && r.slot === '1', '3b fenced reply parsed', r);
  const u = load({ claude: 'k', gemini: 'g', replies: { claude: [claudeText('I cannot read this document.')], gemini: [geminiOk({})] } });
  const r2 = u.B.aiExtract({ files: [PDF] });
  ok(r2.prov === 'gemini' && u.calls.filter(c => c.prov === 'claude').length === 1, '3b unparseable -> Gemini, no Claude retry');
  ok(log(u.props)[0].status === 'badjson' && log(u.props)[0].prov === 'claude', '3b logged as claude badjson');
}

// 3c) aiModelsCheck uses the same request path (no format, same prompt) and prints the parsed result
{
  const t = load({ claude: 'k', replies: { claude: [claudeOk({})] } });
  t.B.aiModelsCheck();
  const c = t.calls[0], lines = t.lines;
  ok(c && c.body.model === 'claude-haiku-5-5' && !('format' in c.body.output_config) && /ANSWER FORMAT/.test(c.body.messages[0].content[0].text), '3c aiModelsCheck same request', c && c.body);
  ok(lines.some(l => /claude-haiku-5-5 \(Claude, effort low\): ok .*parsed: docType policy, slot 1, \d+ fields/.test(l)), '3c prints parsed result', lines);
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
