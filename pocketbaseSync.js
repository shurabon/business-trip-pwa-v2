import { db, seedInitialData } from './db.js';

// PocketBase API base URL (uses current origin when hosted on domain or local IP)
export const PB_URL = (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.includes('localhost') && !window.location.origin.includes('127.0.0.1'))
  ? window.location.origin
  : 'https://app.danilovhome.keenetic.pro';

export function getServerTimeOffsetMs() { return 0; }
export async function fetchServerTimeOffset() { return 0; }

// 1. Быстрая синхронизация всех данных из PocketBase в локальный Dexie кэш
export async function syncWithPocketBase() {
  try {
    const [tripsRes, expensesRes, paymentsRes, clientsRes, settingsRes, taxiRidesRes] = await Promise.all([
      fetch(`${PB_URL}/api/collections/trips/records?filter=(deleted!=true)&perPage=500`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${PB_URL}/api/collections/expenses/records?filter=(deleted!=true)&perPage=500`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${PB_URL}/api/collections/payments/records?filter=(deleted!=true)&perPage=500`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${PB_URL}/api/collections/clients/records?perPage=500`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${PB_URL}/api/collections/settings/records?perPage=1`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${PB_URL}/api/collections/taxi_rides/records?filter=(deleted!=true)&perPage=500`).then(r => {
        if (!r.ok) return { items: [] };
        return r.json();
      }).catch(() => ({ items: [] }))
    ]);

    // Обновляем настройки в localStorage для моментального доступа
    if (settingsRes.items && settingsRes.items.length > 0) {
      const s = settingsRes.items[0];
      if (s.summerRate) localStorage.setItem('fuelSummerRate', s.summerRate);
      if (s.winterRate) localStorage.setItem('fuelWinterRate', s.winterRate);
      if (s.pricePerLiter) localStorage.setItem('fuelPricePerLiter', s.pricePerLiter);
      if (s.deductibleKm) localStorage.setItem('depreciationDeductibleKm', s.deductibleKm);
      if (s.ratePerKm) localStorage.setItem('depreciationRatePerKm', s.ratePerKm);
      if (s.twoFactorSecret) localStorage.setItem('btrip_2fa_secret', s.twoFactorSecret);
      if (s.id) localStorage.setItem('pb_settings_id', s.id);
    }

    // Преобразуем поездки
    const trips = (tripsRes.items || []).map(t => ({
      id: t.id,
      appNo: t.orderNumber || '',
      client: t.client || '',
      location: t.location || '',
      workType: t.workType || '',
      transport: t.transport || 'Нет',
      isBusinessTrip: t.isBusinessTrip !== false,
      startDate: t.startDate || '',
      finishDate: t.finishDate || '',
      perDiemRate: t.perDiemRate || 0,
      odoStart: t.odoStart || 0,
      odoFinish: t.odoFinish || 0,
      status: t.status || 'Подготовлен',
      note: t.note || '',
      created: t.created,
      updated: t.updated
    }));

    // Преобразуем расходы
    const expenses = (expensesRes.items || []).map(e => ({
      id: e.id,
      tripId: e.trip || '',
      date: e.date || '',
      amount: e.amount || 0,
      description: e.description || '',
      category: e.category || '',
      paymentType: e.paymentType || 'cash',
      articleCode: e.articleCode || '',
      fromAddress: e.fromAddress || '',
      toAddress: e.toAddress || '',
      route: e.route || '',
      rideTime: e.rideTime || '',
      taxiRideId: e.taxiRideId || '',
      receipt: e.receipt || '',
      receiptUrl: e.receipt ? `${PB_URL}/api/files/expenses/${e.id}/${e.receipt}` : '',
      receiptName: e.receipt || '',
      created: e.created,
      updated: e.updated
    }));

    // Преобразуем выплаты
    const payments = (paymentsRes.items || []).map(p => ({
      id: p.id,
      tripId: p.trip || '',
      date: p.date || '',
      amount: p.amount || 0,
      note: p.note || '',
      created: p.created,
      updated: p.updated
    }));

    // Преобразуем клиентов
    const clients = (clientsRes.items || []).map(c => ({
      id: c.id,
      name: c.name || '',
      address: c.address || ''
    }));

    // Преобразуем поездки такси
    const taxiRides = (taxiRidesRes.items || []).map(r => ({
      id: r.id,
      tripId: r.trip || '',
      messageId: r.messageId || '',
      date: r.date || '',
      time: r.time || '',
      fromAddress: r.fromAddress || '',
      toAddress: r.toAddress || '',
      route: r.route || '',
      amount: r.amount || 0,
      paymentType: r.paymentType || 'cashless',
      paymentLabel: r.paymentLabel || '',
      isCorporate: r.isCorporate !== false,
      description: r.description || '',
      expenseId: r.expenseId || '',
      status: r.status || 'pending',
      created: r.created,
      updated: r.updated
    }));

    // Атомарно перезаписываем локальный Dexie кэш
    await db.transaction('rw', [db.trips, db.expenses, db.payments, db.clients, db.taxi_rides], async () => {
      await db.trips.clear();
      await db.expenses.clear();
      await db.payments.clear();
      await db.clients.clear();
      await db.taxi_rides.clear();

      if (trips.length > 0) await db.trips.bulkPut(trips);
      if (expenses.length > 0) await db.expenses.bulkPut(expenses);
      if (payments.length > 0) await db.payments.bulkPut(payments);
      if (clients.length > 0) await db.clients.bulkPut(clients);
      if (taxiRides.length > 0) await db.taxi_rides.bulkPut(taxiRides);
    });

    try {
      await seedInitialData();
    } catch (_) {}

    return {
      success: true,
      count: { trips: trips.length, expenses: expenses.length, payments: payments.length, clients: clients.length, taxiRides: taxiRides.length }
    };
  } catch (err) {
    console.error('PocketBase sync error:', err);
    return { success: false, error: err.message };
  }
}

// 2. Создание поездки в PocketBase
export async function createPbTrip(data) {
  const payload = {
    orderNumber: data.appNo || data.orderNumber || '',
    client: data.client || '',
    location: data.location || '',
    workType: data.workType || '',
    transport: data.transport || 'Нет',
    isBusinessTrip: true,
    startDate: data.startDate || '',
    finishDate: data.finishDate || '',
    perDiemRate: parseFloat(data.perDiemRate) || 0,
    odoStart: parseFloat(data.odoStart) || 0,
    odoFinish: parseFloat(data.odoFinish) || 0,
    status: data.status || 'Подготовлен',
    note: data.note || ''
  };
  const res = await fetch(`${PB_URL}/api/collections/trips/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  const rec = await res.json();
  const trip = {
    id: rec.id,
    appNo: rec.orderNumber || '',
    client: rec.client || '',
    location: rec.location || '',
    workType: rec.workType || '',
    transport: rec.transport || 'Нет',
    isBusinessTrip: true,
    startDate: rec.startDate || '',
    finishDate: rec.finishDate || '',
    perDiemRate: rec.perDiemRate || 0,
    odoStart: rec.odoStart || 0,
    odoFinish: rec.odoFinish || 0,
    status: rec.status || 'Подготовлен',
    note: rec.note || ''
  };
  await db.trips.put(trip);
  return trip;
}

// 3. Обновление поездки в PocketBase
export async function updatePbTrip(id, data) {
  const payload = {};
  if (data.appNo !== undefined) payload.orderNumber = data.appNo;
  if (data.orderNumber !== undefined) payload.orderNumber = data.orderNumber;
  if (data.client !== undefined) payload.client = data.client;
  if (data.location !== undefined) payload.location = data.location;
  if (data.workType !== undefined) payload.workType = data.workType;
  if (data.transport !== undefined) payload.transport = data.transport;
  if (data.startDate !== undefined) payload.startDate = data.startDate;
  if (data.finishDate !== undefined) payload.finishDate = data.finishDate;
  if (data.perDiemRate !== undefined) payload.perDiemRate = parseFloat(data.perDiemRate) || 0;
  if (data.odoStart !== undefined) payload.odoStart = parseFloat(data.odoStart) || 0;
  if (data.odoFinish !== undefined) payload.odoFinish = parseFloat(data.odoFinish) || 0;
  if (data.status !== undefined) payload.status = data.status;
  if (data.note !== undefined) payload.note = data.note;

  const res = await fetch(`${PB_URL}/api/collections/trips/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  const rec = await res.json();
  await db.trips.update(id, data);
  return rec;
}

// 4. Пометка поездки на удаление (Soft Delete)
export async function deletePbTrip(id) {
  const res = await fetch(`${PB_URL}/api/collections/trips/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: true })
  });
  if (!res.ok && res.status !== 404) throw new Error(await res.text());
  await db.trips.delete(id);
  // Каскадная пометка на удаление расходов и выплат
  const exps = await db.expenses.where('tripId').equals(String(id)).toArray();
  for (const e of exps) {
    await deletePbExpense(e.id).catch(() => {});
    await db.expenses.delete(e.id);
  }
  const pays = await db.payments.where('tripId').equals(String(id)).toArray();
  for (const p of pays) {
    await deletePbPayment(p.id).catch(() => {});
    await db.payments.delete(p.id);
  }
  return true;
}

// 5. Создание расхода с файлом чека
export async function createPbExpense(data, fileBlob, fileName) {
  let rec;
  if (fileBlob) {
    const formData = new FormData();
    formData.append('trip', String(data.tripId));
    formData.append('date', data.date || '');
    formData.append('amount', parseFloat(data.amount) || 0);
    formData.append('description', data.description || '');
    formData.append('category', data.category || '');
    formData.append('paymentType', data.paymentType || 'cash');
    formData.append('articleCode', data.articleCode || '');
    if (data.fromAddress) formData.append('fromAddress', data.fromAddress);
    if (data.toAddress) formData.append('toAddress', data.toAddress);
    if (data.route) formData.append('route', data.route);
    if (data.rideTime) formData.append('rideTime', data.rideTime);
    if (data.taxiRideId) formData.append('taxiRideId', data.taxiRideId);
    formData.append('receipt', fileBlob, fileName || 'receipt.jpg');

    const res = await fetch(`${PB_URL}/api/collections/expenses/records`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error(await res.text());
    rec = await res.json();
  } else {
    const payload = {
      trip: String(data.tripId),
      date: data.date || '',
      amount: parseFloat(data.amount) || 0,
      description: data.description || '',
      category: data.category || '',
      paymentType: data.paymentType || 'cash',
      articleCode: data.articleCode || '',
      fromAddress: data.fromAddress || '',
      toAddress: data.toAddress || '',
      route: data.route || '',
      rideTime: data.rideTime || '',
      taxiRideId: data.taxiRideId || ''
    };
    const res = await fetch(`${PB_URL}/api/collections/expenses/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    rec = await res.json();
  }

  const expItem = {
    id: rec.id,
    tripId: rec.trip,
    date: rec.date || '',
    amount: rec.amount || 0,
    description: rec.description || '',
    category: rec.category || '',
    paymentType: rec.paymentType || 'cash',
    articleCode: rec.articleCode || '',
    fromAddress: rec.fromAddress || data.fromAddress || '',
    toAddress: rec.toAddress || data.toAddress || '',
    route: rec.route || data.route || '',
    rideTime: rec.rideTime || data.rideTime || '',
    taxiRideId: rec.taxiRideId || data.taxiRideId || '',
    receipt: rec.receipt || '',
    receiptUrl: rec.receipt ? `${PB_URL}/api/files/expenses/${rec.id}/${rec.receipt}` : '',
    receiptName: rec.receipt || ''
  };
  await db.expenses.put(expItem);
  return expItem;
}

// 6. Обновление расхода
export async function updatePbExpense(id, data, fileBlob, fileName) {
  let rec;
  if (fileBlob) {
    const formData = new FormData();
    if (data.tripId) formData.append('trip', String(data.tripId));
    if (data.date !== undefined) formData.append('date', data.date);
    if (data.amount !== undefined) formData.append('amount', parseFloat(data.amount) || 0);
    if (data.description !== undefined) formData.append('description', data.description);
    if (data.category !== undefined) formData.append('category', data.category);
    if (data.paymentType !== undefined) formData.append('paymentType', data.paymentType);
    if (data.articleCode !== undefined) formData.append('articleCode', data.articleCode);
    formData.append('receipt', fileBlob, fileName || 'receipt.jpg');

    const res = await fetch(`${PB_URL}/api/collections/expenses/records/${id}`, {
      method: 'PATCH',
      body: formData
    });
    if (!res.ok) throw new Error(await res.text());
    rec = await res.json();
  } else {
    const payload = {};
    if (data.tripId !== undefined) payload.trip = String(data.tripId);
    if (data.date !== undefined) payload.date = data.date;
    if (data.amount !== undefined) payload.amount = parseFloat(data.amount) || 0;
    if (data.description !== undefined) payload.description = data.description;
    if (data.category !== undefined) payload.category = data.category;
    if (data.paymentType !== undefined) payload.paymentType = data.paymentType;
    if (data.articleCode !== undefined) payload.articleCode = data.articleCode;
    if (data.fromAddress !== undefined) payload.fromAddress = data.fromAddress;
    if (data.toAddress !== undefined) payload.toAddress = data.toAddress;
    if (data.route !== undefined) payload.route = data.route;
    if (data.rideTime !== undefined) payload.rideTime = data.rideTime;
    if (data.taxiRideId !== undefined) payload.taxiRideId = data.taxiRideId;

    const res = await fetch(`${PB_URL}/api/collections/expenses/records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    rec = await res.json();
  }

  const updatedExp = {
    ...data,
    id,
    receipt: rec.receipt || data.receipt || '',
    receiptUrl: rec.receipt ? `${PB_URL}/api/files/expenses/${rec.id}/${rec.receipt}` : (data.receiptUrl || '')
  };
  await db.expenses.update(id, updatedExp);
  return updatedExp;
}

// 7. Пометка расхода на удаление (Soft Delete)
export async function deletePbExpense(id) {
  const res = await fetch(`${PB_URL}/api/collections/expenses/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: true })
  });
  if (!res.ok && res.status !== 404) throw new Error(await res.text());
  await db.expenses.delete(id);
  return true;
}

// 8. Создание выплаты
export async function createPbPayment(data) {
  const payload = {
    trip: String(data.tripId),
    date: data.date || '',
    amount: parseFloat(data.amount) || 0,
    note: data.note || ''
  };
  const res = await fetch(`${PB_URL}/api/collections/payments/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  const rec = await res.json();
  const payItem = {
    id: rec.id,
    tripId: rec.trip,
    date: rec.date || '',
    amount: rec.amount || 0,
    note: rec.note || ''
  };
  await db.payments.put(payItem);
  return payItem;
}

// 9. Обновление выплаты
export async function updatePbPayment(id, data) {
  const payload = {};
  if (data.tripId !== undefined) payload.trip = String(data.tripId);
  if (data.date !== undefined) payload.date = data.date;
  if (data.amount !== undefined) payload.amount = parseFloat(data.amount) || 0;
  if (data.note !== undefined) payload.note = data.note;

  const res = await fetch(`${PB_URL}/api/collections/payments/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  await db.payments.update(id, data);
  return await res.json();
}

// 10. Пометка выплаты на удаление (Soft Delete)
export async function deletePbPayment(id) {
  const res = await fetch(`${PB_URL}/api/collections/payments/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: true })
  });
  if (!res.ok && res.status !== 404) throw new Error(await res.text());
  await db.payments.delete(id);
  return true;
}

// 11. Обновление настроек в PocketBase
export async function updatePbSettings(settings) {
  let settingsId = localStorage.getItem('pb_settings_id');
  if (!settingsId) {
    const listRes = await fetch(`${PB_URL}/api/collections/settings/records?perPage=1`).then(r => r.json());
    if (listRes.items && listRes.items.length > 0) {
      settingsId = listRes.items[0].id;
      localStorage.setItem('pb_settings_id', settingsId);
    }
  }
  if (!settingsId) return;

  const res = await fetch(`${PB_URL}/api/collections/settings/records/${settingsId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

// ====================================================================
// 12. ПОЕЗДКИ ТАКСИ (TAXI RIDES)
// ====================================================================

// Обновление поездки такси в PocketBase и Dexie
export async function updatePbTaxiRide(id, data) {
  const payload = {};
  if (data.trip !== undefined) payload.trip = data.trip;
  if (data.tripId !== undefined) payload.trip = data.tripId;
  if (data.status !== undefined) payload.status = data.status;
  if (data.expenseId !== undefined) payload.expenseId = data.expenseId;
  if (data.paymentType !== undefined) payload.paymentType = data.paymentType;
  if (data.paymentLabel !== undefined) payload.paymentLabel = data.paymentLabel;

  const res = await fetch(`${PB_URL}/api/collections/taxi_rides/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  const rec = await res.json();
  await db.taxi_rides.update(id, data);
  return rec;
}

// Связывание поездки такси с расходом командировки
export async function linkTaxiRideToTrip(ride, tripId, paymentType) {
  const pType = paymentType || ride.paymentType || (ride.isCorporate ? 'cashless' : 'cash');
  
  // 1. Создаем расход
  const expData = {
    tripId: String(tripId),
    date: ride.date,
    amount: parseFloat(ride.amount) || 0,
    description: ride.description || `Такси: ${ride.fromAddress || ''} → ${ride.toAddress || ''} (${ride.time || ''})`,
    category: 'Транспорт',
    paymentType: pType,
    articleCode: 'ТАХI',
    fromAddress: ride.fromAddress || '',
    toAddress: ride.toAddress || '',
    route: ride.route || '',
    rideTime: ride.time || '',
    taxiRideId: String(ride.id)
  };

  const createdExpense = await createPbExpense(expData);

  // 2. Обновляем статус в taxi_rides
  await updatePbTaxiRide(ride.id, {
    trip: String(tripId),
    tripId: String(tripId),
    status: 'linked',
    expenseId: createdExpense.id,
    paymentType: pType
  });

  return createdExpense;
}

// Отвязывание поездки такси от командировки (удаление из расходов)
export async function unlinkTaxiRideFromTrip(rideId) {
  const ride = await db.taxi_rides.get(String(rideId));
  if (!ride) return;

  if (ride.expenseId) {
    try {
      await deletePbExpense(ride.expenseId);
      await db.expenses.delete(ride.expenseId);
    } catch (e) {
      console.warn('Expense delete warning:', e);
    }
  }

  await updatePbTaxiRide(rideId, {
    trip: '',
    tripId: '',
    status: 'pending',
    expenseId: ''
  });
}

// Переключение статуса "Личная поездка (скрыть из отчетов)"
export async function toggleIgnoreTaxiRide(rideId, isIgnored) {
  await updatePbTaxiRide(rideId, {
    status: isIgnored ? 'ignored' : 'pending'
  });
}
