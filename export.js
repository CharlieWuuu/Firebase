import { createRequire } from 'module'; // 用於支援 require 語法
import { initializeApp, cert } from 'firebase-admin/app'; // 初始化 firebase 和憑證相關功能
import { getFirestore } from 'firebase-admin/firestore'; // 從 firebase 引入資料庫存取功能
import fs from 'fs'; // 用於寫入檔案
import chalk from 'chalk'; // 用於改變終端機文字顏色
import path from 'path';

console.log(chalk.yellow('=========== 開始匯出 ==========='));
const require = createRequire(import.meta.url); // 建立 require 函式，讓 ES Module 可以使用 require 語法

console.log(chalk.gray('載入 Firebase 專案憑證...'));
const serviceAccount = require('./credentials.json');

console.log(chalk.gray('初始化 Firebase 應用程式...'));
initializeApp({ credential: cert(serviceAccount) });

console.log(chalk.gray('取得 Firestore 資料庫...'));
const db = getFirestore();

const BASE_OUTPUT = './output'; // 根目錄
// 讀取命令列參數決定模式（typed 或 readable）
const argMode = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=readable').split('=')[1];
const MODE = argMode === 'typed' ? 'typed' : 'readable';
const OUTPUT_DIR = path.join(BASE_OUTPUT, MODE);

// 確保輸出目錄存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// utility
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const isTimestampLike = (v) => v && typeof v.toDate === 'function' && typeof v.toMillis === 'function';
const isGeoPointLike = (v) => v && typeof v === 'object' && ('latitude' in v) && ('longitude' in v);
const isRefLike = (v) => v && typeof v === 'object' && typeof v.path === 'string';

// two serializers: readable and typed
const serializeReadable = (v) => {
  if (v === null || v === undefined) return v;
  if (isTimestampLike(v)) {
    try { return v.toDate().toISOString(); } catch { return String(v); }
  }
  if (isGeoPointLike(v)) return { latitude: v.latitude, longitude: v.longitude };
  if (isRefLike(v)) return v.path; // simple path string
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return { __bytes_base64__: v.toString('base64') };
  if (v instanceof Uint8Array) return { __bytes_base64__: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(serializeReadable);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = serializeReadable(val);
    return o;
  }
  return v;
};

const serializeTyped = (v) => {
  if (v === null || v === undefined) return v;
  if (isTimestampLike(v)) {
    try { return { __type: 'timestamp', value: v.toDate().toISOString() }; } catch { return { __type: 'timestamp', value: String(v) }; }
  }
  if (isGeoPointLike(v)) return { __type: 'geopoint', lat: v.latitude, lng: v.longitude };
  if (isRefLike(v)) return { __type: 'ref', path: v.path };
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return { __type: 'bytes_base64', value: v.toString('base64') };
  if (v instanceof Uint8Array) return { __type: 'bytes_base64', value: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(serializeTyped);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = serializeTyped(val);
    return o;
  }
  return v;
};

// 遞迴匯出（會使用傳入的 serializer）
const exportCollectionRecursive = async (colRef, outDir, serializer) => {
  ensureDir(outDir);
  const snapshot = await colRef.get();
  const docs = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const ser = {};
    for (const [k, v] of Object.entries(data || {})) ser[k] = serializer(v);
    ser.id = doc.id;
    docs.push(ser);

    // 處理此文件的子集合（遞迴）
    const subCols = await doc.ref.listCollections();
    for (const sub of subCols) {
      const subDir = path.join(outDir, colRef.id, doc.id);
      await exportCollectionRecursive(sub, subDir, serializer);
    }
  }

  const filePath = path.join(outDir, `${colRef.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
  console.log(chalk.magenta(`已匯出 ${filePath}，共 ${docs.length} 筆`));
};

const exportAllRecursive = async () => {
  try {
    console.log(chalk.gray(`模式: ${MODE}；取得資料庫中所有集合的列表（遞迴匯出）...`));
    const cols = await db.listCollections();
    const serializer = MODE === 'typed' ? serializeTyped : serializeReadable;

    for (const c of cols) {
      await exportCollectionRecursive(c, OUTPUT_DIR, serializer);
    }

    // metadata
    const meta = {
      exportedAt: new Date().toISOString(),
      mode: MODE,
      projectId: serviceAccount?.project_id || process.env.GCLOUD_PROJECT || 'unknown',
      fileLayout: MODE === 'typed' ? 'typed (__type markers)' : 'readable (plain conversions)',
      toolVersion: '1'
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'metadata.json'), JSON.stringify(meta, null, 2), 'utf8');

    console.log(chalk.yellow('======= 全部集合（含子集合）匯出完成 ======='));
    console.log(chalk.gray(`輸出目錄： ${path.resolve(OUTPUT_DIR)}`));
  } catch (err) {
    console.error(chalk.red('匯出發生錯誤：'), err);
    process.exitCode = 1;
  }
};

// 也保留非遞迴的快速匯出（使用選定 serializer）
const exportAllFlat = async (serializer) => {
  console.log(chalk.gray(`快速扁平匯出（非遞迴）`));
  const collections = await db.listCollections();
  for (const col of collections) {
    const snapshot = await col.get();
    const data = snapshot.docs.map((doc) => {
      const ser = {};
      for (const [k, v] of Object.entries(doc.data() || {})) ser[k] = serializer(v);
      return { id: doc.id, ...ser };
    });
    const filePath = path.join(OUTPUT_DIR, `${col.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(chalk.magenta(`已匯出 ${col.id}.json，共 ${data.length} 筆`));
  }
  console.log(chalk.yellow('======= 扁平匯出完成 ======='));
};

// 執行（預設遞迴匯出）；若要改為扁平匯出請手動呼叫 exportAllFlat(serializer)
exportAllRecursive();