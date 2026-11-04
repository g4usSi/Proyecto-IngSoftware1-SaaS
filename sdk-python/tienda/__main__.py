"""Tienda de demostración «Pulso»: sus fotos de producto viven en SmartStorage y se sirven con el SDK.

    cd sdk-python
    $env:SMARTSTORAGE_API_KEY = 'ss_...'
    python -m tienda.sembrar
    python -m tienda            → http://127.0.0.1:8080
"""
from __future__ import annotations

import email
import email.policy
import html
import os
import sys
import threading
from collections import OrderedDict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from smartstorage import SmartStorageClient, SmartStorageError

from . import catalogo

ESTATICOS = catalogo.CARPETA / "estatico"
MAX_SUBIDA = 25_000_000
CATEGORIAS = ["Running", "Trail", "Urbano"]
TALLAS = ["38", "39", "40", "41", "42", "43", "44", "45"]
e = html.escape


class CacheImagenes:
    """Guarda en memoria los WebP ya descargados para no pedirlos en cada visita."""

    def __init__(self, limite: int = 64):
        self._datos: OrderedDict = OrderedDict()
        self._limite = limite
        self._bloqueo = threading.Lock()

    def obtener(self, cliente: SmartStorageClient, image_id: str) -> bytes:
        with self._bloqueo:
            if image_id in self._datos:
                self._datos.move_to_end(image_id)
                return self._datos[image_id]
        contenido = cliente.download_image(image_id)
        with self._bloqueo:
            self._datos[image_id] = contenido
            while len(self._datos) > self._limite:
                self._datos.popitem(last=False)
        return contenido


def kb(n: int) -> str:
    return f"{n / 1e6:.1f} MB" if n >= 1e6 else f"{n / 1e3:.0f} KB"


def ahorro(p: dict) -> int:
    return round(100 - p["bytesWebp"] * 100 / max(1, p["bytesOriginal"]))


def pagina(titulo: str, cuerpo: str, actual: str = "") -> str:
    enlaces = "".join(
        f'<a href="/?cat={quote(c)}"{" aria-current=page" if c == actual else ""}>{c}</a>' for c in CATEGORIAS)
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titulo)} | Pulso</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;1,800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/estatico/tienda.css"></head>
<body>
<p class="aviso">Envío gratis en compras desde US$50. Tienda de demostración: no se procesan compras reales.</p>
<header class="cabecera">
  <a class="marca" href="/" aria-label="Pulso, inicio">PULSO</a>
  <nav class="menu" aria-label="Categorías"><a href="/"{" aria-current=page" if actual == "inicio" else ""}>Novedades</a>{enlaces}</nav>
  <a class="bolsa" href="#" aria-label="Bolsa de compras">Bolsa <span data-bolsa>0</span></a>
</header>
<main>{cuerpo}</main>
<footer class="pie">
  <div><strong>Pulso</strong><p>Tienda ficticia creada para demostrar el SDK de SmartStorage.</p></div>
  <div><strong>Fotos de producto</strong><p>Se suben con el SDK de Python, se convierten a WebP y se sirven desde la biblioteca privada de la tienda.</p></div>
  <div><a href="/admin">Agregar un producto</a></div>
</footer>
<script>
const contador = document.querySelector('[data-bolsa]');
const leer = () => {{ try {{ return Number(localStorage.getItem('pulso-bolsa') || 0); }} catch {{ return 0; }} }};
contador.textContent = leer();
document.querySelectorAll('[data-agregar]').forEach((boton) => boton.addEventListener('click', () => {{
  if (!document.querySelector('.tallas input:checked')) {{ document.querySelector('.tallas-aviso').hidden = false; return; }}
  const total = leer() + 1;
  try {{ localStorage.setItem('pulso-bolsa', total); }} catch {{}}
  contador.textContent = total;
  boton.textContent = 'Agregado a la bolsa';
  setTimeout(() => {{ boton.textContent = 'Agregar a la bolsa'; }}, 1600);
}}));
</script>
</body></html>"""


def tarjeta(p: dict, nuevo: bool = False) -> str:
    return f"""<a class="tarjeta" href="/producto/{e(p['slug'])}">
  <img src="/img/{e(p['imageId'])}" alt="{e(p['nombre'])} en {e(p['color'].lower())}" width="600" height="600" loading="lazy">
  {'<span class="etiqueta">Nuevo</span>' if nuevo else ''}
  <h3>{e(p['nombre'])}</h3>
  <p>{e(p['categoria'])} · {e(p['color'])}</p>
  <strong>US${e(p['precio'])}</strong>
</a>"""


def inicio(productos: list, categoria: str | None) -> str:
    if not productos:
        return pagina("Configura la tienda", """<section class="vacio"><h1>La tienda aún no tiene productos</h1>
<p>Desde la carpeta <code>sdk-python</code>, define <code>SMARTSTORAGE_API_KEY</code> y ejecuta <code>python -m tienda.sembrar</code>.</p></section>""")
    lista = [p for p in productos if not categoria or p["categoria"] == categoria]
    destacado = productos[0]
    grid = "".join(tarjeta(p, nuevo=i < 2 and not categoria) for i, p in enumerate(lista)) or "<p>No hay productos en esta categoría.</p>"
    portada = "" if categoria else f"""<section class="portada">
  <img src="/img/{e(destacado['imageId'])}" alt="{e(destacado['nombre'])}" width="1200" height="1200">
  <div class="portada-texto">
    <h1>Corre<br>más ligero</h1>
    <p>{e(destacado['nombre'])}: amortiguación para todos tus kilómetros, desde US${e(destacado['precio'])}.</p>
    <div class="acciones"><a class="boton" href="/producto/{e(destacado['slug'])}">Comprar</a><a class="boton boton-claro" href="/?cat=Trail">Ver trail</a></div>
  </div>
</section>"""
    titulo = categoria or "Lo más nuevo"
    return pagina(titulo, f"""{portada}<section class="seccion"><h2>{e(titulo)}</h2><div class="rejilla">{grid}</div></section>""",
                  actual=categoria or "inicio")


def detalle(p: dict, productos: list) -> str:
    tallas = "".join(f'<label><input type="radio" name="talla" value="{t}"><span>{t}</span></label>' for t in TALLAS)
    hermanos = [x for x in productos if x["nombre"] == p["nombre"] and x["slug"] != p["slug"]]
    colores = "".join(f'<a href="/producto/{e(x["slug"])}"><img src="/img/{e(x["imageId"])}" alt="{e(x["color"])}" width="72" height="72"></a>'
                      for x in hermanos)
    formato = (p.get("formatoOriginal") or "original").upper()
    return pagina(f"{p['nombre']} {p['color']}", f"""<article class="producto">
  <img class="producto-foto" src="/img/{e(p['imageId'])}" alt="{e(p['nombre'])} en {e(p['color'].lower())}" width="1200" height="1200">
  <div class="producto-info">
    <p class="producto-categoria">{e(p['categoria'])}</p>
    <h1>{e(p['nombre'])}</h1>
    <p class="producto-color">{e(p['color'])}</p>
    <strong class="producto-precio">US${e(p['precio'])}</strong>
    {f'<div class="colores" aria-label="Otros colores">{colores}</div>' if colores else ''}
    <fieldset class="tallas"><legend>Elige tu talla (EU)</legend>{tallas}</fieldset>
    <p class="tallas-aviso" role="alert" hidden>Elige una talla para agregarla a la bolsa.</p>
    <button type="button" class="boton boton-ancho" data-agregar>Agregar a la bolsa</button>
    <p class="producto-texto">{e(p['descripcion'])}</p>
    <p class="almacenamiento">Esta foto se subió en {e(formato)} de {kb(p['bytesOriginal'])} y se sirve en WebP de {kb(p['bytesWebp'])}: {ahorro(p)} % menos, gracias a SmartStorage.</p>
  </div>
</article>""", actual=p["categoria"])


def admin(productos: list, mensaje: str = "", error: str = "") -> str:
    filas = "".join(f"<tr><td>{e(p['nombre'])} {e(p['color'])}</td><td>{e(p['categoria'])}</td><td>US${e(p['precio'])}</td>"
                    f"<td>{kb(p['bytesOriginal'])} → {kb(p['bytesWebp'])}</td></tr>" for p in productos)
    opciones = "".join(f"<option>{c}</option>" for c in CATEGORIAS)
    return pagina("Agregar producto", f"""<section class="admin">
  <h1>Agregar un producto</h1>
  <p>La foto se sube a SmartStorage con el SDK de Python y aparece en la tienda optimizada en WebP.</p>
  {f'<p class="nota-ok" role="status">{e(mensaje)}</p>' if mensaje else ''}{f'<p class="nota-error" role="alert">{e(error)}</p>' if error else ''}
  <form method="post" action="/admin" enctype="multipart/form-data" class="formulario">
    <label>Nombre<input name="nombre" required maxlength="60"></label>
    <label>Color<input name="color" required maxlength="40"></label>
    <label>Categoría<select name="categoria">{opciones}</select></label>
    <label>Precio en US$<input name="precio" required inputmode="decimal" pattern="\\d+(\\.\\d{{1,2}})?" placeholder="99.00"></label>
    <label class="ancho">Descripción<textarea name="descripcion" rows="3" maxlength="300"></textarea></label>
    <label class="ancho">Foto (JPG, PNG o WebP, hasta 25 MB)<input type="file" name="foto" accept="image/jpeg,image/png,image/webp" required></label>
    <button class="boton" type="submit">Publicar producto</button>
  </form>
  <h2>Productos publicados</h2>
  <table><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Foto original → WebP</th></tr></thead><tbody>{filas}</tbody></table>
</section>""")


def leer_formulario(tipo: str, cuerpo: bytes) -> dict:
    mensaje = email.message_from_bytes(f"Content-Type: {tipo}\r\n\r\n".encode() + cuerpo, policy=email.policy.HTTP)
    campos = {}
    for parte in mensaje.iter_parts():
        nombre = parte.get_param("name", header="content-disposition")
        if parte.get_filename():
            campos[nombre] = (parte.get_filename(), parte.get_payload(decode=True))
        else:
            # Los navegadores envían los campos en UTF-8 sin declarar charset; decodificarlos explícitamente.
            campos[nombre] = parte.get_payload(decode=True).decode('utf-8', errors='replace').strip()
    return campos


class Tienda(BaseHTTPRequestHandler):
    cliente: SmartStorageClient
    cache = CacheImagenes()

    def log_message(self, formato, *args):  # registro corto en la terminal
        sys.stderr.write(f"{self.command} {self.path} → {args[1] if len(args) > 1 else ''}\n")

    def responder(self, contenido, tipo="text/html; charset=utf-8", estado=HTTPStatus.OK, extra=None):
        datos = contenido.encode() if isinstance(contenido, str) else contenido
        self.send_response(estado)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(datos)

    def fallo(self, error: SmartStorageError):
        texto = "SmartStorage no respondió. Revisa que la API esté en marcha." if error.code == "NETWORK_ERROR" else str(error)
        self.responder(pagina("Error", f'<section class="vacio"><h1>No se pudo cargar la tienda</h1><p>{e(texto)}</p></section>'),
                       estado=HTTPStatus.BAD_GATEWAY)

    def do_GET(self):
        url = urlparse(self.path)
        productos = catalogo.cargar()
        try:
            if url.path == "/":
                categoria = parse_qs(url.query).get("cat", [None])[0]
                return self.responder(inicio(productos, categoria if categoria in CATEGORIAS else None))
            if url.path.startswith("/producto/"):
                p = next((x for x in productos if x["slug"] == url.path.rsplit("/", 1)[1]), None)
                if p:
                    return self.responder(detalle(p, productos))
            if url.path.startswith("/img/"):
                image_id = url.path.rsplit("/", 1)[1]
                if any(x["imageId"] == image_id for x in productos):
                    return self.responder(self.cache.obtener(self.cliente, image_id), "image/webp",
                                          extra={"Cache-Control": "public, max-age=3600"})
            if url.path == "/admin":
                return self.responder(admin(productos))
            if url.path == "/estatico/tienda.css":
                return self.responder((ESTATICOS / "tienda.css").read_bytes(), "text/css; charset=utf-8")
        except SmartStorageError as error:
            return self.fallo(error)
        self.responder(pagina("No encontrado", '<section class="vacio"><h1>No encontramos esa página</h1><p><a href="/">Volver a la tienda</a></p></section>'),
                       estado=HTTPStatus.NOT_FOUND)

    def do_POST(self):
        if urlparse(self.path).path != "/admin":
            return self.responder("", estado=HTTPStatus.NOT_FOUND)
        productos = catalogo.cargar()
        largo = int(self.headers.get("Content-Length", 0))
        if largo > MAX_SUBIDA + 100_000:
            return self.responder(admin(productos, error="La foto supera los 25 MB."), estado=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        campos = leer_formulario(self.headers.get("Content-Type", ""), self.rfile.read(largo))
        archivo, foto = campos.get("foto", (None, None))
        if not foto or not campos.get("nombre") or campos.get("categoria") not in CATEGORIAS:
            return self.responder(admin(productos, error="Completa el nombre, la categoría y la foto."), estado=HTTPStatus.BAD_REQUEST)
        try:
            datos = catalogo.publicar_foto(self.cliente, foto, archivo, catalogo.album_tienda(self.cliente))
        except SmartStorageError as error:
            return self.responder(admin(productos, error=f"SmartStorage rechazó la foto: {error}"), estado=HTTPStatus.BAD_GATEWAY)
        base = catalogo.slug(f"{campos['nombre']} {campos.get('color', '')}")
        usado = {p["slug"] for p in productos}
        nuevo_slug = base if base not in usado else f"{base}-{len(productos) + 1}"
        productos.insert(0, {"slug": nuevo_slug, "nombre": campos["nombre"], "color": campos.get("color", ""),
                             "categoria": campos["categoria"], "precio": campos.get("precio", "0.00"),
                             "descripcion": campos.get("descripcion", ""), **datos})
        catalogo.guardar(productos)
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", f"/producto/{nuevo_slug}")
        self.end_headers()


def main() -> int:
    try:
        Tienda.cliente = SmartStorageClient.from_env()
    except SmartStorageError as error:
        print(error, file=sys.stderr)
        return 1
    puerto = int(os.environ.get("TIENDA_PUERTO", "8080"))
    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), Tienda)
    print(f"Tienda Pulso en http://127.0.0.1:{puerto}  (Ctrl+C para detener)")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
