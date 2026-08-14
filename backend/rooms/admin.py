from __future__ import annotations

from django.contrib import admin

from rooms.models import ListeningRoom, RoomParticipant, RoomQueueItem

for model in [ListeningRoom, RoomParticipant, RoomQueueItem]:
    admin.site.register(model)
