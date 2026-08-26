import { db, getDeletedItems, markItemDeleted, cleanupDuplicates, getFuelSettings } from './db.js';

const SUPABASE_URL = 'https://olstydvepzilryzxeipl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_J8fHZmiYuIhSRA89W4R9Rg_9EfVwAOO';

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// Хелпер REST запросов к Supabase
async function supabaseFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error (${response.status}): ${errorText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await response.json();
  }
  return null;
}

// Загрузка бинарного файла/Base64 в Supabase Storage
export async function uploadReceiptToStorage(base64Data, originalFileName) {
  if (!base64Data) return null;
  try {
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    const ext = (originalFileName || 'file.jpg').split('.').pop().toLowerCase();
    const mimeType = ext === 'pdf' ? 'application/pdf' : (ext === 'png' ? 'image/png' : 'image/jpeg');
    const blob = new Blob([byteArray], { type: mimeType });

    const safeName = (originalFileName || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${safeName}`;

    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/receipts/${path}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType
      },
      body: blob
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.warn("Storage upload failed, falling back to local:", err);
      return null;
    }

    return `${SUPABASE_URL}/storage/v1/object/public/receipts/${path}`;
  } catch (err) {
    console.error("uploadReceiptToStorage error:", err);
    return null;
  }
}

// Главная функция двусторонней быстрой синхронизации через Supabase
export async function syncWithSupabase() {
  await cleanupDuplicates();

  // 1. Применяем удаленные элементы в Supabase
  const localDeleted = getDeletedItems();
  if (localDeleted.length > 0) {
    for (const d of localDeleted) {
      try {
        const delId = d.uuid || d.compositeKey || `${d.tableName}_${d.id || d.tripId || ''}`;
        await supabaseFetch('deleted_items', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({
            id: delId,
            table_name: d.tableName,
            item_id: String(d.id || d.uuid || ''),
            deleted_at: d.deletedAt || new Date().toISOString()
          })
        });

        // Удаляем саму запись из облачной таблицы
        if (d.tableName && ['trips', 'expenses', 'payments'].includes(d.tableName)) {
          if (d.id) {
            await supabaseFetch(`${d.tableName}?id=eq.${d.id}`, { method: 'DELETE' });
          }
          // Если это расход/выплата и есть композитные данные, удалим и по совпадению полей на случай расхождения id
          if (d.tableName === 'expenses' && d.tripId && d.amount && d.date) {
            await supabaseFetch(`expenses?trip_id=eq.${d.tripId}&amount=eq.${d.amount}&date=eq.${encodeURIComponent(d.date)}`, { method: 'DELETE' });
          }
          if (d.tableName === 'payments' && d.tripId && d.amount && d.date) {
            await supabaseFetch(`payments?trip_id=eq.${d.tripId}&amount=eq.${d.amount}&date=eq.${encodeURIComponent(d.date)}`, { method: 'DELETE' });
          }
        }
      } catch (e) {
        console.warn("Error pushing deleted item:", e);
      }
    }
  }

  // 2. Скачиваем актуальный список удалений из Supabase
  const remoteDeleted = await supabaseFetch('deleted_items?select=*');
  const mergedDeletedMap = new Map();
  [...localDeleted, ...(remoteDeleted || []).map(r => ({
    tableName: r.table_name,
    uuid: r.id,
    id: r.item_id,
    compositeKey: r.id,
    deletedAt: r.deleted_at
  }))].forEach(d => {
    if (d) {
      const key = d.uuid || d.compositeKey || `${d.tableName}_${d.id || ''}`;
      mergedDeletedMap.set(key, d);
    }
  });
  const mergedDeletedList = Array.from(mergedDeletedMap.values());
  localStorage.setItem('btrips_deleted_items', JSON.stringify(mergedDeletedList));

  // Хелпер проверки на удаленность
  const isRecordDeleted = (tableName, record) => {
    if (!record) return false;
    const recId = record.id != null ? String(record.id) : '';
    const recUuid = record.uuid ? String(record.uuid) : '';
    return mergedDeletedList.some(d => {
      if (d.tableName !== tableName) return false;
      // Точное совпадение по числовому/строковому id
      if (recId && (String(d.id) === recId || String(d.uuid) === recId || d.compositeKey === `${tableName}_${recId}`)) return true;
      // Точное совпадение по uuid
      if (recUuid && (String(d.uuid) === recUuid || String(d.id) === recUuid)) return true;
      // Точное совпадение по композитному ключу для расходов и выплат
      if (tableName === 'expenses' || tableName === 'payments') {
        const tripId = String(record.tripId || record.trip_id || '');
        const amount = String(record.amount || '');
        const date = String(record.date || '');
        const note = String(record.note || record.description || '').trim();
        const compKey = `${tableName}_${tripId}_${amount}_${date}_${note}`;
        if (d.compositeKey === compKey) return true;
      }
      return false;
    });
  };

  // 3. Синхронизация TRIPS
  const remoteTrips = await supabaseFetch('trips?select=*');
  const localTrips = await db.trips.toArray();

  // Отправляем новые / обновленные локальные поездки в Supabase
  for (const lt of localTrips) {
    if (isRecordDeleted('trips', lt)) {
      await db.trips.delete(lt.id);
      continue;
    }
    const rt = remoteTrips?.find(r => String(r.id) === String(lt.id));
    if (!rt || new Date(lt.updatedAt || 0) > new Date(rt.updated_at || 0)) {
      await supabaseFetch('trips', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: lt.id,
          app_no: lt.appNo || '',
          client: lt.client || '',
          location: lt.location || '',
          work_type: lt.workType || '',
          transport: lt.transport || '',
          start_date: lt.startDate || '',
          finish_date: lt.finishDate || '',
          odo_start: lt.odoStart || 0,
          odo_finish: lt.odoFinish || 0,
          status: lt.status || 'не подготовлен',
          per_diem_rate: lt.perDiemRate || 1100,
          note: lt.note || '',
          updated_at: lt.updatedAt || new Date().toISOString()
        })
      });
    }
  }

  // Принимаем поездки из Supabase в локальную базу
  for (const rt of (remoteTrips || [])) {
    if (isRecordDeleted('trips', rt)) {
      await db.trips.delete(rt.id);
      continue;
    }
    const lt = localTrips.find(l => String(l.id) === String(rt.id));
    const tripObj = {
      id: rt.id,
      appNo: rt.app_no,
      client: rt.client,
      location: rt.location,
      workType: rt.work_type,
      transport: rt.transport,
      startDate: rt.start_date,
      finishDate: rt.finish_date,
      odoStart: parseFloat(rt.odo_start) || 0,
      odoFinish: parseFloat(rt.odo_finish) || 0,
      status: rt.status,
      perDiemRate: parseFloat(rt.per_diem_rate) || 1100,
      note: rt.note,
      updatedAt: rt.updated_at
    };
    if (!lt) {
      await db.trips.put(tripObj);
    } else if (new Date(rt.updated_at || 0) > new Date(lt.updatedAt || 0)) {
      await db.trips.put(tripObj);
    }
  }

  // 4. Синхронизация EXPENSES (с автоматической выгрузкой чеков в Storage)
  const remoteExpenses = await supabaseFetch('expenses?select=*');
  const localExpenses = await db.expenses.toArray();

  for (const le of localExpenses) {
    if (isRecordDeleted('expenses', le)) {
      await db.expenses.delete(le.id);
      continue;
    }
    const re = remoteExpenses?.find(r => String(r.id) === String(le.id));
    
    // Если есть локальный чек Base64 и нет receipt_url в облаке — загружаем в Storage
    let receiptUrl = le.receiptUrl || (re ? re.receipt_url : null);
    if (!receiptUrl && le.receiptBase64) {
      receiptUrl = await uploadReceiptToStorage(le.receiptBase64, le.receiptName);
      if (receiptUrl) {
        await db.expenses.update(le.id, { receiptUrl });
      }
    }

    if (!re || new Date(le.updatedAt || 0) > new Date(re.updated_at || 0)) {
      await supabaseFetch('expenses', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: le.id,
          trip_id: String(le.tripId || ''),
          date: le.date || '',
          amount: parseFloat(le.amount) || 0,
          description: le.description || '',
          category: le.category || '',
          payment_type: le.paymentType || 'cash',
          article_code: le.articleCode || '',
          receipt_url: receiptUrl || null,
          receipt_name: le.receiptName || '',
          updated_at: le.updatedAt || new Date().toISOString()
        })
      });
    }
  }

  for (const re of (remoteExpenses || [])) {
    if (isRecordDeleted('expenses', re)) {
      await db.expenses.delete(re.id);
      continue;
    }
    const le = localExpenses.find(l => String(l.id) === String(re.id));
    const expObj = {
      id: re.id,
      tripId: re.trip_id,
      date: re.date,
      amount: parseFloat(re.amount) || 0,
      description: re.description,
      category: re.category,
      paymentType: re.payment_type,
      articleCode: re.article_code,
      receiptUrl: re.receipt_url,
      receiptName: re.receipt_name,
      receiptBase64: le?.receiptBase64 || '', // сохраняем локальный кеш если был
      updatedAt: re.updated_at
    };
    if (!le) {
      await db.expenses.put(expObj);
    } else if (new Date(re.updated_at || 0) > new Date(le.updatedAt || 0)) {
      await db.expenses.put({ ...expObj, receiptBase64: le.receiptBase64 || '' });
    }
  }

  // 5. Синхронизация PAYMENTS
  const remotePayments = await supabaseFetch('payments?select=*');
  const localPayments = await db.payments.toArray();

  for (const lp of localPayments) {
    if (isRecordDeleted('payments', lp)) {
      await db.payments.delete(lp.id);
      continue;
    }
    const rp = remotePayments?.find(r => String(r.id) === String(lp.id));
    if (!rp || new Date(lp.updatedAt || 0) > new Date(rp.updated_at || 0)) {
      await supabaseFetch('payments', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: lp.id,
          trip_id: String(lp.tripId || ''),
          date: lp.date || '',
          amount: parseFloat(lp.amount) || 0,
          note: lp.note || '',
          updated_at: lp.updatedAt || new Date().toISOString()
        })
      });
    }
  }

  for (const rp of (remotePayments || [])) {
    if (isRecordDeleted('payments', rp)) {
      await db.payments.delete(rp.id);
      continue;
    }
    const lp = localPayments.find(l => String(l.id) === String(rp.id));
    const payObj = {
      id: rp.id,
      tripId: rp.trip_id,
      date: rp.date,
      amount: parseFloat(rp.amount) || 0,
      note: rp.note,
      updatedAt: rp.updated_at
    };
    if (!lp) {
      await db.payments.put(payObj);
    } else if (new Date(rp.updated_at || 0) > new Date(lp.updatedAt || 0)) {
      await db.payments.put(payObj);
    }
  }

  // 6. Синхронизация CLIENTS
  const remoteClients = await supabaseFetch('clients?select=*');
  const localClients = await db.clients.toArray();

  for (const lc of localClients) {
    const rc = remoteClients.find(r => r.name.toLowerCase() === lc.name.toLowerCase());
    if (!rc || new Date(lc.updatedAt || 0) > new Date(rc.updated_at || 0)) {
      await supabaseFetch('clients', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          name: lc.name,
          address: lc.address || '',
          updated_at: lc.updatedAt || new Date().toISOString()
        })
      });
    }
  }

  for (const rc of remoteClients) {
    const lc = localClients.find(l => l.name.toLowerCase() === rc.name.toLowerCase());
    if (!lc) {
      await db.clients.add({ name: rc.name, address: rc.address || '', updatedAt: rc.updated_at });
    } else if (new Date(rc.updated_at || 0) > new Date(lc.updatedAt || 0)) {
      await db.clients.update(lc.id, { address: rc.address || '', updatedAt: rc.updated_at });
    }
  }

  // 7. Синхронизация DICTIONARIES
  const remoteDicts = await supabaseFetch('dictionaries?select=*');
  const localDicts = await db.dictionaries.toArray();

  if (remoteDicts && remoteDicts.length > 0) {
    for (const rd of remoteDicts) {
      const exists = localDicts.some(ld => ld.category === rd.category && ld.value.toLowerCase() === rd.value.toLowerCase());
      if (!exists) {
        await db.dictionaries.add({ category: rd.category, value: rd.value });
      }
    }
  } else if (localDicts.length > 0) {
    for (const ld of localDicts) {
      await supabaseFetch('dictionaries', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          category: ld.category,
          value: ld.value,
          updated_at: new Date().toISOString()
        })
      });
    }
  }

  // 8. Синхронизация FUEL SETTINGS
  try {
    const localFuel = getFuelSettings();
    const remoteFuelRes = await supabaseFetch('fuel_settings?id=eq.default');
    if (remoteFuelRes && remoteFuelRes.length > 0) {
      const rf = remoteFuelRes[0];
      if (rf.settings) {
        if (rf.settings.summerRate) localStorage.setItem('fuelSummerRate', rf.settings.summerRate);
        if (rf.settings.winterRate) localStorage.setItem('fuelWinterRate', rf.settings.winterRate);
        if (rf.settings.pricePerLiter) localStorage.setItem('fuelPricePerLiter', rf.settings.pricePerLiter);
        if (rf.settings.deductibleKm) localStorage.setItem('depreciationDeductibleKm', rf.settings.deductibleKm);
        if (rf.settings.ratePerKm) localStorage.setItem('depreciationRatePerKm', rf.settings.ratePerKm);
      }
    } else {
      await supabaseFetch('fuel_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: 'default',
          settings: localFuel,
          updated_at: new Date().toISOString()
        })
      });
    }
  } catch (e) {
    console.warn("Fuel settings sync error:", e);
  }

  const finalTrips = await db.trips.count();
  return {
    success: true,
    tripsCount: finalTrips,
    syncedAt: new Date().toISOString()
  };
}
