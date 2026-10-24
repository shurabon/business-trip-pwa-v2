/**
 * ====================================================================
 * МОДУЛЬ: ui-expenses.js
 * Назначение: Управление расходами и чеками
 * - Сжатие изображений чеков (Canvas) и обработка PDF
 * - Добавление расхода (основная форма и быстрое модальное окно)
 * - Полноэкранный просмотр фото чеков и открытие PDF
 * - Общий список расходов с фильтрацией по периодам
 * - Инлайн-редактирование и мягкое удаление расходов
 * ====================================================================
 */

import { db, formatDateToRu, parseRuDate } from '../db.js';
import { createPbExpense, updatePbExpense, deletePbExpense } from '../pocketbaseSync.js';
import { showToast, scheduleAutoSync, toId, isPdfFile, isDateInPeriod, highlightSelectedItem, closeEditBottomSheet, openPdfAttachment, applyDesktopModalStyle } from './ui-utils.js';
import { activeTripId } from './ui-trips.js';

export let selectedFileBase64 = null;
export let selectedFileName = null;
export let inlinePhotoState = {};
export let quickSelectedFile = null;

/**
 * Сжатие изображения чека с помощью HTML5 Canvas
 * @param {File} file
 * @returns {Promise<{base64: string, name: string, dataUrl?: string, isImg: boolean}>}
 */
export function compressImage(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ base64: '', name: '', isImg: false });
      return;
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ base64: e.target.result.split(',')[1], name: file.name, isImg: false });
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

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const base64 = compressedDataUrl.split(',')[1];
        let finalName = file.name || 'receipt.jpg';
        if (finalName.toLowerCase().endsWith('.pdf')) {
          finalName = finalName.replace(/\.pdf$/i, '.jpg');
        } else if (!/\.(jpg|jpeg|png|webp)$/i.test(finalName)) {
          finalName += '.jpg';
        }
        resolve({ base64, name: finalName, dataUrl: compressedDataUrl, isImg: true });
      };
      img.onerror = () => {
        resolve({ base64: e.target.result.split(',')[1], name: file.name, isImg: false });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Предпросмотр выбранного файла чека в основной форме
 */
export async function previewFile(event) {
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

/**
 * Очистка прикрепленного фото чека в основной форме
 */
export function clearReceiptPhoto() {
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

/**
 * Сохранение нового расхода из основной формы вкладки «Расходы»
 */
export async function handleAddExpense(event) {
  event.preventDefault();
  const tripId = document.getElementById('expenseTripId').value;
  if (!tripId) {
    showToast("Выберите командировку");
    return;
  }

  const paymentType = document.getElementById('expensePaymentType')?.value || 'cash';
  const expData = {
    tripId: tripId,
    date: formatDateToRu(document.getElementById('expenseDate').value),
    amount: parseFloat(document.getElementById('expenseAmount').value) || 0,
    description: document.getElementById('expenseDesc').value,
    paymentType: paymentType,
    articleCode: ''
  };
  try {
    let fileBlob = null;
    if (selectedFileBase64) {
      fileBlob = await (await fetch(`data:image/jpeg;base64,${selectedFileBase64}`)).blob();
    }
    await createPbExpense(expData, fileBlob, selectedFileName);
    showToast("✅ Чек сохранен на сервере!");
  } catch (err) {
    console.error("Save expense error:", err);
    await db.expenses.add({ ...expData, receiptBase64: selectedFileBase64 || '', receiptName: selectedFileName || '' });
    showToast("⚠️ Сохранено локально: " + err.message);
  }
  document.getElementById('expenseForm').reset();
  if (window.setupDefaults) window.setupDefaults();
  clearReceiptPhoto();
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Полноэкранный модальный просмотрщик фото чека
 */
export function openPhotoModal(src, caption) {
  const modal = document.getElementById('photoViewerModal');
  const img = document.getElementById('photoViewerImg');
  const pdfFrame = document.getElementById('photoViewerPdfFrame');
  const cap = document.getElementById('photoViewerCaption');
  if (!modal) return;

  if (pdfFrame) {
    pdfFrame.style.display = 'none';
    pdfFrame.src = '';
  }
  if (img) {
    img.src = src;
    img.style.display = 'block';
  }
  if (cap) cap.innerText = caption || 'Чек';
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closePhotoModal() {
  const modal = document.getElementById('photoViewerModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

/**
 * Быстрое добавление расхода (через модальное окно Speed Dial)
 */
export function openQuickAddModal() {
  const modal = document.getElementById('quickAddModal');
  const tripSelect = document.getElementById('quickExpenseTripId');
  if (!modal || !tripSelect) return;

  const todayRu = document.getElementById('expenseDate')?.value || '';
  if (document.getElementById('quickExpenseDate')) {
    document.getElementById('quickExpenseDate').value = todayRu;
  }
  if (document.getElementById('quickExpenseAmount')) document.getElementById('quickExpenseAmount').value = '';
  if (document.getElementById('quickExpenseDesc')) document.getElementById('quickExpenseDesc').value = '';

  const quickPreview = document.getElementById('quickPreviewContainer');
  if (quickPreview) quickPreview.style.display = 'none';
  quickSelectedFile = null;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeQuickAddModal() {
  const modal = document.getElementById('quickAddModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

export async function previewQuickFile(event) {
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

export async function handleQuickAddExpense(event) {
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

  const newExpObj = {
    tripId: tripId,
    date: formatDateToRu(rawDate),
    amount: amount,
    description: desc,
    paymentType: paymentType,
    receiptBase64: base64,
    receiptName: fileName,
    updatedAt: new Date().toISOString()
  };

  try {
    let fileBlob = null;
    if (base64) {
      fileBlob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
    }
    await createPbExpense(newExpObj, fileBlob, fileName);
    showToast("✅ Чек сохранен на сервере!");
  } catch (err) {
    console.error("Quick add expense error:", err);
    await db.expenses.add(newExpObj);
    showToast("⚠️ Сохранено локально: " + err.message);
  }
  closeQuickAddModal();
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

/**
 * Открытие модального окна редактирования существующего расхода
 * @param {string} expenseId
 * @param {string} [tripId]
 */
export async function editExpenseItem(expenseId, tripId) {
  let exp = await db.expenses.get(toId(expenseId));
  if (!exp) exp = await db.expenses.get(String(expenseId));
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
  const receiptSrc = exp.receiptUrl || (exp.receiptBase64 ? `data:image/jpeg;base64,${exp.receiptBase64}` : '');
  const isPdf = isPdfFile(exp);

  if (receiptSrc || exp.receiptBase64) {
    if (isPdf) {
      photoPreviewHtml = `<div id="edit-photo-preview-${expenseId}" style="margin: 8px 0;"><span class="badge" style="background:#E53935; color:#fff; cursor:pointer; font-size:12px; padding:6px 12px; display:inline-flex; align-items:center; gap:6px;" onclick="event.stopPropagation(); openPdfAttachment('${exp.receiptBase64 || ''}', '${exp.receiptName || 'doc.pdf'}', '${exp.receiptUrl || ''}')"><span class="material-symbols-outlined" style="font-size:16px;">picture_as_pdf</span> 📄 Открыть PDF: ${exp.receiptName || 'Документ'}</span></div>`;
    } else {
      photoPreviewHtml = `<div id="edit-photo-preview-${expenseId}" style="margin: 8px 0; text-align:center;"><img src="${receiptSrc}" style="max-width:100%; max-height:160px; border-radius:8px; border:1px solid #888; cursor:pointer;" onclick="event.stopPropagation(); openPhotoModal('${receiptSrc}', 'Чек')"></div>`;
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

    <form onsubmit="event.preventDefault(); saveInlineExpense('${expenseId}', '${tripId || ''}', '${targetId}');">
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

        <input type="file" id="editCameraInput-${expenseId}" accept="image/*" capture="environment" style="display:none;" onchange="handleEditPhotoChange('${expenseId}', event)">
        <input type="file" id="editGalleryInput-${expenseId}" accept="image/*,application/pdf" style="display:none;" onchange="handleEditPhotoChange('${expenseId}', event)">

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button type="button" class="btn btn-secondary" style="flex:1; padding:8px 6px; font-size:13px;" onclick="document.getElementById('editCameraInput-${expenseId}').click();">
            <span class="material-symbols-outlined" style="font-size:18px;">photo_camera</span> Камера
          </button>
          <button type="button" class="btn btn-secondary" style="flex:1; padding:8px 6px; font-size:13px;" onclick="document.getElementById('editGalleryInput-${expenseId}').click();">
            <span class="material-symbols-outlined" style="font-size:18px;">photo_library</span> Файл
          </button>
          <button type="button" class="btn btn-secondary" style="flex:1; padding:8px 6px; font-size:13px; color:#E53935;" onclick="clearEditPhoto('${expenseId}')">
            ✕ Удалить
          </button>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px; width:100%;">
        <button type="submit" class="btn" style="width:100%; padding: 12px; font-size:15px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:8px;">
          <span class="material-symbols-outlined" style="font-size:20px;">save</span> Сохранить расход
        </button>
        <div style="display:flex; gap:10px; width:100%;">
          <button type="button" class="btn btn-secondary" style="flex:1; padding: 10px; font-size:13px; color:#E53935; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="${tripId ? `deleteExpenseItem('${expenseId}', '${tripId}', '${targetId}')` : `deleteGlobalExpenseItem('${expenseId}', '${targetId}')`}">
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

export async function handleEditPhotoChange(expenseId, event) {
  const file = event.target.files[0];
  if (!file) return;

  const res = await compressImage(file);
  inlinePhotoState[expenseId] = {
    base64: res.base64,
    name: res.name,
    receiptUrl: null
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

export function clearEditPhoto(expenseId) {
  if (confirm("Вы уверены, что хотите удалить фото чека?")) {
    inlinePhotoState[expenseId] = { base64: '', name: '', receiptUrl: null };
    const previewDiv = document.getElementById(`edit-photo-preview-${expenseId}`);
    if (previewDiv) {
      previewDiv.innerHTML = '<div style="color:#888; font-size:12px; text-align:center;">Фото удалено</div>';
    }
  }
}

export async function saveInlineExpense(expenseId, tripId, targetId) {
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
    updateData.receiptUrl = photoData.receiptUrl !== undefined ? photoData.receiptUrl : null;
  }

  await db.expenses.update(toId(expenseId), updateData);
  let photoBlob = null;
  if (photoData.base64) {
    try { photoBlob = await (await fetch(`data:image/jpeg;base64,${photoData.base64}`)).blob(); } catch(_) {}
  }
  await updatePbExpense(toId(expenseId), updateData, photoBlob, photoData.name).catch(console.error);

  closeEditBottomSheet(targetId);
  showToast("✅ Расход обновлен!");
  delete inlinePhotoState[expenseId];
  if (window.loadData) await window.loadData();
  scheduleAutoSync(500);
}

export function cancelInlineExpenseEdit(expenseId, tripId) {
  delete inlinePhotoState[expenseId];
  closeEditBottomSheet();
}

/**
 * Мягкое удаление расхода (Soft Delete)
 */
export async function deleteExpenseItem(expenseId, tripId, targetId) {
  if (confirm("Вы уверены, что хотите удалить этот расход?")) {
    await deletePbExpense(toId(expenseId)).catch(console.error);
    await db.expenses.delete(toId(expenseId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Расход помечен на удаление!");
    if (window.loadData) await window.loadData();
    scheduleAutoSync(500);
  }
}

export async function deleteGlobalExpenseItem(expenseId, targetId) {
  if (confirm("Вы уверены, что хотите удалить этот расход?")) {
    await deletePbExpense(toId(expenseId)).catch(console.error);
    await db.expenses.delete(toId(expenseId));
    closeEditBottomSheet(targetId);
    showToast("🗑 Расход помечен на удаление!");
    if (window.loadData) await window.loadData();
    scheduleAutoSync(500);
  }
}

export function toggleGlobalExpenseExpand(expId) {
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

/**
 * Рендеринг общего списка расходов во вкладке «Расходы»
 */
export async function renderExpensesList() {
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

    const receiptSrc = exp.receiptUrl || (exp.receiptBase64 ? `data:image/jpeg;base64,${exp.receiptBase64}` : '');
    const isPdf = isPdfFile(exp);

    if (receiptSrc || exp.receiptBase64) {
      if (isPdf) {
        icon = 'picture_as_pdf';
        fileBadge = ` <span class="badge" style="background:#E53935; color:#fff; font-size:10px; padding:2px 6px; cursor:pointer;" onclick="event.stopPropagation(); openPdfAttachment('${exp.receiptBase64 || ''}', '${exp.receiptName || 'doc.pdf'}', '${exp.receiptUrl || ''}')">📄 PDF ↗</span>`;
      } else {
        const title = `${(exp.description || 'Чек').replace(/'/g, "\\'")} — ${exp.amount} руб.`;
        fileBadge = ` <span class="badge" style="background:var(--md-sys-color-primary); color:#fff; font-size:10px; padding:2px 6px; cursor:pointer;" onclick="event.stopPropagation(); openPhotoModal('${receiptSrc}', '${title}')">📷 Фото 🔍</span>`;
      }
    }

    html += `
      <div id="global-expense-card-${exp.id}" class="card" style="margin-bottom:10px; padding:14px; cursor:pointer; background:#FFFFFF; border:none; box-shadow:0 3px 14px rgba(0,0,0,0.05);" onclick="editExpenseItem('${exp.id}', '${exp.tripId || ''}')">
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
