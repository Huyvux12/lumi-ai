"""Provider adapters. One pooled HTTP client is reused for the application lifespan."""

import asyncio
import base64
import json
import math
from contextlib import asynccontextmanager
import httpx
from pydantic import ValidationError
from .prompts import checked_segments, system_prompt
from .security import fail
from .token_budget import provider_prompt_tokens
from .provider_config import groq_runtime, resolve_stt, llm_usage
from .schemas import Reply


async def sse_events(lines):
    fields = []
    async for line in lines:
        if line.startswith("data:"):
            fields.append(line[5:].lstrip(" "))
        elif not line and fields:
            yield "\n".join(fields)
            fields.clear()
    if fields:
        yield "\n".join(fields)


def _json_rejected(response):
    try:
        return response.json().get("error", {}).get("code") == "json_validate_failed"
    except (ValueError, KeyError, TypeError, AttributeError):
        return False


def provider_failure(status):
    messages = {
        401: "Thông tin xác thực dịch vụ AI không hợp lệ. Kiểm tra API key ở backend.",
        403: "Tài khoản chưa có quyền truy cập model hoặc dịch vụ AI này.",
        404: "Không tìm thấy endpoint hoặc model. Kiểm tra cấu hình dịch vụ AI.",
        429: "Dịch vụ AI đang giới hạn yêu cầu. Vui lòng thử lại sau.",
        400: "Model không chấp nhận cấu hình. Kiểm tra model, chế độ JSON và tham số giới hạn token.",
        422: "Model không chấp nhận cấu hình. Kiểm tra model, chế độ JSON và tham số giới hạn token.",
    }
    fail("PROVIDER_UNAVAILABLE", messages.get(status, "Dịch vụ AI đang tạm gián đoạn. Vui lòng thử lại."), 502)


def strict_reply_schema():
    def normalize(node):
        if isinstance(node, list):
            return [normalize(value) for value in node]
        if not isinstance(node, dict):
            return node
        result = {key: normalize(value) for key, value in node.items() if key not in {"default", "discriminator"}}
        if "oneOf" in result:
            result["anyOf"] = result.pop("oneOf")
        if "const" in result:
            result["enum"] = [result.pop("const")]
        if result.get("type") == "object":
            result["additionalProperties"] = False
            result["required"] = list(result.get("properties", {}))
        return result
    return normalize(Reply.model_json_schema())


async def generate_reply(client, settings, prompt, character, scene, history, quota, *, provider=None, compatible_client=None):
    if settings.demo_llm and not settings.production:
        text = "Mình đang lắng nghe đây. Cậu muốn kể tiếp điều gì?"
        raw = json.dumps(
            {
                "schema_version": 1,
                "segments": [
                    {"type": "narration", "text": f"{character.data['name']} khẽ mỉm cười."},
                    {"type": "dialogue", "text": text, "emotion": "warm", "pace": "normal"},
                ],
            },
            ensure_ascii=False,
        )
        return checked_segments(raw, prompt.active_tags), {"demo": True}
    runtime = provider or groq_runtime(settings)
    if not runtime.key:
        fail("PROVIDER_UNAVAILABLE", "Trò chuyện AI chưa được cấu hình.", 503)
    messages = [{"role": "system", "content": system_prompt(prompt, character, scene)}]
    # Count the whole prompt; drop the oldest user/assistant pair together.
    budget = quota["input_tokens"]
    selected = list(history)
    schema = strict_reply_schema() if runtime.json_mode == "json_schema" else None
    format_tokens = provider_prompt_tokens([{"role": "system", "content": json.dumps(schema)}], runtime.tokenizer) if schema else 0
    while selected and provider_prompt_tokens(messages + selected, runtime.tokenizer) + format_tokens > budget:
        if len(selected) <= 1:
            fail("CONTEXT_TOO_LONG", "Hồ sơ hoặc tin nhắn quá dài. Vui lòng rút ngắn.", 400)
        selected.pop(0)
        while selected and selected[0]["role"] != "user":
            selected.pop(0)
    if not selected:
        fail("CONTEXT_TOO_LONG", "Hồ sơ nhân vật vượt giới hạn ngữ cảnh.", 400)
    payload = {
        "model": runtime.model,
        "messages": messages + selected,
        runtime.token_parameter: quota["output_tokens"],
    }
    if runtime.json_mode == "json_object":
        payload["response_format"] = {"type": "json_object"}
    elif runtime.json_mode == "json_schema":
        payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "persona_reply", "strict": True, "schema": schema}}
    if runtime.temperature is not None:
        payload["temperature"] = runtime.temperature
    if runtime.reasoning_effort is not None:
        payload["reasoning_effort"] = runtime.reasoning_effort
    target = compatible_client if runtime.provider == "openai_compatible" else client
    if target is None:
        fail("PROVIDER_UNAVAILABLE", "Kết nối LLM chưa được cấu hình.", 503)
    for attempt in range(2):
        try:
            response = await target.post(
                runtime.base_url + "/chat/completions",
                headers={"Authorization": f"Bearer {runtime.key}"},
                json=payload,
                follow_redirects=False,
            )
        except httpx.HTTPError:
            fail("PROVIDER_UNAVAILABLE", "Nhân vật đang tạm gián đoạn. Hãy thử lại sau.", 502)
        if response.status_code == 400 and _json_rejected(response) and attempt == 0:
            continue
        if response.status_code != 200:
            provider_failure(response.status_code)
        try:
            data = response.json()
            choice = data["choices"][0]
            if choice.get("finish_reason") in {"length", "content_filter"}:
                raise ValueError("Incomplete reply")
            segments = checked_segments(choice["message"]["content"], prompt.active_tags)
            return segments, llm_usage(data.get("usage", {}), runtime)
        except (ValueError, ValidationError, KeyError, IndexError, TypeError, AttributeError):
            if attempt == 0:
                continue
            fail("INVALID_REPLY", "Phản hồi chưa hoàn chỉnh. Vui lòng thử lại.", 502)
    fail("PROVIDER_UNAVAILABLE", "Nhân vật đang tạm gián đoạn. Hãy thử lại sau.", 502)


async def transcribe(client, settings, content, filename, mime, *, provider=None):
    runtime = provider or resolve_stt(settings, "groq")
    if not runtime.key:
        fail("PROVIDER_UNAVAILABLE", "Nhập giọng nói chưa được cấu hình.", 503)
    try:
        if runtime.id == "deepgram":
            response = await client.post(
                "https://api.deepgram.com/v1/listen",
                headers={"Authorization": f"Token {runtime.key}", "Content-Type": mime},
                params={"model": runtime.model, "language": "vi", "smart_format": "true"},
                content=content,
                follow_redirects=False,
            )
        else:
            response = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {runtime.key}"},
                data={"model": runtime.model, "language": "vi", "temperature": "0", "response_format": "verbose_json"},
                files={"file": (filename, content, mime)},
                follow_redirects=False,
            )
    except httpx.HTTPError:
        fail("PROVIDER_UNAVAILABLE", "Chưa thể nhận dạng giọng nói. Hãy thử lại sau.", 502)
    if response.status_code != 200:
        provider_failure(response.status_code)
    try:
        data = response.json()
        if runtime.id == "deepgram":
            text = data["results"]["channels"][0]["alternatives"][0]["transcript"]
            duration = data.get("metadata", {}).get("duration")
        else:
            text, duration = data["text"], data.get("duration")
        if not isinstance(text, str):
            raise ValueError
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        fail("PROVIDER_UNAVAILABLE", "Dịch vụ trả về kết quả nhận dạng không hợp lệ.", 502)
    if not text.strip():
        fail("EMPTY_TRANSCRIPT", "Chưa nhận được lời nói. Hãy ghi âm lại.", 422)
    return text.strip(), {"duration": duration if isinstance(duration, (int, float)) and not isinstance(duration, bool) and math.isfinite(duration) and 0 <= duration <= 3600 else None, "provider": runtime.id, "model": runtime.model, "language": "vi"}


async def tts_credentials(settings):
    if settings.tts_auth_mode == "api_key":
        if not settings.google_key:
            fail("PROVIDER_UNAVAILABLE", "Giọng đọc chưa được cấu hình.", 503)
        root = "https://aiplatform.googleapis.com/v1/publishers/google/models/"
        headers = {"x-goog-api-key": settings.google_key}
    elif settings.tts_auth_mode == "adc":
        if not settings.tts_project:
            fail("PROVIDER_UNAVAILABLE", "Giọng đọc chưa được cấu hình.", 503)

        def credentials():
            import google.auth
            from google.auth.transport.requests import Request

            credential, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            credential.refresh(Request())
            return credential.token

        token = await asyncio.to_thread(credentials)
        root = f"https://aiplatform.googleapis.com/v1/projects/{settings.tts_project}/locations/global/publishers/google/models/"
        headers = {"Authorization": f"Bearer {token}"}
    else:
        fail("PROVIDER_UNAVAILABLE", "Phương thức xác thực giọng đọc không hợp lệ.", 503)
    return root + settings.tts_model + ":streamGenerateContent?alt=sse", headers


@asynccontextmanager
async def tts_stream(client, settings, parts, voice):
    url, headers = await tts_credentials(settings)
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"voice": voice}},
        },
    }
    async with client.stream("POST", url, headers=headers, json=body) as response:
        if response.status_code != 200:
            fail("PROVIDER_UNAVAILABLE", "Chưa thể tạo giọng đọc. Hãy thử lại sau.", 502)

        async def chunks():
            pending = b""
            async for raw in sse_events(response.aiter_lines()):
                if raw == "[DONE]":
                    break
                data = json.loads(raw)
                if data.get("error"):
                    raise ValueError("TTS provider stream failed")
                for candidate in data.get("candidates", []):
                    for part in candidate.get("content", {}).get("parts", []):
                        inline = part.get("inlineData", {})
                        if not inline.get("data"):
                            continue
                        if not inline.get("mimeType", "").lower().startswith("audio/l16"):
                            raise ValueError("Unsupported streaming audio format")
                        pending += base64.b64decode(inline["data"], validate=True)
                        length = len(pending) - len(pending) % 2
                        if length:
                            yield pending[:length]
                            pending = pending[length:]
            if pending:
                raise ValueError("Incomplete PCM sample")

        yield chunks()


async def probe_audio(path):
    process = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), 10)
    except BaseException:
        process.kill()
        await process.wait()
        raise
    if process.returncode:
        fail("INVALID_AUDIO", "Bản ghi âm không hợp lệ.", 422)
    try:
        metadata = json.loads(output)
        if not any(stream.get("codec_type") == "audio" for stream in metadata.get("streams", [])):
            raise ValueError("No audio stream")
        duration = float(metadata["format"]["duration"])
    except (ValueError, KeyError, TypeError):
        fail("INVALID_AUDIO", "Bản ghi âm không hợp lệ.", 422)
    if not 0 < duration <= 120:
        fail("INVALID_AUDIO", "Bản ghi âm trống hoặc quá dài.", 422)
    return round(duration * 1000)


async def normalize_audio(source, directory):
    """Decode to bounded mono PCM; trust decoded frames rather than container duration metadata."""
    import wave
    from pathlib import Path
    import secrets

    target = Path(directory) / ("stt-" + secrets.token_hex(12) + ".wav")
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        "121",
        "-f",
        "wav",
        str(target),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(process.wait(), 20)
        if process.returncode:
            fail("INVALID_AUDIO", "Bản ghi âm không thể giải mã.", 422)
        with wave.open(str(target), "rb") as audio:
            duration = round(audio.getnframes() * 1000 / audio.getframerate())
        if not 0 < duration <= 120000:
            fail("INVALID_AUDIO", "Bản ghi âm trống hoặc quá dài.", 422)
        return target.read_bytes(), duration
    except asyncio.TimeoutError:
        fail("INVALID_AUDIO", "Bản ghi âm không thể xử lý.", 422)
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
        target.unlink(missing_ok=True)
