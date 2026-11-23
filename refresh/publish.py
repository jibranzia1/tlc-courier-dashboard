"""Daily refresh, run inside the Composio remote workbench (needs run_composio_tool).

1. Shopify bulk export (export.py) -> metrics (metrics.py) -> dashboard rows (dashjson.py)
2. Static review data (costs, returns, actions, plan) is carried over from the
   previous encrypted file, so it never sits unencrypted in the repository.
3. Encrypt with the dashboard password (kept only in the workbench) and commit
   data.enc.json to jibranzia1/tlc-courier-dashboard, which GitHub Pages serves.
"""
import base64, json, os, warnings
import pandas as pd

warnings.filterwarnings("ignore")
B = "/mnt/files/tlc_courier/"
GH = "github_radii-heir"
OWNER, REPO = "jibranzia1", "tlc-courier-dashboard"
STATIC_KEYS = ["scorecard", "actions", "returns_month", "return_reasons", "plan"]

for f in ("export.py", "metrics.py", "dashjson.py", "crypto.py"):
    exec(open(B + f).read())

secret = json.load(open(B + "dash_secret.json"))["password"]


def _gh_file(path):
    r, e = run_composio_tool("GITHUB_GET_REPOSITORY_CONTENT", {"owner": OWNER, "repo": REPO, "path": path}, account=GH)
    if e:
        return None, None
    d = r.get("data") or {}
    c = d.get("content") if isinstance(d.get("content"), dict) else d
    raw = (c or {}).get("content", "")
    sha = (c or {}).get("sha")
    return (base64.b64decode(raw.replace("\n", "")).decode() if raw else None), sha


# 1. live data
since = (pd.Timestamp.now(tz="Asia/Karachi").normalize().replace(day=1) - pd.DateOffset(months=4)).strftime("%Y-%m-%d")
r = export_orders(run_composio_tool, since)
url = (r.get("data") or {}).get("url")
if not url:
    raise RuntimeError("Shopify bulk export returned no file: " + json.dumps(r)[:300])
d = to_df(url)
M = compute(d)
tot7 = sum(x["n7"] for x in M["recent"])
assert len(d) > 5000 and tot7 > 50 and M["slots"][0]["avg"] > 0, "sanity check failed: rows=%d parcels7=%d" % (len(d), tot7)
live = dash_json(M)

# 2. static data: local copy, else from the previous encrypted file
if os.path.exists(B + "review_static.json"):
    static = json.load(open(B + "review_static.json"))
else:
    txt, _ = _gh_file("data.enc.json")
    prev = decrypt_payload(json.loads(txt), secret)
    static = {k: prev[k] for k in STATIC_KEYS}
    json.dump(static, open(B + "review_static.json", "w"))

# 3. encrypt and commit
payload = {**live, **{k: static[k] for k in STATIC_KEYS}}
enc = encrypt_payload(payload, secret)
assert decrypt_payload(enc, secret)["meta"][0]["refreshed"] == live["meta"][0]["refreshed"]
_, sha = _gh_file("data.enc.json")
args = {"owner": OWNER, "repo": REPO, "path": "data.enc.json", "branch": "main",
        "message": "Data refresh " + live["meta"][0]["refreshed"],
        "content": base64.b64encode(json.dumps(enc).encode()).decode()}
if sha:
    args["sha"] = sha
r, e = run_composio_tool("GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", args, account=GH)
if e:
    raise RuntimeError("GitHub commit failed: " + str(e))
print(json.dumps({"ok": True, "refreshed": live["meta"][0]["refreshed"], "site": "https://%s.github.io/%s/" % (OWNER, REPO),
                  "slots": [(s["key"], s["avg60"], s["p90"]) for s in live["slots"]],
                  "share_7d": [(c["courier"], c["share_7d"]) for c in live["couriers"]]}))
