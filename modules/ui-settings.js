/**
 * ====================================================================
 * МОДУЛЬ: ui-settings.js
 * Назначение: Настройки, справочники и безопасность
 * - Управление справочниками (виды работ, транспорт, статусы)
 * - Настройка норм расхода ГСМ и ставок амортизации
 * - Двухфакторная аутентификация TOTP (Яндекс Ключ / Google Authenticator)
 * - Экспорт и импорт локального бэкапа базы данных (JSON)
 * ====================================================================
 */

import { db, getFuelSettings } from '../db.js';
import { updatePbSettings, PB_URL, getServerTimeOffsetMs, fetchServerTimeOffset } from '../pocketbaseSync.js';
import { showToast, scheduleAutoSync, toId } from './ui-utils.js';
import { generateSecret, verifySync, generateURI } from 'otplib';
import QRCode from 'qrcode';

export const TWO_FACTOR_KEY = 'btrip_2fa_secret';
export const TWO_FACTOR_SESSION_KEY = 'btrip_2fa_session';
export const TWO_FACTOR_ACTIVE_SESSION_KEY = 'btrip_2fa_active_tab';
export let pending2FASecret = null;
export let inactivityTimer = null;

export function is2FAEnabled() {
  const secret = localStorage.getItem(TWO_FACTOR_KEY);
  return !!(secret && secret.trim().length >= 16);
}

export function is2FAAuthorized() {
  if (!is2FAEnabled()) return true;
  const activeTabSession = sessionStorage.getItem(TWO_FACTOR_ACTIVE_SESSION_KEY);
  if (activeTabSession === 'true') return true;

  const sessionExpiresAt = localStorage.getItem(TWO_FACTOR_SESSION_KEY);
  if (sessionExpiresAt) {
    const expires = parseInt(sessionExpiresAt, 10);
    if (!isNaN(expires) && Date.now() < expires) {
      sessionStorage.setItem(TWO_FACTOR_ACTIVE_SESSION_KEY, 'true');
      return true;
    }
  }
  return false;
}

export function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (!is2FAEnabled()) return;
  inactivityTimer = setTimeout(() => {
    sessionStorage.removeItem(TWO_FACTOR_ACTIVE_SESSION_KEY);
    showLockScreen();
  }, 15 * 60 * 1000); // 15 минут неактивности
}

export function check2FAAuthGate() {
  if (!is2FAAuthorized()) {
    showLockScreen();
  } else {
    hideLockScreen();
    resetInactivityTimer();
  }
}

export function showLockScreen() {
  const overlay = document.getElementById('lockScreenOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    const input = document.getElementById('totpLoginInput');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 150);
    }
  }
  if (navigator.onLine) {
    fetchServerTimeOffset().catch(() => {});
  }
}

export function hideLockScreen() {
  const overlay = document.getElementById('lockScreenOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
  resetInactivityTimer();
}

/**
 * Проверка введенного 6-значного TOTP-кода при входе
 */
export async function handleVerify2FALogin(event) {
  event.preventDefault();
  const input = document.getElementById('totpLoginInput');
  const rememberMe = document.getElementById('totpRememberMe')?.checked;
  const token = (input?.value || '').trim();
  const secret = (localStorage.getItem(TWO_FACTOR_KEY) || '').trim();

  if (!token || token.length !== 6) {
    showToast("⚠️ Введите 6-значный код из Яндекс Ключа!");
    return;
  }

  if (!secret) {
    showToast("⚠️ Секретный ключ 2FA не найден. Синхронизируйте базу.");
    hideLockScreen();
    return;
  }

  if (navigator.onLine) {
    try {
      await fetchServerTimeOffset();
    } catch (_) {}
  }

  const offsetMs = getServerTimeOffsetMs();
  const serverEpoch = Math.floor((Date.now() + offsetMs) / 1000);

  let result = verifySync({ token, secret, epoch: serverEpoch, epochTolerance: 240 });
  if (!result?.valid && offsetMs !== 0) {
    result = verifySync({ token, secret, epochTolerance: 240 });
  }

  if (result && result.valid) {
    sessionStorage.setItem(TWO_FACTOR_ACTIVE_SESSION_KEY, 'true');
    if (rememberMe) {
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      localStorage.setItem(TWO_FACTOR_SESSION_KEY, String(expiresAt));
    } else {
      localStorage.removeItem(TWO_FACTOR_SESSION_KEY);
    }
    hideLockScreen();
    showToast("🔓 Авторизация успешна! Добро пожаловать!");
  } else {
    showToast("❌ Неверный или устаревший код! Проверьте время на телефоне.");
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

export function update2FAStatusUI() {
  const badge = document.getElementById('twoFactorStatusBadge');
  const btnSetup = document.getElementById('btnSetup2FA');
  const btnDisable = document.getElementById('btnDisable2FA');

  if (!badge) return;

  if (is2FAEnabled()) {
    badge.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px; color:#15803D;">verified_user</span> <span style="color:#15803D;">2FA активирована (Яндекс Ключ)</span>';
    badge.style.background = '#DCFCE7';
    if (btnSetup) btnSetup.style.display = 'none';
    if (btnDisable) btnDisable.style.display = 'inline-flex';
  } else {
    badge.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">lock_open</span> 2FA отключена';
    badge.style.background = '#E0E7FF';
    badge.style.color = '#3730A3';
    if (btnSetup) btnSetup.style.display = 'inline-flex';
    if (btnDisable) btnDisable.style.display = 'none';
  }
}

/**
 * Открытие модального окна настройки 2FA (генерация QR-кода)
 */
export async function open2FASetupModal() {
  const modal = document.getElementById('setup2FAModal');
  if (!modal) return;

  pending2FASecret = generateSecret();
  const otpUri = generateURI({
    secret: pending2FASecret,
    label: 'Командировки',
    issuer: 'Учет Командировок'
  });

  const secretTextEl = document.getElementById('twoFactorSecretText');
  if (secretTextEl) secretTextEl.innerText = pending2FASecret;

  const canvas = document.getElementById('twoFactorQrCanvas');
  if (canvas) {
    try {
      await QRCode.toCanvas(canvas, otpUri, {
        width: 200,
        margin: 1,
        color: {
          dark: '#1E293B',
          light: '#FFFFFF'
        }
      });
    } catch (err) {
      console.error('Ошибка создания QR-кода:', err);
    }
  }

  const verifyInput = document.getElementById('totpSetupVerifyInput');
  if (verifyInput) verifyInput.value = '';

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function close2FASetupModal() {
  const modal = document.getElementById('setup2FAModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  pending2FASecret = null;
}

export async function handleConfirm2FASetup(event) {
  event.preventDefault();
  const input = document.getElementById('totpSetupVerifyInput');
  const token = (input?.value || '').trim();

  if (!token || token.length !== 6 || !pending2FASecret) {
    showToast("⚠️ Введите 6-значный код из Яндекс Ключа!");
    return;
  }

  if (navigator.onLine) {
    try {
      await fetchServerTimeOffset();
    } catch (_) {}
  }

  const offsetMs = getServerTimeOffsetMs();
  const serverEpoch = Math.floor((Date.now() + offsetMs) / 1000);

  let result = verifySync({ token, secret: pending2FASecret, epoch: serverEpoch, epochTolerance: 240 });
  if (!result?.valid && offsetMs !== 0) {
    result = verifySync({ token, secret: pending2FASecret, epochTolerance: 240 });
  }

  if (result && result.valid) {
    localStorage.setItem(TWO_FACTOR_KEY, pending2FASecret);
    sessionStorage.setItem(TWO_FACTOR_ACTIVE_SESSION_KEY, 'true');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    localStorage.setItem(TWO_FACTOR_SESSION_KEY, String(expiresAt));
    close2FASetupModal();
    update2FAStatusUI();
    showToast("✅ 2FA успешно привязана к Яндекс Ключу!");
    scheduleAutoSync(100);
  } else {
    showToast("❌ Неверный проверочный код! Проверьте время на телефоне и попробуйте снова.");
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

export async function disable2FA() {
  if (!confirm("Вы уверены, что хотите отключить 2FA авторизацию?")) return;
  localStorage.removeItem(TWO_FACTOR_KEY);
  localStorage.removeItem(TWO_FACTOR_SESSION_KEY);
  sessionStorage.removeItem(TWO_FACTOR_ACTIVE_SESSION_KEY);
  update2FAStatusUI();
  showToast("🔓 2FA авторизация отключена");
  scheduleAutoSync(100);
}

/**
 * Загрузка сохраненных настроек топлива в поля ввода
 */
export function loadFuelSettingsIntoInputs() {
  const settings = getFuelSettings();
  const elSummer = document.getElementById('fuelSummerRate');
  const elWinter = document.getElementById('fuelWinterRate');
  const elPrice = document.getElementById('fuelPricePerLiter');
  const elDeductible = document.getElementById('depreciationDeductibleKm');
  const elRate = document.getElementById('depreciationRatePerKm');

  if (elSummer) elSummer.value = settings.summerRate;
  if (elWinter) elWinter.value = settings.winterRate;
  if (elPrice) elPrice.value = settings.pricePerLiter;
  if (elDeductible) elDeductible.value = settings.deductibleKm;
  if (elRate) elRate.value = settings.ratePerKm;

  const styleSelect = document.getElementById('desktopModalStyleSelect');
  if (styleSelect) {
    styleSelect.value = localStorage.getItem('desktopModalStyle') || 'centered';
  }
}

/**
 * Сохранение настроек топлива и амортизации
 */
export async function saveFuelSettings(event) {
  if (event) event.preventDefault();
  const summerRate = parseFloat(document.getElementById('fuelSummerRate').value) || 8.7;
  const winterRate = parseFloat(document.getElementById('fuelWinterRate').value) || 8.9;
  const pricePerLiter = parseFloat(document.getElementById('fuelPricePerLiter').value) || 69;
  const deductibleKm = parseFloat(document.getElementById('depreciationDeductibleKm').value) || 70;
  const ratePerKm = parseFloat(document.getElementById('depreciationRatePerKm').value) || 5;

  localStorage.setItem('fuelSummerRate', summerRate);
  localStorage.setItem('fuelWinterRate', winterRate);
  localStorage.setItem('fuelPricePerLiter', pricePerLiter);
  localStorage.setItem('depreciationDeductibleKm', deductibleKm);
  localStorage.setItem('depreciationRatePerKm', ratePerKm);

  await updatePbSettings({
    summerRate,
    winterRate,
    pricePerLiter,
    deductibleKm,
    ratePerKm
  }).catch(console.error);

  showToast("✅ Настройки ГСМ и амортизации сохранены!");
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Управление справочниками (виды работ, транспорт, статусы)
 */
export function renderDictionariesManager(dicts) {
  const renderList = (category, containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const items = dicts.filter(d => d.category === category);
    if (items.length === 0) {
      container.innerHTML = '<p style="font-size:13px; color:#888;">Список пуст</p>';
      return;
    }
    let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
    items.forEach(item => {
      html += `
        <div id="dict-item-container-${item.id}" style="display:flex; justify-content:space-between; align-items:center; background:#F4F7FF; padding:8px 12px; border-radius:10px; font-size:14px;">
          <span id="dict-item-text-${item.id}">${item.value}</span>
          <div id="dict-item-actions-${item.id}" style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-secondary" style="padding:4px 8px;" onclick="editDictItem('${item.id}', '${item.value.replace(/'/g, "\\'")}')">
              <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
            </button>
            <button class="btn btn-sm btn-secondary" style="padding:4px 8px; color:var(--md-sys-color-error);" onclick="deleteDictItem('${item.id}')">
              <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
            </button>
          </div>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  };

  renderList('workType', 'dictWorkTypesList');
  renderList('transport', 'dictTransportList');
  renderList('status', 'dictStatusesList');
}

export function editDictItem(id, currentValue) {
  const textSpan = document.getElementById(`dict-item-text-${id}`);
  const actionsDiv = document.getElementById(`dict-item-actions-${id}`);
  if (!textSpan || !actionsDiv) return;

  textSpan.innerHTML = `
    <input type="text" id="dict-edit-input-${id}" class="form-control" style="padding:4px 8px; font-size:14px;" value="${currentValue}">
  `;

  actionsDiv.innerHTML = `
    <button class="btn btn-sm" style="padding:4px 10px;" onclick="saveDictItem('${id}')">💾</button>
    <button class="btn btn-sm btn-secondary" style="padding:4px 10px;" onclick="cancelEditDictItem()">✕</button>
  `;
}

export async function saveDictItem(id) {
  const input = document.getElementById(`dict-edit-input-${id}`);
  if (!input) return;
  const newVal = input.value.trim();
  if (!newVal) {
    showToast("Значение не может быть пустым");
    return;
  }

  await db.dictionaries.update(id, { value: newVal });
  localStorage.setItem('dictionaries_updated_at', new Date().toISOString());
  showToast("✅ Элемент справочника обновлен!");
  if (window.loadData) await window.loadData();
}

export function cancelEditDictItem() {
  if (window.loadData) window.loadData();
}

export async function addDictItem(category, inputId) {
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (!val) {
    showToast("Введите наименование");
    return;
  }

  await db.dictionaries.add({ category, value: val });
  localStorage.setItem('dictionaries_updated_at', new Date().toISOString());
  input.value = '';
  showToast("✅ Добавлено в справочник!");
  if (window.loadData) await window.loadData();
}

export async function deleteDictItem(id) {
  if (confirm("Вы уверены, что хотите удалить этот элемент из справочника?")) {
    await db.dictionaries.delete(id);
    localStorage.setItem('dictionaries_updated_at', new Date().toISOString());
    showToast("🗑 Удалено из справочника!");
    if (window.loadData) await window.loadData();
  }
}

/**
 * Экспорт базы данных в JSON файл
 */
export async function exportDbToFile() {
  try {
    const clients = await db.clients.toArray();
    const trips = await db.trips.toArray();
    const expenses = await db.expenses.toArray();
    const payments = await db.payments.toArray();
    const dictionaries = await db.dictionaries.toArray();

    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      clients,
      trips,
      expenses,
      payments,
      dictionaries
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `business_trips_backup_${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("💾 Файл базы данных выгружен!");
  } catch (err) {
    showToast("❌ Ошибка выгрузки файла: " + err);
  }
}

/**
 * Импорт базы данных из JSON файла
 */
export async function importDbFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      if (json.trips && Array.isArray(json.trips)) await db.trips.bulkPut(json.trips);
      if (json.expenses && Array.isArray(json.expenses)) await db.expenses.bulkPut(json.expenses);
      if (json.payments && Array.isArray(json.payments)) await db.payments.bulkPut(json.payments);
      if (json.clients && Array.isArray(json.clients)) await db.clients.bulkPut(json.clients);
      showToast("📥 База данных успешно импортирована!");
      if (window.loadData) await window.loadData();
    } catch (err) {
      showToast("❌ Ошибка чтения файла бэкапа: " + err.message);
    }
  };
  reader.readAsText(file);
}

// Заглушки для обратной совместимости кнопок Gist
export function saveGithubToken() { showToast("Синхронизация работает через личный сервер PocketBase"); }
export function saveGithubGistId() { showToast("Синхронизация работает через личный сервер PocketBase"); }
export function syncWithGithub() { showToast("Синхронизация работает через личный сервер PocketBase"); }
export function executeCloudSync() { scheduleAutoSync(100); }
export function forceReloadFromCloud() { scheduleAutoSync(100); }
