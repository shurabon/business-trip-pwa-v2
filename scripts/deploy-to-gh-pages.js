import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const projectDir = '/home/shu/Projects/business-trip-pwa-v2';

function apiRequest(urlPath, method, token, data) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: urlPath,
      method: method,
      headers: {
        'User-Agent': 'NodeJS-Deployer',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            resolve({ error: true, status: res.statusCode, data: parsed });
          }
        } catch (e) {
          resolve({ error: true, status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runDeploy() {
  const token = process.env.GITHUB_TOKEN || process.argv[2];
  if (!token) {
    console.error('❌ Ошибка: GitHub Token не передан. Запустите: node scripts/deploy-to-gh-pages.js <ваш_github_token>');
    process.exit(1);
  }

  console.log('🔍 Проверяем профиль GitHub...');
  const userRes = await apiRequest('/user', 'GET', token);
  if (userRes.error) {
    console.error('❌ Ошибка аутентификации в GitHub:', userRes);
    process.exit(1);
  }

  const username = userRes.login;
  const repoName = 'business-trip-pwa-v2';
  console.log(`✅ Пользователь GitHub: ${username}`);

  console.log(`📦 Проверяем наличие репозитория ${repoName}...`);
  let repoRes = await apiRequest(`/repos/${username}/${repoName}`, 'GET', token);

  if (repoRes.error && repoRes.status === 404) {
    console.log(`🔨 Создаем репозиторий ${repoName} на GitHub...`);
    repoRes = await apiRequest('/user/repos', 'POST', token, {
      name: repoName,
      description: 'Учет Командировок PWA v2',
      private: false,
      has_pages: true
    });
    if (repoRes.error) {
      console.error('❌ Ошибка создания репозитория:', repoRes);
      process.exit(1);
    }
    console.log(`✅ Репозиторий ${repoName} создан!`);
  } else {
    console.log(`✅ Репозиторий ${repoName} уже существует.`);
  }

  console.log('🛠 Собираем прод-версию (npm run build)...');
  execSync('npm run build', { cwd: projectDir, stdio: 'inherit' });

  const remoteUrl = `https://${token}@github.com/${username}/${repoName}.git`;

  console.log('🚀 Выгружаем dist в ветку gh-pages...');
  try {
    execSync(`npx -y gh-pages -d dist -r ${remoteUrl} -f`, { cwd: projectDir, stdio: 'inherit' });
  } catch (err) {
    console.error('❌ Ошибка выгрузки в gh-pages:', err);
    process.exit(1);
  }

  console.log('⚙️ Включаем GitHub Pages для ветки gh-pages...');
  await apiRequest(`/repos/${username}/${repoName}/pages`, 'POST', token, {
    source: { branch: 'gh-pages', path: '/' }
  }).catch(() => {});

  const pagesUrl = `https://${username}.github.io/${repoName}/`;
  console.log('\n🎉 ====================================================');
  console.log(`🎉 УСПЕШНО ОПУБЛИКОВАНО НА GITHUB PAGES!`);
  console.log(`🌐 Ваша постоянная ссылка: ${pagesUrl}`);
  console.log('====================================================\n');
}

runDeploy();
