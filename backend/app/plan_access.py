"""Live plan availability, independent of immutable quota/price versions."""

from .models import PlanSettings
from .security import fail

FREE_CLOSED_MESSAGE = "hiện sever quá tải vui lòng đăng kí gói cao cấp hơn"
PREMIUM_CLOSED_MESSAGE = "Gói Premium hiện chưa mở đăng ký. Vui lòng chờ mở lại."
PLAN_REQUIRED_MESSAGE = "Hoàn tất thanh toán Premium để sử dụng tính năng."


def closed_message(code):
    return FREE_CLOSED_MESSAGE if code == "free" else PREMIUM_CLOSED_MESSAGE


async def require_plan_open(db, code):
    settings = await db.get(PlanSettings, code)
    if not settings or not settings.enabled:
        fail("PLAN_CLOSED", closed_message(code), 403)
    return settings


async def access_view(db, user, plan):
    code = plan.code if plan else user.signup_plan
    settings = await db.get(PlanSettings, code)
    enabled = bool(settings and settings.enabled)
    return {
        "signup_plan": user.signup_plan,
        "has_plan": plan is not None,
        "plan_enabled": enabled,
        "can_use_features": plan is not None and enabled,
        "plan_message": closed_message(code)
        if not enabled
        else (PLAN_REQUIRED_MESSAGE if not plan else None),
    }
