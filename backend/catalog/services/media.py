from __future__ import annotations

import mimetypes
import shutil
import subprocess
import wave
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image
from rest_framework import status

from core.exceptions import SonoraError
from accounts.models import User
from catalog.models import (
    Release,
    Track,
)
from core.services.access import can_edit_avatar
from core.services.common import (
    AUDIO_TYPES,
    IMAGE_TYPES,
    MAX_AUDIO_BYTES,
    MAX_AVATAR_BYTES,
    MAX_COVER_BYTES,
)


def validate_image(file, max_bytes: int = MAX_AVATAR_BYTES) -> Image.Image:  # type: ignore[no-untyped-def]
    if file.size > max_bytes:
        raise SonoraError("file_too_large", "Image exceeds the upload size limit.")
    content_type = getattr(file, "content_type", "") or mimetypes.guess_type(file.name)[0] or ""
    if content_type not in IMAGE_TYPES:
        raise SonoraError("file_type_invalid", "Choose a JPEG, PNG, or WebP image.")
    try:
        image = Image.open(file)
        image.verify()
        file.seek(0)
        image = Image.open(file).convert("RGB")
    except Exception as exc:
        raise SonoraError("image_invalid", "The image could not be decoded safely.") from exc
    return image


def derivative_content(image: Image.Image, size: int) -> ContentFile:
    copy = image.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), (12, 15, 12))
    offset = ((size - copy.width) // 2, (size - copy.height) // 2)
    canvas.paste(copy, offset)
    output = BytesIO()
    canvas.save(output, format="WEBP", quality=88, method=6)
    return ContentFile(output.getvalue())


def process_avatar(user: User, file) -> User:  # type: ignore[no-untyped-def]
    if not can_edit_avatar(user):
        raise SonoraError(
            "avatar_entitlement",
            "Profile image edits require Silver or Gold.",
            status.HTTP_403_FORBIDDEN,
        )
    image = validate_image(file)
    file.seek(0)
    safe_name = f"{user.id}.webp"
    user.avatar_original.save(file.name, file, save=False)
    user.avatar_256.save(safe_name, derivative_content(image, 256), save=False)
    user.avatar_64.save(safe_name, derivative_content(image, 64), save=False)
    user.save(update_fields=["avatar_original", "avatar_256", "avatar_64"])
    return user


def process_cover(release: Release, file) -> Release:  # type: ignore[no-untyped-def]
    image = validate_image(file, MAX_COVER_BYTES)
    file.seek(0)
    safe_name = f"{release.id}.webp"
    release.cover_original.save(file.name, file, save=False)
    release.cover_512.save(safe_name, derivative_content(image, 512), save=False)
    release.cover_128.save(safe_name, derivative_content(image, 128), save=False)
    release.save(update_fields=["cover_original", "cover_512", "cover_128", "updated_at"])
    return release


def validate_audio_file(file) -> None:  # type: ignore[no-untyped-def]
    if getattr(file, "size", 0) > MAX_AUDIO_BYTES:
        raise SonoraError("file_too_large", "Audio exceeds the upload size limit.")
    content_type = (
        getattr(file, "content_type", "") or mimetypes.guess_type(getattr(file, "name", ""))[0] or ""
    )
    if content_type not in AUDIO_TYPES:
        ext = Path(getattr(file, "name", "")).suffix.lower()
        if ext not in {".mp3", ".wav", ".flac"}:
            raise SonoraError("file_type_invalid", "Choose an MP3, WAV, or FLAC file.")
    try:
        file.seek(0)
    except Exception:
        pass


def wav_duration(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
        return max(1, round(frames / rate))


def process_audio(track: Track) -> Track:
    if not track.original_audio:
        track.processing_state = "failed"
        track.processing_error = "No original audio file was provided."
        track.save(update_fields=["processing_state", "processing_error", "updated_at"])
        return track
    try:
        source = Path(track.original_audio.path)
    except (NotImplementedError, ValueError, OSError):
        source = Path()
    if not source.is_file():
        track.processing_state = "failed"
        track.processing_error = "Original audio file is missing on disk."
        track.save(update_fields=["processing_state", "processing_error", "updated_at"])
        return track
    processed_dir = Path(settings.MEDIA_ROOT) / "audio" / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    target = processed_dir / f"{track.id}.mp3"
    ffmpeg = settings.SONORA_FFMPEG_BINARY
    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(source),
                "-vn",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "192k",
                str(target),
            ],
            check=True,
            capture_output=True,
        )
        track.processed_audio.name = f"audio/processed/{track.id}.mp3"
        track.duration_seconds = (
            wav_duration(source)
            if source.suffix.lower() == ".wav"
            else max(track.duration_seconds, 1)
        )
        track.processing_state = "ready"
        track.processing_error = ""
    except Exception as exc:
        if source.suffix.lower() == ".wav" and source.is_file():
            target = processed_dir / f"{track.id}.wav"
            shutil.copyfile(source, target)
            track.processed_audio.name = f"audio/processed/{track.id}.wav"
            track.duration_seconds = wav_duration(source)
            track.processing_state = "ready"
            track.processing_error = (
                "FFmpeg unavailable locally; WAV rendition copied for development playback."
            )
        else:
            track.processing_state = "failed"
            track.processing_error = f"FFmpeg processing failed: {exc}"
    track.save(
        update_fields=[
            "processed_audio",
            "duration_seconds",
            "processing_state",
            "processing_error",
            "updated_at",
        ]
    )
    if track.release.tracks.filter(processing_state="failed").exists():
        track.release.status = Release.Status.PROCESSING
    elif (
        track.release.tracks.exists()
        and not track.release.tracks.exclude(processing_state="ready").exists()
    ):
        track.release.status = Release.Status.READY
    track.release.save(update_fields=["status", "updated_at"])
    return track
