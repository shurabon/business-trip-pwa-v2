/**
 * ====================================================================
 * МОДУЛЬ: carboneService.js
 * Назначение: Взаимодействие с Carbone Document Engine через PocketBase API:
 * - Получение списка шаблонов документов
 * - Скачивание исходного шаблона (.xlsx)
 * - Загрузка пользовательского шаблона (.xlsx/.docx)
 * - Подготовка данных командировки и рендер заполненного документа (.xlsx/.pdf)
 * ====================================================================
 */

import { db, getAggregatedSummary, formatDateToRu } from '../db.js';
import { showToast } from './ui-utils.js';

const CARBONE_API_PREFIX = '/api/carbone';

/**
 * Получение списка доступных шаблонов с сервера Carbone
 */
export async function getCarboneTemplates() {
  try {
    const res = await fetch(`${CARBONE_API_PREFIX}/templates`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.templates || [];
  } catch (err) {
    console.error('getCarboneTemplates error:', err);
    return [];
  }
}

/**
 * Скачивание исходного файла шаблона (.xlsx) для редактирования на ПК
 */
export async function downloadTemplateOriginal(templateName) {
  try {
    const res = await fetch(`${CARBONE_API_PREFIX}/templates/${encodeURIComponent(templateName)}/download`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = templateName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 2000);
    showToast(`📥 Шаблон ${templateName} скачан`);
  } catch (err) {
    console.error('downloadTemplateOriginal error:', err);
    showToast(`❌ Ошибка скачивания шаблона: ${err.message}`);
  }
}

/**
 * Загрузка обновленного шаблона на сервер Carbone
 */
export async function uploadCarboneTemplate(file) {
  if (!file) return;
  try {
    const formData = new FormData();
    formData.append('template', file);

    const res = await fetch(`${CARBONE_API_PREFIX}/templates/upload`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      showToast(`✅ Шаблон «${file.name}» успешно загружен!`);
      await renderTemplatesManagementList();
    } else {
      throw new Error(data.error || 'Ошибка загрузки');
    }
  } catch (err) {
    console.error('uploadCarboneTemplate error:', err);
    showToast(`❌ Ошибка загрузки шаблона: ${err.message}`);
  }
}

/**
 * Подготовка данных командировки для передачи в Carbone
 */
export async function prepareCarboneTripData(tripId) {
  const trip = await db.trips.get(String(tripId));
  if (!trip) throw new Error('Командировка не найдена');

  const summaryData = await getAggregatedSummary();
  const s = summaryData.tripSummaries.find(item => String(item.trip.id) === String(tripId)) || {
    days: 0,
    perDiemSum: 0,
    expensesTotal: 0,
    depreciationCost: 0,
    totalOwed: 0,
    paymentsTotal: 0,
    balance: 0
  };

  const expenses = await db.expenses.where('tripId').equals(String(tripId)).toArray();
  const payments = await db.payments.where('tripId').equals(String(tripId)).toArray();

  // Расходы для таблицы
  const formattedExpenses = expenses.map((exp, idx) => ({
    index: idx + 1,
    date: formatDateToRu(exp.date),
    category: exp.category || 'Прочее',
    description: exp.description || '',
    amount: (parseFloat(exp.amount) || 0).toLocaleString('ru-RU')
  }));

  // Заправки / путевой лист
  const fuelExpenses = expenses.filter(e => (e.category || '').toLowerCase().includes('топлив') || (e.category || '').toLowerCase().includes('бензин'));
  const fuelStops = fuelExpenses.map((exp, idx) => ({
    index: idx + 1,
    date: formatDateToRu(exp.date),
    station: exp.description || 'АЗС',
    liters: exp.liters || '',
    amount: (parseFloat(exp.amount) || 0).toLocaleString('ru-RU')
  }));

  const odoStart = parseFloat(trip.odoStart) || 0;
  const odoFinish = parseFloat(trip.odoFinish) || 0;
  const distance = odoFinish > odoStart ? (odoFinish - odoStart) : 0;

  let totalFuelLiters = 0;
  fuelExpenses.forEach(f => { totalFuelLiters += (parseFloat(f.liters) || 0); });
  const fuelConsumption = distance > 0 && totalFuelLiters > 0 ? ((totalFuelLiters / distance) * 100).toFixed(1) : '';

  const todayRu = formatDateToRu(new Date().toISOString().split('T')[0]);

  return {
    trip: {
      id: trip.id,
      appNo: trip.appNo || String(trip.id),
      target: trip.target || '',
      client: trip.client || '',
      location: trip.location || '',
      car: trip.transport || 'Автомобиль компании',
      transport: trip.transport || '',
      startDate: formatDateToRu(trip.startDate),
      finishDate: formatDateToRu(trip.finishDate),
      durationDays: String(s.days || 1),
      perDiemRate: (parseFloat(trip.perDiemRate) || 700).toLocaleString('ru-RU'),
      perDiemSum: (s.perDiemSum || 0).toLocaleString('ru-RU'),
      advanceAmount: (s.paymentsTotal || 0).toLocaleString('ru-RU'),
      advanceRequested: (s.totalOwed || 0).toLocaleString('ru-RU'),
      balance: (s.balance || 0).toLocaleString('ru-RU'),
      route: `${trip.location || ''} (местный маршрут)`
    },
    car: {
      model: trip.transport || '',
      plate: '',
      driver: 'Данилов А.В.',
      odoStart: odoStart ? odoStart.toLocaleString('ru-RU') : '',
      odoFinish: odoFinish ? odoFinish.toLocaleString('ru-RU') : '',
      distance: distance ? distance.toLocaleString('ru-RU') : '',
      fuelStart: '',
      fuelFinish: '',
      fuelRefueled: totalFuelLiters ? totalFuelLiters.toFixed(1) : '',
      fuelConsumption: fuelConsumption,
      totalFuelCost: fuelExpenses.reduce((acc, f) => acc + (parseFloat(f.amount) || 0), 0).toLocaleString('ru-RU')
    },
    expenses: formattedExpenses.length > 0 ? formattedExpenses : [
      { index: 1, date: formatDateToRu(trip.startDate), category: '—', description: 'Расходов нет', amount: '0' }
    ],
    fuelStops: fuelStops.length > 0 ? fuelStops : [
      { index: 1, date: formatDateToRu(trip.startDate), station: '—', liters: '—', amount: '0' }
    ],
    totalExpenses: (s.expensesTotal || 0).toLocaleString('ru-RU'),
    finalSettlement: (s.balance || 0).toLocaleString('ru-RU'),
    today: todayRu,
    user: {
      name: 'Данилов А.В.'
    }
  };
}

/**
 * Рендер документа через Carbone и запуск скачивания в браузере
 * @param {string} templateName имя шаблона (например avans_otchet.xlsx)
 * @param {string|number} tripId ID командировки
 * @param {string} [convertTo] опционально: 'pdf' или null для сохранения исходного .xlsx
 */
export async function renderAndDownloadDocument(templateName, tripId, convertTo = null) {
  try {
    showToast(`⏳ Формирование документа «${templateName}»...`);
    const data = await prepareCarboneTripData(tripId);

    let url = `${CARBONE_API_PREFIX}/render/${encodeURIComponent(templateName)}`;
    if (convertTo) {
      url += `?convertTo=${convertTo}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ошибка сервера (${res.status}): ${errText}`);
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;

    const baseName = templateName.replace(/\.[^/.]+$/, "");
    const ext = convertTo || templateName.split('.').pop();
    a.download = `${baseName}_Заявка_${data.trip.appNo || tripId}.${ext}`;

    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    }, 2000);

    showToast(`✅ Документ «${a.download}» успешно скачан!`);
  } catch (err) {
    console.error('renderAndDownloadDocument error:', err);
    showToast(`❌ Ошибка генерации: ${err.message}`);
  }
}

/**
 * Отрисовка списка шаблонов в настройках PWA с кнопками скачивания оригинала и загрузки
 */
export async function renderTemplatesManagementList() {
  const container = document.getElementById('carboneTemplatesList');
  if (!container) return;

  const templates = await getCarboneTemplates();
  if (templates.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:#888;">Шаблоны не найдены на сервере</div>`;
    return;
  }

  const titles = {
    'avans_otchet.xlsx': '📊 Авансовый отчет (Форма АО-1)',
    'sluzhebnaya_zapiska.xlsx': '📝 Служебная записка о командировке',
    'putevoy_list.xlsx': '🚗 Путевой лист легкового автомобиля'
  };

  let html = '';
  templates.forEach(tpl => {
    const title = titles[tpl.name] || tpl.name;
    const sizeKb = Math.round((tpl.size || 0) / 1024);
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px 14px; margin-bottom:8px; font-size:13px;">
        <div>
          <strong style="color:#1E293B;">${title}</strong><br>
          <span style="color:#64748B; font-size:11px;">Файл: <code>${tpl.name}</code> (${sizeKb} КБ)</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-sm btn-secondary" style="padding:6px 10px; font-size:12px;" onclick="downloadTemplateOriginal('${tpl.name}')" title="Скачать оригинальный файл шаблона для редактирования">
            <span class="material-symbols-outlined" style="font-size:16px;">download</span> Оригинал
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}
