import axios from 'axios';
import type {
  FileInfo,
  ParseResult,
  NERResult,
  VisionResult,
  RedactionRequest,
  RedactionResult,
  CompareData,
  EntityTypeConfig,
  ReplacementModeConfig,
} from '../types';

// 创建 axios 实例
const api = axios.create({
  baseURL: '/api/v1',
  timeout: 60000, // 60秒超时（AI处理可能较慢）
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证 token
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.detail || error.message || '请求失败';
    console.error('API Error:', message);
    return Promise.reject(new Error(message));
  }
);

// 文件管理 API
export const fileApi = {
  // 上传文件
  upload: async (file: File): Promise<FileInfo> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // 解析文件
  parse: async (fileId: string): Promise<ParseResult> => {
    return api.get(`/files/${fileId}/parse`);
  },

  // 获取文件信息
  getInfo: async (fileId: string): Promise<FileInfo> => {
    return api.get(`/files/${fileId}`);
  },

  // 下载文件
  getDownloadUrl: (fileId: string, redacted: boolean = false): string => {
    return `/api/v1/files/${fileId}/download?redacted=${redacted}`;
  },

  // 删除文件
  delete: async (fileId: string): Promise<void> => {
    return api.delete(`/files/${fileId}`);
  },
};

// NER识别 API
export const nerApi = {
  // 提取实体
  extractEntities: async (fileId: string): Promise<NERResult> => {
    return api.get(`/files/${fileId}/ner`);
  },
};

// 脱敏处理 API
export const redactionApi = {
  // 执行脱敏
  execute: async (request: RedactionRequest): Promise<RedactionResult> => {
    return api.post('/redaction/execute', request);
  },

  // 获取对比数据
  getComparison: async (fileId: string): Promise<CompareData> => {
    return api.get(`/redaction/${fileId}/compare`);
  },

  // 视觉识别
  detectSensitiveRegions: async (fileId: string, page: number = 1): Promise<VisionResult> => {
    return api.post(`/redaction/${fileId}/vision?page=${page}`);
  },

  // 获取实体类型列表
  getEntityTypes: async (): Promise<{ entity_types: EntityTypeConfig[] }> => {
    return api.get('/redaction/entity-types');
  },

  // 获取替换模式列表
  getReplacementModes: async (): Promise<{ replacement_modes: ReplacementModeConfig[] }> => {
    return api.get('/redaction/replacement-modes');
  },
};

export default api;
