#!/usr/bin/env python3
"""Save a TTS key to the shared VideoCutEditor .env, without echoing it."""
import getpass
import os
from pathlib import Path
from dotenv import set_key

ROOT = Path(__file__).resolve().parents[3]


def save_config(key):
    if not key.strip() or '\n' in key or '\r' in key:
        raise ValueError('API Key must be nonempty and on one line')
    path = ROOT / '.env'
    if path.is_symlink():
        raise ValueError('Refusing to write to a symlink .env')
    previous = os.umask(0o077)
    try:
        path.touch(mode=0o600, exist_ok=True)
        path.chmod(0o600)
        set_key(str(path), 'DOUBAO_TTS_API_KEY', key.strip())
        set_key(str(path), 'DOUBAO_TTS_RESOURCE_ID', 'seed-tts-2.0')
        path.chmod(0o600)
    finally:
        os.umask(previous)
    return path


if __name__ == '__main__':
    key = getpass.getpass('New Doubao TTS API Key (hidden): ')
    path = save_config(key)
    print(f'Saved to {path}. Future runs load it automatically. Key not displayed.')
