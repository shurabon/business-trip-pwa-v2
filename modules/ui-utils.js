/**
 * ====================================================================
 * МОДУЛЬ: ui-utils.js
 * Назначение: Общие вспомогательные функции интерфейса (уведомления,
 * форматирование, индикация сети, стили модальных окон, хелперы дат)
 * ====================================================================
 */

import { syncWithPocketBase } from '../pocketbaseSync.js';

let autoSyncTimer = null;
let isSyncInProgress = false;
export let activePdfBlobUrl = null;
export let currentHighlightedElementId = null;

/**
 * Преобразование ID в строковый формат (для работы с PocketBase строковыми UUID)
 * @param {string|number} id
 * @returns {string}
 */
export const toId = id => String(id);

/**
 * Всплывающее уведомление (Toast)
 * @param {string} msg - Текст сообщения
 * @param {number} [duration] - Длительность показа в миллисекундах
 */
export function showToast(msg, duration) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.style.display = 'block';

  const timeoutMs = duration || (msg.includes('⚠️') || msg.includes('❌') ? 12000 : 4000);

  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    t.style.display = 'none';
  }, timeoutMs);
}

/**
 * Запланировать автоматическую фоновую синхронизацию с сервером PocketBase
 * @param {number} [delayMs=2500] - Задержка перед отправкой запроса (дебаунс)
 */
export function scheduleAutoSync(delayMs = 2500) {
  if (!navigator.onLine) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(async () => {
    if (isSyncInProgress) return;
    try {
      isSyncInProgress = true;
      updateSyncHeaderIndicator('syncing');
      const res = await syncWithPocketBase();
      updateSyncHeaderIndicator('synced', (res?.count?.trips || 0));
    } catch (err) {
      console.warn("Фоновая синхронизация PocketBase:", err);
      updateSyncHeaderIndicator('idle');
    } finally {
      isSyncInProgress = false;
    }
  }, delayMs);
}

/**
 * Обновление индикатора синхронизации в шапке приложения
 * @param {'syncing'|'synced'|'offline'|'idle'} state
 * @param {number} [count] - Количество синхронизированных поездок
 */
export function updateSyncHeaderIndicator(state, count) {
  const badge = document.getElementById('networkStatusBadge');
  if (!badge) return;

  if (state === 'syncing') {
    badge.innerHTML = '<span class="material-symbols-outlined spin" style="font-size:16px;">sync</span> Синхронизация...';
    badge.style.color = 'var(--md-sys-color-primary)';
  } else if (state === 'synced') {
    badge.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px; color:#2E7D32;">cloud_done</span> Онлайн';
    badge.style.color = '#2E7D32';
  } else if (state === 'offline') {
    badge.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px; color:#E53935;">cloud_off</span> Офлайн';
    badge.style.color = '#E53935';
  } else {
    badge.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">cloud</span> Готов';
    badge.style.color = '#64748B';
  }
}

/**
 * Обработка изменения статуса сети (online / offline)
 */
export function updateNetworkStatus() {
  if (navigator.onLine) {
    updateSyncHeaderIndicator('synced');
  } else {
    updateSyncHeaderIndicator('offline');
  }
}

/**
 * Определение стиля модального окна для ПК (по центру или правая шторка)
 */
export function getDesktopModalStyle() {
  return localStorage.getItem('desktopModalStyle') || 'centered';
}

export function saveDesktopModalStyle(val) {
  localStorage.setItem('desktopModalStyle', val || 'centered');
  applyDesktopModalStyle();
  showToast("✅ Стиль модального окна сохранен!");
}

export function applyDesktopModalStyle() {
  const modal = document.getElementById('editBottomSheetModal');
  if (!modal) return;
  const styleVal = getDesktopModalStyle();
  modal.classList.remove('desktop-modal-centered', 'desktop-modal-right-drawer');
  if (styleVal === 'rightDrawer') {
    modal.classList.add('desktop-modal-right-drawer');
  } else {
    modal.classList.add('desktop-modal-centered');
  }
}

/**
 * Синхронизация нативного datepicker с текстовым полем ввода даты ДД.ММ.ГГГГ
 * @param {string} textInputId - ID текстового инпута
 * @param {string} datePickerVal - Значение datepicker ГГГГ-ММ-ДД
 */
export function syncDatePickerToText(textInputId, datePickerVal) {
  if (!datePickerVal) return;
  const [y, m, d] = datePickerVal.split('-');
  const textInput = document.getElementById(textInputId);
  if (textInput) {
    textInput.value = `${d}.${m}.${y}`;
  }
}

/**
 * Проверка, является ли прикреплённый к расходу файл PDF-документом
 * @param {object} expense
 * @returns {boolean}
 */
export function isPdfFile(expense) {
  if (!expense) return false;
  const name = String(expense.receiptName || '').toLowerCase();
  const url = String(expense.receiptUrl || '').toLowerCase();
  const base64 = String(expense.receiptBase64 || '');

  if (base64.startsWith('JVBERi0')) return true; // Сигнатура %PDF- в base64
  if (base64.startsWith('data:application/pdf')) return true;
  if (name.endsWith('.pdf') || url.endsWith('.pdf')) return true;
  return false;
}

/**
 * Проверка вхождения даты ДД.ММ.ГГГГ в выбранный период фильтрации
 * @param {string} dateStr
 * @param {'all'|'currentMonth'|'prevMonth'} period
 * @returns {boolean}
 */
export function isDateInPeriod(dateStr, period) {
  if (!period || period === 'all') return true;
  if (!dateStr) return false;

  let d = null;
  if (dateStr.includes('.')) {
    const parts = dateStr.split('.');
    d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  } else {
    d = new Date(dateStr);
  }
  if (!d || isNaN(d.getTime())) return true;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  if (period === 'currentMonth') {
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  } else if (period === 'prevMonth') {
    const prevDate = new Date(currentYear, currentMonth - 1, 1);
    return d.getFullYear() === prevDate.getFullYear() && d.getMonth() === prevDate.getMonth();
  }
  return true;
}

/**
 * Подсветка выбранной строки/карточки в интерфейсе
 * @param {string|null} targetId
 */
export function highlightSelectedItem(targetId) {
  if (currentHighlightedElementId) {
    const prev = document.getElementById(currentHighlightedElementId);
    if (prev) prev.classList.remove('selected-item-inverted');
  }

  currentHighlightedElementId = targetId || null;
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) el.classList.add('selected-item-inverted');
  }
}

/**
 * Закрытие нижней шторки / модального окна редактирования
 * @param {string} [highlightTargetId]
 */
export function closeEditBottomSheet(highlightTargetId) {
  const modal = document.getElementById('editBottomSheetModal');
  const card = document.getElementById('editBottomSheetCard');
  if (modal) modal.style.display = 'none';
  if (card) card.innerHTML = '';
  document.body.style.overflow = '';

  const target = highlightTargetId || currentHighlightedElementId;
  if (target) {
    setTimeout(() => {
      const el = document.getElementById(target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }
}

/**
 * Открытие PDF-вложения в отдельной вкладке браузера
 * @param {string} url
 * @param {string} name
 */
export function openPdfAttachment(url, name) {
  if (!url) return;
  if (activePdfBlobUrl) {
    URL.revokeObjectURL(activePdfBlobUrl);
    activePdfBlobUrl = null;
  }
  window.open(url, '_blank');
}
