import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, HeadingLevel } from 'docx';
import { db, getAggregatedSummary, calculateTripDays, calculateCarMetrics, getCostArticleByWorkType } from './db.js';

// 1. Полный сводный экспорт всех поездок в Excel
export async function exportToExcel() {
  const summaryData = await getAggregatedSummary();
  const expenses = await db.expenses.toArray();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Учет Командировок PWA';
  workbook.created = new Date();

  // Вкладка 1: Сводный баланс
  const summarySheet = workbook.addWorksheet('Баланс');
  summarySheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Заявка сервиса', key: 'appNo', width: 18 },
    { header: 'Клиент', key: 'client', width: 24 },
    { header: 'Место', key: 'location', width: 25 },
    { header: 'Статус', key: 'status', width: 16 },
    { header: 'Командировочные (руб)', key: 'perDiemSum', width: 22 },
    { header: 'Чеки и расходы (руб)', key: 'expensesTotal', width: 22 },
    { header: 'Итого положено (руб)', key: 'totalOwed', width: 22 },
    { header: 'Получено выплат (руб)', key: 'paymentsTotal', width: 22 },
    { header: 'Итог взаиморасчетов (руб)', key: 'balance', width: 25 }
  ];

  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1055CC' } };

  summaryData.tripSummaries.forEach(s => {
    summarySheet.addRow({
      id: s.trip.id,
      appNo: s.trip.appNo,
      client: s.trip.client,
      location: s.trip.location,
      status: s.trip.status,
      perDiemSum: s.perDiemSum,
      expensesTotal: s.expensesTotal,
      totalOwed: s.totalOwed,
      paymentsTotal: s.paymentsTotal,
      balance: s.balance
    });
  });

  // Вкладка 2: Детализация чеков и расходов
  const expensesSheet = workbook.addWorksheet('Расходы и Чеки');
  expensesSheet.columns = [
    { header: 'ID Расхода', key: 'id', width: 12 },
    { header: 'ID Командировки', key: 'tripId', width: 16 },
    { header: 'Дата расхода', key: 'date', width: 16 },
    { header: 'Сумма (руб)', key: 'amount', width: 16 },
    { header: 'Способ оплаты', key: 'paymentType', width: 16 },
    { header: 'Описание / Назначение', key: 'description', width: 35 }
  ];

  expensesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  expensesSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1055CC' } };

  expenses.forEach(e => {
    expensesSheet.addRow({
      id: e.id,
      tripId: e.tripId,
      date: e.date,
      amount: parseFloat(e.amount) || 0,
      paymentType: e.paymentType === 'cashless' ? 'Безнал (Компания)' : 'Наличные',
      description: e.description
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Сводный_Реестр_Командировок_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 2000);
}

// 2. Экспорт 1-в-1 оригинальной формы АО-1 (по шаблону АО_Куротье.xls)
export async function exportAO1Excel(tripId) {
  const trip = await db.trips.get(parseInt(tripId));
  if (!trip) throw new Error('Командировка не найдена');

  const summaryData = await getAggregatedSummary();
  const tripSummary = summaryData.tripSummaries.find(s => String(s.trip.id) === String(tripId));

  const allExpenses = await db.expenses.where('tripId').equals(String(tripId)).toArray();

  // Разделение расходов на Наличные (личные) и Безналичные (компании)
  const cashExpenses = allExpenses.filter(e => e.paymentType !== 'cashless');
  const cashlessExpenses = allExpenses.filter(e => e.paymentType === 'cashless');

  const defaultArticle = getCostArticleByWorkType(trip.workType);

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Авансовый отчет', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: {
        left: 0.4,
        right: 0.4,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2
      }
    }
  });

  ws.columns = [
    { key: 'A', width: 28 }, // А: Описание / Статьи
    { key: 'B', width: 38 }, // B: Детализация / Наименование
    { key: 'C', width: 14 }, // C: Статья затрат
    { key: 'D', width: 16 }  // D: Сумма (руб)
  ];

  // Заголовок A1:D1
  ws.mergeCells('A1:D1');
  const cellA1 = ws.getCell('A1');
  cellA1.value = 'Авансовый отчет';
  cellA1.font = { name: 'Calibri', size: 16, bold: true };
  cellA1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // Должность и ФИО
  ws.getCell('A3').value = 'Должность';
  ws.getCell('A3').font = { bold: true };
  ws.getCell('B3').value = 'Сервисный инженер';

  ws.getCell('A4').value = 'Ф.И.О.';
  ws.getCell('A4').font = { bold: true };
  ws.getCell('B4').value = 'Данилов Александр Дмитриевич';

  // Заявка сервиса
  ws.getCell('A5').value = 'Заявка';
  ws.getCell('A5').font = { bold: true };
  ws.getCell('B5').value = trip.appNo || `№ ${trip.id}`;

  ws.getCell('C5').value = 'Статья затрат';
  ws.getCell('C5').font = { bold: true };
  ws.getCell('D5').value = 'Сумма';
  ws.getCell('D5').font = { bold: true };

  ws.getCell('A6').value = 'Остаток на ';
  ws.getCell('D6').value = '';

  ws.getCell('A7').value = 'Получено из кассы';
  ws.getCell('D7').value = ''; // Не заполняем "Получено из кассы" по требованию

  ws.getCell('A8').value = 'Дата расхода денежных средств';
  ws.getCell('A8').font = { bold: true };
  ws.getCell('B8').value = 'Наименование расхода';
  ws.getCell('B8').font = { bold: true };

  let rowIdx = 9;

  // Проверка наличия ручных чеков на бензин
  const hasManualFuelCheck = cashExpenses.some(exp => {
    const desc = String(exp.description || '').toLowerCase();
    return desc.includes('бензин') || desc.includes('азс') || desc.includes('топливо') || desc.includes('газ');
  });

  // 1. Суточные
  if (tripSummary && tripSummary.perDiemSum > 0) {
    ws.getCell(`A${rowIdx}`).value = trip.startDate || '';
    ws.getCell(`B${rowIdx}`).value = `Суточные (${tripSummary.days} дн. × ${trip.perDiemRate || 1100} ₽)`;
    ws.getCell(`C${rowIdx}`).value = defaultArticle;
    ws.getCell(`D${rowIdx}`).value = tripSummary.perDiemSum;
    rowIdx++;
  }

  // 2. Расход топлива (только если НЕ было вручную прикрепленного чека АЗС)
  if (!hasManualFuelCheck && tripSummary && tripSummary.carMetrics && tripSummary.carMetrics.isAuto && tripSummary.carMetrics.fuelCost > 0) {
    const cm = tripSummary.carMetrics;
    ws.getCell(`A${rowIdx}`).value = trip.startDate || '';
    ws.getCell(`B${rowIdx}`).value = `Бензин (норма ${cm.fuelRate}л/100км, ~${cm.fuelLiters.toFixed(1)}л × ${cm.fuelPricePerLiter} ₽)`;
    ws.getCell(`C${rowIdx}`).value = defaultArticle;
    ws.getCell(`D${rowIdx}`).value = cm.fuelCost;
    rowIdx++;
  }

  // (Амортизация полностью исключена из Авансового отчета АО-1 по путевому листу)

  // 3. Чеки наличными
  cashExpenses.forEach(exp => {
    ws.getCell(`A${rowIdx}`).value = exp.date || '';
    ws.getCell(`B${rowIdx}`).value = exp.description || 'Расход по чеку';
    ws.getCell(`C${rowIdx}`).value = exp.articleCode || defaultArticle;
    ws.getCell(`D${rowIdx}`).value = parseFloat(exp.amount) || 0;
    rowIdx++;
  });

  const totalExpenseRow = rowIdx;
  ws.mergeCells(`A${totalExpenseRow}:C${totalExpenseRow}`);
  ws.getCell(`A${totalExpenseRow}`).value = 'Итого:';
  ws.getCell(`A${totalExpenseRow}`).font = { bold: true };
  if (totalExpenseRow > 9) {
    ws.getCell(`D${totalExpenseRow}`).value = { formula: `SUM(D9:D${totalExpenseRow - 1})` };
  } else {
    ws.getCell(`D${totalExpenseRow}`).value = 0;
  }
  ws.getCell(`D${totalExpenseRow}`).font = { bold: true };
  rowIdx++;

  // Остаток
  ws.mergeCells(`A${rowIdx}:C${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value = 'Остаток';
  rowIdx++;

  // Перерасход
  ws.mergeCells(`A${rowIdx}:C${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value = 'Перерасход';
  rowIdx++;

  // Подпись
  ws.mergeCells(`A${rowIdx}:D${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value = 'Подпись подотчетного лица';
  ws.getCell(`A${rowIdx}`).font = { italic: true };
  rowIdx += 2;

  // 17 Статей затрат (в точности как в оригинале АО_Куротье.xls)
  ws.getCell(`A${rowIdx}`).value = 'Примечание:';
  ws.getCell(`A${rowIdx}`).font = { bold: true };
  rowIdx++;

  ws.getCell(`A${rowIdx}`).value = '1. Статьи затрат';
  ws.getCell(`A${rowIdx}`).font = { bold: true };
  rowIdx++;

  const fullDictLines = [
    '1.1 Приобретение материалов для маркетинговых целей',
    '1.1.1 Выставки',
    '1.1.2. Семинары собственные',
    '1.1.3. Семинары сторонние',
    '1.2 Приобретение материалов для ПНР (дополнительно указать № Договора)',
    '1.2.1  Приобретение материалов для ПНР Отдела продаж (дополнительно указать № Договора)',
    '1.2.2  Приобретение материалов для Отдела Сервиса',
    '1.3 Командировочные расходы для выполнения ПНР (дополнительно указать № Договора)',
    '1.3.1. Командировочные расходы для выполнения ПНР Отдела продаж (дополнительно указать № Договора)',
    '1.4 Командировочные расходы для выполнения сервисных работ (дополнительно указать № Договора, если открыт)',
    '1.4.1 Гарантийный ремонт',
    '1.4.2 Платный ремонт',
    '1.5 Командировочные расходы для развития продаж Партнеров (посещение Партнеров, участие в выездных семинарах и т.д.)',
    '1.6 Командировочные расходы на обучение Сервис Отдела',
    '1.7 Командировочные расходы на обучение Отдела Продаж',
    '1.8 Командировочные расходы для заключения Договора продажи'
  ];

  fullDictLines.forEach(line => {
    ws.getCell(`A${rowIdx}`).value = line;
    ws.getCell(`A${rowIdx}`).font = { size: 9, color: { argb: '555555' } };
    rowIdx++;
  });

  rowIdx++;

  // СЕКЦИЯ БЕЗНАЛА С ПОЛНОЙ СТЛОШНОЙ ЖЕЛТОЙ ЗАЛИВКОЙ (#FFF2CC)
  const cashlessHeaderRow = rowIdx;
  ws.mergeCells(`A${cashlessHeaderRow}:D${cashlessHeaderRow}`);
  const cHeaderCell = ws.getCell(`A${cashlessHeaderRow}`);
  cHeaderCell.value = 'ОПЛАТА БЕЗНАЛИЧНЫМ ПЕРЕВОДОМ (справочно)';
  cHeaderCell.font = { bold: true, size: 11 };
  rowIdx++;

  // Шапка безналичных оплат
  const cashlessSubHeaderRow = rowIdx;
  ws.getCell(`A${cashlessSubHeaderRow}`).value = 'Дата';
  ws.getCell(`B${cashlessSubHeaderRow}`).value = 'Цель расходования';
  ws.getCell(`C${cashlessSubHeaderRow}`).value = 'Статья затрат';
  ws.getCell(`D${cashlessSubHeaderRow}`).value = 'Сумма';

  for (let c = 1; c <= 4; c++) {
    ws.getRow(cashlessSubHeaderRow).getCell(c).font = { bold: true };
  }
  rowIdx++;

  const startCashlessDataRow = rowIdx;
  if (cashlessExpenses.length === 0) {
    rowIdx++;
  } else {
    cashlessExpenses.forEach(exp => {
      ws.getCell(`A${rowIdx}`).value = exp.date || '';
      ws.getCell(`B${rowIdx}`).value = exp.description || 'Безналичная оплата компанией';
      ws.getCell(`C${rowIdx}`).value = exp.articleCode || defaultArticle;
      ws.getCell(`D${rowIdx}`).value = parseFloat(exp.amount) || 0;
      rowIdx++;
    });
  }

  const cashlessTotalRow = rowIdx;
  ws.getCell(`B${cashlessTotalRow}`).value = 'Всего';
  ws.getCell(`B${cashlessTotalRow}`).font = { bold: true };
  if (cashlessExpenses.length > 0) {
    ws.getCell(`D${cashlessTotalRow}`).value = { formula: `SUM(D${startCashlessDataRow}:D${cashlessTotalRow - 1})` };
  } else {
    ws.getCell(`D${cashlessTotalRow}`).value = 0;
  }
  ws.getCell(`D${cashlessTotalRow}`).font = { bold: true };
  rowIdx++;

  // Финальная строка ИТОГО нал. и безнал. (идёт сразу под Всего)
  const grandTotalRow = rowIdx;
  ws.mergeCells(`A${grandTotalRow}:B${grandTotalRow}`);
  ws.getCell(`A${grandTotalRow}`).value = 'ИТОГО нал. и безнал.';
  ws.getCell(`A${grandTotalRow}`).font = { bold: true, size: 12 };
  ws.getCell(`D${grandTotalRow}`).value = { formula: `SUM(D${totalExpenseRow},D${cashlessTotalRow})` };
  ws.getCell(`D${grandTotalRow}`).font = { bold: true, size: 12 };

  // 1. Применяем СТЛОШНУЮ ЖЕЛТУЮ ЗАЛИВКОЙ (#FFF2CC) ко всей нижней секции безнала
  for (let r = cashlessHeaderRow; r <= grandTotalRow; r++) {
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2CC' } };
    }
  }

  // 2. Границы со ВСЕХ ЧЕТЫРЕХ СТОРОН для всех ячеек таблиц
  const fullBorder = {
    top: { style: 'thin', color: { argb: '444444' } },
    left: { style: 'thin', color: { argb: '444444' } },
    bottom: { style: 'thin', color: { argb: '444444' } },
    right: { style: 'thin', color: { argb: '444444' } }
  };

  // Границы верхней таблицы (строки 5 - 13)
  for (let r = 5; r <= 13; r++) {
    for (let c = 1; c <= 4; c++) {
      ws.getRow(r).getCell(c).border = fullBorder;
    }
  }

  // Границы основной таблицы чеков (строки 8 до totalExpenseRow + 2)
  for (let r = 8; r <= totalExpenseRow + 2; r++) {
    for (let c = 1; c <= 4; c++) {
      ws.getRow(r).getCell(c).border = fullBorder;
    }
  }

  // Границы безналичной секции (строки cashlessHeaderRow до grandTotalRow)
  for (let r = cashlessHeaderRow; r <= grandTotalRow; r++) {
    for (let c = 1; c <= 4; c++) {
      ws.getRow(r).getCell(c).border = fullBorder;
    }
  }

  // Форматирование денежных сумм в колонке D
  ws.eachRow((row) => {
    const cD = row.getCell('D');
    if (typeof cD.value === 'number' || (cD.value && cD.value.formula)) {
      cD.numFmt = '#,##0.00 "₽"';
    }
  });

  // Скачивание файла
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `АО_1_${trip.appNo || trip.id}_${trip.client || 'отчет'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 2000);
}

// Вспомогательная функция для определения реальных размеров base64 изображения
function getImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    };
    img.onerror = () => {
      resolve({ width: 800, height: 600 });
    };
    img.src = dataUrl;
  });
}

// 3. Генерация чистого PDF с чеками (умная сетка 2x2: до 4 чеков на лист A4, сохранение пропорций)
// Хелпер для скачивания файла чека
function triggerFileDownload(urlOrBlob, fileName) {
  const a = document.createElement('a');
  a.href = urlOrBlob;
  a.download = fileName || 'document.pdf';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
  }, 2000);
}

// 3. Генерация чистого PDF с чеками (умная сетка 2x2: до 4 чеков на лист A4, сохранение пропорций + скачивание PDF-чеков)
export async function exportToPDF(tripId) {
  const trip = await db.trips.get(parseInt(tripId));
  if (!trip) throw new Error('Командировка не найдена');

  const allExpenses = await db.expenses.toArray();
  const expenses = allExpenses.filter(e => String(e.tripId) === String(tripId));
  
  const isPdfExpense = (e) => {
    if (!e) return false;
    const base64 = String(e.receiptBase64 || '');
    const name = String(e.receiptName || '').toLowerCase();
    const url = String(e.receiptUrl || '').toLowerCase();
    if (base64.startsWith('JVBERi0') || base64.startsWith('data:application/pdf')) return true;
    if (name.endsWith('.pdf') || url.endsWith('.pdf')) return true;
    return false;
  };

  const isImageExpense = (e) => {
    if (!e) return false;
    if (isPdfExpense(e)) return false;
    return (e.receiptBase64 && String(e.receiptBase64).trim().length > 0) || (e.receiptUrl && String(e.receiptUrl).trim().length > 0);
  };

  const imageReceipts = expenses.filter(isImageExpense);
  const pdfReceipts = expenses.filter(isPdfExpense);

  if (imageReceipts.length === 0 && pdfReceipts.length === 0) {
    throw new Error('В этой командировке нет прикрепленных чеков (ни фото, ни PDF)!');
  }

  // 1. Скачиваем оригинальные PDF-чеки (если есть)
  for (let idx = 0; idx < pdfReceipts.length; idx++) {
    const exp = pdfReceipts[idx];
    let pdfUrl = exp.receiptUrl || '';
    let blobUrl = '';

    if (!pdfUrl && exp.receiptBase64) {
      const cleanBase64 = exp.receiptBase64.includes(',') ? exp.receiptBase64.split(',')[1] : exp.receiptBase64;
      const byteCharacters = atob(cleanBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let j = 0; j < byteCharacters.length; j++) {
        byteNumbers[j] = byteCharacters.charCodeAt(j);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      blobUrl = URL.createObjectURL(blob);
      pdfUrl = blobUrl;
    }

    if (pdfUrl) {
      const appClean = (trip.appNo || trip.id || 'поездка').toString().replace(/[/\\?%*:|"<>]/g, '-');
      const safeDocName = exp.receiptName || `Чек_PDF_${appClean}_${idx + 1}.pdf`;
      // Небольшая задержка между скачиваниями, чтобы браузер не блокировал множественные загрузки
      setTimeout(() => {
        triggerFileDownload(pdfUrl, safeDocName);
        if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      }, idx * 500);
    }
  }

  // 2. Если есть фото-чеки — собираем их в PDF-коллаж
  if (imageReceipts.length > 0) {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const gap = 8; // отступ между чеками

    // Сетка 2 колонки x 2 строки
    const cellWidth = (pageWidth - margin * 2 - gap) / 2; // ~91 мм
    const cellHeight = (pageHeight - margin * 2 - gap) / 2; // ~134.5 мм

    for (let i = 0; i < imageReceipts.length; i++) {
      const posInPage = i % 4; // 0: верх-лево, 1: верх-право, 2: низ-лево, 3: низ-право

      if (i > 0 && posInPage === 0) {
        doc.addPage();
      }

      const col = posInPage % 2; // 0 или 1
      const row = Math.floor(posInPage / 2); // 0 или 1

      const cellX = margin + col * (cellWidth + gap);
      const cellY = margin + row * (cellHeight + gap);

      const exp = imageReceipts[i];
      let dataUrl = '';
      if (exp.receiptBase64 && String(exp.receiptBase64).trim().length > 0) {
        dataUrl = exp.receiptBase64.startsWith('data:') 
          ? exp.receiptBase64 
          : `data:image/jpeg;base64,${exp.receiptBase64}`;
      } else if (exp.receiptUrl) {
        dataUrl = exp.receiptUrl;
      }

      try {
        const dims = await getImageDimensions(dataUrl);
        const imgRatio = dims.width / dims.height;
        const cellRatio = cellWidth / cellHeight;

        let drawW, drawH;
        if (imgRatio > cellRatio) {
          drawW = cellWidth;
          drawH = cellWidth / imgRatio;
        } else {
          drawH = cellHeight;
          drawW = cellHeight * imgRatio;
        }

        const posX = cellX + (cellWidth - drawW) / 2;
        const posY = cellY + (cellHeight - drawH) / 2;

        let format = 'JPEG';
        if (dataUrl.includes('image/png')) format = 'PNG';
        if (dataUrl.includes('image/webp')) format = 'WEBP';

        doc.addImage(dataUrl, format, posX, posY, drawW, drawH, undefined, 'FAST');
      } catch (err) {
        console.error('Ошибка вставки чека в PDF:', err);
      }
    }

    const appNoClean = (trip.appNo || trip.id || 'поездка').toString().replace(/[/\\?%*:|"<>]/g, '-');
    const clientClean = (trip.client || '').toString().replace(/[/\\?%*:|"<>]/g, '-');
    const fileName = `Фото_Чеков_${appNoClean}_${clientClean}.pdf`;

    // Задержка сохранения коллажа, чтобы не конфликтовать со скачиванием PDF-файлов
    const delay = pdfReceipts.length * 500;
    setTimeout(() => {
      doc.save(fileName);
    }, delay);
  }
}

// 4. Генерация Заявления на возмещение денежных средств в формате Word (.docx)
export async function exportReimbursementDocx(tripId) {
  const trip = await db.trips.get(parseInt(tripId));
  if (!trip) throw new Error('Командировка не найдена');

  const allExpenses = await db.expenses.toArray();
  const tripExpenses = allExpenses.filter(e => String(e.tripId) === String(tripId));
  // В заявление на возмещение включаются личные расходы (наличные/карта физлица)
  const cashExpenses = tripExpenses.filter(e => e.paymentType !== 'cashless');

  const totalAmount = cashExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const formattedTotal = totalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const appNo = trip.appNo || `№ ${trip.id}`;

  // Форматирование текущей даты (например: «16» августа 2026 года)
  const now = new Date();
  const monthsGenitive = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const dayStr = String(now.getDate()).padStart(2, '0');
  const monthStr = monthsGenitive[now.getMonth()];
  const yearStr = now.getFullYear();
  const fullDateRu = `«${dayStr}» ${monthStr} ${yearStr} года`;

  // Создаем строки таблицы
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 2200, type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: "Дата", bold: true, font: "Times New Roman" })] })]
        }),
        new TableCell({
          width: { size: 4800, type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: "Покупка", bold: true, font: "Times New Roman" })] })]
        }),
        new TableCell({
          width: { size: 2400, type: WidthType.DXA },
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Сумма, руб с НДС", bold: true, font: "Times New Roman" })] })]
        })
      ]
    })
  ];

  if (cashExpenses.length === 0) {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: trip.startDate || "-", font: "Times New Roman" })] })]
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Расходы отсутствуют", font: "Times New Roman" })] })]
          }),
          new TableCell({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "0,00", font: "Times New Roman" })] })]
          })
        ]
      })
    );
  } else {
    cashExpenses.forEach(exp => {
      const amt = (parseFloat(exp.amount) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: exp.date || trip.startDate || "-", font: "Times New Roman" })] })]
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: exp.description || "Расход по командировке", font: "Times New Roman" })] })]
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: amt, font: "Times New Roman" })] })]
            })
          ]
        })
      );
    });
  }

  // Строка Итого
  tableRows.push(
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 2,
          children: [new Paragraph({ children: [new TextRun({ text: "Итого", bold: true, font: "Times New Roman" })] })]
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: formattedTotal, bold: true, font: "Times New Roman" })] })]
        })
      ]
    })
  );

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: 1134, // ~2 см
            right: 1134,
            bottom: 1134,
            left: 1417 // ~2.5 см
          }
        }
      },
      children: [
        // Шапка справа
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { line: 276 },
          children: [new TextRun({ text: "Директору ООО «МИЛЛАБ»", font: "Times New Roman", size: 24 })]
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { line: 276 },
          children: [new TextRun({ text: "Жидкову Д.В.", font: "Times New Roman", size: 24 })]
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { line: 276 },
          children: [new TextRun({ text: "от сервисного инженера", font: "Times New Roman", size: 24 })]
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { line: 276, after: 400 },
          children: [new TextRun({ text: "Данилова А.Д.", font: "Times New Roman", size: 24 })]
        }),

        // Заголовок
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: "ЗАЯВЛЕНИЕ", bold: true, font: "Times New Roman", size: 28 })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [new TextRun({ text: "на возмещение денежных средств", bold: true, font: "Times New Roman", size: 24 })]
        }),

        // Текст заявления (универсальная формулировка)
        new Paragraph({
          alignment: AlignmentType.JUSTIFY,
          spacing: { line: 360, after: 240 },
          children: [
            new TextRun({
              text: `Прошу возместить денежные средства в размере ${formattedTotal} руб., потраченные для выполнения работ по заявке № ${appNo}. Подтверждающие документы и чеки прилагаются.`,
              font: "Times New Roman",
              size: 24
            })
          ]
        }),

        // Таблица расходов
        new Table({
          width: { size: 9400, type: WidthType.DXA },
          rows: tableRows
        }),

        // Реквизиты
        new Paragraph({
          spacing: { before: 360, line: 280 },
          children: [new TextRun({ text: "Денежные средства прошу перечислить на банковскую карту по следующим реквизитам:", font: "Times New Roman", size: 24 })]
        }),
        new Paragraph({
          spacing: { line: 260 },
          children: [new TextRun({ text: "Валюта получаемого перевода: Российский рубль (RUB)", font: "Times New Roman", size: 22 })]
        }),
        new Paragraph({
          spacing: { line: 260 },
          children: [new TextRun({ text: "Получатель: Данилов Александр Дмитриевич", font: "Times New Roman", size: 22 })]
        }),
        new Paragraph({
          spacing: { line: 260 },
          children: [new TextRun({ text: "Номер счёта: 40817810316473504942", font: "Times New Roman", size: 22 })]
        }),
        new Paragraph({
          spacing: { line: 260 },
          children: [new TextRun({ text: "Банк получателя: УРАЛЬСКИЙ БАНК ПАО СБЕРБАНК", font: "Times New Roman", size: 22 })]
        }),
        new Paragraph({
          spacing: { line: 260 },
          children: [new TextRun({ text: "БИК: 046577674", font: "Times New Roman", size: 22 })]
        }),
        new Paragraph({
          spacing: { line: 260 },
          children: [new TextRun({ text: "Корр. счёт: 30101810500000000674", font: "Times New Roman", size: 22 })]
        }),
        new Paragraph({
          spacing: { line: 260, after: 400 },
          children: [new TextRun({ text: "ИНН: 7707083893", font: "Times New Roman", size: 22 })]
        }),

        // Подпись и дата
        new Paragraph({
          spacing: { before: 200 },
          children: [
            new TextRun({ text: "Сервисный инженер Данилов А.Д.   ___________________   ", font: "Times New Roman", size: 24 }),
            new TextRun({ text: fullDateRu, font: "Times New Roman", size: 24 })
          ]
        })
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const appNoClean = (trip.appNo || trip.id || 'заявка').toString().replace(/[/\\?%*:|"<>]/g, '-');
  a.download = `Заявление_на_возмещение_ДС_${appNoClean}.docx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 2000);
}

// 5. Генерация Путевого листа легкового автомобиля в формате Word (.docx, 1 страница, альбомный A4)
export async function exportWaybillDocx(tripId) {
  const trip = await db.trips.get(parseInt(tripId));
  if (!trip) throw new Error('Командировка не найдена');

  const carMetrics = calculateCarMetrics(trip);
  if (!carMetrics || !carMetrics.isAuto) {
    throw new Error('Путевой лист формируется только для поездок на личном автомобиле!');
  }

  const odoStartVal = trip.odoStart || 0;
  const odoFinishVal = trip.odoFinish || 0;
  const distance = carMetrics.distanceKm || (odoFinishVal > odoStartVal ? odoFinishVal - odoStartVal : 0);
  const fuelRate = carMetrics.fuelRate || 8.7;
  const fuelLiters = carMetrics.fuelLiters || (distance * fuelRate / 100);
  const roundedFuel = fuelLiters.toFixed(1).replace('.', ',');
  const roundedFuelInt = Math.round(fuelLiters);

  const startRu = trip.startDate || '';
  const finishRu = trip.finishDate || startRu;
  const dateRangeStr = startRu === finishRu ? startRu : `${startRu} – ${finishRu}`;

  const clientAddress = trip.location || '';
  const clientName = trip.client || '';
  const fullDest = clientAddress.includes(clientName) ? clientAddress : (clientName ? `${clientName}, ${clientAddress}` : clientAddress);
  const routeText1 = `Екатеринбург, ул. Грибоедова 21 – ${fullDest} – Екатеринбург, ул. Грибоедова 21`;
  const routeText2 = `${fullDest} – Екатеринбург, ул. Грибоедова 21`;

  const borders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    right: { style: BorderStyle.SINGLE, size: 4, color: "000000" }
  };

  // Таблица 1: Спидометр и Топливо
  const table1 = new Table({
    width: { size: 15600, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders,
            columnSpan: 2,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "На начало", bold: true, font: "Arial", size: 18 })] })]
          }),
          new TableCell({
            borders,
            columnSpan: 2,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "На конец", bold: true, font: "Arial", size: 18 })] })]
          }),
          new TableCell({
            borders,
            columnSpan: 6,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "За период", bold: true, font: "Arial", size: 18 })] })]
          })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Показание спидометра (км)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Остаток в баке авто (л)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Показание спидометра (км)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Остаток в баке авто (л)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Заправлено (л)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Наименование топлива", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Пробег (км)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Норма расхода (л/100 км)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Расход топлива по норме (л)", font: "Arial", size: 16 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Расход топлива по факту (л)", font: "Arial", size: 16 })] })] })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(odoStartVal), bold: true, font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "35", font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(odoFinishVal), bold: true, font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "35", font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(roundedFuelInt), font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "АИ-95", font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(distance), bold: true, font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(fuelRate).replace('.', ','), font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: roundedFuel, font: "Arial", size: 18 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: roundedFuel, font: "Arial", size: 18 })] })] })
        ]
      })
    ]
  });

  // Таблица 2: Маршрут следования
  const table2 = new Table({
    width: { size: 15600, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({ borders, width: { size: 600, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "№ п/п", bold: true, font: "Arial", size: 17 })] })] }),
          new TableCell({ borders, width: { size: 2200, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Дата использования автомобиля", bold: true, font: "Arial", size: 17 })] })] }),
          new TableCell({ borders, width: { size: 12800, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Маршрут", bold: true, font: "Arial", size: 17 })] })] })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "1", font: "Arial", size: 17 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: dateRangeStr, font: "Arial", size: 17 })] })] }),
          new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text: routeText1, font: "Arial", size: 17 })] })] })
        ]
      })
    ]
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            orientation: "landscape",
            width: 16838, // A4 landscape ~297mm
            height: 11906 // A4 landscape ~210mm
          },
          margin: {
            top: 500, // компактные поля для гарантии 1 листа
            right: 500,
            bottom: 500,
            left: 600
          }
        }
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [
            new TextRun({ text: "Путевой лист легкового автомобиля KIA RIO 3", bold: true, font: "Arial", size: 24 })
          ]
        }),
        new Paragraph({
          spacing: { line: 240, after: 40 },
          children: [
            new TextRun({ text: "Организация: ", bold: true, font: "Arial", size: 18 }),
            new TextRun({ text: "ООО «МИЛЛАБ» , 127410, город Москва, улица Инженерная, дом 18, корпус 1, квартира 43", font: "Arial", size: 18 })
          ]
        }),
        new Paragraph({
          spacing: { line: 240, after: 40 },
          children: [
            new TextRun({ text: "Автомобиль: ", bold: true, font: "Arial", size: 18 }),
            new TextRun({ text: "рег. знак Х124НТ 196", font: "Arial", size: 18 })
          ]
        }),
        new Paragraph({
          spacing: { line: 240, after: 40 },
          children: [
            new TextRun({ text: "ФИО водителя: ", bold: true, font: "Arial", size: 18 }),
            new TextRun({ text: "Данилов Александр Дмитриевич", font: "Arial", size: 18 })
          ]
        }),
        new Paragraph({
          spacing: { line: 240, after: 140 },
          children: [
            new TextRun({ text: "Номер водительского удостоверения: ", bold: true, font: "Arial", size: 18 }),
            new TextRun({ text: "66 16 369586", font: "Arial", size: 18 })
          ]
        }),

        // Таблица 1
        table1,

        new Paragraph({ spacing: { before: 140, after: 80 } }),

        // Таблица 2
        table2,

        new Paragraph({ spacing: { before: 200, after: 100 } }),

        // Подписи
        new Paragraph({
          spacing: { before: 140, line: 280 },
          children: [
            new TextRun({ text: "Водитель   __________________________  (Данилов А.Д.)", font: "Arial", size: 20 }),
            new TextRun({ text: "               ", font: "Arial", size: 20 }),
            new TextRun({ text: "Главный бухгалтер   ___________________  (Кудрявцева О.А.)", font: "Arial", size: 20 })
          ]
        })
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const appClean = (trip.appNo || trip.id || 'поездка').toString().replace(/[/\\?%*:|"<>]/g, '-');
  const clientClean = (trip.client || '').toString().replace(/[/\\?%*:|"<>]/g, '-');
  a.download = `Путевой_лист_${appClean}_${clientClean}.docx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 2000);
}
