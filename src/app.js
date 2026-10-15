import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/switch/switch.js';
import { ENGINES, normalizeConfig, normalizeWebsite, resolveSearch, clockParts } from './core.js';
import { readConfig, writeConfig, readMedia, writeMedia, deleteMedia, subscribeConfig } from './storage.js';

const $ = id => document.getElementById(id);
const settings = $('settingModal');
const shortcutDialog = $('shortcutDialog');
const video = $('videoWallpaper');
const picture = $('imgWallpaper');
const darkPreference = matchMedia('(prefers-color-scheme: dark)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
let config = normalizeConfig();
let draft = null;
let dirty = new Set();
let pendingMedia;
let busy = false;
let uploadSequence = 0;
let mediaSequence = 0;
let mediaUrl;
let activeMedia;
let videoUserPaused = reduceMotion.matches;
let clockTimer;
let toastTimer;
let editId = null;
let ready = false;

function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `assets/icons.svg#${name}`);
  svg.append(use);
  return svg;
}
function current() { return draft || config; }
function showError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function toast(message, undo) {
  clearTimeout(toastTimer);
  const host = settings.open ? settings.querySelector('.drawer-footer') : document.body;
  if ($('toast').parentElement !== host) host.prepend($('toast'));
  $('toastMessage').textContent = message;
  $('toast').hidden = false;
  $('toastAction').hidden = !undo;
  $('toastAction').onclick = undo ? async () => {
    $('toastAction').disabled = true;
    try { await undo(); toast('已撤销'); } catch { toast('撤销失败，请重试'); }
    finally { $('toastAction').disabled = false; }
  } : null;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, undo ? 10000 : 5000);
}
function renderAppearance() {
  const state = current();
  const dark = state.theme === 'dark' || (state.theme === 'system' && darkPreference.matches);
  document.documentElement.dataset.dark = String(dark);
  document.documentElement.dataset.color = state.color;
  document.body.style.setProperty('--wallpaper-dim', state.dim / 100);
  $('signText').textContent = state.signTextVal;
  $('signText').hidden = !state.signTextVal;
  $('shortcutsSection').hidden = !state.showShortcuts || config.shortcuts.length === 0;
  const engine = ENGINES[state.searchEngine];
  $('searchInput').ariaLabel = `搜索内容或网址，使用 ${engine.name} 搜索`;
  renderClock();
}
function renderClock() {
  clearTimeout(clockTimer);
  const now = new Date();
  const parts = clockParts(now, current());
  $('timeText').textContent = parts.time;
  $('timeText').dateTime = now.toISOString();
  $('secondsText').textContent = parts.seconds;
  document.querySelector('.clock-line').classList.toggle('has-seconds', Boolean(parts.seconds));
  $('periodText').textContent = parts.period;
  $('dateText').textContent = dateFormatter.format(now).replace(/(日)(星期)/, '$1 · $2');
  if (!document.hidden) {
    const interval = current().showSeconds ? 1000 : 60000;
    clockTimer = setTimeout(renderClock, interval - Date.now() % interval + 20);
  }
}
function mediaKey(state) {
  return state.wallpaperKey || (state.wallpaperType === 'video' ? 'wallpaper_video' : 'wallpaper_img');
}
function releaseMedia() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  picture.removeAttribute('src');
  picture.hidden = video.hidden = true;
  document.body.classList.remove('has-wallpaper');
  $('videoToggle').hidden = true;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = undefined;
  activeMedia = undefined;
}
async function renderMedia() {
  const sequence = ++mediaSequence;
  const state = current();
  if (!state.wallpaperType) { releaseMedia(); return; }
  const identity = pendingMedia || mediaKey(state);
  if (activeMedia === identity) return;
  try {
    const data = pendingMedia || await readMedia(mediaKey(state));
    if (sequence !== mediaSequence) return;
    if (!data || (!(data instanceof Blob) && !(typeof data === 'string' && /^data:image\//.test(data)))) throw new Error('missing');
    releaseMedia();
    activeMedia = identity;
    const url = data instanceof Blob ? (mediaUrl = URL.createObjectURL(data)) : data;
    const element = state.wallpaperType === 'video' ? video : picture;
    element.src = url;
    element.hidden = false;
    document.body.classList.add('has-wallpaper');
    if (state.wallpaperType === 'video') {
      video.muted = true;
      $('videoToggle').hidden = false;
      syncPlayback();
    }
  } catch (error) {
    if (sequence !== mediaSequence) return;
    releaseMedia();
    toast('暂时无法读取壁纸，可在自定义面板重新选择。');
    console.warn('[MiniNewTab] Wallpaper unavailable:', error);
  }
}
function syncPlayback() {
  if (video.hidden) return;
  if (document.hidden || videoUserPaused) video.pause();
  else video.play().catch(() => { videoUserPaused = true; renderPlayback(); });
  renderPlayback();
}
function renderPlayback() {
  const paused = video.paused;
  $('videoToggle').replaceChildren(icon(paused ? 'play' : 'pause', 'icon small'), document.createTextNode(paused ? '播放壁纸' : '暂停壁纸'));
  $('videoToggle').ariaLabel = paused ? '播放视频壁纸' : '暂停视频壁纸';
}
video.addEventListener('play', renderPlayback);
video.addEventListener('pause', renderPlayback);
for (const element of [picture, video]) element.addEventListener('error', () => {
  if (!element.hasAttribute('src')) return;
  releaseMedia();
  toast('这份壁纸无法播放或显示，请尝试其他文件。');
});
$('videoToggle').onclick = () => { videoUserPaused = !video.paused; syncPlayback(); };

function renderShortcuts() {
  const fragment = document.createDocumentFragment();
  const manager = document.createDocumentFragment();
  for (const item of config.shortcuts) {
    const wrapper = document.createElement('div'); wrapper.className = 'shortcut';
    const link = document.createElement('a'); link.className = 'shortcut-link'; link.href = item.url; link.title = `${item.name}\n${item.url}`;
    if (config.openInNewTab) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    const symbol = document.createElement('span'); symbol.className = 'shortcut-icon';
    symbol.textContent = Array.from(item.name)[0].toUpperCase();
    symbol.ariaHidden = 'true';
    const label = document.createElement('span'); label.className = 'shortcut-name'; label.textContent = item.name;
    link.append(symbol, label);
    wrapper.append(link); fragment.append(wrapper);
    const edit = document.createElement('button'); edit.className = 'shortcut-setting'; edit.ariaLabel = `编辑 ${item.name}`;
    const name = document.createElement('span'); name.textContent = item.name;
    const address = document.createElement('span'); address.className = 'shortcut-address'; address.textContent = new URL(item.url).hostname;
    edit.append(name, address); edit.onclick = () => openShortcut(item.id); manager.append(edit);
  }
  $('shortcuts').replaceChildren(fragment);
  $('shortcutSettings').replaceChildren(manager);
  $('shortcutSettings').hidden = config.shortcuts.length === 0;
  $('addShortcutButton').disabled = config.shortcuts.length >= 10;
}
async function persistPatch(patch) {
  const latest = normalizeConfig(await readConfig());
  const next = normalizeConfig({ ...latest, ...patch });
  await writeConfig(next);
  config = next;
  renderAppearance(); renderShortcuts();
}
$('searchForm').onsubmit = event => {
  event.preventDefault();
  if (!ready || event.isComposing) return;
  const target = resolveSearch($('searchInput').value, config.searchEngine);
  if (!target) { $('searchInput').focus(); return; }
  if (config.openInNewTab) window.open(target, '_blank', 'noopener,noreferrer');
  else location.assign(target);
};
$('searchInput').addEventListener('keydown', event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); });

function renderSettings() {
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === draft.theme)));
  document.querySelectorAll('.color-swatch').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === draft.color)));
  for (const key of ['showSeconds', 'hour12', 'showShortcuts', 'openInNewTab']) $(key).selected = draft[key];
  $('searchEngine').value = draft.searchEngine;
  $('inputSign').value = draft.signTextVal;
  $('signCount').textContent = `${draft.signTextVal.length} / 80`;
  $('wallpaperStatus').hidden = $('dimControl').hidden = !draft.wallpaperType;
  $('wallpaperName').textContent = draft.wallpaperName || (draft.wallpaperType === 'video' ? '已保存的视频壁纸' : '已保存的图片壁纸');
  $('dimInput').value = draft.dim; $('dimValue').textContent = `${draft.dim}%`;
}
function changeDraft(key, value) { if (!draft || busy) return; draft[key] = value; dirty.add(key); renderAppearance(); renderSettings(); }
function openSettings() {
  if (!ready || busy) return;
  draft = structuredClone(config); dirty = new Set(); pendingMedia = undefined;
  showError('settingsError'); renderSettings(); settings.showModal();
}
$('settingBtn').onclick = openSettings;
function closeSettings() {
  if (busy) return;
  uploadSequence++; draft = null; pendingMedia = undefined;
  $('uploadButton').disabled = false; $('saveConfig').disabled = false;
  settings.close(); renderAppearance(); renderMedia(); renderShortcuts();
}
for (const id of ['closeModal', 'cancelSettings']) $(id).onclick = closeSettings;
settings.addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
settings.addEventListener('click', event => {
  const box = settings.getBoundingClientRect();
  if (event.target === settings && (event.clientX < box.left || event.clientX > box.right)) closeSettings();
});
document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => changeDraft('theme', button.dataset.themeChoice));
document.querySelectorAll('.color-swatch').forEach(button => button.onclick = () => changeDraft('color', button.dataset.color));
for (const key of ['showSeconds', 'hour12', 'showShortcuts', 'openInNewTab']) $(key).addEventListener('change', () => changeDraft(key, $(key).selected));
$('searchEngine').onchange = () => changeDraft('searchEngine', $('searchEngine').value);
$('inputSign').oninput = () => changeDraft('signTextVal', $('inputSign').value);
$('dimInput').oninput = () => changeDraft('dim', Number($('dimInput').value));
$('uploadButton').onclick = () => $('uploadMedia').click();
$('addShortcutButton').onclick = () => openShortcut();

async function validateMedia(file, type) {
  const url = URL.createObjectURL(file);
  const element = type === 'img' ? new Image() : document.createElement('video');
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('读取文件超时，请尝试更小的文件。')), 15000);
      const finish = callback => { clearTimeout(timer); callback(); };
      element.onerror = () => finish(() => reject(new Error('无法读取这份文件，请选择 Chrome 支持的图片或视频。')));
      if (type === 'img') element.onload = () => finish(resolve);
      else { element.preload = 'metadata'; element.onloadedmetadata = () => finish(resolve); }
      element.src = url;
    });
  } finally {
    element.onload = element.onerror = element.onloadedmetadata = null;
    element.removeAttribute('src'); if (type === 'video') element.load();
    URL.revokeObjectURL(url);
  }
}
$('uploadMedia').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || !draft || busy) return;
  const sequence = ++uploadSequence;
  showError('settingsError');
  const type = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) ? 'img' : /^video\/(mp4|webm)$/.test(file.type) ? 'video' : null;
  if (!type) { showError('settingsError', '请选择 JPG、PNG、WebP、GIF、AVIF 图片，或 MP4、WebM 视频。'); return; }
  const limit = (type === 'img' ? 20 : 100) * 1024 * 1024;
  if (file.size > limit) { showError('settingsError', type === 'img' ? '图片不能超过 20 MB。' : '视频不能超过 100 MB。'); return; }
  $('uploadButton').disabled = $('saveConfig').disabled = true;
  try {
    await validateMedia(file, type);
    if (sequence !== uploadSequence || !draft) return;
    pendingMedia = file;
    draft.wallpaperType = type; draft.wallpaperName = file.name; draft.wallpaperKey = null;
    for (const key of ['wallpaperType', 'wallpaperName', 'wallpaperKey']) dirty.add(key);
    videoUserPaused = reduceMotion.matches;
    renderSettings(); await renderMedia();
  } catch (error) { if (draft && sequence === uploadSequence) showError('settingsError', error.message); }
  finally { if (sequence === uploadSequence) $('uploadButton').disabled = $('saveConfig').disabled = false; }
};
$('resetWallpaper').onclick = () => {
  if (!draft || busy) return;
  uploadSequence++; pendingMedia = undefined;
  draft.wallpaperType = null; draft.wallpaperKey = null; draft.wallpaperName = '';
  for (const key of ['wallpaperType', 'wallpaperKey', 'wallpaperName']) dirty.add(key);
  $('uploadButton').disabled = $('saveConfig').disabled = false;
  showError('settingsError'); renderSettings(); renderMedia();
};
$('saveConfig').onclick = async () => {
  if (!draft || busy) return;
  busy = true; showError('settingsError'); $('saveConfig').disabled = true;
  settings.querySelector('.drawer-content').inert = true;
  let newKey;
  const previousKey = config.wallpaperType ? mediaKey(config) : null;
  try {
    if (pendingMedia) {
      newKey = `wallpaper_${crypto.randomUUID()}`;
      await writeMedia(newKey, pendingMedia);
      draft.wallpaperKey = newKey;
    }
    const patch = Object.fromEntries([...dirty].map(key => [key, draft[key]]));
    if (patch.signTextVal !== undefined) patch.signTextVal = patch.signTextVal.trim();
    await persistPatch(patch);
    draft = null; pendingMedia = undefined; settings.close();
    renderAppearance(); await renderMedia();
    toast('已保存，新标签页也会使用这些设置。');
    if (previousKey && previousKey !== config.wallpaperKey && dirty.has('wallpaperType')) deleteMedia(previousKey).catch(() => {});
  } catch (error) {
    if (newKey) deleteMedia(newKey).catch(() => {});
    showError('settingsError', '保存失败，原有设置仍然保留。请检查可用空间后重试。');
    console.warn('[MiniNewTab] Settings save failed:', error);
  } finally { busy = false; $('saveConfig').disabled = false; settings.querySelector('.drawer-content').inert = false; }
};

function openShortcut(id = null) {
  if (!ready || busy) return;
  editId = id;
  const item = config.shortcuts.find(entry => entry.id === id);
  $('shortcutTitle').textContent = item ? '编辑快捷方式' : '添加快捷方式';
  $('shortcutName').value = item?.name || '';
  $('shortcutUrl').value = item?.url || '';
  $('deleteShortcut').hidden = !item;
  showError('shortcutError'); shortcutDialog.showModal(); $('shortcutName').focus();
}
function closeShortcut() { if (!busy) shortcutDialog.close(); }
for (const id of ['closeShortcut', 'cancelShortcut']) $(id).onclick = closeShortcut;
shortcutDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('shortcutForm').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const name = $('shortcutName').value.trim();
  const url = normalizeWebsite($('shortcutUrl').value);
  if (!name) { showError('shortcutError', '为这个快捷方式起个名字。'); $('shortcutName').focus(); return; }
  if (!url) { showError('shortcutError', '请输入有效的网站地址，例如 https://example.com。'); $('shortcutUrl').focus(); return; }
  busy = true; $('saveShortcut').disabled = true;
  try {
    const latest = normalizeConfig(await readConfig());
    if (!editId && latest.shortcuts.length >= 10) throw new Error('最多添加 10 个快捷方式。');
    if (editId && !latest.shortcuts.some(item => item.id === editId)) throw new Error('这个快捷方式已在其他标签页移除，请关闭后重试。');
    const item = { id: editId || crypto.randomUUID(), name, url };
    const shortcuts = editId ? latest.shortcuts.map(entry => entry.id === editId ? item : entry) : [...latest.shortcuts, item];
    await persistPatch({ shortcuts }); shortcutDialog.close(); toast(editId ? '快捷方式已更新' : '快捷方式已添加');
  } catch (error) { showError('shortcutError', error.message || '保存失败，请重试。'); }
  finally { busy = false; $('saveShortcut').disabled = false; }
};
$('deleteShortcut').onclick = async () => {
  if (busy || !editId) return;
  busy = true;
  try {
    const latest = normalizeConfig(await readConfig());
    const index = latest.shortcuts.findIndex(item => item.id === editId);
    const removed = latest.shortcuts[index];
    await persistPatch({ shortcuts: latest.shortcuts.filter(item => item.id !== editId) });
    shortcutDialog.close();
    toast('快捷方式已移除', removed ? async () => {
      const latest = normalizeConfig(await readConfig());
      if (latest.shortcuts.some(item => item.id === removed.id)) return;
      if (latest.shortcuts.length >= 10) throw new Error('limit');
      latest.shortcuts.splice(Math.min(index, latest.shortcuts.length), 0, removed);
      await persistPatch({ shortcuts: latest.shortcuts });
    } : undefined);
  } catch { showError('shortcutError', '移除失败，请重试。'); }
  finally { busy = false; }
};
document.addEventListener('keydown', event => {
  const editable = event.composedPath().some(node => node instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable));
  if (event.key === '/' && !editable && !event.ctrlKey && !event.altKey && !event.metaKey && !settings.open && !shortcutDialog.open) { event.preventDefault(); $('searchInput').focus(); }
  if (event.key === 'Escape' && !settings.open && !shortcutDialog.open) $('searchInput').blur();
});
document.addEventListener('visibilitychange', () => { renderClock(); syncPlayback(); });
darkPreference.addEventListener('change', renderAppearance);
reduceMotion.addEventListener('change', () => { videoUserPaused = reduceMotion.matches; syncPlayback(); });
window.addEventListener('pagehide', () => { clearTimeout(clockTimer); video.pause(); });
window.addEventListener('pageshow', () => { renderClock(); syncPlayback(); });
subscribeConfig(raw => {
  if (busy) return;
  config = normalizeConfig(raw);
  if (!draft) { renderAppearance(); renderShortcuts(); renderMedia(); }
});

async function init() {
  try { config = normalizeConfig(await readConfig()); }
  catch (error) { toast('无法读取设置，已使用默认外观。'); console.warn('[MiniNewTab] Load failed:', error); }
  renderAppearance(); renderShortcuts();
  ready = true;
  document.documentElement.dataset.ready = 'true';
  await renderMedia();
}
init();
