"""SDK de SmartStorage para Python 3.9 o superior, sin dependencias.

Se autentica con una clave de API (``ss_...``) creada en la aplicación:
Desarrolladores → Claves de API. Requiere plan Estándar o superior.

    from smartstorage import SmartStorageClient
    client = SmartStorageClient(api_key="ss_...")
    job = client.upload_image("foto.jpg")          # espera a que se publique
    client.download_image_to(job["imageId"], "foto.webp")
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Iterator, Optional, Union
from urllib import error as urlerror
from urllib import parse, request

__all__ = ["SmartStorageClient", "SmartStorageError"]
__version__ = "1.0.0"

_CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


class SmartStorageError(Exception):
    """Error de la API o de red. ``status`` es 0 cuando no hubo respuesta HTTP."""

    def __init__(self, message: str, status: int = 0, code: str = "NETWORK_ERROR", details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details

    @property
    def retryable(self) -> bool:
        return self.code == "NETWORK_ERROR" or self.status >= 500


class SmartStorageClient:
    def __init__(self, api_key: str, base_url: str = "http://127.0.0.1:3000/api", timeout: float = 30.0):
        if not isinstance(api_key, str) or not api_key.startswith("ss_"):
            raise ValueError('api_key debe ser una clave de API de SmartStorage (empieza con "ss_").')
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "SmartStorageClient":
        """Lee SMARTSTORAGE_API_KEY y, opcionalmente, SMARTSTORAGE_URL."""
        key = os.environ.get("SMARTSTORAGE_API_KEY")
        if not key:
            raise SmartStorageError("Define la variable SMARTSTORAGE_API_KEY con tu clave de API.", code="MISSING_API_KEY")
        return cls(key, os.environ.get("SMARTSTORAGE_URL", "http://127.0.0.1:3000/api"))

    # ── Transporte ──────────────────────────────────────────────
    def _request(self, route: str, method: str = "GET", body: Optional[bytes] = None,
                 headers: Optional[dict] = None, raw: bool = False) -> Any:
        req = request.Request(f"{self.base_url}{route}", data=body, method=method,
                              headers={"Authorization": f"Bearer {self.api_key}", **(headers or {})})
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                payload = response.read()
        except urlerror.HTTPError as exc:
            try:
                failure = json.loads(exc.read() or b"{}").get("error", {})
            except ValueError:
                failure = {}
            raise SmartStorageError(failure.get("message", f"Error HTTP {exc.code}"), exc.code,
                                    failure.get("code", "HTTP_ERROR"), failure.get("details")) from None
        except (urlerror.URLError, TimeoutError, ConnectionError) as exc:
            reason = getattr(exc, "reason", exc)
            raise SmartStorageError(f"No se pudo conectar con SmartStorage: {reason}") from None
        return payload if raw else json.loads(payload)["data"]

    def _json(self, route: str, method: str, value: Optional[dict] = None) -> Any:
        return self._request(route, method, json.dumps(value or {}).encode(), {"Content-Type": "application/json"})

    # ── Cuenta ──────────────────────────────────────────────────
    def quota(self) -> dict:
        """Plan vigente, capacidad y consumo diario."""
        return self._request("/quotas/me")

    def summary(self) -> dict:
        """Espacio lógico frente a físico y ahorro acumulado."""
        return self._request("/files/summary")

    # ── Imágenes ────────────────────────────────────────────────
    def list_images(self, limit: Optional[int] = None, cursor: Optional[str] = None,
                    folder_id: Union[str, None, bool] = False, trash: Optional[bool] = None) -> dict:
        """Una página: {items, unavailableItems, nextCursor}. folder_id=None pide las imágenes sin álbum."""
        query = {}
        if limit is not None:
            query["limit"] = str(limit)
        if cursor:
            query["cursor"] = cursor
        if folder_id is not False:
            query["folderId"] = "none" if folder_id is None else folder_id
        if trash is not None:
            query["trash"] = "true" if trash else "false"
        return self._request("/files" + (f"?{parse.urlencode(query)}" if query else ""))

    def images(self, **options) -> Iterator[dict]:
        """Recorre todas las imágenes, página por página."""
        cursor = None
        while True:
            page = self.list_images(cursor=cursor, **options)
            yield from page["items"]
            cursor = page.get("nextCursor")
            if not cursor:
                return

    def upload_image(self, image: Union[str, Path, bytes], filename: Optional[str] = None,
                     folder_id: Optional[str] = None, wait: bool = True, timeout: float = 120.0,
                     idempotency_key: Optional[str] = None) -> dict:
        """Sube una imagen JPG, PNG o WebP de hasta 25 MB y, por defecto, espera a que se publique.

        Reintenta errores de red y 5xx con la misma Idempotency-Key: si la primera respuesta se
        perdió, el servidor devuelve el mismo trabajo en lugar de admitir otra carga.
        """
        if isinstance(image, (str, Path)):
            path = Path(image)
            content, name = path.read_bytes(), filename or path.name
        else:
            content, name = bytes(image), filename or "imagen"
        key = idempotency_key or str(uuid.uuid4())
        body, content_type = _multipart(content, name, folder_id)
        for attempt in range(1, 4):
            try:
                job = self._request("/jobs", "POST", body, {"Content-Type": content_type, "Idempotency-Key": key})
                break
            except SmartStorageError as exc:
                if attempt == 3 or not exc.retryable:
                    raise
                time.sleep(0.5 * attempt)
        return self.wait_for_job(job["id"], timeout) if wait else job

    def get_job(self, job_id: str) -> dict:
        return self._request(f"/jobs/{parse.quote(job_id)}")

    def wait_for_job(self, job_id: str, timeout: float = 120.0) -> dict:
        """Consulta el trabajo hasta que termina. Lanza JOB_FAILED o JOB_TIMEOUT."""
        deadline = time.monotonic() + timeout
        while True:
            job = self.get_job(job_id)
            if job["status"] == "published":
                return job
            if job["status"] == "failed":
                raise SmartStorageError("La imagen no se pudo procesar.", 422, "JOB_FAILED",
                                        {"jobId": job_id, "errorCode": job.get("errorCode")})
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise SmartStorageError("La imagen sigue en proceso; consulta el trabajo más tarde.", code="JOB_TIMEOUT",
                                        details={"jobId": job_id})
            time.sleep(min((job.get("nextPollAfterMs") or 1000) / 1000, remaining))

    def download_image(self, image_id: str) -> bytes:
        """Contenido WebP de una imagen propia."""
        return self._request(f"/files/{parse.quote(image_id)}/download", raw=True)

    def download_image_to(self, image_id: str, path: Union[str, Path]) -> Path:
        target = Path(path)
        target.write_bytes(self.download_image(image_id))
        return target

    # ── Álbumes y papelera ─────────────────────────────────────
    def list_albums(self) -> dict:
        return self._request("/albums")

    def create_album(self, name: str) -> dict:
        return self._json("/albums", "POST", {"name": name})

    def move_image(self, image_id: str, folder_id: Optional[str]) -> dict:
        return self._json(f"/files/{parse.quote(image_id)}", "PATCH", {"folderId": folder_id})

    def trash_image(self, image_id: str) -> dict:
        return self._json(f"/files/{parse.quote(image_id)}/trash", "POST")

    def restore_image(self, image_id: str) -> dict:
        return self._json(f"/files/{parse.quote(image_id)}/restore", "POST")

    def delete_image(self, image_id: str) -> dict:
        return self._request(f"/files/{parse.quote(image_id)}", "DELETE")


def _multipart(content: bytes, filename: str, folder_id: Optional[str]) -> tuple:
    boundary = f"smartstorage-{uuid.uuid4().hex}"
    safe_name = filename.replace('"', "'").replace("\r", " ").replace("\n", " ")
    mime = _CONTENT_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")
    parts = []
    if folder_id:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="folderId"\r\n\r\n{folder_id}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'
                 f"Content-Type: {mime}\r\n\r\n".encode("utf-8") + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"
