import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.env.EXTENSION_PATH || '.');
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(resolve(`.browser-profile/test-${Date.now()}`), {
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, viewport: { width: 1440, height: 900 }, colorScheme: 'light',
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
});
const results = [];
const errors = [];
const requests = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
});
const cd = await context.browser().newBrowserCDPSession();
const { id } = await cd.send('Extensions.loadUnpacked', { path: root });
const url = `chrome-extension://${id}/newtab.html`;
const page = await context.newPage();
async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); throw error; }
}
async function load() { await page.goto(url); await page.locator('html[data-ready="true"]').waitFor(); }
async function stored() { return page.evaluate(async () => (await chrome.storage.local.get('ntConfig')).ntConfig); }
async function openSettings() { await page.locator('#settingBtn').click(); await page.locator('#settingModal[open]').waitFor(); }
async function saveSettings() { await page.locator('#saveConfig').click(); await page.locator('#settingModal').waitFor({ state: 'hidden' }); }
async function mediaData() { return page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#728b78'; ctx.fillRect(0,0,160,100); return canvas.toDataURL(); }); }
async function seedMedia(key, data) {
  await page.evaluate(async ({ key, data }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('MiniNewTabDB', 1); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('imgStore')) request.result.createObjectStore('imgStore'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('imgStore', 'readwrite'); tx.objectStore('imgStore').put(data?.videoBytes ? new Blob([new Uint8Array(data.videoBytes)], { type: 'video/webm' }) : data, key); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
  }, { key, data });
}

try {
  await load();
  await check('real Manifest V3 extension renders without remote requests', async () => {
    assert.match(await page.locator('#timeText').textContent(), /^\d{2}:\d{2}$/);
    assert.equal(await page.locator('.shortcut-link').count(), 0);
    assert.equal(await page.locator('#searchInput').getAttribute('placeholder'), '搜索或输入网址');
    assert.equal(await page.evaluate(() => Boolean(customElements.get('md-outlined-button'))), true);
    assert.equal(await page.locator('.topbar, .brand, #engineButton, #engineMenu, #themeToggle, .keyboard-hint').count(), 0);
    assert.equal(await page.locator('.search-submit').evaluate(el => getComputedStyle(el).opacity), '0');
    assert.equal(requests.length, 0);
    await page.screenshot({ path: `${output}/desktop-light.png`, fullPage: true });
  });
  await check('empty search and keyboard shortcut', async () => {
    await page.locator('#searchInput').fill('   '); await page.locator('#searchInput').press('Enter'); assert.equal(page.url(), url);
    await page.locator('#searchInput').blur(); await page.keyboard.press('/');
    assert.equal(await page.locator('#searchInput').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#searchInput').evaluate(el => el === document.activeElement), false);
  });
  await check('theme preview cancels with Escape and restores focus', async () => {
    await openSettings(); await page.locator('[data-theme-choice="dark"]').click();
    assert.equal(await page.locator('html').getAttribute('data-dark'), 'true');
    await page.screenshot({ path: `${output}/settings-dark.png`, fullPage: true });
    await page.keyboard.press('Escape'); assert.equal(await page.locator('html').getAttribute('data-dark'), 'false');
    assert.equal(await page.locator('#settingBtn').evaluate(el => el === document.activeElement), true);
  });
  await check('settings persist and synchronize to another tab', async () => {
    const other = await context.newPage(); await other.goto(url); await other.locator('html[data-ready="true"]').waitFor();
    await openSettings(); await page.locator('[data-color="sage"].color-swatch').click();
    await page.locator('#showSeconds').click(); await page.locator('#hour12').click();
    await page.locator('#inputSign').fill('今天，做一件值得的事。'); await saveSettings();
    await other.waitForFunction(() => document.getElementById('signText').textContent === '今天，做一件值得的事。');
    assert.equal((await stored()).showSeconds, true); assert.equal((await stored()).hour12, true);
    await load(); assert.equal(await page.locator('#signText').textContent(), '今天，做一件值得的事。');
    assert.match(await page.locator('#secondsText').textContent(), /^:\d{2}$/);
    assert.equal(await page.locator('#secondsText').evaluate(el => getComputedStyle(el).fontSize), await page.locator('#timeText').evaluate(el => getComputedStyle(el).fontSize));
    await page.screenshot({ path: `${output}/desktop-seconds.png`, fullPage: true });
    await other.close();
  });
  await check('search engine selection exists only in settings', async () => {
    await openSettings(); await page.locator('#searchEngine').selectOption('bing'); await saveSettings();
    assert.equal((await stored()).searchEngine, 'bing');
    assert.equal(await page.locator('#engineButton').count(), 0);
  });
  await check('search and URL navigation use the configured destination', async () => {
    await context.route('https://www.bing.com/**', route => route.fulfill({ body: '<title>Search result fixture</title>' }));
    await context.route('https://example.com/**', route => route.fulfill({ body: '<title>Website fixture</title>' }));
    await page.locator('#searchInput').fill('中文 & Chrome'); await page.locator('#searchInput').press('Enter');
    await page.waitForURL('https://www.bing.com/search?q=*');
    assert.equal(new URL(page.url()).searchParams.get('q'), '中文 & Chrome');
    await load();
    await page.locator('#searchInput').fill('example.com/docs'); await page.locator('#searchInput').press('Enter');
    await page.waitForURL('https://example.com/docs'); await load();
    await openSettings(); await page.locator('#openInNewTab').click(); await saveSettings();
    const popupPromise = context.waitForEvent('page');
    await page.locator('#searchInput').fill('example.com/new-tab'); await page.locator('#searchInput').press('Enter');
    const popup = await popupPromise; await popup.waitForURL('https://example.com/new-tab');
    assert.equal(page.url(), url); await popup.close();
    await openSettings(); await page.locator('#openInNewTab').click(); await saveSettings();
  });
  await check('shortcut validation, add, edit, delete and undo', async () => {
    await openSettings();
    await page.getByRole('button', { name: '添加快捷方式', exact: true }).click();
    await page.locator('#shortcutName').fill('测试网站'); await page.locator('#shortcutUrl').fill('javascript:alert(1)'); await page.locator('#saveShortcut').click();
    assert.equal(await page.locator('#shortcutError').isVisible(), true);
    await page.locator('#shortcutUrl').fill('example.com/docs'); await page.locator('#saveShortcut').click();
    await page.locator('#shortcutDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.shortcut-link').filter({ hasText: '测试网站' }).getAttribute('href'), 'https://example.com/docs');
    await page.getByRole('button', { name: '编辑 测试网站', exact: true }).click();
    await page.locator('#shortcutName').fill('资料库'); await page.locator('#saveShortcut').click(); await page.locator('#shortcutDialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '编辑 资料库', exact: true }).click(); await page.locator('#deleteShortcut').click(); await page.locator('#shortcutDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('link', { name: '资料库', exact: true }).count(), 0);
    await page.locator('#toastAction').click();
    await page.getByRole('button', { name: '编辑 资料库', exact: true }).waitFor();
    await page.locator('#cancelSettings').click(); await page.getByRole('link', { name: '资料库', exact: true }).waitFor();
  });
  const image = await mediaData();
  const imageBuffer = Buffer.from(image.split(',')[1], 'base64');
  await check('image preview cancels without replacing persisted wallpaper', async () => {
    await openSettings(); await page.locator('#uploadMedia').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: imageBuffer });
    await page.locator('body.has-wallpaper').waitFor(); await page.locator('#saveConfig:not([disabled])').waitFor();
    await page.locator('#cancelSettings').click();
    await page.waitForFunction(() => !document.body.classList.contains('has-wallpaper'));
    assert.equal((await stored()).wallpaperType, null);
  });
  await check('image saves as Blob and restores after reload', async () => {
    await openSettings(); await page.locator('#uploadMedia').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: imageBuffer });
    await page.locator('body.has-wallpaper').waitFor(); await page.locator('#saveConfig:not([disabled])').waitFor(); await saveSettings();
    assert.match((await stored()).wallpaperKey, /^wallpaper_/);
    await load(); await page.locator('body.has-wallpaper').waitFor();
    assert.equal(await page.locator('#imgWallpaper').evaluate(el => el.complete && el.naturalWidth === 160), true);
    await page.screenshot({ path: `${output}/wallpaper.png`, fullPage: true });
  });
  await check('failed config save preserves the previous stored wallpaper', async () => {
    const previous = await stored();
    await openSettings(); await page.locator('#uploadMedia').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: imageBuffer });
    await page.locator('#wallpaperName').filter({ hasText: 'second.png' }).waitFor(); await page.locator('#saveConfig:not([disabled])').waitFor();
    await page.evaluate(() => { window.originalSet = chrome.storage.local.set; chrome.storage.local.set = async () => { throw new Error('Simulated full storage'); }; });
    await page.locator('#saveConfig').click(); await page.locator('#settingsError').waitFor({ state: 'visible' });
    assert.equal((await stored()).wallpaperKey, previous.wallpaperKey);
    await page.evaluate(() => { chrome.storage.local.set = window.originalSet; });
    await page.locator('#cancelSettings').click(); await load(); await page.locator('body.has-wallpaper').waitFor();
  });
  await check('legacy base64 image and signature remain compatible', async () => {
    await seedMedia('wallpaper_img', image);
    await page.evaluate(() => chrome.storage.local.set({ ntConfig: { schemaVersion: 2, wallpaperType: 'img', signTextVal: '旧版签名', dim: 35 } }));
    await load(); await page.locator('body.has-wallpaper').waitFor();
    assert.equal(await page.locator('#signText').textContent(), '旧版签名');
    assert.equal(await page.locator('body').evaluate(el => el.style.getPropertyValue('--wallpaper-dim')), '0');
  });
  const videoBytes = Array.from(await readFile(new URL('./fixtures/wallpaper.webm', import.meta.url)));
  await check('video wallpaper persists, pauses and resumes', async () => {
    await openSettings(); await page.locator('#uploadMedia').setInputFiles({ name: 'wallpaper.webm', mimeType: 'video/webm', buffer: Buffer.from(videoBytes) });
    await page.locator('#videoToggle').waitFor({ state: 'visible' }); await page.locator('#saveConfig:not([disabled])').waitFor(); await saveSettings();
    await page.waitForFunction(() => !document.getElementById('videoWallpaper').paused);
    assert.equal(await page.locator('#videoToggle').isVisible(), false);
    await openSettings();
    await page.locator('#videoToggle').click(); assert.equal(await page.locator('#videoWallpaper').evaluate(el => el.paused), true);
    await page.locator('#videoToggle').click(); await page.waitForFunction(() => !document.getElementById('videoWallpaper').paused);
    await page.locator('#cancelSettings').click(); await load();
    await page.waitForFunction(() => document.body.classList.contains('has-wallpaper'));
    assert.equal((await stored()).wallpaperType, 'video');
  });
  await check('legacy video Blob remains compatible; reduced motion pauses autoplay', async () => {
    await seedMedia('wallpaper_video', { videoBytes });
    await page.evaluate(() => chrome.storage.local.set({ ntConfig: { wallpaperType: 'video', signTextVal: '旧视频' } }));
    await page.emulateMedia({ reducedMotion: 'reduce' }); await load();
    await page.waitForFunction(() => document.body.classList.contains('has-wallpaper'));
    await openSettings(); await page.locator('#videoToggle').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#videoWallpaper').evaluate(el => el.paused), true);
    await page.locator('#videoToggle').click(); await page.waitForFunction(() => !document.getElementById('videoWallpaper').paused);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#cancelSettings').click();
  });
  await check('corrupt media is reported and falls back gracefully', async () => {
    await page.evaluate(() => chrome.storage.local.set({ ntConfig: { wallpaperType: 'video', wallpaperKey: 'wallpaper_missing' } }));
    await load(); await page.locator('#toast').waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('has-wallpaper')), false);
    assert.match(await page.locator('#timeText').textContent(), /:/);
  });
  await check('light, dark, mobile and small desktop layouts do not overflow', async () => {
    await page.evaluate(() => chrome.storage.local.clear()); await load();
    for (const [width, height] of [[1440,900], [1024,600], [390,844], [320,568]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      await openSettings();
      await page.locator('#showSeconds').click(); await page.locator('#hour12').click();
      assert.equal(await page.locator('#secondsText').evaluate(el => getComputedStyle(el).fontSize), await page.locator('#timeText').evaluate(el => getComputedStyle(el).fontSize));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `clock overflow at ${width}`);
      const saveBox = await page.locator('#saveConfig').boundingBox();
      assert.ok(saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= height, `save button outside viewport at ${width}`);
      await page.locator('#cancelSettings').click();
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 }); await openSettings(); await page.locator('[data-theme-choice="dark"]').click(); await saveSettings();
    await page.waitForFunction(() => document.documentElement.dataset.dark === 'true');
    await page.screenshot({ path: `${output}/desktop-dark.png`, fullPage: true });
  });
  await check('Chrome new-tab override points to the extension', async () => {
    const tab = await context.newPage(); await tab.goto('chrome://newtab/');
    await tab.locator('#timeText').waitFor(); assert.equal(await tab.title(), '新标签页 · MiniNewTab'); await tab.close();
  });
  assert.deepEqual(errors, [], 'No unhandled browser exceptions');
  console.log(`Passed ${results.length} browser checks. Extension ${id}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, requests }, null, 2));
  await context.close();
}
