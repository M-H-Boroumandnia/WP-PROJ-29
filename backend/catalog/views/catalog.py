from __future__ import annotations

import mimetypes
import os

from django.http import FileResponse, HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404

from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response

from core.exceptions import SonoraError
from accounts.models import User
from catalog.models import (
    Like,
    PlaybackSession,
    Release,
    Track,
)
from catalog.serializers import (
    ReleaseSerializer,
    TrackSerializer,
)
from catalog.services.playback import (
    create_playback_session,
    listening_stats,
    record_progress,
    stream_grant,
    verify_stream_grant,
)
from core.services.access import can_download
from core.views import (
    SonoraAPIView,
    page,
)


class ReleaseListView(SonoraAPIView):
    serializer_class = ReleaseSerializer

    def get(self, request: Request) -> Response:
        queryset = (
            Release.objects.filter(status__in=[Release.Status.PUBLISHED, Release.Status.SCHEDULED])
            .select_related("owner")
            .prefetch_related("tracks__credits__artist__user")
        )
        return Response(
            page(
                ReleaseSerializer(
                    list(queryset), many=True, context={"request": request, "viewer": request.user}
                ).data
            )
        )


class ReleaseDetailView(SonoraAPIView):
    serializer_class = ReleaseSerializer

    def get(self, request: Request, pk: str) -> Response:
        release = get_object_or_404(
            Release.objects.prefetch_related("tracks__credits__artist__user"), pk=pk
        )
        if release.status == Release.Status.ARCHIVED or (
            release.status not in {Release.Status.PUBLISHED, Release.Status.SCHEDULED}
            and release.owner_id != request.user.id
            and request.user.kind != User.Kind.ADMIN
        ):
            raise SonoraError("not_found", "Release not found.", status.HTTP_404_NOT_FOUND)
        return Response(
            ReleaseSerializer(release, context={"request": request, "viewer": request.user}).data
        )


class TrackListView(SonoraAPIView):
    serializer_class = TrackSerializer

    def get(self, request: Request) -> Response:
        tracks = (
            Track.objects.filter(
                release__status__in=[Release.Status.PUBLISHED, Release.Status.SCHEDULED],
                processing_state="ready",
            )
            .select_related("release")
            .prefetch_related("credits__artist__user")
        )
        raw_ids = request.query_params.get("ids", "").strip()
        if raw_ids:
            wanted = [item.strip() for item in raw_ids.split(",") if item.strip()][:100]
            tracks = tracks.filter(id__in=wanted)
        return Response(
            page(
                TrackSerializer(
                    list(tracks), many=True, context={"request": request, "viewer": request.user}
                ).data
            )
        )


class TrackDetailView(SonoraAPIView):
    serializer_class = TrackSerializer

    def get(self, request: Request, pk: str) -> Response:
        track = get_object_or_404(
            Track.objects.select_related("release").prefetch_related("credits__artist__user"), pk=pk
        )
        if track.release.status == Release.Status.ARCHIVED or (
            track.release.status not in {Release.Status.PUBLISHED, Release.Status.SCHEDULED}
            and track.release.owner_id != request.user.id
            and request.user.kind != User.Kind.ADMIN
        ):
            raise SonoraError("not_found", "Track not found.", status.HTTP_404_NOT_FOUND)
        return Response(
            TrackSerializer(track, context={"request": request, "viewer": request.user}).data
        )


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
        return Response(
            {
                "playbackSessionId": str(session.id),
                "streamUrl": f"/api/v1/media/streams/{token}/",
                "expiresAt": session.expires_at.isoformat(),
                "canDownload": can_download(request.user),
            },
            status=status.HTTP_201_CREATED,
        )


class PlaybackProgressView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        session = get_object_or_404(
            PlaybackSession.objects.select_related("track"), pk=pk, user=request.user
        )
        finalize = str(request.data.get("finalize", "")).lower() in {"1", "true", "yes"}
        recorded = record_progress(
            session,
            float(request.data.get("positionSeconds", 0)),
            finalize=finalize,
        )
        session.track.refresh_from_db(
            fields=["stream_count", "unique_listener_count", "updated_at"]
        )
        payload: dict = {
            "validStreamRecorded": recorded,
            "streamCount": session.track.stream_count,
        }
        # Listening minutes are expensive to recompute — only on finalize or new stream.
        if finalize or recorded:
            payload["listeningStats"] = listening_stats(request.user)
        return Response(payload)


class DownloadTicketView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        if not can_download(request.user):
            raise SonoraError(
                "download_entitlement",
                "Downloads require Silver or Gold.",
                status.HTTP_403_FORBIDDEN,
            )
        track = get_object_or_404(Track, pk=pk)
        session = create_playback_session(request.user, track)
        token = stream_grant(session)
        return Response(
            {
                "downloadUrl": f"/api/v1/media/downloads/{token}/",
                "expiresAt": session.expires_at.isoformat(),
            }
        )


class StreamMediaView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request: Request, token: str, download: bool = False) -> HttpResponse:
        session = verify_stream_grant(token)
        file_field = session.track.processed_audio
        if not file_field:
            raise SonoraError(
                "track_unavailable", "Processed media is unavailable.", status.HTTP_404_NOT_FOUND
            )
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
                raise SonoraError(
                    "range_invalid",
                    "Requested media range is invalid.",
                    status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                ) from exc
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

            response = StreamingHttpResponse(
                chunks(), status=status.HTTP_206_PARTIAL_CONTENT, content_type=content_type
            )
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
