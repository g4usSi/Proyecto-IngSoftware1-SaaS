"""Pruebas del SDK de Python contra un servidor HTTP simulado (sin base de datos).

    cd sdk-python
    python -m unittest discover -s tests -v
"""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from smartstorage import SmartStorageClient, SmartStorageError  # noqa: E402

CLAVE = "ss_" + "a" * 32


class ApiSimulada(BaseHTTPRequestHandler):
    trabajos = {}
    intentos = []
    fallar_una_vez = False

    def log_message(self, *args):
        pass

    def responder(self, estado, datos=None, error=None, crudo=None):
        cuerpo = crudo if crudo is not None else json.dumps({"data": datos} if error is None else {"error": error}).encode()
        self.send_response(estado)
        self.send_header("Content-Type", "image/webp" if crudo is not None else "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        if self.headers.get("Authorization") != f"Bearer {CLAVE}":
            return self.responder(401, error={"code": "API_KEY_INVALID", "message": "La clave de API no es válida o fue revocada."})
        if self.path == "/api/quotas/me":
            return self.responder(200, {"plan": {"code": "standard", "name": "Estándar"}})
        if self.path.startswith("/api/jobs/"):
            trabajo = self.trabajos[self.path.rsplit("/", 1)[1]]
            trabajo["consultas"] += 1
            listo = trabajo["consultas"] >= 2
            return self.responder(200, {"id": trabajo["id"], "status": "published" if listo else "processing",
                                        "imageId": "img-1" if listo else None, "nextPollAfterMs": 10})
        if self.path == "/api/files" or self.path.startswith("/api/files?"):
            if "cursor=c2" in self.path:
                return self.responder(200, {"items": [{"id": "img-2"}], "nextCursor": None})
            return self.responder(200, {"items": [{"id": "img-1"}], "nextCursor": "c2"})
        if self.path == "/api/files/img-1/download":
            return self.responder(200, crudo=b"RIFFxxxxWEBP")
        self.responder(404, error={"code": "FILE_NOT_FOUND", "message": "No existe."})

    def do_POST(self):
        cuerpo = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/api/jobs":
            clave = self.headers["Idempotency-Key"]
            ApiSimulada.intentos.append(clave)
            if ApiSimulada.fallar_una_vez:
                ApiSimulada.fallar_una_vez = False
                return self.responder(503, error={"code": "SERVICE_UNAVAILABLE", "message": "Ocupado."})
            assert b'name="file"; filename="zapatilla.png"' in cuerpo and b"Content-Type: image/png" in cuerpo
            self.trabajos[clave] = {"id": clave, "consultas": 0}
            return self.responder(202, {"id": clave, "status": "queued"})
        self.responder(404, error={"code": "NOT_FOUND", "message": "No existe."})


class PruebasCliente(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.servidor = ThreadingHTTPServer(("127.0.0.1", 0), ApiSimulada)
        threading.Thread(target=cls.servidor.serve_forever, daemon=True).start()
        cls.cliente = SmartStorageClient(CLAVE, f"http://127.0.0.1:{cls.servidor.server_address[1]}/api")

    @classmethod
    def tearDownClass(cls):
        cls.servidor.shutdown()

    def test_rechaza_claves_que_no_son_de_api(self):
        with self.assertRaises(ValueError):
            SmartStorageClient("eyJhbGciOi.jwt.token")

    def test_consulta_la_cuota(self):
        self.assertEqual(self.cliente.quota()["plan"]["code"], "standard")

    def test_sube_espera_y_reintenta_con_la_misma_clave(self):
        ApiSimulada.intentos.clear()
        ApiSimulada.fallar_una_vez = True
        trabajo = self.cliente.upload_image(b"\x89PNG...", filename="zapatilla.png")
        self.assertEqual(trabajo["status"], "published")
        self.assertEqual(trabajo["imageId"], "img-1")
        self.assertEqual(len(ApiSimulada.intentos), 2)
        self.assertEqual(ApiSimulada.intentos[0], ApiSimulada.intentos[1], "el reintento usa la misma Idempotency-Key")

    def test_recorre_todas_las_paginas(self):
        self.assertEqual([i["id"] for i in self.cliente.images()], ["img-1", "img-2"])

    def test_descarga_el_webp(self):
        self.assertEqual(self.cliente.download_image("img-1"), b"RIFFxxxxWEBP")

    def test_errores_de_la_api_traen_codigo_y_estado(self):
        with self.assertRaises(SmartStorageError) as caso:
            self.cliente.download_image("ajena")
        self.assertEqual((caso.exception.status, caso.exception.code), (404, "FILE_NOT_FOUND"))
        otro = SmartStorageClient("ss_" + "b" * 32, self.cliente.base_url)
        with self.assertRaises(SmartStorageError) as caso:
            otro.quota()
        self.assertEqual(caso.exception.code, "API_KEY_INVALID")

    def test_sin_servidor_es_error_de_red(self):
        sin_red = SmartStorageClient(CLAVE, "http://127.0.0.1:9/api", timeout=2)
        with self.assertRaises(SmartStorageError) as caso:
            sin_red.quota()
        self.assertEqual(caso.exception.code, "NETWORK_ERROR")
        self.assertTrue(caso.exception.retryable)


if __name__ == "__main__":
    unittest.main()
