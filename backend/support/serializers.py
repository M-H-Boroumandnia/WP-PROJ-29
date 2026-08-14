from __future__ import annotations

from rest_framework import serializers

from accounts.models import ArtistVerificationRequest
from support.models import (
    AuditEvent,
    Ticket,
    TicketMessage,
)


class VerificationRequestSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    userId = serializers.CharField(source="artist.user_id")
    portfolioUrls = serializers.JSONField(source="portfolio_urls")
    createdAt = serializers.DateTimeField(source="created_at")
    decidedAt = serializers.DateTimeField(source="decided_at", allow_null=True)
    artistName = serializers.CharField(source="artist.stage_name", read_only=True)
    username = serializers.CharField(source="artist.user.username", read_only=True)
    displayName = serializers.CharField(source="artist.user.display_name", read_only=True)
    email = serializers.EmailField(source="artist.user.email", read_only=True)
    avatarUrl = serializers.SerializerMethodField()
    bio = serializers.CharField(source="artist.bio", read_only=True)
    genre = serializers.CharField(source="artist.genre", read_only=True)
    birthDate = serializers.DateField(source="artist.user.birth_date", read_only=True)
    gender = serializers.CharField(source="artist.user.gender", read_only=True, allow_null=True)
    locale = serializers.CharField(source="artist.user.locale", read_only=True)
    timezone = serializers.CharField(source="artist.user.timezone", read_only=True)
    accountCreatedAt = serializers.DateTimeField(
        source="artist.user.created_at", read_only=True
    )

    class Meta:
        model = ArtistVerificationRequest
        fields = [
            "id",
            "userId",
            "artistName",
            "username",
            "displayName",
            "email",
            "avatarUrl",
            "bio",
            "genre",
            "birthDate",
            "gender",
            "locale",
            "timezone",
            "accountCreatedAt",
            "status",
            "portfolioUrls",
            "note",
            "reason",
            "createdAt",
            "decidedAt",
        ]

    def get_avatarUrl(self, obj: ArtistVerificationRequest) -> str | None:
        return obj.artist.user.public_avatar_url


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


class AuditEventSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    actorId = serializers.CharField(source="actor_id", allow_null=True)
    createdAt = serializers.DateTimeField(source="created_at")
    requestId = serializers.CharField(source="request_id")

    class Meta:
        model = AuditEvent
        fields = ["id", "actorId", "action", "target", "before", "after", "createdAt", "requestId"]
