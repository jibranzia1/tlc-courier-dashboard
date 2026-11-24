"""Read-only courier tracking for QWQER, PostEx and Leopards.

Only lookup endpoints are called. Nothing here books, cancels or changes a parcel.
Each courier returns one record per tracking number:
    status     delivered | returned | returning | in_transit | cancelled | lost
    attempts   delivery attempts (int or None)
    reason     why it was not delivered / came back (str or None)
    delivered_at  ISO timestamp when delivered (or None)
Records with a final status are cached (cx cache) so each run only asks about parcels still moving.
"""
import json, re, time
import datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

FINAL = {"delivered", "returned", "cancelled", "lost"}
PKT = dt.timezone(dt.timedelta(hours=5))


def classify(text):
    t = (text or "").strip().lower()
    if not t: return "in_transit"
    if "lost" in t or "disput" in t: return "lost"
    if "return" in t:
        if re.search(r"returned( to (merchant|shipper|origin|vendor))?$|return(ed)? delivered|delivered to (shipper|merchant)|returned to", t): return "returned"
        return "returning"
    if "cancel" in t: return "cancelled"
    if "deliver" in t and not any(w in t for w in ("out for", "undeliver", "on route", "attempt", "under review", "re-attempt", "reattempt")):
        return "delivered"
    return "in_transit"


def _iso(x):
    return None if x is None else x.astimezone(dt.timezone.utc).isoformat()


def _pool(fn, items, workers, budget):
    out, t0 = {}, time.time()
    with ThreadPoolExecutor(workers) as ex:
        futs = {}
        it = iter(items)
        for _ in range(workers * 2):
            k = next(it, None)
            if k is None: break
            futs[ex.submit(fn, k)] = k
        while futs:
            for f in as_completed(list(futs)):
                k = futs.pop(f)
                try:
                    r = f.result()
                    if r: out[k] = r
                except Exception:
                    pass
                if time.time() - t0 < budget:
                    n = next(it, None)
                    if n is not None: futs[ex.submit(fn, n)] = n
                break
    return out


# ---------------- QWQER ----------------
QW_BASE = "https://qapi.qwqer.pk/"
QW_STATUS = {1: "in_transit", 2: "in_transit", 3: "in_transit", 4: "in_transit", 5: "delivered", 6: "in_transit", 7: "in_transit",
             8: "cancelled", 9: "returning", 10: "returning", 11: "returned", 12: "in_transit", 13: "lost"}


def _qw_time(s):
    try: return dt.datetime.strptime(s.strip(), "%I:%M %p | %d-%b-%Y").replace(tzinfo=PKT)
    except Exception: return None


def qwqer_one(key, tracking):
    r = requests.get(QW_BASE + "api/orders/merchant/detail/%s/" % tracking, headers={"QWQER-API-KEY": key}, timeout=20)
    if r.status_code == 404: return None
    r.raise_for_status()
    j = r.json()
    d = j.get("data") or {}
    st = QW_STATUS.get(d.get("status"), classify(d.get("status_text")))
    tl = j.get("timeline") or []
    delivered = None
    for e in tl:
        if str(e.get("status", "")).strip().lower() == "delivered":
            delivered = _qw_time(e.get("created_at", "")) or delivered
    reason = d.get("undelivered_reason") or d.get("cancellation_reason") or d.get("refund_reason")
    att = d.get("attempt_count")
    if att is not None and st == "delivered": att = max(1, int(att))
    return dict(status=st, attempts=None if att is None else int(att), reason=reason, delivered_at=_iso(delivered),
                raw_status=d.get("status_text"))


def qwqer(key, trackings, budget=100):
    return _pool(lambda t: qwqer_one(key, t), trackings, 12, budget)


# ---------------- PostEx ----------------
PX_BASE = "https://api.postex.pk/services/integration/api/order/"


def _px_time(s):
    if not s: return None
    for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%d-%m-%Y %H:%M:%S"):
        try: return dt.datetime.strptime(str(s)[:26], f).replace(tzinfo=PKT)
        except Exception: pass
    return None


def _px_record(d):
    hist = d.get("transactionStatusHistory") or []
    msgs = [str(h.get("transactionStatusMessage") or "") for h in hist]
    st = classify(d.get("transactionStatus") or (msgs[-1] if msgs else ""))
    delivered = None
    if st == "delivered":
        for h in hist:
            if classify(h.get("transactionStatusMessage")) == "delivered":
                delivered = _px_time(h.get("updatedAt") or h.get("modifiedDatetime"))
        delivered = delivered or _px_time(d.get("transactionDate") or d.get("updatedAt"))
    att = sum(1 for m in msgs if "attempt" in m.lower()) or None
    if st == "delivered": att = (att or 0) + 1
    reason = d.get("reversalReason") or d.get("returnReason") or d.get("transactionNotes")
    if not reason:
        bad = [m for m in msgs if "attempt" in m.lower() or "refus" in m.lower() or "return" in m.lower()]
        reason = bad[-1] if bad else None
    return dict(status=st, attempts=att, reason=reason, delivered_at=_iso(delivered), raw_status=d.get("transactionStatus"))


def postex_one(token, tracking):
    r = requests.get(PX_BASE + "v1/track-order/%s" % tracking, headers={"token": token}, timeout=20)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    d = (r.json() or {}).get("dist") or {}
    return _px_record(d) if d else None


def postex(token, trackings, budget=100):
    return _pool(lambda t: postex_one(token, t), trackings, 10, budget)


# ---------------- Leopards ----------------
LP_BASE = "https://merchantapi.leopardscourier.com/api/"


def _lp_time(s):
    for f in ("%Y-%m-%d %H:%M:%S", "%d %b %Y %H:%M", "%Y-%m-%d"):
        try: return dt.datetime.strptime(str(s).strip(), f).replace(tzinfo=PKT)
        except Exception: pass
    return None


def leopards_batch(key, pw, batch):
    r = requests.post(LP_BASE + "trackBookedPacket/format/json/", data={"api_key": key, "api_password": pw, "track_numbers": ",".join(batch)}, timeout=40)
    r.raise_for_status()
    j = r.json() or {}
    out = {}
    for p in j.get("packet_list") or []:
        cn = str(p.get("track_number") or p.get("booked_packet_cn") or "")
        st = classify(p.get("booked_packet_status"))
        det = p.get("Tracking Detail") or p.get("tracking_detail") or []
        delivered = None
        if st == "delivered":
            for e in det:
                if classify(e.get("Status")) == "delivered":
                    delivered = _lp_time(e.get("Activity_datetime") or e.get("Activity_Date"))
        att = sum(1 for e in det if "attempt" in str(e.get("Status", "")).lower() or e.get("Reason")) or None
        if st == "delivered": att = (att or 0) + 1
        reasons = [e.get("Reason") for e in det if e.get("Reason")]
        out[cn] = dict(status=st, attempts=att, reason=reasons[-1] if reasons else None, delivered_at=_iso(delivered),
                       raw_status=p.get("booked_packet_status"))
    return out


def leopards(key, pw, trackings, budget=100):
    batches = [trackings[i:i + 50] for i in range(0, len(trackings), 50)]
    res, t0 = {}, time.time()
    for b in batches:
        if time.time() - t0 > budget: break
        try: res.update(leopards_batch(key, pw, b))
        except Exception: pass
    return res


# ---------------- all couriers ----------------
def refresh_cx(parcels, keys, cache, budget=110):
    """parcels: DataFrame with cour, tracking, f_created. keys: dict of credentials. cache: {tracking: record}.
    Returns (cache, live) where live says which couriers answered this run."""
    import pandas as pd
    now = pd.Timestamp.now(tz="Asia/Karachi")
    p = parcels[parcels.tracking.notna() & (parcels.f_created >= now - pd.Timedelta(days=120))]
    todo = {}
    for c, g in p.groupby("cour"):
        ts = [t for t in g.sort_values("f_created", ascending=False).tracking.astype(str).unique()
              if not (t in cache and cache[t]["status"] in FINAL)]
        todo[c] = ts
    live, t0 = {}, time.time()
    jobs = []
    if keys.get("qwqer_key") and todo.get("QWQER"): jobs.append(("QWQER", lambda b: qwqer(keys["qwqer_key"], todo["QWQER"], b)))
    if keys.get("postex_token") and todo.get("PostEx"): jobs.append(("PostEx", lambda b: postex(keys["postex_token"], todo["PostEx"], b)))
    if keys.get("leopards_key") and keys.get("leopards_password") and todo.get("Leopards"):
        jobs.append(("Leopards", lambda b: leopards(keys["leopards_key"], keys["leopards_password"], todo["Leopards"], b)))
    for i, (c, fn) in enumerate(jobs):
        left = budget - (time.time() - t0)
        if left < 10: break
        got = fn(left / (len(jobs) - i))
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        for t, r in got.items():
            r["courier"] = c; r["checked"] = now_iso
            cache[t] = r
        live[c] = len(got) > 0
    # a courier whose key exists and that answered before still counts as connected
    for c, k in (("QWQER", "qwqer_key"), ("PostEx", "postex_token"), ("Leopards", "leopards_key")):
        if keys.get(k) and not live.get(c):
            live[c] = any(r.get("courier") == c for r in cache.values())
    return cache, live


REASONS = [
    ("Refused at the door", ("refus", "not accept", "denied", "reject", "cancelled by customer", "customer cancel", "don't want", "dont want", "not required", "no longer")),
    ("Wanted to open the parcel", ("open", "check the parcel", "inspection")),
    ("Customer not reachable", ("not respond", "unreachable", "not reachable", "no answer", "not answer", "phone off", "switched off", "powered off", "not picking", "contact", "not available", "unavailable", "not at home", "hold", "call")),
    ("Address problem", ("address", "location", "incomplete", "wrong", "out of service", "non service", "area", "not found")),
    ("Asked to deliver later", ("later", "reschedul", "next day", "postpone", "out of city", "out of town")),
    ("Payment not ready", ("cash", "amount", "payment", "money")),
]


def reason_group(text):
    t = (text or "").strip().lower()
    if not t: return None
    for label, words in REASONS:
        if any(w in t for w in words): return label
    return "Other"


def cx_frame(cache):
    import pandas as pd
    if not cache: return pd.DataFrame(columns=["tracking", "status", "attempts", "reason", "delivered_at"])
    return pd.DataFrame([dict(tracking=t, status=r["status"], attempts=r.get("attempts"), reason=reason_group(r.get("reason")), delivered_at=r.get("delivered_at"))
                         for t, r in cache.items()])
