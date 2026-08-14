from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from core.exceptions import SonoraError
from accounts.models import User
from catalog.models import (
    PlayerQueue,
    Release,
    Track,
)
from playlists.models import Playlist
from accounts.serializers import (
    MePreferencesSerializer,
    MeSerializer,
)
from catalog.serializers import TrackSerializer
from playlists.serializers import PlaylistSerializer
from rooms.serializers import PlayerQueueSerializer
from catalog.services.media import process_avatar
from notifications.services import create_audit
from core.views import (
    SonoraAPIView,
    request_id,
)


class MeView(SonoraAPIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    serializer_class = MeSerializer

    def get(self, request: Request) -> Response:
        return Response(
            MeSerializer(request.user, context={"request": request, "viewer": request.user}).data
        )

    def patch(self, request: Request) -> Response:
        user: User = request.user
        data = request.data
        if "avatar" in request.FILES:
            process_avatar(user, request.FILES["avatar"])
        mapping = {
            "displayName": "display_name",
            "locale": "locale",
            "theme": "theme",
            "timezone": "timezone",
            "explicitContentEnabled": "explicit_content_enabled",
            "notificationPreference": "notification_preference",
        }
        for incoming, field in mapping.items():
            if incoming in data:
                setattr(user, field, data[incoming])
        if "username" in data:
            normalized = str(data["username"]).strip().lower().lstrip("@")
            if (
                not normalized
                or len(normalized) < 3
                or len(normalized) > 24
                or not all(ch.isalnum() or ch == "_" for ch in normalized)
            ):
                raise SonoraError(
                    "username_invalid", "Use 3–24 lowercase letters, numbers, or underscores."
                )
            if User.objects.filter(username=normalized).exclude(id=user.id).exists():
                raise SonoraError("username_taken", "That username is already in use.")
            if (
                user.username_changed_at
                and timezone.now() - user.username_changed_at < timezone.timedelta(days=30)
            ):
                raise SonoraError(
                    "username_cooldown", "Username can be changed once every 30 days."
                )
            user.username = normalized
            user.username_changed_at = timezone.now()
        user.save()
        return Response(MeSerializer(user, context={"request": request, "viewer": user}).data)


class MePreferencesView(SonoraAPIView):
    serializer_class = MePreferencesSerializer

    def get(self, request: Request) -> Response:
        return Response(
            MePreferencesSerializer(
                request.user, context={"request": request, "viewer": request.user}
            ).data
        )


class DeleteMeView(SonoraAPIView):
    @transaction.atomic
    def post(self, request: Request) -> Response:
        user: User = request.user
        user.deleted_at = timezone.now()
        user.is_active = False
        user.save(update_fields=["deleted_at", "is_active"])
        user.playlists.update(visibility=Playlist.Visibility.PRIVATE)
        if hasattr(user, "artist_profile"):
            user.owned_releases.update(status=Release.Status.ARCHIVED)
        create_audit(
            user,
            "account.deleted",
            user.id,
            None,
            {"deleted_at": user.deleted_at.isoformat()},
            request_id(request),
        )
        response = Response({"ok": True})
        response.delete_cookie("sonora_refresh", path="/api/v1/auth/")
        return response


class LibraryView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        user: User = request.user
        ctx = {"request": request, "viewer": user}
        owned = Playlist.objects.filter(owner=user).prefetch_related("items__track")
        saved = Playlist.objects.filter(
            saves__user=user, visibility=Playlist.Visibility.PUBLIC
        ).prefetch_related("items__track")
        recent_tracks = (
            Track.objects.filter(recentlyplayed__user=user)
            .select_related("release")
            .prefetch_related("credits__artist__user")
            .order_by("-recentlyplayed__played_at")[:20]
        )
        return Response(
            {
                "owned": PlaylistSerializer(owned, many=True, context=ctx).data,
                "saved": PlaylistSerializer(saved, many=True, context=ctx).data,
                "recent": TrackSerializer(recent_tracks, many=True, context=ctx).data,
            }
        )


class MeQueueView(SonoraAPIView):
    serializer_class = PlayerQueueSerializer

    def get(self, request: Request) -> Response:
        queue, _ = PlayerQueue.objects.get_or_create(user=request.user)
        return Response(PlayerQueueSerializer(queue).data)

    def put(self, request: Request) -> Response:
        serializer = PlayerQueueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        track_ids = [str(track_id) for track_id in data.get("trackIds", [])]
        if track_ids:
            existing = {
                str(track_id)
                for track_id in Track.objects.filter(id__in=track_ids).values_list("id", flat=True)
            }
            track_ids = [track_id for track_id in track_ids if track_id in existing]
        current_index = int(data.get("currentIndex", -1))
        if not track_ids:
            current_index = -1
        elif current_index < -1 or current_index >= len(track_ids):
            current_index = 0 if track_ids else -1
        queue, _ = PlayerQueue.objects.get_or_create(user=request.user)
        queue.track_ids = track_ids
        queue.current_index = current_index
        queue.repeat_mode = data.get("repeatMode", queue.repeat_mode)
        queue.shuffle_enabled = data.get("shuffleEnabled", queue.shuffle_enabled)
        queue.volume = data.get("volume", queue.volume)
        queue.save()
        return Response(PlayerQueueSerializer(queue).data)
