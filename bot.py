"""
AutoPost Telegram Bot
Author: Refactored for stability & SaaS readiness
Architecture: asyncio + Telethon + JSON DB
"""

import asyncio
import json
import os
import random
import string
import ast
import logging
from datetime import datetime, timedelta

from telethon import TelegramClient, events, Button
from telethon.sessions import StringSession
from telethon.errors import (
    FloodWaitError, AuthKeyUnregisteredError, UserDeactivatedError,
    SessionRevokedError, SessionExpiredError, PhoneNumberBannedError
)

# ─────────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────────
API_ID   = 2040
API_HASH = 'b18441a1ff607e10a989891a5462e627'
BOT_TOKEN = '8716528861:AAGLSXvWeyvjbCFn3ywM4-fktYajikq61-k'
OWNER_ID  = 7787174152

USERS_DB_FILE = 'users_db.json'
CODES_FILE    = 'codes.json'

SESSION_CHECK_INTERVAL = 3600   # seconds between periodic session checks
STAGGER_DELAY_MIN      = 5      # seconds between groups in stagger mode
STAGGER_DELAY_MAX      = 7
NORMAL_DELAY           = 1      # seconds between groups in normal mode

# ─────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler(), logging.FileHandler('bot.log', encoding='utf-8')]
)
log = logging.getLogger('AutoPostBot')

# ─────────────────────────────────────────────
#  DATABASE
# ─────────────────────────────────────────────
def load_db(path: str, default):
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            log.error(f"DB load error ({path}): {e}")
    return default

def save_db(path: str, data):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        log.error(f"DB save error ({path}): {e}")

users_db: dict = load_db(USERS_DB_FILE, {})
active_codes: dict = load_db(CODES_FILE, {})

# ─────────────────────────────────────────────
#  USER HELPERS
# ─────────────────────────────────────────────
DEFAULT_USER = {
    "is_sub": False, "sub_end": None,
    "session": None,
    "groups": [], "messages": [],
    "interval": 450,
    "mode": "normal",        # "normal" | "stagger"
}

def get_user(uid) -> dict:
    key = str(uid)
    if key not in users_db:
        users_db[key] = DEFAULT_USER.copy()
    else:
        # backfill missing keys for older records
        for k, v in DEFAULT_USER.items():
            users_db[key].setdefault(k, v)
    return users_db[key]

def save_users():
    save_db(USERS_DB_FILE, users_db)

def is_active(uid) -> bool:
    if int(uid) == OWNER_ID:
        return True
    user = get_user(uid)
    if not user["is_sub"] or not user["sub_end"]:
        return False
    try:
        return datetime.now() < datetime.fromisoformat(user["sub_end"])
    except Exception:
        return False

# ─────────────────────────────────────────────
#  POSTING ENGINE
# ─────────────────────────────────────────────
posting_tasks: dict = {}          # uid -> asyncio.Task
next_post_time: dict = {}         # uid -> datetime

DEAD_SESSION_ERRORS = (
    AuthKeyUnregisteredError, UserDeactivatedError,
    SessionRevokedError, SessionExpiredError, PhoneNumberBannedError,
)

async def _send_one(client: TelegramClient, group: str, msg: dict):
    """Send a single message to a group, handling FloodWait gracefully."""
    try:
        if msg.get("media") and os.path.exists(str(msg["media"])):
            await client.send_file(int(group), msg["media"], caption=msg["text"] or "")
        else:
            await client.send_message(int(group), msg["text"])
    except FloodWaitError as e:
        log.warning(f"FloodWait {e.seconds}s for group {group}")
        await asyncio.sleep(e.seconds + 5)
    except Exception as e:
        log.warning(f"Send failed to {group}: {e}")

async def start_posting(uid: str):
    """Main posting loop for a user. Supports normal and stagger modes."""
    user = users_db.get(uid)
    if not user:
        return

    client = None
    try:
        client = TelegramClient(StringSession(user["session"]), API_ID, API_HASH)
        await client.connect()

        while uid in posting_tasks:
            if not user.get("session") or not user.get("groups") or not user.get("messages"):
                log.info(f"[{uid}] Missing config – stopping.")
                break

            msg = random.choice(user["messages"])
            mode = user.get("mode", "normal")

            for group in user["groups"]:
                if uid not in posting_tasks:
                    break
                await _send_one(client, group, msg)

                if mode == "stagger":
                    delay = random.randint(STAGGER_DELAY_MIN, STAGGER_DELAY_MAX)
                    await asyncio.sleep(delay)
                else:
                    await asyncio.sleep(NORMAL_DELAY)

            # ---- wait until next cycle ----
            base = user.get("interval", 450)
            wait = random.randint(max(60, base - 200), base) if base >= 400 else base
            next_post_time[uid] = datetime.now() + timedelta(seconds=wait)
            log.info(f"[{uid}] Next post in {wait}s")

            # interruptible sleep
            for _ in range(wait):
                if uid not in posting_tasks:
                    break
                await asyncio.sleep(1)

    except DEAD_SESSION_ERRORS as e:
        log.error(f"[{uid}] Dead session: {e}")
        user["session"] = None
        save_users()
        try:
            await bot.send_message(int(uid), "**⚠️ انتهت صلاحية جلستك. أعد ربط حسابك.**")
        except Exception:
            pass
    except Exception as e:
        log.error(f"[{uid}] Posting error: {e}")
    finally:
        posting_tasks.pop(uid, None)
        next_post_time.pop(uid, None)
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass

def launch_posting(uid: str):
    """Create and register a posting task."""
    if uid in posting_tasks:
        return False
    task = asyncio.create_task(start_posting(uid))
    posting_tasks[uid] = task
    return True

def stop_posting(uid: str):
    posting_tasks.pop(uid, None)
    next_post_time.pop(uid, None)

# ─────────────────────────────────────────────
#  SESSION VALIDATION
# ─────────────────────────────────────────────
async def validate_session(session_str: str) -> bool:
    """Return True if session is alive."""
    client = TelegramClient(StringSession(session_str), API_ID, API_HASH)
    try:
        await client.connect()
        return await client.is_user_authorized()
    except Exception:
        return False
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

async def periodic_session_check():
    """Background task: remove dead sessions every SESSION_CHECK_INTERVAL seconds."""
    while True:
        await asyncio.sleep(SESSION_CHECK_INTERVAL)
        log.info("Running periodic session check…")
        for uid, user in list(users_db.items()):
            if not user.get("session"):
                continue
            alive = await validate_session(user["session"])
            if not alive:
                log.warning(f"[{uid}] Session dead – clearing.")
                user["session"] = None
                stop_posting(uid)
                save_users()
                try:
                    await bot.send_message(int(uid), "**⚠️ تم اكتشاف جلسة منتهية وتم حذفها تلقائياً. أعد الربط.**")
                except Exception:
                    pass

# ─────────────────────────────────────────────
#  BOT INIT
# ─────────────────────────────────────────────
bot = TelegramClient('GeminiBot', API_ID, API_HASH).start(bot_token=BOT_TOKEN)

# ─────────────────────────────────────────────
#  UI HELPERS
# ─────────────────────────────────────────────
def main_menu(uid):
    uid = int(uid)
    rows = [
        [Button.inline("📱 حسابك", b"acc"),      Button.inline("📢 النشر التلقائي", b"pub")],
        [Button.inline("🛠 البيانات", b"data"),   Button.inline("⏳ مدة الاشتراك", b"sub_check")],
        [Button.url("المطور", "t.me/MRDLAW")],
    ]
    if uid == OWNER_ID:
        rows.append([Button.inline("👑 لوحة المالك", b"admin")])
    return rows

# ─────────────────────────────────────────────
#  /start
# ─────────────────────────────────────────────
@bot.on(events.NewMessage(pattern='/start'))
async def cmd_start(event):
    uid = event.sender_id
    get_user(uid)

    if not is_active(uid):
        return await event.respond(
            "**⚠️ اشتراكك غير مفعل**",
            buttons=[[Button.url("شراء اشتراك", "t.me/MRDLAW")]]
        )

    await event.respond(f"**👋 أهلاً بك\n🆔 ايديك: `{uid}`**", buttons=main_menu(uid))

# ─────────────────────────────────────────────
#  ACTIVATION CODES  (must be above generic handler)
# ─────────────────────────────────────────────
@bot.on(events.NewMessage(func=lambda e: e.text and e.text.strip().startswith("GMN-")))
async def activate_code(event):
    code = event.text.strip()
    if code not in active_codes:
        return await event.respond("**❌ الكود غير صالح أو منتهي**")

    days = active_codes.pop(code)
    u = get_user(event.sender_id)
    # extend if already subscribed
    base = datetime.fromisoformat(u["sub_end"]) if u.get("sub_end") else datetime.now()
    u["is_sub"] = True
    u["sub_end"] = (max(base, datetime.now()) + timedelta(days=days)).isoformat()
    save_db(CODES_FILE, active_codes)
    save_users()
    await event.respond(f"**🎉 تم تفعيل اشتراكك لمدة {days} يوم ✅**")

# ─────────────────────────────────────────────
#  CALLBACK ROUTER
# ─────────────────────────────────────────────
@bot.on(events.CallbackQuery)
async def on_callback(event):
    uid = str(event.sender_id)
    user = get_user(uid)
    data = event.data.decode()

    # ── Main menu ──────────────────────────────
    if data == "main":
        await event.edit("**👋 القائمة الرئيسية:**", buttons=main_menu(uid))

    # ── Account ───────────────────────────────
    elif data == "acc":
        status = "✅ متصل" if user["session"] else "❌ غير متصل"
        await event.edit(
            f"**📱 إعدادات الحساب\nالحالة: {status}**",
            buttons=[
                [Button.inline("🔑 ربط جلسة", b"login_session"), Button.inline("🚫 قطع الاتصال", b"logout")],
                [Button.inline("🔙 رجوع", b"main")]
            ]
        )

    elif data == "login_session":
        await _login_session(event, uid, user)

    elif data == "logout":
        stop_posting(uid)
        user["session"] = None
        save_users()
        await event.answer("✅ تم قطع الاتصال بنجاح", alert=True)
        # refresh acc screen
        await event.edit(
            "**📱 إعدادات الحساب\nالحالة: ❌ غير متصل**",
            buttons=[
                [Button.inline("🔑 ربط جلسة", b"login_session"), Button.inline("🚫 قطع الاتصال", b"logout")],
                [Button.inline("🔙 رجوع", b"main")]
            ]
        )

    # ── Publishing ────────────────────────────
    elif data == "pub":
        mode_label = "🔀 Stagger" if user.get("mode") == "stagger" else "⚡ Normal"
        await event.edit(
            "**📢 إعدادات النشر التلقائي:**",
            buttons=[
                [Button.inline("➕ إضافة كروب", b"add_gr"),    Button.inline("📋 قائمة الكروبات", b"list_gr")],
                [Button.inline("📝 إضافة رسالة", b"add_msg"),   Button.inline("🖼️ عرض الرسائل", b"list_msg")],
                [Button.inline("⏱️ وقت النشر",   b"time_set"),  Button.inline("⏳ الرسالة القادمة", b"next_msg")],
                [Button.inline(f"وضع النشر: {mode_label}", b"toggle_mode")],
                [Button.inline("▶️ تشغيل", b"run"),             Button.inline("⏹️ إيقاف", b"stop")],
                [Button.inline("🔙 رجوع", b"main")]
            ]
        )

    elif data == "toggle_mode":
        user["mode"] = "stagger" if user.get("mode") == "normal" else "normal"
        save_users()
        await event.answer(f"تم التبديل إلى: {user['mode'].upper()}", alert=True)
        # re-render pub menu
        event.data = b"pub"
        await on_callback(event)

    elif data == "next_msg":
        if uid in posting_tasks and uid in next_post_time:
            rem = (next_post_time[uid] - datetime.now()).total_seconds()
            await event.answer(f"⏳ المتبقي: {max(0, int(rem))} ثانية", alert=True)
        else:
            await event.answer("⚠️ النشر متوقف حالياً", alert=True)

    elif data == "add_gr":
        await _add_group(event, uid, user)

    elif data == "list_gr":
        if not user["groups"]:
            return await event.answer("⚠️ القائمة فارغة", alert=True)
        btns = [
            [Button.inline(f"🔹 {g}", b"none"), Button.inline("🗑️ حذف", f"del_gr_{i}".encode())]
            for i, g in enumerate(user["groups"])
        ]
        btns.append([Button.inline("🔙 رجوع", b"pub")])
        await event.edit("**📋 قائمة الكروبات:**", buttons=btns)

    elif data.startswith("del_gr_"):
        idx = int(data.split("_")[-1])
        if 0 <= idx < len(user["groups"]):
            user["groups"].pop(idx)
            save_users()
            await event.answer("✅ تم الحذف")
        if not user["groups"]:
            await event.edit("**⚠️ القائمة فارغة**", buttons=[[Button.inline("🔙 رجوع", b"pub")]])
        else:
            btns = [
                [Button.inline(f"🔹 {g}", b"none"), Button.inline("🗑️ حذف", f"del_gr_{i}".encode())]
                for i, g in enumerate(user["groups"])
            ]
            btns.append([Button.inline("🔙 رجوع", b"pub")])
            await event.edit("**📋 قائمة الكروبات:**", buttons=btns)

    elif data == "add_msg":
        await event.edit(
            "**📝 اختر نوع الرسالة:**",
            buttons=[
                [Button.inline("📄 نص فقط", b"msg_text"), Button.inline("🖼️ نص + ميديا", b"msg_media")],
                [Button.inline("🔙 رجوع", b"pub")]
            ]
        )

    elif data in (b"msg_text", b"msg_media", "msg_text", "msg_media"):
        await _add_message(event, uid, user, with_media=(data in ("msg_media", b"msg_media")))

    elif data == "list_msg":
        if not user["messages"]:
            return await event.answer("⚠️ لا توجد رسائل", alert=True)

        # ── Build table header ──
        total = len(user["messages"])
        lines = [
            "**📋 قائمة الرسائل:**",
            f"━━━━━━━━━━━━━━━━━━━━",
            f"**إجمالي الرسائل: {total}**",
            "━━━━━━━━━━━━━━━━━━━━",
        ]
        for i, m in enumerate(user["messages"]):
            preview = (m.get("text") or "").strip()[:40] or "─"
            media_icon = "🖼️" if m.get("media") and os.path.exists(str(m["media"])) else "📄"
            lines.append(f"{media_icon} **[{i+1}]** {preview}")

        lines.append("━━━━━━━━━━━━━━━━━━━━")
        table_text = "\n".join(lines)

        # ── One delete button per row ──
        btns = [
            [
                Button.inline(f"📝 رسالة {i+1}", b"none"),
                Button.inline("🗑️ حذف", f"del_msg_{i}".encode())
            ]
            for i in range(total)
        ]
        btns.append([Button.inline("🔙 رجوع", b"pub")])

        await event.edit(table_text, buttons=btns)

    elif data.startswith("del_msg_"):
        idx = int(data.split("_")[-1])
        if 0 <= idx < len(user["messages"]):
            removed = user["messages"].pop(idx)
            media = removed.get("media")
            if media and os.path.exists(str(media)):
                try:
                    os.remove(media)
                except Exception:
                    pass
            save_users()
            await event.answer("✅ تم الحذف", alert=True)

        # ── Refresh the table after delete ──
        if not user["messages"]:
            await event.edit("**⚠️ لا توجد رسائل**", buttons=[[Button.inline("🔙 رجوع", b"pub")]])
        else:
            total = len(user["messages"])
            lines = [
                "**📋 قائمة الرسائل:**",
                f"━━━━━━━━━━━━━━━━━━━━",
                f"**إجمالي الرسائل: {total}**",
                "━━━━━━━━━━━━━━━━━━━━",
            ]
            for i, m in enumerate(user["messages"]):
                preview = (m.get("text") or "").strip()[:40] or "─"
                media_icon = "🖼️" if m.get("media") and os.path.exists(str(m["media"])) else "📄"
                lines.append(f"{media_icon} **[{i+1}]** {preview}")
            lines.append("━━━━━━━━━━━━━━━━━━━━")
            table_text = "\n".join(lines)
            btns = [
                [Button.inline(f"📝 رسالة {i+1}", b"none"), Button.inline("🗑️ حذف", f"del_msg_{i}".encode())]
                for i in range(total)
            ]
            btns.append([Button.inline("🔙 رجوع", b"pub")])
            await event.edit(table_text, buttons=btns)

    elif data == "time_set":
        await _set_interval(event, uid, user)

    elif data == "run":
        if not is_active(uid):
            return await event.answer("⚠️ اشتراكك غير مفعل", alert=True)
        if not user.get("session"):
            return await event.answer("⚠️ الرجاء ربط حساب أولاً", alert=True)
        if not user["groups"]:
            return await event.answer("⚠️ أضف كروبات أولاً", alert=True)
        if not user["messages"]:
            return await event.answer("⚠️ أضف رسائل أولاً", alert=True)
        if uid in posting_tasks:
            return await event.answer("🚀 النشر يعمل بالفعل", alert=True)
        launch_posting(uid)
        await event.edit(
            "**🚀 بدأ النشر التلقائي ✅**",
            buttons=[[Button.inline("⏹️ إيقاف النشر", b"stop")], [Button.inline("🔙 رجوع", b"pub")]]
        )

    elif data == "stop":
        if uid in posting_tasks:
            stop_posting(uid)
            await event.edit(
                "**⏹️ تم إيقاف النشر**",
                buttons=[[Button.inline("▶️ تشغيل", b"run")], [Button.inline("🔙 رجوع", b"pub")]]
            )
        else:
            await event.answer("⚠️ النشر متوقف بالفعل", alert=True)

    # ── Data backup / restore ─────────────────
    elif data == "data":
        await event.edit(
            "**🛠 إدارة البيانات:**",
            buttons=[
                [Button.inline("📤 نسخ احتياطي", b"bk"), Button.inline("📥 استرجاع", b"rs")],
                [Button.inline("🔙 رجوع", b"main")]
            ]
        )

    elif data == "bk":
        backup = {"groups": user["groups"], "messages": user["messages"], "interval": user["interval"], "mode": user.get("mode", "normal")}
        fname = f"backup_{uid}.txt"
        with open(fname, 'w', encoding='utf-8') as f:
            f.write(str(backup))
        await bot.send_file(event.sender_id, fname, caption="**📦 ملف النسخة الاحتياطية لبياناتك**")
        os.remove(fname)

    elif data == "rs":
        await _restore_backup(event, uid, user)

    elif data == "sub_check":
        end = user.get("sub_end") or "غير مفعل"
        await event.answer(f"⏳ اشتراكك ينتهي في:\n{end}", alert=True)

    # ── Admin panel ───────────────────────────
    elif data == "admin":
        if event.sender_id != OWNER_ID:
            return await event.answer("🚫 غير مصرح", alert=True)
        await event.edit(
            "**👑 لوحة التحكم للمالك:**",
            buttons=[
                [Button.inline("🎫 صنع كود", b"gen_code"),  Button.inline("❌ سحب اشتراك", b"unsub")],
                [Button.inline("👥 قائمة المستخدمين", b"list_users")],
                [Button.inline("🔙 رجوع", b"main")]
            ]
        )

    elif data == "gen_code":
        if event.sender_id != OWNER_ID:
            return
        await _gen_code(event)

    elif data == "unsub":
        if event.sender_id != OWNER_ID:
            return
        await _unsub_user(event)

    elif data == "list_users":
        if event.sender_id != OWNER_ID:
            return
        lines = []
        for k, v in users_db.items():
            sub = "✅" if v.get("is_sub") else "❌"
            end = v.get("sub_end", "—")
            lines.append(f"• `{k}` {sub} → {end}")
        text = "**👥 المستخدمون:**\n" + ("\n".join(lines) if lines else "لا يوجد مستخدمون")
        await event.answer()
        await bot.send_message(OWNER_ID, text)

# ─────────────────────────────────────────────
#  CONVERSATION HANDLERS
# ─────────────────────────────────────────────
async def _login_session(event, uid: str, user: dict):
    """Allow user to link via String Session only."""
    if user.get("session"):
        return await event.answer("✅ حساب مرتبط بالفعل. قطع الاتصال أولاً.", alert=True)
    async with bot.conversation(int(uid), timeout=120) as conv:
        await conv.send_message(
            "**🔑 أرسل String Session الخاص بك (Telethon أو Pyrogram):**\n"
            "_(أرسل /cancel للإلغاء)_"
        )
        try:
            resp = await conv.get_response()
            if resp.text.strip() == "/cancel":
                return await conv.send_message("**تم الإلغاء ✅**", buttons=main_menu(uid))

            session_str = resp.text.strip()
            await conv.send_message("**⏳ جاري التحقق من الجلسة…**")

            valid = await validate_session(session_str)
            if not valid:
                return await conv.send_message(
                    "**❌ الجلسة غير صالحة أو منتهية. تأكد منها وحاول مجدداً.**",
                    buttons=main_menu(uid)
                )

            user["session"] = session_str
            save_users()
            await conv.send_message("**✅ تم ربط الحساب بنجاح 🎉**", buttons=main_menu(uid))
        except asyncio.TimeoutError:
            await conv.send_message("**⏰ انتهت مهلة الإدخال**", buttons=main_menu(uid))

async def _add_group(event, uid: str, user: dict):
    async with bot.conversation(int(uid), timeout=60) as conv:
        await conv.send_message(
            "**🆔 أرسل ID المجموعة (مثال: -100xxxxxxxxxx):**",
            buttons=[[Button.inline("❌ إلغاء", b"pub")]]
        )
        try:
            resp = await conv.get_response()
            gid = resp.text.strip()
            if not gid.lstrip('-').isdigit():
                return await conv.send_message("**⚠️ ID غير صالح**", buttons=main_menu(uid))
            if gid in user["groups"]:
                return await conv.send_message("**⚠️ المجموعة مضافة مسبقاً**", buttons=main_menu(uid))
            user["groups"].append(gid)
            save_users()
            await conv.send_message(f"**✅ تمت إضافة: `{gid}`**", buttons=[[Button.inline("🔙 رجوع", b"pub")]])
        except asyncio.TimeoutError:
            await conv.send_message("**⏰ انتهت مهلة الإدخال**", buttons=main_menu(uid))

async def _add_message(event, uid: str, user: dict, with_media: bool):
    async with bot.conversation(int(uid), timeout=120) as conv:
        label = "مع صورة/فيديو" if with_media else "نصية"
        await conv.send_message(
            f"**📝 أرسل الرسالة ال{label} الآن:**",
            buttons=[[Button.inline("❌ إلغاء", b"pub")]]
        )
        try:
            msg = await conv.get_response()
            media_path = None
            if with_media and msg.media:
                media_path = await bot.download_media(msg.media, file=f"media_{uid}_{len(user['messages'])}")
            user["messages"].append({"text": msg.text or "", "media": media_path})
            save_users()
            await conv.send_message("**✅ تم حفظ الرسالة**", buttons=[[Button.inline("🔙 رجوع", b"pub")]])
        except asyncio.TimeoutError:
            await conv.send_message("**⏰ انتهت مهلة الإدخال**", buttons=main_menu(uid))

async def _set_interval(event, uid: str, user: dict):
    async with bot.conversation(int(uid), timeout=60) as conv:
        await conv.send_message(
            "**⏱️ أرسل الفاصل الزمني بالثواني (مثال: 500):**",
            buttons=[[Button.inline("❌ إلغاء", b"pub")]]
        )
        try:
            resp = await conv.get_response()
            if not resp.text.isdigit():
                return await conv.send_message("**⚠️ أرسل رقم صحيح فقط**", buttons=main_menu(uid))
            user["interval"] = int(resp.text)
            save_users()
            await conv.send_message(f"**✅ تم ضبط الفاصل: {resp.text} ثانية**", buttons=[[Button.inline("🔙 رجوع", b"pub")]])
        except asyncio.TimeoutError:
            await conv.send_message("**⏰ انتهت مهلة الإدخال**", buttons=main_menu(uid))

async def _restore_backup(event, uid: str, user: dict):
    async with bot.conversation(int(uid), timeout=120) as conv:
        await conv.send_message("**📥 أرسل ملف txt النسخة الاحتياطية كـ (Document/ملف):**")
        try:
            resp = await conv.get_response()
            if not (resp.media and hasattr(resp.media, 'document')):
                return await conv.send_message(
                    "**⚠️ الرجاء إرسال الملف كـ Document وليس صورة أو نص عادي**",
                    buttons=main_menu(uid)
                )
            path = await resp.download_media()
            if not path:
                return await conv.send_message("**❌ فشل تحميل الملف**", buttons=main_menu(uid))
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = ast.literal_eval(f.read())
                allowed_keys = {"groups", "messages", "interval", "mode"}
                for k in allowed_keys:
                    if k in data:
                        user[k] = data[k]
                save_users()
                await conv.send_message("**✅ تم استرجاع البيانات بنجاح 🎉**", buttons=main_menu(uid))
            except Exception as e:
                await conv.send_message(f"**❌ خطأ في قراءة الملف:\n`{e}`**", buttons=main_menu(uid))
            finally:
                if os.path.exists(path):
                    os.remove(path)
        except asyncio.TimeoutError:
            await conv.send_message("**⏰ انتهت مهلة الإدخال**", buttons=main_menu(uid))

async def _gen_code(event):
    async with bot.conversation(OWNER_ID, timeout=60) as conv:
        await conv.send_message("**🎫 كم عدد أيام الكود؟ (أرسل رقم فقط):**")
        try:
            resp = await conv.get_response()
            if not resp.text.isdigit():
                return await conv.send_message("**⚠️ أرسل رقم صحيح**")
            days = int(resp.text)
            code = "GMN-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
            active_codes[code] = days
            save_db(CODES_FILE, active_codes)
            await conv.send_message(
                f"**🎫 كود لمدة {days} يوم:\n`{code}`**",
                buttons=[[Button.inline("🔙 رجوع", b"admin")]]
            )
        except asyncio.TimeoutError:
            await conv.send_message("**⏰ انتهت المهلة**")

async def _unsub_user(event):
    async with bot.conversation(OWNER_ID, timeout=60) as conv:
        await conv.send_message("**❌ أرسل ID المستخدم لإلغاء اشتراكه:**")
        try:
            resp = await conv.get_response()
            tid = resp.text.strip()
            if tid not in users_db:
                return await conv.send_message("**⚠️ المستخدم غير موجود**")
            users_db[tid]["is_sub"] = False
            save_users()
            stop_posting(tid)
            try:
                await bot.send_message(int(tid), "**⚠️ تم إلغاء اشتراكك. تواصل مع المطور.**")
            except Exception:
                pass
            await conv.send_message(f"**✅ تم إلغاء اشتراك `{tid}`**")
        except asyncio.TimeoutError:
            await conv.send_message("**⏰ انتهت المهلة**")

# ─────────────────────────────────────────────
#  STARTUP
# ─────────────────────────────────────────────
async def main():
    log.info("Bot starting…")
    asyncio.create_task(periodic_session_check())
    log.info("Bot running ✅")
    await bot.run_until_disconnected()

if __name__ == '__main__':
    with bot:
        bot.loop.run_until_complete(main())
