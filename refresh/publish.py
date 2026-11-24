"""Twice-daily refresh, run inside the Composio remote workbench (needs run_composio_tool).

1. Shopify bulk export (export.py) -> day-level rows (daily.py) + the older summary rows (metrics.py, dashjson.py)
2. Courier tracking (couriers.py), read-only, for every courier whose key is in dash_secret.json.
   Parcels with a final status are cached in cx.enc.json so each run only asks about parcels still moving.
3. Static review data (costs, invoice returns, actions, plan) is carried over from the previous encrypted file.
4. Everything is encrypted with the dashboard password and committed to jibranzia1/tlc-courier-dashboard.
Secrets live only in dash_secret.json inside the workbench (written by the scheduled task); nothing plain is committed.
"""
import base64, json, os, time, warnings
import pandas as pd

warnings.filterwarnings("ignore")
B = "/mnt/files/tlc_courier/"
GH = "github_radii-heir"
OWNER, REPO = "jibranzia1", "tlc-courier-dashboard"
STATIC_KEYS = ["scorecard", "actions", "returns_month", "return_reasons", "plan"]
T0 = time.time()

for f in ("export.py", "metrics.py", "dashjson.py", "crypto.py", "daily.py", "couriers.py"):
    exec(open(B + f).read())

SECRET = json.load(open(B + "dash_secret.json"))
secret = SECRET["password"]


def _gh_file(path):
    r, e = run_composio_tool("GITHUB_GET_REPOSITORY_CONTENT", {"owner": OWNER, "repo": REPO, "path": path}, account=GH)
    if e:
        return None, None
    d = r.get("data") or {}
    c = d.get("content") if isinstance(d.get("content"), dict) else d
    raw = (c or {}).get("content", "")
    sha = (c or {}).get("sha")
    if raw:
        return base64.b64decode(raw.replace("\n", "")).decode(), sha
    # large files come back without inline content; fetch the raw file instead
    if sha:
        import requests
        t = requests.get("https://raw.githubusercontent.com/%s/%s/main/%s?ts=%d" % (OWNER, REPO, path, time.time()), timeout=60)
        if t.ok:
            return t.text, sha
    return None, sha


def _gh_put(path, text, message):
    _, sha = _gh_file(path)
    args = {"owner": OWNER, "repo": REPO, "path": path, "branch": "main", "message": message,
            "content": base64.b64encode(text.encode()).decode()}
    if sha:
        args["sha"] = sha
    r, e = run_composio_tool("GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", args, account=GH)
    if e:
        raise RuntimeError("GitHub commit failed for %s: %s" % (path, e))


# 1. Shopify
now = pd.Timestamp.now(tz="Asia/Karachi")
since = "2026-07-01"
r = export_orders(run_composio_tool, since)
url = (r.get("data") or {}).get("url")
if not url:
    raise RuntimeError("Shopify bulk export returned no file: " + json.dumps(r)[:300])
d = to_df(url)
M = compute(d, now)
tot7 = sum(x["n7"] for x in M["recent"])
assert len(d) > 5000 and tot7 > 50 and M["slots"][0]["avg"] > 0, "sanity check failed: rows=%d parcels7=%d" % (len(d), tot7)
live_old = dash_json(M)

# 2. previous payload (static data) and the courier cache
txt, _ = _gh_file("data.enc.json")
prev = decrypt_payload(json.loads(txt), secret) if txt else {}
if os.path.exists(B + "review_static.json"):
    static = json.load(open(B + "review_static.json"))
else:
    static = {k: prev[k] for k in STATIC_KEYS}
    json.dump(static, open(B + "review_static.json", "w"))
import zlib
def pack_cache(c):
    return {"z": base64.b64encode(zlib.compress(json.dumps(c, separators=(",", ":")).encode(), 9)).decode()}
def unpack_cache(o):
    return json.loads(zlib.decompress(base64.b64decode(o["z"])).decode()) if "z" in o else o
ctxt, _ = _gh_file("cx.enc.json")
cache = unpack_cache(decrypt_payload(json.loads(ctxt), secret)) if ctxt else {}

keys = {k: v for k, v in SECRET.items() if k != "password" and v}
live = {}
if keys:
    pf = parcel_frame(d, now)
    budget = max(20, 150 - (time.time() - T0) - 25)
    cache, live = refresh_cx(pf, keys, cache, budget=budget)

# a courier counts as connected when its tracking is in the cache, even if this run could not reach it
for c in ("QWQER", "PostEx", "Leopards"):
    live[c] = bool(live.get(c)) or any(r.get("courier") == c for r in cache.values())

# 3. build, encrypt, commit
v2 = build_v2(d, now, cx_frame(cache), live)
payload = {**live_old, **v2, **{k: static[k] for k in STATIC_KEYS}}
enc = encrypt_payload(payload, secret)
assert decrypt_payload(enc, secret)["app"][0]["as_of"] == v2["app"][0]["as_of"]
stamp = live_old["meta"][0]["refreshed"]
if keys:
    _gh_put("cx.enc.json", json.dumps(encrypt_payload(pack_cache(cache), secret)), "Courier tracking cache " + stamp)
_gh_put("data.enc.json", json.dumps(enc), "Data refresh " + stamp)

open_n = len(v2["open"])
K = {k: i for i, k in enumerate(v2["open_keys"])}
late = sum(1 for o in v2["open"] if o[K["st"]] != "returning" and o[K["over"]] > 0 and o[K["age"]] <= 14)
print(json.dumps({"ok": True, "refreshed": stamp, "site": "https://%s.github.io/%s/" % (OWNER, REPO),
                  "days": len(v2["daily"]), "open_parcels": open_n, "late_14d": late,
                  "couriers_live": live, "cx_cached": len(cache), "seconds": round(time.time() - T0)}))
