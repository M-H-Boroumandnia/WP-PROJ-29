from __future__ import annotations

from collections import defaultdict

from django.utils import timezone

from accounts.models import User
from notifications.models import Notification
from support.models import AuditEvent


def create_audit(
    actor: User | None,
    action: str,
    target: object,
    before: object | None,
    after: object | None,
    request_id: str,
) -> AuditEvent:
    return AuditEvent.objects.create(
        actor=actor,
        action=action,
        target=str(target),
        before=before,
        after=after,
        request_id=request_id,
    )


def create_notification(
    user: User,
    title: str,
    body: str,
    kind: str = Notification.Kind.IMPORTANT,
    title_key: str = "",
    body_key: str = "",
    values: dict | None = None,
) -> Notification:
    return Notification.objects.create(
        user=user,
        title=title,
        body=body,
        kind=kind,
        title_key=title_key,
        body_key=body_key,
        values=values or {},
    )


def notify_staff(
    title: str,
    body: str,
    *,
    kind: str = Notification.Kind.IMPORTANT,
    title_key: str = "",
    body_key: str = "",
    values: dict | None = None,
) -> list[Notification]:
    staff = User.objects.filter(
        kind__in={User.Kind.SUPPORT, User.Kind.ADMIN},
        deleted_at__isnull=True,
        is_active=True,
    )
    return [
        create_notification(
            user,
            title,
            body,
            kind=kind,
            title_key=title_key,
            body_key=body_key,
            values=values,
        )
        for user in staff
    ]


def visible_notifications(user: User) -> list[Notification]:
    notices = list(user.notifications.all().order_by("-created_at"))
    pref = user.notification_preference

    if pref == User.NotificationPreference.MUTED:
        return [n for n in notices if n.kind == Notification.Kind.CRITICAL]
    if pref == User.NotificationPreference.IMPORTANT_ONLY:
        return [
            n
            for n in notices
            if n.kind in {Notification.Kind.CRITICAL, Notification.Kind.IMPORTANT}
        ]
    if pref != User.NotificationPreference.MAX_FIVE_DAILY:
        return notices

    visible: list[Notification] = []
    daily: dict[str, int] = defaultdict(int)
    overflow: dict[str, int] = defaultdict(int)
    for notice in notices:
        if notice.kind == Notification.Kind.CRITICAL:
            visible.append(notice)
            continue
        day = notice.created_at.date().isoformat()
        if daily[day] < 5:
            visible.append(notice)
            daily[day] += 1
        else:
            overflow[day] += 1
    for day, count in overflow.items():
        digest = Notification(
            user=user,
            title="Daily notification digest",
            body=f"{count} additional updates are collected in this digest.",
            title_key="noticeDigestTitle",
            body_key="noticeDigestBody",
            values={"count": count},
            kind=Notification.Kind.IMPORTANT,
            created_at=timezone.make_aware(timezone.datetime.fromisoformat(day)),
        )
        visible.append(digest)
    return sorted(visible, key=lambda n: n.created_at, reverse=True)


def unread_notification_count(user: User) -> int:
    return sum(1 for notice in visible_notifications(user) if notice.pk and notice.read_at is None)
