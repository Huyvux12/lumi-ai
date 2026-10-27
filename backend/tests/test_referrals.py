import re
from email import policy
from email.parser import BytesParser

from sqlalchemy import func, select

from app.models import Order, Subscription, User
from app.referrals import grant_trial
from conftest import conversation, register, turn
from test_billing import payload, webhook

DAY_MS = 86400000
PASSWORD = "CorrectHorse123!"


async def sign_up(client, name, ref=None):
    # Tests sign up many accounts from one address; the per-IP sign-up limit is covered elsewhere.
    client._transport.app.state.limiter.local.clear()
    body = {"email": f"{name}@example.com", "username": name, "password": PASSWORD, "name": name.title()}
    if ref is not None:
        body["ref"] = ref
    response = await client.post("/api/v1/auth/register", json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def login(client, name):
    client.cookies.clear()
    response = await client.post(
        "/api/v1/auth/login", json={"email": f"{name}@example.com", "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def verify(client, cfg, name):
    newest_first = sorted((cfg.data_dir / "outbox").glob("*.eml"), key=lambda p: p.stat().st_mtime_ns, reverse=True)
    for path in newest_first:
        mail = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
        if mail["To"] == f"{name}@example.com":
            found = re.search(r"verify-email\?token=([\w-]+)", mail.get_content())
            if found:
                response = await client.post("/api/v1/auth/verify-email", json={"token": found.group(1)})
                assert response.status_code == 200, response.text
                return response.json()
    raise AssertionError(f"No verification mail for {name}")


async def qualified_invite(client, cfg, name, code):
    await sign_up(client, name, code)
    await verify(client, cfg, name)
    await turn(client, await conversation(client), key=f"{name}-first-turn")


async def gifts(app, user_id, source):
    async with app.state.db() as db:
        return await db.scalar(
            select(func.count()).select_from(Order).where(Order.user_id == user_id, Order.source == source)
        )


async def test_every_account_gets_an_invite_code_and_preview(env):
    _, client, _ = env
    inviter = await register(client)
    code = inviter["invite_code"]
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{7}", code)
    preview = await client.get(f"/api/v1/invites/{code.lower()}")
    assert preview.status_code == 200
    assert preview.json() == {"code": code, "name": "Alice", "username": "alice", "trial_days": 7}
    assert (await client.get("/api/v1/invites/NOPE123")).status_code == 404
    summary = (await client.get("/api/v1/me/invite")).json()
    assert summary["code"] == code and summary["link"].endswith(f"/i/{code}")
    assert summary["invited"] == summary["qualified"] == summary["rewards_granted"] == 0
    assert summary["remaining_to_next"] == 3


async def test_unknown_code_never_blocks_signup(env):
    app, client, _ = env
    account = await sign_up(client, "bob", "ZZZZZZZ")
    async with app.state.db() as db:
        assert (await db.get(User, account["id"])).referred_by is None


async def test_invitee_gets_a_seven_day_basic_trial_on_verification(env):
    app, client, cfg = env
    inviter = await register(client)
    invitee = await sign_up(client, "bob", inviter["invite_code"])
    assert invitee["plan"] == "free"
    assert (await verify(client, cfg, "bob"))["invite_trial_days"] == 7
    me = (await client.get("/api/v1/me")).json()
    assert me["plan"] == "basic"
    sub = (await client.get("/api/v1/billing/subscription")).json()
    assert sub["source"] == "referral_trial"
    async with app.state.db() as db:
        period = await db.scalar(select(Subscription).where(Subscription.user_id == invitee["id"]))
        assert period.ends_at - period.starts_at == 7 * DAY_MS
        order = await db.get(Order, period.order_id)
        assert order.amount_vnd == 0 and order.status == "paid"
    # Granting again is a no-op: the trial is keyed once per account.
    async with app.state.db() as db:
        assert await grant_trial(db, cfg, await db.get(User, invitee["id"])) is None
    assert await gifts(app, invitee["id"], "referral_trial") == 1


async def test_users_without_an_inviter_get_no_trial(env):
    _, client, cfg = env
    await sign_up(client, "bob")
    assert (await verify(client, cfg, "bob"))["invite_trial_days"] == 0
    assert (await client.get("/api/v1/me")).json()["plan"] == "free"


async def test_invite_counts_only_after_verification_and_a_first_chat(env):
    app, client, cfg = env
    inviter = await register(client)
    invitee = await sign_up(client, "bob", inviter["invite_code"])
    ident = await conversation(client)
    await turn(client, ident)
    async with app.state.db() as db:
        assert (await db.get(User, invitee["id"])).referral_qualified_at is None
    await verify(client, cfg, "bob")  # verifying after chatting qualifies too
    async with app.state.db() as db:
        assert (await db.get(User, invitee["id"])).referral_qualified_at is not None
    await sign_up(client, "carol", inviter["invite_code"])
    await verify(client, cfg, "carol")
    async with app.state.db() as db:
        assert (await db.scalar(select(User).where(User.username == "carol"))).referral_qualified_at is None
    await turn(client, await conversation(client), key="carol-first-turn")
    async with app.state.db() as db:
        assert (await db.scalar(select(User).where(User.username == "carol"))).referral_qualified_at
    await login(client, "alice")
    summary = (await client.get("/api/v1/me/invite")).json()
    assert summary["invited"] == 2 and summary["qualified"] == 2 and summary["remaining_to_next"] == 1


async def test_three_qualified_invites_earn_a_basic_month_capped_at_three(env):
    app, client, cfg = env
    inviter = await register(client)
    code = inviter["invite_code"]
    for i in range(2):
        await qualified_invite(client, cfg, f"friend{i}", code)
    assert await gifts(app, inviter["id"], "referral_reward") == 0
    await qualified_invite(client, cfg, "friend2", code)
    assert await gifts(app, inviter["id"], "referral_reward") == 1
    await login(client, "alice")
    assert (await client.get("/api/v1/me")).json()["plan"] == "basic"
    for i in range(3, 10):
        await qualified_invite(client, cfg, f"friend{i}", code)
    assert await gifts(app, inviter["id"], "referral_reward") == 3
    await login(client, "alice")
    summary = (await client.get("/api/v1/me/invite")).json()
    assert summary["qualified"] == 10 and summary["rewards_granted"] == 3 and summary["remaining_to_next"] == 0
    async with app.state.db() as db:
        periods = (
            await db.execute(
                select(Subscription).where(Subscription.user_id == inviter["id"]).order_by(Subscription.starts_at)
            )
        ).scalars().all()
        # Reward months chain one after another instead of overlapping.
        assert [a.ends_at for a in periods[:-1]] == [b.starts_at for b in periods[1:]]


async def test_paying_inviter_keeps_premium_and_reward_queues_after(env):
    app, client, cfg = env
    inviter = await register(client)
    created = (
        await client.post("/api/v1/billing/orders", headers={"Idempotency-Key": "buy-premium-first"})
    ).json()
    assert (await webhook(client, cfg, payload(created))).status_code == 200
    for i in range(3):
        await qualified_invite(client, cfg, f"friend{i}", inviter["invite_code"])
    await login(client, "alice")
    assert (await client.get("/api/v1/me")).json()["plan"] == "premium"
    async with app.state.db() as db:
        premium, basic = (
            await db.execute(
                select(Subscription).where(Subscription.user_id == inviter["id"]).order_by(Subscription.starts_at)
            )
        ).scalars().all()
        assert basic.starts_at == premium.ends_at


async def test_gifted_periods_are_not_paying_users_or_revenue(env):
    app, client, cfg = env
    inviter = await register(client)
    async with app.state.db() as db:
        (await db.get(User, inviter["id"])).role = "owner"
        await db.commit()
    await sign_up(client, "bob", inviter["invite_code"])
    await verify(client, cfg, "bob")
    await login(client, "alice")
    dashboard = (await client.get("/api/v1/admin/dashboard?days=30")).json()
    metrics = dashboard["metrics"]
    assert metrics["premium_users"] == 0 and metrics["gifted_users"] == 1
    assert metrics["revenue_vnd"] == 0
    assert metrics["referral_signups"] == 1 and metrics["referral_qualified"] == 0
    assert (await client.get("/api/v1/admin/summary")).json()["premium_users"] == 0


async def test_admin_can_switch_the_invite_popup_off_and_on(env):
    app, client, _ = env
    assert (await client.get("/api/v1/promotions")).json() == {"invite_banner": True}
    await register(client)
    assert (
        await client.put("/api/v1/admin/promotions/invite_banner", json={"enabled": False})
    ).status_code == 403
    async with app.state.db() as db:
        (await db.scalar(select(User))).role = "admin"
        await db.commit()
    response = await client.put("/api/v1/admin/promotions/invite_banner", json={"enabled": False})
    assert response.status_code == 200 and response.json() == {"code": "invite_banner", "enabled": False}
    assert (await client.get("/api/v1/promotions")).json() == {"invite_banner": False}
    assert (await client.get("/api/v1/admin/promotions")).json()[0]["enabled"] is False
    assert (await client.put("/api/v1/admin/promotions/nope", json={"enabled": True})).status_code == 404
    # Switching the popup off never stops invite codes from working.
    code = (await client.get("/api/v1/me")).json()["invite_code"]
    assert (await client.get(f"/api/v1/invites/{code}")).status_code == 200
