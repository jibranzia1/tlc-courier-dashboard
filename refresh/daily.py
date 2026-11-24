"""Day-level rows for the courier performance app (the page filters and totals them by date).

daily  : one row per pickup day  -> orders in the 9 AM batch, the 7 PM batch (Lahore / other cities), orders, cancelled
hand   : one row per handover day x courier x city group -> parcels, delivered, days-to-deliver buckets, attempts, open
open   : one row per parcel still not delivered (handed over in the last 60 days) -> the chase list
Courier API data (couriers.py), when present, adds returns, attempts and reasons per parcel.
"""
import numpy as np, pandas as pd

HIST_START = pd.Timestamp("2026-07-01", tz="Asia/Karachi")
MORN, EVE = 7 * 60 + 40, 15 * 60 + 25
CITY_GROUPS = ["Lahore", "Karachi", "Islamabad / Pindi", "Other cities"]


def city_group(c):
    c = (c or "").strip().lower()
    if "lahore" in c: return "Lahore"
    if "karachi" in c: return "Karachi"
    if "islamabad" in c or "rawalpindi" in c or "pindi" in c: return "Islamabad / Pindi"
    return "Other cities"


def _norm(c):
    if not isinstance(c, str): return None
    u = c.upper()
    if "QWQER" in u: return "QWQER"
    if "LEOPARD" in u: return "Leopards"
    if "POSTEX" in u: return "PostEx"
    return "Other"


def daily_rows(d, now):
    end = now.normalize()
    o = d.drop_duplicates("name").copy()
    o["lhr"] = o.city.fillna("").str.lower().str.contains("lahore")
    live = o[o.cancelled.isna()]
    ts, lhr = live.created, live.lhr
    out = []
    day = HIST_START + pd.Timedelta(days=1)
    while day < end:
        m = day + pd.Timedelta(minutes=MORN); e = day + pd.Timedelta(minutes=EVE); pe = e - pd.Timedelta(days=1)
        nx = day + pd.Timedelta(days=1)
        out.append(dict(
            d=day.strftime("%Y-%m-%d"),
            am9=int(((ts >= pe) & (ts < m) & lhr).sum()),
            pm7_lhr=int(((ts >= m) & (ts < e) & lhr).sum()),
            pm7_other=int(((ts >= pe) & (ts < e) & ~lhr).sum()),
            orders=int(((ts >= day) & (ts < nx)).sum()),
            cancelled=int(((o.created >= day) & (o.created < nx) & o.cancelled.notna()).sum()),
        ))
        day = nx
    return out


def parcel_frame(d, now, cx=None):
    """One row per courier parcel, with Shopify status and (optional) courier API status merged on tracking."""
    end = now.normalize()
    f = d[d.f_created.notna()].copy()
    f["cour"] = f.company.map(_norm)
    f = f[f.cour.isin(["QWQER", "Leopards", "PostEx"]) & (f.f_created >= HIST_START) & (f.f_created < now)]
    f["g"] = f.city.map(city_group)
    f["hd"] = f.f_created.dt.normalize()
    f["dl"] = f.f_delivered.notna() | (f.f_disp == "DELIVERED")
    f["days"] = (f.f_delivered.dt.normalize() - f.hd).dt.days
    f["cxl"] = f.f_disp.eq("CANCELED")
    f["st"] = np.where(f.dl, "delivered", np.where(f.cxl, "cancelled", "open"))
    f["att"] = np.nan; f["reason"] = None; f["src"] = "shopify"
    if cx is not None and len(cx):
        c = cx.set_index("tracking")
        hit = f.tracking.isin(c.index)
        t = f.loc[hit, "tracking"]
        f.loc[hit, "st"] = c.loc[t, "status"].values
        f.loc[hit, "att"] = c.loc[t, "attempts"].values
        f.loc[hit, "reason"] = c.loc[t, "reason"].values
        f.loc[hit, "src"] = "courier"
        dd = c.loc[t, "delivered_at"].values
        ok = pd.notna(dd)
        idx = f.index[hit][ok]
        f.loc[idx, "days"] = (pd.to_datetime(dd[ok], utc=True).tz_convert("Asia/Karachi").normalize() - f.loc[idx, "hd"]).days
        f.loc[f.st == "delivered", "dl"] = True
    return f


def hand_rows(f, now):
    end = now.normalize()
    g = f[f.hd < end]
    out = []
    for (hd, c, cg), r in g.groupby(["hd", "cour", "g"]):
        dl = r[r.st == "delivered"]
        days = dl.days.dropna().clip(lower=0)
        row = dict(d=hd.strftime("%Y-%m-%d"), c=c, g=cg, n=int(len(r)),
                   dl=int(len(dl)), ret=int((r.st == "returned").sum()), rtn=int((r.st == "returning").sum()),
                   cx=int((r.st == "cancelled").sum()), op=int(r.st.isin(["open", "in_transit"]).sum()),
                   sd=int(days.size), sum=int(days.sum()),
                   b=[int((days == k).sum()) for k in range(5)] + [int((days >= 5).sum())],
                   src=int((r.src == "courier").sum()))
        a = r.att.dropna()
        if len(a):
            row["fa"] = int(((r.st == "delivered") & (r.att <= 1)).sum())
            row["att_n"] = int(len(a))
            row["fad"] = int(((r.st == "delivered") & r.att.notna()).sum())
        out.append(row)
    return out


def reason_rows(f, now):
    end = now.normalize()
    r = f[(f.hd < end) & f.st.isin(["returned", "returning"]) & f.reason.notna()]
    out = []
    for (hd, c, rs), x in r.groupby(["hd", "cour", "reason"]):
        out.append(dict(d=hd.strftime("%Y-%m-%d"), c=c, r=rs, n=int(len(x))))
    return out


def open_rows(f, now):
    """Parcels not yet delivered (or returning), handed over in the last 60 days. The page decides which are late."""
    end = now.normalize()
    r = f[f.st.isin(["open", "in_transit", "returning"]) & (f.f_created >= end - pd.Timedelta(days=60))].copy()
    r["age"] = (end - r.hd).dt.days
    r = r.sort_values("age", ascending=False)
    S = lambda v: v if isinstance(v, str) else ""
    return [dict(o=x.name, c=x.cour, t=S(x.tracking), city=S(x.city).strip().title(), g=x.g,
                 d=x.hd.strftime("%Y-%m-%d"), age=int(x.age),
                 s=S(x.f_disp).replace("_", " ").capitalize() if x.src == "shopify" else x.st.replace("_", " ").capitalize(),
                 st=x.st, att=None if pd.isna(x.att) else int(x.att), why=x.reason if isinstance(x.reason, str) else None, src=x.src)
            for x in r.itertuples(index=False)]


def build_v2(d, now, cx=None, live_couriers=None):
    """Everything the app filters client-side. Open parcels are packed as arrays to keep the file small."""
    f = parcel_frame(d, now, cx)
    o = open_rows(f, now)
    keys = ["o", "c", "t", "city", "g", "d", "age", "s", "st", "att", "why", "src"]
    return dict(
        v=2,
        app=[dict(hist_start=HIST_START.strftime("%Y-%m-%d"), track_start="2026-08-01",
                  data_to=(now.normalize() - pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                  as_of=now.strftime("%Y-%m-%d %H:%M"), city_groups=CITY_GROUPS,
                  live=live_couriers or {})],
        daily=daily_rows(d, now),
        hand=hand_rows(f, now),
        reasons=reason_rows(f, now),
        open_keys=keys,
        open=[[x[k] for k in keys] for x in o],
    )
