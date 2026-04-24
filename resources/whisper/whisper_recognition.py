#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Whisper Speech Recognition для Nexa
Использует faster-whisper для быстрого локального распознавания речи
"""

import sys
import json
import os
import tempfile
import struct
import subprocess
import io
from faster_whisper import WhisperModel

# Модель Whisper
MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "small")
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ru")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")  # cpu или cuda
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")  # int8, int8_float16, int16, float16, float32

# Инициализация модели
model = None


def init_model():
    """Инициализирует модель Whisper"""
    global model
    if model is None:
        try:
            print(
                f"Loading Whisper model: {MODEL_SIZE}, device: {DEVICE}, compute_type: {COMPUTE_TYPE}",
                file=sys.stderr
            )
            model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
            print("Model loaded successfully", file=sys.stderr)
        except Exception as e:
            print(f"Error loading model: {e}", file=sys.stderr)
            sys.exit(1)
    return model


def get_ffmpeg_path():
    """Возвращает путь к ffmpeg/ffmpeg.exe"""
    # 1. Явно переданный путь
    env_ffmpeg = os.environ.get("FFMPEG_PATH")
    if env_ffmpeg and os.path.exists(env_ffmpeg):
        return env_ffmpeg

    possible_paths = []

    # Папка запуска текущего скрипта / exe
    base_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    possible_paths.extend([
        os.path.join(base_dir, "ffmpeg.exe"),
        os.path.join(base_dir, "ffmpeg", "ffmpeg.exe"),
        os.path.join(base_dir, "..", "ffmpeg", "ffmpeg.exe"),
        os.path.join(base_dir, "..", "resources", "ffmpeg", "ffmpeg.exe"),
    ])

    # Текущая рабочая директория
    cwd = os.getcwd()
    possible_paths.extend([
        os.path.join(cwd, "ffmpeg.exe"),
        os.path.join(cwd, "ffmpeg", "ffmpeg.exe"),
        os.path.join(cwd, "resources", "ffmpeg", "ffmpeg.exe"),
    ])

    # PyInstaller / bundled
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        possible_paths.extend([
            os.path.join(meipass, "ffmpeg.exe"),
            os.path.join(meipass, "ffmpeg", "ffmpeg.exe"),
            os.path.join(meipass, "resources", "ffmpeg", "ffmpeg.exe"),
        ])

    for p in possible_paths:
        if p and os.path.exists(p):
            return p

    # Fallback: системный PATH
    return "ffmpeg"


def check_ffmpeg():
    """Проверяет наличие FFmpeg"""
    ffmpeg_path = get_ffmpeg_path()
    try:
        result = subprocess.run(
            [ffmpeg_path, "-version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5
        )
        return result.returncode == 0, ffmpeg_path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False, ffmpeg_path
    except Exception:
        return False, ffmpeg_path


def convert_webm_to_wav(webm_path, wav_path):
    """Конвертирует WebM файл в WAV используя ffmpeg"""
    ffmpeg_ok, ffmpeg_path = check_ffmpeg()
    if not ffmpeg_ok:
        raise Exception(
            "FFmpeg не найден.\n"
            f"Проверялся путь: {ffmpeg_path}\n\n"
            "Решение:\n"
            "1. Положите ffmpeg.exe в resources/ffmpeg/\n"
            "или\n"
            "2. Передайте путь через переменную окружения FFMPEG_PATH"
        )

    if not os.path.exists(webm_path):
        raise Exception(f"Файл не найден: {webm_path}")

    file_size = os.path.getsize(webm_path)
    if file_size == 0:
        raise Exception("Аудио файл пустой (размер 0 байт)")

    if file_size < 100:
        raise Exception(f"Аудио файл слишком маленький ({file_size} байт). Возможно, запись не завершена.")

    try:
        cmd = [
            ffmpeg_path,
            "-err_detect", "ignore_err",
            "-i", webm_path,
            "-ar", "16000",
            "-ac", "1",
            "-f", "wav",
            "-y",
            wav_path
        ]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30
        )

        if not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
            error_msg = result.stderr.decode("utf-8", errors="ignore")
            raise Exception(
                f"FFmpeg не смог создать WAV файл. "
                f"Размер исходного файла: {file_size} байт. Ошибка: {error_msg}"
            )

        if result.returncode != 0:
            # Иногда ffmpeg отдает warning/error код, но файл создается нормально
            if os.path.exists(wav_path) and os.path.getsize(wav_path) > 0:
                return True
            error_msg = result.stderr.decode("utf-8", errors="ignore")
            raise Exception(f"FFmpeg error: {error_msg}")

        return True

    except FileNotFoundError:
        raise Exception(
            "FFmpeg не найден.\n"
            f"Проверялся путь: {ffmpeg_path}\n\n"
            "Положите ffmpeg.exe в resources/ffmpeg/ "
            "или передайте путь через FFMPEG_PATH"
        )
    except subprocess.TimeoutExpired:
        raise Exception("FFmpeg превысил время ожидания при конвертации")
    except Exception as e:
        raise Exception(f"Ошибка конвертации: {str(e)}")


def transcribe_audio(model_instance, audio_path):
    """Распознает речь и возвращает словарь результата"""
    segments, info = model_instance.transcribe(
        audio_path,
        language=LANGUAGE,
        beam_size=5,
        best_of=5,
        temperature=0.0,
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=2000,
            threshold=0.5,
            min_speech_duration_ms=250
        ),
        condition_on_previous_text=True,
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.6
    )

    full_text = ""
    for segment in segments:
        if segment.text:
            full_text += segment.text + " "

    return {
        "success": True,
        "text": full_text.strip(),
        "language": getattr(info, "language", LANGUAGE),
        "language_probability": getattr(info, "language_probability", None)
    }


def process_audio_file(audio_file_path):
    """Обрабатывает аудио файл и возвращает распознанный текст"""
    wav_path = None

    try:
        model_instance = init_model()

        file_ext = os.path.splitext(audio_file_path)[1].lower()
        actual_audio_path = audio_file_path

        if file_ext == ".webm":
            fd, wav_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

            try:
                convert_webm_to_wav(audio_file_path, wav_path)
                actual_audio_path = wav_path
            except Exception as e:
                return json.dumps({
                    "success": False,
                    "error": f"Ошибка конвертации WebM в WAV: {str(e)}"
                }, ensure_ascii=False)

        result = transcribe_audio(model_instance, actual_audio_path)
        return json.dumps(result, ensure_ascii=False)

    except Exception as e:
        return json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False)

    finally:
        if wav_path and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except Exception:
                pass


def process_audio_stream():
    """Обрабатывает аудио поток из stdin (raw PCM 16-bit, 16kHz, mono)"""
    temp_path = None

    try:
        model_instance = init_model()

        audio_data = sys.stdin.buffer.read()
        if len(audio_data) == 0:
            return json.dumps({
                "success": False,
                "error": "No audio data received"
            }, ensure_ascii=False)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_path = temp_file.name

            sample_rate = 16000
            num_channels = 1
            sample_width = 2  # 16-bit

            temp_file.write(b"RIFF")
            temp_file.write(struct.pack("<I", len(audio_data) + 36))
            temp_file.write(b"WAVE")
            temp_file.write(b"fmt ")
            temp_file.write(struct.pack("<I", 16))
            temp_file.write(struct.pack("<H", 1))
            temp_file.write(struct.pack("<H", num_channels))
            temp_file.write(struct.pack("<I", sample_rate))
            temp_file.write(struct.pack("<I", sample_rate * num_channels * sample_width))
            temp_file.write(struct.pack("<H", num_channels * sample_width))
            temp_file.write(struct.pack("<H", sample_width * 8))
            temp_file.write(b"data")
            temp_file.write(struct.pack("<I", len(audio_data)))
            temp_file.write(audio_data)

        result = transcribe_audio(model_instance, temp_path)
        return json.dumps(result, ensure_ascii=False)

    except Exception as e:
        return json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False)

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception:
                pass


if __name__ == "__main__":
    # UTF-8 вывод
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        result = process_audio_file(audio_file)
        print(result, flush=True)
    else:
        result = process_audio_stream()
        print(result, flush=True)