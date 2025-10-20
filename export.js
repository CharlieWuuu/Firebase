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
const argMode = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=readable').split('=')[1];
const MODE = argMode === 'typed' ? 'typed' : 'readable';
console.log(chalk.gray('確認模式為：' + MODE));
const OUTPUT_DIR = path.join(BASE_OUTPUT, MODE);

// 確保輸出目錄存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 判斷型別是否為 timestamp、geopoint 或 ref
const isTimestampLike = (value) => value && typeof value.toDate === 'function' && typeof value.toMillis === 'function';
const isGeoPointLike = (value) => value && typeof value === 'object' && ('latitude' in value) && ('longitude' in value);
const isRefLike = (value) => value && typeof value === 'object' && typeof value.path === 'string';

// 資料處理：是否帶型別標記
const serializeValue = (value, typed = false) => {
  if (value === null || value === undefined) return value;

  // 日期
  if (isTimestampLike(value)) {
    const v = (() => { try { return value.toDate().toISOString(); } catch { return String(value); } })();
    return typed ? { __type: 'timestamp', value: v } : v;
  }

  // 地理座標
  if (isGeoPointLike(value)) {
    return typed
      ? { __type: 'geopoint', lat: value.latitude, lng: value.longitude }
      : { latitude: value.latitude, longitude: value.longitude };
  }

  // 參考路徑
  if (isRefLike(value)) {
    return typed
      ? { __type: 'ref', path: value.path }
      : value.path;
  }

  // Buffer
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    const base64 = value.toString('base64');
    return typed
      ? { __type: 'bytes_base64', value: base64 }
      : { __bytes_base64__: base64 };
  }

  // Uint8Array
  if (value instanceof Uint8Array) {
    const base64 = Buffer.from(value).toString('base64');
    return typed
      ? { __type: 'bytes_base64', value: base64 }
      : { __bytes_base64__: base64 };
  }

  // 陣列
  if (Array.isArray(value)) return value.map(v => serializeValue(v, typed));

  // 物件
  if (typeof value === 'object') {
    const object = {};
    for (const [key, val] of Object.entries(value)) object[key] = serializeValue(val, typed);
    return object;
  }

  return value;
};

// 遞迴匯出（會使用傳入的 serializer）
const exportCollectionRecursive = async (colRef, outDir, serializer) => {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); // 確保目錄存在

  const snapshot = await colRef.get(); // 取得此集合的所有文件
  const docs = []; // 要匯出的文件

  // 處理此文件
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const ser = {};
    for (const [key, value] of Object.entries(data || {})) ser[key] = serializer(value);
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

// 匯出整個資料庫（遞迴所有集合和子集合）
const exportAllRecursive = async () => {
  try {
    console.log(chalk.gray(`模式: ${MODE}；取得資料庫中所有集合的列表...`));
    const cols = await db.listCollections(); // 取得所有頂層集合
    const serializer = (value) => serializeValue(value, MODE === 'typed');

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

// 執行
exportAllRecursive();