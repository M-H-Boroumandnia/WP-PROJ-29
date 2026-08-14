from __future__ import annotations

from django.urls import path

from rooms.views import (
    RoomDetailView,
    RoomJoinView,
    RoomLeaveView,
    RoomPermissionsView,
    RoomQueueView,
    RoomsView,
    RoomTransferHostView,
)

urlpatterns = [
    path("rooms/", RoomsView.as_view(), name="rooms"),
    path("rooms/<str:invite_code>/join/", RoomJoinView.as_view(), name="room-join"),
    path("rooms/<str:invite_code>/", RoomDetailView.as_view(), name="room-detail"),
    path("rooms/<uuid:pk>/leave/", RoomLeaveView.as_view(), name="room-leave"),
    path(
        "rooms/<uuid:pk>/transfer-host/",
        RoomTransferHostView.as_view(),
        name="room-transfer-host",
    ),
    path(
        "rooms/<uuid:pk>/participants/<uuid:user_id>/permissions/",
        RoomPermissionsView.as_view(),
        name="room-permissions",
    ),
    path("rooms/<uuid:pk>/queue/", RoomQueueView.as_view(), name="room-queue"),
]
