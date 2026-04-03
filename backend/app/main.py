"""FastAPI application entrypoint."""
import os
from urllib.parse import urlparse
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import router

app = FastAPI(
    title="CoPro Calculator API",
    description="Film coproduction financing scenario engine",
    version="2.0.0",
)

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def _frontend_origin_variants(frontend_url: str) -> list[str]:
    """Expand a configured frontend URL to include apex/www variants."""
    parsed = urlparse(frontend_url)
    if not parsed.scheme or not parsed.netloc:
        return []

    host = parsed.hostname or ""
    if host in {"localhost", "127.0.0.1"}:
        return [f"{parsed.scheme}://{parsed.netloc}"]

    variants = {f"{parsed.scheme}://{parsed.netloc}"}
    if host.startswith("www."):
        alt_host = host[4:]
    else:
        alt_host = f"www.{host}"

    if parsed.port:
        variants.add(f"{parsed.scheme}://{alt_host}:{parsed.port}")
    else:
        variants.add(f"{parsed.scheme}://{alt_host}")

    return sorted(variants)


frontend_urls = os.getenv("FRONTEND_URL", "")
for frontend_url in frontend_urls.split(","):
    frontend_url = frontend_url.strip()
    if frontend_url:
        origins.extend(_frontend_origin_variants(frontend_url))

origins = list(dict.fromkeys(origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")
