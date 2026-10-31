import fs from 'fs';
import path from 'path';

const CLOUD_APK_BASE = 'https://pwabuilder-cloudapk.azurewebsites.net';
const SITE_URL = 'https://app.danilovhome.keenetic.pro';
const MANIFEST_URL = 'https://app.danilovhome.keenetic.pro/manifest.json';

async function main() {
  console.log('🚀 1. Загружаем и проверяем актуальный манифест с сервера...');
  const manifestRes = await fetch(MANIFEST_URL);
  if (!manifestRes.ok) {
    throw new Error(`Ошибка загрузки манифеста: ${manifestRes.status}`);
  }
  const manifest = await manifestRes.json();
  console.log(`✅ Манифест загружен: "${manifest.name}" (id: ${manifest.id})`);

  const packageOptions = {
    appVersion: '1.0.0.0',
    appVersionCode: 1,
    backgroundColor: manifest.background_color || '#F8F9FE',
    display: manifest.display || 'standalone',
    enableNotifications: false,
    enableSiteSettingsShortcut: true,
    fallbackType: 'customtabs',
    features: {
      locationDelegation: { enabled: false },
      playBilling: { enabled: false }
    },
    host: 'app.danilovhome.keenetic.pro',
    iconUrl: `${SITE_URL}/icon-512.png`,
    maskableIconUrl: `${SITE_URL}/icon-maskable-512.png`,
    monochromeIconUrl: '',
    includeSourceCode: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    launcherName: manifest.short_name || 'Командировки',
    name: manifest.name || 'Учет Командировок PWA',
    navigationColor: manifest.theme_color || '#1055CC',
    navigationColorDark: '#000000',
    navigationDividerColor: manifest.theme_color || '#1055CC',
    navigationDividerColorDark: '#000000',
    orientation: 'default',
    packageId: manifest.id || 'ru.danilovhome.businesstrips',
    pwaUrl: SITE_URL,
    shortcuts: (manifest.shortcuts || []).map(s => ({
      name: s.name,
      shortName: s.short_name,
      url: new URL(s.url, SITE_URL).toString(),
      icon: `${SITE_URL}/icon-192.png`
    })),
    signingMode: 'new',
    signing: {
      alias: 'businesstrips',
      fullName: 'Shura Danilov',
      organization: 'Danilov Home',
      organizationalUnit: 'Engineering',
      countryCode: 'RU',
      keyPassword: 'businesstrips2026',
      storePassword: 'businesstrips2026'
    },
    splashScreenFadeOutDuration: 300,
    startUrl: '/',
    themeColor: manifest.theme_color || '#1055CC',
    themeColorDark: '#000000',
    webManifestUrl: MANIFEST_URL,
    fullScopeUrl: new URL(manifest.scope || '/', SITE_URL).toString(),
    minSdkVersion: 24
  };

  console.log('\n📦 2. Отправляем запрос на сборку APK в облачный сервис PWABuilder...');
  const enqueueRes = await fetch(`${CLOUD_APK_BASE}/enqueuePackageJob`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PWABuilder-Client'
    },
    body: JSON.stringify(packageOptions)
  });

  if (!enqueueRes.ok) {
    const errText = await enqueueRes.text();
    throw new Error(`Ошибка постановки в очередь PWABuilder: ${enqueueRes.status} ${errText}`);
  }

  const jobReceipt = await enqueueRes.json();
  console.log(`✅ Задача создана! ID задачи: ${jobReceipt.id}`);
  const jobId = jobReceipt.id;
  const token = jobReceipt.accessToken;

  console.log('\n⏳ 3. Ожидаем завершения облачной компиляции APK...');
  let jobStatus = 'queued';
  let attempts = 0;
  const maxAttempts = 60; // До 3-4 минут

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 4000));
    attempts++;

    const statusRes = await fetch(`${CLOUD_APK_BASE}/getPackageJob?id=${encodeURIComponent(jobId)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!statusRes.ok) {
      console.log(`   [Попытка ${attempts}] Статус ответа API: ${statusRes.status}`);
      continue;
    }

    const job = await statusRes.json();
    jobStatus = String(job.status || job.state || '').toLowerCase();
    console.log(`   [Попытка ${attempts}/${maxAttempts}] Статус сборки: ${job.status || job.state}`);

    if (jobStatus === 'completed' || jobStatus === 'success' || jobStatus === 'done') {
      console.log('🎉 Сборка APK успешно завершена!');
      break;
    } else if (jobStatus === 'failed' || jobStatus === 'error') {
      throw new Error(`Сборка в PWABuilder завершилась с ошибкой: ${JSON.stringify(job)}`);
    }
  }

  if (jobStatus !== 'completed' && jobStatus !== 'success' && jobStatus !== 'done') {
    throw new Error(`Превышено время ожидания сборки (статус: ${jobStatus})`);
  }

  console.log('\n📥 4. Скачиваем готовый пакет с APK...');
  const downloadRes = await fetch(`${CLOUD_APK_BASE}/downloadPackageZip?id=${encodeURIComponent(jobId)}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!downloadRes.ok) {
    throw new Error(`Ошибка скачивания пакета: ${downloadRes.status}`);
  }

  const arrayBuffer = await downloadRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const outZipPath = path.resolve('business-trip-pwa-android.zip');
  fs.writeFileSync(outZipPath, buffer);
  console.log(`✅ Архив пакета успешно сохранён: ${outZipPath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(err => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
