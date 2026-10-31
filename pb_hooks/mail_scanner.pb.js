/**
 * ====================================================================
 * PocketBase Hook: mail_scanner.pb.js
 * Назначение: Маршрут /api/mail-scan для сканирования почты и парсинга
 * чеков и поездок Яндекс Go через Python-обработчик
 * ====================================================================
 */

routerAdd("POST", "/api/mail-scan", function(e) {
    try {
        const info = e.requestInfo();
        const bodyObj = info.body || {};
        
        // Преобразуем тело запроса в JSON-строку
        const jsonPayload = JSON.stringify(bodyObj);
        
        // Запускаем python-скрипт сканирования
        const cmd = $os.cmd("python3", "/opt/pocketbase/scripts/yandex_go_scanner.py", "--json", jsonPayload);
        const bytes = cmd.combinedOutput();
        
        let rawStr = "";
        for (let i = 0; i < bytes.length; i++) {
            rawStr += String.fromCharCode(bytes[i]);
        }
        
        let decoded = "";
        try {
            decoded = decodeURIComponent(escape(rawStr)).trim();
        } catch (decErr) {
            decoded = rawStr.trim();
        }
        
        let resultObj = null;
        try {
            resultObj = JSON.parse(decoded);
        } catch (jsonErr) {
            resultObj = {
                success: false,
                error: "Не удалось распарсить ответ сканера: " + decoded
            };
        }
        
        return e.json(200, resultObj);
    } catch (err) {
        return e.json(500, {
            success: false,
            error: "Ошибка сервера при вызове сканера: " + String(err)
        });
    }
});
