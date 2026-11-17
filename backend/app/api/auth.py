from typing import Literal
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

"""Minimal authentication: salted PBKDF2 password hashes + HMAC-signed expiring tokens.

Uses only the Python standard library (no extra packages). Users are stored in
backend/data/users.json. The token-signing secret is read from the
ENERGYPULSE_SECRET environment variable, or generated once and saved to
backend/data/secret.key.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
USERS_FILE = DATA_DIR / "users.json"
SECRET_FILE = DATA_DIR / "secret.key"

TOKEN_TTL_SECONDS = 12 * 60 * 60      # sessions last 12 hours
PBKDF2_ROUNDS = 200_000
MAX_FAILED = 5                        # failed logins allowed ...
LOCKOUT_SECONDS = 5 * 60              # ... before a 5-minute lockout

DEFAULT_ADMIN = {"username": "admin", "password": "admin12345", "name": "Administrator"}

_lock = threading.Lock()
_failed: dict[str, tuple[int, float]] = {}   # username -> (count, first_failure_time)
_USERNAME_RE = re.compile(r"^[a-z0-9_.@+-]{3,64}$")


# ---------- passwords ----------
def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ---------- user store ----------
def _load_users() -> dict:
    if not USERS_FILE.exists():
        return {}
    try:
        return json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_users(users: dict) -> None:
    USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def create_user(username: str, password: str, name: str = "") -> dict:
    username = normalize_username(username)
    if not _USERNAME_RE.match(username):
        raise ValueError("Username must be 3-64 characters: letters, numbers, and . _ - @ + (an email address works).")
    if len(password or "") < 8:
        raise ValueError("Password must be at least 8 characters.")
    with _lock:
        users = _load_users()
        if username in users:
            raise ValueError("That username is already taken.")
        users[username] = {
            "name": (name or username).strip()[:60],
            "password": hash_password(password),
            "created": int(time.time()),
        }
        _save_users(users)
    return public_user(username, users[username])


def public_user(username: str, record: dict) -> dict:
    return {"username": username, "name": record.get("name") or username, "role": record.get("role", "user")}


def ensure_default_user() -> None:
    """Make sure a starter admin exists (local development convenience).

    - Brand-new install: creates admin / admin12345 with the admin role.
    - Existing install with no admin: creates 'admin' if the name is free, or repairs
      the starter 'admin' account (still using the starter password) by giving it the
      admin role. Your own accounts are never promoted automatically.
    """
    with _lock:
        users = _load_users()
        if any(u.get("role") == "admin" for u in users.values()):
            return
        starter = users.get(DEFAULT_ADMIN["username"])
        if starter is None:
            users[DEFAULT_ADMIN["username"]] = {
                "name": DEFAULT_ADMIN["name"],
                "password": hash_password(DEFAULT_ADMIN["password"]),
                "role": "admin",
                "created": int(time.time()),
            }
        elif verify_password(DEFAULT_ADMIN["password"], starter.get("password", "")):
            starter["role"] = "admin"
        else:
            return
        _save_users(users)
    print(
        f"[EnergyPulse] Admin login -> username: {DEFAULT_ADMIN['username']}  "
        f"password: {DEFAULT_ADMIN['password']}  (change this!)"
    )


def authenticate(username: str, password: str) -> dict | None:
    username = normalize_username(username)
    now = time.time()
    with _lock:
        count, first = _failed.get(username, (0, now))
        if count >= MAX_FAILED and now - first < LOCKOUT_SECONDS:
            raise PermissionError("Too many failed attempts. Try again in a few minutes.")
        if now - first >= LOCKOUT_SECONDS:
            count = 0
        record = _load_users().get(username)

    # Always run a hash so response time doesn't reveal whether the user exists.
    ok = verify_password(password or "", record["password"] if record else hash_password("x"))
    if record and ok:
        with _lock:
            _failed.pop(username, None)
        return public_user(username, record)

    with _lock:
        _failed[username] = (count + 1, first if count else now)
    return None


# ---------- tokens ----------
def _secret() -> bytes:
    env = os.environ.get("ENERGYPULSE_SECRET")
    if env:
        return env.encode()
    if not SECRET_FILE.exists():
        SECRET_FILE.write_text(secrets.token_hex(32))
    return SECRET_FILE.read_text().strip().encode()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(username: str) -> str:
    payload = _b64(json.dumps({"sub": username, "exp": int(time.time()) + TOKEN_TTL_SECONDS}).encode())
    sig = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def read_token(token: str) -> dict | None:
    """Return the user for a valid, unexpired token, otherwise None."""
    try:
        payload, sig = token.split(".")
        expected = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_unb64(payload))
        if data["exp"] < time.time():
            return None
        record = _load_users().get(data["sub"])
        return public_user(data["sub"], record) if record else None
    except Exception:
        return None

# ---------- authentication and admin API ----------
router = APIRouter(prefix="/api/auth", tags=["authentication"])


class AuthRequest(BaseModel):
    username: str
    password: str
    name: str = ""


def _current_user(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    user = read_token(authorization[len("Bearer "):])
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


@router.post("/register")
def register(data: AuthRequest):
    try:
        user = create_user(data.username, data.password, data.name)
        return {"message": "Account created successfully", "token": make_token(user["username"]), "user": user}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/login")
def login(data: AuthRequest):
    try:
        user = authenticate(data.username, data.password)
    except PermissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    return {"message": "Login successful", "token": make_token(user["username"]), "user": user}


@router.get("/me")
def me(authorization: str | None = Header(default=None)):
    return _current_user(authorization)


@router.get("/admin/users")
def list_users(authorization: str | None = Header(default=None)):
    current = _current_user(authorization)
    if current.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    users = _load_users()
    # Never return password hashes or credential material.
    return [
        {
            "username": username,
            "name": record.get("name") or username,
            "role": record.get("role", "user"),
            "created": record.get("created"),
        }
        for username, record in sorted(users.items())
    ]



# ---------- admin: create / update / delete accounts ----------
class AdminUserCreate(BaseModel):
    username: str
    password: str
    name: str = ""
    role: Literal["admin", "user"] = "user"


class AdminUserUpdate(BaseModel):
    name: str | None = None
    role: Literal["admin", "user"] | None = None
    password: str | None = None   # leave empty to keep the current password


def _require_admin(authorization: str | None) -> dict:
    current = _current_user(authorization)
    if current.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return current


def _admin_count(users: dict) -> int:
    return sum(1 for u in users.values() if u.get("role") == "admin")


def _listed(username: str, record: dict) -> dict:
    return {
        "username": username,
        "name": record.get("name") or username,
        "role": record.get("role", "user"),
        "created": record.get("created"),
    }


@router.post("/admin/users")
def admin_create_user(data: AdminUserCreate, authorization: str | None = Header(default=None)):
    _require_admin(authorization)
    try:
        created = create_user(data.username, data.password, data.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    with _lock:
        users = _load_users()
        users[created["username"]]["role"] = data.role
        _save_users(users)
        return _listed(created["username"], users[created["username"]])


@router.put("/admin/users/{username}")
def admin_update_user(username: str, data: AdminUserUpdate, authorization: str | None = Header(default=None)):
    current = _require_admin(authorization)
    username = normalize_username(username)
    with _lock:
        users = _load_users()
        record = users.get(username)
        if record is None:
            raise HTTPException(status_code=404, detail="Account not found.")
        if data.name is not None:
            name = data.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="Full name cannot be empty.")
            record["name"] = name[:60]
        if data.role is not None and data.role != record.get("role", "user"):
            if username == current["username"]:
                raise HTTPException(status_code=400, detail="You cannot change your own role.")
            if record.get("role") == "admin" and _admin_count(users) <= 1:
                raise HTTPException(status_code=400, detail="At least one administrator must remain.")
            record["role"] = data.role
        if data.password:
            if len(data.password) < 8:
                raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
            record["password"] = hash_password(data.password)
            _failed.pop(username, None)   # also clears any login lockout
        _save_users(users)
        return _listed(username, record)


@router.delete("/admin/users/{username}")
def admin_delete_user(username: str, authorization: str | None = Header(default=None)):
    current = _require_admin(authorization)
    username = normalize_username(username)
    if username == current["username"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    with _lock:
        users = _load_users()
        record = users.get(username)
        if record is None:
            raise HTTPException(status_code=404, detail="Account not found.")
        if record.get("role") == "admin" and _admin_count(users) <= 1:
            raise HTTPException(status_code=400, detail="At least one administrator must remain.")
        del users[username]
        _save_users(users)
    return {"message": f"Account '{username}' deleted."}