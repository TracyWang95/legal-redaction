import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

interface ServiceInfo {
  name: string;
  status: 'online' | 'offline' | 'checking';
}

interface ServicesHealth {
  all_online: boolean;
  services: {
    paddle_ocr: ServiceInfo;
    has_ner: ServiceInfo;
    glm_vision: ServiceInfo;
  };
}

export const Layout: React.FC = () => {
  const location = useLocation();
  
  // 服务状态 - 真实轮询
  const [health, setHealth] = useState<ServicesHealth | null>(null);
  const [checking, setChecking] = useState(true);
  
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/health/services', { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      } else {
        setHealth(null);
      }
    } catch {
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, []);
  
  // 首次加载 + 每15秒轮询
  useEffect(() => {
    fetchHealth();
    const timer = setInterval(fetchHealth, 15000);
    return () => clearInterval(timer);
  }, [fetchHealth]);

  const navItems = [
    { path: '/', label: 'Playground', icon: PlayIcon },
    { path: '/batch', label: '批量处理', icon: BatchIcon, disabled: true },
    { path: '/history', label: '处理历史', icon: HistoryIcon, disabled: true },
    { path: '/settings', label: '识别项配置', icon: RulesIcon },
    { path: '/model-settings', label: '视觉模型配置', icon: ModelIcon },
  ];

  const getPageTitle = () => {
    const item = navItems.find(n => n.path === location.pathname);
    return item?.label || 'Playground';
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <aside className="w-[240px] bg-white border-r border-[#e5e5e5] flex flex-col">
        {/* Logo */}
        <div className="h-[52px] flex items-center px-4 border-b border-[#f0f0f0]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0a0a0a] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <span className="font-semibold text-[14px] text-[#0a0a0a] tracking-[-0.01em]">DataShield</span>
              <p className="text-[11px] text-[#737373]">智能数据脱敏平台</p>
            </div>
          </div>
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map(item => (
            item.disabled ? (
              <div
                key={item.path}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-[#a3a3a3] cursor-not-allowed"
              >
                <item.icon className="w-[18px] h-[18px]" />
                <span>{item.label}</span>
                <span className="ml-auto text-[10px] bg-[#f5f5f5] px-1.5 py-0.5 rounded text-[#737373]">开发中</span>
              </div>
            ) : (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-[#0a0a0a] text-white'
                      : 'text-[#737373] hover:bg-[#f5f5f5] hover:text-[#262626]'
                  }`
                }
              >
                <item.icon className="w-[18px] h-[18px]" />
                {item.label}
              </NavLink>
            )
          ))}
        </nav>
        
        {/* Footer - 服务状态（真实轮询） */}
        <div className="p-3 border-t border-[#f0f0f0]">
          <div className="px-3 py-2.5 rounded-lg bg-[#fafafa]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`w-[6px] h-[6px] rounded-full ${
                  checking ? 'bg-gray-300 animate-pulse' :
                  health?.all_online ? 'bg-[#22c55e]' : 'bg-amber-400'
                }`}></span>
                <span className="text-[11px] font-semibold text-[#0a0a0a] tracking-wide">服务状态</span>
              </div>
              <button onClick={fetchHealth} className="text-[10px] text-gray-400 hover:text-gray-600" title="刷新">
                <svg className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            {health ? (
              <div className="space-y-1.5 text-[11px]">
                {/* PaddleOCR */}
                <div className="flex justify-between items-center">
                  <span className="text-[#737373] truncate mr-2" title={health.services.paddle_ocr.name}>
                    {health.services.paddle_ocr.name}
                  </span>
                  <span className={`font-medium flex-shrink-0 ${health.services.paddle_ocr.status === 'online' ? 'text-[#22c55e]' : 'text-red-500'}`}>
                    {health.services.paddle_ocr.status === 'online' ? '在线' : '离线'}
                  </span>
                </div>
                {/* HaS NER */}
                <div className="flex justify-between items-center">
                  <span className="text-[#737373] truncate mr-2" title={health.services.has_ner.name}>
                    {health.services.has_ner.name}
                  </span>
                  <span className={`font-medium flex-shrink-0 ${health.services.has_ner.status === 'online' ? 'text-[#22c55e]' : 'text-red-500'}`}>
                    {health.services.has_ner.status === 'online' ? '在线' : '离线'}
                  </span>
                </div>
                {/* GLM Vision */}
                <div className="flex justify-between items-center">
                  <span className="text-[#737373] truncate mr-2" title={health.services.glm_vision.name}>
                    {health.services.glm_vision.name}
                  </span>
                  <span className={`font-medium flex-shrink-0 ${health.services.glm_vision.status === 'online' ? 'text-[#22c55e]' : 'text-red-500'}`}>
                    {health.services.glm_vision.status === 'online' ? '在线' : '离线'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-red-500">
                {checking ? '检测中...' : '后端未连接'}
              </div>
            )}
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#fafafa]">
        {/* Header */}
        <header className="h-[52px] bg-white border-b border-[#e5e5e5] flex items-center justify-between px-6">
          <h1 className="text-[15px] font-semibold text-[#0a0a0a] tracking-[-0.01em]">{getPageTitle()}</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[11px]">
              {checking ? (
                <>
                  <span className="w-[6px] h-[6px] rounded-full bg-gray-300 animate-pulse"></span>
                  <span className="text-gray-400">检测服务中...</span>
                </>
              ) : health?.all_online ? (
                <>
                  <span className="w-[6px] h-[6px] rounded-full bg-[#22c55e]"></span>
                  <span className="text-[#737373]">全部服务正常</span>
                </>
              ) : health ? (
                <>
                  <span className="w-[6px] h-[6px] rounded-full bg-amber-400"></span>
                  <span className="text-amber-600">部分服务异常</span>
                </>
              ) : (
                <>
                  <span className="w-[6px] h-[6px] rounded-full bg-red-500"></span>
                  <span className="text-red-500">后端未连接</span>
                </>
              )}
            </div>
          </div>
        </header>
        
        {/* Content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>

      {/* Toast Container */}
      <div id="toast-container" className="fixed bottom-5 right-5 z-50 space-y-2"></div>
    </div>
  );
};

// Icons
const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>
);

const BatchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
  </svg>
);

const HistoryIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>
);

const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
  </svg>
);

// 识别规则配置图标
const RulesIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
  </svg>
);

// 视觉模型配置图标
const ModelIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
  </svg>
);

export default Layout;
