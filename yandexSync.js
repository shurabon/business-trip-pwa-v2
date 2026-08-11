import { db } from './db.js';

const PATH_APP  = 'app:/sync_database.json';
const PATH_DISK = 'disk:/sync_database.json';
const LS_PUBLIC_KEY = 'yandex_sync_public_key';

// ─────────────────────────────────────────────────────────────────
// БД: экспорт и слияние
// ─────────────────────────────────────────────────────────────────

export async function exportLocalDbToJson() {
  const [trips, expenses, payments, clients, dictionaries] = await Promise.all([
    db.trips.toArray(), db.expenses.toArray(), db.payments.toArray(),
    db.clients.toArray(), db.dictionaries.toArray()
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), trips, expenses, payments, clients, dictionaries };
}

export async function mergeRemoteDbToLocal(remoteData) {
  if (!remoteData || typeof remoteData !== 'object') throw new Error('Некорректные данные');

  const mergeTable = async (tableName, remoteItems) => {
    if (!Array.isArray(remoteItems)) return;
    const table = db[tableName];
    if (!table) return;
    const localItems = await table.toArray();

    for (const item of remoteItems) {
      if (!item) continue;
      let existing = null;
      if (tableName === 'trips') {
        existing = localItems.find(l =>
          (l.appNo && l.appNo === item.appNo) ||
          (l.client === item.client && l.startDate === item.startDate)
        );
      } else if (tableName === 'expenses' || tableName === 'payments') {
        existing = localItems.find(l =>
          l.tripId === item.tripId && l.amount === item.amount && l.date === item.date
        );
      } else if (tableName === 'clients') {
        existing = localItems.find(l => l.name && l.name.toLowerCase() === (item.name||'').toLowerCase());
      } else if (tableName === 'dictionaries') {
        existing = localItems.find(l => l.category === item.category && l.value === item.value);
      }

      if (!existing) {
        const copy = { ...item }; delete copy.id;
        await table.add(copy);
      } else {
        const lt = new Date(existing.updatedAt||0).getTime();
        const rt = new Date(item.updatedAt||0).getTime();
        if (rt >= lt) await table.put({ ...item, id: existing.id });
      }
    }
  };

  await mergeTable('trips',       remoteData.trips);
  await mergeTable('expenses',    remoteData.expenses);
  await mergeTable('payments',    remoteData.payments);
  await mergeTable('clients',     remoteData.clients);
  await mergeTable('dictionaries',remoteData.dictionaries);
}

// ─────────────────────────────────────────────────────────────────
// ХРАНИЛИЩЕ КЛЮЧА: custom_properties на папках Яндекс Диска
// Работает через cloud-api.yandex.net — без CORS-блокировки!
// ─────────────────────────────────────────────────────────────────

async function saveKeyToCustomProps(token, publicKey) {
  // Пробуем записать ключ на ОБА пути (app:/ и disk:/)
  // Каждый токен запишет туда, куда у него есть доступ
  for (const folderPath of ['app:/', 'disk:/']) {
    try {
      await fetch(
        `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(folderPath)}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `OAuth ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ custom_properties: { btrips_sync_key: publicKey } })
        }
      );
    } catch(e) { /* у токена нет прав на этот путь — пропускаем */ }
  }
}

async function loadKeyFromCustomProps(token) {
  // Читаем ключ с любого доступного пути
  for (const folderPath of ['app:/', 'disk:/']) {
    try {
      const res = await fetch(
        `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(folderPath)}&fields=custom_properties`,
        {
          method: 'GET',
          headers: { 'Authorization': `OAuth ${token}`, 'Accept': 'application/json' }
        }
      );
      if (!res.ok) continue;
      const meta = await res.json();
      if (meta.custom_properties && meta.custom_properties.btrips_sync_key) {
        return meta.custom_properties.btrips_sync_key;
      }
    } catch(e) { /* пробуем следующий путь */ }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// ЗАГРУЗКА (UPLOAD) + ПУБЛИКАЦИЯ
// ─────────────────────────────────────────────────────────────────

async function tryUploadToPath(token, targetPath, jsonStr) {
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(targetPath)}&overwrite=true`,
    { method: 'GET', headers: { 'Authorization': `OAuth ${token}`, 'Accept': 'application/json' } }
  );
  if (!res.ok) {
    let msg = await res.text();
    try { msg = JSON.parse(msg).message || msg; } catch(e) {}
    throw { status: res.status, message: msg };
  }
  const { href } = await res.json();
  const put = await fetch(href, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: jsonStr
  });
  if (!put.ok) throw new Error(`Ошибка PUT: ${put.status}`);
  return targetPath;
}

async function publishFile(token, filePath) {
  // Публикуем файл
  await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/publish?path=${encodeURIComponent(filePath)}`,
    { method: 'PUT', headers: { 'Authorization': `OAuth ${token}` } }
  ).catch(() => {});

  // Читаем public_key из метаданных
  const meta = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(filePath)}&fields=public_key`,
    { method: 'GET', headers: { 'Authorization': `OAuth ${token}`, 'Accept': 'application/json' } }
  ).catch(() => null);

  if (meta && meta.ok) {
    const json = await meta.json();
    return json.public_key || null;
  }
  return null;
}

export async function uploadToYandexDisk(token) {
  if (!token) throw new Error('Токен не указан');

  const dbData  = await exportLocalDbToJson();
  const jsonStr = JSON.stringify(dbData, null, 2);

  // Пробуем выгрузить (app:/ или disk:/)
  let usedPath = null;
  for (const path of [PATH_APP, PATH_DISK]) {
    try { await tryUploadToPath(token, path, jsonStr); usedPath = path; break; }
    catch(e) { /* пробуем следующий */ }
  }
  if (!usedPath) throw new Error('Не удалось выгрузить файл на Яндекс Диск');

  // Публикуем и получаем ключ
  const publicKey = await publishFile(token, usedPath);
  if (publicKey) {
    localStorage.setItem(LS_PUBLIC_KEY, publicKey);
    // Сохраняем ключ в custom_properties Яндекс Диска — доступно с любого устройства!
    await saveKeyToCustomProps(token, publicKey);
  }

  return { success: true, path: usedPath, publicKey, tripsCount: dbData.trips.length };
}

// ─────────────────────────────────────────────────────────────────
// СКАЧИВАНИЕ через public_key (cloud-api, без CORS-блокировки)
// ─────────────────────────────────────────────────────────────────

async function downloadViaPublicKey(publicKey) {
  // Шаг 1: получаем прямую ссылку скачивания через основной API (CORS работает)
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(publicKey)}`,
    { method: 'GET', headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) {
    let msg = await res.text();
    try { msg = JSON.parse(msg).message || msg; } catch(e) {}
    throw new Error(`Ошибка получения ссылки: ${msg}`);
  }
  const { href } = await res.json();

  // Шаг 2: скачиваем файл через локальный прокси-сервер (обходит CORS блокировку)
  // Прокси на нашем Vite сервере делает запрос к downloader.disk.yandex.ru серверно
  const proxyUrl = `/api/yandex-download?href=${encodeURIComponent(href)}`;
  const file = await fetch(proxyUrl, { cache: 'no-store' });
  if (!file.ok) throw new Error(`Ошибка загрузки через прокси: ${file.status}`);
  return await file.json();
}

// ─────────────────────────────────────────────────────────────────
// ОСНОВНАЯ ФУНКЦИЯ
// ─────────────────────────────────────────────────────────────────

export async function downloadAndMergeFromYandexDisk(token) {
  if (!token) throw new Error('Токен не указан');

  // 1. Ищем public_key: localStorage → custom_properties на Диске
  let publicKey = localStorage.getItem(LS_PUBLIC_KEY);

  if (!publicKey) {
    publicKey = await loadKeyFromCustomProps(token);
    if (publicKey) localStorage.setItem(LS_PUBLIC_KEY, publicKey);
  }

  // 2. Если ключ есть — скачиваем и объединяем
  if (publicKey) {
    try {
      const remoteData = await downloadViaPublicKey(publicKey);
      const remoteTripsCount = Array.isArray(remoteData.trips) ? remoteData.trips.length : 0;

      await mergeRemoteDbToLocal(remoteData);
      const uploadRes = await uploadToYandexDisk(token);
      const finalDb   = await exportLocalDbToJson();

      return {
        success: true,
        mergedAt: new Date().toISOString(),
        path: uploadRes.path,
        remoteTripsCount,
        finalTripsCount: finalDb.trips.length
      };
    } catch(err) {
      localStorage.removeItem(LS_PUBLIC_KEY);
      throw new Error(`Ошибка синхронизации: ${err.message || err}`);
    }
  }

  // 3. Ключ не найден — первичный запуск
  const localDb = await exportLocalDbToJson();
  if (localDb.trips.length === 0) {
    throw new Error(
      'Файл синхронизации не найден на Яндекс Диске. ' +
      'Сначала выполните синхронизацию на устройстве где есть данные (ПК).'
    );
  }

  // Есть локальные данные — первичная выгрузка
  const uploadRes = await uploadToYandexDisk(token);
  return {
    success: true,
    isNew: true,
    path: uploadRes.path,
    tripsCount: localDb.trips.length,
    finalTripsCount: localDb.trips.length
  };
}

// ─────────────────────────────────────────────────────────────────
// OAuth: токен из URL hash
// ─────────────────────────────────────────────────────────────────

export function checkAndExtractYandexTokenFromUrl() {
  const hash = window.location.hash;
  if (!hash) return null;
  const match = hash.match(/access_token=([^&]+)/);
  if (match && match[1]) {
    const token = match[1];
    localStorage.setItem('yandex_disk_oauth_token', token);
    history.replaceState(null, '', window.location.pathname);
    return token;
  }
  return null;
}
