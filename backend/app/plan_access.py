"""Live plan availability, independent of immutable quota/price versions.

Closing a plan only stops new sign-ups to it. Closing Free puts new accounts on a
waitlist; existing free users and paying subscribers keep working.
"""

from .models import PlanSettings
from .plan_catalog import plan_label
from .security import fail

WAITLIST_MESSAGE = (
    "Lumi đang đông người dùng mới nên tài khoản miễn phí đang xếp hàng. "
    "Bạn sẽ dùng được ngay khi có chỗ, hoặc chọn một gói trả phí để bắt đầu luôn."
)


def closed_message(code):
    return f"Gói {plan_label(code)} tạm hết chỗ. Vui lòng quay lại sau hoặc chọn gói khác."


async def plan_open(db, code):
    settings = await db.get(PlanSettings, code)
    return bool(settings and settings.enabled)


async def require_plan_open(db, code):
    settings = await db.get(PlanSettings, code)
    if not settings or not settings.enabled:
        fail("PLAN_CLOSED", closed_message(code), 403)
    return settings


async def waiting(db, user, plan):
    """A waitlisted account stays on hold only while it has no paid period and Free is closed."""
    return bool(user.waitlisted) and plan.code == "free" and not await plan_open(db, "free")


async def access_view(db, user, plan):
    held = await waiting(db, user, plan)
    return {
        "signup_plan": user.signup_plan,
        "has_plan": plan is not None,
        "plan_enabled": not held,
        "can_use_features": not held,
        "waitlisted": held,
        "plan_message": WAITLIST_MESSAGE if held else None,
    }
