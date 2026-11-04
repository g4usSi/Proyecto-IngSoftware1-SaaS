"""Catálogo de la tienda: productos guardados en catalogo.json con el ID de su foto en SmartStorage."""
from __future__ import annotations

import json
import re
import threading
import unicodedata
from pathlib import Path

from smartstorage import SmartStorageClient

CARPETA = Path(__file__).resolve().parent
ARCHIVO = CARPETA / "catalogo.json"
ALBUM = "Tienda Pulso"
_bloqueo = threading.Lock()


def cargar() -> list:
    if not ARCHIVO.exists():
        return []
    return json.loads(ARCHIVO.read_text(encoding="utf-8"))


def guardar(productos: list) -> None:
    with _bloqueo:
        temporal = ARCHIVO.with_suffix(".tmp")
        temporal.write_text(json.dumps(productos, ensure_ascii=False, indent=2), encoding="utf-8")
        temporal.replace(ARCHIVO)


def slug(texto: str) -> str:
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", plano.lower()).strip("-") or "producto"


def album_tienda(cliente: SmartStorageClient) -> str:
    """ID del álbum donde la tienda guarda sus fotos; lo crea la primera vez."""
    for album in cliente.list_albums()["items"]:
        if album["name"] == ALBUM:
            return album["id"]
    return cliente.create_album(ALBUM)["album"]["id"]


def publicar_foto(cliente: SmartStorageClient, contenido, nombre_archivo: str, album_id: str) -> dict:
    """Sube la foto con el SDK, espera su optimización y devuelve sus datos de almacenamiento."""
    trabajo = cliente.upload_image(contenido, filename=nombre_archivo, folder_id=album_id)
    imagen = next((i for i in cliente.images(folder_id=album_id) if i["id"] == trabajo["imageId"]), None)
    return {
        "imageId": trabajo["imageId"],
        "formatoOriginal": (imagen or {}).get("originalFormat"),
        "bytesOriginal": int((imagen or {}).get("originalSizeBytes", 0)),
        "bytesWebp": int((imagen or {}).get("optimizedSizeBytes", 0)),
    }
