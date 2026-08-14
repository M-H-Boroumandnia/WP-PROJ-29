from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from core.exceptions import SonoraError
from catalog.models import Track
from playlists.models import (
    Playlist,
    PlaylistItem,
    SavedPlaylist,
)
from catalog.serializers import TrackSerializer
from playlists.serializers import PlaylistSerializer
from core.services.access import active_subscription
from core.views import (
    SonoraAPIView,
    page,
)


class PlaylistListView(SonoraAPIView):
    serializer_class = PlaylistSerializer

    def get(self, request: Request) -> Response:
        playlists = (
            Playlist.objects.filter(
                Q(owner=request.user) | Q(visibility=Playlist.Visibility.PUBLIC)
            )
            .distinct()
            .prefetch_related("items__track")
        )
        return Response(
            page(
                PlaylistSerializer(
                    list(playlists), many=True, context={"request": request, "viewer": request.user}
                ).data
            )
        )

    def post(self, request: Request) -> Response:
        sub = active_subscription(request.user)
        if Playlist.objects.filter(owner=request.user).count() >= (
            6 if sub.tier == "basic" else 100 if sub.tier == "silver" else 1_000_000
        ):
            raise SonoraError("playlist_limit", "Your plan's playlist limit has been reached.")
        playlist = Playlist.objects.create(
            owner=request.user,
            title=request.data.get("title", "Untitled playlist")[:160],
            visibility=request.data.get("visibility", Playlist.Visibility.PRIVATE),
        )
        return Response(
            PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class PlaylistDetailView(SonoraAPIView):
    serializer_class = PlaylistSerializer

    def get_playlist(self, request: Request, pk: str) -> Playlist:
        playlist = get_object_or_404(Playlist, pk=pk)
        if (
            playlist.owner_id != request.user.id
            and playlist.visibility != Playlist.Visibility.PUBLIC
        ):
            raise SonoraError(
                "forbidden", "You cannot access this playlist.", status.HTTP_403_FORBIDDEN
            )
        return playlist

    def get(self, request: Request, pk: str) -> Response:
        return Response(
            PlaylistSerializer(
                self.get_playlist(request, pk), context={"request": request, "viewer": request.user}
            ).data
        )

    def patch(self, request: Request, pk: str) -> Response:
        playlist = self.get_playlist(request, pk)
        if playlist.owner_id != request.user.id:
            raise SonoraError(
                "forbidden", "Only the owner can edit this playlist.", status.HTTP_403_FORBIDDEN
            )
        for field in ("title", "description", "visibility"):
            if field in request.data:
                setattr(playlist, field, request.data[field])
        if "trackIds" in request.data:
            PlaylistItem.objects.filter(playlist=playlist).delete()
            for index, track_id in enumerate(request.data["trackIds"]):
                PlaylistItem.objects.create(playlist=playlist, track_id=track_id, position=index)
        playlist.save()
        return Response(
            PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data
        )

    def delete(self, request: Request, pk: str) -> Response:
        playlist = self.get_playlist(request, pk)
        if playlist.owner_id != request.user.id:
            raise SonoraError(
                "forbidden", "Only the owner can delete this playlist.", status.HTTP_403_FORBIDDEN
            )
        playlist.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlaylistTrackView(SonoraAPIView):
    serializer_class = PlaylistSerializer

    def post(self, request: Request, pk: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, owner=request.user)
        track = get_object_or_404(Track, pk=request.data.get("trackId"))
        PlaylistItem.objects.get_or_create(
            playlist=playlist, track=track, defaults={"position": playlist.items.count()}
        )
        return Response(
            PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data
        )

    def patch(self, request: Request, pk: str, track_id: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, owner=request.user)
        item = get_object_or_404(PlaylistItem, playlist=playlist, track_id=track_id)
        item.position = int(request.data.get("position", item.position))
        item.save(update_fields=["position", "updated_at"])
        return Response(
            PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data
        )

    def delete(self, request: Request, pk: str, track_id: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, owner=request.user)
        PlaylistItem.objects.filter(playlist=playlist, track_id=track_id).delete()
        return Response(
            PlaylistSerializer(playlist, context={"request": request, "viewer": request.user}).data
        )


class PlaylistSaveView(SonoraAPIView):
    def post(self, request: Request, pk: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk, visibility=Playlist.Visibility.PUBLIC)
        if playlist.owner_id == request.user.id:
            raise SonoraError(
                "not_saveable", "Only another listener's public playlist can be saved."
            )
        SavedPlaylist.objects.get_or_create(user=request.user, playlist=playlist)
        return Response({"saved": True})

    def delete(self, request: Request, pk: str) -> Response:
        SavedPlaylist.objects.filter(user=request.user, playlist_id=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlaybackContextView(SonoraAPIView):
    serializer_class = TrackSerializer

    def get(self, request: Request, pk: str) -> Response:
        playlist = get_object_or_404(Playlist, pk=pk)
        if (
            playlist.owner_id != request.user.id
            and playlist.visibility != Playlist.Visibility.PUBLIC
        ):
            raise SonoraError(
                "forbidden", "You cannot access this playlist.", status.HTTP_403_FORBIDDEN
            )
        tracks = [item.track for item in playlist.items.all()]
        return Response(
            {
                "tracks": TrackSerializer(
                    tracks, many=True, context={"request": request, "viewer": request.user}
                ).data
            }
        )
