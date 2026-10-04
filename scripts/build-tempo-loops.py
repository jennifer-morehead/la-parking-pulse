"""Rebuild iOS pitch-preserving tempo assets with FFmpeg (no Python packages)."""
import array
from pathlib import Path
import subprocess
import wave

root = Path(__file__).resolve().parents[1]
source = root / 'assets/looperman-dark-synth-seamless.wav'
output = root / 'assets/tempo'
output.mkdir(exist_ok=True)
with wave.open(str(source)) as audio:
    sample_rate = audio.getframerate()
    duration = audio.getnframes() / sample_rate

for index in (8, 9, 11, 12, 13, 14):
    # Render three cycles and use the middle one to avoid filter startup/tail.
    frames = round(sample_rate * duration / (index / 10))
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-stream_loop', '2', '-i', str(source),
        '-af', f'atempo={index / 10},atrim=start_sample={frames}:end_sample={frames * 2}',
        '-f', 's16le', '-acodec', 'pcm_s16le', '-'
    ])
    samples = array.array('h', raw)
    count = len(samples) // 2
    overlap = round(sample_rate * 0.02)
    blended = samples[overlap * 2:(count - overlap) * 2]
    for frame in range(overlap):
        weight = frame / (overlap - 1)
        for channel in range(2):
            tail = samples[(count - overlap + frame) * 2 + channel]
            head = samples[frame * 2 + channel]
            blended.append(round(tail * (1 - weight) + head * weight))
    path = output / f'loop-{index}.wav'
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((2, 2, sample_rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(blended.tobytes())
    print(path.relative_to(root))
