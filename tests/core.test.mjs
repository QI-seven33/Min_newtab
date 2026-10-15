import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeWebsite, resolveSearch, clockParts } from '../src/core.js';

test('empty search does nothing; Chinese and punctuation are encoded', () => {
  assert.equal(resolveSearch('   '), null);
  assert.equal(resolveSearch('你好 & Chrome'), 'https://www.google.com/search?q=%E4%BD%A0%E5%A5%BD%20%26%20Chrome');
  assert.equal(resolveSearch('test', 'bing'), 'https://www.bing.com/search?q=test');
});
test('web addresses navigate directly and preserve ports and queries', () => {
  assert.equal(resolveSearch('example.com/a?q=1#x'), 'https://example.com/a?q=1#x');
  assert.equal(normalizeWebsite('http://localhost:3000/test'), 'http://localhost:3000/test');
  assert.equal(normalizeWebsite('localhost:8080'), 'https://localhost:8080/');
  assert.equal(normalizeWebsite('127.0.0.1:8080/a'), 'https://127.0.0.1:8080/a');
  assert.equal(normalizeWebsite('https://例子.中国'), 'https://xn--fsqu00a.xn--fiqs8s/');
});
test('shortcut URLs reject scripts, credentials and invalid input', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///c:/test', 'ftp://example.com', 'https://user:pass@example.com', 'hello world', 'nohostname', null]) assert.equal(normalizeWebsite(value), null);
  assert.match(resolveSearch('javascript:alert(1)'), /^https:\/\/www.google.com\/search\?q=/);
});
test('legacy config retains signature and image/video storage semantics', () => {
  const config = normalizeConfig({ wallpaperType: 'img', signTextVal: '旧签名' });
  assert.equal(config.wallpaperType, 'img'); assert.equal(config.signTextVal, '旧签名');
  assert.equal(config.wallpaperKey, null); assert.equal(config.searchEngine, 'google');
});
test('malformed preferences cannot break rendering or inject links', () => {
  const config = normalizeConfig({ theme: 'invalid', color: 'invalid', searchEngine: '__proto__', dim: Infinity, showSeconds: 'false', signTextVal: {}, shortcuts: [null, { name: 'bad', url: 'javascript:alert(1)' }, { name: 'good', url: 'example.com', id: '<bad>' }] });
  assert.equal(config.theme, 'system'); assert.equal(config.color, 'slate'); assert.equal(config.searchEngine, 'google');
  assert.equal(config.dim, 0); assert.equal(config.showSeconds, false); assert.equal(config.signTextVal, '');
  assert.deepEqual(config.shortcuts, [{ id: 'shortcut-2', name: 'good', url: 'https://example.com/' }]);
  assert.deepEqual(normalizeConfig(null), normalizeConfig());
});
test('shortcut limit and unique IDs survive corrupt or old data', () => {
  const config = normalizeConfig({ shortcuts: Array.from({ length: 12 }, () => ({ name: 'Site', url: 'example.com', id: 'same' })) });
  assert.equal(config.shortcuts.length, 10); assert.equal(new Set(config.shortcuts.map(s => s.id)).size, 10);
  assert.equal(normalizeConfig({ shortcuts: [] }).shortcuts.length, 0);
});
test('clock formats midnight, noon and seconds correctly', () => {
  assert.deepEqual(clockParts(new Date(2026, 0, 1, 0, 5, 9), { hour12: true, showSeconds: true }), { time: '12:05', seconds: ':09', period: '上午' });
  assert.deepEqual(clockParts(new Date(2026, 0, 1, 12, 5), { hour12: true }), { time: '12:05', seconds: '', period: '下午' });
  assert.equal(clockParts(new Date(2026, 0, 1, 23, 59), {}).time, '23:59');
});
test('cleanup removes only unchanged old sample shortcuts and the old default dim', () => {
  const config = normalizeConfig({ schemaVersion: 2, dim: 35, shortcuts: [
    { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/' },
    { id: 'drive', name: '我的文件', url: 'https://drive.google.com/' },
    { id: 'custom', name: 'Gmail', url: 'https://mail.google.com/' },
  ] });
  assert.equal(config.dim, 0);
  assert.deepEqual(config.shortcuts.map(item => item.id), ['drive', 'custom']);
  assert.equal(normalizeConfig({ schemaVersion: 2, dim: 60 }).dim, 60);
  assert.equal(normalizeConfig({ schemaVersion: 3, dim: 35 }).dim, 35);
  assert.equal(normalizeConfig().shortcuts.length, 0);
});
