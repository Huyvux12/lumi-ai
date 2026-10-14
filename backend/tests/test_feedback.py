from conftest import register
from sqlalchemy import select

from app.models import Audit, FeedbackMessage, User, uid

PAYLOAD = {
    "kind": "bug",
    "title": "Ảnh không hiển thị",
    "body": "Mở trang nhân vật nhưng ảnh đại diện không hiển thị.",
}


async def account(app, client, name, role="user"):
    user = await register(client, name)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = role
        await db.commit()
    return user, dict(client.cookies)


def switch(client, cookies):
    client.cookies.clear()
    client.cookies.update(cookies)


async def create(client, **extra):
    response = await client.post("/api/v1/feedback", json={**PAYLOAD, **extra})
    assert response.status_code == 201, response.text
    return response.json()


async def get_admin(client, ident):
    response = await client.get(f"/api/v1/admin/feedback/{ident}")
    assert response.status_code == 200, response.text
    return response.json()["feedback"]


async def patch(client, feedback, **extra):
    return await client.patch(
        f"/api/v1/admin/feedback/{feedback['id']}",
        json={
            "version": feedback["version"],
            "status": feedback["status"],
            "priority": feedback["priority"],
            "assignee_id": feedback["assignee_id"],
            **extra,
        },
    )


async def test_create_trim_and_sanitized_page_path(env):
    app, client, _ = env
    await account(app, client, "alice")
    feedback = await create(
        client, title="  Ảnh không hiển thị  ", source_path="/character/kaito-kid?token=private#secret"
    )
    assert feedback["title"] == PAYLOAD["title"]
    assert feedback["source_path"] == "/character/kaito-kid"
    assert feedback["code"].startswith("FB-") and len(feedback["code"]) == 15
    assert feedback["status"] == "new" and not feedback["unread"]
    assert not {"priority", "assignee_id", "version", "user_id"} & feedback.keys()
    for payload in (
        {"title": "     "},
        {"body": " " * 25},
        {"kind": "payment"},
        {"title": "x" * 121},
        {"body": "x" * 5001},
        {"internal": True},
        {"source_path": "https://evil.example"},
        {"source_path": "//evil.example"},
        {"source_path": "/\\evil"},
        {"source_path": "/secret\npath"},
    ):
        response = await client.post("/api/v1/feedback", json={**PAYLOAD, **payload})
        assert response.status_code == 422, response.text


async def test_feedback_is_private_and_requires_login(env):
    app, client, _ = env
    _, alice = await account(app, client, "alice")
    feedback = await create(client)
    _, _bob = await account(app, client, "bob")
    assert (await client.get("/api/v1/feedback")).json()["total"] == 0
    for method, suffix, body in (
        ("GET", "", None),
        ("POST", "/messages", {"body": "Please help"}),
        ("POST", "/read", {"seen_at": 9999999999999}),
    ):
        response = await client.request(method, f"/api/v1/feedback/{feedback['id']}{suffix}", json=body)
        assert response.status_code == 404, response.text
    assert (await client.get("/api/v1/admin/feedback")).status_code == 403
    client.cookies.clear()
    assert (await client.get("/api/v1/feedback")).status_code == 401
    assert (await client.post("/api/v1/feedback", json=PAYLOAD)).status_code == 401
    switch(client, alice)
    assert (await client.get(f"/api/v1/feedback/{feedback['id']}")).status_code == 200
    assert (await client.get(f"/api/v1/feedback/{uid()}")).status_code == 404


async def test_internal_notes_do_not_leak_or_create_public_updates(env):
    app, client, _ = env
    _, alice = await account(app, client, "alice")
    feedback = await create(client)
    owner, owner_cookies = await account(app, client, "owner", "owner")
    response = await client.post(
        f"/api/v1/admin/feedback/{feedback['id']}/messages",
        json={"body": "INTERNAL SECRET", "internal": True},
    )
    assert response.status_code == 201
    admin = await get_admin(client, feedback["id"])
    assert admin["version"] == 2
    response = await patch(client, admin, priority="urgent", assignee_id=owner["id"])
    assert response.status_code == 200, response.text
    switch(client, alice)
    response = await client.get(f"/api/v1/feedback/{feedback['id']}")
    detail = response.json()
    assert detail["messages"] == []
    assert detail["feedback"]["updated_at"] == feedback["updated_at"]
    assert not detail["feedback"]["unread"]
    assert "INTERNAL SECRET" not in response.text
    switch(client, owner_cookies)
    dashboard = (await client.get("/api/v1/admin/dashboard")).json()
    assert dashboard["queue"]["feedback_new"] == 1
    assert "INTERNAL SECRET" not in str(dashboard)
    async with app.state.db() as db:
        logs = (await db.scalars(select(Audit).where(Audit.target == feedback["id"]))).all()
        assert {log.action for log in logs} == {"feedback.note", "feedback.update"}
        assert all("INTERNAL SECRET" not in str(log.details) for log in logs)


async def test_public_reply_unread_acknowledgement_and_stale_read(env):
    app, client, _ = env
    _, alice = await account(app, client, "alice")
    feedback = await create(client)
    _, owner = await account(app, client, "owner", "owner")
    path = f"/api/v1/admin/feedback/{feedback['id']}/messages"
    assert (await client.post(path, json={"body": "Đã nhận và đang kiểm tra."})).status_code == 201
    switch(client, alice)
    first = (await client.get(f"/api/v1/feedback/{feedback['id']}")).json()
    assert first["feedback"]["unread"]
    assert first["messages"][0]["author_role"] == "admin"
    switch(client, owner)
    assert (await client.post(path, json={"body": "Có thêm thông tin xử lý."})).status_code == 201
    switch(client, alice)
    assert (
        await client.post(
            f"/api/v1/feedback/{feedback['id']}/read",
            json={"seen_at": first["feedback"]["public_updated_at"]},
        )
    ).status_code == 200
    second = (await client.get(f"/api/v1/feedback/{feedback['id']}")).json()
    assert second["feedback"]["unread"]
    await client.post(
        f"/api/v1/feedback/{feedback['id']}/read", json={"seen_at": second["feedback"]["public_updated_at"]}
    )
    assert not (await client.get("/api/v1/feedback")).json()["items"][0]["unread"]
    assert (
        await client.post(
            f"/api/v1/feedback/{feedback['id']}/messages", json={"body": "Cảm ơn, mình bổ sung chi tiết."}
        )
    ).status_code == 201
    assert not (await client.get("/api/v1/feedback")).json()["items"][0]["unread"]
    assert (
        await client.post(
            f"/api/v1/feedback/{feedback['id']}/messages", json={"body": "secret", "internal": True}
        )
    ).status_code == 422


async def test_status_reason_conflict_reopen_and_assignment(env):
    app, client, _ = env
    user, alice = await account(app, client, "alice")
    feedback = await create(client)
    owner, owner_cookies = await account(app, client, "owner", "owner")
    admin = await get_admin(client, feedback["id"])
    assert (await patch(client, admin, status="resolved")).status_code == 422
    assert (await patch(client, admin, assignee_id=user["id"])).status_code == 422
    assert (await patch(client, admin, assignee_id=uid())).status_code == 422
    assert (
        await patch(
            client,
            admin,
            status="reviewing",
            priority="high",
            assignee_id=owner["id"],
            reason="Đang xác minh lỗi.",
        )
    ).status_code == 200
    assert (await patch(client, admin, status="closed", reason="Stale update")).status_code == 409
    admin = await get_admin(client, feedback["id"])
    assert (await patch(client, admin, status="planned", reason="Đã đưa vào kế hoạch.")).status_code == 200
    admin = await get_admin(client, feedback["id"])
    assert (
        await patch(client, admin, status="resolved", reason="Đã sửa lỗi và kiểm thử.")
    ).status_code == 200
    switch(client, alice)
    detail = (await client.get(f"/api/v1/feedback/{feedback['id']}")).json()
    assert [m["status"] for m in detail["messages"]] == ["reviewing", "planned", "resolved"]
    assert detail["messages"][-1]["body"] == "Đã sửa lỗi và kiểm thử."
    assert (
        await client.post(f"/api/v1/feedback/{feedback['id']}/messages", json={"body": "Still broken"})
    ).status_code == 409
    switch(client, owner_cookies)
    admin = await get_admin(client, feedback["id"])
    assert (await patch(client, admin, status="reviewing", reason="Mở lại để kiểm tra.")).status_code == 200
    switch(client, alice)
    assert (
        await client.post(f"/api/v1/feedback/{feedback['id']}/messages", json={"body": "Thông tin bổ sung"})
    ).status_code == 201
    switch(client, owner_cookies)
    admin = await get_admin(client, feedback["id"])
    assert (
        await patch(client, admin, status="closed", reason="Đã gộp vào phản hồi khác.")
    ).status_code == 200
    switch(client, alice)
    assert (
        await client.post(f"/api/v1/feedback/{feedback['id']}/messages", json={"body": "More details"})
    ).status_code == 409


async def test_staff_roles_and_production_mfa(env):
    app, client, cfg = env
    _, alice = await account(app, client, "alice")
    feedback = await create(client)
    await account(app, client, "moderator", "moderator")
    for path in ("/admin/feedback", "/admin/feedback-assignees", f"/admin/feedback/{feedback['id']}"):
        assert (await client.get("/api/v1" + path)).status_code == 403
    assert (
        await client.post(
            f"/api/v1/admin/feedback/{feedback['id']}/messages", json={"body": "Forbidden reply"}
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/admin/feedback/{feedback['id']}",
            json={"version": 1, "status": "reviewing", "priority": "normal"},
        )
    ).status_code == 403
    assert "feedback_new" not in (await client.get("/api/v1/admin/moderation-dashboard")).json()["queue"]
    admin, _cookies = await account(app, client, "administrator", "admin")
    assert (await client.get("/api/v1/admin/feedback")).status_code == 200
    assert (await client.get("/api/v1/admin/feedback-assignees")).json() == [
        {"id": admin["id"], "username": "administrator", "name": "Administrator"}
    ]
    cfg.environment = "production"
    assert (await client.get("/api/v1/admin/feedback")).status_code == 403
    switch(client, alice)
    assert (await client.get("/api/v1/feedback")).status_code == 200


async def test_filters_literal_search_and_pagination(env):
    app, client, _ = env
    await account(app, client, "alice")
    first = await create(client, title="100% ảnh bị lỗi")
    await create(client, kind="feature", title="Thêm chế độ ban ngày")
    assert (await client.get("/api/v1/feedback?kind=feature")).json()["total"] == 1
    assert (await client.get("/api/v1/feedback?status=resolved")).json()["total"] == 0
    await account(app, client, "owner", "owner")
    result = (await client.get("/api/v1/admin/feedback?page_size=1")).json()
    assert result["total"] == 2 and len(result["items"]) == 1
    page2 = (await client.get("/api/v1/admin/feedback?page_size=1&page=2")).json()
    assert page2["items"][0]["id"] != result["items"][0]["id"]
    assert (await client.get("/api/v1/admin/feedback", params={"q": "%"})).json()["total"] == 1
    assert (await client.get("/api/v1/admin/feedback", params={"q": first["code"].lower()})).json()["items"][
        0
    ]["id"] == first["id"]
    for query in ("status=invalid", "kind=invalid", "page=0", "page_size=51", "page=50001"):
        assert (await client.get("/api/v1/admin/feedback?" + query)).status_code == 422


async def test_bounded_message_history_filters_internal_before_pagination(env):
    app, client, _ = env
    _user, alice = await account(app, client, "alice")
    feedback = await create(client)
    owner, cookies = await account(app, client, "owner", "owner")
    async with app.state.db() as db:
        for i in range(105):
            db.add(
                FeedbackMessage(
                    feedback_id=feedback["id"],
                    author_id=owner["id"],
                    author_role="admin",
                    body=f"message {i}",
                    internal=i % 2 == 0,
                    created_at=1000 + i,
                )
            )
        await db.commit()
    public = await client.get(
        f"/api/v1/feedback/{feedback['id']}"
    )  # Owner cannot access someone else's personal inbox.
    assert public.status_code == 404
    switch(client, alice)
    public = (await client.get(f"/api/v1/feedback/{feedback['id']}")).json()
    assert public["message_pages"] == public["message_page"] == 2
    assert [m["body"] for m in public["messages"]] == ["message 101", "message 103"]
    first = (await client.get(f"/api/v1/feedback/{feedback['id']}?message_page=1")).json()
    assert len(first["messages"]) == 50 and not any(m["internal"] for m in first["messages"])
    switch(client, cookies)
    internal = (await client.get(f"/api/v1/admin/feedback/{feedback['id']}")).json()
    assert internal["message_pages"] == 3 and len(internal["messages"]) == 5


async def test_create_limit_and_csrf(env):
    app, client, _ = env
    await account(app, client, "alice")
    for i in range(5):
        await create(client, title=f"Feedback number {i}")
    assert (await client.post("/api/v1/feedback", json=PAYLOAD)).status_code == 429
    assert (await client.get("/api/v1/feedback")).json()["total"] == 5
    del client.headers["X-Lumi-Request"]
    assert (await client.post("/api/v1/feedback", json=PAYLOAD)).status_code == 403


async def test_reply_rate_limit(env):
    app, client, _ = env
    await account(app, client, "alice")
    feedback = await create(client)
    for i in range(30):
        assert (
            await client.post(
                f"/api/v1/feedback/{feedback['id']}/messages", json={"body": f"Additional details {i}"}
            )
        ).status_code == 201
    assert (
        await client.post(f"/api/v1/feedback/{feedback['id']}/messages", json={"body": "Too many requests"})
    ).status_code == 429
