import os
from pathlib import Path

import httpx
from dotenv import dotenv_values
from fastapi import Depends, Header, HTTPException

ADMIN_ROLES = {"admin", "teacher"}
AUTH_TIMEOUT_SECONDS = 10


WEB_APP_ENV_FILE = Path(__file__).resolve().parent.parent / "web-app" / ".env.local"


def _supabase_config() -> tuple[str, str]:
    # Local dev fallback: reuse the public Supabase URL/anon key the web app already has.
    web_env = dotenv_values(WEB_APP_ENV_FILE) if WEB_APP_ENV_FILE.is_file() else {}
    url = (os.getenv("SUPABASE_URL") or web_env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY") or web_env.get("VITE_SUPABASE_ANON_KEY") or ""
    if not url or not anon_key:
        raise HTTPException(
            status_code=503,
            detail="ai_service chua cau hinh SUPABASE_URL / SUPABASE_ANON_KEY de xac thuc.",
        )
    return url, anon_key


async def current_user(authorization: str = Header(default="")) -> dict[str, str]:
    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Thieu token dang nhap.")

    url, anon_key = _supabase_config()
    try:
        async with httpx.AsyncClient(timeout=AUTH_TIMEOUT_SECONDS) as http:
            response = await http.get(
                f"{url}/auth/v1/user",
                headers={"apikey": anon_key, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Khong ket noi duoc Supabase Auth.") from error

    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Token dang nhap khong hop le hoac da het han.")

    user_id = response.json().get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token dang nhap khong hop le.")
    return {"id": user_id, "token": token}


async def require_admin(user: dict[str, str] = Depends(current_user)) -> dict[str, str]:
    url, anon_key = _supabase_config()
    try:
        async with httpx.AsyncClient(timeout=AUTH_TIMEOUT_SECONDS) as http:
            response = await http.get(
                f"{url}/rest/v1/user_profiles",
                params={"user_id": f"eq.{user['id']}", "select": "role,status"},
                headers={"apikey": anon_key, "Authorization": f"Bearer {user['token']}"},
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Khong doc duoc user_profiles.") from error

    rows = response.json() if response.status_code == 200 else []
    profile = rows[0] if isinstance(rows, list) and rows else {}
    if profile.get("role") not in ADMIN_ROLES or (profile.get("status") or "active") != "active":
        raise HTTPException(status_code=403, detail="Chi admin/teacher duoc dung chuc nang nay.")
    return user
