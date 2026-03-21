import React, { useState, useEffect } from 'react';

interface FileHistory {
    id: string;
    filename: string;
    file_type: string;
    file_size: number;
    created_at: number;
    has_redacted: boolean;
}

export const History: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [files, setFiles] = useState<FileHistory[]>([]);

    const fetchFiles = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/v1/files');
            if (res.ok) {
                const data = await res.json();
                setFiles(data.files || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles();
    }, []);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (ts: number) => {
        if (!ts) return '-';
        // Handle both seconds and milliseconds (Python returns seconds)
        const date = new Date(ts > 1e12 ? ts : ts * 1000);
        return date.toLocaleString();
    };

    const handleDelete = async (id: string, name: string) => {
        if (!window.confirm(`确认要删除文件 "${name}" 及它的处理记录吗？`)) return;
        try {
            const res = await fetch(`/api/v1/files/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setFiles(files.filter(f => f.id !== id));
            } else {
                alert('删除失败');
            }
        } catch (e) {
            console.error(e);
            alert('删除失败');
        }
    };

    const handleDownload = (id: string, filename: string, redacted: boolean) => {
        const url = `/api/v1/files/${id}/download?redacted=${redacted}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = redacted ? `redacted_${filename}` : filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="bg-white rounded-xl border border-[#e5e5e5] flex flex-col flex-1 overflow-hidden">
                <div className="px-6 py-4 border-b border-[#f0f0f0] flex justify-between items-center">
                    <div>
                        <h2 className="text-[16px] font-semibold text-[#0a0a0a]">脱敏处理历史</h2>
                        <p className="text-[12px] text-[#737373] mt-1">查看和下载你曾经处理过的所有文件归档</p>
                    </div>
                    <button
                        onClick={fetchFiles}
                        className="text-[13px] px-3 py-1.5 border border-[#e5e5e5] rounded-lg hover:bg-[#fafafa] transition-colors flex items-center gap-1.5"
                    >
                        <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        刷新列表
                    </button>
                </div>

                <div className="flex-1 overflow-auto">
                    {loading ? (
                        <div className="flex justify-center items-center h-full text-[#a3a3a3] text-sm">
                            加载中...
                        </div>
                    ) : files.length === 0 ? (
                        <div className="flex flex-col justify-center items-center h-full text-[#a3a3a3]">
                            <svg className="w-12 h-12 mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-[13px]">暂无处理记录</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#fafafa] sticky top-0 z-10 border-b border-[#f0f0f0]">
                                <tr>
                                    <th className="px-6 py-3 text-[12px] font-medium text-[#737373]">文件名</th>
                                    <th className="px-6 py-3 text-[12px] font-medium text-[#737373] w-[100px]">文件类型</th>
                                    <th className="px-6 py-3 text-[12px] font-medium text-[#737373] w-[100px]">大小</th>
                                    <th className="px-6 py-3 text-[12px] font-medium text-[#737373] w-[180px]">处理时间</th>
                                    <th className="px-6 py-3 text-[12px] font-medium text-[#737373] w-[100px]">处理状态</th>
                                    <th className="px-6 py-3 text-[12px] font-medium text-[#737373] w-[220px]">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#f0f0f0]">
                                {files.map(f => (
                                    <tr key={f.id} className="hover:bg-[#fcfcfc] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="text-[14px] font-medium text-[#262626] truncate max-w-[300px]" title={f.filename}>
                                                {f.filename}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-[11px] px-2 py-1 bg-gray-100 text-gray-600 rounded">
                                                {f.file_type.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-[13px] text-[#737373]">{formatSize(f.file_size)}</td>
                                        <td className="px-6 py-4 text-[13px] text-[#737373]">{formatDate(f.created_at)}</td>
                                        <td className="px-6 py-4">
                                            {f.has_redacted ? (
                                                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#22c55e]">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"></span>
                                                    已脱敏
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#a3a3a3]">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[#d4d4d4]"></span>
                                                    仅提取
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-3">
                                                {f.has_redacted && (
                                                    <button
                                                        onClick={() => handleDownload(f.id, f.filename, true)}
                                                        className="text-[12px] font-medium text-blue-600 hover:text-blue-700"
                                                    >
                                                        下载结果
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDownload(f.id, f.filename, false)}
                                                    className="text-[12px] font-medium text-[#737373] hover:text-[#262626]"
                                                >
                                                    原文件
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(f.id, f.filename)}
                                                    className="text-[12px] font-medium text-red-500 hover:text-red-700 ml-auto"
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};
