from __future__ import annotations

from rest_framework import serializers

from notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    id = serializers.CharField()
    userId = serializers.CharField(source="user_id")
    titleKey = serializers.CharField(source="title_key", allow_blank=True)
    bodyKey = serializers.CharField(source="body_key", allow_blank=True)
    readAt = serializers.DateTimeField(source="read_at", allow_null=True)
    createdAt = serializers.DateTimeField(source="created_at")

    class Meta:
        model = Notification
        fields = [
            "id",
            "userId",
            "title",
            "body",
            "titleKey",
            "bodyKey",
            "values",
            "kind",
            "readAt",
            "createdAt",
        ]
