from __future__ import annotations

from django.urls import path

from .consumers import RoomConsumer

websocket_urlpatterns = [
    path("ws/rooms/<str:invite_code>/", RoomConsumer.as_asgi()),
]
