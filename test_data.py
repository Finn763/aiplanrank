"""One check: index.html inline PLANS matches plans.json (same ids, same per10)."""
import json
import re

plans = json.load(open("plans.json"))
html = open("index.html", encoding="utf-8").read()
m = re.search(r"const PLANS = (\[.*?\]);", html, re.S)
assert m and "fetch(" not in html, "page must be fetch-free single file"
inline = json.loads(m.group(1))
assert [p["id"] for p in inline] == [p["id"] for p in plans], "id drift"
assert all(a["per10"] == b["per10"] for a, b in zip(inline, plans)), "per10 drift"
assert len(plans) == 14
print(f"ok: {len(plans)} rows in sync, fetch-free")
