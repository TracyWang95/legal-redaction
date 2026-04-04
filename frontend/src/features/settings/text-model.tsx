/**
 * Text model settings — NER backend (llama-server / HaS) configuration.
 * Replaces pages/TextModelSettings.tsx with ShadCN components.
 */
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNerBackend } from './hooks/use-model-config';
import { ModelEndpointCard } from './components/model-endpoint-card';

export function TextModel() {
  const {
    llamacppBaseUrl, setLlamacppBaseUrl,
    nerLoading, nerSaving, testing, testResult, nerLive,
    saveNerBackend, testConnection, clearNerOverride,
  } = useNerBackend();

  if (nerLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-7 h-7 border-2 border-muted border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain p-4 sm:p-6 w-full max-w-5xl mx-auto">
        <div className="flex flex-col gap-5">
          {/* Info card */}
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">文本 NER 推理</CardTitle>
              <CardDescription className="text-xs leading-relaxed mt-2">
                <strong className="font-medium text-foreground">HaS</strong> 通过{' '}
                <strong className="font-medium text-foreground">llama-server</strong> 提供 OpenAI 兼容{' '}
                <code className="text-xs bg-background px-1 py-0.5 rounded border">/v1</code>
                。保存后写入{' '}
                <code className="text-xs bg-background px-1 py-0.5 rounded border">data/ner_backend.json</code>
                ，优先级高于环境变量，<strong className="font-medium">无需重启</strong>后端。侧栏「HaS」离线时多为本机未启动对应进程；可运行{' '}
                <code className="text-xs bg-background px-1 py-0.5 rounded border">scripts/start_has.bat</code>
                。下方「测试」使用当前输入框地址，无需先保存。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2 pt-3 border-t">
                <Badge variant="outline">OpenAI 兼容</Badge>
                <Badge variant="outline">本地 HTTP</Badge>
                <Badge variant="outline">llama-server</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Endpoint card */}
          <ModelEndpointCard
            title="HaS 文本 NER"
            description="当前仅支持 HaS 文本 NER；配置 OpenAI 兼容根路径后，点「保存配置」写入运行时文件。"
            endpointUrl={llamacppBaseUrl}
            onEndpointChange={setLlamacppBaseUrl}
            onTest={() => void testConnection()}
            onSave={() => void saveNerBackend()}
            testing={testing}
            saving={nerSaving}
            testResult={testResult}
            liveStatus={nerLive}
            placeholder="http://127.0.0.1:8080/v1"
            tags={['OpenAI 兼容', '内置']}
            endpointLabel="OpenAI 兼容 API 根路径"
            endpointHint="测试会依次尝试 GET .../v1/models、.../v1/health 等路径。"
          />

          {/* Reset button */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => void clearNerOverride()}
              data-testid="reset-ner-default"
            >
              恢复环境变量默认
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
