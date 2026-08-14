import { db, seedInitialData, getFuelNormByDate, calculateTripDays, getAggregatedSummary, formatDateToRu, getTodayRuDate, parseRuDate, getFuelSettings, calculateCarMetrics, markItemDeleted, cleanupDuplicates } from './db.js';
import { exportToExcel, exportToPDF, exportAO1Excel } from './reports.js';
import { exportLocalDbToJson, mergeRemoteDbToLocal, uploadToGithubGist, downloadAndMergeFromGithubGist } from './githubSync.js';

let selectedFileBase64 = null;
let selectedFileName = null;

document.addEventListener('DOMContentLoaded', async () => {
  await seedInitialData();
  setupDefaults();
  setupServiceWorker();
  await loadData();

  const savedTab = sessionStorage.getItem('activeTab');
  if (savedTab) {
    switchTab(savedTab);
  }
});

function getTodayIsoDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function syncDatePickerToText(textInputId, isoValue) {
  if (!isoValue) return;
  const target = document.getElementById(textInputId);
  if (target) {
    target.value = formatDateToRu(isoValue);
  }
}

function setupDefaults() {
  const todayRu = getTodayRuDate();

  if (document.getElementById('tripStartDate')) document.getElementById('tripStartDate').value = todayRu;
  if (document.getElementById('tripFinishDate')) document.getElementById('tripFinishDate').value = todayRu;
  if (document.getElementById('expenseDate')) document.getElementById('expenseDate').value = todayRu;
  if (document.getElementById('paymentDate')) document.getElementById('paymentDate').value = todayRu;

  // Загружаем GitHub токен из localStorage
  const savedGhToken = localStorage.getItem('github_token');
  if (savedGhToken) {
    document.getElementById('githubTokenInput').value = savedGhToken;
    const masked = savedGhToken.substring(0, 8) + '...';
    document.getElementById('syncStatusBadge').innerHTML = `🟢 GitHub токен подключен (${masked})`;
  }

  // Загружаем GitHub Pages токен из localStorage
  const savedPagesToken = localStorage.getItem('github_pages_token');
  if (savedPagesToken && document.getElementById('githubPagesTokenInput')) {
    document.getElementById('githubPagesTokenInput').value = savedPagesToken;
  }

  const savedPagesUrl = localStorage.getItem('gh_pages_url');
  if (savedPagesUrl && document.getElementById('ghPagesBanner')) {
    const banner = document.getElementById('ghPagesBanner');
    banner.style.display = 'block';
    banner.innerHTML = `🟢 Ваша постоянная страница GitHub Pages: <a href="${savedPagesUrl}" target="_blank" style="color:#137333; font-weight:bold;">${savedPagesUrl}</a>`;
  }

  // Загружаем Gist ID из localStorage
  const savedGistId = localStorage.getItem('github_gist_id');
  if (savedGistId) {
    document.getElementById('githubGistIdInput').value = savedGistId;
  }

  loadFuelSettingsIntoInputs();

  window.switchTab = switchTab;
  window.toggleAutoFields = toggleAutoFields;
  window.onClientSelectChange = onClientSelectChange;
  window.previewFile = previewFile;
  window.clearReceiptPhoto = clearReceiptPhoto;
  window.syncDatePickerToText = syncDatePickerToText;
  window.handleCreateTrip = handleCreateTrip;
  window.handleAddExpense = handleAddExpense;
  window.handleAddPayment = handleAddPayment;
  window.renderFilteredSummaryList = renderFilteredSummaryList;
  window.transformCardToEdit = transformCardToEdit;
  window.restoreCardView = restoreCardView;
  window.handleInlineUpdateTrip = handleInlineUpdateTrip;
  window.downloadExcelReport = downloadExcelReport;
  window.downloadPDFReport = downloadPDFReport;
  window.addDictItem = addDictItem;
  window.editDictItem = editDictItem;
  window.saveDictItem = saveDictItem;
  window.cancelEditDictItem = cancelEditDictItem;
  window.deleteDictItem = deleteDictItem;
  window.saveGithubToken = saveGithubToken;
  window.saveGithubGistId = saveGithubGistId;
  window.saveFuelSettings = saveFuelSettings;
  window.syncWithGithub = syncWithGithub;
  window.exportDbToFile = exportDbToFile;
  window.importDbFromFile = importDbFromFile;
  window.toggleCardDetails = toggleCardDetails;
  window.deleteExpenseItem = deleteExpenseItem;
  window.deletePaymentItem = deletePaymentItem;
  window.editExpenseItem = editExpenseItem;
  window.saveInlineExpense = saveInlineExpense;
  window.editPaymentItem = editPaymentItem;
  window.saveInlinePayment = saveInlinePayment;
  window.renderExpensesList = renderExpensesList;
  window.renderPaymentsList = renderPaymentsList;
  window.deleteGlobalExpenseItem = deleteGlobalExpenseItem;
  window.deleteGlobalPaymentItem = deleteGlobalPaymentItem;
  window.toggleGlobalExpenseExpand = toggleGlobalExpenseExpand;
  window.toggleGlobalPaymentExpand = toggleGlobalPaymentExpand;
  window.openPhotoModal = openPhotoModal;
  window.closePhotoModal = closePhotoModal;
  window.handleEditPhotoChange = handleEditPhotoChange;
  window.clearEditPhoto = clearEditPhoto;
  window.openQuickAddModal = openQuickAddModal;
  window.closeQuickAddModal = closeQuickAddModal;
  window.previewQuickFile = previewQuickFile;
  window.handleQuickAddExpense = handleQuickAddExpense;
  window.cancelInlineExpenseEdit = cancelInlineExpenseEdit;
  window.closeEditBottomSheet = closeEditBottomSheet;
  window.cancelInlinePaymentEdit = cancelInlinePaymentEdit;
  window.saveDesktopModalStyle = saveDesktopModalStyle;
  window.setTripStatus = setTripStatus;
  window.setSummaryChipFilter = setSummaryChipFilter;
  window.renderFilteredSummaryList = renderFilteredSummaryList;
  window.generateSelectedReport = generateSelectedReport;
  window.openPdfAttachment = openPdfAttachment;
  window.deployToGitHubPages = deployToGitHubPages;
  window.saveGithubPagesToken = saveGithubPagesToken;
}

function loadFuelSettingsIntoInputs() {
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
  if (styleSelect) styleSelect.value = getDesktopModalStyle();
}

function getDesktopModalStyle() {
  return localStorage.getItem('desktopModalStyle') || 'centered';
}

function applyDesktopModalStyle() {
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

function saveDesktopModalStyle(val) {
  localStorage.setItem('desktopModalStyle', val || 'centered');
  applyDesktopModalStyle();
  showToast("✅ Вид окна на ПК сохранен!");
}

function saveFuelSettings() {
  const summer = document.getElementById('fuelSummerRate')?.value || '8.7';
  const winter = document.getElementById('fuelWinterRate')?.value || '8.9';
  const price = document.getElementById('fuelPricePerLiter')?.value || '69.0';
  const deductible = document.getElementById('depreciationDeductibleKm')?.value || '70';
  const rate = document.getElementById('depreciationRatePerKm')?.value || '5.0';

  localStorage.setItem('fuelSummerRate', summer);
  localStorage.setItem('fuelWinterRate', winter);
  localStorage.setItem('fuelPricePerLiter', price);
  localStorage.setItem('depreciationDeductibleKm', deductible);
  localStorage.setItem('depreciationRatePerKm', rate);

  showToast("✅ Нормы топлива и амортизации сохранены!");
  loadData();
}

function saveGithubToken() {
  const token = document.getElementById('githubTokenInput').value.trim();
  if (!token) {
    showToast("Введите GitHub Personal Access Token");
    return;
  }
  localStorage.setItem('github_token', token);
  const masked = token.substring(0, 8) + '...';
  document.getElementById('syncStatusBadge').innerHTML = `🟢 GitHub токен сохранен (${masked}). Нажмите «Синхронизировать»`;
  showToast("✅ GitHub токен сохранен!");
}

function saveGithubGistId() {
  const gistId = document.getElementById('githubGistIdInput').value.trim();
  if (!gistId) {
    showToast("Введите Gist ID");
    return;
  }
  localStorage.setItem('github_gist_id', gistId);
  showToast("✅ Gist ID сохранен! Теперь нажмите «Синхронизировать»");
}

function showToast(msg, duration) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.style.display = 'block';
  
  const timeoutMs = duration || (msg.includes('❌') || msg.includes('⚠️') ? 12000 : 4000);
  
  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    t.style.display = 'none';
  }, timeoutMs);

  t.onclick = () => {
    t.style.display = 'none';
  };
}

function switchTab(tabId) {
  if (!tabId) return;
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
  } else if (tabId === 'expenseTab') {
    renderExpensesList();
  } else if (tabId === 'paymentTab') {
    renderPaymentsList();
  }
}

async function syncWithGithub() {
  await cleanupDuplicates();
  const token = localStorage.getItem('github_token') || document.getElementById('githubTokenInput').value.trim();
  if (!token) {
    showToast("Сначала укажите GitHub Personal Access Token");
    return;
  }

  const badge = document.getElementById('syncStatusBadge');
  badge.innerHTML = '⏳ Идёт синхронизация через GitHub Gist...';

  try {
    const res = await downloadAndMergeFromGithubGist(token);
    const timeStr = new Date().toLocaleTimeString('ru-RU');

    // Показываем Gist ID в интерфейсе, чтобы можно было скопировать на второе устройство
    const gistId = res.gistId || localStorage.getItem('github_gist_id') || '';
    if (gistId) {
      document.getElementById('githubGistIdInput').value = gistId;
    }

    if (res.isNew) {
      badge.innerHTML = `🟢 База выгружена впервые. Поездок: ${res.finalTripsCount}. Gist ID: <strong>${gistId}</strong>`;
      showToast(`✅ База загружена в GitHub Gist! Скопируйте Gist ID для второго устройства.`);
    } else {
      badge.innerHTML = `🟢 Синхронизировано в ${timeStr}. Поездок в базе: ${res.finalTripsCount}. Gist ID: <strong>${gistId}</strong>`;
      showToast(`✅ Синхронизация выполнена! Поездок: ${res.finalTripsCount}`);
    }
    await loadData();
  } catch (err) {
    badge.innerHTML = `🔴 Ошибка синхронизации: ${err.message}`;
    showToast("❌ Ошибка синхронизации: " + err.message);
  }
}

async function exportDbToFile() {
  try {
    const data = await exportLocalDbToJson();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_business_trips_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("💾 Файл базы данных выгружен!");
  } catch (err) {
    showToast("❌ Ошибка выгрузки файла: " + err);
  }
}

async function importDbFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      await mergeRemoteDbToLocal(json);
      showToast("📥 База данных успешно импортирована!");
      await loadData();
    } catch (err) {
      showToast("❌ Ошибка чтения файла бэкапа: " + err.message);
    }
  };
  reader.readAsText(file);
}

function isAutoTransport(val) {
  if (!val) return false;
  const s = String(val).toLowerCase();
  if (s.includes('автобус')) return false;
  return s.includes('авто') || s.includes('машин') || s.includes('car') || s.includes('тс') || s.includes('легков');
}

function toggleAutoFields(selectId, targetDivId) {
  const transportSelect = document.getElementById(selectId || 'tripTransport');
  const transport = transportSelect ? transportSelect.value : '';
  const autoDiv = document.getElementById(targetDivId || 'autoFields');
  if (autoDiv) {
    autoDiv.style.display = isAutoTransport(transport) ? 'block' : 'none';
  }
}

async function onClientSelectChange(clientName, targetInputId) {
  if (!clientName) return;
  const clientObj = await db.clients.where('name').equalsIgnoreCase(clientName.trim()).first();
  if (clientObj && clientObj.address) {
    const targetInput = document.getElementById(targetInputId);
    if (targetInput) {
      targetInput.value = clientObj.address;
    }
  }
}

function compressImage(file) {
  return new Promise((resolve) => {
    if (!file || !file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ base64: e.target.result.split(',')[1], name: file ? file.name : '', isImg: false });
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 800;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        const base64 = compressedDataUrl.split(',')[1];
        resolve({ base64, name: file.name, dataUrl: compressedDataUrl, isImg: true });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function previewFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const res = await compressImage(file);
  selectedFileBase64 = res.base64;
  selectedFileName = res.name;

  const container = document.getElementById('receiptPreviewContainer');
  const imgEl = document.getElementById('receiptPreviewImg');
  const nameEl = document.getElementById('fileNamePreview');
  const placeholder = document.getElementById('receiptPlaceholder');

  if (res.isImg && res.dataUrl) {
    imgEl.src = res.dataUrl;
    imgEl.style.display = 'inline-block';
    imgEl.style.cursor = 'pointer';
    imgEl.onclick = (e) => { e.stopPropagation(); openPhotoModal(res.dataUrl, `Предпросмотр: ${res.name}`); };
  } else {
    imgEl.style.display = 'none';
  }

  if (nameEl) nameEl.innerText = `📎 ${res.name}`;
  if (container) container.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
}

function clearReceiptPhoto() {
  selectedFileBase64 = null;
  selectedFileName = null;

  const cameraInput = document.getElementById('receiptCameraInput');
  const galleryInput = document.getElementById('receiptGalleryInput');
  const pdfInput = document.getElementById('receiptPdfInput');
  if (cameraInput) cameraInput.value = '';
  if (galleryInput) galleryInput.value = '';
  if (pdfInput) pdfInput.value = '';

  const container = document.getElementById('receiptPreviewContainer');
  const placeholder = document.getElementById('receiptPlaceholder');
  if (container) container.style.display = 'none';
  if (placeholder) placeholder.style.display = 'block';
}

async function loadData() {
  const clients = await db.clients.toArray();
  const dicts = await db.dictionaries.toArray();
  const trips = await db.trips.toArray();

  // Datalist клиентов
  const clientsDatalist = document.getElementById('clientsDatalist');
  clientsDatalist.innerHTML = '';
  clients.forEach(c => {
    clientsDatalist.innerHTML += `<option value="${c.name}">`;
  });

  // Виды работ
  const workTypeSelect = document.getElementById('tripWorkType');
  workTypeSelect.innerHTML = '';
  const workList = dicts.filter(d => d.category === 'workType').map(d => d.value);
  workList.forEach(w => {
    workTypeSelect.innerHTML += `<option value="${w}">${w}</option>`;
  });

  // Транспорт
  const transportSelect = document.getElementById('tripTransport');
  transportSelect.innerHTML = '';
  const transportList = dicts.filter(d => d.category === 'transport').map(d => d.value);
  transportList.forEach(t => {
    transportSelect.innerHTML += `<option value="${t}">${t}</option>`;
  });
  toggleAutoFields('tripTransport', 'autoFields');

  // Статусы в фильтре
  const filterSelect = document.getElementById('summaryStatusFilter');
  filterSelect.innerHTML = `
    <option value="onlyOpen">⏳ Скрывать только (Расчет закрыт + Статус Отправлен)</option>
    <option value="all">🌐 Показать абсолютно все расчеты</option>
  `;

  const statusList = dicts.filter(d => d.category === 'status').map(d => d.value);
  statusList.forEach(st => {
    filterSelect.innerHTML += `<option value="status:${st}">Статус: ${st}</option>`;
  });

  // Селекты для чеков, выплат и отчетов с фильтрацией закрытых
  const expTripSelect = document.getElementById('expenseTripId');
  const payTripSelect = document.getElementById('paymentTripId');
  const reportTripSelect = document.getElementById('reportTripSelect') || document.getElementById('reportTripId');
  
  const showClosedExp = document.getElementById('showClosedTripsExp')?.checked;
  const showClosedPay = document.getElementById('showClosedTripsPay')?.checked;
  const showClosedRep = document.getElementById('showClosedTripsRep')?.checked;

  const expTrips = showClosedExp ? trips : trips.filter(t => t.status !== 'Выплачен');
  const payTrips = showClosedPay ? trips : trips.filter(t => t.status !== 'Выплачен');
  const repTrips = showClosedRep ? trips : trips.filter(t => t.status !== 'Выплачен');

  if (expTripSelect) {
    expTripSelect.innerHTML = expTrips.length === 0 ? '<option value="">(Нет активных командировок)</option>' : '';
    expTrips.forEach(t => {
      expTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
  }

  if (payTripSelect) {
    payTripSelect.innerHTML = payTrips.length === 0 ? '<option value="">(Нет активных командировок)</option>' : '';
    payTrips.forEach(t => {
      payTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
  }

  if (reportTripSelect) {
    reportTripSelect.innerHTML = repTrips.length === 0 ? '<option value="">(Нет активных командировок)</option>' : '';
    repTrips.forEach(t => {
      reportTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
  }

  const aggregated = await getAggregatedSummary();
  renderHeroBalanceWidget(aggregated);
  renderFilteredSummaryList(aggregated);
  renderDictionariesManager(dicts);
  await renderExpensesList();
  await renderPaymentsList();
}

function renderDictionariesManager(dicts) {
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
            <button class="btn btn-sm btn-secondary" style="padding:4px 8px;" onclick="editDictItem(${item.id}, '${item.value.replace(/'/g, "\\'")}')">
              <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
            </button>
            <button class="btn btn-sm btn-secondary" style="padding:4px 8px; color:var(--md-sys-color-error);" onclick="deleteDictItem(${item.id})">
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

function editDictItem(id, currentValue) {
  const textSpan = document.getElementById(`dict-item-text-${id}`);
  const actionsDiv = document.getElementById(`dict-item-actions-${id}`);

  textSpan.innerHTML = `
    <input type="text" id="dict-edit-input-${id}" class="form-control" style="padding:4px 8px; font-size:14px;" value="${currentValue}">
  `;

  actionsDiv.innerHTML = `
    <button class="btn btn-sm" style="padding:4px 10px;" onclick="saveDictItem(${id})">💾</button>
    <button class="btn btn-sm btn-secondary" style="padding:4px 10px;" onclick="loadData()">✕</button>
  `;
}

async function saveDictItem(id) {
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
  await loadData();
}

function cancelEditDictItem() {
  loadData();
}

async function addDictItem(category, inputId) {
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
  await loadData();
}

async function deleteDictItem(id) {
  if (confirm("Вы уверены, что хотите удалить этот элемент из справочника?")) {
    await db.expenses.delete(id).catch(() => {});
    await db.dictionaries.delete(id);
    localStorage.setItem('dictionaries_updated_at', new Date().toISOString());
    showToast("🗑 Удалено из справочника!");
    await loadData();
  }
}

function renderHeroBalanceWidget(aggregated) {
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

  // Обновление сводного виджета на главной странице (первая вкладка "Поездки")
  const heroBalEl = document.getElementById('heroBalanceText');
  if (heroBalEl) {
    if (netBalance < 0) {
      heroBalEl.innerText = `Долг вам: ${Math.abs(netBalance).toLocaleString('ru-RU')} руб.`;
      heroBalEl.style.color = '#FFFFFF';
    } else if (netBalance > 0) {
      heroBalEl.innerText = `Переплата: ${netBalance.toLocaleString('ru-RU')} руб.`;
      heroBalEl.style.color = '#FFE082';
    } else {
      heroBalEl.innerText = `0 руб. (расчеты закрыты)`;
      heroBalEl.style.color = '#FFFFFF';
    }
  }

  if (document.getElementById('heroTotalOwed')) {
    document.getElementById('heroTotalOwed').innerText = `${aggregated.totalOwedAll.toLocaleString('ru-RU')} руб.`;
  }
  if (document.getElementById('heroTotalPaid')) {
    document.getElementById('heroTotalPaid').innerText = `${aggregated.totalPaidAll.toLocaleString('ru-RU')} руб.`;
  }
}

async function setTripStatus(tripId, newStatus) {
  const t = await db.trips.get(parseInt(tripId));
  if (!t) return;
  if (t.status === newStatus) return; // Молчаливый возврат без тоаста если статус не менялся

  // Если вручную переключаем на статус "Выплачен"
  if (newStatus === 'Выплачен') {
    const aggregated = await getAggregatedSummary();
    const summary = aggregated.tripSummaries.find(s => String(s.trip.id) === String(tripId));
    
    // Оставшийся неоплаченным долг сотруднику
    const remainingDebt = summary ? (summary.totalOwed - summary.paymentsTotal) : 0;

    if (remainingDebt > 0) {
      const confirmAutoPay = confirm(
        `Поездке №${t.appNo || t.id} требуется выплата на сумму ${remainingDebt.toLocaleString('ru-RU')} ₽.\n\n` +
        `Нажмите OK, чтобы встроить полную выплату и закрыть поездку.\n` +
        `При нажатии Отмена статус "Выплачен" установлен НЕ БУДЕТ, так как за бухгалтерией числится долг.`
      );

      if (confirmAutoPay) {
        const todayRu = formatDateToRu(new Date().toISOString());
        await db.payments.add({
          tripId: String(t.id),
          date: todayRu,
          amount: remainingDebt,
          note: 'Окончательный расчет по поездки',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        showToast(`✅ Внесена выплата ${remainingDebt.toLocaleString('ru-RU')} ₽!`);
      } else {
        showToast("ℹ️ Статус не изменён: для статуса 'Выплачен' требуется погашение долга.");
        return;
      }
    }
  }

  await db.trips.update(parseInt(tripId), {
    status: newStatus,
    updatedAt: new Date().toISOString()
  });

  showToast(`✅ Статус изменен на "${newStatus}"`);
  await loadData();
}

function renderStepperHtml(t) {
  const currentStatus = String(t.status || 'не подготовлен');

  const isStep1Active = currentStatus === 'не подготовлен';
  const isStep2Active = currentStatus === 'Подготовлен';
  const isStep3Active = currentStatus === 'Отправлен';
  const isStep4Active = currentStatus === 'Выплачен';

  return `
    <div class="trip-stepper" onclick="event.stopPropagation();">
      <div class="stepper-step ${isStep1Active ? 'active' : ''}" title="Черновик / Сбор чеков" onclick="setTripStatus(${t.id}, 'не подготовлен')">
        <div class="stepper-dot">1</div>
        <span>Не подготовлен</span>
      </div>
      <div class="stepper-line ${isStep2Active || isStep3Active || isStep4Active ? 'active' : ''}"></div>
      
      <div class="stepper-step ${isStep2Active ? 'active' : ''}" title="Готов к отправке" onclick="setTripStatus(${t.id}, 'Подготовлен')">
        <div class="stepper-dot">2</div>
        <span>Подготовлен</span>
      </div>
      <div class="stepper-line ${isStep3Active || isStep4Active ? 'active' : ''}"></div>
      
      <div class="stepper-step ${isStep3Active ? 'active' : ''}" title="Передан в бухгалтерию" onclick="setTripStatus(${t.id}, 'Отправлен')">
        <div class="stepper-dot">3</div>
        <span>Отправлен</span>
      </div>
      <div class="stepper-line ${isStep4Active ? 'active' : ''}"></div>
      
      <div class="stepper-step step-paid ${isStep4Active ? 'active' : ''}" title="Выплаты получены / Расчет закрыт" onclick="setTripStatus(${t.id}, 'Выплачен')">
        <div class="stepper-dot">4</div>
        <span>Выплачен</span>
      </div>
    </div>
  `;
}

function setSummaryChipFilter(val, btn) {
  const input = document.getElementById('summaryStatusFilter');
  if (input) input.value = val;
  document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderFilteredSummaryList();
}

async function renderFilteredSummaryList(aggregatedData) {
  const filterVal = document.getElementById('summaryStatusFilter')?.value || 'inProgress';
  const searchQuery = (document.getElementById('summarySearchInput')?.value || '').toLowerCase().trim();
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
          if (exp.receiptBase64) {
            if (exp.receiptName && exp.receiptName.endsWith('.pdf')) {
              fileBadge = ' <span class="badge" style="background:#E53935; color:#fff; font-size:10px; padding:2px 6px;">📄 PDF</span>';
            } else {
              const src = `data:image/jpeg;base64,${exp.receiptBase64}`;
              const title = `${(exp.description || 'Чек').replace(/'/g, "\\'")} — ${exp.amount} руб.`;
              fileBadge = ` <span class="badge" style="background:var(--md-sys-color-primary); color:#fff; font-size:10px; padding:2px 6px; cursor:pointer;" onclick="event.stopPropagation(); openPhotoModal('${src}', '${title}')">📷 Фото 🔍</span>`;
            }
          }
          detailsListHtml += `
            <div id="summary-expense-row-${exp.id}" style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:10px 12px; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:10px; margin-bottom:6px; cursor:pointer;" onclick="event.stopPropagation(); editExpenseItem(${exp.id}, '${t.id}')">
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
            <div id="summary-payment-row-${pay.id}" style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:10px 12px; background:#FFFFFF; border:1px solid #A7F3D0; border-radius:10px; margin-bottom:6px; cursor:pointer;" onclick="event.stopPropagation(); editPaymentItem(${pay.id}, '${t.id}')">
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
            <span>⛽ Топливо: <strong>${cm.fuelLiters.toFixed(1)} л</strong> (~${cm.fuelCost.toLocaleString('ru-RU')} ₽ при ${cm.fuelPricePerLiter} ₽/л)</span>
            ${deprHtml}
          </div>
        </div>
      `;
    }

    html += `
      <div id="card-container-${t.id}" class="card" style="margin-bottom: 14px; padding:16px 18px; border-radius:16px; border:1px solid #CBD5E1; box-shadow:0 6px 22px rgba(0,0,0,0.11); cursor:pointer;" onclick="transformCardToEdit('${t.id}')">
        <!-- ОБЫЧНЫЙ ВИД КАРТОЧКИ В СТИЛЕ TIMELINE -->
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

        <!-- ВСТРОЕННАЯ ПЛАВНО РАЗВОРАЧИВАЕМАЯ ФОРМА РЕДАКТИРОВАНИЯ -->
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

async function handleCreateTrip(event) {
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

  const dicts = await db.dictionaries.toArray();
  const statuses = dicts.filter(d => d.category === 'status').map(d => d.value);
  const defaultStatus = statuses.length > 0 ? statuses[0] : 'не подготовлен';

  await db.trips.add({
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
  });

  showToast("✅ Поездка сохранена локально!");
  document.getElementById('tripForm').reset();
  setupDefaults();
  toggleAutoFields('tripTransport', 'autoFields');
  await loadData();
}

async function handleAddExpense(event) {
  event.preventDefault();
  const tripId = document.getElementById('expenseTripId').value;
  if (!tripId) {
    showToast("Выберите командировку");
    return;
  }

  const paymentType = document.getElementById('expensePaymentType')?.value || 'cash';
  await db.expenses.add({
    tripId: tripId,
    date: formatDateToRu(document.getElementById('expenseDate').value),
    amount: parseFloat(document.getElementById('expenseAmount').value) || 0,
    description: document.getElementById('expenseDesc').value,
    paymentType: paymentType,
    receiptBase64: selectedFileBase64 || '',
    receiptName: selectedFileName || '',
    updatedAt: new Date().toISOString()
  });

  showToast("✅ Расход сохранен!");
  document.getElementById('expenseForm').reset();
  setupDefaults();
  clearReceiptPhoto();
  await loadData();
}

async function handleAddPayment(event) {
  event.preventDefault();
  const tripId = document.getElementById('paymentTripId').value;
  if (!tripId) {
    showToast("Выберите командировку");
    return;
  }

  await db.payments.add({
    tripId: tripId,
    date: formatDateToRu(document.getElementById('paymentDate').value),
    amount: parseFloat(document.getElementById('paymentAmount').value) || 0,
    purpose: 'Выплата на карту',
    note: document.getElementById('paymentNote').value,
    updatedAt: new Date().toISOString()
  });

  // Проверка закрытия баланса для смены статуса на "Выплачен"
  const aggregated = await getAggregatedSummary();
  const summary = aggregated.tripSummaries.find(s => String(s.trip.id) === String(tripId));
  if (summary && summary.totalOwed > 0 && summary.paymentsTotal >= summary.totalOwed) {
    await db.trips.update(parseInt(tripId), { status: 'Выплачен', updatedAt: new Date().toISOString() });
    showToast("✅ Выплата зафиксирована! Статус сменен на 'Выплачен'");
  } else {
    showToast("✅ Выплата зафиксирована!");
  }

  document.getElementById('paymentForm').reset();
  setupDefaults();
  await loadData();
}

let activeTripId = null;
let activeChildEdit = null; // { type: 'expense'|'payment', id: string }

function closeActiveChildForm() {
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
      tripInlineRow.onclick = function(e) {
        e.stopPropagation();
        editExpenseItem(child.id, child.tripId);
      };
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
      tripInlineRow.onclick = function(e) {
        e.stopPropagation();
        editPaymentItem(child.id, child.tripId);
      };
    }
  }
}

async function transformCardToEdit(tripId) {
  const t = await db.trips.get(parseInt(tripId));
  if (!t) return;

  if (activeTripId && String(activeTripId) !== String(tripId)) {
    restoreCardView(activeTripId);
  }
  closeActiveChildForm();
  activeTripId = String(tripId);

  const cardContainer = document.getElementById(`card-container-${tripId}`);
  const viewDiv = document.getElementById(`card-view-${tripId}`);
  const editDiv = document.getElementById(`card-edit-${tripId}`);

  cardContainer.classList.add('md3-card-transformed');
  viewDiv.style.display = 'none';

  const dicts = await db.dictionaries.toArray();
  const transportList = dicts.filter(d => d.category === 'transport').map(d => d.value);
  const workList = dicts.filter(d => d.category === 'workType').map(d => d.value);
  const statusList = dicts.filter(d => d.category === 'status').map(d => d.value);

  let transportHtml = '';
  transportList.forEach(tr => {
    transportHtml += `<option value="${tr}" ${tr === t.transport ? 'selected' : ''}>${tr}</option>`;
  });

  let workHtml = '';
  workList.forEach(w => {
    workHtml += `<option value="${w}" ${w === t.workType ? 'selected' : ''}>${w}</option>`;
  });

  let statusHtml = '';
  statusList.forEach(st => {
    statusHtml += `<option value="${st}" ${st === t.status ? 'selected' : ''}>${st}</option>`;
  });

  const startRu = formatDateToRu(t.startDate);
  const finishRu = formatDateToRu(t.finishDate);

  // Загружаем расходы и выплаты этой командировки для редактирования
  const tripExpenses = await db.expenses.where('tripId').equals(String(tripId)).toArray();
  const tripPayments = await db.payments.where('tripId').equals(String(tripId)).toArray();

  let expEditRows = '';
  if (tripExpenses.length === 0) {
    expEditRows = '<div style="font-size:12px; color:#888; padding:4px 0;">Расходы пока не внесены</div>';
  } else {
    tripExpenses.forEach(exp => {
      let icon = 'receipt_long';
      if (exp.receiptBase64) {
        icon = (exp.receiptName && exp.receiptName.endsWith('.pdf')) ? 'picture_as_pdf' : 'image';
      }
      expEditRows += `
        <div id="inline-expense-edit-row-${exp.id}" style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:10px; padding:10px 12px; margin-bottom:8px; font-size:13px; cursor:pointer;" onclick="event.stopPropagation(); editExpenseItem(${exp.id}, '${t.id}')">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="material-symbols-outlined" style="color:var(--md-sys-color-primary); font-size:18px;">${icon}</span>
            <div>
              <strong>${exp.amount.toLocaleString('ru-RU')} руб.</strong> (${exp.date})<br>
              <span style="color:#555; font-size:12px;">${exp.description || 'Без описания'}</span>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" style="padding:4px 8px; color:#E53935;" onclick="event.stopPropagation(); deleteExpenseItem(${exp.id}, '${t.id}')">
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
        <div id="inline-payment-edit-row-${pay.id}" style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border:1px solid #A7F3D0; border-radius:10px; padding:10px 12px; margin-bottom:8px; font-size:13px; cursor:pointer;" onclick="event.stopPropagation(); editPaymentItem(${pay.id}, '${t.id}')">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="material-symbols-outlined" style="color:#2E7D32; font-size:18px;">payments</span>
            <div>
              <strong>+${pay.amount.toLocaleString('ru-RU')} руб.</strong> (${pay.date})<br>
              <span style="color:#555; font-size:12px;">${pay.note || pay.purpose || 'Выплата'}</span>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" style="padding:4px 8px; color:#E53935;" onclick="event.stopPropagation(); deletePaymentItem(${pay.id}, '${t.id}')">
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

        <div id="inlineAutoFields-${t.id}" style="display: none; background: #E8EFFD; padding: 12px; border-radius: 12px; margin-bottom: 14px;">
          <div class="form-row">
            <div class="form-group">
              <label>ODO start</label>
              <input type="number" id="inlineOdoStart-${t.id}" class="form-control" value="${t.odoStart || 0}" step="1">
            </div>
            <div class="form-group">
              <label>ODO finish</label>
              <input type="number" id="inlineOdoFinish-${t.id}" class="form-control" value="${t.odoFinish || 0}" step="1">
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>Статус командировки</label>
          <select id="inlineStatus-${t.id}" class="form-control">
            ${statusHtml}
          </select>
        </div>

        <div class="form-group">
          <label>Примечание</label>
          <input type="text" id="inlineNote-${t.id}" class="form-control" value="${t.note || ''}">
        </div>

        <div style="display:flex; gap:10px; margin-top:10px; margin-bottom:14px;">
          <button type="submit" class="btn" style="flex:2;">
            <span class="material-symbols-outlined">save</span> Сохранить поездку
          </button>
          <button type="button" class="btn btn-secondary" style="flex:1;" onclick="restoreCardView('${t.id}')">
            Отмена
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

function toggleCardDetails(tripId) {
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

let currentHighlightedElementId = null;

function highlightSelectedItem(targetId) {
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

function closeEditBottomSheet(highlightTargetId) {
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

async function deleteExpenseItem(expenseId, tripId, targetId) {
  if (confirm("Вы уверены, что хотите удалить этот расход?")) {
    const item = await db.expenses.get(parseInt(expenseId));
    if (item) markItemDeleted('expenses', item);
    await db.expenses.delete(parseInt(expenseId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Расход удален!");
    await loadData();
  }
}

async function deletePaymentItem(paymentId, tripId, targetId) {
  if (confirm("Вы уверены, что хотите удалить эту выплату?")) {
    const item = await db.payments.get(parseInt(paymentId));
    if (item) markItemDeleted('payments', item);
    await db.payments.delete(parseInt(paymentId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Выплата удалена!");
    await loadData();
  }
}

let inlinePhotoState = {};

async function editExpenseItem(expenseId, tripId) {
  let exp = await db.expenses.get(parseInt(expenseId));
  if (!exp) exp = await db.expenses.get(String(expenseId));
  if (!exp) exp = await db.expenses.get(expenseId);
  if (!exp) return;

  const activeTabId = document.querySelector('.tab-content.active')?.id;
  let targetId = '';
  if (activeTabId === 'expensesTab') {
    targetId = `global-expense-card-${expenseId}`;
  } else if (activeTripId && String(activeTripId) === String(tripId)) {
    targetId = `inline-expense-edit-row-${expenseId}`;
  } else {
    targetId = `summary-expense-row-${expenseId}`;
  }

  highlightSelectedItem(targetId);

  inlinePhotoState[expenseId] = {
    base64: exp.receiptBase64 || '',
    name: exp.receiptName || ''
  };

  let photoPreviewHtml = '';
  if (exp.receiptBase64) {
    if (exp.receiptName && exp.receiptName.endsWith('.pdf')) {
      photoPreviewHtml = `<div id="edit-photo-preview-${expenseId}" style="margin: 8px 0;"><span class="badge" style="background:#E53935; color:#fff;">📄 PDF: ${exp.receiptName}</span></div>`;
    } else {
      const src = `data:image/jpeg;base64,${exp.receiptBase64}`;
      photoPreviewHtml = `<div id="edit-photo-preview-${expenseId}" style="margin: 8px 0; text-align:center;"><img src="${src}" style="max-width:100%; max-height:160px; border-radius:8px; border:1px solid #ccc; cursor:pointer;" onclick="event.stopPropagation(); openPhotoModal('${src}', 'Чек')"></div>`;
    }
  } else {
    photoPreviewHtml = `<div id="edit-photo-preview-${expenseId}" style="margin: 8px 0; color:#888; font-size:12px; text-align:center;">Фото не прикреплено</div>`;
  }

  const editFormHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #E1E2EC; padding-bottom:10px;">
      <strong style="font-size:17px; color:var(--md-sys-color-primary); display:flex; align-items:center; gap:8px;">
        <span class="material-symbols-outlined">edit_note</span> Редактирование расхода
      </strong>
      <span class="material-symbols-outlined" style="cursor:pointer; color:#666; font-size:24px;" onclick="closeEditBottomSheet('${targetId}')">close</span>
    </div>

    <form onsubmit="event.preventDefault(); saveInlineExpense(${expenseId}, '${tripId || ''}', '${targetId}');">
      <div class="form-group" style="margin-bottom: 12px;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 4px; display:block;">Дата расхода (ДД.ММ.ГГГГ)</label>
        <div style="position:relative; display:flex; align-items:center;">
          <input type="text" id="editExpDate-${expenseId}" class="form-control" style="font-size: 14px; padding: 10px 38px 10px 12px;" value="${exp.date}" pattern="[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}" required>
          <input type="date" style="position:absolute; right:4px; opacity:0; width:36px; height:36px; cursor:pointer; z-index:2;" onchange="syncDatePickerToText('editExpDate-${expenseId}', this.value)">
          <span class="material-symbols-outlined" style="position:absolute; right:10px; pointer-events:none; color:var(--md-sys-color-primary); font-size:22px;">calendar_month</span>
        </div>
      </div>

      <div class="form-group" style="margin-bottom: 12px;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 4px; display:block;">Сумма (руб)</label>
        <input type="number" id="editExpAmount-${expenseId}" class="form-control" style="font-size: 15px; font-weight:600; padding: 10px 12px;" value="${exp.amount}" step="0.01" required>
      </div>

      <div class="form-group" style="margin-bottom: 14px;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 4px; display:block;">Описание расхода / Назначение</label>
        <input type="text" id="editExpDesc-${expenseId}" class="form-control" style="font-size: 14px; padding: 10px 12px;" value="${exp.description || ''}" placeholder="Отель, АЗС, Авиабилеты...">
      </div>

      <div class="form-group" style="margin-bottom: 14px;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 4px; display:block;">Способ оплаты</label>
        <select id="editExpPaymentType-${expenseId}" class="form-control" style="font-size: 14px; padding: 10px 12px;">
          <option value="cash" ${exp.paymentType !== 'cashless' ? 'selected' : ''}>💵 Личные средства (в расчёт долга вам)</option>
          <option value="cashless" ${exp.paymentType === 'cashless' ? 'selected' : ''}>💳 Оплата компанией / Безнал (в справочную секцию)</option>
        </select>
      </div>

      <!-- БЛОК УПРАВЛЕНИЯ ФОТО ЧЕКА -->
      <div class="form-group" style="margin-bottom: 16px; background: #F8F9FE; padding: 12px; border-radius: 12px; border: 1px solid #E0E4F0;">
        <label style="font-weight: 500; font-size: 13px; margin-bottom: 6px; display:block;">Прикрепленный чек / фото</label>

        ${photoPreviewHtml}

        <input type="file" id="editCameraInput-${expenseId}" accept="image/*" capture="environment" style="display:none;" onchange="handleEditPhotoChange(${expenseId}, event)">
        <input type="file" id="editGalleryInput-${expenseId}" accept="image/*,application/pdf" style="display:none;" onchange="handleEditPhotoChange(${expenseId}, event)">

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button type="button" class="btn btn-secondary" style="flex:1; padding:8px 6px; font-size:13px;" onclick="document.getElementById('editCameraInput-${expenseId}').click();">
            <span class="material-symbols-outlined" style="font-size:18px;">photo_camera</span> Камера
          </button>
          <button type="button" class="btn btn-secondary" style="flex:1; padding:8px 6px; font-size:13px;" onclick="document.getElementById('editGalleryInput-${expenseId}').click();">
            <span class="material-symbols-outlined" style="font-size:18px;">photo_library</span> Файл
          </button>
          <button type="button" class="btn btn-secondary" style="flex:1; padding:8px 6px; font-size:13px; color:#E53935;" onclick="clearEditPhoto(${expenseId})">
            ✕ Удалить
          </button>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px; width:100%;">
        <button type="submit" class="btn" style="width:100%; padding: 12px; font-size:15px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:8px;">
          <span class="material-symbols-outlined" style="font-size:20px;">save</span> Сохранить расход
        </button>
        <div style="display:flex; gap:10px; width:100%;">
          <button type="button" class="btn btn-secondary" style="flex:1; padding: 10px; font-size:13px; color:#E53935; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="${tripId ? `deleteExpenseItem(${expenseId}, '${tripId}', '${targetId}')` : `deleteGlobalExpenseItem(${expenseId}, '${targetId}')`}">
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

async function handleEditPhotoChange(expenseId, event) {
  const file = event.target.files[0];
  if (!file) return;

  const res = await compressImage(file);
  inlinePhotoState[expenseId] = {
    base64: res.base64,
    name: res.name
  };

  const previewDiv = document.getElementById(`edit-photo-preview-${expenseId}`);
  if (previewDiv) {
    if (res.isImg && res.dataUrl) {
      previewDiv.innerHTML = `<div style="text-align:center;"><img src="${res.dataUrl}" style="max-width:100%; max-height:160px; border-radius:8px; border:2px solid var(--md-sys-color-primary-container);"></div>`;
    } else {
      previewDiv.innerHTML = `<span class="badge" style="background:#E53935; color:#fff;">📄 PDF: ${res.name}</span>`;
    }
  }
}

function clearEditPhoto(expenseId) {
  if (confirm("Вы уверены, что хотите удалить фото чека?")) {
    inlinePhotoState[expenseId] = { base64: '', name: '' };
    const previewDiv = document.getElementById(`edit-photo-preview-${expenseId}`);
    if (previewDiv) {
      previewDiv.innerHTML = '<div style="color:#888; font-size:12px; text-align:center;">Фото удалено</div>';
    }
  }
}

async function saveInlineExpense(expenseId, tripId, targetId) {
  const dateVal = document.getElementById(`editExpDate-${expenseId}`).value;
  const amountVal = parseFloat(document.getElementById(`editExpAmount-${expenseId}`).value) || 0;
  const descVal = document.getElementById(`editExpDesc-${expenseId}`).value;
  const paymentTypeVal = document.getElementById(`editExpPaymentType-${expenseId}`)?.value || 'cash';

  const photoData = inlinePhotoState[expenseId] || {};

  const updateData = {
    date: formatDateToRu(dateVal),
    amount: amountVal,
    description: descVal,
    paymentType: paymentTypeVal,
    updatedAt: new Date().toISOString()
  };

  if (photoData.base64 !== undefined) {
    updateData.receiptBase64 = photoData.base64;
    updateData.receiptName = photoData.name;
  }

  await db.expenses.update(parseInt(expenseId), updateData);

  closeEditBottomSheet(targetId);
  showToast("✅ Расход обновлен!");
  delete inlinePhotoState[expenseId];
  await loadData();
}

async function editPaymentItem(paymentId, tripId) {
  let pay = await db.payments.get(parseInt(paymentId));
  if (!pay) pay = await db.payments.get(String(paymentId));
  if (!pay) pay = await db.payments.get(paymentId);
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

    <form onsubmit="event.preventDefault(); saveInlinePayment(${paymentId}, '${tripId || ''}', '${targetId}');">
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
          <button type="button" class="btn btn-secondary" style="flex:1; padding: 10px; font-size:13px; color:#E53935; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="${tripId ? `deletePaymentItem(${paymentId}, '${tripId}', '${targetId}')` : `deleteGlobalPaymentItem(${paymentId}, '${targetId}')`}">
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

async function saveInlinePayment(paymentId, tripId, targetId) {
  const dateVal = document.getElementById(`editPayDate-${paymentId}`).value;
  const amountVal = parseFloat(document.getElementById(`editPayAmount-${paymentId}`).value) || 0;
  const noteVal = document.getElementById(`editPayNote-${paymentId}`).value;

  await db.payments.update(parseInt(paymentId), {
    date: formatDateToRu(dateVal),
    amount: amountVal,
    note: noteVal,
    updatedAt: new Date().toISOString()
  });

  closeEditBottomSheet(targetId);
  showToast("✅ Выплата обновлена!");
  await loadData();
}

function restoreCardView(tripId) {
  if (activeTripId === String(tripId)) {
    activeTripId = null;
  }
  highlightSelectedItem(null);
  closeActiveChildForm();

  const cardContainer = document.getElementById(`card-container-${tripId}`);
  const viewDiv = document.getElementById(`card-view-${tripId}`);
  const editDiv = document.getElementById(`card-edit-${tripId}`);

  if (cardContainer) cardContainer.classList.remove('md3-card-transformed');
  if (editDiv) editDiv.style.display = 'none';
  if (viewDiv) viewDiv.style.display = 'block';
}

async function handleInlineUpdateTrip(event, tripId) {
  event.preventDefault();
  await db.trips.update(parseInt(tripId), {
    appNo: document.getElementById(`inlineServiceApp-${tripId}`).value,
    client: document.getElementById(`inlineClient-${tripId}`).value,
    location: document.getElementById(`inlineTarget-${tripId}`).value,
    workType: document.getElementById(`inlineWorkType-${tripId}`).value,
    transport: document.getElementById(`inlineTransport-${tripId}`).value,
    startDate: formatDateToRu(document.getElementById(`inlineStartDate-${tripId}`).value),
    finishDate: formatDateToRu(document.getElementById(`inlineFinishDate-${tripId}`).value),
    odoStart: parseFloat(document.getElementById(`inlineOdoStart-${tripId}`).value) || 0,
    odoFinish: parseFloat(document.getElementById(`inlineOdoFinish-${tripId}`).value) || 0,
    status: document.getElementById(`inlineStatus-${tripId}`).value,
    note: document.getElementById(`inlineNote-${tripId}`).value,
    updatedAt: new Date().toISOString()
  });

  showToast("✅ Изменения сохранены!");
  await loadData();
}

async function generateSelectedReport() {
  const type = document.getElementById('reportTypeSelect')?.value || 'ao1';
  const tripSelect = document.getElementById('reportTripSelect') || document.getElementById('reportTripId');
  const tripId = tripSelect?.value;

  try {
    if (type === 'allExcel') {
      await exportToExcel();
      showToast("📊 Сводный реестр Excel сформирован!");
      return;
    }

    if (!tripId) {
      showToast("⚠️ Выберите командировку для отчета!");
      return;
    }

    if (type === 'ao1') {
      await exportAO1Excel(tripId);
      showToast("📊 Авансовый отчет АО-1 (Excel) сформирован!");
    } else if (type === 'pdf') {
      await exportToPDF(tripId);
      showToast("📕 PDF Авансовый отчет с фото сформирован!");
    }
  } catch (err) {
    showToast("❌ Ошибка при создании отчета: " + err);
  }
}

async function downloadExcelReport() {
  try {
    await exportToExcel();
    showToast("📊 Отчет Excel успешно сформирован!");
  } catch (err) {
    showToast("❌ Ошибка при экспорте Excel: " + err);
  }
}

async function downloadPDFReport() {
  const tripId = document.getElementById('reportTripId').value;
  if (!tripId) {
    showToast("Выберите командировку для PDF отчета");
    return;
  }
  try {
    await exportToPDF(tripId);
    showToast("📕 PDF Авансовый отчет с чеками сформирован!");
  } catch (err) {
    showToast("❌ Ошибка при экспорте PDF: " + err);
  }
}

function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => {})
      .catch(() => {});
  }
}

function isDateInPeriod(dateStr, period) {
  if (!period || period === 'all') return true;
  const d = parseRuDate(dateStr);
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

async function renderExpensesList() {
  const container = document.getElementById('expensesListContainer');
  const badge = document.getElementById('expensesTotalBadge');
  if (!container) return;

  const period = document.getElementById('expensePeriodFilter')?.value || 'currentMonth';
  const expenses = await db.expenses.toArray();
  const trips = await db.trips.toArray();

  const filtered = expenses.filter(e => isDateInPeriod(e.date, period));

  filtered.sort((a, b) => {
    const da = parseRuDate(a.date) || new Date(0);
    const dbTime = parseRuDate(b.date) || new Date(0);
    return dbTime.getTime() - da.getTime();
  });

  const totalSum = filtered.reduce((acc, e) => acc + (parseFloat(e.amount) || 0), 0);
  if (badge) badge.innerText = `Итого за период: ${totalSum.toLocaleString('ru-RU')} руб. (${filtered.length} чек.)`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <p style="color:#888; font-size:13px; margin:4px 0;">
        За выбранный период расходов не найдено. 
        <button type="button" class="btn btn-sm btn-secondary" style="margin-left:6px;" onclick="document.getElementById('expensePeriodFilter').value='all'; renderExpensesList();">Показать за всё время</button>
      </p>
    `;
    return;
  }

  let html = '';
  filtered.forEach(exp => {
    const trip = trips.find(t => String(t.id) === String(exp.tripId));
    const tripName = trip ? `№${trip.appNo || trip.id} ${trip.client || ''}` : 'Командировка';

    let icon = 'receipt_long';
    let fileBadge = '';
    let previewContent = '';

    if (exp.receiptBase64) {
      if (exp.receiptName && exp.receiptName.endsWith('.pdf')) {
        icon = 'picture_as_pdf';
        fileBadge = ` <span class="badge" style="background:#E53935; color:#fff; font-size:10px; padding:2px 6px; cursor:pointer;" onclick="event.stopPropagation(); openPdfAttachment('${exp.receiptBase64}', '${exp.receiptName || 'doc.pdf'}')">📄 PDF ↗</span>`;
        previewContent = `
          <div style="margin-top:8px; display:flex; align-items:center; gap:8px;">
            <button type="button" class="btn btn-sm btn-secondary" style="background:#E53935; color:#fff; border:none; padding:6px 12px; font-size:12px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;" onclick="event.stopPropagation(); openPdfAttachment('${exp.receiptBase64}', '${exp.receiptName || 'doc.pdf'}')">
              <span class="material-symbols-outlined" style="font-size:16px;">picture_as_pdf</span> 👁 Просмотреть / Открыть PDF (${exp.receiptName || 'документ'})
            </button>
          </div>
        `;
      } else {
        const src = `data:image/jpeg;base64,${exp.receiptBase64}`;
        const title = `${(exp.description || 'Чек').replace(/'/g, "\\'")} — ${exp.amount} руб.`;
        fileBadge = ` <span class="badge" style="background:var(--md-sys-color-primary); color:#fff; font-size:10px; padding:2px 6px; cursor:pointer;" onclick="event.stopPropagation(); openPhotoModal('${src}', '${title}')">📷 Фото 🔍</span>`;
        previewContent = `
          <div style="margin-top:8px; text-align:center;">
            <img src="data:image/jpeg;base64,${exp.receiptBase64}" style="max-width:100%; max-height:220px; border-radius:10px; border:2px solid var(--md-sys-color-primary-container); cursor:pointer;" onclick="event.stopPropagation(); openPhotoModal(this.src, '${(exp.description || 'Чек').replace(/'/g, "\\'")} — ${exp.amount} руб.')">
            <div style="font-size:11px; color:var(--md-sys-color-primary); margin-top:4px; font-weight:500;">🔍 Нажмите на фото для просмотра во весь экран</div>
          </div>
        `;
      }
    }

    html += `
      <div id="global-expense-card-${exp.id}" class="card" style="margin-bottom:10px; padding:14px; cursor:pointer; background:#FFFFFF; border:1px solid #CBD5E1;" onclick="editExpenseItem(${exp.id}, '${exp.tripId || ''}')">
        <div id="global-expense-view-${exp.id}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="material-symbols-outlined" style="color:var(--md-sys-color-primary); font-size:22px;">${icon}</span>
              <div>
                <strong style="font-size:14px; color:#1A1C1E;">${exp.amount.toLocaleString('ru-RU')} руб.</strong>${fileBadge}<br>
                <span style="color:#333; font-weight:500;">${exp.description || 'Без описания'}</span><br>
                <span style="color:#777; font-size:11px;">📅 ${exp.date} | 📍 ${tripName}</span>
              </div>
            </div>
          </div>
        </div>

        <div id="global-expense-edit-${exp.id}" style="display:none;" onclick="event.stopPropagation();"></div>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function renderPaymentsList() {
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
      <div id="global-payment-card-${pay.id}" class="card" style="margin-bottom:10px; padding:14px; cursor:pointer; background:#FFFFFF; border:1px solid #A7F3D0;" onclick="editPaymentItem(${pay.id}, '${pay.tripId || ''}')">
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

function toggleGlobalExpenseExpand(expId) {
  const detailsDiv = document.getElementById(`global-expense-details-${expId}`);
  const arrow = document.getElementById(`global-exp-arrow-${expId}`);
  if (!detailsDiv) return;
  if (detailsDiv.style.display === 'none') {
    detailsDiv.style.display = 'block';
    if (arrow) arrow.innerText = 'expand_less';
  } else {
    detailsDiv.style.display = 'none';
    if (arrow) arrow.innerText = 'expand_more';
  }
}

function toggleGlobalPaymentExpand(payId) {
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

async function deleteGlobalExpenseItem(expenseId, targetId) {
  if (confirm("Вы уверены, что хотите удалить этот расход?")) {
    const item = await db.expenses.get(parseInt(expenseId));
    if (item) markItemDeleted('expenses', item);
    await db.expenses.delete(parseInt(expenseId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Расход удален!");
    await loadData();
  }
}

async function deleteGlobalPaymentItem(paymentId, targetId) {
  if (confirm("Вы уверены, что хотите удалить эту выплату?")) {
    const item = await db.payments.get(parseInt(paymentId));
    if (item) markItemDeleted('payments', item);
    await db.payments.delete(parseInt(paymentId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Выплата удалена!");
    await loadData();
  }
}

function openPhotoModal(src, caption) {
  const modal = document.getElementById('photoViewerModal');
  const img = document.getElementById('photoViewerImg');
  const cap = document.getElementById('photoViewerCaption');
  if (!modal || !img) return;

  img.src = src;
  if (cap) cap.innerText = caption || 'Чек';
  modal.style.display = 'flex';
}

function openPdfAttachment(base64, fileName) {
  if (!base64) return;
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName || 'document.pdf';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 2000);
    }
  } catch (err) {
    showToast("❌ Ошибка при открытии PDF: " + err.message);
  }
}

function saveGithubPagesToken() {
  const val = document.getElementById('githubPagesTokenInput').value.trim();
  if (!val) {
    showToast("⚠️ Введите токен с правами repo");
    return;
  }
  localStorage.setItem('github_pages_token', val);
  showToast("✅ Токен для GitHub Pages сохранен!");
}

async function deployToGitHubPages() {
  const token = localStorage.getItem('github_pages_token') || 
                document.getElementById('githubPagesTokenInput')?.value.trim() ||
                localStorage.getItem('github_token') || 
                document.getElementById('githubTokenInput')?.value.trim();

  if (!token) {
    showToast("⚠️ Пожалуйста, введите и сохраните GitHub Access Token для хостинга!");
    return;
  }

  showToast("⏳ Загружаем файлы проекта в GitHub Pages...");

  try {
    // 1. Проверяем пользователя
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!userRes.ok) {
      throw new Error(`Ошибка токена (код ${userRes.status}). Убедитесь, что токен имеет права repo.`);
    }

    const userData = await userRes.json();
    const username = userData.login;
    const repoName = 'business-trip-pwa-v2';

    // 2. Проверяем/создаем репозиторий
    const repoCheck = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
    });

    if (repoCheck.status === 404) {
      showToast("🔨 Создаем новый репозиторий на GitHub...");
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, description: 'Business Trips PWA v2', auto_init: true, has_pages: true })
      });
      if (!createRes.ok) throw new Error(`Не удалось создать репозиторий: ${createRes.status}`);
    }

    // 3. Загружаем основные файлы приложения в ветку "gh-pages"
    const filesToUpload = ['index.html', 'style.css', 'app.js', 'db.js', 'reports.js', 'sw.js', 'manifest.json'];
    
    for (const filePath of filesToUpload) {
      try {
        const fileResp = await fetch(`./${filePath}`);
        if (!fileResp.ok) continue;
        const textContent = await fileResp.text();
        const b64 = btoa(unescape(encodeURIComponent(textContent)));

        const existResp = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${filePath}?ref=gh-pages`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
        });

        let sha = null;
        if (existResp.ok) {
          const existData = await existResp.json();
          sha = existData.sha;
        }

        await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${filePath}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Deploy ${filePath} to GitHub Pages`,
            content: b64,
            branch: 'gh-pages',
            ...(sha ? { sha } : {})
          })
        });
      } catch (fErr) {
        console.warn(`Ошибка загрузки файла ${filePath}:`, fErr);
      }
    }

    // 4. Включаем GitHub Pages
    await fetch(`https://api.github.com/repos/${username}/${repoName}/pages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { branch: 'gh-pages', path: '/' } })
    }).catch(() => {});

    const ghPagesUrl = `https://${username}.github.io/${repoName}/`;
    localStorage.setItem('gh_pages_url', ghPagesUrl);

    const banner = document.getElementById('ghPagesBanner');
    if (banner) {
      banner.style.display = 'block';
      banner.style.background = '#E6F4EA';
      banner.style.border = '1px solid #CEEAD6';
      banner.style.color = '#137333';
      banner.innerHTML = `🟢 <strong>Файлы приложения успешно выгружены!</strong><br>Ваша постоянная ссылка GitHub Pages: <a href="${ghPagesUrl}" target="_blank" style="color:#137333; font-weight:bold; text-decoration:underline;">${ghPagesUrl}</a><div style="margin-top:6px; font-size:11px; color:#555;">(Примечание: GitHub Pages требуется от 30 до 60 секунд для первичного запуска страницы на сервере)</div>`;
    }

    showToast(`✅ Файлы выгружены! Ссылка: ${ghPagesUrl}`, 12000);
  } catch (err) {
    const banner = document.getElementById('ghPagesBanner');
    if (banner) {
      banner.style.display = 'block';
      banner.style.background = '#FFEBEE';
      banner.style.border = '1px solid #EF9A9A';
      banner.style.color = '#C62828';
      banner.innerHTML = `❌ <strong>Ошибка публикации:</strong> ${err.message}`;
    }
    showToast("❌ Ошибка публикации: " + err.message, 15000);
  }
}

function closePhotoModal() {
  const modal = document.getElementById('photoViewerModal');
  if (modal) modal.style.display = 'none';
}

function cancelInlineExpenseEdit(expenseId, tripId) {
  closeActiveChildForm();
  delete inlinePhotoState[expenseId];
}

function cancelInlinePaymentEdit(paymentId, tripId) {
  closeActiveChildForm();
}

let quickSelectedFile = null;

async function openQuickAddModal() {
  const modal = document.getElementById('quickAddModal');
  const tripSelect = document.getElementById('quickExpenseTripId');
  if (!modal || !tripSelect) return;

  const trips = await db.trips.toArray();
  tripSelect.innerHTML = '';

  if (trips.length === 0) {
    tripSelect.innerHTML = '<option value="">Сначала создайте командировку</option>';
  } else {
    trips.reverse().forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.innerText = `№${t.appNo || t.id} — ${t.client || ''} (${t.target || ''})`;
      tripSelect.appendChild(opt);
    });
  }

  document.getElementById('quickExpenseDate').value = getTodayRuDate();
  document.getElementById('quickExpenseAmount').value = '';
  document.getElementById('quickExpenseDesc').value = '';
  document.getElementById('quickPreviewContainer').style.display = 'none';
  quickSelectedFile = null;

  modal.style.display = 'flex';
}

function closeQuickAddModal() {
  const modal = document.getElementById('quickAddModal');
  if (modal) modal.style.display = 'none';
}

async function previewQuickFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  quickSelectedFile = file;

  const previewContainer = document.getElementById('quickPreviewContainer');
  const previewImg = document.getElementById('quickPreviewImg');
  const previewName = document.getElementById('quickFileNamePreview');

  const res = await compressImage(file);
  quickSelectedFile.compressed = res;

  if (previewContainer) previewContainer.style.display = 'block';

  if (res.isImg && res.dataUrl) {
    if (previewImg) {
      previewImg.src = res.dataUrl;
      previewImg.style.display = 'inline-block';
    }
    if (previewName) previewName.innerText = `📷 Фото: ${res.name}`;
  } else {
    if (previewImg) previewImg.style.display = 'none';
    if (previewName) previewName.innerText = `📄 Документ PDF: ${res.name}`;
  }
}

async function handleQuickAddExpense(event) {
  event.preventDefault();
  const tripId = document.getElementById('quickExpenseTripId').value;
  if (!tripId) {
    showToast("Выберите командировку!");
    return;
  }

  const rawDate = document.getElementById('quickExpenseDate').value;
  const amount = parseFloat(document.getElementById('quickExpenseAmount').value);
  const desc = document.getElementById('quickExpenseDesc').value;
  const paymentType = document.getElementById('quickExpensePaymentType')?.value || 'cash';

  let base64 = '';
  let fileName = '';

  if (quickSelectedFile && quickSelectedFile.compressed) {
    base64 = quickSelectedFile.compressed.base64;
    fileName = quickSelectedFile.compressed.name;
  }

  await db.expenses.add({
    tripId: tripId,
    date: formatDateToRu(rawDate),
    amount: amount,
    description: desc,
    paymentType: paymentType,
    receiptBase64: base64,
    receiptName: fileName,
    updatedAt: new Date().toISOString()
  });

  showToast("✅ Чек сохранен!");
  closeQuickAddModal();
  await loadData();
}
