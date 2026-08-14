from __future__ import annotations

from typing import Any

from rest_framework import serializers

from accounts.models import (
    ArtistProfile,
    User,
)
from playlists.models import Playlist
from core.services.access import active_subscription
from core.services.common import public_url


class PublicProfileSerializer(serializers.Serializer):
    id = serializers.CharField()
    username = serializers.CharField()
    displayName = serializers.SerializerMethodField()
    avatarUrl = serializers.SerializerMethodField()
    kind = serializers.SerializerMethodField()
    followerCount = serializers.SerializerMethodField()
    followingCount = serializers.SerializerMethodField()
    isFollowing = serializers.SerializerMethodField()
    publicPlaylistCount = serializers.SerializerMethodField()

    def get_displayName(self, obj: User) -> str:
        profile = getattr(obj, "artist_profile", None)
        return profile.stage_name if profile else obj.display_name

    def get_avatarUrl(self, obj: User) -> str | None:
        return (
            public_url(self.context.get("request"), obj.public_avatar_url)
            if self.context.get("request")
            else obj.public_avatar_url
        )

    def get_kind(self, obj: User) -> str:
        return "artist" if hasattr(obj, "artist_profile") else "consumer"

    def get_followerCount(self, obj: User) -> int:
        return obj.follower_edges.count()

    def get_followingCount(self, obj: User) -> int:
        return obj.following_edges.count()

    def get_isFollowing(self, obj: User) -> bool:
        viewer = self.context.get("viewer")
        return bool(viewer and viewer.following_edges.filter(target=obj).exists())

    def get_publicPlaylistCount(self, obj: User) -> int:
        return obj.playlists.filter(visibility=Playlist.Visibility.PUBLIC).count()


class ArtistOwnerSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    stageName = serializers.CharField(source="stage_name")
    verifiedAt = serializers.DateTimeField(source="verified_at", allow_null=True)

    class Meta:
        model = ArtistProfile
        fields = ["id", "stageName", "bio", "verifiedAt", "genre"]


class ActiveSubscriptionSerializer(serializers.Serializer):
    id = serializers.CharField()
    tier = serializers.CharField()
    status = serializers.CharField()
    startsAt = serializers.DateTimeField(source="starts_at")
    expiresAt = serializers.DateTimeField(source="expires_at", allow_null=True)
    canUpgradeToGold = serializers.BooleanField(source="can_upgrade_to_gold")


class MeSerializer(serializers.Serializer):
    """Slim session identity used by /me/, login, and tokens."""

    id = serializers.CharField()
    username = serializers.CharField()
    displayName = serializers.SerializerMethodField()
    avatarUrl = serializers.SerializerMethodField()
    kind = serializers.CharField()
    locale = serializers.CharField()
    timezone = serializers.CharField()
    theme = serializers.CharField()
    explicitContentEnabled = serializers.BooleanField(source="explicit_content_enabled")
    birthDate = serializers.DateField(source="birth_date")
    subscription = serializers.SerializerMethodField()
    artistProfile = serializers.SerializerMethodField()

    def get_displayName(self, obj: User) -> str:
        profile = getattr(obj, "artist_profile", None)
        return profile.stage_name if profile else obj.display_name

    def get_avatarUrl(self, obj: User) -> str | None:
        return (
            public_url(self.context.get("request"), obj.public_avatar_url)
            if self.context.get("request")
            else obj.public_avatar_url
        )

    def get_subscription(self, obj: User) -> dict[str, Any]:
        return ActiveSubscriptionSerializer(active_subscription(obj)).data

    def get_artistProfile(self, obj: User) -> dict[str, Any] | None:
        profile = getattr(obj, "artist_profile", None)
        return ArtistOwnerSerializer(profile).data if profile else None


class MePreferencesSerializer(MeSerializer):
    email = serializers.EmailField()
    gender = serializers.CharField(allow_null=True)
    notificationPreference = serializers.CharField(source="notification_preference")
    usernameChangedAt = serializers.DateTimeField(source="username_changed_at", allow_null=True)
