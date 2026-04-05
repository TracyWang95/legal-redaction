import { describe, expect, it } from 'vitest';
import { coerceDraftEmptyBatchPrimaryNav, resolveJobPrimaryNavigation } from './jobPrimaryNavigation';

const jid = '11111111-1111-1111-1111-111111111111';

describe('resolveJobPrimaryNavigation', () => {
  it('draft empty -> continue config', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      currentPage: 'job_detail',
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续配置');
      expect(action.to).toContain('/batch/text');
      expect(action.to).toContain('step=1');
    }
  });

  it('draft empty but wizard_furthest_step>=2 -> continue upload step 2', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      currentPage: 'job_detail',
      jobConfig: { wizard_furthest_step: 2 },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续上传');
      expect(action.to).toContain('/batch/text');
      expect(action.to).toContain('step=2');
    }
  });

  it('draft empty: wizard_furthest_step as string "2" still resolves', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      jobConfig: { wizard_furthest_step: '2' },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续上传');
      expect(action.to).toContain('step=2');
    }
  });

  it('draft empty: infer step 2 from entity_type_ids when wizard missing', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      navHints: { item_count: 0 },
      jobConfig: { entity_type_ids: ['name'] },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续上传');
      expect(action.to).toContain('/batch/text');
      expect(action.to).toContain('step=2');
    }
  });

  it('draft empty: image_batch infers from ocr_has_types', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'image_batch',
      items: [],
      navHints: { item_count: 0 },
      jobConfig: { ocr_has_types: ['x'] },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续上传');
      expect(action.to).toContain('/batch/image');
      expect(action.to).toContain('step=2');
    }
  });

  it('draft empty: smart_batch follows stored batch_wizard_mode', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'smart_batch',
      items: [],
      navHints: { item_count: 0 },
      jobConfig: { batch_wizard_mode: 'image', ocr_has_types: ['x'] },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.to).toContain('/batch/image');
      expect(action.to).toContain('step=2');
    }
  });

  it('draft empty: batch_step1_configured hint without full jobConfig', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      navHints: { item_count: 0, batch_step1_configured: true },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续上传');
      expect(action.to).toContain('step=2');
    }
  });

  it('draft empty: nav_hints.wizard_furthest_step without jobConfig', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      navHints: { item_count: 0, wizard_furthest_step: 2 },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续上传');
      expect(action.to).toContain('step=2');
    }
  });

  it('draft with items and wizard_furthest_step 4 -> continue review', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      navHints: { item_count: 1 },
      jobConfig: { wizard_furthest_step: 4 },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续审阅');
      expect(action.to).toContain('step=4');
    }
  });

  it('draft list uses navHints.item_count when items omitted', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      items: [],
      navHints: { item_count: 2 },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('继续上传');
      expect(action.to).toContain('step=2');
    }
  });

  it('awaiting_review -> itemId in URL from items', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'awaiting_review',
      jobType: 'text_batch',
      items: [{ id: 'b', status: 'awaiting_review' }],
      currentPage: 'job_detail',
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') expect(action.to).toContain('itemId=b');
  });

  it('awaiting_review -> itemId from navHints when items empty', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'awaiting_review',
      jobType: 'text_batch',
      items: [],
      navHints: { item_count: 1, first_awaiting_review_item_id: 'x9' },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') expect(action.to).toContain('itemId=x9');
  });

  it('coerce: draft 0 items + nav_hints wizard 2 but nav stuck step=1 -> step=2', () => {
    const fixed = coerceDraftEmptyBatchPrimaryNav({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      itemCount: 0,
      navHints: { item_count: 0, wizard_furthest_step: 2 },
      nav: { kind: 'link', label: '继续配置', to: '/batch/text?jobId=x&step=1' },
    });
    expect(fixed.kind).toBe('link');
    if (fixed.kind === 'link') {
      expect(fixed.label).toBe('继续上传');
      expect(fixed.to).toContain('/batch/text');
      expect(fixed.to).toContain('step=2');
    }
  });

  it('coerce: draft 0 items + jobConfig wizard 2 but nav stuck step=1 -> step=2', () => {
    const fixed = coerceDraftEmptyBatchPrimaryNav({
      jobId: jid,
      status: 'draft',
      jobType: 'text_batch',
      itemCount: 0,
      jobConfig: { wizard_furthest_step: 2 },
      nav: { kind: 'link', label: '继续配置', to: '/batch/text?jobId=x&step=1' },
    });
    expect(fixed.kind).toBe('link');
    if (fixed.kind === 'link') {
      expect(fixed.label).toBe('继续上传');
      expect(fixed.to).toContain('/batch/text');
      expect(fixed.to).toContain('step=2');
    }
  });

  it('running on job detail -> workbench step 3', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'running',
      jobType: 'text_batch',
      items: [],
      currentPage: 'job_detail',
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('查看进度');
      expect(action.to).toContain('step=3');
    }
  });

  it('unknown aggregate status from list -> fallback 查看详情', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'weird_future_status',
      jobType: 'text_batch',
      items: [],
      navHints: { item_count: 0 },
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('查看详情');
      expect(action.to).toContain(`/jobs/${jid}`);
    }
  });

  it('unknown aggregate status from job_detail -> none', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'weird_future_status',
      jobType: 'text_batch',
      items: [],
      currentPage: 'job_detail',
      navHints: { item_count: 0 },
    });
    expect(action.kind).toBe('none');
  });

  it('cancelled from list -> 查看详情 link', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'cancelled',
      jobType: 'text_batch',
      items: [],
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('查看详情');
      expect(action.to).toContain(`/jobs/${jid}`);
    }
  });

  it('cancelled from job_detail -> none (not editable)', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'cancelled',
      jobType: 'text_batch',
      items: [],
      currentPage: 'job_detail',
    });
    expect(action.kind).toBe('none');
    if (action.kind === 'none') expect(action.reason).toContain('取消');
  });

  it('failed from job_detail -> none', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'failed',
      jobType: 'text_batch',
      items: [],
      currentPage: 'job_detail',
    });
    expect(action.kind).toBe('none');
  });

  it('failed from list -> 查看失败详情 link', () => {
    const action = resolveJobPrimaryNavigation({
      jobId: jid,
      status: 'failed',
      jobType: 'text_batch',
      items: [],
    });
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      expect(action.label).toBe('查看失败详情');
      expect(action.to).toContain(`/jobs/${jid}`);
    }
  });
});
