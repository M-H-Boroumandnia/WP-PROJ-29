from __future__ import annotations

from urllib.parse import parse_qs

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from .exceptions import SonoraError
from .models import ListeningRoom, RoomParticipant, Track, User
from .serializers import RoomSerializer
from .services import add_track_to_room, join_room, leave_room, room_controller, track_lock


@sync_to_async
def user_from_token(token: str | None) -> User | AnonymousUser:
    if not token:
        return AnonymousUser()
    try:
        access = AccessToken(token)
        return User.objects.get(id=access["user_id"], deleted_at__isnull=True)
    except Exception:
        return AnonymousUser()


@sync_to_async
def room_state(invite_code: str) -> dict:
    room = ListeningRoom.objects.select_related("host", "current_queue_item__track").get(invite_code=invite_code)
    return RoomSerializer(room, context={}).data


@sync_to_async
def can_read_room(user: User, invite_code: str) -> bool:
    return ListeningRoom.objects.filter(invite_code=invite_code, participants__user=user, participants__left_at__isnull=True).exists()


@sync_to_async
def mutate_room(user: User, invite_code: str, action: str, payload: dict) -> str:
    with transaction.atomic():
        room = ListeningRoom.objects.select_for_update().get(invite_code=invite_code, status=ListeningRoom.Status.ACTIVE)
        participant = RoomParticipant.objects.select_for_update().filter(room=room, user=user, left_at__isnull=True).first()
        if not participant:
            raise SonoraError("room_membership_required", "Join the room before controlling it.")
        participant.last_activity_at = timezone.now()
        participant.save(update_fields=["last_activity_at", "updated_at"])
        if action == "reaction":
            return "reaction"
        if not room_controller(user, room):
            raise SonoraError("room_control_required", "Controller permission is required.")
        if action == "play":
            room.is_playing = True
        elif action == "pause":
            room.is_playing = False
        elif action == "seek":
            room.position_seconds = max(0, float(payload.get("positionSeconds", 0)))
        elif action == "repeat_changed":
            mode = payload.get("repeatMode", "off")
            if mode not in {"off", "all", "one"}:
                raise SonoraError("repeat_invalid", "Repeat mode is invalid.")
            room.repeat_mode = mode
        elif action == "shuffle_changed":
            room.shuffle_enabled = bool(payload.get("shuffleEnabled", False))
        elif action == "track_changed":
            item_id = payload.get("queueItemId")
            item = room.queue_items.filter(id=item_id).first()
            if not item:
                raise SonoraError("queue_item_missing", "Queue item was not found.")
            room.current_queue_item = item
            room.position_seconds = 0
        elif action == "queue_add":
            track = Track.objects.get(id=payload.get("trackId"))
            lock = track_lock(user, track)
            if lock:
                raise SonoraError(lock, "You cannot add a track you cannot access.")
            add_track_to_room(user, room, track)
            return "queue_changed"
        elif action == "participant_permissions_changed":
            if room.host_id != user.id:
                raise SonoraError("host_required", "Only the host can change controller permissions.")
            target = RoomParticipant.objects.get(room=room, user_id=payload.get("userId"), left_at__isnull=True)
            target.can_control = bool(payload.get("canControl", True))
            target.save(update_fields=["can_control", "updated_at"])
            return "participant_permissions_changed"
        elif action == "host_changed":
            if room.host_id != user.id:
                raise SonoraError("host_required", "Only the host can transfer ownership.")
            target = RoomParticipant.objects.get(room=room, user_id=payload.get("userId"), left_at__isnull=True)
            room.host = target.user
            room.save(update_fields=["host", "updated_at"])
            target.can_control = True
            target.save(update_fields=["can_control", "updated_at"])
            return "host_changed"
        else:
            raise SonoraError("room_event_invalid", "Room event is invalid.")
        room.save()
        return action


class RoomConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self) -> None:
        self.invite_code = self.scope["url_route"]["kwargs"]["invite_code"]
        query = parse_qs(self.scope.get("query_string", b"").decode())
        token = (query.get("token") or [None])[0]
        self.user = self.scope.get("user")
        if not self.user or not self.user.is_authenticated:
            self.user = await user_from_token(token)
        if not self.user or not self.user.is_authenticated:
            await self.close(code=4401)
            return
        try:
            await sync_to_async(join_room)(self.user, self.invite_code)
        except Exception:
            await self.close(code=4403)
            return
        self.group_name = f"sonora_room_{self.invite_code}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.broadcast_state("participant_joined")

    async def disconnect(self, code: int) -> None:
        if hasattr(self, "group_name"):
            try:
                room = await sync_to_async(ListeningRoom.objects.get)(invite_code=self.invite_code)
                await sync_to_async(leave_room)(self.user, room)
                await self.broadcast_state("participant_left")
            finally:
                await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content: dict, **kwargs) -> None:
        action = content.get("type")
        payload = content.get("payload") or {}
        try:
            emitted = await mutate_room(self.user, self.invite_code, action, payload)
            if emitted == "reaction":
                await self.channel_layer.group_send(self.group_name, {"type": "room.event", "event": {"type": "reaction", "userId": str(self.user.id), "payload": payload}})
            else:
                await self.broadcast_state(emitted)
        except SonoraError as exc:
            await self.send_json({"type": "error", "error": {"code": exc.code, "message": str(exc)}})
        except Exception:
            await self.send_json({"type": "error", "error": {"code": "room_error", "message": "Room event failed."}})

    async def broadcast_state(self, event_type: str = "room_state") -> None:
        state = await room_state(self.invite_code)
        await self.channel_layer.group_send(self.group_name, {"type": "room.event", "event": {"type": event_type, "room": state}})

    async def room_event(self, event: dict) -> None:
        await self.send_json(event["event"])
