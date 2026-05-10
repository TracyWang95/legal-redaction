"""
vision subpackage - focused modules split from hybrid_vision_service.py.

Re-exports for backward compatibility:
    from app.services.vision import ocr_pipeline, image_pipeline, region_merger
"""
from app.services.vision.image_pipeline import (
    apply_redaction,
    draw_regions_on_image,
    match_ocr_to_vlm,
)
from app.services.vision.ocr_pipeline import (
    expand_table_blocks,
    extract_table_cells,
    match_entities_to_ocr,
    prepare_image,
    run_has_text_analysis,
    run_paddle_ocr,
)
from app.services.vision.region_merger import (
    calc_iou_boxes,
    calc_iou_regions,
    merge_regions,
)

__all__ = [
    # ocr_pipeline
    "prepare_image",
    "run_paddle_ocr",
    "extract_table_cells",
    "expand_table_blocks",
    "run_has_text_analysis",
    "match_entities_to_ocr",
    # image_pipeline
    "match_ocr_to_vlm",
    "draw_regions_on_image",
    "apply_redaction",
    # region_merger
    "calc_iou_boxes",
    "calc_iou_regions",
    "merge_regions",
]
