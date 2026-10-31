/**
 * ====================================================================
 * МОДУЛЬ: ui-mail-scanner.js
 * Назначение: Интеграция с почтой Mail.ru и реестр поездок Яндекс Go
 * - Настройки учетной записи почты и проверка подключения IMAP
 * - Синхронизация писем о поездках напрямую в таблицу базы данных taxi_rides
 * - Полноценный реестр поездок в базе: маршрут («откуда — куда»), точное время, сумма
 * - Умное сопоставление с командировками по датам
 * - Включение/исключение поездки из расходов командировки и Авансового отчета
 * ====================================================================
 */

import { db, parseRuDate, formatDateToRu } from '../db.js';
import { PB_URL, syncWithPocketBase, linkTaxiRideToTrip, unlinkTaxiRideFromTrip, toggleIgnoreTaxiRide } from '../pocketbaseSync.js';
import { showToast } from './ui-utils.js';

// Текущая активная вкладка фильтра в модальном окне: 'all', 'pending', 'linked', 'ignored'
let currentTaxiFilter = 'all';

/**
 * Инициализация и загрузка сохраненных настроек почты в интерфейс
 */
export function loadMailruSettings() {
  const emailInput = document.getElementById('mailruEmailInput');
  const passInput = document.getElementById('mailruPasswordInput');

  const savedEmail = localStorage.getItem('mailru_email') || '';
  const savedPass = localStorage.getItem('mailru_password') || '';

  if (emailInput && savedEmail) emailInput.value = savedEmail;
  if (passInput && savedPass) passInput.value = savedPass;

  updateMailruStatusUI();
}

/**
 * Обновление статуса в интерфейсе настроек
 */
export function updateMailruStatusUI(customMsg, isOk, isErr) {
  const statusBadge = document.getElementById('mailruStatusBadge');
  const hintEl = document.getElementById('ygoCurrentEmailHint');
  const savedEmail = localStorage.getItem('mailru_email') || '';

  if (hintEl) {
    hintEl.textContent = savedEmail || 'не настроена';
  }

  if (!statusBadge) return;

  if (customMsg) {
    if (isOk) {
      statusBadge.style.background = '#ECFDF5';
      statusBadge.style.color = '#065F46';
      statusBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px; color:#10B981;">check_circle</span> ${customMsg}`;
    } else if (isErr) {
      statusBadge.style.background = '#FEF2F2';
      statusBadge.style.color = '#991B1B';
      statusBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px; color:#EF4444;">error</span> ${customMsg}`;
    } else {
      statusBadge.style.background = '#FEF3C7';
      statusBadge.style.color = '#92400E';
      statusBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px; color:#F59E0B;">sync</span> ${customMsg}`;
    }
    return;
  }

  const savedPass = localStorage.getItem('mailru_password') || '';
  if (savedEmail && savedPass) {
    statusBadge.style.background = '#EFF6FF';
    statusBadge.style.color = '#1E40AF';
    statusBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px; color:#3B82F6;">mark_email_read</span> Настроено: <strong>${savedEmail}</strong>`;
  } else {
    statusBadge.style.background = '#FEF3C7';
    statusBadge.style.color = '#92400E';
    statusBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">mail</span> Статус: Не настроено`;
  }
}

/**
 * Переключение видимости пароля приложения
 */
export function toggleMailPasswordVisibility() {
  const passInput = document.getElementById('mailruPasswordInput');
  if (!passInput) return;
  passInput.type = passInput.type === 'password' ? 'text' : 'password';
}

/**
 * Сохранение настроек почты Mail.ru
 */
export function saveMailruSettings() {
  const emailInput = document.getElementById('mailruEmailInput');
  const passInput = document.getElementById('mailruPasswordInput');

  const emailVal = (emailInput?.value || '').trim();
  const passVal = (passInput?.value || '').trim();

  if (!emailVal || !passVal) {
    showToast('Укажите email и пароль приложения Mail.ru', 3000);
    return;
  }

  localStorage.setItem('mailru_email', emailVal);
  localStorage.setItem('mailru_password', passVal);

  updateMailruStatusUI();
  showToast('✅ Настройки почты успешно сохранены', 2500);
}

/**
 * Проверка подключения к серверу IMAP Mail.ru
 */
export async function testMailruConnection() {
  const emailInput = document.getElementById('mailruEmailInput');
  const passInput = document.getElementById('mailruPasswordInput');

  const emailVal = (emailInput?.value || localStorage.getItem('mailru_email') || '').trim();
  const passVal = (passInput?.value || localStorage.getItem('mailru_password') || '').trim();

  if (!emailVal || !passVal) {
    showToast('Введите email и пароль приложения для проверки', 3000);
    return;
  }

  updateMailruStatusUI('Проверка подключения к imap.mail.ru...', false, false);

  try {
    const res = await fetch(`${PB_URL}/api/mail-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailVal,
        password: passVal,
        server: 'imap.mail.ru',
        port: 993,
        testOnly: true
      })
    });

    const data = await res.json();
    if (data.success) {
      updateMailruStatusUI('Подключение к Mail.ru успешно!', true, false);
      showToast('🎉 Связь с почтовым ящиком успешно установлена!', 3000);
    } else {
      updateMailruStatusUI(`Ошибка: ${data.error || 'Не удалось войти'}`, false, true);
      showToast(`Ошибка: ${data.error || 'Проверьте логин/пароль'}`, 4500);
    }
  } catch (err) {
    updateMailruStatusUI(`Сетевая ошибка: ${err.message}`, false, true);
    showToast(`Ошибка сети при проверке: ${err.message}`, 4000);
  }
}

/**
 * Открытие модального окна реестра поездок Яндекс Go из базы
 */
export async function openYandexGoModal() {
  const modal = document.getElementById('yandexGoModal');
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }

  const savedEmail = localStorage.getItem('mailru_email') || '';
  const hintEl = document.getElementById('ygoCurrentEmailHint');
  if (hintEl) hintEl.textContent = savedEmail || 'не настроена';

  // Моментально отображаем поездки из базы данных
  await renderYandexGoRidesFromDb();
}

/**
 * Закрытие модального окна импорта
 */
export function closeYandexGoModal() {
  const modal = document.getElementById('yandexGoModal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

/**
 * Переключение таба фильтра в модальном окне
 */
export function setTaxiFilterTab(tabName) {
  currentTaxiFilter = tabName;
  renderYandexGoRidesFromDb();
}

/**
 * Отрисовка реестра поездок Яндекс Go напрямую из локальной базы данных
 */
export async function renderYandexGoRidesFromDb() {
  const container = document.getElementById('ygoScanContainer');
  if (!container) return;

  // 1. Получаем поездки такси, командировки и расходы из базы данных
  let allRides = [];
  try {
    allRides = await db.taxi_rides.toArray();
  } catch (_) {
    allRides = [];
  }

  const allTrips = await db.trips.toArray();
  const trips = allTrips.filter(t => !t.isDeleted && !t.deleted);
  const expenses = await db.expenses.toArray();

  // Сортировка поездок: от свежих к более старым
  allRides.sort((a, b) => {
    const da = parseRuDate(a.date) || new Date(0);
    const db_ = parseRuDate(b.date) || new Date(0);
    return db_.getTime() - da.getTime();
  });

  const totalCount = allRides.length;
  const linkedCount = allRides.filter(r => r.status === 'linked' || r.expenseId).length;
  const pendingCount = allRides.filter(r => r.status !== 'linked' && r.status !== 'ignored' && !r.expenseId).length;
  const ignoredCount = allRides.filter(r => r.status === 'ignored').length;

  // Фильтрация в соответствии с выбранной вкладкой
  let filteredRides = allRides;
  if (currentTaxiFilter === 'pending') {
    filteredRides = allRides.filter(r => r.status !== 'linked' && r.status !== 'ignored' && !r.expenseId);
  } else if (currentTaxiFilter === 'linked') {
    filteredRides = allRides.filter(r => r.status === 'linked' || r.expenseId);
  } else if (currentTaxiFilter === 'ignored') {
    filteredRides = allRides.filter(r => r.status === 'ignored');
  }

  // Панель вкладок и статистики
  let html = `
    <div style="background:#FFFFFF; border-bottom:1px solid #E2E8F0; padding:4px 0 10px; margin-bottom:12px; position:sticky; top:0; z-index:5;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px; color:#475569;">
        <span>В базе: <strong>${totalCount}</strong> поездок (в отчетах: <strong>${linkedCount}</strong>)</span>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${currentTaxiFilter === 'all' ? '' : 'btn-secondary'}" style="font-size:11.5px; padding:3px 10px; border-radius:16px;" onclick="setTaxiFilterTab('all')">
          Все (${totalCount})
        </button>
        <button type="button" class="btn btn-sm ${currentTaxiFilter === 'pending' ? '' : 'btn-secondary'}" style="font-size:11.5px; padding:3px 10px; border-radius:16px;" onclick="setTaxiFilterTab('pending')">
          Ожидают (${pendingCount})
        </button>
        <button type="button" class="btn btn-sm ${currentTaxiFilter === 'linked' ? '' : 'btn-secondary'}" style="font-size:11.5px; padding:3px 10px; border-radius:16px;" onclick="setTaxiFilterTab('linked')">
          В расходах (${linkedCount})
        </button>
        <button type="button" class="btn btn-sm ${currentTaxiFilter === 'ignored' ? '' : 'btn-secondary'}" style="font-size:11.5px; padding:3px 10px; border-radius:16px;" onclick="setTaxiFilterTab('ignored')">
          Личные (${ignoredCount})
        </button>
      </div>
    </div>
  `;

  if (filteredRides.length === 0) {
    if (totalCount === 0) {
      html += `
        <div style="text-align:center; padding:32px 16px; color:#64748B;">
          <span class="material-symbols-outlined" style="font-size:44px; color:#F59E0B; margin-bottom:8px;">forward_to_inbox</span>
          <strong style="font-size:15px; color:#334155; display:block; margin-bottom:6px;">В базе пока нет поездок</strong>
          <p style="font-size:12.5px; margin:0 0 12px;">Нажмите «Сканировать сейчас», чтобы загрузить письма из Яндекс Go за выбранный период.</p>
          <button class="btn btn-sm" style="background:#D97706;" onclick="triggerYandexGoScan()">🔄 Сканировать почту сейчас</button>
        </div>
      `;
    } else {
      html += `
        <div style="text-align:center; padding:32px 16px; color:#64748B;">
          <span class="material-symbols-outlined" style="font-size:36px; color:#CBD5E1; margin-bottom:6px;">filter_alt_off</span>
          <p style="font-size:13px; margin:0;">В этой категории поездок нет.</p>
        </div>
      `;
    }
    container.innerHTML = html;
    return;
  }

  html += `<div style="display:flex; flex-direction:column; gap:10px;">`;

  filteredRides.forEach((ride) => {
    const isLinked = ride.status === 'linked' || !!ride.expenseId;
    const isIgnored = ride.status === 'ignored';

    // Поиск привязанной командировки
    let linkedTrip = null;
    if (ride.tripId) {
      linkedTrip = trips.find(t => String(t.id) === String(ride.tripId));
    }

    // Если еще не привязана, пробуем подобрать командировку по дате
    let matchedTripId = ride.tripId || '';
    if (!matchedTripId) {
      const rideDateObj = parseRuDate(ride.date);
      if (rideDateObj) {
        for (const t of trips) {
          const startObj = parseRuDate(t.startDate);
          const finObj = parseRuDate(t.finishDate || t.startDate);
          if (startObj && finObj && rideDateObj >= startObj && rideDateObj <= finObj) {
            matchedTripId = t.id;
            break;
          }
        }
      }
    }
    if (!matchedTripId && trips.length > 0) {
      matchedTripId = trips[0].id;
    }

    // Формируем выпадающий список командировок
    let tripOptionsHtml = trips.map(t => {
      const selected = String(t.id) === String(matchedTripId) ? 'selected' : '';
      const orderLabel = t.appNo ? `[${t.appNo}] ` : '';
      const clientLabel = t.client ? `${t.client} ` : '';
      const datesLabel = `(${t.startDate || ''} - ${t.finishDate || ''})`;
      return `<option value="${t.id}" ${selected}>${orderLabel}${clientLabel}${datesLabel}</option>`;
    }).join('');

    if (trips.length === 0) {
      tripOptionsHtml = `<option value="">(Сначала создайте командировку)</option>`;
    }

    const cardBg = isLinked ? '#F8FAFC' : (isIgnored ? '#F1F5F9' : '#FFFFFF');
    const cardBorder = isLinked ? '#CBD5E1' : (isIgnored ? '#E2E8F0' : '#FDE68A');

    // Форматирование маршрута: откуда — куда
    const routeDisplay = (ride.fromAddress && ride.toAddress)
      ? `<span style="color:#0F172A; font-weight:600;">${ride.fromAddress}</span> <span style="color:#D97706;">→</span> <span style="color:#0F172A; font-weight:600;">${ride.toAddress}</span>`
      : `<span style="color:#0F172A; font-weight:600;">${ride.route || 'Поездка Яндекс Go'}</span>`;

    html += `
      <div class="card" style="margin-bottom:0; background:${cardBg}; border:1px solid ${cardBorder}; border-radius:12px; padding:12px 14px; box-shadow:0 1px 4px rgba(0,0,0,0.04);">
        <!-- Заголовок: Маршрут (откуда - куда) и Сумма -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
          <div style="display:flex; align-items:flex-start; gap:6px; line-height:1.35; flex:1;">
            <span class="material-symbols-outlined" style="color:#D97706; font-size:20px; flex-shrink:0; margin-top:1px;">local_taxi</span>
            <div style="font-size:13.5px;">${routeDisplay}</div>
          </div>
          <span style="font-size:15px; font-weight:700; color:#059669; white-space:nowrap; margin-left:10px;">${ride.amount} ₽</span>
        </div>

        <!-- Подзаголовок: Дата и точное время -->
        <div style="display:flex; align-items:center; gap:12px; font-size:12px; color:#64748B; margin-bottom:8px;">
          <span style="display:flex; align-items:center; gap:4px;">
            <span class="material-symbols-outlined" style="font-size:15px; color:#64748B;">schedule</span>
            <strong>${ride.date} в ${ride.time}</strong>
          </span>
          ${ride.isCorporate ? `
            <span style="background:#EEF2FF; color:#3730A3; font-weight:600; font-size:11px; padding:2px 8px; border-radius:6px;">
              💳 Корпоративный счет (Безнал)
            </span>
          ` : `
            <span style="background:#F1F5F9; color:#475569; font-weight:500; font-size:11px; padding:2px 8px; border-radius:6px;">
              💵 Личные средства
            </span>
          `}
        </div>

        <!-- Блок действий в зависимости от статуса -->
        ${isLinked ? `
          <div style="background:#ECFDF5; border:1px solid #A7F3D0; border-radius:8px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; color:#065F46; font-weight:600;">
              <span class="material-symbols-outlined" style="font-size:16px; color:#10B981;">check_circle</span>
              Включено в отчет: ${linkedTrip ? `№${linkedTrip.appNo || linkedTrip.id} (${linkedTrip.client || ''})` : 'Командировка'}
            </div>
            <button type="button" class="btn btn-sm btn-secondary" style="font-size:11px; padding:3px 8px; color:#DC2626; border-color:#FECACA;" onclick="handleUnlinkTaxiRide('${ride.id}')" title="Убрать из расходов командировки">
              Отвязать
            </button>
          </div>
        ` : (isIgnored ? `
          <div style="display:flex; justify-content:space-between; align-items:center; background:#F1F5F9; border-radius:8px; padding:6px 10px; margin-top:4px;">
            <span style="font-size:12px; color:#64748B;">👁 Личная поездка (скрыта из отчетов)</span>
            <button type="button" class="btn btn-sm btn-secondary" style="font-size:11px; padding:3px 8px;" onclick="handleToggleIgnoreTaxi('${ride.id}', false)">
              Вернуть
            </button>
          </div>
        ` : `
          <!-- Выбор способа оплаты: по умолчанию безнал, если Corporate account -->
          <div style="margin-bottom:8px;">
            <select id="ygoPaymentType_${ride.id}" class="form-control" style="font-size:11.5px; padding:4px 8px; width:100%; border-color:${ride.isCorporate ? '#818CF8' : '#CBD5E1'}; background:${ride.isCorporate ? '#EEF2FF' : '#FFFFFF'}; color:${ride.isCorporate ? '#3730A3' : '#334155'}; font-weight:600;">
              <option value="cashless" ${ride.paymentType === 'cashless' ? 'selected' : ''}>💳 Оплата компанией / Безнал (Корпоративный счет)</option>
              <option value="cash" ${ride.paymentType === 'cash' ? 'selected' : ''}>💵 Личные средства (в расчёт долга вам)</option>
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <div style="flex:1; min-width:170px;">
              <select id="ygoTripSelect_${ride.id}" class="form-control" style="font-size:12px; padding:5px 8px; width:100%; font-weight:500;">
                ${tripOptionsHtml}
              </select>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn btn-sm" id="ygoAddBtn_${ride.id}" style="background:#D97706; font-size:12px; padding:6px 12px; font-weight:600; display:flex; align-items:center; gap:4px;" onclick="handleLinkTaxiRide('${ride.id}')">
                <span class="material-symbols-outlined" style="font-size:16px;">add</span> В отчет
              </button>
              <button type="button" class="btn btn-sm btn-secondary" style="font-size:11px; padding:6px 8px;" onclick="handleToggleIgnoreTaxi('${ride.id}', true)" title="Пометить как личную поездку">
                Личная
              </button>
            </div>
          </div>
        `)}
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

/**
 * Запуск сканирования почты через API и синхронизация в PocketBase
 */
export async function triggerYandexGoScan() {
  const savedEmail = localStorage.getItem('mailru_email') || '';
  const savedPass = localStorage.getItem('mailru_password') || '';

  if (!savedEmail || !savedPass) {
    showToast('Почта не настроена. Укажите email и пароль приложения в Настройках.', 3500);
    return;
  }

  const daysSelect = document.getElementById('ygoScanDaysSelect');
  const days = parseInt(daysSelect?.value || '30', 10);

  const container = document.getElementById('ygoScanContainer');
  if (container) {
    container.innerHTML = `
      <div style="text-align:center; padding:36px 16px; color:#475569;">
        <div style="width:40px; height:40px; border:3px solid #FCD34D; border-top-color:#D97706; border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 14px;"></div>
        <strong style="font-size:15px; color:#1E293B; display:block; margin-bottom:6px;">Сканируем почту ${savedEmail}...</strong>
        <p style="font-size:12.5px; color:#64748B; margin:0;">Поиск писем Яндекс Go и запись новых поездок в базу данных...</p>
      </div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;
  }

  try {
    const res = await fetch(`${PB_URL}/api/mail-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: savedEmail,
        password: savedPass,
        server: 'imap.mail.ru',
        port: 993,
        days: days,
        limit: 50
      })
    });

    const data = await res.json();
    if (!data.success) {
      if (container) {
        container.innerHTML = `
          <div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:12px; padding:18px; margin:10px 0; text-align:center;">
            <span class="material-symbols-outlined" style="font-size:36px; color:#EF4444; margin-bottom:6px;">error</span>
            <strong style="display:block; color:#991B1B; font-size:14px; margin-bottom:6px;">Ошибка сканирования почты</strong>
            <p style="font-size:12.5px; color:#B91C1C; margin:0 0 12px; line-height:1.4;">${data.error || 'Проверьте пароль приложения в настройках'}</p>
            <div style="display:flex; justify-content:center; gap:8px;">
              <button class="btn btn-sm" style="background:#EF4444;" onclick="triggerYandexGoScan()">🔄 Повторить</button>
              <button class="btn btn-sm btn-secondary" onclick="closeYandexGoModal(); window.switchTab('settingsTab');">⚙️ Настройки</button>
            </div>
          </div>
        `;
      }
      return;
    }

    // Сканер сохранил поездки в PocketBase, теперь обновляем локальный Dexie
    await syncWithPocketBase();
    await renderYandexGoRidesFromDb();

    const newCount = data.newCount || 0;
    const totalInDb = data.totalInDb || 0;
    if (newCount > 0) {
      showToast(`🎉 Найдено и записано в базу новых поездок: ${newCount}!`, 3500);
    } else {
      showToast(`✅ База актуальна (всего: ${totalInDb} поездок)`, 3000);
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:12px; padding:18px; margin:10px 0; text-align:center;">
          <span class="material-symbols-outlined" style="font-size:36px; color:#EF4444; margin-bottom:6px;">wifi_off</span>
          <strong style="display:block; color:#991B1B; font-size:14px; margin-bottom:6px;">Сетевая ошибка</strong>
          <p style="font-size:12.5px; color:#B91C1C; margin:0 0 12px;">${err.message}</p>
          <button class="btn btn-sm" style="background:#EF4444;" onclick="triggerYandexGoScan()">🔄 Попробовать снова</button>
        </div>
      `;
    }
  }
}

/**
 * Привязка поездки такси к расходам командировки
 */
export async function handleLinkTaxiRide(rideId) {
  const ride = await db.taxi_rides.get(String(rideId));
  if (!ride) return;

  const selectEl = document.getElementById(`ygoTripSelect_${rideId}`);
  const paymentTypeEl = document.getElementById(`ygoPaymentType_${rideId}`);
  const btnEl = document.getElementById(`ygoAddBtn_${rideId}`);

  const tripId = selectEl?.value;
  const paymentType = paymentTypeEl ? paymentTypeEl.value : (ride.paymentType || 'cashless');

  if (!tripId) {
    showToast('Выберите командировку для включения в отчет', 3000);
    return;
  }

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">sync</span> Запись...`;
  }

  try {
    await linkTaxiRideToTrip(ride, tripId, paymentType);
    showToast(`✅ Поездка на ${ride.amount} ₽ успешно добавлена в авансовый отчет!`, 3000);

    // Обновляем список поездок и глобальный дашборд
    await renderYandexGoRidesFromDb();
    if (typeof window.loadData === 'function') {
      window.loadData();
    }
  } catch (err) {
    console.error('Ошибка добавления поездки:', err);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">add</span> В отчет`;
    }
    showToast(`Ошибка сохранения: ${err.message}`, 4000);
  }
}

/**
 * Отвязывание поездки такси от командировки (удаление из расходов)
 */
export async function handleUnlinkTaxiRide(rideId) {
  if (!confirm('Удалить эту поездку из расходов командировки?')) return;

  try {
    await unlinkTaxiRideFromTrip(rideId);
    showToast('Поездка отвязана от расходов командировки', 2500);

    await renderYandexGoRidesFromDb();
    if (typeof window.loadData === 'function') {
      window.loadData();
    }
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, 3500);
  }
}

/**
 * Переключение статуса "Личная поездка (скрыть из отчетов)"
 */
export async function handleToggleIgnoreTaxi(rideId, isIgnored) {
  try {
    await toggleIgnoreTaxiRide(rideId, isIgnored);
    await renderYandexGoRidesFromDb();
    showToast(isIgnored ? 'Поездка скрыта (личная)' : 'Поездка возвращена в список', 2000);
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, 3000);
  }
}

// Экспорт обработчиков в глобальное окно браузера для HTML onclick
if (typeof window !== 'undefined') {
  window.setTaxiFilterTab = setTaxiFilterTab;
  window.handleLinkTaxiRide = handleLinkTaxiRide;
  window.handleUnlinkTaxiRide = handleUnlinkTaxiRide;
  window.handleToggleIgnoreTaxi = handleToggleIgnoreTaxi;
}
