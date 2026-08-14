from __future__ import annotations

from django.urls import path

from notifications.views import (
    NotificationReadView,
    NotificationsView,
    NotificationUnreadView,
)

urlpatterns = [
    path("notifications/", NotificationsView.as_view(), name="notifications"),
    path(
        "notifications/unread-count/",
        NotificationUnreadView.as_view(),
        name="notifications-unread-count",
    ),
    path(
        "notifications/mark-all-read/",
        NotificationReadView.as_view(),
        name="notifications-read-all",
    ),
    path(
        "notifications/<uuid:pk>/read/",
        NotificationReadView.as_view(),
        name="notification-read",
    ),
    path(
        "notifications/<uuid:pk>/",
        NotificationReadView.as_view(),
        name="notification-delete",
    ),
]
