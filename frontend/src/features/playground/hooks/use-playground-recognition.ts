// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import {
  createPreset,
  presetAppliesText,
  presetAppliesVision,
  type RecognitionPreset,
} from '@/services/presetsApi';
import { usePresets, useInvalidatePresets } from '@/services/hooks/use-presets';
import {
  fetchRecognitionEntityTypes,
  fetchRecognitionPipelines,
} from '@/services/recognition-config';
import {
  buildDefaultPipelineTypeIds,
  buildDefaultTextTypeIds,
} from '@/services/defaultRedactionPreset';
import {
  buildVisionSelectionSignature,
  getCachedRecognitionConfig,
  updateRecognitionConfigCache,
} from '../lib/recognition-config';
import {
  setActivePresetTextId,
  setActivePresetVisionId,
  getActivePresetTextId,
  getActivePresetVisionId,
} from '@/services/activePresetBridge';
import { t, useI18n } from '@/i18n';
import { STORAGE_KEYS } from '@/constants/storage-keys';
import { getStorageItem, setStorageItem } from '@/lib/storage';
import { showToast } from '@/components/Toast';
import { localizeErrorMessage } from '@/utils/localizeError';
import { localizePresetName } from '@/features/settings/lib/redaction-display';
import {
  buildPlaygroundTextGroups,
  type ConfigLoadState,
  flattenVisionTypes,
  normalizeVisionPipelines,
  sortEntityTypes,
} from '../lib/recognition-config';
import type { EntityTypeConfig, VisionTypeConfig, PipelineConfig } from '../types';

const RECOGNITION_FETCH_TIMEOUT_MS = 1_200;

function resolveVisionSelectionsFromStorage(pipelines: PipelineConfig[]) {
  const ocrHasTypeIds = pipelines
    .filter((pipeline) => pipeline.mode === 'ocr_has')
    .flatMap((pipeline) => pipeline.types.map((type) => type.id));
  const defaultOcrHasTypeIds = buildDefaultPipelineTypeIds(pipelines, 'ocr_has');
  const hasImageTypeIds = pipelines
    .filter((pipeline) => pipeline.mode === 'has_image')
    .flatMap((pipeline) => pipeline.types.map((type) => type.id));
  const defaultHasImageTypeIds = buildDefaultPipelineTypeIds(pipelines, 'has_image');
  const vlmTypeIds = pipelines
    .filter((pipeline) => pipeline.mode === 'vlm')
    .flatMap((pipeline) => pipeline.types.map((type) => type.id));
  const defaultVlmTypeIds = buildDefaultPipelineTypeIds(pipelines, 'vlm');

  const visionSelectionSignature = buildVisionSelectionSignature(pipelines);
  const savedOcrHasTypes = getStorageItem<string[] | null>(STORAGE_KEYS.OCR_HAS_TYPES, null);
  const savedHasImageTypes = getStorageItem<string[] | null>(STORAGE_KEYS.HAS_IMAGE_TYPES, null);
  const savedVlmTypes = getStorageItem<string[] | null>(STORAGE_KEYS.VLM_TYPES, null);
  const savedVisionSelectionSignature = getStorageItem<string | null>(
    STORAGE_KEYS.VISION_SELECTION_SIGNATURE,
    null,
  );
  const canUseSavedVisionSelection = savedVisionSelectionSignature === visionSelectionSignature;

  const ocrHasTypes = canUseSavedVisionSelection && Array.isArray(savedOcrHasTypes)
    ? (() => {
        const filtered = savedOcrHasTypes.filter((id: string) => ocrHasTypeIds.includes(id));
        return filtered.length > 0 || savedOcrHasTypes.length === 0
          ? filtered
          : defaultOcrHasTypeIds;
      })()
    : defaultOcrHasTypeIds;

  const hasImageTypes = canUseSavedVisionSelection && Array.isArray(savedHasImageTypes)
    ? (() => {
        const filtered = savedHasImageTypes.filter((id: string) => hasImageTypeIds.includes(id));
        return filtered.length > 0 || savedHasImageTypes.length === 0
          ? filtered
          : defaultHasImageTypeIds;
      })()
    : defaultHasImageTypeIds;
  const vlmTypes = canUseSavedVisionSelection && Array.isArray(savedVlmTypes)
    ? (() => {
        const filtered = savedVlmTypes.filter((id: string) => vlmTypeIds.includes(id));
        return filtered.length > 0 || savedVlmTypes.length === 0
          ? filtered
          : defaultVlmTypeIds;
      })()
    : defaultVlmTypeIds;

  return {
    ocrHasTypes,
    hasImageTypes,
    vlmTypes,
    visionSelectionSignature,
  };
}

export function usePlaygroundRecognition() {
  const locale = useI18n((state) => state.locale);
  const presetsQuery = usePresets();
  const invalidatePresets = useInvalidatePresets();

  const cachedConfig = getCachedRecognitionConfig();
  const cachedEntityTypes = cachedConfig ? sortEntityTypes(cachedConfig.entityTypes) : [];
  const cachedPipelines = cachedConfig
    ? normalizeVisionPipelines(cachedConfig.pipelines as PipelineConfig[])
    : [];
  const cachedVisionSelections = resolveVisionSelectionsFromStorage(cachedPipelines);

  const [entityTypes, setEntityTypes] = useState<EntityTypeConfig[]>(cachedEntityTypes);
  const [textConfigState, setTextConfigState] = useState<ConfigLoadState>(cachedEntityTypes.length > 0 ? 'ready' : 'loading');
  const entityConfigLoadedRef = useRef(cachedEntityTypes.length > 0);
  const initialSelectedTypes = buildDefaultTextTypeIds(cachedEntityTypes);
  const [selectedTypes, setSelectedTypesState] = useState<string[]>(initialSelectedTypes);
  const selectedTypesRef = useRef<string[]>(initialSelectedTypes);
  const setSelectedTypes = useCallback((next: SetStateAction<string[]>) => {
    const base = selectedTypesRef.current;
    const resolved = typeof next === 'function' ? next(base) : next;
    selectedTypesRef.current = resolved;
    setSelectedTypesState(resolved);
  }, []);
  const [visionTypes, setVisionTypes] = useState<VisionTypeConfig[]>(() => flattenVisionTypes(cachedPipelines));
  const [visionConfigState, setVisionConfigState] = useState<ConfigLoadState>(
    cachedPipelines.length > 0 ? 'ready' : 'loading',
  );
  const visionConfigLoadedRef = useRef(cachedPipelines.length > 0);
  const [selectedOcrHasTypes, setSelectedOcrHasTypes] = useState<string[]>(() => [
    ...cachedVisionSelections.ocrHasTypes,
  ]);
  const [selectedHasImageTypes, setSelectedHasImageTypes] = useState<string[]>(() => [
    ...cachedVisionSelections.hasImageTypes,
  ]);
  const [selectedVlmTypes, setSelectedVlmTypes] = useState<string[]>(() => [
    ...cachedVisionSelections.vlmTypes,
  ]);
  const selectedOcrHasTypesRef = useRef(selectedOcrHasTypes);
  const selectedHasImageTypesRef = useRef(selectedHasImageTypes);
  const selectedVlmTypesRef = useRef(selectedVlmTypes);
  const [pipelines, setPipelines] = useState<PipelineConfig[]>(cachedPipelines);
  const [typeTab, setTypeTab] = useState<'text' | 'vision'>('text');
  const [replacementMode, setReplacementMode] = useState<'structured' | 'smart' | 'mask'>(
    'structured',
  );
  const [playgroundPresets, setPlaygroundPresets] = useState<RecognitionPreset[]>([]);
  const [playgroundPresetTextId, setPlaygroundPresetTextId] = useState<string | null>(null);
  const [playgroundPresetVisionId, setPlaygroundPresetVisionId] = useState<string | null>(null);
  const [presetDialogKind, setPresetDialogKind] = useState<'text' | 'vision' | null>(null);
  const [presetDialogName, setPresetDialogName] = useState('');
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetApplySeq, setPresetApplySeq] = useState(0);

  useEffect(() => {
    selectedTypesRef.current = selectedTypes;
  }, [selectedTypes]);

  const localizedPlaygroundPresets = useMemo(
    () =>
      playgroundPresets.map((preset) => ({
        ...preset,
        name: localizePresetName(preset, t),
      })),
    [playgroundPresets, locale],
  );

  const textPresetsPg = useMemo(
    () => localizedPlaygroundPresets.filter(presetAppliesText),
    [localizedPlaygroundPresets],
  );
  const visionPresetsPg = useMemo(
    () => localizedPlaygroundPresets.filter(presetAppliesVision),
    [localizedPlaygroundPresets],
  );

  const playgroundDefaultTextTypeIds = useMemo(
    () => buildDefaultTextTypeIds(entityTypes),
    [entityTypes],
  );
  const playgroundDefaultOcrHasTypeIds = useMemo(
    () => buildDefaultPipelineTypeIds(pipelines, 'ocr_has'),
    [pipelines],
  );
  const playgroundDefaultHasImageTypeIds = useMemo(
    () => buildDefaultPipelineTypeIds(pipelines, 'has_image'),
    [pipelines],
  );
  const playgroundDefaultVlmTypeIds = useMemo(
    () => buildDefaultPipelineTypeIds(pipelines, 'vlm'),
    [pipelines],
  );

  const updateOcrHasTypes = useCallback((types: string[]) => {
    selectedOcrHasTypesRef.current = types;
    setSelectedOcrHasTypes(types);
    setStorageItem(STORAGE_KEYS.OCR_HAS_TYPES, types);
  }, []);

  const updateHasImageTypes = useCallback((types: string[]) => {
    selectedHasImageTypesRef.current = types;
    setSelectedHasImageTypes(types);
    setStorageItem(STORAGE_KEYS.HAS_IMAGE_TYPES, types);
  }, []);

  const updateVlmTypes = useCallback((types: string[]) => {
    selectedVlmTypesRef.current = types;
    setSelectedVlmTypes(types);
    setStorageItem(STORAGE_KEYS.VLM_TYPES, types);
  }, []);

  const clearPlaygroundTextPresetTracking = useCallback(() => {
    setPlaygroundPresetTextId(null);
    setActivePresetTextId(null);
  }, []);

  const clearPlaygroundVisionPresetTracking = useCallback(() => {
    setPlaygroundPresetVisionId(null);
    setActivePresetVisionId(null);
  }, []);

  const applyTextPresetToPlayground = useCallback(
    (preset: RecognitionPreset) => {
      if (!presetAppliesText(preset)) return;
      const enabledTextIds = new Set(
        entityTypes.filter((type) => type.enabled !== false).map((type) => type.id),
      );
      setSelectedTypes(preset.selectedEntityTypeIds.filter((id) => enabledTextIds.has(id)));
      if ((preset.kind ?? 'full') !== 'text') {
        setReplacementMode(preset.replacementMode);
      }
      setPlaygroundPresetTextId(preset.id);
      setActivePresetTextId(preset.id);
      setPresetApplySeq((s) => s + 1);
    },
    [entityTypes],
  );

  const applyVisionPresetToPlayground = useCallback(
    (preset: RecognitionPreset) => {
      if (!presetAppliesVision(preset)) return;
      const hasLoadedPipelines = pipelines.length > 0;
      const ocrIds = hasLoadedPipelines
        ? pipelines
            .filter((pipeline) => pipeline.mode === 'ocr_has')
            .flatMap((pipeline) => pipeline.types.map((type) => type.id))
        : null;
      const imageIds = hasLoadedPipelines
        ? pipelines
            .filter((pipeline) => pipeline.mode === 'has_image')
            .flatMap((pipeline) => pipeline.types.map((type) => type.id))
        : null;
      const vlmIds = hasLoadedPipelines
        ? pipelines
            .filter((pipeline) => pipeline.mode === 'vlm')
            .flatMap((pipeline) => pipeline.types.map((type) => type.id))
        : null;

      updateOcrHasTypes(
        hasLoadedPipelines
          ? preset.ocrHasTypes.filter((id) => ocrIds?.includes(id))
          : [...preset.ocrHasTypes],
      );
      updateHasImageTypes(
        hasLoadedPipelines
          ? preset.hasImageTypes.filter((id) => imageIds?.includes(id))
          : [...preset.hasImageTypes],
      );
      updateVlmTypes(
        hasLoadedPipelines
          ? (preset.vlmTypes ?? []).filter((id) => vlmIds?.includes(id))
          : [...(preset.vlmTypes ?? [])],
      );
      setPlaygroundPresetVisionId(preset.id);
      setActivePresetVisionId(preset.id);
      setPresetApplySeq((s) => s + 1);
    },
    [pipelines, updateOcrHasTypes, updateHasImageTypes, updateVlmTypes],
  );

  const selectPlaygroundTextPresetById = useCallback(
    (id: string) => {
      if (!id) {
        setPlaygroundPresetTextId(null);
        setActivePresetTextId(null);
        setSelectedTypes([...playgroundDefaultTextTypeIds]);
        setReplacementMode('structured');
        setPresetApplySeq((s) => s + 1);
        return;
      }

      const preset = playgroundPresets.find((item) => item.id === id);
      if (preset) applyTextPresetToPlayground(preset);
    },
    [playgroundDefaultTextTypeIds, playgroundPresets, applyTextPresetToPlayground],
  );

  const selectPlaygroundVisionPresetById = useCallback(
    (id: string) => {
      if (!id) {
        setPlaygroundPresetVisionId(null);
        setActivePresetVisionId(null);
        updateOcrHasTypes([...playgroundDefaultOcrHasTypeIds]);
        updateHasImageTypes([...playgroundDefaultHasImageTypeIds]);
        updateVlmTypes([...playgroundDefaultVlmTypeIds]);
        setPresetApplySeq((s) => s + 1);
        return;
      }

      const preset = playgroundPresets.find((item) => item.id === id);
      if (preset) applyVisionPresetToPlayground(preset);
    },
    [
      playgroundDefaultOcrHasTypeIds,
      playgroundDefaultHasImageTypeIds,
      playgroundDefaultVlmTypeIds,
      playgroundPresets,
      applyVisionPresetToPlayground,
      updateOcrHasTypes,
      updateHasImageTypes,
      updateVlmTypes,
    ],
  );

  // Sync presets from react-query cache into local state
  useEffect(() => {
    setPlaygroundPresets(presetsQuery.data ?? []);
  }, [presetsQuery.data]);

  const closePresetDialog = useCallback(() => {
    if (presetSaving) return;
    setPresetDialogKind(null);
    setPresetDialogName('');
  }, [presetSaving]);

  const openTextPresetDialog = useCallback(() => {
    setPresetDialogKind('text');
    setPresetDialogName('');
  }, []);

  const openVisionPresetDialog = useCallback(() => {
    setPresetDialogKind('vision');
    setPresetDialogName('');
  }, []);

  const saveTextPresetFromPlayground = useCallback(async () => {
    const name = presetDialogName.trim();
    if (!name) {
      showToast(t('settings.redaction.nameRequired'), 'error');
      return;
    }

    setPresetSaving(true);
    try {
      const created = await createPreset({
        name,
        kind: 'text',
        selectedEntityTypeIds: selectedTypes,
        ocrHasTypes: [],
        hasImageTypes: [],
        vlmTypes: [],
        replacementMode: 'structured',
      });
      await invalidatePresets();
      setPlaygroundPresetTextId(created.id);
      setActivePresetTextId(created.id);
      closePresetDialog();
      showToast(t('preset.saveText.success'), 'success');
    } catch (error) {
      showToast(localizeErrorMessage(error, 'preset.save.failed'), 'error');
    } finally {
      setPresetSaving(false);
    }
  }, [closePresetDialog, presetDialogName, selectedTypes, invalidatePresets]);

  const saveVisionPresetFromPlayground = useCallback(async () => {
    const name = presetDialogName.trim();
    if (!name) {
      showToast(t('settings.redaction.nameRequired'), 'error');
      return;
    }

    setPresetSaving(true);
    try {
      const created = await createPreset({
        name,
        kind: 'vision',
        selectedEntityTypeIds: [],
        ocrHasTypes: selectedOcrHasTypes,
        hasImageTypes: selectedHasImageTypes,
        vlmTypes: selectedVlmTypes,
        replacementMode: 'structured',
      });
      await invalidatePresets();
      setPlaygroundPresetVisionId(created.id);
      setActivePresetVisionId(created.id);
      closePresetDialog();
      showToast(t('preset.saveVision.success'), 'success');
    } catch (error) {
      showToast(localizeErrorMessage(error, 'preset.save.failed'), 'error');
    } finally {
      setPresetSaving(false);
    }
  }, [
    closePresetDialog,
    presetDialogName,
    selectedHasImageTypes,
    selectedOcrHasTypes,
    selectedVlmTypes,
    invalidatePresets,
  ]);

  const fetchEntityTypes = useCallback(
    async (preserveSelection = false) => {
      try {
        const types = sortEntityTypes(await fetchRecognitionEntityTypes(true, RECOGNITION_FETCH_TIMEOUT_MS));
        const defaultTypeIds = buildDefaultTextTypeIds(types);
        const validTypeIds = new Set(types.map((type) => type.id));
        const hadLoaded = entityConfigLoadedRef.current;

        setEntityTypes(types);
        entityConfigLoadedRef.current = types.length > 0;
        setTextConfigState(types.length > 0 ? 'ready' : 'empty');
        setSelectedTypes((previous) => {
          if (!preserveSelection || !hadLoaded) return defaultTypeIds;
          const filtered = previous.filter((id) => validTypeIds.has(id));
          return filtered.length > 0 || previous.length === 0 ? filtered : defaultTypeIds;
        });
        updateRecognitionConfigCache({ entityTypes: types });
      } catch (error) {
        if (import.meta.env.DEV) console.error('fetch entity types failed', error);
        if (!entityConfigLoadedRef.current) {
          setTextConfigState('unavailable');
        }
      }
    },
    [],
  );

  const fetchVisionTypes = useCallback(async () => {
    try {
      const normalizedPipelines = normalizeVisionPipelines(
        (await fetchRecognitionPipelines(RECOGNITION_FETCH_TIMEOUT_MS)) as PipelineConfig[],
      );
      const nextVisionSelections = resolveVisionSelectionsFromStorage(normalizedPipelines);
      const nextVisionTypes = flattenVisionTypes(normalizedPipelines);

      setPipelines(normalizedPipelines);
      setVisionTypes(nextVisionTypes);
      visionConfigLoadedRef.current = normalizedPipelines.length > 0;
      setVisionConfigState(normalizedPipelines.length > 0 ? 'ready' : 'empty');
      updateOcrHasTypes(nextVisionSelections.ocrHasTypes);
      updateHasImageTypes(nextVisionSelections.hasImageTypes);
      updateVlmTypes(nextVisionSelections.vlmTypes);
      setStorageItem(STORAGE_KEYS.VISION_SELECTION_SIGNATURE, nextVisionSelections.visionSelectionSignature);
      updateRecognitionConfigCache({ pipelines: normalizedPipelines });
    } catch (error) {
      if (import.meta.env.DEV) console.error('fetch vision pipelines failed', error);
      if (!visionConfigLoadedRef.current) {
        setVisionConfigState('unavailable');
      }
    }
  }, [updateOcrHasTypes, updateHasImageTypes, updateVlmTypes]);

  const loadRecognitionConfig = useCallback(
    async (preserveSelection = false) => {
      await Promise.allSettled([fetchEntityTypes(preserveSelection), fetchVisionTypes()]);
    },
    [fetchEntityTypes, fetchVisionTypes],
  );

  useEffect(() => {
    void loadRecognitionConfig(false);
  }, [loadRecognitionConfig]);

  useEffect(() => {
    const handleFocus = () => {
      void loadRecognitionConfig(true);
    };

    window.addEventListener('focus', handleFocus);
    const handleEntityTypesChanged = () => fetchEntityTypes(true);
    window.addEventListener('entity-types-changed', handleEntityTypesChanged);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('entity-types-changed', handleEntityTypesChanged);
    };
  }, [fetchEntityTypes, loadRecognitionConfig]);

  const bridgeInitRef = useRef(false);
  useEffect(() => {
    if (bridgeInitRef.current) return;
    if (!playgroundPresets.length || !entityTypes.length) return;

    const textPresetId = getActivePresetTextId();
    if (textPresetId) {
      const preset = playgroundPresets.find(
        (item) => item.id === textPresetId && presetAppliesText(item),
      );
      if (preset) applyTextPresetToPlayground(preset);
    }

    const visionPresetId = getActivePresetVisionId();
    if (visionPresetId && pipelines.length) {
      const preset = playgroundPresets.find(
        (item) => item.id === visionPresetId && presetAppliesVision(item),
      );
      if (preset) applyVisionPresetToPlayground(preset);
    }

    bridgeInitRef.current = true;
  }, [
    playgroundPresets,
    entityTypes,
    pipelines,
    applyTextPresetToPlayground,
    applyVisionPresetToPlayground,
  ]);

  const sortedEntityTypes = useMemo(() => sortEntityTypes(entityTypes), [entityTypes]);

  const playgroundTextGroups = useMemo(
    () => buildPlaygroundTextGroups(sortedEntityTypes),
    [sortedEntityTypes],
  );

  const setPlaygroundTextTypeGroupSelection = useCallback(
    (ids: string[], turnOn: boolean) => {
      clearPlaygroundTextPresetTracking();
      setSelectedTypes((previous) => {
        if (turnOn) {
          const next = new Set(previous);
          ids.forEach((id) => next.add(id));
          return [...next];
        }
        return previous.filter((id) => !ids.includes(id));
      });
    },
    [clearPlaygroundTextPresetTracking],
  );

  const toggleVisionType = useCallback(
    (typeId: string, pipelineMode: 'ocr_has' | 'has_image' | 'vlm') => {
      clearPlaygroundVisionPresetTracking();
      if (pipelineMode === 'ocr_has') {
        const isActive = selectedOcrHasTypes.includes(typeId);
        const next = isActive
          ? selectedOcrHasTypes.filter((id) => id !== typeId)
          : [...selectedOcrHasTypes, typeId];
        updateOcrHasTypes(next);
        return { typeId, wasActive: isActive };
      }
      if (pipelineMode === 'vlm') {
        const isActive = selectedVlmTypes.includes(typeId);
        const next = isActive
          ? selectedVlmTypes.filter((id) => id !== typeId)
          : [...selectedVlmTypes, typeId];
        updateVlmTypes(next);
        return { typeId, wasActive: isActive };
      }

      const isActive = selectedHasImageTypes.includes(typeId);
      const next = isActive
        ? selectedHasImageTypes.filter((id) => id !== typeId)
        : [...selectedHasImageTypes, typeId];
      updateHasImageTypes(next);
      return { typeId, wasActive: isActive };
    },
    [
      selectedOcrHasTypes,
      selectedHasImageTypes,
      selectedVlmTypes,
      updateOcrHasTypes,
      updateHasImageTypes,
      updateVlmTypes,
      clearPlaygroundVisionPresetTracking,
    ],
  );

  return {
    entityTypes,
    textConfigState,
    selectedTypes,
    selectedTypesRef,
    setSelectedTypes,
    visionTypes,
    visionConfigState,
    selectedOcrHasTypes,
    selectedHasImageTypes,
    selectedVlmTypes,
    selectedOcrHasTypesRef,
    selectedHasImageTypesRef,
    selectedVlmTypesRef,
    pipelines,
    typeTab,
    setTypeTab,
    replacementMode,
    setReplacementMode,
    textPresetsPg,
    visionPresetsPg,
    playgroundPresetTextId,
    playgroundPresetVisionId,
    selectPlaygroundTextPresetById,
    selectPlaygroundVisionPresetById,
    saveTextPresetFromPlayground,
    saveVisionPresetFromPlayground,
    presetDialogKind,
    presetDialogName,
    setPresetDialogName,
    presetSaving,
    closePresetDialog,
    openTextPresetDialog,
    openVisionPresetDialog,
    clearPlaygroundTextPresetTracking,
    clearPlaygroundVisionPresetTracking,
    sortedEntityTypes,
    playgroundTextGroups,
    setPlaygroundTextTypeGroupSelection,
    toggleVisionType,
    updateOcrHasTypes,
    updateHasImageTypes,
    updateVlmTypes,
    presetApplySeq,
    getTypeConfig: (typeId: string): { name: string; color: string } => {
      const config = entityTypes.find((type) => type.id === typeId);
      return config || { name: typeId, color: '#6366F1' };
    },
    getVisionTypeConfig: (typeId: string): { name: string; color: string } => {
      const config = visionTypes.find((type) => type.id === typeId);
      return config || { name: typeId, color: '#6366F1' };
    },
  };
}
