#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
====================================================================
Скрипт: yandex_go_scanner.py
Назначение: Универсальный двуязычный (Русский + Английский) парсер
писем о поездках Яндекс Go (Яндекс.Такси) из почты Mail.ru / Yandex.
- Автоматический поиск по папкам: INBOX, «Чеки», «Заказы», «Такси» (IMAP UTF-7)
- Извлечение цены (русский и английский форматы: ₽717.36 / 717.36 ₽)
- Автоопределение способа оплаты: Corporate account / Корпоративный -> Безнал (cashless)
- Парсинг маршрута («Откуда → Куда») и точного времени отправления
- Разбор дат (русские и английские названия месяцев)
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
import binascii

ALL_MONTHS = {
    # Английские месяцы
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    # Русские месяцы
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4,
    'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8,
    'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
    'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4,
    'май': 5, 'июнь': 6, 'июль': 7, 'август': 8,
    'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
    'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4,
    'май': 5, 'июн': 6, 'июл': 7, 'авг': 8,
    'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12
}

def decode_imap_utf7(s):
    """Декодирование имени папки IMAP Modified UTF-7 в обычный Unicode"""
    if not s:
        return ""
    if isinstance(s, bytes):
        try:
            s = s.decode('latin1')
        except Exception:
            s = str(s)
            
    res = []
    parts = s.split('&')
    res.append(parts[0])
    for part in parts[1:]:
        if '-' in part:
            b64, rest = part.split('-', 1)
            if b64:
                b64_std = b64.replace(',', '/')
                pad = len(b64_std) % 4
                if pad:
                    b64_std += '=' * (4 - pad)
                try:
                    raw_bytes = binascii.a2b_base64(b64_std)
                    res.append(raw_bytes.decode('utf-16be', errors='ignore'))
                except Exception:
                    res.append('&' + b64 + '-')
            else:
                res.append('&')
            res.append(rest)
        else:
            res.append('&' + part)
    return ''.join(res)

def parse_imap_folder_line(line):
    """Извлекает исходное имя папки и флаги из строки mail.list()"""
    if isinstance(line, bytes):
        line = line.decode('latin1', errors='ignore')
    
    flags = ""
    folder_name = ""
    
    m = re.search(r'\((?P<flags>.*?)\)\s+(?:"(?P<delim>.*?)"|NIL)\s+(?:"(?P<qname>.*)"|(?P<uname>.*))', line)
    if m:
        flags = m.group('flags') or ""
        folder_name = m.group('qname') or m.group('uname') or ""
    else:
        tokens = line.split()
        if tokens:
            folder_name = tokens[-1].strip('"')
            
    folder_name = folder_name.strip()
    decoded_name = decode_imap_utf7(folder_name)
    return folder_name, decoded_name, flags

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
    s = re.sub(r'(?i)<br\s*/?>', '\n', html_text)
    s = re.sub(r'(?i)</p>', '\n', s)
    s = re.sub(r'(?i)</div>', '\n', s)
    s = re.sub(r'(?i)</td>', ' | ', s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
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

def parse_yandex_go_email(msg_id, msg, raw_email_date, folder_name=""):
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

    # ====================================================================
    # 1. СУММА (PRICE) - Двуязычный поиск (₽ впереди и ₽ сзади)
    # ====================================================================
    amount = 0.0

    # Шаг 1.1: Поиск по ключевым словам Total price / Ride price / Итого / Стоимость
    # Поддерживает знак рубля как перед числом (₽717.36), так и после (717.36 ₽)
    m = re.search(
        r'(?:Total\s*price|Ride\s*price|Итого|Стоимость поездки|Стоимость|Всего|Сумма|ИТОГ[О]?|К оплате)'
        r'[^\d\r\n]{0,35}'
        r'(\d+(?:[\s\xa0\u202f]*\d+)*(?:[.,]\d{1,2})?)',
        full_text,
        re.IGNORECASE
    )
    if m:
        raw_amt = m.group(1).replace(' ', '').replace(',', '.')
        try:
            val = round(float(raw_amt), 2)
            if val > 0:
                amount = val
        except ValueError:
            pass

    # Шаг 1.2: Если не нашли по ключевому слову, ищем знак рубля перед числом (₽717.36)
    if amount == 0.0:
        m2 = re.search(r'[₽$€]\s*(\d+(?:[\s\xa0\u202f]*\d+)*(?:[.,]\d{1,2})?)', full_text)
        if m2:
            raw_amt = m2.group(1).replace(' ', '').replace(',', '.')
            try:
                val = round(float(raw_amt), 2)
                if val > 0:
                    amount = val
            except ValueError:
                pass

    # Шаг 1.3: Поиск знака рубля после числа (717.36 ₽ / 717 руб)
    if amount == 0.0:
        m3 = re.search(r'(\d+(?:[\s\xa0\u202f]*\d+)*(?:[.,]\d{1,2})?)\s*(?:[₽$€]|руб\.?)', full_text, re.IGNORECASE)
        if m3:
            raw_amt = m3.group(1).replace(' ', '').replace(',', '.')
            try:
                val = round(float(raw_amt), 2)
                if val > 0:
                    amount = val
            except ValueError:
                pass

    # Шаг 1.4: Поиск по фискальному формату ОФД (ИТОГ: =717.36)
    if amount == 0.0:
        m4 = re.search(r'ИТОГ[О]?\s*[:=]\s*=?\s*(\d+(?:[.,]\d{1,2})?)', full_text, re.IGNORECASE)
        if m4:
            try:
                amount = round(float(m4.group(1).replace(',', '.')), 2)
            except ValueError:
                pass

    # ====================================================================
    # 2. СПОСОБ ОПЛАТЫ (PAYMENT METHOD)
    # Если Corporate account / Корпоративный -> БЕЗНАЛ (cashless)
    # ====================================================================
    is_cashless = False
    payment_method_raw = ""

    pm_match = re.search(r'(?:Payment\s*method|Способ\s*оплаты)\s*[:—\-]?\s*([^\n\r\t|]+)', full_text, re.IGNORECASE)
    if pm_match:
        payment_method_raw = pm_match.group(1).strip()

    # Проверяем как выделенный блок, так и весь текст письма на признаки корпоративного аккаунта
    check_text = (payment_method_raw + " " + full_text).lower()
    corporate_keywords = [
        'corporate account', 'corporate', 'business account', 'company account',
        'корпоративный аккаунт', 'корпоративный счет', 'корпоративный',
        'оплата компанией', 'безнал', 'безналичный'
    ]
    if any(kw in check_text for kw in corporate_keywords):
        is_cashless = True

    payment_type = "cashless" if is_cashless else "cash"
    payment_label = "Безналичный расчет (Корпоративный аккаунт)" if is_cashless else "Личные средства"

    # ====================================================================
    # 3. МАРШРУТ («ОТКУДА → КУДА») И ВРЕМЯ О ТПРАВЛЕНИЯ
    # ====================================================================
    from_addr = ""
    to_addr = ""

    # Шаг 3.1: Структурированный блок Route / Маршрут
    route_block_match = re.search(r'(?:Route|Маршрут)(.+?)(?:Payment|Оплата|Details|Детали)', full_text, re.DOTALL | re.IGNORECASE)
    if route_block_match:
        block_text = route_block_match.group(1)
        block_lines = [l.strip() for l in block_text.split('\n') if l.strip()]
        
        times_found = []
        addrs_found = []
        for l in block_lines:
            # Время (например 21:10)
            t_m = re.match(r'^(\d{1,2}:\d{2})$', l)
            if t_m:
                times_found.append(t_m.group(1))
            elif len(l) > 3 and not re.match(r'^[•\-\*\t|\s]+$', l):
                # Исключаем служебные заголовки
                if not any(skip in l.lower() for skip in ['route', 'маршрут', 'payment', 'оплата']):
                    addrs_found.append(l)

        if len(addrs_found) >= 2:
            from_addr = addrs_found[0]
            to_addr = addrs_found[1]
        elif len(addrs_found) == 1:
            from_addr = addrs_found[0]

        if times_found:
            time_str = times_found[0]

    # Шаг 3.2: Если не нашли по блоку Route, проверяем классические метки Откуда/Куда
    if not from_addr or not to_addr:
        from_m = re.search(r'(?:Откуда|Точка А|Посадка|Начало поездки)\s*[:—\-]\s*([^\n|]+)', full_text, re.IGNORECASE)
        to_m = re.search(r'(?:Куда|Точка Б|Высадка|Конец поездки)\s*[:—\-]\s*([^\n|]+)', full_text, re.IGNORECASE)
        if from_m and not from_addr: from_addr = from_m.group(1).strip()
        if to_m and not to_addr: to_addr = to_m.group(1).strip()

    def clean_address(addr):
        if not addr: return ""
        addr = re.split(r'(?:Куда|Тариф|Оплата|Итого|Водитель|Машина|Чек|Отзыв|Поездка|Payment|Car|Details)', addr, flags=re.IGNORECASE)[0]
        addr = addr.strip(' ,;:-|\t\r\n')
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
        route = "Поездка Яндекс Go"

    # ====================================================================
    # 4. ДАТА (Двуязычный разбор: October 30, 2026 / 30 октября 2026)
    # ====================================================================
    # Английский формат: Date: October 30, 2026
    eng_date_m = re.search(r'(?:Date|Дата)?\s*[:—\-]?\s*([a-zA-Zа-яА-ЯёЁ]+)\s+(\d{1,2}),?\s+(\d{4})', full_text)
    if eng_date_m:
        m_name = eng_date_m.group(1).lower()
        d_val = int(eng_date_m.group(2))
        y_val = int(eng_date_m.group(3))
        if m_name in ALL_MONTHS:
            try:
                ride_dt = datetime.datetime(y_val, ALL_MONTHS[m_name], d_val)
                date_str = ride_dt.strftime("%d.%m.%Y")
            except Exception:
                pass
    else:
        # Русский формат: 30 октября 2026 или 30.10.2026
        ru_date_m = re.search(r'(\d{1,2})\s+([а-яА-ЯёЁa-zA-Z]+)(?:,?\s+(\d{4}))?', full_text)
        if ru_date_m:
            d_val = int(ru_date_m.group(1))
            m_name = ru_date_m.group(2).lower()
            y_val = int(ru_date_m.group(3)) if ru_date_m.group(3) else dt.year
            if m_name in ALL_MONTHS:
                try:
                    ride_dt = datetime.datetime(y_val, ALL_MONTHS[m_name], d_val)
                    date_str = ride_dt.strftime("%d.%m.%Y")
                except Exception:
                    pass

    # Всегда формируем аккуратное русское описание для бухгалтерии и отчётов
    description = f"Такси Яндекс Go: {route} ({time_str})"

    return {
        "id": f"ygo_{dt.strftime('%Y%m%d%H%M')}_{int(amount)}",
        "messageId": message_id_header,
        "date": date_str,
        "time": time_str,
        "datetime": f"{date_str} в {time_str}",
        "route": route,
        "from": from_addr,
        "to": to_addr,
        "amount": amount,
        "paymentType": payment_type,
        "paymentLabel": payment_label,
        "isCorporate": is_cashless,
        "description": description,
        "subject": subject,
        "sender": sender,
        "folder": folder_name
    }

def get_target_folders(mail):
    target_folders = []
    seen_names = set()

    target_folders.append(("INBOX", "INBOX"))
    seen_names.add("INBOX".lower())

    try:
        status, folder_lines = mail.list()
        if status == 'OK' and folder_lines:
            for f_line in folder_lines:
                if not f_line: continue
                raw_name, decoded_name, flags = parse_imap_folder_line(f_line)
                if not raw_name: continue

                dec_lower = decoded_name.lower()
                flags_lower = flags.lower()

                if '\\trash' in flags_lower or '\\junk' in flags_lower or '\\drafts' in flags_lower or '\\sent' in flags_lower:
                    continue
                if any(bad in dec_lower for bad in ['корзина', 'спам', 'отправлен', 'черновик', 'trash', 'spam', 'sent', 'drafts']):
                    continue

                if dec_lower in seen_names:
                    continue

                keywords = ['чек', 'receipt', 'заказ', 'order', 'яндекс', 'yandex', 'такси', 'taxi', 'поездк', 'ride']
                if any(kw in dec_lower for kw in keywords):
                    target_folders.append((raw_name, decoded_name))
                    seen_names.add(dec_lower)
    except Exception as e:
        sys.stderr.write(f"Ошибка получения списка папок: {e}\n")

    return target_folders

def scan_mail(email_user, password, imap_server="imap.mail.ru", imap_port=993, days=60, limit=50):
    try:
        mail = imaplib.IMAP4_SSL(imap_server, int(imap_port), timeout=25)
    except Exception as e:
        return {"success": False, "error": f"Не удалось подключиться к серверу {imap_server}:{imap_port} ({str(e)})"}

    try:
        mail.login(email_user, password)
    except imaplib.IMAP4.error as e:
        return {"success": False, "error": f"Ошибка авторизации почты: проверьте email и Пароль для внешних приложений ({str(e)})"}
    except Exception as e:
        return {"success": False, "error": f"Ошибка входа: {str(e)}"}

    try:
        target_folders = get_target_folders(mail)
        scanned_folder_names = [dec for raw, dec in target_folders]

        results = []
        seen_message_ids = set()
        seen_ride_signatures = set()

        if days > 0:
            since_date = (datetime.date.today() - datetime.timedelta(days=days)).strftime("%d-%b-%Y")
            search_query = f'(SINCE "{since_date}")'
        else:
            search_query = 'ALL'

        for raw_folder, dec_folder in target_folders:
            if len(results) >= limit:
                break

            folder_to_select = f'"{raw_folder}"' if (' ' in raw_folder and not raw_folder.startswith('"')) else raw_folder
            try:
                status, _ = mail.select(folder_to_select, readonly=True)
                if status != 'OK':
                    continue
            except Exception:
                continue

            try:
                status, data = mail.search(None, search_query)
            except Exception:
                try:
                    status, data = mail.search(None, 'ALL')
                except Exception:
                    continue

            if status != 'OK' or not data or not data[0]:
                continue

            msg_ids = data[0].split()
            msg_ids = msg_ids[::-1]

            for msg_id in msg_ids:
                if len(results) >= limit:
                    break

                try:
                    status, header_data = mail.fetch(msg_id, '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])')
                except Exception:
                    continue

                if status != 'OK' or not header_data or not header_data[0]:
                    continue

                raw_header = header_data[0][1]
                header_msg = email.message_from_bytes(raw_header)
                subject = decode_mime_words(header_msg.get('Subject', '')).lower()
                sender = decode_mime_words(header_msg.get('From', '')).lower()
                msg_uuid = header_msg.get('Message-ID', '').strip()
                raw_date = header_msg.get('Date', '')

                if msg_uuid and msg_uuid in seen_message_ids:
                    continue

                is_yandex_taxi = False
                if any(s in sender for s in ['taxi.yandex', 'go.yandex', 'taximeter', 'yandex']):
                    is_yandex_taxi = True
                elif any(kw in subject for kw in ['яндекс go', 'яндекс.такси', 'яндекс такси', 'yandex.taxi', 'yandex go', 'taxi', 'такси', 'поездка', 'ride', 'чек']):
                    is_yandex_taxi = True

                if not is_yandex_taxi:
                    continue

                try:
                    status, full_data = mail.fetch(msg_id, '(RFC822)')
                except Exception:
                    continue

                if status != 'OK' or not full_data or not full_data[0]:
                    continue

                full_msg = email.message_from_bytes(full_data[0][1])
                parsed = parse_yandex_go_email(msg_id.decode('utf-8', errors='ignore'), full_msg, raw_date, dec_folder)

                sig = f"{parsed['date']}_{parsed['time']}_{parsed['amount']}_{parsed['route']}"
                if sig in seen_ride_signatures:
                    continue

                seen_ride_signatures.add(sig)
                if msg_uuid:
                    seen_message_ids.add(msg_uuid)

                results.append(parsed)

        mail.logout()

        # Автоматическая синхронизация найденных поездок с таблицей taxi_rides PocketBase
        updated_items, new_saved_count, total_db_count = sync_rides_to_pocketbase(results)

        return {
            "success": True,
            "count": len(updated_items),
            "newCount": new_saved_count,
            "totalInDb": total_db_count,
            "foldersScanned": scanned_folder_names,
            "items": updated_items
        }

    except Exception as e:
        try:
            mail.logout()
        except Exception:
            pass
        return {"success": False, "error": f"Ошибка сканирования почты: {str(e)}"}

def sync_rides_to_pocketbase(rides, pb_url="http://127.0.0.1:8090"):
    """
    Автоматически сохраняет найденные поездки в коллекцию taxi_rides PocketBase.
    - Проверяет дубликаты по messageId и сигнатуре (дата + время + сумма).
    - Автоматически находит подходящую командировку по датам и заполняет tripId.
    """
    import urllib.request
    import urllib.error
    from datetime import datetime

    def parse_ru_date(d_str):
        if not d_str:
            return None
        parts = d_str.strip().split('.')
        if len(parts) == 3:
            try:
                return datetime(int(parts[2]), int(parts[1]), int(parts[0]))
            except Exception:
                pass
        return None

    # 1. Получаем существующие командировки из PB
    trips = []
    try:
        req = urllib.request.Request(f"{pb_url}/api/collections/trips/records?filter=(deleted!=true)&perPage=500")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            trips = data.get('items', [])
    except Exception as e:
        sys.stderr.write(f"PB trips fetch notice: {e}\n")

    # 2. Получаем существующие записи taxi_rides из PB
    existing_rides = []
    existing_msg_ids = set()
    existing_signatures = set()
    try:
        req = urllib.request.Request(f"{pb_url}/api/collections/taxi_rides/records?perPage=500")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            existing_rides = data.get('items', [])
            for r in existing_rides:
                mid = r.get('messageId')
                if mid:
                    existing_msg_ids.add(mid)
                sig = f"{r.get('date')}_{r.get('time')}_{round(float(r.get('amount', 0)), 2)}"
                existing_signatures.add(sig)
    except Exception as e:
        sys.stderr.write(f"PB taxi_rides fetch notice: {e}\n")

    new_saved_count = 0
    updated_items = []

    for ride in rides:
        msg_id = ride.get('messageId', '').strip()
        amt = round(float(ride.get('amount', 0)), 2)
        sig = f"{ride.get('date')}_{ride.get('time')}_{amt}"

        # Проверка на дубликат: если уже есть в базе
        if (msg_id and msg_id in existing_msg_ids) or (sig in existing_signatures):
            ride['isNewInDb'] = False
            for er in existing_rides:
                er_sig = f"{er.get('date')}_{er.get('time')}_{round(float(er.get('amount', 0)), 2)}"
                if (msg_id and er.get('messageId') == msg_id) or (er_sig == sig):
                    ride['pbId'] = er.get('id')
                    ride['tripId'] = er.get('trip', '')
                    ride['status'] = er.get('status', 'pending')
                    ride['expenseId'] = er.get('expenseId', '')
                    break
            updated_items.append(ride)
            continue

        # Пытаемся автоматически сопоставить с командировкой по дате
        matched_trip_id = ""
        ride_dt = parse_ru_date(ride.get('date'))
        if ride_dt:
            for t in trips:
                s_dt = parse_ru_date(t.get('startDate'))
                f_dt = parse_ru_date(t.get('finishDate') or t.get('startDate'))
                if s_dt and f_dt and s_dt <= ride_dt <= f_dt:
                    matched_trip_id = t.get('id', '')
                    break

        status = "matched" if matched_trip_id else "pending"

        payload = {
            "messageId": msg_id,
            "date": ride.get('date', ''),
            "time": ride.get('time', ''),
            "fromAddress": ride.get('from', ''),
            "toAddress": ride.get('to', ''),
            "route": ride.get('route', ''),
            "amount": amt,
            "paymentType": ride.get('paymentType', 'cashless'),
            "paymentLabel": ride.get('paymentLabel', ''),
            "isCorporate": bool(ride.get('isCorporate', False)),
            "description": ride.get('description', ''),
            "trip": matched_trip_id,
            "status": status,
            "deleted": False
        }

        try:
            req = urllib.request.Request(
                f"{pb_url}/api/collections/taxi_rides/records",
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                created_record = json.loads(resp.read().decode('utf-8'))
                ride['pbId'] = created_record.get('id')
                ride['tripId'] = matched_trip_id
                ride['status'] = status
                ride['isNewInDb'] = True
                new_saved_count += 1
                if msg_id:
                    existing_msg_ids.add(msg_id)
                existing_signatures.add(sig)
        except Exception as e:
            sys.stderr.write(f"Error saving ride to PB: {e}\n")
            ride['isNewInDb'] = False

        updated_items.append(ride)

    total_db_count = len(existing_msg_ids) if existing_msg_ids else len(existing_rides) + new_saved_count
    return updated_items, new_saved_count, total_db_count


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--json':
        try:
            params = json.loads(sys.argv[2])
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Invalid JSON args: {str(e)}"}))
            return
    else:
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
        try:
            mail = imaplib.IMAP4_SSL(imap_server, int(imap_port), timeout=15)
            mail.login(email_user, password)
            target_folders = get_target_folders(mail)
            mail.logout()
            folder_names = [f[1] for f in target_folders]
            print(json.dumps({
                "success": True,
                "message": f"Успешное подключение к {imap_server} ({email_user})! Доступны папки: {', '.join(folder_names)}"
            }))
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Ошибка проверки подключения: {str(e)}"}))
        return

    res = scan_mail(email_user, password, imap_server, imap_port, days, limit)
    print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__':
    main()
