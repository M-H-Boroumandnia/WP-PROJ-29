from __future__ import annotations

import secrets

from django.db import transaction
from rest_framework import status

from core.exceptions import SonoraError
from accounts.models import User
from billing.models import Subscription
from catalog.models import Track
from rooms.models import (
    ListeningRoom,
    RoomParticipant,
    RoomQueueItem,
)
from core.services.access import active_subscription, track_lock
from core.services.common import now_utc


def room_invite_code() -> str:
    for _ in range(20):
        code = secrets.token_urlsafe(6).replace("_", "").replace("-", "")[:8].upper()
        if not ListeningRoom.objects.filter(invite_code=code).exists():
            return code
    raise SonoraError("room_code_failed", "Could not create a room invite.")


def can_use_room(user: User) -> bool:
    return active_subscription(user).tier in {Subscription.Tier.SILVER, Subscription.Tier.GOLD}


def ensure_room_access(user: User) -> None:
    if not can_use_room(user):
        raise SonoraError(
            "room_entitlement",
            "Group Listening requires Silver or Gold.",
            status.HTTP_403_FORBIDDEN,
        )


@transaction.atomic
def create_room(user: User) -> ListeningRoom:
    ensure_room_access(user)
    room = ListeningRoom.objects.create(invite_code=room_invite_code(), host=user)
    RoomParticipant.objects.create(room=room, user=user, can_control=True)
    return room


@transaction.atomic
def join_room(user: User, invite_code: str) -> ListeningRoom:
    ensure_room_access(user)
    room = ListeningRoom.objects.select_for_update().get(
        invite_code=invite_code, status=ListeningRoom.Status.ACTIVE
    )
    active_count = room.participants.filter(left_at__isnull=True).count()
    if (
        active_count >= 10
        and not room.participants.filter(user=user, left_at__isnull=True).exists()
    ):
        raise SonoraError("room_full", "This room is full.", status.HTTP_409_CONFLICT)
    participant, _ = RoomParticipant.objects.get_or_create(
        room=room, user=user, defaults={"can_control": False}
    )
    participant.left_at = None
    participant.last_activity_at = now_utc()
    participant.save(update_fields=["left_at", "last_activity_at", "updated_at"])
    return room


@transaction.atomic
def leave_room(user: User, room: ListeningRoom) -> ListeningRoom:
    participant = room.participants.filter(user=user, left_at__isnull=True).first()
    if not participant:
        return room
    participant.left_at = now_utc()
    participant.save(update_fields=["left_at", "updated_at"])
    active = list(room.participants.filter(left_at__isnull=True).order_by("joined_at"))
    update_fields = ["updated_at"]
    if active and room.host_id == user.id:
        room.host = active[0].user
        update_fields.append("host")
        active[0].can_control = True
        active[0].save(update_fields=["can_control", "updated_at"])
    room.save(update_fields=update_fields)
    return room


def room_controller(user: User, room: ListeningRoom) -> bool:
    return (
        room.host_id == user.id
        or room.participants.filter(user=user, left_at__isnull=True, can_control=True).exists()
    )


def add_track_to_room(user: User, room: ListeningRoom, track: Track) -> RoomQueueItem:
    if not room_controller(user, room):
        raise SonoraError(
            "room_control_required", "Controller permission is required.", status.HTTP_403_FORBIDDEN
        )
    lock = track_lock(user, track)
    if lock:
        raise SonoraError(
            lock, "You cannot add a track you cannot access.", status.HTTP_403_FORBIDDEN
        )
    position = room.queue_items.count()
    item = RoomQueueItem.objects.create(room=room, track=track, added_by=user, position=position)
    if not room.current_queue_item:
        room.current_queue_item = item
        room.save(update_fields=["current_queue_item", "updated_at"])
    return item


def participant_access_state(user: User, track: Track | None) -> str:
    if not track:
        return "playable"
    lock = track_lock(user, track)
    return {
        "gold_required": "tier_locked",
        "explicit_restricted": "explicit_locked",
        "daily_stream_limit": "tier_locked",
    }.get(lock or "", "playable")
