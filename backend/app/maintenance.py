"""Lease recovery and conservative cleanup of database-backed media."""

from sqlalchemy import delete, select
from .avatars import UNATTACHED_TTL_MS, avatar_referenced
from .models import AudioJob, AuthToken, CharacterAvatar, Message, Session, Usage, now_ms
from .security import lock_user

ORPHAN_GRACE_MS = 300000


async def recover_interrupted(factory):
    # The supported deployment has one API worker. No stream survives a restart.
    async with factory() as db:
        messages = (await db.execute(select(Message).where(Message.status == "generating"))).scalars().all()
        jobs = (await db.execute(select(AudioJob).where(AudioJob.status == "streaming"))).scalars().all()
        pending = (await db.execute(select(AudioJob).where(AudioJob.status == "pending"))).scalars().all()
        resumable = {j.usage_id for j in pending if j.expires_at > now_ms()}
        for usage in (await db.execute(select(Usage).where(Usage.status == "reserved"))).scalars():
            if usage.id not in resumable or usage.expires_at <= now_ms():
                usage.status = "released"
                for job in pending:
                    if job.usage_id == usage.id:
                        job.status = "failed"
        for row in messages + jobs:
            row.status = "failed"
        await db.commit()


async def cleanup_once(app):
    factory, at = app.state.db, now_ms()
    for name in ("chat_tasks", "audio_tasks"):
        tasks = getattr(app.state, name, {})
        for ident, task in list(tasks.items()):
            if task.done():
                tasks.pop(ident, None)
    async with factory() as db:
        await db.execute(delete(Session).where(Session.expires_at <= at))
        await db.execute(delete(AuthToken).where(AuthToken.expires_at <= at))
        expired = (
            (
                await db.execute(
                    select(Usage).where(Usage.status == "reserved", Usage.expires_at <= at).with_for_update()
                )
            )
            .scalars()
            .all()
        )
        for usage in expired:
            usage.status = "released"
            if usage.kind == "chat":
                message = await db.scalar(
                    select(Message).where(
                        Message.request_key == f"{usage.user_id}:{usage.request_key}",
                        Message.status == "generating",
                    )
                )
                if message:
                    message.status = "failed"
            for job in (
                await db.execute(
                    select(AudioJob).where(
                        AudioJob.usage_id == usage.id, AudioJob.status.in_(["pending", "streaming"])
                    )
                )
            ).scalars():
                job.status = "failed"
        await db.execute(delete(AudioJob).where(AudioJob.expires_at <= at))
        await db.commit()
    # Recheck each old candidate instead of trusting a snapshot taken before file creation.
    for path in (app.state.settings.data_dir / "audio").iterdir():
        if path.suffix not in {".pcm", ".part"}:
            continue
        try:
            if path.stat().st_mtime * 1000 > at - ORPHAN_GRACE_MS:
                continue
            async with factory() as db:
                job = await db.get(AudioJob, path.stem)
                if job and job.expires_at > now_ms():
                    continue
                path.unlink(missing_ok=True)
        except FileNotFoundError:
            pass
    async with factory() as db:
        owners = (
            (
                await db.execute(
                    select(CharacterAvatar.owner_id)
                    .where(CharacterAvatar.created_at <= at - UNATTACHED_TTL_MS)
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
    for owner_id in owners:
        async with factory() as db:
            await lock_user(db, owner_id)
            await db.execute(
                delete(CharacterAvatar).where(
                    CharacterAvatar.owner_id == owner_id,
                    CharacterAvatar.created_at <= at - UNATTACHED_TTL_MS,
                    ~avatar_referenced(),
                )
            )
            await db.commit()
