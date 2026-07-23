from __future__ import annotations

import io
import wave
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from django.core.management import call_command
from django.test import override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from .models import (
    ArtistVerificationRequest,
    AuditEvent,
    Notification,
    Payment,
    Playlist,
    Release,
    StreamEvent,
    Subscription,
    SubscriptionPlan,
    Ticket,
    Track,
    User,
)
from .services import local_day

PASSWORD = "DemoPass123!"


def png_file(name: str = "avatar.png") -> SimpleUploadedFile:
    output = io.BytesIO()
    Image.new("RGB", (48, 48), (182, 241, 60)).save(output, format="PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


def wav_file(name: str = "demo.wav", seconds: int = 1) -> SimpleUploadedFile:
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8_000)
        handle.writeframes(b"\0\0" * 8_000 * seconds)
    return SimpleUploadedFile(name, output.getvalue(), content_type="audio/wav")


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class SonoraApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        call_command("seed_demo", reset=True, verbosity=0)

    def setUp(self) -> None:
        cache.clear()
        self.client.credentials()

    def login(self, email: str = "listener.gold@sonora.demo") -> dict:
        response = self.client.post("/api/v1/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        return response.data

    def track_id(self, title: str) -> str:
        return str(Track.objects.get(title=title).id)

    def plan_id(self, tier: str, months: int) -> str:
        return str(SubscriptionPlan.objects.get(tier=tier, duration_months=months).id)

    def test_login_demo_success(self) -> None:
        data = self.login("listener.basic@sonora.demo")
        self.assertEqual(data["user"]["email"], "listener.basic@sonora.demo")
        self.assertEqual(data["user"]["subscription"]["tier"], "basic")

    def test_staff_login_preserves_account_kind(self) -> None:
        support = self.login("support@sonora.demo")
        self.assertEqual(support["user"]["kind"], "support")
        self.client.credentials()
        admin = self.login("admin@sonora.demo")
        self.assertEqual(admin["user"]["kind"], "admin")

    def test_login_invalid_credentials_returns_structured_error(self) -> None:
        response = self.client.post("/api/v1/auth/login/", {"email": "listener.basic@sonora.demo", "password": "wrong"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "invalid_credentials")
        self.assertIn("request_id", response.data)

    def test_register_consumer_creates_basic_account(self) -> None:
        response = self.client.post("/api/v1/auth/register/", {"displayName": "Test Listener", "email": "new@example.com", "password": "LongEnough123!", "birthDate": "1995-01-01", "gender": "prefer_not_to_say", "locale": "en", "timezone": "Asia/Tehran"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(response.data["user"]["subscription"]["tier"], "basic")
        self.assertIsNone(response.data["user"]["artistProfile"])

    def test_duplicate_registration_returns_structured_email_error(self) -> None:
        response = self.client.post("/api/v1/auth/register/", {"displayName": "Duplicate", "email": "listener.basic@sonora.demo", "password": "LongEnough123!", "birthDate": "1995-01-01", "gender": "prefer_not_to_say", "locale": "en", "timezone": "Asia/Tehran"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "email_exists")
        self.assertEqual(response.data["error"]["details"]["email"][0]["code"], "email_exists")

    def test_register_artist_creates_unverified_artist_profile(self) -> None:
        response = self.client.post("/api/v1/auth/register/artist/", {"displayName": "Stage Owner", "stageName": "Stage Signal", "email": "artist-new@example.com", "password": "LongEnough123!", "birthDate": "1995-01-01", "gender": "prefer_not_to_say", "locale": "en", "timezone": "Asia/Tehran"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(response.data["user"]["artistProfile"]["stageName"], "Stage Signal")
        self.assertIsNone(response.data["user"]["artistProfile"]["verifiedAt"])

    def test_refresh_token_returns_new_access_and_user(self) -> None:
        login = self.login("listener.gold@sonora.demo")
        self.client.credentials()
        response = self.client.post("/api/v1/auth/token/refresh/", {"refresh": login["refresh"]}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertIn("access", response.data)
        self.assertEqual(response.data["user"]["email"], "listener.gold@sonora.demo")

    def test_logout_clears_refresh_cookie_response(self) -> None:
        login = self.login("listener.gold@sonora.demo")
        response = self.client.post("/api/v1/auth/logout/", {"refresh": login["refresh"]}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["ok"], True)

    def test_password_reset_request_is_non_enumerating(self) -> None:
        response = self.client.post("/api/v1/auth/password-reset/request/", {"email": "missing@example.com"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["ok"])

    def test_password_reset_confirm_changes_password(self) -> None:
        request = self.client.post("/api/v1/auth/password-reset/request/", {"email": "listener.basic@sonora.demo"}, format="json")
        self.assertEqual(request.status_code, status.HTTP_200_OK)
        reset = request.data["debugReset"]
        confirm = self.client.post("/api/v1/auth/password-reset/confirm/", {"uid": reset["uid"], "token": reset["token"], "newPassword": "NewDemoPass123!"}, format="json")
        self.assertEqual(confirm.status_code, status.HTTP_200_OK, confirm.content)
        response = self.client.post("/api/v1/auth/login/", {"email": "listener.basic@sonora.demo", "password": "NewDemoPass123!"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)

    def test_support_profile_is_not_public(self) -> None:
        self.login()
        response = self.client.get("/api/v1/profiles/internal-support/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_public_profile_exposes_public_playlists_only(self) -> None:
        self.login("listener.gold@sonora.demo")
        response = self.client.get("/api/v1/profiles/nilarayic/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["profile"]["username"], "nilarayic")
        self.assertEqual(response.data["playlists"], [])

    def test_follow_and_unfollow_profile(self) -> None:
        self.login("listener.basic@sonora.demo")
        response = self.client.post("/api/v1/profiles/novaserein/follow/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["following"])
        response = self.client.delete("/api/v1/profiles/novaserein/follow/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_username_change_cooldown_is_enforced(self) -> None:
        self.login("listener.basic@sonora.demo")
        response = self.client.patch("/api/v1/me/", {"username": "nilanew"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        response = self.client.patch("/api/v1/me/", {"username": "nilanewer"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "username_cooldown")

    def test_delete_account_soft_hides_profile_and_keeps_private_playlist_row(self) -> None:
        self.login("listener.basic@sonora.demo")
        playlist_count = Playlist.objects.filter(owner__email="listener.basic@sonora.demo").count()
        response = self.client.post("/api/v1/me/delete/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Playlist.objects.filter(owner__email="listener.basic@sonora.demo").count(), playlist_count)
        self.client.credentials()
        self.login("listener.gold@sonora.demo")
        self.assertEqual(self.client.get("/api/v1/profiles/nilarayic/").status_code, status.HTTP_404_NOT_FOUND)

    def test_plans_return_authoritative_final_price(self) -> None:
        self.login()
        response = self.client.get("/api/v1/subscription/plans/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        gold_12 = next(plan for plan in response.data["results"] if plan["tier"] == "gold" and plan["durationMonths"] == 12)
        self.assertEqual(gold_12["finalPriceRial"], 12_693_600)

    def test_same_tier_repurchase_is_blocked(self) -> None:
        self.login("listener.silver@sonora.demo")
        response = self.client.post("/api/v1/subscription/purchases/", {"planId": self.plan_id("silver", 3)}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "same_tier_active")

    def test_gold_to_silver_downgrade_is_blocked_while_active(self) -> None:
        self.login("listener.gold@sonora.demo")
        response = self.client.post("/api/v1/subscription/purchases/", {"planId": self.plan_id("silver", 1)}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "downgrade_blocked")

    def test_silver_to_gold_activates_immediately_and_snapshots_payment(self) -> None:
        self.login("listener.silver@sonora.demo")
        response = self.client.post("/api/v1/subscription/purchases/", {"planId": self.plan_id("gold", 3)}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(response.data["tier"], "gold")
        sub = self.client.get("/api/v1/subscription/").data
        self.assertEqual(sub["tier"], "gold")

    def test_backend_mock_payment_persists_subscription_and_history_after_relogin(self) -> None:
        registration = self.client.post("/api/v1/auth/register/", {
            "displayName": "Payment Listener",
            "email": "payment-listener@example.com",
            "password": PASSWORD,
            "birthDate": "1996-01-01",
            "gender": "prefer_not_to_say",
            "locale": "en",
            "timezone": "Asia/Tehran",
        }, format="json")
        self.assertEqual(registration.status_code, status.HTTP_201_CREATED, registration.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {registration.data['access']}")
        purchase = self.client.post("/api/v1/subscription/purchases/", {"planId": self.plan_id("silver", 1)}, format="json")
        self.assertEqual(purchase.status_code, status.HTTP_201_CREATED, purchase.content)
        self.assertEqual(purchase.data["provider"], "mock")
        self.assertEqual(purchase.data["status"], "succeeded")
        self.assertTrue(Payment.objects.filter(user__email="payment-listener@example.com", tier="silver", status=Payment.Status.SUCCEEDED).exists())
        me = self.client.get("/api/v1/me/")
        self.assertEqual(me.data["subscription"]["tier"], "silver")
        history = self.client.get("/api/v1/payments/")
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        self.assertEqual(history.data["results"][0]["id"], purchase.data["id"])
        self.client.credentials()
        relogin = self.client.post("/api/v1/auth/login/", {"email": "payment-listener@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(relogin.status_code, status.HTTP_200_OK, relogin.content)
        self.assertEqual(relogin.data["user"]["subscription"]["tier"], "silver")

    def test_basic_playlist_limit_blocks_new_playlist(self) -> None:
        self.login("listener.basic@sonora.demo")
        user = User.objects.get(email="listener.basic@sonora.demo")
        for index in range(6 - user.playlists.count()):
            Playlist.objects.create(owner=user, title=f"Limit {index}", visibility=Playlist.Visibility.PRIVATE)
        response = self.client.post("/api/v1/playlists/", {"title": "Seventh"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "playlist_limit")

    def test_search_returns_categorized_results(self) -> None:
        self.login()
        response = self.client.get("/api/v1/search/?q=Future")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data["tracks"]), 1)
        self.assertGreaterEqual(len(response.data["releases"]), 1)

    def test_seeded_public_media_exists_and_is_served(self) -> None:
        media_root = Path(settings.MEDIA_ROOT)
        expected = [
            "covers/release-1.svg",
            "covers/release-6.svg",
            "avatars/user-basic.svg",
            "avatars/user-artist-v.svg",
        ]
        for relative in expected:
            self.assertTrue((media_root / relative).exists(), relative)
            response = self.client.get(f"/media/{relative}")
            self.assertEqual(response.status_code, status.HTTP_200_OK, relative)
            self.assertGreater(int(response.headers.get("Content-Length", "0")), 20, relative)
        self.assertTrue((media_root / "audio/processed/sonora-1.wav").exists())
        self.assertEqual(self.client.get("/media/audio/processed/sonora-1.wav").status_code, status.HTTP_404_NOT_FOUND)

    def test_catalog_media_urls_resolve_to_public_media(self) -> None:
        self.login()
        response = self.client.get("/api/v1/releases/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        cover_url = response.data["results"][0]["coverUrl"]
        self.assertTrue(cover_url.startswith("/media/covers/"), cover_url)
        self.assertEqual(self.client.get(cover_url).status_code, status.HTTP_200_OK)
        profile = self.client.get("/api/v1/profiles/nilarayic/")
        avatar_url = profile.data["profile"]["avatarUrl"]
        self.assertTrue(avatar_url.startswith("/media/avatars/"), avatar_url)
        self.assertEqual(self.client.get(avatar_url).status_code, status.HTTP_200_OK)

    def test_basic_sees_gold_early_access_lock(self) -> None:
        self.login("listener.basic@sonora.demo")
        response = self.client.get(f"/api/v1/tracks/{self.track_id('Future Bloom')}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["lockReason"], "gold_required")

    def test_explicit_toggle_blocks_explicit_track(self) -> None:
        self.login("listener.gold@sonora.demo")
        self.client.patch("/api/v1/me/", {"explicitContentEnabled": False}, format="json")
        response = self.client.get(f"/api/v1/tracks/{self.track_id('Night Geometry')}/")
        self.assertEqual(response.data["lockReason"], "explicit_restricted")

    def test_minor_cannot_play_explicit_track(self) -> None:
        user = User.objects.get(email="listener.gold@sonora.demo")
        user.birth_date = "2012-01-01"
        user.save(update_fields=["birth_date"])
        self.login("listener.gold@sonora.demo")
        response = self.client.post(f"/api/v1/tracks/{self.track_id('Night Geometry')}/playback-sessions/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "explicit_restricted")

    def test_playback_session_returns_short_lived_grant(self) -> None:
        self.login("listener.gold@sonora.demo")
        response = self.client.post(f"/api/v1/tracks/{self.track_id('Afterglow Index')}/playback-sessions/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertTrue(response.data["streamUrl"].startswith("/api/v1/media/streams/"))

    def test_track_payload_does_not_expose_processed_audio_url(self) -> None:
        self.login("listener.gold@sonora.demo")
        response = self.client.get(f"/api/v1/tracks/{self.track_id('Afterglow Index')}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertIsNone(response.data["audioUrl"])

    def test_playback_grant_stream_returns_browser_playable_audio_and_range(self) -> None:
        self.login("listener.gold@sonora.demo")
        grant = self.client.post(f"/api/v1/tracks/{self.track_id('Afterglow Index')}/playback-sessions/")
        self.assertEqual(grant.status_code, status.HTTP_201_CREATED, grant.content)
        full = self.client.get(grant.data["streamUrl"])
        self.assertEqual(full.status_code, status.HTTP_200_OK)
        self.assertEqual(full["Content-Type"], "audio/wav")
        self.assertEqual(full["Accept-Ranges"], "bytes")
        self.assertGreater(int(full["Content-Length"]), 1_000)
        ranged = self.client.get(grant.data["streamUrl"], HTTP_RANGE="bytes=0-1023")
        self.assertEqual(ranged.status_code, status.HTTP_206_PARTIAL_CONTENT)
        self.assertEqual(ranged["Content-Type"], "audio/wav")
        self.assertEqual(ranged["Content-Length"], "1024")
        self.assertEqual(ranged["Content-Range"].split("/")[0], "bytes 0-1023")

    def test_invalid_stream_grant_is_rejected(self) -> None:
        response = self.client.get("/api/v1/media/streams/not-a-valid-token/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "grant_invalid")

    def test_stream_progress_is_idempotent_per_local_day(self) -> None:
        self.login("listener.gold@sonora.demo")
        track = self.track_id("Afterglow Index")
        grant = self.client.post(f"/api/v1/tracks/{track}/playback-sessions/").data
        first = self.client.post(f"/api/v1/playback-sessions/{grant['playbackSessionId']}/progress/", {"positionSeconds": 31}, format="json")
        second = self.client.post(f"/api/v1/playback-sessions/{grant['playbackSessionId']}/progress/", {"positionSeconds": 35}, format="json")
        self.assertTrue(first.data["validStreamRecorded"])
        self.assertFalse(second.data["validStreamRecorded"])
        self.assertEqual(StreamEvent.objects.filter(user__email="listener.gold@sonora.demo", track_id=track).count(), 1)

    def test_basic_daily_cap_blocks_new_tracks_after_sixty_valid_streams(self) -> None:
        user = User.objects.get(email="listener.basic@sonora.demo")
        day = local_day(user)
        release = Release.objects.get(title="Signals After Dark")
        source_track = Track.objects.get(title="Afterglow Index")
        for index in range(60):
            counted = Track.objects.create(release=release, title=f"Counted {index}", processed_audio=source_track.processed_audio.name, duration_seconds=44, processing_state="ready")
            StreamEvent.objects.get_or_create(user=user, track=counted, local_day=day, defaults={"playback_session": user.playback_sessions.create(track=counted)})
        self.login("listener.basic@sonora.demo")
        response = self.client.post(f"/api/v1/tracks/{self.track_id('Soft Machines')}/playback-sessions/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_download_ticket_requires_silver_or_gold(self) -> None:
        self.login("listener.basic@sonora.demo")
        response = self.client.post(f"/api/v1/tracks/{self.track_id('Afterglow Index')}/download-tickets/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.client.credentials()
        self.login("listener.silver@sonora.demo")
        response = self.client.post(f"/api/v1/tracks/{self.track_id('Afterglow Index')}/download-tickets/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_basic_avatar_upload_is_blocked(self) -> None:
        self.login("listener.basic@sonora.demo")
        response = self.client.patch("/api/v1/me/", {"avatar": png_file()}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "avatar_entitlement")

    def test_silver_avatar_upload_generates_derivative(self) -> None:
        self.login("listener.silver@sonora.demo")
        response = self.client.patch("/api/v1/me/", {"avatar": png_file()}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertIn("/media/avatars/256/", response.data["avatarUrl"])

    def test_invalid_avatar_type_is_rejected(self) -> None:
        self.login("listener.silver@sonora.demo")
        bad = SimpleUploadedFile("avatar.txt", b"not image", content_type="text/plain")
        response = self.client.patch("/api/v1/me/", {"avatar": bad}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "file_type_invalid")

    def test_unverified_artist_cannot_create_release(self) -> None:
        self.login("artist.unverified@sonora.demo")
        response = self.client.post("/api/v1/artist/releases/", {"title": "Not yet", "type": "single"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "verified_required")

    def test_verified_artist_can_upload_wav_track(self) -> None:
        self.login("artist.verified@sonora.demo")
        release = self.client.post("/api/v1/artist/releases/", {"title": "Integration Single", "type": "single", "genre": "Electronic"}, format="json")
        self.assertEqual(release.status_code, status.HTTP_201_CREATED, release.content)
        response = self.client.post(f"/api/v1/artist/releases/{release.data['id']}/tracks/", {"title": "Uploaded Wave", "audio": wav_file(), "isExplicit": "false"}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(Track.objects.get(id=response.data["id"]).processing_state, "ready")

    def test_duplicate_pending_verification_is_blocked(self) -> None:
        self.login("artist.unverified@sonora.demo")
        response = self.client.post("/api/v1/artist/verification-requests/", {"portfolioUrls": ["https://example.com/again"], "note": "again"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "pending_exists")

    def test_support_approves_verification_and_audits(self) -> None:
        self.login("support@sonora.demo")
        pending = ArtistVerificationRequest.objects.get(status=ArtistVerificationRequest.Status.PENDING)
        before = AuditEvent.objects.count()
        response = self.client.post(f"/api/v1/support/verification-requests/{pending.id}/approve/", {"reason": "Identity confirmed"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        pending.refresh_from_db()
        self.assertIsNotNone(pending.artist.verified_at)
        self.assertEqual(AuditEvent.objects.count(), before + 1)

    def test_nonstaff_cannot_decide_verification(self) -> None:
        self.login("listener.gold@sonora.demo")
        pending = ArtistVerificationRequest.objects.get(status=ArtistVerificationRequest.Status.PENDING)
        response = self.client.post(f"/api/v1/support/verification-requests/{pending.id}/reject/", {"reason": "No"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_basic_ticket_creation_is_blocked(self) -> None:
        self.login("listener.basic@sonora.demo")
        response = self.client.post("/api/v1/tickets/", {"subject": "Help", "body": "Please"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "ticket_entitlement")

    def test_silver_ticket_create_reply_and_close(self) -> None:
        self.login("listener.silver@sonora.demo")
        response = self.client.post("/api/v1/tickets/", {"subject": "Catalog", "body": "Please inspect"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        ticket_id = response.data["id"]
        self.assertEqual(self.client.post(f"/api/v1/tickets/{ticket_id}/messages/", {"body": "Adding context"}, format="json").status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.post(f"/api/v1/tickets/{ticket_id}/close/").status_code, status.HTTP_200_OK)
        self.assertEqual(Ticket.objects.get(id=ticket_id).status, Ticket.Status.CLOSED)

    def test_support_can_claim_and_reply_ticket(self) -> None:
        self.login("support@sonora.demo")
        ticket = Ticket.objects.first()
        response = self.client.post(f"/api/v1/tickets/{ticket.id}/claim/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["claimedById"], str(User.objects.get(email="support@sonora.demo").id))
        response = self.client.post(f"/api/v1/tickets/{ticket.id}/messages/", {"body": "We are checking."}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Ticket.objects.get(id=ticket.id).status, Ticket.Status.ANSWERED)

    def test_admin_updates_plan_and_writes_audit(self) -> None:
        self.login("admin@sonora.demo")
        plan = SubscriptionPlan.objects.get(tier="silver", duration_months=1)
        before = AuditEvent.objects.count()
        response = self.client.patch("/api/v1/admin/subscription-plans/", {"id": str(plan.id), "discountPercent": 7}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.data["discountPercent"], 7)
        self.assertEqual(AuditEvent.objects.count(), before + 1)

    def test_admin_archives_release_and_writes_audit(self) -> None:
        self.login("admin@sonora.demo")
        release = Release.objects.get(title="Fern Signals")
        response = self.client.post(f"/api/v1/admin/releases/{release.id}/archive/", {"reason": "Moderation test"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        release.refresh_from_db()
        self.assertEqual(release.status, Release.Status.ARCHIVED)
        self.assertTrue(AuditEvent.objects.filter(action="release.archived").exists())

    def test_notification_muted_keeps_critical_only(self) -> None:
        user = User.objects.get(email="listener.gold@sonora.demo")
        Notification.objects.create(user=user, title="Social", body="x", kind=Notification.Kind.SOCIAL)
        Notification.objects.create(user=user, title="Critical", body="x", kind=Notification.Kind.CRITICAL)
        self.login("listener.gold@sonora.demo")
        self.client.patch("/api/v1/me/", {"notificationPreference": "muted"}, format="json")
        response = self.client.get("/api/v1/notifications/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(all(item["kind"] == "critical" for item in response.data["results"]))

    def test_notification_max_five_daily_adds_digest(self) -> None:
        user = User.objects.get(email="listener.gold@sonora.demo")
        user.notification_preference = User.NotificationPreference.MAX_FIVE_DAILY
        user.save(update_fields=["notification_preference"])
        for index in range(7):
            Notification.objects.create(user=user, title=f"Update {index}", body="x", kind=Notification.Kind.SOCIAL)
        self.login("listener.gold@sonora.demo")
        response = self.client.get("/api/v1/notifications/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(any(item["titleKey"] == "noticeDigestTitle" for item in response.data["results"]))

    def test_basic_cannot_create_room(self) -> None:
        self.login("listener.basic@sonora.demo")
        response = self.client.post("/api/v1/rooms/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "room_entitlement")

    def test_gold_creates_room_and_silver_joins(self) -> None:
        self.login("listener.gold@sonora.demo")
        room = self.client.post("/api/v1/rooms/").data
        self.client.credentials()
        self.login("listener.silver@sonora.demo")
        response = self.client.post(f"/api/v1/rooms/{room['inviteCode']}/join/")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(len(response.data["participants"]), 2)

    def test_room_track_access_state_locks_participant_without_gold(self) -> None:
        self.login("listener.gold@sonora.demo")
        room = self.client.post("/api/v1/rooms/").data
        self.client.post(f"/api/v1/rooms/{room['id']}/queue/", {"trackId": self.track_id("Future Bloom")}, format="json")
        self.client.credentials()
        self.login("listener.silver@sonora.demo")
        response = self.client.post(f"/api/v1/rooms/{room['inviteCode']}/join/")
        silver_state = next(p for p in response.data["participants"] if p["displayName"] == "Milo Vale")
        self.assertEqual(silver_state["accessState"], "tier_locked")

    def test_room_controller_required_to_add_queue_item(self) -> None:
        self.login("listener.gold@sonora.demo")
        room = self.client.post("/api/v1/rooms/").data
        self.client.credentials()
        self.login("listener.silver@sonora.demo")
        self.client.post(f"/api/v1/rooms/{room['inviteCode']}/join/")
        response = self.client.post(f"/api/v1/rooms/{room['id']}/queue/", {"trackId": self.track_id("Afterglow Index")}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "room_control_required")

    def test_room_host_transfer_grants_controller(self) -> None:
        self.login("listener.gold@sonora.demo")
        room = self.client.post("/api/v1/rooms/").data
        silver = User.objects.get(email="listener.silver@sonora.demo")
        self.client.credentials()
        self.login("listener.silver@sonora.demo")
        self.client.post(f"/api/v1/rooms/{room['inviteCode']}/join/")
        self.client.credentials()
        self.login("listener.gold@sonora.demo")
        response = self.client.post(f"/api/v1/rooms/{room['id']}/transfer-host/", {"userId": str(silver.id)}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(response.data["hostUserId"], str(silver.id))
