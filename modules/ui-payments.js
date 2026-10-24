/**
 * ====================================================================
 * МОДУЛЬ: ui-payments.js
 * Назначение: Управление выплатами от бухгалтерии
 * - Добавление выплаты (основная форма и быстрое модальное окно)
 * - Автоматическая смена статуса поездки на «Выплачен» при полном расчете
 * - Общий список выплат с фильтрацией по периодам
 * - Инлайн-редактирование и мягкое удаление выплат (Soft Delete)
 * ====================================================================
 */

import { db, formatDateToRu, parseRuDate, getTodayRuDate, getAggregatedSummary } from '../db.js';
import { createPbPayment, updatePbPayment, deletePbPayment } from '../pocketbaseSync.js';
import { showToast, scheduleAutoSync, toId, isDateInPeriod, highlightSelectedItem, closeEditBottomSheet, applyDesktopModalStyle } from './ui-utils.js';
import { activeTripId } from './ui-trips.js';

/**
 * Сохранение выплаты из основной формы вкладки «Выплаты»
 */
export async function handleAddPayment(event) {
  event.preventDefault();
  const tripId = document.getElementById('paymentTripId').value;
  if (!tripId) {
    showToast("Выберите командировку");
    return;
  }

  const payData = {
    tripId: tripId,
    date: formatDateToRu(document.getElementById('paymentDate').value),
    amount: parseFloat(document.getElementById('paymentAmount').value) || 0,
    note: document.getElementById('paymentNote').value
  };
  try {
    await createPbPayment(payData);
  } catch (err) {
    console.error("Payment save error:", err);
    await db.payments.add(payData);
  }

  // Проверка закрытия баланса для смены статуса на "Выплачен"
  const aggregated = await getAggregatedSummary();
  const summary = aggregated.tripSummaries.find(s => String(s.trip.id) === String(tripId));
  if (summary && summary.totalOwed > 0 && summary.paymentsTotal >= summary.totalOwed) {
    await db.trips.update(toId(tripId), { status: 'Выплачен', updatedAt: new Date().toISOString() });
    showToast("✅ Выплата зафиксирована! Статус сменен на 'Выплачен'");
  } else {
    showToast("✅ Выплата зафиксирована!");
  }

  document.getElementById('paymentForm').reset();
  if (window.setupDefaults) window.setupDefaults();
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Открытие быстрого модального окна добавления выплаты (Speed Dial)
 */
export async function openQuickPaymentModal() {
  const modal = document.getElementById('quickPaymentModal');
  const tripSelect = document.getElementById('quickPaymentTripId');
  if (!modal || !tripSelect) return;

  const aggregated = await getAggregatedSummary();
  const trips = aggregated.tripSummaries;

  const isTripOpenForPayment = s => {
    const t = s.trip;
    const st = String(t.status || 'не подготовлен').trim();
    if (st === 'Выплачен') return false;
    if (s.totalOwed > 0 && s.paymentsTotal >= s.totalOwed) return false;
    return true;
  };

  const openTrips = trips.filter(isTripOpenForPayment);
  tripSelect.innerHTML = '';

  if (openTrips.length === 0) {
    tripSelect.innerHTML = '<option value="">(Все командировки уже выплачены)</option>';
  } else {
    openTrips.reverse().forEach(s => {
      const t = s.trip;
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.innerText = `№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})`;
      tripSelect.appendChild(opt);
    });
  }

  document.getElementById('quickPaymentDate').value = getTodayRuDate();
  document.getElementById('quickPaymentAmount').value = '';
  document.getElementById('quickPaymentNote').value = '';

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeQuickPaymentModal() {
  const modal = document.getElementById('quickPaymentModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

export async function handleQuickAddPayment(event) {
  event.preventDefault();
  const tripId = document.getElementById('quickPaymentTripId').value;
  if (!tripId) {
    showToast("Выберите командировку!");
    return;
  }

  const rawDate = document.getElementById('quickPaymentDate').value;
  const amount = parseFloat(document.getElementById('quickPaymentAmount').value) || 0;
  const note = document.getElementById('quickPaymentNote').value;

  const newPaymentObj = {
    tripId: tripId,
    date: formatDateToRu(rawDate),
    amount: amount,
    note: note,
    updatedAt: new Date().toISOString()
  };

  try {
    await createPbPayment(newPaymentObj);
    showToast("✅ Выплата сохранена на сервере!");
  } catch (err) {
    console.error("Save payment error:", err);
    await db.payments.add(newPaymentObj);
    showToast("⚠️ Сохранено локально: " + err.message);
  }

  closeQuickPaymentModal();
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Редактирование существующей выплаты
 * @param {string} paymentId
 * @param {string} [tripId]
 */
export async function editPaymentItem(paymentId, tripId) {
  let pay = await db.payments.get(toId(paymentId));
  if (!pay) pay = await db.payments.get(String(paymentId));
  if (!pay) return;

  const activeTabId = document.querySelector('.tab-content.active')?.id;
  let targetId = '';
  if (activeTabId === 'paymentsTab') {
    targetId = `global-payment-card-${paymentId}`;
  } else if (activeTripId && String(activeTripId) === String(tripId)) {
    targetId = `inline-payment-edit-row-${paymentId}`;
  } else {
    targetId = `summary-payment-row-${paymentId}`;
  }

  highlightSelectedItem(targetId);

  const editFormHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #A7F3D0; padding-bottom:10px;">
      <strong style="font-size:17px; color:#2E7D32; display:flex; align-items:center; gap:8px;">
        <span class="material-symbols-outlined">payments</span> Редактирование выплаты
      </strong>
      <span class="material-symbols-outlined" style="cursor:pointer; color:#666; font-size:24px;" onclick="closeEditBottomSheet('${targetId}')">close</span>
    </div>

    <form onsubmit="event.preventDefault(); saveInlinePayment('${paymentId}', '${tripId || ''}', '${targetId}');">
      <div class="form-group" style="margin-bottom: 12px;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 4px; display:block;">Дата выплаты (ДД.ММ.ГГГГ)</label>
        <div style="position:relative; display:flex; align-items:center;">
          <input type="text" id="editPayDate-${paymentId}" class="form-control" style="font-size: 14px; padding: 10px 38px 10px 12px;" value="${pay.date}" pattern="[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}" required>
          <input type="date" style="position:absolute; right:4px; opacity:0; width:36px; height:36px; cursor:pointer; z-index:2;" onchange="syncDatePickerToText('editPayDate-${paymentId}', this.value)">
          <span class="material-symbols-outlined" style="position:absolute; right:10px; pointer-events:none; color:#2E7D32; font-size:22px;">calendar_month</span>
        </div>
      </div>

      <div class="form-group" style="margin-bottom: 12px;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 4px; display:block;">Сумма выплаты (руб)</label>
        <input type="number" id="editPayAmount-${paymentId}" class="form-control" style="font-size: 15px; font-weight:600; padding: 10px 12px; color:#2E7D32;" value="${pay.amount}" step="0.01" required>
      </div>

      <div class="form-group" style="margin-bottom: 16px;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 4px; display:block;">Примечание / Назначение</label>
        <input type="text" id="editPayNote-${paymentId}" class="form-control" style="font-size: 14px; padding: 10px 12px;" value="${pay.note || pay.purpose || ''}" placeholder="Выплата на карту...">
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px; width:100%;">
        <button type="submit" class="btn" style="width:100%; padding: 12px; font-size:15px; font-weight:600; background:#2E7D32; display:flex; align-items:center; justify-content:center; gap:8px;">
          <span class="material-symbols-outlined" style="font-size:20px;">save</span> Сохранить выплату
        </button>
        <div style="display:flex; gap:10px; width:100%;">
          <button type="button" class="btn btn-secondary" style="flex:1; padding: 10px; font-size:13px; color:#E53935; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="${tripId ? `deletePaymentItem('${paymentId}', '${tripId}', '${targetId}')` : `deleteGlobalPaymentItem('${paymentId}', '${targetId}')`}">
            <span class="material-symbols-outlined" style="font-size:18px;">delete</span> Удалить
          </button>
          <button type="button" class="btn btn-secondary" style="flex:1; padding: 10px; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="closeEditBottomSheet('${targetId}')">
            Отмена
          </button>
        </div>
      </div>
    </form>
  `;

  const card = document.getElementById('editBottomSheetCard');
  const modal = document.getElementById('editBottomSheetModal');
  if (card && modal) {
    card.innerHTML = editFormHtml;
    applyDesktopModalStyle();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

export async function saveInlinePayment(paymentId, tripId, targetId) {
  const dateVal = document.getElementById(`editPayDate-${paymentId}`).value;
  const amountVal = parseFloat(document.getElementById(`editPayAmount-${paymentId}`).value) || 0;
  const noteVal = document.getElementById(`editPayNote-${paymentId}`).value;

  const updateObj = {
    date: formatDateToRu(dateVal),
    amount: amountVal,
    note: noteVal,
    updatedAt: new Date().toISOString()
  };

  await db.payments.update(toId(paymentId), updateObj);
  await updatePbPayment(toId(paymentId), updateObj).catch(console.error);

  closeEditBottomSheet(targetId);
  showToast("✅ Выплата обновлена!");
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

export function cancelInlinePaymentEdit(paymentId, tripId) {
  closeEditBottomSheet();
}

/**
 * Мягкое удаление выплаты (Soft Delete)
 */
export async function deletePaymentItem(paymentId, tripId, targetId) {
  if (confirm("Вы уверены, что хотите удалить эту выплату?")) {
    await deletePbPayment(toId(paymentId)).catch(console.error);
    await db.payments.delete(toId(paymentId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Выплата помечена на удаление!");
    if (window.loadData) await window.loadData();
    scheduleAutoSync(500);
  }
}

export async function deleteGlobalPaymentItem(paymentId, targetId) {
  if (confirm("Вы уверены, что хотите удалить эту выплату?")) {
    await deletePbPayment(toId(paymentId)).catch(console.error);
    await db.payments.delete(toId(paymentId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Выплата помечена на удаление!");
    if (window.loadData) await window.loadData();
    scheduleAutoSync(500);
  }
}

export function toggleGlobalPaymentExpand(payId) {
  const detailsDiv = document.getElementById(`global-payment-details-${payId}`);
  const arrow = document.getElementById(`global-pay-arrow-${payId}`);
  if (!detailsDiv) return;
  if (detailsDiv.style.display === 'none') {
    detailsDiv.style.display = 'block';
    if (arrow) arrow.innerText = 'expand_less';
  } else {
    detailsDiv.style.display = 'none';
    if (arrow) arrow.innerText = 'expand_more';
  }
}

/**
 * Рендеринг общего списка выплат во вкладке «Выплаты»
 */
export async function renderPaymentsList() {
  const container = document.getElementById('paymentsListContainer');
  const badge = document.getElementById('paymentsTotalBadge');
  if (!container) return;

  const period = document.getElementById('paymentPeriodFilter')?.value || 'currentMonth';
  const payments = await db.payments.toArray();
  const trips = await db.trips.toArray();

  const filtered = payments.filter(p => isDateInPeriod(p.date, period));

  filtered.sort((a, b) => {
    const da = parseRuDate(a.date) || new Date(0);
    const dbTime = parseRuDate(b.date) || new Date(0);
    return dbTime.getTime() - da.getTime();
  });

  const totalSum = filtered.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
  if (badge) badge.innerText = `Итого за период: ${totalSum.toLocaleString('ru-RU')} руб. (${filtered.length} вып.)`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <p style="color:#888; font-size:13px; margin:4px 0;">
        За выбранный период выплат не найдено. 
        <button type="button" class="btn btn-sm btn-secondary" style="margin-left:6px;" onclick="document.getElementById('paymentPeriodFilter').value='all'; renderPaymentsList();">Показать за всё время</button>
      </p>
    `;
    return;
  }

  let html = '';
  filtered.forEach(pay => {
    const trip = trips.find(t => String(t.id) === String(pay.tripId));
    const tripName = trip ? `№${trip.appNo || trip.id} ${trip.client || ''}` : 'Командировка';

    html += `
      <div id="global-payment-card-${pay.id}" class="card" style="margin-bottom:10px; padding:14px; cursor:pointer; background:#FFFFFF; border:none; box-shadow:0 3px 14px rgba(0,0,0,0.05);" onclick="editPaymentItem('${pay.id}', '${pay.tripId || ''}')">
        <div id="global-payment-view-${pay.id}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="material-symbols-outlined" style="color:#2E7D32; font-size:22px;">payments</span>
              <div>
                <strong style="color:#2E7D32; font-size:14px;">+${pay.amount.toLocaleString('ru-RU')} руб.</strong><br>
                <span style="color:#333; font-weight:500;">${pay.note || pay.purpose || 'Выплата'}</span><br>
                <span style="color:#777; font-size:11px;">📅 ${pay.date} | 📍 ${tripName}</span>
              </div>
            </div>
          </div>
        </div>

        <div id="global-payment-edit-${pay.id}" style="display:none;" onclick="event.stopPropagation();"></div>
      </div>
    `;
  });

  container.innerHTML = html;
}
