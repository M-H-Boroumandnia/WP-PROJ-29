from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from core.exceptions import SonoraError
from accounts.models import (
    Follow,
    User,
)
from playlists.models import Playlist
from accounts.serializers import (
    ActiveSubscriptionSerializer,
    ArtistOwnerSerializer,
    PublicProfileSerializer,
)
from playlists.serializers import PlaylistSerializer
from catalog.services.playback import listening_stats
from core.services.access import active_subscription
from core.views import SonoraAPIView


class ProfileView(SonoraAPIView):
    serializer_class = PublicProfileSerializer

    def get(self, request: Request, username: str) -> Response:
        user = get_object_or_404(
            User, username=username, deleted_at__isnull=True, kind=User.Kind.CONSUMER
        )
        if user.kind in {User.Kind.SUPPORT, User.Kind.ADMIN}:
            raise SonoraError("not_found", "Profile not found.", status.HTTP_404_NOT_FOUND)
        playlists = Playlist.objects.filter(
            owner=user, visibility=Playlist.Visibility.PUBLIC
        ).prefetch_related("items")
        ctx = {"request": request, "viewer": request.user, "slim": True}
        public = PublicProfileSerializer(user, context=ctx).data
        follower_users = [
            edge.follower
            for edge in user.follower_edges.select_related(
                "follower", "follower__artist_profile"
            )
        ]
        following_users = [
            edge.target
            for edge in user.following_edges.select_related(
                "target", "target__artist_profile"
            )
        ]
        # Lean profile user — library/recent/saved live on /me/library/, not here.
        public_user = {
            **public,
            "artistProfile": ArtistOwnerSerializer(user.artist_profile).data
            if hasattr(user, "artist_profile")
            else None,
            "followerIds": [str(person.id) for person in follower_users],
            "followingIds": [str(person.id) for person in following_users],
        }
        if request.user.is_authenticated and request.user.id == user.id:
            public_user.update(
                {
                    "email": user.email,
                    "birthDate": user.birth_date,
                    "gender": user.gender,
                    "locale": user.locale,
                    "timezone": user.timezone,
                    "theme": user.theme,
                    "explicitContentEnabled": user.explicit_content_enabled,
                    "subscription": ActiveSubscriptionSerializer(
                        active_subscription(user)
                    ).data,
                    "listeningStats": listening_stats(user),
                }
            )
        payload = {
            "user": public_user,
            "profile": public,
            "playlists": PlaylistSerializer(playlists, many=True, context=ctx).data,
            "followers": PublicProfileSerializer(follower_users, many=True, context=ctx).data,
            "following": PublicProfileSerializer(following_users, many=True, context=ctx).data,
        }
        return Response(payload)


class FollowView(SonoraAPIView):
    def post(self, request: Request, username: str) -> Response:
        target = get_object_or_404(
            User, username=username, deleted_at__isnull=True, kind=User.Kind.CONSUMER
        )
        if target.id == request.user.id:
            raise SonoraError("self_follow", "You cannot follow yourself.")
        Follow.objects.get_or_create(follower=request.user, target=target)
        return Response({"following": True})

    def delete(self, request: Request, username: str) -> Response:
        target = get_object_or_404(
            User, username=username, deleted_at__isnull=True, kind=User.Kind.CONSUMER
        )
        Follow.objects.filter(follower=request.user, target=target).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PeopleDirectoryView(SonoraAPIView):

    serializer_class = PublicProfileSerializer

    def get(self, request: Request) -> Response:
        q = request.query_params.get("q", "").strip()
        people = User.objects.filter(
            kind=User.Kind.CONSUMER, deleted_at__isnull=True, artist_profile__isnull=True
        )
        artists = User.objects.filter(
            kind=User.Kind.CONSUMER, deleted_at__isnull=True, artist_profile__isnull=False
        )
        if q:
            people = people.filter(Q(display_name__icontains=q) | Q(username__icontains=q))
            artists = artists.filter(
                Q(artist_profile__stage_name__icontains=q) | Q(username__icontains=q)
            )
        ctx = {"request": request, "viewer": request.user}
        return Response(
            {
                "people": PublicProfileSerializer(people[:40], many=True, context=ctx).data,
                "artists": PublicProfileSerializer(artists[:40], many=True, context=ctx).data,
            }
        )
