"""Billing tab refresh, run by its own scheduled task in the Composio workbench, in three cells (each under 180 s):

    BILL_STAGE = "orders";  exec(open("/mnt/files/tlc_courier/bill_run.py").read())
    BILL_STAGE = "lines";   exec(open("/mnt/files/tlc_courier/bill_run.py").read())
    BILL_STAGE = "publish"; exec(open("/mnt/files/tlc_courier/bill_run.py").read())

It needs dash_secret.json, which the main courier refresh writes into /mnt/files/tlc_courier/ shortly before.
The bill check itself (rate cards, slab rules) is kept encrypted in refresh/billing.enc.json because the repo is
public; it is decrypted with the dashboard password, run, and the result is encrypted into bill.enc.json.
"""
import base64, gc, json, os, time, zlib
import pandas as pd
import requests

B = "/mnt/files/tlc_courier/"
TMP = "/tmp/tlc_bill_"
GH = "github_radii-heir"
OWNER, REPO = "jibranzia1", "tlc-courier-dashboard"
BILL_SINCE = "2026-06-01"
STAGE = globals().get("BILL_STAGE", "orders")
T1 = time.time()

for f in ("crypto.py", "export.py", "weights.py"):
    exec(open(B + f).read())
if not os.path.exists(B + "dash_secret.json"):
    raise RuntimeError("dash_secret.json is missing: run the main courier refresh first")
pw = json.load(open(B + "dash_secret.json"))["password"]


def _gh_file(path):
    r, e = run_composio_tool("GITHUB_GET_REPOSITORY_CONTENT", {"owner": OWNER, "repo": REPO, "path": path}, account=GH)
    if e:
        return None, None
    dd = r.get("data") or {}
    c = dd.get("content") if isinstance(dd.get("content"), dict) else dd
    raw, sha = (c or {}).get("content", ""), (c or {}).get("sha")
    if raw:
        return base64.b64decode(raw.replace("\n", "")).decode(), sha
    if sha:
        t = requests.get("https://raw.githubusercontent.com/%s/%s/main/%s?ts=%d" % (OWNER, REPO, path, time.time()), timeout=60)
        if t.ok:
            return t.text, sha
    return None, sha


def _gh_put(path, text, message):
    _, sha = _gh_file(path)
    a = {"owner": OWNER, "repo": REPO, "path": path, "branch": "main", "message": message,
         "content": base64.b64encode(text.encode()).decode()}
    if sha:
        a["sha"] = sha
    r, e = run_composio_tool("GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", a, account=GH)
    if e:
        raise RuntimeError("GitHub commit failed for %s: %s" % (path, e))


if STAGE == "orders":
    r = export_orders(run_composio_tool, BILL_SINCE)
    url = (r.get("data") or {}).get("url")
    if not url:
        raise RuntimeError("Shopify export returned no file")
    to_df(url).to_pickle(TMP + "d.pkl")
    ctxt, _ = _gh_file("cx.enc.json")
    o = decrypt_payload(json.loads(ctxt), pw)
    cache = json.loads(zlib.decompress(base64.b64decode(o["z"])).decode()) if "z" in o else o
    pd.to_pickle(cache, TMP + "cx.pkl")
    print(json.dumps({"stage": "orders", "parcels_cached": len(cache), "seconds": round(time.time() - T1)}))

elif STAGE == "lines":
    _, LI = export_weights(run_composio_tool, BILL_SINCE)
    LI.to_pickle(TMP + "li.pkl")
    print(json.dumps({"stage": "lines", "lines": len(LI), "seconds": round(time.time() - T1)}))

elif STAGE == "publish":
    src, _ = _gh_file("refresh/billing.enc.json")
    exec(decrypt_payload(json.loads(src), pw)["code"])
    d, cache, LI = pd.read_pickle(TMP + "d.pkl"), pd.read_pickle(TMP + "cx.pkl"), pd.read_pickle(TMP + "li.pkl")
    RB, FX = build_frame(d, cache, LI)
    del d, cache, LI; gc.collect()
    old, _ = _gh_file("bill.enc.json")
    keep = decrypt_payload(json.loads(old), pw) if old else None
    now = pd.Timestamp.now(tz="Asia/Karachi")
    BP = bill_payload(RB, FX, now.strftime("%Y-%m-%d %H:%M"), keep_months=keep)
    benc = encrypt_payload(BP, pw)
    assert decrypt_payload(benc, pw)["as_of"] == BP["as_of"]
    _gh_put("bill.enc.json", json.dumps(benc), "Bill check " + BP["as_of"])
    hold = sum(m["hold"] for m in BP["months"])
    print(json.dumps({"stage": "publish", "bill_ok": True, "months": len(BP["months"]), "lines": len(BP["lines"]),
                      "hold_rs": hold, "seconds": round(time.time() - T1)}))
