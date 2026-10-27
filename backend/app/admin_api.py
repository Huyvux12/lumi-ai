from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from .billing import apply_payment, matches_invoice, order_status, sepay_transaction_payload
from .admin_dashboard import current_subscribers, dashboard, moderation_dashboard
from .catalog_api import character_view
from .models import (
    Audit,
    Character,
    CharacterAvatar,
    Conversation,
    Order,
    PaymentEvent,
    Plan,
    PlanSettings,
    Promotion,
    Prompt,
    Report,
    Session,
    Subscription,
    Usage,
    User,
    Voice,
    now_ms,
)
from .prompts import ALL_TAGS
from .plan_catalog import PAID_CODES, PLANS, plan_label, plan_rank
from .quotas import admin_usage
from .provider_config import active_llm, cost_totals
from .provider_credentials import credential_metadata
from .schemas import Input, PlanAvailabilityPatch, PlanPatch, PromotionPatch, PromptInput, Reason, UserPatch, VoiceInput
from .voice_catalog import OFFICIAL_VOICES, voice_view
from .security import db_session, fail, require_admin, require_owner, require_staff
from pydantic import Field

router = APIRouter(prefix="/admin")


@router.get("/dashboard")
async def dashboard_view(request: Request, days: int = Query(default=30), user=Depends(require_admin), db=Depends(db_session)):
    if days not in {7, 30, 90}:
        fail("INVALID_PERIOD", "Chọn kỳ 7, 30 hoặc 90 ngày.", 422)
    return await dashboard(db, request.app.state.settings, days)


@router.get("/moderation-dashboard")
async def moderation_dashboard_view(user=Depends(require_staff), db=Depends(db_session)):
    return await moderation_dashboard(db)


def audit(db, user, action, target, details):
    db.add(Audit(actor_id=user.id, action=action, target=target, details=details))


@router.get("/summary")
async def summary(request: Request, user=Depends(require_admin), db=Depends(db_session)):
    at = now_ms()
    paid = await db.scalar(select(func.coalesce(func.sum(Order.amount_vnd), 0)).where(Order.status == "paid"))
    rows = (await db.execute(select(Usage).where(Usage.created_at > at - 30 * 86400000))).scalars().all()
    input_tokens = sum(
        r.provider_usage.get("prompt_tokens", 0) for r in rows if r.kind in {"chat", "admin_test"}
    )
    output_tokens = sum(
        r.provider_usage.get("completion_tokens", 0) for r in rows if r.kind in {"chat", "admin_test"}
    )
    cfg = request.app.state.settings
    costs = await cost_totals(db, at - 30 * 86400000, at + 1)
    keys = await credential_metadata(db, cfg)
    return {
        "users": await db.scalar(select(func.count()).select_from(User)),
        "active_users_7d": await db.scalar(
            select(func.count(func.distinct(Conversation.user_id))).where(
                Conversation.updated_at > at - 7 * 86400000
            )
        ),
        "premium_users": await current_subscribers(db, at, paid=True),
        "revenue_vnd": paid,
        "input_tokens_30d": input_tokens,
        "output_tokens_30d": output_tokens,
        "llm_estimated_usd_30d": costs["usd"],
        "tts_ms_30d": sum(r.secondary for r in rows if r.kind == "tts" and r.status == "committed"),
        "stt_ms_30d": sum(r.amount for r in rows if r.kind == "stt" and r.status == "committed"),
        "requests_released_30d": sum(r.status == "released" for r in rows),
        "providers": {
            "groq": keys["groq"]["configured"],
            "tts": bool(cfg.google_key or cfg.tts_project),
            "sepay": bool(cfg.sepay_secret and cfg.bank_account),
            "sepay_environment": cfg.sepay_environment,
            "demo_llm": cfg.demo_llm,
        },
        "cost_note": "Ước tính LLM theo Qwen 3.8; TTS/STT cần đối chiếu hóa đơn provider. Không phải tổng chi phí thực tế.",
    }


@router.get("/users")
async def users(user=Depends(require_admin), db=Depends(db_session)):
    rows = (await db.execute(select(User).order_by(User.created_at.desc()).limit(200))).scalars()
    return [
        {
            "id": u.id,
            "email": u.email,
            "username": u.username,
            "name": u.name,
            "role": u.role,
            "active": u.active,
            "email_verified": u.email_verified,
            "mfa_enabled": u.mfa_enabled,
            "created_at": u.created_at,
        }
        for u in rows
    ]


@router.get("/users/{ident}/usage")
async def usage(ident: str, user=Depends(require_admin), db=Depends(db_session)):
    if not await db.get(User, ident):
        fail("NOT_FOUND", "Không tìm thấy người dùng.", 404)
    return await admin_usage(db, ident)


@router.patch("/users/{ident}")
async def edit_user(ident: str, body: UserPatch, actor=Depends(require_admin), db=Depends(db_session)):
    target = await db.get(User, ident, with_for_update=True)
    if not target:
        fail("NOT_FOUND", "Không tìm thấy người dùng.", 404)
    if body.role is not None and actor.role != "owner":
        fail("FORBIDDEN", "Chỉ owner có thể cấp quyền.", 403)
    if target.role == "owner" and actor.id != target.id:
        fail("FORBIDDEN", "Không thay đổi tài khoản owner khác.", 403)
    if target.id == actor.id and (body.active is False or body.role not in {None, actor.role}):
        fail("INVALID_ACTION", "Không tự khóa hoặc hạ quyền trong phiên hiện tại.")
    before = {"role": target.role, "active": target.active}
    for key, value in body.model_dump(exclude={"reason"}, exclude_none=True).items():
        setattr(target, key, value)
    await db.execute(delete(Session).where(Session.user_id == target.id))
    audit(
        db,
        actor,
        "user.update",
        ident,
        {"before": before, "after": {"role": target.role, "active": target.active}, "reason": body.reason},
    )
    await db.commit()
    return {"ok": True}


@router.get("/orders")
async def orders(user=Depends(require_admin), db=Depends(db_session)):
    rows = (await db.execute(select(Order).order_by(Order.created_at.desc()).limit(200))).scalars()
    return [
        {
            "id": o.id,
            "user_id": o.user_id,
            "invoice": o.invoice,
            "amount_vnd": o.amount_vnd,
            "status": order_status(o),
            "environment": o.environment,
            "created_at": o.created_at,
        }
        for o in rows
    ]


@router.get("/payments")
async def payments(user=Depends(require_admin), db=Depends(db_session)):
    rows = (
        await db.execute(select(PaymentEvent).order_by(PaymentEvent.created_at.desc()).limit(200))
    ).scalars()
    return [
        {
            "key": p.key,
            "order_id": p.order_id,
            "status": p.status,
            "reason": p.reason,
            "created_at": p.created_at,
        }
        for p in rows
    ]


@router.post("/orders/{ident}/reconcile")
async def reconcile(
    ident: str, body: Reason, request: Request, user=Depends(require_admin), db=Depends(db_session)
):
    order = await db.get(Order, ident)
    if not order:
        fail("NOT_FOUND", "Không tìm thấy đơn.", 404)
    cfg = request.app.state.settings
    if not cfg.sepay_token:
        fail("BILLING_UNAVAILABLE", "Chưa cấu hình API token đối soát.", 503)
    await request.app.state.limiter.check(f"reconcile:{user.id}", 5, 60)
    root = (
        "https://userapi.sepay.vn/v2"
        if cfg.sepay_environment == "live"
        else "https://userapi-sandbox.sepay.vn/v2"
    )
    result = await request.app.state.http.get(
        root + "/transactions",
        headers={"Authorization": f"Bearer {cfg.sepay_token}"},
        params={"q": order.invoice, "transfer_type": "in", "per_page": 100},
    )
    if result.status_code != 200:
        fail("PROVIDER_UNAVAILABLE", "Đối soát tạm gián đoạn.", 502)
    # The bank API and webhook use different field names: translate explicitly, don't mix schemas.
    matched = 0
    for transaction in result.json().get("data", []):
        content = str(transaction.get("transaction_content") or "")
        if not matches_invoice(order.invoice, content):
            continue
        payload = sepay_transaction_payload(transaction)
        applied = await apply_payment(db, cfg, payload)
        matched += applied.status == "applied"
    audit(db, user, "order.reconcile", ident, {"matched": matched, "reason": body.reason})
    await db.commit()
    return {"ok": True, "matched": matched}


@router.get("/plans")
async def plans(user=Depends(require_admin), db=Depends(db_session)):
    settings = {row.code: row for row in (await db.execute(select(PlanSettings))).scalars()}
    rows = (await db.execute(select(Plan).order_by(Plan.created_at.desc()))).scalars().all()
    rows = sorted((p for p in rows if p.code in settings), key=lambda p: plan_rank(p.code))
    return [
        {
            "id": p.id,
            "code": p.code,
            "label": plan_label(p.code),
            "paid": p.code in PAID_CODES,
            "price_vnd": p.price_vnd,
            "quota": p.quota,
            "active": p.active,
            "enabled": settings[p.code].enabled,
            "discount_percent": settings[p.code].discount_percent,
            "promo_codes": settings[p.code].promo_codes,
            "created_at": p.created_at,
        }
        for p in rows
    ]


@router.get("/promotions")
async def promotion_list(user=Depends(require_admin), db=Depends(db_session)):
    rows = (await db.execute(select(Promotion).order_by(Promotion.code))).scalars()
    return [{"code": p.code, "enabled": p.enabled, "updated_at": p.updated_at} for p in rows]


@router.put("/promotions/{code}")
async def update_promotion(
    code: str, body: PromotionPatch, user=Depends(require_admin), db=Depends(db_session)
):
    row = await db.get(Promotion, code, with_for_update=True)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy chương trình.", 404)
    audit(db, user, "promotion.toggle", code, {"before": row.enabled, "after": body.enabled})
    row.enabled, row.updated_at = body.enabled, now_ms()
    await db.commit()
    return {"code": code, "enabled": row.enabled}


@router.put("/plans/{code}/availability")
async def update_availability(
    code: str, body: PlanAvailabilityPatch, user=Depends(require_admin), db=Depends(db_session)
):
    settings = await db.get(PlanSettings, code, with_for_update=True)
    if not settings or (code not in PAID_CODES and (body.discount_percent or body.promo_codes)):
        fail("INVALID_PLAN", "Chỉ áp dụng mã giảm giá cho gói trả phí.", 422)
    before = {key: getattr(settings, key) for key in ("enabled", "discount_percent", "promo_codes")}
    changes = body.model_dump(exclude={"reason"})
    for key, value in changes.items():
        setattr(settings, key, value)
    audit(db, user, "plan.availability", code, {"before": before, "after": changes, "reason": body.reason})
    await db.commit()
    return {"code": code, **changes}


@router.post("/plans/{code}")
async def update_plan(code: str, body: PlanPatch, user=Depends(require_owner), db=Depends(db_session)):
    if code not in PLANS or (code not in PAID_CODES) != (body.price_vnd == 0):
        fail("INVALID_PLAN", "Gói hoặc giá không hợp lệ.")
    old = (
        (await db.execute(select(Plan).where(Plan.code == code, Plan.active.is_(True)).with_for_update()))
        .scalars()
        .all()
    )
    for row in old:
        row.active = False
    await db.flush()
    new = Plan(code=code, price_vnd=body.price_vnd, quota=body.quota.model_dump())
    db.add(new)
    await db.flush()
    audit(
        db,
        user,
        "plan.version",
        new.id,
        {
            "code": code,
            "reason": body.reason,
            "before": [{"id": p.id, "price_vnd": p.price_vnd, "quota": p.quota} for p in old],
            "after": {"price_vnd": new.price_vnd, "quota": new.quota},
        },
    )
    await db.commit()
    return {"id": new.id}


@router.get("/prompts")
async def prompts(user=Depends(require_admin), db=Depends(db_session)):
    rows = (await db.execute(select(Prompt).order_by(Prompt.created_at.desc()).limit(100))).scalars()
    return {
        "tag_catalog": ALL_TAGS,
        "versions": [
            {
                "id": p.id,
                "text": p.text,
                "active_tags": p.active_tags,
                "published": p.published,
                "created_at": p.created_at,
            }
            for p in rows
        ],
    }


@router.post("/prompts")
async def create_prompt(body: PromptInput, user=Depends(require_admin), db=Depends(db_session)):
    if any(tag not in ALL_TAGS for tag in body.active_tags):
        fail("INVALID_TAG", "Có tag giọng nói không được hỗ trợ.")
    row = Prompt(text=body.text, active_tags=list(dict.fromkeys(body.active_tags)))
    db.add(row)
    await db.flush()
    audit(db, user, "prompt.draft", row.id, {"reason": body.reason})
    await db.commit()
    return {"id": row.id}


@router.post("/prompts/{ident}/publish")
async def publish(ident: str, body: Reason, user=Depends(require_admin), db=Depends(db_session)):
    row = await db.get(Prompt, ident)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy phiên bản prompt.", 404)
    previous = (
        (await db.execute(select(Prompt).where(Prompt.published.is_(True)).with_for_update())).scalars().all()
    )
    for other in previous:
        other.published = False
    await db.flush()
    row.published = True
    audit(db, user, "prompt.publish", ident, {"previous": [p.id for p in previous], "reason": body.reason})
    await db.commit()
    return {"ok": True}


@router.get("/voices")
async def voices(user=Depends(require_admin), db=Depends(db_session)):
    return [
        {**voice_view(v), "voice": v.voice, "style": v.style, "enabled": v.enabled}
        for v in (await db.execute(select(Voice).order_by(Voice.name, Voice.id))).scalars()
    ]


@router.get("/voices/options")
async def voice_options(user=Depends(require_admin)):
    # Remapping a preset must not remove its original provider voice from the picker.
    return sorted(OFFICIAL_VOICES)


@router.patch("/voices/{ident}")
async def edit_voice(ident: str, body: VoiceInput, user=Depends(require_admin), db=Depends(db_session)):
    row = await db.get(Voice, ident)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy preset.", 404)
    if body.voice not in OFFICIAL_VOICES:
        fail("INVALID_VOICE", "Chọn một trong 30 giọng Gemini chính thức.")
    before = {**voice_view(row), "style": row.style, "voice": row.voice, "enabled": row.enabled}
    for key, value in body.model_dump(exclude={"reason"}, exclude_unset=True).items():
        setattr(row, key, value)
    audit(db, user, "voice.update", ident, {"before": before, "after": body.model_dump()})
    await db.commit()
    return {"ok": True}


@router.get("/characters")
async def characters(user=Depends(require_staff), db=Depends(db_session)):
    return [
        await character_view(db, c)
        for c in (
            await db.execute(
                select(Character)
                .where((Character.owner_id.is_(None)) | (Character.visibility == "public"))
                .order_by(Character.updated_at.desc())
                .limit(200)
            )
        ).scalars()
    ]


@router.get("/characters/{ident}/preview")
async def preview_character(ident: str, user=Depends(require_staff), db=Depends(db_session)):
    row = await db.get(Character, ident)
    if not row or (row.owner_id and row.visibility != "public"):
        fail("NOT_FOUND", "Không tìm thấy nhân vật trong danh mục quản trị.", 404)
    result = await character_view(db, row)
    if row.data.get("avatar_id"):
        result["image"] = f"/api/v1/admin/avatars/{row.data['avatar_id']}"
    return result


@router.get("/avatars/{ident}")
async def preview_avatar(ident: str, user=Depends(require_staff), db=Depends(db_session)):
    character = await db.scalar(select(Character.id).where(
        Character.data["avatar_id"].as_string() == ident,
        Character.visibility == "public",
    ).limit(1))
    avatar = await db.get(CharacterAvatar, ident) if character else None
    if not avatar:
        fail("NOT_FOUND", "Không tìm thấy ảnh trong danh mục quản trị.", 404)
    return Response(avatar.content, media_type="image/webp")


class ModerationInput(Reason):
    status: str = Field(pattern=r"^(approved|hidden|pending)$")


@router.patch("/characters/{ident}")
async def moderate(ident: str, body: ModerationInput, user=Depends(require_staff), db=Depends(db_session)):
    row = await db.get(Character, ident)
    if not row or (row.owner_id and row.visibility != "public"):
        fail("NOT_FOUND", "Không tìm thấy nhân vật trong danh mục quản trị.", 404)
    audit(
        db,
        user,
        "character.moderate",
        ident,
        {"before": row.status, "after": body.status, "reason": body.reason},
    )
    row.status = body.status
    row.updated_at = now_ms()
    await db.commit()
    return {"ok": True}


@router.get("/reports")
async def reports(user=Depends(require_staff), db=Depends(db_session)):
    return [
        {
            "id": r.id,
            "character_id": r.character_id,
            "reason": r.reason,
            "status": r.status,
            "created_at": r.created_at,
        }
        for r in (await db.execute(select(Report).order_by(Report.created_at.desc()).limit(200))).scalars()
    ]


@router.post("/reports/{ident}/close")
async def close_report(ident: str, body: Reason, user=Depends(require_staff), db=Depends(db_session)):
    row = await db.get(Report, ident)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy báo cáo.", 404)
    row.status = "closed"
    audit(db, user, "report.close", ident, {"reason": body.reason})
    await db.commit()
    return {"ok": True}


@router.get("/audit")
async def audit_log(user=Depends(require_admin), db=Depends(db_session)):
    return [
        {
            "id": a.id,
            "actor_id": a.actor_id,
            "action": a.action,
            "target": a.target,
            "details": a.details,
            "created_at": a.created_at,
        }
        for a in (await db.execute(select(Audit).order_by(Audit.created_at.desc()).limit(200))).scalars()
    ]


from .models import Scene, uid
from .schemas import CharacterInput


class SceneInput(Reason):
    title: str = Field(min_length=2, max_length=120)
    premise: str = Field(min_length=20, max_length=1500)
    hue: int = Field(ge=0, le=360)
    characterIds: list[str] = Field(min_length=1, max_length=10)


@router.get("/scenes")
async def scenes(user=Depends(require_staff), db=Depends(db_session)):
    return [s.data for s in (await db.execute(select(Scene))).scalars()]


@router.post("/scenes")
async def create_scene(body: SceneInput, user=Depends(require_admin), db=Depends(db_session)):
    for ident in body.characterIds:
        c = await db.get(Character, ident)
        if not c or c.visibility != "public" or c.status != "approved":
            fail("INVALID_CHARACTER", "Bối cảnh chỉ dùng nhân vật công khai đã duyệt.")
    ident = "scene-" + uid()
    data = {**body.model_dump(exclude={"reason"}), "id": ident, "creator": user.username}
    db.add(Scene(id=ident, data=data))
    audit(db, user, "scene.create", ident, {"reason": body.reason})
    await db.commit()
    return data


@router.patch("/scenes/{ident}")
async def edit_scene(ident: str, body: SceneInput, user=Depends(require_admin), db=Depends(db_session)):
    row = await db.get(Scene, ident, with_for_update=True)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy bối cảnh.", 404)
    for char_id in body.characterIds:
        c = await db.get(Character, char_id)
        if not c or c.visibility != "public" or c.status != "approved":
            fail("INVALID_CHARACTER", "Bối cảnh chỉ dùng nhân vật công khai đã duyệt.")
    before = row.data
    row.data = {**body.model_dump(exclude={"reason"}), "id": ident, "creator": before["creator"]}
    audit(db, user, "scene.update", ident, {"reason": body.reason, "before": before, "after": row.data})
    await db.commit()
    return row.data


class OfficialInput(CharacterInput):
    reason: str = Field(min_length=3, max_length=500)
    # Avatar attachments are provided by the account-owned character editor only.
    avatar_id: None = None


@router.patch("/catalog/{ident}")
async def edit_official(ident: str, body: OfficialInput, user=Depends(require_admin), db=Depends(db_session)):
    c = await db.get(Character, ident, with_for_update=True)
    if not c or c.owner_id:
        fail("NOT_FOUND", "Không tìm thấy nhân vật chính thức.", 404)
    v = await db.get(Voice, body.voice_id)
    if not v or not v.enabled:
        fail("INVALID_VOICE", "Giọng đọc không khả dụng.")
    before = c.data
    c.data = {**c.data, **body.model_dump(exclude={"visibility", "voice_id", "reason"}, exclude_unset=True)}
    c.voice_id = body.voice_id
    c.updated_at = now_ms()
    audit(db, user, "catalog.update", ident, {"reason": body.reason, "before": before, "after": c.data})
    await db.commit()
    return await character_view(db, c)


@router.post("/orders/{ident}/record-refund")
async def record_refund(ident: str, body: Reason, actor=Depends(require_owner), db=Depends(db_session)):
    order = await db.get(Order, ident, with_for_update=True)
    if not order or order.status != "paid":
        fail("INVALID_ORDER", "Chỉ ghi nhận hoàn tiền cho đơn đã thanh toán.", 409)
    order.status = "refunded"
    sub = (await db.execute(select(Subscription).where(Subscription.order_id == ident))).scalar_one_or_none()
    if sub:
        sub.active = False
    audit(db, actor, "order.refund_recorded", ident, {"reason": body.reason, "amount_vnd": order.amount_vnd})
    await db.commit()
    return {
        "ok": True,
        "message": "Đã ghi nhận hoàn tiền thực hiện bên ngoài và thu hồi kỳ gói tương ứng.",
    }


class PromptTestInput(Input):
    character_id: str = Field(max_length=80)
    text: str = Field(min_length=1, max_length=4000)


@router.post("/prompts/{ident}/test")
async def test_prompt(
    ident: str, body: PromptTestInput, request: Request, user=Depends(require_admin), db=Depends(db_session)
):
    from .providers import generate_reply
    from .quotas import PREMIUM, finish, reserve, usage_lease
    from .catalog_api import accessible_character

    prompt = await db.get(Prompt, ident)
    if not prompt:
        fail("NOT_FOUND", "Không tìm thấy phiên bản prompt.", 404)
    character = await accessible_character(db, body.character_id, user)
    await request.app.state.limiter.check(f"prompt-test:{user.id}", 5, 60)
    usage, _ = await reserve(db, user.id, "admin_test", uid(), 1)
    runtime = await active_llm(db, request.app.state.settings)
    audit(db, user, "prompt.test", ident, {"character_id": character.id})
    await db.commit()
    try:
        async with usage_lease(request.app.state.db, usage.id):
            segments, meta = await generate_reply(
                request.app.state.http,
                request.app.state.settings,
                prompt,
                character,
                None,
                [{"role": "user", "content": body.text}],
                PREMIUM,
                provider=runtime, compatible_client=request.app.state.compatible_http,
            )
        await finish(request.app.state.db, usage.id, success=True, provider_usage=meta)
        return {"segments": [{k: v for k, v in s.items() if k != "tts_text"} for s in segments]}
    except BaseException:
        import asyncio

        await asyncio.shield(finish(request.app.state.db, usage.id, success=False))
        raise
