import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
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
  const ws = workbook.addWorksheet('Авансовый отчет');

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
  ws.getCell(`D${totalExpenseRow}`).value = { formula: `SUM(D6:D${totalExpenseRow - 1})` };
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
  rowIdx += 2;

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
  ws.getCell(`D${cashlessTotalRow}`).value = { formula: `SUM(D${startCashlessDataRow}:D${cashlessTotalRow - 1})` };
  ws.getCell(`D${cashlessTotalRow}`).font = { bold: true };
  rowIdx += 2;

  // Финальная строка ИТОГО нал. и безнал.
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

// 3. Генерация авансового отчета в PDF с прикрепленными фотографиями чеков
export async function exportToPDF(tripId) {
  const trip = await db.trips.get(parseInt(tripId));
  if (!trip) throw new Error('Командировка не найдена');

  const expenses = await db.expenses.where('tripId').equals(String(tripId)).toArray();

  const doc = new jsPDF();
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Advance Report / Trip ID #${trip.id}`, 14, 20);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Service Application: ${trip.appNo || '-'}`, 14, 30);
  doc.text(`Client: ${trip.client || '-'}`, 14, 37);
  doc.text(`Location: ${trip.location || '-'}`, 14, 44);
  doc.text(`Work Type: ${trip.workType || '-'}`, 14, 51);
  doc.text(`Dates: ${trip.startDate} - ${trip.finishDate}`, 14, 58);
  doc.text(`Transport: ${trip.transport || '-'}`, 14, 65);

  let y = 78;
  doc.setFont("helvetica", "bold");
  doc.text("Receipts & Expenses:", 14, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  let expTotal = 0;
  expenses.forEach((e, idx) => {
    expTotal += parseFloat(e.amount) || 0;
    doc.text(`${idx + 1}. Date: ${e.date} | Amount: ${e.amount} rub. | Desc: ${e.description || ''}`, 14, y);
    y += 7;
  });

  y += 5;
  doc.setFont("helvetica", "bold");
  doc.text(`Total Receipts: ${expTotal} rub.`, 14, y);

  for (const e of expenses) {
    if (e.receiptBase64) {
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.text(`Receipt Photo for Expense #${e.id} (${e.amount} rub - ${e.description})`, 14, 15);
      try {
        doc.addImage(`data:image/jpeg;base64,${e.receiptBase64}`, 'JPEG', 14, 25, 180, 220);
      } catch (err) {
        doc.text(`[Image format error]`, 14, 35);
      }
    }
  }

  doc.save(`Trip_Report_ID_${trip.id}_${trip.appNo || 'app'}.pdf`);
}
