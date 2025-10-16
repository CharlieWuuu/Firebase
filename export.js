import { initializeApp } from "firebase/app";
import { getFirestore, getDocs, collection } from "firebase/firestore";
import fs from "fs";

// ⚠️ 請把這裡替換成你的 Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyD8irMhHzFLEFz-nlAvP7scUORdkVww1lI",
  authDomain: "besttour-api.firebaseapp.com",
  databaseURL: "https://besttour-api-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "besttour-api",
  storageBucket: "besttour-api.appspot.com",
  messagingSenderId: "59031234818",
  appId: "1:59031234818:web:27aaafc995fb42b012fa1b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function exportCollection(collRef) {
  const snapshot = await getDocs(collRef);
  const data = [];

  for (const doc of snapshot.docs) {
    const docData = doc.data();
    const subcollections = await doc.ref.listCollections();
    const subData = {};

    // 逐一抓取子集合
    for (const sub of subcollections) {
      const subSnap = await getDocs(sub);
      subData[sub.id] = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    data.push({ id: doc.id, ...docData, ...subData });
  }

  return data;
}

// ✅ 主流程
(async () => {
  const collName = "project"; // 你要匯出的集合名稱
  const data = await exportCollection(collection(db, collName));

  fs.writeFileSync(`${collName}.json`, JSON.stringify(data, null, 2));
  console.log(`✅ 已匯出 ${collName}.json，共 ${data.length} 筆文件`);
})();
