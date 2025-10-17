import { createRequire } from 'module'; // 用於支援 require 語法
import { initializeApp, cert } from 'firebase-admin/app'; // 初始化 firebase 和憑證相關功能
import { getFirestore } from 'firebase-admin/firestore'; // 從 firebas 引入資料庫存取功能
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

const OUTPUT_DIR = './output'; // 定義輸出目錄
// 確保輸出目錄存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 匯出所有集合資料
const exportAll = async () => {
  // 取得資料庫中所有集合的列表
  console.log(chalk.gray(`取得資料庫中所有集合的列表...`));
  const collections = await db.listCollections();
  // 遍歷每個集合
  for (const col of collections) {
    const snapshot = await col.get(); // 取得該集合的所有文件
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })); // 將文件轉換為包含 id 的資料陣列
    const filePath = path.join(OUTPUT_DIR, `${col.id}.json`); // 使用 path.join 來建立完整的檔案路徑
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); // 將資料寫入 JSON 檔案，使用 2 空格縮排美化格式
    console.log(chalk.magenta(`已匯出 ${col.id}.json，共 ${data.length} 筆`));
  }
  console.log(chalk.yellow('======= 全部集合匯出完成 ======='));
};

exportAll();
