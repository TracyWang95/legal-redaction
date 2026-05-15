from types import SimpleNamespace

from PIL import Image

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
