# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Tests for AES-256-GCM file encryption module."""
from __future__ import annotations

import json
import os
import secrets

import pytest

from app.core.file_encryption import (
    _KEY_LENGTH,
    FileEncryptor,
    _load_or_create_key,
    _read_key_file,
)

# ── _load_or_create_key ─────────────────────────────────────


class TestLoadOrCreateKey:
    """Tests for the key generation / loading helper."""

    def test_generates_32_byte_key(self, tmp_path):
        """Key generation must produce a 256-bit (32-byte) key."""
        data_dir = str(tmp_path / "data")
        key = _load_or_create_key(data_dir)
        assert isinstance(key, bytes)
        assert len(key) == _KEY_LENGTH

    def test_key_persisted_to_file(self, tmp_path):
        """Generated key must be saved to encryption_key.json and be readable."""
        data_dir = str(tmp_path / "data")
        key = _load_or_create_key(data_dir)

        key_path = os.path.join(data_dir, "encryption_key.json")
        assert os.path.exists(key_path)

        # Read back through the same helper that _load_or_create_key uses,
        # which handles DPAPI on Windows and plain hex on Unix.
        stored_hex, _ = _read_key_file(key_path)
        assert bytes.fromhex(stored_hex) == key

    def test_key_reloaded_on_second_call(self, tmp_path):
        """Calling twice with the same data_dir returns the same key."""
        data_dir = str(tmp_path / "data")
        key1 = _load_or_create_key(data_dir)
        key2 = _load_or_create_key(data_dir)
        assert key1 == key2

    def test_env_var_override(self, tmp_path, monkeypatch):
        """FILE_ENCRYPTION_KEY env var should take precedence."""
        expected_key = secrets.token_bytes(_KEY_LENGTH)
        monkeypatch.setenv("FILE_ENCRYPTION_KEY", expected_key.hex())

        data_dir = str(tmp_path / "data")
        key = _load_or_create_key(data_dir)
        assert key == expected_key

    def test_env_var_wrong_length_falls_back(self, tmp_path, monkeypatch):
        """Env key with wrong length should be ignored; a persisted key is used instead."""
        bad_key = secrets.token_bytes(16)  # 16 bytes, not 32
        monkeypatch.setenv("FILE_ENCRYPTION_KEY", bad_key.hex())

        data_dir = str(tmp_path / "data")
        key = _load_or_create_key(data_dir)
        assert len(key) == _KEY_LENGTH
        assert key != bad_key  # must not use the invalid key

    def test_corrupted_key_file_triggers_regeneration(self, tmp_path):
        """A corrupted key file should be overwritten with a fresh key."""
        data_dir = str(tmp_path / "data")
        os.makedirs(data_dir, exist_ok=True)

        key_path = os.path.join(data_dir, "encryption_key.json")
        with open(key_path, "w") as f:
            f.write("NOT VALID JSON {{{")

        key = _load_or_create_key(data_dir)
        assert isinstance(key, bytes)
        assert len(key) == _KEY_LENGTH

        # The file should now contain a valid key readable by the helper
        stored_hex, _ = _read_key_file(key_path)
        assert bytes.fromhex(stored_hex) == key

    def test_corrupted_hex_in_key_file(self, tmp_path):
        """Valid JSON but invalid hex value should trigger regeneration."""
        data_dir = str(tmp_path / "data")
        os.makedirs(data_dir, exist_ok=True)

        key_path = os.path.join(data_dir, "encryption_key.json")
        with open(key_path, "w") as f:
            json.dump({"key": "not-a-hex-string"}, f)

        key = _load_or_create_key(data_dir)
        assert len(key) == _KEY_LENGTH

    def test_wrong_length_hex_in_key_file(self, tmp_path):
        """Valid hex but wrong length in key file should trigger regeneration."""
        data_dir = str(tmp_path / "data")
        os.makedirs(data_dir, exist_ok=True)

        key_path = os.path.join(data_dir, "encryption_key.json")
        short_key = secrets.token_bytes(8)
        with open(key_path, "w") as f:
            json.dump({"key": short_key.hex()}, f)

        key = _load_or_create_key(data_dir)
        assert len(key) == _KEY_LENGTH
        assert key != short_key


# ── FileEncryptor — encrypt / decrypt round-trip ────────────


class TestEncryptDecryptRoundTrip:
    """End-to-end encryption and decryption tests."""

    def _make_encryptor(self, tmp_path) -> FileEncryptor:
        data_dir = str(tmp_path / "data")
        return FileEncryptor(data_dir, enabled=True)

    def test_round_trip_basic(self, tmp_path):
        """Encrypt then decrypt must return the original bytes."""
        enc = self._make_encryptor(tmp_path)

        plaintext = b"Hello, redaction world!"
        src = tmp_path / "plain.bin"
        src.write_bytes(plaintext)

        encrypted = tmp_path / "encrypted.bin"
        decrypted = tmp_path / "decrypted.bin"

        enc.encrypt_file(str(src), str(encrypted))
        enc.decrypt_file(str(encrypted), str(decrypted))

        assert decrypted.read_bytes() == plaintext

    def test_encrypted_differs_from_plaintext(self, tmp_path):
        """Ciphertext must not equal the plaintext."""
        enc = self._make_encryptor(tmp_path)

        plaintext = b"Sensitive PII data 1234-5678"
        src = tmp_path / "plain.bin"
        src.write_bytes(plaintext)

        encrypted = tmp_path / "encrypted.bin"
        enc.encrypt_file(str(src), str(encrypted))

        assert encrypted.read_bytes() != plaintext

    def test_empty_file(self, tmp_path):
        """Encrypting an empty file should round-trip correctly."""
        enc = self._make_encryptor(tmp_path)

        src = tmp_path / "empty.bin"
        src.write_bytes(b"")

        encrypted = tmp_path / "encrypted.bin"
        decrypted = tmp_path / "decrypted.bin"

        enc.encrypt_file(str(src), str(encrypted))
        enc.decrypt_file(str(encrypted), str(decrypted))

        assert decrypted.read_bytes() == b""

    def test_small_file(self, tmp_path):
        """Single-byte file."""
        enc = self._make_encryptor(tmp_path)

        src = tmp_path / "tiny.bin"
        src.write_bytes(b"\x42")

        encrypted = tmp_path / "encrypted.bin"
        decrypted = tmp_path / "decrypted.bin"

        enc.encrypt_file(str(src), str(encrypted))
        enc.decrypt_file(str(encrypted), str(decrypted))

        assert decrypted.read_bytes() == b"\x42"

    def test_large_file(self, tmp_path):
        """1 MB+ file should encrypt and decrypt correctly."""
        enc = self._make_encryptor(tmp_path)

        plaintext = secrets.token_bytes(1_100_000)  # ~1.1 MB
        src = tmp_path / "large.bin"
        src.write_bytes(plaintext)

        encrypted = tmp_path / "encrypted.bin"
        decrypted = tmp_path / "decrypted.bin"

        enc.encrypt_file(str(src), str(encrypted))
        enc.decrypt_file(str(encrypted), str(decrypted))

        assert decrypted.read_bytes() == plaintext


# ── decrypt_to_bytes ────────────────────────────────────────


class TestDecryptToBytes:
    """Tests for the in-memory decryption helper."""

    def test_decrypt_to_bytes(self, tmp_path):
        """decrypt_to_bytes should return plaintext without writing a file."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=True)

        plaintext = b"PII: John Doe, SSN 123-45-6789"
        src = tmp_path / "source.bin"
        src.write_bytes(plaintext)

        encrypted = tmp_path / "encrypted.bin"
        enc.encrypt_file(str(src), str(encrypted))

        result = enc.decrypt_to_bytes(str(encrypted))
        assert result == plaintext

    def test_decrypt_to_bytes_disabled(self, tmp_path):
        """When disabled, decrypt_to_bytes returns raw file contents."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=False)

        raw = b"unencrypted data"
        src = tmp_path / "raw.bin"
        src.write_bytes(raw)

        assert enc.decrypt_to_bytes(str(src)) == raw


# ── Disabled mode ───────────────────────────────────────────


class TestDisabledMode:
    """When enabled=False, files should just be copied."""

    def test_encrypt_copies_when_disabled(self, tmp_path):
        """encrypt_file with enabled=False must produce a byte-for-byte copy."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=False)

        plaintext = b"no encryption here"
        src = tmp_path / "input.bin"
        src.write_bytes(plaintext)

        dst = tmp_path / "output.bin"
        enc.encrypt_file(str(src), str(dst))

        assert dst.read_bytes() == plaintext

    def test_decrypt_copies_when_disabled(self, tmp_path):
        """decrypt_file with enabled=False must produce a byte-for-byte copy."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=False)

        content = b"pass-through content"
        src = tmp_path / "input.bin"
        src.write_bytes(content)

        dst = tmp_path / "output.bin"
        enc.decrypt_file(str(src), str(dst))

        assert dst.read_bytes() == content

    def test_key_is_none_when_disabled(self, tmp_path):
        """No key should be loaded when encryption is disabled."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=False)
        assert enc._key is None


# ── Tamper detection ────────────────────────────────────────


class TestTamperDetection:
    """AES-GCM must reject tampered ciphertext."""

    def test_tampered_ciphertext_raises(self, tmp_path):
        """Flipping a byte in the ciphertext must cause decryption to fail."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=True)

        src = tmp_path / "plain.bin"
        src.write_bytes(b"Authenticate this content")

        encrypted = tmp_path / "encrypted.bin"
        enc.encrypt_file(str(src), str(encrypted))

        # Tamper with a byte in the middle of the ciphertext (after the 16-byte nonce)
        raw = bytearray(encrypted.read_bytes())
        tamper_idx = 20  # inside ciphertext region
        raw[tamper_idx] ^= 0xFF
        encrypted.write_bytes(bytes(raw))

        from cryptography.exceptions import InvalidTag

        with pytest.raises(InvalidTag):
            enc.decrypt_file(str(encrypted), str(tmp_path / "decrypted.bin"))

    def test_tampered_nonce_raises(self, tmp_path):
        """Flipping a byte in the nonce must cause decryption to fail."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=True)

        src = tmp_path / "plain.bin"
        src.write_bytes(b"Nonce integrity check")

        encrypted = tmp_path / "encrypted.bin"
        enc.encrypt_file(str(src), str(encrypted))

        raw = bytearray(encrypted.read_bytes())
        raw[0] ^= 0xFF  # tamper the first byte of the nonce
        encrypted.write_bytes(bytes(raw))

        from cryptography.exceptions import InvalidTag

        with pytest.raises(InvalidTag):
            enc.decrypt_file(str(encrypted), str(tmp_path / "decrypted.bin"))


# ── Wrong key ───────────────────────────────────────────────


class TestWrongKey:
    """Decrypting with a different key must fail."""

    def test_wrong_key_raises(self, tmp_path):
        """A file encrypted with one key cannot be decrypted with another."""
        data_dir_a = str(tmp_path / "key_a")
        data_dir_b = str(tmp_path / "key_b")

        enc_a = FileEncryptor(data_dir_a, enabled=True)
        enc_b = FileEncryptor(data_dir_b, enabled=True)

        # Verify the two encryptors have different keys
        assert enc_a._key != enc_b._key

        src = tmp_path / "plain.bin"
        src.write_bytes(b"Secret data for key A only")

        encrypted = tmp_path / "encrypted.bin"
        enc_a.encrypt_file(str(src), str(encrypted))

        from cryptography.exceptions import InvalidTag

        with pytest.raises(InvalidTag):
            enc_b.decrypt_file(str(encrypted), str(tmp_path / "decrypted.bin"))

    def test_wrong_key_decrypt_to_bytes_raises(self, tmp_path):
        """decrypt_to_bytes with the wrong key must also fail."""
        data_dir_a = str(tmp_path / "key_a")
        data_dir_b = str(tmp_path / "key_b")

        enc_a = FileEncryptor(data_dir_a, enabled=True)
        enc_b = FileEncryptor(data_dir_b, enabled=True)

        src = tmp_path / "plain.bin"
        src.write_bytes(b"Another secret")

        encrypted = tmp_path / "encrypted.bin"
        enc_a.encrypt_file(str(src), str(encrypted))

        from cryptography.exceptions import InvalidTag

        with pytest.raises(InvalidTag):
            enc_b.decrypt_to_bytes(str(encrypted))


# ── Nonce uniqueness ────────────────────────────────────────


class TestNonceUniqueness:
    """Each encryption call must use a fresh random nonce."""

    def test_same_plaintext_different_ciphertext(self, tmp_path):
        """Encrypting the same file twice must produce different ciphertexts."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=True)

        plaintext = b"Determinism is the enemy of encryption"
        src = tmp_path / "plain.bin"
        src.write_bytes(plaintext)

        enc1 = tmp_path / "enc1.bin"
        enc2 = tmp_path / "enc2.bin"

        enc.encrypt_file(str(src), str(enc1))
        enc.encrypt_file(str(src), str(enc2))

        ct1 = enc1.read_bytes()
        ct2 = enc2.read_bytes()

        # Ciphertexts must differ (different nonces)
        assert ct1 != ct2

        # The 16-byte nonces at the start must differ
        assert ct1[:16] != ct2[:16]

        # Both must decrypt to the same plaintext
        assert enc.decrypt_to_bytes(str(enc1)) == plaintext
        assert enc.decrypt_to_bytes(str(enc2)) == plaintext


# ── Additional edge cases (from Codex review) ─────────────


class TestEdgeCases:
    """Additional edge cases identified during code review."""

    def test_env_var_invalid_hex_falls_back(self, tmp_path, monkeypatch):
        """Non-hex FILE_ENCRYPTION_KEY should fall back to persisted key, not crash."""
        monkeypatch.setenv("FILE_ENCRYPTION_KEY", "not-hex-at-all")
        data_dir = str(tmp_path / "data")
        key = _load_or_create_key(data_dir)
        assert len(key) == 32

    def test_truncated_ciphertext_raises(self, tmp_path):
        """A ciphertext shorter than nonce + tag minimum should raise an error."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=True)

        # Write a truncated file (only 10 bytes, less than 16-byte nonce + 16-byte tag)
        truncated = tmp_path / "truncated.bin"
        truncated.write_bytes(b"0123456789")

        from cryptography.exceptions import InvalidTag

        with pytest.raises((InvalidTag, ValueError)):
            enc.decrypt_file(str(truncated), str(tmp_path / "out.bin"))

    def test_truncated_ciphertext_decrypt_to_bytes_raises(self, tmp_path):
        """decrypt_to_bytes on truncated ciphertext should also raise."""
        data_dir = str(tmp_path / "data")
        enc = FileEncryptor(data_dir, enabled=True)

        truncated = tmp_path / "truncated.bin"
        truncated.write_bytes(b"short")

        from cryptography.exceptions import InvalidTag

        with pytest.raises((InvalidTag, ValueError)):
            enc.decrypt_to_bytes(str(truncated))
