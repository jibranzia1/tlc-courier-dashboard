
import json, time, datetime as dt, requests, pandas as pd
ACC = "shopify_levy-keek"
def export_orders(run_composio_tool, since):
    q = """
{
  orders(query: "created_at:>=%s") {
    edges { node {
      name createdAt cancelledAt displayFinancialStatus paymentGatewayNames
      currentTotalPriceSet { shopMoney { amount } }
      shippingAddress { city }
      fulfillments(first: 5) { createdAt deliveredAt updatedAt displayStatus trackingInfo(first: 1) { company number } }
    } }
  }
}""" % since
    r, e = run_composio_tool("SHOPIFY_BULK_QUERY_OPERATION", {"query": q, "timeout_seconds": 170, "poll_interval_seconds": 3}, account=ACC)
    if e: raise RuntimeError(e)
    return r
def to_df(url):
    rows = []
    txt = requests.get(url, timeout=120).text
    for line in txt.splitlines():
        if not line.strip(): continue
        o = json.loads(line)
        fs = o.get("fulfillments") or [{}]
        base = dict(name=o["name"], created=o["createdAt"], cancelled=o.get("cancelledAt"),
            fin=o.get("displayFinancialStatus"), gw=", ".join(o.get("paymentGatewayNames") or []),
            cur_total=float(((o.get("currentTotalPriceSet") or {}).get("shopMoney") or {}).get("amount") or 0),
            city=(o.get("shippingAddress") or {}).get("city"), n_ful=len(o.get("fulfillments") or []))
        for f0 in fs:
            ti = (f0.get("trackingInfo") or [{}])
            ti = ti[0] if ti else {}
            rows.append(dict(base, f_disp=f0.get("displayStatus"), f_created=f0.get("createdAt"), f_delivered=f0.get("deliveredAt"),
                f_updated=f0.get("updatedAt"), company=ti.get("company"), tracking=ti.get("number")))
    d = pd.DataFrame(rows)
    for c in ["created","cancelled","f_created","f_delivered","f_updated"]:
        d[c] = pd.to_datetime(d[c], utc=True, errors="coerce").dt.tz_convert("Asia/Karachi")
    return d
