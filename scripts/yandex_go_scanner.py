#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
====================================================================
Скрипт: yandex_go_scanner.py
Назначение: Подключение к почтовому ящику (Mail.ru / Yandex / etc) по IMAP,
поиск и парсинг писем о поездках Яндекс Go (Яндекс.Такси).
Извлечение:
 - Дата и точное время поездки
 - Маршрут («Откуда → Куда»)
 - Стоимость поездки (рубли)
 - Уникальный ID для дедупликации
====================================================================
"""

import sys
import os
import json
import imaplib
import email
from email.header import decode_header
import email.utils
import datetime
import re
import html

RU_MONTHS = {
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4,
    'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8,
    'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
    'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4,
    'май': 5, 'июн': 6, 'июл': 7, 'авг': 8,
    'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12
}

def decode_mime_words(header_val):
    if not header_val:
        return ""
    decoded_fragments = []
    for text, enc in decode_header(header_val):
        if isinstance(text, bytes):
            try:
                decoded_fragments.append(text.decode(enc or 'utf-8', errors='ignore'))
            except Exception:
                decoded_fragments.append(text.decode('utf-8', errors='ignore'))
        else:
            decoded_fragments.append(str(text))
    return " ".join(decoded_fragments).strip()

def strip_tags(html_text):
    if not html_text:
        return ""
    # Заменяем <br> и </p> на перевод строки
    s = re.sub(r'(?i)<br\s*/?>', '\n', html_text)
    s = re.sub(r'(?i)</p>', '\n', s)
    s = re.sub(r'(?i)</div>', '\n', s)
    s = re.sub(r'(?i)</td>', ' | ', s)
    # Убираем все теги
    s = re.sub(r'<[^>]+>', ' ', s)
    # Разэкранируем HTML entities
    s = html.unescape(s)
    # Убираем множественные пробелы
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n\s*\n', '\n', s)
    return s.strip()

def extract_body(msg):
    text_content = ""
    html_content = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            cdispo = str(part.get('Content-Disposition') or '')
            if 'attachment' in cdispo:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or 'utf-8'
            try:
                text = payload.decode(charset, errors='ignore')
            except Exception:
                text = payload.decode('utf-8', errors='ignore')
            if ctype == 'text/plain':
                text_content += "\n" + text
            elif ctype == 'text/html':
                html_content += "\n" + text
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or 'utf-8'
            try:
                text = payload.decode(charset, errors='ignore')
            except Exception:
                text = payload.decode('utf-8', errors='ignore')
            if msg.get_content_type() == 'text/html':
                html_content = text
            else:
                text_content = text

    return text_content.strip(), html_content.strip()

def parse_yandex_go_email(msg_id, msg, raw_email_date):
    subject = decode_mime_words(msg.get('Subject', ''))
    sender = decode_mime_words(msg.get('From', ''))
    message_id_header = msg.get('Message-ID', f"ygo-{msg_id}")

    # Базовая дата из заголовка письма
    parsed_date = email.utils.parsedate_tz(raw_email_date)
    if parsed_date:
        dt = datetime.datetime.fromtimestamp(email.utils.mktime_tz(parsed_date))
    else:
        dt = datetime.datetime.now()

    date_str = dt.strftime("%d.%m.%Y")
    time_str = dt.strftime("%H:%M")

    text_body, html_body = extract_body(msg)
    plain_from_html = strip_tags(html_body) if html_body else ""
    full_text = (text_body + "\n" + plain_from_html).replace('\xa0', ' ').replace('\u202f', ' ')

    # 1. Поиск суммы
    amount = 0.0
    amount_match = re.search(r'(?:Итого|Стоимость поездки|Всего|Сумма|Оплачено|ИТОГ[О]?|К оплате)[^\d]{0,30}(\d+[\s]*[\d]*(?:[.,]\d{1,2})?)\s*(?:₽|руб|р\b)', full_text, re.IGNORECASE)
    if not amount_match:
        # Поиск паттерна в чеках ОФД: ИТОГ: =123.45 или ИТОГО: 123.45
        amount_match = re.search(r'ИТОГ[О]?\s*[:=]\s*(\d+(?:[.,]\d{1,2})?)', full_text, re.IGNORECASE)
    if not amount_match:
        # Поиск просто суммы перед знаком рубля
        amount_match = re.search(r'(\d+[\s]*[\d]*(?:[.,]\d{2})?)\s*(?:₽|руб\.?)', full_text, re.IGNORECASE)

    if amount_match:
        raw_amt = amount_match.group(1).replace(' ', '').replace(',', '.')
        try:
            amount = round(float(raw_amt), 2)
        except ValueError:
            amount = 0.0

    # 2. Поиск даты и времени в теле письма (если они точнее даты отправки письма)
    # Пример: "25 октября, 14:35" или "25.10.2026 в 14:35"
    body_time_match = re.search(r'(\d{1,2})\s+([а-яА-ЯёЁ]+)(?:\s+(\d{4}))?[,\s]+(?:в\s*)?(\d{1,2}:\d{2})', full_text)
    if body_time_match:
        day = int(body_time_match.group(1))
        month_name = body_time_match.group(2).lower()
        year = int(body_time_match.group(3)) if body_time_match.group(3) else dt.year
        t_str = body_time_match.group(4)
        if month_name in RU_MONTHS:
            month = RU_MONTHS[month_name]
            try:
                ride_dt = datetime.datetime(year, month, day)
                date_str = ride_dt.strftime("%d.%m.%Y")
                time_str = t_str
            except Exception:
                pass
    else:
        # Цифровой формат: 25.10.2026 14:35
        num_time_match = re.search(r'(\d{2}\.\d{2}\.\d{4})[,\s]+(?:в\s*)?(\d{1,2}:\d{2})', full_text)
        if num_time_match:
            date_str = num_time_match.group(1)
            time_str = num_time_match.group(2)

    # 3. Поиск маршрута («Откуда — Куда»)
    from_addr = ""
    to_addr = ""

    # Пробуем найти явные метки "Откуда:" и "Куда:"
    from_m = re.search(r'(?:Откуда|Точка А|Посадка|Начало поездки)\s*[:—\-]\s*([^\n|]+)', full_text, re.IGNORECASE)
    to_m = re.search(r'(?:Куда|Точка Б|Высадка|Конец поездки)\s*[:—\-]\s*([^\n|]+)', full_text, re.IGNORECASE)

    if from_m:
        from_addr = from_m.group(1).strip()
    if to_m:
        to_addr = to_m.group(1).strip()

    # Если не нашлось, пробуем шаблоны вида "А <адрес> \n Б <адрес>"
    if not from_addr or not to_addr:
        ab_match = re.search(r'(?:^|\n)\s*[AА]\s+([^\n]+)\s*\n\s*[BБ]\s+([^\n]+)', full_text)
        if ab_match:
            if not from_addr: from_addr = ab_match.group(1).strip()
            if not to_addr: to_addr = ab_match.group(2).strip()

    # Очистка адресов от мусора (длинные хвосты, разделители)
    def clean_address(addr):
        if not addr: return ""
        # Обрезаем если попал следующий текст
        addr = re.split(r'(?:Куда|Тариф|Оплата|Итого|Водитель|Машина|Чек|Отзыв|Поездка)', addr, flags=re.IGNORECASE)[0]
        addr = addr.strip(' ,;:-|\t\r\n')
        # Ограничиваем длину разумными 100 символами
        return addr[:100].strip()

    from_addr = clean_address(from_addr)
    to_addr = clean_address(to_addr)

    route = ""
    if from_addr and to_addr:
        route = f"{from_addr} → {to_addr}"
    elif from_addr:
        route = f"от {from_addr}"
    elif to_addr:
        route = f"до {to_addr}"
    else:
        # Пробуем найти общую фразу маршрута
        route_m = re.search(r'(?:Маршрут|Поездка на такси)\s*[:—\-]\s*([^\n]+)', full_text, re.IGNORECASE)
        if route_m:
            route = clean_address(route_m.group(1))
        else:
            route = "Поездка Яндекс Go"

    description = f"Яндекс Go ({time_str}): {route}"

    return {
        "id": f"ygo_{dt.strftime('%Y%m%d%H%M')}_{int(amount)}",
        "messageId": message_id_header,
        "date": date_str,
        "time": time_str,
        "datetime": f"{date_str} {time_str}",
        "route": route,
        "from": from_addr,
        "to": to_addr,
        "amount": amount,
        "description": description,
        "subject": subject,
        "sender": sender
    }

def scan_mail(email_user, password, imap_server="imap.mail.ru", imap_port=993, days=60, limit=50):
    try:
        mail = imaplib.IMAP4_SSL(imap_server, int(imap_port))
    except Exception as e:
        return {"success": False, "error": f"Не удалось подключиться к серверу {imap_server}:{imap_port} ({str(e)})"}

    try:
        mail.login(email_user, password)
    except imaplib.IMAP4.error as e:
        return {"success": False, "error": f"Ошибка авторизации почты: проверьте email и Пароль для внешних приложений ({str(e)})"}
    except Exception as e:
        return {"success": False, "error": f"Ошибка входа: {str(e)}"}

    try:
        status, _ = mail.select("INBOX", readonly=True)
        if status != 'OK':
            return {"success": False, "error": "Не удалось открыть папку Входящие (INBOX)"}

        # Формируем дату для фильтрации
        if days > 0:
            since_date = (datetime.date.today() - datetime.timedelta(days=days)).strftime("%d-%b-%Y")
            search_query = f'(SINCE "{since_date}")'
        else:
            search_query = 'ALL'

        status, data = mail.search(None, search_query)
        if status != 'OK' or not data or not data[0]:
            mail.logout()
            return {"success": True, "count": 0, "items": []}

        msg_ids = data[0].split()
        # Сортируем от самых свежих к более старым
        msg_ids = msg_ids[::-1]

        results = []
        # Проверяем заголовки
        for msg_id in msg_ids:
            if len(results) >= limit:
                break

            status, header_data = mail.fetch(msg_id, '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])')
            if status != 'OK' or not header_data or not header_data[0]:
                continue

            raw_header = header_data[0][1]
            header_msg = email.message_from_bytes(raw_header)
            subject = decode_mime_words(header_msg.get('Subject', '')).lower()
            sender = decode_mime_words(header_msg.get('From', '')).lower()
            raw_date = header_msg.get('Date', '')

            # Критерии совпадения для Яндекс Go
            is_yandex_taxi = False
            if 'taxi.yandex' in sender or 'go.yandex' in sender or 'taximeter' in sender:
                is_yandex_taxi = True
            elif 'yandex' in sender and ('taxi' in subject or 'такси' in subject or 'поездка' in subject or 'чек' in subject):
                is_yandex_taxi = True
            elif 'яндекс go' in subject or 'яндекс.такси' in subject or 'яндекс такси' in subject or 'yandex.taxi' in subject:
                is_yandex_taxi = True
            elif 'поездка на такси' in subject or 'отчет о поездке' in subject or 'отчёт о поездке' in subject:
                if 'яндекс' in subject or 'yandex' in subject or 'yandex' in sender or 'taxi' in sender:
                    is_yandex_taxi = True

            if not is_yandex_taxi:
                continue

            # Скачиваем полное письмо для парсинга
            status, full_data = mail.fetch(msg_id, '(RFC822)')
            if status != 'OK' or not full_data or not full_data[0]:
                continue

            full_msg = email.message_from_bytes(full_data[0][1])
            parsed_item = parse_yandex_go_email(msg_id.decode('utf-8', errors='ignore'), full_msg, raw_date)
            results.append(parsed_item)

        mail.logout()
        return {
            "success": True,
            "count": len(results),
            "items": results
        }

    except Exception as e:
        try:
            mail.logout()
        except Exception:
            pass
        return {"success": False, "error": f"Ошибка сканирования почты: {str(e)}"}

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--json':
        try:
            params = json.loads(sys.argv[2])
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Invalid JSON args: {str(e)}"}))
            return
    else:
        # Чтение из stdin
        raw_input = sys.stdin.read()
        try:
            params = json.loads(raw_input) if raw_input.strip() else {}
        except Exception:
            params = {}

    email_user = params.get('email', '')
    password = params.get('password', '')
    imap_server = params.get('server', 'imap.mail.ru')
    imap_port = params.get('port', 993)
    days = int(params.get('days', 60))
    limit = int(params.get('limit', 50))
    is_test = params.get('testOnly', False)

    if not email_user or not password:
        print(json.dumps({"success": False, "error": "Email и пароль приложения обязательны для сканирования"}))
        return

    if is_test:
        # Проверка только подключения и авторизации
        try:
            mail = imaplib.IMAP4_SSL(imap_server, int(imap_port), timeout=15)
            mail.login(email_user, password)
            status, _ = mail.select("INBOX", readonly=True)
            mail.logout()
            print(json.dumps({"success": True, "message": f"Успешное подключение к {imap_server} ({email_user})!"}))
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Ошибка проверки подключения: {str(e)}"}))
        return

    res = scan_mail(email_user, password, imap_server, imap_port, days, limit)
    print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__':
    main()
