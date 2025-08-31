import os
import subprocess
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.types import Message, MessageMediaPhoto, MessageMediaDocument, DocumentAttributeFilename
from motor.motor_asyncio import AsyncIOMotorClient
from config import CHANNELS_CONFIG
from dotenv import load_dotenv

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

DOWNLOADS_DIR = os.path.expanduser("~/tg-to-cloud-python/Downloads")
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB in bytes

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
            await db.messages.insert_one({
                "chat_id": chat.id,
                "chat_title": chat.title,
                "message_id": message.id,
                "file_name": file_name,
                "cloud_path": remote_path,
                "cloud_provider": "terabox",
                "from_listener": True
            }) 

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
        ["ts-node", "src/index.ts", *args],
        capture_output=True,
        text=True
    )
    print("STDOUT:")
    print(result.stdout)
    print("STDERR:")
    print(result.stderr)

    if(result.stderr):
        return result.stderr

# ---------------- Export Chat ----------------
@app.get("/export/{dialog_title}")
async def export_dialog(dialog_title: str, background_tasks: BackgroundTasks, exts: str = Query(...)):
    # split by comma and strip spaces
    allowed_extensions: List[str] = [ext.strip() for ext in exts.split(",")]
    matched_dialog = None
    async for dialog in client.iter_dialogs():
        if(dialog_title in dialog.title): 
            matched_dialog = dialog
            break

    if not matched_dialog:
        raise HTTPException(status_code=404, detail="Dialog not found")

    # schedule the heavy job in background
    async def process_dialog(dialog, allowed_extensions):
        async for message in client.iter_messages(dialog):
            if message.media:
                await handle_message(dialog, message, allowed_extensions)

    background_tasks.add_task(process_dialog, matched_dialog, allowed_extensions)

    return {"message": "Your request is submitted. Chat will be exported soon!!"}

# ---------------- Run everything ----------------
import asyncio

async def main():
    # Start Telethon client
    await client.start()
    print("Telegram client started...")

    # Run FastAPI in background
    import uvicorn
    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
    server = uvicorn.Server(config)
    
    await asyncio.gather(
        server.serve(),  # FastAPI server
        client.run_until_disconnected()  # Telethon client
    )

if __name__ == "__main__":
    asyncio.run(main())
