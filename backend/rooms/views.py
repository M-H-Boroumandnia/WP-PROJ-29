from __future__ import annotations

from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from core.exceptions import SonoraError
from accounts.models import User
from catalog.models import Track
from rooms.models import (
    ListeningRoom,
    RoomParticipant,
)
from rooms.serializers import RoomSerializer
from rooms.services import (
    add_track_to_room,
    create_room,
    join_room,
    leave_room,
)
from core.views import SonoraAPIView


class RoomsView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request) -> Response:
        room = create_room(request.user)
        return Response(
            RoomSerializer(room, context={"request": request}).data, status=status.HTTP_201_CREATED
        )


class RoomJoinView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, invite_code: str) -> Response:
        room = join_room(request.user, invite_code)
        return Response(RoomSerializer(room, context={"request": request}).data)


class RoomDetailView(SonoraAPIView):
    serializer_class = RoomSerializer

    def get(self, request: Request, invite_code: str) -> Response:
        room = get_object_or_404(ListeningRoom, invite_code=invite_code)
        if not room.participants.filter(user=request.user, left_at__isnull=True).exists():
            raise SonoraError(
                "forbidden", "Join the room before reading its state.", status.HTTP_403_FORBIDDEN
            )
        return Response(RoomSerializer(room, context={"request": request}).data)


class RoomLeaveView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, pk: str) -> Response:
        room = get_object_or_404(ListeningRoom, pk=pk)
        return Response(
            RoomSerializer(leave_room(request.user, room), context={"request": request}).data
        )


class RoomTransferHostView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, pk: str) -> Response:
        room = get_object_or_404(ListeningRoom, pk=pk, host=request.user)
        target = get_object_or_404(User, pk=request.data.get("userId"))
        participant = get_object_or_404(
            RoomParticipant, room=room, user=target, left_at__isnull=True
        )
        room.host = target
        room.save(update_fields=["host", "updated_at"])
        participant.can_control = True
        participant.save(update_fields=["can_control", "updated_at"])
        return Response(RoomSerializer(room, context={"request": request}).data)


class RoomPermissionsView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, pk: str, user_id: str) -> Response:
        room = get_object_or_404(ListeningRoom, pk=pk, host=request.user)
        participant = get_object_or_404(
            RoomParticipant, room=room, user_id=user_id, left_at__isnull=True
        )
        participant.can_control = bool(request.data.get("canControl", True))
        participant.save(update_fields=["can_control", "updated_at"])
        return Response(RoomSerializer(room, context={"request": request}).data)


class RoomQueueView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, pk: str) -> Response:
        room = get_object_or_404(ListeningRoom, pk=pk)
        track = get_object_or_404(Track, pk=request.data.get("trackId"))
        add_track_to_room(request.user, room, track)
        return Response(RoomSerializer(room, context={"request": request}).data)
