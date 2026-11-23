import json
def dash_json(M):
    names = ["9 AM pickup: Lahore, same day", "7 PM pickup: Lahore, next day", "7 PM pickup: other cities", "7 PM pickup: total to pack"]
    keys = ["am9", "pm7_lhr", "pm7_other", "pm7"]
    slots = [dict(key=k, slot=n, avg60=s["avg"], p90=s["p90"], avg7=s["avg7"]) for k, n, s in zip(keys, names, M["slots"])]
    couriers = [dict(courier=r["courier"], parcels_7d=r["n7"], share_7d=round(r["share7"], 4), parcels_30d=r["n30"],
                     delivered=r["deliv"], next_day=None if r["nextday"] is None else round(r["nextday"], 4),
                     avg_days=None if r["avg"] is None else round(r["avg"], 2), five_plus=None if r["g5"] is None else round(r["g5"], 4))
                for r in M["recent"]]
    volumes = [dict(month=v["month"], QWQER=v["QWQER"], Leopards=v["Leopards"], PostEx=v["PostEx"]) for v in M["volumes"]]
    speed = []
    for s in M["speed"]:
        c, m = s["label"].split(" ", 1)
        speed.append(dict(courier=c, month=m, delivered=s["n"], median_days=s["median"],
                          avg_days=None if s["avg"] is None else round(s["avg"], 2),
                          next_day=None if s["nextday"] is None else round(s["nextday"], 4),
                          five_plus=None if s["g5"] is None else round(s["g5"], 4)))
    fx = lambda t: t.replace(" \u2013 ", " to ")
    meta = [dict(refreshed=M["refreshed"], data_to=M["data_to"], order_window=fx(M["win60"]), speed_window=fx(M["rec_win"]),
                 split_times=M["cutref"])]
    return dict(meta=meta, slots=slots, couriers=couriers, volumes=volumes, speed=speed)
