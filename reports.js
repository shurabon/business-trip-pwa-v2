import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { db, getAggregatedSummary } from './db.js';

// Экспорт базы в форматированный документ Excel (.xlsx)
export async function exportToExcel() {
  const summaryData = await getAggregatedSummary();
  const trips = await db.trips.toArray();
  const expenses = await db.expenses.toArray();
  const payments = await db.payments.toArray();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Учет Командировок PWA';
  workbook.created = new Date();

  // Вкладка 1: Сводный баланс
  const summarySheet = workbook.addWorksheet('Баланс');
  summarySheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Заявка сервиса', key: 'appNo', width: 16 },
    { header: 'Клиент', key: 'client', width: 22 },
    { header: 'Место', key: 'location', width: 25 },
    { header: 'Статус', key: 'status', width: 15 },
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
      description: e.description
    });
  });

  // Генерация и скачивание
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Авансовый_Отчет_Командировки_${new Date().toISOString().split('T')[0]}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// Генерация авансового отчета в PDF с прикрепленными фотографиями чеков
export async function exportToPDF(tripId) {
  const trip = await db.trips.get(parseInt(tripId));
  if (!trip) throw new Error('Командировка не найдена');

  const expenses = await db.expenses.where('tripId').equals(String(tripId)).toArray();
  const payments = await db.payments.where('tripId').equals(String(tripId)).toArray();

  const doc = new jsPDF();
  
  // Добавляем кириллицу стандартным шрифтом
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

  // Фотографии чеков на отдельных страницах
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
