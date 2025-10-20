const fs = require('fs');
const { initializeFirebaseApp, backup } = require('firestore-export-import');
const serviceAccount = require('./credentials.json');

// 初始化 Firebase app
const firestore = initializeFirebaseApp(serviceAccount);

// 匯出指定 collection 為 JSON
backup(firestore, '指定 collection')
  .then(data => {
    fs.writeFileSync('輸出的檔名.json', JSON.stringify(data, null, 2), { encoding: 'utf8' });
  })
  .catch(error => {
    console.error('Export error:', error);
  });