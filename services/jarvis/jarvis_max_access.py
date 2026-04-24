"""
Сервер доступа 0.0.1: проверка и добавление разрешённых Telegram ID.
Запуск: uvicorn jarvis_max_access:app --host 0.0.0.0 --port 8000
"""
import json
import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Nexa Access API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Файл со списком разрешённых ID (рядом со скриптом или в текущей папке)
DATA_DIR = Path(__file__).resolve().parent
ALLOWED_FILE = DATA_DIR / "nexa_allowed.json"

API_KEY = os.environ.get("NEXA_API_KEY", "").strip()


def load_allowed() -> set:
    """Загрузить множество разрешённых user_id из файла."""
    if not ALLOWED_FILE.exists():
        return set()
    try:
        with open(ALLOWED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        ids = data.get("user_ids", data) if isinstance(data, dict) else data
        return set(str(x) for x in ids)
    except Exception:
        return set()


def save_allowed(allowed: set) -> None:
    """Сохранить множество разрешённых user_id в файл."""
    with open(ALLOWED_FILE, "w", encoding="utf-8") as f:
        json.dump({"user_ids": list(allowed)}, f, ensure_ascii=False, indent=2)


def check_api_key(x_api_key: str | None) -> None:
    """Если в окружении задан NEXA_API_KEY, требовать его в заголовке."""
    if not API_KEY:
        return
    if (x_api_key or "").strip() != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid x-api-key")


@app.get("/api/jarvis-max/check")
def check_access(user_id: str, x_api_key: str | None = Header(None, alias="x-api-key")):
    """Проверка: разрешён ли пользователь с данным Telegram ID."""
    check_api_key(x_api_key)
    allowed = load_allowed()
    return {"allowed": user_id.strip() in allowed}


@app.post("/api/nexa/allowed")
async def add_allowed(request: Request, x_api_key: str | None = Header(None, alias="x-api-key")):
    """Добавить user_id в список разрешённых (вызывается при ручном добавлении в приложении)."""
    check_api_key(x_api_key)
    body = await request.json()
    user_id = body.get("user_id")
    if not user_id and isinstance(body.get("user_ids"), list) and body["user_ids"]:
        user_id = body["user_ids"][0]
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    user_id = str(user_id).strip()
    allowed = load_allowed()
    allowed.add(user_id)
    save_allowed(allowed)
    return {"ok": True, "user_id": user_id}


@app.get("/")
def root():
    return {"service": "Nexa Access API", "endpoints": ["/api/nexa/check", "/api/nexa/allowed"]}
