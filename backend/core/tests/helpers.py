from __future__ import annotations

import io
import wave

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

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
