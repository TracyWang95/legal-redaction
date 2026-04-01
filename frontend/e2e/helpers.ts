import { type Page, type APIRequestContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 检查后端是否可用，返回 boolean */
export async function isBackendUp(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get('http://127.0.0.1:8000/health');
    return res.ok();
  } catch {
    return false;
  }
}

/** testdata 目录下的测试图片路径 */
export const TEST_IMAGE_PATH = path.resolve(__dirname, '../../testdata/ce.png');

/** 用户真实测试数据（D:\ceshi） */
export const REAL_TEST_FILES = {
  image: 'D:/ceshi/图片_20260131115035_543_3.png',
  docx1: 'D:/ceshi/数据提供合同_成品-499464daa5.docx',
  docx2: 'D:/ceshi/数据提供合同_成品-d49d74b676.docx',
};

/** 等待页面网络空闲（用于 SPA 路由切换后） */
export async function waitForPageReady(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

/** 关闭 OnboardingGuide 弹窗（首次访问时会出现） */
export async function dismissOnboarding(page: Page) {
  // OnboardingGuide 弹窗 z-[10000]，需先关闭才能操作页面
  const skipBtn = page.getByRole('button', { name: /跳过引导|开始使用/ }).first();
  if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipBtn.click();
    // 等待弹窗消失
    await page.locator('.fixed.inset-0.z-\\[10000\\]').waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  }
}

/** 侧边栏导航项列表 — 与 Layout 中 navItems 对应 */
export const SIDEBAR_NAV = [
  { label: 'Playground', path: '/' },
  { label: '批量任务', path: '/batch' },
  { label: '处理历史', path: '/history' },
  { label: '任务中心', path: '/jobs' },
  { label: '脱敏清单', path: '/settings/redaction' },
  { label: '识别项配置', path: '/settings' },
] as const;

export const MODEL_NAV = [
  { label: '文本模型配置', path: '/model-settings/text' },
  { label: '视觉服务配置', path: '/model-settings/vision' },
] as const;
