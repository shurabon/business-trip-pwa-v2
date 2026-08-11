import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },
  plugins: [
    {
      name: 'yandex-disk-proxy',
      configureServer(server) {
        // Прокси-эндпоинт для скачивания файлов с Яндекс Диска без CORS блокировки
        server.middlewares.use('/api/yandex-download', async (req, res) => {
          try {
            const url = new URL('http://localhost' + req.url);
            const downloadHref = url.searchParams.get('href');
            const token = url.searchParams.get('token');

            if (!downloadHref) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Параметр href не указан' }));
              return;
            }

            // Если передан токен — используем его для авторизации
            const headers = { 'Accept': 'application/json' };
            if (token) headers['Authorization'] = `OAuth ${token}`;

            // Серверный fetch — без CORS ограничений!
            const response = await fetch(downloadHref, { headers });

            if (!response.ok) {
              res.writeHead(response.status, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(JSON.stringify({ error: `Яндекс Диск ответил: ${response.status}` }));
              return;
            }

            const text = await response.text();

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store'
            });
            res.end(text);
          } catch (err) {
            res.writeHead(500, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: `Прокси ошибка: ${err.message}` }));
          }
        });
      }
    }
  ]
});
