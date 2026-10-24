import fs from 'fs';
import path from 'path';

const OWNER = 'shurabon';
const REPO = 'business-trip-pwa-v2';

async function ghRequest(endpoint, method = 'GET', token, body = null) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Deployer-PWA',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${json.message || text} [${method} ${endpoint}]`);
  }
  return json;
}

async function createBlob(token, contentBuffer) {
  const base64 = contentBuffer.toString('base64');
  const res = await ghRequest('/git/blobs', 'POST', token, {
    content: base64,
    encoding: 'base64'
  });
  return res.sha;
}

function getSourceFiles(dirPath, baseDir = dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  const ignored = new Set(['node_modules', 'dist', '.git', '.gemini', 'pb_data', 'pb_public', '.github']);

  for (const file of files) {
    if (ignored.has(file) || file.endsWith('.tar.gz') || file.endsWith('.zip')) continue;
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getSourceFiles(fullPath, baseDir, arrayOfFiles);
    } else {
      arrayOfFiles.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return arrayOfFiles;
}

function getAllFiles(dirPath, baseDir = dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, baseDir, arrayOfFiles);
    } else {
      arrayOfFiles.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return arrayOfFiles;
}

export async function deployToGitHub(token) {
  if (!token) {
    console.error('❌ Не передан GitHub токен');
    process.exit(1);
  }

  console.log('🔍 Проверяем доступ к GitHub репозиторию...');
  const repo = await ghRequest('', 'GET', token);
  console.log(`✅ Доступ к ${repo.full_name} подтверждён.`);

  // 1. Выгружаем все актуальные исходники в ветку master
  console.log('\n📤 1. Выгружаем обновленный исходный код в ветку master...');
  const masterRef = await ghRequest('/git/ref/heads/master', 'GET', token);
  const masterCommitSha = masterRef.object.sha;
  const masterCommit = await ghRequest(`/git/commits/${masterCommitSha}`, 'GET', token);
  const masterBaseTreeSha = masterCommit.tree.sha;
  console.log(`   Базовый коммит: ${masterCommitSha.substring(0, 7)}, дерево: ${masterBaseTreeSha.substring(0, 7)}`);

  const projectDir = path.resolve('.');
  const sourceFiles = getSourceFiles(projectDir);
  console.log(`   Найдено ${sourceFiles.length} файлов исходного кода.`);

  const masterTreeItems = [];
  for (const relPath of sourceFiles) {
    const filePath = path.resolve(relPath);
    const buffer = fs.readFileSync(filePath);
    const blobSha = await createBlob(token, buffer);
    masterTreeItems.push({
      path: relPath,
      mode: '100644',
      type: 'blob',
      sha: blobSha
    });
    console.log(`   + ${relPath} (${blobSha.substring(0, 7)})`);
  }

  const newMasterTree = await ghRequest('/git/trees', 'POST', token, {
    base_tree: masterBaseTreeSha,
    tree: masterTreeItems
  });

  const commitMsg = 'feat: модульная архитектура app.js (modules/), Soft Delete и синхронизация с PocketBase';
  const newMasterCommit = await ghRequest('/git/commits', 'POST', token, {
    message: commitMsg,
    tree: newMasterTree.sha,
    parents: [masterCommitSha]
  });

  await ghRequest('/git/refs/heads/master', 'PATCH', token, {
    sha: newMasterCommit.sha
  });
  console.log(`✅ Ветка master успешно обновлена! (commit: ${newMasterCommit.sha.substring(0, 7)})`);

  // 2. Обновляем ветку gh-pages со свежей сборкой (dist)
  console.log('\n🚀 2. Выгружаем продакшн сборку (dist) в ветку gh-pages...');
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('Папка dist не найдена.');
  }

  let ghPagesCommitSha = null;
  try {
    const ghPagesRef = await ghRequest('/git/ref/heads/gh-pages', 'GET', token);
    ghPagesCommitSha = ghPagesRef.object.sha;
  } catch (err) {
    console.log('   Ветка gh-pages будет создана.');
  }

  const distFiles = getAllFiles(distDir);
  const ghPagesTreeItems = [];

  for (const relFile of distFiles) {
    const absFile = path.join(distDir, relFile);
    const buffer = fs.readFileSync(absFile);
    const blobSha = await createBlob(token, buffer);
    ghPagesTreeItems.push({
      path: relFile,
      mode: '100644',
      type: 'blob',
      sha: blobSha
    });
    console.log(`   + dist/${relFile} (${blobSha.substring(0, 7)})`);
  }

  const newGhPagesTree = await ghRequest('/git/trees', 'POST', token, {
    tree: ghPagesTreeItems
  });

  const newGhPagesCommit = await ghRequest('/git/commits', 'POST', token, {
    message: 'Deploy: модульная декомпозиция и PocketBase интеграция',
    tree: newGhPagesTree.sha,
    parents: ghPagesCommitSha ? [ghPagesCommitSha] : []
  });

  if (ghPagesCommitSha) {
    await ghRequest('/git/refs/heads/gh-pages', 'PATCH', token, {
      sha: newGhPagesCommit.sha,
      force: true
    });
  } else {
    await ghRequest('/git/refs', 'POST', token, {
      ref: 'refs/heads/gh-pages',
      sha: newGhPagesCommit.sha
    });
  }

  console.log(`\n🎉 Ветка gh-pages успешно обновлена! (commit: ${newGhPagesCommit.sha.substring(0, 7)})`);
  console.log(`🌐 Репозиторий: https://github.com/${OWNER}/${REPO}`);
}

const tokenArg = process.env.GITHUB_TOKEN || process.argv[2];
if (tokenArg) {
  deployToGitHub(tokenArg).catch(err => {
    console.error('❌ Ошибка отправки на GitHub:', err.message);
    process.exit(1);
  });
}
