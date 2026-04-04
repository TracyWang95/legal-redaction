/**
 * Model endpoint configuration card — ShadCN Card with endpoint URL input,
 * test connection button, and status indicator.
 */
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ModelEndpointCardProps {
  title: string;
  description: string;
  endpointUrl: string;
  onEndpointChange: (url: string) => void;
  onTest: () => void;
  onSave: () => void;
  testing: boolean;
  saving: boolean;
  testResult: { success: boolean; message: string } | null;
  liveStatus?: 'online' | 'offline';
  placeholder?: string;
  tags?: string[];
  endpointLabel?: string;
  endpointHint?: string;
}

export function ModelEndpointCard({
  title, description, endpointUrl, onEndpointChange,
  onTest, onSave, testing, saving, testResult,
  liveStatus, placeholder, tags, endpointLabel, endpointHint,
}: ModelEndpointCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              {description}
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving}
            data-testid="save-endpoint"
          >
            {saving ? '保存中...' : '保存配置'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{title}</span>
          <Badge variant="secondary" className="text-xs">
            {liveStatus === 'online' ? '启用' : liveStatus === 'offline' ? '启用' : '启用'}
          </Badge>
          {liveStatus === 'online' && (
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">在线</Badge>
          )}
          {liveStatus === 'offline' && (
            <Badge variant="destructive" className="text-xs">离线</Badge>
          )}
          {liveStatus === undefined && (
            <Badge variant="outline" className="text-xs">检测中...</Badge>
          )}
          {tags?.map(tag => (
            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
          ))}
        </div>

        {/* Endpoint input */}
        <div className="space-y-1.5">
          <Label>{endpointLabel ?? 'Endpoint URL'}</Label>
          <div className="flex items-center gap-2">
            <Input
              value={endpointUrl}
              onChange={e => onEndpointChange(e.target.value)}
              placeholder={placeholder ?? 'http://127.0.0.1:8080/v1'}
              className="font-mono text-sm flex-1"
              data-testid="endpoint-url"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={onTest}
              disabled={testing}
              data-testid="test-endpoint"
            >
              {testing ? '测试中...' : '测试'}
            </Button>
          </div>
          {endpointHint && (
            <p className="text-xs text-muted-foreground">{endpointHint}</p>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn(
            'p-3 rounded-lg text-sm border',
            testResult.success
              ? 'bg-green-50 text-green-800 border-green-100'
              : 'bg-red-50 text-red-800 border-red-100',
          )}>
            {testResult.success ? '\u2713 ' : '\u2717 '}
            {testResult.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
