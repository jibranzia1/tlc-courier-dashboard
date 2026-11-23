"""Encrypt / decrypt the dashboard payload (PBKDF2-SHA256 + AES-256-GCM).

The page (index.html) derives the same key in the browser with WebCrypto.
The password is never stored in this repository.
"""
import base64, json, os
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 310000


def _key(password, salt, iterations):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(password.encode())


def encrypt_payload(obj, password, iterations=ITERATIONS):
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(password, salt, iterations)).encrypt(iv, json.dumps(obj, separators=(",", ":")).encode(), None)
    e = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "alg": "PBKDF2-SHA256/AES-256-GCM", "iter": iterations, "salt": e(salt), "iv": e(iv), "ct": e(ct)}


def decrypt_payload(enc, password):
    d = lambda s: base64.b64decode(s)
    plain = AESGCM(_key(password, d(enc["salt"]), enc["iter"])).decrypt(d(enc["iv"]), d(enc["ct"]), None)
    return json.loads(plain)
