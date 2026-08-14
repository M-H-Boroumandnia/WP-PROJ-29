from __future__ import annotations

from typing import Any

from rest_framework import serializers

from catalog.models import PlayerQueue
from rooms.models import (
    ListeningRoom,
    RoomParticipant,
)
from core.services.common import public_url
from rooms.services import participant_access_state


class RoomParticipantSerializer(serializers.ModelSerializer):
    userId = serializers.CharField(source="user_id")
    displayName = serializers.CharField(source="user.display_name")
    avatarUrl = serializers.SerializerMethodField()
    joinedAt = serializers.DateTimeField(source="joined_at")
    isHost = serializers.SerializerMethodField()
    canControl = serializers.BooleanField(source="can_control")
    accessState = serializers.SerializerMethodField()

    class Meta:
        model = RoomParticipant
        fields = [
            "userId",
            "displayName",
            "avatarUrl",
            "joinedAt",
            "isHost",
            "canControl",
            "accessState",
        ]

    def get_avatarUrl(self, obj: RoomParticipant) -> str | None:
        return public_url(self.context.get("request"), obj.user.public_avatar_url)

    def get_isHost(self, obj: RoomParticipant) -> bool:
        return obj.room.host_id == obj.user_id

    def get_accessState(self, obj: RoomParticipant) -> str:
        track = obj.room.current_queue_item.track if obj.room.current_queue_item else None
        return participant_access_state(obj.user, track)


class RoomSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    inviteCode = serializers.CharField(source="invite_code")
    hostUserId = serializers.CharField(source="host_id")
    queue = serializers.SerializerMethodField()
    currentQueueItemId = serializers.CharField(source="current_queue_item_id", allow_null=True)
    positionSeconds = serializers.FloatField(source="position_seconds")
    isPlaying = serializers.BooleanField(source="is_playing")
    repeatMode = serializers.CharField(source="repeat_mode")
    shuffleEnabled = serializers.BooleanField(source="shuffle_enabled")
    participants = serializers.SerializerMethodField()
    updatedAt = serializers.DateTimeField(source="updated_at")

    class Meta:
        model = ListeningRoom
        fields = [
            "id",
            "inviteCode",
            "hostUserId",
            "status",
            "queue",
            "currentQueueItemId",
            "positionSeconds",
            "isPlaying",
            "repeatMode",
            "shuffleEnabled",
            "participants",
            "updatedAt",
        ]

    def get_queue(self, obj: ListeningRoom) -> list[dict[str, Any]]:
        return [
            {
                "id": str(item.id),
                "trackId": str(item.track_id),
                "addedByUserId": str(item.added_by_id),
                "addedAt": item.created_at.isoformat(),
            }
            for item in obj.queue_items.all()
        ]

    def get_participants(self, obj: ListeningRoom) -> list[dict[str, Any]]:
        return RoomParticipantSerializer(
            obj.participants.filter(left_at__isnull=True).select_related("user"),
            many=True,
            context=self.context,
        ).data


class PlayerQueueSerializer(serializers.Serializer):
    trackIds = serializers.ListField(child=serializers.CharField(), required=False)
    currentIndex = serializers.IntegerField(required=False)
    repeatMode = serializers.ChoiceField(choices=["off", "all", "one"], required=False)
    shuffleEnabled = serializers.BooleanField(required=False)
    volume = serializers.FloatField(min_value=0.0, max_value=1.0, required=False)

    def to_representation(self, instance: PlayerQueue) -> dict[str, Any]:
        return {
            "trackIds": list(instance.track_ids or []),
            "currentIndex": instance.current_index,
            "repeatMode": instance.repeat_mode
            if instance.repeat_mode in {"off", "all", "one"}
            else "off",
            "shuffleEnabled": bool(instance.shuffle_enabled),
            "volume": float(instance.volume),
        }
