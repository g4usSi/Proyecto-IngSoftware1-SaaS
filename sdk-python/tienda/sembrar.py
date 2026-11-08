"""Carga el catálogo inicial: sube las fotos de semillas/ a SmartStorage con el SDK.

    python -m tienda.sembrar            (desde la carpeta sdk-python)
"""
from __future__ import annotations

import json
import sys

from smartstorage import SmartStorageClient, SmartStorageError

from . import catalogo


def main() -> int:
    try:
        cliente = SmartStorageClient.from_env()
        print(f"Plan: {cliente.quota()['plan']['name']}")
        album = catalogo.album_tienda(cliente)
        existentes = {p["slug"]: p for p in catalogo.cargar()}
        base = json.loads((catalogo.CARPETA / "catalogo_base.json").read_text(encoding="utf-8"))
        productos = []
        for producto in base:
            if producto["slug"] in existentes:
                productos.append(existentes[producto["slug"]])
                print(f"  ya estaba: {producto['nombre']} {producto['color']}")
                continue
            ruta = catalogo.CARPETA / "semillas" / producto["archivo"]
            foto = catalogo.publicar_foto(cliente, ruta, producto["archivo"], album)
            productos.append({**{k: v for k, v in producto.items() if k != "archivo"}, **foto})
            ahorro = 100 - foto["bytesWebp"] * 100 / max(1, foto["bytesOriginal"])
            print(f"  subida: {producto['nombre']} {producto['color']}  "
                  f"{foto['bytesOriginal'] / 1e6:.2f} MB → {foto['bytesWebp'] / 1e3:.0f} KB WebP ({ahorro:.0f} % menos)")
        catalogo.guardar(productos)
        print(f"Catálogo listo: {len(productos)} productos en el álbum «{catalogo.ALBUM}».")
        return 0
    except SmartStorageError as error:
        print(f"Error {error.status} {error.code}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
