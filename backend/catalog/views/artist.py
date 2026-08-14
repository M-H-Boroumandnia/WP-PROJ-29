from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from core.exceptions import SonoraError
from accounts.models import ArtistVerificationRequest
from catalog.models import (
    Release,
    Track,
    TrackArtistCredit,
)
from notifications.models import Notification
from catalog.serializers import (
    ReleaseSerializer,
    TrackSerializer,
)
from support.serializers import VerificationRequestSerializer
from billing.services.accounting import (
    artist_reward_snapshot,
    sync_artist_ledger,
)
from catalog.services.artist import artist_catalog_analytics
from catalog.services.media import (
    process_audio,
    process_cover,
    validate_audio_file,
)
from core.services.access import (
    ensure_consumer,
    ensure_verified_artist,
)
from core.services.common import parse_api_datetime
from notifications.services import notify_staff
from core.views import (
    EmptySerializer,
    SonoraAPIView,
    page,
)


class ArtistVerificationView(SonoraAPIView):
    serializer_class = VerificationRequestSerializer

    def get(self, request: Request) -> Response:
        ensure_consumer(request.user)
        profile = getattr(request.user, "artist_profile", None)
        qs = (
            ArtistVerificationRequest.objects.filter(artist=profile)
            if profile
            else ArtistVerificationRequest.objects.none()
        )
        return Response(page(VerificationRequestSerializer(list(qs), many=True).data))

    def post(self, request: Request) -> Response:
        profile = getattr(request.user, "artist_profile", None)
        if not profile:
            raise SonoraError("artist_required", "An artist profile is required.")
        if profile.verification_requests.filter(
            status=ArtistVerificationRequest.Status.PENDING
        ).exists():
            raise SonoraError("pending_exists", "You already have a pending request.")
        note = request.data.get("note", "")
        req = ArtistVerificationRequest.objects.create(
            artist=profile,
            portfolio_urls=request.data.get("portfolioUrls", []),
            note=note,
        )
        notify_staff(
            "Verification request pending",
            f"{profile.stage_name} submitted materials for review.",
            kind=Notification.Kind.IMPORTANT,
            title_key="noticeVerificationPendingTitle",
            body_key="noticeVerificationPendingBody",
            values={
                "name": profile.stage_name,
                "note": (note or "")[:160],
            },
        )
        return Response(VerificationRequestSerializer(req).data, status=status.HTTP_201_CREATED)


class ArtistReleasesView(SonoraAPIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    serializer_class = ReleaseSerializer

    def get(self, request: Request) -> Response:
        ensure_consumer(request.user)
        releases = (
            Release.objects.filter(owner=request.user)
            .exclude(status=Release.Status.ARCHIVED)
            .select_related("owner__artist_profile")
            .prefetch_related("tracks__credits__artist__user")
        )
        return Response(
            page(
                ReleaseSerializer(
                    list(releases), many=True, context={"request": request, "viewer": request.user}
                ).data
            )
        )

    @transaction.atomic
    def post(self, request: Request) -> Response:
        ensure_verified_artist(request.user)
        release = Release.objects.create(
            owner=request.user,
            release_type=request.data.get("type", Release.Type.SINGLE),
            title=request.data.get("title", "Untitled release")[:180],
            genre=request.data.get("genre", ""),
            public_release_at=parse_api_datetime(
                request.data.get("publicReleaseAt"), default=timezone.now()
            ),
            early_access_starts_at=parse_api_datetime(
                request.data.get("earlyAccessStartsAt"), allow_null=True
            ),
            status=Release.Status.DRAFT,
        )
        cover = request.FILES.get("cover")
        if cover:
            process_cover(release, cover)
        return Response(
            ReleaseSerializer(release, context={"request": request, "viewer": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class ArtistReleaseDetailView(SonoraAPIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    serializer_class = ReleaseSerializer

    def get_release(self, request: Request, pk: str) -> Release:
        release = get_object_or_404(Release, pk=pk)
        if release.owner_id != request.user.id:
            raise SonoraError(
                "forbidden",
                "Only the owning artist can edit this release.",
                status.HTTP_403_FORBIDDEN,
            )
        return release

    def get(self, request: Request, pk: str) -> Response:
        return Response(
            ReleaseSerializer(
                self.get_release(request, pk), context={"request": request, "viewer": request.user}
            ).data
        )

    def patch(self, request: Request, pk: str) -> Response:
        ensure_verified_artist(request.user)
        release = self.get_release(request, pk)
        if "title" in request.data:
            release.title = str(request.data["title"])[:180]
        if "genre" in request.data:
            release.genre = request.data["genre"] or ""
        if "type" in request.data:
            release.release_type = request.data["type"]
        if "status" in request.data:
            release.status = request.data["status"]
        if "publicReleaseAt" in request.data:
            release.public_release_at = parse_api_datetime(
                request.data["publicReleaseAt"], default=timezone.now()
            )
        if "earlyAccessStartsAt" in request.data:
            release.early_access_starts_at = parse_api_datetime(
                request.data["earlyAccessStartsAt"], allow_null=True
            )
        cover = request.FILES.get("cover")
        if cover:
            process_cover(release, cover)
        release.save()
        return Response(
            ReleaseSerializer(release, context={"request": request, "viewer": request.user}).data
        )

    def delete(self, request: Request, pk: str) -> Response:
        ensure_verified_artist(request.user)
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
        TrackArtistCredit.objects.create(
            track=track, artist=request.user.artist_profile, role=TrackArtistCredit.Role.PRIMARY
        )
        process_audio(track)
        return Response(
            TrackSerializer(track, context={"request": request, "viewer": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class ArtistTrackDetailView(SonoraAPIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    serializer_class = TrackSerializer

    def get_track(self, request: Request, pk: str) -> Track:
        track = get_object_or_404(Track.objects.select_related("release"), pk=pk)
        if track.release.owner_id != request.user.id:
            raise SonoraError(
                "forbidden",
                "Only the owning artist can edit this track.",
                status.HTTP_403_FORBIDDEN,
            )
        return track

    def patch(self, request: Request, pk: str) -> Response:
        ensure_verified_artist(request.user)
        track = self.get_track(request, pk)
        if "title" in request.data:
            track.title = str(request.data["title"])[:180]
        if "lyrics" in request.data:
            track.lyrics = request.data["lyrics"] or ""
        if "isExplicit" in request.data:
            track.is_explicit = str(request.data["isExplicit"]).lower() == "true"
        audio = request.FILES.get("audio")
        if audio:
            validate_audio_file(audio)
            track.original_audio = audio
            track.processing_state = "processing"
            # Persist the upload before processing so ffmpeg reads the new file path.
            track.save()
            process_audio(track)
        else:
            track.save()
        return Response(
            TrackSerializer(track, context={"request": request, "viewer": request.user}).data
        )

    def delete(self, request: Request, pk: str) -> Response:
        ensure_verified_artist(request.user)
        track = self.get_track(request, pk)
        track.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ArtistAnalyticsView(SonoraAPIView):
    def get(self, request: Request) -> Response:
        ensure_consumer(request.user)
        return Response(artist_catalog_analytics(request.user, request))


class ArtistPayoutsView(SonoraAPIView):
    serializer_class = EmptySerializer

    def get(self, request: Request) -> Response:
        profile = getattr(request.user, "artist_profile", None)
        if not profile:
            return Response(page([]))
        reward = artist_reward_snapshot(request.user)
        rows = [
            row
            for row in sync_artist_ledger()
            if row["artistUserId"] == str(request.user.id)
        ]
        return Response(
            {
                **page(rows),
                "rewardRial": reward["rewardRial"],
                "uniqueListeners": reward["uniqueListeners"],
                "validStreams": reward["validStreams"],
                "period": reward["period"],
            }
        )
