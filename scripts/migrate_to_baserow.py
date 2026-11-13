#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, json, mimetypes, glob, time
import urllib.request, urllib.parse, urllib.error

import django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "baserow.config.settings.base")
django.setup()

from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

print("Initializing migration script...")

User = get_user_model()
u = User.objects.get(id=1)
TOKEN = str(RefreshToken.for_user(u).access_token)
DB_ID = 204

def api_call(endpoint, method="GET", data=None):
    url = f"http://127.0.0.1:8000{endpoint}"
    body = None
    headers = {"Authorization": f"JWT {TOKEN}"}
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"API ERROR {e.code} on {method} {endpoint}: {err_body}")
        raise e

def upload_file(filepath):
    if not os.path.exists(filepath):
        return None
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    filename = os.path.basename(filepath)
    mime_type, _ = mimetypes.guess_type(filepath)
    if not mime_type:
        mime_type = "application/octet-stream"

    with open(filepath, "rb") as f:
        file_bytes = f.read()

    data = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        "http://127.0.0.1:8000/api/user-files/upload-file/",
        data=data,
        headers={
            "Authorization": f"JWT {TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={boundary}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Error uploading {filepath}: {e}")
        return None

def parse_date(d_str):
    if not d_str:
        return None
    d_str = str(d_str).strip()
    if not d_str:
        return None
    if "." in d_str:
        parts = d_str.split(".")
        if len(parts) == 3:
            day, month, year = parts
            return f"{year.zfill(4)}-{month.zfill(2)}-{day.zfill(2)}"
    elif "-" in d_str:
        parts = d_str.split("-")
        if len(parts) == 3:
            return f"{parts[0].zfill(4)}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
    return None

# Load PocketBase Export
with open("/tmp/pocketbase_export.json", "r", encoding="utf-8") as f:
    pb_data = json.load(f)

print(f"Loaded export: {len(pb_data.get('clients', []))} clients, {len(pb_data.get('trips', []))} trips, {len(pb_data.get('expenses', []))} expenses, {len(pb_data.get('payments', []))} payments, {len(pb_data.get('taxi_rides', []))} taxi rides")

def create_table_clean(name, primary_field_name):
    tbl = api_call(f"/api/database/tables/database/{DB_ID}/", "POST", {"name": name})
    tbl_id = tbl["id"]
    fields = api_call(f"/api/database/fields/table/{tbl_id}/")
    for f in fields:
        if f.get("primary"):
            api_call(f"/api/database/fields/{f['id']}/", "PATCH", {"name": primary_field_name})
        else:
            api_call(f"/api/database/fields/{f['id']}/", "DELETE")
    print(f"Created table '{name}' (ID: {tbl_id})")
    return tbl_id

# 1. Create Tables
print("\n--- 1. Creating Table Structures ---")
tbl_clients_id = create_table_clean("Клиенты", "Наименование")
api_call(f"/api/database/fields/table/{tbl_clients_id}/", "POST", {"name": "Адрес", "type": "text"})

tbl_trips_id = create_table_clean("Командировки", "Номер приказа / заявки")
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Клиент", "type": "link_row", "link_row_table_id": tbl_clients_id})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Город / Локация", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Дата начала", "type": "date", "date_format": "ISO"})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Дата окончания", "type": "date", "date_format": "ISO"})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {
    "name": "Статус",
    "type": "single_select",
    "select_options": [
        {"value": "Новая", "color": "light-blue"},
        {"value": "В процессе", "color": "blue"},
        {"value": "На проверке", "color": "yellow"},
        {"value": "Завершена", "color": "green"},
        {"value": "Выплачен", "color": "dark-green"}
    ]
})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {
    "name": "Транспорт",
    "type": "single_select",
    "select_options": [
        {"value": "Авто", "color": "blue"},
        {"value": "Поезд", "color": "orange"},
        {"value": "Самолет", "color": "light-blue"},
        {"value": "Общественный", "color": "gray"},
        {"value": "Нет", "color": "light-gray"}
    ]
})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Начальный одометр", "type": "number", "number_decimal_places": 0})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Конечный одометр", "type": "number", "number_decimal_places": 0})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Норма суточных", "type": "number", "number_decimal_places": 0})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Вид работ", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_trips_id}/", "POST", {"name": "Примечание", "type": "long_text"})

tbl_exp_id = create_table_clean("Расходы", "Описание")
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {"name": "Командировка", "type": "link_row", "link_row_table_id": tbl_trips_id})
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {"name": "Дата", "type": "date", "date_format": "ISO"})
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {"name": "Сумма", "type": "number", "number_decimal_places": 2})
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {
    "name": "Способ оплаты",
    "type": "single_select",
    "select_options": [
        {"value": "Наличные", "color": "green"},
        {"value": "Корпоративный аккаунт / Безналичный", "color": "blue"}
    ]
})
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {"name": "Чек", "type": "file"})
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {"name": "Маршрут", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {"name": "Откуда", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_exp_id}/", "POST", {"name": "Куда", "type": "text"})

tbl_pay_id = create_table_clean("Выплаты", "Примечание")
api_call(f"/api/database/fields/table/{tbl_pay_id}/", "POST", {"name": "Командировка", "type": "link_row", "link_row_table_id": tbl_trips_id})
api_call(f"/api/database/fields/table/{tbl_pay_id}/", "POST", {"name": "Дата", "type": "date", "date_format": "ISO"})
api_call(f"/api/database/fields/table/{tbl_pay_id}/", "POST", {"name": "Сумма", "type": "number", "number_decimal_places": 2})

tbl_taxi_id = create_table_clean("Поездки такси", "Маршрут")
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Дата", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Время", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Сумма", "type": "number", "number_decimal_places": 2})
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Тип оплаты", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Статус", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Командировка", "type": "link_row", "link_row_table_id": tbl_trips_id})
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Откуда", "type": "text"})
api_call(f"/api/database/fields/table/{tbl_taxi_id}/", "POST", {"name": "Куда", "type": "text"})

# 2. Populate Clients
print("\n--- 2. Populating Clients ---")
client_map = {} # pb_id -> baserow_id, client_name -> baserow_id
client_items = []
for c in pb_data.get("clients", []):
    client_items.append({
        "Наименование": c.get("name") or "Без названия",
        "Адрес": c.get("address") or ""
    })

res_clients = api_call(f"/api/database/rows/table/{tbl_clients_id}/batch/?user_field_names=true", "POST", {"items": client_items})
for orig, created in zip(pb_data.get("clients", []), res_clients["items"]):
    cid = created["id"]
    client_map[orig["id"]] = cid
    if orig.get("name"):
        client_map[orig["name"].strip()] = cid
print(f"Imported {len(res_clients['items'])} clients")

# 3. Populate Trips
print("\n--- 3. Populating Trips ---")
trip_map = {} # pb_id -> baserow_id
trip_items = []
status_valid = {"Новая", "В процессе", "На проверке", "Завершена", "Выплачен"}
trans_valid = {"Авто", "Поезд", "Самолет", "Общественный", "Нет"}

for t in pb_data.get("trips", []):
    c_name = (t.get("client") or "").strip()
    linked_c = []
    if c_name in client_map:
        linked_c = [client_map[c_name]]
    elif t.get("client") in client_map:
        linked_c = [client_map[t.get("client")]]

    st = t.get("status") or "В процессе"
    if st not in status_valid:
        st = "В процессе"

    tr = t.get("transport") or "Нет"
    if tr not in trans_valid:
        tr = "Нет"

    trip_items.append({
        "Номер приказа / заявки": t.get("orderNumber") or f"Командировка {t.get('startDate')}",
        "Клиент": linked_c,
        "Город / Локация": t.get("location") or "",
        "Дата начала": parse_date(t.get("startDate")),
        "Дата окончания": parse_date(t.get("finishDate")),
        "Статус": st,
        "Транспорт": tr,
        "Начальный одометр": int(t.get("odoStart") or 0),
        "Конечный одометр": int(t.get("odoFinish") or 0),
        "Норма суточных": int(t.get("perDiemRate") or 0),
        "Вид работ": t.get("workType") or "",
        "Примечание": t.get("note") or ""
    })

res_trips = api_call(f"/api/database/rows/table/{tbl_trips_id}/batch/?user_field_names=true", "POST", {"items": trip_items})
for orig, created in zip(pb_data.get("trips", []), res_trips["items"]):
    trip_map[orig["id"]] = created["id"]
print(f"Imported {len(res_trips['items'])} trips")

# 4. Populate Expenses (with Receipt file upload)
print("\n--- 4. Populating Expenses & Receipts ---")
exp_items = []
for e in pb_data.get("expenses", []):
    linked_t = [trip_map[e["trip"]]] if e.get("trip") in trip_map else []
    
    pay_type = "Наличные"
    if e.get("paymentType") in ["corp", "corporate", "Безналичный", "Корпоративный"]:
        pay_type = "Корпоративный аккаунт / Безналичный"

    file_list = []
    receipt_name = e.get("receipt")
    if receipt_name:
        # Check in storage
        search_path = f"/tmp/receipts/pbc_1691921218/{e['id']}/{receipt_name}"
        if not os.path.exists(search_path):
            candidates = glob.glob(f"/tmp/receipts/pbc_1691921218/*/{receipt_name}")
            if candidates:
                search_path = candidates[0]
        
        if os.path.exists(search_path):
            uploaded = upload_file(search_path)
            if uploaded and "name" in uploaded:
                file_list.append({"name": uploaded["name"]})
                print(f"  + Attached receipt {receipt_name} for expense {e.get('description')}")

    exp_items.append({
        "Описание": e.get("description") or "Расход",
        "Командировка": linked_t,
        "Дата": parse_date(e.get("date")),
        "Сумма": float(e.get("amount") or 0),
        "Способ оплаты": pay_type,
        "Чек": file_list,
        "Маршрут": e.get("route") or "",
        "Откуда": e.get("fromAddress") or "",
        "Куда": e.get("toAddress") or ""
    })

res_exp = api_call(f"/api/database/rows/table/{tbl_exp_id}/batch/?user_field_names=true", "POST", {"items": exp_items})
print(f"Imported {len(res_exp['items'])} expenses")

# 5. Populate Payments
print("\n--- 5. Populating Payments ---")
pay_items = []
for p in pb_data.get("payments", []):
    linked_t = [trip_map[p["trip"]]] if p.get("trip") in trip_map else []
    pay_items.append({
        "Примечание": p.get("note") or "Выплата",
        "Командировка": linked_t,
        "Дата": parse_date(p.get("date")),
        "Сумма": float(p.get("amount") or 0)
    })

res_pay = api_call(f"/api/database/rows/table/{tbl_pay_id}/batch/?user_field_names=true", "POST", {"items": pay_items})
print(f"Imported {len(res_pay['items'])} payments")

# 6. Populate Taxi Rides
print("\n--- 6. Populating Taxi Rides ---")
taxi_items = []
for r in pb_data.get("taxi_rides", []):
    linked_t = [trip_map[r["trip"]]] if r.get("trip") in trip_map else []
    taxi_items.append({
        "Маршрут": r.get("route") or r.get("description") or "Поездка Яндекс Go",
        "Дата": r.get("date") or "",
        "Время": r.get("time") or "",
        "Сумма": float(r.get("amount") or 0),
        "Тип оплаты": r.get("paymentLabel") or "",
        "Статус": r.get("status") or "",
        "Командировка": linked_t,
        "Откуда": r.get("fromAddress") or "",
        "Куда": r.get("toAddress") or ""
    })

res_taxi = api_call(f"/api/database/rows/table/{tbl_taxi_id}/batch/?user_field_names=true", "POST", {"items": taxi_items})
print(f"Imported {len(res_taxi['items'])} taxi rides")

print("\n🎉 ALL DATA MIGRATED SUCCESSFULLY TO BASEROW!")
