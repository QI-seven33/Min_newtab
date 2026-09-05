const videoWallpaper = document.getElementById('videoWallpaper');
const imgWallpaper = document.getElementById('imgWallpaper');
const searchInput = document.getElementById('searchInput');
const timeText = document.getElementById('timeText');
const dateText = document.getElementById('dateText');
const signText = document.getElementById('signText');

const settingBtn = document.getElementById('settingBtn');
const settingModal = document.getElementById('settingModal');
const closeModal = document.getElementById('closeModal');
const uploadImg = document.getElementById('uploadImg');
const uploadVideo = document.getElementById('uploadVideo');
const inputSign = document.getElementById('inputSign');
const saveConfig = document.getElementById('saveConfig');

let config = {
  wallpaperType: null, // img / video / null
  signTextVal: ""
};

// ── IndexedDB 封装：图片 base64 与视频 Blob 统一持久化 ──
// 沿用旧库名/旧 store 名，兼容之前已保存的图片数据
const DB_NAME = "MiniNewTabDB";
const STORE_NAME = "imgStore";
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = e => reject(e);
  });
}

// 确保数据库已就绪（防止页面刚加载、用户就上传壁纸时 db 为 null）
async function ensureDB() {
  if (!db) db = await openDB();
  return db;
}

function idbPut(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e);
  });
}

function idbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e);
  });
}

// 保存轻量配置到 chrome.storage.local（只存类型与签名，不存大媒体，避免超配额失败）
async function persistConfig() {
  try {
    await chrome.storage.local.set({
      ntConfig: {
        wallpaperType: config.wallpaperType,
        signTextVal: config.signTextVal
      }
    });
  } catch (e) {
    console.error("[MiniNewTab] 保存配置失败：", e);
  }
}

// 加载配置与媒体壁纸
async function loadConfig() {
  try {
    await ensureDB();
  } catch (e) {
    console.error("[MiniNewTab] IndexedDB 打开失败：", e);
  }

  try {
    const res = await chrome.storage.local.get(["ntConfig"]);
    if (res.ntConfig) {
      if (res.ntConfig.wallpaperType) config.wallpaperType = res.ntConfig.wallpaperType;
      config.signTextVal = res.ntConfig.signTextVal || "";
    }
  } catch (e) {
    console.error("[MiniNewTab] 读取配置失败：", e);
  }

  signText.innerText = config.signTextVal;
  inputSign.value = config.signTextVal;

  // 按配置类型恢复媒体壁纸（任一环节失败都不中断，且有日志便于排查）
  if (config.wallpaperType === "video") {
    try {
      const blob = await idbGet("wallpaper_video");
      if (blob) {
        config.videoBlob = blob;
      } else {
        console.warn("[MiniNewTab] 视频壁纸数据缺失，回退到图片或默认背景");
        config.wallpaperType = "img";
      }
    } catch (e) {
      console.error("[MiniNewTab] 读取视频壁纸失败：", e);
      config.wallpaperType = "img";
    }
  }

  if (config.wallpaperType === "img") {
    try {
      const base64 = await idbGet("wallpaper_img");
      if (base64) {
        config.imgBase64 = base64;
      } else {
        config.wallpaperType = null;
      }
    } catch (e) {
      console.error("[MiniNewTab] 读取图片壁纸失败：", e);
      config.wallpaperType = null;
    }
  }

  applyWallpaper();
}

// 渲染壁纸
function applyWallpaper() {
  videoWallpaper.style.display = "none";
  videoWallpaper.pause();
  imgWallpaper.style.display = "none";

  if (config.wallpaperType === "img" && config.imgBase64) {
    imgWallpaper.src = config.imgBase64;
    imgWallpaper.style.display = "block";
  } else if (config.wallpaperType === "video" && config.videoBlob) {
    if (videoWallpaper.src) URL.revokeObjectURL(videoWallpaper.src);
    videoWallpaper.src = URL.createObjectURL(config.videoBlob);
    videoWallpaper.style.display = "block";
    videoWallpaper.play().catch(() => {});
  }
}

// 165Hz 高刷时间更新：requestAnimationFrame 跟随显示器刷新率
let lastSecond = -1;
function updateTimeStamp() {
  const now = new Date();
  const sec = now.getSeconds();
  if (sec !== lastSecond) {
    lastSecond = sec;
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    timeText.innerText = `${h}:${m}:${s}`;

    const year = now.getFullYear();
    const mon = now.getMonth() + 1;
    const day = now.getDate();
    const weekArr = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
    dateText.innerText = `${year}年${mon}月${day}日 ${weekArr[now.getDay()]}`;
  }
  requestAnimationFrame(updateTimeStamp);
}

// 搜索：新窗口打开，不销毁当前新标签页
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.open(`https://www.baidu.com/s?wd=${encodeURIComponent(searchInput.value.trim())}`, "_blank");
  }
});

// 设置弹窗
settingBtn.onclick = () => settingModal.style.display = "flex";
closeModal.onclick = () => settingModal.style.display = "none";

// 上传图片壁纸：转 base64 存入 IndexedDB，并立即持久化配置（无需再点保存）
uploadImg.onchange = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ""; // 重置，允许重复上传同一文件
  const reader = new FileReader();
  reader.onload = async ev => {
    const base64 = ev.target.result;
    config.wallpaperType = "img";
    config.imgBase64 = base64;
    config.videoBlob = null;
    try {
      await ensureDB();
      await idbPut("wallpaper_img", base64);
      await idbDelete("wallpaper_video").catch(() => {});
    } catch (err) {
      console.error("[MiniNewTab] 图片壁纸持久化失败：", err);
    }
    await persistConfig();
    applyWallpaper();
  };
  reader.readAsDataURL(file);
};

// 上传视频壁纸：Blob 存入 IndexedDB，刷新/新标签页后依然保留
uploadVideo.onchange = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ""; // 重置，允许重复上传同一文件
  config.wallpaperType = "video";
  config.videoBlob = file; // File 本身即 Blob
  config.imgBase64 = null;
  try {
    await ensureDB();
    await idbPut("wallpaper_video", file);
    await idbDelete("wallpaper_img").catch(() => {});
  } catch (err) {
    console.error("[MiniNewTab] 视频壁纸持久化失败：", err);
  }
  await persistConfig();
  applyWallpaper();
};

// 保存配置（签名等）
saveConfig.onclick = async () => {
  config.signTextVal = inputSign.value.trim();
  await persistConfig();
  signText.innerText = config.signTextVal;
  settingModal.style.display = "none";
};

// 页面卸载，释放资源
window.addEventListener('beforeunload', () => {
  if (videoWallpaper.src) {
    URL.revokeObjectURL(videoWallpaper.src);
  }
});

// 初始化
loadConfig();
requestAnimationFrame(updateTimeStamp);
