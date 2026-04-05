import { useT } from '@/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNerBackend } from './hooks/use-model-config';
import { ModelEndpointCard } from './components/model-endpoint-card';

export function TextModel() {
  const t = useT();
  const {
    llamacppBaseUrl,
    setLlamacppBaseUrl,
    nerLoading,
    nerSaving,
    testing,
    testResult,
    nerLive,
    saveNerBackend,
    testConnection,
    clearNerOverride,
  } = useNerBackend();

  if (nerLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-1 min-h-0 overflow-auto overscroll-contain p-4 sm:p-6">
        <div className="flex w-full flex-col gap-5">
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('settings.textModel.infoTitle')}</CardTitle>
              <CardDescription className="mt-2 text-xs leading-relaxed">
                {t('settings.textModel.infoDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Badge variant="outline">{t('settings.textModel.tag.openai')}</Badge>
                <Badge variant="outline">{t('settings.textModel.tag.local')}</Badge>
                <Badge variant="outline">{t('settings.textModel.tag.server')}</Badge>
              </div>
            </CardContent>
          </Card>

          <ModelEndpointCard
            title={t('settings.textModel.cardTitle')}
            description={t('settings.textModel.cardDescription')}
            endpointUrl={llamacppBaseUrl}
            onEndpointChange={setLlamacppBaseUrl}
            onTest={() => void testConnection()}
            onSave={() => void saveNerBackend()}
            testing={testing}
            saving={nerSaving}
            testResult={testResult}
            liveStatus={nerLive}
            placeholder="http://127.0.0.1:8080/v1"
            tags={[
              t('settings.textModel.tag.openai'),
              t('settings.textModel.tag.builtin'),
            ]}
            endpointLabel={t('settings.textModel.endpointLabel')}
            endpointHint={t('settings.textModel.endpointHint')}
          />

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => void clearNerOverride()} data-testid="reset-ner-default">
              {t('settings.textModel.reset')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
