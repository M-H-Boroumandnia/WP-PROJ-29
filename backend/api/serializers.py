from __future__ import annotations

from typing import Any

from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import serializers

from .exceptions import SonoraError
from .models import (
    ArtistProfile,
    ArtistVerificationRequest,
    AuditEvent,
    Like,
    ListeningRoom,
    Notification,
    Payment,
    Playlist,
    PlaylistItem,
    Release,
    RoomParticipant,
    Subscription,
    SubscriptionPlan,
    Ticket,
    TicketMessage,
    Track,
    TrackArtistCredit,
    User,
)
from .services import active_subscription, participant_access_state, public_url, track_lock


class RegisterSerializer(serializers.Serializer):
    displayName = serializers.CharField(max_length=120)
    stageName = serializers.CharField(max_length=140, required=False, allow_blank=True)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=10, write_only=True)
    birthDate = serializers.DateField()
    gender = serializers.ChoiceField(choices=User.Gender.choices, allow_null=True)
    locale = serializers.ChoiceField(choices=User.Locale.choices)
    timezone = serializers.CharField(max_length=64)

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email__iexact=value, deleted_at__isnull=True).exists():
            raise serializers.ValidationError("An account already uses this email.", code="email_exists")
        return value.lower()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        user = authenticate(email=attrs["email"].lower(), password=attrs["password"])
        if not user or user.deleted_at:
            raise SonoraError("invalid_credentials", "Email or password is incorrect.")
        attrs["user"] = user
        return attrs


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
        return public_url(self.context.get("request"), obj.public_avatar_url) if self.context.get("request") else obj.public_avatar_url

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


class MeSerializer(PublicProfileSerializer):
    kind = serializers.CharField()
    email = serializers.EmailField()
    birthDate = serializers.DateField(source="birth_date")
    gender = serializers.CharField(allow_null=True)
    locale = serializers.CharField()
    timezone = serializers.CharField()
    theme = serializers.CharField()
    explicitContentEnabled = serializers.BooleanField(source="explicit_content_enabled")
    notificationPreference = serializers.CharField(source="notification_preference")
    subscription = serializers.SerializerMethodField()
    artistProfile = serializers.SerializerMethodField()
    password = serializers.SerializerMethodField()
    followerIds = serializers.SerializerMethodField()
    followingIds = serializers.SerializerMethodField()
    likedTrackIds = serializers.SerializerMethodField()
    savedPlaylistIds = serializers.SerializerMethodField()
    recentlyPlayedIds = serializers.SerializerMethodField()
    streamDates = serializers.SerializerMethodField()
    usernameChangedAt = serializers.DateTimeField(source="username_changed_at", allow_null=True)
    deletedAt = serializers.DateTimeField(source="deleted_at", allow_null=True)

    def get_subscription(self, obj: User) -> dict[str, Any]:
        return ActiveSubscriptionSerializer(active_subscription(obj)).data

    def get_artistProfile(self, obj: User) -> dict[str, Any] | None:
        profile = getattr(obj, "artist_profile", None)
        return ArtistOwnerSerializer(profile).data if profile else None

    def get_password(self, obj: User) -> str:
        return ""

    def get_followerIds(self, obj: User) -> list[str]:
        return [str(edge.follower_id) for edge in obj.follower_edges.all()]

    def get_followingIds(self, obj: User) -> list[str]:
        return [str(edge.target_id) for edge in obj.following_edges.all()]

    def get_likedTrackIds(self, obj: User) -> list[str]:
        return [str(like.track_id) for like in obj.likes.all()]

    def get_savedPlaylistIds(self, obj: User) -> list[str]:
        return [str(saved.playlist_id) for saved in obj.saved_playlists.all()]

    def get_recentlyPlayedIds(self, obj: User) -> list[str]:
        seen: list[str] = []
        for item in obj.recently_played.all()[:50]:
            track_id = str(item.track_id)
            if track_id not in seen:
                seen.append(track_id)
            if len(seen) == 20:
                break
        return seen

    def get_streamDates(self, obj: User) -> dict[str, str]:
        return {str(event.track_id): event.local_day for event in obj.stream_events.all()}


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
    audioUrl = serializers.SerializerMethodField()
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

    class Meta:
        model = Track
        fields = [
            "id", "releaseId", "title", "coverUrl", "audioUrl", "artists", "releaseTitle", "durationSeconds",
            "isExplicit", "isGoldEarlyAccess", "publicReleaseAt", "genre", "lyrics", "streamCount",
            "uniqueListenerCount", "isPlayableForViewer", "lockReason", "isLiked",
        ]

    def get_coverUrl(self, obj: Track) -> str | None:
        return public_url(self.context.get("request"), obj.release.public_cover_url) if self.context.get("request") else obj.release.public_cover_url

    def get_audioUrl(self, obj: Track) -> str | None:
        return None

    def get_artists(self, obj: Track) -> list[dict[str, Any]]:
        return ArtistCreditSerializer(obj.credits.select_related("artist__user"), many=True).data

    def get_isGoldEarlyAccess(self, obj: Track) -> bool:
        return bool(obj.release.early_access_starts_at and obj.release.public_release_at > timezone.now())

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
        fields = ["id", "type", "title", "coverUrl", "primaryArtist", "publicReleaseAt", "isEarlyAccess", "status", "trackIds", "genre", "ownerUserId", "trackCount", "isPlayableForViewer", "lockReason", "tracks"]

    def get_coverUrl(self, obj: Release) -> str | None:
        return public_url(self.context.get("request"), obj.public_cover_url) if self.context.get("request") else obj.public_cover_url

    def get_primaryArtist(self, obj: Release) -> dict[str, Any]:
        profile = obj.owner.artist_profile
        return {"artistId": str(profile.id), "username": obj.owner.username, "stageName": profile.stage_name, "role": "primary"}

    def get_isEarlyAccess(self, obj: Release) -> bool:
        return bool(obj.early_access_starts_at and obj.public_release_at > timezone.now())

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
        return obj.status in {Release.Status.PUBLISHED, Release.Status.SCHEDULED, Release.Status.READY} and self.get_lockReason(obj) is None

    def get_tracks(self, obj: Release) -> list[dict[str, Any]]:
        return TrackSerializer(obj.tracks.all(), many=True, context=self.context).data


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
        fields = ["id", "owner", "ownerId", "title", "description", "visibility", "coverUrl", "generatedCover", "tracks", "trackIds", "isSaved", "canEdit", "createdAt", "updatedAt"]

    def get_owner(self, obj: Playlist) -> dict[str, Any]:
        return PublicProfileSerializer(obj.owner, context=self.context).data

    def get_coverUrl(self, obj: Playlist) -> str | None:
        return public_url(self.context.get("request"), obj.cover.url if obj.cover else None)

    def get_tracks(self, obj: Playlist) -> list[dict[str, Any]]:
        tracks = [item.track for item in obj.items.select_related("track__release").prefetch_related("track__credits__artist__user")]
        return TrackSerializer(tracks, many=True, context=self.context).data

    def get_trackIds(self, obj: Playlist) -> list[str]:
        return [str(item.track_id) for item in obj.items.all()]

    def get_isSaved(self, obj: Playlist) -> bool:
        user = self.context.get("viewer")
        return bool(user and user.saved_playlists.filter(playlist=obj).exists())

    def get_canEdit(self, obj: Playlist) -> bool:
        user = self.context.get("viewer")
        return bool(user and obj.owner_id == user.id)


class NotificationSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    userId = serializers.CharField(source="user_id")
    titleKey = serializers.CharField(source="title_key", allow_blank=True)
    bodyKey = serializers.CharField(source="body_key", allow_blank=True)
    readAt = serializers.DateTimeField(source="read_at", allow_null=True)
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = Notification
        fields = ["id", "userId", "title", "body", "titleKey", "bodyKey", "values", "kind", "readAt", "createdAt"]


class VerificationRequestSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    userId = serializers.CharField(source="artist.user_id")
    portfolioUrls = serializers.JSONField(source="portfolio_urls")
    createdAt = serializers.DateTimeField(source="created_at")
    decidedAt = serializers.DateTimeField(source="decided_at", allow_null=True)
    artistName = serializers.CharField(source="artist.stage_name", read_only=True)

    class Meta:
        model = ArtistVerificationRequest
        fields = ["id", "userId", "artistName", "status", "portfolioUrls", "note", "reason", "createdAt", "decidedAt"]


class TicketMessageSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    authorId = serializers.CharField(source="author_id")
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = TicketMessage
        fields = ["id", "authorId", "body", "createdAt"]


class TicketSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    creatorId = serializers.CharField(source="creator_id")
    claimedById = serializers.CharField(source="claimed_by_id", allow_null=True)
    messages = TicketMessageSerializer(many=True)
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = Ticket
        fields = ["id", "creatorId", "subject", "status", "claimedById", "messages", "createdAt"]


class PlanSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    durationMonths = serializers.IntegerField(source="duration_months")
    monthlyPriceRial = serializers.IntegerField(source="monthly_price_rial")
    discountPercent = serializers.IntegerField(source="discount_percent")
    finalPriceRial = serializers.IntegerField(source="final_price_rial")
    isAvailable = serializers.BooleanField(source="is_available")
    startsAt = serializers.DateTimeField(source="campaign_starts_at", allow_null=True)
    endsAt = serializers.DateTimeField(source="campaign_ends_at", allow_null=True)

    class Meta:
        model = SubscriptionPlan
        fields = ["id", "tier", "durationMonths", "monthlyPriceRial", "discountPercent", "finalPriceRial", "isAvailable", "label", "startsAt", "endsAt"]


class PaymentSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    userId = serializers.CharField(source="user_id")
    planId = serializers.CharField(source="plan_id", allow_null=True)
    durationMonths = serializers.IntegerField(source="duration_months")
    monthlyPriceRial = serializers.IntegerField(source="monthly_price_rial")
    discountPercent = serializers.IntegerField(source="discount_percent")
    finalPriceRial = serializers.IntegerField(source="final_price_rial")
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = Payment
        fields = ["id", "userId", "planId", "tier", "durationMonths", "monthlyPriceRial", "discountPercent", "finalPriceRial", "provider", "status", "createdAt"]


class AuditEventSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    actorId = serializers.CharField(source="actor_id", allow_null=True)
    createdAt = serializers.DateTimeField(source="created_at")
    requestId = serializers.CharField(source="request_id")

    class Meta:
        model = AuditEvent
        fields = ["id", "actorId", "action", "target", "before", "after", "createdAt", "requestId"]


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
        fields = ["userId", "displayName", "avatarUrl", "joinedAt", "isHost", "canControl", "accessState"]

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
        fields = ["id", "inviteCode", "hostUserId", "status", "queue", "currentQueueItemId", "positionSeconds", "isPlaying", "repeatMode", "shuffleEnabled", "participants", "updatedAt"]

    def get_queue(self, obj: ListeningRoom) -> list[dict[str, Any]]:
        return [{"id": str(item.id), "trackId": str(item.track_id), "addedByUserId": str(item.added_by_id), "addedAt": item.created_at.isoformat()} for item in obj.queue_items.all()]

    def get_participants(self, obj: ListeningRoom) -> list[dict[str, Any]]:
        return RoomParticipantSerializer(obj.participants.filter(left_at__isnull=True).select_related("user"), many=True, context=self.context).data
