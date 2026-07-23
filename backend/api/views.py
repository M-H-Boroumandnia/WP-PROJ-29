from __future__ import annotations

import mimetypes
import os
from collections import defaultdict
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.db.models import Q, Sum
from django.http import FileResponse, HttpRequest, HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.utils import timezone
from rest_framework import permissions, serializers as drf_serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .exceptions import SonoraError, error_response
from .models import (
    ArtistVerificationRequest,
    AuditEvent,
    Follow,
    Like,
    ListeningRoom,
    Notification,
    Payment,
    PlaybackSession,
    Playlist,
    PlaylistItem,
    RecentlyPlayed,
    Release,
    RoomParticipant,
    RoomQueueItem,
    SavedPlaylist,
    Subscription,
    SubscriptionPlan,
    Ticket,
    TicketMessage,
    Track,
    TrackArtistCredit,
    User,
)
from .serializers import (
    ActiveSubscriptionSerializer,
    AuditEventSerializer,
    ArtistOwnerSerializer,
    LoginSerializer,
    MeSerializer,
    NotificationSerializer,
    PaymentSerializer,
    PlanSerializer,
    PlaylistSerializer,
    PublicProfileSerializer,
    RegisterSerializer,
    ReleaseSerializer,
    RoomSerializer,
    TicketSerializer,
    TrackSerializer,
    VerificationRequestSerializer,
)
from .services import (
    add_track_to_room,
    active_subscription,
    can_download,
    can_open_ticket,
    create_audit,
    create_notification,
    create_playback_session,
    create_room,
    ensure_admin,
    ensure_consumer,
    ensure_staff,
    ensure_verified_artist,
    join_room,
    leave_room,
    process_avatar,
    process_audio,
    process_cover,
    purchase_plan,
    record_progress,
    room_controller,
    stream_grant,
    track_lock,
    validate_audio_file,
    verify_stream_grant,
)


def page(results: list[Any]) -> dict[str, Any]:
    return {"count": len(results), "next": None, "previous": None, "results": results}


def request_id(request: Request | HttpRequest) -> str:
    return getattr(request, "request_id", "")


def username_from(display_name: str) -> str:
    base = "".join(ch for ch in display_name.lower() if ch.isalnum())[:18] or "listener"
    candidate = base
    suffix = 1
    while User.objects.filter(username=candidate).exists():
        candidate = f"{base}{suffix}"
        suffix += 1
    return candidate


def token_payload(user: User, request: Request) -> dict[str, Any]:
    refresh = RefreshToken.for_user(user)
    payload = {"access": str(refresh.access_token), "user": MeSerializer(user, context={"request": request, "viewer": user}).data}
    if settings.SONORA_DEMO_MODE:
        payload["refresh"] = str(refresh)
    return payload


def set_refresh_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        "sonora_refresh",
        refresh,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="Lax",
        max_age=14 * 24 * 60 * 60,
        path="/api/v1/auth/",
    )


class EmptySerializer(drf_serializers.Serializer):
    pass


class SonoraAPIView(APIView):
    serializer_class = EmptySerializer


class RegisterView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

    @transaction.atomic
    def post(self, request: Request, artist: bool = False) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = User.objects.create_user(
            email=data["email"],
            password=data["password"],
            username=username_from(data.get("stageName") or data["displayName"]),
            display_name=data["displayName"].strip(),
            birth_date=data["birthDate"],
            gender=data.get("gender"),
            locale=data["locale"],
            timezone=data["timezone"],
        )
        Subscription.basic_for(user)
        if artist:
            stage = data.get("stageName", "").strip()
            if not stage:
                raise SonoraError("stage_name_required", "Stage name is required for artist registration.")
            from .models import ArtistProfile

            ArtistProfile.objects.create(user=user, stage_name=stage)
        create_notification(user, "Welcome to Sonora", "Your listening space is ready.", Notification.Kind.IMPORTANT, "noticeWelcomeTitle", "noticeWelcomeBody")
        payload = token_payload(user, request)
        response = Response(payload, status=status.HTTP_201_CREATED)
        set_refresh_cookie(response, payload["refresh"])
        return response


class LoginView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = LoginSerializer

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        payload = token_payload(user, request)
        response = Response(payload)
        set_refresh_cookie(response, payload["refresh"])
        return response


class RefreshView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        refresh_value = request.COOKIES.get("sonora_refresh") or request.data.get("refresh")
        if not refresh_value:
            raise SonoraError("refresh_missing", "Refresh token is missing.", status.HTTP_401_UNAUTHORIZED)
        refresh = RefreshToken(refresh_value)
        access = refresh.access_token
        user = User.objects.get(id=refresh["user_id"], deleted_at__isnull=True)
        new_refresh = RefreshToken.for_user(user)
        payload = {"access": str(access), "user": MeSerializer(user, context={"request": request, "viewer": user}).data}
        if settings.SONORA_DEMO_MODE:
            payload["refresh"] = str(new_refresh)
        response = Response(payload)
        set_refresh_cookie(response, str(new_refresh))
        return response


class LogoutView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        refresh_value = request.data.get("refresh") or request.COOKIES.get("sonora_refresh")
        if refresh_value:
            try:
                RefreshToken(refresh_value).blacklist()
            except TokenError:
                pass
        response = Response({"ok": True})
        response.delete_cookie("sonora_refresh", path="/api/v1/auth/")
        return response


class PasswordResetRequestView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        email = str(request.data.get("email", "")).strip().lower()
        response: dict[str, Any] = {"ok": True, "message": "If an account exists, reset instructions will be sent."}
        user = User.objects.filter(email=email, deleted_at__isnull=True, is_active=True).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            create_audit(user, "password_reset_requested", "user", str(user.id), None, {"email": email})
            if settings.SONORA_DEMO_MODE:
                response["debugReset"] = {"uid": uid, "token": token}
        return Response(response)


class PasswordResetConfirmView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        uid = str(request.data.get("uid", ""))
        token = str(request.data.get("token", ""))
        password = str(request.data.get("password") or request.data.get("newPassword") or "")
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id, deleted_at__isnull=True, is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            raise SonoraError("reset_invalid", "Password reset link is invalid or expired.", status.HTTP_400_BAD_REQUEST)
        if not default_token_generator.check_token(user, token):
            raise SonoraError("reset_invalid", "Password reset link is invalid or expired.", status.HTTP_400_BAD_REQUEST)
        validate_password(password, user)
        user.set_password(password)
        user.save(update_fields=["password"])
        create_audit(user, "password_reset_confirmed", "user", str(user.id), None, {"email": user.email})
        return Response({"ok": True, "message": "Password has been reset."})


class MeView(SonoraAPIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    serializer_class = MeSerializer

    def get(self, request: Request) -> Response:
        return Response(MeSerializer(request.user, context={"request": request, "viewer": request.user}).data)

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
            if not normalized or len(normalized) < 3 or len(normalized) > 24 or not all(ch.isalnum() or ch == "_" for ch in normalized):
                raise SonoraError("username_invalid", "Use 3–24 lowercase letters, numbers, or underscores.")
            if User.objects.filter(username=normalized).exclude(id=user.id).exists():
                raise SonoraError("username_taken", "That username is already in use.")
            if user.username_changed_at and timezone.now() - user.username_changed_at < timezone.timedelta(days=30):
                raise SonoraError("username_cooldown", "Username can be changed once every 30 days.")
            user.username = normalized
            user.username_changed_at = timezone.now()
        user.save()
        return Response(MeSerializer(user, context={"request": request, "viewer": user}).data)


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
        create_audit(user, "account.deleted", user.id, None, {"deleted_at": user.deleted_at.isoformat()}, request_id(request))
        response = Response({"ok": True})
        response.delete_cookie("sonora_refresh", path="/api/v1/auth/")
        return response


class LibraryView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        user: User = request.user
        ctx = {"request": request, "viewer": user}
        owned = Playlist.objects.filter(owner=user).prefetch_related("items__track")
        saved = Playlist.objects.filter(saves__user=user, visibility=Playlist.Visibility.PUBLIC).prefetch_related("items__track")
        liked_tracks = Track.objects.filter(likes__user=user).select_related("release").prefetch_related("credits__artist__user")
        recent_tracks = Track.objects.filter(recentlyplayed__user=user).select_related("release").prefetch_related("credits__artist__user").order_by("-recentlyplayed__played_at")[:20]
        return Response({
            "owned": PlaylistSerializer(owned, many=True, context=ctx).data,
            "saved": PlaylistSerializer(saved, many=True, context=ctx).data,
            "liked": TrackSerializer(liked_tracks, many=True, context=ctx).data,
            "recent": TrackSerializer(recent_tracks, many=True, context=ctx).data,
        })


class ProfileView(SonoraAPIView):
    serializer_class = PublicProfileSerializer

    def get(self, request: Request, username: str) -> Response:
        user = get_object_or_404(User, username=username, deleted_at__isnull=True, kind=User.Kind.CONSUMER)
        if user.kind in {User.Kind.SUPPORT, User.Kind.ADMIN}:
            raise SonoraError("not_found", "Profile not found.", status.HTTP_404_NOT_FOUND)
        playlists = Playlist.objects.filter(owner=user, visibility=Playlist.Visibility.PUBLIC)
        public = PublicProfileSerializer(user, context={"request": request, "viewer": request.user}).data
        public_user = {
            **public,
            "email": "",
            "password": "",
            "birthDate": "",
            "gender": None,
            "locale": user.locale,
            "timezone": user.timezone,
            "theme": user.theme,
            "explicitContentEnabled": True,
            "notificationPreference": User.NotificationPreference.ALL,
            "subscription": None,
            "artistProfile": ArtistOwnerSerializer(user.artist_profile).data if hasattr(user, "artist_profile") else None,
            "followerIds": [],
            "followingIds": [],
            "likedTrackIds": [],
            "savedPlaylistIds": [],
            "recentlyPlayedIds": [],
            "streamDates": {},
            "usernameChangedAt": None,
            "deletedAt": None,
        }
        return Response({
            "user": public_user,
            "profile": public,
            "playlists": PlaylistSerializer(playlists, many=True, context={"request": request, "viewer": request.user}).data,
        })


class FollowView(SonoraAPIView):
    def post(self, request: Request, username: str) -> Response:
        target = get_object_or_404(User, username=username, deleted_at__isnull=True, kind=User.Kind.CONSUMER)
        if target.id == request.user.id:
            raise SonoraError("self_follow", "You cannot follow yourself.")
        Follow.objects.get_or_create(follower=request.user, target=target)
        return Response({"following": True})

    def delete(self, request: Request, username: str) -> Response:
        target = get_object_or_404(User, username=username, deleted_at__isnull=True, kind=User.Kind.CONSUMER)
        Follow.objects.filter(follower=request.user, target=target).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SearchView(SonoraAPIView):
    serializer_class = TrackSerializer

    def get(self, request: Request) -> Response:
        q = request.query_params.get("q", "").strip()
        genre = request.query_params.get("genre", "all")
        public_statuses = [Release.Status.PUBLISHED, Release.Status.SCHEDULED]
        track_q = Track.objects.filter(release__status__in=public_statuses, processing_state="ready").select_related("release").prefetch_related("credits__artist__user")
        release_q = Release.objects.filter(status__in=public_statuses).select_related("owner").prefetch_related("tracks")
        if q:
            track_q = track_q.filter(Q(title__icontains=q) | Q(release__title__icontains=q) | Q(release__owner__artist_profile__stage_name__icontains=q))
            release_q = release_q.filter(Q(title__icontains=q) | Q(owner__artist_profile__stage_name__icontains=q))
        if genre and genre != "all":
            track_q = track_q.filter(release__genre=genre)
            release_q = release_q.filter(genre=genre)
        people = User.objects.filter(kind=User.Kind.CONSUMER, deleted_at__isnull=True, artist_profile__isnull=True)
        artists = User.objects.filter(kind=User.Kind.CONSUMER, deleted_at__isnull=True, artist_profile__isnull=False)
        if q:
            people = people.filter(Q(display_name__icontains=q) | Q(username__icontains=q))
            artists = artists.filter(Q(artist_profile__stage_name__icontains=q) | Q(username__icontains=q))
        playlists = Playlist.objects.filter(visibility=Playlist.Visibility.PUBLIC)
        if q:
            playlists = playlists.filter(Q(title__icontains=q) | Q(description__icontains=q))
        ctx = {"request": request, "viewer": request.user}
        return Response({
            "people": PublicProfileSerializer(people[:12], many=True, context=ctx).data,
            "artists": PublicProfileSerializer(artists[:12], many=True, context=ctx).data,
            "tracks": TrackSerializer(track_q[:30], many=True, context=ctx).data,
            "releases": ReleaseSerializer(release_q[:20], many=True, context=ctx).data,
            "playlists": PlaylistSerializer(playlists[:20], many=True, context=ctx).data,
        })


class ReleaseListView(SonoraAPIView):
    serializer_class = ReleaseSerializer

    def get(self, request: Request) -> Response:
        queryset = Release.objects.filter(status__in=[Release.Status.PUBLISHED, Release.Status.SCHEDULED]).select_related("owner").prefetch_related("tracks__credits__artist__user")
        return Response(page(ReleaseSerializer(list(queryset), many=True, context={"request": request, "viewer": request.user}).data))


class ReleaseDetailView(SonoraAPIView):
    serializer_class = ReleaseSerializer

    def get(self, request: Request, pk: str) -> Response:
        release = get_object_or_404(Release.objects.prefetch_related("tracks__credits__artist__user"), pk=pk)
        if release.status == Release.Status.ARCHIVED or (release.status not in {Release.Status.PUBLISHED, Release.Status.SCHEDULED} and release.owner_id != request.user.id and request.user.kind != User.Kind.ADMIN):
            raise SonoraError("not_found", "Release not found.", status.HTTP_404_NOT_FOUND)
        return Response(ReleaseSerializer(release, context={"request": request, "viewer": request.user}).data)


class TrackListView(SonoraAPIView):
    serializer_class = TrackSerializer

    def get(self, request: Request) -> Response:
        tracks = Track.objects.filter(release__status__in=[Release.Status.PUBLISHED, Release.Status.SCHEDULED], processing_state="ready").select_related("release").prefetch_related("credits__artist__user")
        return Response(page(TrackSerializer(list(tracks), many=True, context={"request": request, "viewer": request.user}).data))


class TrackDetailView(SonoraAPIView):
    serializer_class = TrackSerializer

    def get(self, request: Request, pk: str) -> Response:
        track = get_object_or_404(Track.objects.select_related("release").prefetch_related("credits__artist__user"), pk=pk)
        if track.release.status == Release.Status.ARCHIVED or (track.release.status not in {Release.Status.PUBLISHED, Release.Status.SCHEDULED} and track.release.owner_id != request.user.id and request.user.kind != User.Kind.ADMIN):
            raise SonoraError("not_found", "Track not found.", status.HTTP_404_NOT_FOUND)
        return Response(TrackSerializer(track, context={"request": request, "viewer": request.user}).data)


class LikeView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        track = get_object_or_404(Track, pk=pk)
        Like.objects.get_or_create(user=request.user, track=track)
        return Response({"liked": True})

    def delete(self, request: Request, pk: str) -> Response:
        Like.objects.filter(user=request.user, track_id=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlaybackSessionView(SonoraAPIView):
    serializer_class = TrackSerializer

    def post(self, request: Request, pk: str) -> Response:
        track = get_object_or_404(Track, pk=pk)
        session = create_playback_session(request.user, track)
        token = stream_grant(session)
        return Response({
            "playbackSessionId": str(session.id),
            "streamUrl": f"/api/v1/media/streams/{token}/",
            "expiresAt": session.expires_at.isoformat(),
            "canDownload": can_download(request.user),
        }, status=status.HTTP_201_CREATED)


class PlaybackProgressView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        session = get_object_or_404(PlaybackSession, pk=pk, user=request.user)
        recorded = record_progress(session, float(request.data.get("positionSeconds", 0)))
        return Response({"validStreamRecorded": recorded})


class DownloadTicketView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        if not can_download(request.user):
            raise SonoraError("download_entitlement", "Downloads require Silver or Gold.", status.HTTP_403_FORBIDDEN)
        track = get_object_or_404(Track, pk=pk)
        session = create_playback_session(request.user, track)
        token = stream_grant(session)
        return Response({"downloadUrl": f"/api/v1/media/downloads/{token}/", "expiresAt": session.expires_at.isoformat()})


class StreamMediaView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request: Request, token: str, download: bool = False) -> HttpResponse:
        session = verify_stream_grant(token)
        file_field = session.track.processed_audio
        if not file_field:
            raise SonoraError("track_unavailable", "Processed media is unavailable.", status.HTTP_404_NOT_FOUND)
        path = file_field.path
        file_size = os.path.getsize(path)
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        range_header = request.headers.get("Range", "").strip()
        filename = f"{session.track.title}{os.path.splitext(path)[1]}" if download else None
        if range_header.startswith("bytes="):
            spec = range_header.removeprefix("bytes=").split(",", 1)[0].strip()
            start_text, _, end_text = spec.partition("-")
            try:
                if start_text:
                    start = int(start_text)
                    end = int(end_text) if end_text else file_size - 1
                else:
                    suffix = int(end_text)
                    start = max(file_size - suffix, 0)
                    end = file_size - 1
            except ValueError as exc:
                raise SonoraError("range_invalid", "Requested media range is invalid.", status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE) from exc
            if start < 0 or end < start or start >= file_size:
                response = HttpResponse(status=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE)
                response["Content-Range"] = f"bytes */{file_size}"
                return response
            end = min(end, file_size - 1)
            length = end - start + 1
            handle = open(path, "rb")
            handle.seek(start)

            def chunks():
                remaining = length
                try:
                    while remaining > 0:
                        data = handle.read(min(64 * 1024, remaining))
                        if not data:
                            break
                        remaining -= len(data)
                        yield data
                finally:
                    handle.close()

            response = StreamingHttpResponse(chunks(), status=status.HTTP_206_PARTIAL_CONTENT, content_type=content_type)
            response["Content-Length"] = str(length)
            response["Content-Range"] = f"bytes {start}-{end}/{file_size}"
            if download and filename:
                response["Content-Disposition"] = f'attachment; filename="{filename}"'
        else:
            response = FileResponse(open(path, "rb"), as_attachment=download, filename=filename)
            response["Content-Type"] = content_type
            response["Content-Length"] = str(file_size)
        response["Accept-Ranges"] = "bytes"
        response["Cache-Control"] = "private, max-age=60"
        return response


class PlaylistListView(SonoraAPIView):
    serializer_class = PlaylistSerializer

    def get(self, request: Request) -> Response:
        playlists = Playlist.objects.filter(Q(owner=request.user) | Q(visibility=Playlist.Visibility.PUBLIC)).distinct().prefetch_related("items__track")
        return Response(page(PlaylistSerializer(list(playlists), many=True, context={"request": request, "viewer": request.user}).data))

    def post(self, request: Request) -> Response:
        sub = active_subscription(request.user)
        if Playlist.objects.filter(owner=request.user).count() >= (6 if sub.tier == "basic" else 100 if sub.tier == "silver" else 1_000_000):
            raise SonoraError("playlist_limit", "Your plan's playlist limit has been reached.")
        playlist = Playlist.objects.create(owner=request.user, title=request.data.get("title", "Untitled playlist")[:160], visibility=request.data.get("visibility", Playlist.Visibility.PRIVATE))
        return Response(PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data, status=status.HTTP_201_CREATED)


class PlaylistDetailView(SonoraAPIView):
    serializer_class = PlaylistSerializer

    def get_playlist(self, request: Request, pk: str) -> Playlist:
        playlist = get_object_or_404(Playlist, pk=pk)
        if playlist.owner_id != request.user.id and playlist.visibility != Playlist.Visibility.PUBLIC:
            raise SonoraError("forbidden", "You cannot access this playlist.", status.HTTP_403_FORBIDDEN)
        return playlist

    def get(self, request: Request, pk: str) -> Response:
        return Response(PlaylistSerializer(self.get_playlist(request, pk), context={"request": request, "viewer": request.user}).data)

    def patch(self, request: Request, pk: str) -> Response:
        playlist = self.get_playlist(request, pk)
        if playlist.owner_id != request.user.id:
            raise SonoraError("forbidden", "Only the owner can edit this playlist.", status.HTTP_403_FORBIDDEN)
        for field in ("title", "description", "visibility"):
            if field in request.data:
                setattr(playlist, field, request.data[field])
        if "trackIds" in request.data:
            PlaylistItem.objects.filter(playlist=playlist).delete()
            for index, track_id in enumerate(request.data["trackIds"]):
                PlaylistItem.objects.create(playlist=playlist, track_id=track_id, position=index)
        playlist.save()
        return Response(PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data)

    def delete(self, request: Request, pk: str) -> Response:
        playlist = self.get_playlist(request, pk)
        if playlist.owner_id != request.user.id:
            raise SonoraError("forbidden", "Only the owner can delete this playlist.", status.HTTP_403_FORBIDDEN)
        playlist.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlaylistTrackView(SonoraAPIView):
    serializer_class = PlaylistSerializer

    def post(self, request: Request, pk: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, owner=request.user)
        track = get_object_or_404(Track, pk=request.data.get("trackId"))
        PlaylistItem.objects.get_or_create(playlist=playlist, track=track, defaults={"position": playlist.items.count()})
        return Response(PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data)

    def patch(self, request: Request, pk: str, track_id: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, owner=request.user)
        item = get_object_or_404(PlaylistItem, playlist=playlist, track_id=track_id)
        item.position = int(request.data.get("position", item.position))
        item.save(update_fields=["position", "updated_at"])
        return Response(PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data)

    def delete(self, request: Request, pk: str, track_id: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, owner=request.user)
        PlaylistItem.objects.filter(playlist=playlist, track_id=track_id).delete()
        return Response(PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data)


class PlaylistSaveView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, visibility=Playlist.Visibility.PUBLIC)
        if playlist.owner_id == request.user.id:
            raise SonoraError("not_saveable", "Only another listener's public playlist can be saved.")
        SavedPlaylist.objects.get_or_create(user=request.user, playlist=playlist)
        return Response({"saved": True})

    def delete(self, request: Request, pk: str) -> Response:
        SavedPlaylist.objects.filter(user=request.user, playlist_id=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlaybackContextView(SonoraAPIView):
    serializer_class = TrackSerializer

    def get(self, request: Request, pk: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk)
        if playlist.owner_id != request.user.id and playlist.visibility != Playlist.Visibility.PUBLIC:
            raise SonoraError("forbidden", "You cannot access this playlist.", status.HTTP_403_FORBIDDEN)
        tracks = [item.track for item in playlist.items.all()]
        return Response({"tracks": TrackSerializer(tracks, many=True, context={"request": request, "viewer": request.user}).data})


class PlansView(SonoraAPIView):
    serializer_class = PlanSerializer

    def get(self, request: Request) -> Response:
        return Response(page(PlanSerializer(list(SubscriptionPlan.objects.all().order_by("tier", "duration_months")), many=True).data))


class SubscriptionView(SonoraAPIView):
    serializer_class = ActiveSubscriptionSerializer

    def get(self, request: Request) -> Response:
        return Response(ActiveSubscriptionSerializer(active_subscription(request.user)).data)


class PurchaseView(SonoraAPIView):
    serializer_class = PaymentSerializer

    def post(self, request: Request) -> Response:
        plan = get_object_or_404(SubscriptionPlan, pk=request.data.get("planId"), is_available=True)
        payment = purchase_plan(request.user, plan, Payment.Provider.MOCK if settings.SONORA_DEMO_MODE else Payment.Provider.ZARINPAL)
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class PaymentsView(SonoraAPIView):
    serializer_class = PaymentSerializer

    def get(self, request: Request) -> Response:
        return Response(page(PaymentSerializer(list(request.user.payments.all().order_by("-created_at")), many=True).data))


class PaymentCallbackView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request, provider: str) -> Response:
        return Response({"ok": True, "provider": provider, "message": "Sandbox callback endpoint configured."})


class NotificationsView(SonoraAPIView):
    serializer_class = NotificationSerializer

    def get(self, request: Request) -> Response:
        notices = list(request.user.notifications.all().order_by("-created_at"))
        pref = request.user.notification_preference
        if pref == User.NotificationPreference.MUTED:
            notices = [n for n in notices if n.kind == Notification.Kind.CRITICAL]
        elif pref == User.NotificationPreference.IMPORTANT_ONLY:
            notices = [n for n in notices if n.kind in {Notification.Kind.CRITICAL, Notification.Kind.IMPORTANT}]
        elif pref == User.NotificationPreference.MAX_FIVE_DAILY:
            visible: list[Notification] = []
            daily: dict[str, int] = defaultdict(int)
            overflow: dict[str, int] = defaultdict(int)
            for notice in notices:
                if notice.kind == Notification.Kind.CRITICAL:
                    visible.append(notice)
                    continue
                day = notice.created_at.date().isoformat()
                if daily[day] < 5:
                    visible.append(notice)
                    daily[day] += 1
                else:
                    overflow[day] += 1
            for day, count in overflow.items():
                digest = Notification(user=request.user, title="Daily notification digest", body=f"{count} additional updates are collected in this digest.", title_key="noticeDigestTitle", body_key="noticeDigestBody", values={"count": count}, kind=Notification.Kind.IMPORTANT, created_at=timezone.make_aware(timezone.datetime.fromisoformat(day)))
                visible.append(digest)
            notices = sorted(visible, key=lambda n: n.created_at, reverse=True)
        return Response(page(NotificationSerializer(notices, many=True).data))


class NotificationReadView(SonoraAPIView):
    def post(self, request: Request, pk: str | None = None) -> Response:
        qs = request.user.notifications.all()
        if pk:
            qs = qs.filter(pk=pk)
        qs.update(read_at=timezone.now())
        return Response({"ok": True})

    def delete(self, request: Request, pk: str) -> Response:
        request.user.notifications.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TicketsView(SonoraAPIView):
    serializer_class = TicketSerializer

    def get(self, request: Request) -> Response:
        tickets = Ticket.objects.all() if request.user.kind in {User.Kind.SUPPORT, User.Kind.ADMIN} else Ticket.objects.filter(creator=request.user)
        return Response(page(TicketSerializer(list(tickets.prefetch_related("messages")), many=True).data))

    def post(self, request: Request) -> Response:
        if not can_open_ticket(request.user):
            raise SonoraError("ticket_entitlement", "Silver, Gold, or verified artist access is required.", status.HTTP_403_FORBIDDEN)
        ticket = Ticket.objects.create(creator=request.user, subject=request.data.get("subject", "Support request")[:180])
        TicketMessage.objects.create(ticket=ticket, author=request.user, body=request.data.get("body", ""))
        return Response(TicketSerializer(ticket).data, status=status.HTTP_201_CREATED)


class TicketDetailView(SonoraAPIView):
    serializer_class = TicketSerializer

    def get_ticket(self, request: Request, pk: str) -> Ticket:
        ticket = get_object_or_404(Ticket, pk=pk)
        if request.user.kind == User.Kind.CONSUMER and ticket.creator_id != request.user.id:
            raise SonoraError("forbidden", "You cannot access this ticket.", status.HTTP_403_FORBIDDEN)
        return ticket

    def get(self, request: Request, pk: str) -> Response:
        return Response(TicketSerializer(self.get_ticket(request, pk)).data)


class TicketMessageView(TicketDetailView):
    def post(self, request: Request, pk: str) -> Response:
        ticket = self.get_ticket(request, pk)
        TicketMessage.objects.create(ticket=ticket, author=request.user, body=request.data.get("body", ""))
        if request.user.kind != User.Kind.CONSUMER:
            ticket.status = Ticket.Status.ANSWERED
            ticket.save(update_fields=["status", "updated_at"])
        return Response(TicketSerializer(ticket).data)


class TicketClaimView(TicketDetailView):
    def post(self, request: Request, pk: str) -> Response:
        ensure_staff(request.user)
        ticket = self.get_ticket(request, pk)
        ticket.claimed_by = None if ticket.claimed_by_id == request.user.id else request.user
        ticket.save(update_fields=["claimed_by", "updated_at"])
        return Response(TicketSerializer(ticket).data)


class TicketCloseView(TicketDetailView):
    def post(self, request: Request, pk: str) -> Response:
        ticket = self.get_ticket(request, pk)
        ticket.status = Ticket.Status.CLOSED
        ticket.save(update_fields=["status", "updated_at"])
        return Response(TicketSerializer(ticket).data)


class ArtistVerificationView(SonoraAPIView):
    serializer_class = VerificationRequestSerializer

    def get(self, request: Request) -> Response:
        ensure_consumer(request.user)
        profile = getattr(request.user, "artist_profile", None)
        qs = ArtistVerificationRequest.objects.filter(artist=profile) if profile else ArtistVerificationRequest.objects.none()
        return Response(page(VerificationRequestSerializer(list(qs), many=True).data))

    def post(self, request: Request) -> Response:
        profile = getattr(request.user, "artist_profile", None)
        if not profile:
            raise SonoraError("artist_required", "An artist profile is required.")
        if profile.verification_requests.filter(status=ArtistVerificationRequest.Status.PENDING).exists():
            raise SonoraError("pending_exists", "You already have a pending request.")
        req = ArtistVerificationRequest.objects.create(artist=profile, portfolio_urls=request.data.get("portfolioUrls", []), note=request.data.get("note", ""))
        return Response(VerificationRequestSerializer(req).data, status=status.HTTP_201_CREATED)


class ArtistReleasesView(SonoraAPIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    serializer_class = ReleaseSerializer

    def get(self, request: Request) -> Response:
        ensure_consumer(request.user)
        releases = Release.objects.filter(owner=request.user)
        return Response(page(ReleaseSerializer(list(releases), many=True, context={"request": request, "viewer": request.user}).data))

    @transaction.atomic
    def post(self, request: Request) -> Response:
        ensure_verified_artist(request.user)
        release = Release.objects.create(
            owner=request.user,
            release_type=request.data.get("type", Release.Type.SINGLE),
            title=request.data.get("title", "Untitled release")[:180],
            genre=request.data.get("genre", ""),
            public_release_at=request.data.get("publicReleaseAt") or timezone.now(),
            early_access_starts_at=request.data.get("earlyAccessStartsAt") or None,
            status=Release.Status.DRAFT,
        )
        if "cover" in request.FILES:
            process_cover(release, request.FILES["cover"])
        return Response(ReleaseSerializer(release, context={"request": request, "viewer": request.user}).data, status=status.HTTP_201_CREATED)


class ArtistReleaseDetailView(SonoraAPIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    serializer_class = ReleaseSerializer

    def get_release(self, request: Request, pk: str) -> Release:
        release = get_object_or_404(Release, pk=pk)
        if release.owner_id != request.user.id:
            raise SonoraError("forbidden", "Only the owning artist can edit this release.", status.HTTP_403_FORBIDDEN)
        return release

    def get(self, request: Request, pk: str) -> Response:
        return Response(ReleaseSerializer(self.get_release(request, pk), context={"request": request, "viewer": request.user}).data)

    def patch(self, request: Request, pk: str) -> Response:
        ensure_verified_artist(request.user)
        release = self.get_release(request, pk)
        for incoming, field in {"title": "title", "genre": "genre", "publicReleaseAt": "public_release_at", "status": "status"}.items():
            if incoming in request.data:
                setattr(release, field, request.data[incoming])
        if "cover" in request.FILES:
            process_cover(release, request.FILES["cover"])
        release.save()
        return Response(ReleaseSerializer(release, context={"request": request, "viewer": request.user}).data)

    def delete(self, request: Request, pk: str) -> Response:
        release = self.get_release(request, pk)
        release.status = Release.Status.ARCHIVED
        release.save(update_fields=["status", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ArtistTrackUploadView(SonoraAPIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    serializer_class = TrackSerializer

    @transaction.atomic
    def post(self, request: Request, pk: str) -> Response:
        ensure_verified_artist(request.user)
        release = get_object_or_404(Release, pk=pk, owner=request.user)
        file = request.FILES.get("audio")
        if not file:
            raise SonoraError("audio_required", "Audio file is required.")
        validate_audio_file(file)
        track = Track.objects.create(
            release=release,
            title=request.data.get("title", release.title)[:180],
            original_audio=file,
            lyrics=request.data.get("lyrics", ""),
            is_explicit=str(request.data.get("isExplicit", "false")).lower() == "true",
            processing_state="processing",
        )
        TrackArtistCredit.objects.create(track=track, artist=request.user.artist_profile, role=TrackArtistCredit.Role.PRIMARY)
        process_audio(track)
        return Response(TrackSerializer(track, context={"request": request, "viewer": request.user}).data, status=status.HTTP_201_CREATED)


class ArtistAnalyticsView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        ensure_consumer(request.user)
        profile = getattr(request.user, "artist_profile", None)
        if not profile:
            raise SonoraError("artist_required", "An artist profile is required.")
        tracks = Track.objects.filter(release__owner=request.user)
        return Response({"streams": tracks.aggregate(total=Sum("stream_count"))["total"] or 0, "tracks": tracks.count(), "verified": bool(profile.verified_at)})


class ArtistPayoutsView(SonoraAPIView):
    serializer_class = EmptySerializer

    def get(self, request: Request) -> Response:
        profile = getattr(request.user, "artist_profile", None)
        payouts = profile.payouts.all() if profile else []
        return Response(page([{"id": str(p.id), "artistUserId": str(request.user.id), "amountRial": p.amount_rial, "status": p.status, "period": p.period} for p in payouts]))


class SupportVerificationView(SonoraAPIView):
    serializer_class = VerificationRequestSerializer

    def get(self, request: Request) -> Response:
        ensure_staff(request.user)
        return Response(page(VerificationRequestSerializer(list(ArtistVerificationRequest.objects.all()), many=True).data))


class VerificationDecisionView(SonoraAPIView):
    serializer_class = VerificationRequestSerializer

    @transaction.atomic
    def post(self, request: Request, pk: str, approved: bool) -> Response:
        ensure_staff(request.user)
        req = get_object_or_404(ArtistVerificationRequest, pk=pk, status=ArtistVerificationRequest.Status.PENDING)
        before = {"status": req.status}
        req.status = ArtistVerificationRequest.Status.APPROVED if approved else ArtistVerificationRequest.Status.REJECTED
        req.reason = request.data.get("reason", "")
        req.reviewer = request.user
        req.decided_at = timezone.now()
        req.save()
        if approved:
            req.artist.verified_at = req.decided_at
            req.artist.save(update_fields=["verified_at", "updated_at"])
        create_audit(request.user, f"verification.{req.status}", req.id, before, {"status": req.status, "reason": req.reason}, request_id(request))
        create_notification(req.artist.user, "Verification decision", req.reason or req.status, Notification.Kind.CRITICAL)
        return Response(VerificationRequestSerializer(req).data)


class AdminPlansView(SonoraAPIView):
    serializer_class = PlanSerializer

    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        return Response(page(PlanSerializer(list(SubscriptionPlan.objects.all()), many=True).data))

    def post(self, request: Request) -> Response:
        ensure_admin(request.user)
        plan = SubscriptionPlan.objects.create(tier=request.data["tier"], duration_months=request.data["durationMonths"], monthly_price_rial=request.data["monthlyPriceRial"], discount_percent=request.data.get("discountPercent", 0), is_available=request.data.get("isAvailable", True), label=request.data.get("label"))
        create_audit(request.user, "plan.created", plan.id, None, PlanSerializer(plan).data, request_id(request))
        return Response(PlanSerializer(plan).data, status=status.HTTP_201_CREATED)

    def patch(self, request: Request) -> Response:
        ensure_admin(request.user)
        plan = get_object_or_404(SubscriptionPlan, pk=request.data.get("id"))
        before = PlanSerializer(plan).data
        for incoming, field in {"monthlyPriceRial": "monthly_price_rial", "discountPercent": "discount_percent", "isAvailable": "is_available", "label": "label"}.items():
            if incoming in request.data:
                setattr(plan, field, request.data[incoming])
        plan.save()
        create_audit(request.user, "plan.updated", plan.id, before, PlanSerializer(plan).data, request_id(request))
        return Response(PlanSerializer(plan).data)


class AdminAuditView(SonoraAPIView):
    serializer_class = AuditEventSerializer

    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        return Response(page(AuditEventSerializer(list(AuditEvent.objects.all()[:200]), many=True).data))


class AdminReportsView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        return Response({
            "subscriptions": Subscription.objects.filter(status=Subscription.Status.ACTIVE).count(),
            "revenueRial": Payment.objects.filter(status=Payment.Status.SUCCEEDED).aggregate(total=Sum("final_price_rial"))["total"] or 0,
            "validStreams": Track.objects.aggregate(total=Sum("stream_count"))["total"] or 0,
            "timezone": "Asia/Tehran",
        })


class AdminPayoutsView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        ensure_admin(request.user)
        from .models import Payout

        return Response(page([{"id": str(p.id), "artistUserId": str(p.artist.user_id), "amountRial": p.amount_rial, "status": p.status, "period": p.period} for p in Payout.objects.all()]))


class PayoutSettleView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        ensure_admin(request.user)
        from .models import Payout

        payout = get_object_or_404(Payout, pk=pk)
        before = {"status": payout.status}
        payout.status = Payout.Status.SETTLED
        payout.settled_at = timezone.now()
        payout.save(update_fields=["status", "settled_at", "updated_at"])
        create_audit(request.user, "payout.settled", payout.id, before, {"status": payout.status}, request_id(request))
        return Response({"ok": True})


class ArchiveReleaseView(SonoraAPIView):
    serializer_class = ReleaseSerializer

    def post(self, request: Request, pk: str) -> Response:
        ensure_admin(request.user)
        release = get_object_or_404(Release, pk=pk)
        before = {"status": release.status}
        release.status = Release.Status.ARCHIVED
        release.archived_reason = request.data.get("reason", "")
        release.save(update_fields=["status", "archived_reason", "updated_at"])
        create_audit(request.user, "release.archived", release.id, before, {"status": release.status, "reason": release.archived_reason}, request_id(request))
        return Response(ReleaseSerializer(release, context={"request": request, "viewer": request.user}).data)


class RoomsView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request) -> Response:
        room = create_room(request.user)
        return Response(RoomSerializer(room, context={"request": request}).data, status=status.HTTP_201_CREATED)


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
            raise SonoraError("forbidden", "Join the room before reading its state.", status.HTTP_403_FORBIDDEN)
        return Response(RoomSerializer(room, context={"request": request}).data)


class RoomLeaveView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, pk: str) -> Response:
        room = get_object_or_404(ListeningRoom, pk=pk)
        return Response(RoomSerializer(leave_room(request.user, room), context={"request": request}).data)


class RoomTransferHostView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, pk: str) -> Response:
        room = get_object_or_404(ListeningRoom, pk=pk, host=request.user)
        target = get_object_or_404(User, pk=request.data.get("userId"))
        participant = get_object_or_404(RoomParticipant, room=room, user=target, left_at__isnull=True)
        room.host = target
        room.save(update_fields=["host", "updated_at"])
        participant.can_control = True
        participant.save(update_fields=["can_control", "updated_at"])
        return Response(RoomSerializer(room, context={"request": request}).data)


class RoomPermissionsView(SonoraAPIView):
    serializer_class = RoomSerializer

    def post(self, request: Request, pk: str, user_id: str) -> Response:
        room = get_object_or_404(ListeningRoom, pk=pk, host=request.user)
        participant = get_object_or_404(RoomParticipant, room=room, user_id=user_id, left_at__isnull=True)
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
