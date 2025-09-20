import os
import subprocess
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.types import (
    Message,
    MessageMediaPhoto,
    MessageMediaDocument,
    DocumentAttributeFilename,
)
from motor.motor_asyncio import AsyncIOMotorClient
from config import CHANNELS_CONFIG
from dotenv import load_dotenv
import psutil
from datetime import datetime

load_dotenv()

# Telegram client
api_id = int(os.getenv("API_ID"))
api_hash = os.getenv("API_HASH")
session_string = os.getenv("SESSION_STRING")
client = TelegramClient(StringSession(session_string), api_id, api_hash)

# FastAPI app
app = FastAPI()

# MongoDB client
mongo_uri = os.getenv("MONGO_URI")
mongo_db = os.getenv("MONGO_DB")
mongo_client = AsyncIOMotorClient(mongo_uri)
db = mongo_client[mongo_db]  # database

SAVE_DIR = os.getenv("SAVE_DIR", "Downloads")
BASE_PATH = os.getenv("BASE_PATH", "~/tg-to-cloud-python")
DOWNLOADS_DIR = os.path.expanduser(os.path.join(BASE_PATH, SAVE_DIR))

MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", 100 * 1024 * 1024))  # 100 MB
MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", 5))

EXPORT_LIMIT = int(os.getenv("EXPORT_LIMIT", 100))

# Ensure download directory exists
os.makedirs(DOWNLOADS_DIR, exist_ok=True)


@client.on(events.NewMessage())
async def handler(event: events.NewMessage.Event):
    chat = await event.get_chat()
    chat_title = getattr(chat, "title", "")

    allowed_exts = []
    isMatched = False

    for ch in CHANNELS_CONFIG["channelsToListen"]:
        # Match by title or ID
        if chat.id == ch["id"] or ch["title"] in chat_title:
            isMatched = True
            allowed_exts = ch.get("allowedMediaExt", [])
            break  # ✅ No need to loop further once matched

    # Only proceed if channe id matched OR title matched AND message has media
    if isMatched and event.message.media:
        await handle_message(chat, event.message, allowed_exts)


async def handle_message(chat, message: Message, allowed_exts):
    local_path = await download_media(message, allowed_exts)
    if local_path:
        remote_path = f"{chat.title}-{chat.id}"
        error = await upload_media(local_path, remote_path)
        print(error)
        if not error:
            print("No Error")
            file_name = os.path.basename(local_path)
            await db.messages.insert_one(
                {
                    "chat_id": chat.id,
                    "chat_title": chat.title,
                    "message_id": message.id,
                    "file_name": file_name,
                    "cloud_path": remote_path,
                    "cloud_provider": "terabox",
                    "from_listener": True,
                    "created_at": datetime.utcnow(),
                }
            )


async def download_media(message: Message, allowed_exts):
    media = message.media
    if isinstance(media, MessageMediaPhoto):
        # TO DO: Handle Photo if needed
        pass
    elif isinstance(media, MessageMediaDocument):
        print("📄 This is a document (pdf, video, audio, etc.)")
        doc = media.document
        filename = None

        # Extract original filename if available
        for attr in doc.attributes:
            if isinstance(attr, DocumentAttributeFilename):
                filename = attr.file_name
                break

        # Fallback filename if none provided
        if not filename:
            filename = f"file_{doc.id}.bin"

        # Get file extension
        file_ext = os.path.splitext(filename)[1]  # e.g. ".pdf", ".mp4"

        # Get file size (bytes)
        file_size = doc.size if doc.size else 0

        # ✅ Check extension allowed
        if allowed_exts and file_ext not in allowed_exts:
            print(f"⛔ Skipping {filename} (ext {file_ext} not allowed)")
            return None

        # ✅ Skip if file is too large
        if file_size > MAX_FILE_SIZE:
            print(f"⛔ Skipping file {filename} because it exceeds 100MB")
            return None

        # Full save path
        save_path = os.path.join(DOWNLOADS_DIR, filename)

        path = await message.download_media(file=save_path)
        print(f"✅ File saved at: {path}")
        print(f"📏 File size: {file_size / (1024*1024):.2f} MB")
        print(f"📂 Extension: {file_ext}")

        return path
    else:
        print("⚠️ Unsupported media type:", type(media))


async def upload_media(local_path, remote_path):
    args = [local_path, remote_path]

    result = subprocess.run(
        ["ts-node", "src/index.ts", *args], capture_output=True, text=True
    )
    print("STDOUT:")
    print(result.stdout)
    print("STDERR:")
    print(result.stderr)

    if result.stderr:
        return result.stderr


async def safe_download(dialog, message, allowed_extensions):
    """
    Downloads media safely with FloodWait handling
    """
    if not message.media:
        return None

    try:
        await handle_message(dialog, message, allowed_extensions)
    except FloodWaitError as e:
        print(f"[FloodWait] Sleeping for {e.seconds}s...")
        await asyncio.sleep(e.seconds)
        return await safe_download(dialog, message, allowed_extensions)
    except Exception as ex:
        print(f"[Error] Failed to download message {message.id}: {ex}")
        return None


async def process_dialog(
    dialog, allowed_extensions, max_concurrency: int = MAX_CONCURRENCY
):
    sem = asyncio.Semaphore(max_concurrency)

    batch = []

    # Fetch last checkpoint
    checkpoint = await db.exports.find_one({"chat_id": dialog.id})
    last_processed_message_id = (
        checkpoint.get("last_processed_message_id") if checkpoint else 0
    )

    async for message in client.iter_messages(
        entity=dialog,
        min_id=last_processed_message_id,  # resume from last processed
        limit=EXPORT_LIMIT,
        reverse=True,  # oldest → newest
        wait_time=1,  # optional pause between API calls
    ):
        batch.append(message)

        # Process batch when it reaches max_concurrency
        if len(batch) >= max_concurrency:
            await process_batch(batch, dialog, allowed_extensions, sem)

            # Update checkpoint in DB
            await db.exports.update_one(
                {"chat_id": dialog.id},
                {
                    "$set": {
                        "last_processed_message_id": batch[-1].id,
                        "last_processed_at": datetime.utcnow().isoformat(),
                        "chat_title": dialog.title,
                    }
                },
                upsert=True,
            )

            batch = []
            await asyncio.sleep(1)  # ✅ 1-second pause after each batch

    # Process any remaining messages
    if batch:
        await process_batch(batch, dialog, allowed_extensions, sem)


async def process_batch(batch, dialog, allowed_extensions, sem):
    """
    Process a batch of messages concurrently but limited by semaphore
    """

    async def worker(message):
        async with sem:
            return await safe_download(dialog, message, allowed_extensions)

    tasks = [asyncio.create_task(worker(msg)) for msg in batch]
    await asyncio.gather(*tasks)


# ---------------- Export Chat ----------------
@app.get("/export/{dialog_title}")
async def export_dialog(
    dialog_title: str, background_tasks: BackgroundTasks, exts: str = Query(...)
):
    # split by comma and strip spaces
    allowed_extensions: List[str] = [ext.strip() for ext in exts.split(",")]
    matched_dialog = None
    async for dialog in client.iter_dialogs():
        if dialog_title in dialog.title:
            matched_dialog = dialog
            break

    if not matched_dialog:
        raise HTTPException(status_code=404, detail="Dialog not found")

    background_tasks.add_task(
        process_dialog, matched_dialog, allowed_extensions, MAX_CONCURRENCY
    )

    return {"message": "Your request is submitted. Chat will be exported soon!!"}


# ---------------- Run everything ----------------
import asyncio


async def monitor_system(interval: int = 5):
    """
    Logs CPU and memory usage every `interval` seconds.
    """
    while True:
        cpu = psutil.cpu_percent()
        mem = psutil.virtual_memory().percent
        print(f"[Monitor] CPU: {cpu:.1f}% | RAM: {mem:.1f}%")
        await asyncio.sleep(interval)


async def main():
    # Start monitoring in background
    # asyncio.create_task(monitor_system(5))

    # Start Telethon client
    await client.start()
    print("Telegram client started...")

    # Run FastAPI in background
    import uvicorn

    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
    server = uvicorn.Server(config)

    await asyncio.gather(
        server.serve(),  # FastAPI server
        client.run_until_disconnected(),  # Telethon client
    )


if __name__ == "__main__":
    asyncio.run(main())
