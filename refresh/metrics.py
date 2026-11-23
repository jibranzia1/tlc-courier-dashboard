
import numpy as np, pandas as pd
COURIERS = ["QWQER", "Leopards", "PostEx"]
def norm(c):
    if not isinstance(c, str): return None
    u = c.upper()
    if "QWQER" in u: return "QWQER"
    if "LEOPARD" in u: return "Leopards"
    if "POSTEX" in u: return "PostEx"
    return "Other"
def compute(d, now=None):
    tz = "Asia/Karachi"
    now = now or pd.Timestamp.now(tz=tz)
    end = now.normalize()                       # data up to end of yesterday
    yday = end - pd.Timedelta(days=1)
    d = d[d.created < end].copy()
    d["cour"] = d.company.map(norm)
    M = {"refreshed": now.strftime("%d %b %Y, %I:%M %p PKT"), "data_to": yday.strftime("%d %b %Y")}
    # ---- order slots, last 60 days, cancelled excluded
    o = d.drop_duplicates("name")
    o = o[o.cancelled.isna()].copy()
    o["lhr"] = o.city.fillna("").str.lower().str.contains("lahore")
    t = o.created.values
    lhr = o.lhr.values
    MORN, EVE = 7*60+40, 15*60+25          # reference cut-offs (minutes after midnight) used to split orders into pickups
    def series(ndays):
        s9, sl, so, st = [], [], [], []
        ts = o.created
        for k in range(ndays, 0, -1):
            dd = end - pd.Timedelta(days=k)
            m = dd + pd.Timedelta(minutes=MORN); e_ = dd + pd.Timedelta(minutes=EVE); pe = e_ - pd.Timedelta(days=1)
            a9 = int(((ts >= pe) & (ts < m) & o.lhr).sum()); al = int(((ts >= m) & (ts < e_) & o.lhr).sum())
            ao = int(((ts >= pe) & (ts < e_) & ~o.lhr).sum())
            s9.append(a9); sl.append(al); so.append(ao); st.append(al + ao)
        return s9, sl, so, st
    s60 = series(60); s7d = series(7)
    M["cutref"] = "Orders split at 7:40 AM and 3:25 PM (current cut-offs at plan volume, 6 packers)"
    M["win60"] = (end - pd.Timedelta(days=60)).strftime("%d %b") + " – " + yday.strftime("%d %b %Y")
    M["slots"] = [{"avg": round(float(np.mean(a)), 1), "p90": round(float(np.percentile(a, 90)), 1), "avg7": round(float(np.mean(b)), 1)}
                  for a, b in zip(s60, s7d)]
    # ---- fulfillments
    f = d[d.f_created.notna() & d.cour.isin(COURIERS) & (d.f_created < end)].copy()
    f["days"] = (f.f_delivered.dt.normalize() - f.f_created.dt.normalize()).dt.days
    last7 = f[f.f_created >= end - pd.Timedelta(days=7)]
    tot7 = len(last7)
    rec = f[(f.f_created >= end - pd.Timedelta(days=35)) & (f.f_created < end - pd.Timedelta(days=5))]
    M["recent"] = []
    for c in COURIERS:
        r = rec[(rec.cour == c) & rec.f_delivered.notna()]
        M["recent"].append({"courier": c, "n7": int((last7.cour == c).sum()), "share7": (float((last7.cour == c).sum()) / tot7) if tot7 else 0.0,
            "n30": int(((f.cour == c) & (f.f_created >= end - pd.Timedelta(days=30))).sum()), "deliv": int(len(r)),
            "nextday": float((r.days <= 1).mean()) if len(r) else None, "avg": float(r.days.mean()) if len(r) else None,
            "g5": float((r.days >= 5).mean()) if len(r) else None})
    M["rec_win"] = (end - pd.Timedelta(days=35)).strftime("%d %b") + " – " + (end - pd.Timedelta(days=6)).strftime("%d %b")
    # ---- months (last 5 incl. current)
    cur = end - pd.Timedelta(days=1)
    months = [(cur.to_period("M") - k) for k in range(4, -1, -1)]
    def mlabel(p):
        lab = p.strftime("%b %Y")
        if p == cur.to_period("M") and cur.day < cur.days_in_month: lab += " (to %d%s)" % (cur.day, "th" if 11 <= cur.day <= 13 else {1:"st",2:"nd",3:"rd"}.get(cur.day % 10, "th"))
        return lab
    f["fm"] = f.f_created.dt.to_period("M")
    M["volumes"] = [{"month": mlabel(p), **{c: int(((f.fm == p) & (f.cour == c)).sum()) for c in COURIERS}} for p in months]
    M["speed"] = []
    for c in COURIERS:
        for p in months[-4:]:
            r = f[(f.fm == p) & (f.cour == c) & f.f_delivered.notna()]
            n = len(r)
            M["speed"].append({"label": c + " " + mlabel(p).replace(" 2026", "").replace(" 2027", ""), "n": int(n),
                "median": float(r.days.median()) if n else None, "avg": float(r.days.mean()) if n else None,
                "nextday": float((r.days <= 1).mean()) if n else None, "g5": float((r.days >= 5).mean()) if n else None})
    return M
