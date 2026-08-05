import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMERA_FOV_DEFAULT_DEGREES,
  DEFAULT_UI_PRESET_ID,
  VISUAL_GEOMETRY_MODE_LABELS,
  MAP_LEGEND_TOGGLE_DEFS,
  MAP_HIGH_CONTRAST_DEFAULT,
  MOBILE_LOOK_SENSITIVITY_DEFAULT,
  MOUSE_LOOK_SENSITIVITY_DEFAULT,
  HUD_MOTION_DEFAULT,
  SCREEN_INTERFERENCE_DEFAULT,
  UI_ELEMENT_DEFS,
  UI_PRESETS,
  autoPickupEnabled,
  adjustCameraFov,
  cycleHudMotionMode,
  cycleScreenInterferenceMode,
  cycleVisualGeometryMode,
  cycleLightingQualityMode,
  lightingQualityMode,
  lightingQualityModeLabel,
  lightingQualityIndex,
  adjustMobileLookSensitivity,
  adjustMouseLookSensitivity,
  activeUiPresetId,
  applyUiPreset,
  cameraFovDegrees,
  hudMotionMode,
  mapColorMode,
  mapHighContrastEnabled,
  mapLegendRowAt,
  mapLegendRowCount,
  mapLegendToggleEnabled,
  mobileLookSensitivity,
  mouseLookSensitivity,
  resetCameraFov,
  resetAutoPickup,
  resetGraphicsSettings,
  resetMapLegendSettings,
  resetMobileLookSensitivity,
  resetMouseLookSensitivity,
  resetUiElement,
  resetUiSettings,
  screenInterferenceMode,
  toggleAutoPickup,
  toggleMapHighContrast,
  toggleMapLegendToggle,
  setUiElementEnabled,
  toggleUiElement,
  uiElementEnabled,
  uiSettingsRowAt,
  uiSettingsRowCount,
  visualGeometryMode,
  visualGeometryModeLabel,
  normalizeLightingQualityMode,
  LIGHTING_QUALITY_MODES,
  LIGHTING_QUALITY_DEFAULT_MODE,
} from '../src/systems/ui_orchestrator';

test('normalizeLightingQualityMode validates lighting modes and falls back to default', () => {
  for (const mode of LIGHTING_QUALITY_MODES) {
    assert.equal(normalizeLightingQualityMode(mode), mode);
  }

  assert.equal(normalizeLightingQualityMode('invalid'), LIGHTING_QUALITY_DEFAULT_MODE);
  assert.equal(normalizeLightingQualityMode(''), LIGHTING_QUALITY_DEFAULT_MODE);
  assert.equal(normalizeLightingQualityMode(null), LIGHTING_QUALITY_DEFAULT_MODE);
  assert.equal(normalizeLightingQualityMode(undefined), LIGHTING_QUALITY_DEFAULT_MODE);
  assert.equal(normalizeLightingQualityMode(123), LIGHTING_QUALITY_DEFAULT_MODE);
  assert.equal(normalizeLightingQualityMode({}), LIGHTING_QUALITY_DEFAULT_MODE);
});

test('UI orchestrator defaults to the novice-safe HUD enabled', () => {
  resetUiSettings();
  const enabled = UI_ELEMENT_DEFS
    .filter(def => !def.locked && uiElementEnabled(def.id))
    .map(def => def.id);
  assert.deepEqual(enabled, [
    'bottom_tabs',
    'weapon_panel',
    'crosshair',
    'interaction_prompt',
    'hazard_warning',
    'minimap',
    'screen_fx',
    'npc_barks',
  ]);
  assert.equal(DEFAULT_UI_PRESET_ID, 'novice');
  assert.equal(activeUiPresetId(), 'novice');
  assert.equal(UI_ELEMENT_DEFS.find(def => def.id === 'messages')?.label, 'Стенографическая сводка');
  assert.equal(uiElementEnabled('messages'), false);
  assert.equal(uiElementEnabled('route_hints'), false);
  assert.equal(uiElementEnabled('fps_counter'), false);
  assert.equal(uiElementEnabled('damage_feedback'), true);
  assert.equal(uiElementEnabled('samosbor_text'), true);
  assert.equal(uiElementEnabled('credits'), true);
  assert.equal(mobileLookSensitivity(), MOBILE_LOOK_SENSITIVITY_DEFAULT);
  assert.equal(mouseLookSensitivity(), MOUSE_LOOK_SENSITIVITY_DEFAULT);
  assert.equal(cameraFovDegrees(), CAMERA_FOV_DEFAULT_DEGREES);
  assert.equal(screenInterferenceMode(), SCREEN_INTERFERENCE_DEFAULT);
  assert.equal(hudMotionMode(), HUD_MOTION_DEFAULT);
  assert.equal(visualGeometryMode(), 'high');
  assert.equal(autoPickupEnabled(), true);
  assert.equal(mapColorMode(), 'rooms');
  assert.equal(mapHighContrastEnabled(), MAP_HIGH_CONTRAST_DEFAULT);
  assert.deepEqual(
    MAP_LEGEND_TOGGLE_DEFS.map(def => [def.id, mapLegendToggleEnabled(def.id)]),
    [
      ['map_npcs', true],
      ['map_monsters', true],
      ['map_items', true],
      ['map_quests', true],
      ['map_lifts', true],
      ['map_surface_marks', true],
    ],
  );
});

test('map legend settings are local toggles outside HUD presets', () => {
  resetUiSettings();
  assert.equal(mapLegendRowCount(), 2 + MAP_LEGEND_TOGGLE_DEFS.length);
  assert.equal(mapLegendRowAt(0)?.kind, 'reset_map_legend');
  assert.equal(mapLegendRowAt(1)?.kind, 'map_contrast');
  assert.equal(toggleMapHighContrast(), true);
  assert.equal(toggleMapLegendToggle('map_items'), false);
  assert.equal(applyUiPreset('off'), true);
  assert.equal(mapColorMode(), 'rooms');
  assert.equal(mapHighContrastEnabled(), true);
  assert.equal(mapLegendToggleEnabled('map_items'), false);
  resetMapLegendSettings();
  assert.equal(mapColorMode(), 'rooms');
  assert.equal(mapHighContrastEnabled(), false);
  assert.equal(mapLegendToggleEnabled('map_items'), true);
});

test('UI orchestrator treats minimap as an ordinary interface surface', () => {
  resetUiSettings();
  assert.equal(uiElementEnabled('minimap'), true);
  assert.equal(toggleUiElement('minimap'), false);
  assert.equal(uiElementEnabled('minimap'), false);
  assert.equal(resetUiElement('minimap'), true);
  assert.equal(uiElementEnabled('minimap'), true);
});

test('UI orchestrator toggles normal elements but keeps locked system text visible', () => {
  resetUiSettings();
  assert.equal(toggleUiElement('caravan_hints'), true);
  assert.equal(uiElementEnabled('caravan_hints'), true);
  assert.equal(setUiElementEnabled('samosbor_text', false), true);
  assert.equal(uiElementEnabled('samosbor_text'), true);
  assert.equal(setUiElementEnabled('damage_feedback', false), true);
  assert.equal(uiElementEnabled('damage_feedback'), true);
  assert.equal(resetUiElement('caravan_hints'), false);
  assert.equal(uiElementEnabled('caravan_hints'), false);
  assert.equal(resetUiElement('minimap'), true);
  assert.equal(uiElementEnabled('minimap'), true);
});

test('UI orchestrator applies combat preset deterministically', () => {
  resetUiSettings();
  assert.equal(applyUiPreset('combat'), true);
  assert.equal(activeUiPresetId(), 'combat');
  assert.equal(uiElementEnabled('weapon_panel'), true);
  assert.equal(uiElementEnabled('crosshair'), true);
  assert.equal(uiElementEnabled('hazard_warning'), true);
  assert.equal(uiElementEnabled('damage_feedback'), true);
});

test('UI orchestrator can switch off every unlocked surface', () => {
  resetUiSettings();
  assert.equal(applyUiPreset('off'), true);
  assert.equal(activeUiPresetId(), 'off');
  for (const def of UI_ELEMENT_DEFS) {
    assert.equal(uiElementEnabled(def.id), def.locked === true, `${def.id} should only stay enabled when locked`);
  }
});

test('UI orchestrator presets cover minimal and full player-safe modes', () => {
  resetUiSettings();
  assert.equal(applyUiPreset('minimal'), true);
  assert.equal(activeUiPresetId(), 'minimal');
  assert.equal(uiElementEnabled('bottom_tabs'), true);
  assert.equal(uiElementEnabled('interaction_prompt'), true);
  assert.equal(uiElementEnabled('hazard_warning'), true);
  assert.equal(uiElementEnabled('minimap'), true);
  assert.equal(uiElementEnabled('weapon_panel'), false);
  assert.equal(uiElementEnabled('messages'), false);
  assert.equal(uiElementEnabled('samosbor_text'), true);

  assert.equal(applyUiPreset('full'), true);
  assert.equal(activeUiPresetId(), 'full');
  for (const def of UI_ELEMENT_DEFS) {
    if (def.id === 'fps_counter') continue;
    assert.equal(uiElementEnabled(def.id), true, `${def.id} should be enabled by full preset`);
  }
  assert.equal(uiElementEnabled('fps_counter'), false);
  assert.equal(uiSettingsRowCount('interface'), UI_PRESETS.length + UI_ELEMENT_DEFS.length + 3);
  assert.equal(uiSettingsRowCount('graphics'), 8);
  assert.equal(uiSettingsRowAt(0, 'interface')?.kind, 'reset_interface');
  assert.equal(uiSettingsRowAt(0, 'graphics')?.kind, 'reset_graphics');
});

test('UI orchestrator keeps auto-pickup as a gameplay toggle outside presets', () => {
  resetUiSettings();
  assert.equal(autoPickupEnabled(), true);
  assert.equal(toggleAutoPickup(), false);
  assert.equal(autoPickupEnabled(), false);
  assert.equal(applyUiPreset('full'), true);
  assert.equal(autoPickupEnabled(), false);
  assert.equal(resetAutoPickup(), true);
  const row = uiSettingsRowAt(1 + UI_PRESETS.length + UI_ELEMENT_DEFS.length, 'interface');
  assert.equal(row?.kind, 'auto_pickup');
});

test('UI orchestrator stores mobile look sensitivity outside presets', () => {
  resetUiSettings();
  assert.equal(mobileLookSensitivity(), 0.5);
  assert.equal(adjustMobileLookSensitivity(1), 0.75);
  assert.equal(adjustMobileLookSensitivity(3), 1.5);
  assert.equal(adjustMobileLookSensitivity(1), 0.25);
  assert.equal(applyUiPreset('off'), true);
  assert.equal(mobileLookSensitivity(), 0.25);
  assert.equal(resetMobileLookSensitivity(), 0.5);
  const row = uiSettingsRowAt(uiSettingsRowCount('interface') - 1, 'interface');
  assert.equal(row?.kind, 'mobile_sensitivity');
});

test('UI orchestrator stores desktop mouse sensitivity outside presets', () => {
  resetUiSettings();
  assert.equal(mouseLookSensitivity(), 1.3);
  assert.equal(adjustMouseLookSensitivity(1), 1.4);
  assert.equal(adjustMouseLookSensitivity(-20), 0.5);
  assert.equal(adjustMouseLookSensitivity(2), 0.7);
  assert.equal(applyUiPreset('off'), true);
  assert.equal(mouseLookSensitivity(), 0.7);
  assert.equal(resetMouseLookSensitivity(), 1.3);
});

test('UI orchestrator stores camera FOV as a graphics setting outside presets', () => {
  resetUiSettings();
  assert.equal(cameraFovDegrees(), 90);
  assert.equal(adjustCameraFov(1), 95);
  assert.equal(adjustCameraFov(3), 110);
  assert.equal(adjustCameraFov(1), 60);
  assert.equal(applyUiPreset('off'), true);
  assert.equal(cameraFovDegrees(), 60);
  assert.equal(resetCameraFov(), 90);
  const row = uiSettingsRowAt(5, 'graphics');
  assert.equal(row?.kind, 'camera_fov');
});

test('UI orchestrator stores visual geometry mode as a graphics setting outside presets', () => {
  resetUiSettings();
  assert.equal(visualGeometryMode(), 'high');
  assert.equal(visualGeometryModeLabel(), 'Высокая');
  assert.equal(VISUAL_GEOMETRY_MODE_LABELS.high, 'Высокая');
  assert.equal(cycleVisualGeometryMode(1), 'off');
  assert.equal(cycleVisualGeometryMode(1), 'low');
  assert.equal(cycleVisualGeometryMode(1), 'medium');
  assert.equal(applyUiPreset('full'), true);
  assert.equal(visualGeometryMode(), 'medium');
  resetGraphicsSettings();
  assert.equal(visualGeometryMode(), 'high');
  const row = uiSettingsRowAt(3, 'graphics');
  assert.equal(row?.kind, 'visual_geometry');
});

test('UI orchestrator stores lighting quality as a graphics setting defaulting to max', () => {
  resetUiSettings();
  assert.equal(lightingQualityMode(), 'experimental');
  assert.equal(lightingQualityModeLabel(), 'Максимум');
  assert.equal(lightingQualityIndex(), 4);
  assert.equal(cycleLightingQualityMode(1), 'off');
  assert.equal(lightingQualityIndex(), 0);
  assert.equal(cycleLightingQualityMode(1), 'low');
  assert.equal(cycleLightingQualityMode(1), 'medium');
  assert.equal(applyUiPreset('full'), true);
  assert.equal(lightingQualityMode(), 'medium');
  resetGraphicsSettings();
  assert.equal(lightingQualityMode(), 'experimental');
  assert.equal(uiSettingsRowAt(4, 'graphics')?.kind, 'lighting_quality');
});

test('UI orchestrator keeps graphics fatigue settings outside interface presets', () => {
  resetUiSettings();
  assert.equal(screenInterferenceMode(), 'critical');
  assert.equal(hudMotionMode(), 'reduced');
  assert.equal(visualGeometryMode(), 'high');
  assert.equal(cycleScreenInterferenceMode(1), 'full');
  assert.equal(cycleHudMotionMode(), 'normal');
  assert.equal(cycleVisualGeometryMode(1), 'off');
  assert.equal(applyUiPreset('off'), true);
  assert.equal(screenInterferenceMode(), 'full');
  assert.equal(hudMotionMode(), 'normal');
  assert.equal(visualGeometryMode(), 'off');
  resetGraphicsSettings();
  assert.equal(cameraFovDegrees(), 90);
  assert.equal(screenInterferenceMode(), 'critical');
  assert.equal(hudMotionMode(), 'reduced');
  assert.equal(visualGeometryMode(), 'high');
  assert.equal(uiSettingsRowAt(1, 'graphics')?.kind, 'screen_interference');
  assert.equal(uiSettingsRowAt(2, 'graphics')?.kind, 'hud_motion');
  assert.equal(uiSettingsRowAt(3, 'graphics')?.kind, 'visual_geometry');
  assert.equal(uiSettingsRowAt(4, 'graphics')?.kind, 'lighting_quality');
  assert.equal(uiSettingsRowAt(6, 'graphics')?.kind, 'map_contrast');
});

test('UI orchestrator handles invalid element IDs defensively', () => {
  resetUiSettings();
  // @ts-expect-error - Testing invalid ID fallback logic
  assert.equal(uiElementEnabled('non_existent_element'), false);
  // @ts-expect-error - Testing invalid ID fallback logic
  assert.equal(setUiElementEnabled('non_existent_element', true), false);
  // @ts-expect-error - Testing invalid ID fallback logic
  assert.equal(toggleUiElement('non_existent_element'), false);
});

test('UI orchestrator handles normal element toggling correctly', () => {
  resetUiSettings();
  // Test fallback to defaultEnabled
  assert.equal(uiElementEnabled('messages'), false);

  // Test overrides via settings dict
  assert.equal(setUiElementEnabled('messages', true), true);
  assert.equal(uiElementEnabled('messages'), true);

  // Test locked element behavior (always returns true)
  assert.equal(uiElementEnabled('damage_feedback'), true);
  assert.equal(setUiElementEnabled('damage_feedback', false), true);
  assert.equal(uiElementEnabled('damage_feedback'), true);
});
