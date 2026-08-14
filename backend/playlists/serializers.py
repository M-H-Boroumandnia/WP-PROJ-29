from __future__ import annotations

from typing import Any

from rest_framework import serializers

from playlists.models import Playlist
from accounts.serializers import PublicProfileSerializer
from catalog.serializers import TrackSerializer
from core.services.common import public_url


class PlaylistSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    owner = serializers.SerializerMethodField()
    coverUrl = serializers.SerializerMethodField()
    generatedCover = serializers.BooleanField(source="generated_cover")
    tracks = serializers.SerializerMethodField()
    isSaved = serializers.SerializerMethodField()
    canEdit = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at")
    updatedAt = serializers.DateTimeField(source="updated_at")
    trackIds = serializers.SerializerMethodField()
    ownerId = serializers.CharField(source="owner_id")

    class Meta:
        model = Playlist
        fields = [
            "id",
            "owner",
            "ownerId",
            "title",
            "description",
            "visibility",
            "coverUrl",
            "generatedCover",
            "tracks",
            "trackIds",
            "isSaved",
            "canEdit",
            "createdAt",
            "updatedAt",
        ]

    def get_owner(self, obj: Playlist) -> dict[str, Any]:
        return PublicProfileSerializer(obj.owner, context=self.context).data

    def get_coverUrl(self, obj: Playlist) -> str | None:
        return public_url(self.context.get("request"), obj.cover.url if obj.cover else None)

    def get_tracks(self, obj: Playlist) -> list[dict[str, Any]]:
        if self.context.get("slim"):
            return []
        tracks = [
            item.track
            for item in obj.items.select_related("track__release").prefetch_related(
                "track__credits__artist__user"
            )
        ]
        return TrackSerializer(tracks, many=True, context=self.context).data

    def get_trackIds(self, obj: Playlist) -> list[str]:
        return [str(item.track_id) for item in obj.items.all()]

    def get_isSaved(self, obj: Playlist) -> bool:
        user = self.context.get("viewer")
        return bool(user and user.saved_playlists.filter(playlist=obj).exists())

    def get_canEdit(self, obj: Playlist) -> bool:
        user = self.context.get("viewer")
        return bool(user and obj.owner_id == user.id)
