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

// Главная функция двусторонней быстрой синхронизации через Supabase (Архитектура Плана Обмена / 1C Transaction Protocol)
export async function syncWithSupabase(forceFullPull = false) {
  await cleanupDuplicates();

  // ==========================================
  // ФАЗА 1: ОБРАБОТКА ИСХОДЯЩЕЙ ОЧЕРЕДИ (PUSH OUTBOX)
  // ==========================================
  const pendingTransactions = await db.syncQueue.orderBy('id').toArray();
  for (const tx of pendingTransactions) {
    try {
      if (tx.action === 'DELETE') {
        if (['trips', 'expenses', 'payments'].includes(tx.entityType)) {
          if (tx.entityId) {
            await supabaseFetch(`${tx.entityType}?id=eq.${tx.entityId}`, { method: 'DELETE' });
          }
        }
      } else if (tx.action === 'UPSERT') {
        const p = tx.payload || {};
        if (tx.entityType === 'trips') {
          await supabaseFetch('trips', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
              id: tx.entityId,
              app_no: p.appNo || '',
              client: p.client || '',
              location: p.location || '',
              work_type: p.workType || '',
              transport: p.transport || '',
              start_date: p.startDate || '',
              finish_date: p.finishDate || '',
              odo_start: p.odoStart || 0,
              odo_finish: p.odoFinish || 0,
              status: p.status || 'не подготовлен',
              per_diem_rate: p.perDiemRate || 1100,
              note: p.note || '',
              updated_at: p.updatedAt || new Date().toISOString()
            })
          });
        } else if (tx.entityType === 'expenses') {
          let receiptUrl = p.receiptUrl || null;
          if (!receiptUrl && p.receiptBase64) {
            receiptUrl = await uploadReceiptToStorage(p.receiptBase64, p.receiptName);
            if (receiptUrl) await db.expenses.update(p.id, { receiptUrl });
          }
          await supabaseFetch('expenses', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
              id: tx.entityId,
              trip_id: String(p.tripId || ''),
              date: p.date || '',
              amount: parseFloat(p.amount) || 0,
              description: p.description || '',
              category: p.category || '',
              payment_type: p.paymentType || 'cash',
              article_code: p.articleCode || '',
              receipt_url: receiptUrl,
              receipt_name: p.receiptName || '',
              updated_at: p.updatedAt || new Date().toISOString()
            })
          });
        } else if (tx.entityType === 'payments') {
          await supabaseFetch('payments', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
              id: tx.entityId,
              trip_id: String(p.tripId || ''),
              date: p.date || '',
              amount: parseFloat(p.amount) || 0,
              note: p.note || '',
              updated_at: p.updatedAt || new Date().toISOString()
            })
          });
        }
      }
      // Успешно отправлено в облако - удаляем транзакцию из очереди
      await db.syncQueue.delete(tx.id);
    } catch (txErr) {
      console.warn("Failed to push sync transaction:", tx, txErr);
      break;
    }
  }

  // ==========================================
  // ФАЗА 2: ПОЛУЧЕНИЕ ЧИСТОГО ОБЛАЧНОГО СОСТОЯНИЯ (PULL CLEAN STATE)
  // ==========================================

  // 1. TRIPS
  const remoteTrips = await supabaseFetch('trips?select=*');
  const localTrips = await db.trips.toArray();

  for (const rt of (remoteTrips || [])) {
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

  for (const lt of localTrips) {
    const exists = remoteTrips?.some(r => String(r.id) === String(lt.id));
    if (!exists && !lt.uuid) await db.trips.delete(lt.id);
  }

  // 2. EXPENSES
  const remoteExpenses = await supabaseFetch('expenses?select=*');
  const localExpenses = await db.expenses.toArray();

  for (const re of (remoteExpenses || [])) {
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

  for (const le of localExpenses) {
    const exists = remoteExpenses?.some(r => String(r.id) === String(le.id));
    if (!exists && !le.uuid) await db.expenses.delete(le.id);
  }

  // 3. PAYMENTS
  const remotePayments = await supabaseFetch('payments?select=*');
  const localPayments = await db.payments.toArray();

  for (const rp of (remotePayments || [])) {
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

  for (const lp of localPayments) {
    const exists = remotePayments?.some(r => String(r.id) === String(lp.id));
    if (!exists && !lp.uuid) await db.payments.delete(lp.id);
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
