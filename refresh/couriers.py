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
    if d.get("status") == 1: st = "awaiting_pickup"
    tl = [e for e in (j.get("timeline") or []) if str(e.get("status", "")).strip().lower() not in ("invoice generated", "weight updated")]
    when = lambda name: [_qw_time(e.get("created_at", "")) for e in tl if str(e.get("status", "")).strip().lower() == name]
    dl = when("delivered"); pk = when("picked up"); rt = when("returned to merchant")
    att = d.get("attempt_count")
    n_att = len(when("attempted"))
    att = max(int(att or 0), n_att + (1 if st == "delivered" else 0))
    comments = [str(c.get("comment") or "").strip() for c in (j.get("comments_data") or []) if c.get("comment")]
    reason = d.get("undelivered_reason") or d.get("cancellation_reason") or (comments[-1] if comments and st != "delivered" else None)
    num = lambda v: None if v is None else float(v)
    bill = dict(w=num(d.get("weight_input")), amt=num(d.get("order_amount")), tot=num(d.get("total_amount")),
                wadm=bool(d.get("weight_updated_by_admin")), wcr=bool(d.get("weight_updated_by_cr")), dt=d.get("delivery_type"),
                nsa=num(d.get("nsa_charges")), peak=bool(d.get("peak_pricing")), disc=num(d.get("discount_amount")),
                add=num(d.get("additional_amount_charge")), plan=d.get("plan"), booked=d.get("created_at"))
    return dict(status=st, bill=bill, attempts=att if (att or st in FINAL) else None, reason=reason, delivered_at=_iso(dl[-1] if dl else None),
                picked_at=_iso(pk[0] if pk else None), returned_at=_iso(rt[-1] if rt else None),
                last=str(tl[-1].get("status")) if tl else d.get("status_text"), raw_status=d.get("status_text"))


def qwqer(key, trackings, budget=100):
    return _pool(lambda t: qwqer_one(key, t), trackings, 12, budget)


# ---------------- PostEx ----------------
PX_BASE = "https://api.postex.pk/services/integration/api/order/"


def _ts(s):
    """ISO time with a +0500 style offset -> aware datetime."""
    if not s: return None
    t = re.sub(r"([+-]\d\d)(\d\d)$", r"\1:\2", str(s).strip())
    try:
        x = dt.datetime.fromisoformat(t)
        return x if x.tzinfo else x.replace(tzinfo=PKT)
    except Exception:
        return None


PX_CODES = {"RFD": "Refused at the door", "CNA": "Customer not reachable", "OPN": "Wanted to open the parcel", "ICA": "Address problem",
            "HCR": "Asked to deliver later", "PNA": "Payment not ready"}


def _px_record(d):
    hist = d.get("transactionStatusHistory") or []
    code = lambda h: str(h.get("transactionStatusMessageCode") or "")
    msg = lambda h: str(h.get("transactionStatusMessage") or "").strip()
    ts = str(d.get("transactionStatus") or "").strip()
    tl = ts.lower()
    codes = [code(h) for h in hist]
    if tl == "delivered" or "0005" in codes and not any(c in ("0039", "0040", "0006") for c in codes): st = "delivered"
    elif tl == "returned" or "0006" in codes: st = "returned"
    elif "unbooked" in tl: st = "awaiting_pickup"
    elif "un-assigned" in tl or "cancel" in tl or (codes and codes[-1] == "0002"): st = "cancelled"
    elif "return" in tl or any(c in ("0039", "0040", "0037", "0032") for c in codes): st = "returning"
    else: st = "in_transit"
    attempts = [msg(h) for h in hist if code(h) == "0013" and msg(h).lower().startswith("attempt")]
    att = len(attempts) + (1 if st == "delivered" else 0)
    reason = None
    if attempts:
        m = re.search(r"attempt made:\s*([A-Z]{3})", attempts[-1], re.I)
        reason = PX_CODES.get(m.group(1).upper(), attempts[-1]) if m else attempts[-1]
    delivered = _ts(d.get("orderDeliveryDate")) if st == "delivered" else None
    if st == "delivered" and not delivered:
        for h in hist:
            if code(h) == "0005": delivered = _ts(h.get("updatedAt"))
    picked = _ts(d.get("orderPickupDate"))
    if not picked:
        for h in hist:
            if code(h) == "0031": picked = _ts(h.get("updatedAt")); break
    returned = None
    for h in hist:
        if code(h) == "0006": returned = _ts(h.get("updatedAt"))
    last = msg(hist[-1]) if hist else ts
    num = lambda v: None if v in (None, "") else float(v)
    bill = dict(w=num(d.get("actualWeight")), amt=num(d.get("transactionFee")), tax=num(d.get("transactionTax")),
                rev=num(d.get("reversalFee")), revtax=num(d.get("reversalTax")), city=d.get("cityName"),
                booked=d.get("transactionDate"), pickup=d.get("orderPickupDate"))
    return dict(status=st, bill=bill, returned_at=_iso(returned), attempts=att if (att or st in FINAL) else None, reason=reason, delivered_at=_iso(delivered),
                picked_at=_iso(picked), last=last, raw_status=ts)


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
    r = requests.post(LP_BASE + "trackBookedPacket/format/json/", data={"api_key": key, "api_password": pw, "track_numbers": ",".join(batch)}, timeout=60)
    r.raise_for_status()
    j = r.json() or {}
    if str(j.get("status")) != "1":
        raise RuntimeError("Leopards: " + str(j.get("error"))[:120])
    out = {}
    for p in j.get("packet_list") or []:
        cn = str(p.get("track_number") or "")
        bs = str(p.get("booked_packet_status") or "").strip(); bl = bs.lower()
        det = p.get("Tracking Detail") or []
        evs = [(str(e.get("Status") or "").strip(), (e.get("Reason") or None), _lp_time(e.get("Activity_datetime"))) for e in det]
        if bl == "delivered": st = "delivered"
        elif "returned to shipper" in bl or any(x.lower().startswith("return to sender") for x, _, _ in evs) and "deliver" not in bl: st = "returned"
        elif "return" in bl: st = "returning"
        elif "cancel" in bl: st = "cancelled"
        elif "pickup request not send" in bl or "booked" == bl: st = "awaiting_pickup"
        else: st = classify(bs)
        if st in ("in_transit", "awaiting_pickup") and evs and re.match(r"(ready for return|being return|return)", evs[-1][0].lower()):
            st = "returning"
        pend = [rs for x, rs, _ in evs if x.lower().startswith("pending") and rs]
        rfr = [rs or x.split("-", 1)[-1].strip() for x, rs, _ in evs if x.lower().startswith("ready for return")]
        att = len(pend) + (1 if st == "delivered" else 0) + (1 if rfr and not pend else 0)
        reason = (rfr[-1] if rfr else pend[-1] if pend else None) if st != "delivered" else None
        dl = [t for x, _, t in evs if x.lower() == "delivered"]
        pk = [t for x, _, t in evs if x.lower().startswith("shipment picked")]
        rt = [t for x, _, t in evs if x.lower().startswith("return to sender")]
        last = evs[-1][0] + (" - " + evs[-1][1] if evs[-1][1] and evs[-1][0].lower().startswith("pending") else "") if evs else bs
        fl = lambda v: None if v in (None, "") else float(v)
        bill = dict(wb=fl(p.get("booked_packet_weight")), wa=fl(p.get("arival_dispatch_weight")),
                    vw=[p.get("booked_packet_vol_weight_l"), p.get("booked_packet_vol_weight_w"), p.get("booked_packet_vol_weight_h")],
                    pcs=p.get("booked_packet_no_piece"), orig=p.get("origin_city_name"), dest=p.get("destination_city_name"),
                    booked=p.get("booking_date"))
        out[cn] = dict(status=st, bill=bill, attempts=att if (att or st in FINAL) else None, reason=reason, delivered_at=_iso(dl[-1] if dl else None),
                       picked_at=_iso(pk[0] if pk else None), returned_at=_iso(rt[-1] if rt else None),
                       last=re.sub(r"\s+", " ", last), raw_status=bs)
    return out


def leopards(key, pw, trackings, budget=100):
    """Leopards answers slowly (about 1 s per parcel per call), so ask in small batches, several at once."""
    batches = [tuple(trackings[i:i + 10]) for i in range(0, len(trackings), 10)]
    got = _pool(lambda b: leopards_batch(key, pw, list(b)), batches, 8, budget)
    res = {}
    for v in got.values(): res.update(v)
    return res


# ---------------- all couriers ----------------
def refresh_cx(parcels, keys, cache, budget=110):
    """parcels: DataFrame with cour, tracking, f_created. keys: dict of credentials. cache: {tracking: record}.
    Returns (cache, live) where live says which couriers answered this run."""
    import pandas as pd
    now = pd.Timestamp.now(tz="Asia/Karachi")
    p = parcels[parcels.tracking.notna()]
    todo = {}
    for c, g in p.groupby("cour"):
        ts = [t for t in g.sort_values("f_created", ascending=False).tracking.astype(str).unique()
              if not (t in cache and cache[t]["status"] in FINAL and "bill" in cache[t]
                      and not (cache[t]["status"] == "returned" and "returned_at" not in cache[t]))]
        # never-checked first (newest first), then the ones checked longest ago
        ts.sort(key=lambda t: (t in cache, cache.get(t, {}).get("checked", "")))
        todo[c] = ts
    live, t0 = {}, time.time()
    jobs = []
    if keys.get("qwqer_key") and todo.get("QWQER"): jobs.append(("QWQER", lambda b: qwqer(keys["qwqer_key"], todo["QWQER"], b)))
    if keys.get("postex_token") and todo.get("PostEx"): jobs.append(("PostEx", lambda b: postex(keys["postex_token"], todo["PostEx"], b)))
    if keys.get("leopards_key") and keys.get("leopards_password") and todo.get("Leopards"):
        jobs.append(("Leopards", lambda b: leopards(keys["leopards_key"], keys["leopards_password"], todo["Leopards"], b)))
    # the couriers are asked in parallel, each with the whole time budget
    def run(job):
        c, fn = job
        try: return c, fn(budget)
        except Exception: return c, {}
    with ThreadPoolExecutor(max(1, len(jobs))) as ex:
        results = list(ex.map(run, jobs))
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    for c, got in results:
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
    ("Fake or duplicate order", ("fake", "duplicate", "not ordered", "did not order", "didn't order")),
    ("Product issue", ("quality", "different", "damaged", "wrong item", "size")),
    ("Courier delay or capacity", ("delayed delivery", "delay", "excess load", "time constraint", "late delivery")),
    ("Refused at the door", ("refus", "not accept", "denied", "reject", "cancelled by customer", "customer cancel", "cancel by customer", "don't want", "dont want", "not required", "no longer")),
    ("Wanted to open the parcel", ("open", "check the parcel", "inspection")),
    ("Address problem", ("address", "location", "incomplete", "wrong", "out of service", "non service", "area", "not found", "house", "flat", "block", "sector", "locate", "out of city parcel")),
    ("Asked to deliver later", ("later", "reschedul", "next day", "postpone", "out of city", "out of town", "hold on")),
    ("Customer not reachable", ("not respond", "unreachable", "not reachable", "no answer", "not answer", "phone off", "switched off", "powered off", "not picking", "contact", "not available", "unavailable", "not at home", "not came", "closed", "call")),
    ("Payment not ready", ("cash", "amount", "payment", "money")),
]


def reason_group(text):
    t = (text or "").strip().lower()
    if not t: return None
    for label, _ in REASONS:
        if t == label.lower(): return label
    for label, words in REASONS:
        if any(w in t for w in words): return label
    return "Other"


def cx_frame(cache):
    import pandas as pd
    if not cache: return pd.DataFrame(columns=["tracking", "status", "attempts", "reason", "delivered_at", "picked_at", "returned_at", "last"])
    return pd.DataFrame([dict(tracking=t, status=r["status"], attempts=r.get("attempts"), reason=reason_group(r.get("reason")), delivered_at=r.get("delivered_at"),
                              picked_at=r.get("picked_at"), returned_at=r.get("returned_at"), last=r.get("last") or r.get("raw_status"))
                         for t, r in cache.items()])
