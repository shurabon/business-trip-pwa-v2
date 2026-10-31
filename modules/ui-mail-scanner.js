/**
 * ====================================================================
 * МОДУЛЬ: ui-mail-scanner.js
 * Назначение: Интеграция с почтой Mail.ru и импорт поездок Яндекс Go
 * - Настройки учетной записи почты и проверка подключения к IMAP
 * - Сканирование писем о поездках Яндекс Go (маршрут, дата, точное время, сумма)
 * - Умное сопоставление с командировками по датам
 * - Добавление поездки в расходы в 1 клик
 * ====================================================================
 */

import { db, parseRuDate, formatDateToRu } from '../db.js';
import { createPbExpense, PB_URL } from '../pocketbaseSync.js';
import { showToast, scheduleAutoSync } from './ui-utils.js';

// Кеш найденных поездок текущей сессии
let scannedRidesCache = [];

/**
 * Инициализация и загрузка сохраненных настроек почты в интерфейс
 */
export function loadMailruSettings() {
  const emailInput = document.getElementById('mailruEmailInput');
  const passInput = document.getElementById('mailruPasswordInput');
  const statusBadge = document.getElementById('mailruStatusBadge');

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
  const savedPass = localStorage.getItem('mailru_password') || '';

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
 * Открытие модального окна импорта поездок Яндекс Go
 */
export function openYandexGoModal() {
  const savedEmail = localStorage.getItem('mailru_email') || '';
  const savedPass = localStorage.getItem('mailru_password') || '';

  if (!savedEmail || !savedPass) {
    showToast('Сначала укажите email и пароль приложения Mail.ru в Настройках', 3500);
    if (typeof window.switchTab === 'function') {
      window.switchTab('settingsTab');
    }
    return;
  }

  const modal = document.getElementById('yandexGoModal');
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }

  const hintEl = document.getElementById('ygoCurrentEmailHint');
  if (hintEl) hintEl.textContent = savedEmail;

  // Если еще не сканировали или список пуст — запускаем автосканирование
  if (scannedRidesCache.length === 0) {
    triggerYandexGoScan();
  } else {
    renderYandexGoRidesList(scannedRidesCache);
  }
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
 * Запуск сканирования почты через API
 */
export async function triggerYandexGoScan() {
  const savedEmail = localStorage.getItem('mailru_email') || '';
  const savedPass = localStorage.getItem('mailru_password') || '';

  if (!savedEmail || !savedPass) {
    showToast('Почта не настроена. Укажите логин и пароль в Настройках.', 3000);
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
        <p style="font-size:12.5px; color:#64748B; margin:0;">Поиск писем Яндекс Go за последние ${days} дней</p>
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

    scannedRidesCache = data.items || [];
    const folders = data.foldersScanned || ['INBOX'];
    await renderYandexGoRidesList(scannedRidesCache, folders);

    if (scannedRidesCache.length > 0) {
      showToast(`Найдено поездок: ${scannedRidesCache.length} (папки: ${folders.join(', ')})`, 3500);
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
 * Отрисовка карточек найденных поездок с выпадающим списком командировок
 */
export async function renderYandexGoRidesList(rides, foldersScanned = []) {
  const container = document.getElementById('ygoScanContainer');
  if (!container) return;

  const folderNamesStr = foldersScanned.length > 0 ? foldersScanned.join(', ') : 'Входящие, Чеки';

  if (!rides || rides.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px 16px; color:#64748B;">
        <span class="material-symbols-outlined" style="font-size:44px; color:#CBD5E1; margin-bottom:8px;">receipt_long</span>
        <strong style="font-size:15px; color:#334155; display:block; margin-bottom:6px;">Поездок не обнаружено</strong>
        <p style="font-size:12.5px; margin:0 0 6px;">За выбранный период писем от Яндекс Go не найдено.</p>
        <small style="display:block; color:#94A3B8; margin-bottom:14px; font-size:11.5px;">Проверены папки: <strong>${folderNamesStr}</strong></small>
        <button class="btn btn-sm btn-secondary" onclick="triggerYandexGoScan()">🔄 Повторить сканирование</button>
      </div>
    `;
    return;
  }

  // Загружаем командировки и существующие расходы из базы
  const allTrips = await db.trips.toArray();
  const trips = allTrips.filter(t => !t.isDeleted && !t.deleted);
  const existingExpenses = await db.expenses.toArray();

  let html = `
    <div style="font-size:11.5px; color:#64748B; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; padding:0 4px;">
      <span>Найдено поездок: <strong>${rides.length}</strong></span>
      <span>Папки: <strong>${folderNamesStr}</strong></span>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:2px;">
  `;

  rides.forEach((ride, idx) => {
    // Проверяем, добавлен ли уже этот расход в базу
    const isAlreadyAdded = existingExpenses.some(exp => {
      if (exp.isDeleted || exp.deleted) return false;
      const sameDate = String(exp.date).trim() === String(ride.date).trim();
      const sameAmount = Math.abs((parseFloat(exp.amount) || 0) - (parseFloat(ride.amount) || 0)) < 0.05;
      const descMatch = (exp.description || '').includes(ride.time) || (exp.description || '').includes(ride.from || 'Яндекс');
      return sameDate && sameAmount && descMatch;
    });

    // Умный поиск подходящей командировки по дате
    let matchedTripId = '';
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

    // Если нет точного совпадения по дате, выбираем первую открытую
    if (!matchedTripId && trips.length > 0) {
      matchedTripId = trips[0].id;
    }

    // Формируем <select> с поездками
    let tripOptionsHtml = trips.map(t => {
      const selected = String(t.id) === String(matchedTripId) ? 'selected' : '';
      const orderLabel = t.appNo ? `[${t.appNo}] ` : '';
      const clientLabel = t.client ? `${t.client} ` : '';
      const datesLabel = `(${t.startDate || ''} - ${t.finishDate || ''})`;
      return `<option value="${t.id}" ${selected}>${orderLabel}${clientLabel}${datesLabel}</option>`;
    }).join('');

    if (trips.length === 0) {
      tripOptionsHtml = `<option value="">(Сначала создайте поездку)</option>`;
    }

    const cardBg = isAlreadyAdded ? '#F8FAFC' : '#FFFFFF';
    const cardBorder = isAlreadyAdded ? '#E2E8F0' : '#FDE68A';

    html += `
      <div class="card" style="margin-bottom:0; background:${cardBg}; border:1px solid ${cardBorder}; border-radius:12px; padding:12px 14px; box-shadow:0 1px 4px rgba(0,0,0,0.04);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="material-symbols-outlined" style="color:#D97706; font-size:20px;">local_taxi</span>
            <strong style="font-size:14px; color:#1E293B;">${ride.route}</strong>
          </div>
          <span style="font-size:15px; font-weight:700; color:#059669; white-space:nowrap; margin-left:8px;">${ride.amount} ₽</span>
        </div>

        <div style="display:flex; align-items:center; gap:12px; font-size:12px; color:#64748B; margin-bottom:10px;">
          <span style="display:flex; align-items:center; gap:4px;">
            <span class="material-symbols-outlined" style="font-size:15px; color:#64748B;">schedule</span>
            <strong>${ride.date} в ${ride.time}</strong>
          </span>
          ${matchedTripId && !isAlreadyAdded ? '<span style="color:#2563EB; font-weight:600;">✓ Командировка подобрана по дате</span>' : ''}
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <div style="flex:1; min-width:180px;">
            <select id="ygoTripSelect_${idx}" class="form-control" style="font-size:12px; padding:5px 8px; width:100%; font-weight:500;" ${isAlreadyAdded ? 'disabled' : ''}>
              ${tripOptionsHtml}
            </select>
          </div>
          <div>
            ${isAlreadyAdded ? `
              <span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600; color:#059669; background:#ECFDF5; padding:6px 12px; border-radius:8px;">
                <span class="material-symbols-outlined" style="font-size:16px;">check</span> Добавлено
              </span>
            ` : `
              <button type="button" class="btn btn-sm" id="ygoAddBtn_${idx}" style="background:#D97706; font-size:12px; padding:6px 14px; font-weight:600; display:flex; align-items:center; gap:4px;" onclick="addYandexGoRideToExpense(${idx})">
                <span class="material-symbols-outlined" style="font-size:16px;">add</span> Добавить
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

/**
 * Добавление выбранной поездки в расходы командировки
 */
export async function addYandexGoRideToExpense(idx) {
  const ride = scannedRidesCache[idx];
  if (!ride) return;

  const selectEl = document.getElementById(`ygoTripSelect_${idx}`);
  const btnEl = document.getElementById(`ygoAddBtn_${idx}`);
  const tripId = selectEl?.value;

  if (!tripId) {
    showToast('Выберите командировку для привязки расхода', 3000);
    return;
  }

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">sync</span> Добавление...`;
  }

  const expenseData = {
    tripId: String(tripId),
    date: ride.date,
    amount: parseFloat(ride.amount) || 0,
    description: `Такси Яндекс Go: ${ride.route} (${ride.time})`,
    category: 'Транспорт',
    paymentType: 'cash', // личные средства
    articleCode: 'ТАХI'
  };

  try {
    // 1. Создаем на сервере PocketBase и локально в Dexie
    await createPbExpense(expenseData);

    // 2. Обновляем кнопку в интерфейсе
    if (btnEl) {
      btnEl.style.background = '#ECFDF5';
      btnEl.style.color = '#059669';
      btnEl.style.border = '1px solid #A7F3D0';
      btnEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">check</span> Добавлено`;
    }
    if (selectEl) {
      selectEl.disabled = true;
    }

    showToast(`✅ Поездка на ${ride.amount} ₽ добавлена в расходы!`, 3000);

    // 3. Обновляем глобальный дашборд и список расходов
    if (typeof window.loadData === 'function') {
      window.loadData();
    }
  } catch (err) {
    console.error('Ошибка добавления поездки:', err);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">add</span> Добавить`;
    }
    showToast(`Ошибка сохранения: ${err.message}`, 4000);
  }
}
