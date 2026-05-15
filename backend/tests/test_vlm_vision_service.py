from types import SimpleNamespace

from PIL import Image

from app.core.config import settings
from app.services.vlm_vision_service import VlmVisionService


def test_vlm_detection_uses_full_image_only_for_signature():
    image = Image.new("RGB", (800, 1000), "white")
    service = VlmVisionService()
    type_config = SimpleNamespace(id="signature", name="签字")

    views = service._detection_views(image, [type_config])

    assert [view.name for view in views] == ["full"]
    assert views[0].crop_x == 0
    assert views[0].crop_y == 0
    assert views[0].crop_width == 800
    assert views[0].crop_height == 1000


def test_full_image_boxes_map_directly_to_original_page():
    image = Image.new("RGB", (800, 1000), "white")
    service = VlmVisionService()
    type_config = SimpleNamespace(id="signature", name="签字")
    full = service._detection_views(image, [type_config])[0]

    boxes = service._objects_to_boxes(
        [
            {
                "type_id": "signature",
                "box_2d": [100, 800, 300, 900],
                "confidence": 0.9,
            }
        ],
        [type_config],
        full,
        page=2,
    )

    assert len(boxes) == 1
    box = boxes[0]
    assert box.page == 2
    assert box.type == "signature"
    assert box.x == 0.1
    assert box.y == 0.8
    assert box.width == 0.2
    assert box.height == 0.1


def test_signature_detection_uses_signature_specific_downscale(monkeypatch):
    monkeypatch.setattr(settings, "VLM_MAX_IMAGE_SIDE", 1024)
    monkeypatch.setattr(settings, "VLM_SIGNATURE_MAX_IMAGE_SIDE", 640, raising=False)
    image = Image.new("RGB", (2000, 1000), "white")
    service = VlmVisionService()
    type_config = SimpleNamespace(id="signature", name="signature")

    view = service._detection_views(image, [type_config])[0]

    assert view.width == 640
    assert view.height == 320
    assert view.max_side == 640
    assert view.crop_width == 2000
    assert view.crop_height == 1000
    assert view.original_width == 2000
    assert view.original_height == 1000


def test_non_signature_detection_uses_generic_downscale(monkeypatch):
    monkeypatch.setattr(settings, "VLM_MAX_IMAGE_SIDE", 1024)
    monkeypatch.setattr(settings, "VLM_SIGNATURE_MAX_IMAGE_SIDE", 640, raising=False)
    image = Image.new("RGB", (2000, 1000), "white")
    service = VlmVisionService()
    type_config = SimpleNamespace(id="custom_visual", name="custom visual")

    view = service._detection_views(image, [type_config])[0]

    assert view.width == 1024
    assert view.height == 512
    assert view.max_side == 1024
