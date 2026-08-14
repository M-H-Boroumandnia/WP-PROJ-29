from __future__ import annotations

from typing import Any

from rest_framework import serializers

from catalog.models import (
    Like,
    Release,
    Track,
    TrackArtistCredit,
)
from core.services.access import track_lock
from core.services.common import (
    is_early_access_active,
    public_url,
)


class ArtistCreditSerializer(serializers.Serializer):
    artistId = serializers.SerializerMethodField()
    username = serializers.CharField(source="artist.user.username")
    stageName = serializers.CharField(source="artist.stage_name")
    role = serializers.CharField()

    def get_artistId(self, obj: TrackArtistCredit) -> str:
        return str(obj.artist_id)


class TrackSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    releaseId = serializers.CharField(source="release_id")
    coverUrl = serializers.SerializerMethodField()
    artists = serializers.SerializerMethodField()
    releaseTitle = serializers.CharField(source="release.title")
    durationSeconds = serializers.IntegerField(source="duration_seconds")
    isExplicit = serializers.BooleanField(source="is_explicit")
    isGoldEarlyAccess = serializers.SerializerMethodField()
    publicReleaseAt = serializers.DateTimeField(source="release.public_release_at")
    genre = serializers.CharField(source="release.genre")
    streamCount = serializers.IntegerField(source="stream_count")
    uniqueListenerCount = serializers.IntegerField(source="unique_listener_count")
    isPlayableForViewer = serializers.SerializerMethodField()
    lockReason = serializers.SerializerMethodField()
    isLiked = serializers.SerializerMethodField()
    hasAudio = serializers.SerializerMethodField()

    class Meta:
        model = Track
        fields = [
            "id",
            "releaseId",
            "title",
            "coverUrl",
            "artists",
            "releaseTitle",
            "durationSeconds",
            "isExplicit",
            "isGoldEarlyAccess",
            "publicReleaseAt",
            "genre",
            "lyrics",
            "streamCount",
            "uniqueListenerCount",
            "isPlayableForViewer",
            "lockReason",
            "isLiked",
            "hasAudio",
        ]

    def get_coverUrl(self, obj: Track) -> str | None:
        return (
            public_url(self.context.get("request"), obj.release.public_cover_url)
            if self.context.get("request")
            else obj.release.public_cover_url
        )

    def get_hasAudio(self, obj: Track) -> bool:
        return bool(obj.original_audio or obj.processed_audio)

    def get_artists(self, obj: Track) -> list[dict[str, Any]]:
        return ArtistCreditSerializer(obj.credits.select_related("artist__user"), many=True).data

    def get_isGoldEarlyAccess(self, obj: Track) -> bool:
        return is_early_access_active(obj.release)

    def get_lockReason(self, obj: Track) -> str | None:
        user = self.context.get("viewer")
        return track_lock(user, obj) if user and user.is_authenticated else None

    def get_isPlayableForViewer(self, obj: Track) -> bool:
        return self.get_lockReason(obj) is None and obj.processing_state == "ready"

    def get_isLiked(self, obj: Track) -> bool:
        user = self.context.get("viewer")
        return bool(user and Like.objects.filter(user=user, track=obj).exists())


class ReleaseSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    type = serializers.CharField(source="release_type")
    coverUrl = serializers.SerializerMethodField()
    primaryArtist = serializers.SerializerMethodField()
    publicReleaseAt = serializers.DateTimeField(source="public_release_at")
    isEarlyAccess = serializers.SerializerMethodField()
    trackIds = serializers.SerializerMethodField()
    ownerUserId = serializers.CharField(source="owner_id")
    trackCount = serializers.SerializerMethodField()
    isPlayableForViewer = serializers.SerializerMethodField()
    lockReason = serializers.SerializerMethodField()
    tracks = serializers.SerializerMethodField()

    class Meta:
        model = Release
        fields = [
            "id",
            "type",
            "title",
            "coverUrl",
            "primaryArtist",
            "publicReleaseAt",
            "isEarlyAccess",
            "status",
            "trackIds",
            "genre",
            "ownerUserId",
            "trackCount",
            "isPlayableForViewer",
            "lockReason",
            "tracks",
        ]

    def get_coverUrl(self, obj: Release) -> str | None:
        return (
            public_url(self.context.get("request"), obj.public_cover_url)
            if self.context.get("request")
            else obj.public_cover_url
        )

    def get_primaryArtist(self, obj: Release) -> dict[str, Any]:
        profile = obj.owner.artist_profile
        return {
            "artistId": str(profile.id),
            "username": obj.owner.username,
            "stageName": profile.stage_name,
            "role": "primary",
        }

    def get_isEarlyAccess(self, obj: Release) -> bool:
        return is_early_access_active(obj)

    def get_trackIds(self, obj: Release) -> list[str]:
        return [str(track.id) for track in obj.tracks.all()]

    def get_trackCount(self, obj: Release) -> int:
        return obj.tracks.count()

    def get_lockReason(self, obj: Release) -> str | None:
        user = self.context.get("viewer")
        if not user or not user.is_authenticated:
            return None
        first = obj.tracks.first()
        return track_lock(user, first) if first else None

    def get_isPlayableForViewer(self, obj: Release) -> bool:
        return (
            obj.status in {Release.Status.PUBLISHED, Release.Status.SCHEDULED, Release.Status.READY}
            and self.get_lockReason(obj) is None
        )

    def get_tracks(self, obj: Release) -> list[dict[str, Any]]:
        if self.context.get("slim"):
            return []
        return TrackSerializer(obj.tracks.all(), many=True, context=self.context).data
