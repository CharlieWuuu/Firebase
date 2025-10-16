import admin from "firebase-admin";
import fs from "fs";

// 載入金鑰
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "besttour-api.appspot.com",
});

const bucket = admin.storage().bucket();

async function listFiles() {
  const [files] = await bucket.getFiles();
  for (const file of files) {
    console.log(file.name); // 顯示檔案路徑
  }
}

listFiles();
