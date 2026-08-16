import { db, getDeletedItems, markItemDeleted, cleanupDuplicates } from './db.js';

const GIST_FILENAME = 'btrips_sync_database.json';
const LS_GIST_ID    = 'github_gist_id';
const LS_DICT_TIME  = 'dictionaries_updated_at';

// ─────────────────────────────────────────────────────────────────
// БД: экспорт и слияние
// ─────────────────────────────────────────────────────────────────

export async function exportLocalDbToJson() {
  await cleanupDuplicates();
  const [trips, expenses, payments, clients, dictionaries] = await Promise.all([
    db.trips.toArray(), db.expenses.toArray(), db.payments.toArray(),
    db.clients.toArray(), db.dictionaries.toArray()
  ]);

  const dictTime = localStorage.getItem(LS_DICT_TIME) || new Date().toISOString();
  const deletedItems = getDeletedItems();

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    trips, expenses, payments, clients,
    deletedItems,
    dictionaries: {
      updatedAt: dictTime,
      items: dictionaries
    }
  };
}

export async function mergeRemoteDbToLocal(remoteData) {
  if (!remoteData || typeof remoteData !== 'object') throw new Error('Некорректные данные');

  const remoteDeleted = Array.isArray(remoteData.deletedItems) ? remoteData.deletedItems : [];
  const localDeleted = getDeletedItems();

  // Объединяем списки удалений по нескольким ключам
  const mergedDeletedMap = new Map();
  [...localDeleted, ...remoteDeleted].forEach(d => {
    if (d) {
      const key = d.uuid || d.compositeKey || `${d.tableName || ''}_${d.id || ''}_${d.tripId || ''}_${d.amount || ''}_${d.date || ''}`;
      mergedDeletedMap.set(key, d);
    }
  });

  const mergedDeletedArray = Array.from(mergedDeletedMap.values());
  localStorage.setItem('btrips_deleted_items', JSON.stringify(mergedDeletedArray));

  const isItemDeleted = (tableName, item) => {
    if (!item) return false;
    const itemUuid = item.uuid || '';
    const itemKey = `${tableName}_${item.tripId || ''}_${item.amount || ''}_${item.date || ''}_${(item.note || item.description || '').trim()}`;

    return mergedDeletedArray.some(d => 
      ((itemUuid && d.uuid === itemUuid) || d.compositeKey === itemKey || d.uuid === itemKey)
    );
  };

  const mergeTable = async (tableName, remoteItems) => {
    if (!Array.isArray(remoteItems)) return;
    const table = db[tableName];
    if (!table) return;
    const localItems = await table.toArray();

    for (const item of remoteItems) {
      if (!item) continue;

      // Если объект в списке удаленных — удаляем из локальной базы и не вставляем!
      if (isItemDeleted(tableName, item)) {
        const localMatch = localItems.find(l => 
          (l.uuid && l.uuid === item.uuid) ||
          (l.tripId === item.tripId && l.amount === item.amount && l.date === item.date)
        );
        if (localMatch) {
          await table.delete(localMatch.id);
        }
        continue;
      }

      let existing = null;

      if (tableName === 'trips') {
        existing = localItems.find(l =>
          (l.uuid && l.uuid === item.uuid) ||
          (l.appNo && l.appNo === item.appNo) ||
          (l.client === item.client && l.startDate === item.startDate)
        );
      } else if (tableName === 'expenses' || tableName === 'payments') {
        existing = localItems.find(l =>
          (l.uuid && l.uuid === item.uuid) ||
          (l.tripId === item.tripId && l.amount === item.amount && l.date === item.date)
        );
      } else if (tableName === 'clients') {
        existing = localItems.find(l =>
          l.name && l.name.toLowerCase() === (item.name || '').toLowerCase()
        );
      }

      if (!existing) {
        const copy = { ...item }; delete copy.id;
        await table.add(copy);
      } else {
        const lt = new Date(existing.updatedAt || 0).getTime();
        const rt = new Date(item.updatedAt  || 0).getTime();
        if (rt >= lt) await table.put({ ...item, id: existing.id });
      }
    }
  };

  await mergeTable('trips',        remoteData.trips);
  await mergeTable('expenses',     remoteData.expenses);
  await mergeTable('payments',     remoteData.payments);
  await mergeTable('clients',      remoteData.clients);

  await cleanupDuplicates();

  // ─────────────────────────────────────────────────────────────────
  // УМНАЯ СИНХРОНИЗАЦИЯ СПРАВОЧНИКОВ:
  // Если на удалённом сервере справочники редактировались позже — 
  // они полностью заменяют локальные (с учётом удалений элементов)!
  // ─────────────────────────────────────────────────────────────────
  if (remoteData.dictionaries) {
    let remoteDictItems = [];
    let remoteDictTimeStr = null;

    if (Array.isArray(remoteData.dictionaries)) {
      remoteDictItems = remoteData.dictionaries;
      remoteDictTimeStr = remoteData.exportedAt || null;
    } else if (typeof remoteData.dictionaries === 'object') {
      remoteDictItems = remoteData.dictionaries.items || [];
      remoteDictTimeStr = remoteData.dictionaries.updatedAt || null;
    }

    const remoteDictTime = new Date(remoteDictTimeStr || 0).getTime();
    const localDictTime  = new Date(localStorage.getItem(LS_DICT_TIME) || 0).getTime();

    if (remoteDictTime > localDictTime) {
      // Удалённый справочник новее — полностью замещаем локальный справочник!
      await db.dictionaries.clear();
      for (const item of remoteDictItems) {
        if (!item) continue;
        const copy = { ...item }; delete copy.id;
        await db.dictionaries.add(copy);
      }
      localStorage.setItem(LS_DICT_TIME, new Date(remoteDictTime).toISOString());
    } else if (localDictTime === 0) {
      // Первый запуск — импортируем отсутствующие элементы
      for (const item of remoteDictItems) {
        if (!item) continue;
        const existing = await db.dictionaries.where({ category: item.category, value: item.value }).first();
        if (!existing) {
          const copy = { ...item }; delete copy.id;
          await db.dictionaries.add(copy);
        }
      }
      localStorage.setItem(LS_DICT_TIME, new Date().toISOString());
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// GitHub Gist: вспомогательные функции
// ─────────────────────────────────────────────────────────────────

function githubHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function createGist(token, content) {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({
      description: 'Business Trips PWA sync database',
      public: false,
      files: {
        [GIST_FILENAME]: { content }
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка создания Gist: ${res.status} ${err}`);
  }
  return await res.json();
}

async function updateGist(token, gistId, content) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: githubHeaders(token),
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: { content }
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 404) throw { status: 404, message: 'Gist не найден' };
    throw new Error(`Ошибка обновления Gist: ${res.status} ${errText}`);
  }
  return await res.json();
}

async function readGist(token, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'GET',
    headers: githubHeaders(token)
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 404) throw { status: 404, message: 'Gist не найден' };
    throw new Error(`Ошибка чтения Gist: ${res.status} ${errText}`);
  }

  const gist = await res.json();
  const file = gist.files[GIST_FILENAME];
  if (!file) throw new Error(`Файл ${GIST_FILENAME} не найден в Gist`);

  let content = file.content;

  if (file.truncated && file.raw_url) {
    const rawRes = await fetch(file.raw_url);
    if (!rawRes.ok) throw new Error(`Ошибка скачивания файла Gist: ${rawRes.status}`);
    content = await rawRes.text();
  }

  return JSON.parse(content);
}

// ─────────────────────────────────────────────────────────────────
// ОСНОВНЫЕ ФУНКЦИИ
// ─────────────────────────────────────────────────────────────────

export async function uploadToGithubGist(token) {
  if (!token) throw new Error('GitHub токен не указан');

  const dbData  = await exportLocalDbToJson();
  const content = JSON.stringify(dbData, null, 2);

  let gistId = localStorage.getItem(LS_GIST_ID);
  let gist;

  if (gistId) {
    try {
      gist = await updateGist(token, gistId, content);
    } catch (err) {
      if (err.status === 404) {
        gist = await createGist(token, content);
        localStorage.setItem(LS_GIST_ID, gist.id);
      } else {
        throw err;
      }
    }
  } else {
    gist = await createGist(token, content);
    localStorage.setItem(LS_GIST_ID, gist.id);
  }

  return {
    success: true,
    gistId: gist.id,
    tripsCount: dbData.trips.length
  };
}

export async function downloadAndMergeFromGithubGist(token) {
  if (!token) throw new Error('GitHub токен не указан');

  const gistId = localStorage.getItem(LS_GIST_ID);

  if (gistId) {
    try {
      const remoteData = await readGist(token, gistId);
      const remoteTripsCount = Array.isArray(remoteData.trips) ? remoteData.trips.length : 0;

      await mergeRemoteDbToLocal(remoteData);

      const uploadRes  = await uploadToGithubGist(token);
      const finalDb    = await exportLocalDbToJson();

      return {
        success: true,
        mergedAt: new Date().toISOString(),
        gistId,
        remoteTripsCount,
        finalTripsCount: finalDb.trips.length
      };
    } catch (err) {
      if (err.status === 404) {
        localStorage.removeItem(LS_GIST_ID);
        const uploadRes = await uploadToGithubGist(token);
        const localDb   = await exportLocalDbToJson();
        return {
          success: true,
          isNew: true,
          gistId: uploadRes.gistId,
          finalTripsCount: localDb.trips.length
        };
      }
      throw err;
    }
  }

  const localDb = await exportLocalDbToJson();

  if (localDb.trips.length === 0) {
    throw new Error(
      'Gist ID не найден. Сначала выполните синхронизацию на устройстве где есть данные (ПК), ' +
      'затем скопируйте Gist ID в настройки этого устройства.'
    );
  }

  const uploadRes = await uploadToGithubGist(token);
  return {
    success: true,
    isNew: true,
    gistId: uploadRes.gistId,
    finalTripsCount: localDb.trips.length
  };
}
