export const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
};
export const COLORS = ['blue', 'sage', 'sand', 'rose', 'slate'];
export const DEFAULTS = {
  schemaVersion: 3, theme: 'system', color: 'slate', searchEngine: 'google',
  openInNewTab: false, showSeconds: false, hour12: false, showShortcuts: true,
  signTextVal: '', wallpaperType: null, wallpaperKey: null, wallpaperName: '', dim: 0,
  shortcuts: [],
};
const LEGACY_SHORTCUTS = [
    { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/' },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/' },
    { id: 'github', name: 'GitHub', url: 'https://github.com/' },
    { id: 'drive', name: '云端硬盘', url: 'https://drive.google.com/' },
];
export function normalizeWebsite(value) {
  const text = String(value ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)
      && !/^[^/:]+:\d+(?:[/?#]|$)/.test(text)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('[')) return null;
    return url.href;
  } catch { return null; }
}
export function resolveSearch(value, engine = 'google') {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return normalizeWebsite(text) || `${(ENGINES[engine] || ENGINES.google).url}${encodeURIComponent(text)}`;
}
export function normalizeConfig(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const result = structuredClone(DEFAULTS);
  for (const key of ['openInNewTab', 'showSeconds', 'hour12', 'showShortcuts']) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key];
  }
  if (['system', 'light', 'dark'].includes(raw.theme)) result.theme = raw.theme;
  if (COLORS.includes(raw.color)) result.color = raw.color;
  if (Object.hasOwn(ENGINES, raw.searchEngine)) result.searchEngine = raw.searchEngine;
  result.signTextVal = typeof raw.signTextVal === 'string' ? raw.signTextVal.slice(0, 80) : '';
  if (['img', 'video'].includes(raw.wallpaperType)) result.wallpaperType = raw.wallpaperType;
  if (typeof raw.wallpaperKey === 'string' && /^wallpaper_[\w-]{1,100}$/.test(raw.wallpaperKey)) result.wallpaperKey = raw.wallpaperKey;
  if (typeof raw.wallpaperName === 'string') result.wallpaperName = raw.wallpaperName.slice(0, 200);
  if (typeof raw.dim === 'number' && Number.isFinite(raw.dim)) result.dim = Math.max(0, Math.min(80, raw.dim));
  // Undo the previous release's default dark overlay, while retaining custom brightness.
  if ((Number(raw.schemaVersion) || 0) < 3 && raw.dim === 35) result.dim = 0;
  if (Array.isArray(raw.shortcuts)) {
    const ids = new Set();
    result.shortcuts = raw.shortcuts.flatMap((item, index) => {
      if (!item || typeof item.name !== 'string') return [];
      const url = normalizeWebsite(item.url);
      const name = item.name.trim().slice(0, 24);
      if (!url || !name) return [];
      let id = typeof item.id === 'string' && /^[\w-]{1,80}$/.test(item.id) ? item.id : `shortcut-${index}`;
      while (ids.has(id)) id += '-x';
      ids.add(id);
      if ((Number(raw.schemaVersion) || 0) < 3 && LEGACY_SHORTCUTS.some(legacy => legacy.id === id && legacy.name === name && legacy.url === url)) return [];
      return [{ id, name, url }];
    }).slice(0, 10);
  }
  return result;
}
export function clockParts(date, config) {
  const hours = config.hour12 ? date.getHours() % 12 || 12 : date.getHours();
  return { time: `${String(hours).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    seconds: config.showSeconds ? `:${String(date.getSeconds()).padStart(2, '0')}` : '',
    period: config.hour12 ? (date.getHours() < 12 ? '上午' : '下午') : '' };
}
