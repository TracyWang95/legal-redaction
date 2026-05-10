"""
专利附图生成脚本
专利名称：一种基于多模态混合识别的文档数据匿名化方法及系统
生成7张黑白专利标准附图
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np
import os

# ── 全局设置 ──
matplotlib.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei']
matplotlib.rcParams['axes.unicode_minus'] = False

OUTPUT_DIR = r"D:\DataInfra-RedactionEverything\docs\patent"
DPI = 300
FIG_WIDTH_CM = 18
FIG_HEIGHT_CM = 24

def cm2inch(cm):
    return cm / 2.54

def new_fig(height_cm=FIG_HEIGHT_CM):
    fig, ax = plt.subplots(figsize=(cm2inch(FIG_WIDTH_CM), cm2inch(height_cm)))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis('off')
    fig.patch.set_facecolor('white')
    return fig, ax

def draw_box(ax, x, y, w, h, text, fontsize=8, linewidth=1.2, rounding=0.05, text_kwargs=None):
    """Draw a rounded rectangle with centered text."""
    box = FancyBboxPatch((x - w/2, y - h/2), w, h,
                         boxstyle=f"round,pad=0,rounding_size={rounding}",
                         facecolor='white', edgecolor='black', linewidth=linewidth)
    ax.add_patch(box)
    kw = dict(ha='center', va='center', fontsize=fontsize, color='black',
              fontfamily='SimHei', linespacing=1.5)
    if text_kwargs:
        kw.update(text_kwargs)
    ax.text(x, y, text, **kw)
    return box

def draw_arrow(ax, x1, y1, x2, y2, style='->', lw=1.2):
    arrow = FancyArrowPatch((x1, y1), (x2, y2),
                            arrowstyle=style, mutation_scale=12,
                            lw=lw, color='black')
    ax.add_patch(arrow)
    return arrow

def draw_diamond(ax, cx, cy, w, h, text, fontsize=7.5):
    """Draw a diamond (rhombus) shape."""
    verts = [(cx, cy + h/2), (cx + w/2, cy), (cx, cy - h/2), (cx - w/2, cy), (cx, cy + h/2)]
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    ax.plot(xs, ys, 'k-', linewidth=1.2)
    ax.fill(xs, ys, facecolor='white', edgecolor='black', linewidth=1.2)
    ax.text(cx, cy, text, ha='center', va='center', fontsize=fontsize,
            fontfamily='SimHei')

def add_fig_label(ax, label):
    ax.text(2, 97, label, ha='left', va='top', fontsize=12, fontweight='bold',
            fontfamily='SimHei')

def save_fig(fig, filename):
    filepath = os.path.join(OUTPUT_DIR, filename)
    fig.savefig(filepath, dpi=DPI, bbox_inches='tight', facecolor='white',
                edgecolor='none', pad_inches=0.3)
    plt.close(fig)
    print(f"  Saved: {filepath}")


# ============================================================
# 图1：整体方法流程图
# ============================================================
def fig1():
    fig, ax = new_fig(28)
    add_fig_label(ax, "图1")

    # Title
    ax.text(50, 96, "整体方法流程图", ha='center', va='top', fontsize=11,
            fontweight='bold', fontfamily='SimHei')

    # Steps
    steps = [
        ("S1: 接收待匿名化文档，\n检测文档类型", 50, 84),
        ("S2: 自适应路由至\n敏感信息识别管线", 50, 66),
        ("S3: 对识别的敏感实体\n进行共指消解标注", 50, 40),
        ("S4: 根据替换策略生成\n全文一致的匿名化替换映射", 50, 26),
        ("S5: 执行文档内容替换和/或\n图像区域遮蔽，\n输出匿名化文档", 50, 11),
    ]
    bw, bh = 42, 9
    for text, x, y in steps:
        draw_box(ax, x, y, bw, bh, text, fontsize=8.5)

    # Arrows between main steps
    draw_arrow(ax, 50, 84 - bh/2, 50, 66 + bh/2)

    # S2 branching boxes
    draw_box(ax, 27, 53, 30, 7, "文本类文档\n→ 三级混合NER管线", fontsize=7.5)
    draw_box(ax, 73, 53, 30, 7, "扫描/图像文档\n→ 双管线视觉检测", fontsize=7.5)

    # S2 to branches
    draw_arrow(ax, 50 - 5, 66 - bh/2, 27 + 5, 53 + 3.5)
    draw_arrow(ax, 50 + 5, 66 - bh/2, 73 - 5, 53 + 3.5)

    # Branches merge to S3
    draw_arrow(ax, 27, 53 - 3.5, 50 - 5, 40 + bh/2)
    draw_arrow(ax, 73, 53 - 3.5, 50 + 5, 40 + bh/2)

    # S3 -> S4
    draw_arrow(ax, 50, 40 - bh/2, 50, 26 + bh/2)
    # S4 -> S5
    draw_arrow(ax, 50, 26 - bh/2, 50, 11 + bh/2)

    save_fig(fig, "fig1_整体方法流程.png")

# ============================================================
# 图2：三级混合NER流程图
# ============================================================
def fig2():
    fig, ax = new_fig(30)
    add_fig_label(ax, "图2")
    ax.text(50, 96, "三级混合NER流程图", ha='center', va='top', fontsize=11,
            fontweight='bold', fontfamily='SimHei')

    # Input
    ax.text(50, 91, "输入：文本内容", ha='center', va='center', fontsize=9,
            fontfamily='SimHei')
    draw_arrow(ax, 50, 89.5, 50, 86)

    # Level 1
    draw_box(ax, 50, 80, 50, 10,
             "第一级：本地语言模型NER\n（轻量LLM，0.6B参数）\n输出：实体列表A",
             fontsize=8)
    draw_arrow(ax, 50, 75, 50, 71)

    # Level 2
    draw_box(ax, 50, 65, 50, 10,
             "第二级：正则表达式检测\n（10+内置模式，置信度0.99）\n输出：实体列表B",
             fontsize=8)
    draw_arrow(ax, 50, 60, 50, 55.5)

    # Level 3
    draw_box(ax, 50, 44, 54, 20,
             "第三级：交叉验证与去重\n\n"
             "① 位置校验 text[start:end]\n"
             "② 重叠检测 used_positions\n"
             "③ 置信度排序（正则>LLM>手动）\n"
             "④ 类型优先级排序\n"
             "⑤ 共指消解标注 coref_id",
             fontsize=7.5)
    draw_arrow(ax, 50, 34, 50, 30)

    # Output
    ax.text(50, 27, "输出：去重后的实体列表（含coref_id）", ha='center', va='center',
            fontsize=9, fontfamily='SimHei')

    save_fig(fig, "fig2_三级混合NER.png")


# ============================================================
# 图3：双管线视觉检测流程图
# ============================================================
def fig3():
    fig, ax = new_fig(32)
    add_fig_label(ax, "图3")
    ax.text(50, 97, "双管线视觉检测流程图", ha='center', va='top', fontsize=11,
            fontweight='bold', fontfamily='SimHei')

    # Input
    ax.text(50, 93, "输入：图像/扫描件", ha='center', va='center', fontsize=9,
            fontfamily='SimHei')
    draw_arrow(ax, 50, 91.5, 50, 89)

    # Parallel split label
    ax.text(50, 88, "（并行执行）", ha='center', va='center', fontsize=7.5,
            fontfamily='SimHei', style='italic')

    # Split arrows
    draw_arrow(ax, 50, 87, 30, 82)
    draw_arrow(ax, 50, 87, 70, 82)

    # Pipeline A box
    pipeA_text = (
        "管线A：OCR+NER语义\n\n"
        "PaddleOCR-VL\n"
        "文字块提取\n"
        "    ↓\n"
        "表格展开\n"
        "    ↓\n"
        "HaS NER分析\n"
        "    ↓\n"
        "实体坐标回映\n"
        "    ↓\n"
        "正则规则补充\n\n"
        "输出：敏感区域列表A"
    )
    draw_box(ax, 30, 57, 32, 46, pipeA_text, fontsize=7, rounding=0.03)

    # Pipeline B box
    pipeB_text = (
        "管线B：视觉目标检测\n\n"
        "YOLO11实例\n"
        "分割模型\n\n"
        "21类隐私区域\n"
        "（人脸/印章/\n"
        " 证件/二维码\n"
        " 等）\n\n\n\n"
        "输出：敏感区域列表B"
    )
    draw_box(ax, 70, 57, 32, 46, pipeB_text, fontsize=7, rounding=0.03)

    # Merge arrows
    draw_arrow(ax, 30, 34, 50, 30)
    draw_arrow(ax, 70, 34, 50, 30)

    # Merge box
    draw_box(ax, 50, 25, 40, 8,
             "IoU阈值去重合并\n（阈值=0.3，OCR优先）", fontsize=8)
    draw_arrow(ax, 50, 21, 50, 17)

    # Output
    ax.text(50, 14, "输出：合并后的敏感区域列表", ha='center', va='center',
            fontsize=9, fontfamily='SimHei')

    save_fig(fig, "fig3_双管线视觉检测.png")


# ============================================================
# 图4：共指消解与一致性替换流程图
# ============================================================
def fig4():
    fig, ax = new_fig(30)
    add_fig_label(ax, "图4")
    ax.text(50, 97, "共指消解与一致性替换流程图", ha='center', va='top', fontsize=11,
            fontweight='bold', fontfamily='SimHei')

    # Input
    ax.text(50, 92, "检测到的实体列表", ha='center', va='center', fontsize=9,
            fontfamily='SimHei')
    draw_arrow(ax, 50, 90.5, 50, 87)

    # Coreference box
    coref_text = (
        "共指消解标注\n\n"
        'key = (text, type)\n'
        '相同key → 相同coref_id\n'
        '例：\n'
        '"张三",PERSON → coref_001\n'
        '"张三",PERSON → coref_001\n'
        '"北京银行",ORG → coref_002'
    )
    draw_box(ax, 50, 76, 50, 19, coref_text, fontsize=7.5)
    draw_arrow(ax, 50, 66.5, 50, 63)

    # Strategy selection box - draw outer box and inner table manually
    outer_x, outer_y, outer_w, outer_h = 50, 51, 52, 20
    draw_box(ax, outer_x, outer_y, outer_w, outer_h, "", fontsize=7)
    ax.text(outer_x, outer_y + outer_h/2 - 2.5, "选择替换策略", ha='center', va='center',
            fontsize=8, fontfamily='SimHei', fontweight='bold')

    # Draw 3-column table inside the box
    tbl_top = outer_y + 4.5
    tbl_bot = outer_y - outer_h/2 + 1.5
    tbl_left = outer_x - outer_w/2 + 4
    tbl_right = outer_x + outer_w/2 - 4
    col_w = (tbl_right - tbl_left) / 3
    tbl_mid = tbl_top - (tbl_top - tbl_bot) * 0.25  # header separator

    # Table border
    ax.plot([tbl_left, tbl_right], [tbl_top, tbl_top], 'k-', lw=0.8)
    ax.plot([tbl_left, tbl_right], [tbl_bot, tbl_bot], 'k-', lw=0.8)
    ax.plot([tbl_left, tbl_left], [tbl_top, tbl_bot], 'k-', lw=0.8)
    ax.plot([tbl_right, tbl_right], [tbl_top, tbl_bot], 'k-', lw=0.8)
    # Column dividers
    ax.plot([tbl_left + col_w, tbl_left + col_w], [tbl_top, tbl_bot], 'k-', lw=0.5)
    ax.plot([tbl_left + 2*col_w, tbl_left + 2*col_w], [tbl_top, tbl_bot], 'k-', lw=0.5)
    # Header separator
    ax.plot([tbl_left, tbl_right], [tbl_mid, tbl_mid], 'k-', lw=0.5)

    # Header text
    headers = ["SMART", "MASK", "STRUCT"]
    for i, h in enumerate(headers):
        cx = tbl_left + col_w * (i + 0.5)
        ax.text(cx, (tbl_top + tbl_mid)/2, h, ha='center', va='center',
                fontsize=7, fontfamily='SimHei', fontweight='bold')

    # Body text
    body = [
        ("智能编号\n[人名一]", "部分遮蔽\n张*\n138****", "语义标签\n<人物\n[001]>"),
    ]
    for row in body:
        for i, cell in enumerate(row):
            cx = tbl_left + col_w * (i + 0.5)
            ax.text(cx, (tbl_mid + tbl_bot)/2, cell, ha='center', va='center',
                    fontsize=6.5, fontfamily='SimHei', linespacing=1.4)

    draw_arrow(ax, 50, 41, 50, 38)

    # Consistency mapping box
    map_text = (
        "一致性替换映射\n\n"
        "coref_id → 替换文本\n"
        "coref_001 → [人名一]\n"
        "coref_002 → [机构一]\n\n"
        "全文所有同coref_id实体\n"
        "使用相同替换文本"
    )
    draw_box(ax, 50, 27, 50, 18, map_text, fontsize=7.5)
    draw_arrow(ax, 50, 18, 50, 14)

    # Output
    ax.text(50, 11, "输出：entity_map {原文→替换文本}", ha='center', va='center',
            fontsize=9, fontfamily='SimHei')

    save_fig(fig, "fig4_共指消解替换.png")


# ============================================================
# 图5：系统架构框图
# ============================================================
def fig5():
    fig, ax = new_fig(22)
    add_fig_label(ax, "图5")
    ax.text(50, 97, "系统架构框图", ha='center', va='top', fontsize=11,
            fontweight='bold', fontfamily='SimHei')

    layer_w = 82
    layer_h = 22
    layer_x = 50
    gap = 2
    inner_pad = 2

    # Layer positions (top to bottom)
    layers = [
        ("应用层", 78),
        ("核心服务层", 53),
        ("基础模型层", 28),
    ]

    for label, cy in layers:
        # Outer frame
        box = FancyBboxPatch((layer_x - layer_w/2, cy - layer_h/2), layer_w, layer_h,
                             boxstyle="round,pad=0,rounding_size=0.02",
                             facecolor='white', edgecolor='black', linewidth=1.5)
        ax.add_patch(box)
        # Layer label at top
        ax.text(layer_x, cy + layer_h/2 - 2.5, label, ha='center', va='top',
                fontsize=9, fontweight='bold', fontfamily='SimHei')

    # ── 应用层 inner boxes ──
    app_y = 73
    app_boxes = [("批量任务\n管理模块", 22), ("单文档\n处理模块", 50), ("审阅管理\n（草稿/确认）", 72)]
    for text, bx in app_boxes:
        draw_box(ax, bx, app_y, 22, 8, text, fontsize=7.5)

    # ── 核心服务层 inner boxes ──
    core_y = 48
    core_boxes = [("三级混合\nNER", 22), ("双管线视觉\n检测", 50), ("匿名化替换引擎\n（共指+四策略）", 72)]
    for text, bx in core_boxes:
        draw_box(ax, bx, core_y, 22, 8, text, fontsize=7.5)

    # ── 基础模型层 inner boxes ──
    base_y = 23
    base_boxes = [("HaS LLM\n(0.6B)", 17), ("PaddleOCR-VL\n(OCR)", 39),
                  ("YOLO11\n(视觉)", 61), ("正则引擎", 80)]
    for text, bx in base_boxes:
        w = 18 if bx != 80 else 16
        draw_box(ax, bx, base_y, w, 8, text, fontsize=7.5)

    save_fig(fig, "fig5_系统架构.png")


# ============================================================
# 图6：批量处理状态机
# ============================================================
def fig6():
    fig, ax = new_fig(22)
    add_fig_label(ax, "图6")
    ax.text(50, 97, "批量处理状态机", ha='center', va='top', fontsize=11,
            fontweight='bold', fontfamily='SimHei')

    # State positions in a flow (2 rows to fit)
    states_row1 = [
        ("QUEUED", 8, 75),
        ("PARSING", 26, 75),
        ("NER", 44, 75),
        ("VISION", 62, 75),
    ]
    states_row2 = [
        ("AWAITING\n_REVIEW", 22, 55),
        ("REDACTING", 50, 55),
        ("COMPLETED", 78, 55),
    ]

    sw, sh = 15, 8

    def draw_state(ax, text, x, y):
        box = FancyBboxPatch((x - sw/2, y - sh/2), sw, sh,
                             boxstyle="round,pad=0,rounding_size=1.5",
                             facecolor='white', edgecolor='black', linewidth=1.2)
        ax.add_patch(box)
        ax.text(x, y, text, ha='center', va='center', fontsize=6.5,
                fontfamily='SimHei')

    for text, x, y in states_row1:
        draw_state(ax, text, x, y)
    for text, x, y in states_row2:
        draw_state(ax, text, x, y)

    # Row 1 arrows
    draw_arrow(ax, 8 + sw/2, 75, 26 - sw/2, 75)
    draw_arrow(ax, 26 + sw/2, 75, 44 - sw/2, 75)
    draw_arrow(ax, 44 + sw/2, 75, 62 - sw/2, 75)

    # VISION -> AWAITING_REVIEW
    draw_arrow(ax, 62, 75 - sh/2, 22 + 3, 55 + sh/2)

    # Row 2 arrows
    draw_arrow(ax, 22 + sw/2, 55, 50 - sw/2, 55)
    draw_arrow(ax, 50 + sw/2, 55, 78 - sw/2, 55)

    # 审阅不通过 loop: REDACTING -> AWAITING_REVIEW
    ax.annotate("", xy=(22 + sw/2, 55 - sh/2 + 1), xytext=(50 - sw/2, 55 - sh/2 + 1),
                arrowprops=dict(arrowstyle='->', lw=1, color='black',
                                connectionstyle='arc3,rad=0.3'))
    ax.text(36, 43, "审阅不通过", ha='center', va='center', fontsize=6.5,
            fontfamily='SimHei')

    # 可选跳过审阅: VISION -> REDACTING (skip AWAITING_REVIEW)
    ax.annotate("", xy=(50, 55 + sh/2), xytext=(62 + 2, 75 - sh/2),
                arrowprops=dict(arrowstyle='->', lw=1, color='black',
                                connectionstyle='arc3,rad=-0.2', linestyle='dashed'))
    ax.text(64, 64, "可选跳过审阅", ha='center', va='center', fontsize=6,
            fontfamily='SimHei')

    # CANCELLED and FAILED
    draw_state(ax, "CANCELLED", 22, 30)
    draw_state(ax, "FAILED", 60, 30)

    ax.text(22, 37, "任何状态\n（用户取消）", ha='center', va='center', fontsize=6,
            fontfamily='SimHei')
    ax.text(60, 37, "任何状态\n（处理异常）", ha='center', va='center', fontsize=6,
            fontfamily='SimHei')

    # Dashed arrows pointing down to CANCELLED and FAILED
    for sx, sy in [(8, 75), (26, 75), (44, 75), (62, 75), (22, 55), (50, 55), (78, 55)]:
        pass  # Skip individual arrows; the text label is sufficient

    # Draw a single representative arrow from main flow to CANCELLED/FAILED
    ax.annotate("", xy=(22, 30 + sh/2), xytext=(44, 75 - sh/2),
                arrowprops=dict(arrowstyle='->', lw=0.8, color='black',
                                linestyle='dotted', connectionstyle='arc3,rad=0.3'))
    ax.annotate("", xy=(60, 30 + sh/2), xytext=(50, 55 - sh/2),
                arrowprops=dict(arrowstyle='->', lw=0.8, color='black',
                                linestyle='dotted', connectionstyle='arc3,rad=-0.2'))

    save_fig(fig, "fig6_批量处理状态机.png")


# ============================================================
# 图7：文档类型自适应路由判定流程图
# ============================================================
def fig7():
    fig, ax = new_fig(26)
    add_fig_label(ax, "图7")
    ax.text(50, 97, "文档类型自适应路由判定流程图", ha='center', va='top', fontsize=11,
            fontweight='bold', fontfamily='SimHei')

    # Input
    ax.text(50, 90, "输入文档", ha='center', va='center', fontsize=9,
            fontfamily='SimHei')
    draw_arrow(ax, 50, 88, 50, 84)

    # Diamond 1: 文档格式？
    draw_diamond(ax, 50, 78, 28, 10, "文档格式？", fontsize=8.5)

    # DOCX/TXT -> left
    draw_arrow(ax, 50 - 14, 78, 14, 78)
    ax.text(28, 80, "DOCX/TXT", ha='center', va='bottom', fontsize=7,
            fontfamily='SimHei')
    draw_box(ax, 14, 70, 22, 7, "文本NER管线", fontsize=8)
    draw_arrow(ax, 14, 78 - 3, 14, 70 + 3.5)

    # 图像 -> right
    draw_arrow(ax, 50 + 14, 78, 86, 78)
    ax.text(72, 80, "图像(JPG/PNG)", ha='center', va='bottom', fontsize=7,
            fontfamily='SimHei')
    draw_box(ax, 86, 70, 22, 7, "双管线视觉检测", fontsize=8)
    draw_arrow(ax, 86, 78 - 3, 86, 70 + 3.5)

    # PDF -> down
    draw_arrow(ax, 50, 78 - 5, 50, 64)
    ax.text(52, 69, "PDF", ha='left', va='center', fontsize=7,
            fontfamily='SimHei')

    # Diamond 2: 文本密度
    draw_diamond(ax, 50, 57, 36, 12, "文本密度\n≥100字符/页？", fontsize=8)

    # Yes -> left to 文本NER管线
    draw_arrow(ax, 50 - 18, 57, 14, 57)
    ax.text(28, 59, "是", ha='center', va='bottom', fontsize=7.5,
            fontfamily='SimHei')
    draw_box(ax, 14, 49, 22, 7, "文本NER管线", fontsize=8)
    draw_arrow(ax, 14, 57 - 3, 14, 49 + 3.5)

    # No -> right to 双管线视觉检测
    draw_arrow(ax, 50 + 18, 57, 86, 57)
    ax.text(72, 59, "否（扫描件）", ha='center', va='bottom', fontsize=7,
            fontfamily='SimHei')
    draw_box(ax, 86, 49, 22, 7, "双管线视觉检测", fontsize=8)
    draw_arrow(ax, 86, 57 - 3, 86, 49 + 3.5)

    save_fig(fig, "fig7_自适应路由.png")


# ============================================================
# Main
# ============================================================
if __name__ == "__main__":
    print("开始生成专利附图...")
    fig1()
    print("  [1/7] 图1 完成")
    fig2()
    print("  [2/7] 图2 完成")
    fig3()
    print("  [3/7] 图3 完成")
    fig4()
    print("  [4/7] 图4 完成")
    fig5()
    print("  [5/7] 图5 完成")
    fig6()
    print("  [6/7] 图6 完成")
    fig7()
    print("  [7/7] 图7 完成")
    print("\n全部7张专利附图已生成完毕！")
    print(f"输出目录：{OUTPUT_DIR}")
