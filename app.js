/**
 * ====================================================================
 * ГЛАВНЫЙ МОДУЛЬ: app.js
 * Назначение: Точка входа веб-приложения (Инициализация, навигация,
 * управление общим состоянием и регистрация глобальных обработчиков)
 * ====================================================================
 */

// 1. База данных и синхронизация
import { db, getTodayRuDate, getAggregatedSummary } from './db.js';
import { syncWithPocketBase, fetchServerTimeOffset } from './pocketbaseSync.js';

// 2. Вспомогательные утилиты интерфейса
import {
  toId,
  showToast,
  scheduleAutoSync,
  updateSyncHeaderIndicator,
  updateNetworkStatus,
  applyDesktopModalStyle,
  saveDesktopModalStyle,
  syncDatePickerToText,
  isPdfFile,
  isDateInPeriod,
  highlightSelectedItem,
  closeEditBottomSheet,
  openPdfAttachment
} from './modules/ui-utils.js';

// 3. Модуль командировок
import {
  activeTripId,
  isAutoTransport,
  toggleAutoFields,
  onClientSelectChange,
  calculateStartOdoFromLiters,
  updateAutoFieldsHint,
  setTripStatus,
  renderStepperHtml,
  renderHeroBalanceWidget,
  setSummaryChipFilter,
  renderFilteredSummaryList,
  handleCreateTrip,
  openCreateTripModal,
  closeCreateTripModal,
  handleCreateTripModal,
  transformCardToEdit,
  restoreCardView,
  handleInlineUpdateTrip,
  toggleCardDetails,
  deleteTrip,
  toggleHomeBalanceDetails,
  goToStatusFilter,
  goToTripCard,
  refreshTripSelects,
  closeActiveChildForm
} from './modules/ui-trips.js';

// 4. Модуль расходов и чеков
import {
  selectedFileBase64,
  selectedFileName,
  compressImage,
  previewFile,
  clearReceiptPhoto,
  handleAddExpense,
  openPhotoModal,
  closePhotoModal,
  openQuickAddModal,
  closeQuickAddModal,
  previewQuickFile,
  handleQuickAddExpense,
  editExpenseItem,
  saveInlineExpense,
  cancelInlineExpenseEdit,
  deleteExpenseItem,
  clearEditPhoto,
  handleEditPhotoChange,
  renderExpensesList,
  deleteGlobalExpenseItem,
  toggleGlobalExpenseExpand
} from './modules/ui-expenses.js';

// 5. Модуль выплат
import {
  handleAddPayment,
  openQuickPaymentModal,
  closeQuickPaymentModal,
  handleQuickAddPayment,
  editPaymentItem,
  saveInlinePayment,
  cancelInlinePaymentEdit,
  deletePaymentItem,
  renderPaymentsList,
  deleteGlobalPaymentItem,
  toggleGlobalPaymentExpand
} from './modules/ui-payments.js';

// 6. Модуль настроек, справочников и 2FA
import {
  loadFuelSettingsIntoInputs,
  saveFuelSettings,
  renderDictionariesManager,
  addDictItem,
  editDictItem,
  saveDictItem,
  cancelEditDictItem,
  deleteDictItem,
  exportDbToFile,
  importDbFromFile,
  saveGithubToken,
  saveGithubGistId,
  syncWithGithub,
  executeCloudSync,
  forceReloadFromCloud,
  check2FAAuthGate,
  update2FAStatusUI,
  hideLockScreen,
  open2FASetupModal,
  close2FASetupModal,
  handleConfirm2FASetup,
  disable2FA,
  handleVerify2FALogin
} from './modules/ui-settings.js';

// 7. Модуль генерации отчетов
import {
  generateSelectedReport,
  downloadExcelReport,
  downloadPDFReport
} from './modules/ui-reports.js';

// 8. Модуль сканирования почты и чеков Яндекс Go
import {
  loadMailruSettings,
  saveMailruSettings,
  toggleMailPasswordVisibility,
  testMailruConnection,
  openYandexGoModal,
  closeYandexGoModal,
  triggerYandexGoScan,
  addYandexGoRideToExpense
} from './modules/ui-mail-scanner.js';

// ====================================================================
// УПРАВЛЕНИЕ SPEED DIAL (КНОПКА БЫСТРЫХ ДЕЙСТВИЙ НА МОБИЛЬНЫХ)
// ====================================================================
let speedDialOpen = false;

export function toggleSpeedDial() {
  speedDialOpen = !speedDialOpen;
  const fab = document.getElementById('mainFabBtn');
  const overlay = document.getElementById('speedDialOverlay');
  const actions = ['sdTrip', 'sdExpense', 'sdPayment'];

  if (fab) fab.classList.toggle('open', speedDialOpen);
  if (overlay) overlay.classList.toggle('visible', speedDialOpen);

  actions.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (speedDialOpen) {
      setTimeout(() => el.classList.add('visible'), i * 50);
    } else {
      el.classList.remove('visible');
    }
  });
}

// ====================================================================
// НАВИГАЦИЯ ПО ВКЛАДКАМ (ТАБАМ)
// ====================================================================
export function switchTab(tabId) {
  sessionStorage.setItem('activeTab', tabId);
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));

  const targetContent = document.getElementById(tabId);
  if (targetContent) targetContent.classList.add('active');

  const targetNavTab = document.querySelector(`.nav-tab[onclick*="${tabId}"]`);
  if (targetNavTab) targetNavTab.classList.add('active');

  const targetMobileNav = document.querySelector(`.mobile-nav-item[onclick*="${tabId}"]`);
  if (targetMobileNav) targetMobileNav.classList.add('active');

  if (tabId === 'tripsTab' || tabId === 'summaryTab' || tabId === 'reportsTab' || tabId === 'settingsTab') {
    loadData();
  } else if (tabId === 'expenseTab' || tabId === 'expensesTab') {
    renderExpensesList();
  } else if (tabId === 'paymentTab' || tabId === 'paymentsTab') {
    renderPaymentsList();
  }
}

// ====================================================================
// ИНИЦИАЛИЗАЦИЯ ЗНАЧЕНИЙ ПО УМОЛЧАНИЮ В ФОРМАХ
// ====================================================================
export function setupDefaults() {
  const todayRu = getTodayRuDate();

  if (document.getElementById('tripStartDate')) document.getElementById('tripStartDate').value = todayRu;
  if (document.getElementById('tripFinishDate')) document.getElementById('tripFinishDate').value = todayRu;
  if (document.getElementById('expenseDate')) document.getElementById('expenseDate').value = todayRu;
  if (document.getElementById('paymentDate')) document.getElementById('paymentDate').value = todayRu;

  loadFuelSettingsIntoInputs();
  applyDesktopModalStyle();
}

// ====================================================================
// ГЛАВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ДАННЫХ И ИНТЕРФЕЙСА
// ====================================================================
export async function loadData() {
  const clients = await db.clients.toArray();
  const dicts = await db.dictionaries.toArray();

  // 1. Автоподстановка клиентов
  const clientsDatalist = document.getElementById('clientsDatalist');
  if (clientsDatalist) {
    clientsDatalist.innerHTML = '';
    clients.forEach(c => {
      clientsDatalist.innerHTML += `<option value="${c.name}">`;
    });
  }

  // 2. Селекты видов работ
  const workTypeSelect = document.getElementById('tripWorkType');
  const modalWorkTypeSelect = document.getElementById('modalTripWorkType');
  const workList = dicts.filter(d => d.category === 'workType').map(d => d.value);
  if (workTypeSelect) {
    workTypeSelect.innerHTML = '';
    workList.forEach(w => workTypeSelect.innerHTML += `<option value="${w}">${w}</option>`);
  }
  if (modalWorkTypeSelect) {
    modalWorkTypeSelect.innerHTML = '';
    workList.forEach(w => modalWorkTypeSelect.innerHTML += `<option value="${w}">${w}</option>`);
  }

  // 3. Селекты транспорта
  const transportSelect = document.getElementById('tripTransport');
  const modalTransportSelect = document.getElementById('modalTripTransport');
  const transportList = dicts.filter(d => d.category === 'transport').map(d => d.value);
  if (transportSelect) {
    transportSelect.innerHTML = '';
    transportList.forEach(t => transportSelect.innerHTML += `<option value="${t}">${t}</option>`);
    toggleAutoFields('tripTransport', 'autoFields');
  }
  if (modalTransportSelect) {
    modalTransportSelect.innerHTML = '';
    transportList.forEach(t => modalTransportSelect.innerHTML += `<option value="${t}">${t}</option>`);
    toggleAutoFields('modalTripTransport', 'modalAutoFields');
  }

  // 4. Фильтр статусов
  const filterSelect = document.getElementById('summaryStatusFilter');
  if (filterSelect && filterSelect.tagName === 'SELECT') {
    filterSelect.innerHTML = `
      <option value="onlyOpen">⏳ Скрывать только (Расчет закрыт + Статус Отправлен)</option>
      <option value="all">🌐 Показать абсолютно все расчеты</option>
    `;
    const statusList = dicts.filter(d => d.category === 'status').map(d => d.value);
    statusList.forEach(st => {
      filterSelect.innerHTML += `<option value="status:${st}">Статус: ${st}</option>`;
    });
  }

  // 5. Рендеринг компонентов
  const aggregated = await getAggregatedSummary();
  renderHeroBalanceWidget(aggregated);
  renderFilteredSummaryList(aggregated);
  renderDictionariesManager(dicts);
  await refreshTripSelects();
  await renderExpensesList();
  await renderPaymentsList();
}

// Делаем loadData доступным глобально для модулей
window.loadData = loadData;

// ====================================================================
// РЕГИСТРАЦИЯ SERVICE WORKER (PWA ОФЛАЙН КЭШИРОВАНИЕ)
// ====================================================================
export function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.hostname.startsWith('192.168.') || 
                  window.location.hostname.startsWith('10.') || 
                  window.location.port !== '';

    if (isDev) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let r of registrations) r.unregister();
      });
      if ('caches' in window) {
        caches.keys().then(names => {
          for (let name of names) caches.delete(name);
        });
      }
      return;
    }

    const swPath = window.location.pathname.endsWith('/') 
      ? window.location.pathname + 'sw.js' 
      : window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) + 'sw.js';

    navigator.serviceWorker.register(swPath)
      .then(() => {})
      .catch((err) => { console.warn('SW предупреждение:', err); });
  }
}

// ====================================================================
// ЭКСПОРТ ВСЕХ ОБРАБОТЧИКОВ В WINDOW ДЛЯ ШАБЛОНОВ HTML
// ====================================================================
export function exportHandlersToWindow() {
  // Навигация и общие элементы
  window.switchTab = switchTab;
  window.toggleSpeedDial = toggleSpeedDial;
  window.syncDatePickerToText = syncDatePickerToText;
  window.saveDesktopModalStyle = saveDesktopModalStyle;
  window.closeEditBottomSheet = closeEditBottomSheet;
  window.openPhotoModal = openPhotoModal;
  window.closePhotoModal = closePhotoModal;
  window.openPdfAttachment = openPdfAttachment;

  // Командировки
  window.toggleAutoFields = toggleAutoFields;
  window.onClientSelectChange = onClientSelectChange;
  window.calculateStartOdoFromLiters = calculateStartOdoFromLiters;
  window.updateAutoFieldsHint = updateAutoFieldsHint;
  window.handleCreateTrip = handleCreateTrip;
  window.openCreateTripModal = openCreateTripModal;
  window.closeCreateTripModal = closeCreateTripModal;
  window.handleCreateTripModal = handleCreateTripModal;
  window.setTripStatus = setTripStatus;
  window.renderFilteredSummaryList = renderFilteredSummaryList;
  window.setSummaryChipFilter = setSummaryChipFilter;
  window.toggleHomeBalanceDetails = toggleHomeBalanceDetails;
  window.goToStatusFilter = goToStatusFilter;
  window.goToTripCard = goToTripCard;
  window.transformCardToEdit = transformCardToEdit;
  window.restoreCardView = restoreCardView;
  window.handleInlineUpdateTrip = handleInlineUpdateTrip;
  window.toggleCardDetails = toggleCardDetails;
  window.deleteTrip = deleteTrip;
  window.refreshTripSelects = refreshTripSelects;

  // Расходы и чеки
  window.previewFile = previewFile;
  window.clearReceiptPhoto = clearReceiptPhoto;
  window.handleAddExpense = handleAddExpense;
  window.openQuickAddModal = openQuickAddModal;
  window.closeQuickAddModal = closeQuickAddModal;
  window.previewQuickFile = previewQuickFile;
  window.handleQuickAddExpense = handleQuickAddExpense;
  window.editExpenseItem = editExpenseItem;
  window.saveInlineExpense = saveInlineExpense;
  window.cancelInlineExpenseEdit = cancelInlineExpenseEdit;
  window.deleteExpenseItem = deleteExpenseItem;
  window.clearEditPhoto = clearEditPhoto;
  window.handleEditPhotoChange = handleEditPhotoChange;
  window.renderExpensesList = renderExpensesList;
  window.deleteGlobalExpenseItem = deleteGlobalExpenseItem;
  window.toggleGlobalExpenseExpand = toggleGlobalExpenseExpand;

  // Выплаты
  window.handleAddPayment = handleAddPayment;
  window.openQuickPaymentModal = openQuickPaymentModal;
  window.closeQuickPaymentModal = closeQuickPaymentModal;
  window.handleQuickAddPayment = handleQuickAddPayment;
  window.editPaymentItem = editPaymentItem;
  window.saveInlinePayment = saveInlinePayment;
  window.cancelInlinePaymentEdit = cancelInlinePaymentEdit;
  window.deletePaymentItem = deletePaymentItem;
  window.renderPaymentsList = renderPaymentsList;
  window.deleteGlobalPaymentItem = deleteGlobalPaymentItem;
  window.toggleGlobalPaymentExpand = toggleGlobalPaymentExpand;

  // Настройки, справочники и 2FA
  window.saveFuelSettings = saveFuelSettings;
  window.addDictItem = addDictItem;
  window.editDictItem = editDictItem;
  window.saveDictItem = saveDictItem;
  window.cancelEditDictItem = cancelEditDictItem;
  window.deleteDictItem = deleteDictItem;
  window.exportDbToFile = exportDbToFile;
  window.importDbFromFile = importDbFromFile;
  window.saveGithubToken = saveGithubToken;
  window.saveGithubGistId = saveGithubGistId;
  window.syncWithGithub = syncWithGithub;
  window.executeCloudSync = executeCloudSync;
  window.forceReloadFromCloud = forceReloadFromCloud;
  window.check2FAAuthGate = check2FAAuthGate;
  window.update2FAStatusUI = update2FAStatusUI;
  window.hideLockScreen = hideLockScreen;
  window.open2FASetupModal = open2FASetupModal;
  window.close2FASetupModal = close2FASetupModal;
  window.handleConfirm2FASetup = handleConfirm2FASetup;
  window.disable2FA = disable2FA;
  window.handleVerify2FALogin = handleVerify2FALogin;

  // Отчеты
  window.generateSelectedReport = generateSelectedReport;
  window.downloadExcelReport = downloadExcelReport;
  window.downloadPDFReport = downloadPDFReport;

  // Сканирование почты и поездки Яндекс Go
  window.loadMailruSettings = loadMailruSettings;
  window.saveMailruSettings = saveMailruSettings;
  window.toggleMailPasswordVisibility = toggleMailPasswordVisibility;
  window.testMailruConnection = testMailruConnection;
  window.openYandexGoModal = openYandexGoModal;
  window.closeYandexGoModal = closeYandexGoModal;
  window.triggerYandexGoScan = triggerYandexGoScan;
  window.addYandexGoRideToExpense = addYandexGoRideToExpense;
}

// Экспортируем обработчики сразу при парсинге скрипта
try {
  exportHandlersToWindow();
} catch (_) {}

// ====================================================================
// СЛУШАТЕЛИ СЕТИ И ГОРЯЧИХ КЛАВИШ
// ====================================================================
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePhotoModal();
    closeQuickAddModal();
    closeQuickPaymentModal();
    closeCreateTripModal();
    closeEditBottomSheet();
    closeYandexGoModal();
    if (speedDialOpen) toggleSpeedDial();
  }
});

// ====================================================================
// ТОЧКА ВХОДА (DOM CONTENT LOADED)
// ====================================================================
document.addEventListener('DOMContentLoaded', async () => {
  exportHandlersToWindow();

  try {
    setupDefaults();
  } catch (err) {
    console.error("setupDefaults ошибка:", err);
  }

  // 1. Фоновая синхронизация с сервером PocketBase
  if (navigator.onLine) {
    try {
      updateSyncHeaderIndicator('syncing');
      const res = await syncWithPocketBase();
      updateSyncHeaderIndicator('synced', (res?.count?.trips || 0));
    } catch (err) {
      console.warn("Синхронизация при старте:", err);
      updateSyncHeaderIndicator('idle');
    }
  }

  // 2. Первоначальная загрузка интерфейса
  try {
    await loadData();
  } catch (err) {
    console.error("loadData ошибка:", err);
  }

  // 3. Безопасность и PWA
  try {
    check2FAAuthGate();
    update2FAStatusUI();
    loadMailruSettings();
    updateNetworkStatus();
    setupServiceWorker();
  } catch (err) {
    console.warn("Инициализация безопасности/PWA:", err);
  }
});
