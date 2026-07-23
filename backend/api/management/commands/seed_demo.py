from __future__ import annotations

import shutil
import uuid
from datetime import timezone as dt_timezone
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.models import (
    ArtistProfile,
    ArtistVerificationRequest,
    AuditEvent,
    Follow,
    Like,
    ListeningRoom,
    Notification,
    Payment,
    Payout,
    Playlist,
    PlaylistItem,
    RecentlyPlayed,
    Release,
    RoomParticipant,
    RoomQueueItem,
    StreamEvent,
    Subscription,
    SubscriptionPlan,
    Ticket,
    TicketMessage,
    Track,
    TrackArtistCredit,
    User,
)
from api.services import wav_duration

DEMO_PASSWORD = "DemoPass123!"
DEMO_NS = uuid.UUID("f74728fc-85b6-4e18-afbd-a3e9098e04c9")
PUBLIC_AVATAR_FILES = [
    "user-basic.svg",
    "user-silver.svg",
    "user-gold.svg",
    "user-artist-u.svg",
    "user-artist-v.svg",
    "user-artist-2.svg",
    "user-artist-3.svg",
    "user-artist-4.svg",
]
PUBLIC_COVER_FILES = [f"release-{index}.svg" for index in range(1, 7)]


def uid(label: str) -> uuid.UUID:
    return uuid.uuid5(DEMO_NS, label)


def dt(value: str):
    parsed = parse_datetime(value)
    if parsed is None:
        raise ValueError(value)
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, dt_timezone.utc)
    return parsed


def final_price(monthly: int, months: int, discount: int) -> int:
    return round(monthly * months * (1 - discount / 100))


def seed_media_root() -> Path:
    candidates = [
        Path(settings.BASE_DIR) / "seed_media",
        Path(settings.BASE_DIR).parent / "frontend" / "public" / "media",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def copy_public_seed_media() -> None:
    source_root = seed_media_root()
    for category, files in {"avatars": PUBLIC_AVATAR_FILES, "covers": PUBLIC_COVER_FILES}.items():
        target_dir = Path(settings.MEDIA_ROOT) / category
        target_dir.mkdir(parents=True, exist_ok=True)
        for file_name in files:
            source = source_root / category / file_name
            target = target_dir / file_name
            if source.exists():
                shutil.copyfile(source, target)


class Command(BaseCommand):
    help = "Seed local Sonora demo users, catalog, plans, support/admin data, and protected media."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--reset", action="store_true", help="Delete existing Sonora data before seeding.")

    def handle(self, *args: Any, **options: Any) -> None:
        if options["reset"]:
            for model in [
                AuditEvent,
                RoomQueueItem,
                RoomParticipant,
                ListeningRoom,
                Payout,
                TicketMessage,
                Ticket,
                Notification,
                StreamEvent,
                RecentlyPlayed,
                Like,
                PlaylistItem,
                Playlist,
                TrackArtistCredit,
                Track,
                Release,
                ArtistVerificationRequest,
                ArtistProfile,
                Payment,
                Subscription,
                SubscriptionPlan,
                Follow,
                User,
            ]:
                model.objects.all().delete()

        copy_public_seed_media()
        users = self.seed_users()
        profiles = self.seed_artist_profiles(users)
        self.seed_plans()
        self.seed_subscriptions(users)
        tracks = self.seed_catalog(users, profiles)
        self.seed_social_library(users, tracks)
        self.seed_workflows(users, profiles)
        self.stdout.write(self.style.SUCCESS("Sonora demo data is ready. Demo password: DemoPass123!"))

    def seed_users(self) -> dict[str, User]:
        rows = [
            ("basic", "listener.basic@sonora.demo", "Nila Ray", "nilarayic", User.Kind.CONSUMER, "basic", "/media/avatars/user-basic.svg"),
            ("silver", "listener.silver@sonora.demo", "Milo Vale", "milovalve", User.Kind.CONSUMER, "silver", "/media/avatars/user-silver.svg"),
            ("gold", "listener.gold@sonora.demo", "Ari Noor", "arinoorld", User.Kind.CONSUMER, "gold", "/media/avatars/user-gold.svg"),
            ("artist_u", "artist.unverified@sonora.demo", "Cedar Bloom", "cedarbloom", User.Kind.CONSUMER, "basic", "/media/avatars/user-artist-u.svg"),
            ("artist_v", "artist.verified@sonora.demo", "Nova Serein", "novaserein", User.Kind.CONSUMER, "gold", "/media/avatars/user-artist-v.svg"),
            ("artist_2", "lumen@sonora.demo", "Lumen Harbor", "lumenharbor", User.Kind.CONSUMER, "silver", "/media/avatars/user-artist-2.svg"),
            ("artist_3", "sol@sonora.demo", "Sol Circuit", "solcircuit", User.Kind.CONSUMER, "gold", "/media/avatars/user-artist-3.svg"),
            ("artist_4", "mira@sonora.demo", "Mira Moss", "miramoss", User.Kind.CONSUMER, "silver", "/media/avatars/user-artist-4.svg"),
            ("support", "support@sonora.demo", "Sonora Support", "internal-support", User.Kind.SUPPORT, "basic", None),
            ("admin", "admin@sonora.demo", "Sonora Admin", "internal-admin", User.Kind.ADMIN, "gold", None),
        ]
        users: dict[str, User] = {}
        for label, email, display, username, kind, _tier, avatar in rows:
            user, created = User.objects.update_or_create(
                id=uid(f"user-{label}"),
                defaults={
                    "email": email,
                    "username": username,
                    "display_name": display,
                    "kind": kind,
                    "birth_date": "1997-04-12",
                    "gender": User.Gender.PREFER_NOT,
                    "avatar_url_external": avatar,
                    "locale": User.Locale.EN,
                    "timezone": "Asia/Tehran",
                    "theme": User.Theme.DARK,
                    "explicit_content_enabled": True,
                    "notification_preference": User.NotificationPreference.ALL,
                    "is_staff": kind in {User.Kind.SUPPORT, User.Kind.ADMIN},
                    "is_superuser": kind == User.Kind.ADMIN,
                    "is_active": True,
                    "deleted_at": None,
                },
            )
            if created or not user.has_usable_password():
                user.set_password(DEMO_PASSWORD)
                user.save(update_fields=["password"])
            users[label] = user
        return users

    def seed_artist_profiles(self, users: dict[str, User]) -> dict[str, ArtistProfile]:
        rows = {
            "artist_u": ("Cedar Bloom", "Bedroom producer shaping quiet electronic sketches.", "Ambient", None),
            "artist_v": ("Nova Serein", "Luminous electronica assembled from night trains and warm circuitry.", "Electronic", "2025-01-14T10:00:00Z"),
            "artist_2": ("Lumen Harbor", "Organic textures and patient percussion.", "Downtempo", "2025-02-02T10:00:00Z"),
            "artist_3": ("Sol Circuit", "Bright synth music for long roads.", "Synthwave", "2025-03-02T10:00:00Z"),
            "artist_4": ("Mira Moss", "Acoustic fragments with an electronic pulse.", "Indie", "2025-04-02T10:00:00Z"),
        }
        profiles: dict[str, ArtistProfile] = {}
        for label, (stage, bio, genre, verified) in rows.items():
            profile, _ = ArtistProfile.objects.update_or_create(
                id=uid(f"profile-{label}"),
                user=users[label],
                defaults={"stage_name": stage, "bio": bio, "genre": genre, "verified_at": dt(verified) if verified else None},
            )
            profiles[label] = profile
        return profiles

    def seed_plans(self) -> None:
        for tier, monthly in [(SubscriptionPlan.Tier.SILVER, 790_000), (SubscriptionPlan.Tier.GOLD, 1_290_000)]:
            for months, discount in [(1, 0), (3, 5), (6, 10), (12, 18)]:
                SubscriptionPlan.objects.update_or_create(
                    id=uid(f"plan-{tier}-{months}"),
                    defaults={"tier": tier, "duration_months": months, "monthly_price_rial": monthly, "discount_percent": discount, "is_available": True, "label": ""},
                )

    def seed_subscriptions(self, users: dict[str, User]) -> None:
        tiers = {
            "basic": Subscription.Tier.BASIC,
            "silver": Subscription.Tier.SILVER,
            "gold": Subscription.Tier.GOLD,
            "artist_u": Subscription.Tier.BASIC,
            "artist_v": Subscription.Tier.GOLD,
            "artist_2": Subscription.Tier.SILVER,
            "artist_3": Subscription.Tier.GOLD,
            "artist_4": Subscription.Tier.SILVER,
            "support": Subscription.Tier.BASIC,
            "admin": Subscription.Tier.GOLD,
        }
        for label, tier in tiers.items():
            Subscription.objects.update_or_create(
                id=uid(f"sub-{label}"),
                user=users[label],
                defaults={
                    "tier": tier,
                    "status": Subscription.Status.ACTIVE,
                    "starts_at": dt("2026-07-06T08:00:00Z"),
                    "expires_at": None if tier == Subscription.Tier.BASIC else dt("2027-07-06T08:00:00Z"),
                },
            )

    def seed_catalog(self, users: dict[str, User], profiles: dict[str, ArtistProfile]) -> dict[int, Track]:
        releases = [
            (1, "artist_v", Release.Type.ALBUM, "Signals After Dark", "Electronic", "2026-05-10T00:00:00Z", None, Release.Status.PUBLISHED),
            (2, "artist_2", Release.Type.ALBUM, "Tidal Memory", "Downtempo", "2026-04-02T00:00:00Z", None, Release.Status.PUBLISHED),
            (3, "artist_3", Release.Type.ALBUM, "Solar Arcade", "Synthwave", "2026-03-14T00:00:00Z", None, Release.Status.PUBLISHED),
            (4, "artist_4", Release.Type.SINGLE, "Fern Signals", "Indie", "2026-06-20T00:00:00Z", None, Release.Status.PUBLISHED),
            (5, "artist_v", Release.Type.SINGLE, "Second Weather", "Electronic", "2026-06-28T00:00:00Z", None, Release.Status.PUBLISHED),
            (6, "artist_v", Release.Type.SINGLE, "Future Bloom", "Electronic", "2026-08-01T00:00:00Z", "2026-07-01T00:00:00Z", Release.Status.SCHEDULED),
        ]
        release_objs: dict[int, Release] = {}
        for number, owner, release_type, title, genre, public_at, early_at, status in releases:
            release, _ = Release.objects.update_or_create(
                id=uid(f"release-{number}"),
                defaults={
                    "owner": users[owner],
                    "release_type": release_type,
                    "title": title,
                    "genre": genre,
                    "public_release_at": dt(public_at),
                    "early_access_starts_at": dt(early_at) if early_at else None,
                    "status": status,
                    "cover_url_external": f"/media/covers/release-{number}.svg",
                },
            )
            release_objs[number] = release

        track_rows = [
            (1, 1, "artist_v", "Afterglow Index", 44, False, "A signal folds into the night\nWe keep the quiet moving", 24_800, 8_800),
            (2, 1, "artist_v", "Soft Machines", 52, False, "Soft machines breathe in time\nSilver circuits, open skies", 23_530, 8_409),
            (3, 1, "artist_v", "Night Geometry", 48, True, "Lines of light / a borrowed city\nWe draw the dark in symmetry", 22_260, 8_018),
            (4, 1, "artist_v", "Window Seat", 46, False, None, 20_990, 7_627),
            (5, 2, "artist_2", "Tidal Memory", 50, False, "Let the water keep the names\nWe were never standing still", 19_720, 7_236),
            (6, 2, "artist_2", "Driftwood Radio", 56, False, None, 18_450, 6_845),
            (7, 2, "artist_2", "Low Tide Lanterns", 43, False, None, 17_180, 6_454),
            (8, 3, "artist_3", "Solar Arcade", 49, False, "Turn the horizon up\nEvery mile becomes a color", 15_910, 6_063),
            (9, 3, "artist_3", "Chrome Sunrise", 47, False, None, 14_640, 5_672),
            (10, 4, "artist_4", "Fern Signals", 54, False, "Green static in the trees\nA small world waking", 13_370, 5_281),
            (11, 5, "artist_v", "Second Weather", 51, False, "There is another weather\nWaiting behind the rain", 12_100, 4_890),
            (12, 6, "artist_v", "Future Bloom", 45, False, "Tomorrow opens slowly\nA brighter frequency", 10_830, 4_499),
        ]
        processed_root = Path(settings.MEDIA_ROOT) / "audio" / "processed"
        processed_root.mkdir(parents=True, exist_ok=True)
        source_root = seed_media_root() / "audio"
        tracks: dict[int, Track] = {}
        for number, release_number, artist_label, title, duration, explicit, lyrics, streams, listeners in track_rows:
            source = source_root / f"sonora-{number}.wav"
            target = processed_root / f"sonora-{number}.wav"
            if source.exists() and not target.exists():
                shutil.copyfile(source, target)
            track, _ = Track.objects.update_or_create(
                id=uid(f"track-{number}"),
                defaults={
                    "release": release_objs[release_number],
                    "title": title,
                    "processed_audio": f"audio/processed/sonora-{number}.wav" if target.exists() else "",
                    "duration_seconds": wav_duration(target) if target.exists() else duration,
                    "lyrics": lyrics,
                    "is_explicit": explicit,
                    "processing_state": "ready" if target.exists() else "failed",
                    "processing_error": "" if target.exists() else "Seed audio file missing.",
                    "stream_count": streams,
                    "unique_listener_count": listeners,
                },
            )
            TrackArtistCredit.objects.update_or_create(id=uid(f"credit-{number}"), defaults={"track": track, "artist": profiles[artist_label], "role": TrackArtistCredit.Role.PRIMARY})
            tracks[number] = track
        return tracks

    def seed_social_library(self, users: dict[str, User], tracks: dict[int, Track]) -> None:
        for follower, target in [("basic", "artist_v"), ("silver", "artist_v"), ("gold", "artist_v"), ("gold", "artist_2")]:
            Follow.objects.get_or_create(follower=users[follower], target=users[target])
        for user_label, track_numbers in [("basic", [1, 5]), ("silver", [2, 6]), ("gold", [1, 5, 12])]:
            for number in track_numbers:
                Like.objects.get_or_create(user=users[user_label], track=tracks[number])
        for label, numbers in [("basic", [3, 1, 8]), ("gold", [12, 1])]:
            for index, number in enumerate(numbers):
                RecentlyPlayed.objects.update_or_create(id=uid(f"recent-{label}-{number}"), defaults={"user": users[label], "track": tracks[number], "played_at": timezone.now() - timezone.timedelta(minutes=index)})

        playlist_rows = [
            ("playlist-1", "artist_v", "Night Transit", "Glowing tracks for the last train home.", Playlist.Visibility.PUBLIC, [1, 8, 5, 11]),
            ("playlist-2", "gold", "Low light focus", "Patient sounds, minimal interruption.", Playlist.Visibility.PUBLIC, [7, 2, 10]),
            ("playlist-3", "basic", "Private sparks", "Just for me.", Playlist.Visibility.PRIVATE, [3, 9]),
        ]
        for key, owner, title, desc, visibility, numbers in playlist_rows:
            playlist, _ = Playlist.objects.update_or_create(id=uid(key), defaults={"owner": users[owner], "title": title, "description": desc, "visibility": visibility, "generated_cover": True})
            PlaylistItem.objects.filter(playlist=playlist).exclude(track__in=[tracks[number] for number in numbers]).delete()
            for pos, number in enumerate(numbers):
                PlaylistItem.objects.update_or_create(playlist=playlist, track=tracks[number], defaults={"position": pos})

    def seed_workflows(self, users: dict[str, User], profiles: dict[str, ArtistProfile]) -> None:
        Notification.objects.update_or_create(id=uid("notice-gold-early"), defaults={"user": users["gold"], "title": "Future Bloom is here early", "body": "Your Gold early-access window is open.", "title_key": "noticeGoldEarlyTitle", "body_key": "noticeGoldEarlyBody", "values": {"releaseTitle": "Future Bloom"}, "kind": Notification.Kind.RELEASE})
        Notification.objects.update_or_create(id=uid("notice-basic-security"), defaults={"user": users["basic"], "title": "Account protected", "body": "Your security settings are up to date.", "title_key": "noticeAccountProtectedTitle", "body_key": "noticeAccountProtectedBody", "kind": Notification.Kind.CRITICAL})
        pending, _ = ArtistVerificationRequest.objects.update_or_create(id=uid("verify-pending"), defaults={"artist": profiles["artist_u"], "portfolio_urls": ["https://example.com/cedar-bloom"], "note": "Independent producer and live performer.", "status": ArtistVerificationRequest.Status.PENDING})
        approved, _ = ArtistVerificationRequest.objects.update_or_create(id=uid("verify-approved"), defaults={"artist": profiles["artist_v"], "portfolio_urls": ["https://example.com/nova-serein"], "note": "Official portfolio.", "reason": "Identity and catalog confirmed.", "status": ArtistVerificationRequest.Status.APPROVED, "reviewer": users["support"], "decided_at": dt("2025-01-14T10:00:00Z")})
        ticket, _ = Ticket.objects.update_or_create(id=uid("ticket-1"), defaults={"creator": users["silver"], "subject": "Downloaded track unavailable", "status": Ticket.Status.OPEN})
        TicketMessage.objects.update_or_create(id=uid("message-1"), defaults={"ticket": ticket, "author": users["silver"], "body": "The download action stays disabled on one release."})
        AuditEvent.objects.update_or_create(id=uid("audit-verify"), defaults={"actor": users["support"], "action": "verification.approved", "target": str(approved.id), "before": {"status": "pending"}, "after": {"status": "approved"}, "request_id": "req-demo-1"})
        AuditEvent.objects.update_or_create(id=uid("audit-plan"), defaults={"actor": users["admin"], "action": "plan.updated", "target": "plan-gold-12", "before": {"discount": 20}, "after": {"discount": 18}, "request_id": "req-demo-2"})
        Payout.objects.update_or_create(id=uid("payout-1"), defaults={"artist": profiles["artist_v"], "amount_rial": 48_600_000, "status": Payout.Status.PENDING, "period": "2026-06"})
