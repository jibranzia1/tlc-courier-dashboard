"""Billing tab refresh: run in the workbench right after publish.py, in the same session (it reuses d and cache).

The bill check itself (rate cards, slab rules) lives encrypted in refresh/billing.enc.json, because the repo is public.
It is decrypted with the dashboard password, run, and its result is encrypted into bill.enc.json for the app.
Months before FREEZE are carried from the previous bill.enc.json (their parcels are final and older orders
are outside the twice-daily Shopify export).
"""
import gc, json, time
import pandas as pd

B = "/mnt/files/tlc_courier/"
FREEZE = "2026-08"
T1 = time.time()
for f in ("crypto.py", "weights.py"):
    exec(open(B + f).read())
SECRET = json.load(open(B + "dash_secret.json"))
pw = SECRET["password"]

for _v in ("payload", "enc", "live_old", "M", "v2", "static", "prev"):
    globals().pop(_v, None)
gc.collect()

src, _ = _gh_file("refresh/billing.enc.json")
exec(decrypt_payload(json.loads(src), pw)["code"])

_, LI = export_weights(run_composio_tool, since)
RB, FX = build_frame(d, cache, LI)
del LI; gc.collect()
RB = RB[RB.m >= FREEZE]
old, _ = _gh_file("bill.enc.json")
keep = decrypt_payload(json.loads(old), pw) if old else None
BP = bill_payload(RB, FX, now.strftime("%Y-%m-%d %H:%M"), keep_months=keep)
benc = encrypt_payload(BP, pw)
assert decrypt_payload(benc, pw)["as_of"] == BP["as_of"]
_gh_put("bill.enc.json", json.dumps(benc), "Bill check refresh " + BP["as_of"])
hold = sum(r["hold"] for r in BP["months"])
print(json.dumps({"bill_ok": True, "months": len(BP["months"]), "lines": len(BP["lines"]), "hold": hold, "seconds": round(time.time() - T1)}))
