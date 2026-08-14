import sys

with open('app.js', 'r') as f:
    content = f.read()

# Chunk 1: updateNetworkStatus in DOMContentLoaded
content = content.replace("document.addEventListener('DOMContentLoaded', async () => {\n  await seedInitialData();", 
"document.addEventListener('DOMContentLoaded', async () => {\n  updateNetworkStatus();\n  await seedInitialData();")

# Chunk 2: Add functions
funcs = """
function updateNetworkStatus() {
  const badge = document.getElementById('networkStatusBadge');
  if (!badge) return;
  if (navigator.onLine) {
    badge.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">wifi</span> Online`;
    badge.style.background = '#E6F4EA';
    badge.style.color = '#137333';
  } else {
    badge.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">wifi_off</span> Offline`;
    badge.style.background = '#FCE8E6';
    badge.style.color = '#C5221F';
  }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePhotoModal();
    closeQuickAddModal();
    if (typeof closeEditBottomSheet === 'function') closeEditBottomSheet();
  }
});

function getTodayIsoDate() {"""
content = content.replace("function getTodayIsoDate() {", funcs)

# Chunk 3: Remove Github Pages setup
to_remove_setup = """  // Загружаем GitHub Pages токен из localStorage
  const savedPagesToken = localStorage.getItem('github_pages_token');
  if (savedPagesToken && document.getElementById('githubPagesTokenInput')) {
    document.getElementById('githubPagesTokenInput').value = savedPagesToken;
  }

  const savedPagesUrl = localStorage.getItem('gh_pages_url');
  if (savedPagesUrl && document.getElementById('ghPagesBanner')) {
    const banner = document.getElementById('ghPagesBanner');
    banner.style.display = 'block';
    banner.innerHTML = `🟢 Ваша постоянная страница GitHub Pages: <a href="${savedPagesUrl}" target="_blank" style="color:#137333; font-weight:bold;">${savedPagesUrl}</a>`;
  }"""
content = content.replace(to_remove_setup, "")

# Chunk 4: refreshTripSelects export
content = content.replace("  window.deployToGitHubPages = deployToGitHubPages;\n  window.saveGithubPagesToken = saveGithubPagesToken;", "  window.refreshTripSelects = refreshTripSelects;")

# Chunk 5: add refreshTripSelects definition
refresh_func = """
async function refreshTripSelects() {
  const trips = await db.trips.toArray();
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
    const currentExpVal = expTripSelect.value;
    expTripSelect.innerHTML = expTrips.length === 0 ? '<option value="">(Нет активных командировок)</option>' : '';
    expTrips.forEach(t => {
      expTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
    if (currentExpVal) expTripSelect.value = currentExpVal;
  }

  if (payTripSelect) {
    const currentPayVal = payTripSelect.value;
    payTripSelect.innerHTML = payTrips.length === 0 ? '<option value="">(Нет активных командировок)</option>' : '';
    payTrips.forEach(t => {
      payTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
    if (currentPayVal) payTripSelect.value = currentPayVal;
  }

  if (reportTripSelect) {
    const currentRepVal = reportTripSelect.value;
    reportTripSelect.innerHTML = repTrips.length === 0 ? '<option value="">(Нет активных командировок)</option>' : '';
    repTrips.forEach(t => {
      reportTripSelect.innerHTML += `<option value="${t.id}">№${t.appNo || t.id} — ${t.client || 'Поездка'} (${t.startDate || ''})</option>`;
    });
    if (currentRepVal) reportTripSelect.value = currentRepVal;
  }
}

function renderDictionariesManager(dicts) {"""
content = content.replace("function renderDictionariesManager(dicts) {", refresh_func)

# Chunk 8: Scroll lock Quick Add
content = content.replace("function closeQuickAddModal() {\n  const modal = document.getElementById('quickAddModal');\n  if (modal) modal.style.display = 'none';\n}", "function closeQuickAddModal() {\n  const modal = document.getElementById('quickAddModal');\n  if (modal) modal.style.display = 'none';\n  document.body.style.overflow = '';\n}")

content = content.replace("  modal.style.display = 'flex';\n}", "  modal.style.display = 'flex';\n  document.body.style.overflow = 'hidden';\n}")


with open('app.js', 'w') as f:
    f.write(content)

