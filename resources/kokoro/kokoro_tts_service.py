#!/usr/bin/env python3
# pyright: reportMissingImports=false, reportAttributeAccessIssue=false
"""Kokoro TTS JSONL service.

Reads one JSON object per stdin line and writes one JSON object per stdout
line. Third-party output that may be emitted while loading the Kokoro pipeline is
redirected to stderr so stdout remains a machine-readable JSONL stream.
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# Keep runtime model/cache files beside the managed service script unless the
# parent process explicitly chooses a different Hugging Face cache directory.
os.environ.setdefault(
	"HF_HOME",
	str(Path(__file__).resolve().parent / "models" / "huggingface"),
)

import numpy as np
import soundfile as sf
from kokoro import KPipeline

MAX_TEXT_CHARS = 1000
SAMPLE_RATE = 24000
DEFAULT_LANG = "a"
DEFAULT_VOICE = "af_heart"
VOICE_RE = re.compile(r"^[a-z]{2}_[a-z0-9_]+$")
LANG_RE = re.compile(r"^[a-z]$")
KOKORO_REPO_ID = os.environ.get("KOKORO_REPO_ID", "hexgrad/Kokoro-82M")
KOKORO_REPO_REVISION = os.environ.get("KOKORO_REPO_REVISION")


def send_message(message: dict[str, Any]) -> None:
	"""Write a single JSON object to stdout."""
	sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
	sys.stdout.flush()


def error_message(message: str) -> dict[str, str]:
	return {"error": message}


def audio_chunk_to_array(audio: Any) -> np.ndarray:
	"""Convert a Kokoro audio chunk into a one-dimensional NumPy array."""
	if hasattr(audio, "detach"):
		audio = audio.detach()
	if hasattr(audio, "cpu"):
		audio = audio.cpu()
	if hasattr(audio, "numpy"):
		audio = audio.numpy()
	return np.asarray(audio, dtype=np.float32).reshape(-1)


def audio_to_base64_wav(audio_data: np.ndarray, sample_rate: int = SAMPLE_RATE) -> str:
	buffer = io.BytesIO()
	sf.write(buffer, audio_data, sample_rate, format="WAV", subtype="PCM_16")
	buffer.seek(0)
	return base64.b64encode(buffer.read()).decode("ascii")


def load_pipeline(lang: str) -> Any:
	"""Load Kokoro for a language while keeping stdout reserved for JSONL."""
	kwargs: dict[str, Any] = {"lang_code": lang, "repo_id": KOKORO_REPO_ID}
	if KOKORO_REPO_REVISION:
		kwargs["revision"] = KOKORO_REPO_REVISION
	with contextlib.redirect_stdout(sys.stderr):
		return KPipeline(**kwargs)


def parse_request(line: str) -> tuple[str, str, str] | dict[str, str]:
	try:
		request = json.loads(line)
	except json.JSONDecodeError as exc:
		return error_message(f"Invalid JSON: {exc}")

	if not isinstance(request, dict):
		return error_message("Invalid input: expected a JSON object")

	text = request.get("text")
	voice = request.get("voice", DEFAULT_VOICE)
	lang = request.get("lang", DEFAULT_LANG)

	if not isinstance(text, str) or not text.strip():
		return error_message("Invalid input: text must be a non-empty string")
	if len(text) > MAX_TEXT_CHARS:
		return error_message(f"Invalid input: text exceeds {MAX_TEXT_CHARS} characters")
	if not isinstance(voice, str) or not VOICE_RE.fullmatch(voice):
		return error_message("Invalid input: voice id is not allowed")
	if not isinstance(lang, str) or not LANG_RE.fullmatch(lang):
		return error_message("Invalid input: lang must be one lowercase letter")

	return text, voice, lang


def synthesize(pipeline: Any, text: str, voice: str) -> tuple[str, float] | dict[str, str]:
	chunks: list[np.ndarray] = []
	for _, _, audio in pipeline(text, voice=voice):
		chunk = audio_chunk_to_array(audio)
		if chunk.size > 0:
			chunks.append(chunk)

	if not chunks:
		return error_message("TTS failed: no audio generated")

	combined = np.concatenate(chunks)
	duration = round(float(len(combined)) / float(SAMPLE_RATE), 2)
	return audio_to_base64_wav(combined), duration


def main() -> int:
	current_lang = DEFAULT_LANG
	try:
		pipeline = load_pipeline(current_lang)
	except Exception as exc:  # noqa: BLE001 - surface model-load failures as JSON.
		send_message(error_message(f"Failed to load Kokoro pipeline: {exc}"))
		return 1

	send_message({"status": "ready"})

	for raw_line in sys.stdin:
		line = raw_line.strip()
		if not line:
			continue

		parsed = parse_request(line)
		if isinstance(parsed, dict):
			send_message(parsed)
			continue

		text, voice, lang = parsed
		try:
			if lang != current_lang:
				pipeline = load_pipeline(lang)
				current_lang = lang
			result = synthesize(pipeline, text, voice)
		except Exception as exc:  # noqa: BLE001 - keep service alive after TTS errors.
			send_message(error_message(f"TTS failed: {exc}"))
			continue

		if isinstance(result, dict):
			send_message(result)
			continue

		audio, duration = result
		send_message({"audio": audio, "duration": duration})

	return 0


if __name__ == "__main__":
	raise SystemExit(main())
