"""Periodic SePay v2 reconciliation. Safe to rerun; bank references/order locks prevent duplicate grants."""

import argparse
import asyncio
import logging
import re
import httpx
from sqlalchemy import select
from .billing import apply_payment
from .config import Settings
from .db import database
from .models import Order, now_ms

log = logging.getLogger("lumi.worker")


async def reconcile_once(cfg, factory, client):
    if not cfg.sepay_token:
        raise RuntimeError("SEPAY_API_TOKEN is required for reconciliation")
    root = (
        "https://userapi.sepay.vn/v2"
        if cfg.sepay_environment == "live"
        else "https://userapi-sandbox.sepay.vn/v2"
    )
    async with factory() as db:
        orders = list(
            (
                await db.execute(
                    select(Order)
                    .where(
                        Order.environment == cfg.sepay_environment,
                        Order.status.in_(["pending", "expired", "review"]),
                        Order.created_at > now_ms() - 7 * 86400000,
                    )
                    .order_by(Order.created_at)
                    .limit(100)
                )
            ).scalars()
        )
    matched = 0
    for order in orders:
        result = await client.get(
            root + "/transactions",
            headers={"Authorization": f"Bearer {cfg.sepay_token}"},
            params={"q": order.invoice, "per_page": 100, "transfer_type": "in"},
        )
        if result.status_code != 200:
            raise RuntimeError("SePay reconciliation is temporarily unavailable")
        for tx in result.json().get("data", []):
            content = str(tx.get("transaction_content") or "")
            if not re.search(r"(?<![A-Z0-9])" + re.escape(order.invoice) + r"(?![A-Z0-9])", content.upper()):
                continue
            payload = {
                "id": tx.get("id"),
                "accountNumber": tx.get("account_number"),
                "content": content,
                "code": tx.get("code"),
                "transferType": tx.get("transfer_type"),
                "transferAmount": tx.get("amount_in"),
                "referenceCode": tx.get("reference_number"),
            }
            async with factory() as db:
                event = await apply_payment(db, cfg, payload)
                matched += event.status == "applied"
                await db.commit()
        # SePay v2 rate limit: leave room for webhook/admin traffic and all pagination queries.
        await asyncio.sleep(0.5)
    return matched


async def main(once):
    cfg = Settings()
    cfg.validate()
    engine, factory = database(cfg.database_url)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            while True:
                try:
                    count = await reconcile_once(cfg, factory, client)
                    log.info("Reconciliation completed: %d matching events", count)
                except Exception:
                    log.error("Reconciliation failed; check provider configuration and connectivity")
                    if once:
                        raise SystemExit(1)
                if once:
                    break
                await asyncio.sleep(60)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main(parser.parse_args().once))
