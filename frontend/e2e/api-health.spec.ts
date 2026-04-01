import { test, expect } from '@playwright/test';
import { isBackendUp } from './helpers';

test.describe('后端 API 健康检查', () => {
  test('GET /health 基本健康', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/health');
    expect(res.ok()).toBeTruthy();
  });

  test('GET /health/services 返回服务状态', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/health/services');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('services');
    expect(body.services).toHaveProperty('paddle_ocr');
    expect(body.services).toHaveProperty('has_ner');
    expect(body.services).toHaveProperty('has_image');
    // 每个服务都应有 status 字段
    for (const key of ['paddle_ocr', 'has_ner', 'has_image']) {
      expect(body.services[key]).toHaveProperty('status');
      expect(['online', 'offline']).toContain(body.services[key].status);
    }
  });

  test('GET /health/services 返回 GPU 信息', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/health/services');
    const body = await res.json();
    // 4090 机器应该有 GPU 信息
    if (body.gpu_memory) {
      expect(body.gpu_memory).toHaveProperty('used_mb');
      expect(body.gpu_memory).toHaveProperty('total_mb');
      expect(body.gpu_memory.total_mb).toBeGreaterThan(0);
    }
  });

  test('GET /api/v1/auth/status 认证状态', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/auth/status');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('auth_enabled');
  });

  test('GET /api/v1/custom-types 实体类型列表', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/custom-types');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('custom_types');
    expect(Array.isArray(body.custom_types)).toBeTruthy();
  });

  test('GET /api/v1/redaction/entity-types 脱敏实体类型', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/redaction/entity-types');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('entity_types');
  });

  test('GET /api/v1/redaction/replacement-modes 替换模式', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/redaction/replacement-modes');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('replacement_modes');
  });

  test('GET /api/v1/presets 预设列表', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/presets');
    expect(res.ok()).toBeTruthy();
  });

  test('GET /api/v1/vision-pipelines Pipeline 配置', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/vision-pipelines');
    expect(res.ok()).toBeTruthy();
  });

  test('GET /api/v1/ner-backend NER 配置', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/ner-backend');
    expect(res.ok()).toBeTruthy();
  });
});
