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
export async function syncWithSupabase(forceFullPull = false) {
  await cleanupDuplicates();

  // 1. Применяем только действительно удаленные пользователем элементы в Supabase
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

        if (d.tableName && ['trips', 'expenses', 'payments'].includes(d.tableName)) {
          if (d.id) {
            await supabaseFetch(`${d.tableName}?id=eq.${d.id}`, { method: 'DELETE' });
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
  (remoteDeleted || []).forEach(r => {
    if (r) {
      mergedDeletedMap.set(r.id, {
        tableName: r.table_name,
        uuid: r.id,
        id: r.item_id,
        compositeKey: r.id,
        deletedAt: r.deleted_at
      });
    }
  });
  const mergedDeletedList = Array.from(mergedDeletedMap.values());
  localStorage.setItem('btrips_deleted_items', JSON.stringify(mergedDeletedList));

  const isRecordDeleted = (tableName, record) => {
    if (!record) return false;
    const recId = record.id != null ? String(record.id) : '';
    const recUuid = record.uuid ? String(record.uuid) : '';
    return mergedDeletedList.some(d => {
      if (d.tableName !== tableName) return false;
      if (recId && (String(d.id) === recId || String(d.uuid) === recId || d.compositeKey === `${tableName}_${recId}`)) return true;
      if (recUuid && (String(d.uuid) === recUuid || String(d.id) === recUuid)) return true;
      return false;
    });
  };

  // 3. Синхронизация TRIPS
  const remoteTrips = await supabaseFetch('trips?select=*');
  const localTrips = await db.trips.toArray();

  // Принимаем ВСЕ актуальные поездки из Supabase в локальную базу
  for (const rt of (remoteTrips || [])) {
    if (isRecordDeleted('trips', rt)) {
      await db.trips.delete(rt.id);
      continue;
    }
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
    await db.trips.put(tripObj);
  }

  // Удаляем локальные поездки, которых нет в облаке (если они удалены)
  for (const lt of localTrips) {
    const existsInCloud = remoteTrips?.some(r => String(r.id) === String(lt.id));
    if (!existsInCloud && !lt.uuid) {
      await db.trips.delete(lt.id);
    }
  }

  // Отправляем ТОЛЬКО действительно более свежие локальные поездки в Supabase
  const refreshedLocalTrips = await db.trips.toArray();
  for (const lt of refreshedLocalTrips) {
    if (isRecordDeleted('trips', lt)) {
      continue;
    }
    const rt = remoteTrips?.find(r => String(r.id) === String(lt.id));
    // Отправляем в облако ТОЛЬКО если записи нет в облаке ИЛИ локальная строго новее облачной
    if (!rt || (new Date(lt.updatedAt || 0).getTime() > new Date(rt.updated_at || 0).getTime())) {
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

  // 4. Синхронизация EXPENSES
  const remoteExpenses = await supabaseFetch('expenses?select=*');
  const localExpenses = await db.expenses.toArray();

  // Принимаем ВСЕ расходы из Supabase
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
      receiptBase64: le?.receiptBase64 || '',
      updatedAt: re.updated_at
    };
    await db.expenses.put(expObj);
  }

  // Удаляем локальные расходы, которых нет в облаке
  for (const le of localExpenses) {
    const exists = remoteExpenses?.some(r => String(r.id) === String(le.id));
    if (!exists && !le.uuid) {
      await db.expenses.delete(le.id);
    }
  }

  // 5. Синхронизация PAYMENTS
  const remotePayments = await supabaseFetch('payments?select=*');
  const localPayments = await db.payments.toArray();

  // Принимаем ВСЕ выплаты из Supabase
  for (const rp of (remotePayments || [])) {
    if (isRecordDeleted('payments', rp)) {
      await db.payments.delete(rp.id);
      continue;
    }
    const payObj = {
      id: rp.id,
      tripId: rp.trip_id,
      date: rp.date,
      amount: parseFloat(rp.amount) || 0,
      note: rp.note,
      updatedAt: rp.updated_at
    };
    await db.payments.put(payObj);
  }

  // Удаляем локальные выплаты, которых нет в облаке
  for (const lp of localPayments) {
    const exists = remotePayments?.some(r => String(r.id) === String(lp.id));
    if (!exists && !lp.uuid) {
      await db.payments.delete(lp.id);
    }
  }

  // 6. Синхронизация CLIENTS
  const remoteClients = await supabaseFetch('clients?select=*');
  const localClients = await db.clients.toArray();

  for (const rc of (remoteClients || [])) {
    const lc = localClients.find(l => l.name.toLowerCase() === rc.name.toLowerCase());
    if (!lc) {
      await db.clients.add({ name: rc.name, address: rc.address || '', updatedAt: rc.updated_at });
    } else if (new Date(rc.updated_at || 0).getTime() >= new Date(lc.updatedAt || 0).getTime()) {
      await db.clients.update(lc.id, { address: rc.address || '', updatedAt: rc.updated_at });
    }
  }

  const refreshedLocalClients = await db.clients.toArray();
  for (const lc of refreshedLocalClients) {
    const rc = remoteClients?.find(r => r.name.toLowerCase() === lc.name.toLowerCase());
    if (!rc || (new Date(lc.updatedAt || 0).getTime() > new Date(rc.updated_at || 0).getTime())) {
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

  // 8. Синхронизация FUEL SETTINGS & 2FA SECURITY
  try {
    const localFuel = getFuelSettings();
    const local2FASecret = localStorage.getItem('btrip_2fa_secret') || '';
    const remoteFuelRes = await supabaseFetch('fuel_settings?id=eq.default');
    if (remoteFuelRes && remoteFuelRes.length > 0) {
      const rf = remoteFuelRes[0];
      if (rf.settings) {
        if (rf.settings.summerRate) localStorage.setItem('fuelSummerRate', rf.settings.summerRate);
        if (rf.settings.winterRate) localStorage.setItem('fuelWinterRate', rf.settings.winterRate);
        if (rf.settings.pricePerLiter) localStorage.setItem('fuelPricePerLiter', rf.settings.pricePerLiter);
        if (rf.settings.deductibleKm) localStorage.setItem('depreciationDeductibleKm', rf.settings.deductibleKm);
        if (rf.settings.ratePerKm) localStorage.setItem('depreciationRatePerKm', rf.settings.ratePerKm);

        // Синхронизация 2FA секрета
        if (rf.settings.twoFactorSecret) {
          const currentSecret = localStorage.getItem('btrip_2fa_secret');
          if (currentSecret !== rf.settings.twoFactorSecret) {
            localStorage.setItem('btrip_2fa_secret', rf.settings.twoFactorSecret);
            // Если на этом устройстве сессия еще не подтверждена - триггерим проверку
            if (typeof window.check2FAAuthGate === 'function') window.check2FAAuthGate();
            if (typeof window.update2FAStatusUI === 'function') window.update2FAStatusUI();
          }
        } else if (rf.settings.twoFactorSecret === '' && localStorage.getItem('btrip_2fa_secret')) {
          // 2FA была отключена на другом устройстве
          localStorage.removeItem('btrip_2fa_secret');
          localStorage.removeItem('btrip_2fa_session_expires');
          if (typeof window.hideLockScreen === 'function') window.hideLockScreen();
          if (typeof window.update2FAStatusUI === 'function') window.update2FAStatusUI();
        }
      }

      // Если локально включили 2FA, а в облаке еще нет - пушим в облако
      if (local2FASecret && rf.settings && rf.settings.twoFactorSecret !== local2FASecret) {
        await supabaseFetch('fuel_settings', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({
            id: 'default',
            settings: { ...rf.settings, ...localFuel, twoFactorSecret: local2FASecret },
            updated_at: new Date().toISOString()
          })
        });
      }
    } else {
      await supabaseFetch('fuel_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: 'default',
          settings: { ...localFuel, twoFactorSecret: local2FASecret },
          updated_at: new Date().toISOString()
        })
      });
    }
  } catch (err) {
    console.warn("Fuel settings / 2FA sync error:", err);
  }

  const finalTrips = await db.trips.count();
  return {
    success: true,
    tripsCount: finalTrips,
    syncedAt: new Date().toISOString()
  };
}
