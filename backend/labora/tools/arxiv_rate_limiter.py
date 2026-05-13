import threading
import time
from urllib.parse import urlparse

ARXIV_MIN_REQUEST_INTERVAL_SECONDS = 3.0

_LOCK = threading.Lock()
_NEXT_ALLOWED_REQUEST_AT = 0.0


def wait_for_arxiv_request_slot(
    min_interval_seconds: float = ARXIV_MIN_REQUEST_INTERVAL_SECONDS,
) -> None:
    """Block until the next global arXiv request slot is available."""
    global _NEXT_ALLOWED_REQUEST_AT

    while True:
        with _LOCK:
            now = time.monotonic()
            if now >= _NEXT_ALLOWED_REQUEST_AT:
                _NEXT_ALLOWED_REQUEST_AT = now + min_interval_seconds
                return
            wait_seconds = _NEXT_ALLOWED_REQUEST_AT - now
        time.sleep(wait_seconds)


def is_arxiv_url(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return host.lower().endswith("arxiv.org")
