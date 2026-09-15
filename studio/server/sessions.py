"""Who is signed in to the studio, and the sign-ins still in flight.

Held in memory: a restart signs everyone out, which costs a click on "Sign in with
GitHub" and keeps GitHub tokens off the disk. A session is found by a random id in
an HttpOnly cookie; the token it holds never reaches the page (see github.py).
"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field


@dataclass
class Session:
    login: str
    token: str
    token_expires: float | None = None     # epoch seconds; None when the token does not expire
    refresh_token: str | None = None
    created: float = field(default_factory=time.time)

    @classmethod
    def from_tokens(cls, login: str, tokens: dict) -> "Session":
        session = cls(login=login, token=tokens["access_token"])
        session.take(tokens)
        return session

    def take(self, tokens: dict) -> None:
        """Adopt a token response from GitHub (a sign-in or a refresh)."""
        self.token = tokens["access_token"]
        expires_in = tokens.get("expires_in")
        self.token_expires = time.time() + int(expires_in) if expires_in else None
        self.refresh_token = tokens.get("refresh_token") or self.refresh_token


class Sessions:
    STATE_SECONDS = 10 * 60
    SESSION_SECONDS = 7 * 24 * 3600

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}
        self._states: dict[str, float] = {}

    def new_state(self) -> str:
        """A one-time value for a sign-in about to go to GitHub."""
        state = secrets.token_urlsafe(24)
        now = time.time()
        with self._lock:
            self._states = {s: t for s, t in self._states.items() if t > now}
            self._states[state] = now + self.STATE_SECONDS
        return state

    def take_state(self, state: str) -> bool:
        """True once for a state this server issued and has not seen come back."""
        with self._lock:
            expires = self._states.pop(state, None)
        return expires is not None and expires > time.time()

    def create(self, session: Session) -> str:
        sid = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions[sid] = session
        return sid

    def get(self, sid: str) -> Session | None:
        with self._lock:
            session = self._sessions.get(sid)
            if session and time.time() - session.created > self.SESSION_SECONDS:
                del self._sessions[sid]
                return None
            return session

    def drop(self, sid: str) -> None:
        with self._lock:
            self._sessions.pop(sid, None)
