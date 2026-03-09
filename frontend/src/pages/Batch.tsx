import React, { useState, useRef } from 'react';

interface BatchFile {
    uid: string;
    rawFile: File;
    fileId?: string;
    status: 'pending' | 'uploading' | 'processing' | 'success' | 'error';
    message?: string;
}

export const Batch: React.FC = () => {
    const [files, setFiles] = useState<BatchFile[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [replacementMode, setReplacementMode] = useState<string>('smart');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const addFiles = (newFiles: FileList | File[]) => {
        const newBatchFiles: BatchFile[] = Array.from(newFiles).map(f => ({
            uid: Math.random().toString(36).substring(7),
            rawFile: f,
            status: 'pending',
        }));
        setFiles(prev => [...prev, ...newBatchFiles]);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
        }
    };

    const removeFile = (uid: string) => {
        if (isProcessing) return;
        setFiles(prev => prev.filter(f => f.uid !== uid));
    };

    const updateFileObj = (uid: string, updates: Partial<BatchFile>) => {
        setFiles(prev => prev.map(f => (f.uid === uid ? { ...f, ...updates } : f)));
    };

    // 核心的单文件执行链： Upload -> Parse -> NER -> Vision(可选) -> Redact
    const processSingleFile = async (fileObj: BatchFile) => {
        try {
            updateFileObj(fileObj.uid, { status: 'uploading', message: '正在上传' });
            const formData = new FormData();
            formData.append('file', fileObj.rawFile);

            // 1. Upload
            const uploadRes = await fetch('/api/v1/files/upload', {
                method: 'POST',
                body: formData,
            });
            if (!uploadRes.ok) throw new Error('上传失败');
            const uploadData = await uploadRes.json();
            const fileId = uploadData.file_id;
            updateFileObj(fileObj.uid, { fileId, status: 'processing', message: '内容解析' });

            // 2. Parse
            const parseRes = await fetch(`/api/v1/files/${fileId}/parse`);
            if (!parseRes.ok) throw new Error('解析失败');
            const parseData = await parseRes.json();
            const isScanned = parseData.is_scanned;
            const pageCount = parseData.page_count;

            updateFileObj(fileObj.uid, { message: '提取敏感词' });

            // 3. NER (Text)
            const nerRes = await fetch(`/api/v1/files/${fileId}/ner`, { method: 'POST', body: JSON.stringify({}), headers: { "Content-Type": "application/json" } });
            if (!nerRes.ok) throw new Error('文本NER失败');
            const nerData = await nerRes.json();
            let allEntities = nerData.entities || [];
            let allBoxes: any[] = [];

            // 4. Vision (if needed)
            if (isScanned) {
                updateFileObj(fileObj.uid, { message: '启动视觉分析' });
                // 对每一页做 vision
                for (let i = 1; i <= pageCount; i++) {
                    const visionRes = await fetch(`/api/v1/redaction/${fileId}/vision?page=${i}`, { method: 'POST', body: JSON.stringify({}), headers: { "Content-Type": "application/json" } });
                    if (visionRes.ok) {
                        const vData = await visionRes.json();
                        if (vData.bounding_boxes) {
                            allBoxes = allBoxes.concat(vData.bounding_boxes);
                        }
                    }
                }
            }

            updateFileObj(fileObj.uid, { message: '黑盒脱敏中' });

            // 5. Execute Redaction
            const redactPayload = {
                file_id: fileId,
                entities: allEntities,
                bounding_boxes: allBoxes,
                config: {
                    replacement_mode: replacementMode,
                    entity_types: ["PERSON", "PHONE", "ID_CARD", "ORG", "CASE_NUMBER"],
                    custom_entity_types: [],
                    custom_replacements: {}
                }
            };

            const redactRes = await fetch('/api/v1/redaction/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(redactPayload)
            });
            if (!redactRes.ok) throw new Error('脱敏执行失败');

            updateFileObj(fileObj.uid, { status: 'success', message: '处理完成' });
        } catch (e: any) {
            updateFileObj(fileObj.uid, { status: 'error', message: e.message || '系统异常' });
        }
    };

    const handleStartBatch = async () => {
        const pendings = files.filter(f => f.status === 'pending' || f.status === 'error');
        if (pendings.length === 0) return;

        setIsProcessing(true);
        // 串行执行，避免 GPU 显存由于并发爆炸
        for (const f of pendings) {
            await processSingleFile(f);
        }
        setIsProcessing(false);
    };

    const handleDownloadAll = () => {
        const successFileIds = files.filter(f => f.status === 'success' && f.fileId).map(f => f.fileId as string);
        if (successFileIds.length === 0) {
            alert("没有已成功脱敏的文件可供下载");
            return;
        }
        fetch('/api/v1/files/batch/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_ids: successFileIds, redacted: true })
        })
            .then(async res => {
                if (!res.ok) throw new Error("下载失败");
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `batch_redacted_files.zip`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
            })
            .catch(err => {
                console.error(err);
                alert("打包下载失败：" + err.message);
            });
    };

    const total = files.length;
    const successCount = files.filter(f => f.status === 'success').length;
    const pendingCount = files.filter(f => f.status === 'pending').length;

    return (
        <div className="p-6 h-full flex gap-6">
            {/* 左侧文件列表区 */}
            <div className="flex-1 flex flex-col bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="p-4 border-b border-[#f0f0f0] flex justify-between items-center bg-[#fafafa]">
                    <div>
                        <h2 className="text-[15px] font-semibold text-[#0a0a0a]">待处理队列</h2>
                        <p className="text-[12px] text-[#737373] mt-0.5">
                            总计 {total} 个文件，已成功 {successCount} 个
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="file"
                            multiple
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            disabled={isProcessing}
                        />
                        <button
                            className="px-3 py-1.5 text-[13px] border border-[#e5e5e5] rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isProcessing}
                        >
                            继续添加
                        </button>
                        <button
                            className="px-3 py-1.5 text-[13px] bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 disabled:opacity-50"
                            onClick={() => setFiles([])}
                            disabled={isProcessing || files.length === 0}
                        >
                            清空全部
                        </button>
                    </div>
                </div>

                <div
                    className="flex-1 overflow-auto p-4 bg-[#fcfcfc]"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                >
                    {files.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl bg-white">
                            <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-3">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </div>
                            <p className="text-[14px] text-gray-600 font-medium">拖拽多份文件到这里</p>
                            <p className="text-[12px] text-gray-400 mt-1">支持 Word、PDF、PNG、JPG 批量导入</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {files.map(f => (
                                <div key={f.uid} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg shadow-sm">
                                    <div className="flex items-center gap-3 overflow-hidden flex-1">
                                        <svg className="w-6 h-6 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <div className="overflow-hidden">
                                            <p className="text-[13px] font-medium text-gray-800 truncate" title={f.rawFile.name}>
                                                {f.rawFile.name}
                                            </p>
                                            <p className="text-[11px] text-gray-500 mt-0.5">{(f.rawFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 shrink-0 px-4">
                                        {f.status === 'pending' && <span className="text-[12px] text-gray-400">等待中</span>}
                                        {f.status === 'uploading' && <span className="text-[12px] text-blue-500 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>上传中</span>}
                                        {f.status === 'processing' && <span className="text-[12px] text-amber-500 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"></span>{f.message}</span>}
                                        {f.status === 'success' && <span className="text-[12px] text-green-500 font-medium flex items-center gap-1">✓ 成功</span>}
                                        {f.status === 'error' && <span className="text-[12px] text-red-500 flex items-center gap-1" title={f.message}>✕ 失败 ({f.message})</span>}

                                        <button
                                            className={`ml-2 text-gray-400 hover:text-red-500 ${(isProcessing && f.status !== 'success' && f.status !== 'error') ? 'invisible' : ''}`}
                                            onClick={() => removeFile(f.uid)}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 右侧全局设置区 */}
            <div className="w-[320px] shrink-0 flex flex-col gap-4">
                <div className="bg-white rounded-xl border border-[#e5e5e5] p-5">
                    <h3 className="text-[14px] font-semibold text-[#0a0a0a] mb-4">全局脱敏策略</h3>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-[12px] font-medium text-gray-700 mb-2">替换模式</label>
                            <select
                                className="w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500 bg-gray-50"
                                value={replacementMode}
                                onChange={e => setReplacementMode(e.target.value)}
                                disabled={isProcessing}
                            >
                                <option value="smart">智能替换 (如: 当事人甲)</option>
                                <option value="mask">掩码隐藏 (如: 张**)</option>
                                <option value="structured">语义保留占位</option>
                            </select>
                        </div>

                        <div className="text-[12px] text-gray-500 bg-blue-50 p-3 rounded-lg leading-relaxed">
                            * 批量处理默认开启常见的五大识别策略（姓名、组织、涉案编号、手机、身份证），您可以去"识别项配置"页细微调整。
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-[#e5e5e5] p-5 flex flex-col gap-3">
                    <h3 className="text-[14px] font-semibold text-[#0a0a0a]">任务操作</h3>

                    <button
                        onClick={handleStartBatch}
                        disabled={isProcessing || pendingCount === 0}
                        className="w-full py-2.5 bg-[#0a0a0a] text-white text-[13px] font-medium rounded-lg hover:bg-[#262626] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                    >
                        {isProcessing ? (
                            <>
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                处理中...
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                一键执行批量脱敏
                            </>
                        )}
                    </button>

                    <button
                        onClick={handleDownloadAll}
                        disabled={isProcessing || successCount === 0}
                        className="w-full py-2.5 bg-white border border-[#0a0a0a] text-[#0a0a0a] text-[13px] font-medium rounded-lg hover:bg-gray-50 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        打包下载已完成文件 (.zip)
                    </button>
                </div>
            </div>
        </div>
    );
};
