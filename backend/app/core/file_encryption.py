"""
文件加密存储 — AES-256-GCM 对上传文件加密落盘。

密钥管理：
- 首次启动自动生成 256 位密钥，持久化到 data/encryption_key.json
- 密钥文件权限 600（仅属主可读）
- 可通过环境变量 FILE_ENCRYPTION_KEY 覆盖

加密格式：
- [16 bytes nonce] + [N bytes ciphertext] + [16 bytes tag]
"""
import json
import logging
import os
import secrets

logger = logging.getLogger(__name__)

_KEY_LENGTH = 32  # AES-256


def _load_or_create_key(data_dir: str) -> bytes:
    """加载或生成文件加密密钥。"""
    # 环境变量优先
    env_key = os.environ.get("FILE_ENCRYPTION_KEY", "").strip()
    if env_key:
        try:
            key = bytes.fromhex(env_key)
        except ValueError:
            logger.warning("FILE_ENCRYPTION_KEY 不是有效的十六进制字符串，使用持久化密钥")
        else:
            if len(key) == _KEY_LENGTH:
                return key
            logger.warning("FILE_ENCRYPTION_KEY 长度不正确 (%d bytes)，使用持久化密钥", len(key))

    key_path = os.path.join(data_dir, "encryption_key.json")
    if os.path.exists(key_path):
        try:
            raw, needs_upgrade = _read_key_file(key_path)
            key = bytes.fromhex(raw)
            if len(key) == _KEY_LENGTH:
                # Auto-migrate old plaintext keys to DPAPI on Windows
                if needs_upgrade:
                    try:
                        _write_key_file(key_path, raw)
                        logger.info("Migrated encryption key to DPAPI-protected format")
                    except Exception:
                        logger.warning("Failed to migrate key to DPAPI format")
                return key
        except Exception:
            logger.warning("加密密钥文件损坏，重新生成")

    # 生成新密钥
    key = secrets.token_bytes(_KEY_LENGTH)
    os.makedirs(data_dir, exist_ok=True)
    _write_key_file(key_path, key.hex())
    logger.info("Generated new file encryption key: %s", key_path)
    return key


def _read_key_file(key_path: str) -> tuple[str, bool]:
    """Read hex key from file, decrypting with DPAPI on Windows.

    Returns (hex_key, needs_upgrade) where needs_upgrade is True when the key
    was read from a plaintext file on Windows and should be migrated to DPAPI.
    """
    with open(key_path) as f:
        data = json.load(f)

    if os.name == "nt" and data.get("dpapi"):
        import base64
        import ctypes
        import ctypes.wintypes

        class DpapiBlob(ctypes.Structure):
            _fields_ = [("cbData", ctypes.wintypes.DWORD),
                         ("pbData", ctypes.POINTER(ctypes.c_char))]

        encrypted = base64.b64decode(data["dpapi"])
        blob_in = DpapiBlob(len(encrypted), ctypes.create_string_buffer(encrypted, len(encrypted)))
        blob_out = DpapiBlob()

        try:
            if ctypes.windll.crypt32.CryptUnprotectData(
                ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
            ):
                result = ctypes.string_at(blob_out.pbData, blob_out.cbData).decode()
                return result, False
            raise OSError("DPAPI decryption failed")
        finally:
            if blob_out.pbData:
                ctypes.windll.kernel32.LocalFree(blob_out.pbData)

    # Plaintext format — flag for upgrade if on Windows
    needs_upgrade = os.name == "nt" and "key" in data
    return data.get("key", ""), needs_upgrade


def _write_key_file(key_path: str, hex_key: str) -> None:
    """Write hex key to file, encrypting with DPAPI on Windows."""
    if os.name == "nt":
        try:
            import base64
            import ctypes
            import ctypes.wintypes

            class DpapiBlob(ctypes.Structure):
                _fields_ = [("cbData", ctypes.wintypes.DWORD),
                             ("pbData", ctypes.POINTER(ctypes.c_char))]

            raw = hex_key.encode()
            blob_in = DpapiBlob(len(raw), ctypes.create_string_buffer(raw, len(raw)))
            blob_out = DpapiBlob()

            if ctypes.windll.crypt32.CryptProtectData(
                ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
            ):
                encrypted = ctypes.string_at(blob_out.pbData, blob_out.cbData)
                ctypes.windll.kernel32.LocalFree(blob_out.pbData)
                with open(key_path, "w") as f:
                    json.dump({"dpapi": base64.b64encode(encrypted).decode()}, f)
                # Hide file on Windows
                try:
                    ctypes.windll.kernel32.SetFileAttributesW(key_path, 0x2)
                except Exception:
                    pass
                return
        except Exception:
            logger.error(
                "DPAPI 加密失败，密钥将以明文存储且 Windows 上无权限保护。"
                "强烈建议通过 FILE_ENCRYPTION_KEY 环境变量配置密钥。"
            )

    # Unix or DPAPI fallback
    with open(key_path, "w") as f:
        json.dump({"key": hex_key}, f)
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        if os.name == "nt":
            logger.warning(
                "Windows: 密钥文件 '%s' 无法设置权限保护。"
                "建议使用 FILE_ENCRYPTION_KEY 环境变量替代文件存储。",
                key_path,
            )


class FileEncryptor:
    """AES-256-GCM 文件加密/解密。"""

    def __init__(self, data_dir: str, enabled: bool = False):
        self.enabled = enabled
        self._key: bytes | None = None
        self._data_dir = data_dir
        if enabled:
            self._key = _load_or_create_key(data_dir)

    def encrypt_file(self, input_path: str, output_path: str) -> None:
        """加密文件（就地或指定输出路径）。"""
        if not self.enabled or self._key is None:
            # 未启用加密，直接拷贝
            if input_path != output_path:
                import shutil
                shutil.copy2(input_path, output_path)
            return

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        aesgcm = AESGCM(self._key)
        nonce = secrets.token_bytes(16)

        with open(input_path, "rb") as f:
            plaintext = f.read()

        ciphertext = aesgcm.encrypt(nonce, plaintext, None)

        with open(output_path, "wb") as f:
            f.write(nonce)
            f.write(ciphertext)

    def decrypt_file(self, input_path: str, output_path: str) -> None:
        """解密文件。"""
        if not self.enabled or self._key is None:
            if input_path != output_path:
                import shutil
                shutil.copy2(input_path, output_path)
            return

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        aesgcm = AESGCM(self._key)

        with open(input_path, "rb") as f:
            data = f.read()

        nonce = data[:16]
        ciphertext = data[16:]

        plaintext = aesgcm.decrypt(nonce, ciphertext, None)

        with open(output_path, "wb") as f:
            f.write(plaintext)

    def decrypt_to_bytes(self, input_path: str) -> bytes:
        """解密文件到内存。"""
        if not self.enabled or self._key is None:
            with open(input_path, "rb") as f:
                return f.read()

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        aesgcm = AESGCM(self._key)

        with open(input_path, "rb") as f:
            data = f.read()

        nonce = data[:16]
        ciphertext = data[16:]
        return aesgcm.decrypt(nonce, ciphertext, None)
