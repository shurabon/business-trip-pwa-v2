import Dexie from 'dexie';

export const db = new Dexie('BusinessTripsDB');

db.version(1).stores({
  trips: '++id, appNo, client, location, workType, transport, startDate, finishDate, odoStart, odoFinish, status, perDiemRate, note, updatedAt',
  expenses: '++id, tripId, date, amount, description, receiptBase64, receiptName, updatedAt',
  payments: '++id, tripId, date, amount, purpose, note, updatedAt',
  clients: '++id, &name, address, updatedAt',
  dictionaries: '++id, category, value'
});

// Форматирование даты в ру-формат DD.MM.YYYY
export function formatDateToRu(val) {
  if (!val) return '';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(String(val))) return String(val);
  
  let d = new Date(val);
  if (isNaN(d.getTime())) {
    // Попытка разбора из ГГГГ-ММ-ДД
    const parts = String(val).split('-');
    if (parts.length === 3) {
      return `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
    }
    return String(val);
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

// Получение сегодняшней даты в формате DD.MM.YYYY
export function getTodayRuDate() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

// Преобразование строковой ру-даты DD.MM.YYYY в объект Date
export function parseRuDate(ruStr) {
  if (!ruStr) return null;
  if (ruStr instanceof Date) return ruStr;
  const str = String(ruStr).trim();
  const parts = str.split('.');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  return new Date(str);
}

// Настройки норм топлива и амортизации
export function getFuelSettings() {
  return {
    summerRate: parseFloat(localStorage.getItem('fuelSummerRate')) || 8.7,
    winterRate: parseFloat(localStorage.getItem('fuelWinterRate')) || 8.9,
    pricePerLiter: parseFloat(localStorage.getItem('fuelPricePerLiter')) || 69.0,
    deductibleKm: parseFloat(localStorage.getItem('depreciationDeductibleKm')) || 70,
    ratePerKm: parseFloat(localStorage.getItem('depreciationRatePerKm')) || 5.0
  };
}

// Получение нормы топлива по дате (Летняя 8.7л / Зимняя 8.9л)
export function getFuelNormByDate(dateStr) {
  const settings = getFuelSettings();
  const d = parseRuDate(dateStr);
  if (!d || isNaN(d.getTime())) return { rate: settings.summerRate, season: 'summer' };
  const month = d.getMonth() + 1;
  const isSummer = (month >= 4 && month <= 10);
  return {
    rate: isSummer ? settings.summerRate : settings.winterRate,
    season: isSummer ? 'summer' : 'winter'
  };
}

// Расчет пробега, расхода топлива и амортизации авто
export function calculateCarMetrics(trip) {
  if (!trip) return null;
  const transportLower = String(trip.transport || '').toLowerCase();
  const isAuto = (
    transportLower.includes('авто') ||
    transportLower.includes('машин') ||
    transportLower.includes('car') ||
    transportLower.includes('тс') ||
    transportLower.includes('легков')
  ) && !transportLower.includes('автобус');

  if (!isAuto) return null;

  const odoStart = parseFloat(trip.odoStart) || 0;
  const odoFinish = parseFloat(trip.odoFinish) || 0;
  const distanceKm = (odoFinish > odoStart) ? (odoFinish - odoStart) : 0;

  const normInfo = getFuelNormByDate(trip.startDate);
  const settings = getFuelSettings();

  const fuelLiters = (distanceKm * normInfo.rate) / 100;
  const fuelCost = fuelLiters * settings.pricePerLiter;

  let depreciationCost = 0;
  if (distanceKm > settings.deductibleKm) {
    depreciationCost = distanceKm * settings.ratePerKm;
  }

  return {
    isAuto: true,
    distanceKm,
    season: normInfo.season, // 'summer' | 'winter'
    fuelRate: normInfo.rate, // л/100км
    fuelLiters,
    fuelPricePerLiter: settings.pricePerLiter,
    fuelCost, // ₽
    deductibleKm: settings.deductibleKm,
    ratePerKm: settings.ratePerKm,
    depreciationCost // ₽
  };
}

// Расчет дней поездки из ру-дат DD.MM.YYYY
export function calculateTripDays(startStr, finishStr) {
  if (!startStr || !finishStr) return 0;
  const start = parseRuDate(startStr);
  const finish = parseRuDate(finishStr);
  if (!start || !finish || isNaN(start.getTime()) || isNaN(finish.getTime())) return 0;
  
  start.setHours(0, 0, 0, 0);
  finish.setHours(0, 0, 0, 0);
  
  const diff = finish.getTime() - start.getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}

// Первичная инициализация базовых справочников
export async function seedInitialData() {
  const dictCount = await db.dictionaries.count();
  if (dictCount === 0) {
    await db.dictionaries.bulkAdd([
      { category: 'transport', value: 'На автомобиле' },
      { category: 'transport', value: 'Общественный / Авиа / ЖД' },
      { category: 'workType', value: 'Монтажные и пусконаладочные работы' },
      { category: 'workType', value: 'Техническое обслуживание' },
      { category: 'workType', value: 'Диагностика и ремонт' },
      { category: 'status', value: 'не подготовлен' },
      { category: 'status', value: 'В процессе' },
      { category: 'status', value: 'Завершена' },
      { category: 'status', value: 'Отчитан' },
      { category: 'status', value: 'Отправлен' },
      { category: 'status', value: 'Выплачен' }
    ]);
  }
}

// Подсчет полного агрегированного баланса по всем поездкам
export async function getAggregatedSummary() {
  const trips = await db.trips.toArray();
  const expenses = await db.expenses.toArray();
  const payments = await db.payments.toArray();

  let totalOwedAll = 0;
  let totalPaidAll = 0;

  const tripSummaries = trips.map(t => {
    const days = calculateTripDays(t.startDate, t.finishDate);
    const startFormatted = formatDateToRu(t.startDate);
    const finishFormatted = formatDateToRu(t.finishDate);
    const isMultiDay = startFormatted && finishFormatted && (startFormatted !== finishFormatted);
    const rate = parseFloat(t.perDiemRate) || 1100;
    const perDiemSum = isMultiDay ? (days * rate) : 0;

    const carMetrics = calculateCarMetrics(t);

    const tExpenses = expenses.filter(e => String(e.tripId) === String(t.id));
    const expensesTotal = tExpenses.reduce((acc, e) => acc + (parseFloat(e.amount) || 0), 0);

    const depreciation = carMetrics ? carMetrics.depreciationCost : 0;
    const totalOwed = perDiemSum + expensesTotal + depreciation;

    const tPayments = payments.filter(p => String(p.tripId) === String(t.id));
    const paymentsTotal = tPayments.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);

    const balance = paymentsTotal - totalOwed;

    // Автоматическая смена статуса на "Выплачен" при полной выплате
    let effectiveStatus = t.status || 'не подготовлен';
    if (paymentsTotal >= totalOwed && totalOwed > 0) {
      effectiveStatus = 'Выплачен';
    } else if (effectiveStatus === 'Выплачен' && paymentsTotal < totalOwed) {
      effectiveStatus = 'Подготовлен';
    }

    t.status = effectiveStatus;

    totalOwedAll += totalOwed;
    totalPaidAll += paymentsTotal;

    return {
      trip: t,
      days,
      perDiemSum,
      carMetrics,
      expensesTotal,
      depreciationCost: depreciation,
      totalOwed,
      paymentsTotal,
      balance,
      effectiveStatus
    };
  });

  return {
    totalOwedAll,
    totalPaidAll,
    netBalanceAll: totalPaidAll - totalOwedAll,
    tripSummaries
  };
}
