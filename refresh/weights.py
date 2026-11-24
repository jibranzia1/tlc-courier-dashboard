"""Our weight for every parcel: Shopify product weights x quantities, plus a packaging allowance.
Orders split across several parcels use each parcel's own items (fulfillment line items)."""
import json, requests, pandas as pd

ACC = "shopify_sikh-cuddy"
UNIT = {"GRAMS": 0.001, "KILOGRAMS": 1.0, "POUNDS": 0.45359237, "OUNCES": 0.028349523}


def export_weights(run_composio_tool, since):
    q = """
{
  orders(query: "created_at:>=%s") {
    edges { node {
      id name
      lineItems { edges { node { sku currentQuantity quantity
        variant { inventoryItem { measurement { weight { unit value } } } } } } }
    } }
  }
}""" % since
    r, e = run_composio_tool("SHOPIFY_BULK_QUERY_OPERATION", {"query": q, "timeout_seconds": 170, "poll_interval_seconds": 3}, account=ACC)
    if e: raise RuntimeError(e)
    url = (r.get("data") or {}).get("url")
    names, rows = {}, []
    for line in requests.get(url, timeout=120).text.splitlines():
        if not line.strip(): continue
        o = json.loads(line)
        if "__parentId" not in o:
            names[o["id"]] = o["name"]; continue
        w = ((((o.get("variant") or {}).get("inventoryItem") or {}).get("measurement") or {}).get("weight") or {})
        kg = (w.get("value") or 0) * UNIT.get(w.get("unit"), 0.001)
        qty = o.get("currentQuantity")
        qty = o.get("quantity") if qty is None else qty
        rows.append(dict(oid=o["__parentId"], sku=o.get("sku"), qty=qty or 0, kg=kg))
    li = pd.DataFrame(rows)
    li["name"] = li.oid.map(names)
    li["line_kg"] = li.qty * li.kg
    g = li.groupby("name").agg(items=("qty", "sum"), kg=("line_kg", "sum"),
                               missing=("kg", lambda s: int(((s <= 0) & (li.loc[s.index, "qty"] > 0)).sum())))
    return g.reset_index(), li


SPLIT_Q = """query($q: String!) { orders(first: 25, query: $q) { nodes { name
  fulfillments(first: 10) { trackingInfo(first: 1) { number }
    fulfillmentLineItems(first: 50) { nodes { quantity lineItem { variant { inventoryItem { measurement { weight { unit value } } } } } } } } } } }"""


def split_weights(run_composio_tool, names):
    """Per-parcel weight for orders shipped in more than one parcel, keyed by tracking number."""
    out = {}
    names = list(names)
    for i in range(0, len(names), 25):
        chunk = names[i:i + 25]
        q = " OR ".join("name:%s" % n.lstrip("#") for n in chunk)
        r, e = run_composio_tool("SHOPIFY_GRAPH_QL_QUERY", {"query": SPLIT_Q, "variables": {"q": q}}, account=ACC)
        if e: continue
        data = r.get("data") or {}
        data = data.get("data", data)
        for o in ((data.get("orders") or {}).get("nodes") or []):
            for f in o.get("fulfillments") or []:
                t = ((f.get("trackingInfo") or [{}]) or [{}])[0].get("number")
                if not t: continue
                kg = 0.0
                for n in ((f.get("fulfillmentLineItems") or {}).get("nodes") or []):
                    w = ((((n.get("lineItem") or {}).get("variant") or {}).get("inventoryItem") or {}).get("measurement") or {}).get("weight") or {}
                    kg += (n.get("quantity") or 0) * (w.get("value") or 0) * UNIT.get(w.get("unit"), 0.001)
                out[str(t)] = kg
    return out
