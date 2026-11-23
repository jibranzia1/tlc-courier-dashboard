# TLC Pakistan courier dashboard

Password-protected dashboard for TLC Pakistan's courier operations: pickup cut-offs, courier mix, delivery speed, costs and returns.

- **Site:** https://jibranzia1.github.io/tlc-courier-dashboard/
- **Data:** `data.enc.json` is encrypted (PBKDF2-SHA256 + AES-256-GCM). The page decrypts it in the browser with the dashboard password. The password is not stored in this repository.
- **Refresh:** a scheduled task runs `refresh/publish.py` every day before 11 AM PKT. It pulls Shopify orders, recomputes the live figures, re-encrypts the file and commits it here.
- **Live figures:** orders per pickup, courier share, delivery speed, shipments by month (Shopify).
- **Last-known figures:** costs, returns and savings actions (October 2026 courier invoices; PostEx September).
