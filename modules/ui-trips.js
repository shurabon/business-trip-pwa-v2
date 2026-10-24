/**
 * ====================================================================
 * МОДУЛЬ: ui-trips.js
 * Назначение: Управление командировками
 * - Создание поездки (обычная форма и быстрое модальное окно)
 * - Расчет ODO старта по литрам и нормам расхода топлива
 * - Рендеринг карточек командировок и интерактивного степпера (1-2-3-4)
 * - Дашборд: плитки статусов, баланс, фильтрация
 * - Редактирование и мягкое удаление поездки
 * ====================================================================
 */

import { db, getAggregatedSummary, formatDateToRu, getTodayRuDate, getFuelSettings } from '../db.js';
import { createPbTrip, updatePbTrip, deletePbTrip } from '../pocketbaseSync.js';
import { showToast, scheduleAutoSync, toId, isPdfFile, openPdfAttachment, currentHighlightedElementId } from './ui-utils.js';

export let activeTripId = null;
export let activeChildEdit = null;

export function setActiveTripId(val) { activeTripId = val; }
export function setActiveChildEdit(val) { activeChildEdit = val; }

/**
 * Проверка, относится ли выбранный транспорт к автомобильному
 * @param {string} val
 * @returns {boolean}
 */
export function isAutoTransport(val) {
  if (!val) return false;
  const s = String(val).toLowerCase();
  if (s.includes('автобус')) return false;
  return s.includes('авто') || s.includes('машин') || s.includes('car') || s.includes('тс') || s.includes('легков');
}

/**
 * Показ/скрытие полей спидометра (ODO) при выборе транспорта
 * @param {string} selectId
 * @param {string} targetDivId
 */
export function toggleAutoFields(selectId, targetDivId) {
  const transportSelect = document.getElementById(selectId || 'tripTransport');
  const transport = transportSelect ? transportSelect.value : '';
  const autoDiv = document.getElementById(targetDivId || 'autoFields');
  if (autoDiv) {
    autoDiv.style.display = isAutoTransport(transport) ? 'block' : 'none';
  }
}

/**
 * Автоподстановка адреса клиента при его выборе
 * @param {string} clientName
 * @param {string} targetInputId
 */
export async function onClientSelectChange(clientName, targetInputId) {
  if (!clientName) return;
  const clientObj = await db.clients.where('name').equalsIgnoreCase(clientName.trim()).first();
  if (clientObj && clientObj.address) {
    const targetInput = document.getElementById(targetInputId);
    if (targetInput) {
      targetInput.value = clientObj.address;
    }
  }
}

/**
 * Автоматический расчет показания ODO старт по заправленным литрам и летней норме
 * Формула: Пробег = (Литры * 100) / Норма; ODO Старт = ODO Финиш - Пробег
 */
export function calculateStartOdoFromLiters(startId, finishId, litersId) {
  const finishInput = document.getElementById(finishId);
  const litersInput = document.getElementById(litersId);
  const startInput = document.getElementById(startId);

  const finishVal = parseFloat(finishInput?.value) || 0;
  const litersVal = parseFloat(litersInput?.value) || 0;

  if (litersVal <= 0) {
    showToast("⚠️ Укажите количество литров по чекам!");
    return;
  }
  if (finishVal <= 0) {
    showToast("⚠️ Укажите показание ODO финиш!");
    return;
  }

  const settings = getFuelSettings();
  const fuelRate = parseFloat(settings.summerRate) || 8.7;
  const targetKm = Math.round((litersVal * 100) / fuelRate);
  const calculatedStart = finishVal - targetKm;

  if (startInput) {
    startInput.value = calculatedStart > 0 ? calculatedStart : 0;
    startInput.style.transition = 'background 0.3s ease';
    startInput.style.background = '#DCFCE7';
    setTimeout(() => { startInput.style.background = ''; }, 1200);
  }

  updateAutoFieldsHint(startId, finishId, litersId);
  showToast(`⚡ Рассчитан пробег ${targetKm} км под ${litersVal} л. ODO старт: ${calculatedStart}`);
}

/**
 * Подсказка с расчетом километров под полями ODO
 */
export function updateAutoFieldsHint(startId, finishId, litersId, hintDivId) {
  const startInput = document.getElementById(startId);
  const finishInput = document.getElementById(finishId);
  const litersInput = document.getElementById(litersId);
  const hintDiv = document.getElementById(hintDivId || startId.replace('OdoStart', 'AutoHint').replace('TripOdoStart', 'AutoHint'));

  const startVal = parseFloat(startInput?.value) || 0;
  const finishVal = parseFloat(finishInput?.value) || 0;
  const litersVal = parseFloat(litersInput?.value) || 0;

  const settings = getFuelSettings();
  const fuelRate = parseFloat(settings.summerRate) || 8.7;

  if (!hintDiv) return;

  if (finishVal > 0 && startVal > 0 && finishVal >= startVal) {
    const diff = finishVal - startVal;
    const normLiters = ((diff * fuelRate) / 100).toFixed(1);
    hintDiv.innerHTML = `<span>Пробег: <strong>${diff} км</strong> | Норма: <strong>${normLiters} л</strong> (норма ${fuelRate})</span>`;
    hintDiv.style.display = 'block';
  } else if (litersVal > 0) {
    const approxKm = Math.round((litersVal * 100) / fuelRate);
    hintDiv.innerHTML = `<span>Под ${litersVal} л пробег ~<strong>${approxKm} км</strong></span>`;
    hintDiv.style.display = 'block';
  } else {
    hintDiv.style.display = 'none';
  }
}

/**
 * Изменение статуса поездки через интерактивный степпер
 * @param {string} tripId
 * @param {string} newStatus - 'не подготовлен' | 'Подготовлен' | 'Отправлен' | 'Выплачен'
 */
export async function setTripStatus(tripId, newStatus) {
  if (newStatus === 'Выплачен') {
    showToast("ℹ️ Статус 'Выплачен' устанавливается автоматически при полной выплате всей суммы");
    return;
  }

  const t = await db.trips.get(toId(tripId));
  if (!t) return;
  if (t.status === newStatus) return;

  await db.trips.update(toId(tripId), {
    status: newStatus,
    updatedAt: new Date().toISOString()
  });
  await updatePbTrip(toId(tripId), { status: newStatus }).catch(console.error);

  showToast(`✅ Статус изменен на "${newStatus}"`);
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Генерация HTML разметки 4-этапного степпера командировки
 * @param {object} t - Объект поездки
 * @returns {string} HTML
 */
export function renderStepperHtml(t) {
  const currentStatus = String(t.status || 'не подготовлен');

  const isStep1Active = currentStatus === 'не подготовлен';
  const isStep2Active = currentStatus === 'Подготовлен';
  const isStep3Active = currentStatus === 'Отправлен';
  const isStep4Active = currentStatus === 'Выплачен';

  return `
    <div class="trip-stepper" onclick="event.stopPropagation();">
      <div class="stepper-step ${isStep1Active ? 'active' : ''}" title="1. Переключить на: не подготовлен" onclick="setTripStatus('${t.id}', 'не подготовлен')">
        <div class="stepper-dot">1</div>
        <span>не подготовлен</span>
      </div>
      <div class="stepper-line ${isStep2Active || isStep3Active || isStep4Active ? 'active' : ''}"></div>
      
      <div class="stepper-step ${isStep2Active ? 'active' : ''}" title="2. Переключить на: Подготовлен" onclick="setTripStatus('${t.id}', 'Подготовлен')">
        <div class="stepper-dot">2</div>
        <span>Подготовлен</span>
      </div>
      <div class="stepper-line ${isStep3Active || isStep4Active ? 'active' : ''}"></div>
      
      <div class="stepper-step ${isStep3Active ? 'active' : ''}" title="3. Переключить на: Отправлен" onclick="setTripStatus('${t.id}', 'Отправлен')">
        <div class="stepper-dot">3</div>
        <span>Отправлен</span>
      </div>
      <div class="stepper-line ${isStep4Active ? 'active' : ''}"></div>
      
      <div class="stepper-step step-paid step-disabled ${isStep4Active ? 'active' : ''}" title="4. Выплачен (автоматически при полном расчете)" style="cursor: default;">
        <div class="stepper-dot">4</div>
        <span>Выплачен</span>
      </div>
    </div>
  `;
}

/**
 * Рендеринг главного виджета баланса и плиток статусов
 * @param {object} aggregated - Агрегированная сводка из db.js
 */
export function renderHeroBalanceWidget(aggregated) {
  const netBalance = aggregated.netBalanceAll;
  const valEl = document.getElementById('metricValueBalance');
  const subEl = document.getElementById('metricSubtextBalance');
  const cardEl = document.getElementById('metricCardBalance');

  const expEl = document.getElementById('metricValueExpenses');
  const payEl = document.getElementById('metricValuePayments');

  if (expEl) expEl.innerText = `${aggregated.totalOwedAll.toLocaleString('ru-RU')} руб.`;
  if (payEl) payEl.innerText = `${aggregated.totalPaidAll.toLocaleString('ru-RU')} руб.`;

  if (valEl && subEl && cardEl) {
    if (netBalance < 0) {
      valEl.innerText = `${Math.abs(netBalance).toLocaleString('ru-RU')} руб.`;
      subEl.innerText = `Долг бухгалтерии вам (перерасход)`;
      cardEl.className = 'metric-card metric-card-amber';
    } else if (netBalance > 0) {
      valEl.innerText = `${netBalance.toLocaleString('ru-RU')} руб.`;
      subEl.innerText = `Переплата (вы получили больше)`;
      cardEl.className = 'metric-card metric-card-amber';
    } else {
      valEl.innerText = `0 руб.`;
      subEl.innerText = `Все расчеты закрыты в 0`;
      cardEl.className = 'metric-card metric-card-blue';
    }
  }

  // Расчет показателей ТОЛЬКО ПО ОТКРЫТЫМ ПОЕЗДКАМ В РАБОТЕ
  const inWorkSummaries = aggregated.tripSummaries.filter(s => {
    const st = String(s.trip.status || 'не подготовлен').trim();
    if (st === 'Выплачен') return false;
    if (s.totalOwed > 0 && s.paymentsTotal >= s.totalOwed) return false;
    return true;
  });

  let activePerDiem = 0;
  let activeExpenses = 0;
  let activeDepr = 0;
  let activeTotalOwed = 0;
  let activeTotalPaid = 0;

  inWorkSummaries.forEach(s => {
    activePerDiem += s.perDiemSum || 0;
    activeExpenses += s.expensesTotal || 0;
    activeDepr += s.depreciationCost || 0;
    activeTotalOwed += s.totalOwed || 0;
    activeTotalPaid += s.paymentsTotal || 0;
  });

  const activeCurrentDebt = Math.max(0, activeTotalOwed - activeTotalPaid);

  const heroBalEl = document.getElementById('heroBalanceText');
  const heroSubtext = document.getElementById('heroBalanceSubtext');
  const heroOwed = document.getElementById('heroTotalOwed');
  const heroPaid = document.getElementById('heroTotalPaid');
  const heroProgressFill = document.getElementById('heroBalanceProgressFill');

  if (heroBalEl) {
    if (activeCurrentDebt > 0) {
      heroBalEl.innerHTML = `${activeCurrentDebt.toLocaleString('ru-RU')} <span class="currency">₽</span>`;
      if (heroSubtext) heroSubtext.innerText = 'Долг бухгалтерии по текущим поездкам';
    } else if (inWorkSummaries.length === 0) {
      heroBalEl.innerHTML = `0 <span class="currency">₽</span>`;
      if (heroSubtext) heroSubtext.innerText = 'Все командировки сданы и выплачены';
    } else {
      heroBalEl.innerHTML = `0 <span class="currency">₽</span>`;
      if (heroSubtext) heroSubtext.innerText = 'Аванс покрывает все текущие траты';
    }
  }

  if (heroPaid) heroPaid.innerText = `Авансы: ${activeTotalPaid.toLocaleString('ru-RU')} ₽`;
  if (heroOwed) heroOwed.innerText = `Траты: ${activeTotalOwed.toLocaleString('ru-RU')} ₽`;

  if (heroProgressFill) {
    const fillPercent = activeTotalOwed > 0 ? Math.min(100, Math.round((activeTotalPaid / activeTotalOwed) * 100)) : 100;
    heroProgressFill.style.width = `${fillPercent}%`;
  }

  // Детализация расходов
  const elPD = document.getElementById('heroDetailPerDiem');
  const elExp = document.getElementById('heroDetailExpenses');
  const elDepr = document.getElementById('heroDetailDepr');
  const elPay = document.getElementById('heroDetailPaid');
  if (elPD) elPD.innerText = `${activePerDiem.toLocaleString('ru-RU')} ₽`;
  if (elExp) elExp.innerText = `${activeExpenses.toLocaleString('ru-RU')} ₽`;
  if (elDepr) elDepr.innerText = `${activeDepr.toLocaleString('ru-RU')} ₽`;
  if (elPay) elPay.innerText = `${activeTotalPaid.toLocaleString('ru-RU')} ₽`;

  // Счетчики статусов 2x2 Grid
  const countNotReady = document.getElementById('dashCountNotReady');
  const countReady = document.getElementById('dashCountReady');
  const countSent = document.getElementById('dashCountSent');
  const countPaid = document.getElementById('dashCountPaid');

  if (countNotReady && countReady && countSent && countPaid) {
    let cNR = 0, cR = 0, cS = 0, cP = 0;
    aggregated.tripSummaries.forEach(s => {
      const st = s.effectiveStatus || s.trip.status || 'не подготовлен';
      if (st === 'не подготовлен') cNR++;
      else if (st === 'Подготовлен') cR++;
      else if (st === 'Отправлен') cS++;
      else if (st === 'Выплачен') cP++;
      else cNR++;
    });
    countNotReady.innerText = cNR;
    countReady.innerText = cR;
    countSent.innerText = cS;
    countPaid.innerText = cP;

    countNotReady.closest('.dashboard-status-tile')?.classList.toggle('tile-disabled', cNR === 0);
    countReady.closest('.dashboard-status-tile')?.classList.toggle('tile-disabled', cR === 0);
    countSent.closest('.dashboard-status-tile')?.classList.toggle('tile-disabled', cS === 0);
    countPaid.closest('.dashboard-status-tile')?.classList.toggle('tile-disabled', cP === 0);
  }

  // Карусель активных командировок
  const activeContainer = document.getElementById('homeActiveTripsList');
  if (activeContainer) {
    if (inWorkSummaries.length === 0) {
      activeContainer.innerHTML = `
        <div style="background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 16px; padding: 20px; text-align: center; width: 100%; color: #64748B;">
          <span class="material-symbols-outlined" style="font-size: 32px; color: #94A3B8; display: block; margin-bottom: 4px;">task_alt</span>
          <strong>Нет открытых командировок в работе</strong>
          <div style="font-size: 12px; color: #94A3B8; margin-top: 2px;">Все командировки выплачены</div>
        </div>
      `;
    } else {
      let cardHtml = '';
      const isSingle = (inWorkSummaries.length === 1);
      inWorkSummaries.forEach(s => {
        const t = s.trip;
        const dates = `${formatDateToRu(t.startDate)} – ${formatDateToRu(t.finishDate)} (${s.days} дн.)`;
        const isReady = (t.status === 'Подготовлен');
        const badgeClass = isReady ? 'trip-mini-card__status-badge--ready' : 'trip-mini-card__status-badge--not-ready';
        const statusLabel = isReady ? 'подготовлен' : 'не подготовлен';
        const singleClass = isSingle ? 'trip-mini-card--single' : '';

        cardHtml += `
          <div class="trip-mini-card ${singleClass}" onclick="goToTripCard('${t.id}')">
            <span class="trip-mini-card__number">№ ${t.appNo || t.id}</span>
            <div class="trip-mini-card__client">${t.client || 'Клиент'}</div>
            <div class="trip-mini-card__location">
              <span class="material-symbols-outlined">location_on</span>
              ${t.location || 'Город не указан'}
            </div>
            <div class="trip-mini-card__dates">
              <span class="material-symbols-outlined">calendar_month</span>
              ${dates}
            </div>
            <div class="trip-mini-card__footer">
              <span class="trip-mini-card__amount">${s.totalOwed.toLocaleString('ru-RU')} ₽</span>
              <span class="trip-mini-card__status-badge ${badgeClass}">${statusLabel}</span>
            </div>
          </div>
        `;
      });
      activeContainer.innerHTML = cardHtml;
    }
  }
}

/**
 * Фильтрация по чипам в списке поездок
 */
export function setSummaryChipFilter(val, btn) {
  const input = document.getElementById('summaryStatusFilter');
  if (input) input.value = val;
  document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderFilteredSummaryList();
}

/**
 * Рендеринг отфильтрованного списка карточек командировок
 * @param {object} [aggregatedData]
 */
export async function renderFilteredSummaryList(aggregatedData) {
  const filterVal = document.getElementById('summaryStatusFilter')?.value || 'inProgress';
  const rawSearch = (document.getElementById('summarySearchInput')?.value || '').trim();
  const token = localStorage.getItem('github_token') || '';
  const gistId = localStorage.getItem('github_gist_id') || '';
  const isAutofillGarbage = (token && rawSearch === token) || (gistId && rawSearch === gistId) || (rawSearch.length >= 32 && !rawSearch.includes(' ') && /^[a-f0-9]+$/i.test(rawSearch));
  const searchQuery = isAutofillGarbage ? '' : rawSearch.toLowerCase();
  const aggregated = aggregatedData || await getAggregatedSummary();
  const container = document.getElementById('summaryList');
  if (!container) return;

  if (aggregated.tripSummaries.length === 0) {
    container.innerHTML = '<p style="color: #666; font-size: 14px;">Нет данных по командировкам.</p>';
    return;
  }

  let filtered = aggregated.tripSummaries.slice();

  if (filterVal === 'inProgress') {
    filtered = filtered.filter(s => {
      const st = String(s.trip.status || 'не подготовлен');
      return st === 'не подготовлен' || st === 'Подготовлен';
    });
  } else if (filterVal === 'sent') {
    filtered = filtered.filter(s => String(s.trip.status) === 'Отправлен');
  } else if (filterVal === 'paid') {
    filtered = filtered.filter(s => String(s.trip.status) === 'Выплачен');
  } else if (filterVal.startsWith('status:')) {
    const targetStatus = filterVal.replace('status:', '').trim().toLowerCase();
    filtered = filtered.filter(s => {
      const st = String(s.effectiveStatus || s.trip.status || 'не подготовлен').trim().toLowerCase();
      return st === targetStatus;
    });
  }

  const allExpenses = await db.expenses.toArray();
  const allPayments = await db.payments.toArray();

  if (searchQuery) {
    filtered = filtered.filter(s => {
      const t = s.trip;
      const appNo = String(t.appNo || t.id || '').toLowerCase();
      const client = String(t.client || '').toLowerCase();
      const location = String(t.location || t.target || '').toLowerCase();
      const workType = String(t.workType || '').toLowerCase();
      const transport = String(t.transport || '').toLowerCase();
      const note = String(t.note || '').toLowerCase();
      const status = String(t.status || '').toLowerCase();
      const startDate = String(t.startDate || '').toLowerCase();
      const finishDate = String(t.finishDate || '').toLowerCase();

      const tExpenses = allExpenses.filter(e => String(e.tripId) === String(t.id));
      const expMatch = tExpenses.some(e =>
        String(e.description || '').toLowerCase().includes(searchQuery) ||
        String(e.amount || '').toLowerCase().includes(searchQuery) ||
        String(e.date || '').toLowerCase().includes(searchQuery)
      );

      const tPayments = allPayments.filter(p => String(p.tripId) === String(t.id));
      const payMatch = tPayments.some(p =>
        String(p.note || p.purpose || '').toLowerCase().includes(searchQuery) ||
        String(p.amount || '').toLowerCase().includes(searchQuery) ||
        String(p.date || '').toLowerCase().includes(searchQuery)
      );

      return appNo.includes(searchQuery) ||
             client.includes(searchQuery) ||
             location.includes(searchQuery) ||
             workType.includes(searchQuery) ||
             transport.includes(searchQuery) ||
             note.includes(searchQuery) ||
             status.includes(searchQuery) ||
             startDate.includes(searchQuery) ||
             finishDate.includes(searchQuery) ||
             expMatch ||
             payMatch;
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color: #666; font-size: 14px;">По данному фильтру нет записей.</p>';
    return;
  }

  let html = '';
  filtered.forEach(s => {
    const t = s.trip;
    let badgeClass = "badge-success";
    let statusText = "Расчет закрыт (0 руб.)";
    if (s.balance < 0) {
      badgeClass = "badge-danger";
      statusText = `Долг бухгалтерии: ${Math.abs(s.balance).toLocaleString('ru-RU')} руб.`;
    } else if (s.balance > 0) {
      badgeClass = "badge-warning";
      statusText = `Переплата: ${s.balance.toLocaleString('ru-RU')} руб.`;
    }

    const startRu = formatDateToRu(t.startDate);
    const finishRu = formatDateToRu(t.finishDate);

    const tripExpenses = allExpenses.filter(e => String(e.tripId) === String(t.id));
    const tripPayments = allPayments.filter(p => String(p.tripId) === String(t.id));

    let detailsListHtml = '';
    if (tripExpenses.length === 0 && tripPayments.length === 0) {
      detailsListHtml = '<div style="font-size:12px; color:#888; padding:4px 0;">Расходы и выплаты пока не внесены</div>';
    } else {
      if (tripExpenses.length > 0) {
        detailsListHtml += '<strong style="font-size:12px; color:var(--md-sys-color-primary); display:block; margin:6px 0 4px;">🧾 ЧЕКИ И РАСХОДЫ:</strong>';
        tripExpenses.forEach(exp => {
          let fileBadge = '';
          const receiptSrc = exp.receiptUrl || (exp.receiptBase64 ? `data:image/jpeg;base64,${exp.receiptBase64}` : '');
          const isPdf = isPdfFile(exp);

          if (receiptSrc || exp.receiptBase64) {
            if (isPdf) {
              fileBadge = ` <span class="badge" style="background:#E53935; color:#fff; font-size:10px; padding:2px 6px; cursor:pointer;" onclick="event.stopPropagation(); openPdfAttachment('${exp.receiptBase64 || ''}', '${exp.receiptName || 'doc.pdf'}', '${exp.receiptUrl || ''}')">📄 PDF ↗</span>`;
            } else {
              const title = `${(exp.description || 'Чек').replace(/'/g, "\\'")} — ${exp.amount} руб.`;
              fileBadge = ` <span class="badge" style="background:var(--md-sys-color-primary); color:#fff; font-size:10px; padding:2px 6px; cursor:pointer;" onclick="event.stopPropagation(); openPhotoModal('${receiptSrc}', '${title}')">📷 Фото 🔍</span>`;
            }
          }
          detailsListHtml += `
            <div id="summary-expense-row-${exp.id}" style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:10px 12px; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:10px; margin-bottom:6px; cursor:pointer;" onclick="event.stopPropagation(); editExpenseItem('${exp.id}', '${t.id}')">
              <span>📅 ${exp.date} — <strong>${exp.description || 'Расход'}</strong>${fileBadge}</span>
              <strong style="color:var(--md-sys-color-primary);">${exp.amount.toLocaleString('ru-RU')} ₽</strong>
            </div>
          `;
        });
      }

      if (tripPayments.length > 0) {
        detailsListHtml += '<strong style="font-size:12px; color:#2E7D32; display:block; margin:8px 0 4px;">💳 ВЫПЛАТЫ ОТ БУХГАЛТЕРИИ:</strong>';
        tripPayments.forEach(pay => {
          detailsListHtml += `
            <div id="summary-payment-row-${pay.id}" style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:10px 12px; background:#FFFFFF; border:1px solid #A7F3D0; border-radius:10px; margin-bottom:6px; cursor:pointer;" onclick="event.stopPropagation(); editPaymentItem('${pay.id}', '${t.id}')">
              <span>📅 ${pay.date} — <strong>${pay.note || pay.purpose || 'Выплата'}</strong></span>
              <strong style="color:#2E7D32;">+${pay.amount.toLocaleString('ru-RU')} ₽</strong>
            </div>
          `;
        });
      }
    }

    let payPercent = s.totalOwed > 0 ? Math.min(100, Math.round((s.paymentsTotal / s.totalOwed) * 100)) : 100;
    let barClass = payPercent >= 100 ? 'trip-progress-bar-green' : (payPercent > 0 ? 'trip-progress-bar-amber' : 'trip-progress-bar-red');

    let carWidgetHtml = '';
    if (s.carMetrics && s.carMetrics.isAuto) {
      const cm = s.carMetrics;
      const seasonText = cm.season === 'winter' ? '❄️ Зимняя норма' : '☀️ Летняя норма';
      const seasonBg = cm.season === 'winter' ? '#0284C7' : '#D97706';
      
      let deprHtml = '';
      if (cm.depreciationCost > 0) {
        deprHtml = `<span style="color:#D97706; font-weight:600;">🛠 Амортизация: <strong>+${cm.depreciationCost.toLocaleString('ru-RU')} ₽</strong> (${cm.distanceKm} км × ${cm.ratePerKm} ₽)</span>`;
      } else {
        deprHtml = `<span style="color:#666;">🛠 Амортизация: <strong>0 ₽</strong> (пробег ≤ ${cm.deductibleKm} км)</span>`;
      }

      carWidgetHtml = `
        <div style="background: #F0F7FF; border: 1px solid #BCE0FD; border-radius: 12px; padding: 8px 12px; margin-bottom: 8px; font-size: 12px; color: #1E293B;" onclick="event.stopPropagation();">
          <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; color:var(--md-sys-color-primary); margin-bottom:4px; flex-wrap:wrap; gap:4px;">
            <span>🚗 Пробег: <strong>${cm.distanceKm.toLocaleString('ru-RU')} км</strong> (ODO: ${t.odoStart || 0} → ${t.odoFinish || 0})</span>
            <span class="badge" style="background:${seasonBg}; color:#fff; font-size:10px; padding:2px 6px;">
              ${seasonText}: ${cm.fuelRate} л/100км
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px; font-size:11px; margin-top:4px; padding-top:4px; border-top:1px dashed #CBD5E1;">
            <span>⛽ Топливо по норме: <strong>${cm.fuelLiters.toFixed(1)} л</strong></span>
            ${deprHtml}
          </div>
        </div>
      `;
    }

    html += `
      <div id="card-container-${t.id}" class="card" style="margin-bottom: 14px; padding:16px 18px; border-radius:16px; border:none; box-shadow:0 4px 18px rgba(0,0,0,0.06); cursor:pointer;" onclick="transformCardToEdit('${t.id}')">
        <!-- ОБЫЧНЫЙ ВИД КАРТОЧКИ -->
        <div id="card-view-${t.id}" class="md3-anim-fadein">
          
          <!-- Заголовок: Номер заявки + Клиент + Статус -->
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
            <div>
              <span style="font-size:12px; font-weight:700; color:var(--md-sys-color-primary); background:var(--md-sys-color-primary-container); padding:2px 8px; border-radius:8px;">
                №${t.appNo || t.id}
              </span>
              <strong style="font-size:15px; color:#191C20; margin-left:6px;">${t.client || 'Клиент'}</strong>
            </div>
            <span class="badge ${badgeClass}">${statusText}</span>
          </div>

          <!-- Строка Даты и Город -->
          <div style="font-size:13px; color:#444; margin-bottom:8px; display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
            <span style="display:flex; align-items:center; gap:4px; font-weight:500;">
              <span class="material-symbols-outlined" style="font-size:16px; color:#666;">calendar_month</span> ${startRu} – ${finishRu} (${s.days} дн.)
            </span>
            <span style="display:flex; align-items:center; gap:4px; font-weight:500;">
              <span class="material-symbols-outlined" style="font-size:16px; color:#666;">location_on</span> ${t.location || 'Город не указан'}
            </span>
          </div>

          <!-- Интерактивный Стэппер Статусов -->
          ${renderStepperHtml(t)}

          ${carWidgetHtml}

          <!-- Финансовая сводка по поездке -->
          <div style="font-size:12px; color:#555; background:#F8F9FE; padding:8px 10px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
            <span>Суточные: <strong>${s.perDiemSum.toLocaleString('ru-RU')} ₽</strong></span>
            <span>Чеки: <strong>${s.expensesTotal.toLocaleString('ru-RU')} ₽</strong></span>
            ${s.depreciationCost > 0 ? `<span style="color:#D97706;">Амортизация: <strong>+${s.depreciationCost.toLocaleString('ru-RU')} ₽</strong></span>` : ''}
            <span>Итого положено: <strong>${s.totalOwed.toLocaleString('ru-RU')} ₽</strong></span>
            <span>Выплачено: <strong style="color:#2E7D32;">${s.paymentsTotal.toLocaleString('ru-RU')} ₽</strong></span>
          </div>

          <!-- Кнопка раскрытия деталей поездки -->
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button type="button" class="btn btn-sm btn-secondary" style="flex:1; justify-content:space-between; font-size:12px; padding:6px 12px;" onclick="event.stopPropagation(); toggleCardDetails('${t.id}')">
              <span>📋 Список расчетов (${tripExpenses.length}) и выплат (${tripPayments.length})</span>
              <span id="card-details-arrow-${t.id}" class="material-symbols-outlined" style="font-size:18px;">expand_more</span>
            </button>
          </div>
          
          <div id="card-details-container-${t.id}" style="display: none; margin-top: 10px; border-top: 1px dashed #DCE3FF; padding-top: 10px;" onclick="event.stopPropagation();">
            ${detailsListHtml}
          </div>
        </div>

        <!-- ВСТРОЕННАЯ ФОРМА РЕДАКТИРОВАНИЯ -->
        <div id="card-edit-${t.id}" style="display: none;" onclick="event.stopPropagation();"></div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (activeTripId && document.getElementById(`card-edit-${activeTripId}`)) {
    await transformCardToEdit(activeTripId);
  }
  if (currentHighlightedElementId) {
    const el = document.getElementById(currentHighlightedElementId);
    if (el) el.classList.add('selected-item-inverted');
  }
}

/**
 * Создание командировки из основной вкладки
 */
export async function handleCreateTrip(event) {
  event.preventDefault();
  const clientName = document.getElementById('tripClient').value.trim();
  const locationVal = document.getElementById('tripTarget').value.trim();

  if (clientName) {
    const existingClient = await db.clients.where('name').equalsIgnoreCase(clientName).first();
    if (!existingClient) {
      await db.clients.add({ name: clientName, address: locationVal, updatedAt: new Date().toISOString() });
    } else if (locationVal && !existingClient.address) {
      await db.clients.update(existingClient.id, { address: locationVal, updatedAt: new Date().toISOString() });
    }
  }

  const defaultStatus = 'не подготовлен';

  const newTrip = {
    appNo: document.getElementById('tripServiceApp').value,
    client: clientName,
    location: locationVal,
    workType: document.getElementById('tripWorkType').value,
    transport: document.getElementById('tripTransport').value,
    startDate: formatDateToRu(document.getElementById('tripStartDate').value),
    finishDate: formatDateToRu(document.getElementById('tripFinishDate').value),
    odoStart: parseFloat(document.getElementById('tripOdoStart').value) || 0,
    odoFinish: parseFloat(document.getElementById('tripOdoFinish').value) || 0,
    status: defaultStatus,
    perDiemRate: 1100,
    note: document.getElementById('tripNote').value,
    updatedAt: new Date().toISOString()
  };

  try {
    await createPbTrip(newTrip);
    showToast("✅ Поездка сохранена на сервере!");
  } catch (err) {
    console.error("Create trip PB error:", err);
    await db.trips.add(newTrip);
    showToast("⚠️ Сохранено локально: " + err.message);
  }

  document.getElementById('tripForm').reset();
  if (window.setupDefaults) window.setupDefaults();
  toggleAutoFields('tripTransport', 'autoFields');
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Открытие модального окна быстрого создания командировки
 */
export function openCreateTripModal() {
  const modal = document.getElementById('createTripModal');
  if (!modal) return;

  const todayRu = getTodayRuDate();
  if (document.getElementById('modalTripStartDate')) document.getElementById('modalTripStartDate').value = todayRu;
  if (document.getElementById('modalTripFinishDate')) document.getElementById('modalTripFinishDate').value = todayRu;
  if (document.getElementById('modalTripServiceApp')) document.getElementById('modalTripServiceApp').value = '';
  if (document.getElementById('modalTripClient')) document.getElementById('modalTripClient').value = '';
  if (document.getElementById('modalTripTarget')) document.getElementById('modalTripTarget').value = '';
  if (document.getElementById('modalTripOdoStart')) document.getElementById('modalTripOdoStart').value = '';
  if (document.getElementById('modalTripOdoFinish')) document.getElementById('modalTripOdoFinish').value = '';
  if (document.getElementById('modalTripNote')) document.getElementById('modalTripNote').value = '';

  toggleAutoFields('modalTripTransport', 'modalAutoFields');

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeCreateTripModal() {
  const modal = document.getElementById('createTripModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

/**
 * Создание командировки из модального окна
 */
export async function handleCreateTripModal(event) {
  event.preventDefault();
  const clientName = document.getElementById('modalTripClient').value.trim();
  const locationVal = document.getElementById('modalTripTarget').value.trim();

  if (clientName) {
    const existing = await db.clients.where('name').equalsIgnoreCase(clientName).first();
    if (!existing) {
      await db.clients.add({ name: clientName, address: locationVal, updatedAt: new Date().toISOString() });
    } else if (locationVal && !existing.address) {
      await db.clients.update(existing.id, { address: locationVal, updatedAt: new Date().toISOString() });
    }
  }

  const defaultStatus = 'не подготовлен';

  const newTripObj = {
    appNo: document.getElementById('modalTripServiceApp').value,
    client: clientName,
    location: locationVal,
    workType: document.getElementById('modalTripWorkType').value,
    transport: document.getElementById('modalTripTransport').value,
    startDate: formatDateToRu(document.getElementById('modalTripStartDate').value),
    finishDate: formatDateToRu(document.getElementById('modalTripFinishDate').value),
    odoStart: parseFloat(document.getElementById('modalTripOdoStart')?.value) || 0,
    odoFinish: parseFloat(document.getElementById('modalTripOdoFinish')?.value) || 0,
    status: defaultStatus,
    perDiemRate: 1100,
    note: document.getElementById('modalTripNote')?.value || '',
    updatedAt: new Date().toISOString()
  };

  try {
    await createPbTrip(newTripObj);
    showToast("✅ Поездка создана на сервере!");
  } catch (err) {
    console.error("Save trip modal error:", err);
    await db.trips.add(newTripObj);
    showToast("⚠️ Сохранено локально: " + err.message);
  }
  closeCreateTripModal();
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Закрытие активной вложенной формы редактирования чека/выплаты
 */
export function closeActiveChildForm() {
  if (!activeChildEdit) return;
  const child = activeChildEdit;
  activeChildEdit = null;

  if (child.type === 'expense') {
    const globalCardView = document.getElementById(`global-expense-view-${child.id}`);
    const globalCardEdit = document.getElementById(`global-expense-edit-${child.id}`);
    if (globalCardView && globalCardEdit) {
      globalCardEdit.style.display = 'none';
      globalCardEdit.innerHTML = '';
      globalCardView.style.display = 'block';
    }

    const tripInlineRow = document.getElementById(`inline-expense-edit-row-${child.id}`) ||
                          document.getElementById(`summary-expense-row-${child.id}`);
    if (tripInlineRow && child.originalHtml) {
      tripInlineRow.innerHTML = child.originalHtml;
    }
  } else if (child.type === 'payment') {
    const globalCardView = document.getElementById(`global-payment-view-${child.id}`);
    const globalCardEdit = document.getElementById(`global-payment-edit-${child.id}`);
    if (globalCardView && globalCardEdit) {
      globalCardEdit.style.display = 'none';
      globalCardEdit.innerHTML = '';
      globalCardView.style.display = 'block';
    }

    const tripInlineRow = document.getElementById(`inline-payment-edit-row-${child.id}`) ||
                          document.getElementById(`summary-payment-row-${child.id}`);
    if (tripInlineRow && child.originalHtml) {
      tripInlineRow.innerHTML = child.originalHtml;
    }
  }
}

/**
 * Разворачивание формы редактирования командировки внутри карточки
 * @param {string} tripId
 */
export async function transformCardToEdit(tripId) {
  const t = await db.trips.get(toId(tripId));
  if (!t) return;

  if (activeTripId && String(activeTripId) !== String(tripId)) {
    restoreCardView(activeTripId);
  }
  closeActiveChildForm();
  activeTripId = String(tripId);

  const cardContainer = document.getElementById(`card-container-${tripId}`);
  const viewDiv = document.getElementById(`card-view-${tripId}`);
  const editDiv = document.getElementById(`card-edit-${tripId}`);
  if (!cardContainer || !viewDiv || !editDiv) return;

  cardContainer.classList.add('md3-card-transformed');
  viewDiv.style.display = 'none';

  const dicts = await db.dictionaries.toArray();
  const transportList = dicts.filter(d => d.category === 'transport').map(d => d.value);
  const workList = dicts.filter(d => d.category === 'workType').map(d => d.value);

  let transportHtml = '';
  transportList.forEach(tr => {
    transportHtml += `<option value="${tr}" ${tr === t.transport ? 'selected' : ''}>${tr}</option>`;
  });

  let workHtml = '';
  workList.forEach(w => {
    workHtml += `<option value="${w}" ${w === t.workType ? 'selected' : ''}>${w}</option>`;
  });

  const startRu = formatDateToRu(t.startDate);
  const finishRu = formatDateToRu(t.finishDate);

  const tripExpenses = await db.expenses.where('tripId').equals(String(tripId)).toArray();
  const tripPayments = await db.payments.where('tripId').equals(String(tripId)).toArray();

  let expEditRows = '';
  if (tripExpenses.length === 0) {
    expEditRows = '<div style="font-size:12px; color:#888; padding:4px 0;">Расходы пока не внесены</div>';
  } else {
    tripExpenses.forEach(exp => {
      let icon = 'receipt_long';
      if (exp.receiptBase64 || exp.receiptUrl) {
        icon = isPdfFile(exp) ? 'picture_as_pdf' : 'image';
      }
      expEditRows += `
        <div id="inline-expense-edit-row-${exp.id}" style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:10px; padding:10px 12px; margin-bottom:8px; font-size:13px; cursor:pointer;" onclick="event.stopPropagation(); editExpenseItem('${exp.id}', '${t.id}')">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="material-symbols-outlined" style="color:var(--md-sys-color-primary); font-size:18px;">${icon}</span>
            <div>
              <strong>${exp.amount.toLocaleString('ru-RU')} руб.</strong> (${exp.date})<br>
              <span style="color:#555; font-size:12px;">${exp.description || 'Без описания'}</span>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" style="padding:4px 8px; color:#E53935;" onclick="event.stopPropagation(); deleteExpenseItem('${exp.id}', '${t.id}')">
            <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
          </button>
        </div>
      `;
    });
  }

  let payEditRows = '';
  if (tripPayments.length === 0) {
    payEditRows = '<div style="font-size:12px; color:#888; padding:4px 0;">Выплаты пока не внесены</div>';
  } else {
    tripPayments.forEach(pay => {
      payEditRows += `
        <div id="inline-payment-edit-row-${pay.id}" style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border:1px solid #A7F3D0; border-radius:10px; padding:10px 12px; margin-bottom:8px; font-size:13px; cursor:pointer;" onclick="event.stopPropagation(); editPaymentItem('${pay.id}', '${t.id}')">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="material-symbols-outlined" style="color:#2E7D32; font-size:18px;">payments</span>
            <div>
              <strong>+${pay.amount.toLocaleString('ru-RU')} руб.</strong> (${pay.date})<br>
              <span style="color:#555; font-size:12px;">${pay.note || pay.purpose || 'Выплата'}</span>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" style="padding:4px 8px; color:#E53935;" onclick="event.stopPropagation(); deletePaymentItem('${pay.id}', '${t.id}')">
            <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
          </button>
        </div>
      `;
    });
  }

  editDiv.innerHTML = `
    <div class="md3-anim-expand">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px; border-bottom:1px solid #DCE3FF; padding-bottom:8px;">
        <strong style="color:var(--md-sys-color-primary); display:flex; align-items:center; gap:6px;">
          <span class="material-symbols-outlined">edit_note</span> Редактирование ID #${t.id}
        </strong>
        <span class="material-symbols-outlined" style="cursor:pointer; color:#666;" onclick="restoreCardView('${t.id}')">close</span>
      </div>

      <form onsubmit="handleInlineUpdateTrip(event, '${t.id}')">
        <div class="form-row">
          <div class="form-group">
            <label>№ Заявки</label>
            <input type="text" id="inlineServiceApp-${t.id}" class="form-control" value="${t.appNo || ''}" required>
          </div>
          <div class="form-group">
            <label>Клиент</label>
            <input type="text" id="inlineClient-${t.id}" class="form-control" list="clientsDatalist" value="${t.client || ''}" onchange="onClientSelectChange(this.value, 'inlineTarget-${t.id}')" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Место (Адрес)</label>
            <input type="text" id="inlineTarget-${t.id}" class="form-control" value="${t.location || ''}" required>
          </div>
          <div class="form-group">
            <label>Вид работ</label>
            <select id="inlineWorkType-${t.id}" class="form-control">
              ${workHtml}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Старт (ДД.ММ.ГГГГ)</label>
            <div style="position:relative; display:flex; align-items:center;">
              <input type="text" id="inlineStartDate-${t.id}" class="form-control" value="${startRu}" pattern="[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}" required style="padding-right:38px;">
              <input type="date" style="position:absolute; right:4px; opacity:0; width:32px; height:32px; cursor:pointer; z-index:2;" onchange="syncDatePickerToText('inlineStartDate-${t.id}', this.value)">
              <span class="material-symbols-outlined" style="position:absolute; right:10px; pointer-events:none; color:var(--md-sys-color-primary); font-size:20px;">calendar_month</span>
            </div>
          </div>
          <div class="form-group">
            <label>Финиш (ДД.ММ.ГГГГ)</label>
            <div style="position:relative; display:flex; align-items:center;">
              <input type="text" id="inlineFinishDate-${t.id}" class="form-control" value="${finishRu}" pattern="[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}" required style="padding-right:38px;">
              <input type="date" style="position:absolute; right:4px; opacity:0; width:32px; height:32px; cursor:pointer; z-index:2;" onchange="syncDatePickerToText('inlineFinishDate-${t.id}', this.value)">
              <span class="material-symbols-outlined" style="position:absolute; right:10px; pointer-events:none; color:var(--md-sys-color-primary); font-size:20px;">calendar_month</span>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>Транспорт</label>
          <select id="inlineTransport-${t.id}" class="form-control" onchange="toggleAutoFields('inlineTransport-${t.id}', 'inlineAutoFields-${t.id}')">
            ${transportHtml}
          </select>
        </div>

        <!-- Поля авто -->
        <div id="inlineAutoFields-${t.id}" style="display:none; background:#F8F9FE; padding:12px; border-radius:12px; margin-bottom:14px; border:1px solid #DCE3FF;">
          <div class="form-row">
            <div class="form-group">
              <label>ODO Старт (км)</label>
              <input type="number" id="inlineOdoStart-${t.id}" class="form-control" value="${t.odoStart || 0}" step="any" oninput="updateAutoFieldsHint('inlineOdoStart-${t.id}', 'inlineOdoFinish-${t.id}', 'inlineLiters-${t.id}')">
            </div>
            <div class="form-group">
              <label>ODO Финиш (км)</label>
              <input type="number" id="inlineOdoFinish-${t.id}" class="form-control" value="${t.odoFinish || 0}" step="any" oninput="updateAutoFieldsHint('inlineOdoStart-${t.id}', 'inlineOdoFinish-${t.id}', 'inlineLiters-${t.id}')">
            </div>
          </div>

          <div style="margin-top:8px; padding-top:8px; border-top:1px dashed #CBD5E1;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; color:#475569; font-weight:500;">⚡ Расчет ODO старт по чекам заправки</label>
              <button type="button" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;" onclick="calculateStartOdoFromLiters('inlineOdoStart-${t.id}', 'inlineOdoFinish-${t.id}', 'inlineLiters-${t.id}')">
                Рассчитать ODO
              </button>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="number" id="inlineLiters-${t.id}" class="form-control" placeholder="Литры по чекам..." step="any" style="font-size:13px; padding:6px 10px;" oninput="updateAutoFieldsHint('inlineOdoStart-${t.id}', 'inlineOdoFinish-${t.id}', 'inlineLiters-${t.id}')">
            </div>
          </div>

          <div id="inlineAutoHint-${t.id}" style="font-size:11px; color:#4338CA; margin-top:6px; background:#EEF2FF; padding:4px 8px; border-radius:6px; display:none;"></div>
        </div>

        <div class="form-group">
          <label>Примечание</label>
          <input type="text" id="inlineNote-${t.id}" class="form-control" value="${t.note || ''}">
        </div>

        <div style="display:flex; gap:10px; margin-top:14px;">
          <button type="submit" class="btn" style="flex:1;">
            Сохранить
          </button>
          <button type="button" class="btn btn-secondary" onclick="restoreCardView('${t.id}')">
            Отмена
          </button>
        </div>

        <div style="margin-top:6px; margin-bottom:14px; text-align:center;">
          <button type="button" class="btn btn-secondary" style="color:#E53935; border:1px solid #E53935; width:100%; padding:10px; font-size:13px; display:inline-flex; align-items:center; justify-content:center; gap:6px;" onclick="deleteTrip('${t.id}')">
            <span class="material-symbols-outlined" style="font-size:18px;">delete_forever</span> 🗑 Удалить командировку
          </button>
        </div>
      </form>

      <!-- УПРАВЛЕНИЕ РАСХОДАМИ И ВЫПЛАТАМИ ЭТОЙ КОМАНДИРОВКИ -->
      <div style="border-top:2px solid #DCE3FF; padding-top:12px; margin-top:14px;">
        <strong style="color:var(--md-sys-color-primary); font-size:13px; display:block; margin-bottom:8px;">
          🧾 Расходы и чеки этой поездки (${tripExpenses.length})
        </strong>
        ${expEditRows}

        <strong style="color:#2E7D32; font-size:13px; display:block; margin:12px 0 8px;">
          💳 Выплаты от бухгалтерии (${tripPayments.length})
        </strong>
        ${payEditRows}
      </div>
    </div>
  `;

  editDiv.style.display = 'block';
  toggleAutoFields(`inlineTransport-${t.id}`, `inlineAutoFields-${t.id}`);
}

/**
 * Возврат карточки из режима редактирования в обычный вид
 * @param {string} tripId
 */
export function restoreCardView(tripId) {
  if (activeTripId === String(tripId)) {
    activeTripId = null;
  }
  closeActiveChildForm();

  const cardContainer = document.getElementById(`card-container-${tripId}`);
  const viewDiv = document.getElementById(`card-view-${tripId}`);
  const editDiv = document.getElementById(`card-edit-${tripId}`);

  if (cardContainer) cardContainer.classList.remove('md3-card-transformed');
  if (editDiv) editDiv.style.display = 'none';
  if (viewDiv) viewDiv.style.display = 'block';
}

/**
 * Сохранение изменений командировки из встроенной формы карточки
 */
export async function handleInlineUpdateTrip(event, tripId) {
  event.preventDefault();
  const updateObj = {
    appNo: document.getElementById(`inlineServiceApp-${tripId}`).value,
    client: document.getElementById(`inlineClient-${tripId}`).value,
    location: document.getElementById(`inlineTarget-${tripId}`).value,
    workType: document.getElementById(`inlineWorkType-${tripId}`).value,
    transport: document.getElementById(`inlineTransport-${tripId}`).value,
    startDate: formatDateToRu(document.getElementById(`inlineStartDate-${tripId}`).value),
    finishDate: formatDateToRu(document.getElementById(`inlineFinishDate-${tripId}`).value),
    odoStart: parseFloat(document.getElementById(`inlineOdoStart-${tripId}`).value) || 0,
    odoFinish: parseFloat(document.getElementById(`inlineOdoFinish-${tripId}`).value) || 0,
    note: document.getElementById(`inlineNote-${tripId}`).value,
    updatedAt: new Date().toISOString()
  };

  await db.trips.update(toId(tripId), updateObj);
  await updatePbTrip(toId(tripId), updateObj).catch(console.error);

  showToast("✅ Изменения сохранены!");
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Раскрытие списка расходов и выплат внутри карточки
 */
export function toggleCardDetails(tripId) {
  const container = document.getElementById(`card-details-container-${tripId}`);
  const arrow = document.getElementById(`card-details-arrow-${tripId}`);
  if (!container) return;

  if (container.style.display === 'none') {
    container.style.display = 'block';
    if (arrow) arrow.innerText = 'expand_less';
  } else {
    container.style.display = 'none';
    if (arrow) arrow.innerText = 'expand_more';
  }
}

/**
 * Мягкое удаление командировки со всеми связанными расходами и выплатами
 * @param {string} tripId
 */
export async function deleteTrip(tripId) {
  const trip = await db.trips.get(toId(tripId));
  if (!trip) return;

  const appName = trip.appNo ? `№${trip.appNo}` : `ID:${trip.id}`;
  const clientName = trip.client ? ` (${trip.client})` : '';

  if (!confirm(`Вы действительно хотите удалить командировку ${appName}${clientName}?\n\nВсе связанные с ней расходы и выплаты также будут помечены на удаление.`)) {
    return;
  }

  // 1. Помечаем на удаление все связанные расходы
  const tripExpenses = await db.expenses.where('tripId').equals(String(tripId)).toArray();
  for (const exp of tripExpenses) {
    if (window.deletePbExpense) await window.deletePbExpense(exp.id).catch(() => {});
    await db.expenses.delete(exp.id);
  }

  // 2. Помечаем на удаление все связанные выплаты
  const tripPayments = await db.payments.where('tripId').equals(String(tripId)).toArray();
  for (const pay of tripPayments) {
    if (window.deletePbPayment) await window.deletePbPayment(pay.id).catch(() => {});
    await db.payments.delete(pay.id);
  }

  // 3. Помечаем на удаление саму поездку на сервере и удаляем из локальной БД
  await deletePbTrip(toId(tripId)).catch(console.error);
  await db.trips.delete(toId(tripId));

  showToast(`🗑 Командировка ${appName} помечена на удаление!`);
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Раскрытие детализации баланса в дашборде
 */
export function toggleHomeBalanceDetails() {
  const widget = document.getElementById('homeSummaryWidget');
  const icon = document.getElementById('homeBalanceExpandIcon');
  if (!widget) return;
  const isExpanded = widget.classList.toggle('expanded');
  if (icon) icon.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
}

/**
 * Переход на вкладку поездок с фильтром по статусу (при клике на плитку дашборда)
 */
export async function goToStatusFilter(statusName) {
  const aggregated = await getAggregatedSummary();
  const count = aggregated.tripSummaries.filter(s => {
    const st = String(s.effectiveStatus || s.trip.status || 'не подготовлен').trim().toLowerCase();
    return st === statusName.toLowerCase();
  }).length;

  if (count === 0) {
    showToast(`ℹ️ Нет командировок со статусом "${statusName}"`);
    return;
  }

  if (window.switchTab) window.switchTab('summaryTab');
  const filterInput = document.getElementById('summaryStatusFilter');
  if (filterInput) {
    filterInput.value = `status:${statusName}`;
  }
  document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
  await renderFilteredSummaryList();
}

/**
 * Мягкий переход к карточке командировки из карусели
 */
export async function goToTripCard(tripId) {
  sessionStorage.setItem('activeTab', 'summaryTab');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));

  const targetContent = document.getElementById('summaryTab');
  if (targetContent) targetContent.classList.add('active');

  const targetNavTab = document.querySelector(`.nav-tab[onclick*="summaryTab"]`);
  if (targetNavTab) targetNavTab.classList.add('active');

  const targetMobileNav = document.querySelector(`.mobile-nav-item[onclick*="summaryTab"]`);
  if (targetMobileNav) targetMobileNav.classList.add('active');

  const filterInput = document.getElementById('summaryStatusFilter');
  if (filterInput) filterInput.value = 'all';
  document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));

  await renderFilteredSummaryList();

  requestAnimationFrame(() => {
    const card = document.getElementById(`card-container-${tripId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('trip-card-gentle-highlight');
      setTimeout(() => card.classList.remove('trip-card-gentle-highlight'), 2300);
    }
  });
}

/**
 * Обновление выпадающих списков выбора командировки (в формах расхода, выплаты, отчета)
 */
export async function refreshTripSelects() {
  const aggregated = await getAggregatedSummary();
  const trips = aggregated.tripSummaries;

  const expTripSelect = document.getElementById('expenseTripId');
  const payTripSelect = document.getElementById('paymentTripId');
  const reportTripSelect = document.getElementById('reportTripSelect') || document.getElementById('reportTripId');
  
  const showClosedExp = document.getElementById('showClosedTripsExp')?.checked;
  const showClosedPay = document.getElementById('showClosedTripsPay')?.checked;
  const showClosedRep = document.getElementById('showClosedTripsRep')?.checked;

  const isTripInWork = s => {
    const t = s.trip;
    const st = String(t.status || 'не подготовлен').trim();
    if (st === 'Отправлен' || st === 'Выплачен' || st === 'Отчитан' || st === 'Завершена') return false;
    if (s.totalOwed > 0 && s.paymentsTotal >= s.totalOwed) return false;
    return true;
  };

  const isTripOpenForPayment = s => {
    const t = s.trip;
    const st = String(t.status || 'не подготовлен').trim();
    if (st === 'Выплачен') return false;
    if (s.totalOwed > 0 && s.paymentsTotal >= s.totalOwed) return false;
    return true;
  };

  const expSummaries = showClosedExp ? trips : trips.filter(isTripInWork);
  const paySummaries = showClosedPay ? trips : trips.filter(isTripOpenForPayment);
  const repSummaries = showClosedRep ? trips : trips.filter(isTripOpenForPayment);

  if (expTripSelect) {
    const currentExpVal = expTripSelect.value;
    expTripSelect.innerHTML = expSummaries.length === 0 ? '<option value="">(Нет активных командировок в работе)</option>' : '';
    expSummaries.forEach(s => {
      const t = s.trip;
      expTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
    if (currentExpVal) expTripSelect.value = currentExpVal;
  }

  if (payTripSelect) {
    const currentPayVal = payTripSelect.value;
    payTripSelect.innerHTML = paySummaries.length === 0 ? '<option value="">(Нет открытых командировок)</option>' : '';
    paySummaries.forEach(s => {
      const t = s.trip;
      payTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
    if (currentPayVal) payTripSelect.value = currentPayVal;
  }

  if (reportTripSelect) {
    const currentRepVal = reportTripSelect.value;
    reportTripSelect.innerHTML = repSummaries.length === 0 ? '<option value="">(Нет открытых командировок)</option>' : '';
    repSummaries.forEach(s => {
      const t = s.trip;
      reportTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
    if (currentRepVal) reportTripSelect.value = currentRepVal;
  }
}
