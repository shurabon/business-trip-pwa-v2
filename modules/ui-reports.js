/**
 * ====================================================================
 * МОДУЛЬ: ui-reports.js
 * Назначение: Формирование и выгрузка отчетов командировок
 * - Авансовый отчет АО-1 (Excel)
 * - Путевой лист (Word .docx)
 * - Заявление на возмещение ДС (Word .docx)
 * - Чеки командировки (PDF)
 * - Сводный реестр всех командировок (Excel)
 * ====================================================================
 */

import { exportToExcel, exportToPDF, exportAO1Excel, exportReimbursementDocx, exportWaybillDocx } from '../reports.js';
import { showToast } from './ui-utils.js';

/**
 * Генерация отчета выбранного типа из вкладки «Отчеты»
 */
export async function generateSelectedReport() {
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
    } else if (type === 'waybillDocx') {
      await exportWaybillDocx(tripId);
      showToast("🚗 Путевой лист (Word) сформирован!");
    } else if (type === 'pdf') {
      await exportToPDF(tripId);
      showToast("📕 Чеки командировки выгружены!");
    } else if (type === 'reimbursementDocx') {
      await exportReimbursementDocx(tripId);
      showToast("📝 Заявление на возмещение ДС (Word) сформировано!");
    }
  } catch (err) {
    showToast("❌ Ошибка при создании отчета: " + err);
  }
}

/**
 * Прямая выгрузка сводного реестра всех поездок в Excel
 */
export async function downloadExcelReport() {
  try {
    await exportToExcel();
    showToast("📊 Отчет Excel успешно сформирован!");
  } catch (err) {
    showToast("❌ Ошибка при экспорте Excel: " + err);
  }
}

/**
 * Выгрузка чеков выбранной командировки в PDF
 */
export async function downloadPDFReport() {
  const tripId = document.getElementById('reportTripId')?.value;
  if (!tripId) {
    showToast("Выберите командировку для PDF отчета");
    return;
  }
  try {
    await exportToPDF(tripId);
    showToast("📕 Чеки командировки выгружены!");
  } catch (err) {
    showToast("❌ Ошибка при экспорте PDF: " + err);
  }
}
