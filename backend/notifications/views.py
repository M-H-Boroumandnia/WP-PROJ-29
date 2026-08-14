from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from notifications.serializers import NotificationSerializer
from notifications.services import (
    unread_notification_count,
    visible_notifications,
)
from core.views import (
    SonoraAPIView,
    page,
)


class NotificationsView(SonoraAPIView):
    serializer_class = NotificationSerializer

    def get(self, request: Request) -> Response:
        notices = visible_notifications(request.user)
        payload = page(NotificationSerializer(notices, many=True).data)
        payload["unreadCount"] = unread_notification_count(request.user)
        return Response(payload)


class NotificationUnreadView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        return Response({"unreadCount": unread_notification_count(request.user)})


class NotificationReadView(SonoraAPIView):
    def post(self, request: Request, pk: str | None = None) -> Response:
        qs = request.user.notifications.all()
        if pk:
            qs = qs.filter(pk=pk)
        qs.update(read_at=timezone.now())
        return Response({"ok": True, "unreadCount": unread_notification_count(request.user)})

    def delete(self, request: Request, pk: str) -> Response:
        request.user.notifications.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
